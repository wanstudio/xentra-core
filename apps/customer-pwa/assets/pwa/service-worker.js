/**
 * Xentra Customer PWA — Service Worker (Release v2.2.8)
 * Follows Google & Gojek PWA Best Practices:
 * 1. Immediate activation via skipWaiting() and clients.claim()
 * 2. Strict Network-First navigation (never serves stale HTML while online)
 * 3. Automatic purge of old version caches on activation
 */
const CACHE_NAME = "bangjo-core-v228";
const ASSETS_TO_CACHE = [

  "/",
  "/manifest.json",
  "/assets/pwa/icon-192.png",
  "/assets/pwa/icon-512.png",
  "/assets/css/tokens.css",
  "/assets/css/layout.css",
  "/assets/css/components.css",
  "/assets/css/home.css",
  "/assets/css/checkout.css",
  "/assets/css/order-received.css",
  "/assets/js/core/store.js",
  "/assets/js/core/ui.js",
  "/assets/js/core/api.js",
  "/assets/js/core/nav.js",
  "/assets/js/core/router.js",
  "/assets/js/pages/home.js",
  "/assets/js/pages/checkout.js",
  "/assets/js/pages/order-received.js"
];

// 1. Install & Pre-cache
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn("[SW Install] Cache addAll warning:", err);
      });
    })
  );
});

// 2. Activate & Purge All Stale Caches
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log("[SW Activate] Purging stale cache:", key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Strategy: Network-First for HTML & Dynamic, Cache-Fallback
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Bypass API, Admin, and Dashboard
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/dashboard')) {
    return;
  }

  // Navigation requests (HTML page loads): ALWAYS Network-First
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match("/") || caches.match(event.request))
    );
    return;
  }

  // Static Assets (JS / CSS / Images): Network-First with Cache Fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});