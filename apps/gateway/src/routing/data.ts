import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb, models, modelTaskPriors, usageEvents } from '@llmgw/db';
import { createTtlCache } from '../cache/memo';
import type { CandidateModel, OwnSignal } from './types';

// Models this gateway can actually execute (adapter + credentials exist).
async function loadExecutableModels(): Promise<CandidateModel[]> {
  const db = getDb();
  const rows = await db
    .select({
      slug: models.slug,
      providerSlug: models.providerSlug,
      upstreamModel: models.upstreamModel,
      promptPricePerM: models.promptPricePerM,
      completionPricePerM: models.completionPricePerM,
      contextLength: models.contextLength,
      modality: models.modality,
    })
    .from(models)
    .where(and(eq(models.executable, true), eq(models.active, true)));
  return rows.map((r) => ({
    slug: r.slug,
    providerSlug: r.providerSlug,
    upstreamModel: r.upstreamModel,
    promptPricePerM: Number(r.promptPricePerM),
    completionPricePerM: Number(r.completionPricePerM),
    contextLength: r.contextLength,
    modality: r.modality,
  }));
}

// The catalog changes only on sync-catalog — cache it so routing stays off the DB.
const catalogCache = createTtlCache<'catalog', CandidateModel[]>(loadExecutableModels, {
  ttlMs: 60_000,
  keyOf: () => 'catalog',
});
export function getExecutableModels(): Promise<CandidateModel[]> {
  return catalogCache.get('catalog');
}

// Behavioral signal from our own traffic over a trailing 7-day window.
async function loadOwnSignal(taskClass: string): Promise<Map<string, OwnSignal>> {
  const db = getDb();
  const since = new Date(Date.now() - 7 * 86_400_000);
  const rows = await db
    .select({
      modelSlug: usageEvents.modelSlug,
      n: sql<number>`count(*)::int`,
      successRate: sql<number>`avg(case when ${usageEvents.status} = 'success' then 1.0 else 0.0 end)::float8`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.taskClass, taskClass), gte(usageEvents.createdAt, since)))
    .groupBy(usageEvents.modelSlug);
  const map = new Map<string, OwnSignal>();
  for (const r of rows) {
    map.set(r.modelSlug, { n: Number(r.n), successRate: Number(r.successRate ?? 1) });
  }
  return map;
}

// Aggregated 7-day signal — a short TTL smooths bursts without hammering the DB.
const ownSignalCache = createTtlCache<string, Map<string, OwnSignal>>(loadOwnSignal, {
  ttlMs: 30_000,
  maxEntries: 200,
});
export function getOwnSignal(taskClass: string): Promise<Map<string, OwnSignal>> {
  return ownSignalCache.get(taskClass);
}

// Cold-start prior seeded from public/curated task→model strength.
async function loadPriorSignal(taskClass: string): Promise<Map<string, number>> {
  const db = getDb();
  const rows = await db
    .select({ modelSlug: modelTaskPriors.modelSlug, weight: modelTaskPriors.weight })
    .from(modelTaskPriors)
    .where(eq(modelTaskPriors.taskClass, taskClass));
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.modelSlug, Number(r.weight));
  return map;
}

// Priors change only via seed/curation → longer TTL is safe.
const priorSignalCache = createTtlCache<string, Map<string, number>>(loadPriorSignal, {
  ttlMs: 60_000,
  maxEntries: 200,
});
export function getPriorSignal(taskClass: string): Promise<Map<string, number>> {
  return priorSignalCache.get(taskClass);
}
