// Idempotent migration for the Prompt Optimization Engine + Agent Time Machine.
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
  `ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS trace_id text`,
  `ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS trace_id text`,
  `CREATE INDEX IF NOT EXISTS usage_events_trace_idx ON usage_events (trace_id)`,
  `CREATE TABLE IF NOT EXISTS optimization_runs (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     name text NOT NULL,
     task_class text,
     baseline_prompt text NOT NULL DEFAULT '',
     status text NOT NULL DEFAULT 'running',
     config jsonb,
     summary jsonb,
     error text,
     created_at timestamptz NOT NULL DEFAULT now(),
     completed_at timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS optimization_runs_workspace_idx ON optimization_runs (workspace_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS optimization_candidates (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     run_id uuid NOT NULL REFERENCES optimization_runs(id) ON DELETE CASCADE,
     label text NOT NULL,
     prompt text NOT NULL,
     model_slug text NOT NULL,
     is_baseline boolean NOT NULL DEFAULT false,
     is_winner boolean NOT NULL DEFAULT false,
     quality_score numeric(6,2) NOT NULL DEFAULT 0,
     avg_cost_usd numeric(20,10) NOT NULL DEFAULT 0,
     avg_latency_ms integer NOT NULL DEFAULT 0,
     composite_score numeric(6,2) NOT NULL DEFAULT 0,
     sample_count integer NOT NULL DEFAULT 0,
     notes text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS optimization_candidates_run_idx ON optimization_candidates (run_id)`,
  `CREATE TABLE IF NOT EXISTS trace_annotations (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     trace_id text NOT NULL,
     note text,
     starred boolean NOT NULL DEFAULT false,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS trace_annotations_ws_trace_uq ON trace_annotations (workspace_id, trace_id)`,
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example).');
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    for (const stmt of DDL) {
      await pool.query(stmt);
      console.log('ok:', stmt.trim().split('\n')[0]!.slice(0, 70));
    }
    console.log('\n✓ optimization + time-machine migration complete');
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
