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
