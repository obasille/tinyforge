// Audio Manager - Handles SFX and Music playback
//
// NOTE: Creating the AudioContext in the constructor (before user interaction) 
// will trigger a browser warning: "AudioContext was not allowed to start."
// This is expected behavior due to browser autoplay policies.
// 
// The audio system will still work correctly - audio simply won't play until
// after the user interacts with the page (clicks start button, presses a key, etc.).
// Games should call playMusic() after detecting user input, not in init().

import {
  AssetDescriptor,
  AssetLoader,
} from './asset-loader.js';
import { addConsoleEntry } from './console-panel.js';

class AudioManager {
  private audioContext: AudioContext;
  private sfxBuffers = new Map<string, AudioBuffer>();
  private musicBuffers = new Map<string, AudioBuffer>();
  private currentMusic: AudioBufferSourceNode | null = null;
  private musicGain: GainNode;

  public constructor() {
    const AudioContextCtor =
      window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error('AudioContext is not supported in this browser.');
    }
    this.audioContext = new AudioContextCtor();
    this.musicGain = this.audioContext.createGain();
    this.musicGain.connect(this.audioContext.destination);
    this.musicGain.gain.value = 0.5; // Music at 50% volume
  }

  /**
   * Get total sprite data size in bytes
   * @returns {number}
   */
  public getDataSize(): number {
    return [...this.sfxBuffers.values(), ...this.musicBuffers.values()]
      .reduce((sum, buf) => sum + buf.length * buf.numberOfChannels * 4, 0);
  }

  /**
   * Get number of loaded sound effects
   * @returns {number}
   */
  public getSfxCount(): number {
    return this.sfxBuffers.size;
  }

  /**
   * Get number of loaded music tracks
   * @returns {number}
   */
  public getMusicCount(): number {
    return this.musicBuffers.size;
  }

  /**
   * Load all audio files from assets/sfx/ and assets/music/ folders
   */
  public async loadAudio(): Promise<void> {
    try {
      // Load SFX files
      const sfxAssets: AssetDescriptor[] = await AssetLoader.scanDirectory(
        './assets/sfx/',
        /\.(wav|mp3|ogg)$/i
      );
      
      for (const asset of sfxAssets) {
        await this.loadAudioFile(this.sfxBuffers, asset.id, asset.url, 'SFX');
      }

      // Load music files
      const musicAssets: AssetDescriptor[] = await AssetLoader.scanDirectory(
        './assets/music/',
        /\.(wav|mp3|ogg)$/i
      );
      
      for (const asset of musicAssets) {
        await this.loadAudioFile(this.musicBuffers, asset.id, asset.url, 'Music');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      addConsoleEntry('WARN', `Audio loading failed: ${message}`);
    }
  }

  /**
   * Load a single audio file into the specified buffer map
   */
  private async loadAudioFile(
    bufferMap: Map<string, AudioBuffer>,
    id: string,
    url: string,
    type: string
  ): Promise<void> {
    try {
      AssetLoader.checkDuplicate(bufferMap, id, url, type);
      
      const arrayBuffer = await AssetLoader.fetchBinary(url);
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      bufferMap.set(id, audioBuffer);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      addConsoleEntry('WARN', `Failed to load ${type} ${id} from ${url}: ${message}`);
    }
  }

  /**
   * Play a sound effect by ID
   */
  public playSfx(id: string, volume = 1.0): void {
    const buffer = this.sfxBuffers.get(id);
    if (!buffer) {
      addConsoleEntry('WARN', `SFX ${id} not loaded`);
      return;
    }

    const source = this.audioContext.createBufferSource();
    const gainNode = this.audioContext.createGain();
    
    source.buffer = buffer;
    gainNode.gain.value = Math.max(0, Math.min(1, volume));
    
    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    source.start(0);
  }

  /**
   * Play background music by ID (loops continuously)
   */
  public playMusic(id: string, volume = 1.0): void {
    this.stopMusic();
    
    const buffer = this.musicBuffers.get(id);
    if (!buffer) {
      addConsoleEntry('WARN', `Music ${id} not loaded`);
      return;
    }

    const source = this.audioContext.createBufferSource();
    const gainNode = this.audioContext.createGain();
    
    source.buffer = buffer;
    source.loop = true;
    gainNode.gain.value = Math.max(0, Math.min(1, volume));
    
    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    source.start(0);
    
    this.currentMusic = source;
  }

  /**
   * Stop currently playing music
   */
  public stopMusic(): void {
    if (this.currentMusic) {
      this.currentMusic.stop();
      this.currentMusic = null;
    }
  }
}

export const audioManager = new AudioManager();
