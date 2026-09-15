/**
 * Service Worker for TradeSizer (deployed via Express on Render)
 *
 * Strategy:
 *   - API calls (/api/*): network only — never cache, never serve stale HTML as JSON
 *   - Static assets (JS, CSS, icons, manifest): cache-first, updated on each install
 *   - index.html: network only (always fresh from Express)
 *
 * The install event caches JS/CSS/icons but NOT index.html.
 * This prevents stale HTML from being served while the new service
 * worker takes control.
 */

const CACHE_NAME = 'tradesizer-v3';
const STATIC_ASSETS = [
  '/manifest.json',
  '/src/api.js',
  '/src/login.js',
  '/src/app.js',
  '/src/engine/calculationEngine.js',
  '/src/engine/calculationEngine.test.js',
  '/src/data/settingsStore.js',
  '/settings.json',
  '/styles.css',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// ── Install: cache only static assets (NOT index.html) ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
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

// ── Fetch ──────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls → never cache (prevents HTML being served as JSON)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkOnly(event.request));
    return;
  }

  // index.html → always fresh from Express (never cached)
  if (url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(networkOnly(event.request));
    return;
  }

  // Everything else (JS, CSS, icons, manifest) → cache-first
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
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
