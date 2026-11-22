// The sprite editor's drawing surface: the current frame zoomed on a
// checkerboard, with the pixel grid, an onion skin of the previous frame,
// and the pointer turned into strokes. Plain TS on a 2D canvas; it redraws
// when the editor's state changes, never through React.

import type { RgbaImage } from './png.ts';
import type { SpriteEditor } from './sprite-editor.ts';

/** Decode an image with the browser (for a JPEG, or a PNG the plain decoder does not read). */
export async function browserDecodeImage(bytes: Uint8Array): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context to decode the image');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width: canvas.width, height: canvas.height, rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
}

const CHECK_A = '#2b2b36';
const CHECK_B = '#353542';

/** Draw one frame's pixels into a canvas of the frame's size. */
export function paintFrame(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
): void {
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx || w === 0 || h === 0) return;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
}

export class SpriteCanvas {
  private readonly canvas: HTMLCanvasElement;
  private readonly frameCanvas = document.createElement('canvas');
  private readonly onionCanvas = document.createElement('canvas');
  private readonly unsubscribe: () => void;
  private readonly resize: ResizeObserver;
  private origin = { x: 0, y: 0 };
  private drawing = false;
  private queued = false;

  constructor(
    private readonly parent: HTMLElement,
    private readonly editor: SpriteEditor,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tf-sprite-canvas';
    this.canvas.dataset.testid = 'sprite-canvas';
    parent.append(this.canvas);
    this.unsubscribe = editor.state.subscribe(() => this.schedule());
    this.resize = new ResizeObserver(() => this.schedule());
    this.resize.observe(parent);
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    this.canvas.addEventListener('pointerleave', this.onLeave);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.draw();
  }

  dispose(): void {
    this.unsubscribe();
    this.resize.disconnect();
    this.canvas.remove();
  }

  /** The frame pixel under a client position. */
  pixelAt(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const { zoom } = this.editor.state.getState();
    return {
      x: Math.floor((clientX - rect.left - this.origin.x) / zoom),
      y: Math.floor((clientY - rect.top - this.origin.y) / zoom),
    };
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.drawing = true;
    const { x, y } = this.pixelAt(e.clientX, e.clientY);
    this.editor.pointerDown(x, y, e.button, e.altKey);
  };

  private onMove = (e: PointerEvent) => {
    const { x, y } = this.pixelAt(e.clientX, e.clientY);
    this.editor.pointerMove(x, y);
  };

  private onUp = (e: PointerEvent) => {
    if (!this.drawing) return;
    this.drawing = false;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.editor.pointerUp();
  };

  private onLeave = () => {
    if (!this.drawing) this.editor.setCursor(null);
  };

  private onContextMenu = (e: Event) => e.preventDefault();

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const { zoom } = this.editor.state.getState();
    this.editor.setZoom(
      e.deltaY < 0 ? zoom + Math.max(1, Math.floor(zoom / 4)) : zoom - Math.max(1, Math.floor(zoom / 4)),
    );
  };

  private schedule(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.draw();
    });
  }

  private draw(): void {
    const s = this.editor.state.getState();
    const dpr = window.devicePixelRatio || 1;
    const cw = this.parent.clientWidth;
    const ch = this.parent.clientHeight;
    if (this.canvas.width !== Math.round(cw * dpr) || this.canvas.height !== Math.round(ch * dpr)) {
      this.canvas.width = Math.round(cw * dpr);
      this.canvas.height = Math.round(ch * dpr);
      this.canvas.style.width = `${cw}px`;
      this.canvas.style.height = `${ch}px`;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!s.ready) return;
    const { frameWidth: w, frameHeight: h, zoom } = s;
    const width = w * zoom;
    const height = h * zoom;
    this.origin = { x: Math.round((cw - width) / 2), y: Math.round((ch - height) / 2) };
    const { x: ox, y: oy } = this.origin;

    // Checkerboard: one square per pixel when zoomed in, else 8 screen pixels.
    const cell = Math.max(zoom, 8);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, width, height);
    ctx.clip();
    for (let y = 0; y < height; y += cell) {
      for (let x = 0; x < width; x += cell) {
        ctx.fillStyle = ((x + y) / cell) % 2 === 0 ? CHECK_A : CHECK_B;
        ctx.fillRect(ox + x, oy + y, cell, cell);
      }
    }
    ctx.restore();

    ctx.imageSmoothingEnabled = false;
    if (s.onion && this.editor.frames.length > 1) {
      const prev = (s.frame - 1 + this.editor.frames.length) % this.editor.frames.length;
      paintFrame(this.onionCanvas, this.editor.frames[prev], w, h);
      ctx.globalAlpha = 0.3;
      ctx.drawImage(this.onionCanvas, ox, oy, width, height);
      ctx.globalAlpha = 1;
    }
    const frame = this.editor.frames[s.frame];
    if (frame) {
      paintFrame(this.frameCanvas, frame, w, h);
      ctx.drawImage(this.frameCanvas, ox, oy, width, height);
    }

    if (s.grid && zoom >= 6) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < w; x++) {
        ctx.moveTo(ox + x * zoom + 0.5, oy);
        ctx.lineTo(ox + x * zoom + 0.5, oy + height);
      }
      for (let y = 1; y < h; y++) {
        ctx.moveTo(ox, oy + y * zoom + 0.5);
        ctx.lineTo(ox + width, oy + y * zoom + 0.5);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(108, 182, 255, 0.6)';
    ctx.strokeRect(ox - 0.5, oy - 0.5, width + 1, height + 1);
    if (s.cursor) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.strokeRect(ox + s.cursor.x * zoom + 0.5, oy + s.cursor.y * zoom + 0.5, zoom - 1, zoom - 1);
    }
  }
}

/**
 * The animation preview: the frames in order at the editor's fps while
 * `playing`, else the current frame. Plain TS with its own timer.
 */
export class FramePreview {
  private readonly frameCanvas = document.createElement('canvas');
  private readonly unsubscribe: () => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private shown = 0;
  private fps = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly editor: SpriteEditor,
    private readonly box = 64,
  ) {
    this.unsubscribe = editor.state.subscribe(() => this.sync());
    this.sync();
  }

  dispose(): void {
    this.unsubscribe();
    if (this.timer) clearInterval(this.timer);
  }

  private sync(): void {
    const s = this.editor.state.getState();
    const want = s.playing && this.editor.frames.length > 1 ? s.fps : 0;
    if (want !== this.fps) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.fps = want;
      if (want) {
        this.timer = setInterval(() => {
          this.shown = (this.shown + 1) % this.editor.frames.length;
          this.draw();
        }, 1000 / want);
      }
    }
    if (!this.fps) this.shown = s.frame;
    this.draw();
  }

  private draw(): void {
    const s = this.editor.state.getState();
    const frame = this.editor.frames[this.shown % Math.max(1, this.editor.frames.length)];
    if (!s.ready || !frame) return;
    const zoom = Math.max(1, Math.floor(this.box / Math.max(s.frameWidth, s.frameHeight)));
    const w = s.frameWidth * zoom;
    const h = s.frameHeight * zoom;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    paintFrame(this.frameCanvas, frame, s.frameWidth, s.frameHeight);
    ctx.drawImage(this.frameCanvas, 0, 0, w, h);
  }
}
