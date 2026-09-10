'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, ChevronDown, MinusCircle, TrendingDown, TrendingUp, XCircle } from 'lucide-react';
import { formatUsd } from '@/lib/format';
import type { EvalRunDetail } from '@/lib/evals';

function fmtCost(v: number): string {
  if (v === 0) return '$0';
  if (v < 0.0001) return '<$0.0001';
  return formatUsd(v, v < 0.01 ? 5 : 4);
}
function pctStr(v: number): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}

const VERDICT: Record<string, { label: string; cls: string; icon: typeof TrendingUp }> = {
  improved: { label: 'Improved', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: TrendingUp },
  regressed: { label: 'Regressed', cls: 'bg-rose-50 text-rose-700 ring-rose-200', icon: TrendingDown },
  neutral: { label: 'Neutral', cls: 'bg-gray-100 text-gray-600 ring-gray-200', icon: MinusCircle },
  'no-baseline': { label: 'No baseline', cls: 'bg-blue-50 text-blue-700 ring-blue-200', icon: MinusCircle },
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const c = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-rose-600' : 'text-gray-900';
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${c}`}>{value}</div>
    </div>
  );
}

export function EvalRunDetailView({ run }: { run: EvalRunDetail }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const s = run.summary;
  const v = s ? VERDICT[s.verdict] ?? VERDICT.neutral! : null;

  return (
    <div>
      <Link href={`/evals/${run.setId}`} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Back to eval set
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-gray-900">{run.name}</h1>
        {v ? (
          <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${v.cls}`}>
            <v.icon className="h-3.5 w-3.5" /> {v.label}
          </span>
        ) : (
          <span className="text-xs text-gray-400">{run.status}</span>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-500">
        <code className="font-mono">{run.candidateModel}</code>
        {run.baselineModel ? <> vs <code className="font-mono">{run.baselineModel}</code></> : null}
        {' · '}
        {run.createdAt.slice(0, 10)}
      </p>

      {run.status === 'error' ? (
        <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{run.error ?? 'Eval failed.'}</div>
      ) : null}

      {s ? (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Cases passed" value={`${s.casesPassed}/${s.casesTotal}`} />
          <Stat
            label="Quality"
            value={s.baseline ? `${s.baseline.quality.toFixed(0)} → ${s.candidate.quality.toFixed(0)}` : s.candidate.quality.toFixed(0)}
            tone={s.qualityDelta > 0 ? 'good' : s.qualityDelta < 0 ? 'bad' : undefined}
          />
          <Stat
            label="Cost Δ"
            value={s.baseline ? pctStr(s.costDeltaPct) : fmtCost(s.candidate.avgCostUsd)}
            tone={s.costDeltaPct < 0 ? 'good' : s.costDeltaPct > 0 ? 'bad' : undefined}
          />
          <Stat
            label="Latency Δ"
            value={s.baseline ? pctStr(s.latencyDeltaPct) : `${s.candidate.avgLatencyMs}ms`}
            tone={s.latencyDeltaPct < 0 ? 'good' : s.latencyDeltaPct > 0 ? 'bad' : undefined}
          />
        </div>
      ) : null}

      <h2 className="mt-6 text-sm font-semibold text-gray-900">Cases ({run.cases.length})</h2>
      <div className="mt-3 space-y-2">
        {run.cases.map((c) => {
          const open = openId === c.caseId;
          const cand = c.candidate;
          const base = c.baseline;
          return (
            <div key={c.caseId} className="rounded-xl border border-gray-200 bg-white">
              <button onClick={() => setOpenId(open ? null : c.caseId)} className="flex w-full items-center gap-3 p-3 text-left">
                <span className="flex-1 truncate text-sm text-gray-700">{c.inputPreview || '(empty)'}</span>
                {cand ? (
                  <span className="inline-flex items-center gap-1 text-xs">
                    {cand.passed ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <XCircle className="h-3.5 w-3.5 text-rose-500" />}
                    <span className="font-semibold text-gray-900">{cand.quality.toFixed(0)}</span>
                  </span>
                ) : null}
                {base ? <span className="text-xs text-gray-400">base {base.quality.toFixed(0)}</span> : null}
                <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              {open ? (
                <div className="border-t border-gray-100 p-3">
                  {c.reference ? (
                    <div className="mb-2 rounded bg-indigo-50 px-2 py-1.5 text-[11px] text-indigo-700">
                      <span className="font-medium">Reference:</span> {c.reference}
                    </div>
                  ) : null}
                  <div className={`grid gap-3 ${base ? 'md:grid-cols-2' : ''}`}>
                    <div>
                      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-blue-700">
                        Candidate
                        {cand ? <span className="text-gray-400">{cand.quality.toFixed(0)} · {fmtCost(cand.costUsd)} · {cand.latencyMs}ms</span> : null}
                      </div>
                      <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 font-mono text-[11px] text-gray-700">
                        {cand?.output || '(no output)'}
                      </pre>
                    </div>
                    {base ? (
                      <div>
                        <div className="mb-1 flex items-center gap-2 text-xs font-medium text-gray-600">
                          Baseline
                          <span className="text-gray-400">{base.quality.toFixed(0)} · {fmtCost(base.costUsd)} · {base.latencyMs}ms</span>
                        </div>
                        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 font-mono text-[11px] text-gray-700">
                          {base.output || '(no output)'}
                        </pre>
                      </div>
                    ) : null}
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
