// Named regions of the memory map, for the memory viewer.

import * as map from '@tinyforge/engine/memory-map';
import { MEMORY_BYTES } from '@tinyforge/runtime';

export interface MemoryRegion {
  name: string;
  start: number;
  size: number;
}

export const MEMORY_REGIONS: readonly MemoryRegion[] = [
  { name: 'Framebuffer', start: map.FB_START, size: map.FB_SIZE },
  { name: 'Input', start: map.INPUT_ADDR, size: 16 },
  { name: 'Sprite table', start: map.SPRITE_TABLE_ADDR, size: map.SPRITE_DATA_ADDR - map.SPRITE_TABLE_ADDR },
  { name: 'Sprite data', start: map.SPRITE_DATA_ADDR, size: map.SPRITE_DATA_SIZE },
  { name: 'SDK (RNG seed)', start: map.SDK_RNG_SEED_ADDR, size: map.SDK_RNG_SEED_SIZE },
  { name: 'Game RAM', start: map.RAM_START, size: map.RAM_SIZE },
  { name: 'Static data / heap', start: 0x80000, size: MEMORY_BYTES - 0x80000 },
];

export function regionAt(address: number): MemoryRegion | null {
  return MEMORY_REGIONS.find((r) => address >= r.start && address < r.start + r.size) ?? null;
}
