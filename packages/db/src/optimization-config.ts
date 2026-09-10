// Shared types + defaults for the Prompt Optimization Engine (used by gateway + web).
// No runtime imports so it is safe to import from client components.

export interface OptimizationExample {
  input: string;
  reference?: string; // optional gold answer to judge against
}

export interface OptimizationWeights {
  quality: number; // 0..1, weights for the composite score
  cost: number;
  latency: number;
}

export interface OptimizationConfig {
  models: string[]; // candidate model slugs to try (empty = auto: cheapest runnable)
  variants: number; // how many prompt variants the optimizer proposes
  examples: OptimizationExample[];
  judgeModel: string | null; // slug for the LLM judge (null = a cheap default)
  weights: OptimizationWeights;
  maxTokens: number;
}

export const DEFAULT_OPTIMIZATION: OptimizationConfig = {
  models: [],
  variants: 3,
  examples: [],
  judgeModel: null,
  weights: { quality: 0.7, cost: 0.2, latency: 0.1 },
  maxTokens: 512,
};

export const MAX_VARIANTS = 5;
export const MAX_EXAMPLES = 8;
export const OPTIMIZER_VERSION = 'ape-v1';

export interface OptimizationSummary {
  baselineScore: number;
  winnerScore: number;
  qualityDelta: number; // winner.quality - baseline.quality (points)
  costDeltaPct: number; // (winner.cost - baseline.cost) / baseline.cost * 100
  latencyDeltaPct: number;
  winnerModel: string;
  winnerLabel: string;
  improved: boolean; // winner beats baseline on the composite score
}
