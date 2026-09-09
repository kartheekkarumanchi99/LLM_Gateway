// Brand registry for model providers (authors). Maps a provider slug to a display
// name, an official domain (used to fetch a real logo), and a brand color used for
// the graceful initial fallback. Pure data — safe to import from client components.

interface BrandInfo {
  name: string;
  domain?: string;
  color: string;
}

const MAP: Record<string, BrandInfo> = {
  openai: { name: 'OpenAI', domain: 'openai.com', color: '#10a37f' },
  anthropic: { name: 'Anthropic', domain: 'anthropic.com', color: '#cc785c' },
  google: { name: 'Google', domain: 'google.com', color: '#4285f4' },
  'google-vertex': { name: 'Google', domain: 'google.com', color: '#4285f4' },
  deepseek: { name: 'DeepSeek', domain: 'deepseek.com', color: '#4d6bfe' },
  'x-ai': { name: 'xAI', domain: 'x.ai', color: '#111111' },
  mistralai: { name: 'Mistral AI', domain: 'mistral.ai', color: '#fa520f' },
  moonshotai: { name: 'Moonshot AI', domain: 'moonshot.cn', color: '#16162e' },
  perplexity: { name: 'Perplexity', domain: 'perplexity.ai', color: '#20808d' },
  meta: { name: 'Meta', domain: 'meta.com', color: '#0866ff' },
  'meta-llama': { name: 'Meta Llama', domain: 'meta.com', color: '#0866ff' },
  microsoft: { name: 'Microsoft', domain: 'microsoft.com', color: '#5e5e5e' },
  cohere: { name: 'Cohere', domain: 'cohere.com', color: '#39594d' },
  nvidia: { name: 'NVIDIA', domain: 'nvidia.com', color: '#76b900' },
  amazon: { name: 'Amazon', domain: 'amazon.com', color: '#ff9900' },
  qwen: { name: 'Qwen', domain: 'qwen.ai', color: '#615ced' },
  'z-ai': { name: 'Z.ai', domain: 'z.ai', color: '#3b5bfe' },
  baidu: { name: 'Baidu', domain: 'baidu.com', color: '#2932e1' },
  bytedance: { name: 'ByteDance', domain: 'bytedance.com', color: '#325ab4' },
  'bytedance-seed': { name: 'ByteDance Seed', domain: 'bytedance.com', color: '#325ab4' },
  tencent: { name: 'Tencent', domain: 'tencent.com', color: '#0052d9' },
  xiaomi: { name: 'Xiaomi', domain: 'mi.com', color: '#ff6900' },
  'ibm-granite': { name: 'IBM Granite', domain: 'ibm.com', color: '#0f62fe' },
  nousresearch: { name: 'Nous Research', domain: 'nousresearch.com', color: '#111111' },
  upstage: { name: 'Upstage', domain: 'upstage.ai', color: '#908fdd' },
  writer: { name: 'Writer', domain: 'writer.com', color: '#111111' },
  minimax: { name: 'MiniMax', domain: 'minimaxi.com', color: '#e8342a' },
  liquid: { name: 'Liquid AI', domain: 'liquid.ai', color: '#111111' },
  inception: { name: 'Inception', domain: 'inceptionlabs.ai', color: '#111111' },
  stepfun: { name: 'StepFun', domain: 'stepfun.com', color: '#111111' },
  rekaai: { name: 'Reka AI', domain: 'reka.ai', color: '#111111' },
  sakana: { name: 'Sakana AI', domain: 'sakana.ai', color: '#111111' },
  cognitivecomputations: { name: 'Cognitive Computations', color: '#7c3aed' },
  'arcee-ai': { name: 'Arcee AI', domain: 'arcee.ai', color: '#111111' },
  'aion-labs': { name: 'AionLabs', color: '#6366f1' },
  openrouter: { name: 'OpenRouter', domain: 'openrouter.ai', color: '#6467f2' },
  thedrummer: { name: 'TheDrummer', color: '#a855f7' },
  gryphe: { name: 'Gryphe', color: '#ec4899' },
  sao10k: { name: 'Sao10K', color: '#f59e0b' },
  nex: { name: 'NEX', color: '#0ea5e9' },
  'nex-agi': { name: 'NEX AGI', color: '#0ea5e9' },
  inclusionai: { name: 'inclusionAI', color: '#14b8a6' },
  kwaipilot: { name: 'Kwaipilot', color: '#f97316' },
  meituan: { name: 'Meituan', domain: 'meituan.com', color: '#ffd100' },
  morph: { name: 'Morph', color: '#8b5cf6' },
  poolside: { name: 'Poolside', domain: 'poolside.ai', color: '#111111' },
  relace: { name: 'Relace', color: '#22c55e' },
  thinkingmachines: { name: 'Thinking Machines', color: '#111111' },
};

function prettify(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((p) => (p ? p[0]!.toUpperCase() + p.slice(1) : p))
    .join(' ');
}

// Deterministic color for providers not in the map (locale/theme independent).
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export interface Brand {
  name: string;
  domain?: string;
  color: string;
  initial: string;
}

export function brandFor(slug: string): Brand {
  const key = (slug || '').toLowerCase();
  const m = MAP[key];
  const name = m?.name ?? prettify(slug || '?');
  const color = m?.color ?? `hsl(${hashHue(key)} 52% 46%)`;
  return { name, domain: m?.domain, color, initial: (name || '?').charAt(0).toUpperCase() };
}
