'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import {
  getHttpDb,
  MAX_EXAMPLES,
  MAX_VARIANTS,
  optimizationCandidates,
  optimizationRuns,
  presets,
} from '@llmgw/db/http';
import { ensurePlaygroundKey, GATEWAY_URL } from './playground';
import { getCurrentWorkspace } from './session';

export interface OptimizeExampleInput {
  input: string;
  reference?: string;
}

export interface RunOptimizationInput {
  name: string;
  taskClass: string;
  baselinePrompt: string;
  examples: OptimizeExampleInput[];
  models: string[];
  variants: number;
  judgeModel?: string | null;
  weights: { quality: number; cost: number; latency: number };
  maxTokens: number;
}

export interface RunOptimizationState {
  ok: boolean;
  error?: string;
  runId?: string;
}

export async function runOptimization(input: RunOptimizationInput): Promise<RunOptimizationState> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No workspace connected. Set up the database first.' };

  const examples = input.examples
    .map((e) => ({ input: (e.input ?? '').trim(), reference: (e.reference ?? '').trim() }))
    .filter((e) => e.input.length > 0)
    .slice(0, MAX_EXAMPLES)
    .map((e) => (e.reference ? { input: e.input, reference: e.reference } : { input: e.input }));
  if (examples.length === 0) return { ok: false, error: 'Add at least one example input.' };

  let key: string;
  try {
    key = await ensurePlaygroundKey(ctx.workspace.id);
  } catch (err) {
    return { ok: false, error: 'Could not create a gateway key: ' + (err as Error).message };
  }

  const body = {
    name: input.name?.trim() || 'Optimization run',
    task_class: input.taskClass?.trim() || 'general',
    baseline_prompt: input.baselinePrompt ?? '',
    examples,
    models: input.models.filter((m) => m.trim()).slice(0, 5),
    variants: Math.max(1, Math.min(MAX_VARIANTS, Math.floor(input.variants) || 3)),
    judge_model: input.judgeModel?.trim() || null,
    weights: input.weights,
    max_tokens: input.maxTokens,
  };

  try {
    const res = await fetch(`${GATEWAY_URL}/v1/optimize`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { run_id?: string; error?: { message?: string } };
    if (!res.ok) {
      return { ok: false, error: json?.error?.message ?? `Gateway error ${res.status}`, runId: json?.run_id };
    }
    revalidatePath('/optimize');
    return { ok: true, runId: json.run_id };
  } catch (err) {
    return { ok: false, error: 'Could not reach the gateway: ' + (err as Error).message };
  }
}

export interface PromoteState {
  ok: boolean;
  error?: string;
  slug?: string;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'optimized'
  );
}

// Promote a winning (or any) candidate into a reusable preset: its prompt becomes
// the preset system prompt, its model the preset's single model.
export async function promoteToPreset(candidateId: string, presetName?: string): Promise<PromoteState> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No workspace connected.' };
  const db = getHttpDb();

  const rows = await db
    .select({
      prompt: optimizationCandidates.prompt,
      modelSlug: optimizationCandidates.modelSlug,
      runName: optimizationRuns.name,
      label: optimizationCandidates.label,
      wsId: optimizationRuns.workspaceId,
    })
    .from(optimizationCandidates)
    .innerJoin(optimizationRuns, eq(optimizationCandidates.runId, optimizationRuns.id))
    .where(eq(optimizationCandidates.id, candidateId))
    .limit(1);
  const cand = rows[0];
  if (!cand || cand.wsId !== ctx.workspace.id) return { ok: false, error: 'Candidate not found.' };

  const name = (presetName?.trim() || `${cand.runName} — ${cand.label}`).slice(0, 80);
  const base = slugify(name);
  const existing = await db
    .select({ slug: presets.slug })
    .from(presets)
    .where(eq(presets.workspaceId, ctx.workspace.id));
  const taken = new Set(existing.map((e) => e.slug));
  let slug = base;
  let n = 1;
  while (taken.has(slug)) slug = `${base}-${n++}`;

  await db.insert(presets).values({
    workspaceId: ctx.workspace.id,
    name,
    slug,
    description: 'Promoted from prompt optimization',
    systemPrompt: cand.prompt,
    config: { models: [cand.modelSlug], tools: [] },
  });
  revalidatePath('/presets');
  return { ok: true, slug };
}

export async function deleteOptimizationRun(runId: string): Promise<{ ok: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  const db = getHttpDb();
  await db
    .delete(optimizationRuns)
    .where(and(eq(optimizationRuns.id, runId), eq(optimizationRuns.workspaceId, ctx.workspace.id)));
  revalidatePath('/optimize');
  return { ok: true };
}
