import { notFound } from 'next/navigation';
import { EvalRunDetailView } from '@/components/eval-run-detail';
import { getEvalRun } from '@/lib/evals';
import { getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const ctx = await getCurrentWorkspace();
  if (!ctx) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Not connected to a database.
      </div>
    );
  }
  const run = await getEvalRun(ctx.workspace.id, runId);
  if (!run) notFound();
  return <EvalRunDetailView run={run} />;
}
