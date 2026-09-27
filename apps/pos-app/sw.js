/**
 * Xentra POS App — Dedicated Service Worker
 *
 * Scoped to the POS Cashier operational surface.
 * Namespace: xentra-pos-
 */

var APP_CACHE_PREFIX = "xentra-pos-";
var FALLBACK_CACHE_NAME = "xentra-pos-live";

var STATIC_ASSETS = [
  "/pos/",
  "/pos/manifest.json",
  "/pos/assets/icons/icon-192.png",
  "/pos/assets/icons/icon-512.png",
  "/pos/assets/css/pos.css?v=1.0.11",
  "/pos/assets/js/TransactionComposer.js?v=1.0.11",
  "/pos/assets/js/PosOfflineStore.js?v=1.0.0",
  "/pos/assets/js/pos-app.js?v=1.0.13"
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

// 1. Install
self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    computeCacheName().then(function (cacheName) {
      return caches.open(cacheName).then(function (cache) {
        return cache.addAll(STATIC_ASSETS).catch(function (err) {
          console.warn("[POS SW] Pre-cache warn:", err);
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

// 2. Activate
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

// 3. Stale-While-Revalidate
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

// 4. Network-First
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
          return caches.match("/pos/");
        }
        return null;
      });
    });
}

// 5. Fetch listener
self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  var url = new URL(event.request.url);

  // Operational APIs, auth, webhooks, or foreign surfaces (Customer PWA, Merchant PWA, Owner)
  // are strictly bypassed (Network-Only) to preserve 100% PWA isolation.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/login") ||
    url.pathname.startsWith("/signin") ||
    url.pathname.startsWith("/signup") ||
    url.pathname.startsWith("/webhooks/") ||
    url.pathname.startsWith("/merchant-app") ||
    url.pathname.startsWith("/merchant") ||
    url.pathname.startsWith("/dashboard") ||
    url.pathname.startsWith("/owner") ||
    url.pathname.startsWith("/checkout") ||
    url.pathname.startsWith("/order-received")
  ) {
    return;
  }

  // Static shell styles, scripts, fonts, and icons: Stale-While-Revalidate
  if (
    url.pathname.startsWith("/pos/assets/") ||
    url.pathname.startsWith("/assets/fonts/")
  ) {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }

  // Scope guard: Only intercept navigations or manifest inside the POS scope
  if (
    url.pathname === "/pos" ||
    url.pathname.startsWith("/pos/") ||
    url.pathname === "/pos-app" ||
    url.pathname.startsWith("/pos-app/") ||
    url.pathname === "/"
  ) {
    event.respondWith(networkFirst(event));
  }
});
