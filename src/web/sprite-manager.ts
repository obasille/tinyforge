// Sprite Manager - Handles sprite loading and memory management

import { AssetLoader } from './asset-loader.js';
import { SPRITE_METADATA_ADDR, SPRITE_DATA_ADDR, SPRITE_DATA_SIZE } from '../memory-map.js';

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
   * Load a single sprite file or sprite sheet
   * Sprite sheet format: ID~COLSxROWS-name.png (e.g., "10~4x3-tiles.png")
   * where COLS = sprites across, ROWS = sprites down
   * Everything after dimensions is ignored (just like single sprite names)
   */
  async #loadSprite(id, url) {
    try {
      AssetLoader.checkDuplicate(this.#sprites, id, url, 'Sprite');

      // Check if this is a sprite sheet (format: ID~COLSxROWS-*.ext)
      const basename = url.split('/').pop();
      const sheetMatch = basename.match(/^(\d+)~(\d+)x(\d+)/);
      
      // Load image
      const img = await AssetLoader.loadImage(url);
      const image = img as HTMLImageElement;
      
      if (sheetMatch) {
        // Sprite sheet detected
        const cols = parseInt(sheetMatch[2], 10);
        const rows = parseInt(sheetMatch[3], 10);
        await this.#loadSpriteSheet(image, id, cols, rows, url);
      } else {
        // Single sprite
        await this.#loadSingleSprite(image, id, url);
      }
    } catch (e) {
      console.warn(`Failed to load sprite ${id} from ${url}:`, e.message);
    }
  }

  /**
   * Load a single sprite image
   */
  async #loadSingleSprite(image, id, url) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    
    // Get RGBA pixel data
    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    
    this.#sprites.set(id, {
      width: image.width,
      height: image.height,
      data: imageData.data // Uint8ClampedArray of RGBA values
    });
  }

  /**
   * Load a sprite sheet and split it into individual sprites
   * @param image - The loaded sprite sheet image
   * @param startId - Starting sprite ID
   * @param cols - Number of sprites across (width)
   * @param rows - Number of sprites down (height)
   * @param url - Source URL (for logging)
   */
  async #loadSpriteSheet(image, startId, cols, rows, url) {
    const spriteWidth = Math.floor(image.width / cols);
    const spriteHeight = Math.floor(image.height / rows);
    const totalSprites = cols * rows;
    
    console.log(`Loading sprite sheet: ${url} (${cols}x${rows} = ${totalSprites} sprites, ${spriteWidth}x${spriteHeight} each)`);
    
    // Create a temporary canvas for extraction
    const canvas = document.createElement('canvas');
    canvas.width = spriteWidth;
    canvas.height = spriteHeight;
    const ctx = canvas.getContext('2d');
    
    // Extract each sprite from the sheet
    let currentId = startId;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // Clear canvas
        ctx.clearRect(0, 0, spriteWidth, spriteHeight);
        
        // Draw the sprite region
        const sx = col * spriteWidth;
        const sy = row * spriteHeight;
        ctx.drawImage(
          image,
          sx, sy, spriteWidth, spriteHeight,  // Source
          0, 0, spriteWidth, spriteHeight      // Destination
        );
        
        // Get pixel data
        const imageData = ctx.getImageData(0, 0, spriteWidth, spriteHeight);
        
        // Store sprite
        if (currentId <= 255) {
          this.#sprites.set(currentId, {
            width: spriteWidth,
            height: spriteHeight,
            data: imageData.data
          });
          currentId++;
        } else {
          console.warn(`Sprite ID ${currentId} exceeds maximum (255), skipping remaining sprites`);
          return;
        }
      }
    }
    
    console.log(`Loaded ${totalSprites} sprites from sheet (IDs ${startId}-${currentId - 1})`);
  }

  /**
   * Write all sprite metadata and pixel data to WASM memory
   */
  #writeSpritesToMemory() {
    let dataOffset = 0;
    const view = new DataView(this.#memory.buffer);
    
    // Write metadata for each sprite
    for (const [id, sprite] of this.#sprites) {
      const metadataAddr = SPRITE_METADATA_ADDR + (id * 8);
      
      view.setUint16(metadataAddr + 0, sprite.width, true);   // Width (little-endian)
      view.setUint16(metadataAddr + 2, sprite.height, true);  // Height (little-endian)
      view.setUint32(metadataAddr + 4, dataOffset, true);     // Data offset (little-endian)
      
      dataOffset += sprite.width * sprite.height * 4; // RGBA = 4 bytes per pixel
    }
    
    // Write pixel data
    const spriteDataView = new Uint8Array(this.#memory.buffer, SPRITE_DATA_ADDR);
    let writeOffset = 0;
    
    for (const [id, sprite] of this.#sprites) {
      const pixelData = sprite.data;
      spriteDataView.set(pixelData, writeOffset);
      writeOffset += pixelData.length;
    }
    
    this.#nextDataOffset = dataOffset;
    
    // Check if we exceeded available memory
    if (this.#nextDataOffset > SPRITE_DATA_SIZE) {
      console.warn(`Sprite data exceeds allocated memory: ${this.#nextDataOffset} bytes (max: ${SPRITE_DATA_SIZE})`);
    }
  }
}

export const spriteManager = new SpriteManager();
