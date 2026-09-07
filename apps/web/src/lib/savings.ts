import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getHttpDb, models, usageEvents, workspaces } from '@llmgw/db/http';
import type { BaselineOption, SavingsData, SavingsModelRow } from './savings-types';

// Premium models offered as the "if you had used one model for everything" baseline.
const BASELINE_SLUGS = [
  'openai/gpt-4o',
  'openai/gpt-4-turbo',
  'anthropic/claude-3-5-sonnet',
  'openai/gpt-4o-mini',
];

// Real savings from actual traffic: actual metered spend vs. a single-model baseline.
export async function getSavings(orgId: string): Promise<SavingsData | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const db = getHttpDb();
    const rows = await db
      .select({
        model: usageEvents.modelSlug,
        requests: sql<number>`count(*)::int`,
        promptTokens: sql<number>`coalesce(sum(${usageEvents.promptTokens}),0)::bigint`,
        completionTokens: sql<number>`coalesce(sum(${usageEvents.completionTokens}),0)::bigint`,
        actualUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}),0)::float8`,
      })
      .from(usageEvents)
      .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
      .where(and(eq(workspaces.orgId, orgId), eq(usageEvents.status, 'success')))
      .groupBy(usageEvents.modelSlug)
      .orderBy(desc(sql`coalesce(sum(${usageEvents.costUsd}),0)`));

    const byModel: SavingsModelRow[] = rows.map((r) => ({
      model: r.model,
      requests: Number(r.requests),
      promptTokens: Number(r.promptTokens),
      completionTokens: Number(r.completionTokens),
      actualUsd: Number(r.actualUsd),
    }));

    const baseRows = await db
      .select({
        slug: models.slug,
        name: models.displayName,
        promptPerM: models.promptPricePerM,
        completionPerM: models.completionPricePerM,
      })
      .from(models)
      .where(inArray(models.slug, BASELINE_SLUGS));

    const baseMap = new Map(baseRows.map((b) => [b.slug, b]));
    const baselines: BaselineOption[] = BASELINE_SLUGS.filter((s) => baseMap.has(s)).map((s) => {
      const b = baseMap.get(s)!;
      return {
        slug: b.slug,
        name: b.name,
        promptPerM: Number(b.promptPerM),
        completionPerM: Number(b.completionPerM),
      };
    });

    return {
      requests: byModel.reduce((a, m) => a + m.requests, 0),
      promptTokens: byModel.reduce((a, m) => a + m.promptTokens, 0),
      completionTokens: byModel.reduce((a, m) => a + m.completionTokens, 0),
      actualUsd: byModel.reduce((a, m) => a + m.actualUsd, 0),
      byModel,
      baselines,
    };
  } catch (err) {
    console.error('[savings] getSavings failed:', (err as Error).message);
    return null;
  }
}
