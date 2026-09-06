import { desc, eq } from 'drizzle-orm';
import { getHttpDb, managementKeys } from '@llmgw/db/http';

export interface ManagementKeyRow {
  id: string;
  name: string;
  hint: string;
  status: 'Active' | 'Revoked' | 'Expired';
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export async function listManagementKeys(orgId: string): Promise<ManagementKeyRow[]> {
  const db = getHttpDb();
  const rows = await db
    .select()
    .from(managementKeys)
    .where(eq(managementKeys.orgId, orgId))
    .orderBy(desc(managementKeys.createdAt));
  const now = Date.now();
  return rows.map((r) => {
    const status: ManagementKeyRow['status'] = r.revokedAt
      ? 'Revoked'
      : r.expiresAt && r.expiresAt.getTime() < now
        ? 'Expired'
        : 'Active';
    return {
      id: r.id,
      name: r.name,
      hint: `${r.keyPrefix}…${r.keyLast4}`,
      status,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}
