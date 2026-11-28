import { mountVirtualControls, withShortcut } from '@tinyforge/editor-core';
import { useEffect, useRef, useState } from 'react';
import { AppMenu } from '../AppMenu.tsx';
import { useEditor } from '../EditorContext.ts';
import { useStore } from '../hooks.ts';
import { usesTouchLayout } from '../layout-mode.ts';
import { mountPixelReadout } from '../pixel-readout.ts';

const CONTROLS_KEY = 'tinyforge.editor.gameControls';

function loadShowControls(): boolean {
  try {
    return localStorage.getItem(CONTROLS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Mounts a container and hands it to the plain-TS viewport. A bar above it
 * has Pause and Restart, the pixel readout, and a menu that shows the
 * on-screen game buttons below the game (off by default: the keyboard plays
 * too). One row for all of it: the game keeps its 2x scale at 1280x800.
 */
export function GamePanel() {
  const editor = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [showControls, setShowControls] = useState(loadShowControls);
  const session = useStore(editor.host.session);
  // The touch layout shows the game outside the panels (TouchGame).
  const touch = usesTouchLayout(useStore(editor.layoutMode));
  const { game } = useStore(editor.project);
  const build = useStore(editor.compiler.builds)[game ?? ''];
  const errors = build?.status === 'failed' ? build.diagnostics.filter((d) => d.severity === 'error') : [];
  // The game's last good build is still running when an edit broke it.
  const stale = session.game === game;

  useEffect(() => {
    const el = ref.current;
    if (!el || touch) return;
    editor.viewport.attach(el);
    // Keys go to the game from the start, without a click first.
    editor.viewport.focus();
    return () => editor.viewport.detach();
  }, [editor, touch]);

  useEffect(() => {
    const el = controlsRef.current;
    if (!el || touch || !showControls) return;
    const controls = mountVirtualControls(el, editor.input, {
      layout: 'strip',
      onPause: () => editor.togglePause(),
      onRestart: () => editor.restart(),
    });
    return () => controls.dispose();
  }, [editor, touch, showControls]);

  const toggleControls = () => {
    const next = !showControls;
    setShowControls(next);
    try {
      localStorage.setItem(CONTROLS_KEY, next ? '1' : '0');
    } catch {
      // Storage may be unavailable; the choice still holds for this session.
    }
  };
  // The keys keep going to the game after a click in the bar.
  const run = (action: () => void) => () => {
    action();
    editor.viewport.focus();
  };
  const paused = session.status === 'paused';

  // biome-ignore lint/correctness/useExhaustiveDependencies: the readout is in the bar, which the touch layout leaves out
  useEffect(() => {
    const el = readout.current;
    if (!el) return;
    return mountPixelReadout(el, editor.pixel, editor.copiedColor);
  }, [editor, touch]);

  return (
    <div className="tf-game-panel">
      {!touch && (
        <div className="tf-game-bar">
          <button
            type="button"
            data-testid="game-pause"
            title={withShortcut(paused ? 'Resume' : 'Pause', 'pauseResume')}
            onClick={run(() => editor.togglePause())}
          >
            {paused ? '▶' : '❚❚'}
          </button>
          <button
            type="button"
            data-testid="game-restart"
            title={withShortcut('Restart', 'restart')}
            onClick={run(() => editor.restart())}
          >
            ↻
          </button>
          <div ref={readout} className="tf-pixel-readout" />
          <AppMenu
            label="View ▾"
            testId="game-menu"
            items={[
              {
                label: 'Game buttons',
                testId: 'game-show-controls',
                title: 'On-screen game buttons below the game, for the mouse',
                checked: showControls,
                onSelect: toggleControls,
              },
            ]}
          />
        </div>
      )}
      <div ref={ref} className="tf-viewport-host" data-testid="viewport" />
      {!touch && showControls && <div ref={controlsRef} className="tf-game-controls" />}
      {build?.status === 'failed' && (
        <div className={`tf-overlay${stale ? ' tf-overlay-soft' : ''}`} role="alert" data-testid="compile-error">
          <p>
            {game} does not compile
            {errors.length > 0 ? ` (${errors.length} error${errors.length === 1 ? '' : 's'})` : ''}
            {stale ? ', running its last good build.' : '.'} See the console.
          </p>
          {!stale && errors[0] && (
            <pre className="tf-compile-error">
              {errors[0].path ? (
                <button
                  type="button"
                  className="tf-log-link"
                  onClick={() => {
                    const { path, line, column } = errors[0];
                    if (path) editor.workbench.openFile(path, { line, column });
                  }}
                >
                  {errors[0].path}:{errors[0].line}
                </button>
              ) : null}
              {errors[0].path ? ': ' : ''}
              {errors[0].message}
            </pre>
          )}
        </div>
      )}
      {session.status === 'hung' && (
        <div className="tf-overlay" role="alert">
          <p>The game is not responding (an infinite loop in update() or draw()?).</p>
          <button type="button" onClick={() => editor.kill()}>
            Stop and reload game
          </button>
        </div>
      )}
      {session.status === 'aborted' && (
        <div className="tf-overlay tf-overlay-soft" role="status">
          <p>The game stopped. See the console.</p>
          <button type="button" onClick={() => editor.loadGame()}>
            Reload game
          </button>
        </div>
      )}
    </div>
  );
}
