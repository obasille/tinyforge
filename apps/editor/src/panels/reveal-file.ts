// Revealing a file in the Files tree: select it, open the folders above it and
// scroll its row into view. Used for the file of the active code tab.

import { type Dispatch, type RefObject, type SetStateAction, useEffect, useRef } from 'react';

/** The folders that hold a path: `games/pong/main.ts` is in `games` and `games/pong`. */
export const ancestorsOf = (path: string): string[] => {
  const parts = path.split('/');
  return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join('/'));
};

/** Reveal `path` whenever it changes. Returns the ref to put on the tree's list. */
export function useRevealFile(
  path: string | null,
  files: readonly { path: string }[],
  select: (path: string) => void,
  setOpen: Dispatch<SetStateAction<Set<string>>>,
): RefObject<HTMLUListElement | null> {
  const tree = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!path) return;
    select(path);
    setOpen((s) => {
      const missing = ancestorsOf(path).filter((f) => !s.has(f));
      return missing.length ? new Set([...s, ...missing]) : s;
    });
  }, [path, select, setOpen]);

  // Scroll once its row is rendered (the file list can arrive later).
  const shown = !!path && files.some((f) => f.path === path);
  useEffect(() => {
    if (!path || !shown) return;
    const row = tree.current?.querySelector(`[data-testid="file-${CSS.escape(path)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [path, shown]);

  return tree;
}
