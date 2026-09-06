import { and, eq, gte, sql } from 'drizzle-orm';
import { getHttpDb, usageEvents, workspaces } from '@llmgw/db/http';

export interface DailyPoint {
  date: string;
  spendUsd: number;
  requests: number;
  tokens: number;
}
export interface TopModel {
  modelSlug: string;
  spendUsd: number;
  requests: number;
}
export interface HeatPoint {
  date: string;
  count: number;
}
export interface ProfileStats {
  totalSpendUsd: number;
  totalRequests: number;
  longestStreakDays: number;
  avgPerDayUsd: number;
  avgPerWeekUsd: number;
}
export interface ProfileData {
  daily: DailyPoint[];
  topModels: TopModel[];
  heatmap: HeatPoint[];
  stats: ProfileStats;
}

const dayExpr = sql<string>`to_char(date_trunc('day', ${usageEvents.createdAt}), 'YYYY-MM-DD')`;

export async function getProfileData(orgId: string): Promise<ProfileData> {
  const db = getHttpDb();
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const since365 = new Date(Date.now() - 365 * 86_400_000);
  const orgFilter = eq(workspaces.orgId, orgId);

  const daily = await db
    .select({
      date: dayExpr,
      spendUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}),0)::float8`,
      requests: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}),0)::int`,
    })
    .from(usageEvents)
    .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
    .where(and(orgFilter, gte(usageEvents.createdAt, since30)))
    .groupBy(dayExpr)
    .orderBy(dayExpr);

  const topModels = await db
    .select({
      modelSlug: usageEvents.modelSlug,
      spendUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}),0)::float8`,
      requests: sql<number>`count(*)::int`,
    })
    .from(usageEvents)
    .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
    .where(and(orgFilter, gte(usageEvents.createdAt, since30)))
    .groupBy(usageEvents.modelSlug)
    .orderBy(sql`coalesce(sum(${usageEvents.costUsd}),0) desc`)
    .limit(5);

  const heat = await db
    .select({ date: dayExpr, count: sql<number>`count(*)::int` })
    .from(usageEvents)
    .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
    .where(and(orgFilter, gte(usageEvents.createdAt, since365)))
    .groupBy(dayExpr)
    .orderBy(dayExpr);

  const totals = await db
    .select({
      spendUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}),0)::float8`,
      requests: sql<number>`count(*)::int`,
    })
    .from(usageEvents)
    .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
    .where(orgFilter);

  const heatmap: HeatPoint[] = heat.map((h) => ({ date: h.date, count: Number(h.count) }));
  const stats = computeStats(
    heatmap,
    Number(totals[0]?.spendUsd ?? 0),
    Number(totals[0]?.requests ?? 0),
  );

  return {
    daily: daily.map((d) => ({
      date: d.date,
      spendUsd: Number(d.spendUsd),
      requests: Number(d.requests),
      tokens: Number(d.tokens),
    })),
    topModels: topModels.map((m) => ({
      modelSlug: m.modelSlug,
      spendUsd: Number(m.spendUsd),
      requests: Number(m.requests),
    })),
    heatmap,
    stats,
  };
}

function computeStats(
  heatmap: HeatPoint[],
  totalSpend: number,
  totalRequests: number,
): ProfileStats {
  const activeDays = heatmap.filter((h) => h.count > 0).map((h) => h.date).sort();
  let longest = 0;
  let current = 0;
  let prev: number | null = null;
  for (const d of activeDays) {
    const t = Math.floor(Date.parse(d + 'T00:00:00Z') / 86_400_000);
    current = prev !== null && t === prev + 1 ? current + 1 : 1;
    if (current > longest) longest = current;
    prev = t;
  }
  const n = activeDays.length || 1;
  const avgPerDay = totalSpend / n;
  return {
    totalSpendUsd: totalSpend,
    totalRequests,
    longestStreakDays: longest,
    avgPerDayUsd: avgPerDay,
    avgPerWeekUsd: avgPerDay * 7,
  };
}
