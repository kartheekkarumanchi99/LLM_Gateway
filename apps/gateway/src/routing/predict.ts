import { and, eq, gte, notLike, sql } from 'drizzle-orm';
import { getDb, PREDICTOR_VERSION, usageEvents } from '@llmgw/db';
import { approxPromptTokens, classifyTask } from './classify';
import type { CostTier, TaskClass } from './types';
import type { ChatMessage } from '../providers/types';

// Lightweight, deterministic predictor: it forecasts which model the authoritative
// router will pick, from the task class plus this workspace's recent routing history.
// It never blocks — history is read from an in-memory snapshot refreshed in the
// background — so it can overlap with (and be raced against) full routing.

export interface Prediction {
  predictorVersion: string;
  predictedTaskClass: TaskClass;
  predictedCostTier: CostTier;
  predictedWorkflow: 'single' | 'cascade' | 'critique' | 'bestofn';
  predictedModel: string | null;
  confidence: number; // 0..1
  topModels: string[];
  reasonCodes: string[];
  predictorLatencyMs: number;
}

export interface TaskStat {
  total: number;
  byModel: Map<string, number>;
}
interface WsStats {
  fetchedAt: number;
  byTask: Map<string, TaskStat>;
}

const STATS_TTL_MS = 60_000;
const HISTORY_WINDOW_DAYS = 30;
const statsCache = new Map<string, WsStats>();
const inflight = new Map<string, Promise<void>>();

function refreshStats(workspaceId: string): void {
  if (inflight.has(workspaceId)) return;
  const p = (async () => {
    try {
      const db = getDb();
      const since = new Date(Date.now() - HISTORY_WINDOW_DAYS * 86_400_000);
      const rows = await db
        .select({
          task: usageEvents.taskClass,
          model: usageEvents.modelSlug,
          n: sql<number>`count(*)::int`,
        })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.workspaceId, workspaceId),
            eq(usageEvents.status, 'success'),
            gte(usageEvents.createdAt, since),
            notLike(usageEvents.requestId, '%#%'), // exclude orchestration legs
          ),
        )
        .groupBy(usageEvents.taskClass, usageEvents.modelSlug);
      const byTask = new Map<string, TaskStat>();
      for (const r of rows) {
        const key = r.task ?? 'chat';
        const t = byTask.get(key) ?? { total: 0, byModel: new Map<string, number>() };
        t.total += Number(r.n);
        t.byModel.set(r.model, (t.byModel.get(r.model) ?? 0) + Number(r.n));
        byTask.set(key, t);
      }
      statsCache.set(workspaceId, { fetchedAt: Date.now(), byTask });
    } catch (err) {
      console.error('[predict] stats refresh failed:', (err as Error).message);
    } finally {
      inflight.delete(workspaceId);
    }
  })();
  inflight.set(workspaceId, p);
}

function getStats(workspaceId: string): WsStats | null {
  const s = statsCache.get(workspaceId);
  if (!s || Date.now() - s.fetchedAt > STATS_TTL_MS) refreshStats(workspaceId);
  return s ?? null;
}

// Warm the workspace history snapshot (call on first sight of a workspace).
export function warmPredictorStats(workspaceId: string): void {
  getStats(workspaceId);
}

// Pure core — deterministic for a fixed input, so it is unit-testable without a DB.
export function computePrediction(input: {
  taskClass: TaskClass;
  approxTokens: number;
  hasTools: boolean;
  taskStat: TaskStat | null;
  fallbackModel: string | null;
}): Omit<Prediction, 'predictorLatencyMs'> {
  const { taskClass, approxTokens, hasTools, taskStat, fallbackModel } = input;
  const reasonCodes: string[] = [`task:${taskClass}`, `tokens:${approxTokens}`];

  let predictedModel: string | null = null;
  let confidence = 0;
  let topModels: string[] = [];

  if (taskStat && taskStat.total > 0 && taskStat.byModel.size > 0) {
    const sorted = [...taskStat.byModel.entries()].sort((a, b) => b[1] - a[1]);
    topModels = sorted.slice(0, 3).map(([m]) => m);
    predictedModel = sorted[0]![0];
    const share = sorted[0]![1] / taskStat.total;
    const sampleFactor = taskStat.total / (taskStat.total + 10); // shrinkage toward low confidence on small samples
    confidence = share * sampleFactor;
    reasonCodes.push(`history:${taskStat.total}`, `concentration:${share.toFixed(2)}`);
  } else {
    predictedModel = fallbackModel;
    confidence = fallbackModel ? 0.25 : 0;
    reasonCodes.push('coldstart:no-history');
  }
  if (hasTools) reasonCodes.push('signal:tools');
  if (approxTokens > 8000) reasonCodes.push('signal:long-context');

  const predictedCostTier: CostTier =
    taskClass === 'code' || taskClass === 'reasoning' || taskClass === 'long_context'
      ? 'medium'
      : 'low';

  return {
    predictorVersion: PREDICTOR_VERSION,
    predictedTaskClass: taskClass,
    predictedCostTier,
    predictedWorkflow: 'single',
    predictedModel,
    confidence: Math.max(0, Math.min(1, confidence)),
    topModels,
    reasonCodes,
  };
}

export function predict(opts: {
  workspaceId: string;
  messages: ChatMessage[];
  hasTools: boolean;
  fallbackModel: string | null;
}): Prediction {
  const t0 = Date.now();
  const taskClass = classifyTask(opts.messages);
  const approxTokens = approxPromptTokens(opts.messages);
  const stats = getStats(opts.workspaceId);
  const taskStat = stats?.byTask.get(taskClass) ?? null;
  const core = computePrediction({
    taskClass,
    approxTokens,
    hasTools: opts.hasTools,
    taskStat,
    fallbackModel: opts.fallbackModel,
  });
  return { ...core, predictorLatencyMs: Date.now() - t0 };
}
