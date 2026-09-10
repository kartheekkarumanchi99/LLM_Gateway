import { and, eq, gte, sql } from 'drizzle-orm';
import { getHttpDb, PROVIDER_CATALOG, usageEvents, workspaces } from '@llmgw/db/http';
import { ensurePlaygroundKey, GATEWAY_URL } from './playground';

export type BreakerState = 'closed' | 'open' | 'half_open' | 'unknown';

export interface LiveHealth {
  breaker: BreakerState;
  sampleCount: number;
  successRate: number;
  errorRate: number;
  rateLimitRate: number;
  p50Ms: number;
  p95Ms: number;
  lastOutcomeAt: number | null;
}

export interface HourBucket {
  hour: string;
  requests: number;
  errors: number;
}

export interface ProviderStatus {
  provider: string;
  displayName: string;
  breaker: BreakerState;
  live: LiveHealth | null;
  history: { requests: number; successRate: number; errorRate: number; p50Ms: number; p95Ms: number };
  hourly: HourBucket[];
}

export interface ReliabilityData {
  providers: ProviderStatus[];
  slaUptime: number; // 0..1 across all providers over the window
  totalRequests: number;
  gatewayReachable: boolean;
}

const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  'x-ai': 'xAI',
  mistralai: 'Mistral AI',
  google: 'Google',
  moonshotai: 'Moonshot AI',
  perplexity: 'Perplexity',
};

function displayName(slug: string): string {
  return (
    PROVIDER_NAMES[slug] ??
    slug
      .split(/[-_]/)
      .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
      .join(' ')
  );
}

interface LiveProvider {
  provider: string;
  breaker: BreakerState;
  sampleCount: number;
  successRate: number;
  errorRate: number;
  rateLimitRate: number;
  p50Ms: number;
  p95Ms: number;
  lastOutcomeAt: number | null;
}

async function fetchLive(workspaceId: string): Promise<Map<string, LiveProvider> | null> {
  try {
    const key = await ensurePlaygroundKey(workspaceId);
    const res = await fetch(`${GATEWAY_URL}/v1/health/providers`, {
      headers: { authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { providers?: LiveProvider[] };
    const map = new Map<string, LiveProvider>();
    for (const p of json.providers ?? []) map.set(p.provider, p);
    return map;
  } catch {
    return null;
  }
}

export async function getReliability(orgId: string, workspaceId: string): Promise<ReliabilityData> {
  const db = getHttpDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const scope = and(eq(workspaces.orgId, orgId), gte(usageEvents.createdAt, since));

  const [historyRaw, hourlyRaw, live] = await Promise.all([
    db
      .select({
        provider: usageEvents.providerSlug,
        requests: sql<number>`count(*)::int`,
        successes: sql<number>`count(*) filter (where ${usageEvents.status} = 'success')::int`,
        p50: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${usageEvents.latencyMs}) filter (where ${usageEvents.status} = 'success'),0)::float8`,
        p95: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${usageEvents.latencyMs}) filter (where ${usageEvents.status} = 'success'),0)::float8`,
      })
      .from(usageEvents)
      .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
      .where(scope)
      .groupBy(usageEvents.providerSlug),
    db
      .select({
        provider: usageEvents.providerSlug,
        hour: sql<string>`to_char(date_trunc('hour', ${usageEvents.createdAt}), 'YYYY-MM-DD"T"HH24:00')`,
        requests: sql<number>`count(*)::int`,
        errors: sql<number>`count(*) filter (where ${usageEvents.status} = 'error')::int`,
      })
      .from(usageEvents)
      .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
      .where(scope)
      .groupBy(usageEvents.providerSlug, sql`date_trunc('hour', ${usageEvents.createdAt})`),
    fetchLive(workspaceId),
  ]);

  const historyByProvider = new Map(historyRaw.map((h) => [h.provider, h]));
  const hourlyByProvider = new Map<string, HourBucket[]>();
  for (const row of hourlyRaw) {
    const arr = hourlyByProvider.get(row.provider) ?? [];
    arr.push({ hour: row.hour, requests: row.requests, errors: row.errors });
    hourlyByProvider.set(row.provider, arr);
  }

  // Union of catalog providers + any provider seen in history or live state.
  const slugs = new Set<string>(PROVIDER_CATALOG.map((p) => p.slug));
  for (const h of historyRaw) slugs.add(h.provider);
  if (live) for (const k of live.keys()) slugs.add(k);

  const providers: ProviderStatus[] = [];
  let totalReq = 0;
  let totalSucc = 0;
  for (const slug of slugs) {
    const h = historyByProvider.get(slug);
    const requests = h?.requests ?? 0;
    const successes = h?.successes ?? 0;
    totalReq += requests;
    totalSucc += successes;
    const lp = live?.get(slug) ?? null;
    providers.push({
      provider: slug,
      displayName: displayName(slug),
      breaker: lp?.breaker ?? (live ? 'closed' : 'unknown'),
      live: lp
        ? {
            breaker: lp.breaker,
            sampleCount: lp.sampleCount,
            successRate: lp.successRate,
            errorRate: lp.errorRate,
            rateLimitRate: lp.rateLimitRate,
            p50Ms: lp.p50Ms,
            p95Ms: lp.p95Ms,
            lastOutcomeAt: lp.lastOutcomeAt,
          }
        : null,
      history: {
        requests,
        successRate: requests > 0 ? successes / requests : 1,
        errorRate: requests > 0 ? (requests - successes) / requests : 0,
        p50Ms: Math.round(h?.p50 ?? 0),
        p95Ms: Math.round(h?.p95 ?? 0),
      },
      hourly: (hourlyByProvider.get(slug) ?? []).sort((a, b) => a.hour.localeCompare(b.hour)),
    });
  }

  // Providers with traffic first, then by name.
  providers.sort((a, b) => b.history.requests - a.history.requests || a.displayName.localeCompare(b.displayName));

  return {
    providers,
    slaUptime: totalReq > 0 ? totalSucc / totalReq : 1,
    totalRequests: totalReq,
    gatewayReachable: live !== null,
  };
}
