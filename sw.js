const CACHE_NAME = 'budget-tracker-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './favicon.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './logo-64x64.png'
];

// Install — pre-cache app shell
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).catch(err => console.error('[SW] Pre-cache failed:', err))
  );
});

// Activate — purge old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch — cache-first for all GET requests, dynamic caching for fonts
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // For Google Fonts (CSS + woff2 files) — cache-first with network fallback
  const isFontReq = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      // Not in cache — try network
      return fetch(event.request).then((response) => {
        // Cache successful responses for app assets and font resources
        if (response && response.status === 200) {
          const isOwnAsset = url.origin === self.location.origin;
          if (isOwnAsset || isFontReq) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        // For fonts that aren't cached yet — just fail silently, system fonts will be used
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
