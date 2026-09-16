import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { apiKeys, getHttpDb } from '@llmgw/db/http';
import { getCurrentWorkspace } from './session';
import type { ChatMessage, ChatResult } from './chat-types';

const PLAYGROUND_KEY_NAME = 'Playground (internal)';
export const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8787';

// The playground calls the gateway like any client, so it needs a real API key.
// We mint one for the workspace and cache it in memory (never sent to the browser).
let cachedRaw: string | null = null;
let cachedWorkspaceId: string | null = null;

interface GatewayResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: Record<string, unknown>;
  _routing?: Record<string, unknown>;
  _orchestration?: {
    pattern?: unknown;
    legs?: unknown;
    requestedN?: unknown;
    completedN?: unknown;
    diversityMode?: unknown;
    judgeReason?: unknown;
  };
  model?: unknown;
  error?: { message?: unknown };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function errorResult(error: string, durationMs = 0): ChatResult {
  return {
    content: '',
    error,
    model: '',
    provider: null,
    mode: null,
    task: null,
    attempts: null,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
    durationMs,
    tokensPerSec: 0,
  };
}

export async function ensurePlaygroundKey(workspaceId: string): Promise<string> {
  if (cachedRaw && cachedWorkspaceId === workspaceId) return cachedRaw;
  const db = getHttpDb();
  const raw = 'sk-llmgw-' + randomBytes(24).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  // Revoke prior internal keys so only the current one stays active.
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.workspaceId, workspaceId),
        eq(apiKeys.name, PLAYGROUND_KEY_NAME),
        isNull(apiKeys.revokedAt),
      ),
    );
  await db.insert(apiKeys).values({
    workspaceId,
    name: PLAYGROUND_KEY_NAME,
    keyPrefix: raw.slice(0, 14),
    keyLast4: raw.slice(-4),
    keyHash: hash,
  });
  cachedRaw = raw;
  cachedWorkspaceId = workspaceId;
  return raw;
}

interface SpecMeta {
  draft_model?: unknown;
  verify_model?: unknown;
  forked?: unknown;
  fork_at_chars?: unknown;
  ttft_ms?: unknown;
  draft_tokens?: unknown;
  verify_tokens?: unknown;
  draft_prompt_tokens?: unknown;
  verify_prompt_tokens?: unknown;
  mean_draft_confidence?: unknown;
  draft_cost_usd?: unknown;
  verify_cost_usd?: unknown;
  total_cost_usd?: unknown;
}

// Consume a speculative-decode SSE stream to completion, accumulating the streamed
// content and reading the in-band `_speculative` summary emitted on the final chunk.
async function speculativeChat(
  key: string,
  body: Record<string, unknown>,
  model: string,
): Promise<ChatResult> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'x-title': 'Playground',
      },
      body: JSON.stringify({ ...body, stream: true }),
    });
  } catch (err) {
    return errorResult(
      `Could not reach the gateway at ${GATEWAY_URL}. Is it running? ${(err as Error).message}`,
      Date.now() - started,
    );
  }
  if (!res.ok || !res.body) {
    let msg = `Gateway error ${res.status}`;
    try {
      const j = (await res.json()) as GatewayResponse;
      msg = str(j?.error?.message) ?? msg;
    } catch {
      /* non-JSON body */
    }
    return errorResult(msg, Date.now() - started);
  }

  let content = '';
  let spec: SpecMeta | null = null;
  let clientTtftMs = 0;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(payload);
        } catch {
          continue;
        }
        const choice = (obj.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const delta = (choice?.delta as { content?: unknown } | undefined) ?? {};
        if (typeof delta.content === 'string' && delta.content) {
          if (clientTtftMs === 0) clientTtftMs = Date.now() - started;
          content += delta.content;
        }
        if (obj._speculative && typeof obj._speculative === 'object') {
          spec = obj._speculative as SpecMeta;
        }
      }
    }
  } catch (err) {
    if (!content) return errorResult((err as Error).message, Date.now() - started);
  }

  const durationMs = Date.now() - started;
  const draftModel = str(spec?.draft_model) ?? model;
  const verifyModel = str(spec?.verify_model);
  const forked = spec?.forked === true;
  const finalModel = verifyModel ?? draftModel;
  const draftCost = num(spec?.draft_cost_usd);
  const verifyCost = num(spec?.verify_cost_usd);
  const totalCost = spec?.total_cost_usd != null ? num(spec.total_cost_usd) : draftCost + verifyCost;
  const draftTokens = num(spec?.draft_tokens);
  const verifyTokens = num(spec?.verify_tokens);
  const promptTokens = num(spec?.draft_prompt_tokens) + num(spec?.verify_prompt_tokens);
  const completionTokens = draftTokens + verifyTokens;
  const ttft = num(spec?.ttft_ms) || clientTtftMs;
  const confidence = num(spec?.mean_draft_confidence);
  const forkAt = num(spec?.fork_at_chars);

  const legs: ChatResult['legs'] = [
    {
      role: 'draft',
      model: draftModel,
      costUsd: draftCost,
      outcome: forked ? 'accepted' : 'ok',
      displayOrder: 1,
      temperature: null,
      note: `${draftTokens} tok · ttft ${ttft}ms${confidence > 0 ? ` · conf ${(confidence * 100).toFixed(0)}%` : ''}`,
    },
  ];
  if (forked && verifyModel) {
    legs.push({
      role: 'verify',
      model: verifyModel,
      costUsd: verifyCost,
      outcome: 'composed',
      displayOrder: 2,
      temperature: null,
      note: `${verifyTokens} tok · continued at ${forkAt} chars`,
    });
  }

  return {
    content,
    model: finalModel,
    provider: finalModel.includes('/') ? (finalModel.split('/')[0] ?? null) : null,
    mode: 'speculative',
    task: 'speculative',
    attempts: null,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    cost: totalCost,
    durationMs,
    tokensPerSec: durationMs > 0 ? completionTokens / (durationMs / 1000) : 0,
    pattern: 'speculative',
    legs,
    requestedN: null,
    completedN: null,
    diversityMode: forked ? 'forked' : 'draft-only',
    judgeReason: forked
      ? `Drafter uncertainty crossed the confidence gate at ${forkAt} chars — forked to the verifier for the rest.`
      : 'Drafter stayed confident throughout — no fork needed.',
  };
}

export async function playgroundChat(opts: {
  messages: ChatMessage[];
  model: string;
  costTier?: string;
  orchestrate?: string;
}): Promise<ChatResult> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return errorResult('No workspace connected. Set up the database first.');

  let key: string;
  try {
    key = await ensurePlaygroundKey(ctx.workspace.id);
  } catch (err) {
    return errorResult('Could not create a playground key: ' + (err as Error).message);
  }

  const body: Record<string, unknown> = { model: opts.model, messages: opts.messages };
  if (opts.costTier) body.cost_tier = opts.costTier;
  if (opts.orchestrate) body.orchestrate = opts.orchestrate;

  // Speculative decoding is streaming-only; consume the SSE stream server-side and
  // fold the in-band `_speculative` summary into the same ChatResult shape.
  if (opts.orchestrate === 'speculative') {
    return speculativeChat(key, body, opts.model);
  }

  const started = Date.now();
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'x-title': 'Playground',
      },
      body: JSON.stringify(body),
    });
    const durationMs = Date.now() - started;
    const json = (await res.json()) as GatewayResponse;
    if (!res.ok) {
      return errorResult(str(json?.error?.message) ?? `Gateway error ${res.status}`, durationMs);
    }

    const usage = json.usage ?? {};
    const routing = json._routing ?? {};
    const orch = json._orchestration;
    const legs = Array.isArray(orch?.legs)
      ? (orch.legs as unknown[]).map((l) => {
          const o = (l ?? {}) as Record<string, unknown>;
          return {
            role: str(o.role) ?? '',
            model: str(o.model) ?? '',
            costUsd: num(o.costUsd),
            outcome: str(o.outcome),
            displayOrder: typeof o.displayOrder === 'number' ? o.displayOrder : null,
            temperature: typeof o.temperature === 'number' ? o.temperature : null,
            note: str(o.note),
          };
        })
      : undefined;
    const content = str(json.choices?.[0]?.message?.content) ?? '';
    const completionTokens = num(usage.completion_tokens);
    return {
      content,
      model: str(json.model) ?? opts.model,
      provider: str(routing.provider),
      mode: str(routing.mode),
      task: str(routing.task),
      attempts: typeof routing.attempts === 'number' ? routing.attempts : null,
      promptTokens: num(usage.prompt_tokens),
      completionTokens,
      totalTokens: num(usage.total_tokens),
      cost: num(usage.cost),
      durationMs,
      tokensPerSec: durationMs > 0 ? completionTokens / (durationMs / 1000) : 0,
      pattern: orch ? str(orch.pattern) : null,
      legs,
      requestedN: orch && typeof orch.requestedN === 'number' ? orch.requestedN : null,
      completedN: orch && typeof orch.completedN === 'number' ? orch.completedN : null,
      diversityMode: orch ? str(orch.diversityMode) : null,
      judgeReason: orch ? str(orch.judgeReason) : null,
    };
  } catch (err) {
    return errorResult(
      `Could not reach the gateway at ${GATEWAY_URL}. Is it running? ${(err as Error).message}`,
      Date.now() - started,
    );
  }
}
