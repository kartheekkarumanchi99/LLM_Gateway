import { desc, eq, sql } from 'drizzle-orm';
import { apiKeys, getHttpDb, guardrails, usageEvents } from '@llmgw/db/http';

export interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  keyLast4: string | null;
  guardrailName: string | null;
  creditLimitUsd: string | null;
  creditLimitInterval: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  usageUsd: number;
}

export async function listApiKeys(workspaceId: string): Promise<ApiKeyRow[]> {
  const db = getHttpDb();
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      keyLast4: apiKeys.keyLast4,
      guardrailName: guardrails.name,
      creditLimitUsd: apiKeys.creditLimitUsd,
      creditLimitInterval: apiKeys.creditLimitInterval,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
      usageUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)::float8`,
    })
    .from(apiKeys)
    .leftJoin(guardrails, eq(apiKeys.guardrailId, guardrails.id))
    .leftJoin(usageEvents, eq(usageEvents.apiKeyId, apiKeys.id))
    .where(eq(apiKeys.workspaceId, workspaceId))
    .groupBy(apiKeys.id, guardrails.name)
    .orderBy(desc(apiKeys.createdAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    keyPrefix: r.keyPrefix,
    keyLast4: r.keyLast4,
    guardrailName: r.guardrailName,
    creditLimitUsd: r.creditLimitUsd,
    creditLimitInterval: r.creditLimitInterval,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    usageUsd: Number(r.usageUsd ?? 0),
  }));
}
