// Composition root: wires editor-core pieces together for the browser.
// Plain TS; React components get this object and subscribe to its stores.

import {
  type AssetList,
  type AssetManifest,
  AudioPlayer,
  CommandStack,
  createStore,
  emptyProject,
  GameCatalog,
  GameHost,
  InputTracker,
  type PixelInfo,
  PixelProbe,
  type ProjectState,
  projectCommands,
  type ShortcutAction,
  type Store,
  Viewport,
} from '@tinyforge/editor-core';
import GameWorker from '@tinyforge/editor-core/game-worker?worker';
import { createLogStore, type LogStore } from './log-store.ts';

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

const absolute = (url: string) => new URL(url, document.baseURI).href;
const absoluteRefs = (refs: AssetManifest['sprites']) => refs.map((r) => ({ ...r, url: absolute(r.url) }));

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
  /** Color of the game pixel under the mouse, or null when not over the game. */
  readonly pixel = createStore<PixelInfo | null>(null);
  readonly pixelProbe: PixelProbe;
  readonly audioSettings = createStore<AudioSettings>(loadAudioSettings());
  /** Title, description, author and cover of every game, read from its cartridge. */
  readonly catalog: GameCatalog;
  /** The asset library (refreshed when files change) and the current game's part of it. */
  private library: AssetManifest;
  private gameAssets: AssetList | null = null;
  /** The library refresh in progress, if any; a hot reload waits for it. */
  private refreshing: Promise<void> = Promise.resolve();

  constructor(readonly manifest: AssetManifest) {
    this.library = manifest;
    this.project = createStore(loadProject(manifest.games));
    this.catalog = new GameCatalog(manifest.games, async (game) => {
      const res = await fetch(this.cartridgeUrl(game), { cache: 'no-store' });
      if (!res.ok) throw new Error(`${game}: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    });
    this.commands = new CommandStack(this.project);
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
    this.host = new GameHost({
      createWorker: () => new GameWorker({ name: 'tinyforge-game' }),
      createCanvas: () => this.viewport.createCanvas(),
      sprites: absoluteRefs(manifest.sprites),
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
      if (next.game !== current.game) this.loadGame();
      current = next;
    });
  }

  setVolume(volume: number): void {
    this.audioSettings.setState((s) => ({ ...s, volume: Math.max(0, Math.min(1, volume)), muted: false }));
  }

  toggleMute(): void {
    this.audioSettings.setState((s) => ({ ...s, muted: !s.muted }));
  }

  async start(): Promise<void> {
    if (!this.project.getState().game && this.manifest.games.length > 0) {
      // First run: pick a game without recording an undo step.
      this.project.setState((p) => ({
        ...p,
        game: this.manifest.games.includes('pong') ? 'pong' : this.manifest.games[0],
      }));
    } else {
      this.loadGame();
    }
    // The picker's titles and covers: the current game first, then the rest.
    void this.catalog.load(undefined, this.project.getState().game);
  }

  /** Load the sounds the current game uses (its cartridge lists them). */
  private async loadGameAudio(): Promise<void> {
    const assets = this.gameAssets;
    if (!assets) return;
    const pick = (refs: AssetManifest['sfx'], ids: string[]) => absoluteRefs(refs.filter((r) => ids.includes(r.id)));
    await this.audio.load(pick(this.library.sfx, assets.sfx), pick(this.library.music, assets.music));
    if (assets !== this.gameAssets) return;
    const { sfx, music } = this.audio.counts;
    this.logs.add('HOST', `Audio loaded: ${sfx} SFX, ${music} music tracks`);
  }

  /**
   * Files in the asset library changed (dev server): reload the game's
   * sprites in place and its sounds. URLs change only for changed files, so
   * only those are fetched again.
   */
  reloadAssets(): Promise<void> {
    this.refreshing = (async () => {
      const res = await fetch(absolute('__tf/manifest.json'), { cache: 'no-store' });
      if (!res.ok) {
        this.logs.add('WARN', `Could not reload assets: manifest HTTP ${res.status}`);
        return;
      }
      this.library = (await res.json()) as AssetManifest;
      this.host.setSprites(absoluteRefs(this.library.sprites));
      await this.loadGameAudio();
    })();
    return this.refreshing;
  }

  cartridgeUrl(game: string): string {
    return absolute(`__tf/cartridges/${game}.wasm?v=${Date.now()}`);
  }

  selectGame(game: string): void {
    this.commands.run(projectCommands.setGame(this.project.getState(), game));
  }

  setSeed(seed: number | null): void {
    this.commands.run(projectCommands.setSeed(this.project.getState(), seed));
  }

  loadGame({ keepState = false } = {}): void {
    const { game, seed } = this.project.getState();
    if (!game) return;
    this.audio.stopMusic();
    this.host.load(game, this.cartridgeUrl(game), { keepState, seed });
  }

  restart(): void {
    this.audio.stopMusic();
    this.host.restart(this.project.getState().seed);
  }

  /** Hot reload after the cartridge was rebuilt: memory (game state) is kept. */
  hotReload(games: string[]): void {
    void this.catalog.load(games);
    const { game } = this.project.getState();
    if (!game || !games.includes(game)) return;
    this.logs.add('HOST', `${game} rebuilt, hot reloading (state kept)`);
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
        this.loadGame();
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
      case 'undo':
        this.commands.undo();
        break;
      case 'redo':
        this.commands.redo();
        break;
    }
  }

  togglePause(): void {
    if (this.host.session.getState().status === 'paused') this.host.resume();
    else this.host.pause();
  }

  /** Replace a hung game Worker and load the project's game from scratch. */
  kill(): void {
    this.audio.stopMusic();
    this.host.kill({ reload: false });
    this.loadGame();
  }
}
