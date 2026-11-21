import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  GAMES_DIR,
  gameEntry,
  gamesAffectedBy,
  listGames,
  MEMORY_MAP_FILE,
  SDK_DIR,
} from '@tinyforge/engine/tooling/compile-game';
import { describe, expect, it } from 'vitest';

describe('game folders', () => {
  it('lists each folder with a main.ts as a game', () => {
    const games = listGames();
    expect(games).toContain('pong');
    expect(games).toContain('crocodiles');
    for (const game of games) expect(gameEntry(game)).toBe(path.join(GAMES_DIR, game, 'main.ts'));
  });

  it('maps a changed file to the games it affects', () => {
    expect(gamesAffectedBy(path.join(GAMES_DIR, 'pong', 'main.ts'))).toEqual(['pong']);
    expect(gamesAffectedBy(path.join(GAMES_DIR, 'crocodiles', 'player.ts'))).toEqual(['crocodiles']);
    expect(gamesAffectedBy(path.join(GAMES_DIR, 'missing', 'main.ts'))).toEqual([]);
    expect(gamesAffectedBy(path.join(GAMES_DIR, 'stray.ts'))).toEqual([]);
    expect(gamesAffectedBy(path.join(SDK_DIR, 'drawing.ts'))).toEqual(listGames());
    expect(gamesAffectedBy(MEMORY_MAP_FILE)).toEqual(listGames());
    expect(gamesAffectedBy(path.join(GAMES_DIR, '..', '..', 'README.md'))).toBeNull();
  });

  describe.each(listGames())('%s', (game) => {
    it('declares TITLE, DESCRIPTION and AUTHOR as string literals', () => {
      const source = readFileSync(gameEntry(game), 'utf8');
      for (const name of ['TITLE', 'DESCRIPTION', 'AUTHOR']) {
        expect(source).toMatch(new RegExp(`^const ${name} = "[^"]+";$`, 'm'));
      }
    });
  });
});
