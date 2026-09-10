'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, CircleCheck, CircleX, RefreshCw, ShieldAlert, Zap } from 'lucide-react';
import type { ProviderStatus, ReliabilityData } from '@/lib/reliability';
import { resetProviderBreaker } from '@/lib/reliability-actions';

function pct(x: number): string {
  return (x * 100).toFixed(x >= 0.9995 ? 0 : 1) + '%';
}

const BREAKER_META: Record<string, { label: string; dot: string; text: string; ring: string }> = {
  closed: { label: 'Operational', dot: 'bg-emerald-500', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  half_open: { label: 'Recovering', dot: 'bg-amber-500', text: 'text-amber-700', ring: 'ring-amber-200' },
  open: { label: 'Failing over', dot: 'bg-rose-500', text: 'text-rose-700', ring: 'ring-rose-200' },
  unknown: { label: 'No live data', dot: 'bg-gray-300', text: 'text-gray-500', ring: 'ring-gray-200' },
};

function Sparkline({ p }: { p: ProviderStatus }) {
  const buckets = p.hourly.slice(-24);
  if (buckets.length === 0) return <div className="h-8 text-[10px] text-gray-300">no traffic (24h)</div>;
  const max = Math.max(1, ...buckets.map((b) => b.requests));
  return (
    <div className="flex h-8 items-end gap-[2px]">
      {buckets.map((b, i) => {
        const h = Math.max(2, (b.requests / max) * 32);
        const errH = b.requests > 0 ? (b.errors / b.requests) * h : 0;
        return (
          <div key={i} className="relative w-full rounded-sm bg-gray-200" style={{ height: `${h}px` }} title={`${b.hour}: ${b.requests} req, ${b.errors} err`}>
            {errH > 0 ? <div className="absolute bottom-0 w-full rounded-sm bg-rose-400" style={{ height: `${errH}px` }} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function ProviderCard({ p }: { p: ProviderStatus }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const meta = BREAKER_META[p.breaker] ?? BREAKER_META.unknown!;
  function reset() {
    startTransition(async () => {
      await resetProviderBreaker(p.provider);
      router.refresh();
    });
  }
  return (
    <div className={`rounded-xl border bg-white p-4 ${p.breaker === 'open' ? 'border-rose-200' : p.breaker === 'half_open' ? 'border-amber-200' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{p.displayName}</span>
          <code className="font-mono text-[11px] text-gray-400">{p.provider}</code>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${meta.text} ${meta.ring}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${p.breaker === 'open' ? 'animate-pulse' : ''}`} />
          {meta.label}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-gray-50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-gray-400">Success 24h</div>
          <div className="text-sm font-semibold text-gray-900">{p.history.requests > 0 ? pct(p.history.successRate) : '—'}</div>
        </div>
        <div className="rounded-lg bg-gray-50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-gray-400">p50 / p95</div>
          <div className="text-sm font-semibold text-gray-900">
            {p.history.requests > 0 ? `${p.history.p50Ms}/${p.history.p95Ms}ms` : '—'}
          </div>
        </div>
        <div className="rounded-lg bg-gray-50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-gray-400">Requests 24h</div>
          <div className="text-sm font-semibold text-gray-900">{p.history.requests}</div>
        </div>
      </div>

      <div className="mt-3">
        <Sparkline p={p} />
      </div>

      {p.live && p.live.sampleCount > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
          <span>Live window: {p.live.sampleCount} calls</span>
          <span>err {pct(p.live.errorRate)}</span>
          {p.live.rateLimitRate > 0 ? <span className="text-amber-600">429s {pct(p.live.rateLimitRate)}</span> : null}
          <span>p95 {p.live.p95Ms}ms</span>
        </div>
      ) : null}

      {p.breaker === 'open' || p.breaker === 'half_open' ? (
        <button
          onClick={reset}
          disabled={pending}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} /> Reset breaker
        </button>
      ) : null}
    </div>
  );
}

export function StatusView({ data }: { data: ReliabilityData }) {
  const router = useRouter();
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 15_000);
    return () => clearInterval(id);
  }, [auto, router]);

  const anyDown = data.providers.some((p) => p.breaker === 'open' || p.breaker === 'half_open');

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-400">
            <Zap className="h-3.5 w-3.5" /> Effective uptime
          </div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">{pct(data.slaUptime)}</div>
          <div className="text-[11px] text-gray-400">across all providers · 24h</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-[11px] uppercase tracking-wide text-gray-400">Requests 24h</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">{data.totalRequests}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-[11px] uppercase tracking-wide text-gray-400">Overall</div>
          <div className={`mt-1 flex items-center gap-1.5 text-lg font-semibold ${anyDown ? 'text-amber-600' : 'text-emerald-600'}`}>
            {anyDown ? <ShieldAlert className="h-5 w-5" /> : <CircleCheck className="h-5 w-5" />}
            {anyDown ? 'Failover active' : 'All systems go'}
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-[11px] uppercase tracking-wide text-gray-400">Live mesh</div>
          <div className={`mt-1 flex items-center gap-1.5 text-lg font-semibold ${data.gatewayReachable ? 'text-emerald-600' : 'text-gray-400'}`}>
            {data.gatewayReachable ? <Activity className="h-5 w-5" /> : <CircleX className="h-5 w-5" />}
            {data.gatewayReachable ? 'Connected' : 'Offline'}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300 text-emerald-600" />
          Auto-refresh (15s)
        </label>
        <button onClick={() => router.refresh()} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.providers.map((p) => (
          <ProviderCard key={p.provider} p={p} />
        ))}
      </div>
    </div>
  );
}
