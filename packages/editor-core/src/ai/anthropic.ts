// Claude, through the dev server: the page sends Messages API requests to
// /__tf/ai/anthropic, and the server adds the key from .env. The page never
// sees the key (the `apiKey` below is a placeholder the server replaces).

import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { CLAUDE_MODELS } from './models.ts';
import { AI_BASE, type AiProvider, type Chat, type ChatInput, type ChatOptions, type ChatTurn } from './provider.ts';

/** US dollars per million tokens: input, output, cache read. Cache writes cost 1.25× input. */
const PRICES: Record<string, [number, number, number]> = {
  'claude-opus-5-5': [4, 20, 0.2],
  'claude-sonnet-5-5': [2, 10, 0.1],
  'claude-haiku-5-5': [0.1, 0.5, 0.01],
};

const STOPS: Record<string, ChatTurn['stop']> = { tool_use: 'tools', max_tokens: 'max_tokens', refusal: 'refusal' };

export class ClaudeProvider implements AiProvider {
  readonly id = 'anthropic';
  readonly label = 'Claude';
  readonly models = CLAUDE_MODELS;
  readonly hasEffort = true;
  private readonly client: Anthropic;

  /** `origin`: where the dev server is (the page's origin in the browser). */
  constructor(origin: string, fetchFn?: typeof fetch) {
    this.client = new Anthropic({
      baseURL: `${origin}${AI_BASE}/anthropic`,
      apiKey: 'added-by-the-dev-server',
      // Allowed because no key is in the page: the dev server holds it.
      dangerouslyAllowBrowser: true,
      defaultHeaders: { 'X-TinyForge': '1' },
      fetch: fetchFn,
    });
  }

  createChat(options: ChatOptions): Chat {
    return new ClaudeChat(this.client, options);
  }
}

class ClaudeChat implements Chat {
  private readonly messages: BetaMessageParam[] = [];
  private readonly tools: BetaToolUnion[];

  constructor(
    private readonly client: Anthropic,
    private readonly options: ChatOptions,
  ) {
    this.tools = options.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: { type: 'object' as const, ...t.schema },
    }));
  }

  async send(input: ChatInput, { signal, onText }: { signal?: AbortSignal; onText?: (d: string) => void } = {}) {
    const content: Array<BetaToolResultBlockParam | { type: 'text'; text: string }> = (input.results ?? []).map(
      (r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, is_error: r.isError === true }),
    );
    if (input.text) content.push({ type: 'text', text: input.text });
    this.messages.push({ role: 'user', content });
    const { system } = this.options;
    const { model, effort } = this.options.settings();
    let message: Anthropic.Beta.BetaMessage;
    try {
      const stream = this.client.beta.messages.stream(
        {
          model,
          max_tokens: 32000,
          thinking: { type: 'adaptive' },
          output_config: { effort },
          // If the model declines, the API retries on a suitable other model in the same call.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: system.map((p) => ({
            type: 'text' as const,
            text: p.text,
            ...(p.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
          })),
          tools: this.tools,
          // Also cache the conversation so far, so each step of a request rereads it cheaply.
          cache_control: { type: 'ephemeral' },
          messages: this.messages,
        },
        { signal },
      );
      if (onText) stream.on('text', onText);
      message = await stream.finalMessage();
    } catch (e) {
      this.messages.pop();
      throw e;
    }
    // The whole reply goes back next time, thinking blocks included.
    this.messages.push({ role: 'assistant', content: message.content as BetaContentBlockParam[] });
    const usage = {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
      cacheRead: message.usage.cache_read_input_tokens ?? 0,
      cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
    };
    const price = PRICES[message.model] ?? PRICES[model];
    const turn: ChatTurn = {
      text: message.content.map((b) => (b.type === 'text' ? b.text : '')).join(''),
      calls: message.content.flatMap((b) =>
        b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input as Record<string, unknown> }] : [],
      ),
      stop: STOPS[message.stop_reason ?? ''] ?? 'end',
      usage,
      cost: price
        ? (usage.input * price[0] +
            usage.cacheWrite * price[0] * 1.25 +
            usage.cacheRead * price[2] +
            usage.output * price[1]) /
          1e6
        : null,
    };
    return turn;
  }
}
