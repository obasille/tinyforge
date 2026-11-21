// What the game picker shows: each game's title, description, author and
// cover, read from the constants in its main.ts (no compile needed) and the
// cover sprite in the library. Plain TS; the reader is injected so tests run
// without files.

import { createStore, type Store } from './store.ts';

export interface GameInfo {
  name: string;
  title: string;
  description: string;
  author: string;
  /** Cover image file (PNG) or null. Turn it into a URL in the UI. */
  cover: Blob | null;
  /** Why the metadata could not be read, if it could not. */
  error: string | null;
  loading: boolean;
}

export interface GameMetaInfo {
  title: string;
  description: string;
  author: string;
  cover: { type: string; bytes: Uint8Array } | null;
}

/** Reads a game's metadata; throws a readable error when it cannot. */
export type ReadGameInfo = (game: string) => Promise<GameMetaInfo>;

const placeholder = (name: string): GameInfo => ({
  name,
  title: name,
  description: '',
  author: '',
  cover: null,
  error: null,
  loading: true,
});

export class GameCatalog {
  readonly games: Store<GameInfo[]>;

  constructor(
    names: string[],
    private readonly readInfo: ReadGameInfo,
  ) {
    this.games = createStore(names.map(placeholder));
  }

  /** The games changed (one was created, renamed or deleted); loads the new ones. */
  setGames(names: string[]): Promise<void> {
    const known = new Map(this.games.getState().map((g) => [g.name, g]));
    const added = names.filter((n) => !known.has(n));
    if (added.length === 0 && names.length === known.size) return Promise.resolve();
    this.games.setState(names.map((n) => known.get(n) ?? placeholder(n)));
    return this.load(added);
  }

  /** Load the given games' metadata (all games when omitted), `first` first. */
  async load(names?: string[], first?: string | null): Promise<void> {
    const wanted = names ?? this.games.getState().map((g) => g.name);
    const ordered = first && wanted.includes(first) ? [first, ...wanted.filter((n) => n !== first)] : wanted;
    for (const name of ordered) await this.loadOne(name);
  }

  private async loadOne(name: string): Promise<void> {
    let info: GameInfo;
    try {
      const meta = await this.readInfo(name);
      info = {
        name,
        title: meta.title,
        description: meta.description,
        author: meta.author,
        cover: meta.cover ? new Blob([meta.cover.bytes as Uint8Array<ArrayBuffer>], { type: meta.cover.type }) : null,
        error: null,
        loading: false,
      };
    } catch (e) {
      const previous = this.games.getState().find((g) => g.name === name);
      // Keep what was shown before (e.g. while the game has a compile error).
      info = {
        ...(previous ?? placeholder(name)),
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    // A game removed while it was loading stays removed.
    this.games.setState((list) => list.map((g) => (g.name === name ? info : g)));
  }
}
