'use server';

import { revalidatePath } from 'next/cache';
import { ensurePlaygroundKey, GATEWAY_URL } from './playground';
import { getCurrentWorkspace } from './session';

export async function resetProviderBreaker(provider?: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No workspace connected.' };
  try {
    const key = await ensurePlaygroundKey(ctx.workspace.id);
    const res = await fetch(`${GATEWAY_URL}/v1/health/reset`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(provider ? { provider } : {}),
    });
    if (!res.ok) return { ok: false, error: `Gateway error ${res.status}` };
    revalidatePath('/status');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
