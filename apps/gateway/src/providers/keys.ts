import { and, desc, eq } from 'drizzle-orm';
import { PROVIDER_CATALOG, decryptSecret, getDb, providerKeys, providerMeta } from '@llmgw/db';
import { createTtlCache } from '../cache/memo';

// Platform (shared) key for a provider, read from its catalog-declared env var.
function platformKey(slug: string): string {
  const meta = providerMeta(slug);
  return meta ? process.env[meta.envKey] ?? '' : '';
}

export function hasPlatformKey(slug: string): boolean {
  return platformKey(slug).length > 0;
}

// BYOK first (org's decrypted key for this provider), else the platform key. Cached per
// (org, provider) with single-flight so the hot path (routing + every recovery leg)
// doesn't hit the DB on each request; a BYOK change takes effect within the TTL.
const keyCache = createTtlCache<string, { key: string; isByok: boolean }>(
  async (composite) => {
    const nl = composite.indexOf('\n');
    const orgId = composite.slice(0, nl);
    const providerSlug = composite.slice(nl + 1);
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
  },
  { ttlMs: 30_000, maxEntries: 5_000 },
);

export function resolveProviderKey(
  orgId: string,
  providerSlug: string,
): Promise<{ key: string; isByok: boolean }> {
  return keyCache.get(`${orgId}\n${providerSlug}`);
}

// Providers with a usable key for this org: platform env keys (global) plus the org's
// BYOK providers. Routing gates on this so a newly-added key immediately lights up its
// models with no code changes. Cached per org (single-flight) so it's not a per-request
// DB read.
const keyedProvidersCache = createTtlCache<string, Set<string>>(
  async (orgId) => {
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
  },
  { ttlMs: 30_000, maxEntries: 5_000 },
);

export function getKeyedProviders(orgId: string): Promise<Set<string>> {
  return keyedProvidersCache.get(orgId);
}
