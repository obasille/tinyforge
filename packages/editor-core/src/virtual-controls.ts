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

/** Show the controls inside `container`. Returns a function that removes them and releases every button they hold. */
export function mountVirtualControls(container: HTMLElement, input: InputTracker): () => void {
  const root = el('div', 'tf-vc');
  root.dataset.testid = 'virtual-controls';
  const left = el('div', 'tf-vc-col tf-vc-col-left');
  const right = el('div', 'tf-vc-col tf-vc-col-right');
  root.append(left, right);

  /** Elements that light up, by the bit they stand for. */
  const lights: Array<[number, HTMLElement]> = [];
  const light = (bit: number, node: HTMLElement) => {
    node.dataset.bit = String(bit);
    lights.push([bit, node]);
    return node;
  };

  const trigger = (bit: number, label: string) => light(bit, el('div', 'tf-vc-btn tf-vc-trigger', label));
  const lt = trigger(Button.lt, 'LT');
  const rt = trigger(Button.rt, 'RT');

  const dpad = el('div', 'tf-vc-pad tf-vc-dpad');
  for (const [cls, bit, label] of [
    ['up', Button.up, '▲'],
    ['left', Button.left, '◀'],
    ['right', Button.right, '▶'],
    ['down', Button.down, '▼'],
  ] as const) {
    dpad.append(light(bit, el('div', `tf-vc-btn tf-vc-${cls}`, label)));
  }

  const face = el('div', 'tf-vc-pad tf-vc-face');
  for (const [cls, bit, label] of [
    ['up', Button.y, 'Y'],
    ['left', Button.x, 'X'],
    ['right', Button.b, 'B'],
    ['down', Button.a, 'A'],
  ] as const) {
    face.append(light(bit, el('div', `tf-vc-btn tf-vc-round tf-vc-${cls}`, label)));
  }

  const start = light(Button.start, el('div', 'tf-vc-btn tf-vc-start', 'START'));
  // An empty slot under the D-pad keeps the two columns aligned.
  left.append(lt, dpad, el('div', 'tf-vc-spacer'));
  right.append(rt, face, start);

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
      if (fingers.has(e.pointerId) || node.hasPointerCapture?.(e.pointerId)) set(e.pointerId, at(e));
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      node.addEventListener(type, (e) => set(e.pointerId, 0));
    }
  };
  control(lt, () => Button.lt);
  control(rt, () => Button.rt);
  control(start, () => Button.start);
  control(dpad, dpadBits);
  control(face, faceBit);
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  container.append(root);
  return () => {
    root.remove();
    fingers.clear();
    input.clearTouch();
  };
}
