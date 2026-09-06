import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { apiKeys, getDb, workspaces } from '@llmgw/db';

export interface AuthContext {
  apiKeyId: string;
  workspaceId: string;
  orgId: string;
  expiresAt: Date | null;
  creditLimitUsd: string | null;
  creditLimitInterval: string | null;
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function authenticate(authHeader?: string): Promise<AuthContext | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const key = authHeader.slice(7).trim();
  if (!key) return null;

  const db = getDb();
  const rows = await db
    .select({
      apiKeyId: apiKeys.id,
      workspaceId: apiKeys.workspaceId,
      revokedAt: apiKeys.revokedAt,
      expiresAt: apiKeys.expiresAt,
      creditLimitUsd: apiKeys.creditLimitUsd,
      creditLimitInterval: apiKeys.creditLimitInterval,
      orgId: workspaces.orgId,
    })
    .from(apiKeys)
    .innerJoin(workspaces, eq(apiKeys.workspaceId, workspaces.id))
    .where(eq(apiKeys.keyHash, hashKey(key)))
    .limit(1);

  const row = rows[0];
  if (!row || row.revokedAt) return null;

  // Fire-and-forget; .execute() runs the query exactly once.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.apiKeyId))
    .execute()
    .catch(() => {});

  return {
    apiKeyId: row.apiKeyId,
    workspaceId: row.workspaceId,
    orgId: row.orgId,
    expiresAt: row.expiresAt,
    creditLimitUsd: row.creditLimitUsd,
    creditLimitInterval: row.creditLimitInterval,
  };
}
