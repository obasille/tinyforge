import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useEditor } from './EditorContext.ts';
import { usesTouchLayout } from './layout-mode.ts';
import type { PanelApi } from './panels/panel-api.ts';

interface Subscribable<T> {
  getState(): T;
  subscribe(listener: () => void): () => void;
}

/** Read a plain-TS store from React. */
export function useStore<T>(store: Subscribable<T>): T {
  return useSyncExternalStore(store.subscribe, store.getState);
}

/** True in the touch layout, where keyboard shortcuts are not shown. */
export function useTouchLayout(): boolean {
  return usesTouchLayout(useStore(useEditor().layoutMode));
}

/**
 * Ctrl+S (Cmd+S) runs `save` while this is the active panel, wherever the
 * keyboard focus is inside it (canvas, buttons, text fields). Keys already
 * handled elsewhere, such as by the code editor, are left alone.
 */
export function useSaveShortcut(api: PanelApi, save: () => void): void {
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 's') return;
      if (!api.isActive) return;
      e.preventDefault();
      saveRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api]);
}
