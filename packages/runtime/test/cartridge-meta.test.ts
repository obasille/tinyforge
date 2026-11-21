import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_RAM_SIZE, LAYOUT_VERSION } from '@tinyforge/engine/memory-map';
import {
  decodeMeta,
  encodeMeta,
  findCustomSection,
  importedMemory,
  insertCustomSection,
  META_SECTION,
  readMeta,
  shiftSourceMap,
  withMeta,
} from '@tinyforge/engine/tooling/cartridge-meta';
import { ASSETS_DIR, compileGame, readGameMeta, readRamSize } from '@tinyforge/engine/tooling/compile-game';
import { describe, expect, it } from 'vitest';

// The smallest valid module: just the header.
const EMPTY = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const COVER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe('cartridge metadata section', () => {
  it('round-trips title, description, author, assets and cover', () => {
    const meta = {
      layout: 1,
      ram: 0x2000,
      memory: 0x70000,
      title: 'Pong',
      description: 'Two players',
      author: 'Olivier',
      assets: { sprites: ['ball'], sfx: ['hit', 'wall'], music: [] },
      cover: { type: 'image/png', bytes: COVER },
    };
    expect(decodeMeta(encodeMeta(meta))).toEqual(meta);
    expect(decodeMeta(encodeMeta({ ...meta, cover: null })).cover).toBeNull();
  });

  it('is written first, right after the header, and found again without compiling', async () => {
    const { wasm, inserted } = withMeta(EMPTY, {
      layout: 1,
      ram: 16,
      memory: 0x60000,
      title: 'T',
      description: 'D',
      author: 'A',
      assets: { sprites: [], sfx: [], music: [] },
      cover: null,
    });
    expect(wasm.length).toBe(EMPTY.length + inserted);
    expect(wasm[8]).toBe(0); // custom section id
    expect(readMeta(wasm)?.title).toBe('T');
    // Still a valid module, and the engine sees the section too.
    const module = await WebAssembly.compile(wasm as Uint8Array<ArrayBuffer>);
    expect(WebAssembly.Module.customSections(module, META_SECTION)).toHaveLength(1);
  });

  it('handles sections larger than 127 bytes (multi-byte sizes)', () => {
    const payload = new Uint8Array(70_000).fill(7);
    const { wasm } = insertCustomSection(EMPTY, 'big', payload);
    expect(findCustomSection(wasm, 'big')).toEqual(payload);
    expect(findCustomSection(wasm, 'missing')).toBeNull();
    expect(readMeta(EMPTY)).toBeNull();
  });

  it('shifts only the first column of a WASM source map', () => {
    // Columns 10, +5, +3 (VLQ: U, K, G) with source/line/column fields.
    const map = JSON.stringify({ version: 3, sources: ['a.ts'], mappings: 'UAAA,KAAC,GAAC' });
    const shifted = JSON.parse(shiftSourceMap(map, 100)) as { mappings: string };
    expect(shifted.mappings).toBe('8GAAA,KAAC,GAAC'); // 110 = '8G'
    expect(shiftSourceMap(map, 0)).toBe(map);
  });
});

describe('RAM_SIZE', () => {
  it('reads a number literal, with or without a type, and defaults to 72 KB', () => {
    expect(readRamSize('g', 'const RAM_SIZE: i32 = 0x2000;')).toBe(0x2000);
    expect(readRamSize('g', 'const RAM_SIZE = 1_024; // bytes')).toBe(1024);
    expect(readRamSize('g', 'const TITLE = "x";')).toBe(DEFAULT_RAM_SIZE);
  });

  it('rejects anything else', () => {
    expect(() => readRamSize('g', 'const RAM_SIZE: i32 = 64 * 1024;')).toThrow(/number literal/);
    expect(() => readRamSize('g', 'const RAM_SIZE: i32 = 100;')).toThrow(/multiple of 16/);
    expect(() => readRamSize('g', 'const RAM_SIZE: i32 = 0;')).toThrow(/multiple of 16/);
  });

  it('places static data right after game RAM, and the cartridge records both', async () => {
    const result = await compileGame('pong', 'release');
    if (!result.ok) throw new Error(result.log);
    const meta = readMeta(result.wasm);
    expect(meta).toMatchObject({ layout: LAYOUT_VERSION, ram: 0x100 });
    // pong declares 256 bytes of RAM: its module needs 6 pages, not the old 16.
    expect(meta?.memory).toBe(6 * 65536);
    expect(importedMemory(result.wasm)).toEqual({ min: 6, max: null });
  });
});

describe('game metadata from main.ts', () => {
  it('reads pong, including its cover from the asset library', () => {
    const meta = readGameMeta('pong');
    expect(meta.title).toBe('Pong');
    expect(meta.author).toBe('Olivier Basille');
    expect(meta.cover?.type).toBe('image/png');
    expect(meta.cover?.bytes).toEqual(new Uint8Array(readFileSync(path.join(ASSETS_DIR, 'sprites', 'pong_cover.png'))));
  });

  it('puts the metadata in compiled cartridges and keeps the source map aligned', async () => {
    const result = await compileGame('pong', 'debug');
    if (!result.ok) throw new Error(result.log);
    const meta = readMeta(result.wasm);
    expect(meta?.title).toBe('Pong');
    expect(meta?.cover?.bytes.length).toBeGreaterThan(0);

    // The first mapped byte offset must land inside the code section (id 10),
    // which moved by the size of the inserted section.
    const module = await WebAssembly.compile(result.wasm);
    expect(WebAssembly.Module.exports(module).map((e) => e.name)).toEqual(
      expect.arrayContaining(['init', 'update', 'draw']),
    );
    const code = sectionRange(result.wasm, 10);
    const offset = firstColumn((JSON.parse(result.sourceMap ?? '{}') as { mappings: string }).mappings);
    expect(offset).toBeGreaterThan(code.start);
    expect(offset).toBeLessThan(code.end);
  });
});

function leb(bytes: Uint8Array, pos: number): [number, number] {
  let value = 0;
  let shift = 0;
  for (;;) {
    const b = bytes[pos++];
    value += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) return [value, pos];
    shift += 7;
  }
}

function sectionRange(wasm: Uint8Array, id: number): { start: number; end: number } {
  let pos = 8;
  while (pos < wasm.length) {
    const sid = wasm[pos++];
    const [size, start] = leb(wasm, pos);
    if (sid === id) return { start, end: start + size };
    pos = start + size;
  }
  throw new Error(`No section ${id}`);
}

function firstColumn(mappings: string): number {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = 0;
  let shift = 0;
  for (const ch of mappings) {
    const digit = B64.indexOf(ch);
    result += (digit & 31) * 2 ** shift;
    if ((digit & 32) === 0) break;
    shift += 5;
  }
  return result & 1 ? -(result - 1) / 2 : result / 2;
}
