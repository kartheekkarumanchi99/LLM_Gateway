import { sql } from 'drizzle-orm';
import { getDb } from '@llmgw/db';
import { resolveProviderKey } from '../providers/keys';
import { getArbitrageSettings, getByokLimit } from './config';
import { hasHeadroom, spareTpm } from './limits';

// Cost-arbitrage key resolution. If the tenant has headroom on its own BYOK key, use it.
// If it's throttled/exhausted and opted to consume, borrow the most under-utilized key from
// a consenting lender org in the pool — turning a workflow-blocking 429 into a served
// request (settled through the capacity-loan ledger).

export interface CapacityResolution {
  key: string;
  isByok: boolean;
  borrowed: boolean;
  lenderOrgId: string | null;
  lenderMarginPct: number;
  ownThrottled: boolean;
}

interface LenderRow {
  orgId: string;
  marginPct: number;
  tpmLimit: number;
  rpmLimit: number;
  maxShareTpm: number;
}

async function findLender(
  selfOrgId: string,
  provider: string,
  estTokens: number,
): Promise<{ orgId: string; marginPct: number } | null> {
  const rows = await getDb().execute(sql`
    SELECT bl.org_id AS "orgId", a.margin_pct AS "marginPct",
           bl.tpm_limit AS "tpmLimit", bl.rpm_limit AS "rpmLimit", a.max_share_tpm AS "maxShareTpm"
    FROM byok_limits bl
    JOIN arbitrage_settings a ON a.org_id = bl.org_id AND a.enabled = true AND a.contribute = true
    WHERE bl.provider = ${provider} AND bl.shareable = true AND bl.org_id <> ${selfOrgId}
      AND EXISTS (SELECT 1 FROM provider_keys pk WHERE pk.org_id = bl.org_id AND pk.provider_slug = ${provider})
  `);
  const candidates = rows.rows as unknown as LenderRow[];
  // Prefer a lender with enough spare for the whole request; else the most spare available.
  let best: { orgId: string; marginPct: number; spare: number; fits: boolean } | null = null;
  for (const c of candidates) {
    const spare = spareTpm(c.orgId, provider, { tpmLimit: c.tpmLimit, rpmLimit: c.rpmLimit }, c.maxShareTpm);
    if (spare <= 0) continue;
    const fits = spare >= estTokens;
    const better = !best || (fits && !best.fits) || (fits === best.fits && spare > best.spare);
    if (better) best = { orgId: c.orgId, marginPct: Number(c.marginPct), spare, fits };
  }
  return best ? { orgId: best.orgId, marginPct: best.marginPct } : null;
}

export async function resolveCapacity(
  orgId: string,
  provider: string,
  estTokens: number,
): Promise<CapacityResolution> {
  const own = await resolveProviderKey(orgId, provider);
  const settings = await getArbitrageSettings(orgId);
  const ownLimit = await getByokLimit(orgId, provider);
  const ownCaps = { tpmLimit: ownLimit?.tpmLimit ?? 0, rpmLimit: ownLimit?.rpmLimit ?? 0 };
  const ownHead = hasHeadroom(orgId, provider, ownCaps, estTokens);

  // Arbitrage off, not consuming, or own key has headroom → use own.
  if (!settings.enabled || !settings.consume || ownHead) {
    return { key: own.key, isByok: own.isByok, borrowed: false, lenderOrgId: null, lenderMarginPct: 0, ownThrottled: !ownHead };
  }

  // Own key is throttled/exhausted — try to borrow spare capacity from the pool.
  const lender = await findLender(orgId, provider, estTokens);
  if (lender) {
    const lenderKey = await resolveProviderKey(lender.orgId, provider);
    if (lenderKey.key && lenderKey.isByok) {
      return { key: lenderKey.key, isByok: true, borrowed: true, lenderOrgId: lender.orgId, lenderMarginPct: lender.marginPct, ownThrottled: true };
    }
  }
  // No lender available — fall back to own key (may 429, but nothing better to do).
  return { key: own.key, isByok: own.isByok, borrowed: false, lenderOrgId: null, lenderMarginPct: 0, ownThrottled: true };
}
