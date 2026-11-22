// The code agent: a chat with a model that calls the tools in tools.ts until
// the request is done. One Agent per game; its conversation lasts while the
// editor is open. Each request's changes become one undo step.

import type { FileCommand } from '../commands.ts';
import { createStore, type Store } from '../store.ts';
import { gameContext } from './prompt.ts';
import {
  type AiProvider,
  addUsage,
  type Chat,
  type ChatInput,
  type ChatSettings,
  emptyUsage,
  type SystemPart,
  type ToolCall,
  type ToolResult,
  type Usage,
} from './provider.ts';
import { AGENT_TOOLS, type AgentContext, AgentTools, type FileChangeView, ToolError } from './tools.ts';

export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'step'; text: string; ok: boolean }
  | { kind: 'error'; text: string }
  | { kind: 'changes'; files: FileChangeView[]; cost: number | null };

export interface AgentState {
  items: ChatItem[];
  running: boolean;
  /** The whole conversation's usage and estimated cost (null when a price was unknown). */
  usage: Usage;
  cost: number | null;
}

export interface AgentOptions {
  provider: AiProvider;
  settings: () => ChatSettings;
  system: SystemPart[];
  context: AgentContext;
  commands: { runFile(command: FileCommand): Promise<void> };
  /** The game's last build, for the request context ("ok", "failed", "not built"). */
  buildStatus(): string;
  /** Most model replies in one request. */
  maxSteps?: number;
}

const short = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

function describe(call: ToolCall): string {
  const path = typeof call.input.path === 'string' ? call.input.path : '';
  const id = typeof call.input.id === 'string' ? call.input.id : '';
  const verbs: Record<string, string> = {
    list_files: 'Listed files',
    read_file: `Read ${path}`,
    edit_file: `Edited ${path}`,
    write_file: `Wrote ${path}`,
    delete_file: `Deleted ${path}`,
    list_assets: 'Listed assets',
    make_sprite: `Made sprite ${id}`,
    make_sound: `Made ${call.input.kind === 'music' ? 'music' : 'sound'} ${id}`,
    compile: 'Compiled',
    game_log: 'Checked the game',
  };
  return verbs[call.name] ?? call.name;
}

export class Agent {
  readonly state: Store<AgentState> = createStore<AgentState>({
    items: [],
    running: false,
    usage: emptyUsage(),
    cost: 0,
  });
  private readonly chat: Chat;
  private readonly tools: AgentTools;
  /** Tool calls whose results the model has not received (a request was stopped). */
  private pending: ToolCall[] = [];
  private first = true;
  private abort: AbortController | null = null;

  constructor(private readonly options: AgentOptions) {
    this.chat = options.provider.createChat({
      settings: options.settings,
      system: options.system,
      tools: AGENT_TOOLS,
    });
    this.tools = new AgentTools(options.context);
  }

  private add(item: ChatItem): number {
    this.state.setState((s) => ({ ...s, items: [...s.items, item] }));
    return this.state.getState().items.length - 1;
  }

  private update(index: number, item: ChatItem): void {
    this.state.setState((s) => ({ ...s, items: s.items.map((it, i) => (i === index ? item : it)) }));
  }

  /** Run a request to the end (or until stopped). */
  async ask(request: string): Promise<void> {
    if (this.state.getState().running || !request.trim()) return;
    const { context, commands, maxSteps = 40 } = this.options;
    this.abort = new AbortController();
    const { signal } = this.abort;
    this.add({ kind: 'user', text: request });
    this.state.setState((s) => ({ ...s, running: true }));
    this.tools.begin(request);
    let cost: number | null = 0;
    try {
      const game = await gameContext(context.files, context.game, this.options.buildStatus(), { first: this.first });
      for (const f of game.shown) this.tools.markSeen(f.path, f.text);
      this.first = false;
      let input: ChatInput = {
        results: this.pending.map((c) => ({
          id: c.id,
          content: 'Not run: the user stopped the request.',
          isError: true,
        })),
        text: `${game.text}\n\n${request}`,
      };
      for (let step = 0; ; step++) {
        if (step >= maxSteps) {
          this.add({ kind: 'error', text: `Stopped after ${maxSteps} steps.` });
          break;
        }
        const index = this.add({ kind: 'assistant', text: '' });
        let text = '';
        const turn = await this.chat.send(input, {
          signal,
          onText: (delta) => {
            text += delta;
            this.update(index, { kind: 'assistant', text });
          },
        });
        this.pending = turn.calls;
        this.update(index, { kind: 'assistant', text: turn.text });
        cost = cost !== null && turn.cost !== null ? cost + turn.cost : null;
        this.state.setState((s) => ({
          ...s,
          usage: addUsage(s.usage, turn.usage),
          cost: s.cost !== null && turn.cost !== null ? s.cost + turn.cost : null,
        }));
        if (!turn.text) this.state.setState((s) => ({ ...s, items: s.items.filter((_, i) => i !== index) }));
        if (turn.stop === 'refusal') {
          this.add({ kind: 'error', text: 'The model declined this request.' });
          break;
        }
        if (turn.stop === 'max_tokens') {
          this.add({ kind: 'error', text: 'The reply was too long and was cut off. Try a smaller request.' });
          break;
        }
        if (turn.calls.length === 0) break;
        const results: ToolResult[] = [];
        for (const call of turn.calls) {
          if (signal.aborted) break;
          results.push(await this.runTool(call));
        }
        if (signal.aborted) throw signal.reason;
        input = { results };
      }
    } catch (e) {
      this.add({
        kind: 'error',
        text: signal.aborted ? 'Stopped.' : `The request failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      const files = this.tools.changes();
      const command = this.tools.commit(`AI: ${short(request.trim().split('\n')[0], 40)}`);
      if (command) await commands.runFile(command);
      if (files.length > 0 || cost) this.add({ kind: 'changes', files, cost });
      this.abort = null;
      this.state.setState((s) => ({ ...s, running: false }));
    }
  }

  private async runTool(call: ToolCall): Promise<ToolResult> {
    const label = describe(call);
    const index = this.add({ kind: 'step', text: label, ok: true });
    try {
      const content = await this.tools.run(call);
      const detail = call.name === 'compile' ? `: ${content.split('\n')[0]}` : '';
      this.update(index, { kind: 'step', text: `${label}${detail}`, ok: !content.startsWith('Failed') });
      return { id: call.id, content };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.update(index, { kind: 'step', text: `${label}: ${short(message, 120)}`, ok: false });
      // A refused tool is an answer the model can act on; anything else is a bug worth reporting as well.
      return { id: call.id, content: e instanceof ToolError ? message : `Error: ${message}`, isError: true };
    }
  }

  /** Stop the running request. Its changes so far stay, as one undo step. */
  stop(): void {
    this.abort?.abort();
  }
}
