import { and, eq, gte, sql } from 'drizzle-orm';
import { getHttpDb, usageEvents } from '@llmgw/db/http';

export interface ModelUsage {
  modelSlug: string;
  spendUsd: number;
  requests: number;
  tokens: number;
}

export interface UsageSummary {
  spendUsd: number;
  requests: number;
  tokens: number;
  byModel: ModelUsage[];
}

function startOfWeekUtc(): Date {
  const d = new Date();
  const dow = d.getUTCDay(); // 0=Sun
  const sinceMonday = (dow + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday));
}

export async function getWeeklyUsage(workspaceId: string): Promise<UsageSummary> {
  const db = getHttpDb();
  const rows = await db
    .select({
      modelSlug: usageEvents.modelSlug,
      spendUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)::float8`,
      requests: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}), 0)::int`,
    })
    .from(usageEvents)
    .where(
      and(eq(usageEvents.workspaceId, workspaceId), gte(usageEvents.createdAt, startOfWeekUtc())),
    )
    .groupBy(usageEvents.modelSlug);

  const byModel: ModelUsage[] = rows
    .map((r) => ({
      modelSlug: r.modelSlug,
      spendUsd: Number(r.spendUsd),
      requests: Number(r.requests),
      tokens: Number(r.tokens),
    }))
    .sort((a, b) => b.spendUsd - a.spendUsd || b.requests - a.requests);

  return {
    spendUsd: byModel.reduce((s, m) => s + m.spendUsd, 0),
    requests: byModel.reduce((s, m) => s + m.requests, 0),
    tokens: byModel.reduce((s, m) => s + m.tokens, 0),
    byModel,
  };
}
