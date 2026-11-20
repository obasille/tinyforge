import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYS } from '../src/input.ts';
import { matchShortcut, SHORTCUTS, withShortcut } from '../src/shortcuts.ts';

const key = (code: string, mods: Partial<{ shift: boolean; ctrl: boolean; meta: boolean; alt: boolean }> = {}) => ({
  code,
  shiftKey: !!mods.shift,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  altKey: !!mods.alt,
});

describe('shortcuts', () => {
  it('maps function keys to run actions', () => {
    expect(matchShortcut(key('F5'))?.action).toBe('reload');
    expect(matchShortcut(key('F5', { shift: true }))?.action).toBe('restart');
    expect(matchShortcut(key('F8'))?.action).toBe('pauseResume');
    expect(matchShortcut(key('F10'))?.action).toBe('step');
  });

  it('treats Cmd like Ctrl for undo and redo', () => {
    expect(matchShortcut(key('KeyZ', { meta: true }))?.action).toBe('undo');
    expect(matchShortcut(key('KeyZ', { ctrl: true, shift: true }))?.action).toBe('redo');
  });

  it('ignores game keys and unknown combinations', () => {
    expect(matchShortcut(key('KeyZ'))).toBeNull();
    expect(matchShortcut(key('F8', { alt: true }))).toBeNull();
    expect(matchShortcut(key('KeyC'))).toBeNull();
  });

  it('never uses a game key without a modifier', () => {
    const gameKeys = new Set([...Object.keys(DEFAULT_KEYS), 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC']);
    for (const s of SHORTCUTS) {
      if (!s.ctrl) expect(gameKeys.has(s.code)).toBe(false);
    }
  });

  it('labels buttons with their key', () => {
    expect(withShortcut('Pause', 'pauseResume')).toBe('Pause (F8)');
  });
});
