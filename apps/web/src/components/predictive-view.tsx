'use client';

import { useState, useTransition } from 'react';
import { Activity, Zap } from 'lucide-react';
import type { PredictiveConfig } from '@llmgw/db/http';
import { fmtInt } from '@/components/charts';
import { Toggle } from '@/components/toggle';
import { savePredictiveConfig, rollbackPredictor } from '@/lib/predictive-actions';
import type { PredEventRow, PredictiveSummary, TaskAccuracy } from '@/lib/predictive-types';

const pct = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)}%`);
const ms = (n: number) => (n <= 0 ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);
const money = (n: number) => (n >= 0.01 ? '$' + n.toFixed(3) : '$' + n.toFixed(5));
const short = (s: string | null) => (s ? (s.includes('/') ? s.split('/')[1]! : s) : '—');
const list = (a: string[]) => a.join(', ');
const parseList = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

function Card({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: string; tone?: 'default' | 'green' | 'violet' }) {
  const c = tone === 'green' ? 'text-emerald-600' : tone === 'violet' ? 'text-violet-600' : 'text-gray-900';
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium tracking-wide text-gray-500 uppercase">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${c}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-gray-400">{sub}</div> : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-gray-700">{label}</span>
      {children}
    </div>
  );
}

function Num({ value, onChange, step, min, max, width = 'w-24' }: { value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; width?: string }) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`${width} rounded-lg border border-gray-300 px-2 py-1 text-sm text-right text-gray-800 outline-none focus:border-violet-500`}
    />
  );
}

export function PredictiveView({
  config,
  summary,
  byTask,
  events,
}: {
  config: PredictiveConfig;
  summary: PredictiveSummary | null;
  byTask: TaskAccuracy[];
  events: PredEventRow[];
}) {
  const [c, setC] = useState<PredictiveConfig>(config);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = <K extends keyof PredictiveConfig>(k: K, v: PredictiveConfig[K]) => {
    setC((p) => ({ ...p, [k]: v }));
    setSaved(false);
  };
  const save = () =>
    start(async () => {
      const r = await savePredictiveConfig(c);
      if (r.ok) setSaved(true);
    });
  const rollback = () =>
    start(async () => {
      const r = await rollbackPredictor();
      if (r.ok) {
        setC((p) => ({ ...p, speculationEnabled: false, observationOnly: true }));
        setSaved(true);
      }
    });

  const maxAcc = Math.max(1, ...byTask.map((t) => t.accuracyPct));

  return (
    <div>
      <div className="flex items-center gap-2">
        <Zap className="h-5 w-5 text-violet-600" />
        <h1 className="text-2xl font-semibold text-gray-900">Predictive Routing</h1>
        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-600">Beta</span>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-gray-500">
        Overlaps prediction, cache lookup and routing, and can start a speculative upstream call — committing to exactly
        one response before any client-visible byte. Observation-only is the safe default.
      </p>

      {/* Metrics */}
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        <Card label="Prediction accuracy" value={pct(summary?.accuracyPct ?? null)} tone="violet" sub={summary ? `${fmtInt(summary.correct)}/${fmtInt(summary.predictions)}` : undefined} />
        <Card label="Routing overhead p50" value={ms(summary?.overheadP50 ?? 0)} sub={summary ? `p95 ${ms(summary.overheadP95)} · p99 ${ms(summary.overheadP99)}` : undefined} />
        <Card label="Avg latency avoided" value={ms(summary?.avgLatencyAvoidedMs ?? 0)} tone="green" sub={summary ? `total ${ms(summary.estLatencyAvoidedMs)}` : undefined} />
        <Card label="Speculation activation" value={pct(summary?.activationRatePct ?? 0)} sub={summary ? `${fmtInt(summary.speculation)} speculative` : undefined} />
        <Card label="Correct commits" value={summary ? fmtInt(summary.correctCommits) : '—'} tone="green" />
        <Card label="Losers cancelled" value={summary ? fmtInt(summary.losersCancelled) : '—'} />
        <Card label="Speculative waste" value={summary ? money(summary.wasteUsd) : '—'} />
        <Card label="Events" value={summary ? fmtInt(summary.total) : '—'} sub={summary ? `${fmtInt(summary.observation)} observed` : undefined} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Config */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 lg:col-span-1">
          <div className="mb-2 text-sm font-semibold text-gray-900">Configuration</div>
          <div className="divide-y divide-gray-100">
            <Row label="Enabled"><Toggle on={c.enabled} onChange={(v) => set('enabled', v)} /></Row>
            <Row label="Observation-only (shadow)"><Toggle on={c.observationOnly} onChange={(v) => set('observationOnly', v)} /></Row>
            <Row label="Speculative execution"><Toggle on={c.speculationEnabled} onChange={(v) => set('speculationEnabled', v)} disabled={c.observationOnly} /></Row>
            <Row label="Disable on sensitive data"><Toggle on={c.sensitiveDataDisabled} onChange={(v) => set('sensitiveDataDisabled', v)} /></Row>
            <Row label="Disable for orchestration"><Toggle on={c.orchestrationDisabled} onChange={(v) => set('orchestrationDisabled', v)} /></Row>
            <Row label="Auto-cancel losers"><Toggle on={c.autoCancelLosers} onChange={(v) => set('autoCancelLosers', v)} /></Row>
            <Row label="Min confidence"><Num value={c.confidenceThreshold} onChange={(n) => set('confidenceThreshold', n)} step={0.05} min={0} max={1} /></Row>
            <Row label="Max speculative $/req"><Num value={c.maxSpeculationCostUsd} onChange={(n) => set('maxSpeculationCostUsd', n)} step={0.01} min={0} /></Row>
            <Row label="Commit timeout (ms)"><Num value={c.commitTimeoutMs} onChange={(n) => set('commitTimeoutMs', n)} step={250} min={250} /></Row>
            <Row label="Max candidates"><Num value={c.maxCandidates} onChange={(n) => set('maxCandidates', n)} step={1} min={1} max={3} /></Row>
          </div>

          <div className="mt-3 space-y-2">
            <label className="block text-xs text-gray-500">Allowed task classes (empty = all)</label>
            <input value={list(c.allowedTaskClasses)} onChange={(e) => set('allowedTaskClasses', parseList(e.target.value))} placeholder="chat, code, reasoning" className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm outline-none focus:border-violet-500" />
            <label className="block text-xs text-gray-500">Allowed models (patterns; empty = all)</label>
            <input value={list(c.allowedModels)} onChange={(e) => set('allowedModels', parseList(e.target.value))} placeholder="openai/*, anthropic/claude-3-5-sonnet" className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm outline-none focus:border-violet-500" />
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button onClick={save} disabled={pending} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
              {pending ? 'Saving…' : saved ? 'Saved' : 'Save'}
            </button>
            <button onClick={rollback} disabled={pending} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Rollback to observation
            </button>
          </div>
          {summary?.predictorVersion ? (
            <div className="mt-3 flex items-center gap-1 text-xs text-gray-400">
              <Activity className="h-3.5 w-3.5" /> predictor {summary.predictorVersion}
            </div>
          ) : null}
        </div>

        {/* Diagnostics */}
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-3 text-sm font-semibold text-gray-900">Accuracy by task class</div>
            <div className="space-y-2">
              {byTask.map((t) => (
                <div key={t.task} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 text-xs capitalize text-gray-700">{t.task}</div>
                  <div className="h-5 flex-1 overflow-hidden rounded bg-gray-100">
                    <div className="flex h-full items-center justify-end rounded bg-violet-500 pr-2 text-[11px] font-medium text-white" style={{ width: `${Math.max(8, (t.accuracyPct / maxAcc) * 100)}%` }}>
                      {t.accuracyPct.toFixed(0)}%
                    </div>
                  </div>
                  <div className="w-16 shrink-0 text-right text-xs text-gray-400">{fmtInt(t.total)}</div>
                </div>
              ))}
              {byTask.length === 0 ? <div className="text-sm text-gray-400">No predictions recorded yet. Enable predictive routing and send traffic.</div> : null}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-900">Recent decisions</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                    <th className="px-4 py-2 font-medium">Mode</th>
                    <th className="px-4 py-2 font-medium">Predicted</th>
                    <th className="px-4 py-2 font-medium">Authoritative</th>
                    <th className="px-4 py-2 font-medium">Result</th>
                    <th className="px-4 py-2 font-medium">Commit</th>
                    <th className="px-4 py-2 font-medium">Overhead</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-2 text-gray-500">{e.speculationStarted ? 'spec' : e.mode}</td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-700">{short(e.predicted)}</td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-700">{short(e.authoritative)}</td>
                      <td className="px-4 py-2">
                        {e.correct == null ? (
                          <span className="text-gray-400">—</span>
                        ) : e.correct ? (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-600">hit</span>
                        ) : (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-600">miss</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">{e.commitReason ?? '—'}</td>
                      <td className="px-4 py-2 text-gray-600">{e.overheadMs != null ? ms(e.overheadMs) : '—'}</td>
                    </tr>
                  ))}
                  {events.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-3 text-sm text-gray-400">No decisions yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
