// Sprite Manager - Handles sprite loading and memory management

class SpriteManager {
  #memory = null;
  #sprites = new Map(); // id -> {width, height, data: Uint8Array (RGBA)}
  #nextDataOffset = 0;

  /**
   * Initialize with WebAssembly memory reference
   */
  init(memory) {
    this.#memory = memory;
  }

  /**
   * Extract numeric ID from filename (e.g., "0-player.png" -> 0)
   */
  #extractId(filename) {
    const match = filename.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Load all sprite files from assets/sprites/ folder
   */
  async loadSprites() {
    if (!this.#memory) {
      console.error('SpriteManager not initialized with memory');
      return;
    }

    try {
      const response = await fetch('../assets/sprites/');
      if (!response.ok) {
        console.warn('Sprites folder not accessible, skipping sprite loading');
        return;
      }

      const html = await response.text();
      const spriteFiles = this.#parseDirectoryListing(html, /\.(png|jpg|jpeg)$/i);

      for (const file of spriteFiles) {
        const id = this.#extractId(file);
        if (id !== null && id >= 0 && id < 256) {
          await this.#loadSprite(id, `../assets/sprites/${file}`);
        }
      }

      // Write all loaded sprites to WASM memory
      this.#writeSpritesToMemory();
      
      console.log(`Loaded ${this.#sprites.size} sprites`);
    } catch (e) {
      console.warn('Sprite loading failed:', e.message);
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
   * Load a single sprite file
   */
  async #loadSprite(id, url) {
    try {
      if (this.#sprites.has(id)) {
        console.warn(`Sprite ID ${id} already loaded, overwriting with ${url}`);
      }

      // Load image
      const img = await this.#loadImage(url);
      
      // Create canvas to extract pixel data
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      
      // Get RGBA pixel data
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      
      this.#sprites.set(id, {
        width: img.width,
        height: img.height,
        data: imageData.data // Uint8ClampedArray of RGBA values
      });

      console.log(`Loaded sprite ${id}: ${img.width}x${img.height} from ${url}`);
    } catch (e) {
      console.warn(`Failed to load sprite ${id} from ${url}:`, e.message);
    }
  }

  /**
   * Load image as promise
   */
  #loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
  }

  /**
   * Write all sprite metadata and pixel data to WASM memory
   */
  #writeSpritesToMemory() {
    const SPRITE_METADATA = 0x0AB100;
    const SPRITE_DATA = 0x0AB900;
    
    let dataOffset = 0;
    const view = new DataView(this.#memory.buffer);
    
    // Write metadata for each sprite
    for (const [id, sprite] of this.#sprites) {
      const metadataAddr = SPRITE_METADATA + (id * 8);
      
      view.setUint16(metadataAddr + 0, sprite.width, true);   // Width (little-endian)
      view.setUint16(metadataAddr + 2, sprite.height, true);  // Height (little-endian)
      view.setUint32(metadataAddr + 4, dataOffset, true);     // Data offset (little-endian)
      
      dataOffset += sprite.width * sprite.height * 4; // RGBA = 4 bytes per pixel
    }
    
    // Write pixel data
    const spriteDataView = new Uint8Array(this.#memory.buffer, SPRITE_DATA);
    let writeOffset = 0;
    
    for (const [id, sprite] of this.#sprites) {
      const pixelData = sprite.data;
      spriteDataView.set(pixelData, writeOffset);
      writeOffset += pixelData.length;
    }
    
    this.#nextDataOffset = dataOffset;
    
    // Check if we exceeded available memory
    if (this.#nextDataOffset > 131072) { // ~128 KB limit
      console.warn(`Sprite data exceeds allocated memory: ${this.#nextDataOffset} bytes`);
    }
  }

  /**
   * Get sprite count
   */
  getSpriteCount() {
    return this.#sprites.size;
  }

  /**
   * Get total sprite data size in bytes
   */
  getDataSize() {
    return this.#nextDataOffset;
  }
}

export const spriteManager = new SpriteManager();
