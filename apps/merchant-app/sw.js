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
var APP_VERSION = "v1.4.13";
var FALLBACK_CACHE_NAME = "xentra-merchant-live";

var STATIC_ASSETS = [
  "/merchant-app/",
  "/merchant-app/manifest.json",
  "/merchant-app/assets/icons/icon-192.png",
  "/merchant-app/assets/icons/icon-512.png",
  "/merchant-shared/css/shared.css?v=1.0.1",
  "/merchant-shared/css/dashboard.css?v=1.0.39",
  "/merchant-app/assets/css/home.css?v=1.0.18",
  "/merchant-shared/js/shared.js?v=1.0.1",
  "/merchant-shared/js/audio-alerts.js?v=1.0.4",
  "/merchant-shared/js/wake-lock.js?v=1.0.0",
  "/merchant-shared/audio/ada-pesanan-baru.mp3",
  "/merchant-shared/js/action-menu.js?v=1.0.0",
  "/merchant-shared/js/crop-editor.js?v=1.0.2",
  "/merchant-shared/js/catalog-client.js?v=1.0.0",
  "/assets/js/core/fulfillment-environments.js?v=1.0.1",
  "/merchant-app/assets/js/branch-catalog-ui.js?v=1.0.1",
  "/merchant-app/assets/js/context.js?v=1.0.0",
  "/merchant-app/assets/js/menu.js?v=1.1.0",
  "/merchant-app/assets/js/hari-ini.js?v=1.0.7",
  "/merchant-app/assets/js/home.js?v=1.0.2",
  "/merchant-app/assets/js/jam-operasional.js?v=1.0.0",
  "/merchant-app/assets/js/reports.js?v=1.0.0",
  "/merchant-app/assets/js/tables.js?v=1.0.0",
  "/merchant-app/assets/js/stock.js?v=1.1.0",
  "/merchant-app/assets/js/purchasing.js?v=1.1.4",
  "/merchant-app/assets/js/promotions.js?v=1.0.2",
  "/merchant-app/assets/js/staff.js?v=1.0.0",
  "/merchant-app/assets/js/orders.js?v=1.0.10",
  "/merchant-app/assets/js/merchant-app.js?v=1.1.7"
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

  // Operational APIs, auth, webhooks, or foreign surfaces (Customer PWA, POS PWA, Owner)
  // are strictly bypassed (Network-Only) to preserve 100% PWA isolation.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/login") ||
    url.pathname.startsWith("/signin") ||
    url.pathname.startsWith("/signup") ||
    url.pathname.startsWith("/webhooks/") ||
    url.pathname.startsWith("/pos") ||
    url.pathname.startsWith("/dashboard") ||
    url.pathname.startsWith("/owner") ||
    url.pathname.startsWith("/checkout") ||
    url.pathname.startsWith("/order-received")
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

  // Scope guard: Only intercept navigations or manifest inside the Merchant scope
  if (
    url.pathname === "/merchant-app" ||
    url.pathname.startsWith("/merchant-app/") ||
    url.pathname === "/merchant" ||
    url.pathname.startsWith("/merchant/")
  ) {
    event.respondWith(networkFirst(event));
  }
});

// 6. Notification Click & Quick Action Buttons (Heads-up banner actions)
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var orderId = data.orderId;
  var action = event.action;

  // Direct action: [✓ Terima] clicked directly from floating notification banner
  if (action === "accept" && orderId) {
    var reqHeaders = { "Content-Type": "application/json" };
    if (data.token) reqHeaders["Authorization"] = "Bearer " + data.token;

    event.waitUntil(
      fetch("/api/v1/orders/" + encodeURIComponent(orderId) + "/branch-acceptance", {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify({
          decision: "accept",
          note: "Diterima melalui Notifikasi Cepat"
        })
      })
        .then(function () {
          return self.registration.showNotification("✅ Pesanan Diterima", {
            body: "Pesanan #" + (data.orderNumber || orderId) + " berhasil diterima dan diproses dapur.",
            icon: "/merchant-app/assets/icons/icon-192.png",
            tag: "order-accepted-" + orderId,
            silent: true
          });
        })
        .then(function () {
          return self.clients.matchAll({ type: "window", includeUncontrolled: true });
        })
        .then(function (clients) {
          clients.forEach(function (client) {
            client.postMessage({ type: "ORDER_ACCEPTED_FROM_NOTIFICATION", orderId: orderId });
          });
        })
        .catch(function (err) {
          console.error("[SW Notification Accept Error]:", err);
        })
    );
    return;
  }

  // Default action: tap on notification body or [Buka Detail] button
  var targetUrl = data.url || "/merchant-app/#pesanan";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url && client.url.includes("/merchant-app") && "focus" in client) {
          client.postMessage({ type: "NAVIGATE_TO_ORDER", orderId: orderId });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// 7. Push Event Listener (Incoming Web Push Notifications)
self.addEventListener("push", function (event) {
  var payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_) {
      payload = { title: "Pesanan Masuk", body: event.data.text() };
    }
  }
  var title = payload.title || "🔔 Pesanan Baru Masuk!";
  var aggressiveVibrate = [500, 250, 500, 250, 1000, 250, 1000];
  var options = {
    body: payload.body || "Ada pesanan baru yang memerlukan konfirmasi segera.",
    icon: "/merchant-app/assets/icons/icon-192.png",
    badge: "/merchant-app/assets/icons/icon-192.png",
    tag: payload.tag || ("order-pending-" + Date.now()),
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: aggressiveVibrate,
    timestamp: Date.now(),
    actions: [
      { action: "accept", title: "✓ Terima Pesanan" },
      { action: "view", title: "Buka Detail" }
    ],
    data: payload.data || { url: "/merchant-app/#pesanan" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
