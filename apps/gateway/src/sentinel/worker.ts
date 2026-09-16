import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  getDb,
  MAX_SHADOW_BATCH,
  SHADOW_WORKER_INTERVAL_MS,
  shadowSamples,
} from '@llmgw/db';
import type { ChatMessage } from '../providers/types';
import { getSentinelConfig } from './config';
import { evaluateSample, type ShadowSampleRow } from './evaluate';
import { updateBaseline } from './baseline';
import { refreshRegistryFromDb } from './registry';

interface WorkerState {
  running: boolean;
  lastRunAt: number | null;
  lastError: string | null;
  totalEvaluated: number;
  totalErrors: number;
}

const state: WorkerState = {
  running: false,
  lastRunAt: null,
  lastError: null,
  totalEvaluated: 0,
  totalErrors: 0,
};

export function sentinelWorkerState(): Readonly<WorkerState> {
  return state;
}

async function claimPending(): Promise<ShadowSampleRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: shadowSamples.id,
      workspaceId: shadowSamples.workspaceId,
      orgId: shadowSamples.orgId,
      taskClass: shadowSamples.taskClass,
      baselineModel: shadowSamples.baselineModel,
      baselineProvider: shadowSamples.baselineProvider,
      messages: shadowSamples.messages,
      referenceOutput: shadowSamples.referenceOutput,
      referenceTokens: shadowSamples.referenceTokens,
      maxTokens: shadowSamples.maxTokens,
    })
    .from(shadowSamples)
    .where(eq(shadowSamples.status, 'pending'))
    .orderBy(asc(shadowSamples.createdAt))
    .limit(MAX_SHADOW_BATCH);
  if (rows.length === 0) return [];
  // Mark claimed so a manual trigger overlapping the interval can't double-process.
  await db
    .update(shadowSamples)
    .set({ status: 'processing' })
    .where(
      and(
        eq(shadowSamples.status, 'pending'),
        inArray(
          shadowSamples.id,
          rows.map((r) => r.id),
        ),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    orgId: r.orgId,
    taskClass: r.taskClass,
    baselineModel: r.baselineModel,
    baselineProvider: r.baselineProvider,
    messages: (r.messages as ChatMessage[] | null) ?? [],
    referenceOutput: r.referenceOutput,
    referenceTokens: r.referenceTokens,
    maxTokens: r.maxTokens,
  }));
}

async function processSample(sample: ShadowSampleRow): Promise<void> {
  const db = getDb();
  const cfg = await getSentinelConfig(sample.workspaceId);
  try {
    const results = await evaluateSample(sample, cfg);
    const seen = new Set<string>();
    for (const r of results) {
      if (r.status !== 'ok') continue;
      const key = `${r.candidateModel}\u0000${r.taskClass}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await updateBaseline(r.candidateModel, r.taskClass, cfg);
    }
    await db
      .update(shadowSamples)
      .set({ status: 'evaluated', evaluatedAt: new Date() })
      .where(eq(shadowSamples.id, sample.id));
    state.totalEvaluated += 1;
  } catch (e) {
    state.totalErrors += 1;
    state.lastError = (e as Error).message;
    await db
      .update(shadowSamples)
      .set({ status: 'error', error: (e as Error).message.slice(0, 500), evaluatedAt: new Date() })
      .where(eq(shadowSamples.id, sample.id));
  }
}

/** Process one batch of pending shadow samples. Safe to call manually or on the interval. */
export async function runSentinelTick(): Promise<{ processed: number }> {
  if (state.running) return { processed: 0 };
  state.running = true;
  state.lastRunAt = Date.now();
  let processed = 0;
  try {
    const batch = await claimPending();
    for (const sample of batch) {
      await processSample(sample);
      processed += 1;
    }
  } catch (e) {
    state.lastError = (e as Error).message;
  } finally {
    state.running = false;
  }
  return { processed };
}

/** Start the background sentinel loop. Returns the interval handle (already unref'd). */
export function startSentinelWorker(): NodeJS.Timeout {
  void refreshRegistryFromDb().catch((e) => console.error('[sentinel] registry hydrate failed:', (e as Error).message));
  const timer = setInterval(() => {
    void runSentinelTick().catch((e) => console.error('[sentinel] tick failed:', (e as Error).message));
  }, SHADOW_WORKER_INTERVAL_MS);
  timer.unref();
  return timer;
}
