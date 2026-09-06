import { and, eq } from 'drizzle-orm';
import {
  buildClassifierPrompt,
  classifierResults,
  classifiers,
  getDb,
  models,
  parseClassifierOutput,
  type ClassifierDimension,
} from '@llmgw/db';
import { getAdapter } from '../providers/registry';
import { resolveProviderKey } from '../providers/keys';
import type { ChatMessage } from '../providers/types';

interface ClassifierRow {
  id: string;
  name: string;
  modelSlug: string;
  sampleRate: string;
  dimensions: ClassifierDimension[];
  prompt: string;
}

async function getActiveClassifiers(workspaceId: string): Promise<ClassifierRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: classifiers.id,
      name: classifiers.name,
      modelSlug: classifiers.modelSlug,
      sampleRate: classifiers.sampleRate,
      dimensions: classifiers.dimensions,
      prompt: classifiers.prompt,
    })
    .from(classifiers)
    .where(and(eq(classifiers.workspaceId, workspaceId), eq(classifiers.enabled, true)));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    modelSlug: r.modelSlug,
    sampleRate: String(r.sampleRate),
    dimensions: (r.dimensions as ClassifierDimension[]) ?? [],
    prompt: r.prompt ?? '',
  }));
}

function conversationText(messages: ChatMessage[], completion: string): string {
  const parts = messages.map(
    (m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`,
  );
  if (completion) parts.push(`assistant: ${completion}`);
  return parts.join('\n').slice(0, 8000);
}

function extractContent(json: Record<string, unknown>): string {
  const choices = json.choices as Array<{ message?: { content?: unknown } }> | undefined;
  const c = choices?.[0]?.message?.content;
  return typeof c === 'string' ? c : '';
}

// Runs a single classifier model once and returns validated tags (no storage).
export async function classifyOnce(
  orgId: string,
  modelSlug: string,
  dimensions: ClassifierDimension[],
  prompt: string,
  conversation: string,
): Promise<Record<string, string> | null> {
  const db = getDb();
  const m = await db
    .select({ providerSlug: models.providerSlug, upstreamModel: models.upstreamModel })
    .from(models)
    .where(eq(models.slug, modelSlug))
    .limit(1);
  const model = m[0];
  if (!model) return null;
  const adapter = getAdapter(model.providerSlug);
  if (!adapter) return null;
  const { key } = await resolveProviderKey(orgId, model.providerSlug);
  if (!key) return null;
  const { system, user } = buildClassifierPrompt(dimensions, prompt, conversation);
  const { json } = await adapter.chat(
    model.upstreamModel,
    {
      model: model.upstreamModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0,
      max_tokens: 300,
    },
    key,
  );
  return parseClassifierOutput(extractContent(json), dimensions);
}

export interface ClassifyRequestParams {
  workspaceId: string;
  orgId: string;
  requestId: string;
  messages: ChatMessage[];
  completion: string;
}

// Fire-and-forget: samples each active classifier, runs it, and stores tags.
export async function runClassifiersForRequest(params: ClassifyRequestParams): Promise<void> {
  try {
    const active = await getActiveClassifiers(params.workspaceId);
    if (active.length === 0) return;
    const convo = conversationText(params.messages, params.completion);
    const db = getDb();
    for (const cls of active) {
      if (Math.random() > Number(cls.sampleRate)) continue;
      void (async () => {
        try {
          const tags = await classifyOnce(params.orgId, cls.modelSlug, cls.dimensions, cls.prompt, convo);
          if (!tags) return;
          await db.insert(classifierResults).values({
            workspaceId: params.workspaceId,
            classifierId: cls.id,
            requestId: params.requestId,
            modelSlug: cls.modelSlug,
            tags,
          });
        } catch (e) {
          console.error('[classifier] run failed:', (e as Error).message);
        }
      })();
    }
  } catch (e) {
    console.error('[classifier] dispatch failed:', (e as Error).message);
  }
}
