#!/usr/bin/env node
// Static dev server for the classic host (apps/classic).
//
// It serves the same URL layout as the deployed site:
//   /            -> apps/classic/ (index.html, dist/, icons/, ...)
//   /assets/...  -> assets/ at the repo root (shared with the new editor)
//
// Directory requests return a plain HTML index of <a href> links, because the
// classic host discovers cartridges, sprites and sounds by parsing directory
// listings. Responses carry Last-Modified so the host's hot reload can poll.
//
// Usage: node scripts/serve-classic.js [port]

import { createReadStream, promises as fs } from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const classicRoot = path.join(repoRoot, 'apps', 'classic');
const assetsRoot = path.join(repoRoot, 'assets');
const port = Number(process.argv[2] || process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const [root, rest] = decoded.startsWith('/assets/')
    ? [assetsRoot, decoded.slice('/assets/'.length)]
    : decoded === '/assets'
      ? [assetsRoot, '']
      : [classicRoot, decoded.slice(1)];
  const full = path.resolve(root, rest);
  // Refuse anything that escapes its mount (../ tricks).
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

async function sendDirectory(res, dir, urlPath, method) {
  if (!urlPath.endsWith('/')) {
    res.writeHead(301, { Location: `${urlPath}/` });
    res.end();
    return;
  }
  const index = path.join(dir, 'index.html');
  try {
    const stat = await fs.stat(index);
    if (stat.isFile()) return sendFile(res, index, stat, method);
  } catch {
    // No index.html: fall through to a listing.
  }
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const links = entries
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort()
    .map((name) => `<li><a href="${encodeURIComponent(name.replace(/\/$/, ''))}${name.endsWith('/') ? '/' : ''}">${name}</a></li>`)
    .join('\n');
  res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  res.end(method === 'HEAD' ? undefined : `<!doctype html><ul>\n${links}\n</ul>\n`);
}

function sendFile(res, file, stat, method) {
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': 'no-cache',
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405);
    res.end();
    return;
  }
  const urlPath = new URL(req.url || '/', 'http://localhost').pathname;
  const full = resolvePath(urlPath);
  if (!full) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const stat = await fs.stat(full);
    if (stat.isDirectory()) await sendDirectory(res, full, urlPath, method);
    else sendFile(res, full, stat, method);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(method === 'HEAD' ? undefined : 'Not found');
  }
});

server.listen(port, () => {
  console.log(`Classic host: http://localhost:${port}/`);
});
