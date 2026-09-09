import { PROVIDER_CATALOG, baseUrlEnvKey, type ProviderMeta } from '@llmgw/db';
import { anthropicAdapter } from './anthropic';
import { createOpenAICompatibleAdapter } from './openai';
import type { ProviderAdapter } from './types';

// Adapters are built from the shared provider catalog — adding a provider there is all
// it takes for the gateway to reach it. OpenAI-compatible providers share one factory
// (base URL overridable via <PREFIX>_BASE_URL); Anthropic uses its translating adapter.
function build(meta: ProviderMeta): ProviderAdapter {
  if (meta.kind === 'anthropic') return anthropicAdapter;
  const baseUrl = process.env[baseUrlEnvKey(meta)] ?? meta.baseUrl;
  return createOpenAICompatibleAdapter(meta.slug, baseUrl);
}

const adapters = new Map<string, ProviderAdapter>(
  PROVIDER_CATALOG.map((meta) => [meta.slug, build(meta)] as const),
);

export function getAdapter(slug: string): ProviderAdapter | undefined {
  return adapters.get(slug);
}

export function hasAdapter(slug: string): boolean {
  return adapters.has(slug);
}
