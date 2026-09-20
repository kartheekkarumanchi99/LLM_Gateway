// Shared types + defaults for Multi-Tenant Financial Arbitrage & BYOK rate-limit balancing
// (gateway + web). No runtime imports so it is safe from client components.

export interface ArbitrageSettings {
  enabled: boolean;
  // Lend this org's under-utilized BYOK throughput to the pool.
  contribute: boolean;
  // Borrow other orgs' spare capacity when this org is throttled.
  consume: boolean;
  // Markup a lender earns over raw provider cost when serving a borrower.
  marginPct: number;
  // Ceiling on tokens/min this org will lend (protects its own headroom).
  maxShareTpm: number;
}

export const DEFAULT_ARBITRAGE_SETTINGS: ArbitrageSettings = {
  enabled: false,
  contribute: false,
  consume: false,
  marginPct: 10,
  maxShareTpm: 100_000,
};

export function normalizeArbitrageSettings(raw: unknown): ArbitrageSettings {
  const r = (raw ?? {}) as Partial<ArbitrageSettings>;
  const clamp = (v: unknown, lo: number, hi: number, dflt: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : false,
    contribute: typeof r.contribute === 'boolean' ? r.contribute : false,
    consume: typeof r.consume === 'boolean' ? r.consume : false,
    marginPct: clamp(r.marginPct, 0, 100, 10),
    maxShareTpm: Math.round(clamp(r.maxShareTpm, 0, 100_000_000, 100_000)),
  };
}

export interface ByokLimit {
  provider: string;
  tpmLimit: number;
  rpmLimit: number;
  shareable: boolean;
  tier: string | null;
}

// Published reference spot rates (USD per 1M tokens) for open-weights inference pools. Used
// by the spot board as a comparison baseline; routing to them requires a configured key.
export interface SpotProvider {
  slug: string;
  name: string;
  promptPerM: number;
  completionPerM: number;
  note: string;
}

export const SPOT_REFERENCE: SpotProvider[] = [
  { slug: 'deepinfra', name: 'DeepInfra', promptPerM: 0.04, completionPerM: 0.06, note: 'Cheapest open-weights pool' },
  { slug: 'groq', name: 'Groq', promptPerM: 0.05, completionPerM: 0.08, note: 'LPU — ultra-low latency' },
  { slug: 'together', name: 'Together AI', promptPerM: 0.06, completionPerM: 0.06, note: 'Broad open-weights catalog' },
  { slug: 'fireworks', name: 'Fireworks AI', promptPerM: 0.07, completionPerM: 0.07, note: 'Fast serverless open-weights' },
];

export const RATE_WINDOW_MS = 60_000; // rolling TPM/RPM window
export const THROTTLE_COOLDOWN_MS = 30_000; // how long a 429 marks a tenant throttled
