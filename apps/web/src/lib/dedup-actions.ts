'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getHttpDb, normalizeDedupConfig, workspaceSettings, type DedupConfig } from '@llmgw/db/http';
import { getCurrentWorkspace } from './session';

async function upsertCache(workspaceId: string, cache: DedupConfig): Promise<void> {
  const db = getHttpDb();
  const existing = await db
    .select({ id: workspaceSettings.id })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1);
  if (existing.length) {
    await db
      .update(workspaceSettings)
      .set({ cache, updatedAt: new Date() })
      .where(eq(workspaceSettings.workspaceId, workspaceId));
  } else {
    await db.insert(workspaceSettings).values({ workspaceId, cache });
  }
}

export async function saveDedupConfig(input: Partial<DedupConfig>): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected.' };
  await upsertCache(ctx.workspace.id, normalizeDedupConfig(input));
  revalidatePath('/cache');
  return { ok: true };
}
