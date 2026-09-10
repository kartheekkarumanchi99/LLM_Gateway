'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, Zap } from 'lucide-react';

type Phase = 'healthy' | 'degrading' | 'tripped' | 'recovering';
// Weighted cycle so the "live" incident dwells on the interesting states.
const CYCLE: Phase[] = ['healthy', 'healthy', 'degrading', 'tripped', 'tripped', 'recovering'];
const BASE_BARS = [10, 13, 8, 15, 11, 14, 9, 16];

const OK_META = { dot: 'bg-emerald-500', bar: 'bg-emerald-300' };
const PHASE_META: Record<Phase, { dot: string; bar: string; label: string; pctCls: string }> = {
  healthy: { dot: 'bg-emerald-500', bar: 'bg-emerald-300', label: '99.7%', pctCls: 'text-gray-500' },
  degrading: { dot: 'bg-amber-500', bar: 'bg-amber-300', label: 'errors ↑', pctCls: 'text-amber-600' },
  tripped: { dot: 'bg-rose-500', bar: 'bg-rose-300', label: 'rerouting', pctCls: 'text-rose-600' },
  recovering: { dot: 'bg-amber-500', bar: 'bg-amber-300', label: 'recovering', pctCls: 'text-amber-600' },
};

export function ReliabilityMock({ providers }: { providers: string[] }) {
  const names = [providers[0] ?? 'OpenAI', providers[1] ?? 'Anthropic', providers[2] ?? 'DeepSeek', providers[3] ?? 'Google'];
  const flaky = 2;
  const [step, setStep] = useState(0);
  const [bars, setBars] = useState<number[][]>(() => names.map(() => BASE_BARS));
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted) return;
    const id = setInterval(() => {
      setStep((s) => s + 1);
      setBars((prev) => prev.map((row) => row.map(() => 5 + Math.round(Math.random() * 13))));
    }, 1300);
    return () => clearInterval(id);
  }, [mounted]);

  const phase = CYCLE[step % CYCLE.length]!;

  return (
    <div className="lg-float relative overflow-hidden rounded-2xl border border-gray-200 bg-[#fbfbfb] p-5 shadow-xl shadow-gray-200/60">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-400/60 to-transparent lg-scan" />
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">Provider health</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
          <span className="lg-pulse h-2 w-2 rounded-full bg-emerald-500" /> live
        </span>
      </div>

      <div className="space-y-2">
        {names.map((name, ri) => {
          const isFlaky = ri === flaky;
          const meta = isFlaky ? PHASE_META[phase] : OK_META;
          const pct = isFlaky ? PHASE_META[phase].label : ri === 1 ? '99.8%' : '99.9%';
          const pctCls = isFlaky ? PHASE_META[phase].pctCls : 'text-gray-500';
          return (
            <div key={name} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <span className={`h-2 w-2 rounded-full transition-colors duration-500 ${meta.dot} ${isFlaky && phase !== 'healthy' ? 'lg-blink' : ''}`} />
              <span className="flex-1 text-sm font-medium text-gray-800">{name}</span>
              <div className="hidden h-6 items-end gap-0.5 sm:flex">
                {bars[ri]!.map((h, i) => (
                  <span
                    key={i}
                    className={`w-1 rounded-sm transition-[height] duration-700 ease-out ${meta.bar}`}
                    style={{ height: h }}
                  />
                ))}
              </div>
              <span className={`w-20 text-right text-xs font-medium transition-colors duration-500 ${pctCls}`}>{pct}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 min-h-[2.25rem]">
        {phase === 'healthy' ? (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" /> All providers healthy — routing to the best model per request.
          </div>
        ) : phase === 'degrading' ? (
          <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <Zap className="h-3.5 w-3.5" /> {names[flaky]} error rate rising — watching the breaker…
          </div>
        ) : phase === 'tripped' ? (
          <div className="flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-xs font-medium text-violet-700">
            <Zap className="h-3.5 w-3.5" /> Breaker tripped on {names[flaky]} → failed over to a healthy model.
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" /> Half-open probe succeeded — {names[flaky]} recovering automatically.
          </div>
        )}
      </div>
    </div>
  );
}
