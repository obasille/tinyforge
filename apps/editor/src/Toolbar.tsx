import { GitHubWorkspace } from '@tinyforge/editor-core';
import { AppMenu, type AppMenuItem } from './AppMenu.tsx';
import { useEditor } from './EditorContext.ts';
import type { Editor } from './editor.ts';
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
  const items = useMenuItems(editor, onResetLayout, onShowAi, touch);

  return (
    <header className="tf-toolbar">
      <strong className="tf-brand">TinyForge</strong>
      <GamePicker />
      <span className="tf-undo-group">
        <button
          type="button"
          disabled={!stack.canUndo}
          onClick={() => editor.commands.undo()}
          title="Undo (Ctrl+Z)"
          // The touch layout shows an arrow; the name still says what is undone.
          aria-label={touch ? `Undo${stack.undoLabel ? ` ${stack.undoLabel}` : ''}` : undefined}
        >
          {touch ? '↶' : `Undo${stack.undoLabel ? ` ${stack.undoLabel}` : ''}`}
        </button>
        <UndoHistory />
      </span>
      <button
        type="button"
        disabled={!stack.canRedo}
        onClick={() => editor.commands.redo()}
        title="Redo (Ctrl+Shift+Z)"
        aria-label={touch ? 'Redo' : undefined}
      >
        {touch ? '↷' : 'Redo'}
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
      {editor.files.workspace instanceof GitHubWorkspace ? (
        <SaveState workspace={editor.files.workspace} touch={touch} />
      ) : null}
      <span className={`tf-status tf-status-${session.status}`} data-testid="run-status" title={session.status}>
        {session.status}
      </span>
      <AppMenu items={items} />
    </header>
  );
}

const SAVE_LABELS = {
  saved: 'Saved',
  pending: 'Unsaved',
  saving: 'Saving…',
  failed: 'Save failed',
  conflict: 'Conflict',
} as const;

/** The deployed editor's GitHub saves: their state, and Save (or Reload after a conflict). */
function SaveState({ workspace, touch }: { workspace: GitHubWorkspace; touch: boolean }) {
  const save = useStore(workspace.save);
  const title =
    save.error ??
    (save.pending.length > 0
      ? `Not on GitHub yet: ${save.pending.join(', ')}`
      : 'Every change is committed to the web branch');
  return (
    <span className={`tf-save tf-save-${save.status}`} data-testid="save-state" title={title}>
      {touch && save.status === 'saved' ? '✓' : SAVE_LABELS[save.status]}
      {save.status === 'conflict' ? (
        <button type="button" data-testid="save-reload" onClick={() => location.reload()}>
          Reload
        </button>
      ) : save.status === 'pending' || save.status === 'failed' ? (
        <button type="button" data-testid="save-now" onClick={() => void workspace.flush()}>
          {save.status === 'failed' ? 'Retry' : 'Save'}
        </button>
      ) : null}
    </span>
  );
}

/** The top-bar menu: AI, Reset layout, and the desktop/touch layout switch. */
export function useMenuItems(
  editor: Editor,
  onResetLayout: () => void,
  onShowAi: () => void,
  touch: boolean,
): AppMenuItem[] {
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
  return items;
}
