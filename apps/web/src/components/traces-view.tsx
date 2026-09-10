'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, History, Search, Star } from 'lucide-react';
import { formatTokens, formatUsd } from '@/lib/format';
import type { TraceListItem } from '@/lib/traces';
import { toggleTraceStar } from '@/lib/trace-actions';

function fmtTime(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ') + ' UTC';
}

export function TracesView({ traces, range }: { traces: TraceListItem[]; range: number }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [stars, setStars] = useState<Record<string, boolean>>(
    () => Object.fromEntries(traces.map((t) => [t.traceId, t.starred])),
  );
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return traces.filter((t) => {
      if (errorsOnly && !t.hasError) return false;
      if (starredOnly && !stars[t.traceId]) return false;
      if (!needle) return true;
      return (
        t.traceId.toLowerCase().includes(needle) ||
        (t.appName ?? '').toLowerCase().includes(needle) ||
        t.models.some((m) => m.toLowerCase().includes(needle))
      );
    });
  }, [traces, q, errorsOnly, starredOnly, stars]);

  function star(e: React.MouseEvent, traceId: string) {
    e.stopPropagation();
    setStars((s) => ({ ...s, [traceId]: !s[traceId] }));
    startTransition(async () => {
      const res = await toggleTraceStar(traceId);
      if (res.ok && res.starred !== undefined) setStars((s) => ({ ...s, [traceId]: res.starred! }));
    });
  }

  function setRange(days: number) {
    router.push(`/traces?range=${days}`);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by trace id, model, or app…"
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-0.5">
          {[1, 7, 30].map((d) => (
            <button
              key={d}
              onClick={() => setRange(d)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${range === d ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {d}d
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300 text-rose-600" />
          Errors
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={starredOnly} onChange={(e) => setStarredOnly(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300 text-amber-500" />
          Starred
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6 grid place-items-center rounded-xl border border-gray-200 bg-white p-12 text-center">
          <History className="mb-2 h-7 w-7 text-gray-300" />
          <div className="font-medium text-gray-700">No traces</div>
          <div className="mt-1 text-sm text-gray-500">
            Send a request through the gateway. Pass an <code className="font-mono">X-LLMGW-Trace</code> header to group
            multi-step agent runs.
          </div>
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="w-8 px-3 py-2"></th>
                <th className="px-3 py-2">Trace</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2 text-right">Steps</th>
                <th className="px-3 py-2 text-right">Spans</th>
                <th className="px-3 py-2">Models</th>
                <th className="px-3 py-2 text-right">Tokens</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr
                  key={t.traceId}
                  onClick={() => router.push(`/traces/${encodeURIComponent(t.traceId)}`)}
                  className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50"
                >
                  <td className="px-3 py-2.5">
                    <button onClick={(e) => star(e, t.traceId)} aria-label="Star trace">
                      <Star className={`h-4 w-4 ${stars[t.traceId] ? 'fill-amber-400 text-amber-400' : 'text-gray-300 hover:text-amber-300'}`} />
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <code className="font-mono text-xs text-gray-700">{t.traceId.slice(0, 20)}{t.traceId.length > 20 ? '…' : ''}</code>
                    {t.appName ? <span className="ml-2 text-[11px] text-gray-400">{t.appName}</span> : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-gray-500">{fmtTime(t.startedAt)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{t.steps}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{t.spanCount}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {t.models.slice(0, 2).map((m) => (
                        <span key={m} className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-600">
                          {m.split('/').pop()}
                        </span>
                      ))}
                      {t.models.length > 2 ? <span className="text-[10px] text-gray-400">+{t.models.length - 2}</span> : null}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{formatTokens(t.totalTokens)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">{formatUsd(t.totalCostUsd, 4)}</td>
                  <td className="px-3 py-2.5">
                    {t.hasError ? (
                      <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700">
                        <AlertTriangle className="h-3 w-3" /> error
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
