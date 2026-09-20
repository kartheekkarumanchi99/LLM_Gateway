'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Database, Layers, Percent, Sparkles, Users, Zap } from 'lucide-react';
import { Toggle, SaveButton } from '@/components/toggle';
import { saveDedupConfig } from '@/lib/dedup-actions';
import type { CacheData } from '@/lib/dedup';
import type { DedupConfig } from '@llmgw/db/http';

function fmtCost(c: number): string {
  if (c <= 0) return '$0';
  if (c < 0.0001) return '<$0.0001';
  return '$' + c.toFixed(c < 0.01 ? 5 : c < 1 ? 3 : 2);
}
function day(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ') + ' UTC';
}

export function CacheView({ data }: { data: CacheData }) {
  const router = useRouter();
  const [cfg, setCfg] = useState<DedupConfig>(data.config);
  const [pending, startSave] = useTransition();
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof DedupConfig>(k: K, v: DedupConfig[K]) => {
    setCfg((c) => ({ ...c, [k]: v }));
    setSaved(false);
  };

  function save() {
    startSave(async () => {
      const res = await saveDedupConfig(cfg);
      if (res.ok) {
        setSaved(true);
        router.refresh();
      }
    });
  }

  const s = data.summary;
  const maxSaved = Math.max(1e-9, ...data.daily.map((d) => d.savedUsd));

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card icon={<Zap className="h-4 w-4" />} tone="violet" label="Cache hits" value={String(s.hits)} sub={`${s.exactHits} exact · ${s.semanticHits} semantic`} />
        <Card icon={<Sparkles className="h-4 w-4" />} tone="emerald" label="Saved" value={fmtCost(s.savedUsd)} sub="tokens eliminated" />
        <Card icon={<Users className="h-4 w-4" />} tone="blue" label="Cross-workspace hits" value={String(s.crossWorkspaceHits)} sub="reused across the org" />
        <Card icon={<Percent className="h-4 w-4" />} tone="amber" label="Hit rate" value={`${s.hitRatePct.toFixed(1)}%`} sub={`avg sim ${(s.avgSimilarity * 100).toFixed(1)}%`} />
      </div>

      {/* Config */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Dedup cache</h2>
            <p className="mt-1 max-w-2xl text-xs text-gray-500">
              Layer 1 is an exact SHA-256 prompt match (always on, free). Layer 2 embeds the prompt and finds the
              nearest prior completion via a pgvector HNSW index — a hit ≥ {(cfg.similarityThreshold * 100).toFixed(0)}%
              cosine within {cfg.ttlHours}h returns instantly at zero tokens. Contribute/consume across the org is opt-in.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Semantic {cfg.enabled ? 'on' : 'off'}</span>
            <Toggle on={cfg.enabled} onChange={(v) => set('enabled', v)} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Use org cache" hint="accept other workspaces' hits">
            <div className="flex h-8 items-center gap-2">
              <Toggle on={cfg.crossWorkspace} onChange={(v) => set('crossWorkspace', v)} />
              <span className="text-xs text-gray-500">{cfg.crossWorkspace ? 'Cross-workspace' : 'This workspace only'}</span>
            </div>
          </Field>
          <Field label="Contribute to org" hint="share this workspace's answers">
            <div className="flex h-8 items-center gap-2">
              <Toggle on={cfg.contribute} onChange={(v) => set('contribute', v)} />
              <span className="text-xs text-gray-500">{cfg.contribute ? 'Sharing' : 'Private'}</span>
            </div>
          </Field>
          <Field label="Min prompt length" hint="skip trivially short prompts">
            <input
              type="number"
              min={0}
              max={4000}
              value={cfg.minChars}
              onChange={(e) => set('minChars', Number(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-violet-500"
            />
          </Field>
          <Field label="Similarity threshold" hint="cosine for a semantic hit">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={90}
                max={99}
                value={Math.round(cfg.similarityThreshold * 100)}
                onChange={(e) => set('similarityThreshold', Number(e.target.value) / 100)}
                className="flex-1 accent-violet-600"
              />
              <span className="w-12 text-right text-sm tabular-nums text-gray-700">{(cfg.similarityThreshold * 100).toFixed(0)}%</span>
            </div>
          </Field>
          <Field label="Freshness window" hint="reuse answers newer than">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={168}
                value={cfg.ttlHours}
                onChange={(e) => set('ttlHours', Number(e.target.value))}
                className="flex-1 accent-violet-600"
              />
              <span className="w-12 text-right text-sm tabular-nums text-gray-700">{cfg.ttlHours}h</span>
            </div>
          </Field>
          <Field label="Cache pool" hint="entries for this org">
            <div className="flex h-8 items-center text-sm text-gray-700">
              {s.entries} entries · <span className="ml-1 text-emerald-600">{s.sharedEntries} shared</span>
            </div>
          </Field>
        </div>

        <div className="mt-5">
          <SaveButton pending={pending} saved={saved} onClick={save} />
        </div>
      </div>

      {/* Savings over time */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">Savings over time</h2>
        {data.daily.length === 0 ? (
          <p className="mt-6 text-center text-sm text-gray-500">No cache hits yet in this window.</p>
        ) : (
          <div className="mt-4 flex h-32 items-end gap-1">
            {data.daily.map((d) => (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${fmtCost(d.savedUsd)} (${d.hits} hits)`}>
                <div className="flex w-full items-end justify-center" style={{ height: '100%' }}>
                  <div
                    className="w-full rounded-t bg-emerald-400"
                    style={{ height: `${Math.max(3, (d.savedUsd / maxSaved) * 100)}%` }}
                  />
                </div>
                <span className="text-[9px] text-gray-400">{d.day.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent hits */}
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Recent cache hits</h2>
          </div>
          {data.recent.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-500">No hits yet. Enable the cache and repeat a prompt.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.recent.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-2.5">
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${r.kind === 'semantic' ? 'bg-violet-50 text-violet-600' : 'bg-blue-50 text-blue-600'}`}>
                    {r.kind === 'semantic' ? <Sparkles className="h-3.5 w-3.5" /> : <Database className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gray-700">{r.model}</span>
                      {r.crossWorkspace ? (
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">cross-ws</span>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-gray-400">
                      {r.kind} · {(r.similarity * 100).toFixed(1)}% · {day(r.createdAt)}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-emerald-600">{fmtCost(r.savedUsd)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Top models */}
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Top cached models</h2>
          </div>
          {data.topModels.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-500">No data yet.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.topModels.map((t) => (
                <li key={t.model} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-gray-300" />
                    <span className="font-mono text-xs text-gray-700">{t.model}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-gray-400">{t.hits} hits</span>
                    <span className="w-16 text-right font-medium text-emerald-600">{fmtCost(t.savedUsd)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
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
  tone: 'violet' | 'emerald' | 'blue' | 'amber';
}) {
  const tones: Record<string, string> = {
    violet: 'bg-violet-50 text-violet-600',
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
