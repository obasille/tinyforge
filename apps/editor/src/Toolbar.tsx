import { useEditor } from './EditorContext.ts';
import { useStore } from './hooks.ts';

export function Toolbar({ onResetLayout }: { onResetLayout: () => void }) {
  const editor = useEditor();
  const project = useStore(editor.project);
  const stack = useStore(editor.commands);
  const session = useStore(editor.host.session);
  const sound = useStore(editor.audioSettings);
  const silent = sound.muted || sound.volume === 0;

  return (
    <header className="tf-toolbar">
      <strong className="tf-brand">TinyForge</strong>
      <label>
        Game{' '}
        <select
          data-testid="game-select"
          value={project.game ?? ''}
          onChange={(e) => {
            editor.selectGame(e.target.value);
            // Hand the keyboard back to the game so it can be played right away.
            editor.viewport.focus();
          }}
        >
          {project.game === null && <option value="">Choose…</option>}
          {editor.manifest.games.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={!stack.canUndo} onClick={() => editor.commands.undo()} title="Undo (Ctrl+Z)">
        Undo{stack.undoLabel ? ` ${stack.undoLabel}` : ''}
      </button>
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
      <button type="button" onClick={onResetLayout}>
        Reset layout
      </button>
    </header>
  );
}
