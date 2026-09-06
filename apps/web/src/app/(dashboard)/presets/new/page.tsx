import Link from 'next/link';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { SERVER_TOOLS } from '@llmgw/db/http';
import { PresetForm } from '@/components/preset-form';
import { getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getCurrentWorkspace();
  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/presets" className="flex items-center gap-1 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" />
          Presets
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-gray-900">New Preset</span>
      </div>
      <h1 className="mt-3 text-2xl font-semibold text-gray-900">New Preset</h1>

      {!ctx ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code> and run{' '}
          <code className="font-mono">pnpm db:push</code>.
        </div>
      ) : (
        <div className="mt-6">
          <PresetForm serverTools={SERVER_TOOLS} />
        </div>
      )}
    </div>
  );
}
