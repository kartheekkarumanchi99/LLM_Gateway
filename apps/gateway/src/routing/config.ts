import { eq } from 'drizzle-orm';
import {
  DEFAULT_PREDICTIVE_CONFIG,
  DEFAULT_ROUTING_CONFIG,
  DEFAULT_TOOLS_CONFIG,
  getDb,
  workspaceSettings,
  type PredictiveConfig,
  type RoutingConfig,
  type ToolsConfig,
} from '@llmgw/db';

export async function getRoutingConfig(workspaceId: string): Promise<RoutingConfig> {
  const db = getDb();
  const rows = await db
    .select({ routing: workspaceSettings.routing })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1);
  const r = (rows[0]?.routing as Partial<RoutingConfig> | null) ?? {};
  return { ...DEFAULT_ROUTING_CONFIG, ...r };
}

export async function getToolsConfig(workspaceId: string): Promise<ToolsConfig> {
  const db = getDb();
  const rows = await db
    .select({ tools: workspaceSettings.tools })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1);
  const t = (rows[0]?.tools as Partial<ToolsConfig> | null) ?? {};
  return { ...DEFAULT_TOOLS_CONFIG, ...t };
}

export async function getPredictiveConfig(workspaceId: string): Promise<PredictiveConfig> {
  const db = getDb();
  const rows = await db
    .select({ predictive: workspaceSettings.predictive })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1);
  const p = (rows[0]?.predictive as Partial<PredictiveConfig> | null) ?? {};
  return { ...DEFAULT_PREDICTIVE_CONFIG, ...p };
}
