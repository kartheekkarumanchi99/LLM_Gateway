import { and, desc, eq, gte } from 'drizzle-orm';
import { apiKeys, getHttpDb, usageEvents, workspaces } from '@llmgw/db/http';

export interface GenerationRow {
  requestId: string;
  createdAt: string;
  modelSlug: string;
  providerSlug: string;
  appName: string | null;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  byok: boolean;
  status: string;
  latencyMs: number;
  ttftMs: number | null;
  routingOverheadMs: number | null;
  finishReason: string | null;
  keyName: string | null;
}
export interface UpstreamRow {
  requestId: string;
  createdAt: string;
  modelSlug: string;
  providerSlug: string;
  status: string;
  attempts: number;
  keyName: string | null;
  latencyMs: number;
}

export async function getLogs(
  orgId: string,
  days: number,
): Promise<{ generations: GenerationRow[]; upstream: UpstreamRow[] }> {
  const db = getHttpDb();
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      requestId: usageEvents.requestId,
      createdAt: usageEvents.createdAt,
      modelSlug: usageEvents.modelSlug,
      providerSlug: usageEvents.providerSlug,
      appName: usageEvents.appName,
      promptTokens: usageEvents.promptTokens,
      completionTokens: usageEvents.completionTokens,
      costUsd: usageEvents.costUsd,
      byok: usageEvents.byok,
      status: usageEvents.status,
      latencyMs: usageEvents.latencyMs,
      ttftMs: usageEvents.ttftMs,
      routingOverheadMs: usageEvents.routingOverheadMs,
      finishReason: usageEvents.finishReason,
      routingTrace: usageEvents.routingTrace,
      keyName: apiKeys.name,
    })
    .from(usageEvents)
    .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
    .leftJoin(apiKeys, eq(usageEvents.apiKeyId, apiKeys.id))
    .where(and(eq(workspaces.orgId, orgId), gte(usageEvents.createdAt, since)))
    .orderBy(desc(usageEvents.createdAt))
    .limit(200);

  const generations: GenerationRow[] = rows.map((r) => ({
    requestId: r.requestId,
    createdAt: r.createdAt.toISOString(),
    modelSlug: r.modelSlug,
    providerSlug: r.providerSlug,
    appName: r.appName,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    costUsd: Number(r.costUsd),
    byok: r.byok,
    status: r.status,
    latencyMs: r.latencyMs,
    ttftMs: r.ttftMs,
    routingOverheadMs: r.routingOverheadMs,
    finishReason: r.finishReason,
    keyName: r.keyName,
  }));

  const upstream: UpstreamRow[] = rows.map((r) => {
    const trace = r.routingTrace as { attempts?: unknown[] } | null;
    const attempts = Array.isArray(trace?.attempts) && trace!.attempts.length > 0 ? trace!.attempts.length : 1;
    return {
      requestId: r.requestId,
      createdAt: r.createdAt.toISOString(),
      modelSlug: r.modelSlug,
      providerSlug: r.providerSlug,
      status: r.status === 'success' ? '200' : '502',
      attempts,
      keyName: r.keyName,
      latencyMs: r.latencyMs,
    };
  });

  return { generations, upstream };
}
