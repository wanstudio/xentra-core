const CACHE_NAME = 'xentra-purchasing-shell-v8';
const APP_SHELL = [
  '/belanja/',
  '/belanja/manifest.json',
  '/belanja/assets/icons/icon-192.png',
  '/belanja/assets/icons/icon-512.png',
  '/merchant-shared/fonts/plus-jakarta-sans.css',
  '/merchant-shared/css/shared.css',
  '/belanja/assets/css/purchasing.css',
  '/belanja/assets/js/purchasing-app.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Bypass API dan auth dari caching
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin/') || url.pathname.startsWith('/auth/')) {
    return;
  }

  if (!url.pathname.startsWith('/belanja/')) return;

  event.respondWith(
    fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      return response;
    }).catch(() => caches.match(request).then(cached => cached || caches.match('/belanja/')))
  );
});
