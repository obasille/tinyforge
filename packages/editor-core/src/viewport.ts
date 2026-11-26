// The game view: owns the <canvas> element(s) inside a container, sizes them
// at integer scale, and turns keyboard and pointer events into game input.
// Plain DOM code; the React panel only hands it a container.

import { SCREEN_HEIGHT, SCREEN_WIDTH } from '@tinyforge/engine/memory-map';
import { TRIGGERS } from '@tinyforge/runtime';
import { type InputTracker, toGamePixel } from './input.ts';

export class Viewport {
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly cleanup: Array<() => void> = [];
  /** Scale by any factor (touch screens), not only whole numbers. */
  private fractional = false;

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
    // Losing focus releases the keyboard only: on a touch screen, pressing an
    // on-screen control outside the view blurs it while the finger still holds.
    on('blur', () => this.input.clearKeys());
    // A hidden page gets no key or pointer releases: release everything.
    const onHidden = () => {
      if (document.visibilityState === 'hidden') this.input.clear();
    };
    const onPageHide = () => this.input.clear();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    this.cleanup.push(() => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
    });

    // The triggers are the Ctrl keys, and a player who holds one while
    // pressing W would hit Ctrl+W, which closes the tab and cannot be
    // cancelled by preventDefault. While a trigger is held, ask before the
    // page unloads instead. Ctrl+key presses that are not game keys still
    // reach the browser and the editor.
    const guard = (e: BeforeUnloadEvent) => {
      if ((this.input.current.buttons & TRIGGERS) === 0) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    this.cleanup.push(() => window.removeEventListener('beforeunload', guard));
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
    // A touch the browser takes over (a scroll, a system gesture) ends
    // without a pointerup: release its button and leave the screen.
    on('pointercancel', (e) => {
      this.input.mouseButton(e.button === -1 ? 0 : e.button, false);
      this.input.pointer(-1, -1);
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

  /** Allow fractional scales (touch screens), so the game fills the space. */
  setFractional(on: boolean): void {
    this.fractional = on;
    this.fit();
  }

  focus(): void {
    this.container?.focus();
  }

  private pointer(e: PointerEvent): void {
    if (!this.canvas) return;
    const { x, y } = toGamePixel(e.clientX, e.clientY, this.canvas.getBoundingClientRect());
    this.input.pointer(x, y);
  }

  /** Largest integer scale that fits (any scale when fractional); fractional below 1×. */
  private fit(): void {
    if (!this.container || !this.canvas) return;
    const { clientWidth: w, clientHeight: h } = this.container;
    const fit = Math.min(w / SCREEN_WIDTH, h / SCREEN_HEIGHT);
    const scale = fit >= 1 && !this.fractional ? Math.floor(fit) : Math.max(fit, 0.25);
    this.canvas.style.width = `${SCREEN_WIDTH * scale}px`;
    this.canvas.style.height = `${SCREEN_HEIGHT * scale}px`;
  }
}
