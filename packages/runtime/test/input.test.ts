import { INPUT_BUTTONS_ADDR, INPUT_BUTTONS_PREV_ADDR } from '@tinyforge/engine/memory-map';
import { describe, expect, it } from 'vitest';
import { Button, NO_INPUT, writeInput } from '../src/input.ts';

describe('writeInput', () => {
  it('writes the buttons as little-endian u16 so the X and Y bits survive', () => {
    const buffer = new ArrayBuffer(INPUT_BUTTONS_PREV_ADDR + 16);
    writeInput(buffer, { ...NO_INPUT, buttons: Button.y | Button.a }, { ...NO_INPUT, buttons: Button.x });
    const view = new DataView(buffer);
    expect(view.getUint16(INPUT_BUTTONS_ADDR, true)).toBe(Button.y | Button.a);
    expect(view.getUint16(INPUT_BUTTONS_PREV_ADDR, true)).toBe(Button.x);
  });

  it('keeps the trigger bits (9 and 10)', () => {
    const buffer = new ArrayBuffer(INPUT_BUTTONS_PREV_ADDR + 16);
    writeInput(buffer, { ...NO_INPUT, buttons: Button.lt | Button.rt }, NO_INPUT);
    expect(new DataView(buffer).getUint16(INPUT_BUTTONS_ADDR, true)).toBe(0b110_0000_0000);
  });
});
