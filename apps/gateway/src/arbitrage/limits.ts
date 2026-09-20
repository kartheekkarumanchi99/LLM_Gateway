import { RATE_WINDOW_MS, THROTTLE_COOLDOWN_MS } from '@llmgw/db';

// In-process real-time rate-limit tracker per (org, provider). Rolling TPM/RPM over a 60s
// window plus a 429 cooldown, so the arbitrage router can tell — at request time — whether a
// tenant has headroom on its own key or must borrow spare capacity from the pool.

interface Event {
  at: number;
  tokens: number;
}
interface State {
  events: Event[];
  throttledUntil: number;
}

const SEP = '\u0000';
const keyOf = (orgId: string, provider: string): string => `${orgId}${SEP}${provider}`;
const registry = new Map<string, State>();

function get(orgId: string, provider: string): State {
  const k = keyOf(orgId, provider);
  let s = registry.get(k);
  if (!s) {
    s = { events: [], throttledUntil: 0 };
    registry.set(k, s);
  }
  return s;
}

function prune(s: State, now: number): void {
  const cutoff = now - RATE_WINDOW_MS;
  if (s.events.length && s.events[0]!.at < cutoff) {
    s.events = s.events.filter((e) => e.at >= cutoff);
  }
}

export function recordConsumption(orgId: string, provider: string, tokens: number): void {
  const s = get(orgId, provider);
  const now = Date.now();
  s.events.push({ at: now, tokens: Math.max(0, tokens) });
  prune(s, now);
}

/** A real 429 marks the tenant throttled on this provider for a cooldown. */
export function note429(orgId: string, provider: string): void {
  get(orgId, provider).throttledUntil = Date.now() + THROTTLE_COOLDOWN_MS;
}

export function isThrottled(orgId: string, provider: string): boolean {
  return Date.now() < get(orgId, provider).throttledUntil;
}

export interface Utilization {
  tpmUsed: number;
  rpmUsed: number;
  tpmLimit: number;
  rpmLimit: number;
  tpmHeadroom: number; // remaining tokens this minute (Infinity when no limit set)
  utilizationPct: number; // 0..100 against the tighter of TPM/RPM
  throttled: boolean;
}

export function utilization(
  orgId: string,
  provider: string,
  caps: { tpmLimit: number; rpmLimit: number },
): Utilization {
  const s = get(orgId, provider);
  const now = Date.now();
  prune(s, now);
  const tpmUsed = s.events.reduce((a, e) => a + e.tokens, 0);
  const rpmUsed = s.events.length;
  const tpmHeadroom = caps.tpmLimit > 0 ? Math.max(0, caps.tpmLimit - tpmUsed) : Infinity;
  const tpmPct = caps.tpmLimit > 0 ? (tpmUsed / caps.tpmLimit) * 100 : 0;
  const rpmPct = caps.rpmLimit > 0 ? (rpmUsed / caps.rpmLimit) * 100 : 0;
  return {
    tpmUsed,
    rpmUsed,
    tpmLimit: caps.tpmLimit,
    rpmLimit: caps.rpmLimit,
    tpmHeadroom,
    utilizationPct: Math.min(100, Math.round(Math.max(tpmPct, rpmPct))),
    throttled: now < s.throttledUntil,
  };
}

/** Whether the tenant can serve an estimated-size request on its own key right now. */
export function hasHeadroom(
  orgId: string,
  provider: string,
  caps: { tpmLimit: number; rpmLimit: number },
  estTokens: number,
): boolean {
  const u = utilization(orgId, provider, caps);
  if (u.throttled) return false;
  if (caps.tpmLimit > 0 && u.tpmUsed + estTokens > caps.tpmLimit) return false;
  if (caps.rpmLimit > 0 && u.rpmUsed + 1 > caps.rpmLimit) return false;
  return true;
}

/** Spare tokens/min a lender can offer (headroom capped by its willing max-share). */
export function spareTpm(
  orgId: string,
  provider: string,
  caps: { tpmLimit: number; rpmLimit: number },
  maxShareTpm: number,
): number {
  const u = utilization(orgId, provider, caps);
  if (u.throttled) return 0;
  const headroom = caps.tpmLimit > 0 ? caps.tpmLimit - u.tpmUsed : maxShareTpm;
  return Math.max(0, Math.min(headroom, maxShareTpm));
}

export function resetLimits(): void {
  registry.clear();
}
