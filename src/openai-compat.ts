/**
 * Translates between Anthropic Messages API and OpenAI Chat Completions API.
 * Used by credential-proxy when OPENAI_COMPAT_BASE_URL is configured.
 */

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  [key: string]: unknown;
}

function flattenContent(content: string | AnthropicContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join('');
}

export function anthropicToOpenAI(
  body: Buffer,
  modelOverride?: string,
): object {
  const req = JSON.parse(body.toString()) as AnthropicRequest;

  const messages: { role: string; content: string }[] = [];

  if (req.system) {
    messages.push({ role: 'system', content: req.system });
  }

  for (const msg of req.messages) {
    messages.push({ role: msg.role, content: flattenContent(msg.content) });
  }

  const out: Record<string, unknown> = {
    model: modelOverride || req.model,
    messages,
  };

  if (req.max_tokens !== undefined) out.max_tokens = req.max_tokens;
  if (req.temperature !== undefined) out.temperature = req.temperature;
  if (req.top_p !== undefined) out.top_p = req.top_p;
  if (req.stop_sequences?.length) out.stop = req.stop_sequences;
  if (req.stream !== undefined) out.stream = req.stream;

  return out;
}

export function openAIToAnthropic(body: Buffer, requestId: string): object {
  const resp = JSON.parse(body.toString());
  const choice = resp.choices?.[0];
  const finishReason = choice?.finish_reason;
  const text = choice?.message?.content || choice?.message?.reasoning || '';

  return {
    id: resp.id || requestId,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: resp.model || '',
    stop_reason:
      finishReason === 'length'
        ? 'max_tokens'
        : finishReason === 'stop'
          ? 'end_turn'
          : (finishReason ?? 'end_turn'),
    stop_sequence: null,
    usage: {
      input_tokens: resp.usage?.prompt_tokens ?? 0,
      output_tokens: resp.usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * State machine for converting OpenAI SSE stream to Anthropic SSE stream.
 * Returns an array of complete SSE event strings to write out.
 */
export class OpenAIStreamAdapter {
  private preambleSent = false;
  private closeSent = false;
  private outputTokens = 0;
  private msgId: string;
  private model: string;
  private buffer = '';

  constructor(msgId: string, model: string) {
    this.msgId = msgId;
    this.model = model;
  }

  feed(chunk: string): string {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    const out: string[] = [];

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') {
        out.push(...this.emitClose());
        continue;
      }
      try {
        const ev = JSON.parse(payload);
        out.push(...this.handleChunk(ev));
      } catch {
        // ignore malformed
      }
    }

    return out.join('');
  }

  flush(): string {
    const out: string[] = [];
    if (this.buffer.trim()) {
      const line = this.buffer.trim();
      if (line.startsWith('data: ')) {
        const payload = line.slice(6).trim();
        if (payload !== '[DONE]') {
          try {
            const ev = JSON.parse(payload);
            out.push(...this.handleChunk(ev));
          } catch {
            // ignore
          }
        } else {
          out.push(...this.emitClose());
        }
      }
    }
    return out.join('');
  }

  private handleChunk(ev: Record<string, unknown>): string[] {
    const choice = (
      ev.choices as {
        delta?: { content?: string; reasoning?: string };
        finish_reason?: string;
      }[]
    )?.[0];
    if (!choice) return [];

    const out: string[] = [];

    if (!this.preambleSent) {
      this.preambleSent = true;
      out.push(
        sseEvent('message_start', {
          type: 'message_start',
          message: {
            id: this.msgId,
            type: 'message',
            role: 'assistant',
            content: [],
            model: this.model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }),
        sseEvent('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
        sseEvent('ping', { type: 'ping' }),
      );
    }

    const text = choice.delta?.content || choice.delta?.reasoning;
    if (text) {
      this.outputTokens += approximateTokens(text);
      out.push(
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text },
        }),
      );
    }

    if (choice.finish_reason) {
      out.push(...this.emitClose(choice.finish_reason));
    }

    return out;
  }

  private emitClose(finishReason?: string): string[] {
    if (this.closeSent) return [];
    this.closeSent = true;

    const stopReason =
      finishReason === 'length'
        ? 'max_tokens'
        : finishReason === 'stop' || !finishReason
          ? 'end_turn'
          : finishReason;

    return [
      sseEvent('content_block_stop', { type: 'content_block_stop', index: 0 }),
      sseEvent('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: this.outputTokens },
      }),
      sseEvent('message_stop', { type: 'message_stop' }),
    ];
  }
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function approximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
