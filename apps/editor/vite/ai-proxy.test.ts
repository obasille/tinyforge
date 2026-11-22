import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createAiHandler, openAiConfig } from './ai-proxy.ts';

const KEY = 'sk-ant-test-key';
let server: Server | null = null;

/** Start the handler on a free port; `upstream` stands in for the Anthropic API. */
async function start(options: Partial<Parameters<typeof createAiHandler>[0]>, upstream?: typeof fetch) {
  const handler = createAiHandler({ env: { ANTHROPIC_API_KEY: KEY }, disabled: null, fetchFn: upstream, ...options });
  server = createServer((req, res) =>
    handler(req, res, () => {
      res.statusCode = 404;
      res.end('next');
    }),
  );
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

afterEach(() => {
  server?.close();
  server = null;
});

function call(
  port: number,
  path: string,
  { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; text: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: { host: `localhost:${port}`, 'x-tinyforge': '1', ...headers },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => {
          text += c;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('AI proxy', () => {
  it('reports the providers, never the key', async () => {
    const port = await start({ env: { ANTHROPIC_API_KEY: KEY, TF_AI_MODEL: 'claude-sonnet-5-5' } });
    const res = await call(port, '/__tf/ai/status');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(KEY);
    expect(JSON.parse(res.text).providers[0]).toMatchObject({ id: 'anthropic', defaultModel: 'claude-sonnet-5-5' });
  });

  it('says how to set it up without a key, and is off when the server is exposed', async () => {
    let port = await start({ env: {} });
    expect(JSON.parse((await call(port, '/__tf/ai/status')).text)).toMatchObject({
      providers: [],
      reason: expect.stringContaining('ANTHROPIC_API_KEY'),
    });
    server?.close();
    port = await start({ disabled: 'exposed' });
    expect(JSON.parse((await call(port, '/__tf/ai/status')).text)).toEqual({ providers: [], reason: 'exposed' });
    const post = await call(port, '/__tf/ai/anthropic/v1/messages', {
      method: 'POST',
      body: '{"model":"claude-opus-5-5"}',
    });
    expect(post.status).toBe(403);
  });

  it('refuses other hosts, other origins, and requests without the header', async () => {
    const port = await start({});
    const other = await call(port, '/__tf/ai/status', { headers: { host: '192.168.1.5:5173' } });
    expect([other.status, other.text]).toEqual([403, 'AI works only on this computer: open http://localhost:5173']);
    expect((await call(port, '/__tf/ai/status', { headers: { host: 'evil.example:<b>' } })).text).toBe(
      'AI works only on this computer: open http://localhost',
    );
    expect((await call(port, '/__tf/ai/status', { headers: { origin: 'http://localhost:3000' } })).status).toBe(403);
    expect((await call(port, '/__tf/ai/status', { headers: { 'x-tinyforge': '' } })).status).toBe(403);
    expect((await call(port, '/__tf/ai/status', { headers: { origin: `http://localhost:${port}` } })).status).toBe(200);
    expect((await call(port, '/other')).text).toBe('next');
  });

  it('forwards a request with the key and only safe headers, and streams the answer back', async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const upstream = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response('event: message_stop\ndata: {}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'request-id': 'req_1', 'set-cookie': 'x=1' },
      });
    }) as unknown as typeof fetch;
    const port = await start({}, upstream);
    const res = await call(port, '/__tf/ai/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': 'placeholder',
        cookie: 'session=1',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      body: JSON.stringify({ model: 'claude-opus-5-5', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('message_stop');
    expect(res.headers['request-id']).toBe('req_1');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(seen[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(seen[0].headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    });
  });

  it('accepts only the listed models', async () => {
    const port = await start({}, (async () => new Response('{}')) as unknown as typeof fetch);
    const res = await call(port, '/__tf/ai/anthropic/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-mythos-5-2' }),
    });
    expect(res.status).toBe(400);
    expect(res.text).toContain('not allowed');
  });

  it('forwards to the OpenAI-compatible server from .env, with its key, for its models only', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const upstream = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof fetch;
    const env = {
      TF_AI_OPENAI_URL: 'http://localhost:11434/v1/',
      TF_AI_OPENAI_KEY: 'local-key',
      TF_AI_OPENAI_MODELS: 'qwen3:8b, llama3.1:8b',
    };
    const port = await start({ env }, upstream);
    const status = JSON.parse((await call(port, '/__tf/ai/status')).text);
    expect(status.providers).toEqual([{ id: 'openai', models: ['qwen3:8b', 'llama3.1:8b'], defaultModel: 'qwen3:8b' }]);
    expect(JSON.stringify(status)).not.toContain('local-key');
    const path = '/__tf/ai/openai/v1/chat/completions';
    const ok = await call(port, path, { method: 'POST', body: JSON.stringify({ model: 'llama3.1:8b' }) });
    expect(ok.text).toContain('[DONE]');
    expect(seen).toEqual([
      {
        url: 'http://localhost:11434/v1/chat/completions',
        headers: { 'content-type': 'application/json', authorization: 'Bearer local-key' },
      },
    ]);
    const bad = await call(port, path, { method: 'POST', body: JSON.stringify({ model: 'gpt-x' }) });
    expect(bad.status).toBe(400);
    // Without the OpenAI settings, the route is off.
    server?.close();
    const off = await start({});
    expect((await call(off, path, { method: 'POST', body: '{"model":"qwen3:8b"}' })).status).toBe(503);
  });

  it('reads the OpenAI settings strictly: https, or http to this machine only', async () => {
    expect(openAiConfig({})).toBeNull();
    expect(openAiConfig({ TF_AI_OPENAI_URL: 'http://localhost:11434/v1' })).toContain('TF_AI_OPENAI_MODELS');
    expect(openAiConfig({ TF_AI_OPENAI_URL: 'not a url', TF_AI_OPENAI_MODELS: 'a' })).toContain('not a URL');
    for (const url of ['http://192.168.1.5:11434/v1', 'http://ollama.example/v1', 'file:///etc', 'ftp://x']) {
      expect(openAiConfig({ TF_AI_OPENAI_URL: url, TF_AI_OPENAI_MODELS: 'a' })).toContain('must be https');
    }
    expect(openAiConfig({ TF_AI_OPENAI_URL: 'http://127.0.0.1:1234/v1', TF_AI_OPENAI_MODELS: 'a' })).toMatchObject({
      url: 'http://127.0.0.1:1234/v1',
    });
    expect(openAiConfig({ TF_AI_OPENAI_URL: 'https://api.example/v1', TF_AI_OPENAI_MODELS: 'a,,b' })).toEqual({
      url: 'https://api.example/v1',
      key: null,
      models: ['a', 'b'],
    });
    // A refused URL is never used, and the panel says why.
    const used: string[] = [];
    const port = await start(
      { env: { ANTHROPIC_API_KEY: KEY, TF_AI_OPENAI_URL: 'http://ollama.example/v1', TF_AI_OPENAI_MODELS: 'a' } },
      (async (url: string) => {
        used.push(url);
        return new Response('{}');
      }) as unknown as typeof fetch,
    );
    const status = JSON.parse((await call(port, '/__tf/ai/status')).text);
    expect(status.providers.map((p: { id: string }) => p.id)).toEqual(['anthropic']);
    expect(status.reason).toContain('must be https');
    const post = await call(port, '/__tf/ai/openai/v1/chat/completions', { method: 'POST', body: '{"model":"a"}' });
    expect(post.status).toBe(503);
    expect(post.text).toContain('must be https');
    expect(used).toEqual([]);
  });
});
