'use strict';

const CACHE_NAME = 'persona-cache-v1';
const OFFLINE_URL = '/offline.html';

const ASSETS_TO_CACHE = [
  '/',
  OFFLINE_URL,
  '/css/app.css',
  '/css/output.css',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
  '/manifest.json',
  '/robots.txt'
];

// Install Service Worker and cache core static shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate and clean up obsolete caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Intercept requests and route them appropriately
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // We only intercept GET requests
  if (req.method !== 'GET') return;

  // Static Assets: Cache-First
  const isGoogleFont = url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com';
  const isStaticAsset = (
    isGoogleFont ||
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/robots.txt' ||
    url.pathname.match(/\.(png|jpg|jpeg|gif|svg|woff2|woff|ttf|css|js)$/i)
  );

  if (isStaticAsset) {
    event.respondWith(
      caches.match(req).then((cachedResponse) => {
        if (cachedResponse) {
          // Asynchronously update the cache in the background
          fetch(req).then((networkResponse) => {
            if (networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(req, networkResponse));
            }
          }).catch(() => {});
          return cachedResponse;
        }

        return fetch(req).then((networkResponse) => {
          if (networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, responseClone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Navigation and pages: Network-First falling back to Offline shell
  if (req.mode === 'navigate' || (req.headers.get('accept') && req.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      fetch(req).catch(() => {
        return caches.match(OFFLINE_URL);
      })
    );
    return;
  }

  // General routes / API / other requests: Network-First falling back to cache
  event.respondWith(
    fetch(req).catch(() => {
      return caches.match(req);
    })
  );
});
