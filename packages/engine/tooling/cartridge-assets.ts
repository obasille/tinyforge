// The `tinyforge.assets` custom section: the library files a game uses,
// embedded in an exported cartridge so it carries its own sprites and sounds.
// Added at the end of a release build by export (the editor's Export, or
// `pnpm tf cartridge`); a cartridge built for the editor has none.
//
// Payload layout (little-endian):
//   u32  JSON length in bytes
//   ...  JSON (UTF-8): { "format": 1, "files": [{ "kind", "file", "offset", "length" }] }
//   ...  the files' bytes; `offset` is relative to the end of the JSON
//
// `file` is the library file name (`coin~8x1.png`, `jump.wav`): it holds the
// asset's ID and sheet layout, as in assets/<kind>/.
//
// Plain TS with no Node or DOM APIs.

import { ASSET_KINDS, ASSET_PATTERNS, type AssetKind, type AssetList, assetId } from './asset-scan.ts';
import { appendCustomSection, findCustomSection } from './cartridge-meta.ts';
import { assetKindOf } from './project-layout.ts';

export const ASSETS_SECTION = 'tinyforge.assets';
const ASSETS_FORMAT = 1;

export interface CartridgeAsset {
  kind: AssetKind;
  /** Library file name, like coin~8x1.png. */
  file: string;
  bytes: Uint8Array;
}

/**
 * The library paths of the assets a game uses, and its cover sprite (no
 * sidecars: a cartridge is for playing).
 */
export function cartridgeAssetPaths(paths: Iterable<string>, used: AssetList, cover: string | null = null): string[] {
  const out: string[] = [];
  for (const p of paths) {
    const kind = assetKindOf(p);
    if (!kind) continue;
    const id = assetId(p.slice(`assets/${kind}/`.length));
    if (used[kind].includes(id) || (kind === 'sprites' && id === cover)) out.push(p);
  }
  return out.sort();
}

export function encodeAssets(assets: readonly CartridgeAsset[]): Uint8Array {
  let offset = 0;
  const files = assets.map(({ kind, file, bytes }) => {
    const entry = { kind, file, offset, length: bytes.length };
    offset += bytes.length;
    return entry;
  });
  const json = new TextEncoder().encode(JSON.stringify({ format: ASSETS_FORMAT, files }));
  const out = new Uint8Array(4 + json.length + offset);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  let at = 4 + json.length;
  for (const { bytes } of assets) {
    out.set(bytes, at);
    at += bytes.length;
  }
  return out;
}

/** The assets in a `tinyforge.assets` payload. Throws when it is malformed. */
export function decodeAssets(payload: Uint8Array): CartridgeAsset[] {
  if (payload.length < 4) throw new Error('tinyforge.assets is truncated');
  const jsonLength = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, true);
  if (4 + jsonLength > payload.length) throw new Error('tinyforge.assets is truncated');
  const json = JSON.parse(new TextDecoder().decode(payload.subarray(4, 4 + jsonLength))) as {
    format?: number;
    files?: Array<{ kind: unknown; file: unknown; offset: unknown; length: unknown }>;
  };
  if (json.format !== ASSETS_FORMAT) throw new Error(`Unsupported tinyforge.assets format ${json.format}`);
  const blobs = payload.subarray(4 + jsonLength);
  return (json.files ?? []).map(({ kind, file, offset, length }) => {
    const known = ASSET_KINDS.find((k) => k === kind);
    // The file name becomes a library path on import: one plain name of the right type.
    if (
      !known ||
      typeof file !== 'string' ||
      file.includes('/') ||
      file.startsWith('.') ||
      !ASSET_PATTERNS[known].test(file)
    ) {
      throw new Error(`tinyforge.assets has an invalid file: ${String(kind)}/${String(file)}`);
    }
    if (
      typeof offset !== 'number' ||
      typeof length !== 'number' ||
      offset < 0 ||
      length < 0 ||
      offset + length > blobs.length
    ) {
      throw new Error(`tinyforge.assets: ${file} is out of range`);
    }
    return { kind: known, file, bytes: blobs.slice(offset, offset + length) };
  });
}

/** A cartridge with these assets embedded. */
export function embedAssets(wasm: Uint8Array, assets: readonly CartridgeAsset[]): Uint8Array<ArrayBuffer> {
  if (findCustomSection(wasm, ASSETS_SECTION)) throw new Error('The cartridge already has embedded assets');
  return appendCustomSection(wasm, ASSETS_SECTION, encodeAssets(assets));
}

/** The assets embedded in a cartridge, or null when it has none. */
export function cartridgeAssets(wasm: Uint8Array): CartridgeAsset[] | null {
  const payload = findCustomSection(wasm, ASSETS_SECTION);
  return payload ? decodeAssets(payload) : null;
}
