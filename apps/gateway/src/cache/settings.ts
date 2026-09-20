import { eq } from 'drizzle-orm';
import { getDb, workspaceSettings } from '@llmgw/db';
import { createTtlCache } from './memo';

export interface WorkspaceSettingsRow {
  routing: unknown;
  tools: unknown;
  observability: unknown;
  predictive: unknown;
  sentinel: unknown;
  cache: unknown;
}

const EMPTY: WorkspaceSettingsRow = { routing: null, tools: null, observability: null, predictive: null, sentinel: null, cache: null };

// One cached read of the workspace_settings row (all jsonb config columns), shared by
// the routing/tools/observability/predictive getters — replacing four separate reads
// of the same row on every request.
const cache = createTtlCache<string, WorkspaceSettingsRow>(
  async (workspaceId) => {
    const rows = await getDb()
      .select({
        routing: workspaceSettings.routing,
        tools: workspaceSettings.tools,
        observability: workspaceSettings.observability,
        predictive: workspaceSettings.predictive,
        sentinel: workspaceSettings.sentinel,
        cache: workspaceSettings.cache,
      })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, workspaceId))
      .limit(1);
    return rows[0] ?? EMPTY;
  },
  { ttlMs: 15_000, maxEntries: 5_000 },
);

export function getWorkspaceSettings(workspaceId: string): Promise<WorkspaceSettingsRow> {
  return cache.get(workspaceId);
}

export function invalidateWorkspaceSettings(workspaceId?: string): void {
  cache.invalidate(workspaceId);
}
