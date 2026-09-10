import { Radio } from 'lucide-react';
import { StatusView } from '@/components/status-view';
import { getCurrentWorkspace } from '@/lib/session';
import { getReliability } from '@/lib/reliability';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getCurrentWorkspace();
  const data = ctx ? await getReliability(ctx.org.id, ctx.workspace.id) : null;

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
          <Radio className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Reliability Mesh</h1>
          <p className="mt-1 text-sm text-gray-500">
            Live provider health scored from your real traffic. When a provider degrades, a circuit breaker trips and
            the router fails over to a healthy, quality-equivalent model — then half-open probes auto-recover.
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
          <StatusView data={data} />
        </div>
      )}
    </div>
  );
}
