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
});
