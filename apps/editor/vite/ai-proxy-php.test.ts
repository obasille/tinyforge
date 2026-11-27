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

describe.skipIf(!hasPhp)('AI proxy (PHP)', () => {
  let dir: string;
  let php: ChildProcess;
  let upstream: Server;
  let base: string;
  const seen: Array<{ headers: IncomingHttpHeaders; body: string }> = [];

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'tf-ai-php-'));
    // The fake API: three server-sent events, 300 ms apart.
    upstream = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', async () => {
        seen.push({ headers: req.headers, body });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_1', 'x-secret': 'no' });
        for (const n of [1, 2, 3]) {
          res.write(`event: ping\ndata: {"n":${n}}\n\n`);
          await sleep(300);
        }
        res.end();
      });
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    const apiPort = (upstream.address() as AddressInfo).port;

    writeFileSync(path.join(dir, 'index.php'), aiProxyPhp());
    writeFileSync(
      path.join(dir, 'config.php'),
      aiConfigPhp({
        anthropicKey: KEY,
        password: PASSWORD,
        iterations: 1000,
        extra: { allow_http: true, anthropic_url: `http://127.0.0.1:${apiPort}/v1/messages` },
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
    expect(text).toContain('"n":1');
    expect(text).toContain('"n":3');
    // The first event arrived before the API had finished (it takes 900 ms).
    expect(firstAt).toBeLessThan(totalAt - 400);

    const sent = seen.at(-1);
    expect(sent?.headers['x-api-key']).toBe(KEY);
    expect(sent?.headers['anthropic-version']).toBe('2023-06-01');
    expect(sent?.headers['anthropic-beta']).toBe('x-1');
    expect(sent?.headers.cookie).toBeUndefined();
    expect(sent?.headers['x-tinyforge']).toBeUndefined();
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
