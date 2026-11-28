import { describe, expect, it } from 'vitest';
import { MANIFEST, PRECACHE_MAX_BYTES, serviceWorker } from './pwa.ts';
import { rootHtaccess } from './site-headers.ts';

describe('installable app', () => {
  it('caches small files at install and the compiler on first use', () => {
    const sw = serviceWorker([
      { file: 'assets/index-a.js', size: 1_400_000 },
      { file: 'assets/asc-b.js', size: PRECACHE_MAX_BYTES + 1 },
    ]);
    expect(sw).toContain('const ASSETS = ["assets/asc-b.js","assets/index-a.js"];');
    expect(sw).toContain('const PRECACHE = ["assets/index-a.js"];');
    // Project files, the AI and GitHub proxy and the login are never answered by the worker.
    expect(sw).toContain("if (file.startsWith('__tf/')) return;");
  });

  it('has a relative scope and start, so it works from any folder', () => {
    expect(MANIFEST).toMatchObject({ start_url: './', scope: './', display: 'standalone' });
  });

  it('serves the manifest with its type and revalidates sw.js', () => {
    expect(rootHtaccess()).toContain('AddType application/manifest+json .webmanifest');
    expect(rootHtaccess()).toContain('Header set Cache-Control "no-cache"');
  });
});
