// One-off idempotent DDL for the Multi-Tenant Arbitrage tables. Delete after applying.
import { setDefaultResultOrder } from 'node:dns';
import { setDefaultAutoSelectFamily } from 'node:net';
setDefaultResultOrder('ipv4first');
setDefaultAutoSelectFamily(false);
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
for (const rel of ['.env', '../.env', '../../.env']) {
  const full = resolve(process.cwd(), rel);
  if (existsSync(full)) { loadEnv({ path: full }); break; }
}
import { Pool } from 'pg';

const DDL = `
CREATE TABLE IF NOT EXISTS arbitrage_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  contribute boolean NOT NULL DEFAULT false,
  consume boolean NOT NULL DEFAULT false,
  margin_pct numeric(6,2) NOT NULL DEFAULT 10,
  max_share_tpm integer NOT NULL DEFAULT 100000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS byok_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  tpm_limit integer NOT NULL DEFAULT 0,
  rpm_limit integer NOT NULL DEFAULT 0,
  shareable boolean NOT NULL DEFAULT false,
  tier text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS byok_limits_uq ON byok_limits (org_id, provider);

CREATE TABLE IF NOT EXISTS capacity_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrower_org_id uuid NOT NULL,
  lender_org_id uuid NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  request_id text NOT NULL UNIQUE,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  provider_cost_usd numeric(20,10) NOT NULL DEFAULT 0,
  transfer_price_usd numeric(20,10) NOT NULL DEFAULT 0,
  margin_usd numeric(20,10) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capacity_loans_borrower_idx ON capacity_loans (borrower_org_id, created_at);
CREATE INDEX IF NOT EXISTS capacity_loans_lender_idx ON capacity_loans (lender_org_id, created_at);
`;

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(DDL);
  const t = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_name IN ('arbitrage_settings','byok_limits','capacity_loans') ORDER BY table_name`,
  );
  console.log('tables present:', t.rows.map((r) => r.table_name).join(', '));
  await pool.end();
  console.log('DDL applied OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
