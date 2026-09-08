import { matchesAnyPattern, type GuardrailPolicies, type PredictiveConfig } from '@llmgw/db';
import { recordUsage } from '../billing/record';
import { checkModelAccess } from '../guardrails/enforce';
import { getAdapter } from '../providers/registry';
import { resolveProviderKey } from '../providers/keys';
import type { ChatCompletionRequest, ChatMessage, Usage } from '../providers/types';
import { autoRoute } from './auto';
import { approxPromptTokens } from './classify';
import type { Prediction } from './predict';
import { recordPredictiveEvent, type PredictiveEventDraft } from './predict-record';
import { resolveModel } from './resolve';
import type { CostTier, RankedCandidate, RoutingTrace, TaskClass } from './types';

// Speculative-execution coordinator for the non-streaming auto path. It starts the
// predicted model's upstream call concurrently with authoritative routing, then a
// commit barrier picks exactly one winner BEFORE any client-visible byte. Exactly
// one call is ever billed; a losing speculative call is aborted (not billed to the
// user) and its estimated waste is recorded separately.

interface RunnableModel {
  slug: string;
  providerSlug: string;
  upstreamModel: string;
  pin: number;
  pout: number;
}

export interface SpecCtx {
  orgId: string;
  workspaceId: string;
  apiKeyId: string;
  requestId: string;
  appName: string | null;
  taskClass: TaskClass;
  costTier: CostTier;
  maxTokens: number;
  guardrail: GuardrailPolicies | null;
  allowedModels: string[];
  config: PredictiveConfig;
  prediction: Prediction;
  startedAt: number;
  speculationBudgetUsd: number | null;
  speculationOptedOut: boolean;
}

export interface SpecResult {
  responseJson: Record<string, unknown>;
  chosenModel: string;
  providerSlug: string;
  completionText: string;
  usage: Usage;
  cost: number;
  headers: Record<string, string>;
}

function fromRanked(r: RankedCandidate): RunnableModel {
  return {
    slug: r.slug,
    providerSlug: r.providerSlug,
    upstreamModel: r.upstreamModel,
    pin: r.promptPricePerM,
    pout: r.completionPricePerM,
  };
}

function estimateCost(m: RunnableModel, promptTokens: number, maxTokens: number): number {
  return (promptTokens / 1_000_000) * m.pin + (maxTokens / 1_000_000) * m.pout;
}

function extractContent(json: Record<string, unknown>): string {
  const choices = json.choices as Array<{ message?: { content?: unknown } }> | undefined;
  const c = choices?.[0]?.message?.content;
  return typeof c === 'string' ? c : '';
}

function withCommitTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  if (!ms || ms <= 0) return p;
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function policyOk(m: RunnableModel, ctx: SpecCtx): boolean {
  const c = ctx.config;
  if (c.allowedModels.length && !matchesAnyPattern(m.slug, c.allowedModels)) return false;
  if (c.allowedProviders.length && !c.allowedProviders.includes(m.providerSlug)) return false;
  if (!matchesAnyPattern(m.slug, ctx.allowedModels)) return false; // workspace allow-list
  if (ctx.guardrail && !checkModelAccess(ctx.guardrail, m.slug, m.providerSlug).allowed) return false;
  return true;
}

async function callModel(
  m: RunnableModel,
  body: ChatCompletionRequest,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ json: Record<string, unknown>; usage: Usage }> {
  const adapter = getAdapter(m.providerSlug);
  if (!adapter) throw new Error(`no adapter for ${m.providerSlug}`);
  return adapter.chat(m.upstreamModel, { ...body, model: m.upstreamModel }, apiKey, signal);
}

// Pure config-level eligibility gate (no DB / no upstream) — returns an ineligibility
// reason or null when the request may open a speculative call.
export function speculationGate(
  pred: Prediction,
  config: PredictiveConfig,
  optedOut: boolean,
): string | null {
  if (!config.speculationEnabled) return 'speculation_disabled';
  if (optedOut) return 'request_opt_out';
  if (!pred.predictedModel) return 'no_prediction';
  if (pred.confidence < config.confidenceThreshold) return 'low_confidence';
  if (config.allowedTaskClasses.length && !config.allowedTaskClasses.includes(pred.predictedTaskClass))
    return 'task_not_allowed';
  return null;
}

export async function runSpeculativeAuto(
  messages: ChatMessage[],
  body: ChatCompletionRequest,
  ctx: SpecCtx,
): Promise<SpecResult | null> {
  const pred = ctx.prediction;
  const promptTokensEst = approxPromptTokens(messages);
  const speculationBudget = Math.min(
    ctx.config.maxSpeculationCostUsd,
    ctx.speculationBudgetUsd ?? Number.POSITIVE_INFINITY,
  );

  // Decide eligibility to actually open a speculative upstream call.
  let ineligibleReason: string | null = speculationGate(pred, ctx.config, ctx.speculationOptedOut);

  // Prepare (but do not yet send) the speculative call.
  let spec: { ctrl: AbortController; promise: Promise<{ json: Record<string, unknown>; usage: Usage }>; model: RunnableModel } | null =
    null;
  if (!ineligibleReason && pred.predictedModel) {
    const resolved = await resolveModel(pred.predictedModel);
    if (!resolved) ineligibleReason = 'model_unresolved';
    else {
      const m: RunnableModel = {
        slug: resolved.slug,
        providerSlug: resolved.providerSlug,
        upstreamModel: resolved.upstreamModel,
        pin: Number(resolved.promptPricePerM),
        pout: Number(resolved.completionPricePerM),
      };
      if (!getAdapter(m.providerSlug)) ineligibleReason = 'no_adapter';
      else if (!policyOk(m, ctx)) ineligibleReason = 'model_not_allowed';
      else if (estimateCost(m, promptTokensEst, ctx.maxTokens) > speculationBudget)
        ineligibleReason = 'over_budget';
      else {
        const keyInfo = await resolveProviderKey(ctx.orgId, m.providerSlug);
        if (!keyInfo.key) ineligibleReason = 'no_provider_key';
        else {
          const ctrl = new AbortController();
          const promise = callModel(m, body, keyInfo.key, ctrl.signal);
          promise.catch(() => {}); // never leak an unhandled rejection on abort
          spec = { ctrl, promise, model: m };
        }
      }
    }
  }

  // No speculative call was started (ineligible or preparation failed) — fall back to
  // the standard path, which records an observation-only predictive event.
  if (!spec) return null;

  // Authoritative routing, raced against the commit timeout.
  const routeStart = Date.now();
  const routed = await withCommitTimeout(
    autoRoute({
      messages,
      costTier: ctx.costTier,
      maxTokens: ctx.maxTokens,
      guardrail: ctx.guardrail,
      allowedModels: ctx.allowedModels,
    }),
    ctx.config.commitTimeoutMs,
  );
  const routeDurationMs = Date.now() - routeStart;

  const rankedChain = (routed?.ranked ?? []).slice(0, 4).map(fromRanked);
  const rawAuthoritative = rankedChain[0] ?? null;

  // If routing produced nothing usable, abort any speculation and fall back to the
  // standard path (preserves existing behavior).
  if (!rawAuthoritative) {
    if (spec) spec.ctrl.abort();
    return null;
  }

  // Walk the ranked chain like the standard recovery loop, but reuse the in-flight
  // speculative call when the router commits to the predicted model. The speculative
  // call stays alive while higher-ranked (possibly non-callable) candidates are
  // probed, so a jittered top pick that fails does not waste a correct prediction.
  const speculationStarted = spec != null;
  let committed: RunnableModel | null = null;
  let out: { json: Record<string, unknown>; usage: Usage } | null = null;
  let specHit = false;
  let loserCancelled = false;
  const wasteUsd = 0; // clean pre-completion aborts; providers generally do not bill them

  for (const cand of rankedChain) {
    if (spec && cand.slug === spec.model.slug) {
      try {
        out = await spec.promise;
        committed = cand;
        specHit = true;
        break;
      } catch {
        spec = null; // speculative call failed; try this model fresh below
      }
    }
    if (!policyOk(cand, ctx)) continue;
    const keyInfo = await resolveProviderKey(ctx.orgId, cand.providerSlug);
    if (!keyInfo.key) continue;
    try {
      out = await callModel(cand, body, keyInfo.key);
      committed = cand;
      if (spec) {
        spec.ctrl.abort(); // a ranked candidate beat the prediction — speculation loses
        loserCancelled = true;
        spec = null;
      }
      break;
    } catch {
      continue; // try the next candidate
    }
  }
  if (spec) {
    spec.ctrl.abort();
    if (!specHit) loserCancelled = true;
  }
  if (!committed || !out) return null; // all candidates failed — let the standard path handle it

  const commitReason = specHit
    ? 'prediction_hit'
    : committed.slug === pred.predictedModel
      ? 'prediction_hit_retry'
      : loserCancelled
        ? 'authoritative_override'
        : 'authoritative';

  const latencyMs = Date.now() - ctx.startedAt;
  const routingOverheadMs = routeDurationMs;
  const byokInfo = await resolveProviderKey(ctx.orgId, committed.providerSlug);
  const trace: RoutingTrace = {
    mode: 'auto',
    taskClass: ctx.taskClass,
    costTier: ctx.costTier,
    chosen: committed.slug,
    attempts: [{ slug: committed.slug, providerSlug: committed.providerSlug, result: 'success' }],
  };

  const cost = await recordUsage({
    requestId: ctx.requestId,
    workspaceId: ctx.workspaceId,
    apiKeyId: ctx.apiKeyId,
    orgId: ctx.orgId,
    modelSlug: committed.slug,
    providerSlug: committed.providerSlug,
    taskClass: ctx.taskClass,
    status: 'success',
    promptTokens: out.usage.promptTokens,
    completionTokens: out.usage.completionTokens,
    totalTokens: out.usage.totalTokens,
    cachedTokens: out.usage.cachedTokens,
    reasoningTokens: out.usage.reasoningTokens,
    promptPricePerM: String(committed.pin),
    completionPricePerM: String(committed.pout),
    latencyMs,
    byok: byokInfo.isByok,
    appName: ctx.appName,
    routingOverheadMs,
    routingTrace: trace,
  });

  const event: PredictiveEventDraft = {
    requestId: ctx.requestId,
    workspaceId: ctx.workspaceId,
    predictorVersion: pred.predictorVersion,
    mode: 'speculation',
    predictedTaskClass: pred.predictedTaskClass,
    actualTaskClass: ctx.taskClass,
    predictedModel: pred.predictedModel,
    authoritativeModel: rawAuthoritative.slug,
    committedModel: committed.slug,
    predictionConfidence: pred.confidence,
    predictionCorrect: pred.predictedModel === committed.slug,
    speculationStarted,
    loserCancelled,
    commitReason,
    routingOverheadMs,
    estimatedStandardOverheadMs: routeDurationMs,
    predictorLatencyMs: pred.predictorLatencyMs,
    speculationWasteUsd: wasteUsd,
  };
  void recordPredictiveEvent(event);

  const responseJson: Record<string, unknown> = {
    ...out.json,
    model: committed.slug,
    usage: { ...(out.json.usage as object | undefined), cost },
    _routing: {
      task: ctx.taskClass,
      mode: 'auto',
      chosen: committed.slug,
      provider: committed.providerSlug,
      attempts: 1,
      prediction: pred.predictedModel,
      predictionConfidence: Number(pred.confidence.toFixed(4)),
      speculationStarted,
      speculativeCandidates: speculationStarted ? 1 : 0,
      committedCandidate: committed.slug,
      commitReason,
      routingOverheadMs,
      speculationWasteUsd: Number(wasteUsd.toFixed(10)),
    },
  };

  return {
    responseJson,
    chosenModel: committed.slug,
    providerSlug: committed.providerSlug,
    completionText: extractContent(out.json),
    usage: out.usage,
    cost,
    headers: {
      'x-llmgw-prediction': pred.predictedModel ?? '',
      'x-llmgw-committed': committed.slug,
      'x-llmgw-commit-reason': commitReason,
      'x-llmgw-routing-overhead-ms': String(routingOverheadMs),
    },
  };
}
