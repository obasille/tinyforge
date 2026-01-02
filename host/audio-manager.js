// Audio Manager - Handles SFX and Music playback

class AudioManager {
  #audioContext = null;
  #sfxBuffers = new Map();
  #musicBuffers = new Map();
  #currentMusic = null;
  #musicGain = null;

  /**
   * Initialize Web Audio API context
   * Must be called after user interaction due to browser autoplay policies
   */
  #init() {
    if (this.#audioContext) return;
    
    this.#audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.#musicGain = this.#audioContext.createGain();
    this.#musicGain.connect(this.#audioContext.destination);
    this.#musicGain.gain.value = 0.5; // Music at 50% volume
  }

  /**
   * Extract numeric ID from filename (e.g., "0-jump.wav" -> 0)
   */
  #extractId(filename) {
    const match = filename.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Load all audio files from assets/sfx/ and assets/music/ folders
   */
  async loadAudio() {
    this.#init();
    
    try {
      // Load SFX files
      const sfxResponse = await fetch('../assets/sfx/');
      if (sfxResponse.ok) {
        const sfxHtml = await sfxResponse.text();
        const sfxFiles = this.#parseDirectoryListing(sfxHtml, /\.(wav|mp3|ogg)$/i);
        
        for (const file of sfxFiles) {
          const id = this.#extractId(file);
          if (id !== null) {
            await this.#loadAudioFile(this.#sfxBuffers, id, `../assets/sfx/${file}`, 'SFX');
          }
        }
      }

      // Load music files
      const musicResponse = await fetch('../assets/music/');
      if (musicResponse.ok) {
        const musicHtml = await musicResponse.text();
        const musicFiles = this.#parseDirectoryListing(musicHtml, /\.(wav|mp3|ogg)$/i);
        
        for (const file of musicFiles) {
          const id = this.#extractId(file);
          if (id !== null) {
            await this.#loadAudioFile(this.#musicBuffers, id, `../assets/music/${file}`, 'Music');
          }
        }
      }
    } catch (e) {
      console.warn('Audio loading failed (folders may not exist yet):', e.message);
    }
  }

  /**
   * Parse directory listing HTML to extract filenames
   */
  #parseDirectoryListing(html, pattern) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const links = Array.from(doc.querySelectorAll('a'));
    return links
      .map(a => a.getAttribute('href'))
      .filter(href => href && pattern.test(href));
  }

  /**
   * Load a single audio file into the specified buffer map
   */
  async #loadAudioFile(bufferMap, id, url, type) {
    try {
      if (bufferMap.has(id)) {
        console.warn(`${type} ID ${id} already loaded, overwriting with ${url}`);
      }
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
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
    this.#init();
    
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
    this.#init();
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
