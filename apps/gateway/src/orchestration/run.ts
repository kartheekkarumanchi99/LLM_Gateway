import { recordUsage } from '../billing/record';
import { resolveProviderKey } from '../providers/keys';
import { getAdapter } from '../providers/registry';
import type { ChatCompletionRequest, ChatMessage } from '../providers/types';
import { classifyTask } from '../routing/classify';
import { autoRoute } from '../routing/auto';
import type { CostTier, RankedCandidate } from '../routing/types';
import { recordDag, seedFor, type CapturedNode } from '../replay/capture';
import type { GuardrailPolicies } from '@llmgw/db';

// HydraFusion-style compound workflows on top of the single-model router.
// - cascade: a cheap model drafts, a quality gate accepts or escalates to a stronger model.
// - critique: a model drafts, an independent critic reviews, the drafter revises once.
// Every leg is metered individually ("complete accounting").

export type OrchestrationPattern = 'cascade' | 'critique' | 'bestofn' | 'decompose';

export interface OrchestrationCtx {
  orgId: string;
  workspaceId: string;
  apiKeyId: string;
  requestId: string;
  traceId?: string | null;
  appName: string | null;
  guardrail: GuardrailPolicies | null;
  allowedModels: string[];
  maxTokens: number;
  keyedProviders?: Set<string>;
  // State-replay DAG collector: callLeg pushes a captured node per executed leg.
  capture?: CapturedNode[];
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
  note?: string; // human label (e.g. subtask title / plan summary) for decompose legs
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

    const seed = seedFor(ctx.requestId, role);
    const body = {
      model: model.upstreamModel,
      messages,
      max_tokens: maxTokens,
      seed,
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
        traceId: ctx.traceId ?? ctx.requestId,
      });
      const content = extractContent(json);
      if (ctx.capture) {
        const choice0 = (json.choices as Array<{ message?: { tool_calls?: unknown } }> | undefined)?.[0];
        ctx.capture.push({
          nodeKey: role,
          parentKey: null,
          seq: 0,
          role,
          model: model.slug,
          provider: model.providerSlug,
          messages,
          params: { temperature: temperature ?? null, topP: null, maxTokens, seed },
          output: content,
          toolCalls: choice0?.message?.tool_calls ?? null,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          costUsd: cost,
          latencyMs,
          outcome: 'ok',
        });
      }
      return {
        content,
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
      keyedProviders: ctx.keyedProviders,
    }),
    autoRoute({
      messages,
      costTier: 'max',
      maxTokens: ctx.maxTokens,
      guardrail: ctx.guardrail,
      allowedModels: ctx.allowedModels,
      keyedProviders: ctx.keyedProviders,
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

// ---- Task decomposition ----------------------------------------------------
// A planner splits the task -> specialist models solve subtasks (each routed at a
// complexity-based cost tier, in dependency waves that run in parallel) -> a strong
// composer merges the results. Every leg is metered individually, and the pattern
// degrades to a single strong answer when no plan can be formed or every subtask
// fails, so it never does worse than the single-model path.
const MAX_SUBTASKS = 6; // cap planner output -> bounds cost + latency
const MAX_DEP_LEVELS = 3; // cap dependency depth so waves stay shallow
const SUBTASK_MAX_TOKENS = 1024; // keep subtasks concise
const DEP_CONTEXT_CHARS = 1500; // truncate injected dependency output

const PLANNER_SYSTEM =
  'You are a planning module. Break the user\'s task into 2-6 independent, concretely-scoped subtasks that can be solved separately and then merged. Prefer FEWER subtasks for simple tasks. Give each subtask a complexity of "low", "medium", or "high" reflecting how much reasoning it needs (low = lookup/formatting, high = deep reasoning or coding). Use "depends_on" ONLY when a subtask genuinely needs an earlier subtask\'s output (reference earlier ids). Reply with ONLY JSON, no prose: {"subtasks":[{"id":1,"title":"short label","prompt":"a self-contained instruction","complexity":"low|medium|high","depends_on":[]}],"compose":"how to merge the results"}.';

const SUBTASK_SYSTEM =
  'You are solving ONE focused subtask that is part of a larger task. Answer only this subtask, precisely and concisely. Do not restate the overall task or add meta commentary.';

const COMPOSER_SYSTEM =
  'You are the composer. Merge the subtask results into one coherent, complete answer to the original task. Resolve overlaps and contradictions, keep it well-structured, and do not mention the decomposition, the subtasks, or this process.';

type Complexity = 'low' | 'medium' | 'high';

interface PlanSubtask {
  id: number;
  title: string;
  prompt: string;
  complexity: Complexity;
  dependsOn: number[];
}

function tierForComplexity(c: Complexity): CostTier {
  return c; // 'low' | 'medium' | 'high' are all valid cost tiers
}

// Hardened plan parser: pulls the JSON object out of the planner reply and
// normalizes it. depends_on may only reference EARLIER ids, which guarantees a
// DAG (no cycles / forward refs). Returns null when there aren't >=2 usable subtasks.
function parsePlan(text: string, cap: number): { subtasks: PlanSubtask[]; compose: string | null } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const raw = (obj as { subtasks?: unknown })?.subtasks;
  if (!Array.isArray(raw)) return null;
  const seen = new Set<number>();
  const subtasks: PlanSubtask[] = [];
  for (const item of raw) {
    if (subtasks.length >= cap) break;
    const r = (item ?? {}) as Record<string, unknown>;
    const id = Number(r.id);
    if (!Number.isInteger(id) || seen.has(id)) continue;
    const rawTitle = typeof r.title === 'string' ? r.title.trim() : '';
    const title = (rawTitle || `Subtask ${id}`).slice(0, 80);
    const rawPrompt = typeof r.prompt === 'string' ? r.prompt.trim() : '';
    const prompt = rawPrompt || title;
    const cLower = typeof r.complexity === 'string' ? r.complexity.toLowerCase() : '';
    const complexity: Complexity = cLower === 'low' || cLower === 'high' ? cLower : 'medium';
    const dependsOn = Array.isArray(r.depends_on)
      ? (r.depends_on as unknown[]).map(Number).filter((d) => Number.isInteger(d) && seen.has(d))
      : [];
    seen.add(id);
    subtasks.push({ id, title, prompt, complexity, dependsOn });
  }
  if (subtasks.length < 2) return null;
  const composeRaw = (obj as { compose?: unknown })?.compose;
  const compose = typeof composeRaw === 'string' && composeRaw.trim() ? composeRaw.trim() : null;
  return { subtasks, compose };
}

// Group subtasks into dependency waves (level 0 = no deps). Because deps only point
// at earlier ids, a single forward pass computes stable levels.
function planWaves(subtasks: PlanSubtask[]): PlanSubtask[][] {
  const levelOf = new Map<number, number>();
  for (const s of subtasks) {
    const lvl =
      s.dependsOn.length === 0
        ? 0
        : Math.min(MAX_DEP_LEVELS, 1 + Math.max(...s.dependsOn.map((d) => levelOf.get(d) ?? 0)));
    levelOf.set(s.id, lvl);
  }
  const waves: PlanSubtask[][] = [];
  for (const s of subtasks) {
    const lvl = levelOf.get(s.id) ?? 0;
    (waves[lvl] ??= []).push(s);
  }
  return waves.filter((w) => w && w.length > 0);
}

async function runDecompose(
  ctx: OrchestrationCtx,
  messages: ChatMessage[],
  cheapChain: LegModel[],
  strongChain: LegModel[],
  taskClass: string,
): Promise<OrchestrationResult> {
  const legs: OrchestrationLeg[] = [];
  const strongOrCheap = strongChain.length ? strongChain : cheapChain;

  // Route each leg at a target cost tier, classifying on that leg's own content so a
  // coding subtask reaches a coding-capable model. Memoized by (tier, class) to avoid
  // duplicate catalog/signal reads across same-kind subtasks.
  const routeCache = new Map<string, LegModel[]>();
  async function routeAtTier(msgs: ChatMessage[], tier: CostTier): Promise<LegModel[]> {
    const key = `${tier}:${classifyTask(msgs)}`;
    const cached = routeCache.get(key);
    if (cached) return cached;
    const r = await autoRoute({
      messages: msgs,
      costTier: tier,
      maxTokens: ctx.maxTokens,
      guardrail: ctx.guardrail,
      allowedModels: ctx.allowedModels,
      keyedProviders: ctx.keyedProviders,
    });
    const chain = r.ranked.slice(0, LEG_FALLBACK_CAP);
    routeCache.set(key, chain);
    return chain;
  }

  const soloFallback = async (note: string): Promise<OrchestrationResult> => {
    const solo = await callLeg(ctx, 'final', strongOrCheap, messages, taskClass, ctx.maxTokens);
    if ('error' in solo) {
      return { ...compose('decompose', '', '', legs, taskClass), error: solo.error };
    }
    legs.push({ ...solo.leg, note });
    return { ...compose('decompose', solo.content, solo.leg.model, legs, taskClass), completedN: 0 };
  };

  // 1) Plan — a medium-tier model splits the task.
  const planChain = await routeAtTier(messages, 'medium');
  const planMessages: ChatMessage[] = [
    { role: 'system', content: PLANNER_SYSTEM },
    { role: 'user', content: `Task:\n${lastUserText(messages)}\n\nReturn the plan as JSON only.` },
  ];
  const planLeg = await callLeg(ctx, 'plan', planChain.length ? planChain : strongOrCheap, planMessages, taskClass, 700);
  const plan = 'error' in planLeg ? null : parsePlan(planLeg.content, MAX_SUBTASKS);
  if (!('error' in planLeg)) {
    legs.push({
      ...planLeg.leg,
      outcome: plan ? `${plan.subtasks.length} subtasks` : 'plan-unusable',
      note: plan ? plan.subtasks.map((s) => s.title).join(' \u2022 ').slice(0, 140) : undefined,
    });
  }
  // Fallback: no usable plan -> a single strong answer.
  if (!plan) return soloFallback('no plan \u2014 direct answer');

  // 2) Subtasks — run each dependency wave in parallel; a specialist model per subtask.
  const outputs = new Map<number, { title: string; content: string }>();
  const subtaskMax = Math.min(ctx.maxTokens, SUBTASK_MAX_TOKENS);
  for (const wave of planWaves(plan.subtasks)) {
    if (legs.reduce((a, l) => a + l.costUsd, 0) >= WORKFLOW_MAX_COST_USD) break; // budget guard
    const settled = await Promise.all(
      wave.map(async (s) => {
        const depCtx = s.dependsOn
          .map((d) => outputs.get(d))
          .filter((o): o is { title: string; content: string } => !!o)
          .map((o) => `### ${o.title}\n${o.content.slice(0, DEP_CONTEXT_CHARS)}`)
          .join('\n\n');
        const subMessages: ChatMessage[] = [
          { role: 'system', content: SUBTASK_SYSTEM },
          { role: 'user', content: depCtx ? `${s.prompt}\n\nContext from earlier steps:\n${depCtx}` : s.prompt },
        ];
        const chain = await routeAtTier(subMessages, tierForComplexity(s.complexity));
        const leg = await callLeg(ctx, `subtask_${s.id}`, chain.length ? chain : cheapChain, subMessages, taskClass, subtaskMax);
        return { s, leg };
      }),
    );
    for (const { s, leg } of settled) {
      if ('error' in leg) {
        legs.push({
          role: `subtask_${s.id}`,
          model: '',
          provider: '',
          promptTokens: 0,
          completionTokens: 0,
          costUsd: 0,
          latencyMs: 0,
          outcome: 'failed',
          note: s.title,
        });
        continue;
      }
      outputs.set(s.id, { title: s.title, content: leg.content });
      legs.push({ ...leg.leg, note: s.title });
    }
  }

  const completed = [...outputs.values()];
  const distinctModels = new Set(
    legs.filter((l) => l.role.startsWith('subtask_') && l.model).map((l) => l.model),
  );
  const diversityMode: 'single-model' | 'multi-model' | 'n/a' =
    distinctModels.size > 1 ? 'multi-model' : distinctModels.size === 1 ? 'single-model' : 'n/a';

  // Fallback: every subtask failed -> single strong answer.
  if (completed.length === 0) {
    return { ...(await soloFallback('subtasks failed \u2014 direct answer')), requestedN: plan.subtasks.length, diversityMode };
  }

  // 3) Compose — a strong model merges the subtask results.
  const resultsBlock = completed.map((o) => `### ${o.title}\n${o.content}`).join('\n\n');
  const composeMessages: ChatMessage[] = [
    { role: 'system', content: COMPOSER_SYSTEM },
    {
      role: 'user',
      content:
        `Original task:\n${lastUserText(messages)}\n\nCompleted subtask results:\n${resultsBlock}` +
        (plan.compose ? `\n\nComposition guidance:\n${plan.compose}` : '') +
        `\n\nWrite the final answer.`,
    },
  ];
  const compLeg = await callLeg(ctx, 'compose', strongOrCheap, composeMessages, taskClass, ctx.maxTokens);
  let content: string;
  let chosenModel: string;
  if ('error' in compLeg) {
    // Composer failed — return a deterministic merge so the user still gets content.
    content = completed.map((o) => `## ${o.title}\n${o.content}`).join('\n\n');
    chosenModel = legs.find((l) => l.role.startsWith('subtask_') && l.model)?.model ?? '';
  } else {
    legs.push({ ...compLeg.leg, outcome: 'composed' });
    content = compLeg.content;
    chosenModel = compLeg.leg.model;
  }

  return {
    ...compose('decompose', content, chosenModel, legs, taskClass),
    requestedN: plan.subtasks.length,
    completedN: completed.length,
    diversityMode,
    judgeReason: plan.compose ?? null,
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
  // Collect the execution DAG for deterministic state replay.
  opts.ctx.capture = [];
  let result: OrchestrationResult;
  if (opts.pattern === 'critique')
    result = await runCritique(opts.ctx, opts.messages, cheapChain, strongChain, taskClass);
  else if (opts.pattern === 'bestofn')
    result = await runBestOfN(opts.ctx, opts.messages, cheapChain, strongChain, taskClass);
  else if (opts.pattern === 'decompose')
    result = await runDecompose(opts.ctx, opts.messages, cheapChain, strongChain, taskClass);
  else result = await runCascade(opts.ctx, opts.messages, cheapChain, strongChain, taskClass);

  if (opts.ctx.capture.length > 0 && result.content) {
    void recordDag({
      requestId: opts.ctx.requestId,
      traceId: opts.ctx.traceId ?? opts.ctx.requestId,
      orgId: opts.ctx.orgId,
      workspaceId: opts.ctx.workspaceId,
      pattern: opts.pattern,
      rootMessages: opts.messages,
      finalOutput: result.content,
      nodes: opts.ctx.capture,
    });
  }
  return result;
}
