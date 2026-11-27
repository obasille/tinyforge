import { Button } from '@tinyforge/runtime';
import { describe, expect, it } from 'vitest';
import { InputTracker, toGamePixel } from '../src/input.ts';

describe('toGamePixel', () => {
  it('maps an exact 2× view', () => {
    expect(toGamePixel(10, 20, { left: 0, top: 0, width: 640, height: 480 })).toEqual({ x: 5, y: 10 });
  });

  it('accounts for pillarboxing', () => {
    // 800×480 box: picture is 640×480, centered with 80 px bars.
    const rect = { left: 0, top: 0, width: 800, height: 480 };
    expect(toGamePixel(40, 100, rect)).toEqual({ x: -1, y: -1 });
    expect(toGamePixel(80, 0, rect)).toEqual({ x: 0, y: 0 });
    expect(toGamePixel(719, 479, rect)).toEqual({ x: 319, y: 239 });
  });
});

describe('InputTracker', () => {
  it('reports game keys and ignores others', () => {
    const seen: number[] = [];
    const tracker = new InputTracker((s) => seen.push(s.buttons));
    expect(tracker.key('ArrowLeft', true)).toBe(true);
    expect(tracker.key('KeyQ', true)).toBe(false);
    tracker.key('KeyZ', true);
    tracker.key('ArrowLeft', false);
    expect(seen).toEqual([Button.left, Button.left | Button.a, Button.a]);
  });

  it('maps WASD to the four action buttons', () => {
    const tracker = new InputTracker(() => {});
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) tracker.key(code, true);
    expect(tracker.current.buttons).toBe(Button.y | Button.x | Button.a | Button.b);
  });

  it('maps Left and Right Ctrl to the LT and RT triggers', () => {
    const tracker = new InputTracker(() => {});
    expect(tracker.key('ControlLeft', true)).toBe(true);
    expect(tracker.current.buttons).toBe(Button.lt);
    tracker.key('ControlRight', true);
    expect(tracker.current.buttons).toBe(Button.lt | Button.rt);
    tracker.key('ControlLeft', false);
    expect(tracker.current.buttons).toBe(Button.rt);
  });

  it('keeps a button held while another key for it is still down', () => {
    const tracker = new InputTracker(() => {});
    tracker.key('KeyS', true);
    tracker.key('KeyZ', true);
    tracker.key('KeyZ', false);
    expect(tracker.current.buttons).toBe(Button.a);
    tracker.key('KeyS', false);
    expect(tracker.current.buttons).toBe(0);
  });

  it('does not report repeats', () => {
    let calls = 0;
    const tracker = new InputTracker(() => calls++);
    tracker.key('Space', true);
    tracker.key('Space', true); // key repeat
    expect(calls).toBe(1);
  });

  it('maps the right mouse button to bit 1', () => {
    const tracker = new InputTracker(() => {});
    tracker.mouseButton(2, true);
    expect(tracker.current.mouseButtons).toBe(0b10);
  });
});

describe('InputTracker with on-screen controls', () => {
  it('keeps a button held by touch when the same key is released', () => {
    const tracker = new InputTracker(() => {});
    tracker.key('KeyS', true);
    tracker.touch('p1', Button.a);
    tracker.key('KeyS', false);
    expect(tracker.current.buttons).toBe(Button.a);
    tracker.touch('p1', 0);
    expect(tracker.current.buttons).toBe(0);
  });

  it('combines several fingers and releases them one at a time', () => {
    const tracker = new InputTracker(() => {});
    tracker.touch('p1', Button.left | Button.up);
    tracker.touch('p2', Button.b);
    expect(tracker.current.buttons).toBe(Button.left | Button.up | Button.b);
    tracker.touch('p1', Button.right);
    expect(tracker.current.buttons).toBe(Button.right | Button.b);
    tracker.touch('p2', 0);
    expect(tracker.current.buttons).toBe(Button.right);
  });

  it('clears the keyboard and touch apart, and both at once', () => {
    const tracker = new InputTracker(() => {});
    tracker.key('ArrowUp', true);
    tracker.touch('p1', Button.a);
    tracker.clearKeys();
    expect(tracker.current.buttons).toBe(Button.a);
    tracker.key('ArrowUp', true);
    tracker.clearTouch();
    expect(tracker.current.buttons).toBe(Button.up);
    tracker.touch('p1', Button.a);
    tracker.clear();
    expect(tracker.current.buttons).toBe(0);
  });
});
