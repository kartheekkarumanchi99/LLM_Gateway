import { and, desc, eq } from 'drizzle-orm';
import { decryptSecret, getDb, providerKeys } from '@llmgw/db';
import { config } from '../config';

function platformKey(slug: string): string {
  if (slug === 'openai') return config.openaiApiKey;
  if (slug === 'anthropic') return config.anthropicApiKey;
  return '';
}

// BYOK first: the org's stored key for this provider (decrypted); else the platform key.
export async function resolveProviderKey(
  orgId: string,
  providerSlug: string,
): Promise<{ key: string; isByok: boolean }> {
  try {
    const db = getDb();
    const rows = await db
      .select({ id: providerKeys.id, enc: providerKeys.encryptedKey })
      .from(providerKeys)
      .where(and(eq(providerKeys.orgId, orgId), eq(providerKeys.providerSlug, providerSlug)))
      .orderBy(desc(providerKeys.createdAt))
      .limit(1);
    const row = rows[0];
    if (row) {
      void db
        .update(providerKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(providerKeys.id, row.id))
        .execute()
        .catch(() => {});
      return { key: decryptSecret(row.enc), isByok: true };
    }
  } catch (err) {
    console.error('[byok] key resolution failed:', (err as Error).message);
  }
  return { key: platformKey(providerSlug), isByok: false };
}
