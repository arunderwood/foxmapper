/**
 * Service worker: app shell precache, and nothing else.
 *
 * **Tiles are not pre-fetched, and that is not an oversight.** Every tile provider prohibits it by
 * name — OSMF's policies list "downloading of tiles in advance instead of downloading when a user
 * views those tiles" as the prohibited practice, with offline use as the named example. Asking
 * users to violate a provider's policy on our behalf is not a mitigation.
 *
 * What is allowed, and what this does: tiles the hunter actually *viewed* while in coverage stay
 * in the browser's HTTP cache, because OSMF's policy requires honouring cache headers for at least
 * seven days and only forbids pre-emptive fetching. Ground already looked at stays drawn. That
 * costs nothing and breaks no policy.
 */

const SHELL_CACHE = 'foxmapper-shell-v1';

/**
 * The app shell. Vite fingerprints the built assets, so the worker caches what it is asked for at
 * runtime rather than a hardcoded list that would go stale on every deploy.
 */
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Individually, so one missing file does not fail the whole install and leave the app with
      // no offline shell at all.
      .then((cache) => Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // The API is never cached. A stale report list would be worse than no report list: the log is
  // the client's, and sync.ts already holds every report this device knows about.
  if (url.pathname.startsWith('/api/')) return;

  // Tiles pass straight through to the browser's HTTP cache, which honours the provider's headers.
  // Putting them in a Cache Storage bucket we control would turn a legitimate viewed-tile cache
  // into an archive we manage, which is the thing the policy forbids.
  if (url.origin !== self.location.origin) return;

  // Navigations: network first, shell second. A hunter opening the app out of coverage gets the
  // app, not a browser error page — which is the whole reason this file exists.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((r) => r ?? Response.error())),
    );
    return;
  }

  // Same-origin assets: cache first, then network, and store what comes back. Vite fingerprints
  // filenames, so a cached asset is never stale — a new build asks for a new URL.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
