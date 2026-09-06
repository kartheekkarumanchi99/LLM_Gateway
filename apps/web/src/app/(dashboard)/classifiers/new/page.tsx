import { CLASSIFIER_PRESETS, MAX_DIMENSIONS } from '@llmgw/db/http';
import { ClassifierForm } from '@/components/classifier-form';
import { listExecutableModels } from '@/lib/classifiers';
import { getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getCurrentWorkspace();
  const models = ctx ? await listExecutableModels() : [];
  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">New classifier</h1>
      <p className="mt-1 text-sm text-gray-500">Tag sampled requests along custom dimensions.</p>
      {!ctx ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code> and run{' '}
          <code className="font-mono">pnpm db:push</code>.
        </div>
      ) : null}
      <div className="mt-8">
        <ClassifierForm models={models} presets={CLASSIFIER_PRESETS} maxDimensions={MAX_DIMENSIONS} connected={!!ctx} />
      </div>
    </div>
  );
}
