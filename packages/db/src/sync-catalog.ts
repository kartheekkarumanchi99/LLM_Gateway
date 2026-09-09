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

import { sql } from 'drizzle-orm';
import { getDb, models, providers } from './index';
import { SUPPORTED_PROVIDER_SLUGS } from './providers-catalog';

// Model authors this gateway can execute (an adapter + base URL exist for them).
const EXECUTABLE_AUTHORS = new Set(SUPPORTED_PROVIDER_SLUGS);

interface ORModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number | null;
  architecture?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
  top_provider?: { context_length?: number | null };
}

function perMillion(perToken?: string): string {
  const n = Number(perToken ?? '0');
  if (!Number.isFinite(n)) return '0';
  return (n * 1_000_000).toFixed(10);
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const db = getDb();

  console.log('Fetching model catalog from OpenRouter public API…');
  const modelsBody = (await fetchJson('https://openrouter.ai/api/v1/models')) as { data?: ORModel[] };
  const modelRows = (modelsBody.data ?? [])
    .filter((m) => typeof m.id === 'string' && m.id.includes('/'))
    .map((m) => {
      const author = m.id.split('/')[0]!;
      const upstream = m.id.split('/').slice(1).join('/');
      const modality =
        m.architecture?.modality ??
        [m.architecture?.input_modalities?.join('+'), m.architecture?.output_modalities?.join('+')]
          .filter(Boolean)
          .join('->') ??
        null;
      return {
        slug: m.id,
        providerSlug: author,
        upstreamModel: upstream,
        displayName: m.name ?? m.id,
        description: m.description ?? null,
        modality: modality || null,
        contextLength: m.context_length ?? m.top_provider?.context_length ?? 8192,
        promptPricePerM: perMillion(m.pricing?.prompt),
        completionPricePerM: perMillion(m.pricing?.completion),
        executable: EXECUTABLE_AUTHORS.has(author),
        active: true,
      };
    });

  console.log(`Upserting ${modelRows.length} models…`);
  for (const c of chunk(modelRows, 100)) {
    await db
      .insert(models)
      .values(c)
      .onConflictDoUpdate({
        target: models.slug,
        set: {
          providerSlug: sql`excluded.provider_slug`,
          upstreamModel: sql`excluded.upstream_model`,
          displayName: sql`excluded.display_name`,
          description: sql`excluded.description`,
          modality: sql`excluded.modality`,
          contextLength: sql`excluded.context_length`,
          promptPricePerM: sql`excluded.prompt_price_per_m`,
          completionPricePerM: sql`excluded.completion_price_per_m`,
          executable: sql`excluded.executable`,
          active: sql`excluded.active`,
        },
      });
  }

  console.log('Fetching provider catalog…');
  let providerRows: { slug: string; displayName: string; iconUrl: string | null; dataPolicy: unknown }[] =
    [];
  try {
    const provBody = (await fetchJson('https://openrouter.ai/api/frontend/v1/all-providers')) as {
      data?: Array<Record<string, unknown>>;
    };
    providerRows = (provBody.data ?? [])
      .map((p) => ({
        slug: String((p.slug as string) ?? (p.name as string) ?? ''),
        displayName: String((p.displayName as string) ?? (p.name as string) ?? ''),
        iconUrl: ((p.icon as { url?: string } | undefined)?.url as string) ?? null,
        dataPolicy: (p.dataPolicy as unknown) ?? null,
      }))
      .filter((p) => p.slug.length > 0);
  } catch (err) {
    console.warn('Provider endpoint failed; deriving from model authors:', (err as Error).message);
  }

  // Ensure every model author also exists as a provider row.
  const known = new Set(providerRows.map((p) => p.slug));
  for (const author of new Set(modelRows.map((m) => m.providerSlug))) {
    if (!known.has(author)) {
      providerRows.push({ slug: author, displayName: author, iconUrl: null, dataPolicy: null });
    }
  }

  console.log(`Upserting ${providerRows.length} providers…`);
  for (const c of chunk(providerRows, 100)) {
    await db
      .insert(providers)
      .values(
        c.map((p) => ({
          slug: p.slug,
          displayName: p.displayName || p.slug,
          iconUrl: p.iconUrl,
          dataPolicy: p.dataPolicy as object | null,
          active: true,
        })),
      )
      .onConflictDoUpdate({
        target: providers.slug,
        set: {
          displayName: sql`excluded.display_name`,
          iconUrl: sql`excluded.icon_url`,
          dataPolicy: sql`excluded.data_policy`,
        },
      });
  }

  const [mc] = await db.select({ c: sql<number>`count(*)::int` }).from(models);
  const [pc] = await db.select({ c: sql<number>`count(*)::int` }).from(providers);
  console.log(`\n✅ Catalog synced: ${mc?.c ?? 0} models, ${pc?.c ?? 0} providers.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
