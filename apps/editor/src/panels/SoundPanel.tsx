// The sound player: a waveform (editor-core sound-view.ts) with a selection,
// playback, and trim, cut, fades and normalize. Edits have their own undo
// inside the panel; Save writes a WAV as one undoable file command.

import { formatTime, SoundEditor, Waveform, WebSoundOutput } from '@tinyforge/editor-core';
import type { IDockviewPanelProps } from 'dockview-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../EditorContext.ts';
import { useSaveShortcut, useStore } from '../hooks.ts';

export interface SoundPanelParams {
  path: string;
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export function SoundPanel({ api, params }: IDockviewPanelProps<SoundPanelParams>) {
  const editor = useEditor();
  const [initial] = useState(params.path);
  // Stable, so the view's title effect runs only when the title or path changes.
  const setTitle = useCallback(
    (title: string, path: string) => {
      api.setTitle(title);
      api.updateParameters({ path });
    },
    [api],
  );
  const [sound, setSound] = useState<SoundEditor | null>(null);

  useEffect(() => {
    const output = new WebSoundOutput(() => {
      const { volume, muted } = editor.audioSettings.getState();
      return muted ? 0 : volume;
    });
    const created = new SoundEditor(initial, {
      files: editor.files,
      commands: editor.commands,
      decodeAudio: (bytes) => output.decode(bytes),
      output,
    });
    void created.load();
    setSound(created);
    if (import.meta.env.DEV) editor.openSounds.add(created);
    return () => {
      editor.openSounds.delete(created);
      created.dispose();
      output.dispose();
    };
  }, [editor, initial]);

  useSaveShortcut(api, () => {
    if (!sound || !editor.files.state.getState().writable) return;
    const { dirty, saving } = sound.state.getState();
    if (dirty && !saving) void sound.save();
  });

  return sound ? <SoundEditorView sound={sound} setTitle={setTitle} /> : null;
}

function SoundEditorView({ sound, setTitle }: { sound: SoundEditor; setTitle: (title: string, path: string) => void }) {
  const editor = useEditor();
  const s = useStore(sound.state);
  const writable = useStore(editor.files.state).writable;
  const waveRef = useRef<HTMLDivElement>(null);
  const name = baseName(s.path);

  useEffect(() => setTitle(s.dirty ? `● ${name}` : name, s.path), [s.dirty, name, s.path, setTitle]);

  useEffect(() => {
    const el = waveRef.current;
    if (!el) return;
    const view = new Waveform(el, sound);
    return () => view.dispose();
  }, [sound]);

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && (key === 'z' || key === 'y')) {
      e.preventDefault();
      const redo = key === 'y' || e.shiftKey;
      if (!(redo ? sound.redo() : sound.undo())) editor.runShortcut(redo ? 'redo' : 'undo');
    } else if (ctrl && key === 'a') {
      e.preventDefault();
      sound.selectAll();
    } else if (key === ' ' && !ctrl) {
      e.preventDefault();
      sound.togglePlay();
    } else if ((key === 'delete' || key === 'backspace') && s.selection) {
      e.preventDefault();
      sound.cut();
    }
  };

  const sel = s.selection;
  const time = (n: number) => formatTime(n, s.sampleRate);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard shortcuts for the player inside; every action also has a button
    <div className="tf-sound" data-testid={`sound-${s.path}`} data-local-history="true" tabIndex={-1} onKeyDown={onKey}>
      <div className="tf-sprite-bar">
        <div className="tf-sprite-group">
          <button
            type="button"
            data-testid="sound-play"
            title="Play or stop (Space)"
            onClick={() => sound.togglePlay()}
          >
            {s.playing ? '■ Stop' : '▶ Play'}
          </button>
          <button
            type="button"
            className={s.loop ? 'tf-sprite-on' : ''}
            aria-pressed={s.loop}
            onClick={() => sound.toggleLoop()}
          >
            Loop
          </button>
          <button type="button" title="Select all (Ctrl+A)" onClick={() => sound.selectAll()}>
            Select all
          </button>
        </div>
        <div className="tf-sprite-group">
          <button
            type="button"
            data-testid="sound-trim"
            disabled={!sel}
            title="Keep only the selection"
            onClick={() => sound.trim()}
          >
            Trim
          </button>
          <button type="button" disabled={!sel} title="Remove the selection (Delete)" onClick={() => sound.cut()}>
            Cut
          </button>
          <button type="button" title="Fade in the selection (or the whole sound)" onClick={() => sound.fade('in')}>
            Fade in
          </button>
          <button type="button" title="Fade out the selection (or the whole sound)" onClick={() => sound.fade('out')}>
            Fade out
          </button>
          <button type="button" title="Make the loudest sample full scale" onClick={() => sound.normalize()}>
            Normalize
          </button>
        </div>
        <div className="tf-sprite-group tf-sprite-right">
          <button type="button" disabled={!s.canUndo} title="Undo (Ctrl+Z)" onClick={() => sound.undo()}>
            Undo
          </button>
          <button type="button" disabled={!s.canRedo} title="Redo (Ctrl+Shift+Z)" onClick={() => sound.redo()}>
            Redo
          </button>
          {writable ? (
            <button
              type="button"
              className="tf-sprite-save"
              data-testid="sound-save"
              disabled={!s.dirty || s.saving}
              title="Save as WAV (Ctrl+S)"
              onClick={() => void sound.save()}
            >
              Save
            </button>
          ) : null}
        </div>
      </div>
      {s.error ? (
        <div className="tf-code-bar tf-code-error" role="alert">
          {s.error}
        </div>
      ) : null}
      {s.conflict ? (
        <div className="tf-code-bar tf-code-conflict" data-testid="sound-conflict">
          {s.conflict === 'changed'
            ? `${name} changed on disk while you were editing it.`
            : `${name} was deleted on disk. Save to create it again.`}
          {s.conflict === 'changed' ? (
            <button type="button" onClick={() => void sound.reloadFromDisk()}>
              Use the file on disk
            </button>
          ) : null}
          <button type="button" onClick={() => sound.keepMine()}>
            Keep my version
          </button>
        </div>
      ) : null}
      <div className="tf-sound-wave" ref={waveRef} />
      <div className="tf-sprite-status" data-testid="sound-status">
        <span>
          {time(s.length)} · {s.sampleRate} Hz · {s.channelCount === 1 ? 'mono' : `${s.channelCount} channels`}
        </span>
        <span>
          {sel
            ? `selection ${time(sel.from)} – ${time(sel.to)} (${time(sel.to - sel.from)})`
            : `cursor ${time(s.cursor)}`}
        </span>
        {!/\.wav$/i.test(s.path) ? <span className="tf-lib-warn">Saves as WAV</span> : null}
      </div>
    </div>
  );
}
