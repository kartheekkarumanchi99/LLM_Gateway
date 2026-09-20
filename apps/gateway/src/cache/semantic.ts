import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { cacheHits, getDb, responseCache, type DedupConfig } from '@llmgw/db';
import { config } from '../config';
import { resolveProviderKey } from '../providers/keys';
import type { ChatMessage } from '../providers/types';

// Cross-workspace, zero-latency semantic prompt-dedup cache.
//
// Layer 1 — exact SHA-256 prompt match (free, always on).
// Layer 2 — semantic pgvector HNSW ANN match (opt-in): embed the query and find the nearest
//           prior completion by cosine similarity, gated on a threshold + freshness window.
// Within an org, a workspace can CONTRIBUTE its completions to a shared pool and/or CONSUME
// cross-workspace hits (both opt-in). A hit returns a stored completion at ~zero upstream cost.

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_PRICE_PER_M = 0.02; // USD per 1M tokens
const EMBED_TIMEOUT_MS = Number(process.env.EMBED_TIMEOUT_MS ?? 4000); // never hang routing on a slow embed
const ANN_CANDIDATES = 10; // nearest neighbors fetched from the HNSW index before threshold check

export interface CacheHit {
  kind: 'exact' | 'semantic';
  similarity: number;
  response: Record<string, unknown>;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  embedCostUsd: number;
  crossWorkspace: boolean;
  sourceWorkspaceId: string | null;
}

export interface CacheLookup {
  hit: CacheHit | null;
  queryEmbedding: number[] | null; // reusable by storeCache on a miss
  embedCostUsd: number;
}

export interface LookupParams {
  workspaceId: string;
  orgId: string;
  messages: ChatMessage[];
  taskClass: string;
  cfg: DedupConfig;
}

function normalize(messages: ChatMessage[]): string {
  return messages
    .map((m) => `${m.role}:${typeof m.content === 'string' ? m.content.trim() : JSON.stringify(m.content)}`)
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

export function lastUserChars(messages: ChatMessage[]): number {
  return queryText(messages).trim().length;
}

async function embed(orgId: string, text: string): Promise<{ vec: number[]; costUsd: number } | null> {
  const { key } = await resolveProviderKey(orgId, 'openai');
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EMBED_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.openaiBaseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000) }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { embedding?: number[] }[]; usage?: { total_tokens?: number } };
    const vec = json.data?.[0]?.embedding;
    if (!Array.isArray(vec)) return null;
    const tokens = json.usage?.total_tokens ?? 0;
    return { vec, costUsd: (tokens / 1_000_000) * EMBED_PRICE_PER_M };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

function vecLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

interface Row {
  id: string;
  response: unknown;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  workspaceId: string | null;
  similarity: number;
}

function toHit(
  r: Row,
  kind: 'exact' | 'semantic',
  similarity: number,
  selfWorkspaceId: string,
  embedCostUsd = 0,
): CacheHit {
  return {
    kind,
    similarity,
    response: r.response as Record<string, unknown>,
    model: r.model,
    provider: r.provider,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    embedCostUsd,
    crossWorkspace: r.workspaceId != null && r.workspaceId !== selfWorkspaceId,
    sourceWorkspaceId: r.workspaceId,
  };
}

export async function lookupCache(params: LookupParams): Promise<CacheLookup> {
  const { workspaceId, orgId, messages, taskClass, cfg } = params;
  const db = getDb();
  const hash = promptHashOf(messages);
  const since = new Date(Date.now() - cfg.ttlHours * 3_600_000);
  // Scope: own workspace always; other workspaces only if the consumer opted into
  // cross-workspace AND the producer marked the entry shared.
  const scope = cfg.crossWorkspace
    ? sql`(rc.workspace_id = ${workspaceId} OR (rc.org_id = ${orgId} AND rc.shared = true))`
    : sql`rc.workspace_id = ${workspaceId}`;

  // 1) Exact match — prefer own workspace, then a fresh shared org entry.
  try {
    const exact = await db.execute(sql`
      SELECT rc.id, rc.response, rc.model, rc.provider,
             rc.prompt_tokens AS "promptTokens", rc.completion_tokens AS "completionTokens",
             rc.workspace_id AS "workspaceId", 1.0 AS "similarity"
      FROM response_cache rc
      WHERE rc.prompt_hash = ${hash} AND rc.created_at > ${since} AND ${scope}
      ORDER BY (rc.workspace_id = ${workspaceId}) DESC, rc.created_at DESC
      LIMIT 1
    `);
    const ex = (exact.rows as unknown as Row[])[0];
    if (ex) {
      bumpHit(ex.id);
      return { hit: toHit(ex, 'exact', 1, workspaceId), queryEmbedding: null, embedCostUsd: 0 };
    }
  } catch (err) {
    console.error('[cache] exact lookup failed:', (err as Error).message);
    return { hit: null, queryEmbedding: null, embedCostUsd: 0 };
  }

  // Semantic (Layer 2) is opt-in.
  if (!cfg.enabled) return { hit: null, queryEmbedding: null, embedCostUsd: 0 };

  const emb = await embed(orgId, queryText(messages));
  if (!emb) return { hit: null, queryEmbedding: null, embedCostUsd: 0 };
  const vlit = vecLiteral(emb.vec);

  // 2) pgvector HNSW ANN: nearest prior completions by cosine, within scope + freshness.
  try {
    const ann = await db.execute(sql`
      SELECT rc.id, rc.response, rc.model, rc.provider,
             rc.prompt_tokens AS "promptTokens", rc.completion_tokens AS "completionTokens",
             rc.workspace_id AS "workspaceId",
             1 - (rc.embedding_vec <=> ${vlit}::vector) AS "similarity"
      FROM response_cache rc
      WHERE rc.embedding_vec IS NOT NULL AND rc.task_class = ${taskClass}
        AND rc.created_at > ${since} AND ${scope}
      ORDER BY rc.embedding_vec <=> ${vlit}::vector
      LIMIT ${ANN_CANDIDATES}
    `);
    const best = (ann.rows as unknown as Row[])[0]; // ORDER BY distance → row 0 is the nearest
    if (best && Number(best.similarity) >= cfg.similarityThreshold) {
      bumpHit(best.id);
      return {
        hit: toHit(best, 'semantic', Number(best.similarity), workspaceId, emb.costUsd),
        queryEmbedding: emb.vec,
        embedCostUsd: emb.costUsd,
      };
    }
  } catch (err) {
    console.error('[cache] ANN lookup failed:', (err as Error).message);
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
  cfg: DedupConfig;
  sensitive?: boolean;
}): Promise<void> {
  try {
    const db = getDb();
    const hash = promptHashOf(opts.messages);
    // Embed only when semantic matching is on; reuse the query embedding from lookup if present.
    const vec = opts.cfg.enabled
      ? (opts.embedding ?? (await embed(opts.orgId, queryText(opts.messages)))?.vec ?? null)
      : null;
    // Sensitive prompts are never shared to the org pool, regardless of the contribute flag.
    const shared = opts.cfg.contribute && !opts.sensitive;
    await db
      .insert(responseCache)
      .values({
        workspaceId: opts.workspaceId,
        orgId: opts.orgId,
        promptHash: hash,
        taskClass: opts.taskClass,
        embeddingVec: vec,
        shared,
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

// Analytics ledger: one row per cache-served request with the counterfactual USD saved.
export function recordCacheHit(p: {
  orgId: string;
  workspaceId: string;
  sourceWorkspaceId: string | null;
  requestId: string;
  kind: 'exact' | 'semantic';
  similarity: number;
  crossWorkspace: boolean;
  model: string;
  savedUsd: number;
}): void {
  const db = getDb();
  void db
    .insert(cacheHits)
    .values({
      orgId: p.orgId,
      workspaceId: p.workspaceId,
      sourceWorkspaceId: p.sourceWorkspaceId,
      requestId: p.requestId,
      kind: p.kind,
      similarity: p.similarity.toFixed(4),
      crossWorkspace: p.crossWorkspace,
      model: p.model,
      savedUsd: p.savedUsd.toFixed(10),
    })
    .execute()
    .catch((e) => console.error('[cache] hit ledger failed:', (e as Error).message));
}
