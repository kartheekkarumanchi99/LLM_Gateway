import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { SERVER_TOOLS } from '@llmgw/db/http';
import { DeletePresetButton } from '@/components/delete-preset-button';
import { PresetForm } from '@/components/preset-form';
import { getPresetById } from '@/lib/presets';
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
  const preset = await getPresetById(id, ctx.workspace.id);
  if (!preset) notFound();

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/presets" className="flex items-center gap-1 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" />
          Presets
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-gray-900">{preset.name}</span>
      </div>
      <div className="mt-3 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">{preset.name}</h1>
        <DeletePresetButton id={preset.id} />
      </div>
      <div className="mt-6">
        <PresetForm serverTools={SERVER_TOOLS} preset={preset} />
      </div>
    </div>
  );
}
