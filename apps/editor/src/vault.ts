// The key vault of hosted mode (the deployed editor). Loaded with the AI
// panel only, so the rest of the editor and pnpm dev never touch it.
//
// The keys leave memory when the vault locks: after 15 minutes without
// activity, when the page is hidden for good (pagehide), or with Lock.

import { KeyVault } from '@tinyforge/editor-core';

export const vault = new KeyVault();

addEventListener('pagehide', () => vault.lock());
// Any input counts as activity. touch() does nothing while locked.
for (const type of ['pointerdown', 'keydown'] as const) {
  addEventListener(type, () => vault.touch(), { capture: true, passive: true });
}
