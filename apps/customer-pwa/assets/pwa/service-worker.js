/**
 * Xentra Customer PWA — Service Worker
 *
 * Release identity: content hash of this file.
 * When this file changes (new commit), the hash changes → new cache → old purged.
 * No hardcoded version strings. No external endpoints. No manual edits.
 *
 * Architecture:
 * 1. Cache name derived from own content hash (auto-changes with each commit)
 * 2. skipWaiting() + clients.claim() for immediate activation
 * 3. Activate purges ONLY stale app-shell caches (scoped to the xentra-pwa-
 *    namespace) and PRESERVES the immutable media cache + unrelated caches.
 *    Never performs a global Cache Storage wipe.
 * 4. Per-category fetch strategy (P0 #4):
 *      API /dashboard                        → bypass (always live network)
 *      admin + uploads/originals|staging     → bypass (never cached)
 *      /assets/uploads/derivatives/          → Cache-First (immutable, by media_id)
 *      /assets/icons/ + /assets/pwa/         → Cache-First (cosmetic staleness only)
 *      HTML / JS / CSS / manifest.json       → Network-First (freshness; unversioned
 *                                              URLs make Cache-First unsafe here)
 *      offline fallback                      → cached match, navigations → "/"
 */
var MEDIA_CACHE_NAME = "xentra-media";
// Every application-shell cache lives under this namespace. Activate only ever
// deletes caches inside it, so a release can never wipe unrelated caches
// (media derivatives, other apps served from the same origin, ...).
var APP_CACHE_PREFIX = "xentra-pwa-";
// Used only when the content hash cannot be computed (e.g. offline install).
var FALLBACK_CACHE_NAME = "xentra-pwa-live";

var STATIC_ASSETS = [
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
  "/assets/js/core/delivery-schedule.js",
  "/assets/js/core/media.js",
  "/assets/js/location.js",
  "/assets/js/core/discovery.js",
  "/assets/js/core/location-picker.js",
  "/assets/js/pages/home.js",
  "/assets/js/pages/checkout.js",
  "/assets/js/pages/order-received.js",
  "/assets/js/pages/aux-pages.js"
];

// Content-hash: fetch own file, compute simple hash for cache name.
// When this file changes (new commit), hash changes → new cache → old purged.
// Resolved once per SW lifetime and shared by install/activate/fetch so the SW
// script is never re-fetched per request.
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
      // Fallback: use a static name so SW still installs
      return FALLBACK_CACHE_NAME;
    });
  return _cacheNamePromise;
}

// 1. Install — compute content hash, pre-cache assets
self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    computeCacheName().then(function (cacheName) {
      return caches.open(cacheName).then(function (cache) {
        return cache.addAll(STATIC_ASSETS).catch(function (err) {
          console.warn("[SW Install] Cache prefetch warn:", err);
        });
      });
    })
  );
});

// 2. Activate — purge ONLY stale application-shell caches, KEEP media cache.
// Never performs a global cache wipe: caches outside the app-shell namespace
// (media cache, other apps on this origin, ...) are always left untouched.
self.addEventListener("activate", function (event) {
  event.waitUntil(
    computeCacheName().then(function (currentCacheName) {
      // The content hash could not be computed (offline fallback). We cannot
      // tell which caches belong to this release, so keep everything instead of
      // risking the loss of the whole app shell.
      if (currentCacheName === FALLBACK_CACHE_NAME) {
        console.warn("[SW Activate] Cache name unresolved — skipping purge to protect existing caches");
        return;
      }
      return caches.keys().then(function (keys) {
        return Promise.all(
          keys.map(function (key) {
            // Preserve the immutable media cache across every release.
            if (key === MEDIA_CACHE_NAME) return;
            // Only purge caches inside this application's shell namespace.
            if (key.indexOf(APP_CACHE_PREFIX) !== 0) return;
            // Keep the cache created by this release.
            if (key === currentCacheName) return;
            console.log("[SW Activate] Purging old app-shell cache:", key);
            return caches.delete(key);
          })
        );
      });
    }).then(function () { return self.clients.claim(); })
  );
});

// ── Fetch helpers ───────────────────────────────────────────────────────────

// Cache-First: serve from cache when present, otherwise fetch and store.
function cacheFirst(event, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        if (response && response.status === 200) {
          cache.put(event.request, response.clone());
        }
        return response;
      }).catch(function () { return cached || null; });
    });
  });
}

// Network-First: fresh when online, cached when the network is unavailable.
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
          return caches.match("/");
        }
        return null;
      });
    });
}

// 3. Fetch strategy — per asset category (see the table in the header comment).
self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  var url = new URL(event.request.url);

  // API calls / Dashboard: never intercepted → always live network state.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/dashboard")) {
    return;
  }

  // Never cache admin or original/staging media paths.
  if (url.pathname.startsWith("/admin/") ||
      url.pathname.startsWith("/assets/uploads/originals/") ||
      url.pathname.startsWith("/assets/uploads/staging/")) {
    return;
  }

  // Immutable media derivatives (content-addressed by media_id): Cache-First.
  if (url.pathname.startsWith("/assets/uploads/derivatives/")) {
    event.respondWith(cacheFirst(event, MEDIA_CACHE_NAME));
    return;
  }

  // Static UI images (app icons): Cache-First. Only cosmetic staleness is
  // possible, and it is bounded by the app-shell cache rotating on each release.
  if (url.pathname.startsWith("/assets/icons/") || url.pathname.startsWith("/assets/pwa/")) {
    event.respondWith(
      computeCacheName().then(function (cn) { return cacheFirst(event, cn); })
    );
    return;
  }

  // HTML / JS / CSS / manifest: Network-First. Deliberately NOT cache-first:
  // asset URLs are unversioned (release identity is the SW content hash), so a
  // stale JS/CSS could pair with a newer HTML document. Network-First keeps code
  // freshness and lets the offline fallback handle real outages.
  event.respondWith(networkFirst(event));
});
