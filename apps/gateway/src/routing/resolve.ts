import { and, eq } from 'drizzle-orm';
import { getDb, models } from '@llmgw/db';

export interface ResolvedModel {
  slug: string;
  providerSlug: string;
  upstreamModel: string;
  promptPricePerM: string;
  completionPricePerM: string;
}

export async function resolveModel(requested: string): Promise<ResolvedModel | null> {
  const db = getDb();
  // Bare model ids default to the openai namespace.
  const slug = requested.includes('/') ? requested : `openai/${requested}`;

  const rows = await db
    .select()
    .from(models)
    .where(and(eq(models.slug, slug), eq(models.active, true)))
    .limit(1);

  const m = rows[0];
  if (!m) return null;

  return {
    slug: m.slug,
    providerSlug: m.providerSlug,
    upstreamModel: m.upstreamModel,
    promptPricePerM: String(m.promptPricePerM),
    completionPricePerM: String(m.completionPricePerM),
  };
}
