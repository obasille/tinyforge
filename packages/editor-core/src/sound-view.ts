// The sound player's waveform and its Web Audio output. Plain TS: the
// waveform is a 2D canvas that redraws on state changes and follows the
// playhead with requestAnimationFrame while a sound plays.

import type { SoundEditor, SoundOutput } from './sound-editor.ts';
import { peaks, type Sound } from './wav.ts';

/** Plays sounds through an AudioContext (created on first use, after a click). */
export class WebSoundOutput implements SoundOutput {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private started = 0;
  private from = 0;
  private rate = 44100;

  constructor(private readonly volume: () => number = () => 1) {}

  private context(): AudioContext {
    this.ctx ??= new AudioContext();
    return this.ctx;
  }

  play(sound: Sound, from: number, to: number, onEnd: () => void): void {
    this.stop();
    const ctx = this.context();
    void ctx.resume();
    const length = Math.max(1, to - from);
    const buffer = ctx.createBuffer(sound.channels.length, length, sound.sampleRate);
    sound.channels.forEach((ch, i) => {
      buffer.copyToChannel(ch.subarray(from, to) as Float32Array<ArrayBuffer>, i);
    });
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = this.volume();
    source.connect(gain).connect(ctx.destination);
    source.onended = () => {
      if (this.source !== source) return;
      this.source = null;
      onEnd();
    };
    this.source = source;
    this.started = ctx.currentTime;
    this.from = from;
    this.rate = sound.sampleRate;
    source.start();
  }

  stop(): void {
    const source = this.source;
    this.source = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
  }

  position(): number | null {
    if (!this.source || !this.ctx) return null;
    return this.from + (this.ctx.currentTime - this.started) * this.rate;
  }

  /** Decode an MP3 or OGG with the browser. */
  async decode(bytes: Uint8Array): Promise<Sound> {
    const buffer = await this.context().decodeAudioData(bytes.slice().buffer);
    return {
      sampleRate: buffer.sampleRate,
      channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice()),
    };
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}

/** "1.234 s" for a sample count. */
export function formatTime(samples: number, sampleRate: number): string {
  return `${(samples / sampleRate).toFixed(3)} s`;
}

export class Waveform {
  private readonly canvas: HTMLCanvasElement;
  private readonly unsubscribe: () => void;
  private readonly resize: ResizeObserver;
  private drag: { anchor: number } | null = null;
  private frame = 0;
  private queued = false;

  constructor(
    private readonly parent: HTMLElement,
    private readonly editor: SoundEditor,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tf-wave-canvas';
    this.canvas.dataset.testid = 'waveform';
    parent.append(this.canvas);
    this.unsubscribe = editor.state.subscribe(() => {
      this.schedule();
      if (editor.state.getState().playing && !this.frame) this.follow();
    });
    this.resize = new ResizeObserver(() => this.schedule());
    this.resize.observe(parent);
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    this.draw();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.unsubscribe();
    this.resize.disconnect();
    this.canvas.remove();
  }

  /** The sample under a client x position. */
  sampleAt(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const { length } = this.editor.state.getState();
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return Math.round(t * length);
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    const at = this.sampleAt(e.clientX);
    const s = this.editor.state.getState();
    // Shift extends the selection from its far end.
    const anchor =
      e.shiftKey && s.selection
        ? Math.abs(at - s.selection.from) > Math.abs(at - s.selection.to)
          ? s.selection.from
          : s.selection.to
        : e.shiftKey
          ? s.cursor
          : at;
    this.drag = { anchor };
    this.editor.select(anchor, at);
  };

  private onMove = (e: PointerEvent) => {
    if (!this.drag) return;
    this.editor.select(this.drag.anchor, this.sampleAt(e.clientX));
  };

  private onUp = (e: PointerEvent) => {
    if (!this.drag) return;
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  };

  private follow(): void {
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
      if (this.editor.state.getState().playing) this.follow();
    });
  }

  private schedule(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.draw();
    });
  }

  private draw(): void {
    const s = this.editor.state.getState();
    const dpr = window.devicePixelRatio || 1;
    const w = this.parent.clientWidth;
    const h = this.parent.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#18181f';
    ctx.fillRect(0, 0, w, h);
    if (!s.ready || s.length === 0 || w === 0) return;
    const x = (sample: number) => (sample / s.length) * w;

    if (s.selection) {
      ctx.fillStyle = 'rgba(108, 182, 255, 0.18)';
      ctx.fillRect(x(s.selection.from), 0, Math.max(1, x(s.selection.to) - x(s.selection.from)), h);
    }
    const mid = h / 2;
    ctx.strokeStyle = '#30303c';
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(w, mid + 0.5);
    ctx.stroke();

    const columns = Math.max(1, Math.floor(w));
    const p = peaks(this.editor.sound, 0, s.length, columns);
    ctx.fillStyle = '#6cb6ff';
    for (let i = 0; i < columns; i++) {
      const top = mid - p[i * 2 + 1] * (mid - 2);
      const bottom = mid - p[i * 2] * (mid - 2);
      ctx.fillRect(i, top, 1, Math.max(1, bottom - top));
    }

    ctx.fillStyle = '#e5c07b';
    ctx.fillRect(Math.round(x(s.cursor)), 0, 1, h);
    const playing = this.editor.position();
    if (playing !== null) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(x(Math.min(playing, s.length))), 0, 1, h);
    }
  }
}
