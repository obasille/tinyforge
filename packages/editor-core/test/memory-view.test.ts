import { describe, expect, it } from 'vitest';
import { regionAt } from '../src/memory-regions.ts';
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

describe('regionAt', () => {
  it('names the region of an address', () => {
    expect(regionAt(0)?.name).toBe('Framebuffer');
    expect(regionAt(0x90000)?.name).toBe('Static data / heap');
  });
});
