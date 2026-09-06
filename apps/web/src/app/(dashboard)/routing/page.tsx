import { DEFAULT_ROUTING_CONFIG } from '@llmgw/db/http';
import { RoutingForm } from '@/components/routing-form';
import { getWorkspaceSettings } from '@/lib/settings';
import { getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getCurrentWorkspace();
  const routing = ctx ? (await getWorkspaceSettings(ctx.workspace.id)).routing : DEFAULT_ROUTING_CONFIG;
  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Routing</h1>
      <p className="mt-1 text-sm text-gray-500">
        Configure the Auto Router, provider sorting, and the default / fallback model.
      </p>
      {!ctx ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code> and run{' '}
          <code className="font-mono">pnpm db:push</code>.
        </div>
      ) : null}
      <div className="mt-8">
        <RoutingForm initial={routing} connected={!!ctx} />
      </div>
    </div>
  );
}
