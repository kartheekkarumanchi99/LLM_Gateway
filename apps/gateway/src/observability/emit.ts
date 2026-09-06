import { decryptSecret, getDb, requestLogs, type ObservabilityConfig } from '@llmgw/db';
import type { ChatMessage } from '../providers/types';
import { getEnabledDestinations, type DestinationRecord } from './config';

export interface EmitParams {
  config: ObservabilityConfig;
  workspaceId: string;
  apiKeyId: string;
  requestId: string;
  modelSlug: string;
  providerSlug: string;
  taskClass: string;
  messages: ChatMessage[];
  completion: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
}

async function logRequest(p: EmitParams): Promise<void> {
  const db = getDb();
  await db.insert(requestLogs).values({
    workspaceId: p.workspaceId,
    apiKeyId: p.apiKeyId,
    requestId: p.requestId,
    modelSlug: p.modelSlug,
    providerSlug: p.providerSlug,
    taskClass: p.taskClass,
    messages: p.messages as unknown as object,
    completion: p.completion,
    promptTokens: p.promptTokens,
    completionTokens: p.completionTokens,
    costUsd: p.costUsd.toFixed(10),
  });
}

function safeDecrypt(enc: string): string | null {
  try {
    return decryptSecret(enc);
  } catch {
    return null;
  }
}

async function broadcast(dest: DestinationRecord, p: EmitParams): Promise<void> {
  if (!dest.baseUrl) return;
  const payload: Record<string, unknown> = {
    request_id: p.requestId,
    timestamp: new Date().toISOString(),
    workspace_id: p.workspaceId,
    model: p.modelSlug,
    provider: p.providerSlug,
    task_class: p.taskClass,
    usage: { prompt_tokens: p.promptTokens, completion_tokens: p.completionTokens, cost_usd: p.costUsd },
    latency_ms: p.latencyMs,
  };
  // Privacy mode omits prompt + completion content.
  if (!dest.privacyMode) {
    payload.messages = p.messages;
    payload.completion = p.completion;
  }
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(dest.headers ?? {}) };
  const apiKey = dest.apiKeyEnc ? safeDecrypt(dest.apiKeyEnc) : null;
  if (apiKey && !headers.authorization && !headers.Authorization) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  await fetch(dest.baseUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
}

// Fire-and-forget: logs the request and/or broadcasts a sampled trace.
export async function emitObservability(p: EmitParams): Promise<void> {
  try {
    if (p.config.inputOutputLogging) {
      await logRequest(p).catch((e) => console.error('[obs] log failed:', (e as Error).message));
    }
    if (p.config.broadcast) {
      const dests = await getEnabledDestinations(p.workspaceId);
      for (const d of dests) {
        if (Math.random() > Number(d.samplingRate)) continue;
        void broadcast(d, p).catch((e) => console.error('[obs] broadcast failed:', (e as Error).message));
      }
    }
  } catch (e) {
    console.error('[obs] emit failed:', (e as Error).message);
  }
}
