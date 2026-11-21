import path from 'node:path';
import { AS_CONSTANTS, assetId, createAssetScan, libraryFromFiles } from '@tinyforge/engine/tooling/asset-scan';
import { readMeta } from '@tinyforge/engine/tooling/cartridge-meta';
import { ASSETS_DIR, compileGame, gamesAffectedByAsset } from '@tinyforge/engine/tooling/compile-game';
import * as assemblyscript from 'assemblyscript';
import asc from 'assemblyscript/asc';
import type { Transform } from 'assemblyscript/transform';
import { describe, expect, it } from 'vitest';

const LIBRARY = libraryFromFiles({
  sprites: ['ball.png', 'coin~8x1.png', 'hero-v2.png', 'notes.txt'],
  sfx: ['hit.wav'],
  music: ['theme-loop.ogg'],
});

/** Compile one in-memory game file with the scan, without the SDK. */
async function scanSource(source: string) {
  const scan = createAssetScan(LIBRARY);
  const entry = 'games/test/main.ts';
  const header =
    'declare function s(name: string, x?: i32): i32;\ndeclare function playSfx(id: string, v: f32): void;\ndeclare function playMusic(id: string, v: f32): void;\n';
  let log = '';
  const sink = {
    write(chunk: string | Uint8Array) {
      log += String(chunk);
      return true;
    },
  };
  const { error } = await asc.main([entry, '--runtime', 'stub', '--noEmit'], {
    readFile: (name: string) => (name === entry ? header + source : null),
    writeFile: () => {},
    listFiles: () => [],
    transforms: [scan.transform as unknown as Transform],
    stdout: sink,
    stderr: sink,
  });
  return { ok: !error, log, used: scan.used() };
}

describe('asset scan', () => {
  it('uses the compiler constants it repeats', () => {
    const as = assemblyscript as unknown as {
      NodeKind: Record<string, number>;
      LiteralKind: Record<string, number>;
      DiagnosticCode: Record<string, number>;
    };
    expect(AS_CONSTANTS).toEqual({
      NodeKindIdentifier: as.NodeKind.Identifier,
      NodeKindCall: as.NodeKind.Call,
      NodeKindLiteral: as.NodeKind.Literal,
      NodeKindParenthesized: as.NodeKind.Parenthesized,
      NodeKindTernary: as.NodeKind.Ternary,
      LiteralKindString: as.LiteralKind.String,
      DiagnosticUserDefined: as.DiagnosticCode.User_defined_0,
    });
  });

  it('reads asset IDs from library file names', () => {
    expect(['coin~8x1.png', 'hero-v2.png', 'ball.png'].map(assetId)).toEqual(['coin', 'hero', 'ball']);
    expect([...LIBRARY.sprites].sort()).toEqual(['ball', 'coin', 'hero']);
  });

  it('collects the IDs a game uses, including both sides of a ternary', async () => {
    const r = await scanSource(
      'export function update(p: i32): void {\n  s("coin", 2); s("ball"); s("ball");\n  playSfx(p ? "hit" : ("hit"), 1);\n  playMusic("theme", 1);\n}\n',
    );
    expect(r.log).toBe('');
    expect(r.ok).toBe(true);
    expect(r.used).toEqual({ sprites: ['ball', 'coin'], sfx: ['hit'], music: ['theme'] });
  });

  it('makes an unknown ID a compile error at the argument', async () => {
    const r = await scanSource('export function draw(): void {\n  s("coins");\n}\n');
    expect(r.ok).toBe(false);
    expect(r.log).toContain('Unknown sprite "coins": no file with that ID in assets/sprites.');
    expect(r.log).toContain('games/test/main.ts(5,5)');
  });

  it('makes a non-literal ID a compile error', async () => {
    const r = await scanSource('export function draw(name: string): void {\n  playSfx(name, 1);\n}\n');
    expect(r.ok).toBe(false);
    expect(r.log).toContain('playSfx() needs the sound effect ID as a string literal');
  });

  it('records what real games use in tinyforge.meta', async () => {
    const croc = await compileGame('crocodiles', 'release');
    if (!croc.ok) throw new Error(croc.log);
    // Sprites used from other files of the game folder count too.
    expect(readMeta(croc.wasm)?.assets.sprites).toEqual(expect.arrayContaining(['crocodile', 'meat', 'tunnel']));
    const tank = await compileGame('tankDuel', 'release');
    if (!tank.ok) throw new Error(tank.log);
    expect(readMeta(tank.wasm)?.assets.sfx).toEqual(expect.arrayContaining(['tank_fire_p1', 'tank_fire_p2']));
    expect(readMeta(tank.wasm)?.assets.sprites).toEqual([]);
  });

  it('knows which games a library change affects', () => {
    const file = (kind: string, name: string) => path.join(ASSETS_DIR, kind, name);
    expect(gamesAffectedByAsset(file('sfx', 'new.wav'), 'add')).toContain('pong');
    expect(gamesAffectedByAsset(file('sfx', 'pong_wall.wav'), 'change')).toEqual([]);
    expect(gamesAffectedByAsset(file('sprites', 'pong_cover.png'), 'change')).toEqual(['pong']);
    expect(gamesAffectedByAsset(file('sprites', 'readme.txt'), 'add')).toBeNull();
    expect(gamesAffectedByAsset('/elsewhere/a.png', 'add')).toBeNull();
  });
});
