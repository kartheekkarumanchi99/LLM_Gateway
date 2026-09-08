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
import { eq, inArray } from 'drizzle-orm';
import { apiKeys, getDb, models, organizations, responseCache, workspaces } from './index';

// Measures REAL cost savings on a representative assistant workload routed through
// the gateway (auto-router decides the model; realistic redundancy exercises the
// semantic cache). Savings = 1 - actual / (every request on a premium baseline).

const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8787';
const N = Number(process.env.BENCH_COUNT ?? 60);
const BASELINES = ['openai/gpt-4o', 'openai/gpt-4-turbo', 'anthropic/claude-3-5-sonnet'];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Realistic assistant intents with a natural skew. Common intents include a
// paraphrase so repeats exercise the semantic cache, not just exact-match.
interface Intent {
  weight: number;
  variants: string[];
}
const INTENTS: Intent[] = [
  { weight: 6, variants: ['What are your customer support hours?', 'When is your support team available?'] },
  { weight: 6, variants: ['How do I reset my password?', 'I forgot my password — how can I change it?'] },
  { weight: 5, variants: ['What is your refund policy?', 'Can I get my money back if I cancel?'] },
  { weight: 4, variants: ['How do I update my billing information?', 'Where do I change my payment card?'] },
  { weight: 4, variants: ['What payment methods do you accept?', 'Which cards can I pay with?'] },
  { weight: 3, variants: ['How do I cancel my subscription?', 'What is the process to end my plan?'] },
  { weight: 3, variants: ['Do you offer a free trial?', 'Is there a trial period available?'] },
  { weight: 2, variants: ['How do I contact a human agent?', 'Can I talk to a real person?'] },
  { weight: 2, variants: ['Write a friendly one-sentence welcome message for a new user.'] },
  { weight: 2, variants: ['Summarize the benefits of two-factor authentication in two sentences.'] },
  { weight: 1, variants: ['Write a Python function that validates an email address with a regex and returns a bool.'] },
  { weight: 1, variants: ['Explain the trade-offs between optimistic and pessimistic locking in databases.'] },
];

interface Sample {
  ok: boolean;
  promptTokens: number;
  completionTokens: number;
  actualCost: number;
  chosen: string;
  mode: string;
  cacheHit: boolean;
  cacheKind: string | null;
}

async function ask(key: string, prompt: string): Promise<Sample> {
  const empty: Sample = {
    ok: false,
    promptTokens: 0,
    completionTokens: 0,
    actualCost: 0,
    chosen: '-',
    mode: '-',
    cacheHit: false,
    cacheKind: null,
  };
  try {
    const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Savings Bench' },
      body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: prompt }], max_tokens: 256 }),
    });
    if (!res.ok) {
      await res.text().catch(() => undefined);
      return empty;
    }
    const j = (await res.json()) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      _routing?: { chosen?: string; mode?: string };
      _cache?: { hit?: boolean; kind?: string };
    };
    return {
      ok: true,
      promptTokens: j.usage?.prompt_tokens ?? 0,
      completionTokens: j.usage?.completion_tokens ?? 0,
      actualCost: j.usage?.cost ?? 0,
      chosen: j._routing?.chosen ?? '-',
      mode: j._routing?.mode ?? '-',
      cacheHit: Boolean(j._cache?.hit),
      cacheKind: j._cache?.kind ?? null,
    };
  } catch {
    return empty;
  }
}

function usd(n: number): string {
  return '$' + n.toFixed(6);
}

async function main() {
  const db = getDb();

  const priceRows = await db
    .select({ slug: models.slug, pin: models.promptPricePerM, pout: models.completionPricePerM })
    .from(models)
    .where(inArray(models.slug, BASELINES));
  const priceMap = new Map(priceRows.map((r) => [r.slug, { pin: Number(r.pin), pout: Number(r.pout) }]));
  if (priceMap.size === 0) {
    console.error('No baseline prices found. Run `pnpm db:sync-catalog` first.');
    process.exit(1);
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

  // Cold-start measurement: clear the cache so savings aren't inflated by prior warmth.
  if (process.env.BENCH_RESET === '1') {
    await db.delete(responseCache).where(eq(responseCache.workspaceId, ws.id));
    console.log('(reset: cleared response cache for this workspace)');
  }

  const raw = 'sk-llmgw-' + randomBytes(24).toString('hex');
  const [key] = await db
    .insert(apiKeys)
    .values({
      workspaceId: ws.id,
      name: 'savings-bench',
      keyPrefix: raw.slice(0, 14),
      keyLast4: raw.slice(-4),
      keyHash: createHash('sha256').update(raw).digest('hex'),
    })
    .returning({ id: apiKeys.id });

  // Weighted intent pool + deterministic sampling; alternate variants on repeats
  // so both exact and semantic cache paths are exercised.
  const pool: number[] = [];
  INTENTS.forEach((it, i) => {
    for (let w = 0; w < it.weight; w++) pool.push(i);
  });
  const rng = mulberry32(20260908);
  const drawCount = new Map<number, number>();

  console.log(`\nSavings benchmark: ${N} requests through ${GATEWAY} (model=auto, cache on)…\n`);
  const samples: Sample[] = [];
  try {
    for (let i = 0; i < N; i++) {
      const intentIdx = pool[Math.floor(rng() * pool.length)]!;
      const seen = drawCount.get(intentIdx) ?? 0;
      drawCount.set(intentIdx, seen + 1);
      const variants = INTENTS[intentIdx]!.variants;
      const prompt = variants[seen % variants.length]!;
      const s = await ask(raw, prompt);
      samples.push(s);
      const tag = s.cacheHit ? `cache:${s.cacheKind}` : s.chosen;
      console.log(`  ${String(i + 1).padStart(2)}. ${tag.padEnd(24)} ${usd(s.actualCost)}`);
    }
  } finally {
    if (key) await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, key.id));
  }

  const ok = samples.filter((s) => s.ok);
  const hits = ok.filter((s) => s.cacheHit).length;
  const actualTotal = ok.reduce((a, s) => a + s.actualCost, 0);

  // Model distribution.
  const dist = new Map<string, number>();
  for (const s of ok) {
    const k = s.cacheHit ? `cache:${s.cacheKind}` : s.chosen;
    dist.set(k, (dist.get(k) ?? 0) + 1);
  }

  console.log(`\n── Results ──────────────────────────────────────────────`);
  console.log(`Requests:        ${ok.length}/${samples.length} ok`);
  console.log(`Cache hits:      ${hits} (${((hits / Math.max(1, ok.length)) * 100).toFixed(1)}%)`);
  console.log(`Actual spend:    ${usd(actualTotal)}`);
  console.log(`\nRouting mix:`);
  for (const [k, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(26)} ${n}`);
  }

  console.log(`\nSavings vs "every request on a premium baseline":`);
  for (const slug of BASELINES) {
    const p = priceMap.get(slug);
    if (!p) continue;
    const baseline = ok.reduce(
      (a, s) => a + (s.promptTokens / 1_000_000) * p.pin + (s.completionTokens / 1_000_000) * p.pout,
      0,
    );
    if (baseline <= 0) continue;
    const savedPct = (1 - actualTotal / baseline) * 100;
    console.log(
      `  ${slug.padEnd(30)} baseline ${usd(baseline)} → saved ${savedPct.toFixed(1)}%`,
    );
  }
  console.log(
    `\nNote: reflects a representative assistant workload (typical redundancy + mostly-simple\n` +
      `queries). Savings scale with your traffic; steady-state cache warmth pushes them higher.\n`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
