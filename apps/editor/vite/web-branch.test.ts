import { describe, expect, it } from 'vitest';
import { webBranchChecker } from './web-branch.ts';

const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('web branch status', () => {
  it('asks GitHub to compare the base with the branch, and caches the answer', async () => {
    const urls: string[] = [];
    const headers: Array<Record<string, string>> = [];
    let time = 0;
    const check = webBranchChecker({
      repo: 'me/game',
      branch: 'web',
      base: 'master',
      token: 'tok',
      now: () => time,
      fetch: (url, init) => {
        urls.push(String(url));
        headers.push(init?.headers as Record<string, string>);
        return reply(200, { ahead_by: 3 });
      },
    });
    expect(await check()).toEqual({
      ahead: 3,
      repo: 'me/game',
      branch: 'web',
      base: 'master',
      url: 'https://github.com/me/game/compare/master...web',
    });
    expect(urls).toEqual(['https://api.github.com/repos/me/game/compare/master...web?per_page=1']);
    // The token goes to GitHub only, from the server.
    expect(headers[0].Authorization).toBe('Bearer tok');
    await check();
    expect(urls).toHaveLength(1);
    time += 6 * 60 * 1000;
    await check();
    expect(urls).toHaveLength(2);
  });

  it('answers 0 when GitHub fails or the settings are odd, without asking', async () => {
    let calls = 0;
    const failing = webBranchChecker({
      repo: 'me/game',
      branch: 'web',
      base: 'master',
      fetch: () => {
        calls++;
        return reply(404, { message: 'Not Found' });
      },
    });
    expect(await failing()).toEqual({ ahead: 0 });
    const offline = webBranchChecker({
      repo: 'me/game',
      branch: 'web',
      base: 'master',
      fetch: () => Promise.reject(new Error('offline')),
    });
    expect(await offline()).toEqual({ ahead: 0 });
    const odd = webBranchChecker({
      repo: 'not a repo',
      branch: 'web',
      base: 'master',
      fetch: () => {
        calls++;
        return reply(200, {});
      },
    });
    expect(await odd()).toEqual({ ahead: 0 });
    expect(calls).toBe(1);
  });
});
