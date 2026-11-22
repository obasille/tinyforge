// File editing in the editor: the open code editors, file operations as
// undoable commands, and which assets the current game uses.
//
// "Used" is the union of the last successful compile and the live scan of
// the game's open buffers, so an asset counts as used as soon as it is typed,
// before the code compiles.

import { ASSET_KINDS, type AssetLibrary, type AssetList, libraryFromFiles } from '@tinyforge/engine/tooling/asset-scan';
import { assetKindOf, isWritablePath } from '@tinyforge/engine/tooling/project-layout';
import { type ImportDraft, importCommand, sidecarText } from './asset-import.ts';
import { type LibraryAsset, type Sidecar, sidecarPath } from './asset-library.ts';
import { CodeEditor } from './code-editor.ts';
import type { FileCommand } from './commands.ts';
import type { CompilerHost } from './compiler-host.ts';
import { createGame, deleteFiles, fileBatch, renameFiles, writeFile } from './file-commands.ts';
import { filesUnder } from './file-tree.ts';
import type { AssetUse } from './live-scan.ts';
import type { ProjectFiles } from './project-files.ts';
import { createStore, type Store } from './store.ts';
import type { FileChange } from './workspace.ts';

const EMPTY: AssetList = { sprites: [], sfx: [], music: [] };

export class Workbench {
  /** Library assets the current game uses: last compile plus live scan. */
  readonly usedAssets: Store<AssetList> = createStore<AssetList>(EMPTY);
  private readonly editors = new Map<string, Set<CodeEditor>>();
  private readonly liveUses = new Map<string, AssetUse[]>();
  private readonly openListeners = new Set<(path: string) => void>();
  private library: AssetLibrary;
  /** Where to put the cursor in the next code editor opened for a path. */
  private goToOnOpen: { path: string; line: number; column: number } | null = null;

  constructor(
    private readonly files: ProjectFiles,
    /** The command stack (only its file commands are used here). */
    private readonly commands: { runFile(command: FileCommand): Promise<void> },
    private readonly compiler: CompilerHost,
    private readonly currentGame: () => string | null,
  ) {
    this.library = libraryFromFiles(files.assetFiles);
    compiler.builds.subscribe(() => {
      for (const set of this.editors.values()) for (const e of set) e.refreshDiagnostics();
      this.updateUsed();
    });
  }

  /** Ask the UI to show a file (it opens a code panel), optionally at a 1-based line and column. */
  openFile(path: string, at?: { line: number; column?: number }): void {
    this.goToOnOpen = at ? { path, line: at.line, column: at.column ?? 1 } : null;
    for (const listener of [...this.openListeners]) listener(path);
    // Already open: the panel was only brought to front.
    const open = this.editorsFor(path)[0];
    if (at && open) {
      open.goTo(at.line, at.column);
      this.goToOnOpen = null;
    }
  }

  onOpenFile(listener: (path: string) => void): () => void {
    this.openListeners.add(listener);
    return () => {
      this.openListeners.delete(listener);
    };
  }

  /** A code editor for `path` in `parent`. Call its dispose() when the panel closes. */
  createCodeEditor(path: string, parent: HTMLElement): CodeEditor {
    const editor = new CodeEditor(path, parent, {
      read: (p) => this.files.readText(p),
      save: (p, text) => this.save(p, text),
      writable: (p) => this.files.writable && isWritablePath(p) && !this.files.entry(p)?.readonly,
      library: () => this.library,
      diagnostics: (p) => {
        const game = /^games\/([^/]+)\//.exec(p)?.[1];
        const all = Object.entries(this.compiler.builds.getState());
        // A file in a game folder: that game's build. The SDK: any build that reported it.
        const builds = game ? all.filter(([g]) => g === game) : all;
        return builds.flatMap(([, b]) => b.diagnostics.filter((d) => d.path === p));
      },
      onUses: (p, uses) => {
        this.liveUses.set(p, uses);
        this.updateUsed();
      },
    });
    const at = this.goToOnOpen;
    if (at?.path === path) {
      editor.goTo(at.line, at.column);
      // Kept until the panel has mounted: React may mount it twice in a row (StrictMode).
      queueMicrotask(() => {
        if (this.goToOnOpen === at) this.goToOnOpen = null;
      });
    }
    // Compile errors for a game that is not running: build it once for its diagnostics.
    const game = /^games\/([^/]+)\//.exec(path)?.[1];
    if (game && this.files.games.includes(game) && !this.compiler.builds.getState()[game]) {
      void this.compiler.build(game);
    }
    let set = this.editors.get(path);
    if (!set) {
      set = new Set();
      this.editors.set(path, set);
    }
    set.add(editor);
    const dispose = editor.dispose.bind(editor);
    editor.dispose = () => {
      dispose();
      set.delete(editor);
      if (set.size === 0) {
        this.editors.delete(path);
        this.liveUses.delete(path);
        this.updateUsed();
      }
    };
    return editor;
  }

  /** The open editors for a path (for tests and agents). */
  editorsFor(path: string): CodeEditor[] {
    return [...(this.editors.get(path) ?? [])];
  }

  /** Save a file through the command stack (Ctrl+Z restores the previous version). */
  async save(path: string, text: string): Promise<void> {
    await this.commands.runFile(await writeFile(this.files, path, text));
  }

  /** Create a game folder with a starter main.ts, and open it. */
  async createGame(name: string): Promise<void> {
    await this.commands.runFile(await createGame(this.files, name));
    this.openFile(`games/${name}/main.ts`);
  }

  /** Create a file (empty unless `text` is given), and open it. */
  async createFile(path: string, text = ''): Promise<void> {
    if (!isWritablePath(path)) throw new Error(`Cannot create ${path} here`);
    if (this.files.entry(path)) throw new Error(`${path} already exists`);
    await this.commands.runFile(await writeFile(this.files, path, text, `New file ${path.split('/').pop()}`));
    this.openFile(path);
  }

  /** Rename or move a file, or a folder with everything in it. */
  async rename(path: string, to: string): Promise<void> {
    if (path === to) return;
    const sources = filesUnder(this.files.files, path);
    if (sources.length === 0) throw new Error(`${path} not found`);
    const moves = sources.map((from): [string, string] => [from, to + from.slice(path.length)]);
    // A renamed asset file takes its sidecar along (in a folder, it moves with the folder).
    if (sources.length === 1 && assetKindOf(path) && (await this.files.readBytes(sidecarPath(path)))) {
      moves.push([sidecarPath(path), sidecarPath(to)]);
    }
    for (const [from, target] of moves) {
      if (!isWritablePath(from) || !isWritablePath(target)) throw new Error(`Cannot move ${from} to ${target}`);
    }
    const label = `Rename ${path.split('/').pop()}`;
    await this.commands.runFile(renameFiles(this.files, moves, label));
  }

  /** Delete a file, or a folder with everything in it. */
  async delete(path: string): Promise<void> {
    const paths = await this.withSidecars(filesUnder(this.files.files, path));
    if (paths.length === 0) throw new Error(`${path} not found`);
    for (const p of paths) if (!isWritablePath(p)) throw new Error(`${p} is read-only`);
    await this.commands.runFile(await deleteFiles(this.files, paths, `Delete ${path.split('/').pop()}`));
  }

  /** Asset files with their sidecars (`<file>.json`) added. */
  private async withSidecars(paths: string[]): Promise<string[]> {
    const out = new Set(paths);
    for (const p of paths) {
      if (assetKindOf(p) && (await this.files.readBytes(sidecarPath(p)))) out.add(sidecarPath(p));
    }
    return [...out];
  }

  /** Import files into the asset library as one undoable command. */
  async importAssets(drafts: readonly ImportDraft[], assets: readonly LibraryAsset[]): Promise<void> {
    await this.commands.runFile(await importCommand(this.files, drafts, assets));
  }

  /** Write an asset's sidecar; an empty one deletes it. */
  async saveSidecar(assetPath: string, sidecar: Sidecar): Promise<void> {
    const path = sidecarPath(assetPath);
    const empty = Object.values(sidecar).every(
      (v) => v === undefined || v === '' || (Array.isArray(v) && v.length === 0),
    );
    const name = assetPath.split('/').pop();
    if (empty) {
      if (await this.files.readBytes(path))
        await this.commands.runFile(await deleteFiles(this.files, [path], `Clear ${name} info`));
      return;
    }
    await this.commands.runFile(
      await fileBatch(this.files, [{ write: path, data: sidecarText(sidecar) }], `Edit ${name} info`, 'assets.sidecar'),
    );
  }

  /**
   * Files changed: open editors reload or ask; the library may have changed.
   * `affected` are the games whose builds the changes made stale; the ones
   * built before or with open files (other than the running game, which
   * reloads anyway) are rebuilt, so their compile status and errors stay true.
   */
  filesChanged(changes: FileChange[], affected: string[] = []): void {
    const running = this.currentGame();
    const built = this.compiler.builds.getState();
    for (const game of affected) {
      if (game !== running && this.files.games.includes(game) && (built[game] || this.hasOpenFiles(game)))
        void this.compiler.build(game);
    }
    this.library = libraryFromFiles(this.files.assetFiles);
    for (const change of changes) {
      for (const editor of this.editors.get(change.path) ?? []) void editor.diskChanged(change.kind);
    }
    if (changes.some((c) => c.path.startsWith('assets/'))) {
      for (const set of this.editors.values()) for (const e of set) e.refreshDiagnostics();
    }
    this.updateUsed();
  }

  private hasOpenFiles(game: string): boolean {
    return [...this.editors.keys()].some((p) => p.startsWith(`games/${game}/`));
  }

  /** The current game changed. */
  gameChanged(): void {
    this.updateUsed();
  }

  private updateUsed(): void {
    const game = this.currentGame();
    if (!game) {
      this.usedAssets.setState(EMPTY);
      return;
    }
    const built = this.compiler.builds.getState()[game]?.assets ?? EMPTY;
    const used: AssetList = { sprites: [], sfx: [], music: [] };
    for (const kind of ASSET_KINDS) {
      const ids = new Set(built[kind]);
      for (const [p, uses] of this.liveUses) {
        if (!p.startsWith(`games/${game}/`)) continue;
        for (const u of uses) if (u.kind === kind && this.library[kind].has(u.id)) ids.add(u.id);
      }
      used[kind] = [...ids].sort();
    }
    const prev = this.usedAssets.getState();
    if (ASSET_KINDS.every((k) => prev[k].join('\n') === used[k].join('\n'))) return;
    this.usedAssets.setState(used);
  }
}
