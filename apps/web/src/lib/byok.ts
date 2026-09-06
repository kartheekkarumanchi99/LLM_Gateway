import { desc, eq } from 'drizzle-orm';
import { getHttpDb, providerKeys, providers } from '@llmgw/db/http';

export interface ProviderKeyRow {
  id: string;
  providerSlug: string;
  providerName: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function listProviderKeys(orgId: string): Promise<ProviderKeyRow[]> {
  const db = getHttpDb();
  const rows = await db
    .select({
      id: providerKeys.id,
      providerSlug: providerKeys.providerSlug,
      providerName: providers.displayName,
      label: providerKeys.label,
      createdAt: providerKeys.createdAt,
      lastUsedAt: providerKeys.lastUsedAt,
    })
    .from(providerKeys)
    .leftJoin(providers, eq(providers.slug, providerKeys.providerSlug))
    .where(eq(providerKeys.orgId, orgId))
    .orderBy(desc(providerKeys.createdAt));

  return rows.map((r) => ({
    id: r.id,
    providerSlug: r.providerSlug,
    providerName: r.providerName ?? r.providerSlug,
    label: r.label,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
  }));
}

export interface ProviderOption {
  slug: string;
  name: string;
}

export async function listProvidersForSelect(): Promise<ProviderOption[]> {
  const db = getHttpDb();
  const rows = await db
    .select({ slug: providers.slug, name: providers.displayName })
    .from(providers)
    .where(eq(providers.active, true))
    .orderBy(providers.displayName);
  return rows.map((r) => ({ slug: r.slug, name: r.name }));
}
