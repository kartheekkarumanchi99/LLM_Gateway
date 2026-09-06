'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { encryptSecret, getHttpDb, isEncryptionConfigured, providerKeys } from '@llmgw/db/http';
import { getCurrentOrg } from './session';

export interface AddKeyState {
  ok: boolean;
  error?: string;
}

export async function addProviderKey(
  _prev: AddKeyState | null,
  formData: FormData,
): Promise<AddKeyState> {
  const providerSlug = String(formData.get('provider') ?? '').trim().toLowerCase();
  const label = String(formData.get('label') ?? '').trim();
  const secret = String(formData.get('secret') ?? '').trim();

  if (!providerSlug) return { ok: false, error: 'Choose a provider.' };
  if (!secret) return { ok: false, error: 'Paste your provider API key.' };
  if (!isEncryptionConfigured()) {
    return { ok: false, error: 'Set BYOK_ENCRYPTION_KEY in .env to store provider keys securely.' };
  }

  const org = await getCurrentOrg();
  if (!org) return { ok: false, error: 'No database connected.' };

  const db = getHttpDb();
  await db.insert(providerKeys).values({
    orgId: org.id,
    providerSlug,
    label: (label || `${providerSlug} key`).slice(0, 80),
    encryptedKey: encryptSecret(secret),
  });

  revalidatePath('/byok');
  return { ok: true };
}

export async function deleteProviderKey(id: string): Promise<{ ok: boolean }> {
  const org = await getCurrentOrg();
  if (!org) return { ok: false };
  const db = getHttpDb();
  await db.delete(providerKeys).where(and(eq(providerKeys.id, id), eq(providerKeys.orgId, org.id)));
  revalidatePath('/byok');
  return { ok: true };
}
