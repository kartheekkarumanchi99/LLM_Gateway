import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb, traceNodes, traceReplays } from '@llmgw/db';
import { recordUsage } from '../billing/record';
import { resolveProviderKey } from '../providers/keys';
import { getAdapter } from '../providers/registry';
import type { ChatCompletionRequest, ChatMessage } from '../providers/types';
import { resolveModel } from '../routing/resolve';
import { recordDag, type CapturedNode, type NodeParams } from './capture';

// Deterministic state replay: re-execute a captured request from ONE overridden node
// forward. A node is "downstream" if its recorded input embedded a changed ancestor's
// output; those get the new output substituted and are re-run. Everything else is kept
// as-is. Faithfully reproduces the recorded DAG structure with substituted content —
// control-flow branches (e.g. a cascade quality gate) are not re-evaluated.

const LEG_TIMEOUT_MS = 45_000;

export interface ReplayOverride {
  nodeKey: string;
  model?: string | null;
  temperature?: number | null;
  topP?: number | null;
  seed?: number | null;
  prompt?: string | null;
}

export interface ReplayFrame {
  nodeKey: string;
  role: string;
  modelBefore: string;
  modelAfter: string;
  paramsBefore: NodeParams;
  paramsAfter: NodeParams;
  inputMessages: ChatMessage[];
  outputBefore: string;
  outputAfter: string;
  changed: boolean;
  isOverride: boolean;
  costUsd: number;
  latencyMs: number;
  error?: string | null;
}

export interface ReplayResult {
  replayId: string;
  pattern: string;
  originalOutput: string;
  finalOutput: string;
  totalCostUsd: number;
  latencyMs: number;
  frames: ReplayFrame[];
  error?: string;
}

interface LoadedNode {
  nodeKey: string;
  parentKey: string | null;
  seq: number;
  role: string;
  model: string;
  provider: string;
  messages: ChatMessage[];
  params: NodeParams;
  output: string;
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function extractContent(json: Record<string, unknown>): string {
  const choices = json.choices as Array<{ message?: { content?: unknown } }> | undefined;
  const c = choices?.[0]?.message?.content;
  return typeof c === 'string' ? c : '';
}

// Replace each changed ancestor's original output with its new output inside a node's input.
function substitute(messages: ChatMessage[], changes: { from: string; to: string }[]): ChatMessage[] {
  return messages.map((m) => {
    if (typeof m.content !== 'string') return m;
    let c = m.content;
    for (const ch of changes) {
      if (ch.from && c.includes(ch.from)) c = c.split(ch.from).join(ch.to);
    }
    return { ...m, content: c };
  });
}

function dependsOn(messages: ChatMessage[], changes: { from: string; to: string }[]): boolean {
  const blob = messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
  return changes.some((ch) => ch.from && blob.includes(ch.from));
}

// Apply a prompt edit to a node's last user message.
function applyPrompt(messages: ChatMessage[], prompt: string): ChatMessage[] {
  const out = messages.map((m) => ({ ...m }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i]!.role === 'user') {
      out[i]!.content = prompt;
      return out;
    }
  }
  out.push({ role: 'user', content: prompt });
  return out;
}

interface CallOutcome {
  output: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
}

async function callModel(
  orgId: string,
  replayId: string,
  nodeKey: string,
  modelSlug: string,
  messages: ChatMessage[],
  params: NodeParams,
): Promise<CallOutcome> {
  const resolved = await resolveModel(modelSlug);
  if (!resolved) return fail('model not found');
  const adapter = getAdapter(resolved.providerSlug);
  if (!adapter) return fail(`no adapter for ${resolved.providerSlug}`);
  const keyInfo = await resolveProviderKey(orgId, resolved.providerSlug);
  if (!keyInfo.key) return fail(`no provider key for ${resolved.providerSlug}`);

  const body = {
    model: resolved.upstreamModel,
    messages,
    max_tokens: params.maxTokens,
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
    ...(params.topP != null ? { top_p: params.topP } : {}),
    ...(params.seed != null ? { seed: params.seed } : {}),
  } as ChatCompletionRequest;
  const started = Date.now();
  try {
    const { json, usage } = await withTimeout(
      adapter.chat(resolved.upstreamModel, body, keyInfo.key),
      LEG_TIMEOUT_MS,
      `${nodeKey} replay timed out`,
    );
    const latencyMs = Date.now() - started;
    const costUsd = await recordUsage({
      requestId: `replay-${replayId}#${nodeKey}`,
      orgId,
      modelSlug: resolved.slug,
      providerSlug: resolved.providerSlug,
      taskClass: 'replay',
      status: 'success',
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      promptPricePerM: resolved.promptPricePerM,
      completionPricePerM: resolved.completionPricePerM,
      latencyMs,
      byok: keyInfo.isByok,
      appName: 'replay',
    });
    return {
      output: extractContent(json),
      provider: resolved.providerSlug,
      model: resolved.slug,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd,
      latencyMs,
      ok: true,
    };
  } catch (err) {
    return { ...fail((err as Error).message), latencyMs: Date.now() - started };
  }

  function fail(error: string): CallOutcome {
    return { output: '', provider: resolved?.providerSlug ?? '', model: modelSlug, promptTokens: 0, completionTokens: 0, costUsd: 0, latencyMs: 0, ok: false, error };
  }
}

export async function runReplay(params: {
  orgId: string;
  workspaceId: string;
  requestId: string;
  override: ReplayOverride;
}): Promise<ReplayResult> {
  const db = getDb();
  const started = Date.now();

  const raw = await db
    .select()
    .from(traceNodes)
    .where(and(eq(traceNodes.requestId, params.requestId), isNull(traceNodes.replayId)))
    .orderBy(asc(traceNodes.seq));
  if (raw.length === 0) throw new Error('No captured trace for this request.');

  const pattern = raw[0]!.pattern;
  const traceId = raw[0]!.traceId;
  const rootRow = raw.find((r) => r.nodeKey === 'root');
  const rootMessages = (rootRow?.messages as ChatMessage[] | null) ?? [];
  const originalOutput = rootRow?.output ?? '';

  const nodes: LoadedNode[] = raw
    .filter((r) => r.nodeKey !== 'root')
    .map((r) => ({
      nodeKey: r.nodeKey,
      parentKey: r.parentKey,
      seq: r.seq,
      role: r.role,
      model: r.model,
      provider: r.provider,
      messages: (r.messages as ChatMessage[] | null) ?? [],
      params: (r.params as NodeParams | null) ?? { temperature: null, topP: null, maxTokens: 512, seed: null },
      output: r.output ?? '',
    }));

  const target = nodes.find((n) => n.nodeKey === params.override.nodeKey);
  if (!target) throw new Error(`Node "${params.override.nodeKey}" not found in this trace.`);

  // The node that produced the request's final answer (handles bestofn where the terminal
  // by sequence is the judge but the answer is the winning candidate).
  const terminal = [...nodes].reverse().find((n) => n.output === originalOutput) ?? nodes[nodes.length - 1]!;

  const [replayRow] = await db
    .insert(traceReplays)
    .values({
      originalRequestId: params.requestId,
      traceId,
      orgId: params.orgId,
      workspaceId: params.workspaceId,
      overrideNodeKey: params.override.nodeKey,
      override: params.override as unknown as object,
      pattern,
      originalOutput,
      status: 'running',
    })
    .returning({ id: traceReplays.id });
  const replayId = replayRow!.id;

  const frames: ReplayFrame[] = [];
  const changes: { from: string; to: string }[] = [];
  const newOutputs = new Map<string, string>();
  let totalCostUsd = 0;

  try {
    // Re-run nodes from the target forward, in execution order.
    for (const node of nodes) {
      if (node.seq < target.seq) continue;
      const isTarget = node.nodeKey === target.nodeKey;
      const downstream = dependsOn(node.messages, changes);
      if (!isTarget && !downstream) continue; // unaffected by the change

      // Build this node's input: substitute changed ancestor outputs; apply a prompt edit
      // only to the overridden node.
      let input = substitute(node.messages, changes);
      if (isTarget && params.override.prompt != null) input = applyPrompt(input, params.override.prompt);

      const modelAfter = isTarget && params.override.model ? params.override.model : node.model;
      const paramsAfter: NodeParams = {
        temperature: isTarget && params.override.temperature != null ? params.override.temperature : node.params.temperature,
        topP: isTarget && params.override.topP != null ? params.override.topP : node.params.topP,
        maxTokens: node.params.maxTokens,
        seed: isTarget && params.override.seed != null ? params.override.seed : node.params.seed,
      };

      const res = await callModel(params.orgId, replayId, node.nodeKey, modelAfter, input, paramsAfter);
      totalCostUsd += res.costUsd;
      const outputAfter = res.ok ? res.output : node.output;
      if (res.ok && outputAfter !== node.output) {
        changes.push({ from: node.output, to: outputAfter });
      }
      newOutputs.set(node.nodeKey, outputAfter);

      frames.push({
        nodeKey: node.nodeKey,
        role: node.role,
        modelBefore: node.model,
        modelAfter: res.ok ? res.model : modelAfter,
        paramsBefore: node.params,
        paramsAfter,
        inputMessages: input,
        outputBefore: node.output,
        outputAfter,
        changed: outputAfter !== node.output,
        isOverride: isTarget,
        costUsd: res.costUsd,
        latencyMs: res.latencyMs,
        error: res.ok ? null : res.error ?? 'failed',
      });
    }

    const finalOutput = newOutputs.get(terminal.nodeKey) ?? originalOutput;

    // Persist the fork DAG (every node, with re-run outputs where they changed).
    const forkNodes: CapturedNode[] = nodes.map((n) => ({
      nodeKey: n.nodeKey,
      parentKey: n.parentKey,
      seq: n.seq,
      role: n.role,
      model: n.nodeKey === target.nodeKey && params.override.model ? params.override.model : n.model,
      provider: n.provider,
      messages: n.messages,
      params: n.nodeKey === target.nodeKey
        ? {
            temperature: params.override.temperature ?? n.params.temperature,
            topP: params.override.topP ?? n.params.topP,
            maxTokens: n.params.maxTokens,
            seed: params.override.seed ?? n.params.seed,
          }
        : n.params,
      output: newOutputs.get(n.nodeKey) ?? n.output,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      outcome: 'ok',
    }));
    await recordDag({
      requestId: params.requestId,
      traceId,
      orgId: params.orgId,
      workspaceId: params.workspaceId,
      pattern,
      rootMessages,
      finalOutput,
      nodes: forkNodes,
      replayId,
      overriddenKey: target.nodeKey,
    });

    await db
      .update(traceReplays)
      .set({
        status: 'complete',
        finalOutput: finalOutput.slice(0, 40_000),
        totalCostUsd: totalCostUsd.toFixed(10),
        latencyMs: Date.now() - started,
        completedAt: new Date(),
      })
      .where(eq(traceReplays.id, replayId));

    return { replayId, pattern, originalOutput, finalOutput, totalCostUsd, latencyMs: Date.now() - started, frames };
  } catch (err) {
    await db
      .update(traceReplays)
      .set({ status: 'error', error: (err as Error).message.slice(0, 500), completedAt: new Date() })
      .where(eq(traceReplays.id, replayId));
    return { replayId, pattern, originalOutput, finalOutput: originalOutput, totalCostUsd, latencyMs: Date.now() - started, frames, error: (err as Error).message };
  }
}
