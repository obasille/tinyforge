// Dev server only: GET /__tf/web-branch says how many commits the deployed
// editor saved on the `web` branch that the main branch does not have yet,
// so the desktop editor can remind you to merge them (`git pull origin web`).
//
//   GET /__tf/web-branch   { ahead, repo?, branch?, base?, url? }
//
// One request to the GitHub API (compare base...branch), at most every 5
// minutes, off the page's critical path. The repository is public, so no
// token is needed; EDITOR_GITHUB_TOKEN from .env, when set, raises the rate
// limit and stays in this server. Any failure (offline, no such branch,
// rate limit) answers { ahead: 0 }: the reminder is a convenience.
//
// EDITOR_GITHUB_REPO (owner/name, default: this clone's origin),
// EDITOR_GITHUB_BRANCH (default web) and EDITOR_GITHUB_BASE (default master)
// pick what is compared, as for `pnpm ai:setup`. TF_NO_WEB_BRANCH=1 turns it
// off (the e2e tests do, to stay offline).

import { execFileSync } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv, type Plugin } from 'vite';

export interface WebBranchStatus {
  ahead: number;
  repo?: string;
  branch?: string;
  base?: string;
  /** The comparison on GitHub. */
  url?: string;
}

export interface WebBranchOptions {
  repo: string;
  branch: string;
  base: string;
  token?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

const CACHE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 5000;
const NAME = /^[\w.-]+\/[\w.-]+$/;
const BRANCH = /^[\w./-]+$/;

/** owner/name of this clone's origin remote, or ''. */
function originRepo(cwd: string): string {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd }).toString().trim();
    return /github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/.exec(url)?.[1] ?? '';
  } catch {
    return '';
  }
}

/** The status, cached; never throws. */
export function webBranchChecker(options: WebBranchOptions): () => Promise<WebBranchStatus> {
  const { repo, branch, base, token } = options;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { at: number; status: Promise<WebBranchStatus> } | null = null;
  const valid = NAME.test(repo) && BRANCH.test(branch) && BRANCH.test(base);

  const check = async (): Promise<WebBranchStatus> => {
    if (!valid) return { ahead: 0 };
    const compare = `${encodeURIComponent(base)}...${encodeURIComponent(branch)}`;
    try {
      const res = await doFetch(`https://api.github.com/repos/${repo}/compare/${compare}?per_page=1`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'tinyforge-editor',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return { ahead: 0 };
      const body = (await res.json()) as { ahead_by?: unknown };
      const ahead = typeof body.ahead_by === 'number' ? body.ahead_by : 0;
      return { ahead, repo, branch, base, url: `https://github.com/${repo}/compare/${compare}` };
    } catch {
      return { ahead: 0 };
    }
  };

  return () => {
    if (!cached || now() - cached.at > CACHE_MS) cached = { at: now(), status: check() };
    return cached.status;
  };
}

/** The route, for the dev server's middleware stack. */
export function webBranchHandler(status: () => Promise<WebBranchStatus>) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url?.split('?')[0] !== '/__tf/web-branch' || req.method !== 'GET') return next();
    void status().then((s) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(s));
    });
  };
}

/** `envDir`: the repository root, with its .env and its git clone. */
export function webBranch({ envDir }: { envDir: string }): Plugin {
  return {
    name: 'tinyforge-web-branch',
    apply: 'serve',
    configureServer(dev) {
      const env = loadEnv(dev.config.mode, envDir, ['EDITOR_GITHUB_', 'TF_NO_WEB_BRANCH']);
      const off = env.TF_NO_WEB_BRANCH === '1' || process.env.TF_NO_WEB_BRANCH === '1';
      const status = off
        ? () => Promise.resolve<WebBranchStatus>({ ahead: 0 })
        : webBranchChecker({
            repo: (env.EDITOR_GITHUB_REPO || originRepo(envDir)).trim(),
            branch: (env.EDITOR_GITHUB_BRANCH || 'web').trim(),
            base: (env.EDITOR_GITHUB_BASE || 'master').trim(),
            token: env.EDITOR_GITHUB_TOKEN?.trim() || undefined,
          });
      dev.middlewares.use(webBranchHandler(status));
    },
  };
}
