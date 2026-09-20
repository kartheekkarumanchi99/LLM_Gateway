import { DEFAULT_DEDUP_CONFIG, normalizeDedupConfig, type DedupConfig } from '@llmgw/db';
import { getWorkspaceSettings } from './settings';

// Env fallback lets the cache be enabled globally without per-workspace config (back-compat
// with the old SEMANTIC_CACHE flag); a stored workspace config always wins.
function envDefault(): DedupConfig {
  if ((process.env.SEMANTIC_CACHE ?? '0') === '1') {
    return { ...DEFAULT_DEDUP_CONFIG, enabled: true };
  }
  return DEFAULT_DEDUP_CONFIG;
}

export async function getCacheConfig(workspaceId: string): Promise<DedupConfig> {
  const s = await getWorkspaceSettings(workspaceId);
  if (s.cache == null) return envDefault();
  return normalizeDedupConfig(s.cache);
}
