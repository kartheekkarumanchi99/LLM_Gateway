import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');

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

import { getPool } from './index';

// Additive + idempotent migration for the Predictive Routing feature. Applies the
// workspace_settings.predictive column and the predictive_routing_events table
// without touching existing tables (drizzle-kit push trips on unrelated PK drift).
const ddl = `
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS predictive jsonb;

CREATE TABLE IF NOT EXISTS predictive_routing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  predictor_version text NOT NULL,
  mode text,
  predicted_task_class text,
  actual_task_class text,
  predicted_model text,
  authoritative_model text,
  committed_model text,
  prediction_confidence numeric(5,4),
  prediction_correct boolean,
  speculation_started boolean NOT NULL DEFAULT false,
  loser_cancelled boolean NOT NULL DEFAULT false,
  commit_reason text,
  routing_overhead_ms integer,
  estimated_standard_overhead_ms integer,
  predictor_latency_ms integer,
  speculation_waste_usd numeric(20,10) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pred_events_ws_idx ON predictive_routing_events (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS pred_events_correct_idx ON predictive_routing_events (prediction_correct);
CREATE INDEX IF NOT EXISTS pred_events_version_idx ON predictive_routing_events (predictor_version);
`;

const pool = getPool();
await pool.query(ddl);
console.log('\u2713 predictive_routing_events table + workspace_settings.predictive column ensured.');
await pool.end();
