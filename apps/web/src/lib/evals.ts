import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  evalCases,
  evalRunCases,
  evalRuns,
  evalSets,
  getHttpDb,
  requestLogs,
  type EvalSummary,
} from '@llmgw/db/http';

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v ?? '');
}

function previewOf(input: unknown): string {
  if (!Array.isArray(input)) return '';
  for (let i = input.length - 1; i >= 0; i--) {
    const m = input[i] as { role?: string; content?: unknown } | null;
    if (m?.role === 'user') return typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
  }
  const last = input[input.length - 1] as { content?: unknown } | undefined;
  return typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '');
}

export interface EvalSetListItem {
  id: string;
  name: string;
  description: string | null;
  caseCount: number;
  runCount: number;
  createdAt: string;
}

export async function getEvalSets(workspaceId: string): Promise<EvalSetListItem[]> {
  const db = getHttpDb();
  const sets = await db
    .select()
    .from(evalSets)
    .where(eq(evalSets.workspaceId, workspaceId))
    .orderBy(desc(evalSets.createdAt))
    .limit(100);
  if (sets.length === 0) return [];
  const ids = sets.map((s) => s.id);
  const [caseCounts, runCounts] = await Promise.all([
    db
      .select({ setId: evalCases.evalSetId, n: sql<number>`count(*)::int` })
      .from(evalCases)
      .where(inArray(evalCases.evalSetId, ids))
      .groupBy(evalCases.evalSetId),
    db
      .select({ setId: evalRuns.evalSetId, n: sql<number>`count(*)::int` })
      .from(evalRuns)
      .where(inArray(evalRuns.evalSetId, ids))
      .groupBy(evalRuns.evalSetId),
  ]);
  const caseMap = new Map(caseCounts.map((c) => [c.setId, c.n]));
  const runMap = new Map(runCounts.map((r) => [r.setId, r.n]));
  return sets.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    caseCount: caseMap.get(s.id) ?? 0,
    runCount: runMap.get(s.id) ?? 0,
    createdAt: iso(s.createdAt),
  }));
}

export interface EvalCaseRow {
  id: string;
  inputPreview: string;
  reference: string | null;
  sourceRequestId: string | null;
}

export interface EvalRunListItem {
  id: string;
  name: string;
  mode: string;
  candidateModel: string;
  baselineModel: string | null;
  status: string;
  summary: EvalSummary | null;
  createdAt: string;
}

export interface EvalSetDetail {
  id: string;
  name: string;
  description: string | null;
  cases: EvalCaseRow[];
  runs: EvalRunListItem[];
}

export async function getEvalSet(workspaceId: string, setId: string): Promise<EvalSetDetail | null> {
  const db = getHttpDb();
  const rows = await db
    .select()
    .from(evalSets)
    .where(and(eq(evalSets.id, setId), eq(evalSets.workspaceId, workspaceId)))
    .limit(1);
  const set = rows[0];
  if (!set) return null;
  const [cases, runs] = await Promise.all([
    db.select().from(evalCases).where(eq(evalCases.evalSetId, setId)).orderBy(desc(evalCases.createdAt)),
    db.select().from(evalRuns).where(eq(evalRuns.evalSetId, setId)).orderBy(desc(evalRuns.createdAt)).limit(50),
  ]);
  return {
    id: set.id,
    name: set.name,
    description: set.description,
    cases: cases.map((c) => ({
      id: c.id,
      inputPreview: previewOf(c.input),
      reference: c.reference,
      sourceRequestId: c.sourceRequestId,
    })),
    runs: runs.map((r) => ({
      id: r.id,
      name: r.name,
      mode: r.mode,
      candidateModel: r.candidateModel,
      baselineModel: r.baselineModel,
      status: r.status,
      summary: (r.summary as EvalSummary | null) ?? null,
      createdAt: iso(r.createdAt),
    })),
  };
}

export interface EvalRunCaseView {
  caseId: string;
  inputPreview: string;
  reference: string | null;
  candidate: { output: string; quality: number; costUsd: number; latencyMs: number; passed: boolean } | null;
  baseline: { output: string; quality: number; costUsd: number; latencyMs: number; passed: boolean } | null;
}

export interface EvalRunDetail {
  id: string;
  name: string;
  mode: string;
  candidateModel: string;
  candidatePrompt: string | null;
  baselineModel: string | null;
  baselinePrompt: string | null;
  status: string;
  error: string | null;
  summary: EvalSummary | null;
  setId: string;
  createdAt: string;
  cases: EvalRunCaseView[];
}

export async function getEvalRun(workspaceId: string, runId: string): Promise<EvalRunDetail | null> {
  const db = getHttpDb();
  const rows = await db
    .select()
    .from(evalRuns)
    .where(and(eq(evalRuns.id, runId), eq(evalRuns.workspaceId, workspaceId)))
    .limit(1);
  const run = rows[0];
  if (!run) return null;

  const rc = await db.select().from(evalRunCases).where(eq(evalRunCases.evalRunId, runId));
  const caseIds = [...new Set(rc.map((r) => r.caseId))];
  const caseInputs = caseIds.length
    ? await db.select({ id: evalCases.id, input: evalCases.input, reference: evalCases.reference }).from(evalCases).where(inArray(evalCases.id, caseIds))
    : [];
  const inputMap = new Map(caseInputs.map((c) => [c.id, c]));

  const byCase = new Map<string, EvalRunCaseView>();
  for (const cid of caseIds) {
    const ci = inputMap.get(cid);
    byCase.set(cid, {
      caseId: cid,
      inputPreview: ci ? previewOf(ci.input) : '(case deleted)',
      reference: ci?.reference ?? null,
      candidate: null,
      baseline: null,
    });
  }
  for (const r of rc) {
    const view = byCase.get(r.caseId);
    if (!view) continue;
    const cell = {
      output: r.output ?? '',
      quality: Number(r.qualityScore),
      costUsd: Number(r.costUsd),
      latencyMs: r.latencyMs,
      passed: r.passed,
    };
    if (r.variant === 'baseline') view.baseline = cell;
    else view.candidate = cell;
  }

  return {
    id: run.id,
    name: run.name,
    mode: run.mode,
    candidateModel: run.candidateModel,
    candidatePrompt: run.candidatePrompt,
    baselineModel: run.baselineModel,
    baselinePrompt: run.baselinePrompt,
    status: run.status,
    error: run.error,
    summary: (run.summary as EvalSummary | null) ?? null,
    setId: run.evalSetId,
    createdAt: iso(run.createdAt),
    cases: [...byCase.values()],
  };
}

export interface CaptureCandidate {
  requestId: string;
  modelSlug: string;
  inputPreview: string;
  completion: string | null;
  createdAt: string;
}

// Recent production requests (with captured messages) available to pull into an eval set.
export async function getCaptureCandidates(workspaceId: string, limit = 25): Promise<CaptureCandidate[]> {
  const db = getHttpDb();
  const rows = await db
    .select({
      requestId: requestLogs.requestId,
      modelSlug: requestLogs.modelSlug,
      messages: requestLogs.messages,
      completion: requestLogs.completion,
      createdAt: requestLogs.createdAt,
    })
    .from(requestLogs)
    .where(and(eq(requestLogs.workspaceId, workspaceId), isNotNull(requestLogs.messages)))
    .orderBy(desc(requestLogs.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    requestId: r.requestId,
    modelSlug: r.modelSlug,
    inputPreview: previewOf(r.messages),
    completion: r.completion,
    createdAt: iso(r.createdAt),
  }));
}
