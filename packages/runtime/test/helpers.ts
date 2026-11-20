import { createHash } from 'node:crypto';
import { compileGame } from '@tinyforge/engine/tooling/compile-game';
import { type AudioCommand, GameMachine, type LogLevel } from '../src/index.ts';

export const FIXED_SEED = 0x1234567;

const cache = new Map<string, Uint8Array<ArrayBuffer>>();

/** Release build of a game, compiled once per test file. */
export async function cartridge(name: string): Promise<Uint8Array<ArrayBuffer>> {
  const hit = cache.get(name);
  if (hit) return hit;
  const result = await compileGame(name, 'release');
  if (!result.ok) throw new Error(`Failed to compile ${name}:\n${result.log}`);
  cache.set(name, result.wasm);
  return result.wasm;
}

export function recordingHost() {
  const logs: Array<{ level: LogLevel; message: string }> = [];
  const audio: AudioCommand[] = [];
  return {
    logs,
    audio,
    host: {
      log: (level: LogLevel, message: string) => logs.push({ level, message }),
      audio: (command: AudioCommand) => audio.push(command),
    },
  };
}

/** A machine with the fixed seed set before init(). */
export async function boot(name: string, host = recordingHost().host): Promise<GameMachine> {
  const machine = new GameMachine(host);
  machine.seed = FIXED_SEED;
  await machine.load(await cartridge(name));
  return machine;
}

export function hash(bytes: Uint8Array | Uint8ClampedArray): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}
