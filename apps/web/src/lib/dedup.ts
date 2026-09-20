import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  cacheHits,
  getHttpDb,
  normalizeDedupConfig,
  responseCache,
  usageEvents,
  workspaces,
  workspaceSettings,
  type DedupConfig,
} from '@llmgw/db/http';

export interface CacheSummary {
  hits: number;
  exactHits: number;
  semanticHits: number;
  crossWorkspaceHits: number;
  savedUsd: number;
  avgSimilarity: number;
  entries: number;
  sharedEntries: number;
  hitRatePct: number;
}

export interface CacheDailyRow {
  day: string;
  hits: number;
  savedUsd: number;
}

export interface CacheHitRow {
  id: string;
  kind: string;
  similarity: number;
  crossWorkspace: boolean;
  model: string;
  savedUsd: number;
  createdAt: string;
}

export interface CacheData {
  config: DedupConfig;
  summary: CacheSummary;
  daily: CacheDailyRow[];
  recent: CacheHitRow[];
  topModels: { model: string; hits: number; savedUsd: number }[];
}

export async function getCacheConfig(workspaceId: string): Promise<DedupConfig> {
  const rows = await getHttpDb()
    .select({ cache: workspaceSettings.cache })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1);
  return normalizeDedupConfig(rows[0]?.cache ?? null);
}

export async function getCacheData(orgId: string, workspaceId: string, days = 30): Promise<CacheData> {
  const db = getHttpDb();
  const since = new Date(Date.now() - days * 86_400_000);

  const [config, summaryRaw, entriesRaw, totalReqRaw, dailyRaw, recentRaw, topRaw] = await Promise.all([
    getCacheConfig(workspaceId),
    db
      .select({
        hits: sql<number>`count(*)::int`,
        exactHits: sql<number>`count(*) filter (where ${cacheHits.kind} = 'exact')::int`,
        semanticHits: sql<number>`count(*) filter (where ${cacheHits.kind} = 'semantic')::int`,
        crossHits: sql<number>`count(*) filter (where ${cacheHits.crossWorkspace})::int`,
        savedUsd: sql<number>`coalesce(sum(${cacheHits.savedUsd}),0)::float8`,
        avgSim: sql<number>`coalesce(avg(${cacheHits.similarity}),0)::float8`,
      })
      .from(cacheHits)
      .where(and(eq(cacheHits.orgId, orgId), gte(cacheHits.createdAt, since))),
    db
      .select({
        entries: sql<number>`count(*)::int`,
        shared: sql<number>`count(*) filter (where ${responseCache.shared})::int`,
      })
      .from(responseCache)
      .where(eq(responseCache.orgId, orgId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(usageEvents)
      .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
      .where(and(eq(workspaces.orgId, orgId), gte(usageEvents.createdAt, since), eq(usageEvents.status, 'success'))),
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${cacheHits.createdAt}), 'YYYY-MM-DD')`,
        hits: sql<number>`count(*)::int`,
        savedUsd: sql<number>`coalesce(sum(${cacheHits.savedUsd}),0)::float8`,
      })
      .from(cacheHits)
      .where(and(eq(cacheHits.orgId, orgId), gte(cacheHits.createdAt, since)))
      .groupBy(sql`date_trunc('day', ${cacheHits.createdAt})`)
      .orderBy(sql`date_trunc('day', ${cacheHits.createdAt})`),
    db
      .select({
        id: cacheHits.id,
        kind: cacheHits.kind,
        similarity: cacheHits.similarity,
        crossWorkspace: cacheHits.crossWorkspace,
        model: cacheHits.model,
        savedUsd: cacheHits.savedUsd,
        createdAt: cacheHits.createdAt,
      })
      .from(cacheHits)
      .where(eq(cacheHits.orgId, orgId))
      .orderBy(desc(cacheHits.createdAt))
      .limit(25),
    db
      .select({
        model: cacheHits.model,
        hits: sql<number>`count(*)::int`,
        savedUsd: sql<number>`coalesce(sum(${cacheHits.savedUsd}),0)::float8`,
      })
      .from(cacheHits)
      .where(and(eq(cacheHits.orgId, orgId), gte(cacheHits.createdAt, since)))
      .groupBy(cacheHits.model)
      .orderBy(desc(sql`count(*)`))
      .limit(8),
  ]);

  const s = summaryRaw[0];
  const hits = Number(s?.hits ?? 0);
  const totalReq = Number(totalReqRaw[0]?.n ?? 0);

  return {
    config,
    summary: {
      hits,
      exactHits: Number(s?.exactHits ?? 0),
      semanticHits: Number(s?.semanticHits ?? 0),
      crossWorkspaceHits: Number(s?.crossHits ?? 0),
      savedUsd: Number(s?.savedUsd ?? 0),
      avgSimilarity: Number(s?.avgSim ?? 0),
      entries: Number(entriesRaw[0]?.entries ?? 0),
      sharedEntries: Number(entriesRaw[0]?.shared ?? 0),
      hitRatePct: totalReq > 0 ? (hits / totalReq) * 100 : 0,
    },
    daily: dailyRaw.map((d) => ({ day: d.day, hits: Number(d.hits), savedUsd: Number(d.savedUsd) })),
    recent: recentRaw.map((r) => ({
      id: r.id,
      kind: r.kind,
      similarity: Number(r.similarity),
      crossWorkspace: r.crossWorkspace,
      model: r.model,
      savedUsd: Number(r.savedUsd),
      createdAt: new Date(r.createdAt).toISOString(),
    })),
    topModels: topRaw.map((t) => ({ model: t.model, hits: Number(t.hits), savedUsd: Number(t.savedUsd) })),
  };
}
