'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import {
  getHttpDb,
  workspaces,
  workspaceSettings,
  type RoutingConfig,
  type ToolsConfig,
} from '@llmgw/db/http';
import { getCurrentWorkspace } from './session';

async function upsert(
  workspaceId: string,
  patch: { routing?: RoutingConfig; tools?: ToolsConfig },
): Promise<void> {
  const db = getHttpDb();
  const existing = await db
    .select({ id: workspaceSettings.id })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1);
  if (existing.length) {
    await db
      .update(workspaceSettings)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(workspaceSettings.workspaceId, workspaceId));
  } else {
    await db.insert(workspaceSettings).values({
      workspaceId,
      routing: patch.routing ?? null,
      tools: patch.tools ?? null,
    });
  }
}

export async function saveRoutingConfig(routing: RoutingConfig): Promise<{ ok: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  await upsert(ctx.workspace.id, { routing });
  revalidatePath('/routing');
  return { ok: true };
}

export async function saveToolsConfig(tools: ToolsConfig): Promise<{ ok: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  await upsert(ctx.workspace.id, { tools });
  revalidatePath('/tools');
  return { ok: true };
}

export async function updateWorkspaceGeneral(
  name: string,
  description: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected.' };
  if (!name.trim()) return { ok: false, error: 'Workspace name is required.' };
  const db = getHttpDb();
  await db
    .update(workspaces)
    .set({ name: name.trim().slice(0, 120), description: description.trim() || null })
    .where(eq(workspaces.id, ctx.workspace.id));
  revalidatePath('/settings');
  return { ok: true };
}

const BUDGET_INTERVALS = new Set(['daily', 'weekly', 'monthly', 'lifetime']);

export async function updateWorkspaceBudget(input: {
  limitUsd: number | null;
  interval: string;
  includeByok: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected.' };
  if (input.limitUsd != null && (!Number.isFinite(input.limitUsd) || input.limitUsd < 0)) {
    return { ok: false, error: 'Budget limit must be a positive number.' };
  }
  const interval = BUDGET_INTERVALS.has(input.interval) ? input.interval : 'monthly';
  const db = getHttpDb();
  await db
    .update(workspaces)
    .set({
      budgetLimitUsd: input.limitUsd == null ? null : input.limitUsd.toFixed(10),
      budgetInterval: interval,
      includeByok: input.includeByok,
    })
    .where(eq(workspaces.id, ctx.workspace.id));
  revalidatePath('/settings');
  return { ok: true };
}
