import { eq } from 'drizzle-orm';
import {
  arbitrageSettings,
  byokLimits,
  DEFAULT_ARBITRAGE_SETTINGS,
  getDb,
  type ArbitrageSettings,
  type ByokLimit,
} from '@llmgw/db';
import { createTtlCache } from '../cache/memo';

const settingsCache = createTtlCache<string, ArbitrageSettings>(
  async (orgId) => {
    try {
      const rows = await getDb()
        .select()
        .from(arbitrageSettings)
        .where(eq(arbitrageSettings.orgId, orgId))
        .limit(1);
      const r = rows[0];
      if (!r) return DEFAULT_ARBITRAGE_SETTINGS;
      return {
        enabled: r.enabled,
        contribute: r.contribute,
        consume: r.consume,
        marginPct: Number(r.marginPct),
        maxShareTpm: r.maxShareTpm,
      };
    } catch {
      return DEFAULT_ARBITRAGE_SETTINGS;
    }
  },
  { ttlMs: 20_000, maxEntries: 5_000 },
);

export function getArbitrageSettings(orgId: string): Promise<ArbitrageSettings> {
  return settingsCache.get(orgId);
}

const limitsCache = createTtlCache<string, Map<string, ByokLimit>>(
  async (orgId) => {
    const map = new Map<string, ByokLimit>();
    try {
      const rows = await getDb().select().from(byokLimits).where(eq(byokLimits.orgId, orgId));
      for (const r of rows) {
        map.set(r.provider, {
          provider: r.provider,
          tpmLimit: r.tpmLimit,
          rpmLimit: r.rpmLimit,
          shareable: r.shareable,
          tier: r.tier,
        });
      }
    } catch {
      /* empty */
    }
    return map;
  },
  { ttlMs: 20_000, maxEntries: 5_000 },
);

export function getByokLimits(orgId: string): Promise<Map<string, ByokLimit>> {
  return limitsCache.get(orgId);
}

export async function getByokLimit(orgId: string, provider: string): Promise<ByokLimit | null> {
  return (await getByokLimits(orgId)).get(provider) ?? null;
}
