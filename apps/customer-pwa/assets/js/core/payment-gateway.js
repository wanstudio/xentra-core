/**
 * Jalur ke payment gateway (customer PWA).
 *
 * Halaman pembayaran dulu memanggil `window.snap.pay()` langsung, padahal Snap.js
 * TIDAK PERNAH dimuat di PWA ini. Akibatnya `window.snap` selalu kosong dan tombol
 * "Bayar Sekarang" selalu jatuh ke pesan "Gateway pembayaran sedang dimuat" —
 * pesanan tidak pernah bisa dibayar.
 *
 * Modul ini yang mengurus jalurnya:
 *   1. mengambil konfigurasi gateway yang boleh diketahui browser (kunci publishable),
 *   2. memuat Snap.js dengan kunci itu saat memang dipakai,
 *   3. mengarahkan ke halaman pembayaran DOKU kalau gatewaynya DOKU.
 *
 * Server key TIDAK PERNAH ada di sini — hanya client key, yang memang publishable.
 */
(function () {
  'use strict';

  var SNAP_ID = 'x-snap-script';
  var DEFAULT_SNAP_URL = 'https://app.sandbox.midtrans.com/snap/snap.js';

  var gatewayConfig = null;
  var configPromise = null;
  var snapPromise = null;

  function api() { return window.Xentra && window.Xentra.API; }

  function loadConfig() {
    if (configPromise) return configPromise;
    var API = api();
    if (!API || typeof API.get !== 'function') return Promise.resolve(null);
    configPromise = API.get('/payment/config').then(function (res) {
      gatewayConfig = (res && res.payment_gateway) ? res.payment_gateway : null;
      return gatewayConfig;
    }).catch(function () {
      // Gagal mengambil konfigurasi bukan alasan untuk menyerah: biarkan pemanggil
      // memutuskan, dan jangan mengunci hasil gagal itu sebagai jawaban selamanya.
      configPromise = null;
      return null;
    });
    return configPromise;
  }

  // Snap.js dimuat sekali, dengan client key dari konfigurasi brand/cabang.
  function loadSnap() {
    if (window.snap && window.snap.pay) return Promise.resolve(window.snap);
    if (snapPromise) return snapPromise;

    snapPromise = loadConfig().then(function (cfg) {
      var clientKey = cfg && cfg.midtrans_client_key ? cfg.midtrans_client_key : '';
      if (!clientKey) {
        snapPromise = null;
        return Promise.reject(new Error('MIDTRANS_CLIENT_KEY_MISSING'));
      }
      return new Promise(function (resolve, reject) {
        var existing = document.getElementById(SNAP_ID);
        if (existing) existing.parentNode.removeChild(existing);

        var script = document.createElement('script');
        script.id = SNAP_ID;
        script.src = (cfg && cfg.snap_script_url) ? cfg.snap_script_url : DEFAULT_SNAP_URL;
        script.setAttribute('data-client-key', clientKey);
        script.onload = function () {
          if (window.snap && window.snap.pay) resolve(window.snap);
          else reject(new Error('SNAP_UNAVAILABLE'));
        };
        script.onerror = function () {
          snapPromise = null;
          reject(new Error('SNAP_LOAD_FAILED'));
        };
        document.head.appendChild(script);
      });
    });

    return snapPromise;
  }

  /**
   * Bayar pesanan yang sudah punya token/tautan dari server.
   *
   * Midtrans memakai Snap (butuh Snap.js); DOKU memakai halaman pembayarannya
   * sendiri, jadi cukup diarahkan ke sana. Pemanggil tidak perlu tahu bedanya.
   */
  function pay(options) {
    var opts = options || {};
    var snapToken = opts.snapToken || null;
    var redirectUrl = opts.redirectUrl || null;
    var handlers = opts.handlers || {};

    return loadConfig().then(function (cfg) {
      var provider = (cfg && cfg.active_provider) || 'midtrans';

      // DOKU: halaman pembayaran milik gateway, tidak ada Snap di sini.
      if (redirectUrl && provider === 'doku') {
        window.location.href = redirectUrl;
        return { opened: 'redirect' };
      }

      if (snapToken) {
        return loadSnap().then(function (snap) {
          snap.pay(snapToken, {
            onSuccess: handlers.onSuccess,
            onPending: handlers.onPending,
            onError: handlers.onError,
            onClose: handlers.onClose
          });
          return { opened: 'snap' };
        }).catch(function (err) {
          throw err;
        });
      }

      // Tautan DOKU ada tapi provider aktif bukan DOKU: tetap pakai tautannya,
      // karena tautan itu memang dibuat oleh gateway yang memproses pesanan ini.
      if (redirectUrl) {
        window.location.href = redirectUrl;
        return { opened: 'redirect' };
      }

      throw new Error('NO_PAYMENT_INSTRUCTION');
    });
  }

  function messageFor(err) {
    var code = err && err.message;
    if (code === 'MIDTRANS_CLIENT_KEY_MISSING') {
      return 'Pembayaran online belum dikonfigurasi. Hubungi cabang untuk menyelesaikan pembayaran.';
    }
    if (code === 'SNAP_LOAD_FAILED' || code === 'SNAP_UNAVAILABLE') {
      return 'Gagal memuat halaman pembayaran. Periksa koneksi lalu coba lagi.';
    }
    if (code === 'NO_PAYMENT_INSTRUCTION') {
      return 'Tidak ada instruksi pembayaran untuk pesanan ini. Hubungi cabang.';
    }
    return 'Pembayaran tidak dapat dibuka. Silakan coba lagi.';
  }

  window.Xentra = window.Xentra || {};
  window.Xentra.PaymentGateway = {
    loadConfig: loadConfig,
    ensureSnap: loadSnap,
    pay: pay,
    messageFor: messageFor
  };
})();
