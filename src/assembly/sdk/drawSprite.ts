// TinyForge SDK - Drawing Primitives
// Low-level and high-level sprite drawing functions for rendering graphics

import {
    WIDTH,
    HEIGHT,
    SPRITE_TABLE_ADDR,
    SPRITE_ID_ENTRY_SIZE,
    SPRITE_ID_MAX_CHARS,
    SPRITE_INFO_ENTRY_SIZE
  } from "./memory";
  
@unmanaged
class SpriteInfo {
  dataOffset: u32; // 0
  dataSize: u32;   // 4
  width: u16;      // 8
  height: u16;     // 10
  cols: u8;        // 12
  rows: u8;        // 13
  _padding: u16;   // 14
}

// @ts-expect-error AssemblyScript decorator
@inline
function getSpriteInfoPtr(infoOffset: u32, index: i32): SpriteInfo {
  return changetype<SpriteInfo>(
    (SPRITE_TABLE_ADDR as u32) + infoOffset + (index as u32) * (SPRITE_INFO_ENTRY_SIZE as u32)
  );
}

/**
 * Resolve a sprite string ID to a packed sprite ID via lookup table.
 * Returns -1 if not found or invalid x or y indices.
 * @param name Sprite name
 * @param x For sprite sheet, the column index
 * @param y For sprite sheet, the row index
 * @returns Numeric ID
 */
export function s(name: string, x: i32 = 0, y: i32 = 0): i32 {
  const length = name.length;
  if (length == 0 || length > SPRITE_ID_MAX_CHARS) {
    return -1;
  }

  const count = load<u16>(SPRITE_TABLE_ADDR) as i32;
  if (count <= 0) {
    return -1;
  }

  const lookupOffset = load<u32>(SPRITE_TABLE_ADDR + 4);
  const infoOffset = load<u32>(SPRITE_TABLE_ADDR + 8);

  for (let id: i32 = 0; id < count; id++) {
    const base = SPRITE_TABLE_ADDR + lookupOffset + (id as usize) * SPRITE_ID_ENTRY_SIZE;
    let match = true;
    for (let i: i32 = 0; i < SPRITE_ID_MAX_CHARS; i++) {
      const tableChar = load<u16>(base + (i << 1));
      if (i < length) {
        if (tableChar != (name.charCodeAt(i) as u16)) {
          match = false;
          break;
        }
      } else {
        if (tableChar != 0) {
          match = false;
        }
        break;
      }
    }
    if (match) {
      const info = getSpriteInfoPtr(infoOffset, id);
      const cols = info.cols as i32;
      const rows = info.rows as i32;
      if (x < 0 || y < 0 || x >= cols || y >= rows) {
        return -1;
      }
      const frameIndex = y * cols + x;
      return ((id & 0xffff) << 16) | (frameIndex & 0xffff);
    }
  }

  return -1;
}

// Values updated by readAndCheckSpriteInfo
let readFrameOffset: u32 = 0;
let readWidth: i32 = 0;
let readHeight: i32 = 0;

/**
 * Read the sprite info for the given ID
 * @param id Packed sprite ID from s()
 * @returns True if the sprite info was read successfully, false otherwise
 */
export function readSpriteInfo(id: i32): bool {
  if (id < 0) return false;

  const infoIndex = (id >>> 16) & 0xffff;
  const packedFrameIndex = id & 0xffff;
  const count = load<u16>(SPRITE_TABLE_ADDR) as i32;
  if (count <= 0 || infoIndex >= count) return false;

  const infoOffset = load<u32>(SPRITE_TABLE_ADDR + 8);
  const info = getSpriteInfoPtr(infoOffset, infoIndex);
  const cols = info.cols as i32;
  const rows = info.rows as i32;
  if (cols <= 0 || rows <= 0) return false;
  if (packedFrameIndex >= cols * rows) return false;

  const width = info.width as i32;
  const height = info.height as i32;
  if (width == 0 || height == 0) return false;

  const frameOffset = info.dataOffset + info.dataSize * (packedFrameIndex as u32);

  // Store the sprite info for later use
  readFrameOffset = frameOffset;
  readWidth = width;
  readHeight = height;
  return true;
}

/**
 * Get the width of the last sprite read by readAndCheckSpriteInfo.
 * @returns Width in pixels
 */
// @ts-expect-error AssemblyScript decorator
@inline
export function getLastSpriteWidth(): i32 {
    return readWidth;
  }
  
/**
 * Get the height of the last sprite read by readAndCheckSpriteInfo.
 * @returns Height in pixels
 */
// @ts-expect-error AssemblyScript decorator
@inline
export function getLastSpriteHeight(): i32 {
  return readHeight;
}

/**
 * Get the memory address of the sprite pixel data for a packed sprite ID.
 * Returns 0 if the ID is invalid.
 * @param id Packed sprite ID from s()
 * @returns Sprite pixel data address in memory
 */
// @ts-expect-error AssemblyScript decorator
@inline
export function getLastSpriteAddress(): usize {
  return readFrameOffset as usize;
}

/**
 * Draw a sprite at the specified position
 * Supports alpha blending for semi-transparent sprites
 * @param id Packed sprite ID from s()
 * @param x X coordinate (top-left)
 * @param y Y coordinate (top-left)
 * @param flipX Whether to flip the sprite horizontally (default: false)
 * @param flipY Whether to flip the sprite vertically (default: false)
 * @example
 * ```typescript
 * drawSprite(s("mySprite"), 100, 100); // Draw sprite at (100, 100)
 * drawSprite(s("mySprite"), 100, 100, true); // Draw flipped horizontally
 * ```
 */
export function drawSprite(id: i32, x: i32, y: i32, flipX: bool = false, flipY: bool = false): void {
  if (!readSpriteInfo(id)) return;
  const frameOffset = readFrameOffset;
  const width = readWidth;
  const height = readHeight;

  // Calculate visible region (clip to screen bounds)
  const startX = max(0, -x);
  const startY = max(0, -y);
  const endX = min(width, WIDTH - x);
  const endY = min(height, HEIGHT - y);

  // Early exit if sprite is completely off-screen
  if (startX >= endX || startY >= endY) return;

  // Draw sprite pixels (only visible region)
  const spriteDataAddr = frameOffset as usize;

  let rowOffset = startY * width;
  let fbRowBase = ((y + startY) * WIDTH) as usize;

  for (let dy: i32 = startY; dy < endY; dy++) {
    // Calculate source row offset (use incremental for non-flipped, multiply for flipped)
    const srcRowOffset = flipY ? ((height - 1 - dy) * width) : rowOffset;
    
    for (let dx: i32 = startX; dx < endX; dx++) {
      // Calculate source column (no cost for non-flipped)
      const srcX = flipX ? (width - 1 - dx) : dx;
      const pixelAddr = spriteDataAddr + ((srcRowOffset + srcX) << 2) as usize;
      const srcPixel = load<u32>(pixelAddr);
      
      const srcA = (srcPixel >> 24) & 0xff;

      // Skip fully transparent pixels
      if (srcA == 0) continue;

      const screenX = x + dx;
      const fbAddr = (fbRowBase + screenX as usize) << 2;

      // If fully opaque, write directly
      if (srcA == 255) {
        store<u32>(fbAddr, srcPixel | 0xff000000);
      } else {
        // Alpha blending required
        const dstPixel = load<u32>(fbAddr);

        // Extract source RGB from loaded pixel
        const srcR = srcPixel & 0xff;
        const srcG = (srcPixel >> 8) & 0xff;
        const srcB = (srcPixel >> 16) & 0xff;

        // Extract destination RGB from ABGR format
        const dstR = dstPixel & 0xff;
        const dstG = (dstPixel >> 8) & 0xff;
        const dstB = (dstPixel >> 16) & 0xff;

        // Blend using bit shift approximation: (x * a + 128) >> 8 ≈ x * a / 255
        const invAlpha = 255 - srcA;

        const blendR = ((srcR * srcA + dstR * invAlpha + 128) >> 8) as u8;
        const blendG = ((srcG * srcA + dstG * invAlpha + 128) >> 8) as u8;
        const blendB = ((srcB * srcA + dstB * invAlpha + 128) >> 8) as u8;

        // Store blended pixel in ABGR format
        const blended = (blendR as u32) | ((blendG as u32) << 8) | ((blendB as u32) << 16);
        store<u32>(fbAddr, blended | 0xff000000);
      }
    }
    
    rowOffset += width;
    fbRowBase += WIDTH as usize;
  }
}

/**
 * Draw a sprite scaled by integer factors
 * @param id Sprite ID
 * @param x X coordinate (top-left)
 * @param y Y coordinate (top-left)
 * @param scaleX Horizontal scale (>= 1)
 * @param scaleY Vertical scale (>= 1)
 * @param flipX Whether to flip the sprite horizontally (default: false)
 * @param flipY Whether to flip the sprite vertically (default: false)
 */
export function drawSpriteScaled(
  id: i32,
  x: i32,
  y: i32,
  scaleX: i32,
  scaleY: i32,
  flipX: bool = false,
  flipY: bool = false,
): void {
  if (scaleX <= 0 || scaleY <= 0) return;
  if (!readSpriteInfo(id)) return;
  const frameOffset = readFrameOffset;
  const width = readWidth;
  const height = readHeight;

  const scaledWidth = width * scaleX;
  const scaledHeight = height * scaleY;

  const startX = max(0, -x);
  const startY = max(0, -y);
  const endX = min(scaledWidth, WIDTH - x);
  const endY = min(scaledHeight, HEIGHT - y);

  if (startX >= endX || startY >= endY) return;

  const spriteDataAddr = frameOffset as usize;
  let fbRowBase = ((y + startY) * WIDTH) as usize;

  for (let dy: i32 = startY; dy < endY; dy++) {
    const srcY = dy / scaleY;
    const srcRow = flipY ? (height - 1 - srcY) : srcY;
    const rowOffset = srcRow * width;

    for (let dx: i32 = startX; dx < endX; dx++) {
      const srcX = dx / scaleX;
      const srcCol = flipX ? (width - 1 - srcX) : srcX;
      const pixelAddr = spriteDataAddr + ((rowOffset + srcCol) << 2) as usize;
      const srcPixel = load<u32>(pixelAddr);
      const srcA = (srcPixel >> 24) & 0xff;
      if (srcA == 0) continue;

      const screenX = x + dx;
      const fbAddr = (fbRowBase + screenX as usize) << 2;

      if (srcA == 255) {
        store<u32>(fbAddr, srcPixel | 0xff000000);
      } else {
        const dstPixel = load<u32>(fbAddr);
        const srcR = srcPixel & 0xff;
        const srcG = (srcPixel >> 8) & 0xff;
        const srcB = (srcPixel >> 16) & 0xff;
        const dstR = dstPixel & 0xff;
        const dstG = (dstPixel >> 8) & 0xff;
        const dstB = (dstPixel >> 16) & 0xff;
        const invAlpha = 255 - srcA;
        const blendR = ((srcR * srcA + dstR * invAlpha + 128) >> 8) as u8;
        const blendG = ((srcG * srcA + dstG * invAlpha + 128) >> 8) as u8;
        const blendB = ((srcB * srcA + dstB * invAlpha + 128) >> 8) as u8;
        const blended = (blendR as u32) | ((blendG as u32) << 8) | ((blendB as u32) << 16);
        store<u32>(fbAddr, blended | 0xff000000);
      }
    }

    fbRowBase += WIDTH as usize;
  }
}

/**
 * Draw a sprite frame from a horizontal sprite strip
 * @param id Sprite ID
 * @param x X coordinate (top-left)
 * @param y Y coordinate (top-left)
 * @param frame Frame index (0-based)
 * @param frameWidth Frame width in pixels
 * @param frameHeight Frame height in pixels
 * @param flipX Whether to flip the frame horizontally (default: false)
 * @param flipY Whether to flip the frame vertically (default: false)
 */
export function drawSpriteFrame(
  id: i32,
  x: i32,
  y: i32,
  frame: i32,
  frameWidth: i32,
  frameHeight: i32,
  flipX: bool = false,
  flipY: bool = false,
): void {
  if (frameWidth <= 0 || frameHeight <= 0) return;
  if (!readSpriteInfo(id)) return;
  const frameOffset = readFrameOffset;
  const spriteWidth = readWidth;
  const spriteHeight = readHeight;

  const framesPerRow = spriteWidth / frameWidth;
  if (framesPerRow <= 0) return;

  const frameIndex = frame % framesPerRow;
  const srcX0 = frameIndex * frameWidth;
  const srcY0 = 0;

  const startX = max(0, -x);
  const startY = max(0, -y);
  const endX = min(frameWidth, WIDTH - x);
  const endY = min(frameHeight, HEIGHT - y);

  if (startX >= endX || startY >= endY) return;

  const spriteDataAddr = frameOffset as usize;
  let fbRowBase = ((y + startY) * WIDTH) as usize;

  for (let dy: i32 = startY; dy < endY; dy++) {
    const srcY = flipY ? (frameHeight - 1 - dy) : dy;
    const srcRow = (srcY0 + srcY) * spriteWidth;

    for (let dx: i32 = startX; dx < endX; dx++) {
      const srcX = flipX ? (frameWidth - 1 - dx) : dx;
      const srcCol = srcX0 + srcX;
      const pixelAddr = spriteDataAddr + ((srcRow + srcCol) << 2) as usize;
      const srcPixel = load<u32>(pixelAddr);
      const srcA = (srcPixel >> 24) & 0xff;
      if (srcA == 0) continue;

      const screenX = x + dx;
      const fbAddr = (fbRowBase + screenX as usize) << 2;

      if (srcA == 255) {
        store<u32>(fbAddr, srcPixel | 0xff000000);
      } else {
        const dstPixel = load<u32>(fbAddr);
        const srcR = srcPixel & 0xff;
        const srcG = (srcPixel >> 8) & 0xff;
        const srcB = (srcPixel >> 16) & 0xff;
        const dstR = dstPixel & 0xff;
        const dstG = (dstPixel >> 8) & 0xff;
        const dstB = (dstPixel >> 16) & 0xff;
        const invAlpha = 255 - srcA;
        const blendR = ((srcR * srcA + dstR * invAlpha + 128) >> 8) as u8;
        const blendG = ((srcG * srcA + dstG * invAlpha + 128) >> 8) as u8;
        const blendB = ((srcB * srcA + dstB * invAlpha + 128) >> 8) as u8;
        const blended = (blendR as u32) | ((blendG as u32) << 8) | ((blendB as u32) << 16);
        store<u32>(fbAddr, blended | 0xff000000);
      }
    }

    fbRowBase += WIDTH as usize;
  }
}
