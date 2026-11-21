import { matchShortcut } from '@tinyforge/editor-core';
import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  themeDark,
} from 'dockview-react';
import { type FunctionComponent, useCallback, useEffect, useRef } from 'react';
import { EditorContext } from './EditorContext.ts';
import type { Editor } from './editor.ts';
import { CodePanel } from './panels/CodePanel.tsx';
import { ConsolePanel } from './panels/ConsolePanel.tsx';
import { FilesPanel } from './panels/FilesPanel.tsx';
import { GamePanel } from './panels/GamePanel.tsx';
import { LibraryPanel } from './panels/LibraryPanel.tsx';
import { MemoryPanel } from './panels/MemoryPanel.tsx';
import { withBoundary } from './panels/PanelBoundary.tsx';
import { RunPanel } from './panels/RunPanel.tsx';
import { Toolbar } from './Toolbar.tsx';

const LAYOUT_KEY = 'tinyforge.editor.layout.v3';

const components: Record<string, FunctionComponent<IDockviewPanelProps>> = {
  game: withBoundary('Game', GamePanel),
  console: withBoundary('Console', ConsolePanel),
  memory: withBoundary('Memory', MemoryPanel),
  run: withBoundary('Run', RunPanel),
  files: withBoundary('Files', FilesPanel),
  library: withBoundary('Library', LibraryPanel),
  code: withBoundary('Code', CodePanel as FunctionComponent<IDockviewPanelProps>),
};

/** Show a file: focus its panel, or open one next to the other code panels (left of the game). */
function openCodePanel(api: DockviewApi, path: string): void {
  const id = `code:${path}`;
  const existing = api.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return;
  }
  const sibling = api.panels.find((p) => p.id.startsWith('code:'));
  const anchor = api.getPanel('game') ?? api.panels[0];
  api.addPanel({
    id,
    component: 'code',
    title: path.slice(path.lastIndexOf('/') + 1),
    params: { path },
    position: sibling
      ? { referencePanel: sibling.id, direction: 'within' }
      : anchor
        ? { referencePanel: anchor.id, direction: 'left' }
        : undefined,
  });
}

function defaultLayout(api: DockviewApi): void {
  api.addPanel({ id: 'game', component: 'game', title: 'Game' });
  api.addPanel({
    id: 'files',
    component: 'files',
    title: 'Files',
    position: { referencePanel: 'game', direction: 'left' },
    initialWidth: 220,
  });
  api.addPanel({
    id: 'run',
    component: 'run',
    title: 'Run',
    position: { referencePanel: 'game', direction: 'right' },
    initialWidth: 300,
  });
  api.addPanel({
    id: 'memory',
    component: 'memory',
    title: 'Memory',
    position: { referencePanel: 'run', direction: 'below' },
  });
  api.addPanel({
    id: 'console',
    component: 'console',
    title: 'Console',
    position: { referencePanel: 'game', direction: 'below' },
    initialHeight: 200,
  });
  api.addPanel({
    id: 'library',
    component: 'library',
    title: 'Library',
    position: { referencePanel: 'console', direction: 'within' },
  });
  api.getPanel('console')?.api.setActive();
}

/** Focus the library panel, or open it next to the console. */
function showLibraryPanel(api: DockviewApi): void {
  const existing = api.getPanel('library');
  if (existing) {
    existing.api.setActive();
    return;
  }
  const anchor = api.getPanel('console');
  api.addPanel({
    id: 'library',
    component: 'library',
    title: 'Library',
    position: anchor ? { referencePanel: anchor.id, direction: 'within' } : undefined,
  });
}

export function App({ editor }: { editor: Editor }) {
  const apiRef = useRef<DockviewApi | null>(null);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    let restored = false;
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (saved) {
        event.api.fromJSON(JSON.parse(saved));
        restored = true;
      }
    } catch {
      event.api.clear();
    }
    if (!restored || event.api.panels.length === 0) defaultLayout(event.api);
    event.api.onDidLayoutChange(() => {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(event.api.toJSON()));
      } catch {
        // Layout persistence is a convenience; ignore storage errors.
      }
    });
  }, []);

  useEffect(
    () =>
      editor.workbench.onOpenFile((path) => {
        if (apiRef.current) openCodePanel(apiRef.current, path);
      }),
    [editor],
  );

  useEffect(
    () =>
      editor.onShowLibrary(() => {
        if (apiRef.current) showLibraryPanel(apiRef.current);
      }),
    [editor],
  );

  const resetLayout = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    api.clear();
    defaultLayout(api);
  }, []);

  // Editor shortcuts (see SHORTCUTS). Capture phase, so they work while the
  // game view has focus; undo/redo stay out of text fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const shortcut = matchShortcut(e);
      if (!shortcut) return;
      const target = e.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, select, [contenteditable]');
      if (typing && (shortcut.action === 'undo' || shortcut.action === 'redo')) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat && shortcut.action !== 'step') return;
      editor.runShortcut(shortcut.action);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [editor]);

  return (
    <EditorContext.Provider value={editor}>
      <div className="tf-app">
        <Toolbar onResetLayout={resetLayout} />
        <div className="tf-dock">
          <DockviewReact components={components} onReady={onReady} theme={themeDark} />
        </div>
      </div>
    </EditorContext.Provider>
  );
}
