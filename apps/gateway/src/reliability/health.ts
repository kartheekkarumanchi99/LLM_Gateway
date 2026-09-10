import { PROVIDER_CATALOG } from '@llmgw/db';

// Reliability Mesh: live provider-health scoring + circuit breakers, driven by real
// request outcomes. The router consults this to skip degraded providers and fail over
// to a healthy same-quality-tier candidate; half-open probes auto-recover.
//
// State is in-process (the gateway is a single long-lived process). The web status page
// combines this live breaker state with historical aggregates from usage_events.

export type BreakerState = 'closed' | 'open' | 'half_open';

interface Sample {
  ok: boolean;
  latencyMs: number;
  status: number; // upstream HTTP status (0 if unknown)
  at: number;
}

interface ProviderRuntime {
  samples: Sample[];
  breaker: BreakerState;
  openedAt: number;
  consecutiveFailures: number;
  halfOpenProbeInFlight: boolean;
  lastOutcomeAt: number;
}

// Tunables — deliberately conservative so a couple of transient blips don't trip a breaker.
const WINDOW = 60; // rolling samples kept per provider
const WINDOW_MS = 120_000; // ignore samples older than this when scoring
const MIN_SAMPLES_TO_TRIP = 5;
const ERROR_RATE_TRIP = 0.5; // >50% errors in the window trips the breaker
const CONSECUTIVE_TRIP = 4; // ...or this many failures back-to-back
const OPEN_MS = 15_000; // stay open this long before a half-open probe

const runtime = new Map<string, ProviderRuntime>();

function get(provider: string): ProviderRuntime {
  let r = runtime.get(provider);
  if (!r) {
    r = {
      samples: [],
      breaker: 'closed',
      openedAt: 0,
      consecutiveFailures: 0,
      halfOpenProbeInFlight: false,
      lastOutcomeAt: 0,
    };
    runtime.set(provider, r);
  }
  return r;
}

function recent(r: ProviderRuntime, now: number): Sample[] {
  return r.samples.filter((s) => now - s.at <= WINDOW_MS);
}

/** Whether a request may be routed to this provider right now (breaker gate). */
export function shouldAllow(provider: string): boolean {
  const r = get(provider);
  const now = Date.now();
  if (r.breaker === 'closed') return true;
  if (r.breaker === 'open') {
    if (now - r.openedAt >= OPEN_MS) {
      // Time to test the water: allow exactly one probe.
      r.breaker = 'half_open';
      r.halfOpenProbeInFlight = true;
      return true;
    }
    return false;
  }
  // half_open: allow a single in-flight probe.
  if (!r.halfOpenProbeInFlight) {
    r.halfOpenProbeInFlight = true;
    return true;
  }
  return false;
}

/** Record a real request outcome and update the breaker. */
export function recordOutcome(
  provider: string,
  outcome: { ok: boolean; latencyMs: number; status?: number },
): void {
  const r = get(provider);
  const now = Date.now();
  r.lastOutcomeAt = now;
  r.samples.push({ ok: outcome.ok, latencyMs: outcome.latencyMs, status: outcome.status ?? 0, at: now });
  if (r.samples.length > WINDOW) r.samples.splice(0, r.samples.length - WINDOW);

  if (r.breaker === 'half_open') {
    // The probe decides recovery.
    r.halfOpenProbeInFlight = false;
    if (outcome.ok) {
      r.breaker = 'closed';
      r.consecutiveFailures = 0;
    } else {
      r.breaker = 'open';
      r.openedAt = now;
    }
    return;
  }

  if (outcome.ok) {
    r.consecutiveFailures = 0;
    return;
  }

  r.consecutiveFailures += 1;
  const window = recent(r, now);
  const errs = window.filter((s) => !s.ok).length;
  const errorRate = window.length > 0 ? errs / window.length : 0;
  const trip =
    r.consecutiveFailures >= CONSECUTIVE_TRIP ||
    (window.length >= MIN_SAMPLES_TO_TRIP && errorRate >= ERROR_RATE_TRIP);
  if (trip && r.breaker === 'closed') {
    r.breaker = 'open';
    r.openedAt = now;
  }
}

export interface ProviderHealth {
  provider: string;
  breaker: BreakerState;
  sampleCount: number;
  successRate: number; // 0..1 over the window
  errorRate: number;
  rateLimitRate: number; // share of 429s
  p50Ms: number;
  p95Ms: number;
  lastOutcomeAt: number | null;
  openedAt: number | null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

export function getProviderHealth(provider: string): ProviderHealth {
  const r = get(provider);
  const now = Date.now();
  const window = recent(r, now);
  const oks = window.filter((s) => s.ok).length;
  const lat = window.filter((s) => s.ok).map((s) => s.latencyMs).sort((a, b) => a - b);
  const rateLimited = window.filter((s) => s.status === 429).length;
  return {
    provider,
    breaker: r.breaker,
    sampleCount: window.length,
    successRate: window.length > 0 ? oks / window.length : 1,
    errorRate: window.length > 0 ? (window.length - oks) / window.length : 0,
    rateLimitRate: window.length > 0 ? rateLimited / window.length : 0,
    p50Ms: percentile(lat, 50),
    p95Ms: percentile(lat, 95),
    lastOutcomeAt: r.lastOutcomeAt || null,
    openedAt: r.breaker !== 'closed' ? r.openedAt || null : null,
  };
}

/** Live health for every catalog provider (even ones with no traffic yet). */
export function getAllProviderHealth(): ProviderHealth[] {
  const seen = new Set<string>();
  const out: ProviderHealth[] = [];
  for (const meta of PROVIDER_CATALOG) {
    seen.add(meta.slug);
    out.push(getProviderHealth(meta.slug));
  }
  for (const slug of runtime.keys()) {
    if (!seen.has(slug)) out.push(getProviderHealth(slug));
  }
  return out;
}

// Test/ops helper: reset a breaker (or all) — used by the "reset" admin action.
export function resetBreaker(provider?: string): void {
  if (provider) runtime.delete(provider);
  else runtime.clear();
}

// Only genuine provider-level failures reflect provider health: network/timeout (status 0),
// rate limits (429), and server errors (5xx). A 4xx model/request error — e.g. an un-served
// catalog model or a bad prompt — is NOT the provider's fault and must not trip its breaker.
export function isProviderFault(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}
