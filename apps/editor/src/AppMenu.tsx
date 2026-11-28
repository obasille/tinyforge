import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface AppMenuItem {
  label: string;
  testId?: string;
  title?: string;
  disabled?: boolean;
  /** A setting that is on or off: shown with a check mark. */
  checked?: boolean;
  onSelect: () => void;
}

/** The bottom safe-area inset (home indicator), read through a probe element. */
function safeBottom(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom)';
  document.body.append(probe);
  const inset = Number.parseFloat(getComputedStyle(probe).paddingBottom) || 0;
  probe.remove();
  return inset;
}

/**
 * A menu button: the top bar's (AI, Reset layout), or a panel's actions.
 * `up`: the list opens above the button (a button at the bottom of the screen).
 * `label` and `testId` replace the ☰ button's.
 */
export function AppMenu({
  items,
  up = false,
  label,
  testId = 'app-menu',
}: {
  items: AppMenuItem[];
  up?: boolean;
  label?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // The list is fixed to the screen, so a scrolling panel does not cut it
  // off. It opens below the button, or above when there is more room there,
  // and scrolls when neither has room. On phones the bottom edge is that of
  // the visible area, above the browser's bar and the home indicator.
  useLayoutEffect(() => {
    const list = listRef.current;
    const button = rootRef.current?.querySelector('.tf-menu-button');
    if (!open || !list || !button) return;
    const place = () => {
      const b = button.getBoundingClientRect();
      const vv = window.visualViewport;
      const bottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - safeBottom() - 8;
      const below = bottom - b.bottom - 4;
      const above = b.top - 4 - 8;
      const height = list.scrollHeight;
      const openUp = up ? !(height > above && below > above) : height > below && above > below;
      Object.assign(list.style, {
        position: 'fixed',
        top: openUp ? 'auto' : `${b.bottom + 4}px`,
        bottom: openUp ? `${window.innerHeight - b.top + 4}px` : 'auto',
        left: up ? `${b.left}px` : 'auto',
        right: up ? 'auto' : `${document.documentElement.clientWidth - b.right}px`,
        maxHeight: `${Math.max(80, openUp ? above : below)}px`,
        overflowY: 'auto',
      });
    };
    place();
    window.visualViewport?.addEventListener('resize', place);
    window.addEventListener('resize', place);
    return () => {
      window.visualViewport?.removeEventListener('resize', place);
      window.removeEventListener('resize', place);
    };
  }, [open, up]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    listRef.current?.querySelector<HTMLButtonElement>('.tf-menu-item:not(:disabled)')?.focus();
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.tf-menu-item:not(:disabled)') ?? [])];
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
        data-testid={testId}
        aria-label={label ?? 'Menu'}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Menu"
        onClick={() => setOpen(!open)}
      >
        {label ?? '☰'}
      </button>
      {open && (
        <div
          className={up ? 'tf-menu-list tf-menu-up' : 'tf-menu-list'}
          role="menu"
          aria-label="Menu"
          ref={listRef}
          onKeyDown={onKey}
        >
          {items.map((item) => {
            const props = {
              type: 'button' as const,
              className: 'tf-menu-item',
              'data-testid': item.testId,
              title: item.title,
              disabled: item.disabled,
              onClick: () => {
                setOpen(false);
                item.onSelect();
              },
            };
            return item.checked === undefined ? (
              <button key={item.label} role="menuitem" {...props}>
                {item.label}
              </button>
            ) : (
              <button key={item.label} role="menuitemcheckbox" aria-checked={item.checked} {...props}>
                <span className="tf-menu-check" aria-hidden="true">
                  {item.checked ? '✓' : ''}
                </span>
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
