// The installable app (step 10 of the mobile plan): manifest, icons, the iOS
// tags and a small hand-written service worker (pwa/sw.js), in the build
// only. Nothing here runs in pnpm dev.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pwa');
/** Larger files (the compiler) are cached on first use, not at install. */
export const PRECACHE_MAX_BYTES = 2_000_000;
const THEME = '#16161c';

export const MANIFEST = {
  name: 'TinyForge Editor',
  short_name: 'TinyForge',
  description: 'Make small games in AssemblyScript, with AI.',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: THEME,
  theme_color: THEME,
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    // The letters sit inside the central 60%, so a round or squircle mask keeps them.
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

/** pwa/sw.js with this build's files: every hashed asset, and the ones to cache at install. */
export function serviceWorker(assets: Array<{ file: string; size: number }>): string {
  const all = assets.map((a) => a.file).sort();
  const precache = assets
    .filter((a) => a.size <= PRECACHE_MAX_BYTES)
    .map((a) => a.file)
    .sort();
  return readFileSync(path.join(DIR, 'sw.js'), 'utf8')
    .replace('/*ASSETS*/ []', JSON.stringify(all))
    .replace('/*PRECACHE*/ []', JSON.stringify(precache));
}

const HEAD_TAGS = [
  { tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' } },
  { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '192x192', href: './icons/icon-192.png' } },
  { tag: 'link', attrs: { rel: 'apple-touch-icon', href: './icons/apple-touch-icon.png' } },
  { tag: 'meta', attrs: { name: 'theme-color', content: THEME } },
  { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' } },
  { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' } },
  { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'TinyForge' } },
  // The page runs under the status bar, which shows over the page's own
  // background; .tf-app pads the top by the safe-area inset. ("black" left a
  // grey veil over the top bar on an iPhone.)
  { tag: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' } },
] as const;

export function pwa(): Plugin {
  return {
    name: 'tinyforge-pwa',
    apply: 'build',
    transformIndexHtml() {
      return HEAD_TAGS.map(({ tag, attrs }) => ({ tag, attrs: { ...attrs }, injectTo: 'head' as const }));
    },
    generateBundle(_options, bundle) {
      const assets = Object.values(bundle).flatMap((item) => {
        const file = item.fileName;
        if (!file.startsWith('assets/') || file.endsWith('.map') || path.basename(file).startsWith('.')) return [];
        const size = item.type === 'chunk' ? Buffer.byteLength(item.code) : item.source.length;
        return [{ file, size }];
      });
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(MANIFEST, null, 2) });
      for (const icon of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
        this.emitFile({ type: 'asset', fileName: `icons/${icon}`, source: readFileSync(path.join(DIR, icon)) });
      }
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker(assets) });
    },
  };
}
