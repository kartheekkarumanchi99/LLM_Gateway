import { anthropicAdapter } from './anthropic';
import { openaiAdapter } from './openai';
import type { ProviderAdapter } from './types';

const adapters: Record<string, ProviderAdapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
};

export function getAdapter(slug: string): ProviderAdapter | undefined {
  return adapters[slug];
}
