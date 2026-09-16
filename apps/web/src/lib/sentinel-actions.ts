'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getHttpDb, normalizeSentinelConfig, workspaceSettings, type SentinelConfig } from '@llmgw/db/http';
import { ensurePlaygroundKey, GATEWAY_URL } from './playground';
import { getCurrentWorkspace } from './session';

async function upsertSentinel(workspaceId: string, sentinel: SentinelConfig): Promise<void> {
  const db = getHttpDb();
  const existing = await db
    .select({ id: workspaceSettings.id })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1);
  if (existing.length) {
    await db
      .update(workspaceSettings)
      .set({ sentinel, updatedAt: new Date() })
      .where(eq(workspaceSettings.workspaceId, workspaceId));
  } else {
    await db.insert(workspaceSettings).values({ workspaceId, sentinel });
  }
}

export async function saveSentinelConfig(
  input: Partial<SentinelConfig>,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected.' };
  await upsertSentinel(ctx.workspace.id, normalizeSentinelConfig(input));
  revalidatePath('/sentinel');
  return { ok: true };
}

// Manually process the pending shadow queue now (instead of waiting for the interval).
export async function triggerSentinelRun(): Promise<{ ok: boolean; processed?: number; error?: string }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected.' };
  try {
    const key = await ensurePlaygroundKey(ctx.workspace.id);
    const res = await fetch(`${GATEWAY_URL}/v1/sentinel/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, error: `Gateway returned ${res.status}` };
    const json = (await res.json()) as { processed?: number };
    revalidatePath('/sentinel');
    return { ok: true, processed: json.processed ?? 0 };
  } catch (err) {
    return { ok: false, error: `Could not reach the gateway. ${(err as Error).message}` };
  }
}
