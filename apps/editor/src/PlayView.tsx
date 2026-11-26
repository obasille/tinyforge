import { mountVirtualControls } from '@tinyforge/editor-core';
import { useEffect, useRef } from 'react';
import { useEditor } from './EditorContext.ts';
import { useStore } from './hooks.ts';

/**
 * Full-screen play (touch layout): the game as large as the screen allows at
 * 4:3, the on-screen controls in two columns at the sides, and a small bar to
 * pause, restart or go back to the editor. The game keeps running: the view
 * borrows the same canvas and Worker from the game panel.
 */
export function PlayView({ touch }: { touch: boolean }) {
  const editor = useEditor();
  const session = useStore(editor.host.session);
  const screen = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = screen.current;
    if (!el) return;
    editor.viewport.setFractional(true);
    editor.viewport.attach(el);
    editor.viewport.focus();
    return () => {
      editor.viewport.detach();
      editor.viewport.setFractional(touch);
    };
  }, [editor, touch]);

  useEffect(() => {
    const el = controls.current;
    if (!el) return;
    return mountVirtualControls(el, editor.input);
  }, [editor]);

  const paused = session.status === 'paused';
  return (
    <div className="tf-play" data-testid="play-view">
      <div ref={screen} className="tf-play-screen" data-testid="play-screen" />
      <div ref={controls} className="tf-play-controls" />
      <div className="tf-play-bar">
        <button type="button" onClick={() => editor.togglePause()} data-testid="play-pause">
          {paused ? '▶ Resume' : '❚❚ Pause'}
        </button>
        <button type="button" onClick={() => editor.restart()} data-testid="play-restart">
          ↻ Restart
        </button>
        <button type="button" onClick={() => editor.playing.setState(false)} data-testid="play-exit">
          ✕ Edit
        </button>
      </div>
    </div>
  );
}
