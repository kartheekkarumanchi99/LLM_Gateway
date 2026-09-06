'use server';

import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getHttpDb, managementKeys } from '@llmgw/db/http';
import { getCurrentUser } from './session';

function genKey() {
  const raw = 'sk-llmgw-mgmt-' + randomBytes(24).toString('hex');
  return {
    raw,
    hash: createHash('sha256').update(raw).digest('hex'),
    prefix: raw.slice(0, 18),
    last4: raw.slice(-4),
  };
}

export async function createManagementKey(
  name: string,
  expiresInDays: number | null,
): Promise<{ ok: boolean; error?: string; key?: string }> {
  const ctx = await getCurrentUser();
  if (!ctx) return { ok: false, error: 'No database connected.' };
  if (!name.trim()) return { ok: false, error: 'Name is required.' };

  let expiresAt: Date | null = null;
  if (expiresInDays != null) {
    if (!Number.isFinite(expiresInDays) || expiresInDays <= 0) {
      return { ok: false, error: 'Expiry must be a positive number of days.' };
    }
    expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);
  }

  const { raw, hash, prefix, last4 } = genKey();
  const db = getHttpDb();
  await db.insert(managementKeys).values({
    orgId: ctx.org.id,
    name: name.trim().slice(0, 80),
    keyPrefix: prefix,
    keyLast4: last4,
    keyHash: hash,
    expiresAt,
  });
  revalidatePath('/management-keys');
  return { ok: true, key: raw };
}

export async function revokeManagementKey(id: string): Promise<{ ok: boolean }> {
  const ctx = await getCurrentUser();
  if (!ctx) return { ok: false };
  const db = getHttpDb();
  await db
    .update(managementKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(managementKeys.id, id), eq(managementKeys.orgId, ctx.org.id)));
  revalidatePath('/management-keys');
  return { ok: true };
}

export async function deleteManagementKey(id: string): Promise<{ ok: boolean }> {
  const ctx = await getCurrentUser();
  if (!ctx) return { ok: false };
  const db = getHttpDb();
  await db
    .delete(managementKeys)
    .where(and(eq(managementKeys.id, id), eq(managementKeys.orgId, ctx.org.id)));
  revalidatePath('/management-keys');
  return { ok: true };
}
