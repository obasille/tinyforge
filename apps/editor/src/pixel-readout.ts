// Status line under the game: coordinates and color of the pixel under the
// mouse. Updated straight in the DOM, since it can change every frame.

import type { Store } from '@tinyforge/editor-core';
import { type PixelInfo, pixelAbgr, pixelHex } from '@tinyforge/editor-core';

export function mountPixelReadout(el: HTMLElement, pixel: Store<PixelInfo | null>): () => void {
  el.innerHTML =
    '<span class="tf-swatch" aria-hidden="true"></span><span class="tf-pixel-text" data-testid="pixel-color"></span>';
  const swatch = el.firstElementChild as HTMLElement;
  const text = el.lastElementChild as HTMLElement;
  const render = () => {
    const p = pixel.getState();
    if (!p) {
      swatch.style.background = 'transparent';
      text.textContent = 'Hover the game to read a pixel color';
      return;
    }
    swatch.style.background = `rgba(${p.r}, ${p.g}, ${p.b}, ${p.a / 255})`;
    text.textContent = `${p.x}, ${p.y}   ${pixelHex(p)}   ${pixelAbgr(p)}   (C copies)`;
  };
  render();
  return pixel.subscribe(render);
}
