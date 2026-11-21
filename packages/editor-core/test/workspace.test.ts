import { describe, expect, it } from 'vitest';
import { CommandStack } from '../src/commands.ts';
import { createGame, deleteFiles, newGameSource, renameFiles, writeFile } from '../src/file-commands.ts';
import { buildTree, filesUnder } from '../src/file-tree.ts';
import { type EventStream, HttpWorkspace } from '../src/http-workspace.ts';
import { ProjectFiles } from '../src/project-files.ts';
import { createStore } from '../src/store.ts';
import type { FileChange } from '../src/workspace.ts';
import { MemoryWorkspace } from './memory-workspace.ts';

const settle = () => new Promise((r) => setTimeout(r, 0));

function project(watch = true) {
  const ws = new MemoryWorkspace(
    {
      'games/pong/main.ts': 'const TITLE = "Pong";',
      'games/asconfig.json': '{}',
      'engine/sdk/index.ts': 'export {}',
      'assets/sprites/ball.png': new Uint8Array([1, 2, 3]),
      'assets/sprites/coin~8x1-v2.png': new Uint8Array([4]),
      'assets/sfx/hit.wav': new Uint8Array([5]),
      'assets/sprites/README.md': '# sprites',
    },
    { watch },
  );
  return { ws, files: new ProjectFiles(ws) };
}

describe('HttpWorkspace', () => {
  it('speaks the dev server protocol', async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: unknown }> = [];
    const fetch = (async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body,
      });
      if (url.endsWith('files.json')) {
        return new Response(JSON.stringify({ writable: true, watch: true, files: [] }));
      }
      if (url.includes('missing')) return new Response('games/missing not found', { status: 404 });
      return new Response(new Uint8Array([7]));
    }) as typeof globalThis.fetch;
    let opened = '';
    let stream: { onmessage: ((e: MessageEvent<string>) => void) | null; close(): void } | null = null;
    const ws = new HttpWorkspace('http://host/app/', {
      fetch,
      openEvents: (url) => {
        opened = url;
        stream = { onmessage: null, close: () => {} };
        return stream;
      },
    });
    expect((await ws.list()).writable).toBe(true);
    expect(await ws.read('games/my game/main.ts')).toEqual(new Uint8Array([7]));
    await ws.write('games/pong/main.ts', 'x');
    await ws.delete('games/pong/old.ts');
    await ws.rename('games/a.ts', 'games/b.ts');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET http://host/app/__tf/files.json',
      'GET http://host/app/__tf/files/games/my%20game/main.ts',
      'PUT http://host/app/__tf/files/games/pong/main.ts',
      'DELETE http://host/app/__tf/files/games/pong/old.ts',
      'POST http://host/app/__tf/rename',
    ]);
    expect(calls.slice(2).every((c) => c.headers['X-TinyForge'] === '1')).toBe(true);
    await expect(ws.read('games/missing')).rejects.toThrow('games/missing not found');
    expect(ws.url({ path: 'assets/sprites/a b.png', size: 1, mtime: 42 })).toBe(
      'http://host/app/__tf/files/assets/sprites/a%20b.png?v=42',
    );

    const seen: FileChange[][] = [];
    ws.watch((c) => seen.push(c));
    expect(opened).toBe('http://host/app/__tf/events');
    (stream as unknown as EventStream).onmessage?.({
      data: JSON.stringify({ changes: [{ path: 'games/pong/main.ts', kind: 'change' }] }),
    } as MessageEvent<string>);
    expect(seen).toEqual([[{ path: 'games/pong/main.ts', kind: 'change' }]]);
  });

  it('does not open a change stream for a static copy', async () => {
    let opened = false;
    const ws = new HttpWorkspace('http://host/', {
      fetch: (async () => new Response(JSON.stringify({ writable: false, watch: false, files: [] }))) as typeof fetch,
      openEvents: () => {
        opened = true;
        return { onmessage: null, close: () => {} };
      },
    });
    await ws.list();
    ws.watch(() => {});
    expect(opened).toBe(false);
  });
});

describe('ProjectFiles', () => {
  it('derives the games and the asset library from the file list', async () => {
    const { files } = project();
    await files.start();
    expect(files.games).toEqual(['pong']);
    expect(files.assetFiles).toEqual({ sprites: ['ball.png', 'coin~8x1-v2.png'], sfx: ['hit.wav'], music: [] });
    expect(files.library.sprites.map((r) => [r.id, r.format])).toEqual([
      ['ball', ''],
      ['coin', '8x1'],
    ]);
    expect(files.library.sprites[0].url).toMatch(/^mem:\/assets\/sprites\/ball\.png\?v=\d+$/);
  });

  it('caches reads until a file changes, and reports every change once', async () => {
    const { ws, files } = project();
    await files.start();
    const seen: FileChange[][] = [];
    files.onChange((c) => seen.push(c));
    expect(await files.readText('games/pong/main.ts')).toBe('const TITLE = "Pong";');
    ws.external('games/pong/main.ts', 'const TITLE = "Pong 2";');
    await settle();
    await settle();
    expect(await files.readText('games/pong/main.ts')).toBe('const TITLE = "Pong 2";');
    await files.write('games/snake/main.ts', 'x');
    await settle();
    await settle();
    expect(files.games).toEqual(['pong', 'snake']);
    expect(seen).toEqual([
      [{ path: 'games/pong/main.ts', kind: 'change' }],
      [{ path: 'games/snake/main.ts', kind: 'add' }],
    ]);
    expect(await files.readText('games/none.ts')).toBeNull();
  });

  it('applies its own writes when the workspace does not watch', async () => {
    const { files } = project(false);
    await files.start();
    await files.write('games/snake/main.ts', 'x');
    expect(files.games).toEqual(['pong', 'snake']);
    await files.rename('games/snake/main.ts', 'games/snake2/main.ts');
    expect(files.games).toEqual(['pong', 'snake2']);
  });
});

describe('file commands', () => {
  async function setup() {
    const { ws, files } = project(false);
    await files.start();
    const stack = new CommandStack(createStore({}));
    return { ws, files, stack };
  }

  it('undoes and redoes a save, a delete and a move', async () => {
    const { ws, files, stack } = await setup();
    await stack.runFile(await writeFile(files, 'games/pong/main.ts', 'new'));
    await stack.runFile(await deleteFiles(files, ['assets/sfx/hit.wav']));
    await stack.runFile(renameFiles(files, [['games/pong/main.ts', 'games/pong2/main.ts']]));
    expect(stack.state.undoLabel).toBe('Rename main.ts');
    expect(ws.text('games/pong2/main.ts')).toBe('new');

    stack.undo();
    stack.undo();
    stack.undo();
    await stack.idle();
    expect(ws.text('games/pong/main.ts')).toBe('const TITLE = "Pong";');
    expect(ws.data.get('assets/sfx/hit.wav')).toEqual(new Uint8Array([5]));
    expect(files.games).toEqual(['pong']);

    stack.redo();
    await stack.idle();
    expect(ws.text('games/pong/main.ts')).toBe('new');
  });

  it('a new file is deleted by its undo; a failed command does not join the history', async () => {
    const { ws, files, stack } = await setup();
    await stack.runFile(await createGame(files, 'space'));
    expect(ws.text('games/space/main.ts')).toBe(newGameSource('space'));
    await expect(createGame(files, 'space')).rejects.toThrow('already exists');
    await expect(createGame(files, 'bad name')).rejects.toThrow('letters, digits');
    expect(() => renameFiles(files, [['games/space/main.ts', 'games/pong/main.ts']])).toThrow('already exists');
    stack.undo();
    await stack.idle();
    expect(ws.data.has('games/space/main.ts')).toBe(false);

    const errors: string[] = [];
    const failing = new CommandStack(createStore({}), (m) => errors.push(m));
    await expect(
      failing.runFile({
        type: 'x',
        label: 'Break',
        args: null,
        apply: () => Promise.reject(new Error('disk full')),
        revert: async () => {},
      }),
    ).rejects.toThrow('disk full');
    expect(failing.state.canUndo).toBe(false);
  });
});

describe('file tree', () => {
  it('nests folders before files, games first, and knows what is read-only', async () => {
    const { files } = project();
    await files.start();
    const tree = buildTree(files.files);
    expect(tree.map((n) => n.name)).toEqual(['games', 'assets', 'engine']);
    const games = tree[0];
    expect(games.children.map((n) => `${n.kind}:${n.name}`)).toEqual(['folder:pong', 'file:asconfig.json']);
    expect(tree[2].readonly).toBe(true);
    expect(games.children[0].readonly).toBe(false);
    expect(filesUnder(files.files, 'assets/sprites').sort()).toEqual([
      'assets/sprites/README.md',
      'assets/sprites/ball.png',
      'assets/sprites/coin~8x1-v2.png',
    ]);
  });
});
