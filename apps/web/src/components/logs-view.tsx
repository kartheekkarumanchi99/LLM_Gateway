'use client';

import { useState, useTransition, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { GenerationRow, UpstreamRow } from '@/lib/logs';
import { getGenerationDetail, type GenerationDetail } from '@/lib/logs-actions';
import { formatUsd } from '@/lib/format';
import { fmtInt } from '@/components/charts';

const TABS = ['Generations', 'Upstream Requests', 'Sessions', 'Videos', 'Batches'] as const;
type Tab = (typeof TABS)[number];

const RANGES: { value: number; label: string }[] = [
  { value: 1, label: 'Past 24 Hours' },
  { value: 7, label: 'Past 7 Days' },
  { value: 30, label: 'Past 30 Days' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  let h = d.getUTCHours();
  const m = d.getUTCMinutes().toString().padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${h}:${m} ${ap}`;
}
function speed(r: GenerationRow): string {
  if (!r.latencyMs || r.completionTokens <= 0) return '—';
  return (r.completionTokens / (r.latencyMs / 1000)).toFixed(1) + ' tok/s';
}
function ms(v: number | null): string {
  if (v == null) return '—';
  if (v < 1000) return `${v} ms`;
  return `${(v / 1000).toFixed(2)} s`;
}

export function LogsView({
  generations,
  upstream,
  range,
  connected,
}: {
  generations: GenerationRow[];
  upstream: UpstreamRow[];
  range: number;
  connected: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('Generations');

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Logs</h1>
        <select
          value={range}
          onChange={(e) => router.push(`/logs?range=${e.target.value}`)}
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

      <div className="mt-5 flex gap-4 overflow-x-auto border-b border-gray-200 text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              'shrink-0 border-b-2 px-1 pb-2 ' +
              (tab === t ? 'border-violet-600 font-medium text-violet-700' : 'border-transparent text-gray-500 hover:text-gray-800')
            }
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === 'Generations' ? (
          <Generations rows={generations} />
        ) : tab === 'Upstream Requests' ? (
          <Upstream rows={upstream} />
        ) : (
          <EmptyTab tab={tab} />
        )}
      </div>
    </div>
  );
}

function Generations({ rows }: { rows: GenerationRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, GenerationDetail | null>>({});
  const [, start] = useTransition();

  function toggle(id: string) {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    if (!(id in details)) {
      start(async () => {
        const d = await getGenerationDetail(id);
        setDetails((prev) => ({ ...prev, [id]: d }));
      });
    }
  }

  if (rows.length === 0) return <EmptyRow label="No generations in this period." />;

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[1100px] text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
            <Th className="w-8" />
            <Th>Date</Th>
            <Th>Model</Th>
            <Th>Provider</Th>
            <Th>App</Th>
            <Th className="text-right">Input</Th>
            <Th className="text-right">Output</Th>
            <Th className="text-right">Cost</Th>
            <Th>Usage</Th>
            <Th className="text-right">Speed</Th>
            <Th className="text-right">Routing</Th>
            <Th className="text-right">TTFT</Th>
            <Th>Finish</Th>
            <Th>API Key</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.requestId}>
              <tr
                onClick={() => toggle(r.requestId)}
                className="cursor-pointer border-b border-gray-50 hover:bg-gray-50"
              >
                <Td className="text-gray-400">
                  {open === r.requestId ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Td>
                <Td className="whitespace-nowrap text-gray-600">{fmtDateTime(r.createdAt)}</Td>
                <Td className="font-medium text-gray-900">{r.modelSlug}</Td>
                <Td className="text-gray-600">{r.providerSlug}</Td>
                <Td className="text-gray-600">{r.appName ?? 'Direct / API'}</Td>
                <Td className="text-right text-gray-600">{fmtInt(r.promptTokens)}</Td>
                <Td className="text-right text-gray-600">{fmtInt(r.completionTokens)}</Td>
                <Td className="text-right text-gray-700">{formatUsd(r.costUsd, 6)}</Td>
                <Td>
                  <span className={r.byok ? 'rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700' : 'rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600'}>
                    {r.byok ? 'BYOK' : 'Credits'}
                  </span>
                </Td>
                <Td className="whitespace-nowrap text-right text-gray-600">{speed(r)}</Td>
                <Td className="whitespace-nowrap text-right text-gray-600">{ms(r.routingOverheadMs)}</Td>
                <Td className="whitespace-nowrap text-right text-gray-600">{ms(r.ttftMs)}</Td>
                <Td className="text-gray-600">{r.finishReason ?? '—'}</Td>
                <Td className="text-gray-600">{r.keyName ?? '—'}</Td>
              </tr>
              {open === r.requestId ? (
                <tr key={r.requestId + '-d'} className="border-b border-gray-100 bg-gray-50/60">
                  <td colSpan={14} className="px-4 py-3">
                    <Detail detail={details[r.requestId]} loaded={r.requestId in details} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Detail({ detail, loaded }: { detail: GenerationDetail | null | undefined; loaded: boolean }) {
  if (!loaded) return <div className="text-sm text-gray-400">Loading…</div>;
  if (!detail) {
    return (
      <div className="text-sm text-gray-500">
        No logged content. Enable <span className="font-medium">Input &amp; Output Logging</span> in Observability to
        capture prompts and completions.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {detail.messages.map((m, i) => (
        <div key={i} className="text-sm">
          <span className="font-medium text-gray-500">{m.role}: </span>
          <span className="whitespace-pre-wrap break-words text-gray-700">{m.content.slice(0, 2000)}</span>
        </div>
      ))}
      {detail.completion ? (
        <div className="text-sm">
          <span className="font-medium text-gray-500">assistant: </span>
          <span className="whitespace-pre-wrap break-words text-gray-700">{detail.completion.slice(0, 2000)}</span>
        </div>
      ) : null}
    </div>
  );
}

function Upstream({ rows }: { rows: UpstreamRow[] }) {
  if (rows.length === 0) return <EmptyRow label="No upstream requests in this period." />;
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
            <Th>Date</Th>
            <Th>Model</Th>
            <Th>Final Provider</Th>
            <Th>Generation ID</Th>
            <Th>Status</Th>
            <Th className="text-right">Attempts</Th>
            <Th>Key</Th>
            <Th className="text-right">Latency</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.requestId} className="border-b border-gray-50 hover:bg-gray-50">
              <Td className="whitespace-nowrap text-gray-600">{fmtDateTime(r.createdAt)}</Td>
              <Td className="font-medium text-gray-900">{r.modelSlug}</Td>
              <Td className="text-gray-600">{r.providerSlug}</Td>
              <Td className="font-mono text-xs text-gray-500">{r.requestId.slice(0, 28)}</Td>
              <Td>
                <span className={r.status === '200' ? 'rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-700' : 'rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700'}>
                  {r.status}
                </span>
              </Td>
              <Td className="text-right text-gray-600">{r.attempts}</Td>
              <Td className="text-gray-600">{r.keyName ?? '—'}</Td>
              <Td className="whitespace-nowrap text-right text-gray-600">{ms(r.latencyMs)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyTab({ tab }: { tab: Tab }) {
  const msgs: Record<string, string> = {
    Sessions: 'No sessions recorded in this period.',
    Videos: 'Video generation is not enabled on this gateway.',
    Batches: 'No batch jobs in this period.',
  };
  return <EmptyRow label={msgs[tab] ?? 'Nothing to show.'} />;
}
function EmptyRow({ label }: { label: string }) {
  return (
    <div className="grid place-items-center rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-400">
      {label}
    </div>
  );
}
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
