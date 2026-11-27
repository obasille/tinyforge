import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubWorkspace } from '../src/github-workspace.ts';
import { ProjectFiles } from '../src/project-files.ts';

const SHA = (c: string) => c.repeat(40);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/** The proxy and the static copy, faked: records every request. */
function fakeSite() {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const site = {
    head: SHA('a'),
    files: [
      { path: 'games/pong/main.ts', size: 4, sha: SHA('1') },
      { path: 'engine/sdk/index.ts', size: 2, sha: SHA('2') },
      { path: 'assets/sprites/ball.png', size: 3, sha: SHA('3') },
    ],
    blobs: { [SHA('1')]: 'pong', [SHA('2')]: 'sdk', [SHA('3')]: 'png', [SHA('9')]: 'changed' } as Record<
      string,
      string
    >,
    // The deploy's copy: main.ts is older there.
    staticFiles: [
      { path: 'games/pong/main.ts', sha: SHA('0') },
      { path: 'engine/sdk/index.ts', sha: SHA('2') },
    ],
    conflict: false,
    commits: 0,
  };
  const fetchFn = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url: url.pathname, body });
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (url.pathname === '/__tf/files.json') return json({ writable: false, watch: false, files: site.staticFiles });
    if (url.pathname.startsWith('/__tf/files/')) return new Response('static');
    if (url.pathname === '/__tf/ai/github/tree') return json({ head: site.head, files: site.files });
    if (url.pathname.startsWith('/__tf/ai/github/blob/')) return new Response(site.blobs[url.pathname.slice(-40)]);
    if (url.pathname === '/__tf/ai/github/commit') {
      if (site.conflict || body.base !== site.head) return json({ head: site.head }, 409);
      site.commits++;
      site.head = SHA(String(site.commits + 4));
      const blobs: Record<string, string> = {};
      for (const c of body.changes) if (c.content) blobs[c.path] = SHA('f');
      return json({ head: site.head, blobs });
    }
    return new Response('nope', { status: 404 });
  }) as unknown as typeof fetch;
  return { site, calls, fetchFn };
}

afterEach(() => vi.useRealTimers());

describe('GitHubWorkspace', () => {
  it('lists the branch, reads unchanged files from the static copy, others from GitHub', async () => {
    const { calls, fetchFn } = fakeSite();
    const ws = new GitHubWorkspace('https://tf.example/', { fetch: fetchFn });
    const info = await ws.list();
    expect(info.writable).toBe(true);
    expect(info.files.find((f) => f.path === 'engine/sdk/index.ts')?.readonly).toBe(true);
    expect(info.files.find((f) => f.path === 'games/pong/main.ts')?.readonly).toBeUndefined();
    expect(dec(await ws.read('engine/sdk/index.ts'))).toBe('static');
    expect(dec(await ws.read('games/pong/main.ts'))).toBe('pong');
    expect(calls.map((c) => c.url)).toContain(`/__tf/ai/github/blob/${SHA('1')}`);
    const sdk = info.files.find((f) => f.path === 'engine/sdk/index.ts');
    expect(sdk && ws.url(sdk)).toMatch(/\/__tf\/files\/engine\/sdk\/index\.ts\?v=/);
  });

  it('batches edits into one commit after a pause, and refuses read-only paths', async () => {
    vi.useFakeTimers();
    const { site, calls, fetchFn } = fakeSite();
    const ws = new GitHubWorkspace('https://tf.example/', { fetch: fetchFn, idleMs: 1000, objectUrl: () => 'blob:x' });
    const files = new ProjectFiles(ws);
    await files.start();
    await files.write('games/pong/main.ts', 'new pong');
    await files.write('assets/sprites/coin.png', new Uint8Array([1, 2]));
    await files.delete('assets/sprites/ball.png');
    await expect(files.write('engine/sdk/index.ts', 'x')).rejects.toThrow(/read-only/);
    expect(ws.save.getState()).toMatchObject({ status: 'pending' });
    expect(ws.save.getState().pending).toEqual([
      'assets/sprites/ball.png',
      'assets/sprites/coin.png',
      'games/pong/main.ts',
    ]);
    // Unsaved edits are what the editor reads, and what Workers fetch.
    expect(await files.readText('games/pong/main.ts')).toBe('new pong');
    expect(files.exists('assets/sprites/ball.png')).toBe(false);
    const coin = files.entry('assets/sprites/coin.png');
    expect(coin && ws.url(coin)).toBe('blob:x');
    expect(calls.filter((c) => c.url.endsWith('/commit'))).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(ws.save.getState().status).toBe('saved'));
    const commits = calls.filter((c) => c.url.endsWith('/commit'));
    expect(commits).toHaveLength(1);
    const body = commits[0].body as { base: string; changes: Array<{ path: string; content?: string }> };
    expect(body.base).toBe(SHA('a'));
    expect(body.changes).toEqual([
      { path: 'games/pong/main.ts', content: btoa('new pong') },
      { path: 'assets/sprites/coin.png', content: btoa('\u0001\u0002') },
      { path: 'assets/sprites/ball.png' },
    ]);
    expect(site.commits).toBe(1);
    // The next commit builds on the new head.
    await files.write('games/pong/main.ts', 'again');
    await ws.flush();
    expect((calls.filter((c) => c.url.endsWith('/commit'))[1].body as { base: string }).base).toBe(SHA('5'));
  });

  it('stops at a conflict and never overwrites', async () => {
    const { site, calls, fetchFn } = fakeSite();
    const ws = new GitHubWorkspace('https://tf.example/', { fetch: fetchFn });
    await ws.list();
    await ws.write('games/pong/main.ts', 'mine');
    site.conflict = true;
    await ws.flush();
    expect(ws.save.getState().status).toBe('conflict');
    expect(ws.save.getState().pending).toEqual(['games/pong/main.ts']);
    // No more attempts until a reload.
    await ws.write('games/pong/main.ts', 'more');
    await ws.flush();
    expect(calls.filter((c) => c.url.endsWith('/commit'))).toHaveLength(1);
  });

  it('takes changes made elsewhere when nothing is pending, else reports a conflict', async () => {
    const { site, fetchFn } = fakeSite();
    const ws = new GitHubWorkspace('https://tf.example/', { fetch: fetchFn });
    const files = new ProjectFiles(ws);
    await files.start();
    const seen: string[] = [];
    files.onChange((changes) => seen.push(...changes.map((c) => `${c.kind} ${c.path}`)));
    site.head = SHA('b');
    site.files = [{ ...site.files[0], sha: SHA('9') }, site.files[1]];
    await ws.checkRemote();
    await vi.waitFor(() => expect(seen).toEqual(['change games/pong/main.ts', 'unlink assets/sprites/ball.png']));
    expect(await files.readText('games/pong/main.ts')).toBe('changed');

    await ws.write('games/pong/main.ts', 'mine');
    site.head = SHA('c');
    await ws.checkRemote();
    expect(ws.save.getState().status).toBe('conflict');
  });

  it('reports a failed save and retries on Save', async () => {
    const { fetchFn } = fakeSite();
    let fail = true;
    const flaky = ((input: string, init?: RequestInit) =>
      fail && String(input).endsWith('/commit')
        ? Promise.resolve(new Response('GitHub error 502 (commit)', { status: 502 }))
        : fetchFn(input, init)) as typeof fetch;
    const ws = new GitHubWorkspace('https://tf.example/', { fetch: flaky });
    await ws.list();
    await ws.write('games/pong/main.ts', 'x');
    await ws.flush();
    expect(ws.save.getState()).toMatchObject({ status: 'failed', error: 'GitHub error 502 (commit)' });
    fail = false;
    await ws.flush();
    expect(ws.save.getState().status).toBe('saved');
  });
});
