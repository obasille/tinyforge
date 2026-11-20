// Vite plugin that serves TinyForge cartridges and assets to the editor.
//
// Dev server:
//   GET /__tf/manifest.json            games and asset lists
//   GET /__tf/cartridges/<game>.wasm   debug build, compiled on first request
//   GET /__tf/cartridges/<game>.wasm.map
//   GET /assets/...                    the repo's shared assets/ folder
// When an engine file changes, the affected games that were already compiled
// are rebuilt and the client gets a `tf:cartridges` HMR event (or Vite's error
// overlay with the compiler output). When a file in assets/sfx or assets/music
// is added, changed or removed, the client gets a `tf:audio` event and reloads
// its sounds.
//
// Build: emits release cartridges, the manifest and the assets into dist/.

import { createReadStream, existsSync, promises as fs, statSync } from 'node:fs';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import {
  type CompileResult,
  compileGame,
  ENGINE_ROOT,
  gamesAffectedBy,
  listGames,
} from '../../../packages/engine/tooling/compile-game.ts';

export const CARTRIDGES_EVENT = 'tf:cartridges';
export const AUDIO_EVENT = 'tf:audio';

export interface CartridgesEvent {
  games: string[];
}

interface AssetRef {
  id: string;
  format: string;
  url: string;
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

function parseId(file: string): { id: string; format: string } | null {
  const name = file.replace(/\.[^/.]+$/, '');
  const tilde = name.indexOf('~');
  const dash = name.indexOf('-');
  if (tilde >= 0) {
    const rest = name.slice(tilde + 1);
    const restDash = rest.indexOf('-');
    return { id: name.slice(0, tilde), format: restDash >= 0 ? rest.slice(0, restDash) : rest };
  }
  const id = dash >= 0 ? name.slice(0, dash) : name;
  return id ? { id, format: '' } : null;
}

async function listAssets(assetsDir: string, sub: string, pattern: RegExp, base: string): Promise<AssetRef[]> {
  const dir = path.join(assetsDir, sub);
  if (!existsSync(dir)) return [];
  const files = (await fs.readdir(dir)).filter((f) => pattern.test(f)).sort();
  return files.flatMap((file) => {
    const parsed = parseId(file);
    return parsed ? [{ ...parsed, url: `${base}assets/${sub}/${encodeURIComponent(file)}` }] : [];
  });
}

async function manifest(assetsDir: string, base: string) {
  return {
    games: listGames(),
    sprites: await listAssets(assetsDir, 'sprites', /\.(png|jpe?g)$/i, base),
    sfx: await listAssets(assetsDir, 'sfx', /\.(wav|mp3|ogg)$/i, base),
    music: await listAssets(assetsDir, 'music', /\.(wav|mp3|ogg)$/i, base),
  };
}

/** Rewrite absolute source paths to Vite's /@fs/ URLs so DevTools can open them. */
function sourceMapForBrowser(map: string): string {
  const parsed = JSON.parse(map) as { sources?: string[] };
  parsed.sources = parsed.sources?.map((s) =>
    path.isAbsolute(s) ? `/@fs/${s.split(path.sep).join('/').replace(/^\//, '')}` : s,
  );
  return JSON.stringify(parsed);
}

export function tinyforge({ assetsDir }: { assetsDir: string }): Plugin {
  const cache = new Map<string, Promise<CompileResult>>();
  let server: ViteDevServer | null = null;

  const build = (game: string): Promise<CompileResult> => {
    let result = cache.get(game);
    if (!result) {
      const started = Date.now();
      result = compileGame(game, 'debug').then((r) => {
        server?.config.logger.info(
          `[tinyforge] ${r.ok ? 'compiled' : 'failed to compile'} ${game} in ${Date.now() - started} ms`,
          {
            timestamp: true,
          },
        );
        return r;
      });
      cache.set(game, result);
    }
    return result;
  };

  return {
    name: 'tinyforge',

    configureServer(dev) {
      server = dev;
      dev.watcher.add(ENGINE_ROOT);
      dev.watcher.add(assetsDir);

      // Audio files: tell the client once a burst of changes (e.g. a git
      // checkout or a generator script) has settled.
      const audioDirs = ['sfx', 'music'].map((sub) => path.join(assetsDir, sub) + path.sep);
      let audioTimer: ReturnType<typeof setTimeout> | null = null;
      const onAudioChange = (file: string) => {
        if (!audioDirs.some((dir) => file.startsWith(dir))) return;
        if (audioTimer) clearTimeout(audioTimer);
        audioTimer = setTimeout(() => {
          audioTimer = null;
          dev.ws.send({ type: 'custom', event: AUDIO_EVENT, data: {} });
        }, 200);
      };

      const onChange = async (file: string) => {
        const affected = gamesAffectedBy(file);
        if (!affected) return;
        // Only rebuild games someone has loaded; the rest compile on request.
        const loaded = affected.filter((g) => cache.has(g));
        for (const g of affected) cache.delete(g);
        if (loaded.length === 0) return;
        const results = await Promise.all(loaded.map(async (g) => [g, await build(g)] as const));
        const failed = results.find(([, r]) => !r.ok);
        if (failed) {
          dev.ws.send({
            type: 'error',
            err: { message: `AssemblyScript: ${failed[0]} failed to compile\n\n${failed[1].log}`, stack: '' },
          });
          dev.ws.send({
            type: 'custom',
            event: CARTRIDGES_EVENT,
            data: { games: [], failed: failed[0], log: failed[1].log },
          });
          return;
        }
        dev.ws.send({ type: 'custom', event: CARTRIDGES_EVENT, data: { games: loaded } satisfies CartridgesEvent });
      };
      dev.watcher.on('change', onChange);
      dev.watcher.on('add', onChange);
      dev.watcher.on('unlink', onChange);
      dev.watcher.on('change', onAudioChange);
      dev.watcher.on('add', onAudioChange);
      dev.watcher.on('unlink', onAudioChange);

      dev.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const pathname = decodeURIComponent(url.pathname);
        try {
          if (pathname === '/__tf/manifest.json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify(await manifest(assetsDir, dev.config.base)));
            return;
          }
          const cart = pathname.match(/^\/__tf\/cartridges\/([A-Za-z0-9_-]+)\.wasm(\.map)?$/);
          if (cart) {
            const [, game, isMap] = cart;
            const result = await build(game);
            res.setHeader('Cache-Control', 'no-store');
            if (!result.ok) {
              res.statusCode = listGames().includes(game) ? 500 : 404;
              res.setHeader('Content-Type', 'text/plain; charset=utf-8');
              res.end(result.log);
              return;
            }
            if (isMap) {
              res.setHeader('Content-Type', 'application/json');
              res.end(result.sourceMap ? sourceMapForBrowser(result.sourceMap) : '{}');
            } else {
              res.setHeader('Content-Type', 'application/wasm');
              res.end(Buffer.from(result.wasm));
            }
            return;
          }
          if (pathname.startsWith('/assets/')) {
            const file = path.resolve(assetsDir, pathname.slice('/assets/'.length));
            if (!file.startsWith(assetsDir + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
              res.statusCode = 404;
              res.end();
              return;
            }
            res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
            createReadStream(file).pipe(res);
            return;
          }
        } catch (e) {
          res.statusCode = 500;
          res.end(e instanceof Error ? e.message : String(e));
          return;
        }
        next();
      });
    },

    async generateBundle() {
      const base = '';
      const m = await manifest(assetsDir, base);
      m.sprites = m.sprites.map((a) => ({ ...a, url: a.url.replace(/^\//, '') }));
      this.emitFile({ type: 'asset', fileName: '__tf/manifest.json', source: JSON.stringify(m) });
      for (const game of m.games) {
        const r = await compileGame(game, 'release');
        if (!r.ok) this.error(`AssemblyScript: ${game} failed to compile\n${r.log}`);
        this.emitFile({ type: 'asset', fileName: `__tf/cartridges/${game}.wasm`, source: r.wasm });
      }
      for (const sub of ['sprites', 'sfx', 'music']) {
        const dir = path.join(assetsDir, sub);
        if (!existsSync(dir)) continue;
        for (const file of await fs.readdir(dir)) {
          if (!MIME[path.extname(file).toLowerCase()]) continue;
          this.emitFile({
            type: 'asset',
            fileName: `assets/${sub}/${file}`,
            source: await fs.readFile(path.join(dir, file)),
          });
        }
      }
    },
  };
}
