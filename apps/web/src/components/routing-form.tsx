'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CostTier, ProviderSort, RoutingConfig } from '@llmgw/db/http';
import { saveRoutingConfig } from '@/lib/settings-actions';
import { SaveButton, Toggle } from '@/components/toggle';

function parseList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function RoutingForm({ initial, connected }: { initial: RoutingConfig; connected: boolean }) {
  const router = useRouter();
  const [costTier, setCostTier] = useState<CostTier>(initial.autoCostTier);
  const [allowed, setAllowed] = useState(initial.autoAllowedModels.join(', '));
  const [prevent, setPrevent] = useState(initial.autoPreventOverrides);
  const [sort, setSort] = useState<ProviderSort>(initial.defaultProviderSort);
  const [defaultModel, setDefaultModel] = useState(initial.defaultModel ?? '');
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  function save() {
    start(async () => {
      await saveRoutingConfig({
        autoCostTier: costTier,
        autoAllowedModels: parseList(allowed),
        autoPreventOverrides: prevent,
        defaultProviderSort: sort,
        defaultModel: defaultModel.trim() || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    });
  }

  return (
    <div className="space-y-10">
      <section className="grid grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
        <div>
          <div className="flex items-center gap-2 font-medium text-gray-900">Auto Router</div>
          <p className="mt-1 text-sm text-gray-500">Configure which models the Auto Router can route to.</p>
        </div>
        <div className="space-y-5">
          <p className="text-sm text-gray-500">
            Route to the best model for each request using <code className="font-mono">auto</code> /{' '}
            <code className="font-mono">openrouter/auto</code>.
          </p>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Cost Tier</label>
            <select
              value={costTier}
              onChange={(e) => setCostTier(e.target.value as CostTier)}
              className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500"
            >
              <option value="low">Low (Default)</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="xhigh">Extra High</option>
              <option value="max">Max</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Lower tiers favor cheaper models; higher tiers favor more capable, expensive ones.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Restrict to Allowed Model List</label>
            <textarea
              value={allowed}
              onChange={(e) => setAllowed(e.target.value)}
              rows={4}
              placeholder="anthropic/*, openai/gpt-4o, google/*"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-violet-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Comma- or newline-separated patterns; wildcards like <code className="font-mono">anthropic/*</code>{' '}
              match a family. Empty = the auto-router chooses from every model it ranks.
            </p>
          </div>
          <label className="flex items-center gap-3">
            <Toggle on={prevent} onChange={setPrevent} />
            <span className="text-sm text-gray-700">Prevent overrides (lock the cost tier for all requests)</span>
          </label>
          <div className="flex justify-end">
            <SaveButton pending={pending} saved={saved} onClick={save} disabled={!connected} />
          </div>
        </div>
      </section>

      <div className="border-t border-gray-200" />

      <section className="grid grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
        <div>
          <div className="font-medium text-gray-900">Default Provider Sort</div>
          <p className="mt-1 text-sm text-gray-500">How providers are sorted. Requests can override this.</p>
        </div>
        <div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as ProviderSort)}
            className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500"
          >
            <option value="balanced">Default (balanced)</option>
            <option value="price">Price</option>
            <option value="throughput">Throughput</option>
            <option value="latency">Latency</option>
          </select>
        </div>
      </section>

      <div className="border-t border-gray-200" />

      <section className="grid grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
        <div>
          <div className="font-medium text-gray-900">Default Model</div>
          <p className="mt-1 text-sm text-gray-500">Default and fallback model for apps.</p>
        </div>
        <div>
          <input
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder="No default (e.g. openai/gpt-4o-mini)"
            className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-violet-500"
          />
        </div>
      </section>
    </div>
  );
}
