import {
  ASSETS_SECTION,
  cartridgeAssets,
  decodeAssets,
  embedAssets,
  encodeAssets,
} from '@tinyforge/engine/tooling/cartridge-assets';
import { findCustomSection, META_SECTION, readMeta } from '@tinyforge/engine/tooling/cartridge-meta';
import { describe, expect, it } from 'vitest';
import { NO_INPUT } from '../src/input.ts';
import { GameMachine } from '../src/machine.ts';
import { cartridge, FIXED_SEED, hash, recordingHost } from './helpers.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 9]);

/** A payload with these files listed (offsets into `blob`). */
function payload(files: unknown[], blob = new Uint8Array(8)): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify({ format: 1, files }));
  const out = new Uint8Array(4 + json.length + blob.length);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  out.set(blob, 4 + json.length);
  return out;
}

async function frameOf(wasm: Uint8Array): Promise<string> {
  const machine = new GameMachine(recordingHost().host);
  machine.seed = FIXED_SEED;
  await machine.load(wasm as Uint8Array<ArrayBuffer>);
  for (let i = 0; i < 60; i++) machine.tick(NO_INPUT);
  machine.draw();
  return hash(machine.framebuffer());
}

describe('tinyforge.assets section', () => {
  it('round-trips library files', () => {
    const assets = [
      { kind: 'sprites' as const, file: 'coin~8x1.png', bytes: PNG },
      { kind: 'sfx' as const, file: 'jump.wav', bytes: WAV },
      { kind: 'music' as const, file: 'theme.wav', bytes: new Uint8Array(0) },
    ];
    expect(decodeAssets(encodeAssets(assets))).toEqual(assets);
  });

  it.each([
    ['a path', { kind: 'sprites', file: '../games/x.png', offset: 0, length: 1 }],
    ['a folder', { kind: 'sprites', file: 'sub/x.png', offset: 0, length: 1 }],
    ['a hidden name', { kind: 'sprites', file: '.x.png', offset: 0, length: 1 }],
    ['the wrong type', { kind: 'sfx', file: 'x.png', offset: 0, length: 1 }],
    ['an unknown kind', { kind: 'engine', file: 'x.ts', offset: 0, length: 1 }],
    ['bytes past the end', { kind: 'sfx', file: 'x.wav', offset: 4, length: 5 }],
    ['a negative offset', { kind: 'sfx', file: 'x.wav', offset: -1, length: 1 }],
  ])('refuses %s', (_, file) => {
    expect(() => decodeAssets(payload([file]))).toThrow(/tinyforge\.assets/);
  });

  it('refuses a truncated payload or an unknown format', () => {
    expect(() => decodeAssets(new Uint8Array(2))).toThrow(/truncated/);
    expect(() => decodeAssets(new Uint8Array([200, 0, 0, 0, 1]))).toThrow(/truncated/);
    const json = new TextEncoder().encode('{"format":2,"files":[]}');
    const p = new Uint8Array(4 + json.length);
    new DataView(p.buffer).setUint32(0, json.length, true);
    p.set(json, 4);
    expect(() => decodeAssets(p)).toThrow(/format 2/);
  });

  it('is added to a release build that still plays the same, and read back', async () => {
    const plain = await cartridge('pong');
    expect(cartridgeAssets(plain)).toBeNull();
    const assets = [{ kind: 'sfx' as const, file: 'pong_hit.wav', bytes: WAV }];
    const wasm = embedAssets(plain, assets);
    expect(cartridgeAssets(wasm)).toEqual(assets);
    // Appended at the end: the metadata stays first and the code is unchanged.
    expect(wasm.subarray(0, plain.length)).toEqual(plain);
    expect(readMeta(wasm)).toEqual(readMeta(plain));
    expect(findCustomSection(wasm, META_SECTION)).not.toBeNull();
    const module = await WebAssembly.compile(wasm);
    expect(WebAssembly.Module.customSections(module, ASSETS_SECTION)).toHaveLength(1);
    expect(await frameOf(wasm)).toBe(await frameOf(plain));
    expect(() => embedAssets(wasm, assets)).toThrow(/already/);
  });
});
