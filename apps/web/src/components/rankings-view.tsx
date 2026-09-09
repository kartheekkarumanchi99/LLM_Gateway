'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Trophy } from 'lucide-react';
import { Donut, HBars, PALETTE, Sparkline, StackedBars, fmtInt } from '@/components/charts';
import { formatTokens, formatUsd } from '@/lib/format';
import type { RankModel, RankingsData } from '@/lib/rankings-types';

const RANGES = [
  { label: '24h', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];
type Metric = 'tokens' | 'spend' | 'requests';
const METRICS: { key: Metric; label: string }[] = [
  { key: 'tokens', label: 'Tokens' },
  { key: 'spend', label: 'Spend' },
  { key: 'requests', label: 'Requests' },
];

function valueOf(m: RankModel, metric: Metric): number {
  return metric === 'tokens' ? m.tokens : metric === 'spend' ? m.spendUsd : m.requests;
}
function fmtValue(metric: Metric, v: number): string {
  return metric === 'tokens' ? formatTokens(v) : metric === 'spend' ? formatUsd(v, v < 1 ? 4 : 2) : fmtInt(v);
}

function Trend({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[11px] text-gray-300">new</span>;
  if (Math.abs(pct) < 0.5) return <span className="text-[11px] text-gray-400">flat</span>;
  const up = pct > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {Math.abs(pct) >= 999 ? '999+' : Math.abs(pct).toFixed(0)}%
    </span>
  );
}

export function RankingsView({ data }: { data: RankingsData }) {
  const [metric, setMetric] = useState<Metric>('tokens');

  const rows = useMemo(() => {
    const sorted = [...data.models].sort((a, b) => valueOf(b, metric) - valueOf(a, metric));
    const total = sorted.reduce((s, m) => s + valueOf(m, metric), 0) || 1;
    return sorted.map((m, i) => ({ m, rank: i + 1, share: (valueOf(m, metric) / total) * 100 }));
  }, [data.models, metric]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Rankings</h1>
          <p className="mt-1 text-sm text-gray-500">
            The most-used models, providers and apps — computed live from real traffic through your gateway.
          </p>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
          {RANGES.map((r) => (
            <Link
              key={r.days}
              href={`/rankings?range=${r.days}`}
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

      {!data.hasData ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          {/* Totals */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Tokens" value={formatTokens(data.totals.tokens)} />
            <Stat label="Spend" value={formatUsd(data.totals.spendUsd, 2)} />
            <Stat label="Requests" value={fmtInt(data.totals.requests)} />
            <Stat label="Models used" value={fmtInt(data.totals.models)} />
            <Stat label="Providers" value={fmtInt(data.totals.providers)} />
          </div>

          {/* Leaderboard */}
          <section className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">Top models</h2>
              <div className="flex overflow-hidden rounded-md border border-gray-200 text-xs">
                {METRICS.map((mt) => (
                  <button
                    key={mt.key}
                    onClick={() => setMetric(mt.key)}
                    className={
                      'px-2.5 py-1 ' +
                      (metric === mt.key ? 'bg-violet-600 font-medium text-white' : 'text-gray-600 hover:bg-gray-50')
                    }
                  >
                    {mt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                    <th className="px-4 py-2 font-medium">#</th>
                    <th className="px-4 py-2 font-medium">Model</th>
                    <th className="px-4 py-2 font-medium">Trend</th>
                    <th className="px-4 py-2 text-right font-medium">{METRICS.find((m) => m.key === metric)?.label}</th>
                    <th className="px-4 py-2 text-right font-medium">Share</th>
                    <th className="px-4 py-2 text-right font-medium">$/1M</th>
                    <th className="hidden px-4 py-2 text-right font-medium md:table-cell">14d</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ m, rank, share }) => (
                    <tr key={m.modelSlug} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                      <td className="px-4 py-2.5 text-gray-400">{rank}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-gray-900">{m.modelSlug}</div>
                        <div className="text-xs text-gray-400">{m.providerSlug}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Trend pct={m.trendPct} />
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-gray-800">{fmtValue(metric, valueOf(m, metric))}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-gray-100 sm:block">
                            <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(3, share)}%` }} />
                          </div>
                          <span className="w-11 text-right text-gray-600">{share.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{m.avgPricePerM > 0 ? formatUsd(m.avgPricePerM, 3) : '—'}</td>
                      <td className="hidden px-4 py-2.5 text-right md:table-cell">
                        <div className="flex justify-end">
                          <Sparkline data={m.spark} color={m.trendPct && m.trendPct < 0 ? '#ef4444' : '#10b981'} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Share over time */}
          {data.share.points.length >= 2 ? (
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="mb-1 text-sm font-semibold text-gray-900">Token share over time</h2>
              <p className="mb-3 text-xs text-gray-400">Daily token mix across the top models.</p>
              <StackedBars data={data.share.points} series={data.share.series} height={160} />
              <div className="mt-3 flex flex-wrap gap-3">
                {data.share.series.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                    {s.label}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {/* Movers */}
          {data.gainers.length > 0 || data.decliners.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              <MoverCard title="Trending up" tone="up" items={data.gainers} />
              <MoverCard title="Trending down" tone="down" items={data.decliners} />
            </div>
          ) : null}

          {/* Categories + providers */}
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Top model by category</h2>
              {data.byTask.length === 0 ? (
                <p className="text-xs text-gray-400">No classified traffic yet.</p>
              ) : (
                <div className="space-y-3">
                  {data.byTask.map((t, i) => (
                    <div key={t.taskClass}>
                      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                        <span className="inline-flex shrink-0 items-center gap-1.5 capitalize text-gray-500">
                          <Trophy className="h-3.5 w-3.5 text-amber-400" />
                          {t.taskClass.replace(/_/g, ' ')}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-right font-medium text-gray-800">{t.modelSlug}</span>
                        <span className="w-10 shrink-0 text-right text-xs text-gray-400">{t.sharePct.toFixed(0)}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.max(3, t.sharePct)}%`, background: PALETTE[i % PALETTE.length] }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Providers by usage</h2>
              <div className="flex items-center gap-4">
                <Donut
                  size={132}
                  thickness={22}
                  segments={data.providers.map((p, i) => ({ label: p.providerSlug, value: p.tokens, color: PALETTE[i % PALETTE.length]! }))}
                  centerLabel={`${Math.round(data.providers[0]?.sharePct ?? 0)}%`}
                  centerSub={data.providers[0]?.providerSlug}
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  {data.providers.map((p, i) => (
                    <div key={p.providerSlug} className="flex items-center gap-2 text-sm">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                      <span className="min-w-0 flex-1 truncate text-gray-700">{p.providerSlug}</span>
                      <span className="text-xs text-gray-400">{p.sharePct.toFixed(0)}%</span>
                      <Trend pct={p.trendPct} />
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          {/* Apps + keys */}
          <div className="grid gap-4 md:grid-cols-2">
            <NamedTable title="Top apps" rows={data.apps} />
            <NamedTable title="Top API keys" rows={data.keys} />
          </div>
        </div>
      )}
    </div>
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

function MoverCard({
  title,
  tone,
  items,
}: {
  title: string;
  tone: 'up' | 'down';
  items: { modelSlug: string; providerSlug: string; tokens: number; trendPct: number }[];
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">{title}</h2>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">Not enough history yet.</p>
      ) : (
        <div className="space-y-3">
          {items.map((m) => {
            const mag = Math.min(100, Math.abs(m.trendPct));
            return (
              <div key={m.modelSlug}>
                <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-gray-700">{m.modelSlug}</span>
                  <span className={`inline-flex shrink-0 items-center gap-0.5 text-xs font-medium ${tone === 'up' ? 'text-emerald-600' : 'text-red-500'}`}>
                    {tone === 'up' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {Math.abs(m.trendPct) >= 999 ? '999+' : Math.abs(m.trendPct).toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(4, mag)}%`, background: tone === 'up' ? '#10b981' : '#ef4444' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function NamedTable({ title, rows }: { title: string; rows: { name: string; tokens: number; spendUsd: number; requests: number; sharePct: number }[] }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400">No data in this window.</p>
      ) : (
        <HBars
          data={rows.map((r, i) => ({
            label: r.name,
            value: r.tokens,
            sub: `${formatTokens(r.tokens)} \u00b7 ${r.sharePct.toFixed(0)}%`,
            color: PALETTE[i % PALETTE.length],
          }))}
        />
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
      <h2 className="text-base font-semibold text-gray-900">No usage yet</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
        Rankings populate from real requests through the gateway. Send some traffic (try the{' '}
        <Link href="/chat" className="text-violet-600 hover:underline">
          Chat
        </Link>{' '}
        playground) and this page will fill in — no mock data.
      </p>
    </div>
  );
}
