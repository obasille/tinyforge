import { describe, expect, it } from 'vitest';
import { GameCatalog, type GameMetaInfo } from '../src/game-catalog.ts';

function cartridge(title: string, cover = false): GameMetaInfo {
  return {
    title,
    description: `${title} description`,
    author: 'Someone',
    cover: cover ? { type: 'image/png', bytes: new Uint8Array([1, 2, 3]) } : null,
  };
}

describe('GameCatalog', () => {
  it('starts with placeholders, then fills in each game, the current one first', async () => {
    const order: string[] = [];
    const catalog = new GameCatalog(['pong', 'snake'], async (game) => {
      order.push(game);
      return cartridge(game === 'pong' ? 'Pong' : 'Snake', game === 'pong');
    });
    expect(catalog.games.getState().map((g) => [g.title, g.loading])).toEqual([
      ['pong', true],
      ['snake', true],
    ]);
    await catalog.load(undefined, 'snake');
    expect(order).toEqual(['snake', 'pong']);
    const [pong, snake] = catalog.games.getState();
    expect(pong).toMatchObject({ title: 'Pong', description: 'Pong description', author: 'Someone', loading: false });
    expect(pong.cover?.type).toBe('image/png');
    expect(snake.cover).toBeNull();
  });

  it('keeps what it showed when a reload fails, and reports the error', async () => {
    let fail = false;
    const catalog = new GameCatalog(['pong'], async () => {
      if (fail) throw new Error('compile error');
      return cartridge('Pong');
    });
    await catalog.load();
    fail = true;
    await catalog.load(['pong']);
    expect(catalog.games.getState()[0]).toMatchObject({ title: 'Pong', error: 'compile error', loading: false });
  });

  it('follows games being added and removed', async () => {
    const catalog = new GameCatalog(['pong'], async (game) => cartridge(game));
    await catalog.load();
    await catalog.setGames(['newGame', 'pong']);
    expect(catalog.games.getState().map((g) => [g.name, g.title, g.loading])).toEqual([
      ['newGame', 'newGame', false],
      ['pong', 'pong', false],
    ]);
    await catalog.setGames(['newGame']);
    expect(catalog.games.getState().map((g) => g.name)).toEqual(['newGame']);
  });
});
