import { creditLedger, getDb, usageEvents } from '@llmgw/db';

export interface RecordParams {
  requestId: string;
  workspaceId?: string | null;
  apiKeyId?: string | null;
  orgId?: string | null;
  modelSlug: string;
  providerSlug: string;
  taskClass?: string | null;
  status: 'success' | 'error';
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptPricePerM: string;
  completionPricePerM: string;
  latencyMs: number;
  byok?: boolean;
  appName?: string | null;
  cachedTokens?: number;
  reasoningTokens?: number;
  finishReason?: string | null;
  ttftMs?: number | null;
  routingOverheadMs?: number | null;
  routingTrace?: unknown;
}

/**
 * Records a usage event and debits the org ledger in one transaction.
 * Idempotent on requestId: a duplicate request is a no-op (no double charge).
 * Never throws — a billing failure must not break the response path.
 */
export async function recordUsage(p: RecordParams): Promise<number> {
  const cost =
    (p.promptTokens / 1_000_000) * Number(p.promptPricePerM) +
    (p.completionTokens / 1_000_000) * Number(p.completionPricePerM);
  const costStr = cost.toFixed(10);

  try {
    const db = getDb();
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(usageEvents)
        .values({
          requestId: p.requestId,
          workspaceId: p.workspaceId ?? null,
          apiKeyId: p.apiKeyId ?? null,
          modelSlug: p.modelSlug,
          providerSlug: p.providerSlug,
          taskClass: p.taskClass ?? null,
          status: p.status,
          promptTokens: p.promptTokens,
          completionTokens: p.completionTokens,
          totalTokens: p.totalTokens,
          costUsd: costStr,
          latencyMs: p.latencyMs,
          byok: p.byok ?? false,
          appName: p.appName ?? null,
          cachedTokens: p.cachedTokens ?? 0,
          reasoningTokens: p.reasoningTokens ?? 0,
          finishReason: p.finishReason ?? null,
          ttftMs: p.ttftMs ?? null,
          routingOverheadMs: p.routingOverheadMs ?? null,
          routingTrace: (p.routingTrace ?? null) as object | null,
        })
        .onConflictDoNothing({ target: usageEvents.requestId })
        .returning({ id: usageEvents.id });

      // Duplicate request id → already billed, stop here.
      if (inserted.length === 0) return;

      if (p.orgId && cost > 0 && p.status === 'success') {
        await tx.insert(creditLedger).values({
          orgId: p.orgId,
          entryType: 'debit',
          amountUsd: (-cost).toFixed(10),
          ref: p.requestId,
        });
      }
    });
  } catch (err) {
    console.error('[billing] recordUsage failed:', (err as Error).message);
  }

  return cost;
}
