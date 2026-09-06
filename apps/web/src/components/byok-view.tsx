'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeySquare, Plus, Trash2, X } from 'lucide-react';
import { addProviderKey, deleteProviderKey, type AddKeyState } from '@/lib/byok-actions';
import type { ProviderKeyRow, ProviderOption } from '@/lib/byok';

const FALLBACK_PROVIDERS: ProviderOption[] = [
  { slug: 'openai', name: 'OpenAI' },
  { slug: 'anthropic', name: 'Anthropic' },
  { slug: 'google', name: 'Google' },
  { slug: 'mistralai', name: 'Mistral' },
  { slug: 'meta-llama', name: 'Meta Llama' },
];

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : 'Never';
}

export function BYOKView({
  keys,
  providers,
  connected,
  encryptionReady,
}: {
  keys: ProviderKeyRow[];
  providers: ProviderOption[];
  connected: boolean;
  encryptionReady: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const [state, formAction, pending] = useActionState<AddKeyState | null, FormData>(
    addProviderKey,
    null,
  );
  const options = providers.length > 0 ? providers : FALLBACK_PROVIDERS;

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  function onDelete(row: ProviderKeyRow) {
    if (!window.confirm(`Remove the ${row.providerName} key "${row.label}"?`)) return;
    startTransition(async () => {
      await deleteProviderKey(row.id);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">BYOK</h1>
          <p className="mt-1 text-sm text-gray-500">
            Bring your own provider API keys. The gateway uses them for routing before any platform key.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          disabled={!connected}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add key
        </button>
      </div>

      {!connected ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code> and run{' '}
          <code className="font-mono">pnpm db:push</code>.
        </div>
      ) : !encryptionReady ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Set <code className="font-mono">BYOK_ENCRYPTION_KEY</code> in <code className="font-mono">.env</code> to
          store provider keys with AES-256-GCM encryption.
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="px-5 py-3 font-medium">Provider</th>
              <th className="px-5 py-3 font-medium">Label</th>
              <th className="px-5 py-3 font-medium">Key</th>
              <th className="px-5 py-3 font-medium">Added</th>
              <th className="px-5 py-3 font-medium">Last used</th>
              <th className="w-10 px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-gray-500">
                  <KeySquare className="mx-auto mb-2 h-6 w-6 text-gray-300" />
                  No provider keys yet. Add one to route through your own account.
                </td>
              </tr>
            ) : (
              keys.map((k) => (
                <tr key={k.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                  <td className="px-5 py-4 font-medium text-gray-900">{k.providerName}</td>
                  <td className="px-5 py-4 text-gray-600">{k.label}</td>
                  <td className="px-5 py-4 font-mono text-xs text-gray-400">••••••••••••</td>
                  <td className="px-5 py-4 text-gray-600">{fmtDate(k.createdAt)}</td>
                  <td className="px-5 py-4 text-gray-600">{fmtDate(k.lastUsedAt)}</td>
                  <td className="px-5 py-4 text-right">
                    <button
                      onClick={() => onDelete(k)}
                      aria-label="Delete key"
                      className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Add provider key</h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form action={formAction} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Provider</label>
                <select
                  name="provider"
                  defaultValue={options[0]?.slug}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                >
                  {options.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Label</label>
                <input
                  name="label"
                  maxLength={80}
                  placeholder="Production key"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">API key</label>
                <input
                  name="secret"
                  type="password"
                  required
                  placeholder="sk-…"
                  autoComplete="off"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                />
                <p className="mt-1 text-xs text-gray-400">Encrypted at rest; never shown again.</p>
              </div>
              {state?.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-gray-300 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
                >
                  {pending ? 'Saving…' : 'Save key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
