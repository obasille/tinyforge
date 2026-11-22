// The `tinyforge.meta` custom section: a cartridge's title, description,
// author and cover image, readable without compiling or running the module.
//
// The section is written first, right after the 8-byte WASM header, so a game
// browser can read it from the first bytes of a cartridge.
//
// Payload layout (little-endian):
//   u32  JSON length in bytes
//   ...  JSON (UTF-8): { "format": 1, "layout": 1, "ram", "memory",
//                        "title", "description", "author",
//                        "assets": { "sprites": [...], "sfx": [...], "music": [...] },
//                        "cover"?: { "type", "offset", "length" } }
//   ...  binary blobs; `offset` is relative to the end of the JSON
//
// `layout` is the memory layout version the game was built for (see
// memory-map.ts), `ram` its game RAM size in bytes (its RAM_SIZE) and
// `memory` the minimum memory its module declares, in bytes: where its static
// data ends and where a host can put the sprite table.
//
// `assets` lists the IDs of the library assets the game uses (found by the
// asset scan at compile time), so a host loads only those.
//
// Plain TS with no Node or DOM APIs: used by the build tooling and by hosts.

import type { AssetList } from './asset-scan.ts';

export const META_SECTION = 'tinyforge.meta';
export const META_FORMAT = 1;

export interface CartridgeMeta {
  /** Memory layout version (memory-map.ts LAYOUT_VERSION at build time). */
  layout: number;
  /** Game RAM size in bytes, from RAM_START. */
  ram: number;
  /** Minimum memory the module declares, in bytes (a multiple of 64 KB). */
  memory: number;
  title: string;
  description: string;
  author: string;
  /** IDs of the library sprites, sound effects and music the game uses. */
  assets: AssetList;
  /** Cover image file bytes (PNG), or null when the game has none. */
  cover: { type: string; bytes: Uint8Array } | null;
}

interface MetaJson {
  format: number;
  layout: number;
  ram: number;
  memory: number;
  title: string;
  description: string;
  author: string;
  assets: AssetList;
  cover?: { type: string; offset: number; length: number };
}

const WASM_HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

function leb128(value: number): number[] {
  const out: number[] = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return out;
}

function readLeb128(bytes: Uint8Array, pos: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  for (;;) {
    if (pos >= bytes.length) throw new Error('Truncated WASM module');
    const byte = bytes[pos++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: pos };
    shift += 7;
    if (shift > 35) throw new Error('Invalid LEB128 value in WASM module');
  }
}

function isWasm(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && WASM_HEADER.every((b, i) => bytes[i] === b);
}

/** Encode metadata as a `tinyforge.meta` section payload. */
export function encodeMeta(meta: CartridgeMeta): Uint8Array {
  const json: MetaJson = {
    format: META_FORMAT,
    layout: meta.layout,
    ram: meta.ram,
    memory: meta.memory,
    title: meta.title,
    description: meta.description,
    author: meta.author,
    assets: meta.assets,
  };
  if (meta.cover) json.cover = { type: meta.cover.type, offset: 0, length: meta.cover.bytes.length };
  const text = new TextEncoder().encode(JSON.stringify(json));
  const blob = meta.cover?.bytes ?? new Uint8Array(0);
  const out = new Uint8Array(4 + text.length + blob.length);
  new DataView(out.buffer).setUint32(0, text.length, true);
  out.set(text, 4);
  out.set(blob, 4 + text.length);
  return out;
}

/** Decode a `tinyforge.meta` payload. Throws on a malformed or newer format. */
export function decodeMeta(payload: Uint8Array): CartridgeMeta {
  if (payload.length < 4) throw new Error('tinyforge.meta is truncated');
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const jsonLength = view.getUint32(0, true);
  if (4 + jsonLength > payload.length) throw new Error('tinyforge.meta is truncated');
  const json = JSON.parse(new TextDecoder().decode(payload.subarray(4, 4 + jsonLength))) as Omit<MetaJson, 'assets'> & {
    assets?: Partial<AssetList>;
  };
  if (json.format !== META_FORMAT) throw new Error(`Unsupported tinyforge.meta format ${json.format}`);
  for (const field of ['layout', 'ram', 'memory'] as const) {
    if (typeof json[field] !== 'number') throw new Error(`tinyforge.meta has no ${field}: rebuild the cartridge`);
  }
  const blobs = payload.subarray(4 + jsonLength);
  let cover: CartridgeMeta['cover'] = null;
  if (json.cover) {
    const { type, offset, length } = json.cover;
    if (offset < 0 || offset + length > blobs.length) throw new Error('tinyforge.meta cover is out of range');
    cover = { type, bytes: blobs.slice(offset, offset + length) };
  }
  const assets = json.assets ?? {};
  return {
    layout: json.layout,
    ram: json.ram,
    memory: json.memory,
    title: json.title,
    description: json.description,
    author: json.author,
    assets: { sprites: assets.sprites ?? [], sfx: assets.sfx ?? [], music: assets.music ?? [] },
    cover,
  };
}

/**
 * Insert a custom section right after the WASM header. Returns the new module
 * and the number of bytes inserted (code offsets move by that much).
 */
export function insertCustomSection(
  wasm: Uint8Array,
  name: string,
  payload: Uint8Array,
): { wasm: Uint8Array; inserted: number } {
  if (!isWasm(wasm)) throw new Error('Not a WASM module');
  const nameBytes = new TextEncoder().encode(name);
  const content = [...leb128(nameBytes.length), ...nameBytes];
  const size = content.length + payload.length;
  const head = [0x00, ...leb128(size), ...content];
  const section = new Uint8Array(head.length + payload.length);
  section.set(head, 0);
  section.set(payload, head.length);
  const out = new Uint8Array(wasm.length + section.length);
  out.set(wasm.subarray(0, 8), 0);
  out.set(section, 8);
  out.set(wasm.subarray(8), 8 + section.length);
  return { wasm: out, inserted: section.length };
}

/** Append a custom section at the end of a module (code offsets do not move). */
export function appendCustomSection(wasm: Uint8Array, name: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!isWasm(wasm)) throw new Error('Not a WASM module');
  const nameBytes = new TextEncoder().encode(name);
  const content = [...leb128(nameBytes.length), ...nameBytes];
  const head = [0x00, ...leb128(content.length + payload.length), ...content];
  const out = new Uint8Array(wasm.length + head.length + payload.length);
  out.set(wasm, 0);
  out.set(head, wasm.length);
  out.set(payload, wasm.length + head.length);
  return out;
}

/** Payload of the first custom section with this name, or null. Does not compile the module. */
export function findCustomSection(wasm: Uint8Array, name: string): Uint8Array | null {
  if (!isWasm(wasm)) throw new Error('Not a WASM module');
  const decoder = new TextDecoder();
  let pos = 8;
  while (pos < wasm.length) {
    const id = wasm[pos++];
    const size = readLeb128(wasm, pos);
    const start = size.next;
    const end = start + size.value;
    if (end > wasm.length) throw new Error('Truncated WASM module');
    if (id === 0) {
      const len = readLeb128(wasm, start);
      const sectionName = decoder.decode(wasm.subarray(len.next, len.next + len.value));
      if (sectionName === name) return wasm.subarray(len.next + len.value, end);
    }
    pos = end;
  }
  return null;
}

/**
 * Point the module's `sourceMappingURL` section at `url` (debuggers load the
 * source map from it). The section goes last, replacing any earlier one, so
 * code offsets do not move.
 */
export function withSourceMapUrl(wasm: Uint8Array, url: string): Uint8Array<ArrayBuffer> {
  if (!isWasm(wasm)) throw new Error('Not a WASM module');
  const decoder = new TextDecoder();
  const parts: Uint8Array[] = [wasm.subarray(0, 8)];
  let pos = 8;
  while (pos < wasm.length) {
    const sectionStart = pos;
    const id = wasm[pos++];
    const size = readLeb128(wasm, pos);
    const end = size.next + size.value;
    if (end > wasm.length) throw new Error('Truncated WASM module');
    let keep = true;
    if (id === 0) {
      const len = readLeb128(wasm, size.next);
      keep = decoder.decode(wasm.subarray(len.next, len.next + len.value)) !== 'sourceMappingURL';
    }
    if (keep) parts.push(wasm.subarray(sectionStart, end));
    pos = end;
  }
  const name = new TextEncoder().encode('sourceMappingURL');
  const value = new TextEncoder().encode(url);
  const content = [...leb128(name.length), ...name, ...leb128(value.length)];
  const head = new Uint8Array([0x00, ...leb128(content.length + value.length), ...content]);
  parts.push(head, value);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Limits of the memory a module imports, in 64 KB pages, or null when it
 * imports none. Reads the import section; does not compile the module.
 */
export function importedMemory(wasm: Uint8Array): { min: number; max: number | null } | null {
  if (!isWasm(wasm)) throw new Error('Not a WASM module');
  let pos = 8;
  while (pos < wasm.length) {
    const id = wasm[pos++];
    const size = readLeb128(wasm, pos);
    const end = size.next + size.value;
    if (id !== 2) {
      pos = end;
      continue;
    }
    let p = size.next;
    const leb = () => {
      const r = readLeb128(wasm, p);
      p = r.next;
      return r.value;
    };
    const limits = () => {
      const flags = wasm[p++];
      const min = leb();
      const max = flags & 1 ? leb() : null;
      return { min, max };
    };
    const count = leb();
    for (let i = 0; i < count; i++) {
      const moduleName = leb();
      p += moduleName;
      const fieldName = leb();
      p += fieldName;
      const kind = wasm[p++];
      if (kind === 0)
        leb(); // function: type index
      else if (kind === 1) {
        p++; // table: element type
        limits();
      } else if (kind === 2) return limits();
      else if (kind === 3)
        p += 2; // global: value type, mutability
      else if (kind === 4) {
        p++; // tag: attribute
        leb();
      } else throw new Error(`Unknown import kind ${kind}`);
    }
    return null;
  }
  return null;
}

/** Add `tinyforge.meta` to a compiled module. */
export function withMeta(wasm: Uint8Array, meta: CartridgeMeta): { wasm: Uint8Array; inserted: number } {
  return insertCustomSection(wasm, META_SECTION, encodeMeta(meta));
}

/** A cartridge's metadata, or null when it has no `tinyforge.meta` section. */
export function readMeta(wasm: Uint8Array): CartridgeMeta | null {
  const payload = findCustomSection(wasm, META_SECTION);
  return payload ? decodeMeta(payload) : null;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function vlqDecode(text: string, pos: number): { value: number; next: number } {
  let result = 0;
  let shift = 0;
  for (;;) {
    const digit = B64.indexOf(text[pos++]);
    if (digit < 0) throw new Error('Invalid source map mappings');
    result += (digit & 31) * 2 ** shift;
    if ((digit & 32) === 0) break;
    shift += 5;
  }
  return { value: result & 1 ? -(result - 1) / 2 : result / 2, next: pos };
}

function vlqEncode(value: number): string {
  let v = value < 0 ? -value * 2 + 1 : value * 2;
  let out = '';
  do {
    let digit = v & 31;
    v = Math.floor(v / 32);
    if (v > 0) digit |= 32;
    out += B64[digit];
  } while (v > 0);
  return out;
}

/**
 * Shift a WASM source map after bytes were inserted before the code. WASM
 * source maps use one line whose columns are byte offsets, and every column
 * after the first is relative, so only the first segment's column changes.
 */
export function shiftSourceMap(mapJson: string, delta: number): string {
  const map = JSON.parse(mapJson) as { mappings?: string };
  const mappings = map.mappings ?? '';
  if (delta === 0 || mappings.length === 0 || mappings[0] === ',' || mappings[0] === ';') return mapJson;
  const first = vlqDecode(mappings, 0);
  map.mappings = vlqEncode(first.value + delta) + mappings.slice(first.next);
  return JSON.stringify(map);
}
