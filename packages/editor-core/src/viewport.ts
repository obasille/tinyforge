// The game view: owns the <canvas> element(s) inside a container, sizes them
// at integer scale, and turns keyboard and pointer events into game input.
// Plain DOM code; the React panel only hands it a container.

import { SCREEN_HEIGHT, SCREEN_WIDTH } from '@tinyforge/engine/memory-map';
import { type InputTracker, toGamePixel } from './input.ts';

export class Viewport {
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly cleanup: Array<() => void> = [];

  constructor(
    private readonly input: InputTracker,
    private readonly onUserGesture: () => void = () => {},
  ) {}

  /**
   * A new canvas for a new game Worker. The previous one (already transferred
   * to a Worker that is gone) is replaced in the DOM.
   */
  createCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = SCREEN_WIDTH;
    canvas.height = SCREEN_HEIGHT;
    canvas.className = 'tf-screen';
    canvas.dataset.testid = 'game-canvas';
    this.canvas?.replaceWith(canvas);
    this.canvas = canvas;
    if (this.container && !canvas.isConnected) this.container.append(canvas);
    this.fit();
    return canvas;
  }

  /** Show the view inside `container` (called by the panel on mount). */
  attach(container: HTMLElement): void {
    this.detach();
    this.container = container;
    container.tabIndex = 0;
    container.classList.add('tf-viewport');
    if (this.canvas) container.append(this.canvas);

    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      container.addEventListener(type, fn);
      this.cleanup.push(() => container.removeEventListener(type, fn));
    };
    on('keydown', (e) => {
      if (this.input.key(e.code, true)) e.preventDefault();
      this.onUserGesture();
    });
    on('keyup', (e) => {
      if (this.input.key(e.code, false)) e.preventDefault();
    });
    on('blur', () => this.input.clear());
    on('pointermove', (e) => this.pointer(e));
    on('pointerleave', () => this.input.pointer(-1, -1));
    on('pointerdown', (e) => {
      container.focus();
      this.pointer(e);
      this.input.mouseButton(e.button, true);
      this.onUserGesture();
      e.preventDefault();
    });
    on('pointerup', (e) => {
      this.pointer(e);
      this.input.mouseButton(e.button, false);
    });
    on('contextmenu', (e) => e.preventDefault());

    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(container);
    this.fit();
  }

  detach(): void {
    for (const fn of this.cleanup.splice(0)) fn();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.canvas?.remove();
    this.container = null;
  }

  focus(): void {
    this.container?.focus();
  }

  private pointer(e: PointerEvent): void {
    if (!this.canvas) return;
    const { x, y } = toGamePixel(e.clientX, e.clientY, this.canvas.getBoundingClientRect());
    this.input.pointer(x, y);
  }

  /** Largest integer scale that fits; fractional only below 1×. */
  private fit(): void {
    if (!this.container || !this.canvas) return;
    const { clientWidth: w, clientHeight: h } = this.container;
    const fit = Math.min(w / SCREEN_WIDTH, h / SCREEN_HEIGHT);
    const scale = fit >= 1 ? Math.floor(fit) : Math.max(fit, 0.25);
    this.canvas.style.width = `${SCREEN_WIDTH * scale}px`;
    this.canvas.style.height = `${SCREEN_HEIGHT * scale}px`;
  }
}
