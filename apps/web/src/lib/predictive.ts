import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  DEFAULT_PREDICTIVE_CONFIG,
  getHttpDb,
  predictiveRoutingEvents,
  workspaceSettings,
  type PredictiveConfig,
} from '@llmgw/db/http';
import type { PredEventRow, PredictiveSummary, TaskAccuracy } from './predictive-types';

export async function getPredictiveConfig(workspaceId: string): Promise<PredictiveConfig> {
  if (!process.env.DATABASE_URL) return DEFAULT_PREDICTIVE_CONFIG;
  try {
    const rows = await getHttpDb()
      .select({ predictive: workspaceSettings.predictive })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, workspaceId))
      .limit(1);
    const p = (rows[0]?.predictive as Partial<PredictiveConfig> | null) ?? {};
    return { ...DEFAULT_PREDICTIVE_CONFIG, ...p };
  } catch (err) {
    console.error('[predictive] getConfig failed:', (err as Error).message);
    return DEFAULT_PREDICTIVE_CONFIG;
  }
}

export async function getPredictiveSummary(
  workspaceId: string,
  days = 30,
): Promise<PredictiveSummary | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const since = new Date(Date.now() - days * 86_400_000);
    const [a] = await getHttpDb()
      .select({
        total: sql<number>`count(*)::int`,
        observation: sql<number>`sum(case when ${predictiveRoutingEvents.mode} = 'observation' then 1 else 0 end)::int`,
        speculation: sql<number>`sum(case when ${predictiveRoutingEvents.mode} = 'speculation' then 1 else 0 end)::int`,
        predictions: sql<number>`sum(case when ${predictiveRoutingEvents.predictionCorrect} is not null then 1 else 0 end)::int`,
        correct: sql<number>`sum(case when ${predictiveRoutingEvents.predictionCorrect} then 1 else 0 end)::int`,
        activation: sql<number>`sum(case when ${predictiveRoutingEvents.speculationStarted} then 1 else 0 end)::int`,
        correctCommits: sql<number>`sum(case when ${predictiveRoutingEvents.speculationStarted} and ${predictiveRoutingEvents.predictionCorrect} then 1 else 0 end)::int`,
        losers: sql<number>`sum(case when ${predictiveRoutingEvents.loserCancelled} then 1 else 0 end)::int`,
        waste: sql<number>`coalesce(sum(${predictiveRoutingEvents.speculationWasteUsd}),0)::float8`,
        p50: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${predictiveRoutingEvents.routingOverheadMs}),0)::float8`,
        p95: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${predictiveRoutingEvents.routingOverheadMs}),0)::float8`,
        p99: sql<number>`coalesce(percentile_cont(0.99) within group (order by ${predictiveRoutingEvents.routingOverheadMs}),0)::float8`,
        estAvoided: sql<number>`coalesce(sum(case when ${predictiveRoutingEvents.speculationStarted} and ${predictiveRoutingEvents.predictionCorrect} then ${predictiveRoutingEvents.estimatedStandardOverheadMs} else 0 end),0)::float8`,
        avgAvoided: sql<number>`coalesce(avg(case when ${predictiveRoutingEvents.speculationStarted} and ${predictiveRoutingEvents.predictionCorrect} then ${predictiveRoutingEvents.estimatedStandardOverheadMs} end),0)::float8`,
        version: sql<string | null>`max(${predictiveRoutingEvents.predictorVersion})`,
      })
      .from(predictiveRoutingEvents)
      .where(
        and(
          eq(predictiveRoutingEvents.workspaceId, workspaceId),
          gte(predictiveRoutingEvents.createdAt, since),
        ),
      );
    if (!a) return null;
    const total = Number(a.total);
    const predictions = Number(a.predictions);
    const correct = Number(a.correct);
    return {
      total,
      observation: Number(a.observation),
      speculation: Number(a.speculation),
      predictions,
      correct,
      accuracyPct: predictions > 0 ? (correct / predictions) * 100 : null,
      overheadP50: Number(a.p50),
      overheadP95: Number(a.p95),
      overheadP99: Number(a.p99),
      estLatencyAvoidedMs: Number(a.estAvoided),
      avgLatencyAvoidedMs: Number(a.avgAvoided),
      activationRatePct: total > 0 ? (Number(a.activation) / total) * 100 : 0,
      correctCommits: Number(a.correctCommits),
      wasteUsd: Number(a.waste),
      losersCancelled: Number(a.losers),
      predictorVersion: a.version ?? null,
    };
  } catch (err) {
    console.error('[predictive] getSummary failed:', (err as Error).message);
    return null;
  }
}

export async function getPredictiveByTask(workspaceId: string, days = 30): Promise<TaskAccuracy[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await getHttpDb()
      .select({
        task: predictiveRoutingEvents.predictedTaskClass,
        total: sql<number>`sum(case when ${predictiveRoutingEvents.predictionCorrect} is not null then 1 else 0 end)::int`,
        correct: sql<number>`sum(case when ${predictiveRoutingEvents.predictionCorrect} then 1 else 0 end)::int`,
      })
      .from(predictiveRoutingEvents)
      .where(
        and(
          eq(predictiveRoutingEvents.workspaceId, workspaceId),
          gte(predictiveRoutingEvents.createdAt, since),
        ),
      )
      .groupBy(predictiveRoutingEvents.predictedTaskClass);
    return rows
      .map((r) => {
        const total = Number(r.total);
        const correct = Number(r.correct);
        return {
          task: r.task ?? 'chat',
          total,
          correct,
          accuracyPct: total > 0 ? (correct / total) * 100 : 0,
        };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);
  } catch (err) {
    console.error('[predictive] getByTask failed:', (err as Error).message);
    return [];
  }
}

export async function getPredictiveEvents(workspaceId: string, limit = 40): Promise<PredEventRow[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const rows = await getHttpDb()
      .select({
        requestId: predictiveRoutingEvents.requestId,
        mode: predictiveRoutingEvents.mode,
        predicted: predictiveRoutingEvents.predictedModel,
        authoritative: predictiveRoutingEvents.authoritativeModel,
        committed: predictiveRoutingEvents.committedModel,
        correct: predictiveRoutingEvents.predictionCorrect,
        confidence: predictiveRoutingEvents.predictionConfidence,
        commitReason: predictiveRoutingEvents.commitReason,
        speculationStarted: predictiveRoutingEvents.speculationStarted,
        overheadMs: predictiveRoutingEvents.routingOverheadMs,
        createdAt: predictiveRoutingEvents.createdAt,
      })
      .from(predictiveRoutingEvents)
      .where(eq(predictiveRoutingEvents.workspaceId, workspaceId))
      .orderBy(desc(predictiveRoutingEvents.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      requestId: r.requestId,
      mode: r.mode ?? '',
      predicted: r.predicted,
      authoritative: r.authoritative,
      committed: r.committed,
      correct: r.correct,
      confidence: r.confidence != null ? Number(r.confidence) : null,
      commitReason: r.commitReason,
      speculationStarted: Boolean(r.speculationStarted),
      overheadMs: r.overheadMs,
      createdAt: (r.createdAt as Date).toISOString(),
    }));
  } catch (err) {
    console.error('[predictive] getEvents failed:', (err as Error).message);
    return [];
  }
}
