// Workspace-level predictive-routing / speculative-execution config, stored as
// the `predictive` jsonb column on workspace_settings (same convention as
// RoutingConfig / ToolsConfig). Feature flag is OFF by default; observation-only
// is the default rollout mode.

export interface PredictiveConfig {
  enabled: boolean;
  observationOnly: boolean;
  speculationEnabled: boolean;
  maxCandidates: number;
  confidenceThreshold: number; // 0..1 — minimum prediction confidence to act/speculate
  maxSpeculationCostUsd: number; // per-request speculative spend ceiling
  commitTimeoutMs: number; // give up waiting for authoritative routing after this
  allowedTaskClasses: string[]; // empty = all
  allowedModels: string[]; // wildcard patterns; empty = all
  allowedProviders: string[]; // empty = all
  sensitiveDataDisabled: boolean; // never speculate when PII/injection is flagged
  orchestrationDisabled: boolean; // never speculate for orchestration workflows
  autoCancelLosers: boolean;
  maxRoutingOverheadMs: number; // 0 = no cap
}

export const DEFAULT_PREDICTIVE_CONFIG: PredictiveConfig = {
  enabled: false,
  observationOnly: true,
  speculationEnabled: false,
  maxCandidates: 1,
  confidenceThreshold: 0.6,
  maxSpeculationCostUsd: 0.02,
  commitTimeoutMs: 8000,
  allowedTaskClasses: [],
  allowedModels: [],
  allowedProviders: [],
  sensitiveDataDisabled: true,
  orchestrationDisabled: true,
  autoCancelLosers: true,
  maxRoutingOverheadMs: 0,
};

export const PREDICTOR_VERSION = 'heuristic-v1';
