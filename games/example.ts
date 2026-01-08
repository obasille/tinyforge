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
  log,
  pset,
} from "../sdk";

// === RAM Variable System ===
// RAM allocation for persistent game state

@unmanaged
class GameVars {
  playerX: i32 = 0;      // 0
  playerY: i32 = 0;      // 4
}

const gameVars = changetype<GameVars>(RAM_START);

// === lifecycle ===
  
export function init(): void {
  clearFramebuffer(c(0xff000000)); // black

  // Initialize player position in RAM
  gameVars.playerX = 160;
  gameVars.playerY = 120;

  log("Starting!");
}

export function update(): void {
  // Movement logic - use buttonDown() for continuous movement
  if (buttonDown(Button.LEFT)) gameVars.playerX--;
  if (buttonDown(Button.RIGHT)) gameVars.playerX++;
  if (buttonDown(Button.UP)) gameVars.playerY--;
  if (buttonDown(Button.DOWN)) gameVars.playerY++;

  // Example: detect button press (not hold) - use buttonPressed() for one-time actions
  // if (buttonPressed(Button.A)) { /* do something once */ }
}

export function draw(): void {
  // Load player position from RAM
  const px = gameVars.playerX;
  const py = gameVars.playerY;

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
}
