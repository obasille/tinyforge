// Any service with an OpenAI-compatible Chat Completions API (a local Ollama
// or LM Studio, or a hosted one), through the dev server: the page sends
// requests to /__tf/ai/openai, and the server forwards them to the address in
// .env, with its key when there is one. No SDK: one streamed POST per reply.

import {
  AI_BASE,
  type AiProvider,
  type Chat,
  type ChatInput,
  type ChatOptions,
  type ChatTurn,
  type SendOptions,
  type ToolCall,
} from './provider.ts';

type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'tool'; tool_call_id: string; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    };

const STOPS: Record<string, ChatTurn['stop']> = {
  tool_calls: 'tools',
  function_call: 'tools',
  length: 'max_tokens',
  content_filter: 'refusal',
};

export class OpenAiProvider implements AiProvider {
  readonly id = 'openai';
  readonly label = 'OpenAI-compatible';
  readonly hasEffort = false;

  /** `models`: the ones the dev server allows (from .env). */
  constructor(
    private readonly origin: string,
    readonly models: string[],
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  createChat(options: ChatOptions): Chat {
    return new OpenAiChat(`${this.origin}${AI_BASE}/openai/v1/chat/completions`, this.fetchFn, options);
  }
}

class OpenAiChat implements Chat {
  private readonly messages: Message[];
  private readonly tools: unknown[];

  constructor(
    private readonly url: string,
    private readonly fetchFn: typeof fetch,
    private readonly options: ChatOptions,
  ) {
    this.messages = [{ role: 'system', content: options.system.map((p) => p.text).join('\n\n') }];
    this.tools = options.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: { type: 'object', ...t.schema } },
    }));
  }

  async send(input: ChatInput, { signal, onText, onThinking }: SendOptions = {}): Promise<ChatTurn> {
    const start = this.messages.length;
    for (const r of input.results ?? []) {
      this.messages.push({ role: 'tool', tool_call_id: r.id, content: r.isError ? `Error: ${r.content}` : r.content });
    }
    if (input.text) this.messages.push({ role: 'user', content: input.text });
    try {
      return await this.request(signal, onText, onThinking);
    } catch (e) {
      this.messages.length = start;
      throw e;
    }
  }

  private async request(
    signal: AbortSignal | undefined,
    onText: ((d: string) => void) | undefined,
    onThinking: ((d: string) => void) | undefined,
  ) {
    const res = await this.fetchFn(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-TinyForge': '1' },
      body: JSON.stringify({
        model: this.options.settings().model,
        messages: this.messages,
        tools: this.tools,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);

    let text = '';
    let finish = '';
    let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const calls: Array<{ id: string; name: string; args: string }> = [];
    // Server-sent events: `data: {...}` lines, then `data: [DONE]`.
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      buffer += chunk.value;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const data = line.startsWith('data:') ? line.slice(5).trim() : '';
        if (!data || data === '[DONE]') continue;
        const event = JSON.parse(data);
        if (event.error) throw new Error(event.error.message ?? JSON.stringify(event.error));
        const choice = event.choices?.[0];
        // Reasoning models on Ollama and others send their thinking apart (the field's name varies).
        const reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
        if (typeof reasoning === 'string' && reasoning) onThinking?.(reasoning);
        if (choice?.delta?.content) {
          text += choice.delta.content;
          onText?.(choice.delta.content);
        }
        for (const d of choice?.delta?.tool_calls ?? []) {
          const i = d.index ?? calls.length;
          calls[i] ??= { id: '', name: '', args: '' };
          if (d.id) calls[i].id = d.id;
          if (d.function?.name) calls[i].name += d.function.name;
          if (d.function?.arguments) calls[i].args += d.function.arguments;
        }
        if (choice?.finish_reason) finish = choice.finish_reason;
        if (event.usage) {
          const cached = event.usage.prompt_tokens_details?.cached_tokens ?? 0;
          usage = {
            input: (event.usage.prompt_tokens ?? 0) - cached,
            output: event.usage.completion_tokens ?? 0,
            cacheRead: cached,
            cacheWrite: 0,
          };
        }
      }
    }

    const toolCalls: ToolCall[] = calls.filter(Boolean).map((c, i) => {
      let input: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(c.args || '{}');
        if (parsed && typeof parsed === 'object') input = parsed;
      } catch {
        // Left empty: the tool answers with the argument it misses, and the model tries again.
      }
      return { id: c.id || `call_${i}`, name: c.name, input };
    });
    this.messages.push({
      role: 'assistant',
      content: text || null,
      ...(toolCalls.length > 0
        ? {
            tool_calls: toolCalls.map((c, i) => ({
              id: c.id,
              type: 'function' as const,
              function: { name: c.name, arguments: calls.filter(Boolean)[i].args || '{}' },
            })),
          }
        : {}),
    });
    // Some servers end a reply with tool calls as "stop".
    const stop = STOPS[finish] ?? (toolCalls.length > 0 ? 'tools' : 'end');
    // No price list: a local model costs nothing, a hosted one is unknown here.
    return { text, calls: toolCalls, stop, usage, cost: null } satisfies ChatTurn;
  }
}
