import Link from 'next/link';
import { Plus, Tags } from 'lucide-react';
import { listClassifiers } from '@/lib/classifiers';
import { getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getCurrentWorkspace();
  const rows = ctx ? await listClassifiers(ctx.workspace.id) : [];
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Classifiers</h1>
          <p className="mt-1 text-sm text-gray-500">
            Classifiers tag a sampled share of your requests along custom dimensions using a small model.
          </p>
        </div>
        <Link
          href="/classifiers/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700"
        >
          <Plus className="h-4 w-4" /> Create classifier
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
          <Tags className="mb-2 h-7 w-7 text-gray-300" />
          <div className="font-medium text-gray-700">No classifiers configured</div>
          <div className="mt-1 text-sm text-gray-500">
            Create a classifier to automatically tag requests by department, task type, and more.
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((c) => (
            <Link
              key={c.id}
              href={`/classifiers/${c.id}`}
              className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 hover:shadow-sm"
            >
              <div className="flex items-center gap-2 font-medium text-gray-900">
                {c.name}
                {!c.enabled ? (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                    Disabled
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 text-sm text-gray-500">
                <code className="font-mono text-xs text-gray-400">{c.modelSlug}</code> · sampling{' '}
                {Math.round(Number(c.sampleRate) * 100)}% · {c.dimensions.length} dimension
                {c.dimensions.length === 1 ? '' : 's'}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
