import type { CandidateModel, CostTier, OwnSignal, RankedCandidate } from './types';

// Deterministic RNG so exploration is reproducible in tests.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Bayesian shrinkage: own telemetry dominates as request count grows.
export function blendAlpha(ownRequests: number, k = 50): number {
  return ownRequests / (ownRequests + k);
}

// Higher lambda => cost matters more. 'max' ignores cost entirely.
const TIER_LAMBDA: Record<CostTier, number> = {
  low: 3.0,
  medium: 1.2,
  high: 0.6,
  xhigh: 0.25,
  max: 0.0,
};

export interface RankInput {
  models: CandidateModel[];
  ownSignal: Map<string, OwnSignal>;
  prior: Map<string, number>;
  estPromptTokens: number;
  estCompletionTokens: number;
  costTier: CostTier;
  weights?: { quality: number; signal: number; reliability: number };
  explore?: number;
  rngSeed?: number;
}

function normalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0);
  return values.map((v) => (v - min) / (max - min));
}

interface Row {
  m: CandidateModel;
  signal: number;
  quality: number;
  reliability: number;
  benefit: number;
  rawCost: number;
  costNorm: number;
}

export function rankCandidates(input: RankInput): {
  ranked: RankedCandidate[];
  alpha: number;
  ownRequests: number;
} {
  const { models } = input;
  const w = input.weights ?? { quality: 1, signal: 1, reliability: 0.5 };
  const explore = input.explore ?? 0.15;
  const rng = mulberry32(input.rngSeed ?? 12345);

  if (models.length === 0) return { ranked: [], alpha: 0, ownRequests: 0 };

  const ownRequests = models.reduce((s, m) => s + (input.ownSignal.get(m.slug)?.n ?? 0), 0);
  const alpha = blendAlpha(ownRequests);
  const totalPrior = Math.max(1e-9, [...input.prior.values()].reduce((s, x) => s + x, 0));
  const totalOwn = Math.max(1, ownRequests);

  const rawCost = models.map(
    (m) =>
      (input.estPromptTokens / 1e6) * m.promptPricePerM +
      (input.estCompletionTokens / 1e6) * m.completionPricePerM,
  );
  const costNormAll = normalize(rawCost);

  const rows: Row[] = models.map((m, i) => {
    const own = input.ownSignal.get(m.slug);
    const ownShare = (own?.n ?? 0) / totalOwn;
    const priorShare = (input.prior.get(m.slug) ?? 0) / totalPrior;
    const signal = alpha * ownShare + (1 - alpha) * priorShare;
    const quality = priorShare;
    const reliability = own ? own.successRate : 0.9;
    const benefit = w.quality * quality + w.signal * signal + w.reliability * reliability;
    return { m, signal, quality, reliability, benefit, rawCost: rawCost[i]!, costNorm: costNormAll[i]! };
  });

  // Pareto frontier: drop candidates dominated on (higher benefit, lower cost).
  const frontier = rows.filter(
    (r) =>
      !rows.some(
        (o) =>
          o !== r &&
          o.benefit >= r.benefit &&
          o.costNorm <= r.costNorm &&
          (o.benefit > r.benefit || o.costNorm < r.costNorm),
      ),
  );
  const pool = frontier.length ? frontier : rows;

  // Normalize benefit + cost within the pool so the cost tier trades off fairly.
  const benefitNorm = normalize(pool.map((r) => r.benefit));
  const costNorm = normalize(pool.map((r) => r.rawCost));
  const lambda = TIER_LAMBDA[input.costTier];

  const ranked: RankedCandidate[] = pool
    .map((r, idx) => {
      const own = input.ownSignal.get(r.m.slug);
      const jitter = explore * (1 / Math.sqrt(1 + (own?.n ?? 0))) * (rng() * 2 - 1);
      const score = benefitNorm[idx]! - lambda * costNorm[idx]! + jitter;
      return {
        ...r.m,
        score,
        quality: r.quality,
        signal: r.signal,
        costNorm: costNorm[idx]!,
        reliability: r.reliability,
      };
    })
    .sort((a, b) => b.score - a.score);

  return { ranked, alpha, ownRequests };
}
