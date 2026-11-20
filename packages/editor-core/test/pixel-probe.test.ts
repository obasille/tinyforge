import { FB_START } from '@tinyforge/engine/memory-map';
import { describe, expect, it } from 'vitest';
import type { WatchFn } from '../src/memory-view.ts';
import { type PixelInfo, PixelProbe, pixelAbgr, pixelHex } from '../src/pixel-probe.ts';

function fakeWatch() {
  const active = new Map<number, (bytes: Uint8Array, offset: number) => void>();
  const watch: WatchFn = (offset, _length, listener) => {
    active.set(offset, listener);
    return () => active.delete(offset);
  };
  const push = (offset: number, bytes: number[]) => active.get(offset)?.(new Uint8Array(bytes), offset);
  return { watch, active, push };
}

describe('PixelProbe', () => {
  it('watches the 4 bytes of the hovered pixel and reports its color', () => {
    const w = fakeWatch();
    const seen: Array<PixelInfo | null> = [];
    const probe = new PixelProbe(w.watch, (p) => seen.push(p));
    probe.setPosition(2, 1);
    const offset = FB_START + (1 * 320 + 2) * 4;
    expect([...w.active.keys()]).toEqual([offset]);
    w.push(offset, [0x12, 0x34, 0x56, 0xff]);
    expect(seen).toEqual([{ x: 2, y: 1, r: 0x12, g: 0x34, b: 0x56, a: 0xff }]);
  });

  it('reports only changes', () => {
    const w = fakeWatch();
    let calls = 0;
    const probe = new PixelProbe(w.watch, () => calls++);
    probe.setPosition(0, 0);
    w.push(FB_START, [1, 2, 3, 255]);
    w.push(FB_START, [1, 2, 3, 255]);
    expect(calls).toBe(1);
  });

  it('stops watching and reports null off screen', () => {
    const w = fakeWatch();
    const seen: Array<PixelInfo | null> = [];
    const probe = new PixelProbe(w.watch, (p) => seen.push(p));
    probe.setPosition(0, 0);
    w.push(FB_START, [1, 2, 3, 255]);
    probe.setPosition(-1, -1);
    expect(w.active.size).toBe(0);
    expect(seen.at(-1)).toBeNull();
  });

  it('formats like the classic host', () => {
    const p = { x: 0, y: 0, r: 0x12, g: 0x34, b: 0x56, a: 0xff };
    expect(pixelAbgr(p)).toBe('0xFF563412');
    expect(pixelHex(p)).toBe('#123456');
  });
});
