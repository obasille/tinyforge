// Vite plugin that serves TinyForge cartridges and assets to the editor.
//
// Dev server:
//   GET /__tf/manifest.json            games and asset lists
//   GET /__tf/cartridges/<game>.wasm   debug build, compiled on first request
//   GET /__tf/cartridges/<game>.wasm.map
//   GET /assets/...                    the repo's shared assets/ folder
// When an engine file changes, the affected games that were already compiled
// are rebuilt and the client gets a `tf:cartridges` HMR event (or Vite's error
// overlay with the compiler output). Adding or removing a library file
// rebuilds them too (an asset ID may have become valid or unknown). When any
// file in assets/sprites, assets/sfx or assets/music is added, changed or
// removed, the client gets a `tf:assets` event and reloads the game's sprites
// and sounds. Asset URLs carry the file's modification time, so a changed
// file has a new URL and an unchanged one stays cached.
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
  gamesAffectedByAsset,
  listGames,
} from '../../../packages/engine/tooling/compile-game.ts';

export const CARTRIDGES_EVENT = 'tf:cartridges';
export const ASSETS_EVENT = 'tf:assets';

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

async function listAssets(
  assetsDir: string,
  sub: string,
  pattern: RegExp,
  base: string,
  versioned: boolean,
): Promise<AssetRef[]> {
  const dir = path.join(assetsDir, sub);
  if (!existsSync(dir)) return [];
  const files = (await fs.readdir(dir)).filter((f) => pattern.test(f)).sort();
  return files.flatMap((file) => {
    const parsed = parseId(file);
    if (!parsed) return [];
    const version = versioned ? `?v=${Math.floor(statSync(path.join(dir, file)).mtimeMs)}` : '';
    return [{ ...parsed, url: `${base}assets/${sub}/${encodeURIComponent(file)}${version}` }];
  });
}

/** Games and the asset library. Dev URLs are versioned by modification time. */
async function manifest(assetsDir: string, base: string, versioned: boolean) {
  return {
    games: listGames(),
    sprites: await listAssets(assetsDir, 'sprites', /\.(png|jpe?g)$/i, base, versioned),
    sfx: await listAssets(assetsDir, 'sfx', /\.(wav|mp3|ogg)$/i, base, versioned),
    music: await listAssets(assetsDir, 'music', /\.(wav|mp3|ogg)$/i, base, versioned),
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

      // Rebuild the affected games someone has loaded; the rest compile on request.
      const rebuild = async (affected: string[]) => {
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

      // Library files: once a burst of changes (e.g. a git checkout or a
      // generator script) has settled, tell the client to reload its assets,
      // then rebuild the games it affects (in that order, so a hot reload
      // finds the new files in the library).
      let assetsTimer: ReturnType<typeof setTimeout> | null = null;
      const assetGames = new Set<string>();
      const assetsChanged = (games: string[]) => {
        for (const g of games) assetGames.add(g);
        if (assetsTimer) clearTimeout(assetsTimer);
        assetsTimer = setTimeout(() => {
          assetsTimer = null;
          const affected = [...assetGames];
          assetGames.clear();
          dev.ws.send({ type: 'custom', event: ASSETS_EVENT, data: {} });
          void rebuild(affected);
        }, 200);
      };

      const onChange = (event: 'add' | 'change' | 'unlink') => async (file: string) => {
        const engine = gamesAffectedBy(file);
        if (engine) return rebuild(engine);
        const asset = gamesAffectedByAsset(file, event);
        if (asset) assetsChanged(asset);
      };
      dev.watcher.on('change', onChange('change'));
      dev.watcher.on('add', onChange('add'));
      dev.watcher.on('unlink', onChange('unlink'));

      dev.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const pathname = decodeURIComponent(url.pathname);
        try {
          if (pathname === '/__tf/manifest.json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify(await manifest(assetsDir, dev.config.base, true)));
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
      const m = await manifest(assetsDir, base, false);
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
