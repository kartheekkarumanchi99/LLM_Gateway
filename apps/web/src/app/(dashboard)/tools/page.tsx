import { DEFAULT_TOOLS_CONFIG, SERVER_TOOLS } from '@llmgw/db/http';
import { ToolsView } from '@/components/tools-view';
import { getWorkspaceSettings } from '@/lib/settings';
import { getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getCurrentWorkspace();
  const tools = ctx ? (await getWorkspaceSettings(ctx.workspace.id)).tools : DEFAULT_TOOLS_CONFIG;
  return <ToolsView serverTools={SERVER_TOOLS} initial={tools} connected={!!ctx} />;
}
