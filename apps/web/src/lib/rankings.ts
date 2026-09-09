import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { apiKeys, getHttpDb, usageEvents, workspaces } from '@llmgw/db/http';
import type {
  Mover,
  RankModel,
  RankNamed,
  RankProvider,
  RankingsData,
  ShareSeries,
  TaskLeader,
} from './rankings-types';

const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
const OTHER_COLOR = '#cbd5e1';

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

function trend(cur: number, prior: number): number | null {
  if (prior <= 0) return null;
  return ((cur - prior) / prior) * 100;
}

const empty: RankingsData = {
  days: 0,
  hasData: false,
  totals: { tokens: 0, spendUsd: 0, requests: 0, models: 0, providers: 0 },
  models: [],
  providers: [],
  byTask: [],
  apps: [],
  keys: [],
  gainers: [],
  decliners: [],
  share: { series: [], points: [] },
};

export async function getRankings(orgId: string, days: number): Promise<RankingsData> {
  if (!process.env.DATABASE_URL) return { ...empty, days };
  try {
    const db = getHttpDb();
    const now = Date.now();
    const since = new Date(now - days * 86_400_000);
    const priorSince = new Date(now - 2 * days * 86_400_000);
    const cur = and(eq(workspaces.orgId, orgId), gte(usageEvents.createdAt, since));
    const prior = and(
      eq(workspaces.orgId, orgId),
      gte(usageEvents.createdAt, priorSince),
      lt(usageEvents.createdAt, since),
    );
    const tokens = sql<number>`coalesce(sum(${usageEvents.totalTokens}),0)::bigint`;
    const spend = sql<number>`coalesce(sum(${usageEvents.costUsd}),0)::float8`;
    const reqs = sql<number>`count(*)::int`;

    const [curModels, priorModels, dayModelRows, curProviders, priorProviders, taskRows, appRows, keyRows] =
      await Promise.all([
        db
          .select({ model: usageEvents.modelSlug, provider: usageEvents.providerSlug, tokens, spend, requests: reqs })
          .from(usageEvents)
          .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
          .where(cur)
          .groupBy(usageEvents.modelSlug, usageEvents.providerSlug)
          .orderBy(sql`coalesce(sum(${usageEvents.totalTokens}),0) desc`),
        db
          .select({ model: usageEvents.modelSlug, tokens })
          .from(usageEvents)
          .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
          .where(prior)
          .groupBy(usageEvents.modelSlug),
        db
          .select({ date: dayExpr, model: usageEvents.modelSlug, tokens })
          .from(usageEvents)
          .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
          .where(cur)
          .groupBy(dayExpr, usageEvents.modelSlug),
        db
          .select({ provider: usageEvents.providerSlug, tokens, spend, requests: reqs })
          .from(usageEvents)
          .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
          .where(cur)
          .groupBy(usageEvents.providerSlug)
          .orderBy(sql`coalesce(sum(${usageEvents.totalTokens}),0) desc`),
        db
          .select({ provider: usageEvents.providerSlug, tokens })
          .from(usageEvents)
          .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
          .where(prior)
          .groupBy(usageEvents.providerSlug),
        db
          .select({ task: usageEvents.taskClass, model: usageEvents.modelSlug, requests: reqs })
          .from(usageEvents)
          .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
          .where(cur)
          .groupBy(usageEvents.taskClass, usageEvents.modelSlug),
        db
          .select({
            name: sql<string>`coalesce(${usageEvents.appName}, 'Direct / API')`,
            tokens,
            spend,
            requests: reqs,
          })
          .from(usageEvents)
          .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
          .where(cur)
          .groupBy(sql`coalesce(${usageEvents.appName}, 'Direct / API')`)
          .orderBy(sql`coalesce(sum(${usageEvents.totalTokens}),0) desc`)
          .limit(8),
        db
          .select({
            name: sql<string>`coalesce(${apiKeys.name}, 'Unknown key')`,
            tokens,
            spend,
            requests: reqs,
          })
          .from(usageEvents)
          .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
          .leftJoin(apiKeys, eq(usageEvents.apiKeyId, apiKeys.id))
          .where(cur)
          .groupBy(sql`coalesce(${apiKeys.name}, 'Unknown key')`)
          .orderBy(sql`coalesce(sum(${usageEvents.totalTokens}),0) desc`)
          .limit(8),
      ]);

    const totalTokens = curModels.reduce((a, m) => a + Number(m.tokens), 0);
    const totalSpend = curModels.reduce((a, m) => a + Number(m.spend), 0);
    const totalReqs = curModels.reduce((a, m) => a + Number(m.requests), 0);
    if (totalReqs === 0) return { ...empty, days };

    const priorByModel = new Map(priorModels.map((r) => [r.model, Number(r.tokens)]));
    const dates = lastNDays(Math.min(days, 90));

    // Per-model daily token map for sparklines + share series.
    const dayMap = new Map<string, Map<string, number>>(); // model -> (date -> tokens)
    for (const r of dayModelRows) {
      const m = dayMap.get(r.model) ?? new Map<string, number>();
      m.set(r.date, Number(r.tokens));
      dayMap.set(r.model, m);
    }

    const models: RankModel[] = curModels.map((m, i) => {
      const t = Number(m.tokens);
      const perDay = dayMap.get(m.model) ?? new Map();
      return {
        rank: i + 1,
        modelSlug: m.model,
        providerSlug: m.provider,
        tokens: t,
        spendUsd: Number(m.spend),
        requests: Number(m.requests),
        sharePct: totalTokens > 0 ? (t / totalTokens) * 100 : 0,
        trendPct: trend(t, priorByModel.get(m.model) ?? 0),
        spark: dates.map((d) => perDay.get(d) ?? 0),
        avgPricePerM: t > 0 ? Number(m.spend) / (t / 1_000_000) : 0,
      };
    });

    const priorProvByModel = new Map(priorProviders.map((r) => [r.provider, Number(r.tokens)]));
    const providers: RankProvider[] = curProviders.map((p) => {
      const t = Number(p.tokens);
      return {
        providerSlug: p.provider,
        tokens: t,
        spendUsd: Number(p.spend),
        requests: Number(p.requests),
        sharePct: totalTokens > 0 ? (t / totalTokens) * 100 : 0,
        trendPct: trend(t, priorProvByModel.get(p.provider) ?? 0),
      };
    });

    // Top model per task class.
    const taskBest = new Map<string, { model: string; requests: number; total: number }>();
    for (const r of taskRows) {
      if (!r.task) continue;
      const n = Number(r.requests);
      const cur2 = taskBest.get(r.task);
      const total = (cur2?.total ?? 0) + n;
      if (!cur2 || n > cur2.requests) taskBest.set(r.task, { model: r.model, requests: n, total });
      else taskBest.set(r.task, { ...cur2, total });
    }
    const byTask: TaskLeader[] = [...taskBest.entries()]
      .map(([taskClass, v]) => ({
        taskClass,
        modelSlug: v.model,
        requests: v.requests,
        sharePct: v.total > 0 ? (v.requests / v.total) * 100 : 0,
      }))
      .sort((a, b) => b.requests - a.requests);

    // Movers: models with a real prior baseline + meaningful volume.
    const movers: Mover[] = models
      .filter((m) => m.trendPct !== null && (m.tokens >= 500 || m.requests >= 3))
      .map((m) => ({ modelSlug: m.modelSlug, providerSlug: m.providerSlug, tokens: m.tokens, trendPct: m.trendPct as number }));
    const gainers = [...movers].filter((m) => m.trendPct > 0).sort((a, b) => b.trendPct - a.trendPct).slice(0, 5);
    const decliners = [...movers].filter((m) => m.trendPct < 0).sort((a, b) => a.trendPct - b.trendPct).slice(0, 5);

    // Share-over-time (top 6 models + Other).
    const topShare = models.slice(0, 6);
    const topSet = new Set(topShare.map((m) => m.modelSlug));
    const series: ShareSeries['series'] = topShare.map((m, i) => ({
      key: m.modelSlug,
      label: m.modelSlug,
      color: PALETTE[i % PALETTE.length]!,
    }));
    if (models.length > topShare.length) series.push({ key: '__other', label: 'Other', color: OTHER_COLOR });
    const points = dates.map((d) => {
      const row: Record<string, number> = {};
      let other = 0;
      for (const [model, perDay] of dayMap) {
        const v = perDay.get(d) ?? 0;
        if (topSet.has(model)) row[model] = v;
        else other += v;
      }
      if (series.some((s) => s.key === '__other')) row.__other = other;
      return row;
    });

    const apps: RankNamed[] = appRows.map((r) => ({
      name: r.name,
      tokens: Number(r.tokens),
      spendUsd: Number(r.spend),
      requests: Number(r.requests),
      sharePct: totalTokens > 0 ? (Number(r.tokens) / totalTokens) * 100 : 0,
    }));
    const keys: RankNamed[] = keyRows.map((r) => ({
      name: r.name,
      tokens: Number(r.tokens),
      spendUsd: Number(r.spend),
      requests: Number(r.requests),
      sharePct: totalTokens > 0 ? (Number(r.tokens) / totalTokens) * 100 : 0,
    }));

    return {
      days,
      hasData: true,
      totals: {
        tokens: totalTokens,
        spendUsd: totalSpend,
        requests: totalReqs,
        models: curModels.length,
        providers: curProviders.length,
      },
      models,
      providers,
      byTask,
      apps,
      keys,
      gainers,
      decliners,
      share: { series, points },
    };
  } catch (err) {
    console.error('[rankings] query failed:', (err as Error).message);
    return { ...empty, days };
  }
}
