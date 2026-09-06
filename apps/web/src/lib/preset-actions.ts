'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getHttpDb, presets, type PresetConfig } from '@llmgw/db/http';
import { getCurrentWorkspace } from './session';

export interface PresetInput {
  id?: string;
  name: string;
  slug?: string;
  description?: string;
  systemPrompt?: string;
  config: PresetConfig;
}

export interface SavePresetState {
  ok: boolean;
  error?: string;
  id?: string;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'preset'
  );
}

export async function savePreset(input: PresetInput): Promise<SavePresetState> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Name is required.' };

  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected.' };
  const db = getHttpDb();

  const base = input.slug?.trim() ? slugify(input.slug) : slugify(name);
  const existing = await db
    .select({ id: presets.id, slug: presets.slug })
    .from(presets)
    .where(eq(presets.workspaceId, ctx.workspace.id));
  const taken = new Set(existing.filter((e) => e.id !== input.id).map((e) => e.slug));
  let slug = base;
  let n = 1;
  while (taken.has(slug)) slug = `${base}-${n++}`;

  const values = {
    name: name.slice(0, 80),
    slug,
    description: input.description?.trim() || null,
    systemPrompt: input.systemPrompt?.trim() || null,
    config: input.config,
  };

  if (input.id) {
    await db
      .update(presets)
      .set(values)
      .where(and(eq(presets.id, input.id), eq(presets.workspaceId, ctx.workspace.id)));
    revalidatePath('/presets');
    revalidatePath(`/presets/${input.id}`);
    return { ok: true, id: input.id };
  }

  const inserted = await db
    .insert(presets)
    .values({ workspaceId: ctx.workspace.id, ...values })
    .returning({ id: presets.id });
  revalidatePath('/presets');
  return { ok: true, id: inserted[0]?.id };
}

export async function deletePreset(id: string): Promise<{ ok: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  const db = getHttpDb();
  await db.delete(presets).where(and(eq(presets.id, id), eq(presets.workspaceId, ctx.workspace.id)));
  revalidatePath('/presets');
  return { ok: true };
}
