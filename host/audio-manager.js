// Audio Manager - Handles SFX and Music playback
//
// NOTE: Creating the AudioContext in the constructor (before user interaction) 
// will trigger a browser warning: "AudioContext was not allowed to start."
// This is expected behavior due to browser autoplay policies.
// 
// The audio system will still work correctly - audio simply won't play until
// after the user interacts with the page (clicks start button, presses a key, etc.).
// Games should call playMusic() after detecting user input, not in init().

import { AssetLoader } from './asset-loader.js';

class AudioManager {
  #audioContext = null;
  #sfxBuffers = new Map();
  #musicBuffers = new Map();
  #currentMusic = null;
  #musicGain = null;

  constructor() {
    this.#audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.#musicGain = this.#audioContext.createGain();
    this.#musicGain.connect(this.#audioContext.destination);
    this.#musicGain.gain.value = 0.5; // Music at 50% volume
  }

  /**
   * Get total sprite data size in bytes
   * @returns {number}
   */
  getDataSize() {
    return [...this.#sfxBuffers.values(), ...this.#musicBuffers.values()]
      .reduce((sum, buf) => sum + buf.length * buf.numberOfChannels * 4, 0);
  }

  /**
   * Get number of loaded sound effects
   * @returns {number}
   */
  getSfxCount() {
    return this.#sfxBuffers.size;
  }

  /**
   * Get number of loaded music tracks
   * @returns {number}
   */
  getMusicCount() {
    return this.#musicBuffers.size;
  }

  /**
   * Load all audio files from assets/sfx/ and assets/music/ folders
   */
  async loadAudio() {
    try {
      // Load SFX files
      const sfxAssets = await AssetLoader.scanDirectory(
        '../assets/sfx/',
        /\.(wav|mp3|ogg)$/i
      );
      
      for (const asset of sfxAssets) {
        await this.#loadAudioFile(this.#sfxBuffers, asset.id, asset.url, 'SFX');
      }

      // Load music files
      const musicAssets = await AssetLoader.scanDirectory(
        '../assets/music/',
        /\.(wav|mp3|ogg)$/i
      );
      
      for (const asset of musicAssets) {
        await this.#loadAudioFile(this.#musicBuffers, asset.id, asset.url, 'Music');
      }
    } catch (e) {
      console.warn('Audio loading failed:', e.message);
    }
  }

  /**
   * Load a single audio file into the specified buffer map
   */
  async #loadAudioFile(bufferMap, id, url, type) {
    try {
      AssetLoader.checkDuplicate(bufferMap, id, url, type);
      
      const arrayBuffer = await AssetLoader.fetchBinary(url);
      const audioBuffer = await this.#audioContext.decodeAudioData(arrayBuffer);
      bufferMap.set(id, audioBuffer);
    } catch (e) {
      console.warn(`Failed to load ${type} ${id} from ${url}:`, e.message);
    }
  }

  /**
   * Play a sound effect by ID
   */
  playSfx(id, volume = 1.0) {
    const buffer = this.#sfxBuffers.get(id);
    if (!buffer) {
      console.warn(`SFX ${id} not loaded`);
      return;
    }

    const source = this.#audioContext.createBufferSource();
    const gainNode = this.#audioContext.createGain();
    
    source.buffer = buffer;
    gainNode.gain.value = Math.max(0, Math.min(1, volume));
    
    source.connect(gainNode);
    gainNode.connect(this.#audioContext.destination);
    source.start(0);
  }

  /**
   * Play background music by ID (loops continuously)
   */
  playMusic(id, volume = 1.0) {
    this.stopMusic();
    
    const buffer = this.#musicBuffers.get(id);
    if (!buffer) {
      console.warn(`Music ${id} not loaded`);
      return;
    }

    const source = this.#audioContext.createBufferSource();
    const gainNode = this.#audioContext.createGain();
    
    source.buffer = buffer;
    source.loop = true;
    gainNode.gain.value = Math.max(0, Math.min(1, volume));
    
    source.connect(gainNode);
    gainNode.connect(this.#audioContext.destination);
    source.start(0);
    
    this.#currentMusic = source;
  }

  /**
   * Stop currently playing music
   */
  stopMusic() {
    if (this.#currentMusic) {
      this.#currentMusic.stop();
      this.#currentMusic = null;
    }
  }
}

export const audioManager = new AudioManager();
