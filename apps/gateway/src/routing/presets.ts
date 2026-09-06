import { and, eq } from 'drizzle-orm';
import { getDb, presets, type PresetConfig } from '@llmgw/db';

export interface ResolvedPreset {
  systemPrompt: string | null;
  config: PresetConfig | null;
}

export async function resolvePreset(workspaceId: string, slug: string): Promise<ResolvedPreset | null> {
  const db = getDb();
  const rows = await db
    .select({ systemPrompt: presets.systemPrompt, config: presets.config })
    .from(presets)
    .where(and(eq(presets.workspaceId, workspaceId), eq(presets.slug, slug)))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return { systemPrompt: r.systemPrompt, config: (r.config as PresetConfig | null) ?? null };
}
