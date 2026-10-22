/**
 * Xentra Customer PWA — Service Worker
 *
 * Release identity: content hash of this file.
 * Canonical white status bar / theme-color (#ffffff).
 * Release 2026-09-30c: Rasa uses the same title color as Kategori.
 * Release 2026-10-04a: Menu presentation media (foto Menu milik Menu) + fix parser
 *   error di pages/home.js. Cache bubble WAJIB di-bump agar shell lama terbuang
 *   dan perbaikan/JS baru benar-benar sampai ke klien.
 * Release 2026-10-13a: Fix syntax error in pages/home.js (missing closing brace on
 *   renderCustomerSpiceIndicator) to resolve stuck loading in customer PWA.
 * Release 2026-10-14a: Operational open/close branch guard in Customer PWA and POS.
 * Release 2026-10-21a: PWA isolation fix - exclude belanja/purchasing routes from customer SW.
 * Release 2026-10-21d: Dribbble-grade multi-step human onboarding wizard for Affiliate.
 * Release 2026-10-21e: Plus Jakarta Sans self-hosted authoritative brand typography & font-src CSP fix.
 * Release 2026-10-21f: Human copywriting overhaul for referral/affiliate program (anti-robotic).
 * Release 2026-10-21g: Fix syntax parser in aux-pages.js (resolve loop loading in customer PWA).
 * Release 2026-10-21h: Performance audit: instant zero-delay boot, smart asset caching, eliminate blocking splash.
 * Release 2026-10-21i: Coordinated splash lifecycle (smooth fade-out on data ready, no naked skeleton flash).
 * Release 2026-10-21j: Strict data-readiness curtain lifecycle (bfcache event guard, full aux page splash synchronization).
 * Release 2026-10-21k: Fix affiliate form title, remove double-router flicker, sanitize WhatsApp phone prefill.
 * Release 2026-10-21L: Network-First JS/CSS delivery, zero-flicker instant affiliate form, strict phone sanitization.
 * Release 2026-10-21M: Hard cache-busting, zero-flicker affiliate persistence, strict phone sanitization.
 * Release 2026-10-21N: Instant Share & Earn architecture (zero-formulir, instant referral link, delayed payout KYC).
 * Release 2026-10-21O: Menu Detail Modal Redesign (Frame 241) & My Collections wishlist page.
 * Release 2026-10-21Q: Flat Rp1.000 per menu affiliate commission model and copy.
 * Release 2026-10-21P: Remove viewport-fit=cover and enforce canonical white navigation bar (#ffffff) without stroke or scrim.
 * Release 2026-10-22A: Live driver map tracking in order-received (CSP worker-src blob fix, OSM tile fallback, and multi-angle Gojek-style scooter SVG).
 * Release 2026-10-22B: Driver proximity & arrival alerts (chime + vibrate + popup modal + pesanan-sampai.mp3 support).
 * Release 2026-10-22C: GoFood/GrabFood-style Customer Order Journey & Stepper UI overhaul (waiting branch confirmation state, pulsing active step, elevated live map hero).
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
  "/assets/fonts/plus-jakarta-sans.css",
  "/assets/fonts/plus-jakarta-sans-400-latin.woff2",
  "/assets/fonts/plus-jakarta-sans-600-latin.woff2",
  "/assets/fonts/plus-jakarta-sans-700-latin.woff2",
  "/assets/fonts/plus-jakarta-sans-800-latin.woff2",
  "/assets/css/tokens.css",
  "/assets/css/layout.css",
  "/assets/css/components.css",
  "/assets/css/home.css",
  "/assets/js/core/store.js",
  "/assets/js/core/ui.js",
  "/assets/js/core/api.js",
  "/assets/js/core/nav.js",
  "/assets/js/core/router.js",
  "/assets/js/core/pwa-runtime.js",
  "/assets/js/core/promo-reward-cart.js",
  "/assets/js/location.js",
  "/assets/js/core/discovery.js",
  "/assets/js/core/media.js",
  "/assets/js/pages/home.js"
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

// Stale-While-Revalidate: Instant paint from cache while revalidating in background.
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

// Network-First: fresh when online, cached when the network is unavailable.
function networkFirst(event) {
  var req = event.request;
  try {
    req = new Request(event.request, { cache: "reload" });
  } catch (_) {}
  return fetch(req)
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

self.addEventListener("message", function (event) {
  if (event.data && (event.data.action === "skipWaiting" || event.data === "skipWaiting")) {
    self.skipWaiting();
  }
});

// 3. Fetch strategy — per asset category.
self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  var url = new URL(event.request.url);

  // Multi-PWA Isolation & Live Operational Data:
  // API calls, auth, dashboard, and isolated operational PWA surfaces (Merchant, POS)
  // are never intercepted by Customer SW → always live network state, no cross-PWA collision.
  if (url.pathname.startsWith("/api/")) return;
  if (
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/login") ||
    url.pathname.startsWith("/signin") ||
    url.pathname.startsWith("/signup") ||
    url.pathname.startsWith("/dashboard") ||
    url.pathname.startsWith("/owner") ||
    url.pathname.startsWith("/merchant-app") ||
    url.pathname.startsWith("/merchant") ||
    url.pathname.startsWith("/merchant-shared/") ||
    url.pathname.startsWith("/pos") ||
    url.pathname.startsWith("/belanja") ||
    url.pathname.startsWith("/purchasing")
  ) {
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

  // Static font assets (Plus Jakarta Sans woff2/css): Cache-First for instant paint.
  if (url.pathname.startsWith("/assets/fonts/")) {
    event.respondWith(
      computeCacheName().then(function (cn) { return cacheFirst(event, cn); })
    );
    return;
  }

  // Static UI images (app icons): Cache-First.
  if (url.pathname.startsWith("/assets/icons/") || url.pathname.startsWith("/assets/pwa/")) {
    event.respondWith(
      computeCacheName().then(function (cn) { return cacheFirst(event, cn); })
    );
    return;
  }

  // Static app shell styles and scripts: Network-First for immediate code freshness,
  // falling back to cache when offline.
  if (url.pathname.startsWith("/assets/css/") || url.pathname.startsWith("/assets/js/")) {
    event.respondWith(networkFirst(event));
    return;
  }

  // HTML / manifest.json / navigations: Network-First for immediate code freshness.
  event.respondWith(networkFirst(event));
});
