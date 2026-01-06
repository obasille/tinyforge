// Sprite Manager - Handles sprite loading and memory management

import { AssetLoader } from './asset-loader.js';

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
   * Get sprite count
   * @returns {number}
   */
  getSpriteCount() {
    return this.#sprites.size;
  }

  /**
   * Get total sprite data size in bytes
   * @returns {number}
   */
  getDataSize() {
    return this.#nextDataOffset;
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
      const spriteAssets = await AssetLoader.scanDirectory(
        '../assets/sprites/',
        /\.(png|jpg|jpeg)$/i,
        0,
        255
      );

      for (const asset of spriteAssets) {
        await this.#loadSprite(asset.id, asset.url);
      }

      // Write all loaded sprites to WASM memory
      this.#writeSpritesToMemory();
    } catch (e) {
      console.warn('Sprite loading failed:', e.message);
    }
  }

  /**
   * Load a single sprite file
   */
  async #loadSprite(id, url) {
    try {
      AssetLoader.checkDuplicate(this.#sprites, id, url, 'Sprite');

      // Load image
      const img = await AssetLoader.loadImage(url);
      
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

      // console.log(`Loaded sprite ${id}: ${img.width}x${img.height} from ${url}`);
    } catch (e) {
      console.warn(`Failed to load sprite ${id} from ${url}:`, e.message);
    }
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
}

export const spriteManager = new SpriteManager();
