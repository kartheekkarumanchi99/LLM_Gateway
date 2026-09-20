import { notFound } from 'next/navigation';
import { History } from 'lucide-react';
import { ReplayView } from '@/components/replay-view';
import { listExecutableModels } from '@/lib/classifiers';
import { getCurrentWorkspace } from '@/lib/session';
import { getTraceDag } from '@/lib/replay';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const ctx = await getCurrentWorkspace();
  if (!ctx) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Not connected to a database.
      </div>
    );
  }
  const decoded = decodeURIComponent(requestId);
  const [dag, models] = await Promise.all([getTraceDag(ctx.org.id, decoded), listExecutableModels()]);
  if (!dag) notFound();

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-violet-50 text-violet-600">
          <History className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">State Replay</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            The complete execution DAG of this request — every node&apos;s exact input, params, seed, and output.
            Freeze the state, modify a single node (swap a model, change temperature, edit the prompt), and re-run
            from that node forward. Downstream legs are re-threaded with the new output and stepped frame-by-frame.
          </p>
        </div>
      </div>
      <div className="mt-6">
        <ReplayView dag={dag} models={models.map((m) => m.slug)} />
      </div>
    </div>
  );
}
