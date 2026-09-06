import { desc, eq } from 'drizzle-orm';
import {
  DEFAULT_OBSERVABILITY_CONFIG,
  getHttpDb,
  observabilityDestinations,
  workspaceSettings,
  type ObservabilityConfig,
} from '@llmgw/db/http';

export interface DestinationRow {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  baseUrl: string | null;
  headers: Record<string, string> | null;
  samplingRate: string;
  privacyMode: boolean;
  region: string;
  hasKey: boolean;
  createdAt: string;
}

export async function getObservability(
  workspaceId: string,
): Promise<{ config: ObservabilityConfig; destinations: DestinationRow[] }> {
  const db = getHttpDb();
  const s = await db
    .select({ observability: workspaceSettings.observability })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1);
  const config = {
    ...DEFAULT_OBSERVABILITY_CONFIG,
    ...((s[0]?.observability as Partial<ObservabilityConfig> | null) ?? {}),
  };
  const rows = await db
    .select()
    .from(observabilityDestinations)
    .where(eq(observabilityDestinations.workspaceId, workspaceId))
    .orderBy(desc(observabilityDestinations.createdAt));
  const destinations: DestinationRow[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    enabled: r.enabled,
    baseUrl: r.baseUrl,
    headers: (r.headers as Record<string, string> | null) ?? null,
    samplingRate: String(r.samplingRate),
    privacyMode: r.privacyMode,
    region: r.region,
    hasKey: Boolean(r.apiKeyEnc),
    createdAt: r.createdAt.toISOString(),
  }));
  return { config, destinations };
}
