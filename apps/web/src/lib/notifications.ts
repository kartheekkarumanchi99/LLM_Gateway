import { desc, eq } from 'drizzle-orm';
import { getHttpDb, notifications, notificationSettings } from '@llmgw/db/http';

export interface NotifSettings {
  lowBalanceEnabled: boolean;
  lowBalanceThresholdUsd: string;
  notifyEmail: string | null;
  modelDeprecationEnabled: boolean;
  modelPriceDropEnabled: boolean;
}
export interface NotifItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

export const DEFAULT_NOTIF_SETTINGS: NotifSettings = {
  lowBalanceEnabled: false,
  lowBalanceThresholdUsd: '100',
  notifyEmail: null,
  modelDeprecationEnabled: false,
  modelPriceDropEnabled: false,
};

export async function getNotificationSettings(workspaceId: string): Promise<NotifSettings> {
  const db = getHttpDb();
  const rows = await db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.workspaceId, workspaceId))
    .limit(1);
  const r = rows[0];
  if (!r) return DEFAULT_NOTIF_SETTINGS;
  return {
    lowBalanceEnabled: r.lowBalanceEnabled,
    lowBalanceThresholdUsd: String(r.lowBalanceThresholdUsd),
    notifyEmail: r.notifyEmail,
    modelDeprecationEnabled: r.modelDeprecationEnabled,
    modelPriceDropEnabled: r.modelPriceDropEnabled,
  };
}

export async function listNotifications(orgId: string, limit = 20): Promise<NotifItem[]> {
  const db = getHttpDb();
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.orgId, orgId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    read: r.read,
    createdAt: r.createdAt.toISOString(),
  }));
}
