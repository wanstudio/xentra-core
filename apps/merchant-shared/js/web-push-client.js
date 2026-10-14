/**
 * XENTRA WEB PUSH CLIENT
 *
 * Automatically registers the device with the server's VAPID Push Service
 * so order alerts & vibrations arrive when the phone is locked, asleep, or browser closed.
 */
(function () {
  'use strict';

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = window.atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function registerWebPushSubscription() {
    // In Native Android App, native Java OrderMonitorService handles notifications!
    // Unsubscribe from browser web push so Google Chrome never intercepts notifications
    if (window.IS_NATIVE_APP) {
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
          var r = await navigator.serviceWorker.ready;
          var sub = await r.pushManager.getSubscription();
          if (sub) await sub.unsubscribe();
        } catch (_) {}
      }
      try {
        var S_native = window.XentraShared;
        var apiBase_native = S_native ? S_native.API_BASE : '/api/v1';
        var hdrs_native = S_native ? S_native.getAuthHeaders() : {};
        fetch(apiBase_native + '/notifications/unsubscribe-all', {
          method: 'POST',
          headers: hdrs_native
        }).catch(function () {});
      } catch (_) {}
      return false;
    }

    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return false;
    }
    if (Notification.permission !== 'granted') {
      return false;
    }

    try {
      var S = window.XentraShared;
      var API_BASE = S ? S.API_BASE : '/api/v1';
      var headers = S ? S.getAuthHeaders() : {};

      // 1. Fetch server's VAPID public key
      var keyRes = await fetch(API_BASE + '/notifications/vapid-public-key');
      var keyData = await keyRes.json();
      if (!keyData || !keyData.success || !keyData.public_key) {
        return false;
      }

      var reg = await navigator.serviceWorker.ready;
      var existingSub = await reg.pushManager.getSubscription();

      var subscription = existingSub;
      if (!subscription) {
        var appServerKey = urlBase64ToUint8Array(keyData.public_key);
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey
        });
      }

      if (!subscription) return false;

      // 2. Send subscription to backend
      var subJson = subscription.toJSON();
      await fetch(API_BASE + '/notifications/subscribe', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
        body: JSON.stringify({ subscription: subJson })
      });

      return true;
    } catch (err) {
      console.warn('[XentraWebPush] Registration error:', err && err.message);
      return false;
    }
  }

  async function requestPermissionAndSubscribe() {
    if (!('Notification' in window)) return false;
    try {
      var perm = await Notification.requestPermission();
      if (perm === 'granted') {
        await registerWebPushSubscription();
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  window.XentraWebPush = {
    register: registerWebPushSubscription,
    requestAndSubscribe: requestPermissionAndSubscribe
  };

  // Auto-sync subscription if permission is already granted and user is logged in
  if (typeof window !== 'undefined') {
    window.addEventListener('load', function () {
      setTimeout(function () {
        if ('Notification' in window && Notification.permission === 'granted') {
          registerWebPushSubscription();
        }
      }, 2500);
    });
  }
})();
