import {
  MAX_EXAMPLES,
  MAX_VARIANTS,
  type OptimizationExample,
  type OptimizationSummary,
  type OptimizationWeights,
} from '@llmgw/db';
import { recordUsage } from '../billing/record';
import { resolveProviderKey } from '../providers/keys';
import { getAdapter } from '../providers/registry';
import type { ChatCompletionRequest, ChatMessage } from '../providers/types';
import { autoRoute } from '../routing/auto';
import { resolveModel, type ResolvedModel } from '../routing/resolve';

// ---------------------------------------------------------------------------
// Prompt Optimization Engine (APE-style, automatic prompt engineering).
//
// Given a baseline system prompt and a handful of sample inputs, the engine:
//   1. asks a capable "proposer" model to draft N distinct improved prompts,
//   2. runs every candidate prompt (baseline + variants) x candidate model
//      against every example,
//   3. has an LLM judge score each candidate's outputs for quality (0-100),
//   4. blends quality + measured cost + measured latency into a composite score,
//   5. picks the winner and reports quality / cost / latency deltas vs baseline.
//
// Every upstream call is metered through recordUsage with traceId === runId, so
// an optimization run also shows up as a single trace in the Agent Time Machine.
// ---------------------------------------------------------------------------

export interface OptimizeInput {
  orgId: string;
  workspaceId: string;
  apiKeyId: string;
  runId: string;
  taskClass: string;
  baselinePrompt: string;
  examples: OptimizationExample[];
  models: string[];
  variants: number;
  judgeModel: string | null;
  weights: OptimizationWeights;
  maxTokens: number;
}

export interface CandidateSampleIO {
  input: string;
  output: string;
}

export interface CandidateResult {
  label: string;
  prompt: string;
  modelSlug: string;
  isBaseline: boolean;
  isWinner: boolean;
  qualityScore: number; // 0..100
  avgCostUsd: number;
  avgLatencyMs: number;
  compositeScore: number; // 0..100
  sampleCount: number;
  notes: string | null;
  samples: CandidateSampleIO[];
}

export interface OptimizeResult {
  candidates: CandidateResult[];
  winnerIndex: number;
  summary: OptimizationSummary;
  proposerModel: string | null;
  judgeModel: string | null;
  totalCostUsd: number;
  warnings: string[];
}

const PROPOSER_TIMEOUT_MS = 30_000;
const EVAL_TIMEOUT_MS = 45_000;
const JUDGE_TIMEOUT_MS = 30_000;
const EVAL_CONCURRENCY = 6;
const MAX_CANDIDATE_MODELS = 3;
const AUTO_CHAIN_DEPTH = 4; // auto path walks up to N ranked models until one is callable
const MAX_EVAL_EXAMPLES = 6; // cap examples actually run to bound cost/time

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

function extractContent(json: Record<string, unknown>): string {
  const choices = json.choices as Array<{ message?: { content?: unknown } }> | undefined;
  const c = choices?.[0]?.message?.content;
  return typeof c === 'string' ? c : '';
}

// Bounded parallel map: keeps at most `limit` promises in flight.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]!, i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

interface CallOutcome {
  content: string;
  costUsd: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
  servedSlug?: string;
  servedProvider?: string;
}

// One metered completion that walks a ranked fallback chain: the router can surface a
// catalog model that isn't actually callable on the key (open-weights / no access), so
// we skip to the next candidate instead of failing — the same resilience the single-model
// chat path gets from its ranked candidate list. Only a success is metered (one row).
async function callChain(
  input: OptimizeInput,
  role: string,
  chain: ResolvedModel[],
  messages: ChatMessage[],
  maxTokens: number,
  timeoutMs: number,
): Promise<CallOutcome> {
  let lastErr = 'no candidate models';
  for (const model of chain) {
    const adapter = getAdapter(model.providerSlug);
    if (!adapter) {
      lastErr = `no adapter for ${model.providerSlug}`;
      continue;
    }
    const keyInfo = await resolveProviderKey(input.orgId, model.providerSlug);
    if (!keyInfo.key) {
      lastErr = `no provider key for ${model.providerSlug}`;
      continue;
    }
    const body: ChatCompletionRequest = { model: model.upstreamModel, messages, max_tokens: maxTokens };
    const started = Date.now();
    try {
      const { json, usage } = await withTimeout(
        adapter.chat(model.upstreamModel, body, keyInfo.key),
        timeoutMs,
        `${role} call timed out after ${timeoutMs}ms`,
      );
      const latencyMs = Date.now() - started;
      const cost = await recordUsage({
        requestId: `${input.runId}#${role}`,
        workspaceId: input.workspaceId,
        apiKeyId: input.apiKeyId,
        orgId: input.orgId,
        modelSlug: model.slug,
        providerSlug: model.providerSlug,
        taskClass: input.taskClass,
        status: 'success',
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        cachedTokens: usage.cachedTokens,
        reasoningTokens: usage.reasoningTokens,
        promptPricePerM: model.promptPricePerM,
        completionPricePerM: model.completionPricePerM,
        latencyMs,
        byok: keyInfo.isByok,
        traceId: input.runId,
        appName: 'optimizer',
      });
      return {
        content: extractContent(json),
        costUsd: cost,
        latencyMs,
        ok: true,
        servedSlug: model.slug,
        servedProvider: model.providerSlug,
      };
    } catch (err) {
      lastErr = (err as Error).message;
      // try the next candidate in the chain
    }
  }
  return { content: '', costUsd: 0, latencyMs: 0, ok: false, error: lastErr };
}

function toResolved(c: {
  slug: string;
  providerSlug: string;
  upstreamModel: string;
  promptPricePerM: number | string;
  completionPricePerM: number | string;
}): ResolvedModel {
  return {
    slug: c.slug,
    providerSlug: c.providerSlug,
    upstreamModel: c.upstreamModel,
    promptPricePerM: String(c.promptPricePerM),
    completionPricePerM: String(c.completionPricePerM),
  };
}

// Explicit candidate models the caller asked for (each is its own single-model chain).
async function resolveExplicitModels(input: OptimizeInput): Promise<ResolvedModel[]> {
  const out: ResolvedModel[] = [];
  for (const slug of input.models.slice(0, MAX_CANDIDATE_MODELS)) {
    const m = await resolveModel(slug);
    if (m && getAdapter(m.providerSlug)) out.push(m);
  }
  return out;
}

// Auto path: a ranked fallback chain of the cheapest runnable models for the task, so a
// dead top candidate (e.g. an un-served open-weights model) falls through to a live one.
async function resolveAutoChain(input: OptimizeInput): Promise<ResolvedModel[]> {
  const probe: ChatMessage[] = [
    { role: 'system', content: input.baselinePrompt || 'You are a helpful assistant.' },
    { role: 'user', content: input.examples[0]?.input ?? 'Hello' },
  ];
  const routed = await autoRoute({
    messages: probe,
    costTier: 'low',
    maxTokens: input.maxTokens,
    guardrail: null,
    allowedModels: [],
  });
  return routed.ranked.slice(0, AUTO_CHAIN_DEPTH).map(toResolved);
}

// Ask the proposer to draft N distinct improved prompts. Robust to non-JSON output.
async function proposeVariants(
  input: OptimizeInput,
  proposer: ResolvedModel[],
  n: number,
): Promise<{ prompts: string[]; error: string | null }> {
  if (n <= 0) return { prompts: [], error: null };
  const sampleInputs = input.examples
    .slice(0, 4)
    .map((e, i) => `${i + 1}. ${e.input.slice(0, 400)}`)
    .join('\n');
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are an expert prompt engineer. You improve system prompts so an LLM performs a task more accurately and reliably. ' +
        'You add clarity, explicit output-format constraints, edge-case handling, and concise guidance. ' +
        'Return ONLY a JSON array of strings (no prose, no markdown), each a complete self-contained system prompt.',
    },
    {
      role: 'user',
      content:
        `Task type: ${input.taskClass}\n\n` +
        `Baseline system prompt:\n"""\n${input.baselinePrompt || '(none provided)'}\n"""\n\n` +
        (sampleInputs ? `Representative user inputs:\n${sampleInputs}\n\n` : '') +
        `Produce exactly ${n} distinct improved system-prompt variants as a JSON array of ${n} strings.`,
    },
  ];
  const res = await callChain(input, 'propose', proposer, messages, Math.max(input.maxTokens, 700), PROPOSER_TIMEOUT_MS);
  if (!res.ok) return { prompts: [], error: res.error ?? 'proposer call failed' };
  return { prompts: parsePromptArray(res.content, n), error: null };
}

function parsePromptArray(text: string, n: number): string[] {
  // Prefer a clean JSON array; fall back to the first bracketed block.
  const tryParse = (s: string): string[] | null => {
    try {
      const v = JSON.parse(s);
      if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    } catch {
      /* ignore */
    }
    return null;
  };
  let arr = tryParse(text.trim());
  if (!arr) {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start >= 0 && end > start) arr = tryParse(text.slice(start, end + 1));
  }
  if (!arr || arr.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of arr) {
    const t = p.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t.slice(0, 4000));
    }
    if (out.length >= n) break;
  }
  return out;
}

// LLM judge: score a candidate's outputs 0-100 for how well they satisfy the task.
async function judgeQuality(
  input: OptimizeInput,
  judge: ResolvedModel[],
  roleSuffix: string,
  examples: OptimizationExample[],
  outputs: string[],
): Promise<{ score: number; reason: string | null; error: string | null }> {
  const cases = examples
    .map((ex, i) => {
      const parts = [`CASE ${i + 1}`, `Input: ${ex.input.slice(0, 600)}`, `Output: ${(outputs[i] ?? '').slice(0, 900)}`];
      if (ex.reference) parts.push(`Reference answer: ${ex.reference.slice(0, 600)}`);
      return parts.join('\n');
    })
    .join('\n\n');
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a strict, fair evaluator. Judge how well the assistant OUTPUTS satisfy the task across all cases: ' +
        'correctness, completeness, format adherence, and (when a reference is given) agreement with it. ' +
        'Return ONLY JSON: {"score": <integer 0-100>, "reason": "<one short sentence>"}.',
    },
    { role: 'user', content: `Task type: ${input.taskClass}\n\n${cases}\n\nScore the overall output quality 0-100.` },
  ];
  const res = await callChain(input, `judge${roleSuffix}`, judge, messages, 200, JUDGE_TIMEOUT_MS);
  if (!res.ok) return { score: 0, reason: 'judge unavailable', error: res.error ?? 'judge call failed' };
  const sm = res.content.match(/"score"\s*:\s*(\d+(?:\.\d+)?)/i) ?? res.content.match(/\b(\d{1,3})\b/);
  const raw = sm ? parseFloat(sm[1]!) : 0;
  const score = Math.max(0, Math.min(100, raw));
  const rm = res.content.match(/"reason"\s*:\s*"([^"]{0,300})"/i);
  return { score, reason: rm ? rm[1]! : null, error: null };
}

interface WorkingCandidate {
  label: string;
  prompt: string;
  modelSlug: string;
  isBaseline: boolean;
  samples: CandidateSampleIO[];
  quality: number;
  qualityReason: string | null;
  avgCostUsd: number;
  avgLatencyMs: number;
  sampleCount: number;
  composite: number;
}

export async function runOptimization(input: OptimizeInput): Promise<OptimizeResult> {
  const variants = Math.max(0, Math.min(MAX_VARIANTS, Math.floor(input.variants)));
  const examples = input.examples.slice(0, MAX_EXAMPLES);
  const evalExamples = examples.slice(0, MAX_EVAL_EXAMPLES);
  if (evalExamples.length === 0) throw new Error('At least one example input is required.');

  // Candidate model chains. Explicit slugs each become a single-model chain (so those
  // exact models are compared); the auto path is one ranked fallback chain (so a dead
  // top pick falls through to a live model).
  const explicit = await resolveExplicitModels(input);
  const autoChain = explicit.length > 0 ? [] : await resolveAutoChain(input);
  const modelChains: { headSlug: string; chain: ResolvedModel[] }[] =
    explicit.length > 0
      ? explicit.map((m) => ({ headSlug: m.slug, chain: [m] }))
      : [{ headSlug: autoChain[0]?.slug ?? '', chain: autoChain }];
  if (modelChains.every((c) => c.chain.length === 0))
    throw new Error('No runnable model found. Add a provider key (BYOK) or specify a model you have access to.');

  // Proposer + judge chain: an explicit judge model, else the strongest explicit model,
  // else the auto fallback chain (a cheap-but-live model is a fine default judge).
  const judgeExplicit = input.judgeModel ? await resolveModel(input.judgeModel) : null;
  const judgeChain: ResolvedModel[] = judgeExplicit
    ? [judgeExplicit]
    : explicit.length > 0
      ? [explicit[explicit.length - 1]!]
      : autoChain;

  const variantPrompts = await proposeVariants(input, judgeChain, variants);
  const warnings: string[] = [];
  if (variantPrompts.error) warnings.push(`Proposer: ${variantPrompts.error}`);

  // Build the candidate grid: {baseline + variants} x candidate model chains.
  const prompts: { label: string; prompt: string; isBaseline: boolean }[] = [
    { label: 'Baseline', prompt: input.baselinePrompt, isBaseline: true },
    ...variantPrompts.prompts.map((p, i) => ({ label: `Variant ${i + 1}`, prompt: p, isBaseline: false })),
  ];
  const grid: { label: string; prompt: string; isBaseline: boolean; chain: ResolvedModel[]; headSlug: string }[] = [];
  for (const p of prompts) {
    for (const mc of modelChains) {
      const label = modelChains.length > 1 ? `${p.label} · ${mc.headSlug}` : p.label;
      grid.push({ label, prompt: p.prompt, isBaseline: p.isBaseline, chain: mc.chain, headSlug: mc.headSlug });
    }
  }

  // Evaluate every (candidate, example) pair with bounded concurrency.
  const tasks = grid.flatMap((g, ci) => evalExamples.map((ex, ei) => ({ ci, ei, g, ex })));
  const runs = await mapLimit(tasks, EVAL_CONCURRENCY, async (t) => {
    const messages: ChatMessage[] = [
      ...(t.g.prompt.trim() ? [{ role: 'system', content: t.g.prompt } as ChatMessage] : []),
      { role: 'user', content: t.ex.input },
    ];
    const out = await callChain(input, `c${t.ci}e${t.ei}`, t.g.chain, messages, input.maxTokens, EVAL_TIMEOUT_MS);
    return { ci: t.ci, ei: t.ei, out };
  });
  const firstEvalError = runs.find((r) => !r.out.ok)?.out.error;
  if (firstEvalError) warnings.push(`Evaluation: ${firstEvalError}`);

  // Aggregate per candidate.
  const working: WorkingCandidate[] = grid.map((g) => ({
    label: g.label,
    prompt: g.prompt,
    modelSlug: g.headSlug,
    isBaseline: g.isBaseline,
    samples: [],
    quality: 0,
    qualityReason: null,
    avgCostUsd: 0,
    avgLatencyMs: 0,
    sampleCount: 0,
    composite: 0,
  }));
  const costSum = new Array(grid.length).fill(0);
  const latSum = new Array(grid.length).fill(0);
  const okCount = new Array(grid.length).fill(0);
  const outputsByCandidate: string[][] = grid.map(() => new Array(evalExamples.length).fill(''));
  for (const r of runs) {
    outputsByCandidate[r.ci]![r.ei] = r.out.content;
    working[r.ci]!.samples.push({ input: evalExamples[r.ei]!.input, output: r.out.content });
    if (r.out.ok) {
      costSum[r.ci] += r.out.costUsd;
      latSum[r.ci] += r.out.latencyMs;
      okCount[r.ci] += 1;
      // Record the model that actually served (the chain may have fallen back).
      if (r.out.servedSlug) working[r.ci]!.modelSlug = r.out.servedSlug;
    }
  }
  for (let i = 0; i < grid.length; i++) {
    const n = Math.max(1, okCount[i]);
    working[i]!.avgCostUsd = costSum[i] / n;
    working[i]!.avgLatencyMs = Math.round(latSum[i] / n);
    working[i]!.sampleCount = okCount[i];
  }

  // Judge each candidate (bounded concurrency). Unique role id keeps each judge call
  // idempotently metered (no requestId collision).
  const judged = await mapLimit(working, 3, async (_w, i) => {
    const q = await judgeQuality(input, judgeChain, String(i), evalExamples, outputsByCandidate[i]!);
    return { i, q };
  });
  for (const j of judged) {
    working[j.i]!.quality = j.q.score;
    working[j.i]!.qualityReason = j.q.reason;
  }
  const firstJudgeError = judged.find((j) => j.q.error)?.q.error;
  if (firstJudgeError) warnings.push(`Judge: ${firstJudgeError}`);

  // Composite score: quality (higher better) + cost + latency (lower better),
  // each min-max normalized across candidates, then blended by weights.
  const costs = working.map((w) => w.avgCostUsd);
  const lats = working.map((w) => w.avgLatencyMs);
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const norm = (v: number, lo: number, hi: number): number => (hi > lo ? (v - lo) / (hi - lo) : 0);
  const w = input.weights;
  const wsum = Math.max(1e-9, w.quality + w.cost + w.latency);
  for (const c of working) {
    const qualityNorm = c.quality / 100;
    const costScore = 1 - norm(c.avgCostUsd, minCost, maxCost); // cheaper => higher
    const latScore = 1 - norm(c.avgLatencyMs, minLat, maxLat); // faster => higher
    c.composite = (100 * (w.quality * qualityNorm + w.cost * costScore + w.latency * latScore)) / wsum;
  }

  // Winner = highest composite; ties broken by quality then cost.
  let winnerIndex = 0;
  for (let i = 1; i < working.length; i++) {
    const a = working[i]!;
    const b = working[winnerIndex]!;
    if (
      a.composite > b.composite + 1e-9 ||
      (Math.abs(a.composite - b.composite) <= 1e-9 && a.quality > b.quality) ||
      (Math.abs(a.composite - b.composite) <= 1e-9 && a.quality === b.quality && a.avgCostUsd < b.avgCostUsd)
    ) {
      winnerIndex = i;
    }
  }

  const baselineIndex = working.findIndex((c) => c.isBaseline);
  const baseline = working[baselineIndex >= 0 ? baselineIndex : 0]!;
  const winner = working[winnerIndex]!;
  const pct = (a: number, b: number): number => (b > 0 ? ((a - b) / b) * 100 : 0);
  const summary: OptimizationSummary = {
    baselineScore: Number(baseline.composite.toFixed(2)),
    winnerScore: Number(winner.composite.toFixed(2)),
    qualityDelta: Number((winner.quality - baseline.quality).toFixed(2)),
    costDeltaPct: Number(pct(winner.avgCostUsd, baseline.avgCostUsd).toFixed(1)),
    latencyDeltaPct: Number(pct(winner.avgLatencyMs, baseline.avgLatencyMs).toFixed(1)),
    winnerModel: winner.modelSlug,
    winnerLabel: winner.label,
    improved: winnerIndex !== (baselineIndex >= 0 ? baselineIndex : 0) && winner.composite > baseline.composite + 1e-9,
  };

  const candidates: CandidateResult[] = working.map((c, i) => ({
    label: c.label,
    prompt: c.prompt,
    modelSlug: c.modelSlug,
    isBaseline: c.isBaseline,
    isWinner: i === winnerIndex,
    qualityScore: Number(c.quality.toFixed(2)),
    avgCostUsd: c.avgCostUsd,
    avgLatencyMs: c.avgLatencyMs,
    compositeScore: Number(c.composite.toFixed(2)),
    sampleCount: c.sampleCount,
    notes: c.qualityReason,
    samples: c.samples,
  }));

  const totalCostUsd = costSum.reduce((a: number, b: number) => a + b, 0);

  return {
    candidates,
    winnerIndex,
    summary,
    proposerModel: judgeChain[0]?.slug ?? null,
    judgeModel: judgeChain[0]?.slug ?? null,
    totalCostUsd,
    warnings,
  };
}
