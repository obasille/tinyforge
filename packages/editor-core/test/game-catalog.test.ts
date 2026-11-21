import { withMeta } from '@tinyforge/engine/tooling/cartridge-meta';
import { describe, expect, it } from 'vitest';
import { GameCatalog } from '../src/game-catalog.ts';

const EMPTY = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

function cartridge(title: string, cover = false): Uint8Array {
  return withMeta(EMPTY, {
    title,
    description: `${title} description`,
    author: 'Someone',
    assets: { sprites: [], sfx: [], music: [] },
    cover: cover ? { type: 'image/png', bytes: new Uint8Array([1, 2, 3]) } : null,
  }).wasm;
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

  it('reports a cartridge without metadata', async () => {
    const catalog = new GameCatalog(['old'], async () => EMPTY);
    await catalog.load();
    expect(catalog.games.getState()[0]).toMatchObject({ title: 'old', error: 'No tinyforge.meta section' });
  });
});
