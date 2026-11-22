// Vite plugin that serves the TinyForge project to the editor: the server
// side of the Workspace's HTTP protocol (editor-core http-workspace.ts).
//
// Dev server:
//   GET    /__tf/files.json         { writable, watch, files: [{ path, size, mtime, readonly? }] }
//   GET    /__tf/files/<path>       a file's bytes
//   PUT    /__tf/files/<path>       create or replace a file
//   DELETE /__tf/files/<path>       delete a file (and folders it leaves empty)
//   POST   /__tf/rename             { from, to }: move a file; `to` must not exist
//   GET    /__tf/events             server-sent events: { changes: [{ path, kind }] }
//
// Paths are project paths (packages/engine/tooling/project-layout.ts): games/,
// engine/ (read-only) and assets/. Only games/<name>/ and the library folders
// are writable. Requests that change files need an `X-TinyForge: 1` header,
// so another web page cannot make them (a custom header needs a CORS
// preflight, which this server does not grant), and a request whose Origin is
// another site is refused, reads included.
//
// The server only serves and watches files: the editor compiles in a Worker.
// A change on disk, from the editor or from any other program, reaches the
// editor the same way, through /__tf/events.
//
// Build: emits the same files.json (read-only, no events) and every project
// file under __tf/files/, so a static host serves the same protocol.

import { createReadStream, existsSync, promises as fs } from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import {
  diskPath,
  listProjectFiles,
  MEMORY_MAP_FILE,
  PROJECT_DIRS,
  type ProjectDirs,
  type ProjectFile,
  projectPathOfFile,
} from '../../../packages/engine/tooling/compile-game.ts';
import { isProjectPath, isWritablePath } from '../../../packages/engine/tooling/project-layout.ts';

export const MUTATION_HEADER = 'x-tinyforge';
/** Largest file the editor can write (64 MB). */
const MAX_WRITE = 64 * 1024 * 1024;

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.json': 'application/json',
  '.ts': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

type ChangeKind = 'add' | 'change' | 'unlink';

interface Listing {
  writable: boolean;
  watch: boolean;
  files: Array<ProjectFile & { readonly?: true }>;
}

async function listing(dirs: ProjectDirs, live: boolean): Promise<Listing> {
  const files = (await listProjectFiles(dirs)).map((f) =>
    live && isWritablePath(f.path) ? f : { ...f, readonly: true as const },
  );
  return { writable: live, watch: live, files };
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

async function readBody(req: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > MAX_WRITE) throw new HttpError(413, 'File too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/** The file to write at a project path, or an HTTP error. */
function writableFile(p: string, dirs: ProjectDirs): string {
  if (!isProjectPath(p)) throw new HttpError(400, `Invalid path "${p}"`);
  if (!isWritablePath(p)) throw new HttpError(403, `${p} is read-only`);
  const file = diskPath(p, dirs);
  if (!file) throw new HttpError(403, `${p} is read-only`);
  return file;
}

/** The folders that hold everything the editor may write; they are never pruned. */
function rootDirs(dirs: ProjectDirs): string[] {
  return [
    dirs.games,
    path.join(dirs.assets, 'sprites'),
    path.join(dirs.assets, 'sfx'),
    path.join(dirs.assets, 'music'),
  ];
}

/** Remove the folders a delete or a move left empty, up to a root folder. */
async function pruneEmpty(file: string, dirs: ProjectDirs): Promise<void> {
  const roots = rootDirs(dirs);
  let dir = path.dirname(file);
  while (!roots.includes(dir) && roots.some((r) => dir.startsWith(r + path.sep))) {
    if ((await fs.readdir(dir)).length > 0) return;
    await fs.rmdir(dir);
    dir = path.dirname(dir);
  }
}

export function tinyforge({ assetsDir }: { assetsDir: string }): Plugin {
  const dirs: ProjectDirs = { ...PROJECT_DIRS, assets: assetsDir };

  return {
    name: 'tinyforge',

    configureServer(dev) {
      dev.watcher.add([dirs.games, dirs.sdk, MEMORY_MAP_FILE, ...rootDirs(dirs).slice(1)]);

      // Change stream: watcher events, batched, to every connected editor.
      const clients = new Set<ServerResponse>();
      let pending = new Map<string, ChangeKind>();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        timer = null;
        const changes = [...pending].map(([p, kind]) => ({ path: p, kind }));
        pending = new Map();
        const message = `data: ${JSON.stringify({ changes })}\n\n`;
        for (const client of clients) client.write(message);
      };
      const onEvent = (kind: ChangeKind) => (file: string) => {
        const p = projectPathOfFile(file, dirs);
        if (!p) return;
        const before = pending.get(p);
        // add then change is still an add; unlink then add is a change.
        pending.set(
          p,
          before === 'add' && kind === 'change' ? 'add' : before === 'unlink' && kind === 'add' ? 'change' : kind,
        );
        if (timer === null) timer = setTimeout(flush, 50);
      };
      dev.watcher.on('add', onEvent('add'));
      dev.watcher.on('change', onEvent('change'));
      dev.watcher.on('unlink', onEvent('unlink'));
      const heartbeat = setInterval(() => {
        for (const client of clients) client.write(': keep-alive\n\n');
      }, 15000);
      dev.httpServer?.on('close', () => clearInterval(heartbeat));

      dev.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const pathname = url.pathname;
        // /__tf/ai/ belongs to the AI routes (ai-proxy.ts).
        if (!pathname.startsWith('/__tf/') || pathname.startsWith('/__tf/ai/')) return next();
        const method = req.method ?? 'GET';
        try {
          if (pathname === '/__tf/files.json' && method === 'GET') {
            send(res, 200, JSON.stringify(await listing(dirs, true)), 'application/json');
            return;
          }
          if (pathname === '/__tf/events' && method === 'GET') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            });
            res.write('retry: 1000\n\n');
            clients.add(res);
            req.on('close', () => clients.delete(res));
            return;
          }
          // Only the editor's own page: a request from another origin is refused, reads included.
          const origin = req.headers.origin;
          if (
            origin !== undefined &&
            origin !== `http://${req.headers.host}` &&
            origin !== `https://${req.headers.host}`
          ) {
            throw new HttpError(403, 'Cross-origin request refused');
          }
          const mutating = method !== 'GET' && method !== 'HEAD';
          if (mutating && req.headers[MUTATION_HEADER] !== '1') {
            throw new HttpError(403, `Missing ${MUTATION_HEADER} header`);
          }
          if (pathname === '/__tf/rename' && method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf8')) as { from?: unknown; to?: unknown };
            if (typeof body.from !== 'string' || typeof body.to !== 'string') {
              throw new HttpError(400, 'Expected { from, to }');
            }
            const from = writableFile(body.from, dirs);
            const to = writableFile(body.to, dirs);
            if (!existsSync(from)) throw new HttpError(404, `${body.from} not found`);
            if (existsSync(to)) throw new HttpError(409, `${body.to} already exists`);
            await fs.mkdir(path.dirname(to), { recursive: true });
            await fs.rename(from, to);
            await pruneEmpty(from, dirs);
            send(res, 204, '');
            return;
          }
          if (!pathname.startsWith('/__tf/files/')) throw new HttpError(404, 'Not found');
          const p = decodeURIComponent(pathname.slice('/__tf/files/'.length));
          if (method === 'GET' || method === 'HEAD') {
            const file = isProjectPath(p) ? diskPath(p, dirs) : null;
            const stat = file ? await fs.stat(file).catch(() => null) : null;
            if (!file || !stat?.isFile()) throw new HttpError(404, `${p} not found`);
            res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
            res.setHeader('Content-Length', stat.size);
            // A URL with ?v= (the modification time) names one version of the file.
            res.setHeader('Cache-Control', url.searchParams.has('v') ? 'max-age=31536000, immutable' : 'no-store');
            if (method === 'HEAD') res.end();
            else createReadStream(file).pipe(res);
            return;
          }
          if (method === 'PUT') {
            const file = writableFile(p, dirs);
            const body = await readBody(req);
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, body);
            send(res, 204, '');
            return;
          }
          if (method === 'DELETE') {
            const file = writableFile(p, dirs);
            const stat = await fs.stat(file).catch(() => null);
            if (!stat?.isFile()) throw new HttpError(404, `${p} not found`);
            await fs.unlink(file);
            await pruneEmpty(file, dirs);
            send(res, 204, '');
            return;
          }
          throw new HttpError(405, `${method} not allowed`);
        } catch (e) {
          if (e instanceof HttpError) send(res, e.status, e.message);
          else if (e instanceof SyntaxError) send(res, 400, e.message);
          else send(res, 500, e instanceof Error ? e.message : String(e));
        }
      });
    },

    // A static copy of the project: the same protocol, read-only.
    async generateBundle() {
      const list = await listing(dirs, false);
      this.emitFile({ type: 'asset', fileName: '__tf/files.json', source: JSON.stringify(list) });
      for (const f of list.files) {
        const file = diskPath(f.path, dirs);
        if (!file) continue;
        this.emitFile({ type: 'asset', fileName: `__tf/files/${f.path}`, source: await fs.readFile(file) });
      }
    },
  };
}
