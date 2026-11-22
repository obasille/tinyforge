import { readFileSync } from 'node:fs';
import { findCustomSection } from '@tinyforge/engine/tooling/cartridge-meta';
import { diskPath, listProjectFiles } from '@tinyforge/engine/tooling/compile-game';
import { compile } from '@tinyforge/engine/tooling/compiler';
import { beforeAll, describe, expect, it } from 'vitest';
import { CompilerHost, type CompilerWorkerLike, type FromCompiler, type ToCompiler } from '../src/compiler-host.ts';
import { newGameSource } from '../src/file-commands.ts';
import { scanAssets, stringValue } from '../src/live-scan.ts';
import { ProjectFiles } from '../src/project-files.ts';
import { Workbench } from '../src/workbench.ts';
import { MemoryWorkspace } from './memory-workspace.ts';

/** The compile Worker's protocol, run in this thread. */
function inProcessWorker(): CompilerWorkerLike & { compiles: number } {
  const reads = new Map<number, (d: string | ArrayBuffer | null) => void>();
  let next = 1;
  const worker = {
    compiles: 0,
    onmessage: null as ((e: MessageEvent<FromCompiler>) => void) | null,
    onerror: null,
    terminate() {},
    postMessage(msg: ToCompiler) {
      if (msg.type === 'file') {
        reads.get(msg.requestId)?.(msg.data);
        return;
      }
      worker.compiles++;
      const read = (path: string, binary: boolean) =>
        new Promise<string | ArrayBuffer | null>((resolve) => {
          const requestId = next++;
          reads.set(requestId, resolve);
          worker.onmessage?.({ data: { type: 'read', requestId, path, binary } } as MessageEvent<FromCompiler>);
        });
      void compile({
        game: msg.game,
        target: msg.target,
        assetFiles: msg.assetFiles,
        files: {
          readText: async (p) => {
            const d = await read(p, false);
            return typeof d === 'string' ? d : null;
          },
          readBytes: async (p) => {
            const d = await read(p, true);
            return d instanceof ArrayBuffer ? new Uint8Array(d) : null;
          },
        },
      }).then((result) =>
        worker.onmessage?.({ data: { type: 'result', id: msg.id, result, ms: 1 } } as MessageEvent<FromCompiler>),
      );
    },
  };
  return worker;
}

const disk: Record<string, Uint8Array> = {};

beforeAll(async () => {
  // The engine, pong and the sprite library, copied from the repo.
  for (const f of await listProjectFiles()) {
    if (f.path.startsWith('games/') && !f.path.startsWith('games/pong/') && f.path !== 'games/asconfig.json') continue;
    // Sounds: only their names matter to a compile.
    const sound = f.path.startsWith('assets/sfx/') || f.path.startsWith('assets/music/');
    disk[f.path] = sound ? new Uint8Array(0) : new Uint8Array(readFileSync(diskPath(f.path) as string));
  }
});

async function setup(maxWorkers = 1) {
  const ws = new MemoryWorkspace(disk);
  const files = new ProjectFiles(ws);
  await files.start();
  const workers: ReturnType<typeof inProcessWorker>[] = [];
  const compiler = new CompilerHost(
    files,
    () => {
      workers.push(inProcessWorker());
      return workers[workers.length - 1];
    },
    maxWorkers,
  );
  const worker = {
    get compiles() {
      return workers.reduce((n, w) => n + w.compiles, 0);
    },
  };
  return { ws, files, worker, workers, compiler };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('CompilerHost', () => {
  it('compiles through the Worker protocol, caches, and rebuilds after a change', async () => {
    const { ws, files, worker, compiler } = await setup();
    const changes: string[][] = [];
    files.onChange(async (c) => changes.push(compiler.invalidate(c)));
    const first = await compiler.build('pong');
    if (!first.ok) throw new Error(first.log);
    expect(first.meta.title).toBe('Pong');
    // DevTools find the source map, which names the files by their Workspace URLs.
    const section = new TextDecoder().decode(findCustomSection(first.wasm, 'sourceMappingURL') ?? new Uint8Array());
    const url = section.slice(section.indexOf('data:')); // after the length prefix
    expect(url).toMatch(/^data:application\/json;base64,/);
    const map = JSON.parse(atob(url.slice(url.indexOf(',') + 1))) as { sources: string[] };
    expect(map.sources).toContainEqual(expect.stringMatching(/^mem:\/games\/pong\/main\.ts\?v=\d+$/));
    expect(() => new WebAssembly.Module(first.wasm)).not.toThrow();
    expect(compiler.builds.getState().pong).toMatchObject({ status: 'ok', diagnostics: [] });
    await compiler.build('pong');
    expect(worker.compiles).toBe(1);

    const main = ws.text('games/pong/main.ts') ?? '';
    ws.external(
      'games/pong/main.ts',
      main.replace('const PADDLE_WIDTH: i32 = 40;', 'const PADDLE_WIDTH: i32 = "wide";'),
    );
    await settle();
    await settle();
    expect(changes).toEqual([['pong']]);
    const broken = await compiler.build('pong');
    expect(broken.ok).toBe(false);
    expect(worker.compiles).toBe(2);
    const state = compiler.builds.getState().pong;
    expect(state.status).toBe('failed');
    expect(state.diagnostics[0]).toMatchObject({ path: 'games/pong/main.ts', severity: 'error' });
    // The last good build's assets stay known while the code is broken.
    expect(state.assets?.sfx).toContain('pong_wall');
  });

  it('rebuilds a game when its COVER sprite changes, not for other sprites', async () => {
    const { compiler } = await setup();
    await compiler.build('pong');
    expect(compiler.invalidate([{ path: 'assets/sprites/pong_cover.png', kind: 'change' }])).toEqual(['pong']);
    expect(compiler.invalidate([{ path: 'assets/sprites/heart.png', kind: 'change' }])).toEqual([]);
    expect(compiler.invalidate([{ path: 'assets/sprites/new.png', kind: 'add' }])).toEqual(['pong']);
  });

  it('compiles games in parallel, one Worker each', async () => {
    const { files, workers, compiler } = await setup(2);
    await files.write('games/fresh/main.ts', newGameSource('fresh'));
    await settle();
    await settle();
    const seen: string[] = [];
    compiler.builds.subscribe(() => {
      const b = compiler.builds.getState();
      seen.push(`${b.pong?.status},${b.fresh?.status}`);
    });
    const pong = compiler.build('pong');
    const fresh = compiler.build('fresh');
    expect((await pong).ok && (await fresh).ok).toBe(true);
    expect(workers.map((w) => w.compiles)).toEqual([1, 1]);
    expect(seen).toContain('building,building');
    // A later build reuses a Worker.
    await files.write('games/fresh/main.ts', `${newGameSource('fresh')}\n`);
    await settle();
    await settle();
    compiler.invalidate([{ path: 'games/fresh/main.ts', kind: 'change' }]);
    expect((await compiler.build('fresh')).ok).toBe(true);
    expect(workers.length).toBe(2);
  });

  it('shows a compile waiting for a free Worker as queued, then building', async () => {
    const { files, compiler } = await setup();
    await files.write('games/fresh/main.ts', newGameSource('fresh'));
    await settle();
    await settle();
    const status = () => [compiler.builds.getState().pong?.status, compiler.builds.getState().fresh?.status];
    const seen: string[] = [];
    compiler.builds.subscribe(() => seen.push(status().join(',')));
    const pong = compiler.build('pong');
    const fresh = compiler.build('fresh');
    expect(status()).toEqual(['queued', 'queued']);
    await pong;
    await fresh;
    expect(status()).toEqual(['ok', 'ok']);
    // pong was sent first: fresh waits until pong is done.
    expect(seen).toContain('building,queued');
    expect(seen.indexOf('ok,building')).toBeGreaterThan(seen.indexOf('building,queued'));
  });
});

describe('new game template', () => {
  it('compiles', async () => {
    const { files, compiler } = await setup();
    await files.write('games/fresh/main.ts', newGameSource('fresh'));
    await settle();
    await settle();
    const result = await compiler.build('fresh');
    if (!result.ok) throw new Error(result.log);
    expect(result.meta).toMatchObject({ title: 'fresh', ram: 0x100 });
  });
});

describe('live asset scan', () => {
  const library = {
    sprites: new Set(['ball', 'coin']),
    sfx: new Set(['hit']),
    music: new Set<string>(),
  };

  it('finds literal IDs, ternaries and parentheses, and flags the rest like the compiler', () => {
    const source = [
      'import { s } from "../../sdk";',
      's("ball"); s(\'coin\', 2);',
      'playSfx(won ? "hit" : ("miss"), 1.0);',
      's(name); foo.s("ignored"); playMusic(`theme`, 1.0);',
    ].join('\n');
    const { uses, issues } = scanAssets(source, library);
    expect(uses.map((u) => `${u.kind}:${u.id}`)).toEqual(['sprites:ball', 'sprites:coin', 'sfx:hit', 'sfx:miss']);
    expect(issues.map((i) => [source.slice(i.from, i.to), i.message])).toEqual([
      ['"miss"', 'Unknown sound effect "miss": no file with that ID in assets/sfx.'],
      ['name', 's() needs the sprite ID as a string literal, like s("name").'],
      ['`theme`', 'playMusic() needs the music track ID as a string literal, like playMusic("name").'],
    ]);
  });

  it('decodes string escapes', () => {
    expect(stringValue('"a\\"b"')).toBe('a"b');
    expect(stringValue("'\\u0041\\x42\\n'")).toBe('AB\n');
  });
});

describe('Workbench', () => {
  it('rebuilds a game built before when a sprite it uses is deleted, even with no file open', async () => {
    const { files, compiler } = await setup();
    const workbench = new Workbench(files, { runFile: async (c) => void (await c.apply()) }, compiler, () => 'pong');
    files.onChange(async (c) => workbench.filesChanged(c, compiler.invalidate(c)));
    const source = newGameSource('fresh')
      .replace('import {', 'import { drawSprite, s,')
      .replace('clearFramebuffer(c(0x141828));', 'clearFramebuffer(c(0x141828));\n  drawSprite(s("heart"), 0, 0);');
    await files.write('games/fresh/main.ts', source);
    await settle();
    await settle();
    expect((await compiler.build('fresh')).ok).toBe(true);
    await files.delete('assets/sprites/heart.png');
    await expect.poll(() => compiler.builds.getState().fresh?.status).toBe('failed');
  });

  it("reports the assets the current game's last build uses", async () => {
    const { files, compiler } = await setup();
    const runs: unknown[] = [];
    const workbench = new Workbench(
      files,
      { runFile: async (c) => void runs.push(await c.apply()) },
      compiler,
      () => 'pong',
    );
    await compiler.build('pong');
    workbench.gameChanged();
    expect(workbench.usedAssets.getState().sprites).toEqual([]);
    expect(workbench.usedAssets.getState().sfx).toContain('pong_wall');
  });
});
