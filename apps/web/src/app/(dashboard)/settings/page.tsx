import { SettingsView, type SettingsInitial } from '@/components/settings-view';
import { getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

const EMPTY: SettingsInitial = {
  name: '',
  description: '',
  budgetLimitUsd: null,
  budgetInterval: 'monthly',
  includeByok: false,
};

export default async function Page() {
  const ctx = await getCurrentWorkspace();
  const initial: SettingsInitial = ctx
    ? {
        name: ctx.workspace.name,
        description: ctx.workspace.description ?? '',
        budgetLimitUsd: ctx.workspace.budgetLimitUsd ?? null,
        budgetInterval: ctx.workspace.budgetInterval,
        includeByok: ctx.workspace.includeByok,
      }
    : EMPTY;
  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
      <p className="mt-1 text-sm text-gray-500">Manage this workspace&apos;s general details and spend limits.</p>
      <div className="mt-8">
        <SettingsView initial={initial} connected={!!ctx} />
      </div>
    </div>
  );
}
