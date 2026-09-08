export interface ChatMessage {
  role: string;
  content: unknown;
  name?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  [key: string]: unknown;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
}

export interface ProviderAdapter {
  slug: string;
  /** Non-streaming completion. Returns an OpenAI-shaped JSON body plus normalized usage. */
  chat(
    upstreamModel: string,
    body: ChatCompletionRequest,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<{ json: Record<string, unknown>; usage: Usage }>;
  /**
   * Streaming completion. Returns a byte stream of OpenAI-compatible SSE and
   * getters that yield usage and finish reason once the stream has finished.
   */
  chatStream(
    upstreamModel: string,
    body: ChatCompletionRequest,
    apiKey: string,
  ): Promise<{
    stream: ReadableStream<Uint8Array>;
    getUsage: () => Usage | null;
    getFinishReason: () => string | null;
  }>;
}
