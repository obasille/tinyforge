import { useEffect, useRef } from 'react';
import { useEditor } from '../EditorContext.ts';
import { useStore } from '../hooks.ts';
import { usesTouchLayout } from '../layout-mode.ts';
import { mountPixelReadout } from '../pixel-readout.ts';

/** Mounts a container and hands it to the plain-TS viewport. */
export function GamePanel() {
  const editor = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLDivElement>(null);
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
    const el = readout.current;
    if (!el) return;
    return mountPixelReadout(el, editor.pixel, editor.copiedColor);
  }, [editor]);

  return (
    <div className="tf-game-panel">
      <div ref={ref} className="tf-viewport-host" data-testid="viewport" />
      <div ref={readout} className="tf-pixel-readout" />
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
