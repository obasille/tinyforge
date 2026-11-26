import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

export interface AppMenuItem {
  label: string;
  testId?: string;
  title?: string;
  onSelect: () => void;
}

/** The top bar's menu button: less frequent actions (AI, Reset layout). */
export function AppMenu({ items }: { items: AppMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    listRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      e.preventDefault();
      buttons[Math.max(0, Math.min(buttons.length - 1, to))]?.focus();
    };
    if (e.key === 'ArrowDown') move(index + 1);
    else if (e.key === 'ArrowUp') move(index - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(buttons.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>('.tf-menu-button')?.focus();
    }
  };

  return (
    <div className="tf-menu" ref={rootRef}>
      <button
        type="button"
        className="tf-menu-button"
        data-testid="app-menu"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Menu"
        onClick={() => setOpen(!open)}
      >
        ☰
      </button>
      {open && (
        <div className="tf-menu-list" role="menu" aria-label="Menu" ref={listRef} onKeyDown={onKey}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="tf-menu-item"
              data-testid={item.testId}
              title={item.title}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
