import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { getHttpDb, traceNodes, traceReplays } from '@llmgw/db/http';

export interface DagNode {
  nodeKey: string;
  parentKey: string | null;
  seq: number;
  role: string;
  model: string;
  provider: string;
  messages: unknown;
  params: unknown;
  output: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  outcome: string;
  overridden: boolean;
}

export interface ReplayableRequest {
  requestId: string;
  traceId: string | null;
  pattern: string;
  nodeCount: number;
  models: string[];
  finalOutput: string;
  createdAt: string;
}

export interface ReplayRecord {
  id: string;
  overrideNodeKey: string;
  override: unknown;
  pattern: string;
  finalOutput: string | null;
  originalOutput: string | null;
  totalCostUsd: number;
  latencyMs: number;
  status: string;
  createdAt: string;
}

export interface TraceDag {
  requestId: string;
  traceId: string | null;
  pattern: string;
  nodes: DagNode[];
  replays: ReplayRecord[];
}

function mapNode(r: typeof traceNodes.$inferSelect): DagNode {
  return {
    nodeKey: r.nodeKey,
    parentKey: r.parentKey,
    seq: r.seq,
    role: r.role,
    model: r.model,
    provider: r.provider,
    messages: r.messages,
    params: r.params,
    output: r.output ?? '',
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    costUsd: Number(r.costUsd),
    latencyMs: r.latencyMs,
    outcome: r.outcome,
    overridden: r.overridden,
  };
}

export async function getReplayableRequests(orgId: string, days = 30): Promise<ReplayableRequest[]> {
  const db = getHttpDb();
  const since = new Date(Date.now() - days * 86_400_000);
  const roots = await db
    .select({
      requestId: traceNodes.requestId,
      traceId: traceNodes.traceId,
      pattern: traceNodes.pattern,
      output: traceNodes.output,
      createdAt: traceNodes.createdAt,
    })
    .from(traceNodes)
    .where(
      and(
        eq(traceNodes.orgId, orgId),
        isNull(traceNodes.replayId),
        eq(traceNodes.nodeKey, 'root'),
        gte(traceNodes.createdAt, since),
      ),
    )
    .orderBy(desc(traceNodes.createdAt))
    .limit(100);
  if (roots.length === 0) return [];

  const ids = roots.map((r) => r.requestId);
  const agg = await db
    .select({
      requestId: traceNodes.requestId,
      nodeCount: sql<number>`count(*)::int`,
      models: sql<string[]>`array_remove(array_agg(distinct ${traceNodes.model}), '')`,
    })
    .from(traceNodes)
    .where(and(inArray(traceNodes.requestId, ids), isNull(traceNodes.replayId)))
    .groupBy(traceNodes.requestId);
  const aggMap = new Map(agg.map((a) => [a.requestId, a]));

  return roots.map((r) => {
    const a = aggMap.get(r.requestId);
    return {
      requestId: r.requestId,
      traceId: r.traceId,
      pattern: r.pattern,
      nodeCount: Number(a?.nodeCount ?? 1),
      models: (a?.models ?? []).filter(Boolean),
      finalOutput: r.output ?? '',
      createdAt: new Date(r.createdAt).toISOString(),
    };
  });
}

export async function getTraceDag(orgId: string, requestId: string): Promise<TraceDag | null> {
  const db = getHttpDb();
  const nodes = await db
    .select()
    .from(traceNodes)
    .where(and(eq(traceNodes.requestId, requestId), eq(traceNodes.orgId, orgId), isNull(traceNodes.replayId)))
    .orderBy(traceNodes.seq);
  if (nodes.length === 0) return null;

  const replays = await db
    .select()
    .from(traceReplays)
    .where(and(eq(traceReplays.originalRequestId, requestId), eq(traceReplays.orgId, orgId)))
    .orderBy(desc(traceReplays.createdAt))
    .limit(25);

  return {
    requestId,
    traceId: nodes[0]!.traceId,
    pattern: nodes[0]!.pattern,
    nodes: nodes.map(mapNode),
    replays: replays.map((r) => ({
      id: r.id,
      overrideNodeKey: r.overrideNodeKey,
      override: r.override,
      pattern: r.pattern,
      finalOutput: r.finalOutput,
      originalOutput: r.originalOutput,
      totalCostUsd: Number(r.totalCostUsd),
      latencyMs: r.latencyMs,
      status: r.status,
      createdAt: new Date(r.createdAt).toISOString(),
    })),
  };
}

// Fork DAG produced by a replay (for viewing a past replay's result tree).
export async function getReplayFork(orgId: string, replayId: string): Promise<DagNode[]> {
  const db = getHttpDb();
  const nodes = await db
    .select()
    .from(traceNodes)
    .where(and(eq(traceNodes.replayId, replayId), eq(traceNodes.orgId, orgId)))
    .orderBy(traceNodes.seq);
  return nodes.map(mapNode);
}
