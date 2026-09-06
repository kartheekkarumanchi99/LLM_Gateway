'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getHttpDb, notifications, notificationSettings } from '@llmgw/db/http';
import { getCurrentUser, getCurrentWorkspace } from './session';
import type { NotifSettings } from './notifications';

export async function saveNotificationSettings(
  patch: Partial<NotifSettings>,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected.' };

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.lowBalanceEnabled !== undefined) set.lowBalanceEnabled = patch.lowBalanceEnabled;
  if (patch.modelDeprecationEnabled !== undefined) set.modelDeprecationEnabled = patch.modelDeprecationEnabled;
  if (patch.modelPriceDropEnabled !== undefined) set.modelPriceDropEnabled = patch.modelPriceDropEnabled;
  if (patch.notifyEmail !== undefined) set.notifyEmail = patch.notifyEmail?.trim() || null;
  if (patch.lowBalanceThresholdUsd !== undefined) {
    const n = Number(patch.lowBalanceThresholdUsd);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'Threshold must be a positive number.' };
    set.lowBalanceThresholdUsd = n.toFixed(2);
  }

  const db = getHttpDb();
  const existing = await db
    .select({ id: notificationSettings.id })
    .from(notificationSettings)
    .where(eq(notificationSettings.workspaceId, ctx.workspace.id))
    .limit(1);
  if (existing.length) {
    await db.update(notificationSettings).set(set).where(eq(notificationSettings.workspaceId, ctx.workspace.id));
  } else {
    await db.insert(notificationSettings).values({ workspaceId: ctx.workspace.id, ...set });
  }
  revalidatePath('/notifications');
  return { ok: true };
}

export async function markNotificationsRead(): Promise<{ ok: boolean }> {
  const ctx = await getCurrentUser();
  if (!ctx) return { ok: false };
  const db = getHttpDb();
  await db.update(notifications).set({ read: true }).where(eq(notifications.orgId, ctx.org.id));
  revalidatePath('/notifications');
  return { ok: true };
}
