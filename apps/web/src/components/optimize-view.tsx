'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FlaskConical, Loader2, Play, Plus, Trophy, X } from 'lucide-react';
import type { ModelOption } from '@/lib/classifiers';
import type { OptimizationRunListItem } from '@/lib/optimization';
import { runOptimization } from '@/lib/optimization-actions';

interface ExampleRow {
  input: string;
  reference: string;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    complete: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    running: 'bg-blue-50 text-blue-700 ring-blue-200',
    error: 'bg-rose-50 text-rose-700 ring-rose-200',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${map[status] ?? 'bg-gray-100 text-gray-600 ring-gray-200'}`}>
      {status}
    </span>
  );
}

export function OptimizeView({
  models,
  runs,
}: {
  models: ModelOption[];
  runs: OptimizationRunListItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [taskClass, setTaskClass] = useState('general');
  const [baseline, setBaseline] = useState('');
  const [examples, setExamples] = useState<ExampleRow[]>([{ input: '', reference: '' }]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [variants, setVariants] = useState(3);
  const [weights, setWeights] = useState({ quality: 0.7, cost: 0.2, latency: 0.1 });
  const [maxTokens, setMaxTokens] = useState(512);

  function setExample(i: number, patch: Partial<ExampleRow>) {
    setExamples((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function addExample() {
    setExamples((prev) => [...prev, { input: '', reference: '' }]);
  }
  function removeExample(i: number) {
    setExamples((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }
  function toggleModel(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  const validExamples = examples.filter((e) => e.input.trim().length > 0);
  const canRun = validExamples.length > 0 && !pending;

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await runOptimization({
        name: name.trim() || 'Optimization run',
        taskClass: taskClass.trim() || 'general',
        baselinePrompt: baseline,
        examples: validExamples.map((e) => ({ input: e.input, reference: e.reference })),
        models: [...selected],
        variants,
        weights,
        maxTokens,
      });
      if (res.ok && res.runId) {
        router.push(`/optimize/${res.runId}`);
      } else {
        setError(res.error ?? 'Optimization failed.');
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <FlaskConical className="h-4 w-4 text-violet-600" /> New optimization
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            The engine drafts improved prompt variants, runs each against your examples, has an LLM judge score
            quality, and ranks candidates by a weighted blend of quality, cost, and latency.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-gray-700">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Support-reply optimizer"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-700">Task type</span>
              <input
                value={taskClass}
                onChange={(e) => setTaskClass(e.target.value)}
                placeholder="classification, summarization, coding…"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
            </label>
          </div>

          <label className="mt-4 block">
            <span className="text-xs font-medium text-gray-700">Baseline system prompt</span>
            <textarea
              value={baseline}
              onChange={(e) => setBaseline(e.target.value)}
              rows={4}
              placeholder="You are a helpful assistant that…"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </label>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Examples</h2>
            <button
              type="button"
              onClick={addExample}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Each example is a representative user input. Add an optional reference answer to judge against.
          </p>
          <div className="mt-3 space-y-3">
            {examples.map((ex, i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-2">
                    <textarea
                      value={ex.input}
                      onChange={(e) => setExample(i, { input: e.target.value })}
                      rows={2}
                      placeholder="Example input…"
                      className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    />
                    <input
                      value={ex.reference}
                      onChange={(e) => setExample(i, { reference: e.target.value })}
                      placeholder="Reference answer (optional)"
                      className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeExample(i)}
                    className="mt-1 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    aria-label="Remove example"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="space-y-5">
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900">Configuration</h2>

          <div className="mt-3">
            <span className="text-xs font-medium text-gray-700">Candidate models</span>
            <p className="text-[11px] text-gray-500">Leave empty to auto-pick the cheapest runnable model.</p>
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
              {models.length === 0 ? (
                <div className="px-1 py-2 text-xs text-gray-400">No executable models. Add a provider key.</div>
              ) : (
                models.slice(0, 40).map((m) => (
                  <label key={m.slug} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selected.has(m.slug)}
                      onChange={() => toggleModel(m.slug)}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                    />
                    <span className="flex-1 truncate text-gray-700">{m.displayName}</span>
                    <span className="font-mono text-[10px] text-gray-400">${m.promptPricePerM}/M</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <label className="mt-4 block">
            <span className="text-xs font-medium text-gray-700">Prompt variants: {variants}</span>
            <input
              type="range"
              min={1}
              max={5}
              value={variants}
              onChange={(e) => setVariants(Number(e.target.value))}
              className="mt-1 w-full accent-violet-600"
            />
          </label>

          <div className="mt-4">
            <span className="text-xs font-medium text-gray-700">Scoring weights</span>
            {(['quality', 'cost', 'latency'] as const).map((k) => (
              <label key={k} className="mt-2 flex items-center gap-2 text-xs">
                <span className="w-16 capitalize text-gray-600">{k}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={weights[k]}
                  onChange={(e) => setWeights((w) => ({ ...w, [k]: Number(e.target.value) }))}
                  className="flex-1 accent-violet-600"
                />
                <span className="w-8 text-right font-mono text-gray-500">{weights[k].toFixed(2)}</span>
              </label>
            ))}
          </div>

          <label className="mt-4 block">
            <span className="text-xs font-medium text-gray-700">Max tokens / response</span>
            <input
              type="number"
              min={64}
              max={4096}
              value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </label>

          {error ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
          ) : null}

          <button
            type="button"
            onClick={submit}
            disabled={!canRun}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {pending ? 'Optimizing…' : 'Run optimization'}
          </button>
          {pending ? (
            <p className="mt-2 text-center text-[11px] text-gray-500">
              Running live model calls — this can take 15–40s.
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900">Recent runs</h2>
          {runs.length === 0 ? (
            <p className="mt-2 text-xs text-gray-500">No runs yet.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {runs.slice(0, 12).map((r) => (
                <button
                  key={r.id}
                  onClick={() => router.push(`/optimize/${r.id}`)}
                  className="block w-full rounded-lg border border-gray-200 p-3 text-left hover:border-gray-300 hover:shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-gray-900">{r.name}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
                    <span>{r.createdAt.slice(0, 10)}</span>
                    {r.summary?.improved ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <Trophy className="h-3 w-3" /> +{r.summary.qualityDelta} quality
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
