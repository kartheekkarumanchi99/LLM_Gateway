import { Radar } from 'lucide-react';
import { SentinelView } from '@/components/sentinel-view';
import { getCurrentWorkspace } from '@/lib/session';
import { getSentinelData } from '@/lib/sentinel';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getCurrentWorkspace();
  const data = ctx ? await getSentinelData(ctx.org.id, ctx.workspace.id) : null;

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-violet-50 text-violet-600">
          <Radar className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Shadow Model Sentinel</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Vendors update API checkpoints silently, and behavior drifts. The Sentinel shadow-tests a scrubbed sample of
            your real traffic against candidate models in the background, scores each against the answer you actually
            served, and — the moment a model regresses in quality or inflates output length — automatically lowers its
            routing weight. A self-healing feedback loop against silent downstream regressions.
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
          <SentinelView data={data} />
        </div>
      )}
    </div>
  );
}
