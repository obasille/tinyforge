// The deployed editor's AI proxy (server/ai/index.php), run with PHP's
// built-in server against a fake Anthropic API. Needs `php` (with curl) on
// the PATH; without it these tests are reported as skipped, not passed.

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClaudeProvider } from '../../../packages/editor-core/src/ai/anthropic.ts';
import { aiConfigPhp } from '../../../scripts/ai-config.js';
import { aiProxyPhp } from './site-headers.ts';

const hasPhp = (() => {
  try {
    return execFileSync('php', ['-r', 'echo function_exists("curl_init") ? "yes" : "no";']).toString() === 'yes';
  } catch {
    return false;
  }
})();

const KEY = 'sk-ant-api03-php-test-key-0123456789';
const PASSWORD = 'a long proxy password';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ev = (type: string, data: Record<string, unknown>) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const EVENTS = [
  ev('message_start', {
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 1 },
    },
  }),
  ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
  ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Hello ' } }),
  ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'world.' } }),
  ev('content_block_stop', { index: 0 }),
  ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } }),
  ev('message_stop', {}),
];

describe.skipIf(!hasPhp)('AI proxy (PHP)', () => {
  let dir: string;
  let php: ChildProcess;
  let upstream: Server;
  let gh: Server;
  /** The fake GitHub: its refs and objects, and every request it got. */
  const git = {
    refs: { master: 'c'.repeat(40) } as Record<string, string>,
    requests: [] as Array<{ method: string; url: string; auth?: string; body?: Record<string, unknown> }>,
    trees: [] as unknown[],
  };
  let base: string;
  const seen: Array<{ headers: IncomingHttpHeaders; body: string }> = [];

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'tf-ai-php-'));
    // The fake API: a Messages API stream whose events come 300 ms apart.
    upstream = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', async () => {
        seen.push({ headers: req.headers, body });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_1', 'x-secret': 'no' });
        for (const event of EVENTS) {
          // Cut in two, so the proxy sees events split across reads.
          const half = Math.floor(event.length / 2);
          res.write(event.slice(0, half));
          await sleep(20);
          res.write(event.slice(half));
          await sleep(300);
        }
        res.end();
      });
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    const apiPort = (upstream.address() as AddressInfo).port;

    gh = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => {
        raw += c;
      });
      req.on('end', () => {
        const url = req.url ?? '';
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
        git.requests.push({ method: req.method ?? '', url, auth: req.headers.authorization, body });
        const json = (status: number, v: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(v));
        };
        const base = '/repos/me/game/git';
        const ref = new RegExp(`^${base}/ref/heads/(\\w+)$`).exec(url);
        const move = new RegExp(`^${base}/refs/heads/(\\w+)$`).exec(url);
        if (ref) {
          const sha = git.refs[ref[1]];
          return sha ? json(200, { object: { sha } }) : json(404, { message: 'Not Found' });
        }
        if (url === `${base}/refs` && req.method === 'POST') {
          git.refs[String(body?.ref).replace('refs/heads/', '')] = String(body?.sha);
          return json(201, {});
        }
        if (url.startsWith(`${base}/trees/`) && req.method === 'GET') {
          return json(200, {
            tree: [
              { path: 'packages/engine/assembly/games/pong/main.ts', type: 'blob', size: 4, sha: '1'.repeat(40) },
              { path: 'packages/engine/assembly/sdk/index.ts', type: 'blob', size: 2, sha: '2'.repeat(40) },
              { path: 'packages/engine/memory-map.ts', type: 'blob', size: 2, sha: '3'.repeat(40) },
              { path: 'assets/sfx/hit.wav', type: 'blob', size: 2, sha: '4'.repeat(40) },
              { path: 'README.md', type: 'blob', size: 2, sha: '5'.repeat(40) },
              { path: 'packages/engine/assembly/games', type: 'tree', sha: '6'.repeat(40) },
            ],
          });
        }
        if (url === `${base}/blobs/${'1'.repeat(40)}`) {
          res.writeHead(200, { 'content-type': 'application/octet-stream' });
          return res.end('pong');
        }
        if (url.startsWith(`${base}/commits/`) && req.method === 'GET')
          return json(200, { tree: { sha: 't'.repeat(40) } });
        if (url === `${base}/blobs` && req.method === 'POST') return json(201, { sha: 'b'.repeat(40) });
        if (url === `${base}/trees` && req.method === 'POST') {
          git.trees.push(body);
          return json(201, { sha: 'e'.repeat(40) });
        }
        if (url === `${base}/commits` && req.method === 'POST') return json(201, { sha: 'd'.repeat(40) });
        if (move && req.method === 'PATCH') {
          if (body?.force !== false) return json(400, {});
          git.refs[move[1]] = String(body?.sha);
          return json(200, {});
        }
        json(500, { message: `unexpected ${req.method} ${url}` });
      });
    });
    await new Promise<void>((r) => gh.listen(0, '127.0.0.1', r));
    const ghPort = (gh.address() as AddressInfo).port;

    writeFileSync(path.join(dir, 'index.php'), aiProxyPhp());
    writeFileSync(
      path.join(dir, 'config.php'),
      aiConfigPhp({
        anthropicKey: KEY,
        password: PASSWORD,
        iterations: 1000,
        extra: {
          allow_http: true,
          anthropic_url: `http://127.0.0.1:${apiPort}/v1/messages`,
          github_token: 'github_pat_test',
          github_repo: 'me/game',
          github_api: `http://127.0.0.1:${ghPort}`,
        },
      }),
    );
    // What .htaccess does on Apache: the proxy's routes go to index.php.
    writeFileSync(
      path.join(dir, 'router.php'),
      `<?php if (str_starts_with(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/__tf/ai/')) { require __DIR__ . '/index.php'; return true; } return false;`,
    );
    const port = 20000 + Math.floor(Math.random() * 20000);
    base = `http://127.0.0.1:${port}`;
    php = spawn('php', ['-S', `127.0.0.1:${port}`, path.join(dir, 'router.php')], {
      cwd: dir,
      env: { ...process.env, TINYFORGE_AI_CONFIG: path.join(dir, 'config.php') },
      stdio: 'ignore',
    });
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`${base}/`);
        break;
      } catch {
        await sleep(100);
      }
    }
  });

  afterAll(() => {
    php?.kill();
    upstream?.close();
    gh?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const call = (route: string, init: RequestInit & { cookie?: string } = {}) =>
    fetch(`${base}/__tf/ai/${route}`, {
      ...init,
      headers: {
        'X-TinyForge': '1',
        ...(init.cookie ? { cookie: init.cookie } : {}),
        ...(init.headers as Record<string, string>),
      },
    });

  const login = async (password = PASSWORD) =>
    call('login', {
      method: 'POST',
      body: JSON.stringify({ password }),
      headers: { 'content-type': 'application/json' },
    });

  const messages = (cookie: string, model = 'claude-haiku-5-5') =>
    call('anthropic/v1/messages', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ model, max_tokens: 10, messages: [] }),
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'anthropic-beta': 'x-1' },
    });

  let cookie = '';

  it('asks for a login, and refuses a wrong password', async () => {
    expect(await (await call('status')).json()).toEqual({ providers: [], login: 'password' });
    const wrong = await login('nope');
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('set-cookie')).toBeNull();
    expect((await messages('tf_ai=forged.value')).status).toBe(401);
  });

  it('logs in with an HttpOnly, SameSite=Strict cookie, then offers Claude', async () => {
    const ok = await login();
    expect(ok.status).toBe(200);
    const setCookie = ok.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^tf_ai=[^;]+/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/path=\/__tf\/ai\//i);
    cookie = setCookie.split(';')[0];
    const status = (await (await call('status', { cookie })).json()) as { providers: Array<{ models: string[] }> };
    expect(status.providers[0].models).toContain('claude-opus-5-5');
    expect(JSON.stringify(status)).not.toContain('sk-ant');
  });

  it('forwards with the key, only a few headers, and streams the reply as it comes', async () => {
    const started = Date.now();
    const res = await messages(cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(res.headers.get('request-id')).toBe('req_1');
    expect(res.headers.get('x-secret')).toBeNull();
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    const firstAt = Date.now() - started;
    let text = new TextDecoder().decode(first.value);
    for (let r = await reader.read(); !r.done; r = await reader.read()) text += new TextDecoder().decode(r.value);
    const totalAt = Date.now() - started;
    // The events arrive whole, with padding comment lines between them that
    // fill the output to 8 KB blocks, so a buffering host sends them on.
    expect(text.replace(/^:[ ]*\n/gm, '')).toBe(EVENTS.join(''));
    expect(text).toMatch(/^: {100,}$/m);
    expect(text.length % 8192).toBe(0);
    // The first event arrived before the API had finished (it takes 2 s).
    expect(firstAt).toBeLessThan(totalAt - 1000);

    const sent = seen.at(-1);
    expect(sent?.headers['x-api-key']).toBe(KEY);
    expect(sent?.headers['anthropic-version']).toBe('2023-06-01');
    expect(sent?.headers['anthropic-beta']).toBe('x-1');
    expect(sent?.headers.cookie).toBeUndefined();
    expect(sent?.headers['x-tinyforge']).toBeUndefined();
  });

  it('streams a reply the Claude adapter reads, padding and all', async () => {
    const withCookie = (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      headers.set('cookie', cookie);
      return fetch(url, { ...init, headers });
    };
    const provider = new ClaudeProvider(base, withCookie as typeof fetch);
    const chat = provider.createChat({
      settings: () => ({ model: 'claude-haiku-5-5', effort: 'low' }),
      system: [{ text: 'sys' }],
      tools: [],
    });
    let streamed = '';
    const turn = await chat.send({ text: 'hi' }, { onText: (d) => (streamed += d) });
    expect(turn.text).toBe('Hello world.');
    expect(streamed).toBe('Hello world.');
  });

  it('lists the web branch (made from master), with project paths only', async () => {
    const res = await call('github/tree', { cookie });
    expect(res.status).toBe(200);
    const tree = (await res.json()) as { head: string; files: Array<{ path: string; sha: string }> };
    expect(git.refs.web).toBe('c'.repeat(40));
    expect(tree.head).toBe('c'.repeat(40));
    expect(tree.files.map((f) => f.path)).toEqual([
      'games/pong/main.ts',
      'engine/sdk/index.ts',
      'engine/memory-map.ts',
      'assets/sfx/hit.wav',
    ]);
    expect(git.requests.every((r) => r.auth === 'Bearer github_pat_test')).toBe(true);
    // A Worker fetches blobs without the header, but still with the login.
    const blob = await fetch(`${base}/__tf/ai/github/blob/${'1'.repeat(40)}`, { headers: { cookie } });
    expect(await blob.text()).toBe('pong');
    expect(blob.headers.get('cache-control')).toMatch(/immutable/);
    expect((await fetch(`${base}/__tf/ai/github/blob/${'1'.repeat(40)}`)).status).toBe(401);
  });

  it('commits a batch on the web branch, never with force, and only to writable paths', async () => {
    const commit = (body: unknown) =>
      call('github/commit', {
        method: 'POST',
        cookie,
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      });
    const ok = await commit({
      base: 'c'.repeat(40),
      message: 'Edit 2 files',
      changes: [{ path: 'games/pong/main.ts', content: btoa('new') }, { path: 'assets/sfx/hit.wav' }],
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ head: 'd'.repeat(40), blobs: { 'games/pong/main.ts': 'b'.repeat(40) } });
    expect(git.refs.web).toBe('d'.repeat(40));
    expect(git.refs.master).toBe('c'.repeat(40));
    expect(git.trees.at(-1)).toEqual({
      base_tree: 't'.repeat(40),
      tree: [
        { path: 'packages/engine/assembly/games/pong/main.ts', mode: '100644', type: 'blob', sha: 'b'.repeat(40) },
        { path: 'assets/sfx/hit.wav', mode: '100644', type: 'blob', sha: null },
      ],
    });

    // The branch moved since: a conflict, and nothing written.
    const before = git.requests.length;
    const stale = await commit({ base: 'c'.repeat(40), changes: [{ path: 'games/pong/main.ts', content: '' }] });
    expect(stale.status).toBe(409);
    expect(git.requests.slice(before).some((r) => r.method !== 'GET')).toBe(false);

    for (const bad of ['engine/sdk/index.ts', 'games/asconfig.json', 'games/../x', '.github/workflows/x.yml']) {
      const res = await commit({ base: 'd'.repeat(40), changes: [{ path: bad, content: '' }] });
      expect(res.status).toBe(403);
    }
  });

  it('refuses other models, other sites and requests without the header', async () => {
    expect((await messages(cookie, 'claude-unknown')).status).toBe(400);
    const foreign = await call('status', { cookie, headers: { origin: 'https://evil.example' } });
    expect(foreign.status).toBe(403);
    const noHeader = await fetch(`${base}/__tf/ai/status`);
    expect(noHeader.status).toBe(403);
  });

  it('logs out', async () => {
    const out = await call('logout', { method: 'POST', cookie });
    expect(out.headers.get('set-cookie')).toMatch(/tf_ai=(deleted)?;/);
  });

  it('stops answering logins after 10 wrong passwords in an hour', async () => {
    for (let i = 0; i < 10; i++) expect((await login('wrong')).status).toBe(401);
    expect((await login()).status).toBe(429);
  });
});
