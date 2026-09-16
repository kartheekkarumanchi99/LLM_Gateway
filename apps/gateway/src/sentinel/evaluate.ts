import { getDb, shadowEvals, type SentinelConfig } from '@llmgw/db';
import { recordUsage } from '../billing/record';
import { getKeyedProviders, resolveProviderKey } from '../providers/keys';
import { getAdapter } from '../providers/registry';
import type { ChatCompletionRequest, ChatMessage } from '../providers/types';
import { autoRoute } from '../routing/auto';
import { resolveModel, type ResolvedModel } from '../routing/resolve';

const CALL_TIMEOUT_MS = 45_000;
const JUDGE_TIMEOUT_MS = 30_000;

export interface ShadowSampleRow {
  id: string;
  workspaceId: string;
  orgId: string;
  taskClass: string;
  baselineModel: string;
  baselineProvider: string;
  messages: ChatMessage[];
  referenceOutput: string;
  referenceTokens: number;
  maxTokens: number;
}

export interface CandidateEvalResult {
  candidateModel: string;
  candidateProvider: string;
  taskClass: string;
  quality: number; // 0..100 vs reference
  lengthRatio: number; // candidate tokens / reference tokens
  candidateTokens: number;
  costUsd: number;
  latencyMs: number;
  status: 'ok' | 'error';
  error: string | null;
}

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

// Candidate set for a sample: always re-probe the baseline model (to catch its own drift)
// plus the top health-agnostic alternatives, up to fanout distinct models.
async function selectCandidates(sample: ShadowSampleRow, cfg: SentinelConfig): Promise<ResolvedModel[]> {
  const out: ResolvedModel[] = [];
  const seen = new Set<string>();
  const baseline = await resolveModel(sample.baselineModel);
  if (baseline && getAdapter(baseline.providerSlug)) {
    out.push(baseline);
    seen.add(baseline.slug);
  }
  const keyedProviders = await getKeyedProviders(sample.orgId);
  const routed = await autoRoute({
    messages: sample.messages,
    costTier: 'low',
    maxTokens: sample.maxTokens,
    guardrail: null,
    allowedModels: [],
    keyedProviders,
    ignoreHealth: true,
  });
  for (const r of routed.ranked) {
    if (out.length >= cfg.fanout) break;
    if (seen.has(r.slug) || !getAdapter(r.providerSlug)) continue;
    seen.add(r.slug);
    out.push(toResolved(r));
  }
  return out.slice(0, Math.max(1, cfg.fanout));
}

async function resolveJudgeChain(sample: ShadowSampleRow, cfg: SentinelConfig): Promise<ResolvedModel[]> {
  if (cfg.judgeModel) {
    const m = await resolveModel(cfg.judgeModel);
    if (m && getAdapter(m.providerSlug)) return [m];
  }
  const keyedProviders = await getKeyedProviders(sample.orgId);
  const routed = await autoRoute({
    messages: sample.messages,
    costTier: 'low',
    maxTokens: 64,
    guardrail: null,
    allowedModels: [],
    keyedProviders,
    ignoreHealth: true,
  });
  return routed.ranked.slice(0, 3).map(toResolved);
}

interface CallOutcome {
  content: string;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
}

async function callModel(
  sample: ShadowSampleRow,
  role: string,
  model: ResolvedModel,
  messages: ChatMessage[],
  maxTokens: number,
  timeoutMs: number,
): Promise<CallOutcome> {
  const adapter = getAdapter(model.providerSlug);
  if (!adapter) return { content: '', completionTokens: 0, costUsd: 0, latencyMs: 0, ok: false, error: 'no adapter' };
  const keyInfo = await resolveProviderKey(sample.orgId, model.providerSlug);
  if (!keyInfo.key)
    return { content: '', completionTokens: 0, costUsd: 0, latencyMs: 0, ok: false, error: 'no provider key' };
  const body: ChatCompletionRequest = { model: model.upstreamModel, messages, max_tokens: maxTokens };
  const started = Date.now();
  try {
    const { json, usage } = await withTimeout(
      adapter.chat(model.upstreamModel, body, keyInfo.key),
      timeoutMs,
      `${role} timed out`,
    );
    const latencyMs = Date.now() - started;
    // Shadow calls are real upstream spend — meter them honestly (idempotent per sample+role).
    const cost = await recordUsage({
      requestId: `shadow-${sample.id}#${role}`,
      workspaceId: sample.workspaceId,
      apiKeyId: null,
      orgId: sample.orgId,
      modelSlug: model.slug,
      providerSlug: model.providerSlug,
      taskClass: sample.taskClass,
      status: 'success',
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      promptPricePerM: model.promptPricePerM,
      completionPricePerM: model.completionPricePerM,
      latencyMs,
      byok: keyInfo.isByok,
      appName: 'sentinel-shadow',
    });
    return { content: extractContent(json), completionTokens: usage.completionTokens, costUsd: cost, latencyMs, ok: true };
  } catch (err) {
    return { content: '', completionTokens: 0, costUsd: 0, latencyMs: Date.now() - started, ok: false, error: (err as Error).message };
  }
}

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      const c = messages[i]!.content;
      return typeof c === 'string' ? c : JSON.stringify(c);
    }
  }
  return '';
}

// LLM judge: score how well a candidate output matches the served reference (0..100).
// Same rubric as the Evals engine so drift scores are comparable to CI eval scores.
async function judgeQuality(
  sample: ShadowSampleRow,
  judge: ResolvedModel[],
  candidateOutput: string,
): Promise<number> {
  if (!candidateOutput.trim()) return 0;
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a strict, fair evaluator. Score how well the CANDIDATE output satisfies the request and ' +
        'agrees with the REFERENCE answer that was actually served: correctness, completeness, and format. ' +
        'Return ONLY JSON: {"score": <integer 0-100>}.',
    },
    {
      role: 'user',
      content:
        `Task type: ${sample.taskClass}\n\nRequest:\n${lastUserText(sample.messages).slice(0, 900)}\n\n` +
        `Reference answer (served in production):\n${sample.referenceOutput.slice(0, 900)}\n\n` +
        `Candidate output:\n${candidateOutput.slice(0, 1200)}\n\nScore 0-100.`,
    },
  ];
  for (let i = 0; i < judge.length; i++) {
    const res = await callModel(sample, `judge-${i}`, judge[i]!, messages, 64, JUDGE_TIMEOUT_MS);
    if (res.ok) {
      const m = res.content.match(/"score"\s*:\s*(\d+(?:\.\d+)?)/i) ?? res.content.match(/\b(\d{1,3})\b/);
      if (m) return Math.max(0, Math.min(100, parseFloat(m[1]!)));
    }
  }
  return 0;
}

// Evaluate every candidate for one sample: generate, judge vs reference, measure length
// inflation, meter cost, and persist a shadow_evals row per candidate.
export async function evaluateSample(sample: ShadowSampleRow, cfg: SentinelConfig): Promise<CandidateEvalResult[]> {
  const candidates = await selectCandidates(sample, cfg);
  if (candidates.length === 0) throw new Error('no runnable candidate models (add a provider key)');
  const judge = await resolveJudgeChain(sample, cfg);

  const results: CandidateEvalResult[] = [];
  for (const model of candidates) {
    const gen = await callModel(sample, model.slug, model, sample.messages, sample.maxTokens, CALL_TIMEOUT_MS);
    let quality = 0;
    if (gen.ok) quality = await judgeQuality(sample, judge, gen.content);

    const refTokens = sample.referenceTokens > 0 ? sample.referenceTokens : Math.ceil(sample.referenceOutput.length / 4);
    const lengthRatio = refTokens > 0 && gen.completionTokens > 0 ? gen.completionTokens / refTokens : 1;

    const result: CandidateEvalResult = {
      candidateModel: model.slug,
      candidateProvider: model.providerSlug,
      taskClass: sample.taskClass,
      quality: Number(quality.toFixed(2)),
      lengthRatio: Number(lengthRatio.toFixed(4)),
      candidateTokens: gen.completionTokens,
      costUsd: gen.costUsd,
      latencyMs: gen.latencyMs,
      status: gen.ok ? 'ok' : 'error',
      error: gen.ok ? null : gen.error ?? 'generation failed',
    };
    results.push(result);

    await getDb()
      .insert(shadowEvals)
      .values({
        sampleId: sample.id,
        workspaceId: sample.workspaceId,
        taskClass: sample.taskClass,
        candidateModel: result.candidateModel,
        candidateProvider: result.candidateProvider,
        output: gen.content.slice(0, 20_000),
        qualityScore: result.quality.toFixed(2),
        candidateTokens: result.candidateTokens,
        lengthRatio: result.lengthRatio.toFixed(4),
        costUsd: result.costUsd.toFixed(10),
        latencyMs: result.latencyMs,
        status: result.status,
        error: result.error,
      })
      .catch((e) => console.error('[sentinel] shadow_eval insert failed:', (e as Error).message));
  }
  return results;
}
