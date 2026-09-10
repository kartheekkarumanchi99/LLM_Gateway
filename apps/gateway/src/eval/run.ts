import {
  MAX_EVAL_CASES,
  PASS_THRESHOLD,
  REGRESSION_QUALITY_DROP,
  type EvalSummary,
  type EvalVariantStats,
  type EvalVerdict,
} from '@llmgw/db';
import { recordUsage } from '../billing/record';
import { resolveProviderKey } from '../providers/keys';
import { getAdapter } from '../providers/registry';
import type { ChatCompletionRequest, ChatMessage } from '../providers/types';
import { autoRoute } from '../routing/auto';
import { resolveModel, type ResolvedModel } from '../routing/resolve';

// Prompt & Model CI: run an eval set against a candidate config and (optionally) a
// baseline, judge each output, and report quality/cost/latency deltas + a pass/fail
// verdict — GitHub-Actions-for-prompts. Reuses the same fallback-chain + LLM-judge
// approach as the optimizer; kept self-contained so the verified optimizer is untouched.

export interface EvalCaseInput {
  id: string;
  input: ChatMessage[];
  reference: string | null;
}

export interface EvalInput {
  orgId: string;
  workspaceId: string;
  apiKeyId: string;
  runId: string;
  taskClass: string;
  cases: EvalCaseInput[];
  candidateModel: string;
  candidatePrompt: string | null;
  baselineModel: string | null;
  baselinePrompt: string | null;
  judgeModel: string | null;
  maxTokens: number;
}

export interface EvalCaseResult {
  caseId: string;
  variant: 'candidate' | 'baseline';
  output: string;
  quality: number;
  costUsd: number;
  latencyMs: number;
  passed: boolean;
}

export interface EvalResult {
  summary: EvalSummary;
  caseResults: EvalCaseResult[];
  warnings: string[];
}

const EVAL_CONCURRENCY = 6;
const AUTO_CHAIN_DEPTH = 4;
const CALL_TIMEOUT_MS = 45_000;
const JUDGE_TIMEOUT_MS = 30_000;

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

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
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

interface CallOutcome {
  content: string;
  costUsd: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
}

async function callChain(
  input: EvalInput,
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
        `${role} timed out after ${timeoutMs}ms`,
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
        appName: 'eval-ci',
      });
      return { content: extractContent(json), costUsd: cost, latencyMs, ok: true };
    } catch (err) {
      lastErr = (err as Error).message;
    }
  }
  return { content: '', costUsd: 0, latencyMs: 0, ok: false, error: lastErr };
}

async function resolveChain(input: EvalInput, slug: string): Promise<ResolvedModel[]> {
  if (slug && slug !== 'auto') {
    const m = await resolveModel(slug);
    if (m && getAdapter(m.providerSlug)) return [m];
  }
  const probe: ChatMessage[] = [{ role: 'user', content: input.cases[0]?.input.at(-1)?.content ?? 'Hello' }];
  const routed = await autoRoute({
    messages: probe,
    costTier: 'low',
    maxTokens: input.maxTokens,
    guardrail: null,
    allowedModels: [],
  });
  return routed.ranked.slice(0, AUTO_CHAIN_DEPTH).map(toResolved);
}

// Override the system prompt when a prompt variant is under test; otherwise replay the
// captured messages verbatim (a pure model swap).
function buildMessages(caseInput: ChatMessage[], promptOverride: string | null): ChatMessage[] {
  if (!promptOverride) return caseInput;
  return [{ role: 'system', content: promptOverride }, ...caseInput.filter((m) => m.role !== 'system')];
}

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i]!.content;
    if (messages[i]!.role === 'user') return typeof c === 'string' ? c : JSON.stringify(c);
  }
  const c = messages[messages.length - 1]?.content;
  return typeof c === 'string' ? c : JSON.stringify(c ?? '');
}

async function judgeOne(
  input: EvalInput,
  judge: ResolvedModel[],
  role: string,
  caseInput: ChatMessage[],
  reference: string | null,
  output: string,
): Promise<{ score: number; error: string | null }> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a strict, fair evaluator. Score how well the assistant OUTPUT satisfies the request: ' +
        'correctness, completeness, format, and (if a reference is given) agreement with it. ' +
        'Return ONLY JSON: {"score": <integer 0-100>}.',
    },
    {
      role: 'user',
      content:
        `Task type: ${input.taskClass}\n\nRequest:\n${lastUserText(caseInput).slice(0, 900)}\n\n` +
        (reference ? `Reference answer:\n${reference.slice(0, 700)}\n\n` : '') +
        `Assistant output:\n${output.slice(0, 1200)}\n\nScore 0-100.`,
    },
  ];
  const res = await callChain(input, role, judge, messages, 60, JUDGE_TIMEOUT_MS);
  if (!res.ok) return { score: 0, error: res.error ?? 'judge failed' };
  const m = res.content.match(/"score"\s*:\s*(\d+(?:\.\d+)?)/i) ?? res.content.match(/\b(\d{1,3})\b/);
  const score = m ? Math.max(0, Math.min(100, parseFloat(m[1]!))) : 0;
  return { score, error: null };
}

function stats(results: EvalCaseResult[]): EvalVariantStats {
  const ok = results.filter((r) => r.output.length > 0 || r.quality > 0);
  const n = Math.max(1, ok.length);
  return {
    quality: results.reduce((a, r) => a + r.quality, 0) / Math.max(1, results.length),
    avgCostUsd: results.reduce((a, r) => a + r.costUsd, 0) / n,
    avgLatencyMs: Math.round(results.reduce((a, r) => a + r.latencyMs, 0) / n),
    passRate: results.length > 0 ? results.filter((r) => r.passed).length / results.length : 0,
    cases: results.length,
  };
}

export async function runEval(input: EvalInput): Promise<EvalResult> {
  const cases = input.cases.slice(0, MAX_EVAL_CASES);
  if (cases.length === 0) throw new Error('The eval set has no cases.');

  const warnings: string[] = [];
  const hasBaseline = Boolean(input.baselineModel || input.baselinePrompt);

  const candidateChain = await resolveChain(input, input.candidateModel);
  if (candidateChain.length === 0) throw new Error('No runnable candidate model. Add a provider key (BYOK).');
  const baselineChain = hasBaseline
    ? input.baselineModel
      ? await resolveChain(input, input.baselineModel)
      : candidateChain
    : [];
  const judgeChain = input.judgeModel ? await resolveChain(input, input.judgeModel) : candidateChain;

  interface Task {
    caseIdx: number;
    variant: 'candidate' | 'baseline';
    chain: ResolvedModel[];
    prompt: string | null;
  }
  const tasks: Task[] = [];
  cases.forEach((_c, i) => {
    tasks.push({ caseIdx: i, variant: 'candidate', chain: candidateChain, prompt: input.candidatePrompt });
    if (hasBaseline) tasks.push({ caseIdx: i, variant: 'baseline', chain: baselineChain, prompt: input.baselinePrompt });
  });

  const raw = await mapLimit(tasks, EVAL_CONCURRENCY, async (t, ti) => {
    const c = cases[t.caseIdx]!;
    const msgs = buildMessages(c.input, t.prompt);
    const out = await callChain(input, `${t.variant.slice(0, 4)}${ti}`, t.chain, msgs, input.maxTokens, CALL_TIMEOUT_MS);
    return { t, out };
  });
  const firstErr = raw.find((r) => !r.out.ok)?.out.error;
  if (firstErr) warnings.push(`Generation: ${firstErr}`);

  const judged = await mapLimit(raw, 4, async (r, ri) => {
    const c = cases[r.t.caseIdx]!;
    const j = await judgeOne(input, judgeChain, `judge${ri}`, c.input, c.reference, r.out.content);
    return { r, quality: j.score, judgeError: j.error };
  });
  const firstJudgeErr = judged.find((j) => j.judgeError)?.judgeError;
  if (firstJudgeErr) warnings.push(`Judge: ${firstJudgeErr}`);

  const caseResults: EvalCaseResult[] = judged.map((j) => ({
    caseId: cases[j.r.t.caseIdx]!.id,
    variant: j.r.t.variant,
    output: j.r.out.content,
    quality: Number(j.quality.toFixed(2)),
    costUsd: j.r.out.costUsd,
    latencyMs: j.r.out.latencyMs,
    passed: j.quality >= PASS_THRESHOLD,
  }));

  const candidateResults = caseResults.filter((r) => r.variant === 'candidate');
  const baselineResults = caseResults.filter((r) => r.variant === 'baseline');
  const candidate = stats(candidateResults);
  const baseline = hasBaseline ? stats(baselineResults) : null;

  const pct = (a: number, b: number): number => (b > 0 ? ((a - b) / b) * 100 : 0);
  let verdict: EvalVerdict = 'no-baseline';
  if (baseline) {
    const dq = candidate.quality - baseline.quality;
    verdict = dq > REGRESSION_QUALITY_DROP ? 'improved' : dq < -REGRESSION_QUALITY_DROP ? 'regressed' : 'neutral';
  }

  const summary: EvalSummary = {
    candidate,
    baseline,
    qualityDelta: baseline ? Number((candidate.quality - baseline.quality).toFixed(2)) : 0,
    costDeltaPct: baseline ? Number(pct(candidate.avgCostUsd, baseline.avgCostUsd).toFixed(1)) : 0,
    latencyDeltaPct: baseline ? Number(pct(candidate.avgLatencyMs, baseline.avgLatencyMs).toFixed(1)) : 0,
    casesPassed: candidateResults.filter((r) => r.passed).length,
    casesTotal: candidateResults.length,
    verdict,
  };

  return { summary, caseResults, warnings };
}
