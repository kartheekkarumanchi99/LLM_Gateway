import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { apiKeys, getDb, workspaces } from '@llmgw/db';
import { createTtlCache } from './cache/memo';

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

// Short-TTL cache keyed by the API key hash: per-request auth becomes ~zero DB reads
// under load (single-flight coalesces bursts). Revocation lag is bounded by the TTL;
// expiry + credit limits are still enforced per-request from the cached context.
const authCache = createTtlCache<string, AuthContext | null>(loadAuthByHash, {
  ttlMs: 10_000,
  maxEntries: 20_000,
});

export async function authenticate(authHeader?: string): Promise<AuthContext | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const key = authHeader.slice(7).trim();
  if (!key) return null;
  return authCache.get(hashKey(key));
}

async function loadAuthByHash(keyHash: string): Promise<AuthContext | null> {
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
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  const row = rows[0];
  if (!row || row.revokedAt) return null;

  // Refresh last-used only on a cache miss (fire-and-forget), not every request.
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
