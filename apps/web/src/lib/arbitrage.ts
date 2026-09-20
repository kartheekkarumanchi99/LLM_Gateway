import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  arbitrageSettings,
  byokLimits,
  capacityLoans,
  DEFAULT_ARBITRAGE_SETTINGS,
  getHttpDb,
  models,
  normalizeArbitrageSettings,
  organizations,
  SPOT_REFERENCE,
  usageEvents,
  workspaces,
  type ArbitrageSettings,
} from '@llmgw/db/http';
import { ensurePlaygroundKey, GATEWAY_URL } from './playground';

export interface ByokLimitRow {
  provider: string;
  tpmLimit: number;
  rpmLimit: number;
  shareable: boolean;
  tier: string | null;
}

export interface LiveProvider {
  provider: string;
  tpmLimit: number;
  rpmLimit: number;
  shareable: boolean;
  tier: string | null;
  tpmUsed: number;
  rpmUsed: number;
  tpmHeadroom: number | null;
  utilizationPct: number;
  throttled: boolean;
}

export interface LoanRow {
  id: string;
  direction: 'borrowed' | 'lent';
  counterparty: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  providerCostUsd: number;
  transferPriceUsd: number;
  marginUsd: number;
  createdAt: string;
}

export interface SpotRow {
  provider: string;
  name: string;
  cheapestModel: string | null;
  blendedPerM: number;
  keyed: boolean;
  latencyMs: number | null;
  note: string | null;
}

export interface ArbitrageData {
  settings: ArbitrageSettings;
  limits: ByokLimitRow[];
  live: LiveProvider[] | null;
  connected: boolean;
  loans: LoanRow[];
  totals: { borrowedCount: number; lentCount: number; spentUsd: number; earnedUsd: number; marginEarnedUsd: number };
  spot: SpotRow[];
}

async function fetchLive(workspaceId: string): Promise<LiveProvider[] | null> {
  try {
    const key = await ensurePlaygroundKey(workspaceId);
    const res = await fetch(`${GATEWAY_URL}/v1/arbitrage/status`, {
      headers: { authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { providers?: LiveProvider[] };
    return json.providers ?? [];
  } catch {
    return null;
  }
}

export async function getArbitrageSettings(orgId: string): Promise<ArbitrageSettings> {
  const rows = await getHttpDb().select().from(arbitrageSettings).where(eq(arbitrageSettings.orgId, orgId)).limit(1);
  const r = rows[0];
  if (!r) return DEFAULT_ARBITRAGE_SETTINGS;
  return normalizeArbitrageSettings({
    enabled: r.enabled,
    contribute: r.contribute,
    consume: r.consume,
    marginPct: Number(r.marginPct),
    maxShareTpm: r.maxShareTpm,
  });
}

async function buildSpot(orgId: string): Promise<SpotRow[]> {
  const db = getHttpDb();
  // Cheapest executable model per provider (blended prompt/completion price) + p50 latency.
  const rows = await db
    .select({
      provider: models.providerSlug,
      blended: sql<number>`min((${models.promptPricePerM} + ${models.completionPricePerM}) / 2)::float8`,
      cheapest: sql<string>`(array_agg(${models.slug} order by (${models.promptPricePerM} + ${models.completionPricePerM})))[1]`,
    })
    .from(models)
    .where(and(eq(models.executable, true), eq(models.active, true)))
    .groupBy(models.providerSlug);

  const since = new Date(Date.now() - 24 * 3_600_000);
  const lat = await db
    .select({
      provider: usageEvents.providerSlug,
      p50: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${usageEvents.latencyMs}) filter (where ${usageEvents.status} = 'success'),0)::float8`,
    })
    .from(usageEvents)
    .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
    .where(and(eq(workspaces.orgId, orgId), gte(usageEvents.createdAt, since)))
    .groupBy(usageEvents.providerSlug);
  const latMap = new Map(lat.map((l) => [l.provider, Number(l.p50)]));

  const keyed: SpotRow[] = rows.map((r) => ({
    provider: r.provider,
    name: r.provider,
    cheapestModel: r.cheapest,
    blendedPerM: Number(r.blended),
    keyed: true,
    latencyMs: latMap.get(r.provider) ? Math.round(latMap.get(r.provider)!) : null,
    note: null,
  }));
  const reference: SpotRow[] = SPOT_REFERENCE.map((s) => ({
    provider: s.slug,
    name: s.name,
    cheapestModel: null,
    blendedPerM: (s.promptPerM + s.completionPerM) / 2,
    keyed: false,
    latencyMs: null,
    note: s.note,
  }));
  return [...keyed, ...reference].sort((a, b) => a.blendedPerM - b.blendedPerM);
}

export async function getArbitrageData(orgId: string, workspaceId: string): Promise<ArbitrageData> {
  const db = getHttpDb();

  const [settings, limitRows, borrowed, lent, spot, live] = await Promise.all([
    getArbitrageSettings(orgId),
    db.select().from(byokLimits).where(eq(byokLimits.orgId, orgId)),
    db
      .select()
      .from(capacityLoans)
      .where(eq(capacityLoans.borrowerOrgId, orgId))
      .orderBy(desc(capacityLoans.createdAt))
      .limit(50),
    db
      .select()
      .from(capacityLoans)
      .where(eq(capacityLoans.lenderOrgId, orgId))
      .orderBy(desc(capacityLoans.createdAt))
      .limit(50),
    buildSpot(orgId),
    fetchLive(workspaceId),
  ]);

  // Resolve counterparty org names.
  const counterpartyIds = [
    ...new Set([...borrowed.map((l) => l.lenderOrgId), ...lent.map((l) => l.borrowerOrgId)]),
  ];
  const orgNames = new Map<string, string>();
  if (counterpartyIds.length > 0) {
    const orgs = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(inArray(organizations.id, counterpartyIds));
    for (const o of orgs) orgNames.set(o.id, o.name);
  }

  const loans: LoanRow[] = [
    ...borrowed.map((l) => ({
      id: l.id,
      direction: 'borrowed' as const,
      counterparty: orgNames.get(l.lenderOrgId) ?? l.lenderOrgId.slice(0, 8),
      provider: l.provider,
      model: l.model,
      promptTokens: l.promptTokens,
      completionTokens: l.completionTokens,
      providerCostUsd: Number(l.providerCostUsd),
      transferPriceUsd: Number(l.transferPriceUsd),
      marginUsd: Number(l.marginUsd),
      createdAt: new Date(l.createdAt).toISOString(),
    })),
    ...lent.map((l) => ({
      id: l.id,
      direction: 'lent' as const,
      counterparty: orgNames.get(l.borrowerOrgId) ?? l.borrowerOrgId.slice(0, 8),
      provider: l.provider,
      model: l.model,
      promptTokens: l.promptTokens,
      completionTokens: l.completionTokens,
      providerCostUsd: Number(l.providerCostUsd),
      transferPriceUsd: Number(l.transferPriceUsd),
      marginUsd: Number(l.marginUsd),
      createdAt: new Date(l.createdAt).toISOString(),
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const totals = {
    borrowedCount: borrowed.length,
    lentCount: lent.length,
    spentUsd: borrowed.reduce((a, l) => a + Number(l.transferPriceUsd), 0),
    earnedUsd: lent.reduce((a, l) => a + Number(l.transferPriceUsd), 0),
    marginEarnedUsd: lent.reduce((a, l) => a + Number(l.marginUsd), 0),
  };

  return {
    settings,
    limits: limitRows.map((r) => ({ provider: r.provider, tpmLimit: r.tpmLimit, rpmLimit: r.rpmLimit, shareable: r.shareable, tier: r.tier })),
    live,
    connected: live !== null,
    loans: loans.slice(0, 60),
    totals,
    spot,
  };
}
