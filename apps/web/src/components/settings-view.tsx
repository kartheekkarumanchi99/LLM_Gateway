'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateWorkspaceBudget, updateWorkspaceGeneral } from '@/lib/settings-actions';
import { SaveButton, Toggle } from '@/components/toggle';

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100';

export interface SettingsInitial {
  name: string;
  description: string;
  budgetLimitUsd: string | null;
  budgetInterval: string;
  includeByok: boolean;
}

export function SettingsView({ initial, connected }: { initial: SettingsInitial; connected: boolean }) {
  const router = useRouter();

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [genSaved, setGenSaved] = useState(false);
  const [genPending, startGen] = useTransition();

  const [limit, setLimit] = useState(initial.budgetLimitUsd ? String(Number(initial.budgetLimitUsd)) : '');
  const [interval, setInterval] = useState(initial.budgetInterval);
  const [includeByok, setIncludeByok] = useState(initial.includeByok);
  const [budgetErr, setBudgetErr] = useState<string | null>(null);
  const [budgetSaved, setBudgetSaved] = useState(false);
  const [budgetPending, startBudget] = useTransition();

  function saveGeneral() {
    setGenErr(null);
    setGenSaved(false);
    startGen(async () => {
      const res = await updateWorkspaceGeneral(name, description);
      if (!res.ok) {
        setGenErr(res.error ?? 'Failed to save.');
        return;
      }
      setGenSaved(true);
      router.refresh();
    });
  }

  function saveBudget() {
    setBudgetErr(null);
    setBudgetSaved(false);
    const trimmed = limit.trim();
    const limitUsd = trimmed === '' ? null : Number(trimmed);
    if (limitUsd != null && (!Number.isFinite(limitUsd) || limitUsd < 0)) {
      setBudgetErr('Budget limit must be a positive number.');
      return;
    }
    startBudget(async () => {
      const res = await updateWorkspaceBudget({ limitUsd, interval, includeByok });
      if (!res.ok) {
        setBudgetErr(res.error ?? 'Failed to save.');
        return;
      }
      setBudgetSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      {!connected ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code> and run{' '}
          <code className="font-mono">pnpm db:push</code>.
        </div>
      ) : null}

      <Section title="General" desc="Basic information about this workspace.">
        <Field label="Workspace name">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={inputCls} />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} />
        </Field>
        {genErr ? <p className="mb-2 text-sm text-red-600">{genErr}</p> : null}
        <div className="flex justify-end">
          <SaveButton pending={genPending} saved={genSaved} onClick={saveGeneral} disabled={!connected} />
        </div>
      </Section>

      <Section title="Budgets & data" desc="Cap total spend across every API key in this workspace.">
        <Field label="Budget limit (USD)">
          <input
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            inputMode="decimal"
            placeholder="No limit"
            className={`${inputCls} max-w-[220px]`}
          />
          <p className="mt-1 text-xs text-gray-500">Leave blank for no limit. Requests are refused once the cap is reached.</p>
        </Field>
        <Field label="Reset interval">
          <select value={interval} onChange={(e) => setInterval(e.target.value)} className={`${inputCls} max-w-[220px]`}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="lifetime">Lifetime</option>
          </select>
        </Field>
        <label className="mb-3 flex items-center gap-2 text-sm text-gray-700">
          <Toggle on={includeByok} onChange={setIncludeByok} disabled={!connected} /> Include BYOK spend in this budget
        </label>
        {budgetErr ? <p className="mb-2 text-sm text-red-600">{budgetErr}</p> : null}
        <div className="flex justify-end">
          <SaveButton pending={budgetPending} saved={budgetSaved} onClick={saveBudget} disabled={!connected} />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-4 border-b border-gray-100 pb-8 md:grid-cols-[220px_1fr]">
      <div>
        <div className="font-medium text-gray-900">{title}</div>
        <p className="mt-1 text-sm text-gray-500">{desc}</p>
      </div>
      <div>{children}</div>
    </section>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {children}
    </div>
  );
}
