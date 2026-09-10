import { notFound } from 'next/navigation';
import { EvalSetDetailView } from '@/components/eval-set-detail';
import { listExecutableModels } from '@/lib/classifiers';
import { getCaptureCandidates, getEvalSet } from '@/lib/evals';
import { getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ setId: string }> }) {
  const { setId } = await params;
  const ctx = await getCurrentWorkspace();
  if (!ctx) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Not connected to a database.
      </div>
    );
  }
  const [set, models, captureCandidates] = await Promise.all([
    getEvalSet(ctx.workspace.id, setId),
    listExecutableModels(),
    getCaptureCandidates(ctx.workspace.id, 25),
  ]);
  if (!set) notFound();
  return <EvalSetDetailView set={set} models={models} captureCandidates={captureCandidates} />;
}
