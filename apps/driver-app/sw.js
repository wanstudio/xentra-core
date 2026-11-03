const CACHE_NAME = 'xentra-driver-shell-v20261031_v31';
const APP_SHELL = [
  '/driver/',
  '/driver/manifest.json',
  '/driver/assets/icons/icon-192.png',
  '/driver/assets/icons/icon-512.png',
  '/driver/assets/audio/tugas-baru.mp3',
  '/driver/assets/audio/ada-pesanan-baru.mp3',
  '/merchant-shared/fonts/plus-jakarta-sans.css',
  '/merchant-shared/css/shared.css?v=1.0.3',
  '/merchant-shared/js/qrcode.js?v=1.0.0',
  '/merchant-shared/js/crop-editor.js?v=1.0.2',
  '/merchant-shared/js/audio-alerts.js?v=1.0.6',
  '/merchant-shared/js/web-push-client.js?v=1.0.1',
  '/merchant-shared/js/ops-chat.js?v=2.0.0',
  '/driver/assets/css/driver.css?v=20261031_v31',
  '/driver/assets/js/driver-app.js?v=20261031_v31'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(() => {})
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => {
        if (key !== CACHE_NAME) {
          console.log('[SW-Driver] Purging old cache:', key);
          return caches.delete(key);
        }
      })
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && (event.data.action === 'skipWaiting' || event.data.action === 'clear-cache')) {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
      self.skipWaiting();
    });
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never cache API or Auth requests
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  const isDriverScope = url.pathname.startsWith('/driver') ||
    url.hostname.startsWith('driver.') ||
    url.hostname.startsWith('kurir.');

  if (!isDriverScope) return;

  // Network-First with cache fallback for fresh UI & offline resilience
  event.respondWith(
    fetch(request, { cache: 'no-cache' }).then(response => {
      if (response && response.status === 200) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request).then(cached => cached || caches.match('/driver/')))
  );
});

// Notification Click & Quick Action Buttons (Heads-up floating banner actions)
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var orderId = data.orderId;
  var action = event.action;

  // Direct action: [✓ Terima Tugas] clicked directly from floating notification banner
  if (action === 'accept' && orderId) {
    var reqHeaders = { 'Content-Type': 'application/json' };
    if (data.token) reqHeaders['Authorization'] = 'Bearer ' + data.token;

    event.waitUntil(
      fetch('/api/v1/driver/tasks/' + encodeURIComponent(orderId) + '/accept', {
        method: 'POST',
        headers: reqHeaders
      })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return self.registration.showNotification('✅ Tugas Pengantaran Diterima', {
            body: 'Tugas #' + (data.orderNumber || orderId) + ' berhasil diterima. Silakan ambil pesanan di resto.',
            icon: '/driver/assets/icons/icon-192.png',
            badge: '/driver/assets/icons/icon-192.png',
            tag: 'driver-task-accepted-' + orderId,
            silent: true
          });
        })
        .then(function () {
          return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        })
        .then(function (clients) {
          var focused = false;
          clients.forEach(function (client) {
            client.postMessage({ type: 'DRIVER_TASK_ACCEPTED_FROM_NOTIFICATION', orderId: orderId });
            if (!focused && 'focus' in client) {
              focused = true;
              client.focus();
            }
          });
          if (!focused && self.clients.openWindow) {
            return self.clients.openWindow(data.url || ('/driver/?order_id=' + encodeURIComponent(orderId)));
          }
        })
        .catch(function () {
          // If token was not in push payload (e.g. background Web Push), open window & let client accept/focus
          return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
            for (var i = 0; i < clientList.length; i++) {
              var client = clientList[i];
              if ('focus' in client) {
                client.postMessage({ type: 'NAVIGATE_TO_DRIVER_TASK', orderId: orderId, autoAccept: true });
                return client.focus();
              }
            }
            if (self.clients.openWindow) {
              return self.clients.openWindow('/driver/?order_id=' + encodeURIComponent(orderId) + '&auto_accept=1');
            }
          });
        })
    );
    return;
  }

  // Default action: tap on notification body or [Buka Detail] button
  var targetUrl = data.url || (orderId ? ('/driver/?order_id=' + encodeURIComponent(orderId)) : '/driver/');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url && (client.url.includes('/driver') || client.url.includes('driver.') || client.url.includes('kurir.')) && 'focus' in client) {
          client.postMessage({ type: 'NAVIGATE_TO_DRIVER_TASK', orderId: orderId });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// Incoming Web Push Notifications (wakes device & plays OS sound + heads-up banner when app is closed)
self.addEventListener('push', function (event) {
  var payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_) {
      payload = { title: '🛵 Tugas Antar Baru!', body: event.data.text() };
    }
  }
  var title = payload.title || '🛵 Tugas Antar Baru!';
  var aggressiveVibrate = [500, 250, 500, 250, 1000, 250, 1000];
  var data = payload.data || {};
  if (!data.url) {
    data.url = payload.url || (data.orderId ? ('/driver/?order_id=' + encodeURIComponent(data.orderId)) : '/driver/');
  }

  var options = {
    body: payload.body || 'Ada tugas pengantaran baru menunggu konfirmasi Anda.',
    icon: payload.icon || '/driver/assets/icons/icon-192.png',
    badge: payload.badge || '/driver/assets/icons/icon-192.png',
    tag: payload.tag || ('driver-task-' + (data.orderId || Date.now())),
    renotify: true,
    requireInteraction: true,
    silent: false, // Play device notification ringtone + vibrate when app is closed!
    vibrate: aggressiveVibrate,
    timestamp: Date.now(),
    actions: [
      { action: 'accept', title: '✓ Terima Tugas' },
      { action: 'view', title: '🛵 Buka Detail' }
    ],
    data: data
  };

  event.waitUntil(
    self.registration.showNotification(title, options).then(function () {
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    }).then(function (clients) {
      if (clients && clients.length) {
        clients.forEach(function (client) {
          client.postMessage({ type: 'NEW_DRIVER_TASK_PUSH_RECEIVED', payload: payload });
        });
      }
    }).catch(function (err) {
      console.warn('[SW-Driver Push Warning]:', err);
    })
  );
});
