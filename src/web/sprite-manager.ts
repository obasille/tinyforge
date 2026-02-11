// Sprite Manager - Handles sprite loading and memory management

import {
  SPRITE_DATA_SIZE,
  SPRITE_ID_ENTRY_SIZE,
  SPRITE_ID_MAX_CHARS,
  SPRITE_INFO_ENTRY_SIZE,
  SPRITE_TABLE_ADDR,
  SPRITE_TABLE_HEADER_SIZE,
} from '../memory-map.js';
import {
  AssetDescriptor,
  AssetLoader,
} from './asset-loader.js';
import { addConsoleEntry } from './console-panel.js';

type SpriteEntry = {
  width: number;
  height: number;
  cols: number;
  rows: number;
  frames: Uint8ClampedArray[];
};

class SpriteManager {
  private memory: WebAssembly.Memory | null = null;
  private entries = new Map<string, SpriteEntry>(); // id -> {width, height, cols, rows, frames: Uint8ClampedArray[]}
  private indexById = new Map<string, number>(); // id -> info index
  private idByIndex = new Map<number, string>(); // info index -> id
  private nextIndex = 0;
  private nextDataOffset = 0;

  /**
   * Initialize with WebAssembly memory reference
   */
  public init(memory: WebAssembly.Memory): void {
    this.memory = memory;
  }

  /**
   * Get sprite count
   * @returns {number}
   */
  public getSpriteCount(): number {
    return this.entries.size;
  }

  /**
   * Get total sprite data size in bytes
   * @returns {number}
   */
  public getDataSize(): number {
    return this.nextDataOffset;
  }

  /**
   * Load all sprite files from assets/sprites/ folder
   */
  public async loadSprites(): Promise<void> {
    if (!this.memory) {
      addConsoleEntry('ERROR', 'SpriteManager not initialized with memory');
      return;
    }

    try {
      const spriteAssets: AssetDescriptor[] = await AssetLoader.scanDirectory(
        './assets/sprites/',
        /\.(png|jpg|jpeg)$/i
      );

      for (const asset of spriteAssets) {
        await this.loadSprite(asset);
      }


      // Write all loaded sprites to WASM memory
      this.writeSpritesToMemory();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      addConsoleEntry('WARN', `Sprite loading failed: ${message}`);
    }
  }

  /**
   * Load a single sprite file or sprite sheet
   * Sprite sheet format: {id}~COLSxROWS-name.png (e.g., "10~4x3-tiles.png")
   * where COLS = sprites across, ROWS = sprites down
   * Everything after dimensions is ignored (just like single sprite names)
   */
  private async loadSprite(asset: AssetDescriptor): Promise<void> {
    try {
      const { id, format, url } = asset;
      AssetLoader.checkDuplicate(this.indexById, id, url, 'Sprite');

      // Check if this is a sprite sheet (format: ID~COLSxROWS-*.ext)
      const sheetMatch = format.match(/^(\d+)x(\d+)$/);
      
      // Load image
      const image = await AssetLoader.loadImage(url);
      
      if (sheetMatch) {
        // Sprite sheet detected
        const cols = parseInt(sheetMatch[1], 10);
        const rows = parseInt(sheetMatch[2], 10);
        await this.loadSpriteSheet(image, id, cols, rows, url);
      } else {
        // Single sprite
        await this.loadSingleSprite(image, id, url);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      addConsoleEntry('WARN', `Failed to load sprite ${asset.id} from ${asset.url}: ${message}`);
    }
  }

  /**
   * Load a single sprite image
   */
  private async loadSingleSprite(image: HTMLImageElement, id: string, url: string): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!ctx) {
      throw new Error('Failed to create 2D canvas context for sprite extraction.');
    }
    ctx.drawImage(image, 0, 0);
    
    // Get RGBA pixel data
    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    
    const entry = {
      width: image.width,
      height: image.height,
      cols: 1,
      rows: 1,
      frames: [imageData.data]
    };
    this.setEntry(id, entry, url);
  }

  /**
   * Load a sprite sheet and split it into individual sprites
   * @param image - The loaded sprite sheet image
   * @param startId - Starting sprite ID
   * @param cols - Number of sprites across (width)
   * @param rows - Number of sprites down (height)
   * @param url - Source URL (for logging)
   */
  private async loadSpriteSheet(
    image: HTMLImageElement,
    id: string,
    cols: number,
    rows: number,
    url: string
  ): Promise<void> {
    const spriteWidth = Math.floor(image.width / cols);
    const spriteHeight = Math.floor(image.height / rows);
    
    // Create a temporary canvas for extraction
    const canvas = document.createElement('canvas');
    canvas.width = spriteWidth;
    canvas.height = spriteHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to create 2D canvas context for sprite sheet extraction.');
    }
    
    // Extract each sprite from the sheet
    const frames: Uint8ClampedArray[] = [];
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
        
        frames.push(imageData.data);
      }
    }
    
    const entry = {
      width: spriteWidth,
      height: spriteHeight,
      cols,
      rows,
      frames
    };
    this.setEntry(id, entry, url);
  }

  /**
   * Write all sprite info and pixel data to WASM memory
   */
  private writeSpritesToMemory(): void {
    if (!this.memory) {
      throw new Error('SpriteManager not initialized with memory');
    }
    let dataOffset = 0;
    const view = new DataView(this.memory.buffer);
    const count = this.idByIndex.size;
    const lookupOffset = SPRITE_TABLE_HEADER_SIZE;
    const infoOffset = lookupOffset + count * SPRITE_ID_ENTRY_SIZE;
    const dataStartOffset = infoOffset + count * SPRITE_INFO_ENTRY_SIZE;

    // Write header
    view.setUint16(SPRITE_TABLE_ADDR + 0, count, true);
    view.setUint16(SPRITE_TABLE_ADDR + 2, 0, true);
    view.setUint32(SPRITE_TABLE_ADDR + 4, lookupOffset, true);
    view.setUint32(SPRITE_TABLE_ADDR + 8, infoOffset, true);
    view.setUint32(SPRITE_TABLE_ADDR + 12, dataStartOffset, true);

    // Reset lookup table
    const lookup = new Uint16Array(
      this.memory.buffer,
      SPRITE_TABLE_ADDR + lookupOffset,
      (SPRITE_ID_ENTRY_SIZE / 2) * count
    );
    lookup.fill(0);

    const infoTable = new Uint8Array(
      this.memory.buffer,
      SPRITE_TABLE_ADDR + infoOffset,
      SPRITE_INFO_ENTRY_SIZE * count
    );
    infoTable.fill(0);

    // Write lookup table (UTF-16 code units)
    for (const [index, id] of this.idByIndex) {
      const name = id;
      if (name.length > SPRITE_ID_MAX_CHARS) {
        addConsoleEntry('WARN', `Sprite ID "${name}" exceeds ${SPRITE_ID_MAX_CHARS} chars, skipping lookup entry`);
        continue;
      }
      const baseIndex = index * (SPRITE_ID_ENTRY_SIZE / 2);
      for (let i = 0; i < name.length; i++) {
        lookup[baseIndex + i] = name.charCodeAt(i);
      }
    }
    
    // Write pixel data
    const spriteDataView = new Uint8Array(
      this.memory.buffer,
      SPRITE_TABLE_ADDR + dataStartOffset,
      SPRITE_DATA_SIZE
    );
    let writeOffset = 0;
    
    for (const [index, id] of this.idByIndex) {
      const entry = this.entries.get(id);
      if (!entry) continue;

      const infoAddr = SPRITE_TABLE_ADDR + infoOffset + (index * SPRITE_INFO_ENTRY_SIZE);
      const frameSize = entry.width * entry.height * 4;
      const frameCount = entry.frames.length;

      view.setUint32(infoAddr + 0, SPRITE_TABLE_ADDR + dataStartOffset + dataOffset, true); // Data offset (absolute)
      view.setUint32(infoAddr + 4, frameSize, true);  // Data size per frame
      view.setUint16(infoAddr + 8, entry.width, true);  // Width
      view.setUint16(infoAddr + 10, entry.height, true); // Height
      view.setUint8(infoAddr + 12, entry.cols);
      view.setUint8(infoAddr + 13, entry.rows);
      view.setUint16(infoAddr + 14, 0);

      for (let i = 0; i < frameCount; i++) {
        const pixelData = entry.frames[i];
        spriteDataView.set(pixelData, writeOffset);
        writeOffset += pixelData.length;
        dataOffset += pixelData.length;
      }
    }
    
    this.nextDataOffset = dataOffset;
    
    // Check if we exceeded available memory
    if (this.nextDataOffset > SPRITE_DATA_SIZE) {
      addConsoleEntry('WARN', `Sprite data exceeds allocated memory: ${this.nextDataOffset} bytes (max: ${SPRITE_DATA_SIZE})`);
    }
  }

  private setEntry(id: string, entry: SpriteEntry, url: string): void {
    const index = this.getOrAssignIndex(id, url);
    if (index < 0) return;
    this.entries.set(id, entry);
  }

  private getOrAssignIndex(id: string, url: string): number {
    if (this.indexById.has(id)) {
      return this.indexById.get(id) ?? -1;
    }
    if (this.nextIndex > 255) {
      addConsoleEntry('WARN', `Sprite limit reached (256). Cannot load ${id} from ${url}`);
      return -1;
    }
    const index = this.nextIndex;
    this.nextIndex++;
    this.indexById.set(id, index);
    this.idByIndex.set(index, id);
    return index;
  }
}

export const spriteManager = new SpriteManager();
