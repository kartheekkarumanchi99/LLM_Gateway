import { and, eq, gte, sql } from 'drizzle-orm';
import { creditLedger, getDb, notifications, notificationSettings } from '@llmgw/db';

// Evaluates the workspace's low-balance rule after a billable request and,
// when tripped, records a de-duplicated notification. Fire-and-forget.
export async function maybeLowBalanceAlert(orgId: string, workspaceId: string): Promise<void> {
  try {
    const db = getDb();
    const settings = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.workspaceId, workspaceId))
      .limit(1);
    const s = settings[0];
    if (!s || !s.lowBalanceEnabled) return;

    const threshold = Number(s.lowBalanceThresholdUsd);
    const bal = await db
      .select({ total: sql<string>`coalesce(sum(${creditLedger.amountUsd}),0)` })
      .from(creditLedger)
      .where(eq(creditLedger.orgId, orgId));
    const balance = Number(bal[0]?.total ?? 0);
    if (balance >= threshold) return;

    // De-dupe: at most one unread low-balance alert per 24h.
    const since = new Date(Date.now() - 86_400_000);
    const existing = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.orgId, orgId),
          eq(notifications.type, 'low_balance'),
          eq(notifications.read, false),
          gte(notifications.createdAt, since),
        ),
      )
      .limit(1);
    if (existing[0]) return;

    await db.insert(notifications).values({
      orgId,
      workspaceId,
      type: 'low_balance',
      title: 'Low balance alert',
      body: `Your credit balance ($${balance.toFixed(2)}) is below your $${threshold.toFixed(2)} threshold.`,
    });
  } catch (e) {
    console.error('[alerts] low balance check failed:', (e as Error).message);
  }
}
