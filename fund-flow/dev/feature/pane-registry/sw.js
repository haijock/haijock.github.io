// FundFlow Service Worker
// Bump VERSION to invalidate caches on deploy.
const VERSION = '2';
const CACHE_NAME = `fundflow-v${VERSION}`;

// App shell: files to pre-cache on install.
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './core/pane-registry.js',
  './panes/breakdown.js',
  './panes/priority.js',
  './panes/cashflow.js',
  './panes/milestones.js',
  './manifest.json',
  './vendor/chart.js',
  './vendor/chartjs-adapter-date-fns.js',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-maskable-512.svg',
];

// ---- Install: pre-cache the app shell ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

// ---- Activate: purge old caches ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('fundflow-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  // Start controlling all open tabs immediately.
  self.clients.claim();
});

// ---- Fetch: routing strategy ----
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle GET requests.
  if (event.request.method !== 'GET') return;

  // Google Fonts CSS (fonts.googleapis.com) — network-first so updates propagate.
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(networkFirstThenCache(event.request));
    return;
  }

  // Google Fonts binary files (fonts.gstatic.com) — cache-first (immutable).
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirstThenNetwork(event.request));
    return;
  }

  // Same-origin requests — cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstThenNetwork(event.request));
    return;
  }

  // Everything else: let it pass through (no caching).
});

// ---- Strategies ----

function cacheFirstThenNetwork(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      // Only cache valid responses.
      if (!response || response.status !== 200 || response.type === 'opaque') {
        return response;
      }
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
      return response;
    });
  });
}

function networkFirstThenCache(request) {
  return fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
      }
      return response;
    })
    .catch(() => caches.match(request));
}
