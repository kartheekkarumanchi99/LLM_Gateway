// Shared types + defaults for Prompt & Model CI (gateway + web). No runtime imports so
// it is safe to import from client components.

export interface EvalVariantStats {
  quality: number; // avg 0..100
  avgCostUsd: number;
  avgLatencyMs: number;
  passRate: number; // 0..1
  cases: number;
}

export type EvalVerdict = 'improved' | 'regressed' | 'neutral' | 'no-baseline';

export interface EvalSummary {
  candidate: EvalVariantStats;
  baseline: EvalVariantStats | null;
  qualityDelta: number; // candidate.quality - baseline.quality
  costDeltaPct: number; // (candidate.cost - baseline.cost) / baseline.cost * 100
  latencyDeltaPct: number;
  casesPassed: number;
  casesTotal: number;
  verdict: EvalVerdict;
}

export const MAX_EVAL_CASES = 20;
export const PASS_THRESHOLD = 70; // candidate quality >= this = a passing case
export const REGRESSION_QUALITY_DROP = 3; // quality points drop that counts as a regression
