// Plain zip files: write (deflated) and read (stored or deflated), enough for
// exporting a game and importing it back, or a zip made by any zip tool.
// Deflate comes from the platform's CompressionStream ("deflate-raw"), in
// browsers and in Node alike. No zip64, encryption or multi-disk archives.
//
// Plain TS with no Node or DOM APIs.

export interface ZipEntry {
  path: string;
  bytes: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Largest total a zip may unpack to: a damaged or hostile zip stops here. */
export const MAX_UNZIPPED = 256 * 1024 * 1024;

/** Run bytes through a (de)compression stream, stopping past `limit` output bytes. */
async function through(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  limit = Number.POSITIVE_INFINITY,
): Promise<Uint8Array> {
  const reader = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    size += chunk.value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error('A file in the zip is larger than it says');
    }
    chunks.push(chunk.value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** A zip of these files, each deflated (or stored when deflating does not shrink it). */
export async function writeZip(entries: readonly ZipEntry[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const { path, bytes } of entries) {
    const name = encoder.encode(path);
    const deflated = await through(bytes, new CompressionStream('deflate-raw'));
    const stored = deflated.length >= bytes.length;
    const data = stored ? bytes : deflated;
    const crc = crc32(bytes);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, stored ? 0 : 8, true);
    lv.setUint16(12, 0x21, true); // 1980-01-01: no clock, so the same files give the same zip
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, bytes.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, stored ? 0 : 8, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, bytes.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The files in a zip (folders left out). Throws on a damaged or unsupported zip. */
export async function readZip(zip: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Not a zip file');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > zip.length || view.getUint32(at, true) !== 0x02014b50) throw new Error('The zip is damaged');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const path = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extra + comment;
    if (path.endsWith('/')) continue;
    if (flags & 1) throw new Error(`${path} is encrypted`);
    total += size;
    if (total > MAX_UNZIPPED) throw new Error(`The zip unpacks to more than ${MAX_UNZIPPED / 1024 / 1024} MB`);
    if (local + 30 > zip.length || view.getUint32(local, true) !== 0x04034b50) throw new Error('The zip is damaged');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = zip.subarray(start, start + packed);
    if (data.length !== packed) throw new Error('The zip is damaged');
    let bytes: Uint8Array;
    if (method === 0) bytes = data.slice();
    else if (method === 8) bytes = await through(data, new DecompressionStream('deflate-raw'), size);
    else throw new Error(`${path} uses an unsupported compression (method ${method})`);
    if (bytes.length !== size || crc32(bytes) !== crc) throw new Error(`${path} is damaged in the zip`);
    entries.push({ path, bytes });
  }
  return entries;
}
