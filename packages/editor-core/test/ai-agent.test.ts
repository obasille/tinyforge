import { describe, expect, it } from 'vitest';
import { Agent } from '../src/ai/agent.ts';
import { lineDiff } from '../src/ai/diff.ts';
import { renderPixels } from '../src/ai/pixels.ts';
import { readSdkApi, sdkApi } from '../src/ai/prompt.ts';
import type { AiProvider, Chat, ChatInput, ChatTurn, ToolCall } from '../src/ai/provider.ts';
import { pitchHz, renderSynth, type SynthNote } from '../src/ai/synth.ts';
import type { LibraryAsset } from '../src/asset-library.ts';
import { CommandStack } from '../src/commands.ts';
import { decodePng } from '../src/png.ts';
import { ProjectFiles } from '../src/project-files.ts';
import { createStore } from '../src/store.ts';
import { decodeWav } from '../src/wav.ts';
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

async function setup(
  turns: Parameters<typeof scripted>[0],
  extra: Record<string, string | Uint8Array> = {},
  assets: Array<Partial<LibraryAsset>> = [],
) {
  const ws = new MemoryWorkspace({ 'games/pong/main.ts': MAIN, 'games/snake/main.ts': MAIN, ...extra });
  const files = new ProjectFiles(ws);
  await files.start();
  const stack = new CommandStack(createStore({}));
  const { provider, inputs } = scripted(turns);
  let builds = 0;
  let assetFiles = files.assetFiles;
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
        assetFiles = files.assetFiles;
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
      assets: () => assets as LibraryAsset[],
    },
  });
  return { ws, files, stack, agent, inputs, builds: () => builds, assetFiles: () => assetFiles };
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

describe('asset generators', () => {
  const beep = { id: 'beep', kind: 'sfx', notes: [{ at: 0, len: 0.1, note: 'C5', to: 'C6' }] };
  const coin = {
    id: 'coin',
    palette: { y: '#ffd000', k: '#000' },
    frames: [
      ['.y.', 'yky', '.y.'],
      ['...', '.y.', '...'],
    ],
  };

  it('makes a sprite and a sound with sidecars, waits for them to be listed, and undoes them', async () => {
    const { ws, stack, agent, inputs, assetFiles } = await setup([
      { calls: [call('make_sprite', coin), call('make_sound', beep), call('compile')] },
      { text: 'Done.' },
    ]);
    await agent.ask('Add a coin');
    expect(inputs[1].results?.map((r) => r.content)).toEqual([
      'Made assets/sprites/coin~2x1.png: 2 frames of 3x3',
      'Made assets/sfx/beep.wav: 0.15 s',
      'ok',
    ]);
    // The compile saw the new assets.
    expect(assetFiles().sprites).toEqual(['coin~2x1.png']);
    expect(assetFiles().sfx).toEqual(['beep.wav']);
    const image = await decodePng(ws.data.get('assets/sprites/coin~2x1.png') as Uint8Array);
    expect([image?.width, image?.height]).toEqual([6, 3]);
    expect([...(image?.rgba.subarray(4, 8) ?? [])]).toEqual([255, 208, 0, 255]);
    expect([...(image?.rgba.subarray(0, 4) ?? [])]).toEqual([0, 0, 0, 0]);
    const sound = decodeWav(ws.data.get('assets/sfx/beep.wav') as Uint8Array);
    expect(sound?.sampleRate).toBe(44100);
    const sidecar = JSON.parse(ws.text('assets/sfx/beep.wav.json') ?? '{}');
    expect(sidecar).toMatchObject({ generator: 'tinyforge-ai', prompt: 'Add a coin', spec: { notes: beep.notes } });
    const changes = agent.state.getState().items.find((i) => i.kind === 'changes');
    expect(changes?.kind === 'changes' && changes.files.map((f) => [f.path, f.binary])).toEqual([
      ['assets/sprites/coin~2x1.png', true],
      ['assets/sprites/coin~2x1.png.json', false],
      ['assets/sfx/beep.wav', true],
      ['assets/sfx/beep.wav.json', false],
    ]);
    stack.undo();
    await stack.idle();
    expect([...ws.data.keys()].filter((p) => p.startsWith('assets/'))).toEqual([]);
  });

  it('asks before replacing an asset, and moves a sheet whose frame count changed', async () => {
    const coinAsset = { kind: 'sprites', id: 'coin', path: 'assets/sprites/coin~2x1.png', usedBy: [], sidecar: null };
    const beepAsset = { kind: 'sfx', id: 'beep', path: 'assets/sfx/beep.wav', usedBy: ['pong'], sidecar: null };
    const { ws, stack, agent, inputs } = await setup(
      [
        {
          calls: [
            call('make_sound', beep),
            call('make_sprite', { ...coin, frames: [coin.frames[0]] }),
            // Made in this request: replaced without asking.
            call('make_sprite', coin),
          ],
        },
        { text: 'ok' },
      ],
      {
        'assets/sprites/coin~2x1.png': new Uint8Array([1]),
        'assets/sprites/coin~2x1.png.json': '{"license":"CC0"}',
        'assets/sfx/beep.wav': new Uint8Array([2]),
      },
      [coinAsset, beepAsset] as Array<Partial<LibraryAsset>>,
    );
    // The user keeps the sound and replaces the sprite.
    const answers = [false, true];
    const questions: string[] = [];
    agent.state.subscribe(() => {
      const open = agent.state.getState().items.find((i) => i.kind === 'confirm' && i.answer === null);
      if (open?.kind === 'confirm' && !questions.includes(open.text)) {
        questions.push(open.text);
        queueMicrotask(() => agent.answer(answers.shift() ?? false));
      }
    });
    await agent.ask('Redo the coin');
    expect(questions).toEqual([
      'Replace the sound "beep" (assets/sfx/beep.wav)? Used by: pong.',
      'Replace the sprite "coin" (assets/sprites/coin~2x1.png)?',
    ]);
    expect(inputs[1].results?.map((r) => r.content)).toEqual([
      'The user chose to keep sfx "beep". Pick another ID, or ask them.',
      'Made assets/sprites/coin.png: 1 frame of 3x3',
      'Made assets/sprites/coin~2x1.png: 2 frames of 3x3',
    ]);
    expect([...(ws.data.get('assets/sfx/beep.wav') ?? [])]).toEqual([2]);
    expect(ws.data.has('assets/sprites/coin.png')).toBe(false);
    expect(JSON.parse(ws.text('assets/sprites/coin~2x1.png.json') ?? '{}').generator).toBe('tinyforge-ai');
    stack.undo();
    await stack.idle();
    expect([...(ws.data.get('assets/sprites/coin~2x1.png') ?? [])]).toEqual([1]);
    expect(ws.text('assets/sprites/coin~2x1.png.json')).toBe('{"license":"CC0"}');
    expect(ws.data.has('assets/sprites/coin.png')).toBe(false);
  });

  it('answers no when the request is stopped during a question', async () => {
    const beepAsset = { kind: 'sfx', id: 'beep', path: 'assets/sfx/beep.wav', usedBy: [], sidecar: null };
    const { ws, agent } = await setup(
      [{ calls: [call('make_sound', beep)] }, { text: 'never' }],
      { 'assets/sfx/beep.wav': new Uint8Array([2]) },
      [beepAsset] as Array<Partial<LibraryAsset>>,
    );
    agent.state.subscribe(() => {
      if (agent.state.getState().items.some((i) => i.kind === 'confirm' && i.answer === null)) agent.stop();
    });
    await agent.ask('New beep');
    const items = agent.state.getState().items;
    expect(items.find((i) => i.kind === 'confirm')).toMatchObject({ answer: false });
    expect(items.some((i) => i.kind === 'error' && i.text === 'Stopped.')).toBe(true);
    expect([...(ws.data.get('assets/sfx/beep.wav') ?? [])]).toEqual([2]);
    expect(agent.state.getState().running).toBe(false);
  });
});

describe('asset list', () => {
  it('names each asset file and its sidecar, and explains a wrong sidecar guess', async () => {
    const cover = {
      kind: 'sprites',
      id: 'pong_cover',
      path: 'assets/sprites/pong_cover.png',
      cols: 1,
      rows: 1,
      image: { width: 64, height: 64 },
      usedBy: ['pong'],
      sidecar: null,
    };
    const jump = { kind: 'sfx', id: 'jump', path: 'assets/sfx/jump.wav', usedBy: [], sidecar: { tags: ['retro'] } };
    const { inputs, agent } = await setup(
      [
        {
          calls: [
            call('list_assets'),
            call('read_file', { path: 'assets/sprites/pong_cover.json' }),
            call('read_file', { path: 'assets/sfx/jump.wav.json' }),
          ],
        },
        { text: 'ok' },
      ],
      {
        'assets/sprites/pong_cover.png': new Uint8Array([1]),
        'assets/sfx/jump.wav': new Uint8Array([1]),
        'assets/sfx/jump.wav.json': '{"tags":["retro"]}',
      },
      [cover, jump] as Array<Partial<LibraryAsset>>,
    );
    await agent.ask('Look at the assets');
    const [list, guess, sidecar] = inputs[1].results?.map((r) => r.content) ?? [];
    expect(list).toBe(
      'sprite pong_cover: assets/sprites/pong_cover.png, frame 64x64, 1x1 frames; used by: pong\n' +
        'sfx jump: assets/sfx/jump.wav; tags: retro; sidecar: assets/sfx/jump.wav.json',
    );
    expect(guess).toBe(
      "assets/sprites/pong_cover.json not found. A sidecar is named after the asset's file (assets/sprites/<file>.json); list_assets shows the files and their sidecars. No sprites asset has one.",
    );
    expect(sidecar).toBe('{"tags":["retro"]}');
  });
});

describe('synth and pixels', () => {
  it('plays notes', () => {
    expect(pitchHz('A4')).toBe(440);
    expect(pitchHz('C4')).toBeCloseTo(261.63, 2);
    expect(pitchHz('Bb3')).toBeCloseTo(pitchHz('A#3'));
    const spec = {
      bpm: 120,
      notes: [
        { at: 0, len: 1, note: 'C4', wave: 'triangle' as const },
        { at: 0, len: 1, note: 2000, wave: 'noise' as const, vol: 1 },
      ],
    };
    const a = renderSynth(spec);
    // One beat at 120 bpm plus the default release, at the effects rate.
    expect(a.sampleRate).toBe(44100);
    expect(a.channels[0].length).toBe(Math.ceil(0.55 * 44100));
    expect(renderSynth(spec).channels[0]).toEqual(a.channels[0]);
    // Normalized to the games' effect loudness, and faded out at the end.
    expect(Math.max(...a.channels[0].map(Math.abs))).toBeCloseTo(0.35, 3);
    expect(a.channels[0].at(-1)).toBeCloseTo(0, 3);
    expect(() => renderSynth({ notes: [{ at: 0, len: 1, note: 'H4' }] })).toThrow('Not a note');
    expect(() => renderSynth({ notes: [{ at: 0, len: 1, note: 'C4', wave: 'pulse' as never }] })).toThrow('wave');
    expect(() => renderSynth({ notes: [{ at: 119, len: 2, note: 'C4' }] })).toThrow('at most 120 s');
    expect(() => renderSynth({ notes: [] })).toThrow('at least one note');
  });

  it('matches chiptune.py: LFSR noise, a 16-step triangle, and track lines', () => {
    const one = (note: SynthNote) =>
      renderSynth({ notes: [{ attack: 0, sustain: 1, release: 0, vol: 1, ...note }], loop: true }).channels[0];
    // chiptune.py's Noise() clocked at 4000 Hz: the same bits.
    const noise = one({ at: 0, len: 0.01, note: 4000, wave: 'noise' });
    const bits = [...noise.slice(0, 200)].map((v) => (v > 0 ? '1' : '0')).join('');
    expect(bits).toBe(`${'1'.repeat(11)}${'0'.repeat(154)}${'1'.repeat(11)}${'0'.repeat(24)}`);
    const levels = new Set([...one({ at: 0, len: 0.01, note: 'A4', wave: 'triangle' })].map((v) => v.toFixed(4)));
    expect(levels.size).toBeLessThanOrEqual(16);
    // "C4 . E4 - G4": C4 held two steps, a rest, G4; like parse_line.
    const lead = renderSynth(
      { tracks: [{ line: 'C4 . E4 - G4', step: 0.1, hold: 1, release: 0, attack: 0, sustain: 1 }], loop: true },
      { sampleRate: 1000, volume: 1 },
    ).channels[0];
    expect(lead.length).toBe(500);
    expect([...lead.slice(300, 400)].every((v) => v === 0)).toBe(true);
    expect([...lead.slice(0, 200)].some((v) => v !== 0)).toBe(true);
    expect(() => renderSynth({ tracks: [{ line: 'C4 X4', step: 0.1 }] })).toThrow('Not a note: "X4"');
  });

  it('draws a grid and refuses a bad one', () => {
    expect(() => renderPixels({ palette: {}, frames: [['x']] })).toThrow('"x" is not in the palette');
    expect(() => renderPixels({ palette: { a: '#fff' }, frames: [['aa', 'a']] })).toThrow('must have 2 characters');
    expect(() => renderPixels({ palette: { a: 'red' }, frames: [['a']] })).toThrow('colour');
    expect(() => renderPixels({ palette: {}, frames: [['.'.repeat(65)]] })).toThrow('1 to 64');
    expect(renderPixels({ palette: { a: '#11223380' }, frames: [['a']] }).rgba).toEqual(
      new Uint8ClampedArray([0x11, 0x22, 0x33, 0x80]),
    );
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
