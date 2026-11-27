// On-screen game controls for touch screens: two columns, the left trigger
// over the D-pad on the left, the right trigger over the A/B/X/Y diamond and
// Start on the right. Plain DOM code, like the viewport; the React side only
// hands it a container. Each finger is tracked by its pointer id and feeds
// the InputTracker's touch source, so keyboard and touch never release each
// other's buttons.

import { Button } from '@tinyforge/runtime';
import type { InputTracker } from './input.ts';

/** Fraction of the pad's half-size where a touch means no direction. */
const DEAD_ZONE = 0.25;

/**
 * Buttons for a touch at (x, y) inside a D-pad of size w × h: up to two
 * directions (diagonals), none near the centre. Sliding a finger changes it.
 */
export function dpadBits(x: number, y: number, w: number, h: number): number {
  const dx = (x - w / 2) / (w / 2);
  const dy = (y - h / 2) / (h / 2);
  if (Math.hypot(dx, dy) < DEAD_ZONE) return 0;
  // Eight sectors of 45°: a direction counts when the touch is within
  // 67.5° of it, so the diagonals combine two directions.
  const angle = Math.atan2(dy, dx);
  const near = (target: number) =>
    Math.abs(Math.atan2(Math.sin(angle - target), Math.cos(angle - target))) < (3 * Math.PI) / 8;
  let bits = 0;
  if (near(0)) bits |= Button.right;
  if (near(Math.PI / 2)) bits |= Button.down;
  if (near(Math.PI)) bits |= Button.left;
  if (near(-Math.PI / 2)) bits |= Button.up;
  return bits;
}

/** The face button nearest to (x, y) in a diamond of size w × h: Y top, X left, B right, A bottom. */
export function faceBit(x: number, y: number, w: number, h: number): number {
  const dx = (x - w / 2) / (w / 2);
  const dy = (y - h / 2) / (h / 2);
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? Button.x : Button.b;
  return dy < 0 ? Button.y : Button.a;
}

const el = (tag: string, className: string, text = ''): HTMLElement => {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
};

/** The button of a vertical column of `bits` (top to bottom) at height y of h. */
export function columnBit(bits: readonly number[], y: number, h: number): number {
  const i = Math.floor((y / h) * bits.length);
  return bits[Math.max(0, Math.min(bits.length - 1, i))] ?? 0;
}

export interface VirtualControlsOptions {
  /**
   * landscape: two columns over the sides of the game (LT, D-pad, Pause and
   * Restart on the left; RT, the A/B/X/Y diamond and Start on the right).
   * portrait: one narrow column on each side of the game (the D-pad, then
   * Y/X/B/A) and a row above it (LT, Pause, Restart, Start, RT).
   */
  layout: 'landscape' | 'portrait';
  onPause(): void;
  onRestart(): void;
  /** Label of the pause button (Pause or Resume). */
  paused?: boolean;
}

export interface VirtualControls {
  /** Show whether the game is paused on the pause button. */
  setPaused(paused: boolean): void;
  /** Remove the controls and release every button they hold. */
  dispose(): void;
}

/**
 * Show the controls inside `container`, as direct children with the classes
 * tf-vc-* (the page's CSS places them). Each finger is tracked by its pointer
 * id; a finger can slide from one button to the next within a group.
 */
export function mountVirtualControls(
  container: HTMLElement,
  input: InputTracker,
  options: VirtualControlsOptions,
): VirtualControls {
  const added: HTMLElement[] = [];
  const add = (node: HTMLElement) => {
    added.push(node);
    container.append(node);
    return node;
  };

  /** Elements that light up, by the bit they stand for. */
  const lights: Array<[number, HTMLElement]> = [];
  const light = (bit: number, node: HTMLElement) => {
    node.dataset.bit = String(bit);
    lights.push([bit, node]);
    return node;
  };

  /** What each finger holds. */
  const fingers = new Map<number, number>();
  const refresh = () => {
    let held = 0;
    for (const bits of fingers.values()) held |= bits;
    for (const [bit, node] of lights) node.toggleAttribute('data-pressed', (held & bit) !== 0);
  };
  const set = (pointerId: number, bits: number) => {
    if (bits) fingers.set(pointerId, bits);
    else fingers.delete(pointerId);
    input.touch(`vc${pointerId}`, bits);
    refresh();
  };

  /** A control: `bitsAt` maps a position in it to the buttons held. */
  const control = (node: HTMLElement, bitsAt: (x: number, y: number, w: number, h: number) => number) => {
    const at = (e: PointerEvent) => {
      const r = node.getBoundingClientRect();
      return bitsAt(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    };
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // Keep receiving this finger's moves and release even outside the control.
      try {
        node.setPointerCapture?.(e.pointerId);
      } catch {
        // A pointer the browser no longer tracks: hold until it lifts anyway.
      }
      set(e.pointerId, at(e));
    });
    node.addEventListener('pointermove', (e) => {
      if (fingers.has(e.pointerId)) set(e.pointerId, at(e));
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      node.addEventListener(type, (e) => set(e.pointerId, 0));
    }
    node.addEventListener('contextmenu', (e) => e.preventDefault());
    return node;
  };

  const button = (bit: number, className: string, label: string) =>
    control(light(bit, el('div', `tf-vc-btn ${className}`, label)), () => bit);

  /** Pause and Restart: actions for the editor, not game buttons. */
  const action = (className: string, label: string, testId: string, run: () => void) => {
    const node = el('button', `tf-vc-btn tf-vc-action ${className}`, label);
    node.setAttribute('type', 'button');
    node.dataset.testid = testId;
    node.addEventListener('click', run);
    return node;
  };
  const pause = action('tf-vc-pause', '', 'play-pause', options.onPause);
  const restart = action('tf-vc-restart', '↻', 'play-restart', options.onRestart);
  restart.title = 'Restart';
  const setPaused = (paused: boolean) => {
    pause.textContent = paused ? '▶' : '❚❚';
    pause.title = paused ? 'Resume' : 'Pause';
  };
  setPaused(options.paused ?? false);

  const lt = button(Button.lt, 'tf-vc-trigger', 'LT');
  const rt = button(Button.rt, 'tf-vc-trigger', 'RT');
  const start = button(Button.start, 'tf-vc-start', 'START');

  const pad = (className: string, keys: ReadonlyArray<readonly [string, number, string]>) => {
    const node = el('div', `tf-vc-pad ${className}`);
    for (const [cls, bit, label] of keys) node.append(light(bit, el('div', `tf-vc-btn tf-vc-${cls}`, label)));
    return node;
  };
  const dpadKeys = [
    ['up', Button.up, '▲'],
    ['left', Button.left, '◀'],
    ['right', Button.right, '▶'],
    ['down', Button.down, '▼'],
  ] as const;
  const faceKeys = [
    ['up tf-vc-round', Button.y, 'Y'],
    ['left tf-vc-round', Button.x, 'X'],
    ['right tf-vc-round', Button.b, 'B'],
    ['down tf-vc-round', Button.a, 'A'],
  ] as const;

  const root = el('div', `tf-vc tf-vc-${options.layout}`);
  root.dataset.testid = 'virtual-controls';
  if (options.layout === 'landscape') {
    const left = el('div', 'tf-vc-col tf-vc-col-left');
    const right = el('div', 'tf-vc-col tf-vc-col-right');
    const actions = el('div', 'tf-vc-actions');
    actions.append(pause, restart);
    left.append(lt, control(pad('tf-vc-dpad', dpadKeys), dpadBits), actions);
    right.append(rt, control(pad('tf-vc-face', faceKeys), faceBit), start);
    root.append(left, right);
    add(root);
  } else {
    const top = el('div', 'tf-vc-top');
    const middle = el('div', 'tf-vc-top-middle');
    middle.append(pause, restart, start);
    top.append(lt, middle, rt);
    const column = (className: string, keys: ReadonlyArray<readonly [string, number, string]>) => {
      const node = el('div', `tf-vc-column ${className}`);
      for (const [, bit, label] of keys) node.append(light(bit, el('div', 'tf-vc-btn', label)));
      const bits = keys.map(([, bit]) => bit);
      return control(node, (_x, y, _w, h) => columnBit(bits, y, h));
    };
    root.append(
      top,
      column('tf-vc-column-left', dpadKeys),
      column('tf-vc-column-right', [
        [' tf-vc-round', Button.y, 'Y'],
        [' tf-vc-round', Button.x, 'X'],
        [' tf-vc-round', Button.b, 'B'],
        [' tf-vc-round', Button.a, 'A'],
      ]),
    );
    add(root);
  }
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    setPaused,
    dispose() {
      for (const node of added) node.remove();
      fingers.clear();
      input.clearTouch();
    },
  };
}
