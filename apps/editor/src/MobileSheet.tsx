// The bottom sheet of the touch layout in portrait: the editor panels below
// the game, at one of three heights. Collapsed shows only the handle and the
// tabs, half fills the space under the game, expanded covers the game (which
// keeps running). Drag the handle to resize, tap it to switch between half
// and expanded. It stays above the on-screen keyboard and expands while the
// keyboard is open, so a text field being typed in stays visible.

import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

export type SheetState = 'collapsed' | 'half' | 'expanded';

const SHEET_KEY = 'tinyforge.editor.sheet';
/** Collapsed: the handle and the row of tabs. */
export const COLLAPSED_HEIGHT = 88;
/** A drag shorter than this is a tap. */
const TAP = 6;

function loadState(): SheetState {
  try {
    const saved = localStorage.getItem(SHEET_KEY);
    return saved === 'collapsed' || saved === 'expanded' ? saved : 'half';
  } catch {
    return 'half';
  }
}

/** The height of each position, from the page as it is laid out now. */
interface Bounds {
  half: number;
  expanded: number;
  /** Height of the on-screen keyboard over the page (0 when closed). */
  keyboard: number;
}

/** The nearest position to a height. */
export function snapSheet(height: number, bounds: { half: number; expanded: number }): SheetState {
  const stops: Array<[SheetState, number]> = [
    ['collapsed', COLLAPSED_HEIGHT],
    ['half', bounds.half],
    ['expanded', bounds.expanded],
  ];
  let best = stops[0];
  for (const stop of stops) if (Math.abs(stop[1] - height) < Math.abs(best[1] - height)) best = stop;
  return best[0];
}

export function useMobileSheet(enabled: boolean, rootRef: RefObject<HTMLElement | null>) {
  const [state, setState] = useState<SheetState>(loadState);
  const [bounds, setBounds] = useState<Bounds>({ half: 0, expanded: 0, keyboard: 0 });
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; height: number; moved: boolean } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SHEET_KEY, state);
    } catch {
      // The position still applies for this session.
    }
  }, [state]);

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;
    const measure = () => {
      const page = root.getBoundingClientRect();
      const toolbar = root.querySelector('.tf-toolbar')?.getBoundingClientRect();
      const game = root.querySelector('.tf-touch-game')?.getBoundingClientRect();
      const vv = window.visualViewport;
      const keyboard = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
      const bottom = page.bottom - keyboard;
      setBounds({
        expanded: Math.max(COLLAPSED_HEIGHT, bottom - (toolbar?.bottom ?? page.top)),
        half: Math.max(COLLAPSED_HEIGHT, bottom - (game?.bottom ?? page.top)),
        keyboard,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    const game = root.querySelector('.tf-touch-game');
    if (game) observer.observe(game);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', measure);
    vv?.addEventListener('scroll', measure);
    return () => {
      observer.disconnect();
      vv?.removeEventListener('resize', measure);
      vv?.removeEventListener('scroll', measure);
    };
  }, [enabled, rootRef]);

  // While the keyboard is open, the sheet takes all the room above it.
  const shown: SheetState = bounds.keyboard > 0 ? 'expanded' : state;
  const rest = shown === 'collapsed' ? COLLAPSED_HEIGHT : shown === 'half' ? bounds.half : bounds.expanded;
  const height = drag ?? rest;

  const toggle = () => setState(shown === 'expanded' ? 'half' : 'expanded');

  const handleProps = {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // Not a pointer the browser tracks: moves still arrive while it is over the handle.
      }
      start.current = { y: e.clientY, height: rest, moved: false };
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const s = start.current;
      if (!s) return;
      const dy = s.y - e.clientY;
      if (Math.abs(dy) >= TAP) s.moved = true;
      if (s.moved) setDrag(Math.max(COLLAPSED_HEIGHT, Math.min(bounds.expanded, s.height + dy)));
    },
    onPointerUp(e: ReactPointerEvent<HTMLElement>) {
      const s = start.current;
      start.current = null;
      if (!s) return;
      if (s.moved) setState(snapSheet(Math.max(COLLAPSED_HEIGHT, s.height + s.y - e.clientY), bounds));
      else toggle();
      setDrag(null);
    },
    onPointerCancel() {
      start.current = null;
      setDrag(null);
    },
    // Keyboard (Enter or Space on the focused handle); a tap is handled on pointerup.
    onClick(e: { detail: number }) {
      if (e.detail === 0) toggle();
    },
  };

  /** Opens a collapsed sheet to half; leaves it as it is otherwise. */
  const open = useCallback(() => setState((s) => (s === 'collapsed' ? 'half' : s)), []);

  return {
    open,
    state: shown,
    style: enabled ? { height, bottom: bounds.keyboard } : undefined,
    handleProps,
  };
}
