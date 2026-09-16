// Shared types + defaults + pure drift math for the Shadow Model Drift & Regression
// Sentinel (gateway + web). No runtime imports so it is safe from client components.
//
// The Sentinel async-duplicates a sample of production traffic (PII-scrubbed) to candidate
// models in the background, LLM-judges each output against the served ("reference") answer,
// tracks a per-(model, task) behavioral baseline, and flags when a silently-updated vendor
// checkpoint drifts — a quality drop or output-length inflation — so routing can self-heal.

export interface SentinelConfig {
  enabled: boolean;
  // Share of eligible production requests duplicated into the shadow queue (0..100).
  sampleRatePct: number;
  // Candidate models evaluated per shadow sample (1..4).
  fanout: number;
  // Relative quality drop vs baseline that counts as drift (percentage points of %, default 3).
  qualityDropPct: number;
  // Relative output-length inflation vs baseline that counts as drift (default 15%).
  lengthInflationPct: number;
  // Apply the routing health penalty automatically when drift is detected.
  autoReweight: boolean;
  // Override judge model (else the cheapest runnable model is used).
  judgeModel: string | null;
}

export const DEFAULT_SENTINEL_CONFIG: SentinelConfig = {
  enabled: false,
  sampleRatePct: 10,
  fanout: 2,
  qualityDropPct: 3,
  lengthInflationPct: 15,
  autoReweight: true,
  judgeModel: null,
};

export function normalizeSentinelConfig(raw: unknown): SentinelConfig {
  const r = (raw ?? {}) as Partial<SentinelConfig>;
  const clampNum = (v: unknown, lo: number, hi: number, dflt: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_SENTINEL_CONFIG.enabled,
    sampleRatePct: clampNum(r.sampleRatePct, 0, 100, DEFAULT_SENTINEL_CONFIG.sampleRatePct),
    fanout: Math.round(clampNum(r.fanout, 1, MAX_FANOUT, DEFAULT_SENTINEL_CONFIG.fanout)),
    qualityDropPct: clampNum(r.qualityDropPct, 0.5, 50, DEFAULT_SENTINEL_CONFIG.qualityDropPct),
    lengthInflationPct: clampNum(r.lengthInflationPct, 1, 200, DEFAULT_SENTINEL_CONFIG.lengthInflationPct),
    autoReweight: typeof r.autoReweight === 'boolean' ? r.autoReweight : DEFAULT_SENTINEL_CONFIG.autoReweight,
    judgeModel: typeof r.judgeModel === 'string' && r.judgeModel ? r.judgeModel : null,
  };
}

// ---- Constants (tuned conservatively so a couple of noisy samples can't trip drift) ----
export const MIN_BASELINE_SAMPLES = 8; // baseline is "established" only past this many evals
export const RECENT_WINDOW = 10; // evals compared against the baseline
export const MIN_RECENT_SAMPLES = 3; // need at least this many recent evals to declare drift
export const MAX_FANOUT = 4;
export const MAX_SHADOW_BATCH = 4; // pending samples processed per worker tick
export const SHADOW_WORKER_INTERVAL_MS = 20_000;
export const MAX_PENDING_SAMPLES = 500; // backpressure: stop enqueueing past this depth
export const HEALTH_FLOOR = 0.3; // a drifted model never drops below 30% routing weight
export const BASELINE_EWMA = 0.15; // how fast a healthy baseline tracks recent behavior

export type DriftKind = 'quality_drop' | 'length_inflation' | 'recovered';
export type ModelDriftStatus = 'establishing' | 'healthy' | 'watching' | 'drifted';

export interface DriftInput {
  baselineQuality: number; // 0..100 established mean
  baselineLengthRatio: number; // established mean of candidateTokens / referenceTokens
  baselineSamples: number;
  recentQuality: number; // mean over the recent window
  recentLengthRatio: number;
  recentSamples: number;
}

export interface DriftAssessment {
  status: ModelDriftStatus;
  drifted: boolean;
  kinds: DriftKind[];
  qualityDropPct: number; // relative % drop vs baseline (>=0)
  lengthInflationPct: number; // relative % inflation vs baseline (>=0)
  healthMultiplier: number; // 0..1 routing weight
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// Pure drift assessment: baseline (known-good) vs recent behavior → status + routing weight.
// Deterministic and side-effect-free so it is unit-testable and identical on gateway + web.
export function assessDrift(input: DriftInput, cfg: SentinelConfig): DriftAssessment {
  const qualityDropPct =
    input.baselineQuality > 0
      ? clamp(((input.baselineQuality - input.recentQuality) / input.baselineQuality) * 100, 0, 100)
      : 0;
  const lengthInflationPct =
    input.baselineLengthRatio > 0
      ? clamp(((input.recentLengthRatio - input.baselineLengthRatio) / input.baselineLengthRatio) * 100, 0, 1000)
      : 0;

  // Not enough history to trust a baseline yet.
  if (input.baselineSamples < MIN_BASELINE_SAMPLES || input.recentSamples < MIN_RECENT_SAMPLES) {
    return {
      status: 'establishing',
      drifted: false,
      kinds: [],
      qualityDropPct: Number(qualityDropPct.toFixed(2)),
      lengthInflationPct: Number(lengthInflationPct.toFixed(2)),
      healthMultiplier: 1,
    };
  }

  const qDrift = qualityDropPct >= cfg.qualityDropPct;
  const lDrift = lengthInflationPct >= cfg.lengthInflationPct;
  const kinds: DriftKind[] = [];
  if (qDrift) kinds.push('quality_drop');
  if (lDrift) kinds.push('length_inflation');

  let healthMultiplier = 1;
  if (qDrift) {
    // A 3% drop → ~0.91; 10% → 0.70; >=23% → floor. Penalty scales with severity.
    healthMultiplier = clamp(1 - (qualityDropPct / 100) * 3, HEALTH_FLOOR, 1);
  }
  if (lDrift) {
    // Length inflation alone is a softer signal (costs money, rarely breaks output).
    healthMultiplier = Math.min(healthMultiplier, 0.85);
  }

  const drifted = qDrift || lDrift;
  let status: ModelDriftStatus;
  if (drifted) status = 'drifted';
  else if (qualityDropPct >= cfg.qualityDropPct * 0.5 || lengthInflationPct >= cfg.lengthInflationPct * 0.5)
    status = 'watching';
  else status = 'healthy';

  return {
    status,
    drifted,
    kinds,
    qualityDropPct: Number(qualityDropPct.toFixed(2)),
    lengthInflationPct: Number(lengthInflationPct.toFixed(2)),
    healthMultiplier: Number(healthMultiplier.toFixed(4)),
  };
}

export interface ModelHealthView {
  modelSlug: string;
  taskClass: string;
  status: ModelDriftStatus;
  baselineQuality: number;
  recentQuality: number;
  qualityDropPct: number;
  baselineLengthRatio: number;
  recentLengthRatio: number;
  lengthInflationPct: number;
  healthMultiplier: number;
  sampleCount: number;
  updatedAt: string | null;
}
