'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDownLeft, ArrowUpRight, Gauge, Plus, Scale, Trash2, Zap } from 'lucide-react';
import { Toggle, SaveButton } from '@/components/toggle';
import { saveArbitrageSettings, saveByokLimit, deleteByokLimit } from '@/lib/arbitrage-actions';
import type { ArbitrageData, LiveProvider } from '@/lib/arbitrage';
import type { ArbitrageSettings } from '@llmgw/db/http';

function fmtCost(c: number): string {
  if (c <= 0) return '$0';
  if (c < 0.0001) return '<$0.0001';
  return '$' + c.toFixed(c < 0.01 ? 5 : c < 1 ? 3 : 2);
}
function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}
function fmtTpm(n: number | null): string {
  if (n == null) return '∞';
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
  return String(n);
}

export function ArbitrageView({ data }: { data: ArbitrageData }) {
  const router = useRouter();
  const [cfg, setCfg] = useState<ArbitrageSettings>(data.settings);
  const [pending, startSave] = useTransition();
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof ArbitrageSettings>(k: K, v: ArbitrageSettings[K]) => {
    setCfg((c) => ({ ...c, [k]: v }));
    setSaved(false);
  };
  function save() {
    startSave(async () => {
      const res = await saveArbitrageSettings(cfg);
      if (res.ok) {
        setSaved(true);
        router.refresh();
      }
    });
  }

  const throttled = (data.live ?? []).filter((p) => p.throttled).length;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card icon={<Gauge className="h-4 w-4" />} tone={throttled > 0 ? 'red' : 'emerald'} label="Throttled providers" value={String(throttled)} sub={`${(data.live ?? []).length} tracked`} />
        <Card icon={<ArrowDownLeft className="h-4 w-4" />} tone="blue" label="Borrowed" value={String(data.totals.borrowedCount)} sub={`${fmtCost(data.totals.spentUsd)} spent`} />
        <Card icon={<ArrowUpRight className="h-4 w-4" />} tone="violet" label="Lent" value={String(data.totals.lentCount)} sub={`${fmtCost(data.totals.earnedUsd)} earned`} />
        <Card icon={<Scale className="h-4 w-4" />} tone="amber" label="Margin earned" value={fmtCost(data.totals.marginEarnedUsd)} sub="from lending" />
      </div>

      {/* Pool config */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Capacity pool</h2>
            <p className="mt-1 max-w-2xl text-xs text-gray-500">
              Join the cross-tenant clearinghouse. <b>Contribute</b> lends your under-utilized BYOK throughput to other
              orgs; <b>consume</b> borrows their spare capacity when you&apos;re rate-limited. Every borrow is settled
              through a tenant-isolated ledger at cost + your margin.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{cfg.enabled ? 'On' : 'Off'}</span>
            <Toggle on={cfg.enabled} onChange={(v) => set('enabled', v)} />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Contribute capacity" hint="lend spare throughput">
            <div className="flex h-8 items-center gap-2">
              <Toggle on={cfg.contribute} onChange={(v) => set('contribute', v)} />
              <span className="text-xs text-gray-500">{cfg.contribute ? 'Lending' : 'Off'}</span>
            </div>
          </Field>
          <Field label="Consume capacity" hint="borrow when throttled">
            <div className="flex h-8 items-center gap-2">
              <Toggle on={cfg.consume} onChange={(v) => set('consume', v)} />
              <span className="text-xs text-gray-500">{cfg.consume ? 'Borrowing' : 'Off'}</span>
            </div>
          </Field>
          <Field label="Lending margin" hint="markup over provider cost">
            <div className="flex items-center gap-2">
              <input type="range" min={0} max={50} value={cfg.marginPct} onChange={(e) => set('marginPct', Number(e.target.value))} className="flex-1 accent-violet-600" />
              <span className="w-10 text-right text-sm tabular-nums text-gray-700">{cfg.marginPct}%</span>
            </div>
          </Field>
          <Field label="Max share (TPM)" hint="ceiling you'll lend">
            <input type="number" min={0} step={1000} value={cfg.maxShareTpm} onChange={(e) => set('maxShareTpm', Number(e.target.value))} className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-violet-500" />
          </Field>
        </div>
        <div className="mt-5">
          <SaveButton pending={pending} saved={saved} onClick={save} />
        </div>
      </div>

      {/* Rate-limit headroom */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Rate-limit headroom</h2>
            <p className="mt-0.5 text-xs text-gray-500">Live TPM/RPM per provider key (60s window). {data.connected ? '' : 'Gateway offline — showing config only.'}</p>
          </div>
        </div>
        {data.limits.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-500">No BYOK limits configured. Add one below to start tracking headroom + enable arbitrage.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.limits.map((l) => {
              const live = (data.live ?? []).find((p) => p.provider === l.provider);
              return <HeadroomRow key={l.provider} provider={l.provider} tier={l.tier} shareable={l.shareable} tpmLimit={l.tpmLimit} rpmLimit={l.rpmLimit} live={live ?? null} />;
            })}
          </div>
        )}
        <LimitForm />
      </div>

      {/* Loan ledger */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Settlement ledger</h2>
          <p className="mt-0.5 text-xs text-gray-500">Cross-tenant borrows, tenant-isolated. Borrower pays provider cost + margin; lender is reimbursed it.</p>
        </div>
        {data.loans.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-500">No capacity loans yet. When a throttled tenant borrows a lender&apos;s key, the settlement lands here.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="border-b border-gray-100 bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-5 py-2 font-medium">Dir</th>
                <th className="px-5 py-2 font-medium">Counterparty</th>
                <th className="px-5 py-2 font-medium">Provider</th>
                <th className="px-5 py-2 font-medium">Tokens</th>
                <th className="px-5 py-2 font-medium">Provider cost</th>
                <th className="px-5 py-2 font-medium">Transfer</th>
                <th className="px-5 py-2 font-medium">Margin</th>
                <th className="px-5 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.loans.map((l) => (
                <tr key={l.id}>
                  <td className="px-5 py-2">
                    {l.direction === 'borrowed' ? (
                      <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600"><ArrowDownLeft className="h-3 w-3" />borrow</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-600"><ArrowUpRight className="h-3 w-3" />lend</span>
                    )}
                  </td>
                  <td className="px-5 py-2 text-gray-600">{l.counterparty}</td>
                  <td className="px-5 py-2 font-mono text-gray-700">{l.provider}</td>
                  <td className="px-5 py-2 text-gray-500">{fmtInt(l.promptTokens + l.completionTokens)}</td>
                  <td className="px-5 py-2 text-gray-500">{fmtCost(l.providerCostUsd)}</td>
                  <td className="px-5 py-2 font-medium text-gray-800">{fmtCost(l.transferPriceUsd)}</td>
                  <td className={`px-5 py-2 font-medium ${l.direction === 'lent' ? 'text-emerald-600' : 'text-gray-400'}`}>{fmtCost(l.marginUsd)}</td>
                  <td className="px-5 py-2 text-gray-400">{l.createdAt.slice(0, 16).replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Spot board */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900"><Zap className="h-4 w-4 text-amber-500" /> Spot price board</h2>
          <p className="mt-0.5 text-xs text-gray-500">Live cheapest compute per provider (blended $/1M tokens). Background jobs route to the cheapest keyed pool.</p>
        </div>
        <div className="divide-y divide-gray-100">
          {data.spot.map((s, i) => (
            <div key={s.provider} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <span className="w-5 text-center text-[11px] text-gray-300">{i + 1}</span>
              <span className="w-28 shrink-0 font-medium text-gray-800">{s.name}</span>
              {s.keyed ? (
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600">keyed</span>
              ) : (
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">reference</span>
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-400">{s.cheapestModel ?? s.note ?? ''}</span>
              {s.latencyMs != null ? <span className="text-[11px] text-gray-400">{s.latencyMs}ms p50</span> : null}
              <span className="w-24 text-right font-mono text-xs text-gray-700">${s.blendedPerM.toFixed(3)}/M</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HeadroomRow({
  provider,
  tier,
  shareable,
  tpmLimit,
  rpmLimit,
  live,
}: {
  provider: string;
  tier: string | null;
  shareable: boolean;
  tpmLimit: number;
  rpmLimit: number;
  live: LiveProvider | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const pct = live?.utilizationPct ?? 0;
  const barTone = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-gray-800">{provider}</span>
          {tier ? <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{tier}</span> : null}
          {shareable ? <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-600">shareable</span> : null}
          {live?.throttled ? <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600">throttled</span> : null}
        </div>
        <button
          onClick={async () => {
            setBusy(true);
            await deleteByokLimit(provider);
            setBusy(false);
            router.refresh();
          }}
          disabled={busy}
          className="text-gray-300 hover:text-red-500 disabled:opacity-50"
          title="Remove limit"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
          <div className={`h-full rounded-full ${barTone}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <span className="w-40 shrink-0 text-right text-[11px] text-gray-500">
          {fmtInt(live?.tpmUsed ?? 0)} / {tpmLimit > 0 ? fmtTpm(tpmLimit) : '∞'} TPM · {live?.rpmUsed ?? 0}/{rpmLimit > 0 ? rpmLimit : '∞'} RPM
        </span>
      </div>
    </div>
  );
}

function LimitForm() {
  const router = useRouter();
  const [provider, setProvider] = useState('');
  const [tpm, setTpm] = useState('');
  const [rpm, setRpm] = useState('');
  const [shareable, setShareable] = useState(false);
  const [tier, setTier] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!provider.trim()) return;
    setBusy(true);
    await saveByokLimit({ provider, tpmLimit: Number(tpm) || 0, rpmLimit: Number(rpm) || 0, shareable, tier: tier || null });
    setBusy(false);
    setProvider('');
    setTpm('');
    setRpm('');
    setTier('');
    setShareable(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 bg-gray-50/50 px-5 py-3">
      <label className="text-[11px] text-gray-500">
        Provider
        <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="openai" className="mt-0.5 block w-28 rounded border border-gray-300 px-2 py-1 text-xs outline-none focus:border-violet-500" />
      </label>
      <label className="text-[11px] text-gray-500">
        TPM limit
        <input type="number" value={tpm} onChange={(e) => setTpm(e.target.value)} placeholder="30000" className="mt-0.5 block w-24 rounded border border-gray-300 px-2 py-1 text-xs outline-none focus:border-violet-500" />
      </label>
      <label className="text-[11px] text-gray-500">
        RPM limit
        <input type="number" value={rpm} onChange={(e) => setRpm(e.target.value)} placeholder="500" className="mt-0.5 block w-20 rounded border border-gray-300 px-2 py-1 text-xs outline-none focus:border-violet-500" />
      </label>
      <label className="text-[11px] text-gray-500">
        Tier
        <input value={tier} onChange={(e) => setTier(e.target.value)} placeholder="Tier 2" className="mt-0.5 block w-20 rounded border border-gray-300 px-2 py-1 text-xs outline-none focus:border-violet-500" />
      </label>
      <label className="flex items-center gap-1.5 pb-1.5 text-[11px] text-gray-600">
        <input type="checkbox" checked={shareable} onChange={(e) => setShareable(e.target.checked)} className="accent-violet-600" /> shareable
      </label>
      <button onClick={add} disabled={busy || !provider.trim()} className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">
        <Plus className="h-3.5 w-3.5" /> Add limit
      </button>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        {hint ? <span className="text-[10px] text-gray-400">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Card({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone: 'violet' | 'red' | 'emerald' | 'blue' | 'amber' }) {
  const tones: Record<string, string> = {
    violet: 'bg-violet-50 text-violet-600',
    red: 'bg-red-50 text-red-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
  };
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className={`grid h-8 w-8 place-items-center rounded-lg ${tones[tone]}`}>{icon}</div>
      <div className="mt-3 text-2xl font-semibold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-gray-400">{sub}</div> : null}
    </div>
  );
}
