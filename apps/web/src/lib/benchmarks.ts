import { and, eq, gte, sql } from 'drizzle-orm';
import { getHttpDb, models, usageEvents, workspaces } from '@llmgw/db/http';
import { qualityOf } from './model-quality';
import type { BenchModel, BenchmarksData, ParetoPoint, TaskBench, TaskLeaderRow } from './benchmarks-types';

const empty: BenchmarksData = {
  days: 0,
  hasData: false,
  totalCalls: 0,
  modelsMeasured: 0,
  catalogModels: 0,
  pareto: [],
  frontier: [],
  models: [],
  tasks: [],
};

// Upper-left Pareto frontier: a model is on the frontier if no cheaper model has
// equal-or-higher quality.
function computeFrontier(pts: { slug: string; price: number; quality: number }[]): Set<string> {
  const sorted = [...pts].sort((a, b) => a.price - b.price || b.quality - a.quality);
  const on = new Set<string>();
  let bestQ = -Infinity;
  for (const p of sorted) {
    if (p.quality > bestQ) {
      on.add(p.slug);
      bestQ = p.quality;
    }
  }
  return on;
}

export async function getBenchmarks(orgId: string, days: number): Promise<BenchmarksData> {
  if (!process.env.DATABASE_URL) return { ...empty, days };
  try {
    const db = getHttpDb();
    const since = new Date(Date.now() - days * 86_400_000);
    const scope = and(eq(workspaces.orgId, orgId), gte(usageEvents.createdAt, since));

    const [perModelRaw, taskRaw, catalogRaw] = await Promise.all([
      db
        .select({
          model: usageEvents.modelSlug,
          provider: usageEvents.providerSlug,
          requests: sql<number>`count(*)::int`,
          successes: sql<number>`count(*) filter (where ${usageEvents.status} = 'success')::int`,
          promptTokens: sql<number>`coalesce(sum(${usageEvents.promptTokens}),0)::bigint`,
          completionTokens: sql<number>`coalesce(sum(${usageEvents.completionTokens}),0)::bigint`,
          spend: sql<number>`coalesce(sum(${usageEvents.costUsd}),0)::float8`,
          latencySum: sql<number>`coalesce(sum(${usageEvents.latencyMs}),0)::bigint`,
          p50: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${usageEvents.latencyMs}),0)::float8`,
          p95: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${usageEvents.latencyMs}),0)::float8`,
          ttftP50: sql<number | null>`percentile_cont(0.5) within group (order by ${usageEvents.ttftMs})`,
          ttftP95: sql<number | null>`percentile_cont(0.95) within group (order by ${usageEvents.ttftMs})`,
          cached: sql<number>`count(*) filter (where ${usageEvents.cached})::int`,
          attempts: sql<number>`coalesce(avg(coalesce(jsonb_array_length(${usageEvents.routingTrace} -> 'attempts'), 1)),1)::float8`,
        })
        .from(usageEvents)
        .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
        .where(scope)
        .groupBy(usageEvents.modelSlug, usageEvents.providerSlug),
      db
        .select({
          task: usageEvents.taskClass,
          model: usageEvents.modelSlug,
          requests: sql<number>`count(*)::int`,
          successes: sql<number>`count(*) filter (where ${usageEvents.status} = 'success')::int`,
          latencySum: sql<number>`coalesce(sum(${usageEvents.latencyMs}),0)::bigint`,
          completionTokens: sql<number>`coalesce(sum(${usageEvents.completionTokens}),0)::bigint`,
          spend: sql<number>`coalesce(sum(${usageEvents.costUsd}),0)::float8`,
        })
        .from(usageEvents)
        .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
        .where(scope)
        .groupBy(usageEvents.taskClass, usageEvents.modelSlug),
      db
        .select({
          slug: models.slug,
          provider: models.providerSlug,
          pin: models.promptPricePerM,
          pout: models.completionPricePerM,
        })
        .from(models)
        .where(and(eq(models.executable, true), eq(models.active, true))),
    ]);

    const totalCalls = perModelRaw.reduce((a, r) => a + Number(r.requests), 0);

    const usedByModel = new Map(perModelRaw.map((r) => [r.model, Number(r.requests)]));

    // ---- Pareto (quality vs blended list price) over the executable catalog ----
    const pricePoints = catalogRaw
      .map((c) => ({
        slug: c.slug,
        provider: c.provider,
        price: (Number(c.pin) + Number(c.pout)) / 2,
        quality: qualityOf(c.slug),
      }))
      .filter((p) => p.price > 0);
    const frontierSet = computeFrontier(pricePoints);
    const pareto: ParetoPoint[] = pricePoints.map((p) => ({
      slug: p.slug,
      provider: p.provider,
      pricePerM: p.price,
      quality: p.quality,
      requests: usedByModel.get(p.slug) ?? 0,
      onFrontier: frontierSet.has(p.slug),
      used: (usedByModel.get(p.slug) ?? 0) > 0,
    }));
    const frontier = pricePoints
      .filter((p) => frontierSet.has(p.slug))
      .sort((a, b) => a.price - b.price)
      .map((p) => ({ x: p.price, y: p.quality, slug: p.slug }));

    // ---- Measured model benchmarks ----
    const modelsBench: BenchModel[] = perModelRaw
      .map((r) => {
        const requests = Number(r.requests);
        const completion = Number(r.completionTokens);
        const totalTok = Number(r.promptTokens) + completion;
        const latencySum = Number(r.latencySum);
        const successRate = requests > 0 ? Number(r.successes) / requests : 0;
        return {
          modelSlug: r.model,
          providerSlug: r.provider,
          requests,
          successRate,
          errorRate: 1 - successRate,
          avgLatencyMs: requests > 0 ? latencySum / requests : 0,
          p50LatencyMs: Number(r.p50),
          p95LatencyMs: Number(r.p95),
          ttftP50: r.ttftP50 == null ? null : Number(r.ttftP50),
          ttftP95: r.ttftP95 == null ? null : Number(r.ttftP95),
          throughput: latencySum > 0 ? completion / (latencySum / 1000) : 0,
          avgPricePerM: totalTok > 0 ? Number(r.spend) / (totalTok / 1_000_000) : 0,
          avgAttempts: Number(r.attempts),
          cacheHitRate: requests > 0 ? Number(r.cached) / requests : 0,
          qualityEst: qualityOf(r.model),
        };
      })
      .sort((a, b) => b.requests - a.requests);

    // ---- Task-class leaderboards ----
    const byTask = new Map<string, TaskLeaderRow[]>();
    const taskTotals = new Map<string, number>();
    for (const r of taskRaw) {
      if (!r.task) continue;
      const requests = Number(r.requests);
      const completion = Number(r.completionTokens);
      const latencySum = Number(r.latencySum);
      const row: TaskLeaderRow = {
        modelSlug: r.model,
        requests,
        successRate: requests > 0 ? Number(r.successes) / requests : 0,
        avgLatencyMs: requests > 0 ? latencySum / requests : 0,
        avgCostUsd: requests > 0 ? Number(r.spend) / requests : 0,
        throughput: latencySum > 0 ? completion / (latencySum / 1000) : 0,
      };
      (byTask.get(r.task) ?? byTask.set(r.task, []).get(r.task)!).push(row);
      taskTotals.set(r.task, (taskTotals.get(r.task) ?? 0) + requests);
    }
    const tasks: TaskBench[] = [...byTask.entries()]
      .map(([taskClass, leaders]) => ({
        taskClass,
        total: taskTotals.get(taskClass) ?? 0,
        leaders: leaders
          .sort((a, b) => b.successRate - a.successRate || b.requests - a.requests)
          .slice(0, 5),
      }))
      .sort((a, b) => b.total - a.total);

    return {
      days,
      hasData: totalCalls > 0,
      totalCalls,
      modelsMeasured: perModelRaw.length,
      catalogModels: catalogRaw.length,
      pareto,
      frontier,
      models: modelsBench,
      tasks,
    };
  } catch (err) {
    console.error('[benchmarks] query failed:', (err as Error).message);
    return { ...empty, days };
  }
}
