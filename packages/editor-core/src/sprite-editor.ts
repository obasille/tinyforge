// The sprite editor's model: one sprite or sheet, split into frames, edited
// pixel by pixel. Plain TS: SpriteCanvas draws it and turns the pointer into
// strokes, and the React panel renders the tools from `state`.
//
// Edits stay in memory (with their own undo, one step per stroke or frame
// operation) until Save, which writes a PNG through the command stack, so
// Ctrl+Z outside the panel undoes the save like any file edit. Changing the
// number of frames renames the file (`id~4x1.png`); the sidecar follows.

import { assetKindOf } from '@tinyforge/engine/tooling/project-layout';
import { sidecarPath } from './asset-library.ts';
import type { FileCommand } from './commands.ts';
import { type FileOp, fileBatch } from './file-commands.ts';
import { decodePng, encodePng, type RgbaImage } from './png.ts';
import { type ProjectFiles, parseAssetName } from './project-files.ts';
import { createStore, type Store } from './store.ts';
import type { FileChange } from './workspace.ts';

/** A colour as 0xRRGGBBAA. */
export type Color = number;

export const TRANSPARENT: Color = 0;

export const rgbaOf = (c: Color): [number, number, number, number] => [
  (c >>> 24) & 255,
  (c >>> 16) & 255,
  (c >>> 8) & 255,
  c & 255,
];
export const colorOf = (r: number, g: number, b: number, a = 255): Color =>
  (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | (a & 255)) >>> 0;
/** `#rrggbb` (alpha left out). */
export const hexOf = (c: Color) => `#${(c >>> 8).toString(16).padStart(6, '0')}`;
export const cssOf = (c: Color) => {
  const [r, g, b, a] = rgbaOf(c);
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
};

/** The starting palette: a plain spread of hues and greys. */
export const DEFAULT_PALETTE: Color[] = [
  0x000000ff, 0x3a3a48ff, 0x7a7a8aff, 0xc8c8d0ff, 0xffffffff, 0x6b2a2aff, 0xd83a3aff, 0xff9a7aff, 0x8a5a1aff,
  0xf0a030ff, 0xffe070ff, 0x2a6a2aff, 0x50c050ff, 0xb0f090ff, 0x1a3a7aff, 0x3a7ad8ff, 0x80c8ffff, 0x5a2a8aff,
  0xa860e0ff, 0xf0a0e0ff,
];

export type SpriteTool = 'pencil' | 'eraser' | 'fill' | 'line' | 'rect' | 'picker';

export interface SpriteEditorState {
  /** The file being edited (changes when a save renames it). */
  path: string;
  ready: boolean;
  /** Why the file could not be read or saved. */
  error: string | null;
  frameWidth: number;
  frameHeight: number;
  cols: number;
  rows: number;
  frame: number;
  tool: SpriteTool;
  color: Color;
  /** Pixels per sprite pixel on screen. */
  zoom: number;
  onion: boolean;
  grid: boolean;
  playing: boolean;
  fps: number;
  /** The pixel under the pointer, in frame coordinates. */
  cursor: { x: number; y: number } | null;
  dirty: boolean;
  saving: boolean;
  /** The file changed or went away on disk while there are unsaved edits. */
  conflict: null | 'changed' | 'deleted';
  canUndo: boolean;
  canRedo: boolean;
  /** Colours in the sprite, most used first. */
  used: Color[];
  /** Bumped on every pixel change; the canvas redraws on it. */
  version: number;
}

interface Snapshot {
  frames: Uint8ClampedArray[];
  frameWidth: number;
  frameHeight: number;
  cols: number;
  rows: number;
  frame: number;
}

/** Decodes an image the PNG decoder does not read (a JPEG); the browser's decoder in the editor. */
export type ImageDecoder = (bytes: Uint8Array) => Promise<RgbaImage>;

export interface SpriteEditorHost {
  files: ProjectFiles;
  commands: { runFile(command: FileCommand): Promise<void> };
  decodeImage?: ImageDecoder;
}

const MAX_HISTORY = 200;
/** Largest frame side the editor creates (the sprite table stores u16 sizes). */
export const MAX_FRAME_SIDE = 1024;

/** Split a sheet into frames, row by row. */
export function splitFrames(image: RgbaImage, cols: number, rows: number): Uint8ClampedArray[] {
  const fw = Math.floor(image.width / cols);
  const fh = Math.floor(image.height / rows);
  const frames: Uint8ClampedArray[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const f = new Uint8ClampedArray(fw * fh * 4);
      for (let y = 0; y < fh; y++) {
        const src = ((r * fh + y) * image.width + c * fw) * 4;
        f.set(image.rgba.subarray(src, src + fw * 4), y * fw * 4);
      }
      frames.push(f);
    }
  }
  return frames;
}

/** Join frames into a sheet, row by row. */
export function joinFrames(
  frames: readonly Uint8ClampedArray[],
  fw: number,
  fh: number,
  cols: number,
  rows: number,
): RgbaImage {
  const width = fw * cols;
  const height = fh * rows;
  const rgba = new Uint8ClampedArray(width * height * 4);
  frames.forEach((f, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    for (let y = 0; y < fh; y++)
      rgba.set(f.subarray(y * fw * 4, (y + 1) * fw * 4), ((r * fh + y) * width + c * fw) * 4);
  });
  return { width, height, rgba };
}

/**
 * The sheet layout for `count` frames: a strip stays a strip (it grows in
 * its direction), a grid keeps its columns.
 */
export function layoutFor(count: number, cols: number, rows: number): { cols: number; rows: number } {
  if (rows === 1) return { cols: count, rows: 1 };
  if (cols === 1) return { cols: 1, rows: count };
  return { cols, rows: Math.max(1, Math.ceil(count / cols)) };
}

/** The file name for a sprite: its ID, the sheet format when it has frames, the old `-info`, and .png. */
export function spriteFileName(file: string, cols: number, rows: number): string {
  const name = file.replace(/\.[^/.]+$/, '');
  const { id } = parseAssetName(file);
  const rest = name.slice(id.length);
  const info = rest.startsWith('~') ? rest.slice(rest.indexOf('-') >= 0 ? rest.indexOf('-') : rest.length) : rest;
  const sheet = cols > 1 || rows > 1 ? `~${cols}x${rows}` : '';
  return `${id}${sheet}${info}.png`;
}

/** Flood fill (4 neighbours, exact colour match) from (x, y). Returns whether anything changed. */
export function floodFill(px: Uint8ClampedArray, w: number, h: number, x: number, y: number, color: Color): boolean {
  const [r, g, b, a] = rgbaOf(color);
  const at = (y * w + x) * 4;
  const target = [px[at], px[at + 1], px[at + 2], px[at + 3]];
  if (target[0] === r && target[1] === g && target[2] === b && target[3] === a) return false;
  const same = (o: number) =>
    px[o] === target[0] && px[o + 1] === target[1] && px[o + 2] === target[2] && px[o + 3] === target[3];
  const stack = [x, y];
  while (stack.length) {
    const cy = stack.pop() as number;
    const cx = stack.pop() as number;
    const o = (cy * w + cx) * 4;
    if (!same(o)) continue;
    px[o] = r;
    px[o + 1] = g;
    px[o + 2] = b;
    px[o + 3] = a;
    if (cx > 0) stack.push(cx - 1, cy);
    if (cx < w - 1) stack.push(cx + 1, cy);
    if (cy > 0) stack.push(cx, cy - 1);
    if (cy < h - 1) stack.push(cx, cy + 1);
  }
  return true;
}

/** The pixels of a line from (x0, y0) to (x1, y1), ends included. */
export function linePoints(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    points.push([x, y]);
    if (x === x1 && y === y1) return points;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** The outline of the rectangle with corners (x0, y0) and (x1, y1). */
export function rectPoints(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const [l, r] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [t, b] = y0 < y1 ? [y0, y1] : [y1, y0];
  const points: Array<[number, number]> = [];
  for (let x = l; x <= r; x++) points.push([x, t], [x, b]);
  for (let y = t + 1; y < b; y++) points.push([l, y], [r, y]);
  return points;
}

/** Colours in some pixels, most used first (fully transparent left out). */
export function usedColors(frames: readonly Uint8ClampedArray[], limit = 64): Color[] {
  const counts = new Map<Color, number>();
  for (const f of frames) {
    for (let i = 0; i < f.length; i += 4) {
      if (f[i + 3] === 0) continue;
      const c = colorOf(f[i], f[i + 1], f[i + 2], f[i + 3]);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([c]) => c);
}

export class SpriteEditor {
  readonly state: Store<SpriteEditorState>;
  /** One RGBA array per frame (frameWidth × frameHeight × 4). */
  frames: Uint8ClampedArray[] = [];
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  /** The bytes on disk, as last loaded or saved (to recognise our own writes). */
  private disk: Uint8Array | null = null;
  private stroke: { button: number; x: number; y: number; before: Snapshot; base: Uint8ClampedArray } | null = null;
  private stopWatch: () => void;
  private disposed = false;

  constructor(
    path: string,
    private readonly host: SpriteEditorHost,
  ) {
    this.state = createStore<SpriteEditorState>({
      path,
      ready: false,
      error: null,
      frameWidth: 0,
      frameHeight: 0,
      cols: 1,
      rows: 1,
      frame: 0,
      tool: 'pencil',
      color: 0xffffffff,
      zoom: 8,
      onion: false,
      grid: true,
      playing: false,
      fps: 8,
      cursor: null,
      dirty: false,
      saving: false,
      conflict: null,
      canUndo: false,
      canRedo: false,
      used: [],
      version: 0,
    });
    this.stopWatch = host.files.onChange((changes) => void this.filesChanged(changes));
  }

  get path(): string {
    return this.state.getState().path;
  }

  private update(patch: Partial<SpriteEditorState>): void {
    this.state.setState((s) => ({ ...s, ...patch }));
  }

  dispose(): void {
    this.disposed = true;
    this.stopWatch();
  }

  /** Read and decode the file. */
  async load(): Promise<void> {
    const bytes = await this.host.files.readBytes(this.path);
    if (this.disposed) return;
    if (!bytes) {
      this.update({ error: `${this.path} not found` });
      return;
    }
    try {
      this.setImage(await this.decode(bytes), bytes);
    } catch (e) {
      this.update({ error: `Cannot read ${this.path}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  private async decode(bytes: Uint8Array): Promise<RgbaImage> {
    const png = await decodePng(bytes);
    if (png) return png;
    if (!this.host.decodeImage) throw new Error('unsupported image format');
    return this.host.decodeImage(bytes);
  }

  private setImage(image: RgbaImage, bytes: Uint8Array): void {
    const name = this.path.slice(this.path.lastIndexOf('/') + 1);
    const format = name.includes('~') ? parseAssetName(name).format : '';
    const m = /^(\d+)x(\d+)$/.exec(format);
    let cols = m ? Number(m[1]) : 1;
    let rows = m ? Number(m[2]) : 1;
    if (cols < 1 || rows < 1 || image.width % cols !== 0 || image.height % rows !== 0) {
      cols = 1;
      rows = 1;
    }
    this.frames = splitFrames(image, cols, rows);
    this.disk = bytes;
    this.undoStack = [];
    this.redoStack = [];
    const s = this.state.getState();
    const frameWidth = image.width / cols;
    const frameHeight = image.height / rows;
    const fit = Math.max(1, Math.min(32, Math.floor(256 / Math.max(frameWidth, frameHeight))));
    this.update({
      ready: true,
      error: null,
      frameWidth,
      frameHeight,
      cols,
      rows,
      frame: Math.min(s.frame, cols * rows - 1),
      zoom: s.ready ? s.zoom : fit,
      dirty: false,
      conflict: null,
      canUndo: false,
      canRedo: false,
      used: usedColors(this.frames),
      version: s.version + 1,
    });
  }

  // --- Settings -----------------------------------------------------------

  setTool(tool: SpriteTool): void {
    this.update({ tool });
  }

  setColor(color: Color): void {
    this.update({ color: color >>> 0 });
  }

  setZoom(zoom: number): void {
    this.update({ zoom: Math.max(1, Math.min(64, Math.round(zoom))) });
  }

  toggle(key: 'onion' | 'grid' | 'playing'): void {
    this.update({ [key]: !this.state.getState()[key] } as Partial<SpriteEditorState>);
  }

  setFps(fps: number): void {
    this.update({ fps: Math.max(1, Math.min(60, Math.round(fps))) });
  }

  setFrame(frame: number): void {
    const count = this.frames.length;
    this.update({ frame: ((frame % count) + count) % count });
  }

  setCursor(cursor: { x: number; y: number } | null): void {
    const prev = this.state.getState().cursor;
    if (prev?.x === cursor?.x && prev?.y === cursor?.y) return;
    this.update({ cursor });
  }

  // --- History ------------------------------------------------------------

  private snapshot(): Snapshot {
    const s = this.state.getState();
    return {
      frames: this.frames.map((f) => f.slice()),
      frameWidth: s.frameWidth,
      frameHeight: s.frameHeight,
      cols: s.cols,
      rows: s.rows,
      frame: s.frame,
    };
  }

  private restore(snap: Snapshot): void {
    this.frames = snap.frames.map((f) => f.slice());
    const { frames: _, ...layout } = snap;
    this.changed(layout);
  }

  /** Record an edit: `before` goes on the undo stack. */
  private commit(before: Snapshot, patch: Partial<SpriteEditorState> = {}): void {
    this.undoStack.push(before);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.changed(patch);
  }

  private changed(patch: Partial<SpriteEditorState> = {}): void {
    const s = this.state.getState();
    this.update({
      ...patch,
      dirty: true,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      used: usedColors(this.frames),
      version: s.version + 1,
    });
  }

  undo(): boolean {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    this.redoStack.push(this.snapshot());
    this.restore(snap);
    return true;
  }

  redo(): boolean {
    const snap = this.redoStack.pop();
    if (!snap) return false;
    this.undoStack.push(this.snapshot());
    this.restore(snap);
    return true;
  }

  // --- Drawing ------------------------------------------------------------

  private inside(x: number, y: number): boolean {
    const { frameWidth, frameHeight } = this.state.getState();
    return x >= 0 && y >= 0 && x < frameWidth && y < frameHeight;
  }

  private put(px: Uint8ClampedArray, x: number, y: number, color: Color): void {
    if (!this.inside(x, y)) return;
    const o = (y * this.state.getState().frameWidth + x) * 4;
    const [r, g, b, a] = rgbaOf(color);
    px[o] = r;
    px[o + 1] = g;
    px[o + 2] = b;
    px[o + 3] = a;
  }

  /** The colour at a pixel of the current frame. */
  colorAt(x: number, y: number): Color {
    if (!this.inside(x, y)) return TRANSPARENT;
    const s = this.state.getState();
    const f = this.frames[s.frame];
    const o = (y * s.frameWidth + x) * 4;
    return colorOf(f[o], f[o + 1], f[o + 2], f[o + 3]);
  }

  /**
   * Start a stroke at a pixel of the current frame. Button 2 (right) paints
   * transparent; Alt (or the picker) picks the colour instead.
   */
  pointerDown(x: number, y: number, button = 0, alt = false): void {
    const s = this.state.getState();
    if (!s.ready) return;
    if (alt || s.tool === 'picker') {
      if (this.inside(x, y)) this.setColor(this.colorAt(x, y));
      return;
    }
    const color = button === 2 || s.tool === 'eraser' ? TRANSPARENT : s.color;
    const frame = this.frames[s.frame];
    if (s.tool === 'fill') {
      if (!this.inside(x, y)) return;
      const before = this.snapshot();
      if (floodFill(frame, s.frameWidth, s.frameHeight, x, y, color)) this.commit(before);
      return;
    }
    this.stroke = { button, x, y, before: this.snapshot(), base: frame.slice() };
    this.put(frame, x, y, color);
    this.bump();
  }

  pointerMove(x: number, y: number): void {
    this.setCursor(this.inside(x, y) ? { x, y } : null);
    const stroke = this.stroke;
    if (!stroke) return;
    const s = this.state.getState();
    const frame = this.frames[s.frame];
    const color = stroke.button === 2 || s.tool === 'eraser' ? TRANSPARENT : s.color;
    if (s.tool === 'line' || s.tool === 'rect') {
      // A shape is drawn again from the frame as it was, so it follows the pointer.
      frame.set(stroke.base);
      const points = s.tool === 'line' ? linePoints(stroke.x, stroke.y, x, y) : rectPoints(stroke.x, stroke.y, x, y);
      for (const [px, py] of points) this.put(frame, px, py, color);
    } else {
      const last = stroke as typeof stroke & { lx?: number; ly?: number };
      for (const [px, py] of linePoints(last.lx ?? stroke.x, last.ly ?? stroke.y, x, y)) this.put(frame, px, py, color);
      last.lx = x;
      last.ly = y;
    }
    this.bump();
  }

  pointerUp(): void {
    const stroke = this.stroke;
    if (!stroke) return;
    this.stroke = null;
    const frame = this.frames[this.state.getState().frame];
    if (frame.every((v, i) => v === stroke.base[i])) return;
    this.commit(stroke.before);
  }

  /** Redraw while a stroke is in progress (no history entry yet). */
  private bump(): void {
    this.update({ version: this.state.getState().version + 1 });
  }

  // --- Frames -------------------------------------------------------------

  private relayout(before: Snapshot, frames: Uint8ClampedArray[], frame: number): void {
    const s = this.state.getState();
    const { cols, rows } = layoutFor(frames.length, s.cols, s.rows);
    const blank = () => new Uint8ClampedArray(s.frameWidth * s.frameHeight * 4);
    while (frames.length < cols * rows) frames.push(blank());
    this.frames = frames;
    this.commit(before, { cols, rows, frame: Math.max(0, Math.min(frame, frames.length - 1)) });
  }

  /** Add an empty frame after the current one. */
  addFrame(): void {
    const s = this.state.getState();
    if (this.frames.length >= 255) return;
    const before = this.snapshot();
    const frames = [...this.frames];
    frames.splice(s.frame + 1, 0, new Uint8ClampedArray(s.frameWidth * s.frameHeight * 4));
    this.relayout(before, frames, s.frame + 1);
  }

  /** Copy the current frame after itself. */
  duplicateFrame(): void {
    const s = this.state.getState();
    if (this.frames.length >= 255) return;
    const before = this.snapshot();
    const frames = [...this.frames];
    frames.splice(s.frame + 1, 0, this.frames[s.frame].slice());
    this.relayout(before, frames, s.frame + 1);
  }

  deleteFrame(): void {
    const s = this.state.getState();
    if (this.frames.length <= 1) return;
    const before = this.snapshot();
    const frames = this.frames.filter((_, i) => i !== s.frame);
    // A grid keeps its columns: drop a last row left empty.
    if (s.rows > 1 && s.cols > 1) {
      while (frames.length > s.cols && frames.length % s.cols !== 0) frames.pop();
    }
    this.relayout(before, frames, s.frame);
  }

  /** Move the current frame one place left (-1) or right (+1). */
  moveFrame(step: -1 | 1): void {
    const s = this.state.getState();
    const to = s.frame + step;
    if (to < 0 || to >= this.frames.length) return;
    const before = this.snapshot();
    const frames = [...this.frames];
    [frames[s.frame], frames[to]] = [frames[to], frames[s.frame]];
    this.frames = frames;
    this.commit(before, { frame: to });
  }

  /** Clear the current frame. */
  clearFrame(): void {
    const s = this.state.getState();
    if (this.frames[s.frame].every((v) => v === 0)) return;
    const before = this.snapshot();
    this.frames[s.frame] = new Uint8ClampedArray(s.frameWidth * s.frameHeight * 4);
    this.commit(before);
  }

  /** Mirror the current frame left to right or top to bottom. */
  flipFrame(axis: 'x' | 'y'): void {
    const s = this.state.getState();
    const before = this.snapshot();
    const src = this.frames[s.frame];
    const out = new Uint8ClampedArray(src.length);
    const w = s.frameWidth;
    const h = s.frameHeight;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const from = ((axis === 'y' ? h - 1 - y : y) * w + (axis === 'x' ? w - 1 - x : x)) * 4;
        out.set(src.subarray(from, from + 4), (y * w + x) * 4);
      }
    }
    this.frames[s.frame] = out;
    this.commit(before);
  }

  /** Change the frame size; pixels keep their place from the top left. */
  resize(width: number, height: number): void {
    const s = this.state.getState();
    const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_FRAME_SIDE;
    if (!valid(width) || !valid(height)) throw new Error(`A frame is 1 to ${MAX_FRAME_SIDE} pixels wide and high`);
    if (width === s.frameWidth && height === s.frameHeight) return;
    const before = this.snapshot();
    this.frames = this.frames.map((f) => {
      const out = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < Math.min(height, s.frameHeight); y++) {
        const row = Math.min(width, s.frameWidth) * 4;
        out.set(f.subarray(y * s.frameWidth * 4, y * s.frameWidth * 4 + row), y * width * 4);
      }
      return out;
    });
    const fit = Math.max(1, Math.min(32, Math.floor(256 / Math.max(width, height))));
    this.commit(before, { frameWidth: width, frameHeight: height, zoom: Math.min(s.zoom, fit) });
  }

  /** The whole sheet as one image. */
  sheet(): RgbaImage {
    const s = this.state.getState();
    return joinFrames(this.frames, s.frameWidth, s.frameHeight, s.cols, s.rows);
  }

  // --- Files --------------------------------------------------------------

  /** Write the sprite as a PNG (one undoable file command); a new layout or a JPEG renames the file. */
  async save(): Promise<void> {
    const s = this.state.getState();
    if (!s.ready || s.saving) return;
    this.update({ saving: true, error: null });
    try {
      const bytes = await encodePng(this.sheet());
      const dir = this.path.slice(0, this.path.lastIndexOf('/') + 1);
      const target = dir + spriteFileName(this.path.slice(dir.length), s.cols, s.rows);
      const ops: FileOp[] = [{ write: target, data: bytes }];
      if (target !== this.path) {
        if (this.host.files.entry(target)) throw new Error(`${target} already exists`);
        const side = await this.host.files.readBytes(sidecarPath(this.path));
        ops.push({ delete: this.path });
        if (side) ops.push({ delete: sidecarPath(this.path) }, { write: sidecarPath(target), data: side });
      }
      const name = target.slice(dir.length);
      this.disk = bytes;
      await this.host.commands.runFile(await fileBatch(this.host.files, ops, `Edit ${name}`, 'sprites.save'));
      this.update({ path: target, dirty: false, conflict: null, saving: false });
    } catch (e) {
      this.update({ saving: false, error: `Save failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  /** Conflict: drop the edits and load the file on disk. */
  reloadFromDisk(): Promise<void> {
    return this.load();
  }

  /** Conflict: keep the edits; the next save overwrites the file. */
  keepMine(): void {
    this.update({ conflict: null });
  }

  private async filesChanged(changes: FileChange[]): Promise<void> {
    const mine = changes.find((c) => c.path === this.path);
    if (!mine || this.disposed) return;
    const s = this.state.getState();
    if (mine.kind === 'unlink') {
      // Our own save to a new name, or a delete (by undo, or another program).
      if (s.saving || this.host.files.entry(this.path)) return;
      this.update({ conflict: 'deleted', dirty: true });
      return;
    }
    const bytes = await this.host.files.readBytes(this.path);
    if (!bytes || this.disposed) return;
    if (this.disk && bytes.length === this.disk.length && bytes.every((b, i) => b === this.disk?.[i])) return;
    if (!this.state.getState().dirty) {
      try {
        this.setImage(await this.decode(bytes), bytes);
      } catch (e) {
        this.update({ error: `Cannot read ${this.path}: ${e instanceof Error ? e.message : String(e)}` });
      }
      return;
    }
    this.update({ conflict: 'changed' });
  }
}

/** A blank sprite (or sheet) as one file command: `assets/sprites/<id>[~Nx1].png`. */
export async function newSpriteCommand(
  files: ProjectFiles,
  id: string,
  frameWidth: number,
  frameHeight: number,
  frames = 1,
): Promise<{ path: string; command: FileCommand }> {
  const valid = (n: number, max: number) => Number.isInteger(n) && n >= 1 && n <= max;
  if (!valid(frameWidth, MAX_FRAME_SIDE) || !valid(frameHeight, MAX_FRAME_SIDE)) {
    throw new Error(`A frame is 1 to ${MAX_FRAME_SIDE} pixels wide and high`);
  }
  if (!valid(frames, 255)) throw new Error('A sheet has 1 to 255 frames');
  const path = `assets/sprites/${spriteFileName(`${id}.png`, frames, 1)}`;
  if (!assetKindOf(path)) throw new Error(`Invalid sprite name ${path}`);
  const image = {
    width: frameWidth * frames,
    height: frameHeight,
    rgba: new Uint8ClampedArray(frameWidth * frames * frameHeight * 4),
  };
  const command = await fileBatch(
    files,
    [{ write: path, data: await encodePng(image) }],
    `New sprite ${id}`,
    'sprites.new',
  );
  return { path, command };
}
