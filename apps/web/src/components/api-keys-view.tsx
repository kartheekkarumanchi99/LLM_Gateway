'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, MoreVertical, Plus, Search, X } from 'lucide-react';
import {
  createApiKey,
  deleteApiKey,
  renameApiKey,
  revokeApiKey,
  type CreateKeyState,
} from '@/lib/api-key-actions';
import type { ApiKeyRow } from '@/lib/api-keys';
import { formatUsd } from '@/lib/format';

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : 'Never';
}

export function ApiKeysView({ rows, connected }: { rows: ApiKeyRow[]; connected: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [state, formAction, pending] = useActionState<CreateKeyState | null, FormData>(
    createApiKey,
    null,
  );

  useEffect(() => {
    if (state?.ok && state.key) {
      setRevealKey(state.key);
      setCreateOpen(false);
    }
  }, [state]);

  const filtered = rows.filter(
    (r) =>
      r.name.toLowerCase().includes(query.toLowerCase()) ||
      r.keyPrefix.toLowerCase().includes(query.toLowerCase()),
  );

  function onRename(row: ApiKeyRow) {
    const name = window.prompt('Rename key', row.name);
    setMenuId(null);
    if (name == null) return;
    startTransition(async () => {
      await renameApiKey(row.id, name);
      router.refresh();
    });
  }

  function onRevoke(row: ApiKeyRow) {
    setMenuId(null);
    if (!window.confirm(`Revoke "${row.name}"? Requests using it will stop working.`)) return;
    startTransition(async () => {
      await revokeApiKey(row.id);
      router.refresh();
    });
  }

  function onDelete(row: ApiKeyRow) {
    setMenuId(null);
    if (!window.confirm(`Delete "${row.name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      await deleteApiKey(row.id);
      router.refresh();
    });
  }

  return (
    <div onClick={() => setMenuId(null)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">API Keys</h1>
          <p className="mt-1 text-sm text-gray-500">Create and manage your API keys.</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          disabled={!connected}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          New Key
        </button>
      </div>

      {!connected ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code>, then run{' '}
          <code className="font-mono">pnpm db:push</code> and <code className="font-mono">pnpm db:seed</code>.
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 p-3">
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
            <Search className="h-4 w-4 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or key prefix…"
              className="w-full bg-transparent outline-none placeholder:text-gray-400"
            />
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="px-5 py-3 font-medium">Key</th>
              <th className="px-5 py-3 font-medium">Guardrails</th>
              <th className="px-5 py-3 font-medium">Expires</th>
              <th className="px-5 py-3 font-medium">Last Used</th>
              <th className="px-5 py-3 font-medium">Key usage</th>
              <th className="px-5 py-3 font-medium">Key limit</th>
              <th className="w-10 px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-gray-500">
                  {rows.length === 0 ? 'No API keys yet. Create your first one.' : 'No matches.'}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                  <td className="px-5 py-4">
                    <div className="font-medium text-gray-900">
                      {r.name}
                      {r.revokedAt ? (
                        <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                          Revoked
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-gray-400">
                      {r.keyPrefix}…{r.keyLast4 ?? ''}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-gray-600">{r.guardrailName ?? 'No guardrails'}</td>
                  <td className="px-5 py-4 text-gray-600">{fmtDate(r.expiresAt)}</td>
                  <td className="px-5 py-4 text-gray-600">{fmtDate(r.lastUsedAt)}</td>
                  <td className="px-5 py-4 text-gray-700">{formatUsd(r.usageUsd, 3)}</td>
                  <td className="px-5 py-4 text-gray-700">
                    {r.creditLimitUsd
                      ? `${formatUsd(r.creditLimitUsd)} / ${r.creditLimitInterval ?? 'total'}`
                      : 'unlimited'}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
                      <button
                        aria-label="Key actions"
                        onClick={() => setMenuId(menuId === r.id ? null : r.id)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                      {menuId === r.id ? (
                        <div className="absolute right-0 z-10 mt-1 w-36 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-left text-sm shadow-lg">
                          <button
                            onClick={() => onRename(r)}
                            className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-50"
                          >
                            Rename
                          </button>
                          {!r.revokedAt ? (
                            <button
                              onClick={() => onRevoke(r)}
                              className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-50"
                            >
                              Revoke
                            </button>
                          ) : null}
                          <button
                            onClick={() => onDelete(r)}
                            className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="border-t border-gray-200 px-5 py-3 text-xs text-gray-500">
          {rows.length} {rows.length === 1 ? 'key' : 'keys'}
        </div>
      </div>

      {createOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
          onClick={() => setCreateOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Create API key</h2>
              <button
                onClick={() => setCreateOpen(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form action={formAction} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
                <input
                  name="name"
                  required
                  maxLength={80}
                  placeholder="Production key"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Credit limit <span className="text-gray-400">— optional</span>
                  </label>
                  <input
                    name="limit"
                    inputMode="decimal"
                    placeholder="Unlimited"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                  />
                </div>
                <div className="w-32">
                  <label className="mb-1 block text-sm font-medium text-gray-700">Per</label>
                  <select
                    name="interval"
                    defaultValue="total"
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                  >
                    <option value="total">Total</option>
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                  </select>
                </div>
              </div>
              {state?.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-lg border border-gray-300 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
                >
                  {pending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {revealKey ? <RevealModal apiKey={revealKey} onClose={() => setRevealKey(null)} /> : null}
    </div>
  );
}

function RevealModal({ apiKey, onClose }: { apiKey: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">Save your API key</h2>
        <p className="mt-1 text-sm text-gray-500">
          This is the only time the full key is shown. Store it somewhere safe.
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <code className="flex-1 truncate font-mono text-sm text-gray-800">{apiKey}</code>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(apiKey);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* clipboard blocked */
              }
            }}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-white"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
