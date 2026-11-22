// Dev server routes for the AI panel. The API key stays here, in Node: it is
// read from .env and added to requests the page sends, and never sent back.
//
//   GET  /__tf/ai/status                       { providers: [{ id, models, defaultModel }], reason? }
//   POST /__tf/ai/anthropic/v1/messages        forwarded to the Anthropic API with the key
//   POST /__tf/ai/openai/v1/chat/completions   forwarded to TF_AI_OPENAI_URL (an OpenAI-compatible
//                                              server, such as a local Ollama), with its key if any
//
// Only the editor itself may use them: requests must come to localhost, from
// the same origin, with the X-TinyForge header (another page cannot add it
// without a CORS preflight, which this server does not grant). The routes are
// off when the dev server listens beyond localhost (`--host`), and accept only
// the models in models.ts (or TF_AI_OPENAI_MODELS). A static build has no AI:
// `apply: 'serve'`.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv, type Plugin } from 'vite';
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from '../../../packages/editor-core/src/ai/models.ts';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
/** Largest request body forwarded (a long conversation with file contents). */
const MAX_BODY = 32 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export interface AiEnv {
  ANTHROPIC_API_KEY?: string;
  /** Default model for a browser that has not picked one. */
  TF_AI_MODEL?: string;
  /** An OpenAI-compatible API's base URL, such as http://localhost:11434/v1 (Ollama). */
  TF_AI_OPENAI_URL?: string;
  /** Its key, when it needs one. */
  TF_AI_OPENAI_KEY?: string;
  /** The models the editor may use there, comma-separated. */
  TF_AI_OPENAI_MODELS?: string;
}

export interface OpenAiConfig {
  url: string;
  key: string | null;
  models: string[];
}

/**
 * The OpenAI-compatible server from .env: its settings, null when it is not
 * set up, or why it is refused. The URL must be https, or http to this
 * machine (a local Ollama), so a key never travels unencrypted.
 */
export function openAiConfig(env: AiEnv): OpenAiConfig | string | null {
  const raw = env.TF_AI_OPENAI_URL?.trim();
  if (!raw) return null;
  const models = (env.TF_AI_OPENAI_MODELS ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  if (models.length === 0) return 'TF_AI_OPENAI_MODELS is empty: list the models to use, comma-separated.';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `TF_AI_OPENAI_URL is not a URL: ${raw}`;
  }
  const local = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !local) {
    return `TF_AI_OPENAI_URL must be https (or http://localhost): ${raw}`;
  }
  return { url: url.href.replace(/\/+$/, ''), key: env.TF_AI_OPENAI_KEY?.trim() || null, models };
}

const SETUP = 'Add ANTHROPIC_API_KEY (or TF_AI_OPENAI_URL and TF_AI_OPENAI_MODELS) to .env and restart the dev server.';

export interface AiHandlerOptions {
  env: AiEnv;
  /** Why the routes are off (the server is exposed), or null. */
  disabled: string | null;
  fetchFn?: typeof fetch;
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

/** A request from the editor's own page on localhost, or an error. */
function checkLocal(req: IncomingMessage): void {
  const host = req.headers.host ?? '';
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  // A page on another site can reach localhost through a DNS name that points to it: refuse other Host names.
  if (!LOCAL_HOSTS.has(hostname)) {
    // Only a port number is echoed back, nothing else from the request.
    const port = /^:\d{1,5}$/.test(host.slice(hostname.length)) ? host.slice(hostname.length) : '';
    throw new HttpError(403, `AI works only on this computer: open http://localhost${port}`);
  }
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${host}` && origin !== `https://${host}`) {
    throw new HttpError(403, 'AI routes answer only the editor itself');
  }
  if (req.headers['x-tinyforge'] !== '1') throw new HttpError(403, 'Missing x-tinyforge header');
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

const header = (req: IncomingMessage, name: string, pattern: RegExp): string | undefined => {
  const value = req.headers[name];
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
};

/** Send the request on and stream the reply back, with only a few of its headers. */
async function forward(
  res: ServerResponse,
  fetchFn: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: Buffer,
): Promise<void> {
  const abort = new AbortController();
  res.on('close', () => abort.abort());
  const upstream = await fetchFn(url, { method: 'POST', headers, body: new Uint8Array(body), signal: abort.signal });
  res.statusCode = upstream.status;
  for (const name of ['content-type', 'retry-after', 'request-id']) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.setHeader('Cache-Control', 'no-store');
  // Streamed as it arrives, so the panel shows the reply while it is written.
  const reader = upstream.body?.getReader();
  for (let chunk = await reader?.read(); chunk && !chunk.done; chunk = await reader?.read()) res.write(chunk.value);
  res.end();
}

/** Refuse a request whose model is not one of `allowed`. */
function allowedModel(body: Buffer, allowed: string[]): void {
  const { model } = JSON.parse(body.toString('utf8')) as { model?: unknown };
  if (typeof model !== 'string' || !allowed.includes(model))
    throw new HttpError(400, `Model not allowed: ${String(model)}`);
}

/** The middleware, separate from Vite so it can be tested. */
export function createAiHandler({ env, disabled, fetchFn = fetch }: AiHandlerOptions) {
  const key = env.ANTHROPIC_API_KEY?.trim() || null;
  const config = openAiConfig(env);
  const openai = typeof config === 'string' ? null : config;
  /** A setting in .env that is refused, shown in the panel. */
  const problem = typeof config === 'string' ? `${config} The OpenAI-compatible server is off.` : null;
  const pick = (models: string[], fallback: string) =>
    env.TF_AI_MODEL && models.includes(env.TF_AI_MODEL) ? env.TF_AI_MODEL : fallback;
  const providers = [
    ...(key
      ? [{ id: 'anthropic', models: CLAUDE_MODELS, defaultModel: pick(CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL) }]
      : []),
    ...(openai ? [{ id: 'openai', models: openai.models, defaultModel: pick(openai.models, openai.models[0]) }] : []),
  ];
  // The provider of TF_AI_MODEL first: the panel starts with the first one.
  providers.sort(
    (a, b) => Number(b.models.includes(env.TF_AI_MODEL ?? '')) - Number(a.models.includes(env.TF_AI_MODEL ?? '')),
  );

  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!pathname.startsWith('/__tf/ai/')) return next();
    try {
      checkLocal(req);
      if (pathname === '/__tf/ai/status' && req.method === 'GET') {
        const reason = disabled ?? problem ?? (providers.length > 0 ? undefined : SETUP);
        send(res, 200, JSON.stringify({ providers: disabled ? [] : providers, reason }), 'application/json');
        return;
      }
      if (pathname === '/__tf/ai/anthropic/v1/messages' && req.method === 'POST') {
        if (disabled) throw new HttpError(403, disabled);
        if (!key) throw new HttpError(503, 'No ANTHROPIC_API_KEY in .env');
        const body = await readBody(req);
        allowedModel(body, CLAUDE_MODELS);
        // Only these headers go on; the page's own (cookies, its placeholder key) do not.
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': header(req, 'anthropic-version', /^\d{4}-\d{2}-\d{2}$/) ?? '2023-06-01',
        };
        const beta = header(req, 'anthropic-beta', /^[a-z0-9-]+(,[a-z0-9-]+)*$/);
        if (beta) headers['anthropic-beta'] = beta;
        await forward(res, fetchFn, ANTHROPIC_URL, headers, body);
        return;
      }
      if (pathname === '/__tf/ai/openai/v1/chat/completions' && req.method === 'POST') {
        if (disabled) throw new HttpError(403, disabled);
        if (!openai) throw new HttpError(503, problem ?? 'No TF_AI_OPENAI_URL in .env');
        const body = await readBody(req);
        allowedModel(body, openai.models);
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (openai.key) headers.authorization = `Bearer ${openai.key}`;
        await forward(res, fetchFn, `${openai.url}/chat/completions`, headers, body);
        return;
      }
      throw new HttpError(404, 'Not found');
    } catch (e) {
      if (res.headersSent) res.end();
      else if (e instanceof HttpError) send(res, e.status, e.message);
      else if (e instanceof SyntaxError) send(res, 400, e.message);
      else if ((e as Error).name === 'AbortError') res.end();
      else send(res, 502, e instanceof Error ? e.message : String(e));
    }
  };
}

/** The server listens beyond localhost (`--host`, or `server.host` in the config). */
function exposedReason(host: string | boolean | undefined): string | null {
  if (host === undefined || host === false || (typeof host === 'string' && LOCAL_HOSTS.has(host))) return null;
  return 'AI is off because the dev server is reachable from the network (--host). Restart it without --host.';
}

/** `envDir`: the folder whose .env holds the key (the repository root). */
export function aiProxy({ envDir }: { envDir: string }): Plugin {
  return {
    name: 'tinyforge-ai',
    apply: 'serve',
    configureServer(dev) {
      // Only ANTHROPIC_ and TF_AI_ variables are read, in Node; Vite gives the page only VITE_ ones.
      const env = loadEnv(dev.config.mode, envDir, ['ANTHROPIC_', 'TF_AI_']) as AiEnv;
      const disabled = exposedReason(dev.config.server.host);
      const openai = openAiConfig(env);
      if (disabled && (env.ANTHROPIC_API_KEY || openai)) dev.config.logger.warn(disabled);
      if (typeof openai === 'string') dev.config.logger.error(`${openai} The OpenAI-compatible server is off.`);
      dev.middlewares.use(createAiHandler({ env, disabled }));
    },
  };
}
