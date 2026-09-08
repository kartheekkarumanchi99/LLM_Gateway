// Pure types for the AI Optimization & FinOps dashboard (no runtime imports —
// safe to import from client components).

export interface BaselineComparison {
  slug: string;
  name: string;
  costReductionPct: number; // 1 - actual/baseline, as a percentage
  qualityRetentionPct: number; // weighted model quality / baseline quality
  baselineUsd: number;
  valueEfficiency: number; // quality retained per unit of (cost fraction)
}

export interface AttributionSource {
  key: string;
  label: string;
  usd: number;
  pct: number; // share of total savings
}

export interface WorkflowStat {
  key: 'single' | 'cascade' | 'critique' | 'bestofn';
  label: string;
  requests: number;
  avgCostUsd: number;
  avgLatencyMs: number;
  successRatePct: number;
  savingsUsd: number;
  estQualityDelta: number | null; // modeled; null = not estimated
  // Pattern-specific (null when not applicable)
  acceptanceRatePct?: number | null;
  escalationRatePct?: number | null;
  avgBranchCount?: number | null;
  judgeSelectionRatePct?: number | null;
  revisionImprovementRatePct?: number | null;
}

export interface CacheAnalytics {
  hitRatePct: number;
  hits: number;
  misses: number;
  savingsUsd: number;
  exactHits: number;
  semanticHits: number;
}

export interface ModelRow {
  slug: string;
  provider: string;
  requests: number;
  tokens: number;
  costUsd: number;
  quality: number;
  sharePct: number;
}

export interface ProviderRow {
  provider: string;
  requests: number;
  costUsd: number;
  sharePct: number;
}

export interface TaskRow {
  task: string;
  requests: number;
  topModel: string;
  topModelSharePct: number; // routing "consistency" proxy
}

export interface EfficiencyRow {
  label: string;
  quality: number;
  costFraction: number; // relative to gpt-4o = 1
  efficiency: number; // quality / costFraction
  current: boolean;
}

export interface FinOpsData {
  // Executive summary
  primaryBaseline: string; // slug used for the headline (gpt-4o if present)
  costReductionPct: number;
  qualityRetainedPct: number;
  valueEfficiency: number;
  totalSavedUsd: number;
  totalRequests: number;
  totalTokens: number;
  actualUsd: number;
  costFractionPct: number; // actual / baseline, as %

  comparisons: BaselineComparison[]; // quality vs cost hero (per baseline)
  attribution: AttributionSource[];
  workflows: WorkflowStat[];
  cache: CacheAnalytics;
  topModels: ModelRow[];
  modelsAvoided: { slug: string; quality: number }[];
  providers: ProviderRow[];
  tasks: TaskRow[];
  efficiency: EfficiencyRow[];
  avgModelQuality: number; // "quality confidence" proxy
  routingConsistencyPct: number; // avg top-model share across tasks
}
