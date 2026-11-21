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

  // C copies the hovered pixel's color, like the classic host. F4 does the
  // same from anywhere (see SHORTCUTS).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.code !== 'KeyC' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    editor.copyPixelColor();
  };

  return (
    <div className="tf-game-panel">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the viewport is focusable and takes game keys */}
      <div ref={ref} className="tf-viewport-host" data-testid="viewport" onKeyDown={onKeyDown} />
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
