// PNG encoding and decoding in plain TS, for the sprite editor.
//
// A canvas round trip premultiplies alpha and can change half-transparent
// pixels, so the editor reads and writes PNGs itself: every pixel saved is
// the pixel drawn. Compression uses CompressionStream ("deflate" is the zlib
// format PNG wants), which browsers, Workers and Node all have.
//
// Decoding covers non-interlaced images at bit depths 1-8 in every colour
// type, and 16-bit ones (reduced to 8 bits). Anything else returns null and
// the caller falls back to the browser's decoder.

export interface RgbaImage {
  width: number;
  height: number;
  /** width × height × 4 bytes, row by row. */
  rgba: Uint8ClampedArray;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(
    new Blob([data as BlobPart]).stream().pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>),
  );
  return new Uint8Array(await out.arrayBuffer());
}

const deflate = (data: Uint8Array) => pipe(data, new CompressionStream('deflate'));
const inflate = (data: Uint8Array) => pipe(data, new DecompressionStream('deflate'));

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Encode RGBA pixels as a PNG (8-bit RGBA, the smallest filter per row). */
export async function encodePng(image: RgbaImage): Promise<Uint8Array> {
  const { width, height, rgba } = image;
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  const candidate = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let filter = 0; filter < 5; filter++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const cur = rgba[row + x];
        const a = x >= 4 ? rgba[row + x - 4] : 0;
        const b = y > 0 ? rgba[row - stride + x] : 0;
        const c = x >= 4 && y > 0 ? rgba[row - stride + x - 4] : 0;
        const pred =
          filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (cur - pred) & 255;
        candidate[x] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = filter;
        raw[y * (stride + 1)] = filter;
        raw.set(candidate, y * (stride + 1) + 1);
      }
    }
    if (best < 0) raw[y * (stride + 1)] = 0;
  }
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const chunks = [chunk('IHDR', header), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(8 + chunks.reduce((n, c) => n + c.length, 0));
  out.set(SIGNATURE, 0);
  let offset = 8;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** Decode a PNG to RGBA, or null when it is not one this decoder reads. */
export async function decodePng(bytes: Uint8Array): Promise<RgbaImage | null> {
  if (bytes.length < 8 || !SIGNATURE.every((b, i) => bytes[i] === b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let palette: Uint8Array | null = null;
  let alpha: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (data.length !== length) return null;
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      depth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return null; // interlaced or unknown method
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') alpha = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += length + 12;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!width || !height || !channels || ![1, 2, 4, 8, 16].includes(depth)) return null;
  if (colorType === 3 && (!palette || depth === 16)) return null;
  if ((colorType === 2 || colorType === 4 || colorType === 6) && depth < 8) return null;
  const compressed = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  let at = 0;
  for (const d of idat) {
    compressed.set(d, at);
    at += d.length;
  }
  let raw: Uint8Array;
  try {
    raw = await inflate(compressed);
  } catch {
    return null;
  }
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = Math.ceil((width * channels * depth) / 8);
  if (raw.length < (stride + 1) * height) return null;
  const lines = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? lines[dst + x - bpp] : 0;
      const b = y > 0 ? lines[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? lines[dst - stride + x - bpp] : 0;
      const v = raw[src + x];
      const pred =
        filter === 0
          ? 0
          : filter === 1
            ? a
            : filter === 2
              ? b
              : filter === 3
                ? (a + b) >> 1
                : filter === 4
                  ? paeth(a, b, c)
                  : -1;
      if (pred < 0) return null;
      lines[dst + x] = (v + pred) & 255;
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  // Sample n of row y, scaled to 0..255 (or the raw index for a palette).
  const sample = (y: number, n: number): number => {
    const row = y * stride;
    if (depth === 8) return lines[row + n];
    if (depth === 16) return lines[row + n * 2];
    const bit = n * depth;
    const v = (lines[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return colorType === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  // A tRNS colour key (grey or RGB), compared at the image's own depth.
  const key = (y: number, n: number): number => {
    if (depth !== 16) return sample(y, n);
    return (lines[y * stride + n * 2] << 8) | lines[y * stride + n * 2 + 1];
  };
  const keyValue = (i: number) => (alpha && alpha.length >= (i + 1) * 2 ? (alpha[i * 2] << 8) | alpha[i * 2 + 1] : -1);
  const scaleKey = (v: number) => (depth === 16 || depth === 8 ? v : Math.round((v * 255) / ((1 << depth) - 1)));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const n = x * channels;
      if (colorType === 3) {
        const i = sample(y, n);
        if (!palette || i * 3 + 2 >= palette.length) return null;
        rgba[o] = palette[i * 3];
        rgba[o + 1] = palette[i * 3 + 1];
        rgba[o + 2] = palette[i * 3 + 2];
        rgba[o + 3] = alpha && i < alpha.length ? alpha[i] : 255;
      } else if (colorType === 0 || colorType === 4) {
        const g = sample(y, n);
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        if (colorType === 4) rgba[o + 3] = sample(y, n + 1);
        else rgba[o + 3] = alpha && key(y, n) === scaleKey(keyValue(0)) ? 0 : 255;
      } else {
        rgba[o] = sample(y, n);
        rgba[o + 1] = sample(y, n + 1);
        rgba[o + 2] = sample(y, n + 2);
        if (colorType === 6) rgba[o + 3] = sample(y, n + 3);
        else {
          const transparent =
            alpha &&
            key(y, n) === scaleKey(keyValue(0)) &&
            key(y, n + 1) === scaleKey(keyValue(1)) &&
            key(y, n + 2) === scaleKey(keyValue(2));
          rgba[o + 3] = transparent ? 0 : 255;
        }
      }
    }
  }
  return { width, height, rgba };
}

export interface ImageSize {
  width: number;
  height: number;
}

/** Width and height of a PNG or JPEG from its header, or null. */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 24 && png.every((b, i) => bytes[i] === b)) {
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      // Start of frame (SOF0-SOF15, except DHT, JPG and DAC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = view.getUint16(i + 5);
        const width = view.getUint16(i + 7);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      i += 2 + view.getUint16(i + 2);
    }
  }
  return null;
}
