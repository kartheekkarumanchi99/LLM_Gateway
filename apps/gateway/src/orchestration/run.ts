import { recordUsage } from '../billing/record';
import { resolveProviderKey } from '../providers/keys';
import { getAdapter } from '../providers/registry';
import type { ChatCompletionRequest, ChatMessage } from '../providers/types';
import { autoRoute } from '../routing/auto';
import type { RankedCandidate } from '../routing/types';
import type { GuardrailPolicies } from '@llmgw/db';

// HydraFusion-style compound workflows on top of the single-model router.
// - cascade: a cheap model drafts, a quality gate accepts or escalates to a stronger model.
// - critique: a model drafts, an independent critic reviews, the drafter revises once.
// Every leg is metered individually ("complete accounting").

export type OrchestrationPattern = 'cascade' | 'critique' | 'bestofn';

export interface OrchestrationCtx {
  orgId: string;
  workspaceId: string;
  apiKeyId: string;
  requestId: string;
  appName: string | null;
  guardrail: GuardrailPolicies | null;
  allowedModels: string[];
  maxTokens: number;
}

export interface OrchestrationLeg {
  role: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  outcome: string;
  temperature?: number;
  displayOrder?: number; // slot this candidate occupied when shown to the judge
}

export interface OrchestrationResult {
  pattern: OrchestrationPattern;
  content: string;
  chosenModel: string;
  legs: OrchestrationLeg[];
  totalCostUsd: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  taskClass: string;
  requestedN?: number;
  completedN?: number;
  diversityMode?: 'single-model' | 'multi-model' | 'n/a';
  judgeReason?: string | null;
  error?: string;
}

type LegModel = Pick<
  RankedCandidate,
  'slug' | 'providerSlug' | 'upstreamModel' | 'promptPricePerM' | 'completionPricePerM'
>;

interface LegOk {
  content: string;
  leg: OrchestrationLeg;
}
interface LegErr {
  error: string;
}

function textOf(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content ?? '');
}

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') return textOf(messages[i]!.content);
  }
  return textOf(messages[messages.length - 1]?.content);
}

function extractContent(json: Record<string, unknown>): string {
  const choices = json.choices as Array<{ message?: { content?: unknown } }> | undefined;
  const c = choices?.[0]?.message?.content;
  return typeof c === 'string' ? c : '';
}

function parseAccept(text: string): boolean {
  const m = text.match(/"accept"\s*:\s*(true|false)/i);
  if (m) return m[1]!.toLowerCase() === 'true';
  // Fallback if the judge did not return clean JSON.
  return /\baccept(ed)?\b/i.test(text) && !/\breject|insufficient|incorrect|incomplete\b/i.test(text);
}

// Hardened judge parser: extracts a 1-based winner index + optional reason,
// tolerating malformed output (falls back to the first candidate).
function parseJudge(text: string, count: number): { index: number; reason: string | null } {
  const rm = text.match(/"reason"\s*:\s*"([^"]{0,300})"/i);
  const bm =
    text.match(/"best"\s*:\s*(\d+)/i) ?? text.match(/\banswer\s+(\d+)\b/i) ?? text.match(/\b(\d+)\b/);
  const idx = (bm ? parseInt(bm[1]!, 10) : 1) - 1;
  const index = Number.isFinite(idx) && idx >= 0 && idx < count ? idx : 0;
  return { index, reason: rm ? rm[1]! : null };
}

// Rejects if the promise doesn't settle within ms — a hung provider must not
// stall the whole workflow.
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// Fisher-Yates. Non-deterministic on purpose: randomizing the order candidates
// are shown to the judge is what defeats position bias.
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

async function callLeg(
  ctx: OrchestrationCtx,
  role: string,
  models: LegModel[],
  messages: ChatMessage[],
  taskClass: string,
  maxTokens: number,
  temperature?: number,
): Promise<LegOk | LegErr> {
  let lastErr = 'no candidate models';
  // Walk the ranked fallback chain: the router can surface a catalog model that
  // isn't actually callable (open-weights / not enabled on the key). Skip to the
  // next candidate instead of failing the whole workflow — the same resilience the
  // single-model path gets from its ranked candidate list.
  for (const model of models) {
    const adapter = getAdapter(model.providerSlug);
    if (!adapter) {
      lastErr = `no adapter for ${model.providerSlug}`;
      continue;
    }
    const keyInfo = await resolveProviderKey(ctx.orgId, model.providerSlug);
    if (!keyInfo.key) {
      lastErr = `no provider key for ${model.providerSlug}`;
      continue;
    }

    const body = {
      model: model.upstreamModel,
      messages,
      max_tokens: maxTokens,
      ...(temperature != null ? { temperature } : {}),
    } as ChatCompletionRequest;
    const started = Date.now();
    try {
      const { json, usage } = await withTimeout(
        adapter.chat(model.upstreamModel, body, keyInfo.key),
        LEG_TIMEOUT_MS,
        `${role} leg timed out after ${LEG_TIMEOUT_MS}ms`,
      );
      const latencyMs = Date.now() - started;
      // Suffixed request id keeps each leg idempotent + individually metered.
      const cost = await recordUsage({
        requestId: `${ctx.requestId}#${role}`,
        workspaceId: ctx.workspaceId,
        apiKeyId: ctx.apiKeyId,
        orgId: ctx.orgId,
        modelSlug: model.slug,
        providerSlug: model.providerSlug,
        taskClass,
        status: 'success',
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        cachedTokens: usage.cachedTokens,
        reasoningTokens: usage.reasoningTokens,
        promptPricePerM: String(model.promptPricePerM),
        completionPricePerM: String(model.completionPricePerM),
        latencyMs,
        byok: keyInfo.isByok,
        appName: ctx.appName,
      });
      return {
        content: extractContent(json),
        leg: {
          role,
          model: model.slug,
          provider: model.providerSlug,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          costUsd: cost,
          latencyMs,
          outcome: 'ok',
          ...(temperature != null ? { temperature } : {}),
        },
      };
    } catch (err) {
      lastErr = (err as Error).message;
      // try the next candidate in the chain
    }
  }
  return { error: lastErr };
}

function compose(
  pattern: OrchestrationPattern,
  content: string,
  chosenModel: string,
  legs: OrchestrationLeg[],
  taskClass: string,
): OrchestrationResult {
  const promptTokens = legs.reduce((a, l) => a + l.promptTokens, 0);
  const completionTokens = legs.reduce((a, l) => a + l.completionTokens, 0);
  return {
    pattern,
    content,
    chosenModel,
    legs,
    totalCostUsd: legs.reduce((a, l) => a + l.costUsd, 0),
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    taskClass,
  };
}

function emptyResult(pattern: OrchestrationPattern, taskClass: string): OrchestrationResult {
  return {
    pattern,
    content: '',
    chosenModel: '',
    legs: [],
    totalCostUsd: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    taskClass,
  };
}

// Builds a cheap "drafter" chain and a distinct stronger chain using the existing
// router at opposite cost tiers. Returning ranked chains (not single picks) lets
// each leg fall back when the top candidate isn't actually callable.
const LEG_FALLBACK_CAP = 4;
const BEST_OF_N = 3;
const LEG_TIMEOUT_MS = 45_000; // per-upstream-call ceiling
const WORKFLOW_MAX_COST_USD = 0.5; // safety ceiling: stop escalating past this

async function pickModels(
  ctx: OrchestrationCtx,
  messages: ChatMessage[],
): Promise<{ cheapChain: LegModel[]; strongChain: LegModel[]; taskClass: string }> {
  const [low, high] = await Promise.all([
    autoRoute({
      messages,
      costTier: 'low',
      maxTokens: ctx.maxTokens,
      guardrail: ctx.guardrail,
      allowedModels: ctx.allowedModels,
    }),
    autoRoute({
      messages,
      costTier: 'max',
      maxTokens: ctx.maxTokens,
      guardrail: ctx.guardrail,
      allowedModels: ctx.allowedModels,
    }),
  ]);
  const cheapChain = low.ranked.slice(0, LEG_FALLBACK_CAP);
  const cheapTop = cheapChain[0];
  // Strongest-first, excluding the cheap top pick so escalation is a real step up.
  const strongChain = high.ranked
    .filter((m) => !cheapTop || m.slug !== cheapTop.slug)
    .slice(0, LEG_FALLBACK_CAP);
  return { cheapChain, strongChain, taskClass: low.taskClass };
}

async function runCascade(
  ctx: OrchestrationCtx,
  messages: ChatMessage[],
  cheapChain: LegModel[],
  strongChain: LegModel[],
  taskClass: string,
): Promise<OrchestrationResult> {
  const legs: OrchestrationLeg[] = [];

  const draft = await callLeg(ctx, 'draft', cheapChain, messages, taskClass, ctx.maxTokens);
  if ('error' in draft) {
    // Couldn't draft on any cheap candidate — answer directly with a strong one.
    const fallbackChain = strongChain.length ? strongChain : cheapChain;
    const solo = await callLeg(ctx, 'final', fallbackChain, messages, taskClass, ctx.maxTokens);
    if ('error' in solo) return { ...emptyResult('cascade', taskClass), error: solo.error };
    return compose('cascade', solo.content, solo.leg.model, [solo.leg], taskClass);
  }
  legs.push(draft.leg);
  const draftModel = draft.leg.model;

  // Stronger candidates that differ from the model that actually drafted.
  const escalation = strongChain.filter((m) => m.slug !== draftModel);
  if (escalation.length === 0) {
    // Nothing stronger to escalate to — the draft is the answer.
    return compose('cascade', draft.content, draftModel, legs, taskClass);
  }

  const judgeMessages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a strict quality reviewer. Reply ONLY with JSON: {"accept": true|false, "reason": "..."}. Accept only if the candidate answer is correct, complete, and directly addresses the task.',
    },
    {
      role: 'user',
      content: `Task:\n${lastUserText(messages)}\n\nCandidate answer:\n${draft.content}\n\nReturn JSON only.`,
    },
  ];
  const gate = await callLeg(ctx, 'gate', cheapChain, judgeMessages, taskClass, 200);
  let accept = false;
  if (!('error' in gate)) {
    accept = parseAccept(gate.content);
    legs.push({ ...gate.leg, outcome: accept ? 'accepted' : 'rejected' });
  }
  if (accept) return compose('cascade', draft.content, draftModel, legs, taskClass);

  // Workflow cost ceiling: don't escalate to the expensive model past the cap.
  const spent = legs.reduce((a, l) => a + l.costUsd, 0);
  if (spent >= WORKFLOW_MAX_COST_USD) return compose('cascade', draft.content, draftModel, legs, taskClass);

  const finalLeg = await callLeg(ctx, 'final', escalation, messages, taskClass, ctx.maxTokens);
  if ('error' in finalLeg) return compose('cascade', draft.content, draftModel, legs, taskClass);
  legs.push(finalLeg.leg);
  return compose('cascade', finalLeg.content, finalLeg.leg.model, legs, taskClass);
}

async function runCritique(
  ctx: OrchestrationCtx,
  messages: ChatMessage[],
  drafterChain: LegModel[],
  criticChain: LegModel[],
  taskClass: string,
): Promise<OrchestrationResult> {
  const legs: OrchestrationLeg[] = [];

  const draft = await callLeg(ctx, 'draft', drafterChain, messages, taskClass, ctx.maxTokens);
  if ('error' in draft) return { ...emptyResult('critique', taskClass), error: draft.error };
  legs.push(draft.leg);
  const drafterModel = draft.leg.model;

  const critMessages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are an expert reviewer offering an independent perspective. Identify concrete errors, gaps, and improvements in the candidate answer. Be specific and concise. Do not rewrite the whole answer.',
    },
    {
      role: 'user',
      content: `Task:\n${lastUserText(messages)}\n\nCandidate answer:\n${draft.content}\n\nProvide your critique.`,
    },
  ];
  const criticFallback = criticChain.length ? criticChain : drafterChain;
  const crit = await callLeg(ctx, 'critic', criticFallback, critMessages, taskClass, 512);
  if ('error' in crit) return compose('critique', draft.content, drafterModel, legs, taskClass);
  legs.push(crit.leg);

  const reviseMessages: ChatMessage[] = [
    ...messages,
    { role: 'assistant', content: draft.content },
    {
      role: 'user',
      content: `A reviewer gave this critique:\n${crit.content}\n\nRevise your previous answer to address it. Return only the improved answer.`,
    },
  ];
  // Prefer the model that actually drafted, then the rest of the chain.
  const reviseChain = [
    ...drafterChain.filter((m) => m.slug === drafterModel),
    ...drafterChain.filter((m) => m.slug !== drafterModel),
  ];
  const revise = await callLeg(ctx, 'revise', reviseChain, reviseMessages, taskClass, ctx.maxTokens);
  if ('error' in revise) return compose('critique', draft.content, drafterModel, legs, taskClass);
  legs.push(revise.leg);
  return compose('critique', revise.content, revise.leg.model, legs, taskClass);
}

// best-of-N: run several cheap models on the SAME task in parallel, then a strong
// judge selects the winner — the closest text analog to HydraFusion's parallel
// branches + gating fusion. Branches run concurrently, so latency ~ the slowest
// branch rather than the sum.
async function runBestOfN(
  ctx: OrchestrationCtx,
  messages: ChatMessage[],
  cheapChain: LegModel[],
  strongChain: LegModel[],
  taskClass: string,
): Promise<OrchestrationResult> {
  const distinct = cheapChain;
  const branchCount = Math.min(BEST_OF_N, Math.max(distinct.length, 2));

  // Each branch prefers a distinct model (falling back through the chain) and
  // uses a different temperature so even a repeated model diverges.
  const branches = Array.from({ length: branchCount }, (_, i) => {
    const primary = distinct[i % distinct.length]!;
    const chain = [primary, ...distinct.filter((m) => m.slug !== primary.slug)];
    const temperature = Math.min(1, 0.2 + i * 0.35);
    return callLeg(ctx, `candidate_${i + 1}`, chain, messages, taskClass, ctx.maxTokens, temperature);
  });
  const settled = await Promise.all(branches);
  const candidates = settled.filter((r): r is LegOk => !('error' in r));

  const requestedN = branchCount;
  const completedN = candidates.length;
  const diversityMode: 'single-model' | 'multi-model' | 'n/a' =
    completedN === 0
      ? 'n/a'
      : new Set(candidates.map((c) => c.leg.model)).size > 1
        ? 'multi-model'
        : 'single-model';

  // Branch-failure policy: 0 done → error; exactly 1 → return it (no judge needed).
  if (completedN === 0) {
    const err = settled.find((r): r is LegErr => 'error' in r);
    return {
      ...emptyResult('bestofn', taskClass),
      error: err?.error ?? 'all candidates failed',
      requestedN,
      completedN,
      diversityMode,
    };
  }
  if (completedN === 1) {
    const only = candidates[0]!;
    return {
      ...compose(
        'bestofn',
        only.content,
        only.leg.model,
        [{ ...only.leg, outcome: 'selected', displayOrder: 1 }],
        taskClass,
      ),
      requestedN,
      completedN,
      diversityMode,
      judgeReason: null,
    };
  }

  // Anti position-bias: show candidates to the judge in RANDOM order, then map
  // the winning display slot back to the original candidate.
  const order = shuffle(candidates.map((_, i) => i)); // display slot -> original index
  const judgeMessages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a strict judge. Several candidate answers to the same task follow, in random order. Pick the single best one on correctness and completeness — not length or writing style. Reply ONLY with JSON: {"best": <1-based index>, "reason": "..."}.',
    },
    {
      role: 'user',
      content: `Task:\n${lastUserText(messages)}\n\n${order
        .map((origIdx, slot) => `Answer ${slot + 1}:\n${candidates[origIdx]!.content}`)
        .join('\n\n')}\n\nReturn JSON only.`,
    },
  ];
  const judge = await callLeg(ctx, 'judge', strongChain.length ? strongChain : cheapChain, judgeMessages, taskClass, 220);

  let winnerOrig = order[0]!; // default: whatever was shown first
  let judgeReason: string | null = null;
  let judgeLeg: OrchestrationLeg | null = null;
  if (!('error' in judge)) {
    const parsed = parseJudge(judge.content, order.length);
    winnerOrig = order[parsed.index]!;
    judgeReason = parsed.reason;
    judgeLeg = { ...judge.leg, outcome: `picked slot #${parsed.index + 1}` };
  }

  const slotOf = new Map<number, number>();
  order.forEach((origIdx, slot) => slotOf.set(origIdx, slot + 1));
  const legs: OrchestrationLeg[] = candidates.map((c, i) => ({
    ...c.leg,
    outcome: i === winnerOrig ? 'selected' : 'candidate',
    displayOrder: slotOf.get(i),
  }));
  if (judgeLeg) legs.push(judgeLeg);

  const winner = candidates[winnerOrig]!;
  return {
    ...compose('bestofn', winner.content, winner.leg.model, legs, taskClass),
    requestedN,
    completedN,
    diversityMode,
    judgeReason,
  };
}

export async function runOrchestration(opts: {
  pattern: OrchestrationPattern;
  messages: ChatMessage[];
  ctx: OrchestrationCtx;
}): Promise<OrchestrationResult> {
  const { cheapChain, strongChain, taskClass } = await pickModels(opts.ctx, opts.messages);
  if (cheapChain.length === 0) {
    return { ...emptyResult(opts.pattern, taskClass), error: 'No runnable model available for orchestration.' };
  }
  if (opts.pattern === 'critique')
    return runCritique(opts.ctx, opts.messages, cheapChain, strongChain, taskClass);
  if (opts.pattern === 'bestofn')
    return runBestOfN(opts.ctx, opts.messages, cheapChain, strongChain, taskClass);
  return runCascade(opts.ctx, opts.messages, cheapChain, strongChain, taskClass);
}
