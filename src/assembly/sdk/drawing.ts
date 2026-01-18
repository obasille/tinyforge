// TinyForge SDK - Drawing Primitives
// Low-level and high-level drawing functions for rendering graphics

import { WIDTH, HEIGHT, SPRITE_METADATA_ADDR, SPRITE_DATA_ADDR } from "./memory";

/**
 * Efficiently clears entire framebuffer using native JS
 * Much faster than a WASM loop for clearing the full screen
 * @param color ABGR color to fill the framebuffer with
 */
// @ts-expect-error AssemblyScript decorator
@external("env", "clearFramebuffer")
export declare function clearFramebuffer(color: u32): void;

/**
 * Set a single pixel in the framebuffer
 * Coordinates are clipped to screen bounds
 * @param x X coordinate (0-319)
 * @param y Y coordinate (0-239)
 * @param color ABGR color value
 */
// @ts-expect-error AssemblyScript decorator
@inline
export function pset(x: i32, y: i32, color: u32): void {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const i = (y * WIDTH + x) << 2;
  store<u32>(i, color | 0xff000000);
}

/**
 * Draw a filled rectangle
 * @param x Top-left X coordinate
 * @param y Top-left Y coordinate
 * @param w Width in pixels
 * @param h Height in pixels
 * @param color ABGR color value
 */
export function fillRect(x: i32, y: i32, w: i32, h: i32, color: u32): void {
  for (let dy: i32 = 0; dy < h; dy++) {
    for (let dx: i32 = 0; dx < w; dx++) {
      pset(x + dx, y + dy, color);
    }
  }
}

/**
 * Draw a rectangle outline
 * @param x Top-left X coordinate
 * @param y Top-left Y coordinate
 * @param w Width in pixels
 * @param h Height in pixels
 * @param color ABGR color value
 */
export function drawRect(x: i32, y: i32, w: i32, h: i32, color: u32): void {
  for (let i: i32 = 0; i < w; i++) {
    pset(x + i, y, color);
    pset(x + i, y + h - 1, color);
  }
  for (let i: i32 = 0; i < h; i++) {
    pset(x, y + i, color);
    pset(x + w - 1, y + i, color);
  }
}

/**
 * Draw a line using Bresenham's algorithm
 * @param x0 Starting X coordinate
 * @param y0 Starting Y coordinate
 * @param x1 Ending X coordinate
 * @param y1 Ending Y coordinate
 * @param color ABGR color value
 */
export function drawLine(x0: i32, y0: i32, x1: i32, y1: i32, color: u32): void {
  let dx = x1 - x0;
  let dy = y1 - y0;
  const sx: i32 = dx >= 0 ? 1 : -1;
  const sy: i32 = dy >= 0 ? 1 : -1;
  dx = dx >= 0 ? dx : -dx;
  dy = dy >= 0 ? dy : -dy;

  let err = (dx > dy ? dx : -dy) >> 1;
  while (true) {
    pset(x0, y0, color);
    if (x0 == x1 && y0 == y1) break;
    const e2 = err;
    if (e2 > -dx) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dy) {
      err += dx;
      y0 += sy;
    }
  }
}

/**
 * Draw a filled circle using midpoint algorithm
 * @param cx Center X coordinate
 * @param cy Center Y coordinate
 * @param r Radius in pixels
 * @param color ABGR color value
 */
export function fillCircle(cx: i32, cy: i32, r: i32, color: u32): void {
  const r2 = r * r;
  for (let dy: i32 = -r; dy <= r; dy++) {
    for (let dx: i32 = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r2) {
        pset(cx + dx, cy + dy, color);
      }
    }
  }
}

/**
 * Draw a circle outline using midpoint algorithm
 * @param cx Center X coordinate
 * @param cy Center Y coordinate
 * @param r Radius in pixels
 * @param color ABGR color value
 */
export function drawCircle(cx: i32, cy: i32, r: i32, color: u32): void {
  let x: i32 = r;
  let y: i32 = 0;
  let err: i32 = 1 - r;

  while (x >= y) {
    pset(cx + x, cy + y, color);
    pset(cx + y, cy + x, color);
    pset(cx - y, cy + x, color);
    pset(cx - x, cy + y, color);
    pset(cx - x, cy - y, color);
    pset(cx - y, cy - x, color);
    pset(cx + y, cy - x, color);
    pset(cx + x, cy - y, color);

    y++;
    if (err < 0) {
      err += (y << 1) + 1;
    } else {
      x--;
      err += ((y - x) << 1) + 1;
    }
  }
}

/**
 * Draw a sprite at the specified position
 * Supports alpha blending for semi-transparent sprites
 * @param id Sprite ID
 * @param x X coordinate (top-left)
 * @param y Y coordinate (top-left)
 * @param flipX Whether to flip the sprite horizontally (default: false)
 * @param flipY Whether to flip the sprite vertically (default: false)
 * @example
 * ```typescript
 * drawSprite(0, 100, 100); // Draw sprite 0 at (100, 100)
 * drawSprite(0, 100, 100, true); // Draw flipped horizontally
 * ```
 */
export function drawSprite(id: u32, x: i32, y: i32, flipX: bool = false, flipY: bool = false): void {
  // Read sprite metadata
  const metadataAddr = SPRITE_METADATA_ADDR + (id as usize) * 8;
  const width = load<u16>(metadataAddr) as i32;
  const height = load<u16>(metadataAddr + 2) as i32;
  const dataOffset = load<u32>(metadataAddr + 4);

  // Early exit if sprite has no size (not loaded)
  if (width == 0 || height == 0) return;

  // Calculate visible region (clip to screen bounds)
  const startX = max(0, -x);
  const startY = max(0, -y);
  const endX = min(width, WIDTH - x);
  const endY = min(height, HEIGHT - y);

  // Early exit if sprite is completely off-screen
  if (startX >= endX || startY >= endY) return;

  // Draw sprite pixels (only visible region)
  const spriteDataAddr = SPRITE_DATA_ADDR + dataOffset;

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
  id: u32,
  x: i32,
  y: i32,
  scaleX: i32,
  scaleY: i32,
  flipX: bool = false,
  flipY: bool = false,
): void {
  if (scaleX <= 0 || scaleY <= 0) return;

  const metadataAddr = SPRITE_METADATA_ADDR + (id as usize) * 8;
  const width = load<u16>(metadataAddr) as i32;
  const height = load<u16>(metadataAddr + 2) as i32;
  const dataOffset = load<u32>(metadataAddr + 4);

  if (width == 0 || height == 0) return;

  const scaledWidth = width * scaleX;
  const scaledHeight = height * scaleY;

  const startX = max(0, -x);
  const startY = max(0, -y);
  const endX = min(scaledWidth, WIDTH - x);
  const endY = min(scaledHeight, HEIGHT - y);

  if (startX >= endX || startY >= endY) return;

  const spriteDataAddr = SPRITE_DATA_ADDR + dataOffset;
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
  id: u32,
  x: i32,
  y: i32,
  frame: i32,
  frameWidth: i32,
  frameHeight: i32,
  flipX: bool = false,
  flipY: bool = false,
): void {
  if (frameWidth <= 0 || frameHeight <= 0) return;

  const metadataAddr = SPRITE_METADATA_ADDR + (id as usize) * 8;
  const spriteWidth = load<u16>(metadataAddr) as i32;
  const spriteHeight = load<u16>(metadataAddr + 2) as i32;
  const dataOffset = load<u32>(metadataAddr + 4);

  if (spriteWidth == 0 || spriteHeight == 0) return;

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

  const spriteDataAddr = SPRITE_DATA_ADDR + dataOffset;
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
