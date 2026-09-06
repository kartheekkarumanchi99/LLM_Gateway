export type TaskClass =
  | 'code'
  | 'reasoning'
  | 'summarization'
  | 'extraction'
  | 'creative'
  | 'vision'
  | 'long_context'
  | 'chat';

export type CostTier = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const COST_TIERS: CostTier[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function isCostTier(x: unknown): x is CostTier {
  return typeof x === 'string' && (COST_TIERS as string[]).includes(x);
}

export interface CandidateModel {
  slug: string;
  providerSlug: string;
  upstreamModel: string;
  promptPricePerM: number;
  completionPricePerM: number;
  contextLength: number;
  modality: string | null;
}

export interface OwnSignal {
  n: number;
  successRate: number;
}

export interface RankedCandidate extends CandidateModel {
  score: number;
  quality: number;
  signal: number;
  costNorm: number;
  reliability: number;
}

export interface RoutingAttempt {
  slug: string;
  providerSlug: string;
  result: 'skipped' | 'error' | 'success';
  reason?: string;
}

export interface RoutingTrace {
  mode: 'auto' | 'explicit' | 'fallback';
  taskClass?: TaskClass;
  costTier?: CostTier;
  chosen?: string;
  signalMix?: { alpha: number; ownRequests: number };
  attempts: RoutingAttempt[];
}
