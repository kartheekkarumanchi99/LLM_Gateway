'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Play, Radar, ShieldAlert, TrendingDown, Waypoints } from 'lucide-react';
import { Toggle, SaveButton } from '@/components/toggle';
import { saveSentinelConfig, triggerSentinelRun } from '@/lib/sentinel-actions';
import type { SentinelData, ModelDriftRow } from '@/lib/sentinel';
import type { SentinelConfig } from '@llmgw/db/http';

function fmtCost(c: number): string {
  if (c <= 0) return '$0';
  if (c < 0.0001) return '<$0.0001';
  return '$' + c.toFixed(c < 0.01 ? 5 : 3);
}
function day(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') + ' UTC' : '—';
}

const STATUS_STYLE: Record<string, { badge: string; label: string }> = {
  establishing: { badge: 'bg-gray-100 text-gray-600', label: 'Establishing' },
  healthy: { badge: 'bg-emerald-50 text-emerald-600', label: 'Healthy' },
  watching: { badge: 'bg-amber-50 text-amber-600', label: 'Watching' },
  drifted: { badge: 'bg-red-50 text-red-600', label: 'Drifted' },
};

function kindStyle(kind: string): string {
  if (kind === 'recovered') return 'bg-emerald-50 text-emerald-600';
  if (kind === 'length_inflation') return 'bg-amber-50 text-amber-600';
  return 'bg-red-50 text-red-600';
}

export function SentinelView({ data }: { data: SentinelData }) {
  const router = useRouter();
  const [cfg, setCfg] = useState<SentinelConfig>(data.config);
  const [pending, startSave] = useTransition();
  const [saved, setSaved] = useState(false);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  const set = <K extends keyof SentinelConfig>(k: K, v: SentinelConfig[K]) => {
    setCfg((c) => ({ ...c, [k]: v }));
    setSaved(false);
  };

  function save() {
    startSave(async () => {
      const res = await saveSentinelConfig(cfg);
      if (res.ok) {
        setSaved(true);
        router.refresh();
      }
    });
  }

  async function runNow() {
    setRunning(true);
    setRunMsg(null);
    const res = await triggerSentinelRun();
    setRunning(false);
    setRunMsg(res.ok ? `Processed ${res.processed ?? 0} sample(s).` : res.error ?? 'Failed.');
    if (res.ok) router.refresh();
  }

  const watched = data.models.length;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card icon={<Waypoints className="h-4 w-4" />} label="Models watched" value={String(watched)} tone="violet" />
        <Card
          icon={<ShieldAlert className="h-4 w-4" />}
          label="Drifted now"
          value={String(data.drifted)}
          tone={data.drifted > 0 ? 'red' : 'emerald'}
        />
        <Card
          icon={<Radar className="h-4 w-4" />}
          label="Shadow evals"
          value={String(data.totalEvals)}
          sub={`${data.counts.pending} pending`}
          tone="blue"
        />
        <Card icon={<TrendingDown className="h-4 w-4" />} label="Shadow spend" value={fmtCost(data.shadowCostUsd)} tone="amber" />
      </div>

      {/* Worker status line */}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className={`inline-block h-2 w-2 rounded-full ${data.connected ? 'bg-emerald-500' : 'bg-gray-300'}`} />
        {data.connected && data.worker ? (
          <span>
            Background worker connected · {data.worker.totalEvaluated} evaluated, {data.worker.totalErrors} errors
            {data.worker.lastRunAt ? ` · last tick ${day(new Date(data.worker.lastRunAt).toISOString())}` : ''}
          </span>
        ) : (
          <span>Background worker not reachable (gateway offline?). Detection state below is from the database.</span>
        )}
      </div>

      {/* Config */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Shadow sampling</h2>
            <p className="mt-1 max-w-2xl text-xs text-gray-500">
              A scrubbed copy of {cfg.sampleRatePct}% of served requests is re-run through candidate models in the
              background, judged against the answer production actually returned, and compared to each model&apos;s
              established baseline. A ≥{cfg.qualityDropPct}% quality drop or ≥{cfg.lengthInflationPct}% length inflation
              trips drift{cfg.autoReweight ? ' and automatically lowers the model’s routing weight' : ' (observe-only)'}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{cfg.enabled ? 'On' : 'Off'}</span>
            <Toggle on={cfg.enabled} onChange={(v) => set('enabled', v)} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Sample rate" hint="% of served requests shadowed">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                value={cfg.sampleRatePct}
                onChange={(e) => set('sampleRatePct', Number(e.target.value))}
                className="flex-1 accent-violet-600"
              />
              <span className="w-10 text-right text-sm tabular-nums text-gray-700">{cfg.sampleRatePct}%</span>
            </div>
          </Field>
          <Field label="Candidates / sample" hint="models evaluated per sample">
            <input
              type="number"
              min={1}
              max={4}
              value={cfg.fanout}
              onChange={(e) => set('fanout', Number(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-violet-500"
            />
          </Field>
          <Field label="Judge model" hint="blank = cheapest runnable">
            <input
              type="text"
              value={cfg.judgeModel ?? ''}
              placeholder="auto (cheapest)"
              onChange={(e) => set('judgeModel', e.target.value.trim() || null)}
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-violet-500"
            />
          </Field>
          <Field label="Quality-drop threshold" hint="% below baseline = drift">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={20}
                value={cfg.qualityDropPct}
                onChange={(e) => set('qualityDropPct', Number(e.target.value))}
                className="flex-1 accent-violet-600"
              />
              <span className="w-10 text-right text-sm tabular-nums text-gray-700">{cfg.qualityDropPct}%</span>
            </div>
          </Field>
          <Field label="Length-inflation threshold" hint="% longer than baseline = drift">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={5}
                max={100}
                value={cfg.lengthInflationPct}
                onChange={(e) => set('lengthInflationPct', Number(e.target.value))}
                className="flex-1 accent-violet-600"
              />
              <span className="w-10 text-right text-sm tabular-nums text-gray-700">{cfg.lengthInflationPct}%</span>
            </div>
          </Field>
          <Field label="Auto re-weight routing" hint="apply the penalty live">
            <div className="flex h-8 items-center">
              <Toggle on={cfg.autoReweight} onChange={(v) => set('autoReweight', v)} />
              <span className="ml-2 text-xs text-gray-500">{cfg.autoReweight ? 'Self-healing' : 'Detect only'}</span>
            </div>
          </Field>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <SaveButton pending={pending} saved={saved} onClick={save} />
          <button
            onClick={runNow}
            disabled={running}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <Play className="h-4 w-4" />
            {running ? 'Running…' : 'Evaluate pending now'}
          </button>
          {runMsg ? <span className="text-xs text-gray-500">{runMsg}</span> : null}
        </div>
      </div>

      {/* Model health */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Model drift monitor</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Baseline vs. recent shadow behavior per model + task. Routing weight &lt; 1.00 means the router is actively
            shedding traffic away from this checkpoint.
          </p>
        </div>
        {data.models.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-500">
            No baselines yet. Enable shadow sampling, send some traffic, then evaluate — baselines establish after a
            handful of samples.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.models.map((m) => (
              <ModelRow key={`${m.modelSlug}:${m.taskClass}`} m={m} />
            ))}
          </div>
        )}
      </div>

      {/* Drift events */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Drift &amp; recovery log</h2>
          <p className="mt-0.5 text-xs text-gray-500">Every detection and automatic re-weight, plus recoveries.</p>
        </div>
        {data.events.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-500">
            No drift detected. When a vendor silently ships a worse checkpoint, it lands here.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.events.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-5 py-3">
                <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${kindStyle(e.kind)}`}>
                  {e.kind === 'recovered' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-gray-800">{e.modelSlug}</span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{e.taskClass}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${kindStyle(e.kind)}`}>{e.kind.replace('_', ' ')}</span>
                    {e.resolvedAt ? (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600">resolved</span>
                    ) : null}
                  </div>
                  {e.detail ? <p className="mt-0.5 text-xs text-gray-600">{e.detail}</p> : null}
                </div>
                <span className="shrink-0 text-[11px] text-gray-400">{day(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ModelRow({ m }: { m: ModelDriftRow }) {
  const s = STATUS_STYLE[m.status] ?? STATUS_STYLE.establishing!;
  const weightPct = Math.round(m.healthMultiplier * 100);
  return (
    <div className="px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-gray-800">{m.modelSlug}</span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{m.taskClass}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${s.badge}`}>{s.label}</span>
        </div>
        <div className="text-xs text-gray-400">{m.sampleCount} baseline · {m.recentSamples} recent</div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-4">
        <Metric label="Baseline quality" value={m.baselineQuality.toFixed(1)} />
        <Metric
          label="Recent quality"
          value={m.recentQuality.toFixed(1)}
          tone={m.qualityDropPct >= 3 ? 'red' : m.qualityDropPct > 1 ? 'amber' : 'default'}
          delta={m.qualityDropPct > 0 ? `-${m.qualityDropPct.toFixed(1)}%` : null}
        />
        <Metric
          label="Length ratio"
          value={`${m.baselineLengthRatio.toFixed(2)}× → ${m.recentLengthRatio.toFixed(2)}×`}
          tone={m.lengthInflationPct >= 15 ? 'red' : m.lengthInflationPct > 5 ? 'amber' : 'default'}
          delta={m.lengthInflationPct > 0 ? `+${m.lengthInflationPct.toFixed(0)}%` : null}
        />
        <div>
          <div className="text-gray-400">Routing weight</div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full ${weightPct >= 100 ? 'bg-emerald-500' : weightPct >= 70 ? 'bg-amber-500' : 'bg-red-500'}`}
                style={{ width: `${weightPct}%` }}
              />
            </div>
            <span className="w-9 text-right tabular-nums text-gray-700">{m.healthMultiplier.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'default',
  delta,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'amber' | 'red';
  delta?: string | null;
}) {
  const color = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-gray-800';
  return (
    <div>
      <div className="text-gray-400">{label}</div>
      <div className={`mt-1 font-medium ${color}`}>
        {value}
        {delta ? <span className="ml-1 text-[10px]">{delta}</span> : null}
      </div>
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

function Card({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone: 'violet' | 'red' | 'emerald' | 'blue' | 'amber';
}) {
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
