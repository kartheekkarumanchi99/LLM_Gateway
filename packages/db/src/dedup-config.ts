// Shared types + defaults for the Cross-Workspace Semantic Prompt-Dedup Cache (gateway +
// web). No runtime imports so it is safe from client components.
//
// Two layers: (1) exact SHA-256 prompt match, always on and free; (2) semantic pgvector
// HNSW ANN match, opt-in. Within an org a workspace may CONTRIBUTE its completions to a
// shared pool and/or CONSUME cross-workspace hits — both opt-in for privacy. A hit returns
// a stored completion at ~zero upstream cost.

export interface DedupConfig {
  // Layer 2 (semantic vector) matching. Exact-match is always on regardless.
  enabled: boolean;
  // Accept hits produced by OTHER workspaces in the same org.
  crossWorkspace: boolean;
  // Contribute this workspace's completions to the org-shared pool.
  contribute: boolean;
  // Minimum cosine similarity for a semantic hit (0..1).
  similarityThreshold: number;
  // Freshness window — only reuse completions newer than this.
  ttlHours: number;
  // Don't cache trivially short prompts (chars in the last user message).
  minChars: number;
}

export const DEFAULT_DEDUP_CONFIG: DedupConfig = {
  enabled: false,
  crossWorkspace: false,
  contribute: false,
  similarityThreshold: 0.96,
  ttlHours: 24,
  minChars: 24,
};

export function normalizeDedupConfig(raw: unknown): DedupConfig {
  const r = (raw ?? {}) as Partial<DedupConfig>;
  const clamp = (v: unknown, lo: number, hi: number, dflt: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_DEDUP_CONFIG.enabled,
    crossWorkspace: typeof r.crossWorkspace === 'boolean' ? r.crossWorkspace : DEFAULT_DEDUP_CONFIG.crossWorkspace,
    contribute: typeof r.contribute === 'boolean' ? r.contribute : DEFAULT_DEDUP_CONFIG.contribute,
    similarityThreshold: clamp(r.similarityThreshold, 0.5, 0.999, DEFAULT_DEDUP_CONFIG.similarityThreshold),
    ttlHours: Math.round(clamp(r.ttlHours, 1, 24 * 30, DEFAULT_DEDUP_CONFIG.ttlHours)),
    minChars: Math.round(clamp(r.minChars, 0, 4000, DEFAULT_DEDUP_CONFIG.minChars)),
  };
}

export const EMBED_DIMENSIONS = 1536; // text-embedding-3-small
