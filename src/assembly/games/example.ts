// TinyForge Game Example

// Import console SDK
import {
  Button,
  FixedArray,
  FixedArrayWithCount,
  HEIGHT,
  RAM_START,
  WIDTH,
  buttonDown,
  c,
  clearFramebuffer,
  drawCircle,
  drawLine,
  drawNumber,
  drawRect,
  drawSprite,
  drawSpriteScaled,
  log,
  pset,
  s,
} from "../sdk";

// === RAM Variable System ===
// RAM allocation for persistent game state

@unmanaged
class Vars {
  playerX: i32; // 0
  playerY: i32; // 4
  animFrame: i32; // 8
  // Grid array: 100 bytes (calculated: FixedArray.sizeInMemory<u8>(100) = 100)
  // Score array: 40 bytes (calculated: FixedArray.sizeInMemory<i32>(10) = 40)
  // Items array: 44 bytes (calculated: FixedArrayWithCount.sizeInMemory<u16>(20) = 4 + 40)
  // Tags array: 12 bytes (calculated: FixedArrayWithCount.sizeInMemory<u8, u8>(10) = 2 + 10)
}

const vars = changetype<Vars>(RAM_START);

// Zero-allocation arrays using @unmanaged pattern
const grid = FixedArray.fromAddress<u8>(RAM_START + 12); // 100 u8 values
const scores = changetype<FixedArray<i32>>(RAM_START + 112); // 10 i32 values

// Zero-allocation array with dynamic length tracking (default u16 counters: 4 bytes metadata)
const items = FixedArrayWithCount.fromAddress<u16>(RAM_START + 152); // max 20 u16 values

// Zero-allocation array with u8 counters (only 2 bytes metadata for small arrays!)
const tags = changetype<FixedArrayWithCount<u8, u8>>(RAM_START + 196); // max 10 u8 values

// === lifecycle ===

export function init(): void {
  clearFramebuffer(c(0xff000000)); // black

  // Initialize player position in RAM
  vars.playerX = 160;
  vars.playerY = 120;

  // Initialize arrays - zero allocation!
  grid.fill(0, 100); // Clear 100 u8 values
  scores.set(0, 1000); // High score (bracket notation supported!)
  scores.set(1, 500);
  grid.set(10, 42); // Set grid cell (bracket notation supported!)

  // Initialize dynamic array with capacity
  items.capacity = 20;
  items.clear();
  items.push(100);
  items.push(200);
  items.push(300);

  // Initialize small array with u8 counters (saves 6 bytes vs i32!)
  tags.capacity = 10;
  tags.clear();
  tags.push(1);
  tags.push(2);

  log("Starting!");
}

export function update(): void {
  // Movement logic - use buttonDown() for continuous movement
  if (buttonDown(Button.LEFT)) vars.playerX--;
  if (buttonDown(Button.RIGHT)) vars.playerX++;
  if (buttonDown(Button.UP)) vars.playerY--;
  if (buttonDown(Button.DOWN)) vars.playerY++;

  // Example: detect button press (not hold) - use buttonPressed() for one-time actions
  // if (buttonPressed(Button.A)) { /* do something once */ }

  vars.animFrame++;

  // Example: update array values - zero allocation!
  if (vars.animFrame % 60 == 0) {
    const current = grid.get(10);
    grid.set(10, ((current + 1) % 256) as u8); // Increment grid cell every 60 frames

    // Dynamic array example: add item every 60 frames
    if ((items.length as i32) < (items.capacity as i32)) {
      items.push((vars.animFrame / 60) as u16);
    }

    // Small array with u8 counters
    if ((tags.length as u8) < (tags.capacity as u8)) {
      tags.push(((vars.animFrame / 60) % 256) as u8);
    }
  }
}

export function draw(): void {
  // Load player position from RAM
  const px = vars.playerX;
  const py = vars.playerY;

  // test pattern
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const r = x & 255;
      const g = y & 255;
      const b = 128;
      pset(x, y, (r << 16) | (g << 8) | b);
    }
  }
  // draw player
  pset(px, py, c(0xffffff));

  drawSpriteScaled(s("level1"), 0, 0, 16, 16);

  const speed = 0.3;
  const i = <u32>Math.floor((vars.animFrame * speed) / 2) % 9;
  const o = <u32>Math.floor(vars.animFrame * speed) % 350;
  drawSprite(s("dino", i as i32, 0), -30 + o, 10, true, true); // draw sprite at (10,10)
  drawNumber(1, 30, i, c(0x0000ff)); // draw animation frame count

  // Display array values - zero allocation access!
  const gridVal = grid.get(10);
  const highScore = scores.get(0);
  drawNumber(1, 150, gridVal, c(0x00ff00)); // Show grid value
  drawNumber(1, 180, highScore, c(0xffff00)); // Show high score
  drawNumber(1, 210, items.length as i32, c(0xff00ff)); // Show dynamic array length (i32)
  drawNumber(1, 230, tags.length as i32, c(0x00ffff)); // Show small array length (u8)

  drawCircle(10, 100, 30, c(0x0000ff));
  drawRect(10, 100, 10, 20, c(0x0000ff));
  drawLine(100, 100, 200, 200, c(0x0000ff));
  // drawString(100, 100, "Hello, world!", c(0x0000ff));
  // drawNumber(100, 100, 10, c(0x0000ff));
  // drawSprite(s("dino"), 100, 100);
  // drawSpriteFrame(1, 100, 100, 0, 10, 10);
  // drawSpriteScaled(1, 100, 100, 2, 2);
  // drawSpriteFrameScaled(1, 100, 100, 0, 10, 10, 2, 2);

  drawSprite(s("crocodile"), 200, 200);
  drawSprite(s("crocodile_bloody"), 150, 200);
}
