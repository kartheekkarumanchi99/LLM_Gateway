import { NewWorkspaceButton } from '@/components/new-workspace-button';
import { WorkspacesTable } from '@/components/workspaces-table';
import { getCurrentOrg } from '@/lib/session';
import { listWorkspaces } from '@/lib/workspaces';

export const dynamic = 'force-dynamic';

export default async function WorkspacesPage() {
  const org = await getCurrentOrg();
  const rows = org ? await listWorkspaces(org.id) : [];

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Workspaces</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your workspaces and their configurations.
          </p>
        </div>
        <NewWorkspaceButton />
      </div>

      {!org ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Copy <code className="font-mono">.env.example</code> to{' '}
          <code className="font-mono">.env</code>, set <code className="font-mono">DATABASE_URL</code>,
          then run <code className="font-mono">pnpm db:push</code> and{' '}
          <code className="font-mono">pnpm db:seed</code>.
        </div>
      ) : null}

      <div className="mt-6">
        <WorkspacesTable rows={rows} />
      </div>
    </div>
  );
}
