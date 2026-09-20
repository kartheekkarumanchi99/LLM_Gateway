'use server';

import { revalidatePath } from 'next/cache';
import { ensurePlaygroundKey, GATEWAY_URL } from './playground';
import { getCurrentWorkspace } from './session';

export interface ReplayFrame {
  nodeKey: string;
  role: string;
  modelBefore: string;
  modelAfter: string;
  paramsBefore: { temperature: number | null; topP: number | null; maxTokens: number; seed: number | null };
  paramsAfter: { temperature: number | null; topP: number | null; maxTokens: number; seed: number | null };
  inputMessages: unknown;
  outputBefore: string;
  outputAfter: string;
  changed: boolean;
  isOverride: boolean;
  costUsd: number;
  latencyMs: number;
  error?: string | null;
}

export interface ReplayResult {
  replayId: string;
  pattern: string;
  originalOutput: string;
  finalOutput: string;
  totalCostUsd: number;
  latencyMs: number;
  frames: ReplayFrame[];
  error?: string;
}

export interface ReplayOverrideInput {
  nodeKey: string;
  model?: string | null;
  temperature?: number | null;
  topP?: number | null;
  prompt?: string | null;
  seed?: number | null;
}

export async function runReplayAction(
  requestId: string,
  override: ReplayOverrideInput,
): Promise<{ ok: boolean; result?: ReplayResult; error?: string }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected.' };
  let key: string;
  try {
    key = await ensurePlaygroundKey(ctx.workspace.id);
  } catch (err) {
    return { ok: false, error: 'Could not create a gateway key: ' + (err as Error).message };
  }
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/replay`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        request_id: requestId,
        override: {
          node_key: override.nodeKey,
          model: override.model ?? undefined,
          temperature: override.temperature ?? undefined,
          top_p: override.topP ?? undefined,
          seed: override.seed ?? undefined,
          prompt: override.prompt ?? undefined,
        },
      }),
    });
    const json = (await res.json()) as unknown;
    if (!res.ok) {
      const e = (json as { error?: { message?: string } | string }).error;
      const msg = typeof e === 'object' ? e?.message : typeof e === 'string' ? e : undefined;
      return { ok: false, error: msg ?? `Gateway error ${res.status}` };
    }
    revalidatePath(`/replay/${requestId}`);
    return { ok: true, result: json as ReplayResult };
  } catch (err) {
    return { ok: false, error: `Could not reach the gateway. ${(err as Error).message}` };
  }
}
