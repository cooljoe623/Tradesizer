/**
 * Service Worker for TradeSizer
 *
 * Strategy:
 *   - Network-first for API calls (/api/*) — fresh data is critical
 *   - Cache-first for all static assets (HTML, CSS, JS, icons, manifest)
 *
 * Install: precache the app shell so it loads instantly offline.
 * Activate: delete all old caches and claim clients immediately.
 * Fetch: serve static from cache, API from network only.
 */

const CACHE_NAME = 'tradesizer-v2';
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

// ── Install: precache the app shell ──────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  // Skip waiting and take control immediately so the new SW
  // intercepts every fetch from page load, not just after a refresh.
  self.skipWaiting();
});

// ── Activate: wipe old caches and claim clients immediately ─
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls → network only (never serve stale HTML as JSON)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkOnly(event.request));
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
    // Offline fallback: show the app shell for page navigations
    if (request.mode === 'navigate') {
      return caches.match('/index.html');
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

/**
 * Network-only for API calls. No cache fallback so a stale HTML
 * page can never be served in place of JSON.
 */
async function networkOnly(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
