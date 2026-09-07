import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { apiKeys, getHttpDb } from '@llmgw/db/http';
import { getCurrentWorkspace } from './session';
import type { ChatMessage, ChatResult } from './chat-types';

const PLAYGROUND_KEY_NAME = 'Playground (internal)';
const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8787';

// The playground calls the gateway like any client, so it needs a real API key.
// We mint one for the workspace and cache it in memory (never sent to the browser).
let cachedRaw: string | null = null;
let cachedWorkspaceId: string | null = null;

interface GatewayResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: Record<string, unknown>;
  _routing?: Record<string, unknown>;
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

async function ensurePlaygroundKey(workspaceId: string): Promise<string> {
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

export async function playgroundChat(opts: {
  messages: ChatMessage[];
  model: string;
  costTier?: string;
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
    };
  } catch (err) {
    return errorResult(
      `Could not reach the gateway at ${GATEWAY_URL}. Is it running? ${(err as Error).message}`,
      Date.now() - started,
    );
  }
}
