'use server';

import { and, desc, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { evalCases, evalRuns, evalSets, getHttpDb, requestLogs } from '@llmgw/db/http';
import { ensurePlaygroundKey, GATEWAY_URL } from './playground';
import { getCurrentWorkspace } from './session';

export interface ActionState {
  ok: boolean;
  error?: string;
  id?: string;
}

export async function createEvalSet(name: string, description?: string): Promise<ActionState> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No workspace connected.' };
  if (!name.trim()) return { ok: false, error: 'Name is required.' };
  const db = getHttpDb();
  const inserted = await db
    .insert(evalSets)
    .values({ workspaceId: ctx.workspace.id, name: name.trim().slice(0, 120), description: description?.trim() || null })
    .returning({ id: evalSets.id });
  revalidatePath('/evals');
  return { ok: true, id: inserted[0]?.id };
}

export async function deleteEvalSet(setId: string): Promise<{ ok: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  const db = getHttpDb();
  await db.delete(evalSets).where(and(eq(evalSets.id, setId), eq(evalSets.workspaceId, ctx.workspace.id)));
  revalidatePath('/evals');
  return { ok: true };
}

async function assertOwnsSet(setId: string, workspaceId: string): Promise<boolean> {
  const db = getHttpDb();
  const rows = await db
    .select({ id: evalSets.id })
    .from(evalSets)
    .where(and(eq(evalSets.id, setId), eq(evalSets.workspaceId, workspaceId)))
    .limit(1);
  return !!rows[0];
}

export async function addManualCase(setId: string, inputText: string, reference?: string): Promise<ActionState> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No workspace connected.' };
  if (!inputText.trim()) return { ok: false, error: 'Input is required.' };
  if (!(await assertOwnsSet(setId, ctx.workspace.id))) return { ok: false, error: 'Eval set not found.' };
  const db = getHttpDb();
  await db.insert(evalCases).values({
    evalSetId: setId,
    input: [{ role: 'user', content: inputText.trim() }],
    reference: reference?.trim() || null,
  });
  revalidatePath(`/evals/${setId}`);
  return { ok: true };
}

export async function deleteCase(setId: string, caseId: string): Promise<{ ok: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  if (!(await assertOwnsSet(setId, ctx.workspace.id))) return { ok: false };
  const db = getHttpDb();
  await db.delete(evalCases).where(eq(evalCases.id, caseId));
  revalidatePath(`/evals/${setId}`);
  return { ok: true };
}

// Pull selected production requests (from Observability logs) into the eval set as cases.
export async function captureFromLogs(setId: string, requestIds: string[]): Promise<ActionState> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No workspace connected.' };
  if (!(await assertOwnsSet(setId, ctx.workspace.id))) return { ok: false, error: 'Eval set not found.' };
  const ids = requestIds.filter((r) => typeof r === 'string' && r).slice(0, 50);
  if (ids.length === 0) return { ok: false, error: 'Select at least one request.' };
  const db = getHttpDb();
  const rows = await db
    .select({ requestId: requestLogs.requestId, messages: requestLogs.messages, completion: requestLogs.completion })
    .from(requestLogs)
    .where(and(eq(requestLogs.workspaceId, ctx.workspace.id), inArray(requestLogs.requestId, ids)))
    .orderBy(desc(requestLogs.createdAt));
  const values = rows
    .filter((r) => Array.isArray(r.messages))
    .map((r) => ({
      evalSetId: setId,
      input: r.messages as object,
      reference: r.completion ?? null,
      sourceRequestId: r.requestId,
    }));
  if (values.length === 0) return { ok: false, error: 'No captured messages found for those requests.' };
  await db.insert(evalCases).values(values);
  revalidatePath(`/evals/${setId}`);
  return { ok: true, id: String(values.length) };
}

export interface RunEvalInput {
  setId: string;
  name?: string;
  mode?: string;
  candidateModel: string;
  candidatePrompt?: string;
  baselineModel?: string;
  baselinePrompt?: string;
  judgeModel?: string;
}

export async function runEvalAction(input: RunEvalInput): Promise<ActionState> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No workspace connected.' };
  let key: string;
  try {
    key = await ensurePlaygroundKey(ctx.workspace.id);
  } catch (err) {
    return { ok: false, error: 'Could not create a gateway key: ' + (err as Error).message };
  }
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/eval`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        eval_set_id: input.setId,
        name: input.name,
        mode: input.mode,
        candidate_model: input.candidateModel,
        candidate_prompt: input.candidatePrompt || null,
        baseline_model: input.baselineModel || null,
        baseline_prompt: input.baselinePrompt || null,
        judge_model: input.judgeModel || null,
      }),
    });
    const json = (await res.json()) as { run_id?: string; error?: { message?: string } };
    if (!res.ok) return { ok: false, error: json?.error?.message ?? `Gateway error ${res.status}`, id: json?.run_id };
    revalidatePath(`/evals/${input.setId}`);
    return { ok: true, id: json.run_id };
  } catch (err) {
    return { ok: false, error: 'Could not reach the gateway: ' + (err as Error).message };
  }
}
