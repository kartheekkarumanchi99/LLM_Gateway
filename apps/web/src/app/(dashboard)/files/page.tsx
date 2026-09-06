import { FilesView } from '@/components/files-view';
import { listFiles } from '@/lib/files';
import { getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getCurrentWorkspace();
  const rows = ctx ? await listFiles(ctx.workspace.id) : [];
  return <FilesView rows={rows} connected={!!ctx} />;
}
