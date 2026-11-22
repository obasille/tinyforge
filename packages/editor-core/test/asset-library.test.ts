import { describe, expect, it } from 'vitest';
import {
  draftImport,
  idFromName,
  importCommand,
  importProblems,
  kindForFile,
  suggestedSheet,
  targetFile,
} from '../src/asset-import.ts';
import { AssetLibrary, idProblem, type LibraryAsset, matchesSearch, tagCounts } from '../src/asset-library.ts';
import { CommandStack } from '../src/commands.ts';
import type { CompilerHost } from '../src/compiler-host.ts';
import { imageSize } from '../src/png.ts';
import { ProjectFiles } from '../src/project-files.ts';
import { createStore } from '../src/store.ts';
import { Workbench } from '../src/workbench.ts';
import { MemoryWorkspace } from './memory-workspace.ts';

const settle = () => new Promise((r) => setTimeout(r, 0));

/** A PNG header (signature + IHDR) of the given size; enough for imageSize. */
function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

/** A JPEG start with an APP0 segment, then SOF0 with the given size. */
function jpegHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0,
    4,
    0,
    0,
    0xff,
    0xc0,
    0,
    11,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    3,
    0,
    0,
    0,
  ]);
  return b;
}

async function project(extra: Record<string, string | Uint8Array> = {}) {
  const ws = new MemoryWorkspace({
    'games/pong/main.ts':
      'const TITLE = "Pong";\nconst COVER = "pong_cover";\nexport function draw(): void { s("ball"); playSfx(hit ? "hit" : "miss"); }',
    'games/tank/main.ts': 'const TITLE = "Tank";\nexport function draw(): void { s("ball"); playMusic("theme"); }',
    'games/tank/level.ts': 'export function lvl(): void { s("coin", 1, 0); }',
    'assets/sprites/ball.png': pngHeader(8, 8),
    'assets/sprites/ball.png.json': '{"tags":["round","Retro"],"license":"CC0","custom":1}',
    'assets/sprites/coin~8x1-v2.png': pngHeader(64, 8),
    'assets/sprites/pong_cover.png': pngHeader(32, 32),
    'assets/sprites/bad~3y.png': pngHeader(8, 8),
    'assets/sfx/hit.wav': new Uint8Array([1]),
    'assets/sfx/hit-loud.ogg': new Uint8Array([2]),
    'assets/sfx/miss.wav': new Uint8Array([3]),
    'assets/sfx/miss.wav.json': 'not json',
    'assets/music/theme.wav': new Uint8Array([4]),
    'assets/music/unused~2x1.wav': new Uint8Array([5]),
    ...extra,
  });
  const files = new ProjectFiles(ws);
  await files.start();
  const library = new AssetLibrary(files);
  files.onChange((changes) => void library.filesChanged(changes));
  await library.start();
  const find = (path: string) => library.state.getState().assets.find((a) => a.path === path) as LibraryAsset;
  return { ws, files, library, find };
}

describe('asset IDs', () => {
  it('checks IDs', () => {
    expect(idProblem('coin_2')).toBeNull();
    expect(idProblem('')).toMatch(/required/);
    expect(idProblem('a-b')).toMatch(/letters/);
    expect(idProblem('a'.repeat(17))).toMatch(/16/);
  });

  it('makes IDs from file names', () => {
    expect(idFromName('coin~8x1-v2.png')).toBe('coin');
    expect(idFromName('My Hero (final).png')).toBe('My_Hero_final');
    expect(idFromName('a very long sprite name.png')).toBe('a_very_long_spri');
    expect(idFromName('---.png')).toBe('asset');
    expect(kindForFile('boom.WAV')).toBe('sfx');
    expect(kindForFile('level_theme.ogg')).toBe('music');
    expect(kindForFile('hero.jpeg')).toBe('sprites');
    expect(kindForFile('notes.txt')).toBeNull();
  });
});

describe('imageSize', () => {
  it('reads PNG and JPEG headers', () => {
    expect(imageSize(pngHeader(320, 24))).toEqual({ width: 320, height: 24 });
    expect(imageSize(jpegHeader(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('suggests strips of square frames', () => {
    expect(suggestedSheet({ width: 72, height: 8 })).toEqual({ cols: 9, rows: 1 });
    expect(suggestedSheet({ width: 16, height: 64 })).toEqual({ cols: 1, rows: 4 });
    expect(suggestedSheet({ width: 20, height: 8 })).toBeNull();
    expect(suggestedSheet({ width: 8, height: 8 })).toBeNull();
  });
});

describe('AssetLibrary', () => {
  it('lists assets with their layout, sidecar, issues and users', async () => {
    const { find, library } = await project();
    const ball = find('assets/sprites/ball.png');
    expect(ball).toMatchObject({ kind: 'sprites', id: 'ball', cols: 1, rows: 1, usedBy: ['pong', 'tank'], issues: [] });
    expect(ball.sidecar).toEqual({ tags: ['round', 'Retro'], license: 'CC0', custom: 1 });
    expect(find('assets/sprites/coin~8x1-v2.png')).toMatchObject({ id: 'coin', cols: 8, rows: 1, usedBy: ['tank'] });
    // The COVER counts as a use.
    expect(find('assets/sprites/pong_cover.png').usedBy).toEqual(['pong']);
    // Both branches of a choice count.
    expect(find('assets/sfx/miss.wav').usedBy).toEqual(['pong']);
    expect(find('assets/sfx/miss.wav').sidecar).toBeNull();
    expect(find('assets/sprites/bad~3y.png').issues).toEqual(['"3y" is not a sheet format like 8x1']);
    expect(find('assets/music/unused~2x1.wav').issues).toEqual(['Only sprites have a sheet format']);
    expect(find('assets/sfx/hit.wav').issues[0]).toMatch(/Same ID as hit-loud.ogg/);
    // Sidecars are not assets.
    expect(library.state.getState().assets.some((a) => a.path.endsWith('.json'))).toBe(false);
  });

  it('follows file changes and live uses', async () => {
    const { ws, find, library } = await project();
    ws.external('games/tank/level.ts', 'export function lvl(): void {}');
    ws.external('assets/sprites/coin~8x1-v2.png.json', '{"tags":"oops"}');
    await settle();
    await library.idle();
    expect(find('assets/sprites/coin~8x1-v2.png').usedBy).toEqual([]);
    // A sidecar whose tags are not a list gets an empty one.
    expect(find('assets/sprites/coin~8x1-v2.png').sidecar).toEqual({ tags: [] });
    library.setLiveUses('tank', { sprites: ['coin'], sfx: [], music: [] });
    expect(find('assets/sprites/coin~8x1-v2.png').usedBy).toEqual(['tank']);
    ws.external('games/pong/main.ts', null);
    await settle();
    await library.idle();
    expect(find('assets/sprites/ball.png').usedBy).toEqual(['tank']);
  });

  it('searches IDs, file names and tags', async () => {
    const { find, library } = await project();
    const ball = find('assets/sprites/ball.png');
    expect(matchesSearch(ball, '')).toBe(true);
    expect(matchesSearch(ball, 'BA')).toBe(true);
    expect(matchesSearch(ball, 'retro')).toBe(true);
    expect(matchesSearch(ball, '#retro ball')).toBe(true);
    expect(matchesSearch(ball, '#ret')).toBe(false);
    expect(matchesSearch(ball, 'ball coin')).toBe(false);
    expect(tagCounts(library.state.getState().assets)).toEqual([
      { tag: 'Retro', count: 1 },
      { tag: 'round', count: 1 },
    ]);
  });
});

describe('import', () => {
  it('drafts a file from its name and checks it', async () => {
    const { library } = await project();
    const assets = library.state.getState().assets;
    const coin = draftImport('coin~4x2-new.png', pngHeader(32, 16));
    expect(coin).toMatchObject({ kind: 'sprites', id: 'coin', cols: 4, rows: 2, image: { width: 32, height: 16 } });
    expect(targetFile(coin)).toBe('coin~4x2.png');
    expect(importProblems(coin, assets, [coin])).toEqual(['The library already has a sprite "coin"']);
    const alone = (d: typeof coin) => importProblems(d, assets, [d]);
    expect(alone({ ...coin, replace: true })).toEqual([]);
    expect(alone({ ...coin, id: 'gem', cols: 3 })).toEqual(['32×16 does not split into 3×2 equal frames']);
    expect(alone({ ...coin, id: 'gem', cols: 0 })[0]).toMatch(/whole numbers/);
    const twin = { ...coin, id: 'gem' };
    expect(importProblems(twin, assets, [twin, { ...twin }])).toEqual(['Another file in this import has the ID "gem"']);
    expect(importProblems(draftImport('notes.txt', new Uint8Array()), assets, [])[0]).toMatch(/Not an image/);
    expect(importProblems(draftImport('x.png', new Uint8Array([1])), assets, [])).toEqual([
      'The image could not be read',
    ]);
    const boom = draftImport('boom.wav', new Uint8Array([9]));
    expect(boom).toMatchObject({ kind: 'sfx', id: 'boom', cols: 1, rows: 1, image: null });
    expect(importProblems(boom, assets, [boom])).toEqual([]);
  });

  it('imports as one undoable command, replacing and keeping sidecars', async () => {
    const { ws, files, library, find } = await project();
    const stack = new CommandStack(createStore({}));
    const assets = library.state.getState().assets;
    const ball = { ...draftImport('ball~2x1.png', pngHeader(16, 8)), replace: true };
    const gem = { ...draftImport('gem.png', pngHeader(8, 8)), tags: ['shiny'], license: 'CC0' };
    await stack.runFile(await importCommand(files, [ball, gem], assets));
    await settle();
    await library.idle();
    expect(ws.data.has('assets/sprites/ball.png')).toBe(false);
    expect(ws.data.has('assets/sprites/ball.png.json')).toBe(false);
    // The replaced sprite's sidecar moved to the new file.
    expect(JSON.parse(ws.text('assets/sprites/ball~2x1.png.json') ?? '')).toMatchObject({ license: 'CC0', custom: 1 });
    expect(JSON.parse(ws.text('assets/sprites/gem.png.json') ?? '')).toEqual({ tags: ['shiny'], license: 'CC0' });
    expect(find('assets/sprites/ball~2x1.png')).toMatchObject({ cols: 2, usedBy: ['pong', 'tank'] });
    expect(stack.getState().undoLabel).toBe('Import 2 assets');
    stack.undo();
    await stack.idle();
    await settle();
    expect(ws.data.has('assets/sprites/ball~2x1.png')).toBe(false);
    expect(ws.data.has('assets/sprites/gem.png')).toBe(false);
    expect(ws.data.has('assets/sprites/gem.png.json')).toBe(false);
    expect(ws.text('assets/sprites/ball.png.json')).toContain('custom');
    expect(ws.data.has('assets/sprites/ball.png')).toBe(true);
  });

  it('refuses drafts with problems', async () => {
    const { files, library } = await project();
    const coin = draftImport('coin.png', pngHeader(8, 8));
    await expect(importCommand(files, [coin], library.state.getState().assets)).rejects.toThrow(/already has/);
  });
});

describe('Workbench asset files', () => {
  async function setup() {
    const p = await project();
    const stack = new CommandStack(createStore({}));
    const compiler = { builds: createStore({}), build: async () => ({}) } as unknown as CompilerHost;
    return { ...p, stack, bench: new Workbench(p.files, stack, compiler, () => null) };
  }

  it('moves and deletes an asset with its sidecar', async () => {
    const { ws, bench, stack } = await setup();
    await bench.rename('assets/sprites/ball.png', 'assets/sprites/orb.png');
    await settle();
    expect(ws.text('assets/sprites/orb.png.json')).toContain('round');
    expect(ws.data.has('assets/sprites/ball.png.json')).toBe(false);
    await bench.delete('assets/sprites/orb.png');
    await settle();
    expect(ws.data.has('assets/sprites/orb.png.json')).toBe(false);
    stack.undo();
    await stack.idle();
    expect(ws.text('assets/sprites/orb.png.json')).toContain('round');
  });

  it('saves and clears sidecars', async () => {
    const { ws, bench, stack } = await setup();
    await bench.saveSidecar('assets/sfx/hit.wav', { tags: ['impact'], source: 'sfxr' });
    await settle();
    expect(JSON.parse(ws.text('assets/sfx/hit.wav.json') ?? '')).toEqual({ tags: ['impact'], source: 'sfxr' });
    await bench.saveSidecar('assets/sfx/hit.wav', { tags: [], license: undefined });
    await settle();
    expect(ws.data.has('assets/sfx/hit.wav.json')).toBe(false);
    stack.undo();
    await stack.idle();
    expect(ws.data.has('assets/sfx/hit.wav.json')).toBe(true);
  });
});
