import { FlaskConical } from 'lucide-react';
import { OptimizeView } from '@/components/optimize-view';
import { listExecutableModels } from '@/lib/classifiers';
import { getOptimizationRuns } from '@/lib/optimization';
import { getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getCurrentWorkspace();
  const [models, runs] = ctx
    ? await Promise.all([listExecutableModels(), getOptimizationRuns(ctx.workspace.id)])
    : [[], []];

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-violet-50 text-violet-600">
          <FlaskConical className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Prompt Optimizer</h1>
          <p className="mt-1 text-sm text-gray-500">
            Automatically engineer better prompts. The engine proposes variants, evaluates them on your examples
            with a live LLM judge, and ranks by quality, cost, and latency.
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
          <OptimizeView models={models} runs={runs} />
        </div>
      )}
    </div>
  );
}
