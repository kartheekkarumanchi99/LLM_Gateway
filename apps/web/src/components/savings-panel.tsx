'use client';

import { useState } from 'react';
import { TrendingDown } from 'lucide-react';
import { fmtInt } from '@/components/charts';
import type { SavingsData } from '@/lib/savings-types';

function money(n: number): string {
  const abs = Math.abs(n);
  const digits = abs < 0.01 ? 6 : abs < 1 ? 4 : 2;
  return (n < 0 ? '-$' : '$') + abs.toFixed(digits);
}

export function SavingsPanel({ data }: { data: SavingsData }) {
  const [baselineSlug, setBaselineSlug] = useState(data.baselines[0]?.slug ?? '');
  const baseline = data.baselines.find((b) => b.slug === baselineSlug) ?? data.baselines[0];

  if (data.requests === 0 || !baseline) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <TrendingDown className="h-4 w-4 text-emerald-600" /> Cost savings
        </div>
        <p className="mt-2 text-sm text-gray-500">
          No usage recorded yet. Send requests through the gateway and savings versus a
          single-model baseline will appear here.
        </p>
      </div>
    );
  }

  const cost = (pt: number, ct: number) =>
    (pt / 1_000_000) * baseline.promptPerM + (ct / 1_000_000) * baseline.completionPerM;

  const baselineUsd = cost(data.promptTokens, data.completionTokens);
  const savedUsd = baselineUsd - data.actualUsd;
  const savedPct = baselineUsd > 0 ? (savedUsd / baselineUsd) * 100 : 0;

  const rows = data.byModel
    .map((m) => {
      const base = cost(m.promptTokens, m.completionTokens);
      return { ...m, baselineUsd: base, savedUsd: base - m.actualUsd };
    })
    .slice(0, 6);

  return (
    <div className="rounded-xl border border-emerald-200 bg-gradient-to-b from-emerald-50/70 to-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <TrendingDown className="h-4 w-4" /> Cost savings
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-4xl font-bold text-emerald-600">
              {savedPct > 0 ? savedPct.toFixed(0) : '0'}%
            </span>
            <span className="text-lg font-semibold text-gray-800">
              {money(Math.max(0, savedUsd))} saved
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            across {fmtInt(data.requests)} requests · {fmtInt(data.promptTokens + data.completionTokens)}{' '}
            tokens
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Compare against</label>
          <select
            value={baselineSlug}
            onChange={(e) => setBaselineSlug(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
          >
            {data.baselines.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-500">Without routing (all {baseline.name})</div>
          <div className="mt-1 text-2xl font-semibold text-gray-400 line-through">
            {money(baselineUsd)}
          </div>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-white p-4">
          <div className="text-xs text-gray-500">With intelligent routing</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-600">{money(data.actualUsd)}</div>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="mt-5 overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Model actually used</th>
                <th className="px-3 py-2 text-right font-medium">Requests</th>
                <th className="px-3 py-2 text-right font-medium">Actual</th>
                <th className="px-3 py-2 text-right font-medium">If {baseline.name}</th>
                <th className="px-3 py-2 text-right font-medium">Saved</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.model} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono text-xs text-gray-700">{r.model}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{fmtInt(r.requests)}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{money(r.actualUsd)}</td>
                  <td className="px-3 py-2 text-right text-gray-400">{money(r.baselineUsd)}</td>
                  <td
                    className={
                      'px-3 py-2 text-right font-medium ' +
                      (r.savedUsd >= 0 ? 'text-emerald-600' : 'text-gray-400')
                    }
                  >
                    {money(r.savedUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="mt-3 text-xs text-gray-400">
        Baseline assumes every request had used {baseline.name} at list price; actual is metered per
        request. Savings grow as routine prompts route to cheaper models.
      </p>
    </div>
  );
}
