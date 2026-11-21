// Named regions of a game's memory, for the memory viewer. Memory is sized per
// game, so the regions come from what the game Worker reports.

import * as map from '@tinyforge/engine/memory-map';
import type { GameMemory } from './protocol.ts';

export interface MemoryRegion {
  name: string;
  start: number;
  size: number;
}

/** The regions of the given game's memory (the layout alone before a game loads). */
export function memoryRegions(memory: GameMemory | null): MemoryRegion[] {
  const fb = { start: memory?.fbStart ?? map.FB_START, size: memory?.fbSize ?? map.FB_SIZE };
  const systemStart = memory?.systemStart ?? map.SYSTEM_START;
  const systemEnd = memory?.systemEnd ?? map.SYSTEM_END;
  const ramStart = memory?.ramStart ?? map.RAM_START;
  const ram = memory?.ram ?? map.DEFAULT_RAM_SIZE;
  const regions: MemoryRegion[] = [
    { name: 'Framebuffer', start: fb.start, size: fb.size },
    { name: 'System', start: systemStart, size: systemEnd - systemStart },
    { name: 'Game RAM', start: ramStart, size: ram },
  ];
  if (memory) {
    regions.push(
      { name: 'Static data / heap', start: ramStart + ram, size: memory.hostDataAddr - (ramStart + ram) },
      { name: 'Sprite table', start: memory.hostDataAddr, size: memory.spriteTableBytes },
    );
  }
  return regions;
}

export function regionAt(regions: readonly MemoryRegion[], address: number): MemoryRegion | null {
  return regions.find((r) => address >= r.start && address < r.start + r.size) ?? null;
}
