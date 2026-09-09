// Provider catalog — the SINGLE source of truth for which upstream providers this
// gateway can execute, how to reach them, and which env var holds their platform key.
//
// Adding a provider here (plus its <ENV>_API_KEY in the environment) lights up all of
// that provider's models with NO other code changes: key resolution, adapter selection,
// executability (sync-catalog), and routing key-gating all read from this list.
//
// `slug` MUST match the model catalog's provider_slug (the OpenRouter "author" prefix,
// e.g. `anthropic/claude-3.5-sonnet` -> author `anthropic`). `kind` selects the wire
// format: `openai` = any OpenAI-compatible /chat/completions endpoint; `anthropic` =
// the native Anthropic Messages API (translated by its adapter).

export interface ProviderMeta {
  slug: string;
  kind: 'openai' | 'anthropic';
  baseUrl: string; // default OpenAI-compatible base (…/v1); override via <PREFIX>_BASE_URL
  envKey: string; // platform key env var
}

export const PROVIDER_CATALOG: ProviderMeta[] = [
  { slug: 'openai', kind: 'openai', baseUrl: 'https://api.openai.com/v1', envKey: 'OPENAI_API_KEY' },
  { slug: 'anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', envKey: 'ANTHROPIC_API_KEY' },
  { slug: 'deepseek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', envKey: 'DEEPSEEK_API_KEY' },
  { slug: 'x-ai', kind: 'openai', baseUrl: 'https://api.x.ai/v1', envKey: 'XAI_API_KEY' },
  { slug: 'mistralai', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', envKey: 'MISTRAL_API_KEY' },
  { slug: 'google', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', envKey: 'GEMINI_API_KEY' },
  { slug: 'moonshotai', kind: 'openai', baseUrl: 'https://api.moonshot.ai/v1', envKey: 'MOONSHOT_API_KEY' },
  { slug: 'perplexity', kind: 'openai', baseUrl: 'https://api.perplexity.ai', envKey: 'PERPLEXITY_API_KEY' },
];

const bySlug = new Map(PROVIDER_CATALOG.map((p) => [p.slug, p]));

export function providerMeta(slug: string): ProviderMeta | undefined {
  return bySlug.get(slug);
}

export const SUPPORTED_PROVIDER_SLUGS: string[] = PROVIDER_CATALOG.map((p) => p.slug);

// Env var holding an optional base-URL override for a provider (e.g. OPENAI_BASE_URL,
// DEEPSEEK_BASE_URL) — lets you point a provider at a proxy/gateway without code edits.
export function baseUrlEnvKey(meta: ProviderMeta): string {
  return meta.envKey.replace(/_API_KEY$/, '_BASE_URL');
}
