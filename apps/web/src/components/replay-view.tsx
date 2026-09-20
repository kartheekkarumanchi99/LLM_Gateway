'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, GitFork, Pencil, Play, RotateCcw } from 'lucide-react';
import { runReplayAction, type ReplayResult } from '@/lib/replay-actions';
import type { DagNode, TraceDag } from '@/lib/replay';

const ROLE_TONE: Record<string, string> = {
  root: 'bg-gray-100 text-gray-600 border-gray-200',
  draft: 'bg-blue-50 text-blue-700 border-blue-200',
  critic: 'bg-amber-50 text-amber-700 border-amber-200',
  revise: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  gate: 'bg-purple-50 text-purple-700 border-purple-200',
  final: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  judge: 'bg-purple-50 text-purple-700 border-purple-200',
  plan: 'bg-purple-50 text-purple-700 border-purple-200',
  compose: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};
function tone(role: string): string {
  if (role.startsWith('candidate')) return 'bg-blue-50 text-blue-700 border-blue-200';
  if (role.startsWith('subtask')) return 'bg-blue-50 text-blue-700 border-blue-200';
  return ROLE_TONE[role] ?? 'bg-gray-50 text-gray-700 border-gray-200';
}
function fmtCost(c: number): string {
  if (c <= 0) return '$0';
  if (c < 0.0001) return '<$0.0001';
  return '$' + c.toFixed(c < 0.01 ? 5 : 4);
}
function lastUser(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown };
    if (m?.role === 'user' && typeof m.content === 'string') return m.content;
  }
  const m0 = messages[0] as { content?: unknown } | undefined;
  return typeof m0?.content === 'string' ? m0.content : '';
}
function params(p: unknown): { temperature: number | null; seed: number | null; maxTokens: number } {
  const o = (p ?? {}) as { temperature?: number; seed?: number; maxTokens?: number };
  return { temperature: o.temperature ?? null, seed: o.seed ?? null, maxTokens: o.maxTokens ?? 0 };
}

export function ReplayView({ dag, models }: { dag: TraceDag; models: string[] }) {
  const router = useRouter();
  const executable = dag.nodes.filter((n) => n.role !== 'root');
  const [selectedKey, setSelectedKey] = useState<string>(executable[0]?.nodeKey ?? '');
  const selected = dag.nodes.find((n) => n.nodeKey === selectedKey) ?? null;

  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState('');
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function selectNode(n: DagNode) {
    setSelectedKey(n.nodeKey);
    setModel('');
    setTemperature('');
    setPrompt('');
    setResult(null);
    setError(null);
  }

  async function replay() {
    if (!selected) return;
    setRunning(true);
    setError(null);
    setResult(null);
    const res = await runReplayAction(dag.requestId, {
      nodeKey: selected.nodeKey,
      model: model || null,
      temperature: temperature !== '' ? Number(temperature) : null,
      prompt: prompt || null,
    });
    setRunning(false);
    if (res.ok && res.result) {
      setResult(res.result);
      router.refresh();
    } else {
      setError(res.error ?? 'Replay failed.');
    }
  }

  const hasEdit = model !== '' || temperature !== '' || prompt !== '';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="rounded bg-gray-100 px-2 py-0.5 font-medium text-gray-700">{dag.pattern}</span>
        <span>·</span>
        <span className="font-mono">{dag.requestId.slice(0, 24)}</span>
        <span>·</span>
        <span>{executable.length} nodes</span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.3fr]">
        {/* DAG */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Execution DAG</h2>
          <div className="space-y-1.5">
            {dag.nodes.map((n) => (
              <div key={n.nodeKey} className="flex items-center gap-1.5">
                <span className="w-4 shrink-0 text-center text-[10px] text-gray-300">{n.seq}</span>
                {n.parentKey && n.parentKey !== 'root' ? (
                  <span className="shrink-0 text-gray-300">
                    <ArrowRight className="h-3 w-3" />
                  </span>
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <button
                  onClick={() => selectNode(n)}
                  disabled={n.role === 'root'}
                  className={`flex-1 rounded-lg border px-3 py-2 text-left text-xs transition ${tone(n.role)} ${
                    selectedKey === n.nodeKey ? 'ring-2 ring-violet-400' : ''
                  } ${n.role === 'root' ? 'cursor-default opacity-70' : 'hover:brightness-95'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{n.nodeKey}</span>
                    {n.model ? <span className="font-mono text-[10px] opacity-80">{n.model}</span> : null}
                  </div>
                  {n.role !== 'root' ? (
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] opacity-70">
                      {params(n.params).temperature != null ? <span>temp {params(n.params).temperature}</span> : null}
                      <span>{n.completionTokens} tok</span>
                      <span>{fmtCost(n.costUsd)}</span>
                      <span>{n.latencyMs}ms</span>
                    </div>
                  ) : null}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Inspector + editor */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          {!selected || selected.role === 'root' ? (
            <p className="py-10 text-center text-sm text-gray-500">Select a node to inspect and replay.</p>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">
                  Node <span className="font-mono text-violet-600">{selected.nodeKey}</span>
                </h2>
                <span className="text-xs text-gray-400">seq {selected.seq}</span>
              </div>

              <Section label="Input (last user message)">
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-[11px] text-gray-700">
                  {lastUser(selected.messages).slice(0, 1200) || '—'}
                </pre>
              </Section>
              <Section label="Output">
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-[11px] text-gray-700">
                  {selected.output.slice(0, 1200) || '—'}
                </pre>
              </Section>

              {/* Editor */}
              <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50/40 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-violet-700">
                  <Pencil className="h-3.5 w-3.5" /> Modify this node, then replay
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="text-[11px] text-gray-600">
                    Swap model
                    <input
                      list="replay-models"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder={selected.model || 'keep current'}
                      className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-xs outline-none focus:border-violet-500"
                    />
                    <datalist id="replay-models">
                      {models.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </label>
                  <label className="text-[11px] text-gray-600">
                    Temperature
                    <input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={temperature}
                      onChange={(e) => setTemperature(e.target.value)}
                      placeholder={params(selected.params).temperature?.toString() ?? 'default'}
                      className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-xs outline-none focus:border-violet-500"
                    />
                  </label>
                </div>
                <label className="mt-2 block text-[11px] text-gray-600">
                  Edit prompt (replaces the last user message)
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={2}
                    placeholder="leave blank to keep the recorded prompt"
                    className="mt-0.5 w-full resize-y rounded border border-gray-300 px-2 py-1 text-xs outline-none focus:border-violet-500"
                  />
                </label>
                <button
                  onClick={replay}
                  disabled={running || !hasEdit}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  <Play className="h-4 w-4" />
                  {running ? 'Replaying…' : 'Replay from this node'}
                </button>
                {!hasEdit ? <span className="ml-2 text-[11px] text-gray-400">Change something to replay.</span> : null}
                {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Replay result */}
      {result ? <ReplayResultView result={result} /> : null}

      {/* Past replays */}
      {dag.replays.length > 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Past replays</h2>
          </div>
          <ul className="divide-y divide-gray-100">
            {dag.replays.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <GitFork className="h-3.5 w-3.5 text-gray-300" />
                  <span>
                    override <span className="font-mono text-violet-600">{r.overrideNodeKey}</span>
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${r.status === 'complete' ? 'bg-emerald-50 text-emerald-600' : r.status === 'error' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                    {r.status}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-gray-400">
                  <span>{fmtCost(r.totalCostUsd)}</span>
                  <span>{r.latencyMs}ms</span>
                  <span>{r.createdAt.slice(0, 16).replace('T', ' ')}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ReplayResultView({ result }: { result: ReplayResult }) {
  const changed = result.finalOutput !== result.originalOutput;
  return (
    <div className="rounded-xl border border-violet-200 bg-white">
      <div className="flex items-center justify-between border-b border-violet-100 bg-violet-50/40 px-5 py-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-violet-800">
          <RotateCcw className="h-4 w-4" /> Replay result — {result.frames.length} frame(s) re-executed
        </h2>
        <span className="text-xs text-gray-500">
          {fmtCost(result.totalCostUsd)} · {result.latencyMs}ms
        </span>
      </div>

      {/* Frames */}
      <div className="divide-y divide-gray-100">
        {result.frames.map((f, i) => (
          <div key={f.nodeKey + i} className="px-5 py-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-violet-100 text-[10px] font-medium text-violet-700">
                {i + 1}
              </span>
              <span className="font-mono text-gray-800">{f.nodeKey}</span>
              {f.isOverride ? <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700">overridden</span> : <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">re-threaded</span>}
              {f.modelBefore !== f.modelAfter ? (
                <span className="text-[11px] text-gray-500">
                  <span className="font-mono line-through opacity-60">{f.modelBefore}</span>
                  <ArrowRight className="mx-1 inline h-3 w-3" />
                  <span className="font-mono text-violet-600">{f.modelAfter}</span>
                </span>
              ) : (
                <span className="font-mono text-[11px] text-gray-400">{f.modelAfter}</span>
              )}
              {f.changed ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">output changed</span> : <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">identical</span>}
              <span className="ml-auto text-[11px] text-gray-400">{fmtCost(f.costUsd)} · {f.latencyMs}ms</span>
            </div>
            {f.error ? (
              <p className="text-xs text-red-600">{f.error}</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Diff label="Before" text={f.outputBefore} tone="gray" />
                <Diff label="After" text={f.outputAfter} tone={f.changed ? 'violet' : 'gray'} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Final answer diff */}
      <div className="border-t border-gray-100 px-5 py-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
          Final answer {changed ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">changed</span> : <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600">unchanged</span>}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Diff label="Original" text={result.originalOutput} tone="gray" />
          <Diff label="Replayed" text={result.finalOutput} tone={changed ? 'violet' : 'gray'} />
        </div>
      </div>
    </div>
  );
}

function Diff({ label, text, tone }: { label: string; text: string; tone: 'gray' | 'violet' }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <pre className={`max-h-48 overflow-auto whitespace-pre-wrap rounded p-2 text-[11px] ${tone === 'violet' ? 'bg-violet-50 text-gray-800' : 'bg-gray-50 text-gray-600'}`}>
        {text.slice(0, 2000) || '—'}
      </pre>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      {children}
    </div>
  );
}
