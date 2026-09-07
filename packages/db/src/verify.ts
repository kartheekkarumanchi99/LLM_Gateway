import { setDefaultResultOrder } from 'node:dns';
// Neon dual-stack: avoid the IPv6 black-hole on some networks.
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

import { getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { getDb, getPool, schema } from './index';

// Reports only presence — never the value — of a secret.
function presence(v: string | undefined): string {
  return v && v.trim().length > 0 ? '✅ set' : '❌ missing';
}

async function main() {
  console.log('\n🔎 llm-gateway database check\n');

  console.log('Environment:');
  console.log(`  DATABASE_URL         ${presence(process.env.DATABASE_URL)}   (runtime: gateway pool + web http)`);
  console.log(`  DIRECT_URL           ${presence(process.env.DIRECT_URL)}   (drizzle-kit push/migrations)`);
  console.log(`  BYOK_ENCRYPTION_KEY  ${presence(process.env.BYOK_ENCRYPTION_KEY)}   (BYOK + observability secrets)`);
  console.log(`  OPENAI_API_KEY       ${presence(process.env.OPENAI_API_KEY)}   (platform fallback provider key)`);
  console.log(`  ANTHROPIC_API_KEY    ${presence(process.env.ANTHROPIC_API_KEY)}`);
  console.log('');

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set. Copy .env.example to .env and fill it in, then re-run.');
    process.exit(1);
  }

  const db = getDb();
  const t0 = Date.now();
  try {
    await db.execute(sql`select 1`);
  } catch (err) {
    console.error('❌ Could not connect:', (err as Error).message);
    console.error('   Verify the DATABASE_URL host/credentials and that the database is reachable.');
    await getPool().end().catch(() => {});
    process.exit(1);
  }
  console.log(`✅ Connected. Round-trip ~${Date.now() - t0}ms.\n`);

  // Compare the live schema against every table declared in schema.ts.
  const tables = Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[];
  const expected = tables.map((t) => getTableName(t)).sort();
  const res = await db.execute(
    sql`select table_name from information_schema.tables where table_schema = 'public'`,
  );
  const existing = new Set((res.rows as Array<{ table_name: string }>).map((r) => r.table_name));
  const missing = expected.filter((t) => !existing.has(t));

  console.log(`Schema: ${expected.length - missing.length}/${expected.length} tables present.`);
  if (missing.length > 0) {
    console.log(`  ⚠️ Missing: ${missing.join(', ')}`);
    console.log('  → Create them with:  pnpm db:push\n');
  } else {
    console.log('  ✅ All expected tables exist.\n');
  }

  if (!missing.includes('models') && !missing.includes('providers')) {
    const counts = await db.execute(sql`
      select
        (select count(*) from models)                         as models,
        (select count(*) from models where executable = true) as executable_models,
        (select count(*) from providers)                      as providers,
        (select count(*) from organizations)                  as orgs,
        (select count(*) from api_keys)                       as api_keys
    `);
    const row = (counts.rows as Array<Record<string, string>>)[0] ?? {};
    const models = Number(row.models ?? 0);
    const executable = Number(row.executable_models ?? 0);
    const providers = Number(row.providers ?? 0);
    const orgs = Number(row.orgs ?? 0);
    const apiKeys = Number(row.api_keys ?? 0);

    console.log('Data:');
    console.log(`  Models         ${models}  (${executable} executable)`);
    console.log(`  Providers      ${providers}`);
    console.log(`  Organizations  ${orgs}`);
    console.log(`  API keys       ${apiKeys}\n`);

    const tips: string[] = [];
    if (models === 0) tips.push('Empty catalog → seed a starter set:  pnpm db:seed   (full catalog: pnpm db:sync-catalog)');
    else if (executable === 0) tips.push('No executable models → run:  pnpm db:sync-catalog   (marks OpenAI/Anthropic executable)');
    if (orgs === 0) tips.push('No org/workspace yet → run:  pnpm db:seed   (creates the demo org + one API key)');
    if (tips.length > 0) {
      console.log('Next steps:');
      for (const t of tips) console.log(`  → ${t}`);
      console.log('');
    }
  }

  // Recent metering activity — proves the billing pipeline is recording usage.
  if (!missing.includes('usage_events') && !missing.includes('credit_ledger')) {
    const act = await db.execute(sql`
      select
        (select count(*) from usage_events)                          as events,
        (select count(*) from usage_events where status = 'success') as ok,
        (select coalesce(sum(total_tokens), 0) from usage_events)    as tokens,
        (select coalesce(sum(cost_usd), 0) from usage_events)        as spend,
        (select coalesce(sum(amount_usd), 0) from credit_ledger)     as ledger
    `);
    const a = (act.rows as Array<Record<string, string>>)[0] ?? {};
    const events = Number(a.events ?? 0);
    console.log('Activity:');
    console.log(`  Usage events   ${events}  (${Number(a.ok ?? 0)} success)`);
    console.log(`  Tokens metered ${Number(a.tokens ?? 0)}`);
    console.log(`  Spend recorded $${Number(a.spend ?? 0).toFixed(6)}`);
    console.log(`  Ledger balance $${Number(a.ledger ?? 0).toFixed(6)}`);
    if (events > 0) console.log('  ✅ Billing pipeline is recording real usage.');
    console.log('');
  }

  const ready = missing.length === 0;
  console.log(ready ? '🎉 Schema is READY.\n' : '🔧 Run the steps above, then re-run: pnpm db:verify\n');

  await getPool().end().catch(() => {});
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
