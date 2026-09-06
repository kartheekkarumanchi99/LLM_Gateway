import { ApiKeysView } from '@/components/api-keys-view';
import { listApiKeys } from '@/lib/api-keys';
import { getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getCurrentWorkspace();
  const rows = ctx ? await listApiKeys(ctx.workspace.id) : [];
  return <ApiKeysView rows={rows} connected={!!ctx} />;
}
