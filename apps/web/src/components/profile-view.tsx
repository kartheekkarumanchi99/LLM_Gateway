'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Pencil, X } from 'lucide-react';
import type { ProfileData } from '@/lib/profile';
import { updateUserProfile } from '@/lib/profile-actions';
import { formatUsd } from '@/lib/format';
import { Bars, fmtInt, Heatmap, HeatLegend } from '@/components/charts';

type Metric = 'tokens' | 'spend' | 'requests';

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
function mdLabel(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}
function spendLabel(v: number): string {
  if (v > 0 && v < 0.01) return '< $0.01';
  return formatUsd(v, v < 1 ? 4 : 2);
}

export function ProfileView({
  name,
  email,
  data,
  connected,
}: {
  name: string;
  email: string;
  data: ProfileData;
  connected: boolean;
}) {
  const router = useRouter();
  const [metric, setMetric] = useState<Metric>('spend');
  const [range, setRange] = useState(7);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [pending, start] = useTransition();

  const byDate = useMemo(() => new Map(data.daily.map((d) => [d.date, d])), [data.daily]);
  const series = useMemo(() => {
    return lastNDays(range).map((date) => {
      const row = byDate.get(date);
      const value =
        metric === 'spend' ? (row?.spendUsd ?? 0) : metric === 'tokens' ? (row?.tokens ?? 0) : (row?.requests ?? 0);
      return { date, value };
    });
  }, [byDate, range, metric]);

  const total = series.reduce((s, p) => s + p.value, 0);
  const hasData = series.some((p) => p.value > 0);
  const bigValue =
    metric === 'spend' ? spendLabel(total) : fmtInt(total) + (metric === 'tokens' ? ' tokens' : ' requests');

  const initials = (name || email || 'U')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('');

  function saveName() {
    start(async () => {
      const res = await updateUserProfile(draft);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    });
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-orange-500 text-xl font-semibold text-white">
          {initials}
        </div>
        <div>
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="rounded-lg border border-gray-300 px-2 py-1 text-lg font-semibold outline-none focus:border-violet-500"
                autoFocus
              />
              <button onClick={saveName} disabled={pending} className="rounded p-1 text-green-600 hover:bg-green-50">
                <Check className="h-4 w-4" />
              </button>
              <button onClick={() => { setEditing(false); setDraft(name); }} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-gray-900">{name || 'Unnamed User'}</h1>
              {connected ? (
                <button onClick={() => setEditing(true)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Edit name">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          )}
          <div className="text-sm text-gray-500">{email || '—'}</div>
        </div>
      </div>

      {!connected ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code> and run{' '}
          <code className="font-mono">pnpm db:push</code>, <code className="font-mono">pnpm db:seed</code>.
        </div>
      ) : null}

      {/* Usage summary */}
      <div className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-gray-900">Usage summary</span>
            <select
              value={range}
              onChange={(e) => setRange(Number(e.target.value))}
              className="rounded-lg border border-gray-300 px-2 py-1 text-sm outline-none"
            >
              <option value={7}>Last 7 Days</option>
              <option value={14}>Last 14 Days</option>
              <option value={30}>Last 30 Days</option>
            </select>
          </div>
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-sm">
            {(['tokens', 'spend', 'requests'] as Metric[]).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={
                  'rounded-md px-3 py-1 capitalize ' +
                  (metric === m ? 'bg-violet-100 font-medium text-violet-700' : 'text-gray-500 hover:text-gray-800')
                }
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
          <div>
            <div className="text-3xl font-semibold text-gray-900">{bigValue}</div>
            <div className="text-sm text-gray-400">{hasData ? 'Daily total' : 'No prior data'}</div>
            <div className="mt-4">
              <Bars
                data={series.map((p) => ({ label: mdLabel(p.date), value: p.value }))}
                color="#6366f1"
                valueFmt={(v) => (metric === 'spend' ? spendLabel(v) : fmtInt(v))}
              />
              <div className="mt-1 flex justify-between text-[11px] text-gray-400">
                <span>{series.length ? mdLabel(series[0]!.date) : ''}</span>
                <span>{series.length ? mdLabel(series[series.length - 1]!.date) : ''}</span>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <div className="mb-2 text-sm font-medium text-gray-900">Top models <span className="font-normal text-gray-400">by spend</span></div>
            {data.topModels.length === 0 ? (
              <div className="text-sm text-gray-400">No usage yet.</div>
            ) : (
              <div className="space-y-2">
                {data.topModels.map((m) => (
                  <div key={m.modelSlug} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 truncate text-gray-700">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-violet-500" />
                      <span className="truncate">{m.modelSlug}</span>
                    </span>
                    <span className="shrink-0 text-gray-500">{spendLabel(m.spendUsd)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Activity */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-4 font-semibold text-gray-900">Activity</div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Longest streak" value={`${data.stats.longestStreakDays} day${data.stats.longestStreakDays === 1 ? '' : 's'}`} />
          <Stat label="Avg / day" value={formatUsd(data.stats.avgPerDayUsd, 6)} />
          <Stat label="Avg / week" value={formatUsd(data.stats.avgPerWeekUsd, 6)} />
          <Stat label="Total" value={formatUsd(data.stats.totalSpendUsd, data.stats.totalSpendUsd < 1 ? 5 : 2)} />
        </div>
        <div className="mt-5">
          <Heatmap points={data.heatmap} />
          <div className="mt-2">
            <HeatLegend />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}
