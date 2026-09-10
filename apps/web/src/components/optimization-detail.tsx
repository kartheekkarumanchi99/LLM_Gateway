'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, ChevronDown, Loader2, Sparkles, Trophy } from 'lucide-react';
import type { OptimizationRunDetail } from '@/lib/optimization';
import { promoteToPreset } from '@/lib/optimization-actions';

function fmtCost(v: number): string {
  if (v === 0) return '$0';
  if (v < 0.0001) return '<$0.0001';
  return '$' + v.toFixed(v < 0.01 ? 5 : 4);
}
function fmtDeltaPct(v: number): string {
  const s = v > 0 ? '+' : '';
  return `${s}${v.toFixed(1)}%`;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'neutral' }) {
  const color = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-rose-600' : 'text-gray-900';
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

export function OptimizationDetail({ run }: { run: OptimizationRunDetail }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [promoted, setPromoted] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function promote(candidateId: string) {
    setPendingId(candidateId);
    startTransition(async () => {
      const res = await promoteToPreset(candidateId);
      if (res.ok && res.slug) setPromoted((p) => ({ ...p, [candidateId]: res.slug! }));
      setPendingId(null);
    });
  }

  const s = run.summary;
  const maxComposite = Math.max(1, ...run.candidates.map((c) => c.compositeScore));

  return (
    <div>
      <Link href="/optimize" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Back to optimizer
      </Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{run.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {run.taskClass ?? 'general'} · {run.createdAt.slice(0, 10)} ·{' '}
            <span
              className={
                run.status === 'complete'
                  ? 'text-emerald-600'
                  : run.status === 'error'
                    ? 'text-rose-600'
                    : 'text-blue-600'
              }
            >
              {run.status}
            </span>
          </p>
        </div>
      </div>

      {run.status === 'error' ? (
        <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {run.error ?? 'Optimization failed.'}
        </div>
      ) : null}

      {s ? (
        <div className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Trophy className="h-4 w-4 text-amber-500" />
            Winner: {s.winnerLabel}
            <code className="font-mono text-xs text-gray-400">{s.winnerModel}</code>
            {s.improved ? (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                beats baseline
              </span>
            ) : (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">
                baseline held up
              </span>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Composite" value={`${s.baselineScore} → ${s.winnerScore}`} tone="neutral" />
            <Metric
              label="Quality Δ"
              value={`${s.qualityDelta > 0 ? '+' : ''}${s.qualityDelta}`}
              tone={s.qualityDelta > 0 ? 'good' : s.qualityDelta < 0 ? 'bad' : 'neutral'}
            />
            <Metric
              label="Cost Δ"
              value={fmtDeltaPct(s.costDeltaPct)}
              tone={s.costDeltaPct < 0 ? 'good' : s.costDeltaPct > 0 ? 'bad' : 'neutral'}
            />
            <Metric
              label="Latency Δ"
              value={fmtDeltaPct(s.latencyDeltaPct)}
              tone={s.latencyDeltaPct < 0 ? 'good' : s.latencyDeltaPct > 0 ? 'bad' : 'neutral'}
            />
          </div>
        </div>
      ) : null}

      <h2 className="mt-6 text-sm font-semibold text-gray-900">Candidates ({run.candidates.length})</h2>
      <div className="mt-3 space-y-2">
        {run.candidates.map((c, i) => {
          const open = openId === c.id;
          return (
            <div
              key={c.id}
              className={`rounded-xl border bg-white ${c.isWinner ? 'border-amber-300 ring-1 ring-amber-100' : 'border-gray-200'}`}
            >
              <button
                onClick={() => setOpenId(open ? null : c.id)}
                className="flex w-full items-center gap-3 p-4 text-left"
              >
                <span className="w-5 text-sm font-semibold text-gray-400">{i + 1}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{c.label}</span>
                    {c.isWinner ? (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                        <Trophy className="h-3 w-3" /> winner
                      </span>
                    ) : null}
                    {c.isBaseline ? (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">baseline</span>
                    ) : null}
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${c.isWinner ? 'bg-amber-400' : 'bg-violet-400'}`}
                      style={{ width: `${(c.compositeScore / maxComposite) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="hidden gap-5 text-right sm:flex">
                  <div>
                    <div className="text-[10px] uppercase text-gray-400">Quality</div>
                    <div className="text-sm font-semibold text-gray-900">{c.qualityScore}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-gray-400">Cost</div>
                    <div className="text-sm font-semibold text-gray-900">{fmtCost(c.avgCostUsd)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-gray-400">Latency</div>
                    <div className="text-sm font-semibold text-gray-900">{c.avgLatencyMs}ms</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-gray-400">Score</div>
                    <div className="text-sm font-semibold text-violet-700">{c.compositeScore}</div>
                  </div>
                </div>
                <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>

              {open ? (
                <div className="border-t border-gray-100 p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-gray-600">Prompt</span>
                    <code className="font-mono text-[11px] text-gray-400">{c.modelSlug}</code>
                  </div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 font-mono text-xs text-gray-800">
                    {c.prompt || '(empty prompt)'}
                  </pre>
                  {c.notes ? (
                    <div className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
                      <span className="font-medium">Judge:</span> {c.notes}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500 sm:hidden">
                    <span>Quality {c.qualityScore}</span>
                    <span>{fmtCost(c.avgCostUsd)}</span>
                    <span>{c.avgLatencyMs}ms</span>
                    <span className="text-violet-700">Score {c.compositeScore}</span>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    {promoted[c.id] ? (
                      <Link
                        href="/presets"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
                      >
                        <Check className="h-3.5 w-3.5" /> Promoted → @preset/{promoted[c.id]}
                      </Link>
                    ) : (
                      <button
                        onClick={() => promote(c.id)}
                        disabled={pending && pendingId === c.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                      >
                        {pending && pendingId === c.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        Promote to preset
                      </button>
                    )}
                    <span className="text-[11px] text-gray-400">
                      Judged on {c.sampleCount} sample{c.sampleCount === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
