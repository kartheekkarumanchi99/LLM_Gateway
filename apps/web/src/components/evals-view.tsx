'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FlaskConical, Loader2, Plus } from 'lucide-react';
import type { EvalSetListItem } from '@/lib/evals';
import { createEvalSet } from '@/lib/evals-actions';

const VERDICT_BADGE: Record<string, string> = {
  improved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  regressed: 'bg-rose-50 text-rose-700 ring-rose-200',
  neutral: 'bg-gray-100 text-gray-600 ring-gray-200',
  'no-baseline': 'bg-blue-50 text-blue-700 ring-blue-200',
};

export function EvalsView({ sets }: { sets: EvalSetListItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await createEvalSet(name, desc);
      if (res.ok && res.id) router.push(`/evals/${res.id}`);
      else setError(res.error ?? 'Could not create the eval set.');
    });
  }

  return (
    <div>
      <div className="flex justify-end">
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> New eval set
        </button>
      </div>

      {open ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Support replies v2"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Description (optional)"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          {error ? <div className="mt-2 text-xs text-rose-600">{error}</div> : null}
          <div className="mt-3">
            <button
              onClick={create}
              disabled={pending || !name.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create
            </button>
          </div>
        </div>
      ) : null}

      {sets.length === 0 ? (
        <div className="mt-6 grid place-items-center rounded-xl border border-gray-200 bg-white p-12 text-center">
          <FlaskConical className="mb-2 h-7 w-7 text-gray-300" />
          <div className="font-medium text-gray-700">No eval sets yet</div>
          <div className="mt-1 text-sm text-gray-500">
            Create a set, capture cases from production traffic, then eval a prompt or model change against it.
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {sets.map((s) => (
            <Link
              key={s.id}
              href={`/evals/${s.id}`}
              className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 hover:shadow-sm"
            >
              <div className="font-medium text-gray-900">{s.name}</div>
              {s.description ? <div className="mt-0.5 text-sm text-gray-500">{s.description}</div> : null}
              <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                <span>{s.caseCount} cases</span>
                <span>{s.runCount} runs</span>
                <span>{s.createdAt.slice(0, 10)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export { VERDICT_BADGE };
