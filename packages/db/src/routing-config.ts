// Workspace-level routing/tools/preset contracts shared by the web app and gateway.

export type CostTier = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ProviderSort = 'balanced' | 'price' | 'throughput' | 'latency';

export interface RoutingConfig {
  autoCostTier: CostTier;
  autoAllowedModels: string[];
  autoPreventOverrides: boolean;
  defaultProviderSort: ProviderSort;
  defaultModel: string | null;
}

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  autoCostTier: 'low',
  autoAllowedModels: [],
  autoPreventOverrides: false,
  defaultProviderSort: 'balanced',
  defaultModel: null,
};

export interface ServerToolMeta {
  id: string;
  label: string;
  description: string;
  group: string;
}

export const SERVER_TOOLS: ServerToolMeta[] = [
  { id: 'web_search', label: 'Web Search', description: 'Real-time web search during a generation.', group: 'Web Access' },
  { id: 'web_fetch', label: 'Web Fetch', description: 'Fetch the contents of a URL and return it as text.', group: 'Web Access' },
  { id: 'advisor', label: 'Advisor', description: 'Consult a stronger advisor model mid-generation.', group: 'Multi-model' },
  { id: 'subagent', label: 'Subagent', description: 'Delegate sub-tasks to a smaller, faster worker model.', group: 'Multi-model' },
  { id: 'fusion', label: 'Fusion', description: 'Run a panel of models plus an analyst over the request.', group: 'Multi-model' },
  { id: 'shell', label: 'Shell', description: 'Hosted shell in a sandboxed container.', group: 'Code Execution' },
  { id: 'bash', label: 'Bash', description: 'Run model-authored shell commands in a sandbox.', group: 'Code Execution' },
];

export interface ToolsConfig {
  disallowed: string[];
  plugins: { responseHealing: boolean; paretoRouter: boolean };
}

export const DEFAULT_TOOLS_CONFIG: ToolsConfig = {
  disallowed: [],
  plugins: { responseHealing: false, paretoRouter: false },
};

export interface PresetProviderPrefs {
  sort?: 'price' | 'throughput' | 'latency';
  order?: string[];
  only?: string[];
  ignore?: string[];
  allowFallbacks?: boolean;
  dataCollection?: 'allow' | 'deny';
  zdr?: boolean;
  maxPrice?: { prompt?: number; completion?: number };
}

export interface PresetParameters {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

export interface PresetConfig {
  models: string[];
  providerPrefs?: PresetProviderPrefs;
  parameters?: PresetParameters;
  tools: string[];
  caching?: { enabled: boolean; ttlSeconds: number };
}

// Wildcards: '*', 'anthropic/*', or exact 'openai/gpt-4o'. Empty list = allow all.
export function matchesAnyPattern(slug: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((raw) => {
    const p = raw.trim();
    if (!p) return false;
    if (p === '*') return true;
    if (p.endsWith('/*')) return slug.startsWith(p.slice(0, -1));
    return slug === p;
  });
}

export function parsePatternList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
