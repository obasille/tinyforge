// Asset naming and the sprite table, ported from the classic host
// (apps/classic/src/asset-loader.ts and sprite-manager.ts) without DOM use.

import {
  SPRITE_ID_ENTRY_SIZE,
  SPRITE_ID_MAX_CHARS,
  SPRITE_INFO_ENTRY_SIZE,
  SPRITE_TABLE_HEADER_SIZE,
} from '@tinyforge/engine/memory-map';
import type { MemoryLayout } from './layout.ts';

export const MAX_ASSET_ID_LENGTH = 16;
export const MAX_SPRITES = 256;

export interface ParsedAssetName {
  id: string;
  format: string;
  info: string;
}

/**
 * Parse `{id}~{format}-{info}.ext`; only the id is required.
 * For example `coin~8x1.png` is id "coin", format "8x1".
 */
export function parseAssetFilename(filename: string): ParsedAssetName | null {
  const basename = filename.split(/[/\\]/).pop();
  if (!basename) return null;
  let decoded = basename;
  try {
    decoded = decodeURIComponent(basename);
  } catch {
    // Keep the original when it is not valid URI encoding.
  }
  const name = decoded.replace(/\.[^/.]+$/, '');
  let id = name;
  let format = '';
  let info = '';
  const tilde = name.indexOf('~');
  const dash = name.indexOf('-');
  if (tilde >= 0) {
    id = name.slice(0, tilde);
    const rest = name.slice(tilde + 1);
    const restDash = rest.indexOf('-');
    if (restDash >= 0) {
      format = rest.slice(0, restDash);
      info = rest.slice(restDash + 1);
    } else {
      format = rest;
    }
  } else if (dash >= 0) {
    id = name.slice(0, dash);
    info = name.slice(dash + 1);
  }
  return id ? { id, format, info } : null;
}

/** Sheet layout from a format like "8x1", or 1×1 for a single sprite. */
export function sheetLayout(format: string): { cols: number; rows: number } {
  const m = format.match(/^(\d+)x(\d+)$/);
  return m ? { cols: Number(m[1]), rows: Number(m[2]) } : { cols: 1, rows: 1 };
}

/** One decoded sprite (or sprite sheet split into frames), RGBA bytes. */
export interface SpriteImage {
  id: string;
  width: number;
  height: number;
  cols: number;
  rows: number;
  frames: Uint8ClampedArray[];
}

/** Split a decoded RGBA image into `cols × rows` frames, row by row. */
export function splitSheet(
  rgba: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  cols: number,
  rows: number,
): { width: number; height: number; frames: Uint8ClampedArray[] } {
  const width = Math.floor(imageWidth / cols);
  const height = Math.floor(imageHeight / rows);
  const frames: Uint8ClampedArray[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const frame = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        const src = ((r * height + y) * imageWidth + c * width) * 4;
        frame.set(rgba.subarray(src, src + width * 4), y * width * 4);
      }
      frames.push(frame);
    }
  }
  return { width, height, frames };
}

/** Bytes the sprite table needs for these sprites (header, entries, pixels). */
export function spriteTableBytes(sprites: ReadonlyArray<SpriteImage>): number {
  const list = sprites.slice(0, MAX_SPRITES);
  let pixels = 0;
  for (const sprite of list) for (const frame of sprite.frames) pixels += frame.length;
  return SPRITE_TABLE_HEADER_SIZE + list.length * (SPRITE_ID_ENTRY_SIZE + SPRITE_INFO_ENTRY_SIZE) + pixels;
}

/**
 * Write the sprite table the SDK reads (header, id lookup, info entries,
 * pixel data) at `address`, and point the layout's sprite-table pointer at
 * it. The buffer must hold spriteTableBytes(sprites) bytes from `address`.
 * Returns warnings instead of logging, so callers decide where they go.
 */
export function writeSpriteTable(
  buffer: ArrayBuffer,
  layout: MemoryLayout,
  address: number,
  sprites: ReadonlyArray<SpriteImage>,
): { bytes: number; warnings: string[] } {
  const warnings: string[] = [];
  const list = sprites.slice(0, MAX_SPRITES);
  if (sprites.length > MAX_SPRITES) {
    warnings.push(`Sprite limit reached (${MAX_SPRITES}); ${sprites.length - MAX_SPRITES} not loaded`);
  }
  const size = spriteTableBytes(list);
  if (address + size > buffer.byteLength) {
    throw new Error(`Sprite table needs ${address + size} bytes of memory, ${buffer.byteLength} available`);
  }
  const view = new DataView(buffer);
  const count = list.length;
  const lookupOffset = SPRITE_TABLE_HEADER_SIZE;
  const infoOffset = lookupOffset + count * SPRITE_ID_ENTRY_SIZE;
  const dataStart = infoOffset + count * SPRITE_INFO_ENTRY_SIZE;

  new Uint8Array(buffer, address, size).fill(0);
  view.setUint16(address + 0, count, true);
  view.setUint32(address + 4, lookupOffset, true);
  view.setUint32(address + 8, infoOffset, true);
  view.setUint32(address + 12, dataStart, true);

  const lookup = new Uint16Array(buffer, address + lookupOffset, (SPRITE_ID_ENTRY_SIZE / 2) * count);
  const data = new Uint8Array(buffer, address + dataStart, size - dataStart);
  let offset = 0;

  list.forEach((sprite, index) => {
    if (sprite.id.length > SPRITE_ID_MAX_CHARS) {
      warnings.push(`Sprite ID "${sprite.id}" exceeds ${SPRITE_ID_MAX_CHARS} chars, skipping lookup entry`);
    } else {
      const base = index * (SPRITE_ID_ENTRY_SIZE / 2);
      for (let i = 0; i < sprite.id.length; i++) lookup[base + i] = sprite.id.charCodeAt(i);
    }
    const info = address + infoOffset + index * SPRITE_INFO_ENTRY_SIZE;
    const frameSize = sprite.width * sprite.height * 4;
    view.setUint32(info + 0, address + dataStart + offset, true);
    view.setUint32(info + 4, frameSize, true);
    view.setUint16(info + 8, sprite.width, true);
    view.setUint16(info + 10, sprite.height, true);
    view.setUint8(info + 12, sprite.cols);
    view.setUint8(info + 13, sprite.rows);
    for (const frame of sprite.frames) {
      data.set(frame, offset);
      offset += frame.length;
    }
  });

  view.setUint32(layout.spriteTablePtrAddr, address, true);
  return { bytes: offset, warnings };
}
