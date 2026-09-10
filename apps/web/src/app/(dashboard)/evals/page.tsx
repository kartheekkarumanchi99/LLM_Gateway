import { GitPullRequestArrow } from 'lucide-react';
import { EvalsView } from '@/components/evals-view';
import { getEvalSets } from '@/lib/evals';
import { getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getCurrentWorkspace();
  const sets = ctx ? await getEvalSets(ctx.workspace.id) : [];

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-blue-600">
          <GitPullRequestArrow className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Prompt &amp; Model CI</h1>
          <p className="mt-1 text-sm text-gray-500">
            CI for LLM changes. Capture eval sets from real traffic, then score a prompt or model change against a
            baseline — quality, cost, and latency deltas before you ship.
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
          <EvalsView sets={sets} />
        </div>
      )}
    </div>
  );
}
