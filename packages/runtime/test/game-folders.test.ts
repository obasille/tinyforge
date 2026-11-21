import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  diskPath,
  GAMES_DIR,
  gameEntry,
  listGames,
  listProjectFiles,
  MEMORY_MAP_FILE,
  projectPathOfFile,
  SDK_DIR,
} from '@tinyforge/engine/tooling/compile-game';
import {
  affectedGames,
  compilerPath,
  gamesIn,
  isProjectPath,
  isWritablePath,
  projectPathOf,
} from '@tinyforge/engine/tooling/project-layout';
import { describe, expect, it } from 'vitest';

describe('game folders', () => {
  it('lists each folder with a main.ts as a game', () => {
    const games = listGames();
    expect(games).toContain('pong');
    expect(games).toContain('crocodiles');
    for (const game of games) expect(gameEntry(game)).toBe(path.join(GAMES_DIR, game, 'main.ts'));
  });

  it('maps a changed file to the games it affects', () => {
    const games = ['crocodiles', 'pong'];
    const none = () => null;
    expect(affectedGames('games/pong/main.ts', 'change', games, none)).toEqual(['pong']);
    expect(affectedGames('games/crocodiles/player.ts', 'change', games, none)).toEqual(['crocodiles']);
    expect(affectedGames('games/newGame/main.ts', 'add', games, none)).toEqual(['newGame']);
    expect(affectedGames('games/stray.ts', 'change', games, none)).toBeNull();
    expect(affectedGames('engine/sdk/drawing.ts', 'change', games, none)).toEqual(games);
    expect(affectedGames('engine/memory-map.ts', 'change', games, none)).toEqual(games);
    expect(affectedGames('games/asconfig.json', 'change', games, none)).toEqual(games);
    expect(affectedGames('README.md', 'change', games, none)).toBeNull();
  });

  it('names files by project path and maps them to disk and to the compiler', async () => {
    expect(diskPath('games/pong/main.ts')).toBe(gameEntry('pong'));
    expect(diskPath('engine/sdk/drawing.ts')).toBe(path.join(SDK_DIR, 'drawing.ts'));
    expect(diskPath('engine/memory-map.ts')).toBe(MEMORY_MAP_FILE);
    expect(diskPath('engine/tooling/compiler.ts')).toBeNull();
    expect(diskPath('games/../../package.json')).toBeNull();
    expect(projectPathOfFile(path.join(GAMES_DIR, 'pong', 'main.ts'))).toBe('games/pong/main.ts');
    expect(projectPathOfFile(path.join(GAMES_DIR, '..', 'index.ts'))).toBeNull();
    expect(compilerPath('engine/sdk/index.ts')).toBe('assembly/sdk/index.ts');
    expect(projectPathOf('assembly/games/pong/../../sdk/index.ts')).toBe('engine/sdk/index.ts');
    const files = (await listProjectFiles()).map((f) => f.path);
    expect(gamesIn(files)).toEqual(listGames());
    expect(files).toContain('games/asconfig.json');
    expect(files).toContain('engine/memory-map.ts');
    expect(files.some((f) => f.startsWith('assets/cartridges/'))).toBe(false);
  });

  it('only lets the editor write games and library files', () => {
    expect(isWritablePath('games/pong/main.ts')).toBe(true);
    expect(isWritablePath('games/pong/levels/a.ts')).toBe(true);
    expect(isWritablePath('assets/sprites/ball.png')).toBe(true);
    expect(isWritablePath('games/asconfig.json')).toBe(false);
    expect(isWritablePath('engine/sdk/index.ts')).toBe(false);
    expect(isWritablePath('assets/cartridges/pong.wasm')).toBe(false);
    expect(isWritablePath('games/bad name/main.ts')).toBe(false);
    for (const bad of ['', '/games/a/b.ts', 'games/./a.ts', 'games/../x', 'games/a/.env', 'games\\a\\b.ts']) {
      expect(isProjectPath(bad)).toBe(false);
    }
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
