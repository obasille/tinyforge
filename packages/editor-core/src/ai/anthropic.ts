// Claude, in one of two ways:
// - Through the dev server (pnpm dev): the page sends Messages API requests to
//   /__tf/ai/anthropic, and the server adds the key from .env. The page never
//   sees the key (the `apiKey` below is a placeholder the server replaces).
// - Direct (hosted mode, the deployed editor): requests go to
//   api.anthropic.com with the key from the unlocked key vault. The key is
//   read for each request and put in the header there, so the SDK client never
//   holds it, and locking the vault stops the next request.

import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { CLAUDE_MODELS } from './models.ts';
import {
  AI_BASE,
  type AiProvider,
  type Chat,
  type ChatInput,
  type ChatOptions,
  type ChatTurn,
  type SendOptions,
} from './provider.ts';

/** US dollars per million tokens: input, output, cache read. Cache writes cost 1.25× input. */
const PRICES: Record<string, [number, number, number]> = {
  'claude-opus-5-5': [4, 20, 0.2],
  'claude-sonnet-5-5': [2, 10, 0.1],
  'claude-haiku-5-5': [0.1, 0.5, 0.01],
};

/** The Messages API, called directly in hosted mode. */
export const ANTHROPIC_API = 'https://api.anthropic.com';
const LOCKED = 'The key vault is locked. Unlock it to use the AI.';

const STOPS: Record<string, ChatTurn['stop']> = { tool_use: 'tools', max_tokens: 'max_tokens', refusal: 'refusal' };

export class ClaudeProvider implements AiProvider {
  readonly id = 'anthropic';
  readonly label = 'Claude';
  readonly models = CLAUDE_MODELS;
  readonly hasEffort = true;
  private readonly client: Anthropic;
  /** Throws when a request cannot be sent (direct, with the vault locked). */
  private readonly ready: () => void = () => {};

  /**
   * `origin`: where the dev server is (the page's origin in the browser).
   * `{ apiKey }`: call the API directly, with the key this returns for each
   * request (null when the vault is locked).
   */
  constructor(target: string | { apiKey: () => string | null }, fetchFn?: typeof fetch) {
    if (typeof target === 'string') {
      this.client = new Anthropic({
        baseURL: `${target}${AI_BASE}/anthropic`,
        apiKey: 'added-by-the-dev-server',
        // Allowed because no key is in the page: the dev server holds it.
        dangerouslyAllowBrowser: true,
        defaultHeaders: { 'X-TinyForge': '1' },
        fetch: fetchFn,
      });
      return;
    }
    const send = fetchFn ?? ((input, init) => fetch(input, init));
    this.client = new Anthropic({
      baseURL: ANTHROPIC_API,
      apiKey: 'set-for-each-request',
      // Hosted mode: the key is in the page, from the key vault, by design
      // (see the plan's security section). The SDK then also sends the
      // anthropic-dangerous-direct-browser-access header that CORS needs.
      dangerouslyAllowBrowser: true,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const key = target.apiKey();
        if (!key) throw new Error(LOCKED);
        const headers = new Headers(init?.headers);
        headers.set('x-api-key', key);
        return send(input, { ...init, headers });
      }) as typeof fetch,
    });
    this.ready = () => {
      if (!target.apiKey()) throw new Error(LOCKED);
    };
  }

  createChat(options: ChatOptions): Chat {
    return new ClaudeChat(this.client, options, this.ready);
  }
}

class ClaudeChat implements Chat {
  private readonly messages: BetaMessageParam[] = [];
  private readonly tools: BetaToolUnion[];

  constructor(
    private readonly client: Anthropic,
    private readonly options: ChatOptions,
    private readonly ready: () => void,
  ) {
    this.tools = options.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: { type: 'object' as const, ...t.schema },
    }));
  }

  async send(input: ChatInput, { signal, onText, onThinking }: SendOptions = {}) {
    this.ready();
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
          // Summarized: the panel shows it, collapsed. It adds no request and no step.
          thinking: { type: 'adaptive', display: 'summarized' },
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
      if (onThinking) stream.on('thinking', (delta) => onThinking(delta));
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
