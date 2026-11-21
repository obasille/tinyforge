import { describe, expect, it } from 'vitest';
import { memoryRegions, regionAt } from '../src/memory-regions.ts';
import { formatRows } from '../src/memory-view.ts';

describe('formatRows', () => {
  it('prints address, hex and ASCII per 16-byte row', () => {
    const bytes = new Uint8Array(16).map((_, i) => 0x41 + i);
    expect(formatRows(bytes, 0x6e020)).toBe(
      '<span class="addr">06E020</span>  41 42 43 44 45 46 47 48 49 4A 4B 4C 4D 4E 4F 50  ABCDEFGHIJKLMNOP',
    );
  });

  it('highlights bytes that changed since the previous frame', () => {
    const prev = new Uint8Array([1, 2]);
    const next = new Uint8Array([1, 3]);
    expect(formatRows(next, 0, prev)).toContain('01 <b>03</b>');
  });

  it('escapes HTML in the ASCII column', () => {
    expect(formatRows(new Uint8Array([0x3c]), 0)).toContain('&lt;');
  });
});

describe('memory regions', () => {
  it('names the region of an address in the layout before a game loads', () => {
    const regions = memoryRegions(null);
    expect(regionAt(regions, 0)?.name).toBe('Framebuffer');
    expect(regionAt(regions, 0x4b000)?.name).toBe('System');
    expect(regionAt(regions, 0x50000)?.name).toBe('Game RAM');
  });

  it("follows the game's RAM size, static data and sprite table", () => {
    const regions = memoryRegions({
      size: 0x80000,
      layout: 1,
      fbStart: 0,
      fbSize: 0x4b000,
      systemStart: 0x4b000,
      systemEnd: 0x50000,
      ramStart: 0x50000,
      ram: 0x2000,
      hostDataAddr: 0x60000,
      spriteTableBytes: 0x1000,
    });
    expect(regionAt(regions, 0x51fff)?.name).toBe('Game RAM');
    expect(regionAt(regions, 0x52000)?.name).toBe('Static data / heap');
    expect(regionAt(regions, 0x60000)?.name).toBe('Sprite table');
    expect(regionAt(regions, 0x61000)).toBeNull();
  });
});
