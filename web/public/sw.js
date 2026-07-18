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

const ENTRY_URLS = ['/', '/index.html', '/manifest.webmanifest'];

/**
 * The shell is index.html **and the app it loads**.
 *
 * Caching only the entry points is the trap: a worker installs and claims the page *after* that
 * page's scripts have already been fetched, so the fingerprinted JS and CSS never pass through
 * the fetch handler and never land in the cache. The next offline load then serves index.html
 * from cache and dies fetching the app — an app-shell precache with no app in it.
 *
 * Vite fingerprints the asset filenames on every build, so the list is read out of the freshly
 * fetched index.html rather than hardcoded here, where it would go stale on the next deploy.
 */
async function shellUrls() {
  const urls = new Set(ENTRY_URLS);
  try {
    const response = await fetch('/index.html', { cache: 'reload' });
    if (!response.ok) return [...urls];
    const html = await response.text();
    for (const match of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
      urls.add(match[1]);
    }
  } catch {
    // Installed with no network. The entry points still get cached if they are already there, and
    // the next install with coverage picks up the rest.
  }
  return [...urls];
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const urls = await shellUrls();
      // Individually, so one missing file does not fail the whole install and leave the app with
      // no offline shell at all.
      await Promise.allSettled(urls.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
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

  // The Vite dev server serves modules at stable URLs, so cache-first would pin them to whatever
  // was fetched first and hide every source edit. These paths never exist in a production build —
  // Vite bundles and fingerprints — so always going to network here costs prod nothing and keeps
  // the dev server honest even if a worker from a prior prod build is still registered.
  if (/^\/(src|@vite|@id|@fs|node_modules)\//.test(url.pathname)) return;

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
