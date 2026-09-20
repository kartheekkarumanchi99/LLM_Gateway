'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import {
  arbitrageSettings,
  byokLimits,
  getHttpDb,
  normalizeArbitrageSettings,
  type ArbitrageSettings,
} from '@llmgw/db/http';
import { getCurrentWorkspace } from './session';

export async function saveArbitrageSettings(
  input: Partial<ArbitrageSettings>,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected.' };
  const cfg = normalizeArbitrageSettings(input);
  const db = getHttpDb();
  const existing = await db
    .select({ id: arbitrageSettings.id })
    .from(arbitrageSettings)
    .where(eq(arbitrageSettings.orgId, ctx.org.id))
    .limit(1);
  if (existing.length) {
    await db
      .update(arbitrageSettings)
      .set({ ...cfg, marginPct: cfg.marginPct.toFixed(2), updatedAt: new Date() })
      .where(eq(arbitrageSettings.orgId, ctx.org.id));
  } else {
    await db.insert(arbitrageSettings).values({ orgId: ctx.org.id, ...cfg, marginPct: cfg.marginPct.toFixed(2) });
  }
  revalidatePath('/arbitrage');
  return { ok: true };
}

export async function saveByokLimit(input: {
  provider: string;
  tpmLimit: number;
  rpmLimit: number;
  shareable: boolean;
  tier?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected.' };
  const provider = input.provider.trim().toLowerCase();
  if (!provider) return { ok: false, error: 'Provider is required.' };
  const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);
  const values = {
    tpmLimit: clamp(input.tpmLimit),
    rpmLimit: clamp(input.rpmLimit),
    shareable: Boolean(input.shareable),
    tier: input.tier?.trim() || null,
  };
  const db = getHttpDb();
  const existing = await db
    .select({ id: byokLimits.id })
    .from(byokLimits)
    .where(and(eq(byokLimits.orgId, ctx.org.id), eq(byokLimits.provider, provider)))
    .limit(1);
  if (existing.length) {
    await db.update(byokLimits).set(values).where(and(eq(byokLimits.orgId, ctx.org.id), eq(byokLimits.provider, provider)));
  } else {
    await db.insert(byokLimits).values({ orgId: ctx.org.id, provider, ...values });
  }
  revalidatePath('/arbitrage');
  return { ok: true };
}

export async function deleteByokLimit(provider: string): Promise<{ ok: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  await getHttpDb()
    .delete(byokLimits)
    .where(and(eq(byokLimits.orgId, ctx.org.id), eq(byokLimits.provider, provider.toLowerCase())));
  revalidatePath('/arbitrage');
  return { ok: true };
}
