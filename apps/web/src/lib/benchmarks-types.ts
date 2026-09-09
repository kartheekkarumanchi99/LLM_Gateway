// Client-safe types for the Benchmarks page.

export interface ParetoPoint {
  slug: string;
  provider: string;
  pricePerM: number; // blended list price $/1M
  quality: number; // public capability estimate (0-100)
  requests: number; // your calls in the window (0 = not used)
  onFrontier: boolean;
  used: boolean;
}

export interface BenchModel {
  modelSlug: string;
  providerSlug: string;
  requests: number;
  successRate: number; // 0..1
  errorRate: number; // 0..1
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  ttftP50: number | null;
  ttftP95: number | null;
  throughput: number; // completion tokens / sec
  avgPricePerM: number; // realized blended $/1M
  avgAttempts: number;
  cacheHitRate: number; // 0..1
  qualityEst: number; // public capability estimate
}

export interface TaskLeaderRow {
  modelSlug: string;
  requests: number;
  successRate: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  throughput: number;
}

export interface TaskBench {
  taskClass: string;
  total: number;
  leaders: TaskLeaderRow[];
}

export interface BenchmarksData {
  days: number;
  hasData: boolean;
  totalCalls: number;
  modelsMeasured: number;
  catalogModels: number;
  pareto: ParetoPoint[];
  frontier: { x: number; y: number; slug: string }[];
  models: BenchModel[];
  tasks: TaskBench[];
}
