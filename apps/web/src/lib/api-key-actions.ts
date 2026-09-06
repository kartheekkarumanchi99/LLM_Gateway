'use server';

import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { apiKeys, getHttpDb } from '@llmgw/db/http';
import { getCurrentWorkspace } from './session';

export interface CreateKeyState {
  ok: boolean;
  error?: string;
  key?: string;
}

const VALID_INTERVALS = new Set(['total', 'day', 'week', 'month']);

function genKey() {
  const raw = 'sk-llmgw-' + randomBytes(24).toString('hex');
  return {
    raw,
    hash: createHash('sha256').update(raw).digest('hex'),
    prefix: raw.slice(0, 14),
    last4: raw.slice(-4),
  };
}

export async function createApiKey(
  _prev: CreateKeyState | null,
  formData: FormData,
): Promise<CreateKeyState> {
  const name = String(formData.get('name') ?? '').trim();
  const limitRaw = String(formData.get('limit') ?? '').trim();
  const intervalRaw = String(formData.get('interval') ?? 'total').trim();

  if (!name) return { ok: false, error: 'Name is required.' };
  if (name.length > 80) return { ok: false, error: 'Name must be 80 characters or fewer.' };

  let creditLimitUsd: string | null = null;
  if (limitRaw) {
    const n = Number(limitRaw);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'Limit must be a positive number.' };
    creditLimitUsd = String(n);
  }
  const interval = VALID_INTERVALS.has(intervalRaw) ? intervalRaw : 'total';

  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected. Set DATABASE_URL, then db:push + db:seed.' };

  const { raw, hash, prefix, last4 } = genKey();
  const db = getHttpDb();
  await db.insert(apiKeys).values({
    workspaceId: ctx.workspace.id,
    name,
    keyPrefix: prefix,
    keyLast4: last4,
    keyHash: hash,
    creditLimitUsd,
    creditLimitInterval: creditLimitUsd ? interval : null,
  });

  revalidatePath('/api-keys');
  return { ok: true, key: raw };
}

export async function renameApiKey(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Name is required.' };
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected.' };
  const db = getHttpDb();
  await db
    .update(apiKeys)
    .set({ name: trimmed.slice(0, 80) })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, ctx.workspace.id)));
  revalidatePath('/api-keys');
  return { ok: true };
}

export async function revokeApiKey(id: string): Promise<{ ok: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  const db = getHttpDb();
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, ctx.workspace.id)));
  revalidatePath('/api-keys');
  return { ok: true };
}

export async function deleteApiKey(id: string): Promise<{ ok: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  const db = getHttpDb();
  await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, ctx.workspace.id)));
  revalidatePath('/api-keys');
  return { ok: true };
}
