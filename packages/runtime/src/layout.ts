// Memory layouts by version. A cartridge records the layout version it was
// built for (tinyforge.meta `layout`); the host reads every address from the
// matching entry, never from memory-map.ts directly, so cartridges built for
// an older layout keep working after a new one is added. Entries are never
// removed.

import * as v1 from '@tinyforge/engine/memory-map';

export interface MemoryLayout {
  version: number;
  fbStart: number;
  fbSize: number;
  inputButtonsAddr: number;
  inputButtonsPrevAddr: number;
  mouseXAddr: number;
  mouseYAddr: number;
  mouseButtonsAddr: number;
  mouseButtonsPrevAddr: number;
  spriteTablePtrAddr: number;
  rngSeedAddr: number;
  systemStart: number;
  systemEnd: number;
  ramStart: number;
}

export const LAYOUTS: Readonly<Record<number, MemoryLayout>> = {
  1: {
    version: 1,
    fbStart: v1.FB_START,
    fbSize: v1.FB_SIZE,
    inputButtonsAddr: v1.INPUT_BUTTONS_ADDR,
    inputButtonsPrevAddr: v1.INPUT_BUTTONS_PREV_ADDR,
    mouseXAddr: v1.MOUSE_X_ADDR,
    mouseYAddr: v1.MOUSE_Y_ADDR,
    mouseButtonsAddr: v1.MOUSE_BUTTONS_ADDR,
    mouseButtonsPrevAddr: v1.MOUSE_BUTTONS_PREV_ADDR,
    spriteTablePtrAddr: v1.SPRITE_TABLE_PTR_ADDR,
    rngSeedAddr: v1.SDK_RNG_SEED_ADDR,
    systemStart: v1.SYSTEM_START,
    systemEnd: v1.SYSTEM_END,
    ramStart: v1.RAM_START,
  },
};

/** The newest layout this host knows. */
export const CURRENT_LAYOUT: MemoryLayout = LAYOUTS[v1.LAYOUT_VERSION];

/** The layout a cartridge was built for; throws a readable error otherwise. */
export function layoutFor(version: number): MemoryLayout {
  const layout = LAYOUTS[version];
  if (layout) return layout;
  throw new Error(
    version > CURRENT_LAYOUT.version
      ? `Cartridge uses memory layout ${version}, newer than this host (${CURRENT_LAYOUT.version}): update TinyForge`
      : `Unknown memory layout ${version}`,
  );
}

export const PAGE_SIZE = 65536;

/** Bytes rounded up to whole 64 KB pages. */
export function pagesFor(bytes: number): number {
  return Math.ceil(bytes / PAGE_SIZE);
}
