import Link from 'next/link';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { listPresets } from '@/lib/presets';
import { getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getCurrentWorkspace();
  const rows = ctx ? await listPresets(ctx.workspace.id) : [];
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Presets</h1>
          <p className="mt-1 text-sm text-gray-500">
            Presets are shortcuts for your system prompts, model and provider configurations, and request
            parameters.
          </p>
        </div>
        <Link
          href="/presets/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700"
        >
          <Plus className="h-4 w-4" /> New Preset
        </Link>
      </div>

      {!ctx ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code> and run{' '}
          <code className="font-mono">pnpm db:push</code>.
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="mt-6 grid place-items-center rounded-xl border border-gray-200 bg-white p-12 text-center">
          <SlidersHorizontal className="mb-2 h-7 w-7 text-gray-300" />
          <div className="font-medium text-gray-700">No presets yet</div>
          <div className="mt-1 text-sm text-gray-500">
            Create a preset to save your model + parameter configuration.
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((p) => (
            <Link
              key={p.id}
              href={`/presets/${p.id}`}
              className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 hover:shadow-sm"
            >
              <div className="flex items-center gap-2 font-medium text-gray-900">
                {p.name}
                <code className="font-mono text-xs text-gray-400">@preset/{p.slug}</code>
              </div>
              {p.description ? <div className="mt-0.5 text-sm text-gray-500">{p.description}</div> : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
