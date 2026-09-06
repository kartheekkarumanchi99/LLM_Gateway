'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import type { BudgetPolicy, ModelAccessPolicy, PolicyMode } from '@llmgw/db/http';
import {
  updateBudgetPolicy,
  updateContentPolicy,
  updateModelAccessPolicy,
} from '@/lib/guardrail-actions';

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? 'bg-violet-600' : 'bg-gray-300'}`}
      aria-pressed={on}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-4' : 'left-0.5'}`}
      />
    </button>
  );
}

function SaveButton({ pending, saved, onClick }: { pending: boolean; saved: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
    >
      {saved ? <Check className="h-4 w-4" /> : null}
      {pending ? 'Saving…' : saved ? 'Saved' : 'Save'}
    </button>
  );
}

export function BudgetForm({ id, budget }: { id: string; budget?: BudgetPolicy }) {
  const router = useRouter();
  const [limit, setLimit] = useState(budget?.limitUsd != null ? String(budget.limitUsd) : '');
  const [interval, setInterval] = useState<BudgetPolicy['interval']>(budget?.interval ?? 'month');
  const [includeByok, setIncludeByok] = useState(budget?.includeByok ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  function save() {
    setError(null);
    const n = limit.trim() === '' ? null : Number(limit);
    if (n != null && (!Number.isFinite(n) || n < 0)) {
      setError('Enter a positive number, or leave blank for no limit.');
      return;
    }
    start(async () => {
      await updateBudgetPolicy(id, { limitUsd: n, interval, includeByok });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-sm font-semibold text-gray-900">Credit limit</div>
        <div className="flex items-center gap-3">
          <div className="flex flex-1 items-center rounded-lg border border-gray-300 px-3 py-2">
            <span className="mr-1 text-gray-400">$</span>
            <input
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              inputMode="decimal"
              placeholder="No limit"
              className="w-full text-sm outline-none"
            />
          </div>
          <span className="text-sm text-gray-500">every</span>
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value as BudgetPolicy['interval'])}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none"
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="total">Total</option>
          </select>
        </div>
        <p className="mt-2 text-sm text-gray-500">
          Leave blank for no limit. This budget applies individually to each key assigned to the guardrail.
        </p>
      </div>

      <label className="flex items-center gap-3">
        <Toggle on={includeByok} onChange={setIncludeByok} />
        <span className="text-sm text-gray-700">Include BYOK spend in this budget</span>
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex justify-end">
        <SaveButton pending={pending} saved={saved} onClick={save} />
      </div>
    </div>
  );
}

export function ModelAccessForm({ id, value }: { id: string; value: ModelAccessPolicy }) {
  const router = useRouter();
  const [v, setV] = useState<ModelAccessPolicy>(value);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  function patch(next: Partial<ModelAccessPolicy>) {
    setV((prev) => ({ ...prev, ...next }));
  }
  function listToText(list: string[]): string {
    return list.join(', ');
  }
  function textToList(text: string): string[] {
    return text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  function save() {
    start(async () => {
      await updateModelAccessPolicy(id, v);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    });
  }

  const zdrItems: { key: keyof ModelAccessPolicy['zdr']; label: string }[] = [
    { key: 'nonFrontier', label: 'Non-frontier' },
    { key: 'anthropic', label: 'Anthropic' },
    { key: 'openai', label: 'OpenAI' },
    { key: 'google', label: 'Google' },
    { key: 'spacexai', label: 'SpaceXAI' },
  ];
  const trainItems: { key: keyof ModelAccessPolicy['training']; label: string }[] = [
    { key: 'allowPaidTrain', label: 'Allow paid endpoints that train on request data' },
    { key: 'allowFreeTrain', label: 'Allow free endpoints that train on request data' },
    { key: 'allowFreePublish', label: 'Allow free endpoints that publish prompts' },
  ];

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Zero Data Retention
        </div>
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {zdrItems.map((item) => (
            <label key={item.key} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-gray-700">{item.label}</span>
              <Toggle
                on={v.zdr[item.key]}
                onChange={(on) => patch({ zdr: { ...v.zdr, [item.key]: on } as ModelAccessPolicy['zdr'] })}
              />
            </label>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Data Training
        </div>
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {trainItems.map((item) => (
            <label key={item.key} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-gray-700">{item.label}</span>
              <Toggle
                on={v.training[item.key]}
                onChange={(on) =>
                  patch({ training: { ...v.training, [item.key]: on } as ModelAccessPolicy['training'] })
                }
              />
            </label>
          ))}
        </div>
        <label className="mt-3 flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
          <span className="text-sm text-gray-700">Restrict data regions</span>
          <Toggle on={v.restrictRegions} onChange={(on) => patch({ restrictRegions: on })} />
        </label>
      </section>

      <section>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Access Policy
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-gray-900">Restriction mode</div>
              <div className="text-sm text-gray-500">
                {v.restrictionMode === 'allow_all_except'
                  ? 'All providers/models allowed unless explicitly blocked.'
                  : 'All providers/models blocked unless explicitly allowed.'}
              </div>
            </div>
            <select
              value={v.restrictionMode}
              onChange={(e) => patch({ restrictionMode: e.target.value as ModelAccessPolicy['restrictionMode'] })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none"
            >
              <option value="allow_all_except">Allow All Except…</option>
              <option value="block_all_except">Block All Except…</option>
            </select>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {v.restrictionMode === 'allow_all_except' ? (
              <>
                <ListField
                  label="Blocked providers"
                  placeholder="deepinfra, together"
                  value={listToText(v.blockedProviders)}
                  onChange={(t) => patch({ blockedProviders: textToList(t) })}
                />
                <ListField
                  label="Blocked models"
                  placeholder="openai/gpt-4o"
                  value={listToText(v.blockedModels)}
                  onChange={(t) => patch({ blockedModels: textToList(t) })}
                />
              </>
            ) : (
              <>
                <ListField
                  label="Allowed providers"
                  placeholder="openai, anthropic"
                  value={listToText(v.allowedProviders)}
                  onChange={(t) => patch({ allowedProviders: textToList(t) })}
                />
                <ListField
                  label="Allowed models"
                  placeholder="openai/gpt-4o-mini"
                  value={listToText(v.allowedModels)}
                  onChange={(t) => patch({ allowedModels: textToList(t) })}
                />
              </>
            )}
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <SaveButton pending={pending} saved={saved} onClick={save} />
      </div>
    </div>
  );
}

function ListField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
      />
      <p className="mt-1 text-xs text-gray-400">Comma-separated slugs.</p>
    </div>
  );
}

export function ContentForm({
  id,
  field,
  value,
}: {
  id: string;
  field: 'promptInjection' | 'sensitiveInfo';
  value: PolicyMode;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<PolicyMode>(value);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  function save() {
    start(async () => {
      const p = field === 'promptInjection' ? { promptInjection: mode } : { sensitiveInfo: mode };
      await updateContentPolicy(id, p);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    });
  }

  const options: { value: PolicyMode; label: string; desc: string }[] = [
    { value: 'off', label: 'Off', desc: 'No detection.' },
    { value: 'flag', label: 'Flag', desc: 'Detect and annotate the request, but allow it.' },
    { value: 'block', label: 'Block', desc: 'Reject the request when detected.' },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
              mode === o.value ? 'border-violet-400 bg-violet-50/40' : 'border-gray-200'
            }`}
          >
            <input
              type="radio"
              name="mode"
              checked={mode === o.value}
              onChange={() => setMode(o.value)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">{o.label}</span>
              <span className="block text-sm text-gray-500">{o.desc}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex justify-end">
        <SaveButton pending={pending} saved={saved} onClick={save} />
      </div>
    </div>
  );
}
