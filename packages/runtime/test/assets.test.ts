import { describe, expect, it } from 'vitest';
import { parseAssetFilename, sheetLayout, splitSheet, spriteTableBytes, writeSpriteTable } from '../src/assets.ts';
import { CURRENT_LAYOUT } from '../src/layout.ts';

describe('parseAssetFilename', () => {
  it.each([
    ['coin~8x1.png', { id: 'coin', format: '8x1', info: '' }],
    ['10~4x3-tiles.png', { id: '10', format: '4x3', info: 'tiles' }],
    ['tap-short.wav', { id: 'tap', format: '', info: 'short' }],
    ['player.png', { id: 'player', format: '', info: '' }],
    ['dir/game%20over.wav', { id: 'game over', format: '', info: '' }],
  ])('%s', (file, expected) => {
    expect(parseAssetFilename(file)).toEqual(expected);
  });
});

describe('sprite sheets', () => {
  it('reads the layout from the format', () => {
    expect(sheetLayout('8x1')).toEqual({ cols: 8, rows: 1 });
    expect(sheetLayout('')).toEqual({ cols: 1, rows: 1 });
  });

  it('splits a 2×1 sheet into frames', () => {
    // 4×1 image: two 2×1 frames, pixel values 1..4 in the red channel.
    const rgba = new Uint8ClampedArray([1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255]);
    const { width, height, frames } = splitSheet(rgba, 4, 1, 2, 1);
    expect([width, height, frames.length]).toEqual([2, 1, 2]);
    expect(frames[1][0]).toBe(3);
  });
});

describe('writeSpriteTable', () => {
  it('writes the header, lookup and info entry the SDK expects, and points to the table', () => {
    const TABLE = 0x70000;
    const frame = new Uint8ClampedArray(2 * 2 * 4).fill(7);
    const sprites = [{ id: 'hero', width: 2, height: 2, cols: 1, rows: 1, frames: [frame] }];
    expect(spriteTableBytes(sprites)).toBe(16 + 32 + 16 + 16);
    const buffer = new ArrayBuffer(TABLE + spriteTableBytes(sprites));
    const { bytes, warnings } = writeSpriteTable(buffer, CURRENT_LAYOUT, TABLE, sprites);
    expect(warnings).toEqual([]);
    expect(bytes).toBe(16);
    const view = new DataView(buffer);
    expect(view.getUint32(CURRENT_LAYOUT.spriteTablePtrAddr, true)).toBe(TABLE);
    const SPRITE_TABLE_ADDR = TABLE;
    expect(view.getUint16(SPRITE_TABLE_ADDR, true)).toBe(1);
    const lookup = SPRITE_TABLE_ADDR + view.getUint32(SPRITE_TABLE_ADDR + 4, true);
    expect(String.fromCharCode(view.getUint16(lookup, true), view.getUint16(lookup + 2, true))).toBe('he');
    const info = SPRITE_TABLE_ADDR + view.getUint32(SPRITE_TABLE_ADDR + 8, true);
    expect(view.getUint16(info + 8, true)).toBe(2);
    const dataAddr = view.getUint32(info, true);
    expect(new Uint8Array(buffer, dataAddr, 16).every((b) => b === 7)).toBe(true);
  });

  it('refuses to write past the end of memory', () => {
    const sprites = [{ id: 'a', width: 1, height: 1, cols: 1, rows: 1, frames: [new Uint8ClampedArray(4)] }];
    expect(() => writeSpriteTable(new ArrayBuffer(0x70010), CURRENT_LAYOUT, 0x70000, sprites)).toThrow(/needs/);
  });
});
