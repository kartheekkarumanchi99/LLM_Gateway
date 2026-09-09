import {
  DEFAULT_PREDICTIVE_CONFIG,
  DEFAULT_ROUTING_CONFIG,
  DEFAULT_TOOLS_CONFIG,
  type PredictiveConfig,
  type RoutingConfig,
  type ToolsConfig,
} from '@llmgw/db';
import { getWorkspaceSettings } from '../cache/settings';

export async function getRoutingConfig(workspaceId: string): Promise<RoutingConfig> {
  const s = await getWorkspaceSettings(workspaceId);
  const r = (s.routing as Partial<RoutingConfig> | null) ?? {};
  return { ...DEFAULT_ROUTING_CONFIG, ...r };
}

export async function getToolsConfig(workspaceId: string): Promise<ToolsConfig> {
  const s = await getWorkspaceSettings(workspaceId);
  const t = (s.tools as Partial<ToolsConfig> | null) ?? {};
  return { ...DEFAULT_TOOLS_CONFIG, ...t };
}

export async function getPredictiveConfig(workspaceId: string): Promise<PredictiveConfig> {
  const s = await getWorkspaceSettings(workspaceId);
  const p = (s.predictive as Partial<PredictiveConfig> | null) ?? {};
  return { ...DEFAULT_PREDICTIVE_CONFIG, ...p };
}
