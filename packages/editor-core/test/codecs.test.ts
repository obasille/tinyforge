import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, encodePng, imageSize } from '../src/png.ts';
import { cutSound, decodeWav, encodeWav, fadeSound, normalizeSound, peaks, trimSound } from '../src/wav.ts';

function pngChunk(type: string, data: Buffer): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const body = Buffer.concat([Buffer.from(type), data]);
  let c = 0xffffffff;
  for (const x of body) c = table[(c ^ x) & 255] ^ (c >>> 8);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0, body.length + 4);
  return out;
}

/** A PNG from raw filtered scanlines, for the colour types the encoder never writes. */
function rawPng(
  width: number,
  height: number,
  depth: number,
  colorType: number,
  lines: number[][],
  extra: Buffer[] = [],
) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = colorType;
  const raw = Buffer.from(lines.flatMap((l) => [0, ...l]));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', header),
      ...extra,
      pngChunk('IDAT', deflateSync(raw)),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

describe('PNG', () => {
  it('round-trips every pixel, half-transparent ones included', async () => {
    const width = 13;
    const height = 7;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37 + (i >> 3) * 11) & 255;
    const png = await encodePng({ width, height, rgba });
    expect(imageSize(png)).toEqual({ width, height });
    const back = await decodePng(png);
    expect(back?.width).toBe(width);
    expect(back?.rgba).toEqual(rgba);
  });

  it('reads palette, grey and RGB images', async () => {
    // 2-bit palette with tRNS: 3 pixels.
    const pal = rawPng(
      3,
      1,
      2,
      3,
      [[0b00011000]],
      [pngChunk('PLTE', Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255])), pngChunk('tRNS', Buffer.from([0]))],
    );
    expect([...((await decodePng(pal))?.rgba ?? [])]).toEqual([255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 255, 255]);
    // 8-bit grey + alpha.
    const ga = rawPng(1, 1, 8, 4, [[100, 50]]);
    expect([...((await decodePng(ga))?.rgba ?? [])]).toEqual([100, 100, 100, 50]);
    // 8-bit RGB with a colour key.
    const rgb = rawPng(2, 1, 8, 2, [[1, 2, 3, 9, 9, 9]], [pngChunk('tRNS', Buffer.from([0, 1, 0, 2, 0, 3]))]);
    expect([...((await decodePng(rgb))?.rgba ?? [])]).toEqual([1, 2, 3, 0, 9, 9, 9, 255]);
    // 16-bit RGBA keeps the high bytes.
    const deep = rawPng(1, 1, 16, 6, [[0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xff, 0xff]]);
    expect([...((await decodePng(deep))?.rgba ?? [])]).toEqual([0x12, 0x56, 0x9a, 0xff]);
    expect(await decodePng(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('WAV', () => {
  const sound = { sampleRate: 8000, channels: [new Float32Array([0, 0.5, -0.5, 1, -1, 0.25])] };

  it('round-trips 16-bit PCM', () => {
    const back = decodeWav(encodeWav(sound));
    expect(back?.sampleRate).toBe(8000);
    for (let i = 0; i < 6; i++) expect(back?.channels[0][i]).toBeCloseTo(sound.channels[0][i], 4);
    expect(decodeWav(new Uint8Array(10))).toBeNull();
  });

  it('edits samples', () => {
    expect([...trimSound(sound, 1, 3).channels[0]]).toEqual([0.5, -0.5]);
    expect([...cutSound(sound, 1, 5).channels[0]]).toEqual([0, 0.25]);
    expect([...fadeSound(sound, 0, 4, 'in').channels[0]]).toEqual([0, 0.125, -0.25, 0.75, -1, 0.25]);
    expect([...normalizeSound(sound, 1, 3).channels[0]].slice(1, 3)).toEqual([1, -1]);
    expect([...peaks(sound, 0, 6, 2)]).toEqual([-0.5, 0.5, -1, 1]);
  });
});
