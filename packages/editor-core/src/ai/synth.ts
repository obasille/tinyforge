// A small synthesizer for retro sound effects and music, so the agent can make
// sounds by writing a description instead of audio. The description is kept
// in the asset's sidecar, so a sound can be made again or adjusted.
//
//   { "bpm": 120, "notes": [
//       { "at": 0, "len": 0.5, "note": "C5", "wave": "square", "to": "C6" },
//       { "at": 0.5, "len": 1, "note": "E4", "wave": "triangle", "vol": 0.6 } ] }
//
// Times are seconds, or beats when `bpm` is set. Same description, same sound
// (noise uses a fixed seed).

import type { Sound } from '../wav.ts';

export type Wave = 'square' | 'triangle' | 'saw' | 'sine' | 'noise';
const WAVES: Wave[] = ['square', 'triangle', 'saw', 'sine', 'noise'];

export interface SynthNote {
  /** Start, in seconds (or beats with `bpm`). */
  at: number;
  /** Held length, before the release. */
  len: number;
  wave?: Wave;
  /** Pitch: a note name ("C4", "F#5", "Bb3") or a frequency in Hz. */
  note: string | number;
  /** Slide to this pitch over the note's length. */
  to?: string | number;
  /** 0 to 1. Default 0.5. */
  vol?: number;
  /** Envelope, in seconds (attack, decay, release) and level (sustain, 0 to 1). */
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  /** Square wave duty cycle, 0.05 to 0.95. Default 0.5. */
  duty?: number;
}

export interface SynthSpec {
  bpm?: number;
  /** Master volume, 0 to 1. Default 0.8. */
  volume?: number;
  notes: SynthNote[];
}

export const SYNTH_RATE = 22050;
const MAX_SECONDS = 120;
const MAX_NOTES = 4000;

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** A note name or a frequency, in Hz. */
export function pitchHz(pitch: string | number): number {
  if (typeof pitch === 'number') {
    if (!(pitch > 0 && pitch < 20000)) throw new Error(`Frequency out of range: ${pitch}`);
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

/** Render a description to a mono sound. Throws with a readable message when it is invalid. */
export function renderSynth(spec: SynthSpec, sampleRate = SYNTH_RATE): Sound {
  if (!spec || !Array.isArray(spec.notes) || spec.notes.length === 0) throw new Error('notes: at least one note');
  if (spec.notes.length > MAX_NOTES) throw new Error(`At most ${MAX_NOTES} notes`);
  const beat = spec.bpm === undefined ? 1 : 60 / num(spec.bpm, 'bpm', 20, 400);
  const volume = num(spec.volume, 'volume', 0, 1, 0.8);
  const notes = spec.notes.map((n, i) => {
    const where = `notes[${i}]`;
    const wave = n.wave ?? 'square';
    if (!WAVES.includes(wave)) throw new Error(`${where}.wave must be one of ${WAVES.join(', ')}`);
    return {
      wave,
      start: num(n.at, `${where}.at`, 0, MAX_SECONDS / beat) * beat,
      len: num(n.len, `${where}.len`, 0.001, MAX_SECONDS / beat) * beat,
      f0: pitchHz(n.note),
      f1: n.to === undefined ? null : pitchHz(n.to),
      vol: num(n.vol, `${where}.vol`, 0, 1, 0.5),
      attack: num(n.attack, `${where}.attack`, 0, 10, 0.005),
      decay: num(n.decay, `${where}.decay`, 0, 10, 0.05),
      sustain: num(n.sustain, `${where}.sustain`, 0, 1, 0.7),
      release: num(n.release, `${where}.release`, 0, 10, 0.05),
      duty: num(n.duty, `${where}.duty`, 0.05, 0.95, 0.5),
    };
  });
  const seconds = Math.max(...notes.map((n) => n.start + n.len + n.release));
  if (seconds > MAX_SECONDS) throw new Error(`The sound is ${seconds.toFixed(1)} s long; at most ${MAX_SECONDS} s`);
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  let seed = 0x2545f491;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) / 0xffffffff) * 2 - 1;
  };
  for (const n of notes) {
    const first = Math.floor(n.start * sampleRate);
    const count = Math.ceil((n.len + n.release) * sampleRate);
    let phase = 0;
    let held = 0;
    for (let k = 0; k < count && first + k < out.length; k++) {
      const t = k / sampleRate;
      // Exponential slide over the held part, then hold the end pitch.
      const f = n.f1 === null ? n.f0 : n.f0 * (n.f1 / n.f0) ** Math.min(1, t / n.len);
      const prev = phase;
      phase = (phase + f / sampleRate) % 1;
      let s: number;
      if (n.wave === 'square') s = phase < n.duty ? 1 : -1;
      else if (n.wave === 'triangle') s = 1 - 4 * Math.abs(phase - 0.5);
      else if (n.wave === 'saw') s = 2 * phase - 1;
      else if (n.wave === 'sine') s = Math.sin(2 * Math.PI * phase);
      else {
        // Noise: a new random value each cycle, so the pitch colours it.
        if (phase < prev || k === 0) held = random();
        s = held;
      }
      let env: number;
      if (t < n.attack) env = t / n.attack;
      else if (t < n.attack + n.decay) env = 1 - (1 - n.sustain) * ((t - n.attack) / n.decay);
      else env = n.sustain;
      if (t > n.len) env *= Math.max(0, 1 - (t - n.len) / Math.max(n.release, 1e-6));
      out[first + k] += s * env * n.vol;
    }
  }
  // Scale down rather than clip when notes add up past full scale.
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const gain = volume / Math.max(1, peak);
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return { sampleRate, channels: [out] };
}
