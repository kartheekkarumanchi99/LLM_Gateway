import { Database } from 'lucide-react';
import { CacheView } from '@/components/cache-view';
import { getCurrentWorkspace } from '@/lib/session';
import { getCacheData } from '@/lib/dedup';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getCurrentWorkspace();
  const data = ctx ? await getCacheData(ctx.org.id, ctx.workspace.id) : null;

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
          <Database className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Semantic Dedup Cache</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            A dual-layer cache that eliminates the cost of repetitive work. Exact SHA-256 matches and pgvector HNSW
            nearest-neighbor matches return a prior completion instantly — and, opt-in, reuse answers across every
            workspace in your org. Repetitive organizational prompts collapse to zero tokens.
          </p>
        </div>
      </div>

      {!ctx || !data ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code> and run{' '}
          <code className="font-mono">pnpm db:push</code>.
        </div>
      ) : (
        <div className="mt-6">
          <CacheView data={data} />
        </div>
      )}
    </div>
  );
}
