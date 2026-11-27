// The touch layout's panels, without Dockview: a row of large tabs and one
// panel at a time. The Editor tab shows the open files, one at a time, with a
// switcher. A panel is mounted the first time its tab is shown and stays
// mounted (hidden) after, as Dockview tabs do, so it keeps its state.

import { type FunctionComponent, lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useStore } from './hooks.ts';
import { CodePanel } from './panels/CodePanel.tsx';
import { ConsolePanel } from './panels/ConsolePanel.tsx';
import { FilesPanel } from './panels/FilesPanel.tsx';
import { LibraryPanel } from './panels/LibraryPanel.tsx';
import { MemoryPanel } from './panels/MemoryPanel.tsx';
import { withBoundary } from './panels/PanelBoundary.tsx';
import type { PanelApi, PanelProps } from './panels/panel-api.ts';
import { RunPanel } from './panels/RunPanel.tsx';
import { SoundPanel } from './panels/SoundPanel.tsx';
import { SpritePanel } from './panels/SpritePanel.tsx';
import type { FileKind, OpenFile, TouchPanels as TouchPanelsStore, TouchTab } from './touch-panels.ts';

const AiPanel = lazy(() => import('./panels/AiPanel.tsx'));
const LazyAiPanel = () => (
  <Suspense fallback={null}>
    <AiPanel />
  </Suspense>
);

const FIXED: ReadonlyArray<[Exclude<TouchTab, 'editor' | 'ai'>, string, FunctionComponent]> = [
  ['files', 'Files', withBoundary('Files', FilesPanel)],
  ['library', 'Library', withBoundary('Library', LibraryPanel)],
  ['console', 'Console', withBoundary('Console', ConsolePanel)],
  ['run', 'Run', withBoundary('Run', RunPanel)],
  ['memory', 'Memory', withBoundary('Memory', MemoryPanel)],
];
const Ai = withBoundary('AI', LazyAiPanel);

const FILE_PANELS: Record<FileKind, FunctionComponent<PanelProps<{ path: string }>>> = {
  code: withBoundary('Code', CodePanel),
  sprite: withBoundary('Sprite', SpritePanel),
  sound: withBoundary('Sound', SoundPanel),
};

/** The order of the tabs; Editor and AI only while they have something to show. */
const ORDER: readonly TouchTab[] = ['files', 'library', 'editor', 'console', 'run', 'memory', 'ai'];
const LABELS: Record<TouchTab, string> = {
  files: 'Files',
  library: 'Library',
  editor: 'Editor',
  console: 'Console',
  run: 'Run',
  memory: 'Memory',
  ai: 'AI',
};

interface Props {
  panels: TouchPanelsStore;
  /** Called when a tab is tapped (the sheet opens if it was collapsed). */
  onTab?: () => void;
}

export function TouchPanels({ panels, onTab }: Props) {
  const state = useStore(panels);
  const { tab, files, active, ai } = state;
  const [visited, setVisited] = useState<ReadonlySet<TouchTab>>(() => new Set([tab]));
  useEffect(() => setVisited((v) => (v.has(tab) ? v : new Set([...v, tab]))), [tab]);

  const tabs = ORDER.filter((t) => (t === 'editor' ? files.length > 0 : t === 'ai' ? ai : true));
  const activeFile = files.find((f) => f.id === active);

  return (
    <div className="tf-touch-panels" data-testid="touch-panels">
      <div className="tf-touch-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={t === tab}
            className="tf-touch-tab"
            data-testid={`touch-tab-${t}`}
            onClick={() => {
              panels.show(t);
              onTab?.();
            }}
          >
            {LABELS[t]}
          </button>
        ))}
      </div>
      <div className="tf-touch-body">
        {FIXED.map(([id, , Panel]) =>
          visited.has(id) ? (
            <section key={id} className="tf-touch-panel" hidden={tab !== id} data-testid={`touch-panel-${id}`}>
              <Panel />
            </section>
          ) : null,
        )}
        {files.length > 0 && (
          <section
            className="tf-touch-panel tf-touch-editor"
            hidden={tab !== 'editor'}
            data-testid="touch-panel-editor"
          >
            <div className="tf-touch-filebar">
              <select
                aria-label="Open file"
                data-testid="touch-file-select"
                value={active ?? ''}
                onChange={(e) => panels.selectFile(e.target.value)}
              >
                {files.map((f) => (
                  <option key={f.id} value={f.id} title={f.path}>
                    {switcherLabel(f)}
                  </option>
                ))}
              </select>
              {activeFile && (
                <button
                  type="button"
                  className="tf-touch-close"
                  data-testid="touch-file-close"
                  aria-label={`Close ${switcherLabel(activeFile)}`}
                  onClick={() => panels.closeFile(activeFile.id)}
                >
                  ×
                </button>
              )}
            </div>
            {files.map((f) => (
              <div key={f.id} className="tf-touch-file" hidden={f.id !== active}>
                <FileHost panels={panels} file={f} />
              </div>
            ))}
          </section>
        )}
        {ai && visited.has('ai') && (
          <section className="tf-touch-panel tf-touch-editor" hidden={tab !== 'ai'} data-testid="touch-panel-ai">
            <div className="tf-touch-filebar">
              <span>AI</span>
              <button
                type="button"
                className="tf-touch-close"
                data-testid="touch-ai-close"
                aria-label="Close AI"
                onClick={() => panels.closeAi()}
              >
                ×
              </button>
            </div>
            <div className="tf-touch-file">
              <Ai />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * A file in the switcher: its path without `games/` or `assets/`
 * (`breakout/main.ts`, `sprites/dino.png`, `engine/sdk/drawing.ts`), with
 * the panel's ● for unsaved changes.
 */
export function switcherLabel(file: OpenFile): string {
  const path = file.path.replace(/^(games|assets)\//, '');
  return file.title.startsWith('● ') ? `● ${path}` : path;
}

/** One open file's panel, with the panel API that Dockview would give it. */
function FileHost({ panels, file }: { panels: TouchPanelsStore; file: OpenFile }) {
  const { id, kind, path } = file;
  const api = useMemo<PanelApi>(
    () => ({
      get isActive() {
        const s = panels.getState();
        return s.tab === 'editor' && s.active === id;
      },
      setTitle: (title) => panels.setTitle(id, title),
      updateParameters: (params) => panels.setPath(id, params.path),
    }),
    [panels, id],
  );
  // The code editor follows its path; the sprite and sound panels keep the
  // path they opened and rename it themselves.
  const params = useMemo(() => ({ path }), [path]);
  const Panel = FILE_PANELS[kind];
  return <Panel api={api} params={params} />;
}
