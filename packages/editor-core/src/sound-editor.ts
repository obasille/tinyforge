// The sound player's model: one sound effect or music track as samples,
// a selection, and the edits (trim, cut, fades, normalize). Plain TS:
// Waveform draws it, the React panel renders the buttons from `state`.
//
// Like the sprite editor, edits stay in memory (with their own undo) until
// Save, which writes a 16-bit WAV through the command stack. An MP3 or OGG
// is saved as a WAV under the same ID; its sidecar follows.

import { sidecarPath } from './asset-library.ts';
import type { FileCommand } from './commands.ts';
import { type FileOp, fileBatch } from './file-commands.ts';
import type { ProjectFiles } from './project-files.ts';
import { createStore, type Store } from './store.ts';
import {
  cutSound,
  decodeWav,
  encodeWav,
  fadeSound,
  normalizeSound,
  type Sound,
  soundLength,
  trimSound,
} from './wav.ts';
import type { FileChange } from './workspace.ts';

/** Plays a stretch of a sound; the editor's is the Web Audio one in sound-view.ts. */
export interface SoundOutput {
  /** Start playing [from, to) of the sound; `onEnd` runs when it stops by itself. */
  play(sound: Sound, from: number, to: number, onEnd: () => void): void;
  stop(): void;
  /** The sample playing now, or null. */
  position(): number | null;
}

export interface SoundEditorHost {
  files: ProjectFiles;
  commands: { runFile(command: FileCommand): Promise<void> };
  /** Decodes a sound the WAV reader does not read (MP3, OGG). */
  decodeAudio?: (bytes: Uint8Array) => Promise<Sound>;
  output?: SoundOutput;
}

export interface SoundEditorState {
  path: string;
  ready: boolean;
  error: string | null;
  sampleRate: number;
  channelCount: number;
  /** Length in samples. */
  length: number;
  /** Selected samples [from, to), or null for none. */
  selection: { from: number; to: number } | null;
  /** Where playback starts without a selection. */
  cursor: number;
  playing: boolean;
  /** Play the selection (or the sound) over and over. */
  loop: boolean;
  dirty: boolean;
  saving: boolean;
  conflict: null | 'changed' | 'deleted';
  canUndo: boolean;
  canRedo: boolean;
  version: number;
}

const MAX_HISTORY = 50;

/** The WAV file name for a sound file (same ID and info, `.wav`). */
export const wavFileName = (file: string) => file.replace(/\.[^/.]+$/, '.wav');

export class SoundEditor {
  readonly state: Store<SoundEditorState>;
  sound: Sound = { sampleRate: 44100, channels: [new Float32Array()] };
  private undoStack: Sound[] = [];
  private redoStack: Sound[] = [];
  private disk: Uint8Array | null = null;
  private stopWatch: () => void;
  private disposed = false;

  constructor(
    path: string,
    private readonly host: SoundEditorHost,
  ) {
    this.state = createStore<SoundEditorState>({
      path,
      ready: false,
      error: null,
      sampleRate: 44100,
      channelCount: 1,
      length: 0,
      selection: null,
      cursor: 0,
      playing: false,
      loop: false,
      dirty: false,
      saving: false,
      conflict: null,
      canUndo: false,
      canRedo: false,
      version: 0,
    });
    this.stopWatch = host.files.onChange((changes) => void this.filesChanged(changes));
  }

  get path(): string {
    return this.state.getState().path;
  }

  private update(patch: Partial<SoundEditorState>): void {
    this.state.setState((s) => ({ ...s, ...patch }));
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.stopWatch();
  }

  async load(): Promise<void> {
    const bytes = await this.host.files.readBytes(this.path);
    if (this.disposed) return;
    if (!bytes) {
      this.update({ error: `${this.path} not found` });
      return;
    }
    try {
      this.setSound(await this.decode(bytes), bytes);
    } catch (e) {
      this.update({ error: `Cannot read ${this.path}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  private async decode(bytes: Uint8Array): Promise<Sound> {
    const wav = decodeWav(bytes);
    if (wav) return wav;
    if (!this.host.decodeAudio) throw new Error('unsupported sound format');
    return this.host.decodeAudio(bytes);
  }

  private setSound(sound: Sound, bytes: Uint8Array): void {
    this.stop();
    this.sound = sound;
    this.disk = bytes;
    this.undoStack = [];
    this.redoStack = [];
    this.update({
      ready: true,
      error: null,
      sampleRate: sound.sampleRate,
      channelCount: sound.channels.length,
      length: soundLength(sound),
      selection: null,
      cursor: 0,
      dirty: false,
      conflict: null,
      canUndo: false,
      canRedo: false,
      version: this.state.getState().version + 1,
    });
  }

  // --- Selection and playback ----------------------------------------------

  /** Select [a, b) (in any order); an empty range clears the selection and sets the cursor. */
  select(a: number, b: number): void {
    const len = soundLength(this.sound);
    const from = Math.max(0, Math.min(len, Math.round(Math.min(a, b))));
    const to = Math.max(0, Math.min(len, Math.round(Math.max(a, b))));
    if (to - from < 1) this.update({ selection: null, cursor: from });
    else this.update({ selection: { from, to }, cursor: from });
  }

  selectAll(): void {
    this.select(0, soundLength(this.sound));
  }

  /** The range edits and playback use: the selection, or the whole sound. */
  range(): { from: number; to: number } {
    return this.state.getState().selection ?? { from: 0, to: soundLength(this.sound) };
  }

  play(): void {
    const out = this.host.output;
    if (!out || !this.state.getState().ready) return;
    const s = this.state.getState();
    const { from, to } = s.selection ?? {
      from: s.cursor >= soundLength(this.sound) ? 0 : s.cursor,
      to: soundLength(this.sound),
    };
    out.stop();
    this.update({ playing: true });
    out.play(this.sound, from, to, () => {
      if (this.disposed) return;
      if (this.state.getState().loop && this.state.getState().playing) this.play();
      else this.update({ playing: false });
    });
  }

  stop(): void {
    this.host.output?.stop();
    if (this.state.getState().playing) this.update({ playing: false });
  }

  togglePlay(): void {
    if (this.state.getState().playing) this.stop();
    else this.play();
  }

  toggleLoop(): void {
    this.update({ loop: !this.state.getState().loop });
  }

  /** The sample playing now, for the playhead. */
  position(): number | null {
    return this.state.getState().playing ? (this.host.output?.position() ?? null) : null;
  }

  // --- Edits ----------------------------------------------------------------

  private apply(next: Sound, selection: SoundEditorState['selection']): void {
    this.stop();
    this.undoStack.push(this.sound);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.sound = next;
    this.changed(selection);
  }

  private changed(selection: SoundEditorState['selection']): void {
    const length = soundLength(this.sound);
    this.update({
      length,
      selection: selection && selection.to <= length ? selection : null,
      cursor: Math.min(this.state.getState().cursor, length),
      dirty: true,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      version: this.state.getState().version + 1,
    });
  }

  /** Keep only the selection. */
  trim(): void {
    const sel = this.state.getState().selection;
    if (!sel) return;
    this.apply(trimSound(this.sound, sel.from, sel.to), null);
  }

  /** Remove the selection. */
  cut(): void {
    const sel = this.state.getState().selection;
    if (!sel || sel.to - sel.from >= soundLength(this.sound)) return;
    this.apply(cutSound(this.sound, sel.from, sel.to), null);
    this.update({ cursor: sel.from });
  }

  fade(direction: 'in' | 'out'): void {
    const { from, to } = this.range();
    this.apply(fadeSound(this.sound, from, to, direction), this.state.getState().selection);
  }

  normalize(): void {
    const { from, to } = this.range();
    const next = normalizeSound(this.sound, from, to, 0.98);
    if (next === this.sound) return;
    this.apply(next, this.state.getState().selection);
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.stop();
    this.redoStack.push(this.sound);
    this.sound = prev;
    this.changed(this.state.getState().selection);
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.stop();
    this.undoStack.push(this.sound);
    this.sound = next;
    this.changed(this.state.getState().selection);
    return true;
  }

  // --- Files ----------------------------------------------------------------

  /** Write the sound as a 16-bit WAV (one undoable file command). */
  async save(): Promise<void> {
    const s = this.state.getState();
    if (!s.ready || s.saving) return;
    this.update({ saving: true, error: null });
    try {
      const bytes = encodeWav(this.sound);
      const dir = this.path.slice(0, this.path.lastIndexOf('/') + 1);
      const target = dir + wavFileName(this.path.slice(dir.length));
      const ops: FileOp[] = [{ write: target, data: bytes }];
      if (target !== this.path) {
        if (this.host.files.entry(target)) throw new Error(`${target} already exists`);
        const side = await this.host.files.readBytes(sidecarPath(this.path));
        ops.push({ delete: this.path });
        if (side) ops.push({ delete: sidecarPath(this.path) }, { write: sidecarPath(target), data: side });
      }
      this.disk = bytes;
      const name = target.slice(dir.length);
      await this.host.commands.runFile(await fileBatch(this.host.files, ops, `Edit ${name}`, 'sounds.save'));
      this.update({ path: target, dirty: false, conflict: null, saving: false });
    } catch (e) {
      this.update({ saving: false, error: `Save failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  reloadFromDisk(): Promise<void> {
    return this.load();
  }

  keepMine(): void {
    this.update({ conflict: null });
  }

  private async filesChanged(changes: FileChange[]): Promise<void> {
    const mine = changes.find((c) => c.path === this.path);
    if (!mine || this.disposed) return;
    if (mine.kind === 'unlink') {
      if (this.state.getState().saving || this.host.files.entry(this.path)) return;
      this.update({ conflict: 'deleted', dirty: true });
      return;
    }
    const bytes = await this.host.files.readBytes(this.path);
    if (!bytes || this.disposed) return;
    if (this.disk && bytes.length === this.disk.length && bytes.every((b, i) => b === this.disk?.[i])) return;
    if (!this.state.getState().dirty) {
      try {
        this.setSound(await this.decode(bytes), bytes);
      } catch (e) {
        this.update({ error: `Cannot read ${this.path}: ${e instanceof Error ? e.message : String(e)}` });
      }
      return;
    }
    this.update({ conflict: 'changed' });
  }
}
