// TinyForge Game Example

// Import console SDK
import {
  Button,
  UncheckedArrayView,
  ArrayView,
  SCREEN_HEIGHT,
  RAM_START,
  SCREEN_WIDTH,
  buttonDown,
  buttonPressed,
  c,
  fillRect,
  INPUT_BUTTONS_ADDR,
  MouseButton,
  mouseDown,
  mousePressed,
  mouseX,
  mouseY,
  p1AxisX,
  p1AxisY,
  p2AxisX,
  p2AxisY,
  print,
  printNumber,
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
  UncheckedArrayObjView,
  Vec2i,
} from "../../sdk";

// Game metadata, read by the TinyForge tooling (string literals only).
const TITLE = "Example";
const DESCRIPTION = "TinyForge game example";
const AUTHOR = "Olivier Basille";

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
// Each array starts right after the previous one, the first right after Vars.
// offsetof<Vars>() is the struct size; sizeof<Vars>() would be the size of a
// pointer (4).
const GRID_ADDR = RAM_START + offsetof<Vars>();
const SCORES_ADDR = GRID_ADDR + 100;
const ITEMS_ADDR = SCORES_ADDR + 40;
const TAGS_ADDR = ITEMS_ADDR + 44;
const VECS_ADDR = TAGS_ADDR + 12;
const grid = UncheckedArrayView.fromAddress<u8>(GRID_ADDR); // 100 u8 values
const scores = changetype<UncheckedArrayView<i32>>(SCORES_ADDR); // 10 i32 values

// Zero-allocation array with dynamic length tracking (default u16 counters: 4 bytes metadata)
const items = ArrayView.fromAddress<u16>(ITEMS_ADDR, 20); // max 20 u16 values, capacity 20 items

// Zero-allocation array with u8 counters (only 2 bytes metadata for small arrays!)
const tags = ArrayView.fromAddress<u8, u8>(TAGS_ADDR, 10); // max 10 u8 values, capacity 10 items

const arrOfVec = UncheckedArrayObjView.fromAddress<Vec2i>(VECS_ADDR, 8); // Array of Vec2 objects (x,y as f32)

// === Input test panel ===
// Shows the live state of every input the SDK supports. A box lights up while
// its button is held, and the number under it counts buttonPressed() edges.

// Every keyboard button, in the order of the press counters below.
const BUTTONS: StaticArray<Button> = [
  Button.UP,
  Button.DOWN,
  Button.LEFT,
  Button.RIGHT,
  Button.A,
  Button.B,
  Button.X,
  Button.Y,
  Button.START,
  Button.LT,
  Button.RT,
];
const MOUSE_BUTTONS: StaticArray<MouseButton> = [MouseButton.LEFT, MouseButton.MIDDLE, MouseButton.RIGHT];

// Press counters: one u16 per keyboard button, then one per mouse button.
const presses = UncheckedArrayView.fromAddress<u16>(RAM_START + 280); // 14 u16 values

// @ts-expect-error AssemblyScript decorator
@inline
const MOUSE_COUNTER: i32 = 11;

// === lifecycle ===

export function init(): void {
  clearFramebuffer(c(0xff000000)); // black

  for (let i = 0; i < 14; i++) presses.set(i, 0);

  // Initialize player position in RAM
  vars.playerX = 160;
  vars.playerY = 120;

  // Initialize arrays - zero allocation!
  grid.fill(0, 100); // Clear 100 u8 values
  scores.set(0, 1000); // High score (bracket notation supported!)
  scores.set(1, 500);
  grid.set(10, 42); // Set grid cell (bracket notation supported!)

  // Initialize dynamic array with capacity
  items.clear();
  items.push(100);
  items.push(200);
  items.push(300);

  // Initialize small array with u8 counters (saves 6 bytes vs i32!)
  tags.clear();
  tags.push(1);
  tags.push(2);

  // Initialize array of objects
  arrOfVec.set(0, new Vec2i(1, 2));
  arrOfVec.set(1, new Vec2i(3, 4));
  // store<u32>(RAM_START + 208 + 4, 123);

  log("Starting!");
}

export function update(): void {
  // Movement logic - the axis helpers return -1, 0 or 1 from held buttons
  vars.playerX += p1AxisX();
  vars.playerY += p1AxisY();

  // buttonPressed() is true only on the frame a button goes down
  for (let i = 0; i < BUTTONS.length; i++) {
    if (buttonPressed(BUTTONS[i])) presses.set(i, presses.get(i) + 1);
  }
  for (let i = 0; i < MOUSE_BUTTONS.length; i++) {
    if (mousePressed(MOUSE_BUTTONS[i])) presses.set(MOUSE_COUNTER + i, presses.get(MOUSE_COUNTER + i) + 1);
  }

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
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const r = x & 255;
      const g = y & 255;
      const b = 128;
      pset(x, y, (r << 16) | (g << 8) | b);
    }
  }
  // draw player
  pset(px, py, c(0xffffff));

  drawSpriteScaled(s("level1"), 0, 0, 16, 16);

  const speed: f32 = 0.3;
  const i = <u32>Mathf.floor((<f32>vars.animFrame * speed) / 2) % 9;
  const o = <u32>Mathf.floor(<f32>vars.animFrame * speed) % 350;
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

  const v0 = arrOfVec.get(0);
  const v1 = arrOfVec.get(1);
  drawNumber(300, 10, v0.x, c(0xff0000));
  drawNumber(300, 30, v0.y, c(0x00ff00));
  drawNumber(300, 50, v1.x, c(0x0000ff));
  drawNumber(300, 70, v1.y, c(0xffff00));

  drawInputPanel();
}

/** One button box: lit while held, label inside, press count underneath. */
function drawButton(x: i32, y: i32, w: i32, label: string, held: bool, count: i32, lit: u32): void {
  fillRect(x, y, w, 14, held ? lit : c(0x1f2937));
  drawRect(x, y, w, 14, held ? c(0xffffff) : c(0x64748b));
  print(x + ((w - label.length * 6) >> 1), y + 3, label, held ? c(0x000000) : c(0xe2e8f0));
  printNumber(x + 2, y + 16, count, c(0x94a3b8));
}

function key(index: i32, x: i32, y: i32, w: i32, label: string, lit: u32): void {
  drawButton(x, y, w, label, buttonDown(BUTTONS[index]), presses.get(index) as i32, lit);
}

function drawInputPanel(): void {
  const grey = c(0x94a3b8);
  const white = c(0xffffff);
  fillRect(16, 24, 288, 196, c(0x0b1120));
  drawRect(16, 24, 288, 196, c(0x64748b));
  print(22, 28, "INPUT TEST  (held = lit, number = presses)", grey);

  // Triggers
  key(9, 24, 42, 60, "LT", c(0xf97316));
  print(24, 68, "L CTRL", grey);
  key(10, 236, 42, 60, "RT", c(0xf97316));
  print(242, 68, "R CTRL", grey);

  // D-pad (arrow keys)
  const dpad = c(0x38bdf8);
  key(0, 54, 82, 26, "^", dpad);
  key(2, 24, 110, 26, "<", dpad);
  key(3, 84, 110, 26, ">", dpad);
  key(1, 54, 138, 26, "v", dpad);
  print(36, 168, "ARROWS", grey);

  // Action buttons (diamond on WASD)
  key(7, 236, 82, 26, "Y", c(0xeab308));
  key(6, 206, 110, 26, "X", c(0x3b82f6));
  key(5, 266, 110, 26, "B", c(0x22c55e));
  key(4, 236, 138, 26, "A", c(0xef4444));
  print(220, 168, "W A S D", grey);

  // Start
  key(8, 130, 82, 60, "START", c(0xa78bfa));
  print(124, 108, "ENTER/SPACE", grey);

  // Axis helpers
  print(118, 124, "P1 AXIS", grey);
  printNumber(166, 124, p1AxisX(), white);
  printNumber(184, 124, p1AxisY(), white);
  print(118, 136, "P2 AXIS", grey);
  printNumber(166, 136, p2AxisX(), white);
  printNumber(184, 136, p2AxisY(), white);
  print(118, 148, "MASK", grey);
  printNumber(166, 148, load<u16>(INPUT_BUTTONS_ADDR) as i32, white);

  // Mouse
  const mx = mouseX() as i32;
  const my = mouseY() as i32;
  print(24, 184, "MOUSE X", grey);
  printNumber(72, 184, mx, white);
  print(102, 184, "Y", grey);
  printNumber(112, 184, my, white);
  const mouse = c(0xf472b6);
  for (let i = 0; i < 3; i++) {
    const label = i == 0 ? "L" : i == 1 ? "M" : "R";
    drawButton(
      164 + i * 30,
      180,
      26,
      label,
      mouseDown(MOUSE_BUTTONS[i]),
      presses.get(MOUSE_COUNTER + i) as i32,
      mouse,
    );
  }

  // Crosshair at the mouse position
  if (mx >= 0 && my >= 0) {
    drawLine(mx - 4, my, mx + 4, my, white);
    drawLine(mx, my - 4, mx, my + 4, white);
  }
}
