import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, responseCache } from '@llmgw/db';
import { config } from '../config';
import { resolveProviderKey } from '../providers/keys';
import type { ChatMessage } from '../providers/types';

// Semantic + exact response cache. A hit returns a stored completion at ~zero
// upstream cost, which is the largest model-agnostic cost-optimization lever.

const SEMANTIC_THRESHOLD = Number(process.env.SEMANTIC_CACHE_THRESHOLD ?? 0.93);
const SEMANTIC_SCAN = Number(process.env.SEMANTIC_CACHE_SCAN ?? 300);
const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_PRICE_PER_M = 0.02; // USD per 1M tokens

export interface CacheHit {
  kind: 'exact' | 'semantic';
  similarity: number;
  response: Record<string, unknown>;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  embedCostUsd: number;
}

export interface CacheLookup {
  hit: CacheHit | null;
  // Query embedding computed during lookup, reusable by storeCache on a miss.
  queryEmbedding: number[] | null;
  embedCostUsd: number;
}

function normalize(messages: ChatMessage[]): string {
  return messages
    .map(
      (m) =>
        `${m.role}:${typeof m.content === 'string' ? m.content.trim() : JSON.stringify(m.content)}`,
    )
    .join('\n');
}

export function promptHashOf(messages: ChatMessage[]): string {
  return createHash('sha256').update(normalize(messages)).digest('hex');
}

function queryText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user' && typeof messages[i]!.content === 'string') {
      return messages[i]!.content as string;
    }
  }
  return normalize(messages);
}

async function embed(orgId: string, text: string): Promise<{ vec: number[]; costUsd: number } | null> {
  const { key } = await resolveProviderKey(orgId, 'openai');
  if (!key) return null;
  try {
    const res = await fetch(`${config.openaiBaseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000) }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { embedding?: number[] }[];
      usage?: { total_tokens?: number };
    };
    const vec = json.data?.[0]?.embedding;
    if (!Array.isArray(vec)) return null;
    const tokens = json.usage?.total_tokens ?? 0;
    return { vec, costUsd: (tokens / 1_000_000) * EMBED_PRICE_PER_M };
  } catch {
    return null;
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function bumpHit(id: string): void {
  const db = getDb();
  void db
    .update(responseCache)
    .set({ hitCount: sql`${responseCache.hitCount} + 1`, lastHitAt: new Date() })
    .where(eq(responseCache.id, id))
    .execute()
    .catch(() => {});
}

export async function lookupCache(
  workspaceId: string,
  orgId: string,
  messages: ChatMessage[],
  taskClass: string,
): Promise<CacheLookup> {
  const db = getDb();
  const hash = promptHashOf(messages);

  // 1) Exact match — free, no embedding needed.
  try {
    const rows = await db
      .select()
      .from(responseCache)
      .where(and(eq(responseCache.workspaceId, workspaceId), eq(responseCache.promptHash, hash)))
      .limit(1);
    const r = rows[0];
    if (r) {
      bumpHit(r.id);
      return {
        hit: {
          kind: 'exact',
          similarity: 1,
          response: r.response as Record<string, unknown>,
          model: r.model,
          provider: r.provider,
          promptTokens: r.promptTokens,
          completionTokens: r.completionTokens,
          embedCostUsd: 0,
        },
        queryEmbedding: null,
        embedCostUsd: 0,
      };
    }
  } catch (err) {
    console.error('[cache] exact lookup failed:', (err as Error).message);
  }

  // 2) Semantic match — embed the query, cosine over recent rows in the same task class.
  const emb = await embed(orgId, queryText(messages));
  if (!emb) return { hit: null, queryEmbedding: null, embedCostUsd: 0 };

  try {
    const rows = await db
      .select()
      .from(responseCache)
      .where(and(eq(responseCache.workspaceId, workspaceId), eq(responseCache.taskClass, taskClass)))
      .orderBy(desc(responseCache.createdAt))
      .limit(SEMANTIC_SCAN);
    let best: { id: string; sim: number; row: (typeof rows)[number] } | null = null;
    for (const r of rows) {
      const v = r.embedding as number[] | null;
      if (!Array.isArray(v)) continue;
      const sim = cosine(emb.vec, v);
      if (!best || sim > best.sim) best = { id: r.id, sim, row: r };
    }
    if (best && best.sim >= SEMANTIC_THRESHOLD) {
      bumpHit(best.id);
      return {
        hit: {
          kind: 'semantic',
          similarity: best.sim,
          response: best.row.response as Record<string, unknown>,
          model: best.row.model,
          provider: best.row.provider,
          promptTokens: best.row.promptTokens,
          completionTokens: best.row.completionTokens,
          embedCostUsd: emb.costUsd,
        },
        queryEmbedding: emb.vec,
        embedCostUsd: emb.costUsd,
      };
    }
  } catch (err) {
    console.error('[cache] semantic lookup failed:', (err as Error).message);
  }
  return { hit: null, queryEmbedding: emb.vec, embedCostUsd: emb.costUsd };
}

export async function storeCache(opts: {
  workspaceId: string;
  orgId: string;
  messages: ChatMessage[];
  taskClass: string;
  response: Record<string, unknown>;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  embedding?: number[] | null;
}): Promise<void> {
  try {
    const db = getDb();
    const hash = promptHashOf(opts.messages);
    // Reuse the lookup's embedding when available; otherwise compute once.
    const vec = opts.embedding ?? (await embed(opts.orgId, queryText(opts.messages)))?.vec ?? null;
    await db
      .insert(responseCache)
      .values({
        workspaceId: opts.workspaceId,
        promptHash: hash,
        taskClass: opts.taskClass,
        embedding: vec,
        model: opts.model,
        provider: opts.provider,
        response: opts.response,
        promptTokens: opts.promptTokens,
        completionTokens: opts.completionTokens,
      })
      .onConflictDoNothing();
  } catch (err) {
    console.error('[cache] store failed:', (err as Error).message);
  }
}
