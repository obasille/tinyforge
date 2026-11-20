// Composition root: wires editor-core pieces together for the browser.
// Plain TS; React components get this object and subscribe to its stores.

import {
  type AssetManifest,
  AudioPlayer,
  CommandStack,
  createStore,
  emptyProject,
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

  constructor(readonly manifest: AssetManifest) {
    this.project = createStore(loadProject(manifest.games));
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
      sprites: manifest.sprites.map((s) => ({ ...s, url: absolute(s.url) })),
      onLog: (level, message) => this.logs.add(level, message),
      onAudio: (command) => this.audio.play(command),
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
    await this.loadAudio(this.manifest);
    if (!this.project.getState().game && this.manifest.games.length > 0) {
      // First run: pick a game without recording an undo step.
      this.project.setState((p) => ({
        ...p,
        game: this.manifest.games.includes('pong') ? 'pong' : this.manifest.games[0],
      }));
    } else {
      this.loadGame();
    }
  }

  private async loadAudio(manifest: AssetManifest, version = ''): Promise<void> {
    const ref = (s: AssetManifest['sfx'][number]) => ({ ...s, url: absolute(s.url) + version });
    await this.audio.load(manifest.sfx.map(ref), manifest.music.map(ref));
    const { sfx, music } = this.audio.counts;
    this.logs.add('HOST', `Audio loaded: ${sfx} SFX, ${music} music tracks`);
  }

  /** Reload sounds after files in assets/sfx or assets/music changed (dev server). */
  async reloadAudio(): Promise<void> {
    const res = await fetch(absolute('__tf/manifest.json'), { cache: 'no-store' });
    if (!res.ok) {
      this.logs.add('WARN', `Could not reload audio: manifest HTTP ${res.status}`);
      return;
    }
    // Cache-bust so changed files are fetched again under the same URL.
    await this.loadAudio((await res.json()) as AssetManifest, `?v=${Date.now()}`);
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
    const { game } = this.project.getState();
    if (!game || !games.includes(game)) return;
    this.logs.add('HOST', `${game} rebuilt, hot reloading (state kept)`);
    this.loadGame({ keepState: true });
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
