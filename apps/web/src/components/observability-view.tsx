'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Settings2, Trash2, X } from 'lucide-react';
import type { ObsDestinationType, ObservabilityConfig } from '@llmgw/db/http';
import type { DestinationRow } from '@/lib/observability';
import {
  deleteDestination,
  saveDestination,
  saveObservabilityConfig,
  type DestinationInput,
} from '@/lib/observability-actions';
import { Toggle } from '@/components/toggle';

interface Editing {
  id?: string;
  type: string;
  typeLabel: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  headers: string;
  samplingRate: string;
  privacyMode: boolean;
  region: string;
  enabled: boolean;
  hasKey: boolean;
}

export function ObservabilityView({
  initialConfig,
  destinations,
  catalog,
  connected,
}: {
  initialConfig: ObservabilityConfig;
  destinations: DestinationRow[];
  catalog: ObsDestinationType[];
  connected: boolean;
}) {
  const router = useRouter();
  const [config, setConfig] = useState<ObservabilityConfig>(initialConfig);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  function setFlag(key: keyof ObservabilityConfig, val: boolean) {
    const next = { ...config, [key]: val };
    setConfig(next);
    start(async () => {
      await saveObservabilityConfig(next);
      router.refresh();
    });
  }

  function openNew(t: ObsDestinationType) {
    setError(null);
    setEditing({
      type: t.id,
      typeLabel: t.label,
      name: t.label,
      baseUrl: t.defaultBaseUrl ?? '',
      apiKey: '',
      headers: '',
      samplingRate: '1',
      privacyMode: false,
      region: 'global',
      enabled: true,
      hasKey: false,
    });
  }

  function openEdit(d: DestinationRow) {
    setError(null);
    setEditing({
      id: d.id,
      type: d.type,
      typeLabel: catalog.find((c) => c.id === d.type)?.label ?? d.type,
      name: d.name,
      baseUrl: d.baseUrl ?? '',
      apiKey: '',
      headers: d.headers ? JSON.stringify(d.headers, null, 2) : '',
      samplingRate: d.samplingRate,
      privacyMode: d.privacyMode,
      region: d.region,
      enabled: d.enabled,
      hasKey: d.hasKey,
    });
  }

  function saveEditing() {
    if (!editing) return;
    setError(null);
    let headers: Record<string, string> | null = null;
    if (editing.headers.trim()) {
      try {
        headers = JSON.parse(editing.headers) as Record<string, string>;
      } catch {
        setError('Headers must be valid JSON.');
        return;
      }
    }
    const input: DestinationInput = {
      id: editing.id,
      type: editing.type,
      name: editing.name,
      baseUrl: editing.baseUrl,
      apiKey: editing.apiKey || undefined,
      headers,
      samplingRate: Number(editing.samplingRate) || 1,
      privacyMode: editing.privacyMode,
      region: editing.region,
      enabled: editing.enabled,
    };
    start(async () => {
      const res = await saveDestination(input);
      if (!res.ok) {
        setError(res.error ?? 'Failed to save.');
        return;
      }
      setEditing(null);
      router.refresh();
    });
  }

  function onDelete(d: DestinationRow) {
    if (!window.confirm(`Delete destination "${d.name}"?`)) return;
    start(async () => {
      await deleteDestination(d.id);
      router.refresh();
    });
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Observability</h1>

      {!connected ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code> and run{' '}
          <code className="font-mono">pnpm db:push</code>.
        </div>
      ) : null}

      <div className="mt-6 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <div className="font-medium text-gray-900">
              Input &amp; Output Logging <span className="text-xs font-medium text-blue-600">Beta</span>
            </div>
            <div className="text-sm text-gray-500">
              Store prompts and completions in your logs for debugging and evaluation.
            </div>
          </div>
          <Toggle on={config.inputOutputLogging} onChange={(v) => setFlag('inputOutputLogging', v)} disabled={!connected} />
        </div>
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <div className="font-medium text-gray-900">Broadcast</div>
            <div className="text-sm text-gray-500">
              Automatically send traces from your requests to external observability platforms.
            </div>
          </div>
          <Toggle on={config.broadcast} onChange={(v) => setFlag('broadcast', v)} disabled={!connected} />
        </div>
      </div>

      {destinations.length > 0 ? (
        <section className="mt-8">
          <div className="mb-2 text-sm font-semibold text-gray-900">Configured</div>
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {destinations.map((d) => (
              <div key={d.id} className="flex items-center justify-between px-5 py-4">
                <div>
                  <div className="flex items-center gap-2 font-medium text-gray-900">
                    {d.name}
                    {!d.enabled ? (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                        Disabled
                      </span>
                    ) : null}
                  </div>
                  <div className="text-sm text-gray-500">
                    {catalog.find((c) => c.id === d.type)?.label ?? d.type} · sampling{' '}
                    {Math.round(Number(d.samplingRate) * 100)}%{d.privacyMode ? ' · privacy' : ''}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEdit(d)}
                    className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    aria-label="Edit"
                  >
                    <Settings2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => onDelete(d)}
                    className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <div className="mb-2 text-sm font-semibold text-gray-900">Available</div>
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {catalog.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <div className="font-medium text-gray-900">{t.label}</div>
                <div className="text-sm text-gray-500">{t.description}</div>
              </div>
              <button
                onClick={() => openNew(t)}
                disabled={!connected}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Add Destination <Plus className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {editing ? (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/30 p-4" onClick={() => setEditing(null)}>
          <div
            className="my-8 w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                {editing.id ? 'Edit' : 'New'} {editing.typeLabel} Destination
              </h2>
              <button onClick={() => setEditing(null)} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <L label="Name">
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={ic} />
              </L>
              <L label="Base URL">
                <input value={editing.baseUrl} onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} placeholder="https://otlp.example.com" className={`${ic} font-mono`} />
              </L>
              <L label={`API Key${editing.hasKey ? ' (leave blank to keep)' : ''}`}>
                <input type="password" value={editing.apiKey} onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })} autoComplete="off" className={`${ic} font-mono`} />
              </L>
              <L label="Headers (JSON, optional)">
                <textarea value={editing.headers} onChange={(e) => setEditing({ ...editing, headers: e.target.value })} rows={2} placeholder='{"x-custom": "value"}' className={`${ic} font-mono`} />
              </L>
              <div className="grid grid-cols-2 gap-3">
                <L label="Sampling rate (0–1)">
                  <input value={editing.samplingRate} onChange={(e) => setEditing({ ...editing, samplingRate: e.target.value })} inputMode="decimal" className={ic} />
                </L>
                <L label="Region">
                  <select value={editing.region} onChange={(e) => setEditing({ ...editing, region: e.target.value })} className={ic}>
                    <option value="global">Global</option>
                    <option value="eu">European Union</option>
                    <option value="us">United States</option>
                  </select>
                </L>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <Toggle on={editing.privacyMode} onChange={(v) => setEditing({ ...editing, privacyMode: v })} /> Privacy mode (exclude prompt &amp; completion)
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <Toggle on={editing.enabled} onChange={(v) => setEditing({ ...editing, enabled: v })} /> Enabled
              </label>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-lg border border-gray-300 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={saveEditing} className="rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-700">
                Add
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const ic =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100';

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {children}
    </div>
  );
}
