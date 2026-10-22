/**
 * Mybangjo Owner Mobile App — Dedicated Service Worker
 * Scope: /owner/
 */

var CACHE_NAME = 'mybangjo-owner-v1.6.9';

var STATIC_ASSETS = [
  '/owner/',
  '/owner/manifest.json',
  '/owner/assets/icons/icon-192.png',
  '/owner/assets/icons/icon-512.png',
  '/owner/assets/css/owner-app.css',
  '/owner/assets/js/owner-app.js',
  '/merchant-shared/fonts/plus-jakarta-sans.css',
  '/merchant-shared/css/shared.css',
  '/merchant-shared/css/dashboard.css',
  '/merchant-shared/css/presentation-shells.css'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(STATIC_ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== CACHE_NAME && key.startsWith('mybangjo-owner-')) {
            return caches.delete(key);
          }
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  // Always network-only for APIs, Auth, and dynamic bundles
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.includes('/bundles/')) {
    return;
  }

  // Network-first for navigation requests
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(function () {
        return caches.match('/owner/');
      })
    );
    return;
  }

  // Stale-while-revalidate for static assets
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var fetchPromise = fetch(event.request).then(function (networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          var copy = networkResponse.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, copy);
          });
        }
        return networkResponse;
      }).catch(function () {
        return cached;
      });
      return cached || fetchPromise;
    })
  );
});
