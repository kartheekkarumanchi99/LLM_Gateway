import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  driftEvents,
  getHttpDb,
  modelBaselines,
  normalizeSentinelConfig,
  shadowEvals,
  shadowSamples,
  workspaces,
  workspaceSettings,
  type ModelDriftStatus,
  type SentinelConfig,
} from '@llmgw/db/http';
import { ensurePlaygroundKey, GATEWAY_URL } from './playground';

export interface ModelDriftRow {
  modelSlug: string;
  taskClass: string;
  status: ModelDriftStatus;
  baselineQuality: number;
  recentQuality: number;
  qualityDropPct: number;
  baselineLengthRatio: number;
  recentLengthRatio: number;
  lengthInflationPct: number;
  healthMultiplier: number;
  sampleCount: number;
  recentSamples: number;
  fingerprint: string | null;
  updatedAt: string | null;
}

export interface DriftEventRow {
  id: string;
  modelSlug: string;
  taskClass: string;
  kind: string;
  qualityDropPct: number;
  lengthInflationPct: number;
  healthMultiplier: number;
  detail: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SentinelWorkerState {
  running: boolean;
  lastRunAt: number | null;
  totalEvaluated: number;
  totalErrors: number;
}

export interface SentinelData {
  config: SentinelConfig;
  connected: boolean;
  models: ModelDriftRow[];
  events: DriftEventRow[];
  counts: { pending: number; evaluated: number; error: number };
  totalEvals: number;
  shadowCostUsd: number;
  drifted: number;
  worker: SentinelWorkerState | null;
}

function pct(baseline: number, recent: number): number {
  return baseline > 0 ? Math.max(0, ((baseline - recent) / baseline) * 100) : 0;
}
function inflation(baseline: number, recent: number): number {
  return baseline > 0 ? Math.max(0, ((recent - baseline) / baseline) * 100) : 0;
}

async function fetchWorker(workspaceId: string): Promise<SentinelWorkerState | null> {
  try {
    const key = await ensurePlaygroundKey(workspaceId);
    const res = await fetch(`${GATEWAY_URL}/v1/sentinel/status`, {
      headers: { authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { worker?: SentinelWorkerState };
    return json.worker ?? null;
  } catch {
    return null;
  }
}

export async function getSentinelConfig(workspaceId: string): Promise<SentinelConfig> {
  const rows = await getHttpDb()
    .select({ sentinel: workspaceSettings.sentinel })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1);
  return normalizeSentinelConfig(rows[0]?.sentinel ?? null);
}

export async function getSentinelData(orgId: string, workspaceId: string): Promise<SentinelData> {
  const db = getHttpDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [config, baselines, recentRaw, eventsRaw, countsRaw, costRaw, worker] = await Promise.all([
    getSentinelConfig(workspaceId),
    db
      .select({
        modelSlug: modelBaselines.modelSlug,
        taskClass: modelBaselines.taskClass,
        status: modelBaselines.status,
        meanQuality: modelBaselines.meanQuality,
        meanLengthRatio: modelBaselines.meanLengthRatio,
        healthMultiplier: modelBaselines.healthMultiplier,
        sampleCount: modelBaselines.sampleCount,
        fingerprint: modelBaselines.fingerprint,
        updatedAt: modelBaselines.updatedAt,
      })
      .from(modelBaselines)
      .orderBy(desc(modelBaselines.updatedAt)),
    // Recent (24h) behavior per model+task from this org's shadow evals.
    db
      .select({
        modelSlug: shadowEvals.candidateModel,
        taskClass: shadowEvals.taskClass,
        recentQuality: sql<number>`avg(${shadowEvals.qualityScore})::float8`,
        recentLengthRatio: sql<number>`avg(${shadowEvals.lengthRatio})::float8`,
        recentSamples: sql<number>`count(*)::int`,
      })
      .from(shadowEvals)
      .innerJoin(workspaces, eq(shadowEvals.workspaceId, workspaces.id))
      .where(and(eq(workspaces.orgId, orgId), eq(shadowEvals.status, 'ok'), gte(shadowEvals.createdAt, since)))
      .groupBy(shadowEvals.candidateModel, shadowEvals.taskClass),
    db
      .select({
        id: driftEvents.id,
        modelSlug: driftEvents.modelSlug,
        taskClass: driftEvents.taskClass,
        kind: driftEvents.kind,
        qualityDropPct: driftEvents.qualityDropPct,
        lengthInflationPct: driftEvents.lengthInflationPct,
        healthMultiplier: driftEvents.healthMultiplier,
        detail: driftEvents.detail,
        createdAt: driftEvents.createdAt,
        resolvedAt: driftEvents.resolvedAt,
      })
      .from(driftEvents)
      .orderBy(desc(driftEvents.createdAt))
      .limit(50),
    db
      .select({ status: shadowSamples.status, n: sql<number>`count(*)::int` })
      .from(shadowSamples)
      .where(eq(shadowSamples.workspaceId, workspaceId))
      .groupBy(shadowSamples.status),
    db
      .select({ cost: sql<number>`coalesce(sum(${shadowEvals.costUsd}),0)::float8`, n: sql<number>`count(*)::int` })
      .from(shadowEvals)
      .innerJoin(workspaces, eq(shadowEvals.workspaceId, workspaces.id))
      .where(eq(workspaces.orgId, orgId)),
    fetchWorker(workspaceId),
  ]);

  const recentMap = new Map<string, { q: number; l: number; n: number }>();
  for (const r of recentRaw) {
    recentMap.set(`${r.modelSlug}\u0000${r.taskClass}`, {
      q: Number(r.recentQuality),
      l: Number(r.recentLengthRatio),
      n: Number(r.recentSamples),
    });
  }

  const models: ModelDriftRow[] = baselines.map((b) => {
    const baselineQuality = Number(b.meanQuality);
    const baselineLengthRatio = Number(b.meanLengthRatio);
    const recent = recentMap.get(`${b.modelSlug}\u0000${b.taskClass}`);
    const recentQuality = recent ? recent.q : baselineQuality;
    const recentLengthRatio = recent ? recent.l : baselineLengthRatio;
    return {
      modelSlug: b.modelSlug,
      taskClass: b.taskClass,
      status: b.status as ModelDriftStatus,
      baselineQuality: Number(baselineQuality.toFixed(2)),
      recentQuality: Number(recentQuality.toFixed(2)),
      qualityDropPct: Number(pct(baselineQuality, recentQuality).toFixed(2)),
      baselineLengthRatio: Number(baselineLengthRatio.toFixed(3)),
      recentLengthRatio: Number(recentLengthRatio.toFixed(3)),
      lengthInflationPct: Number(inflation(baselineLengthRatio, recentLengthRatio).toFixed(2)),
      healthMultiplier: Number(Number(b.healthMultiplier).toFixed(3)),
      sampleCount: b.sampleCount,
      recentSamples: recent ? recent.n : 0,
      fingerprint: b.fingerprint,
      updatedAt: b.updatedAt ? new Date(b.updatedAt).toISOString() : null,
    };
  });

  const counts = { pending: 0, evaluated: 0, error: 0 };
  for (const c of countsRaw) {
    const n = Number(c.n);
    if (c.status === 'pending' || c.status === 'processing') counts.pending += n;
    else if (c.status === 'evaluated') counts.evaluated += n;
    else if (c.status === 'error') counts.error += n;
  }

  return {
    config,
    connected: worker !== null,
    models,
    events: eventsRaw.map((e) => ({
      id: e.id,
      modelSlug: e.modelSlug,
      taskClass: e.taskClass,
      kind: e.kind,
      qualityDropPct: Number(Number(e.qualityDropPct).toFixed(2)),
      lengthInflationPct: Number(Number(e.lengthInflationPct).toFixed(2)),
      healthMultiplier: Number(Number(e.healthMultiplier).toFixed(3)),
      detail: e.detail,
      createdAt: new Date(e.createdAt).toISOString(),
      resolvedAt: e.resolvedAt ? new Date(e.resolvedAt).toISOString() : null,
    })),
    counts,
    totalEvals: Number(costRaw[0]?.n ?? 0),
    shadowCostUsd: Number(costRaw[0]?.cost ?? 0),
    drifted: models.filter((m) => m.status === 'drifted').length,
    worker,
  };
}
