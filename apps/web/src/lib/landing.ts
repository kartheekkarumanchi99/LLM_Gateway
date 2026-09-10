import { eq, sql } from 'drizzle-orm';
import { getHttpDb, models, PROVIDER_CATALOG, usageEvents } from '@llmgw/db/http';

export interface LandingStats {
  models: number;
  providers: number;
  requests: number;
  connected: boolean;
}

// Real platform numbers for the landing page — never fabricated. Falls back to the
// static provider catalog when the database isn't connected.
export async function getLandingStats(): Promise<LandingStats> {
  const catalogProviders = PROVIDER_CATALOG.length;
  if (!process.env.DATABASE_URL) {
    return { models: 0, providers: catalogProviders, requests: 0, connected: false };
  }
  try {
    const db = getHttpDb();
    const [modelRows, providerRows, reqRows] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(models).where(eq(models.active, true)),
      db
        .select({ p: models.providerSlug })
        .from(models)
        .where(eq(models.active, true))
        .groupBy(models.providerSlug),
      db.select({ n: sql<number>`count(*)::int` }).from(usageEvents),
    ]);
    return {
      models: modelRows[0]?.n ?? 0,
      providers: Math.max(catalogProviders, providerRows.length),
      requests: reqRows[0]?.n ?? 0,
      connected: true,
    };
  } catch {
    return { models: 0, providers: catalogProviders, requests: 0, connected: false };
  }
}
