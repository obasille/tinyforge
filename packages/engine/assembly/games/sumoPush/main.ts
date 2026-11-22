// SUMO PUSH - TinyForge Game
// Two discs on a shrinking ring. Shove the other one off the edge.
// Best of 5 rounds (first to 3).
//
// Controls (same keyboard, side by side):
//   Player 1 (red, left):   W A S D   (second D-pad: Button.P2_*)
//   Player 2 (blue, right): arrow keys
//   Dash: Left Ctrl (WASD player) / Right Ctrl (arrows player), in the held
//   direction. Double-tapping a direction also dashes, for keyboards with no
//   Right Ctrl.
//   START: begin / next match.

import {
  Button,
  buttonPressed,
  c,
  clearFramebuffer,
  drawCircle,
  drawStartMessageBox,
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
  print,
  printCentered,
  printNumber,
  RAM_START,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  stopMusic,
  warn,
  warni,
  withAlpha,
} from "../../sdk";

// Game metadata, read by the TinyForge tooling (string literals only).
const TITLE = "Sumo Push";
const DESCRIPTION = "Two discs on a shrinking ring: shove the other one off the edge";
const AUTHOR = "Olivier Basille";

// === Constants ===
const ARENA_X: f32 = 160.0;
const ARENA_Y: f32 = 130.0;
const ARENA_START_RADIUS: f32 = 100.0;
const ARENA_MIN_RADIUS: f32 = 38.0;
const SHRINK_DELAY: i32 = 300; // frames of play before the ring starts to shrink
const SHRINK_SPEED: f32 = 0.05; // pixels per frame

const DISC_RADIUS: f32 = 10.0;
const START_OFFSET: f32 = 40.0; // distance from the center at the start of a round
const ACCEL: f32 = 0.2;
const FRICTION: f32 = 0.93;
const DIAGONAL: f32 = 0.7071;
const RESTITUTION: f32 = 0.9;

const DASH_SPEED: f32 = 5.0;
const DASH_COOLDOWN: i32 = 75;
const DASH_FX_FRAMES: i32 = 12;
const DOUBLE_TAP_WINDOW: i32 = 14;

const FALL_FRAMES: i32 = 36;
const COUNTDOWN_FRAMES: i32 = 180;
const ROUND_OVER_FRAMES: i32 = 120;
const ROUNDS_TO_WIN: i32 = 3;

const P1_COLOR: u32 = 0xe8453c;
const P1_DARK: u32 = 0x8c1f1a;
const P1_LIGHT: u32 = 0xffa49a;
const P2_COLOR: u32 = 0x3c8ce8;
const P2_DARK: u32 = 0x1a4a8c;
const P2_LIGHT: u32 = 0x9acbff;

enum GameState {
  TITLE = 0,
  COUNTDOWN = 1,
  PLAYING = 2,
  ROUND_OVER = 3,
  MATCH_OVER = 4,
}

// Round result stored in Vars.roundWinner.
enum RoundResult {
  NONE = 0,
  P1 = 1,
  P2 = 2,
  DRAW = 3,
}

// Direction of the last tap, for double-tap dash detection.
enum Dir {
  NONE = 0,
  UP = 1,
  DOWN = 2,
  LEFT = 3,
  RIGHT = 4,
}

// === RAM Layout ===
@unmanaged
class Vars {
  state: u8; // 0
  roundWinner: u8; // 1
  matchWinner: u8; // 2
  _pad: u8; // 3
  timer: i32; // 4  countdown / round-over timer
  frame: i32; // 8  frames since boot, for double taps and blinking
  playFrames: i32; // 12 frames played this round
  radius: f32; // 16 current ring radius
  round: i32; // 20
  bumpCooldown: i32; // 24 keeps the bump sound from rattling
}

@unmanaged
class Player {
  x: f32; // 0
  y: f32; // 4
  vx: f32; // 8
  vy: f32; // 12
  score: i32; // 16
  dashCooldown: i32; // 20
  dashFx: i32; // 24
  lastTapDir: i32; // 28
  lastTapFrame: i32; // 32
  falling: i32; // 36  0 on the ring, then frames since stepping off
}

// Players start right after Vars. offsetof<Vars>() is the struct size;
// sizeof<Vars>() would be the size of a pointer (4).
const PLAYER_BASE: usize = offsetof<Vars>();
const PLAYER_STRIDE: usize = 48;

const vars = changetype<Vars>(RAM_START);

function player(index: i32): Player {
  if (index < 0 || index > 1) {
    warni("Invalid player index: {}", index);
    index = 0;
  }
  return changetype<Player>(RAM_START + PLAYER_BASE + (<usize>index) * PLAYER_STRIDE);
}

// === Helpers ===
function resetPositions(): void {
  const p1 = player(0);
  const p2 = player(1);
  p1.x = ARENA_X - START_OFFSET;
  p2.x = ARENA_X + START_OFFSET;
  for (let i: i32 = 0; i < 2; i++) {
    const p = player(i);
    p.y = ARENA_Y;
    p.vx = 0.0;
    p.vy = 0.0;
    p.dashCooldown = 0;
    p.dashFx = 0;
    p.lastTapDir = Dir.NONE;
    p.lastTapFrame = 0;
    p.falling = 0;
  }
  vars.radius = ARENA_START_RADIUS;
  vars.playFrames = 0;
  vars.bumpCooldown = 0;
  vars.roundWinner = RoundResult.NONE as u8;
}

function startRound(): void {
  resetPositions();
  vars.round++;
  vars.timer = COUNTDOWN_FRAMES;
  vars.state = GameState.COUNTDOWN as u8;
  playSfx("sumo_count", 0.5);
  logi("Round {}", vars.round);
}

function startMatch(): void {
  player(0).score = 0;
  player(1).score = 0;
  vars.round = 0;
  vars.matchWinner = 0;
  playMusic("sumo_theme", 0.4);
  startRound();
}

// The direction just tapped on this player's D-pad, or Dir.NONE.
function tappedDir(index: i32): i32 {
  if (index == 0) {
    if (buttonPressed(Button.P2_UP)) return Dir.UP;
    if (buttonPressed(Button.P2_DOWN)) return Dir.DOWN;
    if (buttonPressed(Button.P2_LEFT)) return Dir.LEFT;
    if (buttonPressed(Button.P2_RIGHT)) return Dir.RIGHT;
  } else {
    if (buttonPressed(Button.UP)) return Dir.UP;
    if (buttonPressed(Button.DOWN)) return Dir.DOWN;
    if (buttonPressed(Button.LEFT)) return Dir.LEFT;
    if (buttonPressed(Button.RIGHT)) return Dir.RIGHT;
  }
  return Dir.NONE;
}

function dash(p: Player, dx: f32, dy: f32): void {
  const len: f32 = Mathf.sqrt(dx * dx + dy * dy);
  if (len < 0.0001) {
    warn("Dash without a direction");
    return;
  }
  p.vx = (dx / len) * DASH_SPEED;
  p.vy = (dy / len) * DASH_SPEED;
  p.dashCooldown = DASH_COOLDOWN;
  p.dashFx = DASH_FX_FRAMES;
  p.lastTapDir = Dir.NONE;
  playSfx("sumo_dash", 0.5);
}

// Fire key: dash the way the stick points, else the way the disc is
// sliding, else straight at the other disc.
function fireDash(index: i32, p: Player, ax: i32, ay: i32): void {
  if (ax != 0 || ay != 0) {
    dash(p, <f32>ax, <f32>ay);
  } else if (p.vx * p.vx + p.vy * p.vy > 0.04) {
    dash(p, p.vx, p.vy);
  } else {
    const other = player(1 - index);
    const dx: f32 = other.x - p.x;
    const dy: f32 = other.y - p.y;
    if (dx * dx + dy * dy > 0.0001) dash(p, dx, dy);
    else dash(p, index == 0 ? 1.0 : -1.0, 0.0);
  }
}

// Double tap: a second press of the same direction within the window.
function tryDoubleTap(index: i32, p: Player): void {
  const dir: i32 = tappedDir(index);
  if (dir == Dir.NONE) return;

  const quick: bool = dir == p.lastTapDir && vars.frame - p.lastTapFrame <= DOUBLE_TAP_WINDOW;
  if (quick && p.dashCooldown == 0) {
    if (dir == Dir.UP) dash(p, 0.0, -1.0);
    else if (dir == Dir.DOWN) dash(p, 0.0, 1.0);
    else if (dir == Dir.LEFT) dash(p, -1.0, 0.0);
    else dash(p, 1.0, 0.0);
    return;
  }
  p.lastTapDir = dir;
  p.lastTapFrame = vars.frame;
}

function movePlayer(index: i32, p: Player): void {
  if (p.dashCooldown > 0) p.dashCooldown--;
  if (p.dashFx > 0) p.dashFx--;

  if (p.falling == 0) {
    const ax: i32 = index == 0 ? p2AxisX() : p1AxisX();
    const ay: i32 = index == 0 ? p2AxisY() : p1AxisY();
    let accel: f32 = ACCEL;
    if (ax != 0 && ay != 0) accel *= DIAGONAL;
    p.vx += <f32>ax * accel;
    p.vy += <f32>ay * accel;
    // Fire key: Left Ctrl for the WASD player, Right Ctrl for the arrows player.
    const fire: Button = index == 0 ? Button.P2_FIRE : Button.P1_FIRE;
    if (buttonPressed(fire) && p.dashCooldown == 0) fireDash(index, p, ax, ay);
    else tryDoubleTap(index, p);
  }

  p.vx *= FRICTION;
  p.vy *= FRICTION;
  p.x += p.vx;
  p.y += p.vy;
}

// Equal-mass collision, slightly inelastic.
function collide(a: Player, b: Player): void {
  if (a.falling > 0 || b.falling > 0) return;
  const dx: f32 = b.x - a.x;
  const dy: f32 = b.y - a.y;
  const distSq: f32 = dx * dx + dy * dy;
  const minDist: f32 = DISC_RADIUS * 2.0;
  if (distSq >= minDist * minDist) return;

  let dist: f32 = Mathf.sqrt(distSq);
  let nx: f32 = 1.0;
  let ny: f32 = 0.0;
  if (dist > 0.0001) {
    nx = dx / dist;
    ny = dy / dist;
  } else {
    dist = 0.0;
  }

  // Push apart so they no longer overlap.
  const half: f32 = (minDist - dist) * 0.5;
  a.x -= nx * half;
  a.y -= ny * half;
  b.x += nx * half;
  b.y += ny * half;

  // Closing speed along the normal.
  const closing: f32 = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (closing <= 0.0) return;
  const j: f32 = ((1.0 + RESTITUTION) * closing) * 0.5;
  a.vx -= j * nx;
  a.vy -= j * ny;
  b.vx += j * nx;
  b.vy += j * ny;

  if (vars.bumpCooldown == 0) {
    playSfx("sumo_bump", Mathf.min(1.0, 0.25 + closing / 6.0));
    vars.bumpCooldown = 6;
  }
}

function checkRingOut(p: Player): void {
  if (p.falling > 0) {
    p.falling++;
    return;
  }
  const dx: f32 = p.x - ARENA_X;
  const dy: f32 = p.y - ARENA_Y;
  if (dx * dx + dy * dy > vars.radius * vars.radius) {
    p.falling = 1;
    playSfx("sumo_fall", 0.6);
  }
}

function endRound(): void {
  const p1 = player(0);
  const p2 = player(1);
  let result: RoundResult = RoundResult.DRAW;
  if (p1.falling > 0 && p2.falling == 0) result = RoundResult.P2;
  else if (p2.falling > 0 && p1.falling == 0) result = RoundResult.P1;

  if (result == RoundResult.P1) p1.score++;
  else if (result == RoundResult.P2) p2.score++;
  vars.roundWinner = result as u8;
  logi("Round {} result: {} (score {}-{})", vars.round, result, p1.score, p2.score);

  if (p1.score >= ROUNDS_TO_WIN || p2.score >= ROUNDS_TO_WIN) {
    vars.matchWinner = p1.score >= ROUNDS_TO_WIN ? 1 : 2;
    vars.state = GameState.MATCH_OVER as u8;
    stopMusic();
    playSfx("sumo_win", 0.7);
    logi("Player {} wins the match", vars.matchWinner);
    return;
  }
  vars.timer = ROUND_OVER_FRAMES;
  vars.state = GameState.ROUND_OVER as u8;
  if (result != RoundResult.DRAW) playSfx("sumo_point", 0.6);
}

function updatePlaying(): void {
  const p1 = player(0);
  const p2 = player(1);

  vars.playFrames++;
  if (vars.playFrames == SHRINK_DELAY) playSfx("sumo_shrink", 0.5);
  if (vars.playFrames > SHRINK_DELAY && vars.radius > ARENA_MIN_RADIUS) {
    vars.radius = Mathf.max(ARENA_MIN_RADIUS, vars.radius - SHRINK_SPEED);
  }
  if (vars.bumpCooldown > 0) vars.bumpCooldown--;

  movePlayer(0, p1);
  movePlayer(1, p2);
  collide(p1, p2);
  checkRingOut(p1);
  checkRingOut(p2);

  // Let the fall play out (the other disc may follow it off the edge).
  if (p1.falling >= FALL_FRAMES || p2.falling >= FALL_FRAMES) endRound();
}

// === Lifecycle ===
export function init(): void {
  vars.state = GameState.TITLE as u8;
  vars.frame = 0;
  vars.round = 0;
  vars.matchWinner = 0;
  player(0).score = 0;
  player(1).score = 0;
  resetPositions();
  log("Sumo Push ready");
}

export function update(): void {
  vars.frame++;
  const state = vars.state;

  if (state == GameState.TITLE || state == GameState.MATCH_OVER) {
    if (buttonPressed(Button.START)) startMatch();
    return;
  }

  if (state == GameState.COUNTDOWN) {
    vars.timer--;
    if (vars.timer == 0) {
      vars.state = GameState.PLAYING as u8;
      playSfx("sumo_go", 0.6);
    } else if (vars.timer % 60 == 0) {
      playSfx("sumo_count", 0.5);
    }
    return;
  }

  if (state == GameState.ROUND_OVER) {
    vars.timer--;
    if (vars.timer <= 0) startRound();
    return;
  }

  updatePlaying();
}

// === Drawing ===
function drawBackground(): void {
  clearFramebuffer(c(0x16121f));
  const dot = c(0x241d33);
  for (let y: i32 = 30; y < SCREEN_HEIGHT; y += 12) {
    const shift: i32 = (y / 12) % 2 == 0 ? 0 : 6;
    for (let x: i32 = shift; x < SCREEN_WIDTH; x += 12) {
      fillRect(x, y, 2, 2, dot);
    }
  }
}

function drawArena(): void {
  const cx: i32 = <i32>ARENA_X;
  const cy: i32 = <i32>ARENA_Y;
  const r: i32 = <i32>vars.radius;

  // Rope ring: blinks once the ring is shrinking.
  const shrinking: bool =
    vars.state == GameState.PLAYING && vars.playFrames > SHRINK_DELAY && vars.radius > ARENA_MIN_RADIUS;
  let rope: u32 = c(0xb83a2e);
  if (shrinking && (vars.frame / 10) % 2 == 0) rope = c(0xf0c040);

  fillCircle(cx + 3, cy + 5, r + 4, withAlpha(c(0x000000), 0x70)); // drop shadow
  fillCircle(cx, cy, r + 4, rope);
  fillCircle(cx, cy, r, c(0xd8b47a)); // clay
  drawCircle(cx, cy, r - 6, c(0xc49c62));

  // Starting lines.
  const lineColor = c(0xf4ecd8);
  const off: i32 = <i32>START_OFFSET;
  if (r > off + 4) {
    fillRect(cx - off + 14, cy - 8, 2, 16, lineColor);
    fillRect(cx + off - 16, cy - 8, 2, 16, lineColor);
  }
}

function drawPlayer(p: Player, main: u32, dark: u32, light: u32, label: string): void {
  let r: i32 = <i32>DISC_RADIUS;
  if (p.falling > 0) {
    const left: i32 = FALL_FRAMES - min<i32>(p.falling, FALL_FRAMES);
    r = (<i32>DISC_RADIUS * left) / FALL_FRAMES;
    if (r <= 0) return;
  }
  const x: i32 = <i32>Mathf.round(p.x);
  const y: i32 = <i32>Mathf.round(p.y);

  // Dash trail.
  if (p.dashFx > 0) {
    const alpha: u8 = <u8>(p.dashFx * 10);
    fillCircle(<i32>(p.x - p.vx * 4.0), <i32>(p.y - p.vy * 4.0), r - 2, withAlpha(c(main), alpha));
    fillCircle(<i32>(p.x - p.vx * 2.0), <i32>(p.y - p.vy * 2.0), r - 1, withAlpha(c(main), alpha * 2));
  }

  if (p.falling == 0) fillCircle(x + 2, y + 3, r, withAlpha(c(0x000000), 0x60));
  fillCircle(x, y, r, c(dark));
  fillCircle(x, y, r - 2, c(main));
  fillCircle(x - 3, y - 3, 3, c(light));
  if (p.falling == 0) print(x - 2, y - 3, label, c(0xffffff));

  // Dash ready: a thin halo.
  if (p.falling == 0 && p.dashCooldown == 0 && vars.state == GameState.PLAYING) {
    drawCircle(x, y, r + 2, withAlpha(c(0xffffff), 0x50));
  }
}

function drawScorePips(x: i32, score: i32, color: u32): void {
  for (let i: i32 = 0; i < ROUNDS_TO_WIN; i++) {
    const px: i32 = x + i * 12;
    if (i < score) fillCircle(px, 13, 4, c(color));
    else drawCircle(px, 13, 4, c(0x55506a));
  }
}

function drawDashBar(x: i32, p: Player, color: u32): void {
  const w: i32 = 36;
  fillRect(x, 21, w, 3, c(0x2c2640));
  const filled: i32 = ((DASH_COOLDOWN - p.dashCooldown) * w) / DASH_COOLDOWN;
  fillRect(x, 21, filled, 3, p.dashCooldown == 0 ? c(color) : c(0x6a6480));
}

function drawHud(): void {
  const p1 = player(0);
  const p2 = player(1);
  print(8, 9, "P1", c(P1_COLOR));
  drawScorePips(30, p1.score, P1_COLOR);
  drawDashBar(8, p1, P1_COLOR);

  print(SCREEN_WIDTH - 20, 9, "P2", c(P2_COLOR));
  drawScorePips(SCREEN_WIDTH - 54, p2.score, P2_COLOR);
  drawDashBar(SCREEN_WIDTH - 44, p2, P2_COLOR);

  if (vars.round > 0) {
    print(SCREEN_WIDTH / 2 - 21, 9, "ROUND", c(0xa098b8));
    printNumber(SCREEN_WIDTH / 2 + 15, 9, vars.round, c(0xa098b8));
  }
}

// color is 0xRRGGBB
function drawBanner(text: string, color: u32): void {
  const w: i32 = text.length * 6 + 24;
  const x: i32 = (SCREEN_WIDTH - w) / 2;
  fillRect(x, 54, w, 18, withAlpha(c(0x0e0b16), 0xd0));
  fillRect(x, 54, w, 1, c(color));
  fillRect(x, 71, w, 1, c(color));
  printCentered(59, text, c(color));
}

export function draw(): void {
  drawBackground();
  drawArena();
  drawPlayer(player(0), P1_COLOR, P1_DARK, P1_LIGHT, "1");
  drawPlayer(player(1), P2_COLOR, P2_DARK, P2_LIGHT, "2");
  drawHud();

  const state = vars.state;
  if (state == GameState.TITLE) {
    drawStartMessageBox("SUMO PUSH", c(0x1a1626), c(0xf0c040));
    const help = c(0xd8d0e8);
    fillRect(40, 176, 240, 46, withAlpha(c(0x0e0b16), 0xd0));
    printCentered(181, "P1: W A S D      P2: ARROWS", help);
    printCentered(193, "DASH: CTRL OR DOUBLE-TAP", help);
    printCentered(205, "PUSH THE OTHER OFF. FIRST TO 3!", help);
  } else if (state == GameState.COUNTDOWN) {
    const secs: i32 = (vars.timer + 59) / 60;
    if (secs == 3) drawBanner("3", 0xf0c040);
    else if (secs == 2) drawBanner("2", 0xf0c040);
    else drawBanner("1", 0xf0c040);
  } else if (state == GameState.PLAYING) {
    if (vars.playFrames < 30) drawBanner("PUSH!", 0xffffff);
    else if (vars.playFrames >= SHRINK_DELAY && vars.playFrames < SHRINK_DELAY + 60) {
      drawBanner("THE RING SHRINKS", 0xf0c040);
    }
  } else if (state == GameState.ROUND_OVER) {
    const w: u8 = vars.roundWinner;
    if (w == RoundResult.P1) drawBanner("PLAYER 1 TAKES THE ROUND", P1_COLOR);
    else if (w == RoundResult.P2) drawBanner("PLAYER 2 TAKES THE ROUND", P2_COLOR);
    else drawBanner("DOUBLE RING-OUT: NO POINT", 0xd8d0e8);
  } else if (state == GameState.MATCH_OVER) {
    if (vars.matchWinner == 1) drawStartMessageBox("PLAYER 1 WINS!", c(0x1a1626), c(P1_COLOR));
    else drawStartMessageBox("PLAYER 2 WINS!", c(0x1a1626), c(P2_COLOR));
  }
}
