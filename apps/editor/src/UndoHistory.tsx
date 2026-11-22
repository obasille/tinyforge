import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useEditor } from './EditorContext.ts';
import { useStore } from './hooks.ts';

/** Arrow next to Undo: lists recent changes; picking one undoes back to before it. */
export function UndoHistory() {
  const editor = useEditor();
  const stack = useStore(editor.commands);
  const [open, setOpen] = useState(false);
  // Entries up to this index are highlighted: they are what a click undoes.
  const [hover, setHover] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const history = stack.history;
  // Closes by itself once there is nothing left to undo.
  const shown = open && history.length > 0;

  useEffect(() => {
    if (!shown) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [shown]);

  useEffect(() => {
    if (!shown) return;
    setHover(0);
    listRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [shown]);

  const undoTo = (index: number) => {
    setOpen(false);
    editor.commands.undoMany(index + 1);
    editor.viewport.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      e.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, to))]?.focus();
    };
    if (e.key === 'ArrowDown') move(index + 1);
    else if (e.key === 'ArrowUp') move(index - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(items.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      editor.viewport.focus();
    }
  };

  return (
    <div className="tf-history" ref={rootRef}>
      <button
        type="button"
        className="tf-history-button"
        data-testid="undo-history"
        aria-label="Recent changes"
        aria-haspopup="menu"
        aria-expanded={shown}
        title="Recent changes"
        disabled={history.length === 0}
        onClick={() => setOpen(!shown)}
      >
        ▾
      </button>
      {shown && (
        <div className="tf-history-list" role="menu" aria-label="Recent changes" ref={listRef} onKeyDown={onKey}>
          {history.map((label, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: entries are positions in the stack
              key={i}
              type="button"
              role="menuitem"
              className="tf-history-item"
              data-active={i <= hover}
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onClick={() => undoTo(i)}
            >
              {label}
            </button>
          ))}
          <div className="tf-history-footer" aria-live="polite">
            Undo {hover + 1} {hover === 0 ? 'change' : 'changes'}
          </div>
        </div>
      )}
    </div>
  );
}
