import { baseUrlEnvKey, providerMeta, type GuardrailPolicies } from '@llmgw/db';
import { recordUsage } from '../billing/record';
import { resolveProviderKey } from '../providers/keys';
import type { ChatMessage } from '../providers/types';
import { autoRoute } from '../routing/auto';
import { approxPromptTokens } from '../routing/classify';
import { resolveModel, type ResolvedModel } from '../routing/resolve';

// ---------------------------------------------------------------------------
// Active Multi-Provider Speculative Cross-Provider Decoding.
//
// A fast, cheap "drafter" starts streaming immediately (low TTFT) with token logprobs.
// The gateway watches the drafter's confidence on the fly; the moment a cheap model
// becomes uncertain over a span, it forks to a frontier "verifier" that continues
// seamlessly from the accepted prefix — one continuous SSE stream the client never sees
// break. The drafter serves the easy majority cheaply/fast; the frontier model is spent
// only where it's actually needed.
//
// Honest limits: true token-level speculative decoding needs the verifier's per-token
// logits for a supplied continuation, which black-box chat APIs don't expose. So
// acceptance is gated on the DRAFTER's own logprobs (uncertainty predicts error) at
// chunk granularity — same business outcome (frontier quality at fast TTFT) within what
// provider APIs allow. Both legs use the OpenAI wire format (logprobs required).
// ---------------------------------------------------------------------------

export interface SpecDecodeCtx {
  orgId: string;
  workspaceId: string;
  apiKeyId: string;
  requestId: string;
  traceId: string;
  appName: string | null;
  guardrail: GuardrailPolicies | null;
  allowedModels: string[];
  keyedProviders: Set<string>;
  maxTokens: number;
  startedAt: number;
}

export interface SpecDecodeOpts {
  messages: ChatMessage[];
  ctx: SpecDecodeCtx;
  draftModel?: string | null;
  verifyModel?: string | null;
  confidenceThreshold?: number; // rolling mean logprob under which we fork (default -1.1)
  windowSize?: number; // rolling window of tokens (default 16)
  minDraftTokens?: number; // don't fork before this many accepted tokens (default 12)
  temperature?: number;
}

export interface SpecSummary {
  draftModel: string;
  verifyModel: string | null;
  forked: boolean;
  forkAtChars: number;
  ttftMs: number;
  draftTokens: number;
  verifyTokens: number;
  meanDraftConfidence: number; // mean token probability over the draft (0..1)
  content: string;
  totalCostUsd: number;
  error?: string;
}

const DRAFT_LOGPROB_BODY = { logprobs: true, top_logprobs: 0 } as const;
const CHAIN_DEPTH = 4;

function providerBaseUrl(providerSlug: string): string | null {
  const meta = providerMeta(providerSlug);
  if (!meta || meta.kind !== 'openai') return null; // logprobs + OpenAI wire format required
  return process.env[baseUrlEnvKey(meta)] ?? meta.baseUrl;
}

async function resolveOpenAiModel(slug: string): Promise<ResolvedModel | null> {
  const m = await resolveModel(slug);
  if (!m) return null;
  return providerMeta(m.providerSlug)?.kind === 'openai' ? m : null;
}

// Ranked fallback chains: cheap-first drafters + strong-first verifiers, all OpenAI-kind
// and runnable for this org. One route call feeds both (fewer round-trips); the chains
// let us skip a catalog model that isn't actually callable on the key.
async function selectChains(
  opts: SpecDecodeOpts,
): Promise<{ draftChain: ResolvedModel[]; verifyChain: ResolvedModel[] } | null> {
  const explicitDraft = opts.draftModel ? await resolveOpenAiModel(opts.draftModel) : null;
  const explicitVerify = opts.verifyModel ? await resolveOpenAiModel(opts.verifyModel) : null;

  const routed = await autoRoute({
    messages: opts.messages,
    costTier: 'low',
    maxTokens: opts.ctx.maxTokens,
    guardrail: opts.ctx.guardrail,
    allowedModels: opts.ctx.allowedModels,
    keyedProviders: opts.ctx.keyedProviders,
  });
  const seen = new Set<string>();
  const pool: ResolvedModel[] = [];
  for (const c of routed.ranked) {
    if (providerMeta(c.providerSlug)?.kind !== 'openai' || seen.has(c.slug)) continue;
    seen.add(c.slug);
    pool.push({
      slug: c.slug,
      providerSlug: c.providerSlug,
      upstreamModel: c.upstreamModel,
      promptPricePerM: String(c.promptPricePerM),
      completionPricePerM: String(c.completionPricePerM),
    });
  }
  const cheapFirst = [...pool].sort((a, b) => Number(a.completionPricePerM) - Number(b.completionPricePerM));
  const strongFirst = [...pool].sort((a, b) => Number(b.completionPricePerM) - Number(a.completionPricePerM));

  const draftChain = explicitDraft
    ? [explicitDraft, ...cheapFirst.filter((m) => m.slug !== explicitDraft.slug)]
    : cheapFirst;
  const verifyChain = explicitVerify
    ? [explicitVerify, ...strongFirst.filter((m) => m.slug !== explicitVerify.slug)]
    : strongFirst;

  if (draftChain.length === 0) return null;
  return { draftChain: draftChain.slice(0, CHAIN_DEPTH), verifyChain: verifyChain.slice(0, CHAIN_DEPTH) };
}

interface Delta {
  content: string;
  logprobs: number[];
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number } | null;
}

function parseSSE(data: string): Delta | 'done' | null {
  if (data === '[DONE]') return 'done';
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(data);
  } catch {
    return null;
  }
  const choice = (obj.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const delta = (choice?.delta as { content?: unknown } | undefined) ?? {};
  const content = typeof delta.content === 'string' ? delta.content : '';
  const lp = (choice?.logprobs as { content?: Array<{ logprob?: unknown }> } | undefined)?.content ?? [];
  const logprobs = lp.map((t) => (typeof t.logprob === 'number' ? t.logprob : 0)).filter((n) => Number.isFinite(n));
  const finishReason = typeof choice?.finish_reason === 'string' ? (choice.finish_reason as string) : null;
  const u = obj.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  const usage = u ? { promptTokens: u.prompt_tokens ?? 0, completionTokens: u.completion_tokens ?? 0 } : null;
  return { content, logprobs, finishReason, usage };
}

async function openaiFetchStream(
  baseUrl: string,
  key: string,
  upstreamModel: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ ...body, model: upstreamModel, stream: true, stream_options: { include_usage: true } }),
    signal,
  });
}

// Open the first candidate in a chain that actually returns a stream (skips un-served
// catalog models that 4xx immediately). Returns the opened response + the model used.
async function openFirst(
  orgId: string,
  chain: ResolvedModel[],
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{ res: Response; model: ResolvedModel; isByok: boolean } | null> {
  for (const cand of chain) {
    const keyInfo = await resolveProviderKey(orgId, cand.providerSlug);
    const base = providerBaseUrl(cand.providerSlug);
    if (!keyInfo.key || !base) continue;
    try {
      const res = await openaiFetchStream(base, keyInfo.key, cand.upstreamModel, body, signal);
      if (res.ok && res.body) return { res, model: cand, isByok: keyInfo.isByok };
      await res.body?.cancel().catch(() => {});
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function sseChunk(id: string, model: string, delta: { role?: string; content?: string }, finish: string | null): Uint8Array {
  const obj = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

const DONE_BYTES = new TextEncoder().encode('data: [DONE]\n\n');

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function costOf(m: ResolvedModel, promptTokens: number, completionTokens: number): number {
  return (
    (promptTokens / 1_000_000) * Number(m.promptPricePerM) +
    (completionTokens / 1_000_000) * Number(m.completionPricePerM)
  );
}

// The terminal chunk. Carries the speculative summary under a non-standard
// `_speculative` key — OpenAI-compatible clients ignore unknown fields, while
// gateway-aware clients (playground, SDK) can surface the fork/models/TTFT/cost.
function finalSpecChunk(
  id: string,
  model: string,
  finish: string | null,
  spec: Record<string, unknown>,
): Uint8Array {
  const obj = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: {}, finish_reason: finish }],
    _speculative: spec,
  };
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

export function runSpeculativeDecode(opts: SpecDecodeOpts): {
  stream: ReadableStream<Uint8Array>;
  done: Promise<SpecSummary>;
} {
  let resolveDone!: (s: SpecSummary) => void;
  const done = new Promise<SpecSummary>((r) => (resolveDone = r));
  const draftAbort = new AbortController();
  const verifyAbort = new AbortController();

  const threshold = opts.confidenceThreshold ?? -1.1;
  const windowSize = Math.max(4, opts.windowSize ?? 16);
  const minDraftTokens = Math.max(1, opts.minDraftTokens ?? 12);
  const id = `spec-${opts.ctx.requestId}`;

  const emptySummary = (error: string): SpecSummary => ({
    draftModel: '',
    verifyModel: null,
    forked: false,
    forkAtChars: 0,
    ttftMs: 0,
    draftTokens: 0,
    verifyTokens: 0,
    meanDraftConfidence: 0,
    content: '',
    totalCostUsd: 0,
    error,
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void pipeline(controller).catch((err) => {
        try {
          controller.enqueue(sseChunk(id, 'error', {}, 'error'));
          controller.enqueue(DONE_BYTES);
          controller.close();
        } catch {
          /* already closed */
        }
        resolveDone(emptySummary((err as Error).message));
      });
    },
    cancel() {
      draftAbort.abort();
      verifyAbort.abort();
    },
  });

  async function pipeline(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    const chains = await selectChains(opts);
    if (!chains) {
      controller.enqueue(sseChunk(id, 'error', { content: 'No runnable model for speculative decoding.' }, 'stop'));
      controller.enqueue(DONE_BYTES);
      controller.close();
      resolveDone(emptySummary('no runnable model'));
      return;
    }

    // ---- Drafter: first callable candidate, streamed immediately ----
    const draftOpen = await openFirst(
      opts.ctx.orgId,
      chains.draftChain,
      {
        messages: opts.messages,
        max_tokens: opts.ctx.maxTokens,
        ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
        ...(chains.verifyChain.length > 0 ? DRAFT_LOGPROB_BODY : {}),
      },
      draftAbort.signal,
    );
    if (!draftOpen) {
      controller.enqueue(sseChunk(id, 'error', { content: 'Drafter unavailable.' }, 'stop'));
      controller.enqueue(DONE_BYTES);
      controller.close();
      resolveDone(emptySummary('drafter unavailable'));
      return;
    }
    const draft = draftOpen.model;
    const canFork = chains.verifyChain.some((m) => m.slug !== draft.slug);

    controller.enqueue(sseChunk(id, draft.slug, { role: 'assistant', content: '' }, null));

    let accepted = '';
    let draftTokens = 0;
    let firstTokenAt = 0;
    let forked = false;
    const window: number[] = [];
    const allLogprobs: number[] = [];
    let draftFinish: string | null = null;
    let draftUsage: { promptTokens: number; completionTokens: number } | null = null;

    try {
      const reader = draftOpen.res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      outer: for (;;) {
        const { done: rdone, value } = await reader.read();
        if (rdone) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const parsed = parseSSE(line.slice(5).trim());
          if (!parsed) continue;
          if (parsed === 'done') break outer;
          if (parsed.usage) draftUsage = parsed.usage;
          if (parsed.finishReason) draftFinish = parsed.finishReason;
          if (parsed.content) {
            if (firstTokenAt === 0) firstTokenAt = Date.now();
            accepted += parsed.content;
            controller.enqueue(sseChunk(id, draft.slug, { content: parsed.content }, null));
          }
          for (const lp of parsed.logprobs) {
            allLogprobs.push(lp);
            window.push(lp);
            if (window.length > windowSize) window.shift();
            draftTokens += 1;
          }
          if (
            canFork &&
            !forked &&
            draftTokens >= minDraftTokens &&
            window.length >= Math.min(windowSize, minDraftTokens) &&
            mean(window) < threshold
          ) {
            forked = true;
            draftAbort.abort();
            break outer;
          }
        }
        if (draftFinish) break;
      }
    } catch (err) {
      if (!forked && accepted.length === 0) {
        controller.enqueue(sseChunk(id, draft.slug, { content: 'Drafter error.' }, 'stop'));
        controller.enqueue(DONE_BYTES);
        controller.close();
        resolveDone(emptySummary((err as Error).message));
        return;
      }
    }

    const forkAtChars = accepted.length;
    let verifyText = '';
    let verifyTokens = 0;
    let verifyModel: ResolvedModel | null = null;
    let verifyIsByok = false;
    let verifyUsage: { promptTokens: number; completionTokens: number } | null = null;
    let finalFinish = draftFinish ?? 'stop';

    // ---- Verifier: seamless continuation from the accepted prefix ----
    if (forked && canFork) {
      const verifyChain = chains.verifyChain.filter((m) => m.slug !== draft.slug);
      const continueMessages: ChatMessage[] = [...opts.messages, { role: 'assistant', content: accepted }];
      const vOpen = await openFirst(
        opts.ctx.orgId,
        verifyChain,
        {
          messages: continueMessages,
          max_tokens: opts.ctx.maxTokens,
          ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
        },
        verifyAbort.signal,
      );
      if (vOpen) {
        verifyModel = vOpen.model;
        verifyIsByok = vOpen.isByok;
        try {
          const reader = vOpen.res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          vouter: for (;;) {
            const { done: rdone, value } = await reader.read();
            if (rdone) break;
            buffer += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, nl).trim();
              buffer = buffer.slice(nl + 1);
              if (!line.startsWith('data:')) continue;
              const parsed = parseSSE(line.slice(5).trim());
              if (!parsed) continue;
              if (parsed === 'done') break vouter;
              if (parsed.usage) verifyUsage = parsed.usage;
              if (parsed.finishReason) finalFinish = parsed.finishReason;
              if (parsed.content) {
                verifyText += parsed.content;
                verifyTokens += 1;
                controller.enqueue(sseChunk(id, verifyModel.slug, { content: parsed.content }, null));
              }
            }
          }
        } catch {
          // Verifier dropped mid-continuation; the drafted prefix already streamed stands.
        }
      }
    }

    // ---- Token accounting + per-leg cost (same formula recordUsage bills with) ----
    const draftPromptTokens = draftUsage?.promptTokens ?? approxPromptTokens(opts.messages);
    const draftCompletionTokens = draftUsage?.completionTokens ?? draftTokens;
    const ttftMs = firstTokenAt ? firstTokenAt - opts.ctx.startedAt : 0;
    const draftCost = costOf(draft, draftPromptTokens, draftCompletionTokens);

    const verifyMetered = !!(verifyModel && (verifyUsage || verifyTokens > 0));
    const verifyPromptTokens = verifyMetered
      ? (verifyUsage?.promptTokens ?? approxPromptTokens(opts.messages) + Math.ceil(forkAtChars / 4))
      : 0;
    const verifyCompletionTokens = verifyMetered ? (verifyUsage?.completionTokens ?? verifyTokens) : 0;
    const verifyCost = verifyModel && verifyMetered ? costOf(verifyModel, verifyPromptTokens, verifyCompletionTokens) : 0;
    const meanConfidence = allLogprobs.length ? Number(Math.exp(mean(allLogprobs)).toFixed(3)) : 0;

    // Final chunk carries the speculative summary in-band so any streaming client
    // sees the fork, models, TTFT and cost without a side channel.
    controller.enqueue(
      finalSpecChunk(id, verifyModel ? verifyModel.slug : draft.slug, finalFinish, {
        draft_model: draft.slug,
        verify_model: verifyModel ? verifyModel.slug : null,
        forked: !!verifyModel,
        fork_at_chars: forkAtChars,
        ttft_ms: ttftMs,
        draft_tokens: draftTokens,
        verify_tokens: verifyTokens,
        draft_prompt_tokens: draftPromptTokens,
        verify_prompt_tokens: verifyPromptTokens,
        mean_draft_confidence: meanConfidence,
        draft_cost_usd: Number(draftCost.toFixed(6)),
        verify_cost_usd: Number(verifyCost.toFixed(6)),
        total_cost_usd: Number((draftCost + verifyCost).toFixed(6)),
      }),
    );
    controller.enqueue(DONE_BYTES);
    controller.close();

    // ---- Metering: each provider leg billed individually (server-side) ----
    await recordUsage({
      requestId: `${opts.ctx.requestId}#draft`,
      workspaceId: opts.ctx.workspaceId,
      apiKeyId: opts.ctx.apiKeyId,
      orgId: opts.ctx.orgId,
      modelSlug: draft.slug,
      providerSlug: draft.providerSlug,
      taskClass: 'speculative',
      status: 'success',
      promptTokens: draftPromptTokens,
      completionTokens: draftCompletionTokens,
      totalTokens: draftPromptTokens + draftCompletionTokens,
      promptPricePerM: draft.promptPricePerM,
      completionPricePerM: draft.completionPricePerM,
      latencyMs: Date.now() - opts.ctx.startedAt,
      byok: draftOpen.isByok,
      traceId: opts.ctx.traceId,
      ttftMs,
      appName: opts.ctx.appName,
    });

    if (verifyModel && verifyMetered) {
      await recordUsage({
        requestId: `${opts.ctx.requestId}#verify`,
        workspaceId: opts.ctx.workspaceId,
        apiKeyId: opts.ctx.apiKeyId,
        orgId: opts.ctx.orgId,
        modelSlug: verifyModel.slug,
        providerSlug: verifyModel.providerSlug,
        taskClass: 'speculative',
        status: 'success',
        promptTokens: verifyPromptTokens,
        completionTokens: verifyCompletionTokens,
        totalTokens: verifyPromptTokens + verifyCompletionTokens,
        promptPricePerM: verifyModel.promptPricePerM,
        completionPricePerM: verifyModel.completionPricePerM,
        latencyMs: Date.now() - opts.ctx.startedAt,
        byok: verifyIsByok,
        traceId: opts.ctx.traceId,
        appName: opts.ctx.appName,
      });
    }

    resolveDone({
      draftModel: draft.slug,
      verifyModel: verifyModel ? verifyModel.slug : null,
      forked: !!verifyModel,
      forkAtChars,
      ttftMs,
      draftTokens,
      verifyTokens,
      meanDraftConfidence: meanConfidence,
      content: accepted + verifyText,
      totalCostUsd: draftCost + verifyCost,
    });
  }

  return { stream, done };
}
