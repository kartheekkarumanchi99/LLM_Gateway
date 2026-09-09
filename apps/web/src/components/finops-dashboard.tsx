'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';
import { fmtInt } from '@/components/charts';
import { formatTokens } from '@/lib/format';
import { QUALITY_INDEX_NOTE } from '@/lib/model-quality';
import type { FinOpsData, WorkflowStat } from '@/lib/finops-types';

const pct1 = (n: number) => `${n.toFixed(1)}%`;
const pct0 = (n: number) => `${Math.round(n)}%`;
function money(n: number): string {
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(3);
  return '$' + n.toFixed(5);
}
function ms(n: number): string {
  if (n <= 0) return '—';
  return n >= 1000 ? (n / 1000).toFixed(1) + 's' : Math.round(n) + 'ms';
}
function shortModel(slug: string): string {
  return slug.includes('/') ? slug.split('/')[1]! : slug;
}
function cleanName(s: string): string {
  // Strip a "Provider: " prefix from catalog display names.
  return s.includes(': ') ? s.slice(s.indexOf(': ') + 2) : s;
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="mb-3">
        <h2 className="text-sm font-semibold tracking-wide text-gray-900 uppercase">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'green' | 'violet' | 'blue';
}) {
  const toneCls =
    tone === 'green'
      ? 'text-emerald-600'
      : tone === 'violet'
        ? 'text-violet-600'
        : tone === 'blue'
          ? 'text-blue-600'
          : 'text-gray-900';
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium tracking-wide text-gray-500 uppercase">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneCls}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-gray-400">{sub}</div> : null}
    </div>
  );
}

function Meter({ value, color = '#16a34a', track = '#e5e7eb' }: { value: number; color?: string; track?: string }) {
  const w = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: track }}>
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

export function FinOpsDashboard({ data }: { data: FinOpsData }) {
  const [showNote, setShowNote] = useState(false);
  const baselineName = cleanName(data.comparisons.find((c) => c.slug === data.primaryBaseline)?.name ?? 'GPT-4o');
  const maxEff = Math.max(1, ...data.efficiency.map((e) => e.efficiency));

  return (
    <div>
      {/* Headline */}
      <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-semibold tracking-wide text-emerald-700 uppercase">
              AI Optimization &amp; FinOps
            </div>
            <h1 className="mt-1 text-3xl font-bold text-gray-900">
              {pct0(data.qualityRetainedPct)} quality at{' '}
              <span className="text-emerald-600">
                {data.costFractionPct < 10 ? pct1(data.costFractionPct) : pct0(data.costFractionPct)}
              </span>{' '}
              of {baselineName} cost
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-600">
              Quality retained while cost is reduced by{' '}
              <span className="font-semibold text-emerald-700">{pct1(data.costReductionPct)}</span> versus running
              every request on {baselineName}.
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500">Value efficiency</div>
            <div className="text-3xl font-bold text-emerald-600">{data.valueEfficiency.toFixed(1)}×</div>
            <div className="text-xs text-gray-400">quality per unit cost</div>
          </div>
        </div>
        <button
          onClick={() => setShowNote((s) => !s)}
          className="mt-3 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
        >
          <Info className="h-3.5 w-3.5" /> How quality is measured
        </button>
        {showNote ? <p className="mt-1 max-w-2xl text-xs text-gray-500">{QUALITY_INDEX_NOTE}</p> : null}
      </div>

      {/* 1. Executive summary */}
      <Section title="Executive summary">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          <Metric label="Cost reduction" value={pct1(data.costReductionPct)} tone="green" sub={`vs ${baselineName}`} />
          <Metric label="Quality retained" value={pct0(data.qualityRetainedPct)} tone="violet" sub={`vs ${baselineName}`} />
          <Metric label="Value efficiency" value={`${data.valueEfficiency.toFixed(1)}×`} tone="blue" sub="quality / cost" />
          <Metric label="Total saved" value={money(data.totalSavedUsd)} tone="green" sub={`actual ${money(data.actualUsd)}`} />
          <Metric label="Requests" value={fmtInt(data.totalRequests)} sub="this workspace" />
          <Metric label="Tokens" value={formatTokens(data.totalTokens)} sub="processed" />
        </div>
      </Section>

      {/* 2. Quality vs Cost hero */}
      <Section
        title="Quality vs cost"
        subtitle="High quality is retained across every premium baseline while cost drops sharply."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {data.comparisons.map((c) => (
            <div key={c.slug} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium text-gray-900">{cleanName(c.name)}</div>
                <div className="text-xs text-gray-400">baseline {money(c.baselineUsd)}</div>
              </div>
              <div className="mt-3 space-y-2.5">
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-gray-500">Quality retained</span>
                    <span className="font-semibold text-violet-600">{pct0(c.qualityRetentionPct)}</span>
                  </div>
                  <Meter value={c.qualityRetentionPct} color="#7c3aed" />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-gray-500">Cost reduction</span>
                    <span className="font-semibold text-emerald-600">{pct1(c.costReductionPct)}</span>
                  </div>
                  <Meter value={c.costReductionPct} color="#16a34a" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* 3. Savings attribution */}
      <Section title="Savings attribution" subtitle="Where the savings come from.">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
            {data.attribution.map((a, i) => (
              <div
                key={a.key}
                title={`${a.label}: ${money(a.usd)} (${pct0(a.pct)})`}
                style={{ width: `${a.pct}%`, background: ['#16a34a', '#0ea5e9', '#7c3aed'][i % 3] }}
              />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {data.attribution.map((a, i) => (
              <div key={a.key} className="flex items-center gap-3">
                <span
                  className="mt-0.5 h-3 w-3 shrink-0 rounded-sm"
                  style={{ background: ['#16a34a', '#0ea5e9', '#7c3aed'][i % 3] }}
                />
                <div>
                  <div className="text-sm font-medium text-gray-900">{a.label}</div>
                  <div className="text-xs text-gray-500">
                    {money(a.usd)} · {pct0(a.pct)} of savings
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* 4. Workflow analytics */}
      <Section title="Workflow analytics" subtitle="Orchestration patterns and how each performs.">
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="px-4 py-2.5 font-medium">Workflow</th>
                <th className="px-4 py-2.5 font-medium">Requests</th>
                <th className="px-4 py-2.5 font-medium">Avg cost</th>
                <th className="px-4 py-2.5 font-medium">Avg latency</th>
                <th className="px-4 py-2.5 font-medium">Success</th>
                <th className="px-4 py-2.5 font-medium">Savings</th>
                <th className="px-4 py-2.5 font-medium">Signals</th>
              </tr>
            </thead>
            <tbody>
              {data.workflows.map((w) => (
                <tr key={w.key} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-900">{w.label}</td>
                  <td className="px-4 py-3 text-gray-700">{fmtInt(w.requests)}</td>
                  <td className="px-4 py-3 text-gray-700">{w.requests > 0 ? money(w.avgCostUsd) : '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{w.requests > 0 ? ms(w.avgLatencyMs) : '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{w.requests > 0 ? pct0(w.successRatePct) : '—'}</td>
                  <td className="px-4 py-3 text-emerald-600">{w.savingsUsd > 0 ? money(w.savingsUsd) : '—'}</td>
                  <td className="px-4 py-3">
                    <WorkflowSignals w={w} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Est. quality Δ for Critique/Best-of-N/Decompose is a modeled estimate; acceptance, escalation, branch count, subtasks and judge
          rate are measured from recorded legs.
        </p>
      </Section>

      {/* 5. Cache analytics */}
      <Section title="Cache analytics" subtitle="Exact + semantic response cache.">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Metric label="Hit rate" value={pct1(data.cache.hitRatePct)} tone="green" />
          <Metric label="Cache hits" value={fmtInt(data.cache.hits)} />
          <Metric label="Cache misses" value={fmtInt(data.cache.misses)} />
          <Metric label="Cache savings" value={money(data.cache.savingsUsd)} tone="green" />
        </div>
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
            <span>Exact vs semantic hits</span>
            <span>
              {fmtInt(data.cache.exactHits)} exact · {fmtInt(data.cache.semanticHits)} semantic
            </span>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              style={{
                width: `${data.cache.hits > 0 ? (data.cache.exactHits / data.cache.hits) * 100 : 0}%`,
                background: '#0ea5e9',
              }}
            />
            <div
              style={{
                width: `${data.cache.hits > 0 ? (data.cache.semanticHits / data.cache.hits) * 100 : 0}%`,
                background: '#7c3aed',
              }}
            />
          </div>
        </div>
      </Section>

      {/* 6. Model intelligence */}
      <Section title="Model intelligence" subtitle="Which models and providers do the work.">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-2">
            <div className="mb-3 text-sm font-medium text-gray-900">Request distribution</div>
            <div className="space-y-2.5">
              {data.topModels.map((m) => (
                <div key={m.slug} className="flex items-center gap-3">
                  <div className="w-40 shrink-0 truncate font-mono text-xs text-gray-700" title={m.slug}>
                    {shortModel(m.slug)}
                  </div>
                  <div className="flex-1">
                    <Meter value={m.sharePct} color="#6366f1" />
                  </div>
                  <div className="w-28 shrink-0 text-right text-xs text-gray-500">
                    {fmtInt(m.requests)} · Q{Math.round(m.quality)}
                  </div>
                </div>
              ))}
              {data.topModels.length === 0 ? (
                <div className="text-sm text-gray-400">No traffic yet.</div>
              ) : null}
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-3 text-sm font-medium text-gray-900">Providers</div>
              <div className="space-y-2">
                {data.providers.map((p) => (
                  <div key={p.provider} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-gray-700">{p.provider}</span>
                    <span className="text-gray-500">{pct0(p.sharePct)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-2 text-sm font-medium text-gray-900">Premium models avoided</div>
              {data.modelsAvoided.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {data.modelsAvoided.map((m) => (
                    <span
                      key={m.slug}
                      className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                      title={`Quality index ${m.quality}`}
                    >
                      {shortModel(m.slug)}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-400">None — premium models were used directly.</div>
              )}
            </div>
          </div>
        </div>
      </Section>

      {/* 7. Value efficiency */}
      <Section title="Value efficiency" subtitle="Quality retained per unit of cost. Higher is better.">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="space-y-3">
            {data.efficiency
              .slice()
              .sort((a, b) => b.efficiency - a.efficiency)
              .map((e) => (
                <div key={e.label} className="flex items-center gap-3">
                  <div className={`w-36 shrink-0 text-sm ${e.current ? 'font-semibold text-emerald-700' : 'text-gray-700'}`}>
                    {cleanName(e.label)}
                  </div>
                  <div className="flex-1">
                    <div className="h-6 w-full overflow-hidden rounded bg-gray-100">
                      <div
                        className="flex h-full items-center justify-end rounded pr-2 text-xs font-medium text-white"
                        style={{
                          width: `${Math.max(6, (e.efficiency / maxEff) * 100)}%`,
                          background: e.current ? '#16a34a' : '#9ca3af',
                        }}
                      >
                        {e.efficiency >= 1000 ? `${Math.round(e.efficiency)}×` : `${e.efficiency.toFixed(1)}×`}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
          <p className="mt-3 text-xs text-gray-400">
            Efficiency = quality index ÷ cost (relative to {baselineName}). This platform wins by routing and caching
            most traffic to far cheaper models while retaining quality.
          </p>
        </div>
      </Section>

      {/* 8. Routing transparency */}
      <Section title="Routing transparency" subtitle="What the router did, and how confidently.">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-2">
            <div className="mb-3 text-sm font-medium text-gray-900">Top task types &amp; model selected</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="pb-2 font-medium">Task</th>
                  <th className="pb-2 font-medium">Requests</th>
                  <th className="pb-2 font-medium">Model selected</th>
                  <th className="pb-2 font-medium">Consistency</th>
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((t) => (
                  <tr key={t.task} className="border-t border-gray-50">
                    <td className="py-2 capitalize text-gray-800">{t.task}</td>
                    <td className="py-2 text-gray-600">{fmtInt(t.requests)}</td>
                    <td className="py-2 font-mono text-xs text-gray-700">{shortModel(t.topModel)}</td>
                    <td className="py-2 text-gray-600">{pct0(t.topModelSharePct)}</td>
                  </tr>
                ))}
                {data.tasks.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-3 text-sm text-gray-400">
                      No routed traffic yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-gray-600">Routing consistency</span>
                <span className="font-semibold text-gray-900">{pct0(data.routingConsistencyPct)}</span>
              </div>
              <Meter value={data.routingConsistencyPct} color="#6366f1" />
              <p className="mt-1.5 text-xs text-gray-400">Share of each task going to its top model.</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-gray-600">Quality confidence</span>
                <span className="font-semibold text-gray-900">{pct0(data.avgModelQuality)}</span>
              </div>
              <Meter value={data.avgModelQuality} color="#7c3aed" />
              <p className="mt-1.5 text-xs text-gray-400">Avg benchmark quality index of chosen models.</p>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function WorkflowSignals({ w }: { w: WorkflowStat }) {
  const chips: string[] = [];
  if (w.acceptanceRatePct != null) chips.push(`accept ${pct0(w.acceptanceRatePct)}`);
  if (w.escalationRatePct != null) chips.push(`escalate ${pct0(w.escalationRatePct)}`);
  if (w.avgBranchCount != null) chips.push(`${w.avgBranchCount.toFixed(1)} branches`);
  if (w.subtaskAvg != null) chips.push(`${w.subtaskAvg.toFixed(1)} subtasks`);
  if (w.judgeSelectionRatePct != null) chips.push(`judged ${pct0(w.judgeSelectionRatePct)}`);
  if (w.estQualityDelta != null && w.estQualityDelta > 0) chips.push(`est. +${w.estQualityDelta} quality`);
  if (chips.length === 0) return <span className="text-xs text-gray-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span key={c} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
          {c}
        </span>
      ))}
    </div>
  );
}
