import { readGameZip } from '@tinyforge/engine/tooling/game-zip';
import { crc32, MAX_UNZIPPED, readZip, writeZip } from '@tinyforge/engine/tooling/zip';
import { describe, expect, it } from 'vitest';
import type { LibraryAsset } from '../src/asset-library.ts';
import { CommandStack } from '../src/commands.ts';
import { exportGameZip, gameImportCommand, planGameImport, usedAssets } from '../src/game-transfer.ts';
import { ProjectFiles } from '../src/project-files.ts';
import { createStore } from '../src/store.ts';
import { MemoryWorkspace } from './memory-workspace.ts';

const text = (s: string) => new TextEncoder().encode(s);

/** Made by Python's zipfile (deflated), inside a top folder, as other zip tools do. */
const PYTHON_ZIP =
  'UEsDBBQAAAAIAM5xdl3LP8M3KQAAAIACAAAaAAAAbXlnYW1lL2dhbWVzL2hlbGxvL21haW4udHNLrSjILypRSCvNSy7JzM9TyMzLLNHQtFIoy89MUaiu5UodlR+Vp6E8AFBLAwQUAAAACADOcXZduTMmNRAAAAAOAAAAHwAAAG15Z2FtZS9hc3NldHMvc2Z4L2JlZXAud2F2Lmpzb26rVipJTC9WsopWqlCKrQUAUEsDBBQAAAAIAM5xdl3TYhvKCQAAAGgAAAAaAAAAbXlnYW1lL2Fzc2V0cy9zZngvYmVlcC53YXYL8nRzY6ADAABQSwECFAMUAAAACADOcXZdyz/DNykAAACAAgAAGgAAAAAAAAAAAAAAgAEAAAAAbXlnYW1lL2dhbWVzL2hlbGxvL21haW4udHNQSwECFAMUAAAACADOcXZduTMmNRAAAAAOAAAAHwAAAAAAAAAAAAAAgAFhAAAAbXlnYW1lL2Fzc2V0cy9zZngvYmVlcC53YXYuanNvblBLAQIUAxQAAAAIAM5xdl3TYhvKCQAAAGgAAAAaAAAAAAAAAAAAAACAAa4AAABteWdhbWUvYXNzZXRzL3NmeC9iZWVwLndhdlBLBQYAAAAAAwADAN0AAADvAAAAAAA=';

describe('zip', () => {
  it('writes a zip it (and other tools) can read back', async () => {
    const entries = [
      { path: 'games/a/main.ts', bytes: text('x'.repeat(1000)) },
      { path: 'assets/sfx/b.wav', bytes: new Uint8Array([1, 2, 3]) },
    ];
    const zip = await writeZip(entries);
    expect(zip.length).toBeLessThan(400); // the text is deflated
    expect(await readZip(zip)).toEqual(entries);
    expect(await writeZip(entries)).toEqual(zip); // no clock: the same files give the same zip
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    const python = await readZip(Uint8Array.from(atob(PYTHON_ZIP), (c) => c.charCodeAt(0)));
    expect(python.map((e) => e.path)).toEqual([
      'mygame/games/hello/main.ts',
      'mygame/assets/sfx/beep.wav.json',
      'mygame/assets/sfx/beep.wav',
    ]);
    await expect(readZip(text('not a zip'))).rejects.toThrow('Not a zip file');
  });

  it('refuses a zip that unpacks to more than it says, or too much', async () => {
    const zip = await writeZip([{ path: 'games/a/main.ts', bytes: text('a'.repeat(5000)) }]);
    const lying = zip.slice();
    const view = new DataView(lying.buffer);
    const central = lying.findIndex((_, i) => i + 4 <= lying.length && view.getUint32(i, true) === 0x02014b50);
    view.setUint32(central + 24, 10, true); // claims 10 bytes
    await expect(readZip(lying)).rejects.toThrow('larger than it says');
    view.setUint32(central + 24, MAX_UNZIPPED + 1, true);
    await expect(readZip(lying)).rejects.toThrow('unpacks to more than');
  });

  it('accepts only one game and library assets, at project paths', async () => {
    const zipOf = (...paths: string[]) => writeZip(paths.map((path) => ({ path, bytes: text('x') })));
    expect((await readGameZip(Uint8Array.from(atob(PYTHON_ZIP), (c) => c.charCodeAt(0)))).game).toBe('hello');
    for (const [paths, message] of [
      [['games/a/main.ts', '../evil.ts'], 'Not a game zip'],
      [['games/a/main.ts', 'games/a/../../x.ts'], 'Not a game zip'],
      [['games/a/main.ts', 'engine/sdk/index.ts'], 'Not a game zip'],
      [['games/a/main.ts', 'assets/sfx/notes.txt'], 'Not a game zip'],
      [['games/a/main.ts', 'games/b/main.ts'], 'several games'],
      [['games/a/util.ts'], 'main.ts is missing'],
      [['assets/sfx/a.wav'], 'no games/'],
    ] as const) {
      await expect(readGameZip(await zipOf(...paths))).rejects.toThrow(message);
    }
  });
});

describe('game export and import', () => {
  const asset = (kind: LibraryAsset['kind'], id: string, usedBy: string[]) => ({ kind, id, usedBy }) as LibraryAsset;

  it('exports a game with the assets it uses, and imports it as one undo step', async () => {
    const ws = new MemoryWorkspace({
      'games/pong/main.ts': 'pong',
      'games/pong/ball.ts': 'ball',
      'games/snake/main.ts': 'snake',
      'assets/sprites/ball~2x1.png': new Uint8Array([1]),
      'assets/sprites/ball~2x1.png.json': '{"tags":["round"]}',
      'assets/sfx/hit.wav': new Uint8Array([2]),
      'assets/sfx/other.wav': new Uint8Array([3]),
    });
    const files = new ProjectFiles(ws);
    await files.start();
    const assets = [
      asset('sprites', 'ball', ['pong']),
      asset('sfx', 'hit', ['pong', 'snake']),
      asset('sfx', 'other', ['snake']),
    ];
    expect(usedAssets(assets, 'pong')).toEqual({ sprites: ['ball'], sfx: ['hit'], music: [] });
    const zip = await exportGameZip(files, 'pong', assets);
    expect((await readZip(zip)).map((e) => e.path)).toEqual([
      'assets/sfx/hit.wav',
      'assets/sprites/ball~2x1.png',
      'assets/sprites/ball~2x1.png.json',
      'games/pong/ball.ts',
      'games/pong/main.ts',
    ]);

    // Into a project with snake, a different hit.wav, and no pong.
    const target = new MemoryWorkspace({ 'games/snake/main.ts': 'snake', 'assets/sfx/hit.wav': new Uint8Array([9]) });
    const other = new ProjectFiles(target);
    await other.start();
    const plan = await planGameImport(other, zip);
    expect(plan.gameExists).toBe(false);
    expect(plan.changed.map((f) => f.path)).toEqual(['assets/sfx/hit.wav']);
    expect(plan.added.map((f) => f.path)).toHaveLength(4);
    const stack = new CommandStack(createStore({}));
    await stack.runFile(await gameImportCommand(other, plan, false));
    expect(target.text('games/pong/main.ts')).toBe('pong');
    expect([...(target.data.get('assets/sfx/hit.wav') ?? [])]).toEqual([9]); // kept
    expect(stack.getState().history).toEqual(["Import game 'pong'"]);
    stack.undo();
    await stack.idle();
    expect([...target.data.keys()].sort()).toEqual(['assets/sfx/hit.wav', 'games/snake/main.ts']);

    // Replacing takes the zip's hit.wav; a second import of pong is refused.
    await stack.runFile(await gameImportCommand(other, plan, true));
    expect([...(target.data.get('assets/sfx/hit.wav') ?? [])]).toEqual([2]);
    await stack.idle();
    const again = await planGameImport(other, zip);
    expect(again.gameExists).toBe(true);
    await expect(gameImportCommand(other, again, false)).rejects.toThrow('already has a game named pong');
  });
});
