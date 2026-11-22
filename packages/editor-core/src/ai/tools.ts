// The code agent's tools, and the rules they enforce whatever the model asks:
// it writes only text files in the current game's folder, reads any project
// file, and cannot write a file it has not read (or that changed since it read
// it). There is no shell and no network.
//
// Writes go to disk at once, so compile and hot reload see them. Everything a
// request changed becomes one command (`commit`): one undo step.

import type { CompileResult } from '@tinyforge/engine/tooling/compiler';
import { gameOf, isProjectPath } from '@tinyforge/engine/tooling/project-layout';
import type { LibraryAsset } from '../asset-library.ts';
import type { FileCommand } from '../commands.ts';
import type { ProjectFiles } from '../project-files.ts';
import type { FileChange } from '../workspace.ts';
import type { ToolCall, ToolSpec } from './provider.ts';

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

export const AGENT_TOOLS: ToolSpec[] = [
  {
    name: 'list_files',
    description: "List the current game's files and the SDK files, with their sizes.",
    schema: { properties: {}, required: [] },
  },
  {
    name: 'read_file',
    description:
      'Read a text file by project path (games/<name>/..., engine/sdk/..., assets/<kind>/<file>.json). You must read a file before changing it.',
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

const str = (input: Record<string, unknown>, key: string): string => {
  const value = input[key];
  if (typeof value !== 'string') throw new ToolError(`Missing "${key}" (a string)`);
  return value;
};

export class AgentTools {
  /** Each changed path's bytes before the request (null: it did not exist). */
  private readonly before = new Map<string, Uint8Array | null>();
  /** Each changed path's content now (null: deleted). */
  private readonly after = new Map<string, string | null>();
  /** What the agent last read or wrote per path. */
  private readonly seen = new Map<string, string | null>();

  constructor(private readonly ctx: AgentContext) {}

  /** Count a file as read: its text was shown to the model another way. */
  markSeen(path: string, text: string): void {
    this.seen.set(path, text);
  }

  /** Start a new request: forget the previous request's changes (not what was read). */
  begin(): void {
    this.before.clear();
    this.after.clear();
  }

  /** What this request changed, file by file. */
  changes(): Array<{ path: string; before: string | null; after: string | null }> {
    const decode = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);
    return [...this.after].map(([path, after]) => ({ path, before: decode(this.before.get(path) ?? null), after }));
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
    if (text === null) throw new ToolError(`${path} not found`);
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
    this.remember(path, text);
    await this.ctx.files.delete(path);
    this.after.set(path, null);
    this.seen.set(path, null);
    this.ctx.invalidate([{ path, kind: 'unlink' }]);
    return `Deleted ${path}`;
  }

  private async save(path: string, before: string | null, content: string): Promise<void> {
    this.remember(path, before);
    await this.ctx.files.write(path, content);
    this.after.set(path, content);
    this.seen.set(path, content);
    this.ctx.invalidate([{ path, kind: before === null ? 'add' : 'change' }]);
  }

  private remember(path: string, text: string | null): void {
    if (!this.before.has(path)) this.before.set(path, text === null ? null : new TextEncoder().encode(text));
  }

  private listAssets(): string {
    const lines = this.ctx.assets().map((a) => {
      const tags = a.sidecar?.tags?.length ? ` tags: ${a.sidecar.tags.join(', ')}` : '';
      if (a.kind !== 'sprites') return `${a.kind} ${a.id}${tags}`;
      const frame = a.image ? `${a.image.width / a.cols}x${a.image.height / a.rows}` : '?';
      return `sprite ${a.id} frame ${frame}, ${a.cols}x${a.rows} frames${tags}`;
    });
    return lines.join('\n') || '(the library is empty)';
  }

  private async compile(): Promise<string> {
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
