import { DEFAULT_SENTINEL_CONFIG, normalizeSentinelConfig, type SentinelConfig } from '@llmgw/db';
import { getWorkspaceSettings } from '../cache/settings';

export async function getSentinelConfig(workspaceId: string): Promise<SentinelConfig> {
  const s = await getWorkspaceSettings(workspaceId);
  if (s.sentinel == null) return DEFAULT_SENTINEL_CONFIG;
  return normalizeSentinelConfig(s.sentinel);
}
