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

  describe('pong', () => {
    // Top paddle X (f32) is the first field of pong's Vars struct.
    const P1_X = 0;

    it('moves the top paddle with the second D-pad (A and D keys)', async () => {
      const machine = await boot('pong');
      machine.tick({ ...NO_INPUT, buttons: Button.start });
      const x = () => new DataView(machine.read(RAM_START + P1_X, 4).buffer).getFloat32(0, true);
      const start = x();
      for (let i = 0; i < 10; i++) machine.tick({ ...NO_INPUT, buttons: Button.b }); // D: P2_RIGHT
      expect(x()).toBeGreaterThan(start);
      const right = x();
      for (let i = 0; i < 10; i++) machine.tick({ ...NO_INPUT, buttons: Button.x }); // A: P2_LEFT
      expect(x()).toBeLessThan(right);
    });
  });

  describe('tetris', () => {
    // Offsets into tetris's Vars struct at RAM_START.
    const LINES = 4;
    const CURRENT_Y = 12;
    const STATE = 16;
    const FALL_DELAY = 20;
    const BOARD = 28; // sizeof<Vars>; 10x20 cells, one byte each
    const CLEARING = 3;
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

    it('blinks a full line for 36 frames, paused, then removes it', async () => {
      const machine = await boot('tetris');
      machine.tick(START);
      // Fill the bottom row, then hard drop: locking finds the full row.
      const mem = machine.snapshot();
      mem.fill(1, RAM_START + BOARD + 19 * 10, RAM_START + BOARD + 20 * 10);
      machine.restore(mem);
      machine.tick(UP);
      const byte = (offset: number) => machine.read(RAM_START + offset, 1)[0];
      expect(byte(STATE)).toBe(CLEARING);
      for (let i = 0; i < 35; i++) machine.tick(i % 2 === 0 ? UP : NO_INPUT);
      expect(byte(STATE)).toBe(CLEARING);
      expect(byte(LINES)).toBe(0);
      machine.tick(NO_INPUT);
      expect(byte(LINES)).toBe(1);
      expect(byte(STATE)).not.toBe(CLEARING);
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
  describe('tank duel', () => {
    // Layout of tankDuel's RAM: Vars (32 bytes), then two 16-byte tanks.
    const STATE = 0;
    const TANKS = 32;
    const PLAYING = 2;
    const MATCH_OVER = 4;
    const START: InputState = { ...NO_INPUT, buttons: Button.start };
    const RT: InputState = { ...NO_INPUT, buttons: Button.rt }; // player 1 fire
    const LT: InputState = { ...NO_INPUT, buttons: Button.lt }; // player 2 fire
    const hold = (buttons: number): InputState => ({ ...NO_INPUT, buttons });

    const view = (machine: GameMachine, offset: number, size: number) =>
      new DataView(machine.read(RAM_START + offset, size).buffer);
    const state = (m: GameMachine) => view(m, STATE, 1).getUint8(0);
    const tankX = (m: GameMachine, i: number) => view(m, TANKS + i * 16, 4).getFloat32(0, true);
    const wins = (m: GameMachine, i: number) => view(m, TANKS + i * 16 + 11, 1).getUint8(0);
    const ticks = (m: GameMachine, n: number, input: InputState = NO_INPUT) => {
      for (let i = 0; i < n; i++) m.tick(input);
    };
    /** From the title (or between rounds), wait out the 3-2-1 countdown. */
    const untilPlaying = (m: GameMachine) => {
      for (let i = 0; i < 400 && state(m) !== PLAYING; i++) m.tick(NO_INPUT);
      expect(state(m)).toBe(PLAYING);
    };

    it('runs the same every time', async () => {
      const play = async () => {
        const m = await boot('tankDuel');
        m.tick(START);
        ticks(m, 200, hold(Button.up | Button.y));
        ticks(m, 1, LT);
        ticks(m, 300, hold(Button.left | Button.b));
        m.draw();
        return hash(m.framebuffer());
      };
      expect(await play()).toBe(await play());
    });

    it('drives player 1 with the arrows and player 2 with WASD', async () => {
      const m = await boot('tankDuel');
      m.tick(START);
      untilPlaying(m);
      const p1 = tankX(m, 0);
      const p2 = tankX(m, 1);
      ticks(m, 20, hold(Button.left | Button.b)); // P1 west, P2 east (D key)
      expect(tankX(m, 0)).toBeLessThan(p1);
      expect(tankX(m, 1)).toBeGreaterThan(p2);
    });

    it('bounces a shell off a wall and back into its own tank', async () => {
      const rec = recordingHost();
      const m = await boot('tankDuel', rec.host);
      m.tick(START);
      untilPlaying(m);
      m.tick(RT); // player 1 faces the wall in front of them and fires
      ticks(m, 200);
      const ids = rec.audio.flatMap((c) => (c.type === 'sfx' ? [c.id] : []));
      expect(ids).toContain('tank_fire_p1');
      expect(ids).toContain('tank_bounce');
      expect(ids).toContain('tank_explode');
      expect(wins(m, 0)).toBe(0);
      expect(wins(m, 1)).toBe(1);
    });

    it('plays a best-of-5 match to the end', async () => {
      const rec = recordingHost();
      const m = await boot('tankDuel', rec.host);
      m.tick(START);
      // Round 1 (open top lane): both tanks drive up to it, then player 2
      // turns east and fires along it at player 1.
      untilPlaying(m);
      ticks(m, 120, hold(Button.up | Button.y));
      m.tick(hold(Button.b));
      m.tick(LT);
      ticks(m, 250);
      expect(wins(m, 1)).toBe(1);
      // Rounds 2 and 3: player 1 fires at the wall ahead and the bounce
      // comes back at them.
      for (let round = 2; round <= 3; round++) {
        untilPlaying(m);
        m.tick(RT);
        ticks(m, 250);
        expect(wins(m, 1)).toBe(round);
      }
      expect(state(m)).toBe(MATCH_OVER);
      expect(wins(m, 0)).toBe(0);

      const ids = rec.audio.flatMap((c) => (c.type === 'sfx' ? [c.id] : []));
      expect(rec.audio[0]).toMatchObject({ type: 'music', id: 'tank_theme' });
      expect(ids.slice(0, 4)).toEqual(['tank_tick', 'tank_tick', 'tank_tick', 'tank_go']);
      for (const id of ['tank_fire_p2', 'tank_explode', 'tank_win']) expect(ids).toContain(id);
      expect(rec.audio.some((c) => c.type === 'stopMusic')).toBe(true);

      // START on the result screen begins a fresh match.
      m.tick(NO_INPUT);
      m.tick(START);
      expect(wins(m, 1)).toBe(0);
    });
  });
});
