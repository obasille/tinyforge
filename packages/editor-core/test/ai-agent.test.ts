import { describe, expect, it } from 'vitest';
import { Agent } from '../src/ai/agent.ts';
import { lineDiff } from '../src/ai/diff.ts';
import { readSdkApi, sdkApi } from '../src/ai/prompt.ts';
import type { AiProvider, Chat, ChatInput, ChatTurn, ToolCall } from '../src/ai/provider.ts';
import { CommandStack } from '../src/commands.ts';
import { ProjectFiles } from '../src/project-files.ts';
import { createStore } from '../src/store.ts';
import { MemoryWorkspace } from './memory-workspace.ts';

const MAIN = 'export function init(): void {}\nexport function update(): void {}\nexport function draw(): void {}\n';

/** A model that plays back scripted turns and records what it was sent. */
function scripted(turns: Array<Partial<ChatTurn> | ((input: ChatInput) => Partial<ChatTurn>)>) {
  const inputs: ChatInput[] = [];
  const provider: AiProvider = {
    id: 'fake',
    label: 'Fake',
    models: ['fake'],
    hasEffort: false,
    createChat(): Chat {
      return {
        async send(input, { onText, signal } = {}) {
          inputs.push(input);
          if (signal?.aborted) throw new Error('aborted');
          const next = turns.shift();
          if (!next) throw new Error('no more turns');
          const turn = typeof next === 'function' ? next(input) : next;
          if (turn.text) onText?.(turn.text);
          return {
            text: '',
            calls: [],
            stop: turn.calls?.length ? 'tools' : 'end',
            usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
            cost: 0.01,
            ...turn,
          };
        },
      };
    },
  };
  return { provider, inputs };
}

let ids = 0;
const call = (name: string, input: Record<string, unknown> = {}): ToolCall => ({ id: `t${++ids}`, name, input });

async function setup(turns: Parameters<typeof scripted>[0], extra: Record<string, string> = {}) {
  const ws = new MemoryWorkspace({ 'games/pong/main.ts': MAIN, 'games/snake/main.ts': MAIN, ...extra });
  const files = new ProjectFiles(ws);
  await files.start();
  const stack = new CommandStack(createStore({}));
  const { provider, inputs } = scripted(turns);
  let builds = 0;
  const agent = new Agent({
    provider,
    settings: () => ({ model: 'fake', effort: 'medium' }),
    system: [{ text: 'rules', cache: true }],
    commands: stack,
    buildStatus: () => 'ok',
    context: {
      files,
      game: 'pong',
      build: async () => {
        builds++;
        const text = (await files.readText('games/pong/main.ts')) ?? '';
        return text.includes('oops')
          ? {
              ok: false,
              log: 'ERROR',
              diagnostics: [
                {
                  path: 'games/pong/main.ts',
                  line: 2,
                  column: 1,
                  from: 0,
                  to: 1,
                  severity: 'error' as const,
                  message: 'Bad',
                },
              ],
            }
          : ({ ok: true, log: '', diagnostics: [] } as never);
      },
      invalidate: () => {},
      gameLog: () => 'running',
      assets: () => [],
    },
  });
  return { ws, files, stack, agent, inputs, builds: () => builds };
}

describe('code agent', () => {
  it('edits the game, compiles, and makes the request one undo step', async () => {
    const { ws, stack, agent, inputs } = await setup([
      // main.ts is in the first request's context, so it counts as read.
      {
        calls: [
          call('edit_file', { path: 'games/pong/main.ts', old: 'update(): void {}', new: 'update(): void { oops }' }),
        ],
      },
      { calls: [call('compile')] },
      (input) => {
        expect(input.results?.[0].content).toContain('games/pong/main.ts:2:1 Bad');
        return { calls: [call('edit_file', { path: 'games/pong/main.ts', old: 'oops', new: '' })] };
      },
      { calls: [call('compile'), call('write_file', { path: 'games/pong/NOTES.md', content: '# Pong' })] },
      { text: 'Done.' },
    ]);
    await agent.ask('Make the ball faster');
    expect(inputs[0].text).toContain('games/pong/main.ts:\nexport function init');
    expect(inputs[0].text).toContain('Make the ball faster');
    expect(ws.text('games/pong/main.ts')).toContain('update(): void {  }');
    expect(ws.text('games/pong/NOTES.md')).toBe('# Pong');
    const state = agent.state.getState();
    expect(state.running).toBe(false);
    expect(state.items.map((i) => i.kind)).toEqual([
      'user',
      'step',
      'step',
      'step',
      'step',
      'step',
      'assistant',
      'changes',
    ]);
    expect(state.items[2]).toMatchObject({ kind: 'step', text: 'Compiled: Failed:', ok: false });
    expect(state.cost).toBeCloseTo(0.05);
    expect(stack.getState().history).toEqual(['AI: Make the ball faster']);
    stack.undo();
    await stack.idle();
    expect(ws.text('games/pong/main.ts')).toBe(MAIN);
    expect(ws.data.has('games/pong/NOTES.md')).toBe(false);
    stack.redo();
    await stack.idle();
    expect(ws.text('games/pong/NOTES.md')).toBe('# Pong');
  });

  it('refuses writes outside the game, unread files, binary files and files changed by the user', async () => {
    const { ws, agent, inputs } = await setup(
      [
        {
          calls: [
            call('write_file', { path: 'games/snake/main.ts', content: 'x' }),
            call('write_file', { path: 'assets/sfx/a.wav', content: 'x' }),
            call('write_file', { path: 'games/pong/util.ts', content: 'export const A = 1;' }),
            call('write_file', { path: 'games/pong/extra.ts', content: 'y' }),
            call('delete_file', { path: 'games/pong/main.ts' }),
            call('read_file', { path: '../secret' }),
          ],
        },
        () => {
          ws.external('games/pong/util.ts', 'export const A = 2;');
          return { calls: [call('edit_file', { path: 'games/pong/util.ts', old: 'A = 1', new: 'A = 3' })] };
        },
        { text: 'ok' },
      ],
      { 'games/pong/extra.ts': 'old' },
    );
    await agent.ask('Try things');
    const results = inputs[1].results?.map((r) => [r.isError === true, r.content]);
    expect(results).toEqual([
      [true, 'You can only change files in games/pong/'],
      [true, 'You can only change files in games/pong/'],
      [false, 'Created games/pong/util.ts'],
      [true, 'Read games/pong/extra.ts before changing it.'],
      [true, 'main.ts cannot be deleted'],
      [true, 'Invalid path "../secret"'],
    ]);
    expect(inputs[2].results?.[0].content).toMatch(/changed since you last read it/);
    expect(ws.text('games/pong/util.ts')).toBe('export const A = 2;');
  });

  it('keeps partial changes when stopped, and answers the unrun tools next time', async () => {
    let agentRef: Agent | null = null;
    const { ws, stack, agent, inputs } = await setup([
      {
        calls: [call('write_file', { path: 'games/pong/a.ts', content: 'a' }), call('compile')],
      },
      { text: 'never' },
      { text: 'Hello again' },
    ]);
    agentRef = agent;
    // Stop as soon as the first tool has run.
    const unsubscribe = agent.state.subscribe(() => {
      if (ws.data.has('games/pong/a.ts')) agentRef?.stop();
    });
    await agent.ask('Write a');
    unsubscribe();
    expect(agent.state.getState().items.some((i) => i.kind === 'error' && i.text === 'Stopped.')).toBe(true);
    expect(stack.getState().history).toEqual(['AI: Write a']);
    await agent.ask('Next');
    const results = inputs.at(-1)?.results ?? [];
    expect(results.map((r) => r.isError)).toEqual([true, true]);
    expect(results[0].content).toContain('stopped');
  });

  it('reports a failed request and a refusal', async () => {
    const { agent } = await setup([{ stop: 'refusal' }]);
    await agent.ask('x');
    const errors = () => agent.state.getState().items.flatMap((i) => (i.kind === 'error' ? [i.text] : []));
    expect(errors()).toEqual(['The model declined this request.']);
    await agent.ask('y');
    expect(errors()[1]).toContain('The request failed');
    expect(agent.state.getState().running).toBe(false);
  });
});

describe('prompt and diff', () => {
  it('lists the SDK API without bodies', async () => {
    const api = sdkApi([
      {
        path: 'engine/sdk/input.ts',
        text: 'export enum Button {\n  A = 0,\n  B = 1,\n}\nexport function drawLine(\n  x: i32,\n  y: i32,\n): void {\n  body();\n}\nfunction hidden(): void {}\nexport const RAM_START: u32 = 0x100;',
      },
    ]);
    expect(api).toBe(
      '// engine/sdk/input.ts\nexport enum Button {\n  A = 0,\n  B = 1,\n}\nexport function drawLine(\n  x: i32,\n  y: i32,\n): void\nexport const RAM_START: u32 = 0x100;',
    );
    const ws = new MemoryWorkspace({
      'engine/sdk/a.ts': 'export function a(): void {}',
      'engine/sdk/index.ts': 'export * from "./a";',
    });
    const files = new ProjectFiles(ws);
    await files.start();
    expect(await readSdkApi(files)).toBe('// engine/sdk/a.ts\nexport function a(): void');
  });

  it('diffs lines with context', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n');
    const after = ['a', 'b', 'c', 'D', 'e', 'f', 'g', 'h'].join('\n');
    expect(lineDiff(before, after, 1).map((l) => `${l.kind}${l.text}`)).toEqual(['…', ' c', '-d', '+D', ' e', '…']);
    expect(lineDiff(null, 'x').map((l) => l.kind)).toEqual(['+']);
  });
});
