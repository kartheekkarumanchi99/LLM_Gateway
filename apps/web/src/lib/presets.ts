import { and, desc, eq } from 'drizzle-orm';
import { getHttpDb, presets, type PresetConfig } from '@llmgw/db/http';

export interface PresetRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  systemPrompt: string | null;
  config: PresetConfig | null;
  createdAt: string;
}

export async function listPresets(workspaceId: string): Promise<PresetRow[]> {
  const db = getHttpDb();
  const rows = await db
    .select()
    .from(presets)
    .where(eq(presets.workspaceId, workspaceId))
    .orderBy(desc(presets.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    systemPrompt: r.systemPrompt,
    config: (r.config as PresetConfig | null) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getPresetById(id: string, workspaceId: string): Promise<PresetRow | null> {
  const db = getHttpDb();
  const rows = await db
    .select()
    .from(presets)
    .where(and(eq(presets.id, id), eq(presets.workspaceId, workspaceId)))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    systemPrompt: r.systemPrompt,
    config: (r.config as PresetConfig | null) ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
