import { describe, expect, it, vi } from 'vitest';
import { GameHost, type WorkerLike } from '../src/game-host.ts';
import type { FromWorker, ToWorker } from '../src/protocol.ts';

class FakeWorker implements WorkerLike {
  sent: ToWorker[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(message: ToWorker): void {
    this.sent.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(message: FromWorker): void {
    this.onmessage?.({ data: message } as MessageEvent<FromWorker>);
  }
  types(): string[] {
    return this.sent.map((m) => m.type);
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  let tick: (() => void) | null = null;
  const logs: string[] = [];
  const host = new GameHost({
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    createCanvas: () => ({ transferControlToOffscreen: () => ({}) as OffscreenCanvas }),
    sprites: [],
    onLog: (_level, message) => logs.push(message),
    hangTimeoutMs: 3000,
    setTimer: (fn) => {
      tick = fn;
      return 1;
    },
    clearTimer: () => {
      tick = null;
    },
  });
  return { host, workers, logs, tick: () => tick?.() };
}

describe('GameHost', () => {
  it('sends init with the canvas first', () => {
    const { workers } = setup();
    expect(workers[0].sent[0].type).toBe('init');
  });

  it('delivers watch slices to the right listener and unsubscribes', () => {
    const { host, workers } = setup();
    const got: number[] = [];
    const stop = host.watch(100, 4, (bytes, offset) => got.push(offset, bytes[0]));
    const watchMsg = workers[0].sent.find((m) => m.type === 'watch') as Extract<ToWorker, { type: 'watch' }>;
    workers[0].emit({
      type: 'watches',
      ticks: 1,
      slices: [{ id: watchMsg.id, offset: 100, bytes: new Uint8Array([9, 0, 0, 0]).buffer }],
    });
    expect(got).toEqual([100, 9]);
    stop();
    expect(workers[0].types()).toContain('unwatch');
  });

  it('resolves snapshots by request id', async () => {
    const { host, workers } = setup();
    const p = host.snapshot();
    const req = workers[0].sent.at(-1) as Extract<ToWorker, { type: 'snapshot' }>;
    workers[0].emit({ type: 'snapshot', requestId: req.requestId, bytes: new Uint8Array([1, 2]).buffer });
    expect(Array.from(await p)).toEqual([1, 2]);
  });

  it('marks the game hung when pings go unanswered, and recovers', () => {
    vi.useFakeTimers();
    try {
      const { host, workers, tick } = setup();
      workers[0].emit({ type: 'status', status: 'running', game: 'pong' });
      tick(); // sends a ping
      vi.advanceTimersByTime(3500);
      tick();
      expect(host.session.getState().status).toBe('hung');
      const ping = workers[0].sent.find((m) => m.type === 'ping') as Extract<ToWorker, { type: 'ping' }>;
      workers[0].emit({ type: 'pong', id: ping.id });
      expect(host.session.getState().status).toBe('running');
    } finally {
      vi.useRealTimers();
    }
  });

  it('kill replaces the worker, keeps watches and reloads the game fresh', async () => {
    const { host, workers } = setup();
    host.watch(0, 8, () => {});
    host.load('pong', new Uint8Array([0, 97, 115, 109]), { keepState: true });
    const pending = host.snapshot();
    host.kill();
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1].types()).toEqual(['init', 'watch', 'load']);
    expect((workers[1].sent[2] as Extract<ToWorker, { type: 'load' }>).keepState).toBe(false);
    await expect(pending).rejects.toThrow(/restarted/);
    expect(host.session.getState().generation).toBe(2);
  });
});
