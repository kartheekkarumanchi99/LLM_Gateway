'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getHttpDb, workspaces } from '@llmgw/db/http';
import { getCurrentOrg } from './session';

export interface ActionState {
  ok: boolean;
  error?: string;
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'workspace'
  );
}

export async function createWorkspace(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const budgetRaw = String(formData.get('budget') ?? '').trim();

  if (!name) return { ok: false, error: 'Name is required.' };
  if (name.length > 80) return { ok: false, error: 'Name must be 80 characters or fewer.' };
  if (description.length > 500) {
    return { ok: false, error: 'Description must be 500 characters or fewer.' };
  }

  let budgetLimitUsd: string | null = null;
  if (budgetRaw) {
    const n = Number(budgetRaw);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: 'Budget must be a positive number.' };
    }
    budgetLimitUsd = String(n);
  }

  const org = await getCurrentOrg();
  if (!org) {
    return { ok: false, error: 'No database connected. Set DATABASE_URL, then run db:push and db:seed.' };
  }
  const db = getHttpDb();

  // Ensure a unique slug within the org (neon-http has no transactions).
  const base = slugify(name);
  const existing = await db
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.orgId, org.id));
  const taken = new Set(existing.map((r) => r.slug));
  let slug = base;
  let n = 1;
  while (taken.has(slug)) slug = `${base}-${n++}`;

  await db.insert(workspaces).values({
    orgId: org.id,
    name,
    slug,
    description: description || null,
    budgetLimitUsd,
  });

  revalidatePath('/');
  return { ok: true };
}
