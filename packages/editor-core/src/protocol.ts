// Messages between the editor (main thread) and the game Worker.
//
// The Worker owns the WebAssembly memory and the OffscreenCanvas. The editor
// never reads memory directly: it asks for copies. Memory watches are pushed
// after every drawn frame, so a viewer showing a small address range updates
// every frame for the cost of a few KB per message.

import type { AudioCommand, InputState, LogLevel } from '@tinyforge/runtime';

export interface AssetRef {
  id: string;
  format: string;
  url: string;
}

export interface AssetManifest {
  games: string[];
  sprites: AssetRef[];
  sfx: AssetRef[];
  music: AssetRef[];
}

export type RunStatus = 'idle' | 'loading' | 'running' | 'paused' | 'aborted' | 'hung';

export interface FrameStats {
  fps: number;
  updateMs: number;
  drawMs: number;
  /** Updates run in the last frame (0..maxSteps). */
  updates: number;
  /** update() calls since init. */
  ticks: number;
  seed: number;
}

export type ToWorker =
  | { type: 'init'; canvas: OffscreenCanvas; sprites: AssetRef[] }
  | { type: 'load'; url: string; name: string; keepState: boolean; seed: number | null }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'step'; count: number }
  | { type: 'restart'; seed: number | null }
  | { type: 'input'; input: InputState }
  | { type: 'watch'; id: number; offset: number; length: number }
  | { type: 'unwatch'; id: number }
  | { type: 'snapshot'; requestId: number }
  | { type: 'restore'; requestId: number; bytes: ArrayBuffer }
  | { type: 'ping'; id: number };

export type FromWorker =
  | { type: 'ready'; spriteCount: number; spriteBytes: number }
  | { type: 'status'; status: RunStatus; game: string | null }
  | { type: 'log'; level: LogLevel | 'HOST'; message: string }
  | { type: 'audio'; command: AudioCommand }
  | { type: 'stats'; stats: FrameStats }
  | { type: 'watches'; ticks: number; slices: Array<{ id: number; offset: number; bytes: ArrayBuffer }> }
  | { type: 'snapshot'; requestId: number; bytes: ArrayBuffer }
  | { type: 'restored'; requestId: number }
  | { type: 'pong'; id: number };
