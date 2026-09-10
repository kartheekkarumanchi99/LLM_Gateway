import { notFound } from 'next/navigation';
import { OptimizationDetail } from '@/components/optimization-detail';
import { getOptimizationRun } from '@/lib/optimization';
import { getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCurrentWorkspace();
  if (!ctx) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Not connected to a database.
      </div>
    );
  }
  const run = await getOptimizationRun(ctx.workspace.id, id);
  if (!run) notFound();
  return <OptimizationDetail run={run} />;
}
