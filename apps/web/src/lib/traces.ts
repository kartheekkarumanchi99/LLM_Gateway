import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { getHttpDb, requestLogs, traceAnnotations, usageEvents } from '@llmgw/db/http';

export interface TraceListItem {
  traceId: string;
  startedAt: string;
  endedAt: string;
  steps: number;
  spanCount: number;
  totalCostUsd: number;
  totalTokens: number;
  models: string[];
  appName: string | null;
  hasError: boolean;
  starred: boolean;
}

export interface TraceAttempt {
  slug: string;
  providerSlug: string;
  result: string;
  reason?: string;
}

export interface TraceSpan {
  id: string;
  kind: 'request' | 'leg';
  parentId: string | null;
  label: string;
  model: string;
  provider: string;
  status: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
  offsetMs: number;
  finishReason: string | null;
  cached: boolean;
  attempts: TraceAttempt[];
  hasLog: boolean;
  messages: unknown | null;
  completion: string | null;
}

export interface TraceDetail {
  traceId: string;
  startedAt: string;
  endedAt: string;
  wallMs: number;
  steps: number;
  totalCostUsd: number;
  totalTokens: number;
  models: string[];
  hasError: boolean;
  spans: TraceSpan[];
  annotation: { starred: boolean; note: string | null };
  replayMessages: unknown | null;
  replayModel: string | null;
}

function ms(v: unknown): number {
  return v instanceof Date ? v.getTime() : new Date(String(v)).getTime();
}
function isLeg(requestId: string): boolean {
  return requestId.includes('#');
}
function legRole(requestId: string): string {
  const i = requestId.indexOf('#');
  return i >= 0 ? requestId.slice(i + 1) : 'leg';
}

function parseAttempts(routingTrace: unknown): TraceAttempt[] {
  if (!routingTrace || typeof routingTrace !== 'object') return [];
  const attempts = (routingTrace as { attempts?: unknown }).attempts;
  if (!Array.isArray(attempts)) return [];
  return attempts
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      slug: String(a.slug ?? ''),
      providerSlug: String(a.providerSlug ?? ''),
      result: String(a.result ?? ''),
      ...(typeof a.reason === 'string' ? { reason: a.reason } : {}),
    }));
}

const DEFAULT_ROW_CAP = 5000;

export async function getTraces(workspaceId: string, days: number): Promise<TraceListItem[]> {
  const db = getHttpDb();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      traceId: usageEvents.traceId,
      requestId: usageEvents.requestId,
      status: usageEvents.status,
      costUsd: usageEvents.costUsd,
      totalTokens: usageEvents.totalTokens,
      appName: usageEvents.appName,
      modelSlug: usageEvents.modelSlug,
      latencyMs: usageEvents.latencyMs,
      createdAt: usageEvents.createdAt,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.workspaceId, workspaceId),
        isNotNull(usageEvents.traceId),
        gte(usageEvents.createdAt, since),
      ),
    )
    .orderBy(desc(usageEvents.createdAt))
    .limit(DEFAULT_ROW_CAP);

  const starredRows = await db
    .select({ traceId: traceAnnotations.traceId, starred: traceAnnotations.starred })
    .from(traceAnnotations)
    .where(and(eq(traceAnnotations.workspaceId, workspaceId), eq(traceAnnotations.starred, true)));
  const starredSet = new Set(starredRows.map((r) => r.traceId));

  const map = new Map<
    string,
    {
      minStart: number;
      maxEnd: number;
      steps: Set<string>;
      spanCount: number;
      cost: number;
      tokens: number;
      models: Set<string>;
      appName: string | null;
      hasError: boolean;
    }
  >();
  for (const r of rows) {
    const tid = r.traceId as string;
    let e = map.get(tid);
    if (!e) {
      e = {
        minStart: Infinity,
        maxEnd: -Infinity,
        steps: new Set(),
        spanCount: 0,
        cost: 0,
        tokens: 0,
        models: new Set(),
        appName: null,
        hasError: false,
      };
      map.set(tid, e);
    }
    const end = ms(r.createdAt);
    const start = end - (r.latencyMs ?? 0);
    e.minStart = Math.min(e.minStart, start);
    e.maxEnd = Math.max(e.maxEnd, end);
    e.spanCount += 1;
    if (!isLeg(r.requestId)) {
      e.steps.add(r.requestId);
      if (!e.appName) e.appName = r.appName ?? null;
    }
    e.cost += Number(r.costUsd);
    e.tokens += r.totalTokens ?? 0;
    e.models.add(r.modelSlug);
    if (r.status === 'error') e.hasError = true;
  }

  const list: TraceListItem[] = [];
  for (const [traceId, e] of map) {
    list.push({
      traceId,
      startedAt: new Date(e.minStart).toISOString(),
      endedAt: new Date(e.maxEnd).toISOString(),
      steps: Math.max(1, e.steps.size),
      spanCount: e.spanCount,
      totalCostUsd: e.cost,
      totalTokens: e.tokens,
      models: [...e.models],
      appName: e.appName,
      hasError: e.hasError,
      starred: starredSet.has(traceId),
    });
  }
  list.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return list.slice(0, 200);
}

export async function getTrace(workspaceId: string, traceId: string): Promise<TraceDetail | null> {
  const db = getHttpDb();
  const rows = await db
    .select()
    .from(usageEvents)
    .where(and(eq(usageEvents.workspaceId, workspaceId), eq(usageEvents.traceId, traceId)))
    .orderBy(usageEvents.createdAt);
  if (rows.length === 0) return null;

  const logRows = await db
    .select({
      requestId: requestLogs.requestId,
      messages: requestLogs.messages,
      completion: requestLogs.completion,
    })
    .from(requestLogs)
    .where(and(eq(requestLogs.workspaceId, workspaceId), eq(requestLogs.traceId, traceId)));
  const logByRequest = new Map(logRows.map((l) => [l.requestId, l]));

  const ends = rows.map((r) => ms(r.createdAt));
  const starts = rows.map((r, i) => ends[i]! - (r.latencyMs ?? 0));
  const traceStart = Math.min(...starts);
  const traceEnd = Math.max(...ends);

  const spans: TraceSpan[] = rows.map((r, i) => {
    const leg = isLeg(r.requestId);
    const log = logByRequest.get(r.requestId);
    return {
      id: r.requestId,
      kind: leg ? 'leg' : 'request',
      parentId: leg ? r.requestId.slice(0, r.requestId.indexOf('#')) : null,
      label: leg ? legRole(r.requestId) : 'request',
      model: r.modelSlug,
      provider: r.providerSlug,
      status: r.status,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      totalTokens: r.totalTokens,
      costUsd: Number(r.costUsd),
      latencyMs: r.latencyMs,
      offsetMs: Math.max(0, starts[i]! - traceStart),
      finishReason: r.finishReason,
      cached: r.cached,
      attempts: leg ? [] : parseAttempts(r.routingTrace),
      hasLog: !!log,
      messages: log?.messages ?? null,
      completion: log?.completion ?? null,
    };
  });

  // Order: each request followed by its legs, requests by start time.
  const requests = spans.filter((s) => s.kind === 'request').sort((a, b) => a.offsetMs - b.offsetMs);
  const legsByParent = new Map<string, TraceSpan[]>();
  for (const s of spans.filter((s) => s.kind === 'leg')) {
    const arr = legsByParent.get(s.parentId!) ?? [];
    arr.push(s);
    legsByParent.set(s.parentId!, arr);
  }
  const ordered: TraceSpan[] = [];
  for (const req of requests) {
    ordered.push(req);
    const legs = (legsByParent.get(req.id) ?? []).sort((a, b) => a.offsetMs - b.offsetMs);
    ordered.push(...legs);
  }
  // Any orphan legs (parent not in this trace) appended at the end.
  const seen = new Set(ordered.map((s) => s.id));
  for (const s of spans) if (!seen.has(s.id)) ordered.push(s);

  const ann = await db
    .select({ starred: traceAnnotations.starred, note: traceAnnotations.note })
    .from(traceAnnotations)
    .where(and(eq(traceAnnotations.workspaceId, workspaceId), eq(traceAnnotations.traceId, traceId)))
    .limit(1);

  // Replay uses the first primary request that has stored messages.
  const firstWithLog = requests.find((r) => r.hasLog && Array.isArray(r.messages));
  const models = [...new Set(rows.map((r) => r.modelSlug))];

  return {
    traceId,
    startedAt: new Date(traceStart).toISOString(),
    endedAt: new Date(traceEnd).toISOString(),
    wallMs: traceEnd - traceStart,
    steps: requests.length,
    totalCostUsd: rows.reduce((a, r) => a + Number(r.costUsd), 0),
    totalTokens: rows.reduce((a, r) => a + r.totalTokens, 0),
    models,
    hasError: rows.some((r) => r.status === 'error'),
    spans: ordered,
    annotation: { starred: ann[0]?.starred ?? false, note: ann[0]?.note ?? null },
    replayMessages: firstWithLog?.messages ?? null,
    replayModel: firstWithLog?.model ?? null,
  };
}
