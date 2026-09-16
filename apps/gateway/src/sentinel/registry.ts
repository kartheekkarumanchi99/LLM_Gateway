import { getDb, modelBaselines, type ModelDriftStatus } from '@llmgw/db';

// In-process routing-health registry for the Drift Sentinel. The router consults this to
// re-weight (or shed) traffic away from a drifted model in real time — the "self-healing"
// control loop. State is hydrated from model_baselines on boot + refreshed periodically, and
// updated live by the background worker the instant it detects (or clears) drift.
//
// Keyed per (model, task): a checkpoint can regress on code while staying fine on chat.

const HEALTHY = 1;
const SEP = '\u0000';
const keyOf = (slug: string, taskClass: string): string => `${slug}${SEP}${taskClass}`;

interface Entry {
  multiplier: number;
  status: ModelDriftStatus;
  updatedAt: number;
}

const registry = new Map<string, Entry>();

/** Routing weight for a model on a task (1 = healthy). Consulted by score.ts. */
export function getModelHealth(slug: string, taskClass: string): number {
  return registry.get(keyOf(slug, taskClass))?.multiplier ?? HEALTHY;
}

export function setModelHealth(
  slug: string,
  taskClass: string,
  multiplier: number,
  status: ModelDriftStatus,
): void {
  registry.set(keyOf(slug, taskClass), { multiplier, status, updatedAt: Date.now() });
}

/** Only the penalized models for a task — a small map handed to the ranker. */
export function healthMapForTask(taskClass: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of registry) {
    const sep = k.indexOf(SEP);
    if (k.slice(sep + 1) === taskClass && v.multiplier < HEALTHY) out.set(k.slice(0, sep), v.multiplier);
  }
  return out;
}

export interface RegistryEntryView {
  modelSlug: string;
  taskClass: string;
  multiplier: number;
  status: ModelDriftStatus;
  updatedAt: number;
}

export function getAllHealth(): RegistryEntryView[] {
  const out: RegistryEntryView[] = [];
  for (const [k, v] of registry) {
    const sep = k.indexOf(SEP);
    out.push({
      modelSlug: k.slice(0, sep),
      taskClass: k.slice(sep + 1),
      multiplier: v.multiplier,
      status: v.status,
      updatedAt: v.updatedAt,
    });
  }
  return out;
}

/** Rehydrate live weights from the persisted baselines (boot + periodic reconcile). */
export async function refreshRegistryFromDb(): Promise<void> {
  const rows = await getDb()
    .select({
      modelSlug: modelBaselines.modelSlug,
      taskClass: modelBaselines.taskClass,
      status: modelBaselines.status,
      healthMultiplier: modelBaselines.healthMultiplier,
    })
    .from(modelBaselines);
  for (const r of rows) {
    setModelHealth(r.modelSlug, r.taskClass, Number(r.healthMultiplier), r.status as ModelDriftStatus);
  }
}

/** Test/ops helper. */
export function resetRegistry(): void {
  registry.clear();
}
