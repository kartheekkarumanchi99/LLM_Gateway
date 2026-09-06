import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb, usageEvents, workspaces } from '@llmgw/db';

function intervalStart(interval: string | null): Date {
  const now = Date.now();
  const day = 86_400_000;
  switch (interval) {
    case 'day':
    case 'daily':
      return new Date(now - day);
    case 'week':
    case 'weekly':
      return new Date(now - 7 * day);
    case 'month':
    case 'monthly':
      return new Date(now - 30 * day);
    default:
      return new Date(0);
  }
}

// Total USD spent by a key within its limit window ('total' | 'day' | 'week' | 'month').
export async function keyUsageUsd(apiKeyId: string, interval: string | null): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)` })
    .from(usageEvents)
    .where(
      and(eq(usageEvents.apiKeyId, apiKeyId), gte(usageEvents.createdAt, intervalStart(interval))),
    );
  return Number(rows[0]?.total ?? 0);
}

export interface WorkspaceBudget {
  limitUsd: number | null;
  interval: string;
  includeByok: boolean;
}

// Reads the workspace-wide spend cap. Returns null if the workspace is missing.
export async function getWorkspaceBudget(workspaceId: string): Promise<WorkspaceBudget | null> {
  const db = getDb();
  const rows = await db
    .select({
      limitUsd: workspaces.budgetLimitUsd,
      interval: workspaces.budgetInterval,
      includeByok: workspaces.includeByok,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    limitUsd: r.limitUsd == null ? null : Number(r.limitUsd),
    interval: r.interval,
    includeByok: r.includeByok,
  };
}

// Total USD spent across the whole workspace within its budget window. When
// includeByok is false, BYOK-attributed spend is excluded from the total.
export async function workspaceUsageUsd(
  workspaceId: string,
  interval: string,
  includeByok: boolean,
): Promise<number> {
  const db = getDb();
  const filters = [
    eq(usageEvents.workspaceId, workspaceId),
    gte(usageEvents.createdAt, intervalStart(interval)),
  ];
  if (!includeByok) filters.push(eq(usageEvents.byok, false));
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)` })
    .from(usageEvents)
    .where(and(...filters));
  return Number(rows[0]?.total ?? 0);
}
