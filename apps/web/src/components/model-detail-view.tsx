'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Copy, Sparkles } from 'lucide-react';
import { StackedBars, fmtInt } from '@/components/charts';
import { ProviderLogo } from '@/components/provider-logo';
import { formatPricePerM, formatTokens } from '@/lib/format';
import type { CatalogModel, ModelInsights } from '@/lib/catalog-types';

const SUBNAV = [
  { id: 'providers', label: 'Providers' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'performance', label: 'Performance' },
  { id: 'uptime', label: 'Uptime' },
  { id: 'benchmarks', label: 'Benchmarks' },
  { id: 'apps', label: 'Apps' },
  { id: 'activity', label: 'Activity' },
  { id: 'faq', label: 'FAQ' },
];

const MOD_COLOR: Record<string, string> = {
  text: 'bg-gray-100 text-gray-600',
  image: 'bg-blue-50 text-blue-600',
  audio: 'bg-purple-50 text-purple-600',
  video: 'bg-pink-50 text-pink-600',
  file: 'bg-amber-50 text-amber-700',
};

function parseModality(modality: string | null): { inputs: string[]; outputs: string[] } {
  if (!modality) return { inputs: ['text'], outputs: ['text'] };
  const [inp, out] = modality.split('->');
  const split = (s?: string) =>
    s
      ? s
          .split(/[+,/]/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      : [];
  const inputs = split(inp);
  const outputs = split(out ?? inp);
  return { inputs: inputs.length ? inputs : ['text'], outputs: outputs.length ? outputs : ['text'] };
}

function fmtMs(ms: number): string {
  if (!ms || ms <= 0) return '—';
  if (ms >= 1000) return (ms / 1000).toFixed(2) + 's';
  return Math.round(ms) + 'ms';
}

export function ModelDetailView({
  model,
  insights,
}: {
  model: CatalogModel;
  insights: ModelInsights;
}) {
  const [showCurl, setShowCurl] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const { inputs, outputs } = parseModality(model.modality);
  const t = insights.telemetry;
  const hasTelemetry = t.requests > 0;
  const successRate = t.requests > 0 ? (t.successes / t.requests) * 100 : 0;
  const hasActivity = insights.activity.some((d) => d.prompt + d.completion > 0);

  const curl = [
    'curl http://localhost:8787/v1/chat/completions \\',
    '  -H "Authorization: Bearer $LLMGW_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    "  -d '{",
    `    "model": "${model.slug}",`,
    '    "messages": [{ "role": "user", "content": "Hello" }]',
    "  }'",
  ].join('\n');

  const desc = model.description ?? '';
  const longDesc = desc.length > 260;

  function copyCurl() {
    void navigator.clipboard?.writeText(curl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div>
      <Link
        href="/models"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" /> Models
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ProviderLogo slug={model.provider} icon={model.providerIcon} size={44} />
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-gray-900">
              {model.providerName}: {model.name}
              {model.executable ? (
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                  Runnable
                </span>
              ) : null}
            </h1>
            <p className="mt-0.5 font-mono text-xs text-gray-400">{model.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCurl((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            <Sparkles className="h-4 w-4" /> Try this model
          </button>
          <Link
            href="/chat"
            className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Playground
          </Link>
        </div>
      </div>

      {showCurl ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-gray-950">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
            <span className="text-xs font-medium text-gray-400">Send a request to this gateway</span>
            <button
              onClick={copyCurl}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-300 hover:bg-white/10"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-gray-100">
            <code>{curl}</code>
          </pre>
        </div>
      ) : null}

      {/* Overview cards */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <OverviewCard label="Modalities">
          <div className="flex flex-wrap gap-1">
            {inputs.map((m) => (
              <span key={'in-' + m} className={'rounded px-1.5 py-0.5 text-[11px] font-medium ' + (MOD_COLOR[m] ?? MOD_COLOR.text)}>
                {m}
              </span>
            ))}
            <span className="px-0.5 text-gray-400">→</span>
            {outputs.map((m) => (
              <span key={'out-' + m} className={'rounded px-1.5 py-0.5 text-[11px] font-medium ' + (MOD_COLOR[m] ?? MOD_COLOR.text)}>
                {m}
              </span>
            ))}
          </div>
        </OverviewCard>
        <OverviewCard label="Input / output price">
          <div className="text-sm font-semibold text-gray-900">
            {formatPricePerM(model.promptPricePerM)} / {formatPricePerM(model.completionPricePerM)}
          </div>
          <div className="text-xs text-gray-400">per 1M tokens</div>
        </OverviewCard>
        <OverviewCard label="Context">
          <div className="text-sm font-semibold text-gray-900">{formatTokens(model.contextLength)}</div>
          <div className="text-xs text-gray-400">tokens</div>
        </OverviewCard>
        <OverviewCard label="Added">
          <div className="text-sm font-semibold text-gray-900">{model.createdAt.slice(0, 10)}</div>
          <div className="text-xs text-gray-400">to this gateway</div>
        </OverviewCard>
      </div>

      {/* Description */}
      {desc ? (
        <div className="mt-4 text-sm leading-relaxed text-gray-600">
          <p className={expanded || !longDesc ? '' : 'line-clamp-3'}>{desc}</p>
          {longDesc ? (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-xs font-medium text-violet-600 hover:text-violet-700"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Body: sub-nav + sections */}
      <div className="mt-8 flex gap-8">
        <nav className="sticky top-4 hidden h-fit w-40 shrink-0 space-y-0.5 lg:block">
          {SUBNAV.map((s) => (
            <a
              key={s.id}
              href={'#' + s.id}
              className="block rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            >
              {s.label}
            </a>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-10">
          {/* Providers */}
          <Section id="providers" title="Providers">
            <p className="mb-3 text-sm text-gray-500">
              Served through this gateway via {model.providerName}.
            </p>
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Provider</th>
                    <th className="px-3 py-2 font-medium">Input /M</th>
                    <th className="px-3 py-2 font-medium">Output /M</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-800">{model.providerName}</td>
                    <td className="px-3 py-2 text-gray-700">{formatPricePerM(model.promptPricePerM)}</td>
                    <td className="px-3 py-2 text-gray-700">{formatPricePerM(model.completionPricePerM)}</td>
                    <td className="px-3 py-2">
                      {model.executable ? (
                        <span className="text-emerald-600">Runnable</span>
                      ) : (
                        <span className="text-gray-400">Catalog only</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          {/* Pricing */}
          <Section id="pricing" title="Pricing">
            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
              <StatCard label="Input price" value={formatPricePerM(model.promptPricePerM)} sub="/M tokens" />
              <StatCard label="Output price" value={formatPricePerM(model.completionPricePerM)} sub="/M tokens" />
            </div>
            <p className="mt-3 text-xs text-gray-400">
              Listed catalog price. Actual spend is metered per request and recorded in the credit
              ledger.
            </p>
          </Section>

          {/* Performance */}
          <Section id="performance" title="Performance">
            <p className="mb-3 text-sm text-gray-500">
              Measured from real requests routed to this model through the gateway.
            </p>
            {hasTelemetry ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="Throughput" value={`${Math.round(t.avgThroughput)}`} sub="tok/s avg" />
                <StatCard label="Latency p50" value={fmtMs(t.p50LatencyMs)} sub="median" />
                <StatCard label="Latency p95" value={fmtMs(t.p95LatencyMs)} sub="tail" />
                <StatCard label="Time to first token" value={fmtMs(t.avgTtftMs)} sub="avg (streaming)" />
              </div>
            ) : (
              <EmptyState>
                No performance data yet. Route requests to{' '}
                <code className="font-mono text-gray-600">{model.slug}</code> through the gateway to
                see real throughput and latency here.
              </EmptyState>
            )}
          </Section>

          {/* Uptime */}
          <Section id="uptime" title="Uptime">
            {hasTelemetry ? (
              <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                <StatCard label="Success rate" value={`${successRate.toFixed(1)}%`} sub={`${fmtInt(t.requests)} requests`} />
                <StatCard label="Errors" value={fmtInt(t.requests - t.successes)} sub="failed requests" />
              </div>
            ) : (
              <EmptyState>No request history yet for this model.</EmptyState>
            )}
          </Section>

          {/* Benchmarks */}
          <Section id="benchmarks" title="Benchmarks">
            <EmptyState>
              External benchmark scores are not connected. This section populates when an evaluation
              source is configured — no scores are shown to avoid displaying data we cannot verify.
            </EmptyState>
          </Section>

          {/* Apps */}
          <Section id="apps" title="Apps">
            <p className="mb-3 text-sm text-gray-500">
              Client apps that sent the most traffic to this model on your gateway.
            </p>
            {insights.apps.length > 0 ? (
              <div className="space-y-2">
                {insights.apps.map((a, i) => (
                  <div
                    key={a.app + i}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2 text-gray-700">
                      <span className="text-gray-400">{i + 1}.</span> {a.app}
                    </span>
                    <span className="text-gray-500">
                      {fmtInt(a.tokens)} tokens · {fmtInt(a.requests)} req
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState>No app traffic recorded for this model yet.</EmptyState>
            )}
          </Section>

          {/* Activity */}
          <Section id="activity" title="Activity">
            <p className="mb-3 text-sm text-gray-500">Token volume to this model over the last 30 days.</p>
            {hasActivity ? (
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <StackedBars
                  data={insights.activity.map((d) => ({ prompt: d.prompt, completion: d.completion }))}
                  series={[
                    { key: 'prompt', color: '#6366f1', label: 'Prompt' },
                    { key: 'completion', color: '#a855f7', label: 'Completion' },
                  ]}
                  height={140}
                />
                <div className="mt-3 flex gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-[#6366f1]" /> Prompt
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-[#a855f7]" /> Completion
                  </span>
                </div>
              </div>
            ) : (
              <EmptyState>No usage in the last 30 days.</EmptyState>
            )}
          </Section>

          {/* FAQ */}
          <Section id="faq" title="Frequently asked questions">
            <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
              <Faq q={`What is ${model.name}?`}>
                {desc || `${model.name} is a model served via ${model.providerName} on this gateway.`}
              </Faq>
              <Faq q={`How much does ${model.name} cost?`}>
                Input {formatPricePerM(model.promptPricePerM)} per 1M tokens, output{' '}
                {formatPricePerM(model.completionPricePerM)} per 1M tokens.
              </Faq>
              <Faq q={`What is the context length of ${model.name}?`}>
                {formatTokens(model.contextLength)} tokens.
              </Faq>
              <Faq q={`Can I run ${model.name} on this gateway?`}>
                {model.executable
                  ? 'Yes — this model has a provider adapter and credentials, so requests route to it directly.'
                  : 'Not yet — it is listed in the catalog but is not runnable on this gateway.'}
              </Faq>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4">
      <h2 className="mb-3 text-lg font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

function OverviewCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      {children}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-gray-900">{value}</div>
      {sub ? <div className="text-xs text-gray-400">{sub}</div> : null}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">
      {children}
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group px-4">
      <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-sm font-medium text-gray-800">
        {q}
        <span className="text-gray-400 transition group-open:rotate-180">⌄</span>
      </summary>
      <p className="pb-3 text-sm text-gray-600">{children}</p>
    </details>
  );
}
