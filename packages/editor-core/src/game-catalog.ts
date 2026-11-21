// What the game picker shows: each game's title, description, author and
// cover, read from the `tinyforge.meta` section of its cartridge.
// Plain TS; the fetch is injected so tests run without a server.

import { readMeta } from '@tinyforge/engine/tooling/cartridge-meta';
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

export type FetchBytes = (game: string) => Promise<Uint8Array>;

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
    private readonly fetchBytes: FetchBytes,
  ) {
    this.games = createStore(names.map(placeholder));
  }

  /** Load the given games' metadata (all games when omitted), `first` first. */
  async load(names?: string[], first?: string | null): Promise<void> {
    const wanted = names ?? this.games.getState().map((g) => g.name);
    const ordered = first && wanted.includes(first) ? [first, ...wanted.filter((n) => n !== first)] : wanted;
    // One at a time: the dev server compiles each cartridge on first request.
    for (const name of ordered) await this.loadOne(name);
  }

  private async loadOne(name: string): Promise<void> {
    let info: GameInfo;
    try {
      const meta = readMeta(await this.fetchBytes(name));
      info = meta
        ? {
            name,
            title: meta.title,
            description: meta.description,
            author: meta.author,
            cover: meta.cover
              ? new Blob([meta.cover.bytes as Uint8Array<ArrayBuffer>], { type: meta.cover.type })
              : null,
            error: null,
            loading: false,
          }
        : { ...placeholder(name), loading: false, error: 'No tinyforge.meta section' };
    } catch (e) {
      const previous = this.games.getState().find((g) => g.name === name);
      // Keep what was shown before (e.g. while the game has a compile error).
      info = {
        ...(previous ?? placeholder(name)),
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    this.games.setState((list) => list.map((g) => (g.name === name ? info : g)));
  }
}
