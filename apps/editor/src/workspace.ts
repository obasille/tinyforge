// Which Workspace the editor runs on: the dev server's (or a static copy's)
// HTTP protocol, or, in the deployed editor once logged in to its proxy with
// GitHub set up, the web branch on GitHub.

import { GitHubWorkspace, HttpWorkspace, type Workspace } from '@tinyforge/editor-core';

export async function chooseWorkspace(base: string): Promise<Workspace> {
  const http = new HttpWorkspace(base);
  // The dev server is writable: nothing else to ask.
  const info = await http.list().catch(() => null);
  if (!info || info.writable) return http;
  const status = await fetch(new URL('__tf/ai/status', base), { headers: { 'X-TinyForge': '1' } })
    .then((r) => (r.ok ? (r.json() as Promise<{ github?: unknown }>) : null))
    .catch(() => null);
  if (!status?.github) return http;

  const github = new GitHubWorkspace(base);
  // Save before the page goes away or the app goes to the background; check
  // for changes made elsewhere when it comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void github.flush();
    else void github.checkRemote().catch(() => {});
  });
  addEventListener('pagehide', (e) => {
    if (!e.persisted) github.flushOnExit();
  });
  addEventListener('beforeunload', (e) => {
    const { status: s } = github.save.getState();
    if (s === 'pending' || s === 'saving') e.preventDefault();
  });
  return github;
}
