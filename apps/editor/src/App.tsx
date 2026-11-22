import { matchShortcut } from '@tinyforge/editor-core';
import { assetKindOf } from '@tinyforge/engine/tooling/project-layout';
import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanel,
  type IDockviewPanelProps,
  themeDark,
} from 'dockview-react';
import { type FunctionComponent, lazy, Suspense, useCallback, useEffect, useRef } from 'react';
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
import { SoundPanel } from './panels/SoundPanel.tsx';
import { SpritePanel } from './panels/SpritePanel.tsx';
import { Toolbar } from './Toolbar.tsx';

const LAYOUT_KEY = 'tinyforge.editor.layout.v3';

// The AI panel and its code load only when the panel is first shown.
const AiPanel = lazy(() => import('./panels/AiPanel.tsx'));
const LazyAiPanel = () => (
  <Suspense fallback={null}>
    <AiPanel />
  </Suspense>
);

const components: Record<string, FunctionComponent<IDockviewPanelProps>> = {
  game: withBoundary('Game', GamePanel),
  console: withBoundary('Console', ConsolePanel),
  memory: withBoundary('Memory', MemoryPanel),
  run: withBoundary('Run', RunPanel),
  files: withBoundary('Files', FilesPanel),
  library: withBoundary('Library', LibraryPanel),
  code: withBoundary('Code', CodePanel as FunctionComponent<IDockviewPanelProps>),
  sprite: withBoundary('Sprite', SpritePanel as FunctionComponent<IDockviewPanelProps>),
  sound: withBoundary('Sound', SoundPanel as FunctionComponent<IDockviewPanelProps>),
  ai: withBoundary('AI', LazyAiPanel),
};

const EDITOR_PANELS = /^(code|sprite|sound):/;

/** The panel kind that edits a file: the sprite editor, the sound player, or code. */
function panelKind(path: string): 'code' | 'sprite' | 'sound' {
  const kind = assetKindOf(path);
  return kind === 'sprites' ? 'sprite' : kind ? 'sound' : 'code';
}

/** Show a file: focus its panel, or open one next to the other editor panels (left of the game). */
function openFilePanel(api: DockviewApi, path: string): void {
  const component = panelKind(path);
  // A save can rename an asset file; its panel keeps its ID and follows the new path.
  const existing =
    api.getPanel(`${component}:${path}`) ??
    api.panels.find((p) => EDITOR_PANELS.test(p.id) && (p.params as { path?: string } | undefined)?.path === path);
  if (existing) {
    existing.api.setActive();
    return;
  }
  const sibling = api.panels.find((p) => EDITOR_PANELS.test(p.id));
  const anchor = api.getPanel('game') ?? api.panels[0];
  api.addPanel({
    id: `${component}:${path}`,
    component,
    title: path.slice(path.lastIndexOf('/') + 1),
    params: { path },
    position: sibling
      ? { referencePanel: sibling.id, direction: 'within' }
      : anchor
        ? { referencePanel: anchor.id, direction: 'left' }
        : undefined,
  });
}

const codePath = (panel: IDockviewPanel | undefined): string | null =>
  panel?.id.startsWith('code:') ? ((panel.params as { path?: string } | undefined)?.path ?? null) : null;

/**
 * Keep `editor.activeCode` on the active code tab. Focusing another panel (the
 * game, the console) keeps the last code tab; closing it falls back to the code
 * tab shown in another group, or null.
 */
function trackActiveCode(api: DockviewApi, editor: Editor): void {
  const shownCode = () => {
    const active = codePath(api.activePanel);
    if (active) return active;
    for (const group of api.groups) {
      const path = codePath(group.activePanel);
      if (path) return path;
    }
    return null;
  };
  editor.activeCode.setState(shownCode());
  api.onDidActivePanelChange(({ panel }) => {
    const path = codePath(panel);
    if (path) editor.activeCode.setState(path);
  });
  api.onDidRemovePanel((panel) => {
    if (codePath(panel) === editor.activeCode.getState()) editor.activeCode.setState(shownCode());
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

/** Focus the AI panel, or open it next to the run panel (right of the game). */
function showAiPanel(api: DockviewApi): void {
  const existing = api.getPanel('ai');
  if (existing) {
    existing.api.setActive();
    return;
  }
  const anchor = api.getPanel('run') ?? api.getPanel('game');
  api.addPanel({
    id: 'ai',
    component: 'ai',
    title: 'AI',
    position: anchor ? { referencePanel: anchor.id, direction: anchor.id === 'run' ? 'within' : 'right' } : undefined,
  });
}

export function App({ editor }: { editor: Editor }) {
  const apiRef = useRef<DockviewApi | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Dockview calls onReady once; the editor is fixed for the app's life.
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
    trackActiveCode(event.api, editor);
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
        if (apiRef.current) openFilePanel(apiRef.current, path);
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

  const showAi = useCallback(() => {
    if (apiRef.current) showAiPanel(apiRef.current);
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
      // Text fields, and panels with their own history (sprite editor, sound player), keep undo/redo.
      const local = target?.closest('input, textarea, select, [contenteditable], [data-local-history]');
      if (local && (shortcut.action === 'undo' || shortcut.action === 'redo')) return;
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
        <Toolbar onResetLayout={resetLayout} onShowAi={showAi} />
        <div className="tf-dock">
          <DockviewReact components={components} onReady={onReady} theme={themeDark} />
        </div>
      </div>
    </EditorContext.Provider>
  );
}
