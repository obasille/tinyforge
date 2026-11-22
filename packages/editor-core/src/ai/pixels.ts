// Sprites from a text grid, so the agent can draw by writing characters:
//
//   { "palette": { "k": "#000000", "y": "#ffd000" },
//     "frames": [["..kk..", ".kyyk.", "..kk.."]] }
//
// One character per pixel, "." is transparent. Frames go side by side in a
// strip, the sheet layout the library already reads (`<id>~<n>x1.png`).

import type { RgbaImage } from '../png.ts';
import { joinFrames } from '../sprite-editor.ts';

export interface PixelSpec {
  /** Character to colour: "#rgb", "#rrggbb" or "#rrggbbaa". */
  palette: Record<string, string>;
  /** Each frame is its rows, top to bottom; every frame has the same size. */
  frames: string[][];
}

export const MAX_PIXEL_SIDE = 64;
export const MAX_PIXEL_FRAMES = 16;

function parseColor(hex: unknown, char: string): [number, number, number, number] {
  const m = typeof hex === 'string' ? /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex) : null;
  if (!m) throw new Error(`palette["${char}"] must be a colour like "#ff8800"`);
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (h.length === 6) h += 'ff';
  return [0, 2, 4, 6].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number, number];
}

/** Draw the grid. Throws with a readable message when it is invalid. */
export function renderPixels(spec: PixelSpec): RgbaImage & { frames: number } {
  if (!spec || typeof spec.palette !== 'object' || spec.palette === null) throw new Error('palette: an object');
  const colors = new Map<string, [number, number, number, number]>([['.', [0, 0, 0, 0]]]);
  for (const [char, hex] of Object.entries(spec.palette)) {
    if ([...char].length !== 1 || char === '.') throw new Error(`palette keys are single characters other than "."`);
    colors.set(char, parseColor(hex, char));
  }
  const frames = spec.frames;
  if (!Array.isArray(frames) || frames.length === 0) throw new Error('frames: at least one frame');
  if (frames.length > MAX_PIXEL_FRAMES) throw new Error(`At most ${MAX_PIXEL_FRAMES} frames`);
  const h = Array.isArray(frames[0]) ? frames[0].length : 0;
  const w = typeof frames[0]?.[0] === 'string' ? [...frames[0][0]].length : 0;
  if (w < 1 || h < 1 || w > MAX_PIXEL_SIDE || h > MAX_PIXEL_SIDE) {
    throw new Error(`A frame is 1 to ${MAX_PIXEL_SIDE} pixels on each side`);
  }
  const pixels = frames.map((rows, f) => {
    if (!Array.isArray(rows) || rows.length !== h) throw new Error(`frames[${f}] must have ${h} rows, like frame 0`);
    const out = new Uint8ClampedArray(w * h * 4);
    rows.forEach((row, y) => {
      const chars = typeof row === 'string' ? [...row] : [];
      if (chars.length !== w) throw new Error(`frames[${f}][${y}] must have ${w} characters`);
      chars.forEach((c, x) => {
        const color = colors.get(c);
        if (!color) throw new Error(`frames[${f}][${y}]: "${c}" is not in the palette`);
        out.set(color, (y * w + x) * 4);
      });
    });
    return out;
  });
  return { ...joinFrames(pixels, w, h, pixels.length, 1), frames: pixels.length };
}
