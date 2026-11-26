// Which layout the editor uses: the desktop one (Dockview as it always was)
// or the touch one (three columns, a play mode with on-screen controls).
// Automatic follows the screen; the menu can force either, per device.

import { createStore, type Store } from '@tinyforge/editor-core';

export type LayoutMode = 'auto' | 'touch' | 'desktop';

const MODE_KEY = 'tinyforge.editor.layoutMode';

/** True on a touch screen (a coarse pointer: phones, tablets). */
export const hasTouchScreen = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Whether a mode means the touch layout on this device. */
export const usesTouchLayout = (mode: LayoutMode): boolean => mode === 'touch' || (mode === 'auto' && hasTouchScreen());

function loadMode(): LayoutMode {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    return saved === 'touch' || saved === 'desktop' ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

/** The mode, loaded from and saved to localStorage. */
export function createLayoutMode(): Store<LayoutMode> {
  const store = createStore<LayoutMode>(loadMode());
  store.subscribe(() => {
    try {
      const mode = store.getState();
      if (mode === 'auto') localStorage.removeItem(MODE_KEY);
      else localStorage.setItem(MODE_KEY, mode);
    } catch {
      // The choice still applies for this session.
    }
  });
  return store;
}
