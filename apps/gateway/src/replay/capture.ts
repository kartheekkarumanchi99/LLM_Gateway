import { createHash } from 'node:crypto';
import { getDb, traceNodes } from '@llmgw/db';
import type { ChatMessage } from '../providers/types';

// Records the full execution DAG of a request so any node can later be inspected and
// deterministically re-run. Capture is best-effort and never throws into the request path.

export interface NodeParams {
  temperature: number | null;
  topP: number | null;
  maxTokens: number;
  seed: number | null;
}

export interface CapturedNode {
  nodeKey: string;
  parentKey: string | null;
  seq: number;
  role: string;
  model: string;
  provider: string;
  messages: ChatMessage[];
  params: NodeParams;
  output: string;
  toolCalls?: unknown;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  outcome: string;
  note?: string | null;
}

// Deterministic per-node seed so an unchanged replay reproduces its output and a
// model swap runs under the same seed. OpenAI honors `seed`; others ignore it.
export function seedFor(requestId: string, nodeKey: string): number {
  const h = createHash('sha256').update(`${requestId}:${nodeKey}`).digest('hex').slice(0, 8);
  return parseInt(h, 16);
}

// Role → parent edge for a readable DAG. Fan-in nodes (judge, compose) attach to root;
// the UI renders the candidate/subtask fan-in by convention.
function parentForRole(role: string, keys: Set<string>): string | null {
  if (role === 'root') return null;
  if (role === 'draft' || role === 'plan' || role.startsWith('candidate')) return 'root';
  if (role === 'gate') return keys.has('draft') ? 'draft' : 'root';
  if (role === 'critic') return keys.has('draft') ? 'draft' : 'root';
  if (role === 'revise') return keys.has('critic') ? 'critic' : keys.has('draft') ? 'draft' : 'root';
  if (role === 'final') return keys.has('gate') ? 'gate' : 'root';
  if (role === 'judge') return 'root';
  if (role.startsWith('subtask')) return keys.has('plan') ? 'plan' : 'root';
  if (role === 'compose') return keys.has('plan') ? 'plan' : 'root';
  return 'root';
}

export interface RecordDagParams {
  requestId: string;
  traceId: string | null;
  orgId: string;
  workspaceId: string;
  pattern: string;
  rootMessages: ChatMessage[];
  finalOutput: string;
  nodes: CapturedNode[];
  replayId?: string | null;
  overriddenKey?: string | null;
}

// Persist the DAG: a synthetic 'root' (the original request) plus every executed node,
// with parent edges and execution order.
export async function recordDag(p: RecordDagParams): Promise<void> {
  try {
    const keys = new Set(p.nodes.map((n) => n.nodeKey));
    keys.add('root');
    const rows = [
      {
        requestId: p.requestId,
        traceId: p.traceId,
        orgId: p.orgId,
        workspaceId: p.workspaceId,
        replayId: p.replayId ?? null,
        pattern: p.pattern,
        nodeKey: 'root',
        parentKey: null,
        seq: 0,
        role: 'root',
        model: '',
        provider: '',
        messages: p.rootMessages as unknown as object,
        params: null,
        output: p.finalOutput.slice(0, 40_000),
        toolCalls: null,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: '0',
        latencyMs: 0,
        outcome: 'ok',
        note: null,
        overridden: false,
      },
      ...p.nodes.map((n, i) => ({
        requestId: p.requestId,
        traceId: p.traceId,
        orgId: p.orgId,
        workspaceId: p.workspaceId,
        replayId: p.replayId ?? null,
        pattern: p.pattern,
        nodeKey: n.nodeKey,
        parentKey: n.parentKey ?? parentForRole(n.role, keys),
        seq: i + 1,
        role: n.role,
        model: n.model,
        provider: n.provider,
        messages: n.messages as unknown as object,
        params: n.params as unknown as object,
        output: n.output.slice(0, 40_000),
        toolCalls: (n.toolCalls ?? null) as object | null,
        promptTokens: n.promptTokens,
        completionTokens: n.completionTokens,
        costUsd: n.costUsd.toFixed(10),
        latencyMs: n.latencyMs,
        outcome: n.outcome,
        note: n.note ?? null,
        overridden: p.overriddenKey != null && n.nodeKey === p.overriddenKey,
      })),
    ];
    await getDb().insert(traceNodes).values(rows);
  } catch (e) {
    console.error('[replay] DAG capture failed:', (e as Error).message);
  }
}
