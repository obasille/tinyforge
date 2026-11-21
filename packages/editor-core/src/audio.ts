// Plays the game's audio commands on the main thread (AudioContext does not
// exist in Workers). Same behaviour as the classic host's audio manager.

import type { AudioCommand } from '@tinyforge/runtime';
import type { AssetRef } from './protocol.ts';

interface Loaded {
  url: string;
  buffer: AudioBuffer;
}

export class AudioPlayer {
  private readonly ctx: AudioContext;
  private readonly sfx = new Map<string, Loaded>();
  private readonly music = new Map<string, Loaded>();
  private loadSeq = 0;
  /** The load in progress and the IDs it brings, for sounds played meanwhile. */
  private loading: { done: Promise<void>; ids: Set<string> } | null = null;
  /** Bumped by every music command, so a deferred track does not override a later one. */
  private musicSeq = 0;
  private current: AudioBufferSourceNode | null = null;
  /** Every sound goes through this node: the editor's master volume. */
  private readonly master: GainNode;
  private volume = 1;
  private muted = false;

  constructor(
    private readonly warn: (message: string) => void,
    ctx?: AudioContext,
  ) {
    this.ctx = ctx ?? new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
  }

  /** Master volume (0..1) and mute. Applies to sounds already playing too. */
  setOutput(volume: number, muted: boolean): void {
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
    this.muted = muted;
    this.master.gain.value = this.outputGain;
  }

  get outputGain(): number {
    return this.muted ? 0 : this.volume;
  }

  /**
   * Load the given sounds (the current game's); anything not listed is
   * dropped. A sound whose URL did not change is kept, not fetched again.
   * When loads overlap, the last one called wins.
   */
  async load(sfx: AssetRef[], music: AssetRef[]): Promise<void> {
    const seq = ++this.loadSeq;
    const nextSfx = new Map<string, Loaded>();
    const nextMusic = new Map<string, Loaded>();
    const done = Promise.all([
      ...sfx.map((ref) => this.loadOne(nextSfx, this.sfx, ref, 'SFX')),
      ...music.map((ref) => this.loadOne(nextMusic, this.music, ref, 'Music')),
    ]).then(() => {
      if (seq !== this.loadSeq) return;
      // Swap only once everything decoded, so sounds keep playing meanwhile.
      this.replace(this.sfx, nextSfx);
      this.replace(this.music, nextMusic);
      this.loading = null;
    });
    this.loading = { done, ids: new Set([...sfx, ...music].map((r) => r.id)) };
    await done;
  }

  /**
   * A sound that is still loading (a game plays its first sounds while they
   * decode): play it once loaded. Returns false when it is not loading.
   */
  private defer(command: AudioCommand & { id: string }): boolean {
    const loading = this.loading;
    if (!loading?.ids.has(command.id)) return false;
    const musicSeq = this.musicSeq;
    const loadSeq = this.loadSeq;
    void loading.done.then(() => {
      if (command.type === 'music' && musicSeq !== this.musicSeq) return;
      if (loadSeq !== this.loadSeq) return; // a newer load (another game) took over
      this.play(command, false);
    });
    return true;
  }

  private replace(into: Map<string, Loaded>, from: Map<string, Loaded>): void {
    into.clear();
    for (const [id, buffer] of from) into.set(id, buffer);
  }

  get counts(): { sfx: number; music: number } {
    return { sfx: this.sfx.size, music: this.music.size };
  }

  /** Browsers start audio suspended until a user gesture. */
  unlock(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(command: AudioCommand, canDefer = true): void {
    switch (command.type) {
      case 'sfx': {
        const buffer = this.sfx.get(command.id)?.buffer;
        if (!buffer) {
          if (canDefer && this.defer(command)) return;
          this.warn(`SFX ${command.id} not loaded`);
          return;
        }
        this.start(buffer, command.volume, false);
        break;
      }
      case 'music': {
        if (canDefer) this.musicSeq++;
        this.stopMusic();
        const buffer = this.music.get(command.id)?.buffer;
        if (!buffer) {
          if (canDefer && this.defer(command)) return;
          this.warn(`Music ${command.id} not loaded`);
          return;
        }
        this.current = this.start(buffer, command.volume, true);
        break;
      }
      case 'stopMusic':
        this.musicSeq++;
        this.stopMusic();
        break;
    }
  }

  stopMusic(): void {
    this.current?.stop();
    this.current = null;
  }

  private start(buffer: AudioBuffer, volume: number, loop: boolean): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    source.loop = loop;
    gain.gain.value = Math.max(0, Math.min(1, volume));
    source.connect(gain).connect(this.master);
    source.start(0);
    return source;
  }

  private async loadOne(
    into: Map<string, Loaded>,
    previous: Map<string, Loaded>,
    ref: AssetRef,
    kind: string,
  ): Promise<void> {
    const kept = previous.get(ref.id);
    if (kept?.url === ref.url) {
      into.set(ref.id, kept);
      return;
    }
    try {
      const res = await fetch(ref.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      into.set(ref.id, { url: ref.url, buffer: await this.ctx.decodeAudioData(await res.arrayBuffer()) });
    } catch (e) {
      this.warn(`Failed to load ${kind} ${ref.id} from ${ref.url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
