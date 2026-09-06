import { notFound } from 'next/navigation';
import { CLASSIFIER_PRESETS, MAX_DIMENSIONS } from '@llmgw/db/http';
import { ClassifierForm } from '@/components/classifier-form';
import { getClassifierById, listExecutableModels } from '@/lib/classifiers';
import { getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCurrentWorkspace();
  if (!ctx) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Not connected to a database yet.
      </div>
    );
  }
  const classifier = await getClassifierById(id, ctx.workspace.id);
  if (!classifier) notFound();
  const models = await listExecutableModels();
  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Edit classifier</h1>
      <div className="mt-8">
        <ClassifierForm
          models={models}
          presets={CLASSIFIER_PRESETS}
          maxDimensions={MAX_DIMENSIONS}
          classifier={classifier}
          connected
        />
      </div>
    </div>
  );
}
