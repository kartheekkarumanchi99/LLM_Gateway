import { eq } from 'drizzle-orm';
import {
  DEFAULT_ROUTING_CONFIG,
  DEFAULT_TOOLS_CONFIG,
  getHttpDb,
  workspaceSettings,
  type RoutingConfig,
  type ToolsConfig,
} from '@llmgw/db/http';

export async function getWorkspaceSettings(
  workspaceId: string,
): Promise<{ routing: RoutingConfig; tools: ToolsConfig }> {
  const db = getHttpDb();
  const rows = await db
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1);
  const row = rows[0];
  return {
    routing: { ...DEFAULT_ROUTING_CONFIG, ...((row?.routing as Partial<RoutingConfig> | null) ?? {}) },
    tools: { ...DEFAULT_TOOLS_CONFIG, ...((row?.tools as Partial<ToolsConfig> | null) ?? {}) },
  };
}
