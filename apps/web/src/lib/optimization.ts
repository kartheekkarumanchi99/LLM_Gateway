import { and, desc, eq } from 'drizzle-orm';
import {
  getHttpDb,
  optimizationCandidates,
  optimizationRuns,
  type OptimizationSummary,
} from '@llmgw/db/http';

export interface OptimizationRunListItem {
  id: string;
  name: string;
  taskClass: string | null;
  status: string;
  summary: OptimizationSummary | null;
  createdAt: string;
  completedAt: string | null;
}

export interface OptimizationCandidateRow {
  id: string;
  label: string;
  prompt: string;
  modelSlug: string;
  isBaseline: boolean;
  isWinner: boolean;
  qualityScore: number;
  avgCostUsd: number;
  avgLatencyMs: number;
  compositeScore: number;
  sampleCount: number;
  notes: string | null;
}

export interface OptimizationRunDetail {
  id: string;
  name: string;
  taskClass: string | null;
  baselinePrompt: string;
  status: string;
  error: string | null;
  summary: OptimizationSummary | null;
  createdAt: string;
  completedAt: string | null;
  candidates: OptimizationCandidateRow[];
}

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v ?? '');
}

export async function getOptimizationRuns(workspaceId: string): Promise<OptimizationRunListItem[]> {
  const db = getHttpDb();
  const rows = await db
    .select({
      id: optimizationRuns.id,
      name: optimizationRuns.name,
      taskClass: optimizationRuns.taskClass,
      status: optimizationRuns.status,
      summary: optimizationRuns.summary,
      createdAt: optimizationRuns.createdAt,
      completedAt: optimizationRuns.completedAt,
    })
    .from(optimizationRuns)
    .where(eq(optimizationRuns.workspaceId, workspaceId))
    .orderBy(desc(optimizationRuns.createdAt))
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    taskClass: r.taskClass,
    status: r.status,
    summary: (r.summary as OptimizationSummary | null) ?? null,
    createdAt: iso(r.createdAt),
    completedAt: r.completedAt ? iso(r.completedAt) : null,
  }));
}

export async function getOptimizationRun(
  workspaceId: string,
  runId: string,
): Promise<OptimizationRunDetail | null> {
  const db = getHttpDb();
  const runRows = await db
    .select()
    .from(optimizationRuns)
    .where(and(eq(optimizationRuns.id, runId), eq(optimizationRuns.workspaceId, workspaceId)))
    .limit(1);
  const run = runRows[0];
  if (!run) return null;

  const cands = await db
    .select()
    .from(optimizationCandidates)
    .where(eq(optimizationCandidates.runId, runId))
    .orderBy(desc(optimizationCandidates.compositeScore));

  return {
    id: run.id,
    name: run.name,
    taskClass: run.taskClass,
    baselinePrompt: run.baselinePrompt,
    status: run.status,
    error: run.error,
    summary: (run.summary as OptimizationSummary | null) ?? null,
    createdAt: iso(run.createdAt),
    completedAt: run.completedAt ? iso(run.completedAt) : null,
    candidates: cands.map((c) => ({
      id: c.id,
      label: c.label,
      prompt: c.prompt,
      modelSlug: c.modelSlug,
      isBaseline: c.isBaseline,
      isWinner: c.isWinner,
      qualityScore: Number(c.qualityScore),
      avgCostUsd: Number(c.avgCostUsd),
      avgLatencyMs: c.avgLatencyMs,
      compositeScore: Number(c.compositeScore),
      sampleCount: c.sampleCount,
      notes: c.notes,
    })),
  };
}
