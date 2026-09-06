import { ManagementKeysView } from '@/components/management-keys-view';
import { listManagementKeys } from '@/lib/management-keys';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getCurrentUser();
  const rows = ctx ? await listManagementKeys(ctx.org.id) : [];
  return <ManagementKeysView rows={rows} connected={!!ctx} />;
}
