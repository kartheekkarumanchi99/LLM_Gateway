'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, MoreVertical, Plus, X } from 'lucide-react';
import type { ManagementKeyRow } from '@/lib/management-keys';
import {
  createManagementKey,
  deleteManagementKey,
  revokeManagementKey,
} from '@/lib/management-key-actions';

const EXPIRY: { label: string; days: number | null }[] = [
  { label: 'Never', days: null },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
];

function fmtDate(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function ManagementKeysView({
  rows,
  connected,
}: {
  rows: ManagementKeyRow[];
  connected: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [expiryIdx, setExpiryIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const res = await createManagementKey(name, EXPIRY[expiryIdx]!.days);
      if (!res.ok) {
        setError(res.error ?? 'Failed to create key.');
        return;
      }
      setCreating(false);
      setName('');
      setExpiryIdx(0);
      setRevealed(res.key ?? null);
      router.refresh();
    });
  }

  function copy() {
    if (!revealed) return;
    void navigator.clipboard.writeText(revealed);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Management Keys</h1>
          <p className="mt-1 text-sm text-gray-500">
            Control your management API keys for administrative actions.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          disabled={!connected}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> New Key
        </button>
      </div>

      {!connected ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code> and run{' '}
          <code className="font-mono">pnpm db:push</code>.
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Hint</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="w-10 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                  No management keys yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.hint}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(r.expiresAt)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="relative px-4 py-3 text-right">
                    <button
                      onClick={() => setMenu(menu === r.id ? null : r.id)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      aria-label="Actions"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                    {menu === r.id ? (
                      <div className="absolute right-4 top-10 z-10 w-32 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                        {r.status === 'Active' ? (
                          <button
                            onClick={() => {
                              setMenu(null);
                              start(async () => {
                                await revokeManagementKey(r.id);
                                router.refresh();
                              });
                            }}
                            className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                          >
                            Revoke
                          </button>
                        ) : null}
                        <button
                          onClick={() => {
                            setMenu(null);
                            if (!window.confirm(`Delete management key "${r.name}"?`)) return;
                            start(async () => {
                              await deleteManagementKey(r.id);
                              router.refresh();
                            });
                          }}
                          className="block w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="border-t border-gray-100 px-4 py-2.5 text-xs text-gray-500">
          {rows.length} management key{rows.length === 1 ? '' : 's'}
        </div>
      </div>

      {creating ? (
        <Modal onClose={() => setCreating(false)} title="Create a Management Key">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                placeholder="e.g. CI provisioning"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Expires</label>
              <select
                value={expiryIdx}
                onChange={(e) => setExpiryIdx(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none"
              >
                {EXPIRY.map((o, i) => (
                  <option key={o.label} value={i}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setCreating(false)} className="rounded-lg border border-gray-300 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button onClick={submit} disabled={pending} className="rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60">
              {pending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </Modal>
      ) : null}

      {revealed ? (
        <Modal onClose={() => setRevealed(null)} title="Create a Management Key">
          <p className="text-center text-sm text-gray-600">Your new management key:</p>
          <div className="mt-3 flex items-start gap-2">
            <code className="flex-1 break-all rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-800">
              {revealed}
            </code>
            <button onClick={copy} className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50" aria-label="Copy">
              <Copy className="h-4 w-4" />
            </button>
          </div>
          {copied ? <p className="mt-1 text-center text-xs text-green-600">Copied.</p> : null}
          <p className="mt-3 text-sm text-gray-600">
            Please copy it now and write it down somewhere safe.{' '}
            <span className="font-semibold">You will not be able to see it again.</span>
          </p>
          <p className="mt-2 text-sm text-red-600">
            This is a management key. It can only be used to manage other API keys and cannot make model requests.
          </p>
          <div className="mt-5 flex justify-end">
            <button onClick={() => setRevealed(null)} className="rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-700">
              Done
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: ManagementKeyRow['status'] }) {
  const cls =
    status === 'Active'
      ? 'bg-green-50 text-green-700'
      : status === 'Revoked'
        ? 'bg-red-50 text-red-700'
        : 'bg-gray-100 text-gray-600';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
