'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import {
  getHttpDb,
  guardrails,
  type BudgetPolicy,
  type GuardrailPolicies,
  type ModelAccessPolicy,
  type PolicyMode,
} from '@llmgw/db/http';
import { getCurrentWorkspace } from './session';

export interface CreateGuardrailState {
  ok: boolean;
  error?: string;
  id?: string;
}

async function loadPolicies(id: string, workspaceId: string): Promise<GuardrailPolicies> {
  const db = getHttpDb();
  const rows = await db
    .select({ policies: guardrails.policies })
    .from(guardrails)
    .where(and(eq(guardrails.id, id), eq(guardrails.workspaceId, workspaceId)))
    .limit(1);
  return (rows[0]?.policies as GuardrailPolicies | null) ?? {};
}

async function savePolicies(id: string, workspaceId: string, policies: GuardrailPolicies): Promise<void> {
  const db = getHttpDb();
  await db
    .update(guardrails)
    .set({ policies })
    .where(and(eq(guardrails.id, id), eq(guardrails.workspaceId, workspaceId)));
  revalidatePath(`/guardrails/${id}`);
  revalidatePath('/guardrails');
}

export async function createGuardrail(
  _prev: CreateGuardrailState | null,
  formData: FormData,
): Promise<CreateGuardrailState> {
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  if (!name) return { ok: false, error: 'Name is required.' };

  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected.' };

  const db = getHttpDb();
  const inserted = await db
    .insert(guardrails)
    .values({
      workspaceId: ctx.workspace.id,
      name: name.slice(0, 80),
      description: description || null,
      isDefault: false,
      status: 'active',
      policies: {},
    })
    .returning({ id: guardrails.id });
  revalidatePath('/guardrails');
  return { ok: true, id: inserted[0]?.id };
}

export async function updateBudgetPolicy(id: string, budget: BudgetPolicy): Promise<{ ok: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  const policies = await loadPolicies(id, ctx.workspace.id);
  policies.budget = budget.limitUsd == null ? undefined : budget;
  await savePolicies(id, ctx.workspace.id, policies);
  return { ok: true };
}

export async function updateModelAccessPolicy(
  id: string,
  modelAccess: ModelAccessPolicy,
): Promise<{ ok: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  const policies = await loadPolicies(id, ctx.workspace.id);
  policies.modelAccess = modelAccess;
  await savePolicies(id, ctx.workspace.id, policies);
  return { ok: true };
}

export async function updateContentPolicy(
  id: string,
  patch: { promptInjection?: PolicyMode; sensitiveInfo?: PolicyMode },
): Promise<{ ok: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  const policies = await loadPolicies(id, ctx.workspace.id);
  if (patch.promptInjection !== undefined) policies.promptInjection = patch.promptInjection;
  if (patch.sensitiveInfo !== undefined) policies.sensitiveInfo = patch.sensitiveInfo;
  await savePolicies(id, ctx.workspace.id, policies);
  return { ok: true };
}

export async function deleteGuardrail(id: string): Promise<{ ok: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  const db = getHttpDb();
  await db
    .delete(guardrails)
    .where(
      and(
        eq(guardrails.id, id),
        eq(guardrails.workspaceId, ctx.workspace.id),
        eq(guardrails.isDefault, false),
      ),
    );
  revalidatePath('/guardrails');
  return { ok: true };
}
