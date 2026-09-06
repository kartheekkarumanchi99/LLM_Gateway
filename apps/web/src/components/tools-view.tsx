'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ServerToolMeta, ToolsConfig } from '@llmgw/db/http';
import { saveToolsConfig } from '@/lib/settings-actions';
import { SaveButton, Toggle } from '@/components/toggle';

export function ToolsView({
  serverTools,
  initial,
  connected,
}: {
  serverTools: ServerToolMeta[];
  initial: ToolsConfig;
  connected: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'server' | 'plugins'>('server');
  const [disallowed, setDisallowed] = useState<Set<string>>(new Set(initial.disallowed));
  const [responseHealing, setResponseHealing] = useState(initial.plugins.responseHealing);
  const [paretoRouter, setParetoRouter] = useState(initial.plugins.paretoRouter);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  const groups = useMemo(() => {
    const g: Record<string, ServerToolMeta[]> = {};
    for (const t of serverTools) (g[t.group] ??= []).push(t);
    return g;
  }, [serverTools]);

  function toggleTool(id: string, allowed: boolean) {
    setDisallowed((prev) => {
      const next = new Set(prev);
      if (allowed) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save() {
    start(async () => {
      await saveToolsConfig({
        disallowed: [...disallowed],
        plugins: { responseHealing, paretoRouter },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Tools</h1>
          <p className="mt-1 text-sm text-gray-500">Configure server tools and plugins for this workspace.</p>
        </div>
        <SaveButton pending={pending} saved={saved} onClick={save} disabled={!connected} />
      </div>

      {!connected ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code> and run{' '}
          <code className="font-mono">pnpm db:push</code>.
        </div>
      ) : null}

      <div className="mt-6 flex gap-6 border-b border-gray-200 text-sm">
        <button
          onClick={() => setTab('server')}
          className={`-mb-px border-b-2 pb-2 ${tab === 'server' ? 'border-violet-600 font-medium text-violet-700' : 'border-transparent text-gray-500'}`}
        >
          Server Tools
        </button>
        <button
          onClick={() => setTab('plugins')}
          className={`-mb-px border-b-2 pb-2 ${tab === 'plugins' ? 'border-violet-600 font-medium text-violet-700' : 'border-transparent text-gray-500'}`}
        >
          Plugins
        </button>
      </div>

      {tab === 'server' ? (
        <div className="mt-6 space-y-8">
          <p className="text-sm text-gray-500">
            Control which server tools requests may use. Disallowing a tool rejects any request that asks for
            it with a <code className="font-mono">403</code>.
          </p>
          {Object.entries(groups).map(([group, tools]) => (
            <section key={group}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{group}</div>
              <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
                {tools.map((t) => (
                  <div key={t.id} className="flex items-center justify-between px-5 py-4">
                    <div>
                      <div className="font-medium text-gray-900">{t.label}</div>
                      <div className="text-sm text-gray-500">{t.description}</div>
                      <div className="mt-0.5 font-mono text-xs text-gray-400">openrouter:{t.id}</div>
                    </div>
                    <Toggle on={!disallowed.has(t.id)} onChange={(allowed) => toggleTool(t.id, allowed)} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          <p className="text-sm text-gray-500">Set default plugin behavior for your API requests.</p>
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <div className="font-medium text-gray-900">Response Healing</div>
                <div className="text-sm text-gray-500">Automatically fix malformed JSON responses from LLMs.</div>
              </div>
              <Toggle on={responseHealing} onChange={setResponseHealing} />
            </div>
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <div className="font-medium text-gray-900">Pareto Router</div>
                <div className="text-sm text-gray-500">Use the Pareto cost/quality router for coding tasks.</div>
              </div>
              <Toggle on={paretoRouter} onChange={setParetoRouter} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
