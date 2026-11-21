import { useEffect, useRef } from 'react';
import { useEditor } from '../EditorContext.ts';
import { useStore } from '../hooks.ts';
import { mountPixelReadout } from '../pixel-readout.ts';

/** Mounts a container and hands it to the plain-TS viewport. */
export function GamePanel() {
  const editor = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLDivElement>(null);
  const session = useStore(editor.host.session);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    editor.viewport.attach(el);
    // Keys go to the game from the start, without a click first.
    editor.viewport.focus();
    return () => editor.viewport.detach();
  }, [editor]);

  useEffect(() => {
    const el = readout.current;
    if (!el) return;
    return mountPixelReadout(el, editor.pixel, editor.copiedColor);
  }, [editor]);

  return (
    <div className="tf-game-panel">
      <div ref={ref} className="tf-viewport-host" data-testid="viewport" />
      <div ref={readout} className="tf-pixel-readout" />
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
