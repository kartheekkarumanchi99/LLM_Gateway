'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ActivityData, NamedUsage } from '@/lib/activity';
import { formatUsd } from '@/lib/format';
import { Bars, fmtInt } from '@/components/charts';

const RANGES: { value: number; label: string }[] = [
  { value: 1, label: 'Past 24 Hours' },
  { value: 7, label: 'Past 7 Days' },
  { value: 30, label: 'Past 1 Month' },
  { value: 90, label: 'Past 3 Months' },
];

function mdLabel(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}
function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

export function ActivityView({
  data,
  range,
  connected,
}: {
  data: ActivityData;
  range: number;
  connected: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'overview' | 'trends'>('overview');

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Activity</h1>
          <p className="mt-1 text-sm text-gray-500">Your usage across models on the gateway.</p>
        </div>
        <select
          value={range}
          onChange={(e) => router.push(`/activity?range=${e.target.value}`)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none"
        >
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {!connected ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code> and run{' '}
          <code className="font-mono">pnpm db:push</code>.
        </div>
      ) : null}

      <div className="mt-5 flex gap-4 border-b border-gray-200 text-sm">
        {(['overview', 'trends'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              'border-b-2 px-1 pb-2 capitalize ' +
              (tab === t ? 'border-violet-600 font-medium text-violet-700' : 'border-transparent text-gray-500 hover:text-gray-800')
            }
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' ? <Overview data={data} /> : <Trends data={data} />}
    </div>
  );
}

function Overview({ data }: { data: ActivityData }) {
  const { totals, daily } = data;
  return (
    <div className="mt-6 space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Card label="Total spend" value={formatUsd(totals.spendUsd, totals.spendUsd < 1 ? 4 : 2)} spark={daily.map((d) => d.spendUsd)} />
        <Card label="Requests" value={fmtInt(totals.requests)} spark={daily.map((d) => d.requests)} />
        <Card label="Token volume" value={fmtInt(totals.tokens)} spark={daily.map((d) => d.tokens)} />
        <Card label="Cache hit rate" value={pct(totals.cacheHitRate)} />
        <Card label="Blended $/1M" value={formatUsd(totals.blendedPerM, 2)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Top API Keys">
          <RankList items={data.byKey} unit="tokens" />
        </Panel>
        <Panel title="Top Apps">
          <RankList items={data.byApp} unit="tokens" />
        </Panel>
      </div>

      <Panel title="Usage by model">
        {data.byModel.length === 0 ? (
          <Empty />
        ) : (
          <div>
            <Bars data={data.byModel.map((m) => ({ label: m.modelSlug, value: m.spendUsd }))} color="#84cc16" valueFmt={(v) => formatUsd(v, 4)} />
            <Legend items={data.byModel.map((m) => m.modelSlug)} />
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Usage type">
          {daily.length === 0 ? (
            <Empty />
          ) : (
            <div>
              <div className="flex h-[150px] items-end gap-[3px]">
                {daily.map((d, i) => {
                  const max = Math.max(1, ...daily.map((x) => x.spendUsd));
                  return (
                    <div key={i} className="flex flex-1 flex-col-reverse" style={{ height: 150 }} title={`${mdLabel(d.date)} · platform ${formatUsd(d.platformUsd, 4)} · BYOK ${formatUsd(d.byokUsd, 4)}`}>
                      <div style={{ height: `${(d.platformUsd / max) * 146}px`, background: '#6366f1' }} />
                      <div style={{ height: `${(d.byokUsd / max) * 146}px`, background: '#f59e0b' }} />
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-4 text-xs text-gray-500">
                <Dot color="#f59e0b" /> BYOK <Dot color="#6366f1" /> Platform spend
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Request volume by model">
          {data.byModel.length === 0 ? (
            <Empty />
          ) : (
            <div>
              <Bars data={data.byModel.map((m) => ({ label: m.modelSlug, value: m.requests }))} color="#84cc16" valueFmt={(v) => fmtInt(v)} />
              <Legend items={data.byModel.map((m) => m.modelSlug)} />
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Token breakdown">
          <ProportionBar
            segments={[
              { label: 'Prompt', value: Math.max(0, totals.promptTokens - totals.cachedTokens), color: '#6366f1' },
              { label: 'Completion', value: Math.max(0, totals.completionTokens - totals.reasoningTokens), color: '#ef4444' },
              { label: 'Reasoning', value: totals.reasoningTokens, color: '#a855f7' },
            ]}
          />
        </Panel>
        <Panel title="Prompt token caching">
          <ProportionBar
            segments={[
              { label: 'Cached', value: totals.cachedTokens, color: '#f59e0b' },
              { label: 'Uncached', value: Math.max(0, totals.promptTokens - totals.cachedTokens), color: '#94a3b8' },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}

function Trends({ data }: { data: ActivityData }) {
  const sections: { title: string; trend: ActivityData['trends']['models'] }[] = [
    { title: 'Models', trend: data.trends.models },
    { title: 'API Keys', trend: data.trends.keys },
    { title: 'Apps', trend: data.trends.apps },
  ];
  return (
    <div className="mt-6 space-y-6">
      {sections.map((s) => (
        <div key={s.title} className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <Panel title={`${s.title} · spend over time`}>
            {s.trend.series.length === 0 || !s.trend.topName ? (
              <Empty />
            ) : (
              <div>
                <div className="mb-2 text-sm text-gray-500">
                  Top: <span className="font-medium text-gray-800">{s.trend.topName}</span>
                </div>
                <Bars data={s.trend.series.map((p) => ({ label: mdLabel(p.date), value: p.spendUsd }))} color="#6366f1" valueFmt={(v) => formatUsd(v, 4)} />
              </div>
            )}
          </Panel>
          <Panel title={`${s.title} · trending`}>
            <RankList items={s.trend.items} unit="spend" />
          </Panel>
        </div>
      ))}
    </div>
  );
}

function Card({ label, value, spark }: { label: string; value: string; spark?: number[] }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-gray-900">{value}</div>
      {spark && spark.length > 1 ? (
        <div className="mt-2 h-8 opacity-70">
          <Bars data={spark.map((v, i) => ({ label: String(i), value: v }))} color="#c7d2fe" height={32} />
        </div>
      ) : (
        <div className="mt-2 h-8" />
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 text-sm font-semibold text-gray-900">{title}</div>
      {children}
    </div>
  );
}

function RankList({ items, unit }: { items: NamedUsage[]; unit: 'tokens' | 'spend' }) {
  if (items.length === 0) return <Empty />;
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={it.name + i} className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2 truncate text-gray-700">
            <span className="w-4 shrink-0 text-right text-gray-400">{i + 1}</span>
            <span className="truncate">{it.name}</span>
          </span>
          <span className="shrink-0 text-gray-500">
            {unit === 'tokens' ? `${fmtInt(it.tokens)} tok` : formatUsd(it.spendUsd, 4)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ProportionBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <Empty />;
  return (
    <div>
      <div className="flex h-4 overflow-hidden rounded-full">
        {segments.map((s) => (
          <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label}: ${fmtInt(s.value)}`} />
        ))}
      </div>
      <div className="mt-3 space-y-1">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-gray-600">
              <Dot color={s.color} /> {s.label}
            </span>
            <span className="text-gray-500">{fmtInt(s.value)} tok</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Legend({ items }: { items: string[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
      {items.slice(0, 8).map((it) => (
        <span key={it} className="flex items-center gap-1.5">
          <Dot color="#84cc16" /> {it}
        </span>
      ))}
    </div>
  );
}
function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />;
}
function Empty() {
  return <div className="grid h-24 place-items-center text-sm text-gray-400">No usage in this period.</div>;
}
