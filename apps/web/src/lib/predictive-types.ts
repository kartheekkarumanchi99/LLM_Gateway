// Pure types for the Predictive Routing dashboard (no runtime imports — safe for
// client components).

export interface PredictiveSummary {
  total: number;
  observation: number;
  speculation: number;
  predictions: number;
  correct: number;
  accuracyPct: number | null;
  overheadP50: number;
  overheadP95: number;
  overheadP99: number;
  estLatencyAvoidedMs: number;
  avgLatencyAvoidedMs: number;
  activationRatePct: number;
  correctCommits: number;
  wasteUsd: number;
  losersCancelled: number;
  predictorVersion: string | null;
}

export interface TaskAccuracy {
  task: string;
  total: number;
  correct: number;
  accuracyPct: number;
}

export interface PredEventRow {
  requestId: string;
  mode: string;
  predicted: string | null;
  authoritative: string | null;
  committed: string | null;
  correct: boolean | null;
  confidence: number | null;
  commitReason: string | null;
  speculationStarted: boolean;
  overheadMs: number | null;
  createdAt: string;
}
