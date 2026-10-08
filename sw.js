const CACHE_NAME = 'budget-tracker-v5';
const CACHE_PREFIX = 'budget-tracker-';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './storage.js',
  './manifest.json',
  './favicon.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './logo-64x64.png'
];

// Install: Pre-cache app shell safely without blocking on single image failure
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        ASSETS_TO_CACHE.map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] Could not cache asset:', url, err))
        )
      );
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Activate: Take control immediately & delete old cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Always serve HTML from cache FIRST for instant offline PWA startup
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const isNavigation =
    event.request.mode === 'navigate' ||
    (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'));

  if (isNavigation) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cached) => {
        if (cached) return cached;
        // Fallback to index.html or root if start_url had extra parameters
        return caches.match('./index.html', { ignoreSearch: true }).then((indexCached) => {
          if (indexCached) return indexCached;
          return caches.match('./', { ignoreSearch: true }).then((rootCached) => {
            if (rootCached) return rootCached;
            return fetch(event.request);
          });
        });
      }).catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  // Non-navigation GET requests (icons, manifest, images, etc.)
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    }).catch(() => {
      return new Response('', { status: 404, statusText: 'Offline asset not found' });
    })
  );
});
