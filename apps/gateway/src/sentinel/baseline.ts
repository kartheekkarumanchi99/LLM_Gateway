import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  assessDrift,
  BASELINE_EWMA,
  driftEvents,
  getDb,
  MIN_BASELINE_SAMPLES,
  modelBaselines,
  RECENT_WINDOW,
  shadowEvals,
  type DriftKind,
  type ModelDriftStatus,
  type SentinelConfig,
} from '@llmgw/db';
import { setModelHealth } from './registry';

// Drift is a property of the VENDOR model (a silently-updated checkpoint affects every
// workspace), so baselines are global per (model, task). Detection thresholds + enforcement
// come from the cfg of the workspace whose traffic triggered this evaluation.

interface BaselineRow {
  meanQuality: number;
  meanLengthRatio: number;
  sampleCount: number;
  status: ModelDriftStatus;
}

async function recentWindow(
  modelSlug: string,
  taskClass: string,
): Promise<{ quality: number; lengthRatio: number; n: number }> {
  const rows = await getDb()
    .select({ quality: shadowEvals.qualityScore, lengthRatio: shadowEvals.lengthRatio })
    .from(shadowEvals)
    .where(
      and(
        eq(shadowEvals.candidateModel, modelSlug),
        eq(shadowEvals.taskClass, taskClass),
        eq(shadowEvals.status, 'ok'),
      ),
    )
    .orderBy(desc(shadowEvals.createdAt))
    .limit(RECENT_WINDOW);
  if (rows.length === 0) return { quality: 0, lengthRatio: 1, n: 0 };
  const q = rows.reduce((a, r) => a + Number(r.quality), 0) / rows.length;
  const l = rows.reduce((a, r) => a + Number(r.lengthRatio), 0) / rows.length;
  return { quality: q, lengthRatio: l, n: rows.length };
}

function fingerprint(quality: number, lengthRatio: number): string {
  return `${Math.round(quality)}|${lengthRatio.toFixed(2)}`;
}

async function openEvent(modelSlug: string, taskClass: string, kind: DriftKind): Promise<boolean> {
  const rows = await getDb()
    .select({ id: driftEvents.id })
    .from(driftEvents)
    .where(
      and(
        eq(driftEvents.modelSlug, modelSlug),
        eq(driftEvents.taskClass, taskClass),
        eq(driftEvents.kind, kind),
        isNull(driftEvents.resolvedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// Recompute a model's baseline from its latest shadow evals and, if it has drifted from its
// established behavior, record a drift event + apply the routing penalty (self-healing).
export async function updateBaseline(modelSlug: string, taskClass: string, cfg: SentinelConfig): Promise<void> {
  const db = getDb();
  const recent = await recentWindow(modelSlug, taskClass);
  if (recent.n === 0) return;

  const existing = await db
    .select({
      meanQuality: modelBaselines.meanQuality,
      meanLengthRatio: modelBaselines.meanLengthRatio,
      sampleCount: modelBaselines.sampleCount,
      status: modelBaselines.status,
    })
    .from(modelBaselines)
    .where(and(eq(modelBaselines.modelSlug, modelSlug), eq(modelBaselines.taskClass, taskClass)))
    .limit(1);

  const prev: BaselineRow | null = existing[0]
    ? {
        meanQuality: Number(existing[0].meanQuality),
        meanLengthRatio: Number(existing[0].meanLengthRatio),
        sampleCount: existing[0].sampleCount,
        status: existing[0].status as ModelDriftStatus,
      }
    : null;

  // First time we see this model+task: seed the baseline from the recent window.
  if (!prev) {
    const established = recent.n >= MIN_BASELINE_SAMPLES;
    await db.insert(modelBaselines).values({
      modelSlug,
      taskClass,
      meanQuality: recent.quality.toFixed(2),
      meanLengthRatio: recent.lengthRatio.toFixed(4),
      sampleCount: recent.n,
      fingerprint: fingerprint(recent.quality, recent.lengthRatio),
      status: established ? 'healthy' : 'establishing',
      healthMultiplier: '1',
      establishedAt: established ? new Date() : null,
      updatedAt: new Date(),
    });
    setModelHealth(modelSlug, taskClass, 1, established ? 'healthy' : 'establishing');
    return;
  }

  const assessment = assessDrift(
    {
      baselineQuality: prev.meanQuality,
      baselineLengthRatio: prev.meanLengthRatio,
      baselineSamples: prev.sampleCount,
      recentQuality: recent.quality,
      recentLengthRatio: recent.lengthRatio,
      recentSamples: recent.n,
    },
    cfg,
  );

  const enforcedMultiplier = cfg.autoReweight ? assessment.healthMultiplier : 1;
  const wasDrifted = prev.status === 'drifted';
  const nowDrifted = assessment.drifted;

  // Baseline evolution: freeze while drifted (a bad checkpoint must not become its own
  // reference); running-mean while establishing; slow EWMA toward recent while healthy.
  let newQuality = prev.meanQuality;
  let newLengthRatio = prev.meanLengthRatio;
  let newCount = prev.sampleCount;
  let establishedAt: Date | null | undefined;

  if (nowDrifted) {
    // frozen
  } else if (wasDrifted) {
    // Recovery: the new checkpoint becomes the baseline.
    newQuality = recent.quality;
    newLengthRatio = recent.lengthRatio;
    newCount = Math.max(MIN_BASELINE_SAMPLES, recent.n);
    establishedAt = new Date();
  } else if (prev.sampleCount < MIN_BASELINE_SAMPLES) {
    newQuality = (prev.meanQuality * prev.sampleCount + recent.quality) / (prev.sampleCount + 1);
    newLengthRatio = (prev.meanLengthRatio * prev.sampleCount + recent.lengthRatio) / (prev.sampleCount + 1);
    newCount = prev.sampleCount + 1;
    if (newCount >= MIN_BASELINE_SAMPLES) establishedAt = new Date();
  } else {
    newQuality = prev.meanQuality * (1 - BASELINE_EWMA) + recent.quality * BASELINE_EWMA;
    newLengthRatio = prev.meanLengthRatio * (1 - BASELINE_EWMA) + recent.lengthRatio * BASELINE_EWMA;
    newCount = prev.sampleCount + 1;
  }

  await db
    .update(modelBaselines)
    .set({
      meanQuality: newQuality.toFixed(2),
      meanLengthRatio: newLengthRatio.toFixed(4),
      sampleCount: newCount,
      status: assessment.status,
      healthMultiplier: enforcedMultiplier.toFixed(4),
      fingerprint: fingerprint(newQuality, newLengthRatio),
      ...(establishedAt !== undefined ? { establishedAt } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(modelBaselines.modelSlug, modelSlug), eq(modelBaselines.taskClass, taskClass)));

  setModelHealth(modelSlug, taskClass, enforcedMultiplier, assessment.status);

  // ---- Self-healing audit log: one event per drift episode + a closing recovery ----
  if (nowDrifted && !wasDrifted) {
    for (const kind of assessment.kinds) {
      if (await openEvent(modelSlug, taskClass, kind)) continue;
      await db.insert(driftEvents).values({
        modelSlug,
        taskClass,
        kind,
        baselineQuality: prev.meanQuality.toFixed(2),
        observedQuality: recent.quality.toFixed(2),
        qualityDropPct: assessment.qualityDropPct.toFixed(2),
        baselineLengthRatio: prev.meanLengthRatio.toFixed(4),
        observedLengthRatio: recent.lengthRatio.toFixed(4),
        lengthInflationPct: assessment.lengthInflationPct.toFixed(2),
        healthMultiplier: enforcedMultiplier.toFixed(4),
        sampleCount: recent.n,
        detail:
          kind === 'quality_drop'
            ? `Quality ${prev.meanQuality.toFixed(1)}→${recent.quality.toFixed(1)} (${assessment.qualityDropPct.toFixed(1)}% drop)` +
              (cfg.autoReweight ? ` · routing weight ↓ ${enforcedMultiplier.toFixed(2)}` : ' · observe-only')
            : `Output length ${prev.meanLengthRatio.toFixed(2)}×→${recent.lengthRatio.toFixed(2)}× (${assessment.lengthInflationPct.toFixed(1)}% inflation)` +
              (cfg.autoReweight ? ` · routing weight ↓ ${enforcedMultiplier.toFixed(2)}` : ' · observe-only'),
      });
    }
  } else if (!nowDrifted && wasDrifted) {
    await db
      .update(driftEvents)
      .set({ resolvedAt: new Date() })
      .where(
        and(
          eq(driftEvents.modelSlug, modelSlug),
          eq(driftEvents.taskClass, taskClass),
          isNull(driftEvents.resolvedAt),
        ),
      );
    await db.insert(driftEvents).values({
      modelSlug,
      taskClass,
      kind: 'recovered',
      baselineQuality: recent.quality.toFixed(2),
      observedQuality: recent.quality.toFixed(2),
      qualityDropPct: '0',
      baselineLengthRatio: recent.lengthRatio.toFixed(4),
      observedLengthRatio: recent.lengthRatio.toFixed(4),
      lengthInflationPct: '0',
      healthMultiplier: '1',
      sampleCount: recent.n,
      resolvedAt: new Date(),
      detail: `Recovered — quality back to ${recent.quality.toFixed(1)}; routing weight restored to 1.00`,
    });
  }
}
