import { RAM_START, SDK_RNG_SEED_ADDR } from '@tinyforge/engine/memory-map';
import { compileGame } from '@tinyforge/engine/tooling/compile-game';
import { Button, NO_INPUT } from '@tinyforge/runtime';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FromWorker } from '../src/protocol.ts';
import { GameWorkerCore } from '../src/worker-core.ts';

let pong: ArrayBuffer;

beforeAll(async () => {
  const result = await compileGame('pong', 'debug');
  if (!result.ok) throw new Error(result.log);
  pong = result.wasm.buffer as ArrayBuffer;
});

/** A worker core with a manual clock and frame queue. */
function harness() {
  const posted: FromWorker[] = [];
  let time = 0;
  let pendingFrame: ((now: number) => void) | null = null;
  const core = new GameWorkerCore({
    post: (m) => posted.push(m),
    now: () => time,
    requestFrame: (cb) => {
      pendingFrame = cb;
    },
    fetch: async (url) => ({
      ok: url.endsWith('pong.wasm'),
      status: url.endsWith('pong.wasm') ? 200 : 404,
      arrayBuffer: async () => pong.slice(0),
      text: async () => 'not found',
    }),
  });
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) {
      time += 1000 / 60;
      const cb = pendingFrame;
      pendingFrame = null;
      cb?.(time);
    }
  };
  const of = <T extends FromWorker['type']>(type: T) =>
    posted.filter((m): m is Extract<FromWorker, { type: T }> => m.type === type);
  return { core, posted, frames, of };
}

async function loaded(seed = 1234) {
  const h = harness();
  await h.core.handle({ type: 'load', url: '/pong.wasm', name: 'pong', keepState: false, seed });
  return h;
}

describe('GameWorkerCore', () => {
  it('loads a cartridge, applies the seed and starts running', async () => {
    const h = await loaded(1234);
    expect(h.of('status').map((m) => m.status)).toEqual(['loading', 'running']);
    h.frames(3);
    const watches: number[] = [];
    await h.core.handle({ type: 'watch', id: 1, offset: SDK_RNG_SEED_ADDR, length: 4 });
    const last = h.of('watches').at(-1);
    watches.push(new DataView(last?.slices[0].bytes as ArrayBuffer).getInt32(0, true));
    expect(watches[0]).not.toBe(0);
  });

  it('pushes each watched range after every frame', async () => {
    const h = await loaded();
    await h.core.handle({ type: 'watch', id: 7, offset: RAM_START, length: 256 });
    const before = h.of('watches').length;
    h.frames(10);
    const pushed = h.of('watches').slice(before);
    expect(pushed).toHaveLength(10);
    expect(pushed.every((m) => m.slices[0].id === 7 && m.slices[0].bytes.byteLength === 256)).toBe(true);
    // ticks advance one per frame at 60 Hz
    expect(pushed.at(-1)?.ticks).toBeGreaterThan(pushed[0].ticks);
  });

  it('stops pushing after unwatch', async () => {
    const h = await loaded();
    await h.core.handle({ type: 'watch', id: 1, offset: 0, length: 16 });
    await h.core.handle({ type: 'unwatch', id: 1 });
    const before = h.of('watches').length;
    h.frames(5);
    expect(h.of('watches').length).toBe(before);
  });

  it('pauses, single-steps and resumes', async () => {
    const h = await loaded();
    h.frames(5);
    await h.core.handle({ type: 'pause' });
    await h.core.handle({ type: 'watch', id: 1, offset: 0, length: 4 });
    const ticksAtPause = h.of('watches').at(-1)?.ticks ?? -1;
    h.frames(5); // no frames run while paused
    await h.core.handle({ type: 'step', count: 3 });
    expect(h.of('watches').at(-1)?.ticks).toBe(ticksAtPause + 3);
    await h.core.handle({ type: 'resume' });
    expect(h.of('status').at(-1)?.status).toBe('running');
  });

  it('keeps state on a hot reload and stays paused if it was paused', async () => {
    const h = await loaded();
    await h.core.handle({ type: 'input', input: { ...NO_INPUT, buttons: Button.start | Button.right } });
    h.frames(30);
    await h.core.handle({ type: 'pause' });
    const snap = h.posted.length;
    await h.core.handle({ type: 'snapshot', requestId: 1 });
    const before = new Uint8Array((h.posted[snap] as { bytes: ArrayBuffer }).bytes).slice(RAM_START, RAM_START + 512);
    await h.core.handle({ type: 'load', url: '/pong.wasm', name: 'pong', keepState: true, seed: null });
    expect(h.of('status').at(-1)?.status).toBe('paused');
    await h.core.handle({ type: 'snapshot', requestId: 2 });
    const after = new Uint8Array((h.of('snapshot').at(-1) as { bytes: ArrayBuffer }).bytes).slice(
      RAM_START,
      RAM_START + 512,
    );
    expect(after).toEqual(before);
  });

  it('round-trips a snapshot', async () => {
    const h = await loaded();
    await h.core.handle({ type: 'input', input: { ...NO_INPUT, buttons: Button.start } });
    h.frames(20);
    await h.core.handle({ type: 'pause' });
    await h.core.handle({ type: 'snapshot', requestId: 1 });
    const snap = h.of('snapshot')[0].bytes.slice(0);
    await h.core.handle({ type: 'step', count: 30 });
    await h.core.handle({ type: 'restore', requestId: 2, bytes: snap });
    await h.core.handle({ type: 'snapshot', requestId: 3 });
    expect(new Uint8Array(h.of('snapshot')[1].bytes)).toEqual(new Uint8Array(snap));
    expect(h.of('restored')).toHaveLength(1);
  });

  it('reports a failed load without crashing', async () => {
    const h = harness();
    await h.core.handle({ type: 'load', url: '/missing.wasm', name: 'missing', keepState: false, seed: null });
    expect(h.of('status').at(-1)?.status).toBe('aborted');
    expect(h.of('log').some((l) => l.level === 'ERROR' && l.message.includes('Failed to load missing'))).toBe(true);
  });

  it('answers pings', async () => {
    const h = harness();
    await h.core.handle({ type: 'ping', id: 5 });
    expect(h.of('pong')).toEqual([{ type: 'pong', id: 5 }]);
  });
});

describe('GameWorkerCore sprites', () => {
  let dino: ArrayBuffer;
  beforeAll(async () => {
    const result = await compileGame('dinoWorld', 'debug');
    if (!result.ok) throw new Error(result.log);
    dino = result.wasm.buffer as ArrayBuffer;
  });

  const ref = (id: string, version = 1, format = '') => ({ id, format, url: `/s/${id}.png?v=${version}` });

  /** A worker whose sprite files are 8×8 images; records every fetched URL. */
  function spriteHarness() {
    const posted: FromWorker[] = [];
    const fetched: string[] = [];
    const core = new GameWorkerCore({
      post: (m) => posted.push(m),
      now: () => 0,
      requestFrame: () => {},
      fetch: async (url) => {
        fetched.push(url);
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => (url.endsWith('.wasm') ? dino.slice(0) : new ArrayBuffer(1)),
          text: async () => '',
        };
      },
      decodeImage: async () => ({ width: 64, height: 8, rgba: new Uint8ClampedArray(64 * 8 * 4) }),
    });
    const of = <T extends FromWorker['type']>(type: T) =>
      posted.filter((m): m is Extract<FromWorker, { type: T }> => m.type === type);
    const sprites = () => fetched.filter((u) => u.startsWith('/s/'));
    return { core, of, fetched, sprites };
  }

  const library = [ref('coin', 1, '8x1'), ref('crocodile'), ref('dino', 1, '8x1'), ref('heart')];

  it("loads only the sprites the game's metadata lists", async () => {
    const h = spriteHarness();
    await h.core.handle({ type: 'init', canvas: fakeCanvas(), sprites: library });
    expect(h.sprites()).toEqual([]); // nothing until a game loads
    await h.core.handle({ type: 'load', url: '/dinoWorld.wasm', name: 'dinoWorld', keepState: false, seed: 1 });
    expect(h.sprites().sort()).toEqual(['/s/coin.png?v=1', '/s/dino.png?v=1']);
    expect(h.of('sprites').at(-1)).toMatchObject({ game: 'dinoWorld', spriteCount: 2 });
    expect(h.of('assets').at(-1)).toEqual({
      type: 'assets',
      game: 'dinoWorld',
      assets: { sprites: ['coin', 'dino'], sfx: ['tap'], music: [] },
    });
    expect(h.of('status').at(-1)?.status).toBe('running');
  });

  it('reloads a changed sprite in place, fetching only that file', async () => {
    const h = spriteHarness();
    await h.core.handle({ type: 'init', canvas: fakeCanvas(), sprites: library });
    await h.core.handle({ type: 'load', url: '/dinoWorld.wasm', name: 'dinoWorld', keepState: false, seed: 1 });
    const before = h.sprites().length;
    await h.core.handle({
      type: 'library',
      sprites: library.map((r) => (r.id === 'dino' ? ref('dino', 2, '8x1') : r)),
    });
    expect(h.sprites().slice(before)).toEqual(['/s/dino.png?v=2']);
    expect(h.of('sprites').at(-1)).toMatchObject({ spriteCount: 2 });
    // A hot reload reuses the decoded sprites.
    await h.core.handle({ type: 'load', url: '/dinoWorld.wasm', name: 'dinoWorld', keepState: true, seed: null });
    expect(h.sprites().length).toBe(before + 1);
  });

  it('reports a sprite missing from the library', async () => {
    const h = spriteHarness();
    await h.core.handle({ type: 'init', canvas: fakeCanvas(), sprites: [ref('coin', 1, '8x1')] });
    await h.core.handle({ type: 'load', url: '/dinoWorld.wasm', name: 'dinoWorld', keepState: false, seed: 1 });
    expect(h.of('sprites').at(-1)).toMatchObject({ spriteCount: 1 });
    expect(h.of('log').map((m) => m.message)).toContain('Sprite dino is not in the library');
  });
});

function fakeCanvas(): OffscreenCanvas {
  return { getContext: () => null } as unknown as OffscreenCanvas;
}
