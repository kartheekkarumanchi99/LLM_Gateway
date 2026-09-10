// Idempotent migration for Prompt & Model CI (eval sets/cases/runs/run-cases).
// (drizzle-kit push trips on this DB's pre-existing PK drift, so apply additive DDL directly.)
import { setDefaultResultOrder } from 'node:dns';
import { setDefaultAutoSelectFamily } from 'node:net';
setDefaultResultOrder('ipv4first');
setDefaultAutoSelectFamily(false);

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
for (const rel of ['.env', '../.env', '../../.env']) {
  const full = resolve(process.cwd(), rel);
  if (existsSync(full)) {
    loadEnv({ path: full });
    break;
  }
}

import { Pool } from 'pg';

const DDL = [
  `CREATE TABLE IF NOT EXISTS eval_sets (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     name text NOT NULL,
     description text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS eval_sets_workspace_idx ON eval_sets (workspace_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS eval_cases (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     eval_set_id uuid NOT NULL REFERENCES eval_sets(id) ON DELETE CASCADE,
     input jsonb NOT NULL,
     reference text,
     source_request_id text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS eval_cases_set_idx ON eval_cases (eval_set_id)`,
  `CREATE TABLE IF NOT EXISTS eval_runs (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     eval_set_id uuid NOT NULL REFERENCES eval_sets(id) ON DELETE CASCADE,
     name text NOT NULL,
     mode text NOT NULL DEFAULT 'prompt',
     candidate_model text NOT NULL,
     candidate_prompt text,
     baseline_model text,
     baseline_prompt text,
     judge_model text,
     status text NOT NULL DEFAULT 'running',
     summary jsonb,
     error text,
     created_at timestamptz NOT NULL DEFAULT now(),
     completed_at timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS eval_runs_workspace_idx ON eval_runs (workspace_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS eval_run_cases (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     eval_run_id uuid NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
     case_id uuid NOT NULL,
     variant text NOT NULL,
     output text,
     quality_score numeric(6,2) NOT NULL DEFAULT '0',
     cost_usd numeric(20,10) NOT NULL DEFAULT '0',
     latency_ms integer NOT NULL DEFAULT 0,
     passed boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS eval_run_cases_run_idx ON eval_run_cases (eval_run_id)`,
];

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  for (const stmt of DDL) {
    await pool.query(stmt);
    console.log('ok:', stmt.slice(0, 60).replace(/\s+/g, ' '));
  }
  await pool.end();
  console.log('\u2713 prompt-ci migration complete');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
