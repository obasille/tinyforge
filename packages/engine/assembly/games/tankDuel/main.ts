// TANK DUEL - TinyForge Game
// Two-player top-down tank battle. Shells bounce off walls; one hit loses
// the round, first to 3 rounds wins the match (best of 5).
//
// Player 1 (orange, right): arrow keys to drive, RT (Right Ctrl) to fire
// Player 2 (blue, left):    W/A/S/D to drive, LT (Left Ctrl) to fire
// Each player starts on their own side of the keyboard.

import {
  Button,
  buttonDown,
  buttonPressed,
  c,
  clearFramebuffer,
  drawCircle,
  drawLine,
  drawNumber,
  drawRect,
  drawStartMessageBox,
  drawString,
  fillCircle,
  fillRect,
  log,
  logi,
  p1AxisX,
  p1AxisY,
  p2AxisX,
  p2AxisY,
  playMusic,
  playSfx,
  RAM_START,
  SCREEN_WIDTH,
  stopMusic,
  warni,
} from "../../sdk";

// Game metadata, read by the TinyForge tooling (string literals only).
const TITLE = "Tank Duel";
const DESCRIPTION = "Two-player top-down tank battle with bouncing shells";
const AUTHOR = "Olivier Basille";

// === Constants ===
const TILE: i32 = 16;
const COLS: i32 = 20;
const ROWS: i32 = 14;
const HUD_HEIGHT: i32 = 16;
const ARENA_Y: i32 = HUD_HEIGHT; // arena fills the screen below the HUD

const TANK_HALF: f32 = 6.0; // tanks are 12x12
const TANK_SPEED: f32 = 1.0;
const DIAGONAL: f32 = 0.70710678;
const BARREL_LENGTH: f32 = 9.0;

const SHELL_SPEED: f32 = 2.5;
const SHELL_RADIUS: f32 = 2.0;
const SHELL_SUBSTEPS: i32 = 2;
const MAX_BOUNCES: u8 = 2; // a shell dies on its third wall hit
const SHELLS_PER_TANK: i32 = 3;
const MAX_SHELLS: i32 = SHELLS_PER_TANK * 2;
const SHELL_SAFE_FRAMES: u16 = 10; // a fresh shell can't hit its own tank
const SHELL_MAX_AGE: u16 = 900;
const FIRE_COOLDOWN: u8 = 18;

const MAX_PUFFS: i32 = 8;
const PUFF_FRAMES: u8 = 14;

const WINS_NEEDED: u8 = 3;
const COUNTDOWN_FRAMES: i32 = 180; // 3, 2, 1
const GO_FRAMES: i32 = 45;
const ROUND_OVER_FRAMES: i32 = 150;
const EXPLOSION_FRAMES: i32 = 60;
const LAYOUT_COUNT: i32 = 3;

// Same colors as pong: arrows player orange, WASD player blue.
const P1_COLOR: u32 = 0xff7a2a;
const P1_DARK: u32 = 0x8c3f12;
const P2_COLOR: u32 = 0x3fa9ff;
const P2_DARK: u32 = 0x1d5a8c;
const FLOOR_COLOR: u32 = 0x1b1e16;
const FLOOR_DOT_COLOR: u32 = 0x262a1f;
const WALL_COLOR: u32 = 0x6b6f5a;
const WALL_LIGHT: u32 = 0x8f947a;
const WALL_DARK: u32 = 0x45483a;

// Arena layouts, 20x14 tiles each ('#' wall, '.' floor), one after another.
// Every layout is symmetric under a half turn so both spawns are fair.
const LAYOUTS: StaticArray<string> = [
  // Crossroads
  "####################",
  "#..................#",
  "#..................#",
  "#....###....#......#",
  "#....#......#..##..#",
  "#...........#......#",
  "#......##..........#",
  "#..........##......#",
  "#......#...........#",
  "#..##..#......#....#",
  "#......#....###....#",
  "#..................#",
  "#..................#",
  "####################",
  // Bunkers
  "####################",
  "#..................#",
  "#..##.........#....#",
  "#..#.....##...#....#",
  "#........#.........#",
  "#....#.......###...#",
  "#....#.............#",
  "#.............#....#",
  "#...###.......#....#",
  "#.........#........#",
  "#....#...##.....#..#",
  "#....#.........##..#",
  "#..................#",
  "####################",
  // Corridors
  "####################",
  "#.......#..........#",
  "#.......#....##....#",
  "#....#.............#",
  "#.........###...#..#",
  "#....#.............#",
  "#....#....#........#",
  "#........#....#....#",
  "#.............#....#",
  "#..#...###.........#",
  "#.............#....#",
  "#....##....#.......#",
  "#..........#.......#",
  "####################",
];

enum GameState {
  TITLE = 0,
  COUNTDOWN = 1,
  PLAYING = 2,
  ROUND_OVER = 3,
  MATCH_OVER = 4,
}

// 8 facing directions, clockwise from east (screen y points down).
const DIR_X: StaticArray<f32> = [1.0, DIAGONAL, 0.0, -DIAGONAL, -1.0, -DIAGONAL, 0.0, DIAGONAL];
const DIR_Y: StaticArray<f32> = [0.0, DIAGONAL, 1.0, DIAGONAL, 0.0, -DIAGONAL, -1.0, -DIAGONAL];

// === RAM Layout ===
@unmanaged
class Tank {
  x: f32; // 0  center
  y: f32; // 4
  dir: u8; // 8  0..7, see DIR_X / DIR_Y
  alive: u8; // 9
  cooldown: u8; // 10
  wins: u8; // 11
  treadPhase: u8; // 12 advances while driving
}
const TANK_SIZE: i32 = 16;

@unmanaged
class Shell {
  x: f32; // 0
  y: f32; // 4
  vx: f32; // 8
  vy: f32; // 12
  age: u16; // 16
  active: u8; // 18
  owner: u8; // 19 0 = player 1, 1 = player 2
  bounces: u8; // 20
}
const SHELL_SIZE: i32 = 24;

@unmanaged
class Puff {
  x: f32; // 0
  y: f32; // 4
  timer: u8; // 8 counts down, 0 = unused
}
const PUFF_SIZE: i32 = 12;

@unmanaged
class Vars {
  state: u8; // 0
  layout: u8; // 1
  round: u8; // 2  1-based
  roundWinner: u8; // 3  0 = none yet, 1 or 2, 3 = draw
  timer: i32; // 4  countdown / round-over frames
  goTimer: i32; // 8  frames left showing "GO!"
  frame: i32; // 12 frames since boot, drives small animations
  explosionTimer: i32; // 16
}
// offsetof<Vars>() is the struct size; sizeof<Vars>() would be the size of a
// pointer (4).
const VARS_SIZE: i32 = <i32>offsetof<Vars>();

const TANKS_ADDR: usize = RAM_START + VARS_SIZE;
const SHELLS_ADDR: usize = TANKS_ADDR + 2 * TANK_SIZE;
const PUFFS_ADDR: usize = SHELLS_ADDR + MAX_SHELLS * SHELL_SIZE;

const vars = changetype<Vars>(RAM_START);

function tank(index: i32): Tank {
  return changetype<Tank>(TANKS_ADDR + <usize>(index * TANK_SIZE));
}

function shell(index: i32): Shell {
  return changetype<Shell>(SHELLS_ADDR + <usize>(index * SHELL_SIZE));
}

function puff(index: i32): Puff {
  return changetype<Puff>(PUFFS_ADDR + <usize>(index * PUFF_SIZE));
}

// === Input ===
// Player 1 (index 0) drives with the arrows, player 2 with WASD.
function axisX(player: i32): i32 {
  return player == 0 ? p1AxisX() : p2AxisX();
}

function axisY(player: i32): i32 {
  return player == 0 ? p1AxisY() : p2AxisY();
}

function firePressed(player: i32): bool {
  return buttonPressed(player == 0 ? Button.P1_FIRE : Button.P2_FIRE);
}

// === Arena ===
function isWallTile(col: i32, row: i32): bool {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return true;
  const line: string = unchecked(LAYOUTS[<i32>vars.layout * ROWS + row]);
  return line.charCodeAt(col) == 35; // '#'
}

/** True when the world point is inside a wall (or outside the arena). */
function isWallAt(x: f32, y: f32): bool {
  const col: i32 = <i32>Mathf.floor(x / <f32>TILE);
  const row: i32 = <i32>Mathf.floor((y - <f32>ARENA_Y) / <f32>TILE);
  return isWallTile(col, row);
}

/** True when an axis-aligned box centered on (x, y) touches any wall. */
function boxHitsWall(x: f32, y: f32, half: f32): bool {
  const left: i32 = <i32>Mathf.floor((x - half) / <f32>TILE);
  const right: i32 = <i32>Mathf.floor((x + half - 0.01) / <f32>TILE);
  const top: i32 = <i32>Mathf.floor((y - half - <f32>ARENA_Y) / <f32>TILE);
  const bottom: i32 = <i32>Mathf.floor((y + half - 0.01 - <f32>ARENA_Y) / <f32>TILE);
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      if (isWallTile(col, row)) return true;
    }
  }
  return false;
}

function tanksOverlap(x: f32, y: f32, other: Tank): bool {
  if (!other.alive) return false;
  const size: f32 = TANK_HALF * 2.0;
  return Mathf.abs(x - other.x) < size && Mathf.abs(y - other.y) < size;
}

// === Effects ===
function spawnPuff(x: f32, y: f32): void {
  for (let i = 0; i < MAX_PUFFS; i++) {
    const p = puff(i);
    if (p.timer == 0) {
      p.x = x;
      p.y = y;
      p.timer = PUFF_FRAMES;
      return;
    }
  }
  // All puffs busy: reuse the oldest-looking one rather than drop the effect.
  const p = puff(0);
  p.x = x;
  p.y = y;
  p.timer = PUFF_FRAMES;
}

// === Round setup ===
function resetRound(): void {
  vars.layout = <u8>((<i32>vars.round - 1) % LAYOUT_COUNT);
  vars.roundWinner = 0;
  vars.timer = COUNTDOWN_FRAMES;
  vars.goTimer = 0;
  vars.explosionTimer = 0;

  const middle: f32 = <f32>(ARENA_Y + (ROWS / 2) * TILE);
  const spawnInset: i32 = 2 * TILE + TILE / 2; // center of the third column
  // Player 1 (arrows) on the right, player 2 (WASD) on the left.
  const p1 = tank(0);
  p1.x = <f32>(SCREEN_WIDTH - spawnInset);
  p1.y = middle;
  p1.dir = 4; // facing west
  p1.alive = 1;
  p1.cooldown = 0;
  p1.treadPhase = 0;

  const p2 = tank(1);
  p2.x = <f32>spawnInset;
  p2.y = middle;
  p2.dir = 0; // facing east
  p2.alive = 1;
  p2.cooldown = 0;
  p2.treadPhase = 0;

  for (let i = 0; i < MAX_SHELLS; i++) shell(i).active = 0;
  for (let i = 0; i < MAX_PUFFS; i++) puff(i).timer = 0;

  vars.state = GameState.COUNTDOWN as u8;
  logi("Round {} on layout {}", vars.round, vars.layout);
}

function startMatch(): void {
  tank(0).wins = 0;
  tank(1).wins = 0;
  vars.round = 1;
  resetRound();
  playSfx("tank_tick", 0.5); // the "3"
}

// === Tanks ===
function updateTank(player: i32): void {
  const t = tank(player);
  if (!t.alive) return;
  const other = tank(1 - player);

  if (t.cooldown > 0) t.cooldown--;

  const ax: i32 = axisX(player);
  const ay: i32 = axisY(player);
  if (ax != 0 || ay != 0) {
    // Face the direction being pushed: index 0..7 clockwise from east.
    let dir: i32 = 0;
    if (ax > 0 && ay == 0) dir = 0;
    else if (ax > 0 && ay > 0) dir = 1;
    else if (ax == 0 && ay > 0) dir = 2;
    else if (ax < 0 && ay > 0) dir = 3;
    else if (ax < 0 && ay == 0) dir = 4;
    else if (ax < 0 && ay < 0) dir = 5;
    else if (ax == 0 && ay < 0) dir = 6;
    else dir = 7;
    t.dir = <u8>dir;
    t.treadPhase = <u8>((<i32>t.treadPhase + 1) & 0xff);

    const speed: f32 = ax != 0 && ay != 0 ? TANK_SPEED * DIAGONAL : TANK_SPEED;
    // Move one axis at a time so tanks slide along walls.
    const nx: f32 = t.x + <f32>ax * speed;
    if (!boxHitsWall(nx, t.y, TANK_HALF) && !tanksOverlap(nx, t.y, other)) t.x = nx;
    const ny: f32 = t.y + <f32>ay * speed;
    if (!boxHitsWall(t.x, ny, TANK_HALF) && !tanksOverlap(t.x, ny, other)) t.y = ny;
  }

  if (firePressed(player) && t.cooldown == 0) fire(player);
}

function fire(player: i32): void {
  const t = tank(player);
  let live: i32 = 0;
  let free: i32 = -1;
  for (let i = 0; i < MAX_SHELLS; i++) {
    const s = shell(i);
    if (s.active) {
      if (<i32>s.owner == player) live++;
    } else if (free < 0) {
      free = i;
    }
  }
  if (live >= SHELLS_PER_TANK) return; // out of ammo until a shell is gone
  if (free < 0) {
    warni("No free shell slot for player {} (live {})", player + 1, live);
    return;
  }

  const dx: f32 = unchecked(DIR_X[<i32>t.dir]);
  const dy: f32 = unchecked(DIR_Y[<i32>t.dir]);
  let sx: f32 = t.x + dx * BARREL_LENGTH;
  let sy: f32 = t.y + dy * BARREL_LENGTH;
  // Barrel pushed into a wall: fire from the hull instead of through it.
  if (isWallAt(sx, sy)) {
    sx = t.x;
    sy = t.y;
  }

  const s = shell(free);
  s.x = sx;
  s.y = sy;
  s.vx = dx * SHELL_SPEED;
  s.vy = dy * SHELL_SPEED;
  s.age = 0;
  s.active = 1;
  s.owner = <u8>player;
  s.bounces = 0;
  t.cooldown = FIRE_COOLDOWN;
  playSfx(player == 0 ? "tank_fire_p1" : "tank_fire_p2", 0.5);
}

// === Shells ===
function killShell(s: Shell): void {
  s.active = 0;
  spawnPuff(s.x, s.y);
}

function wallHit(s: Shell): bool {
  if (s.bounces >= MAX_BOUNCES) {
    killShell(s);
    playSfx("tank_fizzle", 0.4);
    return true;
  }
  s.bounces++;
  playSfx("tank_bounce", 0.35);
  return false;
}

/** Moves a shell one frame. Returns false when it hit a wall for good. */
function moveShell(s: Shell): bool {
  for (let step = 0; step < SHELL_SUBSTEPS; step++) {
    const stepX: f32 = s.vx / <f32>SHELL_SUBSTEPS;
    const stepY: f32 = s.vy / <f32>SHELL_SUBSTEPS;
    // Each axis separately: a wall in the way of x flips vx, of y flips vy.
    s.x += stepX;
    if (isWallAt(s.x, s.y)) {
      s.x -= stepX;
      s.vx = -s.vx;
      if (wallHit(s)) return false;
    }
    s.y += stepY;
    if (isWallAt(s.x, s.y)) {
      s.y -= stepY;
      s.vy = -s.vy;
      if (wallHit(s)) return false;
    }
  }
  return true;
}

function shellHitsTank(s: Shell, t: Tank): bool {
  if (!t.alive) return false;
  const reach: f32 = TANK_HALF + SHELL_RADIUS;
  return Mathf.abs(s.x - t.x) < reach && Mathf.abs(s.y - t.y) < reach;
}

function updateShells(): void {
  // Hits are collected first so two tanks hit on the same frame is a draw.
  let hit0 = false;
  let hit1 = false;

  for (let i = 0; i < MAX_SHELLS; i++) {
    const s = shell(i);
    if (!s.active) continue;
    s.age++;
    if (s.age >= SHELL_MAX_AGE) {
      killShell(s);
      continue;
    }
    if (!moveShell(s)) continue;

    for (let p = 0; p < 2; p++) {
      // A fresh shell is still leaving its own barrel.
      if (<i32>s.owner == p && s.age < SHELL_SAFE_FRAMES) continue;
      if (shellHitsTank(s, tank(p))) {
        if (p == 0) hit0 = true;
        else hit1 = true;
        s.active = 0;
        break;
      }
    }
  }

  // Shells that meet cancel each other out.
  for (let i = 0; i < MAX_SHELLS; i++) {
    const a = shell(i);
    if (!a.active) continue;
    for (let j = i + 1; j < MAX_SHELLS; j++) {
      const b = shell(j);
      if (!b.active) continue;
      const dx: f32 = a.x - b.x;
      const dy: f32 = a.y - b.y;
      const reach: f32 = SHELL_RADIUS * 2.0;
      if (dx * dx + dy * dy < reach * reach) {
        killShell(a);
        killShell(b);
        playSfx("tank_fizzle", 0.4);
        break;
      }
    }
  }

  if (hit0 || hit1) endRound(hit0, hit1);
}

function endRound(hit0: bool, hit1: bool): void {
  const p1 = tank(0);
  const p2 = tank(1);
  if (hit0) p1.alive = 0;
  if (hit1) p2.alive = 0;

  if (hit0 && hit1) {
    vars.roundWinner = 3;
    log("Round is a draw");
  } else if (hit1) {
    vars.roundWinner = 1;
    p1.wins++;
  } else {
    vars.roundWinner = 2;
    p2.wins++;
  }
  logi("Round {} over: P1 {} - P2 {}", vars.round, p1.wins, p2.wins);

  vars.state = GameState.ROUND_OVER as u8;
  vars.timer = ROUND_OVER_FRAMES;
  vars.goTimer = 0;
  vars.explosionTimer = EXPLOSION_FRAMES;
  playSfx("tank_explode", 0.7);
}

function updatePuffs(): void {
  for (let i = 0; i < MAX_PUFFS; i++) {
    const p = puff(i);
    if (p.timer > 0) p.timer--;
  }
}

// === Lifecycle ===
export function init(): void {
  vars.state = GameState.TITLE as u8;
  vars.round = 1;
  vars.frame = 0;
  tank(0).wins = 0;
  tank(1).wins = 0;
  resetRound();
  // The title shows the first arena with both tanks parked in it.
  vars.state = GameState.TITLE as u8;
  log("Tank Duel ready");
}

export function update(): void {
  vars.frame++;
  const state = vars.state;

  if (state == GameState.TITLE || state == GameState.MATCH_OVER) {
    updatePuffs();
    if (vars.explosionTimer > 0) vars.explosionTimer--;
    if (buttonPressed(Button.START)) {
      // Audio only starts after a user gesture, so start music on START.
      playMusic("tank_theme", 0.35);
      startMatch();
    }
    return;
  }

  updatePuffs();
  if (vars.explosionTimer > 0) vars.explosionTimer--;

  if (state == GameState.COUNTDOWN) {
    vars.timer--;
    if (vars.timer <= 0) {
      vars.state = GameState.PLAYING as u8;
      vars.goTimer = GO_FRAMES;
      playSfx("tank_go", 0.5);
    } else if (vars.timer % 60 == 0) {
      playSfx("tank_tick", 0.5);
    }
    return;
  }

  if (state == GameState.ROUND_OVER) {
    // Shells already in the air keep flying while the wreck burns, and
    // fizzle out against the tank that is still standing.
    for (let i = 0; i < MAX_SHELLS; i++) {
      const s = shell(i);
      if (!s.active || !moveShell(s)) continue;
      if (shellHitsTank(s, tank(0)) || shellHitsTank(s, tank(1))) killShell(s);
    }
    vars.timer--;
    if (vars.timer > 0) return;

    const p1 = tank(0);
    const p2 = tank(1);
    if (p1.wins >= WINS_NEEDED || p2.wins >= WINS_NEEDED) {
      vars.state = GameState.MATCH_OVER as u8;
      for (let i = 0; i < MAX_SHELLS; i++) shell(i).active = 0;
      stopMusic();
      playSfx("tank_win", 0.8);
      logi("Match over: P1 {} - P2 {}", p1.wins, p2.wins);
    } else {
      vars.round++;
      resetRound();
      playSfx("tank_tick", 0.5); // the "3"
    }
    return;
  }

  // PLAYING
  if (vars.goTimer > 0) vars.goTimer--;
  updateTank(0);
  updateTank(1);
  updateShells();
}

// === Drawing ===
function drawArena(): void {
  fillRect(0, ARENA_Y, SCREEN_WIDTH, ROWS * TILE, c(FLOOR_COLOR));
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x: i32 = col * TILE;
      const y: i32 = ARENA_Y + row * TILE;
      if (isWallTile(col, row)) {
        fillRect(x, y, TILE, TILE, c(WALL_COLOR));
        // Bevel: light top/left, dark bottom/right, plus a brick seam.
        fillRect(x, y, TILE, 2, c(WALL_LIGHT));
        fillRect(x, y, 2, TILE, c(WALL_LIGHT));
        fillRect(x, y + TILE - 2, TILE, 2, c(WALL_DARK));
        fillRect(x + TILE - 2, y, 2, TILE, c(WALL_DARK));
        fillRect(x + 2, y + TILE / 2 - 1, TILE - 4, 1, c(WALL_DARK));
      } else {
        fillRect(x + TILE / 2, y + TILE / 2, 1, 1, c(FLOOR_DOT_COLOR));
      }
    }
  }
}

function drawTank(player: i32): void {
  const t = tank(player);
  const cx: i32 = <i32>Mathf.round(t.x);
  const cy: i32 = <i32>Mathf.round(t.y);
  const color: u32 = c(player == 0 ? P1_COLOR : P2_COLOR);
  const dark: u32 = c(player == 0 ? P1_DARK : P2_DARK);

  if (!t.alive) {
    // Burnt-out hull.
    fillRect(cx - 6, cy - 6, 12, 12, c(0x2a2a2a));
    drawRect(cx - 6, cy - 6, 12, 12, dark);
    fillCircle(cx, cy, 2, c(0x111111));
    return;
  }

  const dir: i32 = <i32>t.dir;
  const dx: f32 = unchecked(DIR_X[dir]);
  const dy: f32 = unchecked(DIR_Y[dir]);
  // Tracks run along the hull's main axis (horizontal for E/W, vertical for
  // N/S; diagonals use the horizontal look).
  const vertical: bool = dir == 2 || dir == 6;
  const tread: i32 = (<i32>t.treadPhase >> 2) & 3;
  if (vertical) {
    fillRect(cx - 6, cy - 6, 3, 12, dark);
    fillRect(cx + 3, cy - 6, 3, 12, dark);
    for (let k = 0; k < 3; k++) {
      const ty: i32 = cy - 6 + ((k * 4 + tread) % 12);
      fillRect(cx - 6, ty, 3, 1, c(0x101010));
      fillRect(cx + 3, ty, 3, 1, c(0x101010));
    }
    fillRect(cx - 3, cy - 5, 6, 10, color);
  } else {
    fillRect(cx - 6, cy - 6, 12, 3, dark);
    fillRect(cx - 6, cy + 3, 12, 3, dark);
    for (let k = 0; k < 3; k++) {
      const tx: i32 = cx - 6 + ((k * 4 + tread) % 12);
      fillRect(tx, cy - 6, 1, 3, c(0x101010));
      fillRect(tx, cy + 3, 1, 3, c(0x101010));
    }
    fillRect(cx - 5, cy - 3, 10, 6, color);
  }

  // Barrel: two lines side by side so it reads at 1x.
  const bx: i32 = cx + <i32>Mathf.round(dx * BARREL_LENGTH);
  const by: i32 = cy + <i32>Mathf.round(dy * BARREL_LENGTH);
  drawLine(cx, cy, bx, by, c(0xe8e8e8));
  if (vertical) drawLine(cx + 1, cy, bx + 1, by, c(0xb0b0b0));
  else drawLine(cx, cy + 1, bx, by + 1, c(0xb0b0b0));

  // Turret.
  fillCircle(cx, cy, 3, dark);
  fillCircle(cx, cy, 2, color);
}

function drawShells(): void {
  for (let i = 0; i < MAX_SHELLS; i++) {
    const s = shell(i);
    if (!s.active) continue;
    const x: i32 = <i32>Mathf.round(s.x);
    const y: i32 = <i32>Mathf.round(s.y);
    fillCircle(x, y, 2, c(s.owner == 0 ? P1_COLOR : P2_COLOR));
    fillRect(x, y, 1, 1, c(0xffffff));
  }
}

function drawPuffs(): void {
  for (let i = 0; i < MAX_PUFFS; i++) {
    const p = puff(i);
    if (p.timer == 0) continue;
    const age: i32 = <i32>(PUFF_FRAMES - p.timer);
    const r: i32 = 1 + age / 3;
    const x: i32 = <i32>Mathf.round(p.x);
    const y: i32 = <i32>Mathf.round(p.y);
    drawCircle(x, y, r, c(age < 5 ? 0xffe27a : 0x8a8a7a));
  }
}

function drawExplosion(player: i32): void {
  const left: i32 = vars.explosionTimer;
  if (left <= 0) return;
  const t = tank(player);
  if (t.alive) return;
  const age: i32 = EXPLOSION_FRAMES - left;
  const cx: i32 = <i32>Mathf.round(t.x);
  const cy: i32 = <i32>Mathf.round(t.y);
  if (age < 10) {
    fillCircle(cx, cy, 4 + age, c(age < 4 ? 0xffffff : 0xffd040));
  }
  if (age < 30) {
    drawCircle(cx, cy, 6 + age, c(0xff7a2a));
    drawCircle(cx, cy, 3 + age / 2, c(0xffd040));
  }
  // Eight sparks flying out along the eight directions.
  if (age < 40) {
    const dist: f32 = <f32>(age * 3 / 2 + 4);
    for (let d = 0; d < 8; d++) {
      const sx: i32 = cx + <i32>Mathf.round(unchecked(DIR_X[d]) * dist);
      const sy: i32 = cy + <i32>Mathf.round(unchecked(DIR_Y[d]) * dist);
      fillRect(sx - 1, sy - 1, 2, 2, c(age < 20 ? 0xffd040 : 0x885522));
    }
  }
}

function drawPips(x: i32, wins: u8, color: u32): void {
  for (let i = 0; i < <i32>WINS_NEEDED; i++) {
    const px: i32 = x + i * 10;
    if (i < <i32>wins) fillRect(px, 5, 7, 7, c(color));
    else drawRect(px, 5, 7, 7, c(color));
  }
}

function drawHud(): void {
  fillRect(0, 0, SCREEN_WIDTH, HUD_HEIGHT, c(0x0c0d0a));
  // Each score sits on its tank's side: player 2 left, player 1 right.
  drawString(6, 5, "P2", c(P2_COLOR));
  drawPips(26, tank(1).wins, P2_COLOR);
  drawString(SCREEN_WIDTH - 22, 5, "P1", c(P1_COLOR));
  drawPips(SCREEN_WIDTH - 54, tank(0).wins, P1_COLOR);
  if (vars.state != GameState.TITLE) {
    drawString(SCREEN_WIDTH / 2 - 32, 5, "ROUND", c(0xbbbbbb));
    drawNumber(SCREEN_WIDTH / 2 + 16, 5, <i32>vars.round, c(0xffffff));
  }
}

function drawBanner(text: string, color: u32): void {
  const w: i32 = text.length * 8 + 16;
  const x: i32 = SCREEN_WIDTH / 2 - w / 2;
  const y: i32 = ARENA_Y + (ROWS * TILE) / 2 - 10;
  fillRect(x, y, w, 20, c(0x101010));
  drawRect(x, y, w, 20, c(color));
  drawString(x + 8, y + 7, text, c(color));
}

export function draw(): void {
  clearFramebuffer(c(0x000000));
  drawArena();
  drawTank(0);
  drawTank(1);
  drawShells();
  drawPuffs();
  drawExplosion(0);
  drawExplosion(1);
  drawHud();

  const state = vars.state;
  if (state == GameState.TITLE) {
    drawStartMessageBox("TANK DUEL", c(0x14160f), c(0xd8dcc0));
    fillRect(40, 160, 240, 30, c(0x14160f));
    drawRect(40, 160, 240, 30, c(0x45483a));
    drawString(48, 166, "P1 ARROWS  FIRE R-CTRL", c(P1_COLOR));
    drawString(48, 178, "P2  WASD   FIRE L-CTRL", c(P2_COLOR));
  } else if (state == GameState.COUNTDOWN) {
    const n: i32 = (vars.timer + 59) / 60;
    if (n >= 3) drawBanner("3", 0xffff60);
    else if (n == 2) drawBanner("2", 0xffff60);
    else drawBanner("1", 0xffff60);
  } else if (state == GameState.PLAYING) {
    if (vars.goTimer > 0) drawBanner("GO!", 0x80ff80);
  } else if (state == GameState.ROUND_OVER) {
    if (vars.timer < ROUND_OVER_FRAMES - 30) {
      if (vars.roundWinner == 1) drawBanner("P1 WINS THE ROUND", P1_COLOR);
      else if (vars.roundWinner == 2) drawBanner("P2 WINS THE ROUND", P2_COLOR);
      else drawBanner("DRAW", 0xdddddd);
    }
  } else if (state == GameState.MATCH_OVER) {
    if (tank(0).wins >= WINS_NEEDED) {
      drawStartMessageBox("PLAYER 1 WINS!", c(0x14160f), c(P1_COLOR));
    } else {
      drawStartMessageBox("PLAYER 2 WINS!", c(0x14160f), c(P2_COLOR));
    }
  }
}
