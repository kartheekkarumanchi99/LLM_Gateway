import { and, desc, eq } from 'drizzle-orm';
import { PROVIDER_CATALOG, decryptSecret, getDb, providerKeys, providerMeta } from '@llmgw/db';

// Platform (shared) key for a provider, read from its catalog-declared env var.
function platformKey(slug: string): string {
  const meta = providerMeta(slug);
  return meta ? process.env[meta.envKey] ?? '' : '';
}

export function hasPlatformKey(slug: string): boolean {
  return platformKey(slug).length > 0;
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

// Providers with a usable key for this org: platform env keys (global) plus the org's
// BYOK providers. Routing gates on this so a newly-added key immediately lights up its
// models with no code changes.
export async function getKeyedProviders(orgId: string): Promise<Set<string>> {
  const keyed = new Set<string>();
  for (const meta of PROVIDER_CATALOG) {
    if ((process.env[meta.envKey] ?? '').length > 0) keyed.add(meta.slug);
  }
  try {
    const rows = await getDb()
      .selectDistinct({ providerSlug: providerKeys.providerSlug })
      .from(providerKeys)
      .where(eq(providerKeys.orgId, orgId));
    for (const r of rows) keyed.add(r.providerSlug);
  } catch (err) {
    console.error('[byok] keyed-provider lookup failed:', (err as Error).message);
  }
  return keyed;
}
