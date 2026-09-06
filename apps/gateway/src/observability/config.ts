import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_OBSERVABILITY_CONFIG,
  getDb,
  observabilityDestinations,
  workspaceSettings,
  type ObservabilityConfig,
} from '@llmgw/db';

export async function getObservabilityConfig(workspaceId: string): Promise<ObservabilityConfig> {
  const db = getDb();
  const rows = await db
    .select({ observability: workspaceSettings.observability })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1);
  const o = (rows[0]?.observability as Partial<ObservabilityConfig> | null) ?? {};
  return { ...DEFAULT_OBSERVABILITY_CONFIG, ...o };
}

export interface DestinationRecord {
  id: string;
  type: string;
  name: string;
  baseUrl: string | null;
  headers: Record<string, string> | null;
  apiKeyEnc: string | null;
  samplingRate: string;
  privacyMode: boolean;
}

export async function getEnabledDestinations(workspaceId: string): Promise<DestinationRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(observabilityDestinations)
    .where(
      and(
        eq(observabilityDestinations.workspaceId, workspaceId),
        eq(observabilityDestinations.enabled, true),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    baseUrl: r.baseUrl,
    headers: (r.headers as Record<string, string> | null) ?? null,
    apiKeyEnc: r.apiKeyEnc,
    samplingRate: String(r.samplingRate),
    privacyMode: r.privacyMode,
  }));
}
