import { RAM_START } from '@tinyforge/engine/memory-map';
import { listGames } from '@tinyforge/engine/tooling/compile-game';
import { describe, expect, it } from 'vitest';
import { Button, type InputState, NO_INPUT } from '../src/input.ts';
import { GameMachine } from '../src/machine.ts';
import { boot, cartridge, FIXED_SEED, hash, recordingHost } from './helpers.ts';

const HOLD_RIGHT: InputState = { ...NO_INPUT, buttons: Button.right | Button.start };

function run(machine: GameMachine, ticks: number, input: InputState = HOLD_RIGHT): string {
  for (let i = 0; i < ticks; i++) machine.tick(input);
  machine.draw();
  return hash(machine.framebuffer());
}

describe('GameMachine with real cartridges', () => {
  it('produces the same frame for the same seed and input', async () => {
    const a = run(await boot('pong'), 120);
    const b = run(await boot('pong'), 120);
    expect(a).toBe(b);
  });

  it('draws something other than a blank screen', async () => {
    const machine = await boot('pong');
    machine.draw();
    const pixels = new Uint32Array(machine.framebuffer().buffer, 0, 320 * 240);
    expect(new Set(pixels).size).toBeGreaterThan(1);
  });

  it('restores a snapshot exactly', async () => {
    const machine = await boot('pong');
    run(machine, 30);
    const snap = machine.snapshot();
    const first = run(machine, 60);
    machine.restore(snap);
    expect(run(machine, 60)).toBe(first);
  });

  it('keeps game state across a hot reload', async () => {
    const straight = await boot('pong');
    const expected = run(straight, 90);

    const reloaded = await boot('pong');
    run(reloaded, 45);
    await reloaded.load(await cartridge('pong'), { keepState: true });
    for (let i = 0; i < 45; i++) reloaded.tick(HOLD_RIGHT);
    reloaded.draw();
    expect(hash(reloaded.framebuffer())).toBe(expected);
  });

  it('rejects a module without the lifecycle exports', async () => {
    // (module (import "env" "memory" (memory 16 16)))
    const empty = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x02, 0x10, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x06, 0x6d, 0x65, 0x6d,
      0x6f, 0x72, 0x79, 0x02, 0x01, 0x10, 0x10,
    ]);
    const machine = new GameMachine(recordingHost().host);
    await expect(machine.load(empty)).rejects.toThrow(/missing required exports: init, update, draw/);
  });

  describe.each(listGames())('%s', (name) => {
    it('boots and runs 120 ticks without aborting', async () => {
      const rec = recordingHost();
      const machine = new GameMachine(rec.host);
      machine.seed = FIXED_SEED;
      await machine.load(await cartridge(name));
      run(machine, 120);
      const errors = rec.logs.filter((l) => l.level === 'ABORT' || l.level === 'ERROR');
      expect(errors).toEqual([]);
      expect(machine.aborted).toBe(false);
    });
  });

  describe('tetris', () => {
    // Offsets into tetris's Vars struct at RAM_START.
    const CURRENT_Y = 12;
    const FALL_DELAY = 20;
    const START: InputState = { ...NO_INPUT, buttons: Button.start };
    const UP: InputState = { ...NO_INPUT, buttons: Button.up };

    it('falls one row every 48 frames at level 0', async () => {
      const machine = await boot('tetris');
      machine.tick(START);
      expect(machine.read(RAM_START + FALL_DELAY, 1)[0]).toBe(48);
      const y = () => new DataView(machine.read(RAM_START + CURRENT_Y, 4).buffer).getInt32(0, true);
      const start = y();
      for (let i = 0; i < 47; i++) machine.tick(NO_INPUT);
      expect(y()).toBe(start);
      machine.tick(NO_INPUT);
      expect(y()).toBe(start + 1);
    });

    it('plays music, lock and game over sounds', async () => {
      const rec = recordingHost();
      const machine = await boot('tetris', rec.host);
      machine.tick(START);
      // Hard drop every other frame until the stack tops out.
      for (let i = 0; i < 200; i++) machine.tick(i % 2 === 0 ? UP : NO_INPUT);
      const ids = rec.audio.flatMap((c) => (c.type === 'sfx' ? [c.id] : []));
      expect(ids).toContain('tetris_lock');
      expect(ids).toContain('tetris_gameover');
      expect(rec.audio[0]).toMatchObject({ type: 'music', id: 'tetris_theme' });
      expect(rec.audio.some((c) => c.type === 'stopMusic')).toBe(true);
    });
  });

  describe('pong audio', () => {
    const START: InputState = { ...NO_INPUT, buttons: Button.start };

    it('plays music, countdown, hit, score and win sounds', async () => {
      const rec = recordingHost();
      const machine = await boot('pong', rec.host);
      machine.tick(START);
      // Paddles stay centered for the first serve, so the ball rallies.
      for (let i = 0; i < 600; i++) machine.tick(NO_INPUT);
      // Then the bottom paddle moves out of the way until player 1 wins.
      for (let i = 0; i < 3000; i++) machine.tick(HOLD_RIGHT);
      const ids = rec.audio.flatMap((c) => (c.type === 'sfx' ? [c.id] : []));
      expect(rec.audio[0]).toMatchObject({ type: 'music', id: 'pong_theme' });
      expect(ids.slice(0, 4)).toEqual(['pong_tick', 'pong_tick', 'pong_tick', 'pong_go']);
      for (const id of ['pong_serve', 'pong_hit_p1', 'pong_hit_p2', 'pong_score', 'pong_win']) {
        expect(ids).toContain(id);
      }
      expect(rec.audio.some((c) => c.type === 'stopMusic')).toBe(true);
    });
  });
});
