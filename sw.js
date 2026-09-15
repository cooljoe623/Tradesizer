/**
 * Service Worker for TradeSizer
 *
 * Strategy:
 *   - Cache-first for static assets (HTML, CSS, JS, icons, manifest)
 *   - Network-first for API calls (/api/*) so live data is never stale
 *
 * Install: precache the shell so the app loads instantly.
 * Activate: clean up old caches.
 * Fetch: serve cached assets offline, fall back to network when online.
 */

const CACHE_NAME = 'tradesizer-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.json',
  '/src/api.js',
  '/src/login.js',
  '/src/app.js',
  '/src/engine/calculationEngine.js',
  '/src/engine/calculationEngine.test.js',
  '/src/data/settingsStore.js',
  '/settings.json',
];

// ── Install: precache the app shell ──────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// ── Fetch: cache-first for static, network-first for API ────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls → network-first (fresh data is critical)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Everything else → cache-first
  event.respondWith(cacheFirst(event.request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline fallback for navigation requests
    if (request.mode === 'navigate') {
      return caches.match('/index.html');
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ ok: false, error: 'Offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
