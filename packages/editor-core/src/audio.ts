// Plays the game's audio commands on the main thread (AudioContext does not
// exist in Workers). Same behaviour as the classic host's audio manager.

import type { AudioCommand } from '@tinyforge/runtime';
import type { AssetRef } from './protocol.ts';

export class AudioPlayer {
  private readonly ctx: AudioContext;
  private readonly sfx = new Map<string, AudioBuffer>();
  private readonly music = new Map<string, AudioBuffer>();
  private current: AudioBufferSourceNode | null = null;

  constructor(
    private readonly warn: (message: string) => void,
    ctx?: AudioContext,
  ) {
    this.ctx = ctx ?? new AudioContext();
  }

  async load(sfx: AssetRef[], music: AssetRef[]): Promise<void> {
    await Promise.all([
      ...sfx.map((ref) => this.loadOne(this.sfx, ref, 'SFX')),
      ...music.map((ref) => this.loadOne(this.music, ref, 'Music')),
    ]);
  }

  get counts(): { sfx: number; music: number } {
    return { sfx: this.sfx.size, music: this.music.size };
  }

  /** Browsers start audio suspended until a user gesture. */
  unlock(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(command: AudioCommand): void {
    switch (command.type) {
      case 'sfx': {
        const buffer = this.sfx.get(command.id);
        if (!buffer) {
          this.warn(`SFX ${command.id} not loaded`);
          return;
        }
        this.start(buffer, command.volume, false);
        break;
      }
      case 'music': {
        this.stopMusic();
        const buffer = this.music.get(command.id);
        if (!buffer) {
          this.warn(`Music ${command.id} not loaded`);
          return;
        }
        this.current = this.start(buffer, command.volume, true);
        break;
      }
      case 'stopMusic':
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
    source.connect(gain).connect(this.ctx.destination);
    source.start(0);
    return source;
  }

  private async loadOne(into: Map<string, AudioBuffer>, ref: AssetRef, kind: string): Promise<void> {
    try {
      const res = await fetch(ref.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      into.set(ref.id, await this.ctx.decodeAudioData(await res.arrayBuffer()));
    } catch (e) {
      this.warn(`Failed to load ${kind} ${ref.id} from ${ref.url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
