'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import {
  encryptSecret,
  getHttpDb,
  observabilityDestinations,
  workspaceSettings,
  type ObservabilityConfig,
} from '@llmgw/db/http';
import { getCurrentWorkspace } from './session';

export async function saveObservabilityConfig(config: ObservabilityConfig): Promise<{ ok: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  const db = getHttpDb();
  const existing = await db
    .select({ id: workspaceSettings.id })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, ctx.workspace.id))
    .limit(1);
  if (existing.length) {
    await db
      .update(workspaceSettings)
      .set({ observability: config, updatedAt: new Date() })
      .where(eq(workspaceSettings.workspaceId, ctx.workspace.id));
  } else {
    await db.insert(workspaceSettings).values({ workspaceId: ctx.workspace.id, observability: config });
  }
  revalidatePath('/observability');
  return { ok: true };
}

export interface DestinationInput {
  id?: string;
  type: string;
  name: string;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string> | null;
  samplingRate: number;
  privacyMode: boolean;
  region: string;
  enabled: boolean;
}

export async function saveDestination(input: DestinationInput): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected.' };
  if (!input.name.trim()) return { ok: false, error: 'Name is required.' };

  const db = getHttpDb();
  const base = {
    type: input.type,
    name: input.name.trim().slice(0, 80),
    baseUrl: input.baseUrl?.trim() || null,
    headers: input.headers ?? null,
    samplingRate: String(Math.min(1, Math.max(0, input.samplingRate))),
    privacyMode: input.privacyMode,
    region: input.region,
    enabled: input.enabled,
  };

  if (input.id) {
    const patch: Record<string, unknown> = { ...base };
    if (input.apiKey && input.apiKey.trim()) patch.apiKeyEnc = encryptSecret(input.apiKey.trim());
    await db
      .update(observabilityDestinations)
      .set(patch)
      .where(
        and(
          eq(observabilityDestinations.id, input.id),
          eq(observabilityDestinations.workspaceId, ctx.workspace.id),
        ),
      );
    revalidatePath('/observability');
    return { ok: true };
  }

  await db.insert(observabilityDestinations).values({
    workspaceId: ctx.workspace.id,
    ...base,
    apiKeyEnc: input.apiKey?.trim() ? encryptSecret(input.apiKey.trim()) : null,
  });
  revalidatePath('/observability');
  return { ok: true };
}

export async function deleteDestination(id: string): Promise<{ ok: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  const db = getHttpDb();
  await db
    .delete(observabilityDestinations)
    .where(
      and(
        eq(observabilityDestinations.id, id),
        eq(observabilityDestinations.workspaceId, ctx.workspace.id),
      ),
    );
  revalidatePath('/observability');
  return { ok: true };
}
