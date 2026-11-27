import { Button } from '@tinyforge/runtime';
import { describe, expect, it } from 'vitest';
import { columnBit, dpadBits, faceBit } from '../src/virtual-controls.ts';

describe('dpadBits', () => {
  const at = (x: number, y: number) => dpadBits(x, y, 100, 100);
  it('reads the four directions', () => {
    expect(at(50, 5)).toBe(Button.up);
    expect(at(50, 95)).toBe(Button.down);
    expect(at(5, 50)).toBe(Button.left);
    expect(at(95, 50)).toBe(Button.right);
  });
  it('combines two directions on a diagonal', () => {
    expect(at(95, 5)).toBe(Button.up | Button.right);
    expect(at(5, 95)).toBe(Button.down | Button.left);
  });
  it('holds nothing near the centre', () => {
    expect(at(52, 48)).toBe(0);
  });
});

describe('faceBit', () => {
  const at = (x: number, y: number) => faceBit(x, y, 100, 100);
  it('picks the nearest button of the diamond', () => {
    expect(at(50, 10)).toBe(Button.y);
    expect(at(10, 50)).toBe(Button.x);
    expect(at(90, 50)).toBe(Button.b);
    expect(at(50, 90)).toBe(Button.a);
  });
});

describe('columnBit', () => {
  it('splits a column into equal parts, top to bottom', () => {
    const bits = [Button.up, Button.left, Button.right, Button.down];
    expect(columnBit(bits, 5, 200)).toBe(Button.up);
    expect(columnBit(bits, 60, 200)).toBe(Button.left);
    expect(columnBit(bits, 110, 200)).toBe(Button.right);
    expect(columnBit(bits, 199, 200)).toBe(Button.down);
    expect(columnBit(bits, 250, 200)).toBe(Button.down);
  });
});
