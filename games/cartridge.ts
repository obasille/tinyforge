// TinyForge Game Example

// Import console SDK
import { WIDTH, HEIGHT, clearFramebuffer, pset, Button, buttonDown, buttonPressed, log, warn, getI32, setI32 } from '../sdk';


// === RAM Variable System ===
// Generic RAM allocation and access for game state
// Each enum value represents an offset from RAM_START

enum Var {
  PX = 0,    // Player X (i32, 4 bytes)
  PY = 4,    // Player Y (i32, 4 bytes)
  // Add more variables here:
  // SCORE = 8,
  // HEALTH = 12,
  // etc.
}

@inline
function getPX(): i32 {
  return getI32(Var.PX);
}
@inline
function setPX(value: i32): void {
  setI32(Var.PX, value);
}
@inline
function getPY(): i32 {
  return getI32(Var.PY);
}
@inline
function setPY(value: i32): void {
  setI32(Var.PY, value);
}

// === lifecycle ===
export function init(): void {
  warn("Game starting...");

  clearFramebuffer(0xFF000000); // black
  
  // Initialize player position in RAM
  setPX(160);
  setPY(120);

  log("Game started!");
}

export function update(): void {
  // Load player position from RAM
  let px = getPX();
  let py = getPY();
  
  // Movement logic - use buttonDown() for continuous movement
  if (buttonDown(Button.LEFT))  px--;
  if (buttonDown(Button.RIGHT)) px++;
  if (buttonDown(Button.UP))    py--;
  if (buttonDown(Button.DOWN))  py++;
  
  // Store updated position back to RAM
  setPX(px);
  setPY(py);
  
  // Example: detect button press (not hold) - use buttonPressed() for one-time actions
  // if (buttonPressed(Button.A)) { /* do something once */ }
}

export function draw(): void {
  // Load player position from RAM
  const px = getPX();
  const py = getPY();
  
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
  pset(px, py, 0xffffff);
}
