'use server';

import { and, desc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import {
  buildClassifierPrompt,
  classifiers,
  decryptSecret,
  getHttpDb,
  MAX_CLASSIFIERS,
  MAX_DIMENSIONS,
  models,
  parseClassifierOutput,
  providerKeys,
  type ClassifierDimension,
} from '@llmgw/db/http';
import { getCurrentWorkspace } from './session';

export interface ClassifierInput {
  id?: string;
  name: string;
  preset: string;
  modelSlug: string;
  sampleRate: number;
  dimensions: ClassifierDimension[];
  prompt: string;
  enabled: boolean;
}

function cleanDimensions(dims: ClassifierDimension[]): ClassifierDimension[] {
  return dims
    .slice(0, MAX_DIMENSIONS)
    .map((d) => ({ name: d.name.trim(), values: d.values.map((v) => v.trim()).filter(Boolean) }))
    .filter((d) => d.name && d.values.length > 0);
}

export async function saveClassifier(input: ClassifierInput): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected.' };
  if (!input.name.trim()) return { ok: false, error: 'Name is required.' };
  if (!input.modelSlug.trim()) return { ok: false, error: 'A classifier model is required.' };
  const dims = cleanDimensions(input.dimensions);
  if (dims.length === 0) return { ok: false, error: 'Add at least one dimension with one value.' };

  const db = getHttpDb();
  const row = {
    name: input.name.trim().slice(0, 80),
    preset: input.preset,
    modelSlug: input.modelSlug,
    sampleRate: String(Math.min(1, Math.max(0, input.sampleRate))),
    dimensions: dims,
    prompt: input.prompt.trim(),
    enabled: input.enabled,
  };

  if (input.id) {
    await db
      .update(classifiers)
      .set(row)
      .where(and(eq(classifiers.id, input.id), eq(classifiers.workspaceId, ctx.workspace.id)));
    revalidatePath('/classifiers');
    return { ok: true };
  }

  const existing = await db
    .select({ id: classifiers.id })
    .from(classifiers)
    .where(eq(classifiers.workspaceId, ctx.workspace.id));
  if (existing.length >= MAX_CLASSIFIERS) {
    return { ok: false, error: `You can create at most ${MAX_CLASSIFIERS} classifiers per workspace.` };
  }

  await db.insert(classifiers).values({ workspaceId: ctx.workspace.id, ...row });
  revalidatePath('/classifiers');
  return { ok: true };
}

export async function deleteClassifier(id: string): Promise<{ ok: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  const db = getHttpDb();
  await db
    .delete(classifiers)
    .where(and(eq(classifiers.id, id), eq(classifiers.workspaceId, ctx.workspace.id)));
  revalidatePath('/classifiers');
  return { ok: true };
}

async function resolveKey(orgId: string, providerSlug: string): Promise<string> {
  const db = getHttpDb();
  const rows = await db
    .select({ enc: providerKeys.encryptedKey })
    .from(providerKeys)
    .where(and(eq(providerKeys.orgId, orgId), eq(providerKeys.providerSlug, providerSlug)))
    .orderBy(desc(providerKeys.createdAt))
    .limit(1);
  if (rows[0]) {
    try {
      return decryptSecret(rows[0].enc);
    } catch {
      /* fall through to platform key */
    }
  }
  if (providerSlug === 'openai') return process.env.OPENAI_API_KEY ?? '';
  if (providerSlug === 'anthropic') return process.env.ANTHROPIC_API_KEY ?? '';
  return '';
}

async function callProvider(
  providerSlug: string,
  upstreamModel: string,
  apiKey: string,
  system: string,
  user: string,
): Promise<string> {
  if (providerSlug === 'openai') {
    const base = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: upstreamModel,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        max_tokens: 300,
      }),
    });
    const json = (await res.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (!res.ok) throw new Error(json?.error?.message ?? `OpenAI error ${res.status}`);
    return json.choices?.[0]?.message?.content ?? '';
  }
  if (providerSlug === 'anthropic') {
    const base = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1';
    const res = await fetch(`${base}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: upstreamModel,
        system,
        messages: [{ role: 'user', content: user }],
        max_tokens: 300,
        temperature: 0,
      }),
    });
    const json = (await res.json()) as {
      error?: { message?: string };
      content?: Array<{ text?: string }>;
    };
    if (!res.ok) throw new Error(json?.error?.message ?? `Anthropic error ${res.status}`);
    return Array.isArray(json.content) ? json.content.map((p) => p?.text ?? '').join('') : '';
  }
  throw new Error(`Provider "${providerSlug}" is not configured for classification.`);
}

export async function testClassifier(
  input: ClassifierInput,
  sampleMessage: string,
): Promise<{ ok: boolean; tags?: Record<string, string>; content?: string; error?: string }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected.' };
  if (!sampleMessage.trim()) return { ok: false, error: 'Enter a sample message to classify.' };
  const dims = cleanDimensions(input.dimensions);
  if (dims.length === 0) return { ok: false, error: 'Add at least one dimension with one value.' };

  const db = getHttpDb();
  const m = await db
    .select({ providerSlug: models.providerSlug, upstreamModel: models.upstreamModel })
    .from(models)
    .where(eq(models.slug, input.modelSlug))
    .limit(1);
  const model = m[0];
  if (!model) return { ok: false, error: 'Selected model was not found.' };

  const apiKey = await resolveKey(ctx.org.id, model.providerSlug);
  if (!apiKey) {
    return { ok: false, error: `No API key available for ${model.providerSlug}. Add one under BYOK or set the platform key.` };
  }

  try {
    const { system, user } = buildClassifierPrompt(dims, input.prompt, `user: ${sampleMessage.trim()}`);
    const content = await callProvider(model.providerSlug, model.upstreamModel, apiKey, system, user);
    const tags = parseClassifierOutput(content, dims);
    return { ok: true, tags, content };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
