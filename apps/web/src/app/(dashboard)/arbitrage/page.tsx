import { Scale } from 'lucide-react';
import { ArbitrageView } from '@/components/arbitrage-view';
import { getCurrentWorkspace } from '@/lib/session';
import { getArbitrageData } from '@/lib/arbitrage';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getCurrentWorkspace();
  const data = ctx ? await getArbitrageData(ctx.org.id, ctx.workspace.id) : null;

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-violet-50 text-violet-600">
          <Scale className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Capacity Arbitrage</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            A financial clearinghouse for LLM tokens. The gateway tracks real-time rate-limit headroom across every
            team&apos;s BYOK keys and, when one team is throttled, routes its request over another team&apos;s
            under-utilized enterprise capacity — settled through a tenant-isolated ledger. Non-critical jobs flow to the
            cheapest spot pool. No more workflow-blocking 429s; maximum use of pre-negotiated discounts.
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
          <ArbitrageView data={data} />
        </div>
      )}
    </div>
  );
}
