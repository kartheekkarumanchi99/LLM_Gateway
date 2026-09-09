// Client-safe types for the Rankings page (no runtime imports).

export interface RankModel {
  rank: number;
  modelSlug: string;
  providerSlug: string;
  tokens: number;
  spendUsd: number;
  requests: number;
  sharePct: number; // share of total tokens in the window
  trendPct: number | null; // token change vs the previous equal-length window
  spark: number[]; // per-day tokens across the window
  avgPricePerM: number; // realized blended $/1M (spend / (tokens/1e6))
}

export interface RankProvider {
  providerSlug: string;
  tokens: number;
  spendUsd: number;
  requests: number;
  sharePct: number;
  trendPct: number | null;
}

export interface RankNamed {
  name: string;
  tokens: number;
  spendUsd: number;
  requests: number;
  sharePct: number;
}

export interface TaskLeader {
  taskClass: string;
  modelSlug: string;
  requests: number;
  sharePct: number; // model's share within the task class
}

export interface Mover {
  modelSlug: string;
  providerSlug: string;
  tokens: number;
  trendPct: number;
}

export interface ShareSeries {
  series: { key: string; label: string; color: string }[];
  points: Record<string, number>[]; // one per day, keyed by model slug (+ 'other')
}

export interface RankingsTotals {
  tokens: number;
  spendUsd: number;
  requests: number;
  models: number;
  providers: number;
}

export interface RankingsData {
  days: number;
  hasData: boolean;
  totals: RankingsTotals;
  models: RankModel[];
  providers: RankProvider[];
  byTask: TaskLeader[];
  apps: RankNamed[];
  keys: RankNamed[];
  gainers: Mover[];
  decliners: Mover[];
  share: ShareSeries;
}
