// Status line under the game: coordinates and color of the pixel under the
// mouse. Updated straight in the DOM, since it can change every frame.

import type { Store } from '@tinyforge/editor-core';
import { type PixelInfo, pixelAbgr, pixelHex } from '@tinyforge/editor-core';

export function mountPixelReadout(
  el: HTMLElement,
  pixel: Store<PixelInfo | null>,
  copied: Store<string | null>,
): () => void {
  el.innerHTML =
    '<span class="tf-swatch" aria-hidden="true"></span><span class="tf-pixel-text" data-testid="pixel-color"></span>' +
    '<span class="tf-pixel-copied" role="status" data-testid="pixel-copied"></span>';
  const [swatch, text, flash] = Array.from(el.children) as HTMLElement[];
  const render = () => {
    const p = pixel.getState();
    if (!p) {
      swatch.style.background = 'transparent';
      text.textContent = 'Hover the game to read a pixel color';
      return;
    }
    swatch.style.background = `rgba(${p.r}, ${p.g}, ${p.b}, ${p.a / 255})`;
    text.textContent = `${p.x}, ${p.y}   ${pixelHex(p)}   ${pixelAbgr(p)}   (F4 copies)`;
  };
  const renderCopied = () => {
    const hex = copied.getState();
    flash.textContent = hex ? `Copied ${hex}` : '';
  };
  render();
  renderCopied();
  const offPixel = pixel.subscribe(render);
  const offCopied = copied.subscribe(renderCopied);
  return () => {
    offPixel();
    offCopied();
  };
}
