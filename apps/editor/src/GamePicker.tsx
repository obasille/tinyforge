import type { GameInfo } from '@tinyforge/editor-core';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { BuildStatus } from './BuildStatus.tsx';
import { useEditor } from './EditorContext.ts';
import { useStore } from './hooks.ts';

/** A game's cover image, or its initials when it has none. */
function Cover({ game, size }: { game: GameInfo; size: 'small' | 'large' }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!game.cover) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(game.cover);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [game.cover]);

  const className = `tf-cover tf-cover-${size}`;
  if (url) return <img className={className} src={url} alt="" draggable={false} />;
  const initials = game.title
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className={`${className} tf-cover-placeholder`} aria-hidden="true">
      {initials}
    </span>
  );
}

/** Toolbar button showing the current game; opens a scrollable list of games. */
export function GamePicker() {
  const editor = useEditor();
  const project = useStore(editor.project);
  const games = useStore(editor.catalog.games);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const current = games.find((g) => g.name === project.game) ?? null;

  // Close on a click outside the picker.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // When opening, focus the current game and scroll it into view.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const selected =
      list?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ??
      list?.querySelector<HTMLButtonElement>('[role="option"]');
    selected?.focus();
    selected?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  const choose = (name: string) => {
    setOpen(false);
    if (name !== project.game) editor.selectGame(name);
    // Hand the keyboard back to the game so it can be played right away.
    editor.viewport.focus();
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const options = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      e.preventDefault();
      options[Math.max(0, Math.min(options.length - 1, to))]?.focus();
    };
    if (e.key === 'ArrowDown') move(index + 1);
    else if (e.key === 'ArrowUp') move(index - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(options.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      editor.viewport.focus();
    }
  };

  return (
    <div className="tf-picker" ref={rootRef}>
      <button
        type="button"
        className="tf-picker-button"
        data-testid="game-select"
        data-game={project.game ?? ''}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Choose a game"
        onClick={() => setOpen((o) => !o)}
      >
        {current ? (
          <>
            <Cover game={current} size="small" />
            <span>{current.title}</span>
            <BuildStatus game={current.name} />
          </>
        ) : (
          <span>Choose a game…</span>
        )}
        <span className="tf-picker-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          className="tf-picker-list"
          role="listbox"
          aria-label="Games"
          data-testid="game-picker"
          ref={listRef}
          onKeyDown={onListKey}
        >
          {games.map((g) => (
            <button
              key={g.name}
              type="button"
              role="option"
              aria-selected={g.name === project.game}
              className="tf-picker-option"
              data-testid={`game-option-${g.name}`}
              onClick={() => choose(g.name)}
            >
              <Cover game={g} size="large" />
              <span className="tf-picker-text">
                <span className="tf-picker-title">
                  {g.title} <BuildStatus game={g.name} />
                </span>
                <span className="tf-picker-desc">
                  {g.loading ? 'Loading…' : g.error && !g.description ? g.error : g.description}
                </span>
                {g.author && <span className="tf-picker-author">by {g.author}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
