// The panels of the touch layout, without Dockview: a row of tabs and one
// panel at a time (TouchPanels.tsx). Files open in the Editor tab, which has
// a switcher for the open files. Plain data in a store, saved to
// localStorage so the tab and the open files survive a reload.

import { createStore, type Store } from '@tinyforge/editor-core';
import { assetKindOf } from '@tinyforge/engine/tooling/project-layout';

/** The panel kind that edits a file: the sprite editor, the sound player, or code. */
export type FileKind = 'code' | 'sprite' | 'sound';

export function panelKind(path: string): FileKind {
  const kind = assetKindOf(path);
  return kind === 'sprites' ? 'sprite' : kind ? 'sound' : 'code';
}

export type TouchTab = 'files' | 'library' | 'editor' | 'console' | 'run' | 'memory' | 'ai';

export interface OpenFile {
  /** Stays the same when a save renames the file. */
  id: string;
  path: string;
  kind: FileKind;
  title: string;
}

export interface TouchPanelsState {
  tab: TouchTab;
  files: OpenFile[];
  /** The file shown in the Editor tab. */
  active: string | null;
  /** The AI tab is shown once asked for (menu), until closed. */
  ai: boolean;
}

const KEY = 'tinyforge.editor.touchPanels';
const TABS: readonly TouchTab[] = ['files', 'library', 'editor', 'console', 'run', 'memory', 'ai'];
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

const INITIAL: TouchPanelsState = { tab: 'files', files: [], active: null, ai: false };

function load(): TouchPanelsState {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<TouchPanelsState> | null;
    if (!saved) return INITIAL;
    const files = Array.isArray(saved.files)
      ? saved.files
          .filter((f): f is OpenFile => typeof f?.id === 'string' && typeof f.path === 'string')
          .map((f) => ({ id: f.id, path: f.path, kind: panelKind(f.path), title: baseName(f.path) }))
      : [];
    const active = files.find((f) => f.id === saved.active)?.id ?? files[0]?.id ?? null;
    const ai = saved.ai === true;
    let tab = TABS.includes(saved.tab as TouchTab) ? (saved.tab as TouchTab) : 'files';
    if ((tab === 'editor' && !active) || (tab === 'ai' && !ai)) tab = 'files';
    return { tab, files, active, ai };
  } catch {
    return INITIAL;
  }
}

export interface TouchPanels extends Store<TouchPanelsState> {
  show(tab: TouchTab): void;
  /** Show a file in the Editor tab, opening it if needed. */
  openFile(path: string): void;
  /** Show an open file in the Editor tab. */
  selectFile(id: string): void;
  closeFile(id: string): void;
  closeAi(): void;
  setTitle(id: string, title: string): void;
  setPath(id: string, path: string): void;
  /** Back to the Files tab, without the AI tab; open files stay open. */
  reset(): void;
}

export function createTouchPanels(): TouchPanels {
  const store = createStore<TouchPanelsState>(load());
  const update = (change: (s: TouchPanelsState) => TouchPanelsState) => {
    const before = store.getState();
    const after = change(before);
    if (after !== before) store.setState(after);
  };
  store.subscribe(() => {
    const { tab, files, active, ai } = store.getState();
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ tab, files: files.map(({ id, path }) => ({ id, path })), active, ai }),
      );
    } catch {
      // Saving is a convenience; the panels still work for this session.
    }
  });

  return {
    ...store,
    show(tab) {
      update((s) => ({ ...s, tab, ai: s.ai || tab === 'ai' }));
    },
    openFile(path) {
      update((s) => {
        const kind = panelKind(path);
        const existing = s.files.find((f) => f.id === `${kind}:${path}` || f.path === path);
        if (existing) return { ...s, tab: 'editor', active: existing.id };
        const file = { id: `${kind}:${path}`, path, kind, title: baseName(path) };
        return { ...s, tab: 'editor', files: [...s.files, file], active: file.id };
      });
    },
    selectFile(id) {
      update((s) => (s.files.some((f) => f.id === id) ? { ...s, tab: 'editor', active: id } : s));
    },
    closeFile(id) {
      update((s) => {
        const index = s.files.findIndex((f) => f.id === id);
        if (index < 0) return s;
        const files = s.files.filter((f) => f.id !== id);
        const active = s.active === id ? (files[Math.min(index, files.length - 1)]?.id ?? null) : s.active;
        return { ...s, files, active, tab: s.tab === 'editor' && !active ? 'files' : s.tab };
      });
    },
    closeAi() {
      update((s) => ({ ...s, ai: false, tab: s.tab === 'ai' ? 'files' : s.tab }));
    },
    setTitle(id, title) {
      update((s) =>
        s.files.some((f) => f.id === id && f.title !== title)
          ? { ...s, files: s.files.map((f) => (f.id === id ? { ...f, title } : f)) }
          : s,
      );
    },
    setPath(id, path) {
      update((s) =>
        s.files.some((f) => f.id === id && f.path !== path)
          ? { ...s, files: s.files.map((f) => (f.id === id ? { ...f, path } : f)) }
          : s,
      );
    },
    reset() {
      update((s) => ({ ...s, tab: 'files', ai: false }));
    },
  };
}

/**
 * The code file the Files tree highlights and the AI works on: the shown file
 * when it is code, else the last code file shown while it stays open.
 */
export function activeCodePath(state: TouchPanelsState, previous: string | null): string | null {
  const code = state.files.filter((f) => f.kind === 'code');
  const shown = code.find((f) => f.id === state.active);
  if (shown) return shown.path;
  if (previous && code.some((f) => f.path === previous)) return previous;
  return code.at(-1)?.path ?? null;
}
