import { and, asc, desc, eq } from 'drizzle-orm';
import { classifiers, getHttpDb, models, type ClassifierDimension } from '@llmgw/db/http';

export interface ClassifierRow {
  id: string;
  name: string;
  preset: string;
  modelSlug: string;
  sampleRate: string;
  dimensions: ClassifierDimension[];
  prompt: string;
  enabled: boolean;
  createdAt: string;
}

function mapRow(r: typeof classifiers.$inferSelect): ClassifierRow {
  return {
    id: r.id,
    name: r.name,
    preset: r.preset,
    modelSlug: r.modelSlug,
    sampleRate: String(r.sampleRate),
    dimensions: (r.dimensions as ClassifierDimension[]) ?? [],
    prompt: r.prompt ?? '',
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listClassifiers(workspaceId: string): Promise<ClassifierRow[]> {
  const db = getHttpDb();
  const rows = await db
    .select()
    .from(classifiers)
    .where(eq(classifiers.workspaceId, workspaceId))
    .orderBy(desc(classifiers.createdAt));
  return rows.map(mapRow);
}

export async function getClassifierById(id: string, workspaceId: string): Promise<ClassifierRow | null> {
  const db = getHttpDb();
  const rows = await db
    .select()
    .from(classifiers)
    .where(and(eq(classifiers.id, id), eq(classifiers.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ? mapRow(rows[0]) : null;
}

export interface ModelOption {
  slug: string;
  displayName: string;
  providerSlug: string;
  promptPricePerM: string;
}

// Executable models only (adapter + credentials exist), cheapest first — these
// are the models that can actually run a classifier.
export async function listExecutableModels(): Promise<ModelOption[]> {
  const db = getHttpDb();
  const rows = await db
    .select({
      slug: models.slug,
      displayName: models.displayName,
      providerSlug: models.providerSlug,
      promptPricePerM: models.promptPricePerM,
    })
    .from(models)
    .where(and(eq(models.executable, true), eq(models.active, true)))
    .orderBy(asc(models.promptPricePerM))
    .limit(200);
  return rows.map((r) => ({
    slug: r.slug,
    displayName: r.displayName,
    providerSlug: r.providerSlug,
    promptPricePerM: String(r.promptPricePerM),
  }));
}
