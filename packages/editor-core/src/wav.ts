// Sounds as plain sample arrays, for the sound player: WAV reading and
// writing, waveform peaks, and the edits (trim, cut, fades, gain).
//
// WAV files are read here (PCM 8/16/24/32-bit and 32-bit float) so an edit
// keeps every sample; MP3 and OGG are decoded by the browser and saved back
// as WAV. Plain TS with no DOM.

export interface Sound {
  sampleRate: number;
  /** One array per channel, samples from -1 to 1. */
  channels: Float32Array[];
}

export const soundLength = (sound: Sound) => sound.channels[0]?.length ?? 0;
export const soundSeconds = (sound: Sound) => soundLength(sound) / sound.sampleRate;

/** Read a WAV file, or null when it is not a PCM or float WAV. */
export function decodeWav(bytes: Uint8Array): Sound | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let format = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bits = 0;
  let data: Uint8Array | null = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ' && size >= 16) {
      format = view.getUint16(body, true);
      channelCount = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the sub-format's first two bytes.
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
    } else if (id === 'data') {
      data = bytes.subarray(body, Math.min(body + size, bytes.length));
    }
    at = body + size + (size & 1);
  }
  const pcm = format === 1 && [8, 16, 24, 32].includes(bits);
  const float = format === 3 && bits === 32;
  if (!data || !channelCount || !sampleRate || (!pcm && !float)) return null;
  const width = bits / 8;
  const frames = Math.floor(data.length / (width * channelCount));
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      const o = (i * channelCount + c) * width;
      let v: number;
      if (float) v = dv.getFloat32(o, true);
      else if (bits === 8) v = (dv.getUint8(o) - 128) / 128;
      else if (bits === 16) v = dv.getInt16(o, true) / 32768;
      else if (bits === 24)
        v = ((dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getInt8(o + 2) << 16)) / 8388608) as number;
      else v = dv.getInt32(o, true) / 2147483648;
      channels[c][i] = v;
    }
  }
  return { sampleRate, channels };
}

/** Write a 16-bit PCM WAV file. */
export function encodeWav(sound: Sound): Uint8Array {
  const channelCount = sound.channels.length;
  const frames = soundLength(sound);
  const dataSize = frames * channelCount * 2;
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);
  const write = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sound.sampleRate, true);
  view.setUint32(28, sound.sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      const v = Math.max(-1, Math.min(1, sound.channels[c][i]));
      view.setInt16(o, v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), true);
      o += 2;
    }
  }
  return out;
}

/**
 * Min and max of every channel over `buckets` equal slices of [from, to),
 * for drawing a waveform: [min0, max0, min1, max1, ...].
 */
export function peaks(sound: Sound, from: number, to: number, buckets: number): Float32Array {
  const out = new Float32Array(buckets * 2);
  const span = Math.max(0, to - from);
  for (let b = 0; b < buckets; b++) {
    const start = from + Math.floor((b * span) / buckets);
    const end = Math.max(start + 1, from + Math.floor(((b + 1) * span) / buckets));
    let min = 0;
    let max = 0;
    for (const ch of sound.channels) {
      for (let i = start; i < end && i < ch.length; i++) {
        const v = ch[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    out[b * 2] = min;
    out[b * 2 + 1] = max;
  }
  return out;
}

const mapChannels = (sound: Sound, fn: (ch: Float32Array) => Float32Array): Sound => ({
  sampleRate: sound.sampleRate,
  channels: sound.channels.map(fn),
});

/** Keep only [from, to). */
export function trimSound(sound: Sound, from: number, to: number): Sound {
  return mapChannels(sound, (ch) => ch.slice(from, to));
}

/** Remove [from, to). */
export function cutSound(sound: Sound, from: number, to: number): Sound {
  return mapChannels(sound, (ch) => {
    const out = new Float32Array(ch.length - (to - from));
    out.set(ch.subarray(0, from), 0);
    out.set(ch.subarray(to), from);
    return out;
  });
}

/** Fade [from, to) in (0 → 1) or out (1 → 0). */
export function fadeSound(sound: Sound, from: number, to: number, direction: 'in' | 'out'): Sound {
  const span = Math.max(1, to - from);
  return mapChannels(sound, (ch) => {
    const out = ch.slice();
    for (let i = from; i < to; i++) {
      const t = (i - from) / span;
      out[i] *= direction === 'in' ? t : 1 - t;
    }
    return out;
  });
}

/** Scale [from, to) so its loudest sample reaches `peak` (no change for silence). */
export function normalizeSound(sound: Sound, from: number, to: number, peak = 1): Sound {
  let max = 0;
  for (const ch of sound.channels) for (let i = from; i < to; i++) max = Math.max(max, Math.abs(ch[i]));
  if (max === 0) return sound;
  const gain = peak / max;
  return mapChannels(sound, (ch) => {
    const out = ch.slice();
    for (let i = from; i < to; i++) out[i] *= gain;
    return out;
  });
}
