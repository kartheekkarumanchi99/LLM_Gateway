// Benchmark-based quality index (0-100), approximated from PUBLIC evaluations
// (e.g. MMLU / LMArena / Artificial Analysis standings). This is an ESTIMATE of a
// model's general capability — NOT a live evaluation of your traffic. It is used
// only to express "quality retained" relative to a premium baseline. No runtime
// imports here so it is safe to use in both server and client code.

const QUALITY_INDEX: Record<string, number> = {
  // OpenAI
  'openai/gpt-4o': 100,
  'openai/gpt-4o-2024-11-20': 100,
  'openai/gpt-4o-2024-08-06': 99,
  'openai/gpt-4o-2024-05-13': 98,
  'openai/gpt-4o-mini': 92,
  'openai/gpt-4-turbo': 97,
  'openai/gpt-4': 94,
  'openai/gpt-3.5-turbo': 78,
  'openai/gpt-4.1': 99,
  'openai/gpt-4.1-mini': 93,
  'openai/gpt-4.1-nano': 86,
  'openai/o1': 99,
  'openai/o3': 99,
  'openai/o3-mini': 94,
  'openai/o4-mini': 94,
  'openai/gpt-oss-120b': 90,
  'openai/gpt-oss-20b': 84,
  // Anthropic
  'anthropic/claude-3-5-sonnet': 99,
  'anthropic/claude-3-opus': 97,
  'anthropic/claude-3-haiku': 82,
  'anthropic/claude-sonnet-4': 100,
  'anthropic/claude-haiku-4.5': 92,
  'anthropic/claude-opus-4': 100,
};

// Default for unknown models: a conservative mid-tier estimate.
const DEFAULT_QUALITY = 85;

export function qualityOf(slug: string): number {
  if (slug in QUALITY_INDEX) return QUALITY_INDEX[slug]!;
  // Family fallbacks so unseen variants still get a sensible index.
  if (/gpt-4o-mini|4\.1-mini|haiku|mini|nano|flash|3\.5-turbo/i.test(slug)) return 86;
  if (/gpt-4o|gpt-4\.1|sonnet|gpt-4-turbo|opus|o1|o3|o4/i.test(slug)) return 97;
  return DEFAULT_QUALITY;
}

export const QUALITY_INDEX_NOTE =
  'Benchmark-based quality index (approx., from public evals) — an estimate of model capability, not a live evaluation of your traffic.';
