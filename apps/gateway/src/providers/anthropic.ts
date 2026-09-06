import { config } from '../config';
import type { ChatCompletionRequest, ProviderAdapter, Usage } from './types';

const ANTHROPIC_VERSION = '2023-06-01';

// Map Anthropic stop reasons to OpenAI finish_reason values.
function mapStop(reason: string | null | undefined): string {
  switch (reason) {
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    case 'end_turn':
    case 'stop_sequence':
    default:
      return 'stop';
  }
}

function toAnthropicPayload(body: ChatCompletionRequest, upstreamModel: string) {
  const system = body.messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');

  const messages = body.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

  const payload: Record<string, unknown> = {
    model: upstreamModel,
    // Anthropic requires max_tokens.
    max_tokens: (body as Record<string, any>).max_tokens ?? 1024,
    messages,
  };
  if (system) payload.system = system;
  const temperature = (body as Record<string, any>).temperature;
  if (typeof temperature === 'number') payload.temperature = temperature;
  return payload;
}

export const anthropicAdapter: ProviderAdapter = {
  slug: 'anthropic',

  async chat(upstreamModel, body, apiKey) {
    const res = await fetch(`${config.anthropicBaseUrl}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(toAnthropicPayload(body, upstreamModel)),
    });

    const data = (await res.json()) as Record<string, any>;
    if (!res.ok) {
      const err = new Error(data?.error?.message ?? `Upstream error ${res.status}`) as Error & {
        status?: number;
      };
      err.status = res.status;
      throw err;
    }

    const text = Array.isArray(data.content)
      ? data.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
      : '';
    const promptTokens = data.usage?.input_tokens ?? 0;
    const completionTokens = data.usage?.output_tokens ?? 0;
    const cachedTokens = data.usage?.cache_read_input_tokens ?? 0;
    const usage: Usage = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      cachedTokens,
      reasoningTokens: 0,
    };

    const json = {
      id: data.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: mapStop(data.stop_reason),
        },
      ],
      usage: {
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens: usage.totalTokens,
      },
    };
    return { json, usage };
  },

  async chatStream(upstreamModel, body, apiKey) {
    const res = await fetch(`${config.anthropicBaseUrl}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({ ...toAnthropicPayload(body, upstreamModel), stream: true }),
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Upstream error ${res.status}: ${text}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }

    let usage: Usage | null = null;
    let promptTokens = 0;
    let cachedTokens = 0;
    let finishReason: string | null = null;
    const id = 'chatcmpl-' + Math.random().toString(36).slice(2);
    const created = Math.floor(Date.now() / 1000);
    const model = body.model;
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = '';

    const openaiChunk = (delta: Record<string, unknown>, finish: string | null = null) =>
      encoder.encode(
        `data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`,
      );

    // Translate Anthropic's SSE event stream into OpenAI-compatible chunks.
    const transform = new TransformStream<Uint8Array, Uint8Array>({
      start(controller) {
        controller.enqueue(openaiChunk({ role: 'assistant', content: '' }));
      },
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          try {
            const evt = JSON.parse(data);
            if (evt.type === 'message_start') {
              promptTokens = evt.message?.usage?.input_tokens ?? 0;
              cachedTokens = evt.message?.usage?.cache_read_input_tokens ?? 0;
            } else if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
              controller.enqueue(openaiChunk({ content: evt.delta.text }));
            } else if (evt.type === 'message_delta') {
              const out = evt.usage?.output_tokens ?? 0;
              if (evt.delta?.stop_reason) finishReason = mapStop(evt.delta.stop_reason);
              usage = {
                promptTokens,
                completionTokens: out,
                totalTokens: promptTokens + out,
                cachedTokens,
                reasoningTokens: 0,
              };
            } else if (evt.type === 'message_stop') {
              controller.enqueue(openaiChunk({}, 'stop'));
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            }
          } catch {
            // Ignore partial JSON.
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
