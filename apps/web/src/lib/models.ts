import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { getHttpDb, models, providers, usageEvents } from '@llmgw/db/http';
import type {
  ActivityDay,
  CatalogModel,
  ModelApp,
  ModelInsights,
  ModelTelemetry,
  RunnableModel,
} from './catalog-types';

// Full public model catalog (active models), joined to provider display info.
export async function listCatalogModels(): Promise<CatalogModel[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const db = getHttpDb();
    const rows = await db
      .select({
        slug: models.slug,
        name: models.displayName,
        provider: models.providerSlug,
        upstreamModel: models.upstreamModel,
        description: models.description,
        modality: models.modality,
        contextLength: models.contextLength,
        promptPricePerM: models.promptPricePerM,
        completionPricePerM: models.completionPricePerM,
        executable: models.executable,
        createdAt: models.createdAt,
        providerName: providers.displayName,
        providerIcon: providers.iconUrl,
      })
      .from(models)
      .leftJoin(providers, eq(providers.slug, models.providerSlug))
      .where(eq(models.active, true))
      .orderBy(asc(models.slug));

    return rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      provider: r.provider,
      providerName: r.providerName ?? r.provider,
      providerIcon: r.providerIcon,
      upstreamModel: r.upstreamModel,
      description: r.description,
      modality: r.modality,
      contextLength: r.contextLength,
      promptPricePerM: Number(r.promptPricePerM),
      completionPricePerM: Number(r.completionPricePerM),
      executable: r.executable,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt ?? ''),
    }));
  } catch (err) {
    console.error('[models] listCatalogModels failed:', (err as Error).message);
    return [];
  }
}

const EMPTY_INSIGHTS: ModelInsights = {
  telemetry: {
    requests: 0,
    successes: 0,
    p50LatencyMs: 0,
    p95LatencyMs: 0,
    avgTtftMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    avgThroughput: 0,
  },
  apps: [],
  activity: [],
};

function lastNDaysList(n: number): string[] {
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

export async function getModelDetail(slug: string): Promise<CatalogModel | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const db = getHttpDb();
    const rows = await db
      .select({
        slug: models.slug,
        name: models.displayName,
        provider: models.providerSlug,
        upstreamModel: models.upstreamModel,
        description: models.description,
        modality: models.modality,
        contextLength: models.contextLength,
        promptPricePerM: models.promptPricePerM,
        completionPricePerM: models.completionPricePerM,
        executable: models.executable,
        createdAt: models.createdAt,
        providerName: providers.displayName,
        providerIcon: providers.iconUrl,
      })
      .from(models)
      .leftJoin(providers, eq(providers.slug, models.providerSlug))
      .where(eq(models.slug, slug))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      slug: r.slug,
      name: r.name,
      provider: r.provider,
      providerName: r.providerName ?? r.provider,
      providerIcon: r.providerIcon,
      upstreamModel: r.upstreamModel,
      description: r.description,
      modality: r.modality,
      contextLength: r.contextLength,
      promptPricePerM: Number(r.promptPricePerM),
      completionPricePerM: Number(r.completionPricePerM),
      executable: r.executable,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt ?? ''),
    };
  } catch (err) {
    console.error('[models] getModelDetail failed:', (err as Error).message);
    return null;
  }
}

export async function getModelInsights(slug: string): Promise<ModelInsights> {
  if (!process.env.DATABASE_URL) return EMPTY_INSIGHTS;
  try {
    const db = getHttpDb();
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [statsRows, appRows, actRows] = await Promise.all([
      db
        .select({
          requests: sql<number>`count(*)::int`,
          successes: sql<number>`(count(*) filter (where ${usageEvents.status} = 'success'))::int`,
          p50LatencyMs: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${usageEvents.latencyMs}) filter (where ${usageEvents.status} = 'success'), 0)::float8`,
          p95LatencyMs: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${usageEvents.latencyMs}) filter (where ${usageEvents.status} = 'success'), 0)::float8`,
          avgTtftMs: sql<number>`coalesce(avg(${usageEvents.ttftMs}) filter (where ${usageEvents.ttftMs} is not null), 0)::float8`,
          promptTokens: sql<number>`coalesce(sum(${usageEvents.promptTokens}),0)::int`,
          completionTokens: sql<number>`coalesce(sum(${usageEvents.completionTokens}),0)::int`,
          reasoningTokens: sql<number>`coalesce(sum(${usageEvents.reasoningTokens}),0)::int`,
          avgThroughput: sql<number>`coalesce(avg((${usageEvents.completionTokens})::float8 / nullif(${usageEvents.latencyMs}, 0) * 1000) filter (where ${usageEvents.status} = 'success' and ${usageEvents.completionTokens} > 0), 0)::float8`,
        })
        .from(usageEvents)
        .where(eq(usageEvents.modelSlug, slug)),
      db
        .select({
          app: sql<string>`coalesce(nullif(${usageEvents.appName}, ''), 'Direct API')`,
          tokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}),0)::int`,
          requests: sql<number>`count(*)::int`,
        })
        .from(usageEvents)
        .where(eq(usageEvents.modelSlug, slug))
        .groupBy(sql`coalesce(nullif(${usageEvents.appName}, ''), 'Direct API')`)
        .orderBy(sql`coalesce(sum(${usageEvents.totalTokens}),0) desc`)
        .limit(5),
      db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${usageEvents.createdAt}), 'YYYY-MM-DD')`,
          prompt: sql<number>`coalesce(sum(${usageEvents.promptTokens}),0)::int`,
          completion: sql<number>`coalesce(sum(${usageEvents.completionTokens}),0)::int`,
        })
        .from(usageEvents)
        .where(and(eq(usageEvents.modelSlug, slug), gte(usageEvents.createdAt, since)))
        .groupBy(sql`1`)
        .orderBy(sql`1`),
    ]);

    const s = statsRows[0];
    const telemetry: ModelTelemetry = {
      requests: Number(s?.requests ?? 0),
      successes: Number(s?.successes ?? 0),
      p50LatencyMs: Number(s?.p50LatencyMs ?? 0),
      p95LatencyMs: Number(s?.p95LatencyMs ?? 0),
      avgTtftMs: Number(s?.avgTtftMs ?? 0),
      promptTokens: Number(s?.promptTokens ?? 0),
      completionTokens: Number(s?.completionTokens ?? 0),
      reasoningTokens: Number(s?.reasoningTokens ?? 0),
      avgThroughput: Number(s?.avgThroughput ?? 0),
    };
    const apps: ModelApp[] = appRows.map((a) => ({
      app: a.app,
      tokens: Number(a.tokens),
      requests: Number(a.requests),
    }));
    const actMap = new Map(actRows.map((r) => [r.day, r]));
    const activity: ActivityDay[] = lastNDaysList(30).map((day) => {
      const row = actMap.get(day);
      return { day, prompt: Number(row?.prompt ?? 0), completion: Number(row?.completion ?? 0) };
    });
    return { telemetry, apps, activity };
  } catch (err) {
    console.error('[models] getModelInsights failed:', (err as Error).message);
    return EMPTY_INSIGHTS;
  }
}

// Models this gateway can actually execute (adapter + credentials), for the picker.
export async function listRunnableModels(): Promise<RunnableModel[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const db = getHttpDb();
    const rows = await db
      .select({ slug: models.slug, name: models.displayName, provider: models.providerSlug })
      .from(models)
      .where(and(eq(models.active, true), eq(models.executable, true)))
      .orderBy(asc(models.slug));
    return rows.map((r) => ({ slug: r.slug, name: r.name, provider: r.provider }));
  } catch (err) {
    console.error('[models] listRunnableModels failed:', (err as Error).message);
    return [];
  }
}
