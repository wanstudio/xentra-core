/**
 * Xentra Customer PWA — Service Worker
 * Architecture:
 * 1. Immediate activation via skipWaiting() and clients.claim()
 * 2. Strict Network-First for HTML, JS, CSS (guarantees 0ms stale code on live connections)
 * 3. Cache-Fallback for genuine offline operation
 * 4. Automatic purge of old version caches on activation
 */
const CACHE_NAME = "bangjo-pwa-p7f4a01";
const STATIC_ASSETS = [
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
  "/assets/js/core/pwa-runtime.js",
  "/assets/js/core/promo-reward-cart.js",
  "/assets/js/core/discovery.js",
  "/assets/js/location.js",
  "/assets/js/pages/home.js",
  "/assets/js/pages/checkout.js",
  "/assets/js/pages/order-received.js"
];

// 1. Install & Pre-cache with Cache-Busting
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      const versionedUrls = STATIC_ASSETS.map(u => {
        if (u === "/" || u === "/manifest.json" || u.includes(".png")) return u;
        return u + "?v=" + "p6c9d12";
      });
      return cache.addAll(versionedUrls).catch(err => {
        console.warn("[SW Install] Cache prefetch warn:", err);
      });
    })
  );
});

// 2. Activate & Purge ALL Stale Caches
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log("[SW Activate] Purging old cache:", key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Strategy: Network-First with Live Fallback
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Never touch API calls or Merchant Dashboard
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/dashboard')) {
    return;
  }

  // Network-First for HTML navigation, JS scripts, and CSS stylesheets
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.mode === "navigate") {
            return caches.match("/");
          }
          return null;
        });
      })
  );
});