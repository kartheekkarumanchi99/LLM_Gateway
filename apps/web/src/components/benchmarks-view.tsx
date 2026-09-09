'use client';

import Link from 'next/link';
import { Brain, Code2, DollarSign, FileText, Languages, type LucideIcon, MessageSquare, Sparkles, Wrench, Zap } from 'lucide-react';
import { Scatter, fmtInt } from '@/components/charts';
import { ProviderLogo } from '@/components/provider-logo';
import { formatUsd } from '@/lib/format';
import type { BenchModel, BenchmarksData } from '@/lib/benchmarks-types';

const RANGES = [
  { label: '24h', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

const MEDAL_GRAD = [
  'linear-gradient(135deg,#fcd34d,#f59e0b)',
  'linear-gradient(135deg,#e5e7eb,#9ca3af)',
  'linear-gradient(135deg,#f59e0b,#b45309)',
];

const TASK_ICONS: Record<string, LucideIcon> = {
  chat: MessageSquare,
  code: Code2,
  coding: Code2,
  reasoning: Brain,
  summarization: FileText,
  extraction: FileText,
  translation: Languages,
  agentic: Wrench,
  tool_use: Wrench,
};
function taskIcon(t: string): LucideIcon {
  return TASK_ICONS[t.toLowerCase()] ?? Sparkles;
}

function Badge({ icon: Icon, label, tone }: { icon: LucideIcon; label: string; tone: 'emerald' | 'violet' }) {
  const c = tone === 'emerald' ? 'bg-emerald-50 text-emerald-600' : 'bg-violet-50 text-violet-600';
  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${c}`}>
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

function fmtMs(ms: number): string {
  if (!ms || ms <= 0) return '—';
  return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms) + 'ms';
}
function pct(x: number): string {
  return (x * 100).toFixed(x >= 0.995 ? 0 : 1) + '%';
}

export function BenchmarksView({ data }: { data: BenchmarksData }) {
  const scatter = data.pareto.map((p) => ({
    x: p.pricePerM,
    y: p.quality,
    label: p.slug,
    size: p.requests,
    kind: (p.onFrontier ? 'frontier' : p.used ? 'used' : 'other') as 'frontier' | 'used' | 'other',
  }));

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Benchmarks</h1>
          <p className="mt-1 text-sm text-gray-500">
            How models perform — measured from real calls through your gateway, plus a quality-vs-price frontier over the live catalog.
          </p>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
          {RANGES.map((r) => (
            <Link
              key={r.days}
              href={`/benchmarks?range=${r.days}`}
              className={
                'px-3 py-1.5 ' +
                (data.days === r.days ? 'bg-gray-900 font-medium text-white' : 'text-gray-600 hover:bg-gray-50')
              }
            >
              {r.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {/* Pareto */}
        {data.pareto.length > 0 ? (
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Quality per dollar</h2>
              <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                <Legend color="#059669" label="Efficient frontier" />
                <Legend color="#7c3aed" label="You use" />
                <Legend color="#cbd5e1" label="Catalog" />
              </div>
            </div>
            <p className="mb-2 text-xs text-gray-400">
              Each dot is an executable model — X = blended list price per 1M tokens (log), Y = capability. Dot size = your call
              volume. The dashed line is the best quality available at each price.
            </p>
            <Scatter points={scatter} frontier={data.frontier} xLabel="Price per 1M tokens (log)" yLabel="Capability" />
            <p className="mt-2 text-[11px] text-gray-400">
              Capability is a public benchmark estimate (approx. from public evals), not a live evaluation of your traffic. Latency,
              throughput, cost and success below are measured from your real calls.
            </p>
          </section>
        ) : null}

        {/* Totals */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Calls measured" value={fmtInt(data.totalCalls)} />
          <Stat label="Models measured" value={fmtInt(data.modelsMeasured)} />
          <Stat label="Catalog (executable)" value={fmtInt(data.catalogModels)} />
          <Stat label="On frontier" value={fmtInt(data.frontier.length)} />
        </div>

        {/* Measured model table */}
        <section className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Measured model performance</h2>
            <p className="text-xs text-gray-400">Latency, throughput, reliability and realized cost — from your traffic in this window.</p>
          </div>
          {data.models.length === 0 ? (
            <EmptyRow text="No calls in this window yet — send traffic and these fill in with real numbers." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                    <th className="px-4 py-2 font-medium">Model</th>
                    <th className="px-4 py-2 text-right font-medium">Calls</th>
                    <th className="px-4 py-2 text-right font-medium">Success</th>
                    <th className="px-4 py-2 text-right font-medium">p50</th>
                    <th className="px-4 py-2 text-right font-medium">p95</th>
                    <th className="px-4 py-2 text-right font-medium">TTFT</th>
                    <th className="px-4 py-2 text-right font-medium">Tok/s</th>
                    <th className="px-4 py-2 text-right font-medium">$/1M</th>
                    <th className="px-4 py-2 text-right font-medium">Cache</th>
                    <th className="px-4 py-2 text-right font-medium">Retries</th>
                  </tr>
                </thead>
                <tbody>
                  {data.models.map((m) => (
                    <ModelRow key={m.modelSlug} m={m} maxCalls={data.models[0]?.requests ?? 1} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Task leaderboards */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Best model by task class</h2>
          {data.tasks.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-400">
              No classified traffic in this window yet.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {data.tasks.map((t) => {
                const withLat = t.leaders.filter((l) => l.avgLatencyMs > 0);
                const minLat = withLat.length ? Math.min(...withLat.map((l) => l.avgLatencyMs)) : 1;
                const fastest = withLat.length
                  ? withLat.reduce((a, b) => (b.avgLatencyMs < a.avgLatencyMs ? b : a)).modelSlug
                  : null;
                const costs = t.leaders.filter((l) => l.avgCostUsd > 0);
                const cheapest = costs.length
                  ? costs.reduce((a, b) => (b.avgCostUsd < a.avgCostUsd ? b : a)).modelSlug
                  : null;
                const multi = t.leaders.length >= 2;
                const Icon = taskIcon(t.taskClass);
                return (
                  <div key={t.taskClass} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md">
                    <div className="flex items-center gap-2.5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white px-4 py-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-sm">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold capitalize text-gray-900">{t.taskClass.replace(/_/g, ' ')}</div>
                        <div className="text-[11px] text-gray-400">
                          {fmtInt(t.total)} calls · {t.leaders.length} model{t.leaders.length === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {t.leaders.map((l, i) => {
                        const speedPct = l.avgLatencyMs > 0 ? (minLat / l.avgLatencyMs) * 100 : 100;
                        const isFastest = multi && l.modelSlug === fastest;
                        const isCheapest = multi && l.modelSlug === cheapest;
                        return (
                          <div key={l.modelSlug} className={`px-4 py-3 ${i === 0 ? 'bg-gradient-to-r from-amber-50/50 to-transparent' : ''}`}>
                            <div className="flex items-center gap-2.5">
                              <span
                                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white shadow-sm"
                                style={{ background: MEDAL_GRAD[i] ?? 'linear-gradient(135deg,#e2e8f0,#cbd5e1)' }}
                              >
                                {i + 1}
                              </span>
                              <ProviderLogo slug={l.modelSlug.split('/')[0] ?? l.modelSlug} size={22} />
                              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{l.modelSlug}</span>
                              <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                                {pct(l.successRate)}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500"
                                  style={{ width: `${Math.max(6, speedPct)}%` }}
                                />
                              </div>
                              {isFastest ? <Badge icon={Zap} label="Fastest" tone="emerald" /> : null}
                              {isCheapest && !isFastest ? <Badge icon={DollarSign} label="Cheapest" tone="violet" /> : null}
                            </div>
                            <div className="mt-1.5 flex items-center gap-3 text-[11px] text-gray-400">
                              <span className="font-medium text-gray-500">{fmtMs(l.avgLatencyMs)}</span>
                              <span>{l.throughput > 0 ? `${l.throughput.toFixed(0)} tok/s` : '\u2014'}</span>
                              <span>{l.avgCostUsd > 0 ? formatUsd(l.avgCostUsd, 4) : 'Free'}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ModelRow({ m, maxCalls }: { m: BenchModel; maxCalls: number }) {
  return (
    <tr className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
      <td className="px-4 py-2.5">
        <div className="font-medium text-gray-900">{m.modelSlug}</div>
        <div className="text-xs text-gray-400">{m.providerSlug}</div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-2">
          <div className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-gray-100 lg:block">
            <div className="h-full rounded-full bg-indigo-400" style={{ width: `${Math.max(4, (m.requests / maxCalls) * 100)}%` }} />
          </div>
          <span className="w-10 text-right text-gray-700">{fmtInt(m.requests)}</span>
        </div>
      </td>
      <td className="px-4 py-2.5 text-right">
        <span className={m.successRate >= 0.99 ? 'text-emerald-600' : m.successRate >= 0.9 ? 'text-gray-700' : 'text-amber-600'}>
          {pct(m.successRate)}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right text-gray-600">{fmtMs(m.p50LatencyMs)}</td>
      <td className="px-4 py-2.5 text-right text-gray-600">{fmtMs(m.p95LatencyMs)}</td>
      <td className="px-4 py-2.5 text-right text-gray-600">{m.ttftP50 != null ? fmtMs(m.ttftP50) : '—'}</td>
      <td className="px-4 py-2.5 text-right text-gray-600">{m.throughput > 0 ? m.throughput.toFixed(1) : '—'}</td>
      <td className="px-4 py-2.5 text-right text-gray-600">{m.avgPricePerM > 0 ? formatUsd(m.avgPricePerM, 3) : 'Free'}</td>
      <td className="px-4 py-2.5 text-right text-gray-500">{m.cacheHitRate > 0 ? pct(m.cacheHitRate) : '—'}</td>
      <td className="px-4 py-2.5 text-right text-gray-500">{m.avgAttempts > 1.01 ? m.avgAttempts.toFixed(2) : '—'}</td>
    </tr>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-sm text-gray-400">{text}</div>;
}
