import { describe, expect, it } from 'vitest';
import { AudioPlayer } from '../src/audio.ts';

class FakeNode {
  readonly connections: unknown[] = [];
  connect<T>(node: T): T {
    this.connections.push(node);
    return node;
  }
}

class FakeGain extends FakeNode {
  gain = { value: 1 };
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  started = false;
  start() {
    this.started = true;
  }
  stop() {}
}

function fakeContext() {
  const gains: FakeGain[] = [];
  const sources: FakeSource[] = [];
  const destination = {};
  const ctx = {
    state: 'running',
    destination,
    createGain() {
      const g = new FakeGain();
      gains.push(g);
      return g;
    },
    createBufferSource() {
      const s = new FakeSource();
      sources.push(s);
      return s;
    },
    decodeAudioData: async () => ({}),
    resume: async () => {},
  };
  return { ctx: ctx as unknown as AudioContext, gains, sources, destination };
}

describe('AudioPlayer master volume', () => {
  it('routes the master gain to the speakers at full volume', () => {
    const { ctx, gains, destination } = fakeContext();
    const p = new AudioPlayer(() => {}, ctx);
    expect(gains[0].connections).toEqual([destination]);
    expect(p.outputGain).toBe(1);
  });

  it('sets, clamps and mutes the master gain', () => {
    const { ctx, gains } = fakeContext();
    const p = new AudioPlayer(() => {}, ctx);
    p.setOutput(0.25, false);
    expect(gains[0].gain.value).toBe(0.25);
    p.setOutput(3, false);
    expect(gains[0].gain.value).toBe(1);
    p.setOutput(-1, false);
    expect(gains[0].gain.value).toBe(0);
    p.setOutput(0.5, true);
    expect(gains[0].gain.value).toBe(0);
    p.setOutput(0.5, false);
    expect(gains[0].gain.value).toBe(0.5);
  });

  it('plays every sound through the master gain', async () => {
    const { ctx, gains, sources } = fakeContext();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(new ArrayBuffer(4))) as typeof fetch;
    try {
      const p = new AudioPlayer(() => {}, ctx);
      await p.load([{ id: '1', format: '', url: 'x.wav' }], []);
      p.play({ type: 'sfx', id: '1', volume: 0.5 });
      expect(sources[0].started).toBe(true);
      const perSound = sources[0].connections[0] as FakeGain;
      expect(perSound.gain.value).toBe(0.5);
      expect(perSound.connections).toEqual([gains[0]]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("keeps unchanged sounds, refetches changed ones and drops the previous game's", async () => {
    const { ctx } = fakeContext();
    const realFetch = globalThis.fetch;
    const fetched: string[] = [];
    globalThis.fetch = (async (url: string) => {
      fetched.push(url);
      return new Response(new ArrayBuffer(4));
    }) as typeof fetch;
    try {
      const p = new AudioPlayer(() => {}, ctx);
      const ref = (id: string, v: number) => ({ id, format: '', url: `${id}.wav?v=${v}` });
      await p.load([ref('a', 1), ref('b', 1)], [ref('m', 1)]);
      await p.load([ref('a', 1), ref('b', 2)], []);
      expect(fetched).toEqual(['a.wav?v=1', 'b.wav?v=1', 'm.wav?v=1', 'b.wav?v=2']);
      expect(p.counts).toEqual({ sfx: 2, music: 0 });
      // Overlapping loads: the last one called wins.
      const first = p.load([ref('x', 1)], []);
      const second = p.load([ref('y', 1)], []);
      await Promise.all([first, second]);
      expect(p.counts).toEqual({ sfx: 1, music: 0 });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('plays a sound requested while it is still loading, once it is loaded', async () => {
    const { ctx, sources } = fakeContext();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(new ArrayBuffer(4))) as typeof fetch;
    const warnings: string[] = [];
    try {
      const p = new AudioPlayer((w) => warnings.push(w), ctx);
      const loading = p.load([{ id: 'hit', format: '', url: 'hit.wav' }], [{ id: 'theme', format: '', url: 't.ogg' }]);
      p.play({ type: 'music', id: 'theme', volume: 1 });
      p.play({ type: 'sfx', id: 'hit', volume: 1 });
      p.play({ type: 'sfx', id: 'other', volume: 1 });
      expect(sources).toHaveLength(0);
      await loading;
      await Promise.resolve();
      expect(sources.map((s) => s.loop)).toEqual([true, false]);
      expect(warnings).toEqual(['SFX other not loaded']);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
