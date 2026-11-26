import { AppMenu, type AppMenuItem } from './AppMenu.tsx';
import { useEditor } from './EditorContext.ts';
import { GamePicker } from './GamePicker.tsx';
import { useStore } from './hooks.ts';
import { UndoHistory } from './UndoHistory.tsx';

export function Toolbar({
  onResetLayout,
  onShowAi,
  touch,
}: {
  onResetLayout: () => void;
  onShowAi: () => void;
  touch: boolean;
}) {
  const editor = useEditor();
  const stack = useStore(editor.commands);
  const session = useStore(editor.host.session);
  const sound = useStore(editor.audioSettings);
  const silent = sound.muted || sound.volume === 0;
  const mode = useStore(editor.layoutMode);
  const items: AppMenuItem[] = [
    { label: 'AI', testId: 'show-ai', title: 'Ask the code agent for a change', onSelect: onShowAi },
    { label: 'Reset layout', testId: 'reset-layout', onSelect: onResetLayout },
    touch
      ? {
          label: 'Use desktop layout',
          testId: 'use-desktop-layout',
          onSelect: () => editor.layoutMode.setState('desktop'),
        }
      : { label: 'Use touch layout', testId: 'use-touch-layout', onSelect: () => editor.layoutMode.setState('touch') },
  ];
  if (mode !== 'auto') {
    items.push({
      label: 'Automatic layout',
      testId: 'auto-layout',
      title: 'Touch layout on touch screens, desktop layout elsewhere',
      onSelect: () => editor.layoutMode.setState('auto'),
    });
  }

  return (
    <header className="tf-toolbar">
      <strong className="tf-brand">TinyForge</strong>
      <GamePicker />
      <span className="tf-undo-group">
        <button type="button" disabled={!stack.canUndo} onClick={() => editor.commands.undo()} title="Undo (Ctrl+Z)">
          Undo{stack.undoLabel ? ` ${stack.undoLabel}` : ''}
        </button>
        <UndoHistory />
      </span>
      <button
        type="button"
        disabled={!stack.canRedo}
        onClick={() => editor.commands.redo()}
        title="Redo (Ctrl+Shift+Z)"
      >
        Redo
      </button>
      <span className="tf-spacer" />
      <span className="tf-volume">
        <button
          type="button"
          data-testid="mute"
          aria-pressed={sound.muted}
          title={sound.muted ? 'Unmute sound' : 'Mute sound'}
          onClick={() => {
            editor.toggleMute();
            editor.viewport.focus();
          }}
        >
          {silent ? '🔇' : sound.volume < 0.5 ? '🔉' : '🔊'}
        </button>
        <input
          type="range"
          data-testid="volume"
          aria-label="Master volume"
          title={`Master volume ${Math.round(sound.volume * 100)}%`}
          min={0}
          max={100}
          step={1}
          value={Math.round(sound.volume * 100)}
          onChange={(e) => editor.setVolume(Number(e.target.value) / 100)}
          // After a drag, give the keyboard back to the game.
          onPointerUp={() => editor.viewport.focus()}
        />
      </span>
      <span className={`tf-status tf-status-${session.status}`} data-testid="run-status">
        {session.status}
      </span>
      {touch && (
        <button
          type="button"
          data-testid="play"
          title="Play full screen with on-screen controls"
          onClick={() => editor.playing.setState(true)}
        >
          ▶ Play
        </button>
      )}
      <AppMenu items={items} />
    </header>
  );
}
