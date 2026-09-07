// Pure types for the chat playground (no runtime imports — safe for client use).

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatLeg {
  role: string;
  model: string;
  costUsd: number;
  outcome?: string | null;
  displayOrder?: number | null;
  temperature?: number | null;
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
  pattern?: string | null;
  legs?: ChatLeg[];
  requestedN?: number | null;
  completedN?: number | null;
  diversityMode?: string | null;
  judgeReason?: string | null;
}

export interface ChatResult extends ChatMeta {
  content: string;
  error?: string;
}
