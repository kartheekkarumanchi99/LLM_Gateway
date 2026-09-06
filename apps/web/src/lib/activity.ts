import { and, eq, gte, sql } from 'drizzle-orm';
import { apiKeys, getHttpDb, usageEvents, workspaces } from '@llmgw/db/http';

export interface ModelUsage {
  modelSlug: string;
  spendUsd: number;
  requests: number;
  tokens: number;
}
export interface NamedUsage {
  name: string;
  spendUsd: number;
  tokens: number;
}
export interface DailyUsage {
  date: string;
  spendUsd: number;
  byokUsd: number;
  platformUsd: number;
  requests: number;
  tokens: number;
}
export interface Trend {
  topName: string | null;
  series: { date: string; spendUsd: number }[];
  items: NamedUsage[];
}
export interface ActivityTotals {
  spendUsd: number;
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheHitRate: number;
  blendedPerM: number;
}
export interface ActivityData {
  totals: ActivityTotals;
  byModel: ModelUsage[];
  byKey: NamedUsage[];
  byApp: NamedUsage[];
  daily: DailyUsage[];
  trends: { models: Trend; keys: Trend; apps: Trend };
}

const dayExpr = sql<string>`to_char(date_trunc('day', ${usageEvents.createdAt}), 'YYYY-MM-DD')`;

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function buildTrend(rows: { date: string; name: string; spendUsd: number }[], days: number): Trend {
  const totalByName = new Map<string, number>();
  for (const r of rows) totalByName.set(r.name, (totalByName.get(r.name) ?? 0) + r.spendUsd);
  const items = [...totalByName.entries()]
    .map(([name, spendUsd]) => ({ name, spendUsd, tokens: 0 }))
    .sort((a, b) => b.spendUsd - a.spendUsd)
    .slice(0, 5);
  const topName = items[0]?.name ?? null;
  const dates = lastNDays(Math.min(days, 60));
  const byDate = new Map<string, number>();
  for (const r of rows) if (r.name === topName) byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.spendUsd);
  const series = dates.map((date) => ({ date, spendUsd: byDate.get(date) ?? 0 }));
  return { topName, series, items };
}

export async function getActivity(orgId: string, days: number): Promise<ActivityData> {
  const db = getHttpDb();
  const since = new Date(Date.now() - days * 86_400_000);
  const scope = and(eq(workspaces.orgId, orgId), gte(usageEvents.createdAt, since));

  const [totalsRows, byModelRows, byKeyRows, byAppRows, dailyRows, dayModelRows, dayKeyRows, dayAppRows] =
    await Promise.all([
      db
        .select({
          spendUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}),0)::float8`,
          requests: sql<number>`count(*)::int`,
          tokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}),0)::int`,
          promptTokens: sql<number>`coalesce(sum(${usageEvents.promptTokens}),0)::int`,
          completionTokens: sql<number>`coalesce(sum(${usageEvents.completionTokens}),0)::int`,
          reasoningTokens: sql<number>`coalesce(sum(${usageEvents.reasoningTokens}),0)::int`,
          cachedTokens: sql<number>`coalesce(sum(${usageEvents.cachedTokens}),0)::int`,
        })
        .from(usageEvents)
        .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
        .where(scope),
      db
        .select({
          modelSlug: usageEvents.modelSlug,
          spendUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}),0)::float8`,
          requests: sql<number>`count(*)::int`,
          tokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}),0)::int`,
        })
        .from(usageEvents)
        .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
        .where(scope)
        .groupBy(usageEvents.modelSlug)
        .orderBy(sql`coalesce(sum(${usageEvents.costUsd}),0) desc`)
        .limit(8),
      db
        .select({
          name: sql<string>`coalesce(${apiKeys.name}, 'Unknown key')`,
          spendUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}),0)::float8`,
          tokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}),0)::int`,
        })
        .from(usageEvents)
        .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
        .leftJoin(apiKeys, eq(usageEvents.apiKeyId, apiKeys.id))
        .where(scope)
        .groupBy(sql`coalesce(${apiKeys.name}, 'Unknown key')`)
        .orderBy(sql`coalesce(sum(${usageEvents.totalTokens}),0) desc`)
        .limit(8),
      db
        .select({
          name: sql<string>`coalesce(${usageEvents.appName}, 'Direct / API')`,
          spendUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}),0)::float8`,
          tokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}),0)::int`,
        })
        .from(usageEvents)
        .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
        .where(scope)
        .groupBy(sql`coalesce(${usageEvents.appName}, 'Direct / API')`)
        .orderBy(sql`coalesce(sum(${usageEvents.totalTokens}),0) desc`)
        .limit(8),
      db
        .select({
          date: dayExpr,
          spendUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}),0)::float8`,
          byokUsd: sql<number>`coalesce(sum(case when ${usageEvents.byok} then ${usageEvents.costUsd} else 0 end),0)::float8`,
          platformUsd: sql<number>`coalesce(sum(case when ${usageEvents.byok} then 0 else ${usageEvents.costUsd} end),0)::float8`,
          requests: sql<number>`count(*)::int`,
          tokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}),0)::int`,
        })
        .from(usageEvents)
        .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
        .where(scope)
        .groupBy(dayExpr)
        .orderBy(dayExpr),
      db
        .select({
          date: dayExpr,
          name: usageEvents.modelSlug,
          spendUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}),0)::float8`,
        })
        .from(usageEvents)
        .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
        .where(scope)
        .groupBy(dayExpr, usageEvents.modelSlug),
      db
        .select({
          date: dayExpr,
          name: sql<string>`coalesce(${apiKeys.name}, 'Unknown key')`,
          spendUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}),0)::float8`,
        })
        .from(usageEvents)
        .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
        .leftJoin(apiKeys, eq(usageEvents.apiKeyId, apiKeys.id))
        .where(scope)
        .groupBy(dayExpr, sql`coalesce(${apiKeys.name}, 'Unknown key')`),
      db
        .select({
          date: dayExpr,
          name: sql<string>`coalesce(${usageEvents.appName}, 'Direct / API')`,
          spendUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}),0)::float8`,
        })
        .from(usageEvents)
        .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
        .where(scope)
        .groupBy(dayExpr, sql`coalesce(${usageEvents.appName}, 'Direct / API')`),
    ]);

  const t = totalsRows[0];
  const spendUsd = Number(t?.spendUsd ?? 0);
  const tokens = Number(t?.tokens ?? 0);
  const promptTokens = Number(t?.promptTokens ?? 0);
  const cachedTokens = Number(t?.cachedTokens ?? 0);
  const totals: ActivityTotals = {
    spendUsd,
    requests: Number(t?.requests ?? 0),
    tokens,
    promptTokens,
    completionTokens: Number(t?.completionTokens ?? 0),
    reasoningTokens: Number(t?.reasoningTokens ?? 0),
    cachedTokens,
    cacheHitRate: promptTokens > 0 ? cachedTokens / promptTokens : 0,
    blendedPerM: tokens > 0 ? spendUsd / (tokens / 1_000_000) : 0,
  };

  return {
    totals,
    byModel: byModelRows.map((r) => ({
      modelSlug: r.modelSlug,
      spendUsd: Number(r.spendUsd),
      requests: Number(r.requests),
      tokens: Number(r.tokens),
    })),
    byKey: byKeyRows.map((r) => ({ name: r.name, spendUsd: Number(r.spendUsd), tokens: Number(r.tokens) })),
    byApp: byAppRows.map((r) => ({ name: r.name, spendUsd: Number(r.spendUsd), tokens: Number(r.tokens) })),
    daily: dailyRows.map((r) => ({
      date: r.date,
      spendUsd: Number(r.spendUsd),
      byokUsd: Number(r.byokUsd),
      platformUsd: Number(r.platformUsd),
      requests: Number(r.requests),
      tokens: Number(r.tokens),
    })),
    trends: {
      models: buildTrend(dayModelRows.map((r) => ({ date: r.date, name: r.name, spendUsd: Number(r.spendUsd) })), days),
      keys: buildTrend(dayKeyRows.map((r) => ({ date: r.date, name: r.name, spendUsd: Number(r.spendUsd) })), days),
      apps: buildTrend(dayAppRows.map((r) => ({ date: r.date, name: r.name, spendUsd: Number(r.spendUsd) })), days),
    },
  };
}
