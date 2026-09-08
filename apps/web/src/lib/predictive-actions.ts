'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import {
  DEFAULT_PREDICTIVE_CONFIG,
  getHttpDb,
  workspaceSettings,
  type PredictiveConfig,
} from '@llmgw/db/http';
import { getCurrentWorkspace } from './session';

async function upsertPredictive(workspaceId: string, predictive: PredictiveConfig): Promise<void> {
  const db = getHttpDb();
  const existing = await db
    .select({ id: workspaceSettings.id })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1);
  if (existing.length) {
    await db
      .update(workspaceSettings)
      .set({ predictive, updatedAt: new Date() })
      .where(eq(workspaceSettings.workspaceId, workspaceId));
  } else {
    await db.insert(workspaceSettings).values({ workspaceId, predictive });
  }
}

// Coerce/clamp inbound config so the persisted document is always well-formed.
function sanitize(input: Partial<PredictiveConfig>): PredictiveConfig {
  const c = { ...DEFAULT_PREDICTIVE_CONFIG, ...input };
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
  return {
    enabled: Boolean(c.enabled),
    observationOnly: Boolean(c.observationOnly),
    speculationEnabled: Boolean(c.speculationEnabled),
    maxCandidates: Math.round(clamp(c.maxCandidates, 1, 3)),
    confidenceThreshold: clamp(c.confidenceThreshold, 0, 1),
    maxSpeculationCostUsd: clamp(c.maxSpeculationCostUsd, 0, 10),
    commitTimeoutMs: Math.round(clamp(c.commitTimeoutMs, 250, 60_000)),
    allowedTaskClasses: Array.isArray(c.allowedTaskClasses) ? c.allowedTaskClasses.slice(0, 16) : [],
    allowedModels: Array.isArray(c.allowedModels) ? c.allowedModels.slice(0, 64) : [],
    allowedProviders: Array.isArray(c.allowedProviders) ? c.allowedProviders.slice(0, 32) : [],
    sensitiveDataDisabled: Boolean(c.sensitiveDataDisabled),
    orchestrationDisabled: Boolean(c.orchestrationDisabled),
    autoCancelLosers: Boolean(c.autoCancelLosers),
    maxRoutingOverheadMs: Math.round(clamp(c.maxRoutingOverheadMs, 0, 60_000)),
  };
}

export async function savePredictiveConfig(
  input: Partial<PredictiveConfig>,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected.' };
  await upsertPredictive(ctx.workspace.id, sanitize(input));
  revalidatePath('/predictive');
  return { ok: true };
}

// Rollback = immediately revert to the safe default rollout mode: keep observing,
// but stop opening speculative upstream calls.
export async function rollbackPredictor(): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected.' };
  const db = getHttpDb();
  const rows = await db
    .select({ predictive: workspaceSettings.predictive })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, ctx.workspace.id))
    .limit(1);
  const current = { ...DEFAULT_PREDICTIVE_CONFIG, ...((rows[0]?.predictive as Partial<PredictiveConfig>) ?? {}) };
  await upsertPredictive(ctx.workspace.id, {
    ...current,
    speculationEnabled: false,
    observationOnly: true,
  });
  revalidatePath('/predictive');
  return { ok: true };
}
