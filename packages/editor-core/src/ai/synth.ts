// A small chiptune synthesizer, so the agent can make sounds by writing a
// description instead of audio. It made the games' own sounds (each keeps its
// description, its recipe, in its sidecar): pulse voices with a duty cycle, a
// 16-step triangle and 15-bit LFSR noise like an 8-bit console, plus a smooth
// triangle, saw and sine. The description is kept in the asset's sidecar, so
// a sound can be made again or adjusted.
//
//   { "bpm": 120,
//     "notes": [{ "at": 0, "len": 0.5, "note": "C5", "wave": "square", "to": "C6" }],
//     "tracks": [{ "line": "C4 . E4 - G4 . . -", "step": 0.5, "wave": "triangle" }] }
//
// Times are seconds, or beats when `bpm` is set. A track line is the scripts'
// notation: one token per step, "." holds the previous note, "-" is a rest.
// For noise, the pitch is the noise clock (1000 to 22000 Hz: higher is
// hissier). Noise notes that share a `noiseGroup` continue one generator, in
// the order they are written, as the games' drum lines do; otherwise each
// note starts it afresh. Same description, same sound.

import type { Sound } from '../wav.ts';

/** `triangle` is the 16-step 8-bit one; `softtriangle` is smooth (a drum's skin tone). */
export type Wave = 'square' | 'triangle' | 'softtriangle' | 'saw' | 'sine' | 'noise';
const WAVES: Wave[] = ['square', 'triangle', 'softtriangle', 'saw', 'sine', 'noise'];

/** How a note sounds; a track's settings apply to each of its notes. */
export interface Voice {
  wave?: Wave;
  /** 0 to 1. Default 0.5. */
  vol?: number;
  /** Envelope, in seconds (attack, decay, release) and level (sustain, 0 to 1). */
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  /** Square wave duty cycle, 0.05 to 0.95. Default 0.5 (0.125 and 0.25 are the thin 8-bit pulses). */
  duty?: number;
  /** Linear fades at the ends of the note's whole length, in seconds, on top of the envelope (declicking). */
  fadeIn?: number;
  fadeOut?: number;
  /** Noise notes with the same group share one generator, in the order written (a drum line). */
  noiseGroup?: string;
}

export interface SynthNote extends Voice {
  /** Start, in seconds (or beats with `bpm`). */
  at: number;
  /** Held length, before the release. */
  len: number;
  /** Pitch: a note name ("C4", "F#5", "Bb3") or a frequency in Hz. */
  note: string | number;
  /** Slide to this pitch over the note's length. */
  to?: string | number;
  /** How the slide moves: `exp` (default) evenly in pitch; `drum` falls fast, then settles, like a struck skin. */
  curve?: 'exp' | 'drum';
}

export interface SynthTrack extends Voice {
  /** Tokens separated by spaces: a note name (or Hz, for noise), "." to hold, "-" for a rest. */
  line: string;
  /** Length of one token (seconds, or beats with `bpm`). */
  step: number;
  /** Start of the line. Default 0. */
  at?: number;
  /** Part of each note that sounds, 0.1 to 1. Default 0.9. */
  hold?: number;
}

export interface SynthSpec {
  bpm?: number;
  /** Peak volume, 0 to 1. Default: the renderer's (0.35 for effects, 0.5 for music, like the games' sounds). */
  volume?: number;
  /** A loop has no fade-out at its end. */
  loop?: boolean;
  /** Total length (seconds, or beats with `bpm`): notes are cut there, as a loop's last bar. Default: the end of the last note. */
  length?: number;
  notes?: SynthNote[];
  tracks?: SynthTrack[];
}

export interface SynthOptions {
  sampleRate?: number;
  /** Peak volume when the spec sets none. */
  volume?: number;
}

/** The scripts' rates: effects at 44.1 kHz, music at half that to keep loops small. */
export const SFX_RATE = 44100;
export const MUSIC_RATE = 22050;
const MAX_SECONDS = 120;
const MAX_NOTES = 4000;

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** A note name or a frequency, in Hz. */
export function pitchHz(pitch: string | number): number {
  // A track token can be a frequency too ("8000" for a noise drum).
  if (typeof pitch === 'string' && /^\d+(\.\d+)?$/.test(pitch)) pitch = Number(pitch);
  if (typeof pitch === 'number') {
    // Up to 30 kHz: a noise clock may run near the sample rate (hi-hats).
    if (!(pitch > 0 && pitch <= 30000)) throw new Error(`Frequency out of range: ${pitch}`);
    return pitch;
  }
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(pitch);
  if (!m) throw new Error(`Not a note: "${pitch}" (use names like C4, F#5, Bb3, or a frequency in Hz)`);
  const midi = 12 * (Number(m[3]) + 1) + SEMITONES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 440 * 2 ** ((midi - 69) / 12);
}

const num = (value: unknown, name: string, min: number, max: number, fallback?: number): number => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number from ${min} to ${max}`);
  }
  return value;
};

/** A track's line as notes: a token per step, "." extends the note before it. */
function trackNotes(track: SynthTrack, where: string): SynthNote[] {
  if (typeof track?.line !== 'string') throw new Error(`${where}.line must be a string`);
  const step = num(track.step, `${where}.step`, 0.001, MAX_SECONDS);
  const at = num(track.at, `${where}.at`, 0, MAX_SECONDS, 0);
  const hold = num(track.hold, `${where}.hold`, 0.01, 1, 0.9);
  const { line: _line, step: _step, at: _at, hold: _hold, ...voice } = track;
  const notes: Array<SynthNote & { steps: number }> = [];
  track.line
    .split(/\s+/)
    .filter(Boolean)
    .forEach((token, i) => {
      const last = notes.at(-1);
      if (token === '.') {
        if (last && Math.round((last.at - at) / step) + last.steps === i) last.steps++;
      } else if (token !== '-') {
        notes.push({ ...voice, at: at + i * step, len: 0, note: token, steps: 1 });
      }
    });
  return notes.map(({ steps, ...n }) => ({ ...n, len: steps * step * hold }));
}

/** Render a description to a mono sound. Throws with a readable message when it is invalid. */
export function renderSynth(
  spec: SynthSpec,
  { sampleRate = SFX_RATE, volume: fallback = 0.35 }: SynthOptions = {},
): Sound {
  if (!spec || typeof spec !== 'object') throw new Error('A description is required');
  if (spec.notes !== undefined && !Array.isArray(spec.notes)) throw new Error('notes must be a list');
  if (spec.tracks !== undefined && !Array.isArray(spec.tracks)) throw new Error('tracks must be a list');
  const all = [...(spec.notes ?? []), ...(spec.tracks ?? []).flatMap((t, i) => trackNotes(t, `tracks[${i}]`))];
  if (all.length === 0) throw new Error('notes or tracks: at least one note');
  if (all.length > MAX_NOTES) throw new Error(`At most ${MAX_NOTES} notes`);
  const beat = spec.bpm === undefined ? 1 : 60 / num(spec.bpm, 'bpm', 20, 400);
  const volume = num(spec.volume, 'volume', 0, 1, fallback);
  const notes = all.map((n, i) => {
    const where = i < (spec.notes?.length ?? 0) ? `notes[${i}]` : `a track's note ${n.note}`;
    const wave = n.wave ?? 'square';
    if (!WAVES.includes(wave)) throw new Error(`${where}.wave must be one of ${WAVES.join(', ')}`);
    return {
      wave,
      start: num(n.at, `${where}.at`, 0, MAX_SECONDS / beat) * beat,
      len: num(n.len, `${where}.len`, 0.001, MAX_SECONDS / beat) * beat,
      f0: pitchHz(n.note),
      f1: n.to === undefined ? null : pitchHz(n.to),
      drum: n.curve === 'drum',
      vol: num(n.vol, `${where}.vol`, 0, 1, 0.5),
      attack: num(n.attack, `${where}.attack`, 0, 10, 0.002),
      decay: num(n.decay, `${where}.decay`, 0, 10, 0.05),
      sustain: num(n.sustain, `${where}.sustain`, 0, 1, 0.7),
      release: num(n.release, `${where}.release`, 0, 10, 0.05),
      duty: num(n.duty, `${where}.duty`, 0.05, 0.95, 0.5),
      fadeIn: num(n.fadeIn, `${where}.fadeIn`, 0, 10, 0),
      fadeOut: num(n.fadeOut, `${where}.fadeOut`, 0, 10, 0),
      group: typeof n.noiseGroup === 'string' ? n.noiseGroup : null,
    };
  });
  const seconds =
    spec.length === undefined
      ? Math.max(...notes.map((n) => n.start + n.len + n.release))
      : num(spec.length, 'length', 0.001, MAX_SECONDS / beat) * beat;
  if (seconds > MAX_SECONDS) throw new Error(`The sound is ${seconds.toFixed(1)} s long; at most ${MAX_SECONDS} s`);
  // Sample counts round down, like the scripts: a note of 0.07 s at 22050 Hz is 1543 samples.
  const countOf = (n: (typeof notes)[number]) => Math.max(1, Math.floor((n.len + n.release) * sampleRate));
  const size =
    spec.length === undefined
      ? Math.max(...notes.map((n) => Math.floor(n.start * sampleRate) + countOf(n)))
      : Math.floor(seconds * sampleRate);
  const out = new Float32Array(size);
  // Noise: a 15-bit LFSR stepped at the note's pitch, like an NES noise channel.
  // A group's notes continue one generator in the order they are written (notes, then tracks).
  const groups = new Map<string, { lfsr: number; clock: number }>();
  for (const n of notes) {
    const first = Math.floor(n.start * sampleRate);
    const count = countOf(n);
    let phase = 0;
    const noise = (n.group !== null && groups.get(n.group)) || { lfsr: 1, clock: 0 };
    if (n.group !== null) groups.set(n.group, noise);
    for (let k = 0; k < count; k++) {
      const t = k / sampleRate;
      // A slide over the held part, then hold the end pitch: exponential, or a drum's quick fall.
      const u = Math.min(1, t / n.len);
      const f = n.f1 === null ? n.f0 : n.drum ? n.f1 + (n.f0 - n.f1) * (1 - u) ** 2 : n.f0 * (n.f1 / n.f0) ** u;
      phase = (phase + f / sampleRate) % 1;
      let s: number;
      if (n.wave === 'square') s = phase < n.duty ? 1 : -1;
      else if (n.wave === 'triangle') s = Math.round((Math.abs(phase * 4 - 2) - 1) * 7.5) / 7.5;
      else if (n.wave === 'softtriangle') s = Math.abs(phase * 4 - 2) - 1;
      else if (n.wave === 'saw') s = 2 * phase - 1;
      else if (n.wave === 'sine') s = Math.sin(2 * Math.PI * phase);
      else {
        for (noise.clock += f / sampleRate; noise.clock >= 1; noise.clock--) {
          noise.lfsr = (noise.lfsr >> 1) | (((noise.lfsr ^ (noise.lfsr >> 1)) & 1) << 14);
        }
        s = noise.lfsr & 1 ? 1 : -1;
      }
      let env: number;
      if (t < n.attack) env = t / n.attack;
      else if (t < n.attack + n.decay) env = 1 - (1 - n.sustain) * ((t - n.attack) / n.decay);
      else env = n.sustain;
      if (t > n.len) env *= Math.max(0, 1 - (t - n.len) / Math.max(n.release, 1e-6));
      if (n.fadeIn || n.fadeOut) {
        // A fade at most as long as the note: a fadeOut of the note's length ramps over all of it.
        const fadeIn = n.fadeIn ? k / Math.min(n.fadeIn * sampleRate, count) : 1;
        const fadeOut = n.fadeOut ? (count - k) / Math.min(n.fadeOut * sampleRate, count) : 1;
        env *= Math.min(1, fadeIn, fadeOut);
      }
      // Past the sound's length (a loop's end), the note is cut.
      if (first + k < out.length) out[first + k] += s * env * n.vol;
    }
  }
  // Normalize to the volume (rather than clip when notes add up), and fade
  // the last 5 ms out to avoid a click, unless the sound loops.
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const gain = volume / Math.max(1e-6, peak);
  const fade = spec.loop ? 0 : Math.floor(0.005 * sampleRate);
  for (let i = 0; i < out.length; i++) out[i] *= gain * (fade ? Math.min(1, (out.length - i) / fade) : 1);
  return { sampleRate, channels: [out] };
}
