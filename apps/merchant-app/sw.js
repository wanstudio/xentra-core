/**
 * Xentra Merchant App — Dedicated Service Worker
 *
 * Scoped specifically to the Branch Manager operational surface (/merchant-app/).
 * Namespace: xentra-merchant-
 *
 * Operational rules:
 * 1. API & Auth requests (/api/*, /auth/*, /login) are ALWAYS Network-Only (never cached)
 *    to prevent stale orders, out-of-sync table status, or outdated stock.
 * 2. Navigation requests: Network-First with fallback to cached shell.
 * 3. Static shell assets: Stale-While-Revalidate for instant render.
 * 4. Cache name auto-derived from own script content hash.
 */

var APP_CACHE_PREFIX = "xentra-merchant-";
var FALLBACK_CACHE_NAME = "xentra-merchant-live";

var STATIC_ASSETS = [
  "/merchant-app/",
  "/merchant-app/manifest.json",
  "/merchant-app/assets/icons/icon-192.png",
  "/merchant-app/assets/icons/icon-512.png",
  "/merchant-shared/css/shared.css?v=1.0.0",
  "/merchant-shared/css/dashboard.css?v=1.0.12",
  "/merchant-shared/js/shared.js?v=1.0.0",
  "/merchant-shared/js/action-menu.js?v=1.0.0",
  "/merchant-shared/js/crop-editor.js?v=1.0.0",
  "/merchant-shared/js/catalog-client.js?v=1.0.0",
  "/assets/js/core/fulfillment-environments.js?v=1.0.0",
  "/merchant-app/assets/js/branch-catalog-ui.js?v=1.0.0",
  "/merchant-app/assets/js/context.js?v=1.0.0",
  "/merchant-app/assets/js/menu.js?v=1.0.0",
  "/merchant-app/assets/js/hari-ini.js?v=1.0.0",
  "/merchant-app/assets/js/jam-operasional.js?v=1.0.0",
  "/merchant-app/assets/js/reports.js?v=1.0.0",
  "/merchant-app/assets/js/tables.js?v=1.0.0",
  "/merchant-app/assets/js/stock.js?v=1.0.0",
  "/merchant-app/assets/js/promotions.js?v=1.0.0",
  "/merchant-app/assets/js/staff.js?v=1.0.0",
  "/merchant-app/assets/js/orders.js?v=1.0.1",
  "/merchant-app/assets/js/merchant-app.js?v=1.0.2"
];

var _cacheNamePromise = null;
function computeCacheName() {
  if (_cacheNamePromise) return _cacheNamePromise;
  _cacheNamePromise = fetch(self.location.href, { cache: "no-store" })
    .then(function (r) { return r.text(); })
    .then(function (text) {
      var hash = 0;
      for (var i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash = hash & hash;
      }
      return APP_CACHE_PREFIX + Math.abs(hash).toString(36);
    })
    .catch(function () {
      return FALLBACK_CACHE_NAME;
    });
  return _cacheNamePromise;
}

// 1. Install — compute hash, pre-cache shell
self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    computeCacheName().then(function (cacheName) {
      return caches.open(cacheName).then(function (cache) {
        return cache.addAll(STATIC_ASSETS).catch(function (err) {
          console.warn("[Merchant SW] Pre-cache warn:", err);
        });
      });
    })
  );
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.action === "skipWaiting") {
    self.skipWaiting();
  }
});

// 2. Activate — purge ONLY stale xentra-merchant- caches, claim clients
self.addEventListener("activate", function (event) {
  event.waitUntil(
    computeCacheName().then(function (currentCacheName) {
      if (currentCacheName === FALLBACK_CACHE_NAME) return;
      return caches.keys().then(function (keys) {
        return Promise.all(
          keys.map(function (key) {
            if (key.indexOf(APP_CACHE_PREFIX) !== 0) return;
            if (key === currentCacheName) return;
            return caches.delete(key);
          })
        );
      });
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// 3. Stale-While-Revalidate helper for assets
function staleWhileRevalidate(event) {
  return computeCacheName().then(function (cn) {
    return caches.open(cn).then(function (cache) {
      return cache.match(event.request).then(function (cached) {
        var fetchPromise = fetch(event.request).then(function (response) {
          if (response && response.status === 200) {
            cache.put(event.request, response.clone());
          }
          return response;
        }).catch(function () {
          return cached || null;
        });
        return cached || fetchPromise;
      });
    });
  });
}

// 4. Network-First helper for navigation / shell
function networkFirst(event) {
  return fetch(event.request)
    .then(function (response) {
      if (response && response.status === 200) {
        var copy = response.clone();
        computeCacheName().then(function (cn) {
          caches.open(cn).then(function (c) { c.put(event.request, copy); });
        });
      }
      return response;
    })
    .catch(function () {
      return caches.match(event.request).then(function (cached) {
        if (cached) return cached;
        if (event.request.mode === "navigate") {
          return caches.match("/merchant-app/");
        }
        return null;
      });
    });
}

// 5. Fetch listener
self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  var url = new URL(event.request.url);

  // Operational APIs, auth, webhooks, or SSE are strictly Network-Only (NEVER cached)
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/login") ||
    url.pathname.startsWith("/webhooks/")
  ) {
    return;
  }

  // Static shell styles, scripts, fonts, and icons: Stale-While-Revalidate
  if (
    url.pathname.startsWith("/merchant-shared/") ||
    url.pathname.startsWith("/merchant-app/assets/") ||
    url.pathname.startsWith("/assets/fonts/")
  ) {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }

  // HTML / Navigations / Manifest: Network-First
  event.respondWith(networkFirst(event));
});
