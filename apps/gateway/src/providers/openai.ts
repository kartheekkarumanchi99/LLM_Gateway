import { config } from '../config';
import type { ChatCompletionRequest, ProviderAdapter, Usage } from './types';

export const openaiAdapter: ProviderAdapter = {
  slug: 'openai',

  async chat(upstreamModel, body, apiKey, signal) {
    const res = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ ...body, model: upstreamModel, stream: false }),
      signal,
    });

    const json = (await res.json()) as Record<string, any>;
    if (!res.ok) {
      const err = new Error(json?.error?.message ?? `Upstream error ${res.status}`) as Error & {
        status?: number;
      };
      err.status = res.status;
      throw err;
    }

    const u = json.usage ?? {};
    const usage: Usage = {
      promptTokens: u.prompt_tokens ?? 0,
      completionTokens: u.completion_tokens ?? 0,
      totalTokens: u.total_tokens ?? 0,
      cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
      reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    };
    return { json, usage };
  },

  async chatStream(upstreamModel, body, apiKey) {
    const res = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        ...body,
        model: upstreamModel,
        stream: true,
        // Ask OpenAI to include a final usage chunk so we can bill accurately.
        stream_options: { include_usage: true },
      }),
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Upstream error ${res.status}: ${text}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }

    let usage: Usage | null = null;
    let finishReason: string | null = null;
    const decoder = new TextDecoder();
    let buffer = '';

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        // Pass every byte straight through to the client.
        controller.enqueue(chunk);

        // Tee a copy to sniff the usage line without altering the stream.
        buffer += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const obj = JSON.parse(data);
            const fr = obj.choices?.[0]?.finish_reason;
            if (fr) finishReason = fr;
            if (obj.usage) {
              usage = {
                promptTokens: obj.usage.prompt_tokens ?? 0,
                completionTokens: obj.usage.completion_tokens ?? 0,
                totalTokens: obj.usage.total_tokens ?? 0,
                cachedTokens: obj.usage.prompt_tokens_details?.cached_tokens ?? 0,
                reasoningTokens: obj.usage.completion_tokens_details?.reasoning_tokens ?? 0,
              };
            }
          } catch {
            // Ignore chunks that aren't complete JSON.
          }
        }
      },
    });

    return {
      stream: res.body.pipeThrough(transform),
      getUsage: () => usage,
      getFinishReason: () => finishReason,
    };
  },
};
