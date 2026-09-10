'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getHttpDb, traceAnnotations } from '@llmgw/db/http';
import { ensurePlaygroundKey, GATEWAY_URL } from './playground';
import { getCurrentWorkspace } from './session';
import { getTrace } from './traces';

export interface ReplayResult {
  model: string;
  content: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  chosenModel: string | null;
  error: string | null;
}

export interface ReplayState {
  ok: boolean;
  error?: string;
  results?: ReplayResult[];
}

interface GatewayChatResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown };
  model?: unknown;
  _routing?: { chosen?: unknown };
  error?: { message?: unknown };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Re-run a captured request against one or more models with the response cache
// bypassed, so you get fresh, comparable outputs + live cost/latency.
export async function replayTrace(traceId: string, models: string[]): Promise<ReplayState> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No workspace connected.' };

  const trace = await getTrace(ctx.workspace.id, traceId);
  if (!trace) return { ok: false, error: 'Trace not found.' };
  if (!trace.replayMessages || !Array.isArray(trace.replayMessages)) {
    return {
      ok: false,
      error:
        'No stored prompt to replay. Enable Observability request logging so inputs are captured, then run the request again.',
    };
  }

  const targets = (models.length > 0 ? models : [trace.replayModel ?? 'openai/gpt-4o-mini'])
    .filter((m) => m && m.trim())
    .slice(0, 4);
  if (targets.length === 0) return { ok: false, error: 'Choose at least one model to replay against.' };

  let key: string;
  try {
    key = await ensurePlaygroundKey(ctx.workspace.id);
  } catch (err) {
    return { ok: false, error: 'Could not create a gateway key: ' + (err as Error).message };
  }

  const results = await Promise.all(
    targets.map(async (model): Promise<ReplayResult> => {
      const started = Date.now();
      try {
        const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${key}`,
            'content-type': 'application/json',
            'x-title': 'Time Machine replay',
          },
          body: JSON.stringify({ model, messages: trace.replayMessages, cache: false }),
        });
        const latencyMs = Date.now() - started;
        const json = (await res.json()) as GatewayChatResponse;
        if (!res.ok) {
          return {
            model,
            content: '',
            promptTokens: 0,
            completionTokens: 0,
            costUsd: 0,
            latencyMs,
            chosenModel: null,
            error: typeof json?.error?.message === 'string' ? json.error.message : `Gateway error ${res.status}`,
          };
        }
        const content = json.choices?.[0]?.message?.content;
        return {
          model,
          content: typeof content === 'string' ? content : '',
          promptTokens: num(json.usage?.prompt_tokens),
          completionTokens: num(json.usage?.completion_tokens),
          costUsd: num(json.usage?.cost),
          latencyMs,
          chosenModel: typeof json._routing?.chosen === 'string' ? json._routing.chosen : (typeof json.model === 'string' ? json.model : null),
          error: null,
        };
      } catch (err) {
        return {
          model,
          content: '',
          promptTokens: 0,
          completionTokens: 0,
          costUsd: 0,
          latencyMs: Date.now() - started,
          chosenModel: null,
          error: (err as Error).message,
        };
      }
    }),
  );

  return { ok: true, results };
}

async function upsertAnnotation(
  workspaceId: string,
  traceId: string,
  patch: { starred?: boolean; note?: string | null },
): Promise<void> {
  const db = getHttpDb();
  await db
    .insert(traceAnnotations)
    .values({
      workspaceId,
      traceId,
      starred: patch.starred ?? false,
      note: patch.note ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [traceAnnotations.workspaceId, traceAnnotations.traceId],
      set: {
        ...(patch.starred !== undefined ? { starred: patch.starred } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        updatedAt: new Date(),
      },
    });
}

export async function toggleTraceStar(traceId: string): Promise<{ ok: boolean; starred?: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  const db = getHttpDb();
  const existing = await db
    .select({ starred: traceAnnotations.starred })
    .from(traceAnnotations)
    .where(and(eq(traceAnnotations.workspaceId, ctx.workspace.id), eq(traceAnnotations.traceId, traceId)))
    .limit(1);
  const next = !(existing[0]?.starred ?? false);
  await upsertAnnotation(ctx.workspace.id, traceId, { starred: next });
  revalidatePath('/traces');
  revalidatePath(`/traces/${traceId}`);
  return { ok: true, starred: next };
}

export async function saveTraceNote(traceId: string, note: string): Promise<{ ok: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  await upsertAnnotation(ctx.workspace.id, traceId, { note: note.trim() || null });
  revalidatePath(`/traces/${traceId}`);
  return { ok: true };
}
