import { formatSeed, type ShortcutAction, withShortcut } from '@tinyforge/editor-core';
import { useEffect, useRef } from 'react';
import { Pane } from 'tweakpane';
import { useEditor } from '../EditorContext.ts';
import { useTouchLayout } from '../hooks.ts';

/**
 * Run controls and live stats, built with Tweakpane. Tweakpane is plain DOM,
 * so it reads the stores directly instead of re-rendering through React.
 */
export function RunPanel() {
  const editor = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  // The touch layout has no keyboard: buttons say "Pause", not "Pause (F8)".
  const touch = useTouchLayout();

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const label = (text: string, action: ShortcutAction) => (touch ? text : withShortcut(text, action));
    const pane = new Pane({ container });
    const stats = { status: 'idle', fps: 0, update: 0, draw: 0, ticks: 0, seed: '' };
    const settings = {
      fixedSeed: editor.project.getState().seed !== null,
      seed: formatSeed(editor.project.getState().seed ?? 0),
    };

    const live = pane.addFolder({ title: 'Game' });
    live.addBinding(stats, 'status', { readonly: true });
    live.addBinding(stats, 'fps', { readonly: true, format: (v: number) => v.toFixed(0) });
    live.addBinding(stats, 'update', { label: 'update ms', readonly: true, format: (v: number) => v.toFixed(2) });
    live.addBinding(stats, 'draw', { label: 'draw ms', readonly: true, format: (v: number) => v.toFixed(2) });
    live.addBinding(stats, 'update', { label: 'update graph', readonly: true, view: 'graph', min: 0, max: 16.7 });
    live.addBinding(stats, 'ticks', { readonly: true, format: (v: number) => v.toFixed(0) });
    // view: 'text' stops Tweakpane from reading a '0x…' string as a color.
    live.addBinding(stats, 'seed', { label: 'RNG seed', readonly: true, view: 'text' });

    const run = pane.addFolder({ title: 'Run' });
    const pauseBtn = run.addButton({ title: label('Pause', 'pauseResume') });
    pauseBtn.on('click', () => editor.togglePause());
    run.addButton({ title: label('Step 1 tick', 'step') }).on('click', () => editor.host.step(1));
    run.addButton({ title: label('Restart (init)', 'restart') }).on('click', () => editor.restart());
    run.addButton({ title: label('Reload cartridge', 'reload') }).on('click', () => editor.loadGame());

    const state = pane.addFolder({ title: 'State' });
    state.addButton({ title: 'Save state' }).on('click', () => void editor.saveState());
    const loadBtn = state.addButton({ title: 'Load state', disabled: !editor.hasSavedState.getState() });
    loadBtn.on('click', () => void editor.loadState());

    const seedFolder = pane.addFolder({ title: 'Seed' });
    seedFolder.addBinding(settings, 'fixedSeed', { label: 'fixed seed' }).on('change', (ev) => {
      editor.setSeed(ev.value ? Number.parseInt(settings.seed, 16) || 1 : null);
    });
    seedFolder.addBinding(settings, 'seed', { label: 'value (hex)', view: 'text' }).on('change', (ev) => {
      if (!settings.fixedSeed) return;
      const n = Number.parseInt(String(ev.value).replace(/^0x/i, ''), 16);
      if (Number.isFinite(n) && n !== editor.project.getState().seed) editor.setSeed(n);
    });
    seedFolder.addButton({ title: 'Use current run seed' }).on('click', () => {
      const s = editor.host.session.getState().stats?.seed;
      if (s !== undefined) editor.setSeed(s);
    });

    const syncSession = () => {
      const s = editor.host.session.getState();
      stats.status = s.status;
      if (s.stats) {
        stats.fps = s.stats.fps;
        stats.update = s.stats.updateMs;
        stats.draw = s.stats.drawMs;
        stats.ticks = s.stats.ticks;
        stats.seed = formatSeed(s.stats.seed);
      }
      pauseBtn.title = label(s.status === 'paused' ? 'Resume' : 'Pause', 'pauseResume');
    };
    const syncProject = () => {
      const seed = editor.project.getState().seed;
      settings.fixedSeed = seed !== null;
      if (seed !== null) settings.seed = formatSeed(seed);
      pane.refresh();
    };
    const unsubs = [
      editor.host.session.subscribe(syncSession),
      editor.project.subscribe(syncProject),
      editor.hasSavedState.subscribe(() => {
        loadBtn.disabled = !editor.hasSavedState.getState();
      }),
    ];
    syncSession();
    // Monitors poll their bound values; this keeps them current between session updates.
    return () => {
      for (const u of unsubs) u();
      pane.dispose();
    };
  }, [editor, touch]);

  return <div ref={ref} className="tf-run" data-testid="run-panel" />;
}
