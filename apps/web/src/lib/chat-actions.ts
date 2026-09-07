'use server';

import { playgroundChat } from './playground';
import type { ChatMessage, ChatResult } from './chat-types';

export async function sendChat(opts: {
  messages: ChatMessage[];
  model: string;
  costTier?: string;
  orchestrate?: string;
}): Promise<ChatResult> {
  return playgroundChat(opts);
}
