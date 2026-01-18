// TinyForge Game Example

// Import console SDK
import {
  Button,
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
  log,
  pset,
} from "../sdk";

// === RAM Variable System ===
// RAM allocation for persistent game state

@unmanaged
class Vars {
  playerX: i32;     // 0
  playerY: i32;     // 4
  animFrame: i32;   // 8
}

const vars = changetype<Vars>(RAM_START);

// === lifecycle ===
  
export function init(): void {
  clearFramebuffer(c(0xff000000)); // black

  // Initialize player position in RAM
  vars.playerX = 160;
  vars.playerY = 120;

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

  const speed = 0.3;
  const i = <u32>Math.floor(vars.animFrame * speed / 2) % 9;
  const o = <u32>Math.floor(vars.animFrame * speed) % 350;
  drawSprite(1 + i, -30 + o, 10, true, true); // draw sprite at (10,10)
  drawNumber(1, 30, i, c(0x0000ff)); // draw animation frame count

  drawCircle(10, 100, 30, c(0x0000ff));
  drawRect(10, 100, 10, 20, c(0x0000ff));
  drawLine(100, 100, 200, 200, c(0x0000ff));
  // drawString(100, 100, "Hello, world!", c(0x0000ff));
  // drawNumber(100, 100, 10, c(0x0000ff));
  // drawSprite(1, 100, 100);
  // drawSpriteFrame(1, 100, 100, 0, 10, 10);
  // drawSpriteScaled(1, 100, 100, 2, 2);
  // drawSpriteFrameScaled(1, 100, 100, 0, 10, 10, 2, 2);
}
