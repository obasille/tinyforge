import { useEditor } from './EditorContext.ts';
import { useStore } from './hooks.ts';

export function Toolbar({ onResetLayout }: { onResetLayout: () => void }) {
  const editor = useEditor();
  const project = useStore(editor.project);
  const stack = useStore(editor.commands);
  const session = useStore(editor.host.session);

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
      <button type="button" disabled={!stack.canUndo} onClick={() => editor.commands.undo()} title="Ctrl+Z">
        Undo{stack.undoLabel ? ` ${stack.undoLabel}` : ''}
      </button>
      <button type="button" disabled={!stack.canRedo} onClick={() => editor.commands.redo()} title="Ctrl+Shift+Z">
        Redo
      </button>
      <span className="tf-spacer" />
      <span className={`tf-status tf-status-${session.status}`} data-testid="run-status">
        {session.status}
      </span>
      <button type="button" onClick={onResetLayout}>
        Reset layout
      </button>
    </header>
  );
}
