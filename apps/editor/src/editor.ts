// Composition root: wires editor-core pieces together for the browser.
// Plain TS; React components get this object and subscribe to its stores.

import {
  AssetLibrary,
  type AssetList,
  type AssetManifest,
  AudioPlayer,
  CommandStack,
  CompilerHost,
  createStore,
  emptyProject,
  type FileChange,
  GameCatalog,
  GameHost,
  type GameMetaInfo,
  InputTracker,
  type PixelInfo,
  PixelProbe,
  type ProjectFiles,
  type ProjectState,
  pixelHex,
  projectCommands,
  type ShortcutAction,
  type SoundEditor,
  type SpriteEditor,
  type Store,
  Viewport,
  Workbench,
} from '@tinyforge/editor-core';
import CompileWorker from '@tinyforge/editor-core/compile-worker?worker';
import GameWorker from '@tinyforge/editor-core/game-worker?worker';
import { assetId } from '@tinyforge/engine/tooling/asset-scan';
import { parseGameMeta } from '@tinyforge/engine/tooling/game-meta';
import { assetKindOf, gameEntryPath } from '@tinyforge/engine/tooling/project-layout';
import { createLayoutMode } from './layout-mode.ts';
import { createLogStore, type LogStore } from './log-store.ts';
import { createTouchPanels } from './touch-panels.ts';

const PROJECT_KEY = 'tinyforge.editor.project';

function loadProject(games: string[]): ProjectState {
  try {
    const saved = JSON.parse(localStorage.getItem(PROJECT_KEY) ?? 'null') as ProjectState | null;
    if (saved?.version === 1)
      return { ...emptyProject(), ...saved, game: saved.game && games.includes(saved.game) ? saved.game : null };
  } catch {
    // Unreadable or blocked storage: start fresh.
  }
  return emptyProject();
}

const AUDIO_KEY = 'tinyforge.editor.audio';

/** Master sound settings. A preference of this browser, not part of the project. */
export interface AudioSettings {
  volume: number;
  muted: boolean;
}

function loadAudioSettings(): AudioSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(AUDIO_KEY) ?? 'null') as Partial<AudioSettings> | null;
    const volume = Number(saved?.volume);
    return {
      volume: saved && Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1,
      muted: saved?.muted === true,
    };
  } catch {
    return { volume: 1, muted: false };
  }
}

const IMAGE = /\.(png|jpe?g)$/i;

export class Editor {
  readonly project: Store<ProjectState>;
  readonly commands: CommandStack<ProjectState>;
  readonly logs: LogStore = createLogStore();
  readonly host: GameHost;
  readonly viewport: Viewport;
  readonly input: InputTracker;
  readonly audio: AudioPlayer;
  private savedState: Uint8Array | null = null;
  readonly hasSavedState = createStore(false);
  /** Desktop or touch layout (see layout-mode.ts). */
  readonly layoutMode = createLayoutMode();
  /** The touch layout's tabs and open files. */
  readonly touchPanels = createTouchPanels();
  /** Color of the game pixel under the mouse, or null when not over the game. */
  readonly pixel = createStore<PixelInfo | null>(null);
  /** The color just copied with F4, shown briefly under the game; null otherwise. */
  readonly copiedColor = createStore<string | null>(null);
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;
  readonly pixelProbe: PixelProbe;
  readonly audioSettings = createStore<AudioSettings>(loadAudioSettings());
  /** Title, description, author and cover of every game, read from its main.ts. */
  readonly catalog: GameCatalog;
  /** Compiles games in a Worker; caches builds until their files change. */
  readonly compiler: CompilerHost;
  /** Open code editors, file operations, and the assets the game uses. */
  readonly workbench: Workbench;
  /** The asset library panel's model: every asset, its sidecar and the games using it. */
  readonly assets: AssetLibrary;
  /** The asset the library panel shows (a project path), set from elsewhere (the file tree). */
  readonly assetFocus = createStore<string | null>(null);
  /** The file of the active code tab (the last code tab shown), or null when none is open. Set by the dock. */
  readonly activeCode = createStore<string | null>(null);
  /** Open sprite editors and sound players (for tests and agents, through window.__tf). */
  readonly openSprites = new Set<SpriteEditor>();
  readonly openSounds = new Set<SoundEditor>();
  /** The asset library (refreshed when files change) and the current game's part of it. */
  private library: AssetManifest;
  private gameAssets: AssetList | null = null;
  /** The library refresh in progress, if any; a hot reload waits for it. */
  private refreshing: Promise<void> = Promise.resolve();
  /** Bumped by each loadGame, so a slow compile does not load a game the user left. */
  private loadSeq = 0;

  constructor(readonly files: ProjectFiles) {
    this.library = files.library;
    this.project = createStore(loadProject(files.games));
    this.catalog = new GameCatalog(files.games, (game) => this.readGameInfo(game));
    // Parallel compiles, one Worker each: half the cores, at most 4 (each holds a compiler in memory).
    const compileWorkers = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
    this.compiler = new CompilerHost(files, () => new CompileWorker({ name: 'tinyforge-compiler' }), compileWorkers);
    this.commands = new CommandStack(this.project, (message) => this.logs.add('ERROR', message));
    this.workbench = new Workbench(
      files,
      this.commands,
      this.compiler,
      () => this.project.getState().game,
      (game) => this.runGame(game),
    );
    this.assets = new AssetLibrary(files);
    this.workbench.usedAssets.subscribe(() =>
      this.assets.setLiveUses(this.project.getState().game, this.workbench.usedAssets.getState()),
    );
    this.audio = new AudioPlayer((m) => this.logs.add('WARN', m));
    const applyAudio = () => {
      const { volume, muted } = this.audioSettings.getState();
      this.audio.setOutput(volume, muted);
    };
    applyAudio();
    this.audioSettings.subscribe(() => {
      applyAudio();
      try {
        localStorage.setItem(AUDIO_KEY, JSON.stringify(this.audioSettings.getState()));
      } catch {
        // Storage may be unavailable; the setting still applies for this session.
      }
    });
    this.pixelProbe = new PixelProbe(
      (offset, length, listener) => this.host.watch(offset, length, listener),
      (pixel) => this.pixel.setState(pixel),
    );
    this.input = new InputTracker((state) => {
      this.host.setInput(state);
      this.pixelProbe.setPosition(state.mouseX, state.mouseY);
    });
    this.viewport = new Viewport(this.input, () => this.audio.unlock());
    unlockAudioOnGesture(this.audio);
    this.host = new GameHost({
      createWorker: () => new GameWorker({ name: 'tinyforge-game' }),
      createCanvas: () => this.viewport.createCanvas(),
      sprites: this.library.sprites,
      onLog: (level, message) => this.logs.add(level, message),
      onAudio: (command) => this.audio.play(command),
      onAssets: (game, assets) => {
        if (game !== this.project.getState().game) return;
        this.gameAssets = assets;
        void this.loadGameAudio();
      },
    });

    // Persist the project and follow game changes (including undo/redo).
    let current = this.project.getState();
    this.project.subscribe(() => {
      const next = this.project.getState();
      try {
        localStorage.setItem(PROJECT_KEY, JSON.stringify(next));
      } catch {
        // Storage may be unavailable; the project still works for this session.
      }
      if (next.game !== current.game) {
        this.workbench.gameChanged();
        void this.loadGame();
      }
      current = next;
    });

    // Every file change, from the editor or from another program, comes here.
    files.onChange((changes) => this.filesChanged(changes));
  }

  /** The games in the project. */
  get games(): string[] {
    return this.files.games;
  }

  private async readGameInfo(game: string): Promise<GameMetaInfo> {
    const entry = gameEntryPath(game);
    const source = await this.files.readText(entry);
    if (source === null) throw new Error(`${entry} not found`);
    const meta = parseGameMeta(entry, source);
    let cover: GameMetaInfo['cover'] = null;
    if (meta.cover) {
      const id = meta.cover;
      const file = this.files.assetFiles.sprites.find((f) => IMAGE.test(f) && assetId(f) === id);
      const bytes = file ? await this.files.readBytes(`assets/sprites/${file}`) : null;
      if (file && bytes) cover = { type: /\.png$/i.test(file) ? 'image/png' : 'image/jpeg', bytes };
    }
    return { title: meta.title, description: meta.description, author: meta.author, cover };
  }

  private filesChanged(changes: FileChange[]): void {
    const games = this.files.games;
    const affected = this.compiler.invalidate(changes);
    this.workbench.filesChanged(changes, affected);
    void this.assets.filesChanged(changes);
    void this.catalog.setGames(games);
    // Titles and covers: a game's main.ts or a sprite changed.
    const sprites = changes.some((c) => assetKindOf(c.path) === 'sprites');
    const metaChanged = games.filter((g) => sprites || changes.some((c) => c.path === gameEntryPath(g)));
    if (metaChanged.length > 0) void this.catalog.load(metaChanged);
    if (changes.some((c) => assetKindOf(c.path))) void this.reloadAssets();
    const { game } = this.project.getState();
    if (game && !games.includes(game)) this.gameRemoved(games, changes);
    else if (game && affected.includes(game)) this.hotReload(game);
  }

  /**
   * The current game is gone. The editor's own Delete and Rename already
   * switched games, inside their undo step (Workbench); this covers a change
   * made by another program, which has no undo: run the renamed game, or
   * another one, or none.
   */
  private gameRemoved(games: string[], changes: FileChange[]): void {
    const renamed = games.find((g) => changes.some((c) => c.kind === 'add' && c.path === gameEntryPath(g)));
    this.runGame(renamed ?? (games.includes('pong') ? 'pong' : (games[0] ?? null)));
  }

  /** Run a game (null: none) without an undo step; selectGame() is the undoable choice. */
  private runGame(game: string | null): void {
    if (!game) this.host.kill({ reload: false });
    this.project.setState((p) => ({ ...p, game }));
  }

  setVolume(volume: number): void {
    this.audioSettings.setState((s) => ({ ...s, volume: Math.max(0, Math.min(1, volume)), muted: false }));
  }

  toggleMute(): void {
    this.audioSettings.setState((s) => ({ ...s, muted: !s.muted }));
  }

  async start(): Promise<void> {
    const games = this.files.games;
    void this.assets.start();
    if (!this.project.getState().game && games.length > 0) {
      // First run: pick a game without recording an undo step.
      this.project.setState((p) => ({
        ...p,
        game: games.includes('pong') ? 'pong' : games[0],
      }));
    } else {
      void this.loadGame();
    }
    // The picker's titles and covers: the current game first, then the rest.
    void this.catalog.load(undefined, this.project.getState().game);
    // Every game's compile status, once the current game is built (so it starts first).
    const current = this.project.getState().game;
    void (current ? this.compiler.build(current) : Promise.resolve()).then(() => {
      for (const game of this.files.games) void this.compiler.build(game);
    });
  }

  /** Load the sounds the current game uses (its cartridge lists them). */
  private async loadGameAudio(): Promise<void> {
    const assets = this.gameAssets;
    if (!assets) return;
    const pick = (refs: AssetManifest['sfx'], ids: string[]) => refs.filter((r) => ids.includes(r.id));
    await this.audio.load(pick(this.library.sfx, assets.sfx), pick(this.library.music, assets.music));
    if (assets !== this.gameAssets) return;
    const { sfx, music } = this.audio.counts;
    this.logs.add('HOST', `Audio loaded: ${sfx} SFX, ${music} music tracks`);
  }

  /**
   * Files in the asset library changed: reload the game's sprites in place
   * and its sounds. URLs change only for changed files, so only those are
   * fetched again.
   */
  reloadAssets(): Promise<void> {
    this.refreshing = (async () => {
      this.library = this.files.library;
      this.host.setSprites(this.library.sprites);
      await this.loadGameAudio();
    })();
    return this.refreshing;
  }

  /** Show an asset in the library panel. */
  showAsset(path: string): void {
    this.assetFocus.setState(path);
    for (const listener of [...this.showLibraryListeners]) listener();
  }

  private readonly showLibraryListeners = new Set<() => void>();

  /** The UI opens or focuses the library panel. */
  onShowLibrary(listener: () => void): () => void {
    this.showLibraryListeners.add(listener);
    return () => {
      this.showLibraryListeners.delete(listener);
    };
  }

  selectGame(game: string): void {
    const title = this.catalog.games.getState().find((g) => g.name === game)?.title;
    this.commands.run(projectCommands.setGame(this.project.getState(), game, title));
  }

  setSeed(seed: number | null): void {
    this.commands.run(projectCommands.setSeed(this.project.getState(), seed));
  }

  /** Compile the project's game (or reuse its build) and run it. */
  async loadGame({ keepState = false } = {}): Promise<void> {
    const { game, seed } = this.project.getState();
    if (!game) return;
    const seq = ++this.loadSeq;
    const result = await this.compiler.build(game, 'debug', true);
    if (seq !== this.loadSeq || game !== this.project.getState().game) return;
    if (!result.ok) {
      this.logs.add('ERROR', `${game} failed to compile:\n${result.log}`);
      // Another game still running would look like this one: stop it. The
      // Game tab shows the errors. (A broken edit keeps the game's last build.)
      if (this.host.session.getState().game !== game) {
        this.audio.stopMusic();
        this.host.kill({ reload: false });
      }
      return;
    }
    const ms = this.compiler.builds.getState()[game]?.ms;
    if (ms != null) this.logs.add('HOST', `Compiled ${game} in ${ms} ms`);
    this.audio.stopMusic();
    this.host.load(game, result.wasm, { keepState, seed });
  }

  restart(): void {
    this.audio.stopMusic();
    this.host.restart(this.project.getState().seed);
  }

  /** Hot reload after the game's files changed: memory (game state) is kept. */
  private hotReload(game: string): void {
    this.logs.add('HOST', `${game} changed, rebuilding and hot reloading (state kept)`);
    void this.refreshing.then(() => this.loadGame({ keepState: true }));
  }

  async saveState(): Promise<void> {
    this.savedState = await this.host.snapshot();
    this.hasSavedState.setState(true);
    this.logs.add('HOST', 'State saved');
  }

  async loadState(): Promise<void> {
    if (!this.savedState) return;
    await this.host.restore(this.savedState);
    this.logs.add('HOST', 'State restored');
  }

  /** Run what a keyboard shortcut stands for. */
  runShortcut(action: ShortcutAction): void {
    switch (action) {
      case 'reload':
        void this.loadGame();
        break;
      case 'restart':
        this.restart();
        break;
      case 'pauseResume':
        this.togglePause();
        break;
      case 'step':
        this.host.step(1);
        break;
      case 'copyColor':
        this.copyPixelColor();
        break;
      case 'undo':
        this.commands.undo();
        break;
      case 'redo':
        this.commands.redo();
        break;
    }
  }

  /** Copy the hovered pixel's color (#RRGGBB) to the clipboard. Does nothing off the game. */
  copyPixelColor(): void {
    const p = this.pixel.getState();
    if (!p) return;
    const hex = pixelHex(p);
    if (!navigator.clipboard) {
      this.logs.add('WARN', 'Could not copy to the clipboard');
      return;
    }
    navigator.clipboard.writeText(hex).then(
      () => {
        this.logs.add('HOST', `Copied ${hex}`);
        this.copiedColor.setState(hex);
        clearTimeout(this.copiedTimer);
        this.copiedTimer = setTimeout(() => this.copiedColor.setState(null), 1200);
      },
      () => this.logs.add('WARN', 'Could not copy to the clipboard'),
    );
  }

  togglePause(): void {
    if (this.host.session.getState().status === 'paused') this.host.resume();
    else this.host.pause();
  }

  /** Replace a hung game Worker and load the project's game from scratch. */
  kill(): void {
    this.audio.stopMusic();
    this.host.kill({ reload: false });
    void this.loadGame();
  }
}

/**
 * Start the audio at the first tap or key anywhere: the on-screen controls,
 * the menus and the panels count, not only the game view. On iOS, sounds use
 * the media channel ("playback"), so the ring/silent switch does not mute
 * the game; the default ("ambient") is muted by it.
 */
function unlockAudioOnGesture(audio: { unlock(): boolean }): void {
  const session = (navigator as { audioSession?: { type: string } }).audioSession;
  if (session) session.type = 'playback';
  const events = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
  const onGesture = () => {
    if (!audio.unlock()) return;
    for (const e of events) removeEventListener(e, onGesture, true);
  };
  for (const e of events) addEventListener(e, onGesture, true);
}
