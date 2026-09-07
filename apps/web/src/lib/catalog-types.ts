// Pure types shared by server data loaders and client components (no runtime imports,
// so it is safe to `import type` from client components without pulling in node deps).

export interface CatalogModel {
  slug: string;
  name: string;
  provider: string;
  providerName: string;
  providerIcon: string | null;
  upstreamModel: string;
  description: string | null;
  modality: string | null;
  contextLength: number;
  promptPricePerM: number;
  completionPricePerM: number;
  executable: boolean;
  createdAt: string;
}

export interface ModelTelemetry {
  requests: number;
  successes: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgTtftMs: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  avgThroughput: number;
}

export interface ModelApp {
  app: string;
  tokens: number;
  requests: number;
}

export interface ActivityDay {
  day: string;
  prompt: number;
  completion: number;
}

export interface ModelInsights {
  telemetry: ModelTelemetry;
  apps: ModelApp[];
  activity: ActivityDay[];
}

export interface RunnableModel {
  slug: string;
  name: string;
  provider: string;
}
