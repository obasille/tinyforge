import { describe, expect, it } from 'vitest';
import { interpolate, readString } from '../src/strings.ts';

function asString(text: string, at = 64): ArrayBuffer {
  const buffer = new ArrayBuffer(256);
  const view = new DataView(buffer);
  view.setUint32(at - 4, text.length * 2, true);
  for (let i = 0; i < text.length; i++) view.setUint16(at + i * 2, text.charCodeAt(i), true);
  return buffer;
}

describe('readString', () => {
  it('decodes a UTF-16 AssemblyScript string', () => {
    expect(readString(asString('Hé, TinyForge!'), 64)).toBe('Hé, TinyForge!');
  });

  it('returns an empty string for a null pointer', () => {
    expect(readString(new ArrayBuffer(16), 0)).toBe('');
  });

  it('does not read past the end of memory', () => {
    const buffer = new ArrayBuffer(16);
    new DataView(buffer).setUint32(4, 1000, true);
    expect(readString(buffer, 8)).toMatch(/bad string ptr/);
  });
});

describe('interpolate', () => {
  it('fills placeholders in order and skips missing params', () => {
    expect(interpolate('x={} y={}', [3, 4n, undefined, undefined])).toBe('x=3 y=4');
  });
});
