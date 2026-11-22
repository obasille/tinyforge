// The code agent's tools, and the rules they enforce whatever the model asks:
// it writes only text files in the current game's folder, reads any project
// file, and cannot write a file it has not read (or that changed since it read
// it). It adds sprites and sounds to the library only through make_sprite and
// make_sound, and replaces an existing asset only once the user says yes.
// There is no shell and no network.
//
// Writes go to disk at once, so compile and hot reload see them. Everything a
// request changed becomes one command (`commit`): one undo step.

import type { AssetKind } from '@tinyforge/engine/tooling/asset-scan';
import type { CompileResult } from '@tinyforge/engine/tooling/compiler';
import { gameOf, isProjectPath } from '@tinyforge/engine/tooling/project-layout';
import { idProblem, type LibraryAsset, type Sidecar, sidecarPath } from '../asset-library.ts';
import type { FileCommand } from '../commands.ts';
import { encodePng } from '../png.ts';
import { type ProjectFiles, parseAssetName } from '../project-files.ts';
import { spriteFileName } from '../sprite-editor.ts';
import { encodeWav } from '../wav.ts';
import type { FileChange } from '../workspace.ts';
import { type PixelSpec, renderPixels } from './pixels.ts';
import type { ToolCall, ToolSpec } from './provider.ts';
import { MUSIC_RATE, renderSynth, SFX_RATE, type SynthSpec } from './synth.ts';

/** What the tools reach in the editor. */
export interface AgentContext {
  files: ProjectFiles;
  game: string;
  /** Compile the game (the editor's build cache). */
  build(): Promise<CompileResult>;
  /** Tell the build cache a file changed (the change event may arrive later). */
  invalidate(changes: FileChange[]): void;
  /** The running game's status and recent log lines. */
  gameLog(): string;
  assets(): LibraryAsset[];
}

const TEXT_FILE = /\.(ts|md|json|txt)$/i;
const WRITABLE_FILE = /\.(ts|md)$/i;
/** Largest file the agent reads or writes, in characters. */
const MAX_TEXT = 200_000;
/** The sidecar mark of an asset the agent made. */
export const AI_GENERATOR = 'tinyforge-ai';
/** Longest wait for the file list to show the assets a request made, before compiling. */
const LIST_WAIT_MS = 5000;

const VOICE_PROPERTIES = {
  wave: { type: 'string', enum: ['square', 'triangle', 'saw', 'sine', 'noise'] },
  vol: { type: 'number', description: '0 to 1, default 0.5' },
  attack: { type: 'number', description: 'Seconds, default 0.002' },
  decay: { type: 'number', description: 'Seconds, default 0.05' },
  sustain: { type: 'number', description: 'Level 0 to 1, default 0.7 (0 with a long decay: a plucked fade)' },
  release: { type: 'number', description: 'Seconds, default 0.05' },
  duty: { type: 'number', description: 'Square duty 0.05 to 0.95, default 0.5; 0.125 and 0.25 sound thin' },
};
const NOTE_SCHEMA = {
  type: 'object',
  properties: {
    at: { type: 'number', description: 'Start (seconds, or beats with bpm)' },
    len: { type: 'number', description: 'Held length (seconds, or beats with bpm)' },
    note: { type: ['string', 'number'], description: 'Note name (C4, F#5, Bb3) or Hz; for noise, the clock in Hz' },
    to: { type: ['string', 'number'], description: 'Slide to this pitch over the note' },
    ...VOICE_PROPERTIES,
  },
  required: ['at', 'len', 'note'],
};
const TRACK_SCHEMA = {
  type: 'object',
  properties: {
    line: {
      type: 'string',
      description: 'One token per step: a note name (or Hz for noise), "." holds, "-" rests. Like "C4 . E4 - G4 . . -"',
    },
    step: { type: 'number', description: 'Length of one token (seconds, or beats with bpm)' },
    at: { type: 'number', description: 'Start, default 0' },
    hold: { type: 'number', description: 'Part of each note that sounds, 0.1 to 1, default 0.9' },
    ...VOICE_PROPERTIES,
  },
  required: ['line', 'step'],
};
const TAGS_SCHEMA = { type: 'array', items: { type: 'string' } };

export const AGENT_TOOLS: ToolSpec[] = [
  {
    name: 'list_files',
    description: "List the current game's files and the SDK files, with their sizes.",
    schema: { properties: {}, required: [] },
  },
  {
    name: 'read_file',
    description:
      "Read a text file by project path: games/<name>/..., engine/sdk/..., or an asset's sidecar (its file name plus .json, like assets/sprites/coin~8x1.png.json; list_assets says which exist). Images and sounds cannot be read. You must read a file before changing it.",
    schema: { properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'edit_file',
    description:
      'Replace one exact passage of a file in the current game. `old` must appear exactly once; include enough surrounding lines to make it unique.',
    schema: {
      properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } },
      required: ['path', 'old', 'new'],
    },
  },
  {
    name: 'write_file',
    description:
      "Create a file in the current game's folder, or replace one you have read. Only .ts and .md files. Prefer edit_file for changes to an existing file.",
    schema: { properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
  {
    name: 'delete_file',
    description: "Delete a file you have read in the current game's folder (not main.ts).",
    schema: { properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'list_assets',
    description: 'List the asset library: sprite IDs with frame size and sheet layout, sound and music IDs, tags.',
    schema: { properties: {}, required: [] },
  },
  {
    name: 'make_sprite',
    description:
      'Add a sprite to the library by drawing it as a text grid: one palette character per pixel, "." transparent. Several frames make a horizontal sheet. At most 64x64 pixels and 16 frames. An ID already in the library replaces that asset once the user agrees (they are asked).',
    schema: {
      properties: {
        id: { type: 'string', description: 'Letters, digits and _; at most 16' },
        palette: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Character to colour, like {"k": "#000000", "r": "#ff2020"}',
        },
        frames: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } },
          description: 'Each frame: its rows, top to bottom, all the same width',
        },
        tags: TAGS_SCHEMA,
      },
      required: ['id', 'palette', 'frames'],
    },
  },
  {
    name: 'make_sound',
    description:
      'Add a sound effect (kind "sfx") or music (kind "music") to the library, made by the chiptune synthesizer the games\' sounds come from: square (pulse, with duty), triangle (8-bit stepped), noise (LFSR; its pitch is the clock, 1000 to 12000 Hz), saw and sine. Give single notes (effects: a pitch slide with `to`, noise bursts) or tracks (music: one line of tokens per voice, like a lead, a bass and a drum line), or both; they may overlap. Times are seconds, or beats when bpm is set. At most 120 s. Music that repeats should set loop. An ID already in the library replaces that asset once the user agrees (they are asked).',
    schema: {
      properties: {
        id: { type: 'string', description: 'Letters, digits and _; at most 16' },
        kind: { type: 'string', enum: ['sfx', 'music'] },
        bpm: { type: 'number' },
        volume: {
          type: 'number',
          description: 'Peak volume 0 to 1; default 0.35 for sfx, 0.5 for music (like the games)',
        },
        loop: { type: 'boolean', description: 'No fade-out at the end, for music that loops' },
        notes: { type: 'array', items: NOTE_SCHEMA },
        tracks: { type: 'array', items: TRACK_SCHEMA },
        tags: TAGS_SCHEMA,
      },
      required: ['id', 'kind'],
    },
  },
  {
    name: 'compile',
    description: 'Compile the current game. Returns "ok" or the errors. Compile before you finish.',
    schema: { properties: {}, required: [] },
  },
  {
    name: 'game_log',
    description:
      'The running game: its status (running, paused, crashed, hung) and its recent log lines. The game hot reloads after each change that compiles.',
    schema: { properties: {}, required: [] },
  },
];

export class ToolError extends Error {}

/** One file a request changed. A binary file (an image, a sound) has empty text for its before and after. */
export interface FileChangeView {
  path: string;
  before: string | null;
  after: string | null;
  binary: boolean;
}

const str = (input: Record<string, unknown>, key: string): string => {
  const value = input[key];
  if (typeof value !== 'string') throw new ToolError(`Missing "${key}" (a string)`);
  return value;
};

export class AgentTools {
  /** Each changed path's bytes before the request (null: it did not exist). */
  private readonly before = new Map<string, Uint8Array | null>();
  /** Each changed path's content now (null: deleted). */
  private readonly after = new Map<string, Uint8Array | string | null>();
  /** What the agent last read or wrote per path. */
  private readonly seen = new Map<string, string | null>();
  /** The user's request, kept in a made asset's sidecar. */
  private request = '';

  /** `confirm` asks the user a yes or no question (the agent pauses until they answer). */
  constructor(
    private readonly ctx: AgentContext,
    private readonly confirm: (question: string) => Promise<boolean> = async () => false,
  ) {}

  /** Count a file as read: its text was shown to the model another way. */
  markSeen(path: string, text: string): void {
    this.seen.set(path, text);
  }

  /** Start a new request: forget the previous request's changes (not what was read). */
  begin(request = ''): void {
    this.before.clear();
    this.after.clear();
    this.request = request;
  }

  /** What this request changed, file by file. */
  changes(): FileChangeView[] {
    return [...this.after].map(([path, after]) => {
      const before = this.before.get(path) ?? null;
      const binary = !TEXT_FILE.test(path);
      const text = (data: Uint8Array | string | null) =>
        data === null ? null : binary ? '' : typeof data === 'string' ? data : new TextDecoder().decode(data);
      return { path, before: text(before), after: text(after), binary };
    });
  }

  async run(call: ToolCall): Promise<string> {
    const { input } = call;
    switch (call.name) {
      case 'list_files':
        return this.listFiles();
      case 'read_file':
        return this.read(str(input, 'path'));
      case 'edit_file':
        return this.edit(str(input, 'path'), str(input, 'old'), str(input, 'new'));
      case 'write_file':
        return this.write(str(input, 'path'), str(input, 'content'));
      case 'delete_file':
        return this.remove(str(input, 'path'));
      case 'list_assets':
        return this.listAssets();
      case 'make_sprite':
        return this.makeSprite(input);
      case 'make_sound':
        return this.makeSound(input);
      case 'compile':
        return this.compile();
      case 'game_log':
        return this.ctx.gameLog();
      default:
        throw new ToolError(`Unknown tool ${call.name}`);
    }
  }

  private listFiles(): string {
    const { files, game } = this.ctx;
    const lines = files.files
      .filter((f) => f.path.startsWith(`games/${game}/`) || f.path.startsWith('engine/sdk/'))
      .map((f) => `${f.path} (${f.size} bytes)`);
    return lines.join('\n') || '(no files)';
  }

  private async read(path: string): Promise<string> {
    if (!isProjectPath(path)) throw new ToolError(`Invalid path "${path}"`);
    if (!TEXT_FILE.test(path)) throw new ToolError(`${path} is not a text file`);
    const text = await this.ctx.files.readText(path);
    if (text === null) {
      // A common guess: the sidecar named after the ID rather than the file.
      const kind = /^assets\/([^/]+)\//.exec(path)?.[1];
      const sidecars = this.ctx.files.files.filter(
        (f) => kind && f.path.startsWith(`assets/${kind}/`) && f.path.endsWith('.json'),
      );
      const hint = kind
        ? ` A sidecar is named after the asset's file (assets/${kind}/<file>.json); list_assets shows the files and their sidecars.${sidecars.length === 0 ? ` No ${kind} asset has one.` : ''}`
        : '';
      throw new ToolError(`${path} not found.${hint}`);
    }
    if (text.length > MAX_TEXT) throw new ToolError(`${path} is too large (${text.length} characters)`);
    this.seen.set(path, text);
    return text;
  }

  /** The current text of a file the agent may change, checking it read the latest version. */
  private async current(path: string): Promise<string | null> {
    const { game } = this.ctx;
    if (!isProjectPath(path) || gameOf(path) !== game) {
      throw new ToolError(`You can only change files in games/${game}/`);
    }
    if (!WRITABLE_FILE.test(path)) throw new ToolError('You can only write .ts and .md files');
    const text = await this.ctx.files.readText(path);
    if (text !== null && this.seen.get(path) !== text) {
      throw new ToolError(
        this.seen.has(path)
          ? `${path} changed since you last read it (the user may have edited it). Read it again.`
          : `Read ${path} before changing it.`,
      );
    }
    return text;
  }

  private async edit(path: string, old: string, replacement: string): Promise<string> {
    const text = await this.current(path);
    if (text === null) throw new ToolError(`${path} not found`);
    const count = old ? text.split(old).length - 1 : 0;
    if (count !== 1) {
      throw new ToolError(
        count === 0
          ? `The passage was not found in ${path}`
          : `The passage appears ${count} times; include more context`,
      );
    }
    await this.save(
      path,
      text,
      text.replace(old, () => replacement),
    );
    return `Edited ${path}`;
  }

  private async write(path: string, content: string): Promise<string> {
    if (content.length > MAX_TEXT) throw new ToolError(`Too large (${content.length} characters)`);
    const text = await this.current(path);
    await this.save(path, text, content);
    return text === null ? `Created ${path}` : `Replaced ${path}`;
  }

  private async remove(path: string): Promise<string> {
    if (path === `games/${this.ctx.game}/main.ts`) throw new ToolError('main.ts cannot be deleted');
    const text = await this.current(path);
    if (text === null) throw new ToolError(`${path} not found`);
    await this.put(path, null);
    this.seen.set(path, null);
    return `Deleted ${path}`;
  }

  private async save(path: string, before: string | null, content: string): Promise<void> {
    if (!this.before.has(path)) this.before.set(path, before === null ? null : new TextEncoder().encode(before));
    await this.put(path, content);
    this.seen.set(path, content);
  }

  /** Write (or delete, with null) a file, keeping what it was before the request. */
  private async put(path: string, data: Uint8Array | string | null): Promise<void> {
    const { files } = this.ctx;
    const existed = files.exists(path);
    if (!this.before.has(path)) this.before.set(path, existed ? await files.readBytes(path) : null);
    if (data === null) await files.delete(path);
    else await files.write(path, data);
    this.after.set(path, data);
    this.ctx.invalidate([{ path, kind: data === null ? 'unlink' : existed ? 'change' : 'add' }]);
  }

  /**
   * Write a made asset as `assets/<kind>/<file>` with its sidecar. An ID
   * already in the library is replaced once the user says yes (its old files
   * go when the new file name differs, as for a sheet with more frames); one
   * this request made is replaced without asking.
   */
  private async putAsset(
    kind: AssetKind,
    id: string,
    file: string,
    data: Uint8Array,
    spec: unknown,
    tags: unknown,
  ): Promise<string> {
    const { files } = this.ctx;
    const path = `assets/${kind}/${file}`;
    const sameId = (p: string) => p.startsWith(`assets/${kind}/`) && parseAssetName(p.split('/')[2]).id === id;
    const old = this.ctx.assets().filter((a) => a.kind === kind && a.id === id);
    // An asset this request already wrote or removed was settled earlier in the request.
    const theirs = old.filter((a) => !this.after.has(a.path));
    if (theirs.length > 0) {
      const used = [...new Set(theirs.flatMap((a) => a.usedBy))];
      const what = kind === 'sprites' ? 'sprite' : kind === 'sfx' ? 'sound' : 'music';
      const question = `Replace the ${what} "${id}" (${theirs.map((a) => a.path).join(', ')})?${used.length ? ` Used by: ${used.join(', ')}.` : ''}`;
      if (!(await this.confirm(question))) {
        throw new ToolError(`The user chose to keep ${kind} "${id}". Pick another ID, or ask them.`);
      }
    }
    // The assets this request made may not be in the library yet.
    const stale = new Set([...old].map((a) => a.path));
    for (const [p, v] of this.after) if (v !== null && sameId(p) && !p.endsWith('.json')) stale.add(p);
    stale.delete(path);
    for (const p of stale) {
      if (files.exists(p)) await this.put(p, null);
      if (files.exists(sidecarPath(p))) await this.put(sidecarPath(p), null);
    }
    const sidecar: Sidecar = { source: 'TinyForge AI', prompt: this.request, generator: AI_GENERATOR, spec };
    if (Array.isArray(tags) && tags.every((t) => typeof t === 'string') && tags.length > 0) sidecar.tags = tags;
    await this.put(path, data);
    await this.put(sidecarPath(path), `${JSON.stringify(sidecar, null, 2)}\n`);
    return path;
  }

  private assetId(input: Record<string, unknown>): string {
    const id = str(input, 'id');
    const problem = idProblem(id);
    if (problem) throw new ToolError(problem);
    return id;
  }

  private async makeSprite(input: Record<string, unknown>): Promise<string> {
    const id = this.assetId(input);
    const spec = { palette: input.palette, frames: input.frames } as PixelSpec;
    let image: ReturnType<typeof renderPixels>;
    try {
      image = renderPixels(spec);
    } catch (e) {
      throw new ToolError((e as Error).message);
    }
    const file = spriteFileName(`${id}.png`, image.frames, 1);
    const path = await this.putAsset('sprites', id, file, await encodePng(image), spec, input.tags);
    const frame = `${image.width / image.frames}x${image.height}`;
    return `Made ${path}: ${image.frames} frame${image.frames > 1 ? 's' : ''} of ${frame}`;
  }

  private async makeSound(input: Record<string, unknown>): Promise<string> {
    const id = this.assetId(input);
    const kind = input.kind;
    if (kind !== 'sfx' && kind !== 'music') throw new ToolError('kind must be "sfx" or "music"');
    const { bpm, volume, loop, notes, tracks } = input;
    const spec = Object.fromEntries(
      Object.entries({ bpm, volume, loop, notes, tracks }).filter(([, v]) => v !== undefined),
    ) as SynthSpec;
    let sound: ReturnType<typeof renderSynth>;
    try {
      // The scripts' rates and loudness, so made sounds match the games' own.
      sound = renderSynth(
        spec,
        kind === 'music' ? { sampleRate: MUSIC_RATE, volume: 0.5 } : { sampleRate: SFX_RATE, volume: 0.35 },
      );
    } catch (e) {
      throw new ToolError((e as Error).message);
    }
    const path = await this.putAsset(kind, id, `${id}.wav`, encodeWav(sound), spec, input.tags);
    return `Made ${path}: ${(sound.channels[0].length / sound.sampleRate).toFixed(2)} s`;
  }

  /**
   * The compiler finds asset IDs in the file list, which shows a written file
   * once the workspace reports it: wait for the assets this request made.
   */
  private async listed(): Promise<void> {
    const { files } = this.ctx;
    const ready = () =>
      [...this.after].every(([p, v]) => !p.startsWith('assets/') || (files.entry(p) !== undefined) === (v !== null));
    if (ready()) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        off();
        resolve();
      };
      const timer = setTimeout(done, LIST_WAIT_MS);
      const off = files.onChange(() => {
        if (ready()) done();
      });
    });
  }

  private listAssets(): string {
    const { files } = this.ctx;
    const lines = this.ctx.assets().map((a) => {
      const extra = [
        a.sidecar?.tags?.length ? `tags: ${a.sidecar.tags.join(', ')}` : '',
        a.usedBy.length ? `used by: ${a.usedBy.join(', ')}` : '',
        files.exists(sidecarPath(a.path)) ? `sidecar: ${sidecarPath(a.path)}` : '',
      ].filter(Boolean);
      const more = extra.length ? `; ${extra.join('; ')}` : '';
      if (a.kind !== 'sprites') return `${a.kind} ${a.id}: ${a.path}${more}`;
      const frame = a.image ? `${a.image.width / a.cols}x${a.image.height / a.rows}` : '?';
      return `sprite ${a.id}: ${a.path}, frame ${frame}, ${a.cols}x${a.rows} frames${more}`;
    });
    return lines.join('\n') || '(the library is empty)';
  }

  private async compile(): Promise<string> {
    await this.listed();
    const result = await this.ctx.build();
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    if (result.ok) return errors.length === 0 ? 'ok' : `ok, with messages:\n${result.log.slice(-4000)}`;
    if (errors.length === 0) return `Failed:\n${result.log.slice(-4000)}`;
    return `Failed:\n${errors
      .slice(0, 30)
      .map((d) => `${d.path ?? '?'}:${d.line}:${d.column} ${d.message}`)
      .join('\n')}`;
  }

  /**
   * Everything this request changed, as one undoable command. The changes are
   * already on disk, so the first apply does nothing; a redo writes them again.
   */
  commit(label: string): FileCommand | null {
    if (this.before.size === 0) return null;
    const { files } = this.ctx;
    const before = [...this.before];
    const after = [...this.after];
    let onDisk = true;
    return {
      type: 'ai.request',
      label,
      args: { paths: before.map(([p]) => p) },
      async apply() {
        if (onDisk) {
          onDisk = false;
          return;
        }
        for (const [path, content] of after) {
          if (content !== null) await files.write(path, content);
          else if (files.exists(path)) await files.delete(path);
        }
      },
      async revert() {
        for (const [path, bytes] of [...before].reverse()) {
          if (bytes) await files.write(path, bytes);
          else if (files.exists(path)) await files.delete(path);
        }
      },
    };
  }
}
