// Pure types for the cost-savings panel (no runtime imports — safe for client use).

export interface SavingsModelRow {
  model: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  actualUsd: number;
}

export interface BaselineOption {
  slug: string;
  name: string;
  promptPerM: number;
  completionPerM: number;
}

export interface SavingsData {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  actualUsd: number;
  byModel: SavingsModelRow[];
  baselines: BaselineOption[];
}
