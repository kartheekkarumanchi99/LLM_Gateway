import { listRunnableModels } from '@/lib/models';
import { ChatView } from '@/components/chat-view';

export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  const models = await listRunnableModels();
  return <ChatView models={models} />;
}
