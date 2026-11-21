// Editor keyboard shortcuts. They use function keys so they never collide
// with game keys (arrows, WASD, Z/X, Enter/Space), and
// they work whether the game view or the editor has focus. A bare Ctrl press
// is a game trigger (LT/RT); only Ctrl+key combinations are shortcuts.

export type ShortcutAction = 'reload' | 'restart' | 'pauseResume' | 'step' | 'copyColor' | 'undo' | 'redo';

export interface Shortcut {
  action: ShortcutAction;
  /** KeyboardEvent.code */
  code: string;
  shift?: boolean;
  ctrl?: boolean;
  /** Shown in buttons and tooltips. */
  label: string;
  description: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { action: 'reload', code: 'F5', label: 'F5', description: 'Reload cartridge' },
  { action: 'restart', code: 'F5', shift: true, label: 'Shift+F5', description: 'Restart (init)' },
  { action: 'pauseResume', code: 'F8', label: 'F8', description: 'Pause / resume' },
  { action: 'step', code: 'F10', label: 'F10', description: 'Step 1 tick (pauses first)' },
  // F4: free in Chrome, Firefox, Safari and Edge (F1/F3/F6/F7/F11/F12 are taken).
  { action: 'copyColor', code: 'F4', label: 'F4', description: 'Copy the hovered pixel color' },
  { action: 'undo', code: 'KeyZ', ctrl: true, label: 'Ctrl+Z', description: 'Undo' },
  { action: 'redo', code: 'KeyZ', ctrl: true, shift: true, label: 'Ctrl+Shift+Z', description: 'Redo' },
];

export interface KeyLike {
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** The shortcut a key press triggers, if any. Cmd counts as Ctrl on macOS. */
export function matchShortcut(e: KeyLike): Shortcut | null {
  if (e.altKey) return null;
  const ctrl = e.ctrlKey || e.metaKey;
  return SHORTCUTS.find((s) => s.code === e.code && !!s.shift === e.shiftKey && !!s.ctrl === ctrl) ?? null;
}

/** "Pause (F8)" style label for a button. */
export function withShortcut(text: string, action: ShortcutAction): string {
  const s = SHORTCUTS.find((x) => x.action === action);
  return s ? `${text} (${s.label})` : text;
}
