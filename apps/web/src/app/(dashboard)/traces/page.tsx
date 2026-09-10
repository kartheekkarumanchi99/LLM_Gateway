import { History } from 'lucide-react';
import { TracesView } from '@/components/traces-view';
import { getCurrentWorkspace } from '@/lib/session';
import { getTraces } from '@/lib/traces';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range } = await searchParams;
  const days = range === '1' ? 1 : range === '30' ? 30 : 7;
  const ctx = await getCurrentWorkspace();
  const traces = ctx ? await getTraces(ctx.workspace.id, days) : [];

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
          <History className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Agent Time Machine</h1>
          <p className="mt-1 text-sm text-gray-500">
            Replay and inspect every request. Group multi-step agent runs with an{' '}
            <code className="font-mono text-xs">X-LLMGW-Trace</code> header, then step through the span waterfall,
            re-run against other models, and diff the results.
          </p>
        </div>
      </div>

      {!ctx ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code> and run{' '}
          <code className="font-mono">pnpm db:push</code>.
        </div>
      ) : (
        <div className="mt-6">
          <TracesView traces={traces} range={days} />
        </div>
      )}
    </div>
  );
}
