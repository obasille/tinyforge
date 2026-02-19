// TinyForge SDK - Drawing Primitives
// Low-level and high-level drawing functions for rendering graphics

import {
  FB_START,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
} from "./memory";

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
  if (x < 0 || x >= SCREEN_WIDTH || y < 0 || y >= SCREEN_HEIGHT) return;
  const i = (y * SCREEN_WIDTH + x) << 2;
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
  if (w <= 0 || h <= 0) return;

  let x0 = x;
  let y0 = y;
  let x1 = x + w;
  let y1 = y + h;

  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x1 > SCREEN_WIDTH) x1 = SCREEN_WIDTH;
  if (y1 > SCREEN_HEIGHT) y1 = SCREEN_HEIGHT;

  if (x0 >= x1 || y0 >= y1) return;

  const colorValue = color | 0xff000000;
  const rowWidth = SCREEN_WIDTH;
  const xCount = x1 - x0;

  for (let yy: i32 = y0; yy < y1; yy++) {
    let addr = ((yy * rowWidth + x0) << 2) as usize;
    for (let xx: i32 = 0; xx < xCount; xx++) {
      store<u32>(addr, colorValue);
      addr += 4;
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
  if (w <= 0 || h <= 0) return;

  let x0 = x;
  let y0 = y;
  let x1 = x + w;
  let y1 = y + h;

  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x1 > SCREEN_WIDTH) x1 = SCREEN_WIDTH;
  if (y1 > SCREEN_HEIGHT) y1 = SCREEN_HEIGHT;

  if (x0 >= x1 || y0 >= y1) return;

  const colorValue = color | 0xff000000;
  const rowWidth = SCREEN_WIDTH;
  const top = y0;
  const bottom = y1 - 1;
  const left = x0;
  const right = x1 - 1;

  // Top edge
  let addrTop = ((top * rowWidth + left) << 2) as usize;
  for (let xx: i32 = left; xx <= right; xx++) {
    store<u32>(addrTop, colorValue);
    addrTop += 4;
  }

  // Bottom edge (if different from top)
  if (bottom != top) {
    let addrBottom = ((bottom * rowWidth + left) << 2) as usize;
    for (let xx: i32 = left; xx <= right; xx++) {
      store<u32>(addrBottom, colorValue);
      addrBottom += 4;
    }
  }

  // Left and right edges (skip corners already drawn)
  if (right != left && bottom - top > 1) {
    for (let yy: i32 = top + 1; yy < bottom; yy++) {
      let addrLeft = ((yy * rowWidth + left) << 2) as usize;
      let addrRight = ((yy * rowWidth + right) << 2) as usize;
      store<u32>(addrLeft, colorValue);
      store<u32>(addrRight, colorValue);
    }
  } else if (right == left && bottom - top > 1) {
    for (let yy: i32 = top + 1; yy < bottom; yy++) {
      let addrLeft = ((yy * rowWidth + left) << 2) as usize;
      store<u32>(addrLeft, colorValue);
    }
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
export function drawLine(
  x0: i32, y0: i32,
  x1: i32, y1: i32,
  color: u32
): void {
  const LEFT = 1;
  const RIGHT = 2;
  const TOP = 4;
  const BOTTOM = 8;

  const maxX = SCREEN_WIDTH - 1;
  const maxY = SCREEN_HEIGHT - 1;

  function outCode(x: i32, y: i32): i32 {
    let code = 0;
    if (x < 0) code |= LEFT;
    else if (x > maxX) code |= RIGHT;
    if (y < 0) code |= TOP;
    else if (y > maxY) code |= BOTTOM;
    return code;
  }

  let code0 = outCode(x0, y0);
  let code1 = outCode(x1, y1);

  while (true) {

    if ((code0 | code1) == 0) {
      break; // fully inside
    }
    if ((code0 & code1) != 0) {
      return; // fully outside
    }

    const out = code0 != 0 ? code0 : code1;
    let x = 0;
    let y = 0;

    if (out & TOP) {
      if (y1 == y0) return;
      x = x0 + ((x1 - x0) * (0 - y0)) / (y1 - y0);
      y = 0;
    } else if (out & BOTTOM) {
      if (y1 == y0) return;
      x = x0 + ((x1 - x0) * (maxY - y0)) / (y1 - y0);
      y = maxY;
    } else if (out & RIGHT) {
      if (x1 == x0) return;
      y = y0 + ((y1 - y0) * (maxX - x0)) / (x1 - x0);
      x = maxX;
    } else {
      if (x1 == x0) return;
      y = y0 + ((y1 - y0) * (0 - x0)) / (x1 - x0);
      x = 0;
    }
    if (out == code0) {
      x0 = x;
      y0 = y;
      code0 = outCode(x0, y0);
    } else {
      x1 = x;
      y1 = y;
      code1 = outCode(x1, y1);
    }
  }

  const colorValue = color | 0xff000000;

  let dx = x1 - x0;
  let dy = y1 - y0;

  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;

  dx = dx >= 0 ? dx : -dx;
  dy = dy >= 0 ? dy : -dy;

  let err = (dx > dy ? dx : -dy) / 2;
  let index = FB_START + y0 * SCREEN_WIDTH + x0;
  const indexIncX = sx;
  const indexIncY = sy * SCREEN_WIDTH;
  while (true) {
    store<u32>((index << 2) as usize, colorValue);

    if (x0 == x1 && y0 == y1) {
      break;
    }

    const e2 = err;
    if (e2 > -dx) {
      err -= dy;
      x0 += sx;
      index += indexIncX;
    }
    if (e2 < dy) {
      err += dx;
      y0 += sy;
      index += indexIncY;
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
  if (r < 0) return;

  const colorValue = color | 0xff000000;

  if (r == 0) {
    if (cx < 0 || cx >= SCREEN_WIDTH || cy < 0 || cy >= SCREEN_HEIGHT) return;
    const addr = ((cy * SCREEN_WIDTH + cx) << 2) as usize;
    store<u32>(addr, colorValue);
    return;
  }

  const rowWidth = SCREEN_WIDTH;

  function drawSpan(y: i32, xStart: i32, xEnd: i32, colorValue: u32): void {
    if (y < 0 || y >= SCREEN_HEIGHT) return;
    let xs = xStart;
    let xe = xEnd;
    if (xs < 0) xs = 0;
    if (xe >= SCREEN_WIDTH) xe = SCREEN_WIDTH - 1;
    if (xs > xe) return;

    let addr = ((y * rowWidth + xs) << 2) as usize;
    const count = xe - xs + 1;
    for (let i: i32 = 0; i < count; i++) {
      store<u32>(addr, colorValue);
      addr += 4;
    }
  }

  let x: i32 = r;
  let y: i32 = 0;
  let err: i32 = 1 - r;

  while (x >= y) {
    drawSpan(cy + y, cx - x, cx + x, colorValue);
    drawSpan(cy - y, cx - x, cx + x, colorValue);

    if (x != y) {
      drawSpan(cy + x, cx - y, cx + y, colorValue);
      drawSpan(cy - x, cx - y, cx + y, colorValue);
    }

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
 * Draw a circle outline using midpoint algorithm
 * @param cx Center X coordinate
 * @param cy Center Y coordinate
 * @param r Radius in pixels
 * @param color ABGR color value
 */
export function drawCircle(cx: i32, cy: i32, r: i32, color: u32): void {
  if (r < 0) return;

  const colorValue = color | 0xff000000;
  const rowWidth = SCREEN_WIDTH;

  let x: i32 = r;
  let y: i32 = 0;
  let err: i32 = 1 - r;

  while (x >= y) {
    const yTop = cy + y;
    const yBottom = cy - y;
    const yRight = cy + x;
    const yLeft = cy - x;

    if (yTop >= 0 && yTop < SCREEN_HEIGHT) {
      const rowBase = (yTop * rowWidth) as usize;
      const x1 = cx + x;
      const x2 = cx - x;
      if (x1 >= 0 && x1 < SCREEN_WIDTH) store<u32>(((rowBase + x1) << 2) as usize, colorValue);
      if (x2 >= 0 && x2 < SCREEN_WIDTH) store<u32>(((rowBase + x2) << 2) as usize, colorValue);
    }

    if (yBottom != yTop && yBottom >= 0 && yBottom < SCREEN_HEIGHT) {
      const rowBase = (yBottom * rowWidth) as usize;
      const x1 = cx + x;
      const x2 = cx - x;
      if (x1 >= 0 && x1 < SCREEN_WIDTH) store<u32>(((rowBase + x1) << 2) as usize, colorValue);
      if (x2 >= 0 && x2 < SCREEN_WIDTH) store<u32>(((rowBase + x2) << 2) as usize, colorValue);
    }

    if (x != y) {
      if (yRight >= 0 && yRight < SCREEN_HEIGHT) {
        const rowBase = (yRight * rowWidth) as usize;
        const x1 = cx + y;
        const x2 = cx - y;
        if (x1 >= 0 && x1 < SCREEN_WIDTH) store<u32>(((rowBase + x1) << 2) as usize, colorValue);
        if (x2 >= 0 && x2 < SCREEN_WIDTH) store<u32>(((rowBase + x2) << 2) as usize, colorValue);
      }

      if (yLeft >= 0 && yLeft < SCREEN_HEIGHT) {
        const rowBase = (yLeft * rowWidth) as usize;
        const x1 = cx + y;
        const x2 = cx - y;
        if (x1 >= 0 && x1 < SCREEN_WIDTH) store<u32>(((rowBase + x1) << 2) as usize, colorValue);
        if (x2 >= 0 && x2 < SCREEN_WIDTH) store<u32>(((rowBase + x2) << 2) as usize, colorValue);
      }
    }

    y++;
    if (err < 0) {
      err += (y << 1) + 1;
    } else {
      x--;
      err += ((y - x) << 1) + 1;
    }
  }
}
