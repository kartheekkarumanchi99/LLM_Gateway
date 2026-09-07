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

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { apiKeys, getDb, models, organizations, workspaces } from './index';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8787';
const PROBES_PER_MODEL = Number(process.env.PROBE_COUNT ?? 6);

// Real, cheap, chat-completions-compatible models to measure. Override with
// PROBE_MODELS="openai/gpt-4o-mini,openai/gpt-4o". Only slugs present in the
// catalog AND marked executable are probed, so unknown ids are skipped safely.
const DEFAULT_MODELS = [
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'openai/gpt-3.5-turbo',
  'openai/gpt-4-turbo',
];
const ALLOWLIST = (process.env.PROBE_MODELS ?? DEFAULT_MODELS.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function probeOnce(slug: string, key: string, streaming: boolean): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'x-title': 'Performance Probe',
      },
      body: JSON.stringify({
        model: slug,
        messages: [{ role: 'user', content: 'Reply with the single word: ok.' }],
        max_tokens: 8,
        stream: streaming,
      }),
    });
    if (!res.ok) {
      console.warn(`  ${slug}${streaming ? ' (stream)' : ''} -> HTTP ${res.status}`);
      // Drain body so the socket is freed even on error.
      await res.text().catch(() => undefined);
      return false;
    }
    // Read the whole response so latency/TTFT reflect a complete round-trip.
    await res.text();
    console.log(`  ${slug}${streaming ? ' (stream)' : ''} -> ok`);
    return true;
  } catch (err) {
    console.warn(`  ${slug} -> ${(err as Error).message}`);
    return false;
  }
}

async function main() {
  const db = getDb();

  const targets = await db
    .select({ slug: models.slug })
    .from(models)
    .where(and(eq(models.active, true), eq(models.executable, true), inArray(models.slug, ALLOWLIST)));

  if (targets.length === 0) {
    console.log(
      'No probe-eligible models found. Ensure the catalog is synced and PROBE_MODELS are runnable.',
    );
    process.exit(0);
  }

  const org =
    (await db.select().from(organizations).where(eq(organizations.slug, 'demo')))[0] ??
    (await db.select().from(organizations).limit(1))[0];
  if (!org) {
    console.error('No organization found. Run `pnpm db:seed` first.');
    process.exit(1);
  }
  const ws = (await db.select().from(workspaces).where(eq(workspaces.orgId, org.id)).limit(1))[0];
  if (!ws) {
    console.error('No workspace found. Run `pnpm db:seed` first.');
    process.exit(1);
  }

  // Temporary key used only for probing; revoked when done (raw never leaves this process).
  const raw = 'sk-llmgw-' + randomBytes(24).toString('hex');
  const [key] = await db
    .insert(apiKeys)
    .values({
      workspaceId: ws.id,
      name: 'perf-probe',
      keyPrefix: raw.slice(0, 14),
      keyLast4: raw.slice(-4),
      keyHash: createHash('sha256').update(raw).digest('hex'),
    })
    .returning({ id: apiKeys.id });

  console.log(`\nProbing ${targets.length} models via ${GATEWAY} (${PROBES_PER_MODEL}x each)…\n`);
  let sent = 0;
  let ok = 0;
  try {
    for (const t of targets) {
      for (let i = 0; i < PROBES_PER_MODEL; i++) {
        // Alternate streaming so time-to-first-token gets populated too.
        const streaming = i % 2 === 1;
        sent++;
        if (await probeOnce(t.slug, raw, streaming)) ok++;
      }
    }
  } finally {
    if (key) await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, key.id));
  }

  console.log(
    `\n✅ Probed ${targets.length} models · ${sent} requests · ${ok} succeeded. Perf-probe key revoked.`,
  );
  console.log('   Open a probed model page to see real throughput, latency, TTFT, uptime & activity.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
