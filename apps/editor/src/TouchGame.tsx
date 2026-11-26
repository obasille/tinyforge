import { mountVirtualControls, type VirtualControls } from '@tinyforge/editor-core';
import { useEffect, useRef } from 'react';
import { AppMenu, type AppMenuItem } from './AppMenu.tsx';
import { useEditor } from './EditorContext.ts';

/**
 * The game in the touch layout, with the on-screen controls.
 * - landscape: full screen at 4:3, the controls in two columns over its sides,
 *   Pause and Restart at the bottom left, Start at the bottom right.
 * - portrait: across the top of the screen, one narrow control column on each
 *   side and a row above it (LT, Pause, Restart, Start, RT); the editor
 *   panels go below.
 * The same canvas and Worker as everywhere else: rotating never restarts the game.
 */
export function TouchGame({ layout, menu }: { layout: 'landscape' | 'portrait'; menu: AppMenuItem[] }) {
  const editor = useEditor();
  const root = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = screen.current;
    if (!el) return;
    editor.viewport.attach(el);
    editor.viewport.focus();
    return () => editor.viewport.detach();
  }, [editor]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const session = editor.host.session;
    const controls: VirtualControls = mountVirtualControls(el, editor.input, {
      layout,
      onPause: () => editor.togglePause(),
      onRestart: () => editor.restart(),
      paused: session.getState().status === 'paused',
    });
    const unsubscribe = session.subscribe(() => controls.setPaused(session.getState().status === 'paused'));
    return () => {
      unsubscribe();
      controls.dispose();
    };
  }, [editor, layout]);

  return (
    <div ref={root} className={`tf-touch-game tf-touch-game-${layout}`} data-testid="touch-game">
      <div ref={screen} className="tf-touch-screen" data-testid="touch-screen" />
      {layout === 'landscape' && (
        // Landscape has no top bar: the menu (layout switch) sits by Pause and Restart.
        <div className="tf-touch-menu">
          <AppMenu items={menu} up />
        </div>
      )}
    </div>
  );
}
