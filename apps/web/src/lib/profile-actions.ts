'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getHttpDb, users } from '@llmgw/db/http';
import { getCurrentUser } from './session';

export async function updateUserProfile(name: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCurrentUser();
  if (!ctx) return { ok: false, error: 'No database connected.' };
  if (!name.trim()) return { ok: false, error: 'Name is required.' };
  const db = getHttpDb();
  await db.update(users).set({ name: name.trim().slice(0, 120) }).where(eq(users.id, ctx.user.id));
  revalidatePath('/profile');
  return { ok: true };
}
