/**
 * Xentra Customer PWA — Service Worker (M6)
 * Architecture:
 * 1. Immediate activation via skipWaiting() and clients.claim()
 * 2. Strict Network-First for HTML, JS, CSS (guarantees 0ms stale code on live connections)
 * 3. Cache-Fallback for genuine offline operation
 * 4. Automatic purge of old version caches on activation
 * 5. M6: Immutable media derivative caching — /assets/uploads/derivatives/ paths
 *    are versioned by media_id, so safe to cache with Cache-First strategy.
 *    Never cache: original binaries, admin endpoints, arbitrary uploads.
 */
const CACHE_NAME = "bangjo-pwa-m6a01";
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
  "/assets/css/location-picker.css",
  "/assets/js/core/store.js",
  "/assets/js/core/ui.js",
  "/assets/js/core/api.js",
  "/assets/js/core/nav.js",
  "/assets/js/core/router.js",
  "/assets/js/core/pwa-runtime.js",
  "/assets/js/core/promo-reward-cart.js",
  "/assets/js/core/media.js",
  "/assets/js/location.js",
  "/assets/js/core/discovery.js",
  "/assets/js/core/location-picker.js",
  "/assets/js/pages/home.js",
  "/assets/js/pages/checkout.js",
  "/assets/js/pages/order-received.js",
  "/assets/js/pages/aux-pages.js"
];

// M6: Separate cache for immutable media derivatives (versioned by media_id)
const MEDIA_CACHE_NAME = "bangjo-media-m6a01";

// 1. Install & Pre-cache with Cache-Busting
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      const versionedUrls = STATIC_ASSETS.map(u => {
        if (u === "/" || u === "/manifest.json" || u.includes(".png")) return u;
        return u + "?v=" + "m6a01";
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
          // Purge any non-current caches (old app cache AND old media cache)
          if (key !== CACHE_NAME && key !== MEDIA_CACHE_NAME) {
            console.log("[SW Activate] Purging old cache:", key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Strategy
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Never touch API calls or Dashboard
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/dashboard')) {
    return;
  }

  // Never cache admin or original media paths
  if (url.pathname.startsWith('/admin/') ||
      url.pathname.startsWith('/assets/uploads/originals/') ||
      url.pathname.startsWith('/assets/uploads/staging/')) {
    return;
  }

  // M6: Cache-First for immutable media derivative URLs.
  // Paths under /assets/uploads/derivatives/<brandId>/<mediaId>/<variant>.webp
  // are content-addressed by media_id — safe to cache indefinitely.
  // A media replacement creates a NEW media_id → new URL → new cache entry.
  if (url.pathname.startsWith('/assets/uploads/derivatives/')) {
    event.respondWith(
      caches.open(MEDIA_CACHE_NAME).then(cache => {
        return cache.match(event.request).then(cached => {
          if (cached) return cached; // Cache hit — immutable derivative
          return fetch(event.request).then(response => {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => cached || null);
        });
      })
    );
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