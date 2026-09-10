import { notFound } from 'next/navigation';
import { TraceDetailView } from '@/components/trace-detail';
import { listExecutableModels } from '@/lib/classifiers';
import { getCurrentWorkspace } from '@/lib/session';
import { getTrace } from '@/lib/traces';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ traceId: string }> }) {
  const { traceId } = await params;
  const ctx = await getCurrentWorkspace();
  if (!ctx) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Not connected to a database.
      </div>
    );
  }
  const decoded = decodeURIComponent(traceId);
  const [trace, models] = await Promise.all([getTrace(ctx.workspace.id, decoded), listExecutableModels()]);
  if (!trace) notFound();
  return <TraceDetailView trace={trace} models={models} />;
}
