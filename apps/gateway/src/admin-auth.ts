import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, managementKeys } from '@llmgw/db';

export interface AdminContext {
  orgId: string;
  managementKeyId: string;
}

// Authenticates a management key (admin API only — cannot make model requests,
// since chat auth checks the separate api_keys table).
export async function authenticateManagement(authHeader?: string): Promise<AdminContext | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const key = authHeader.slice(7).trim();
  if (!key) return null;
  const hash = createHash('sha256').update(key).digest('hex');

  const db = getDb();
  const rows = await db
    .select({
      id: managementKeys.id,
      orgId: managementKeys.orgId,
      revokedAt: managementKeys.revokedAt,
      expiresAt: managementKeys.expiresAt,
    })
    .from(managementKeys)
    .where(eq(managementKeys.keyHash, hash))
    .limit(1);

  const row = rows[0];
  if (!row || row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

  void db
    .update(managementKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(managementKeys.id, row.id))
    .execute()
    .catch(() => {});

  return { orgId: row.orgId, managementKeyId: row.id };
}
