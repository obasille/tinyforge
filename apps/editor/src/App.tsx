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
import { ConsolePanel } from './panels/ConsolePanel.tsx';
import { GamePanel } from './panels/GamePanel.tsx';
import { MemoryPanel } from './panels/MemoryPanel.tsx';
import { withBoundary } from './panels/PanelBoundary.tsx';
import { RunPanel } from './panels/RunPanel.tsx';
import { Toolbar } from './Toolbar.tsx';

const LAYOUT_KEY = 'tinyforge.editor.layout.v1';

const components: Record<string, FunctionComponent<IDockviewPanelProps>> = {
  game: withBoundary('Game', GamePanel),
  console: withBoundary('Console', ConsolePanel),
  memory: withBoundary('Memory', MemoryPanel),
  run: withBoundary('Run', RunPanel),
};

function defaultLayout(api: DockviewApi): void {
  api.addPanel({ id: 'game', component: 'game', title: 'Game' });
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
