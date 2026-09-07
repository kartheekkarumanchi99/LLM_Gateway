// Pure types for the chat playground (no runtime imports — safe for client use).

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatMeta {
  model: string;
  provider: string | null;
  mode: string | null;
  task: string | null;
  attempts: number | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  durationMs: number;
  tokensPerSec: number;
}

export interface ChatResult extends ChatMeta {
  content: string;
  error?: string;
}
