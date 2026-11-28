// The deployed editor's service worker. apps/editor/vite/pwa.ts writes it to
// the build as sw.js, with this build's file lists filled in.
//
// - assets/ (content-hashed names, never change): cache first. The small ones
//   are cached at install; the large ones (the compiler) on first use.
// - The page itself: network first, so a deploy shows at the next launch; the
//   cached copy only when the network fails.
// - __tf/ (project files, the AI and GitHub proxy, login): never touched, so
//   nothing private or stale is ever served from here.
// - Everything else: the network, as without a service worker.

/** Every hashed file of this build, relative to the scope. */
const ASSETS = /*ASSETS*/ [];
/** The ones cached at install. */
const PRECACHE = /*PRECACHE*/ [];
const ASSET_CACHE = 'tf-assets';
const PAGE_CACHE = 'tf-page';

const scope = new URL(self.registration.scope);
const known = new Set(ASSETS);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(ASSET_CACHE);
      await cache.addAll(PRECACHE.map((file) => new URL(file, scope).href));
      // The page fetches no file through this worker until the next launch,
      // so taking over now cannot mix two builds in one page.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop the files of earlier builds.
      const cache = await caches.open(ASSET_CACHE);
      for (const request of await cache.keys()) {
        const file = new URL(request.url).pathname.slice(scope.pathname.length);
        if (!known.has(file)) await cache.delete(request);
      }
      for (const name of await caches.keys()) {
        if (name !== ASSET_CACHE && name !== PAGE_CACHE) await caches.delete(name);
      }
    })(),
  );
});

async function cacheFirst(request, file) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && known.has(file)) await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(scope.href, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(scope.href);
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const file = url.pathname.slice(scope.pathname.length);
  if (file.startsWith('__tf/')) return;
  if (file.startsWith('assets/')) {
    event.respondWith(cacheFirst(request, file));
  } else if (request.mode === 'navigate' && (file === '' || file === 'index.html')) {
    event.respondWith(networkFirst(request));
  }
});
