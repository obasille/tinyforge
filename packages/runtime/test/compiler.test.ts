import { readMeta } from '@tinyforge/engine/tooling/cartridge-meta';
import { nodeFiles, readAssetFiles } from '@tinyforge/engine/tooling/compile-game';
import { type CompilerFiles, compile, configArgs } from '@tinyforge/engine/tooling/compiler';
import { describe, expect, it } from 'vitest';

/** The project on disk, with some files replaced in memory. */
function filesWith(overrides: Record<string, string>): CompilerFiles {
  const disk = nodeFiles();
  return {
    readText: async (p) => (p in overrides ? overrides[p] : disk.readText(p)),
    readBytes: (p) => disk.readBytes(p),
  };
}

const GAME = `import { clearFramebuffer, s } from "../../sdk";
const TITLE = "Test";
const DESCRIPTION = "A test game";
const AUTHOR = "Tests";
const RAM_SIZE: i32 = 0x100;
export function init(): void {}
export function update(): void {}
export function draw(): void { clearFramebuffer(0); s("pong_cover"); }
`;

describe('compiler', () => {
  it('turns asconfig.json options and a target into asc flags', () => {
    const config = {
      options: { runtime: 'stub', exportRuntime: false, importMemory: true, lowMemoryLimit: 0 },
      targets: { debug: { debug: true }, release: { optimizeLevel: 3 } },
    };
    expect(configArgs(config, 'debug')).toEqual([
      '--runtime',
      'stub',
      '--importMemory',
      '--lowMemoryLimit',
      '0',
      '--debug',
    ]);
    expect(configArgs(config, 'release')).toContain('--optimizeLevel');
  });

  it('compiles a game held in memory', async () => {
    const result = await compile({
      game: 'memoryGame',
      target: 'release',
      files: filesWith({ 'games/memoryGame/main.ts': GAME }),
      assetFiles: readAssetFiles(),
    });
    if (!result.ok) throw new Error(result.log);
    expect(result.meta.title).toBe('Test');
    expect(readMeta(result.wasm)?.assets.sprites).toEqual(['pong_cover']);
  });

  it('reports errors with their project path and position', async () => {
    const source = GAME.replace('clearFramebuffer(0);', 'clearFramebuffer(0); let x: i32 = "text";').replace(
      '"pong_cover"',
      '"nope"',
    );
    const result = await compile({
      game: 'memoryGame',
      target: 'debug',
      files: filesWith({ 'games/memoryGame/main.ts': source }),
      assetFiles: readAssetFiles(),
    });
    expect(result.ok).toBe(false);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    const unknown = errors.find((d) => d.message.includes('Unknown sprite "nope"'));
    expect(unknown).toMatchObject({ path: 'games/memoryGame/main.ts', line: 8 });
    expect(source.slice(unknown?.from, unknown?.to)).toBe('"nope"');
  });

  it('reports bad metadata at its line', async () => {
    const result = await compile({
      game: 'memoryGame',
      target: 'debug',
      files: filesWith({ 'games/memoryGame/main.ts': GAME.replace('0x100', '64 * 4') }),
      assetFiles: readAssetFiles(),
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ path: 'games/memoryGame/main.ts', line: 5, severity: 'error' }),
    ]);
  });

  it('refuses a game without main.ts', async () => {
    const result = await compile({
      game: 'missing',
      target: 'debug',
      files: filesWith({}),
      assetFiles: readAssetFiles(),
    });
    expect(result).toMatchObject({ ok: false, log: expect.stringContaining('no games/missing/main.ts') });
  });
});
