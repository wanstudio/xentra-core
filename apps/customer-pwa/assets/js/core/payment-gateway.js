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

  // Hanya provider yang aktif yang dipakai. Provider yang tidak aktif tidak boleh
  // memblokir yang aktif, dan tidak boleh diminta kredensialnya.
  var ONLINE_PROVIDERS = ['midtrans', 'doku'];
  var DEFAULT_PROVIDER = 'midtrans';

  // Satu tempat yang tahu nama tiap provider. Halaman tidak menuliskan nama provider
  // sendiri, jadi menambah provider baru tidak perlu menyentuh checkout/order-received.
  // `channels` adalah daftar kanal yang ditawarkan provider itu, untuk label panjang.
  var PROVIDERS = {
    midtrans: { name: 'Midtrans', channels: 'Midtrans / QRIS' },
    doku: { name: 'DOKU', channels: 'DOKU' }
  };

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

  // Provider yang sedang aktif menurut konfigurasi. Selama konfigurasi belum
  // termuat, jawabannya 'midtrans' — sama dengan perilaku server untuk config lama.
  function activeProvider() {
    var p = gatewayConfig && gatewayConfig.active_provider;
    return (p && ONLINE_PROVIDERS.indexOf(p) !== -1) ? p : DEFAULT_PROVIDER;
  }

  function isOnlineMethod(method) {
    return ONLINE_PROVIDERS.indexOf(String(method || '').toLowerCase()) !== -1;
  }

  /**
   * Label pembayaran online untuk SATU pesanan.
   *
   * Mengikuti provider yang memproses pesanan itu, bukan provider yang kebetulan
   * sedang aktif. Dipakai halaman supaya tidak ada nama provider yang ditulis tangan
   * di sana.
   */
  function onlineLabel(method, withChannels) {
    var info = PROVIDERS[String(method || '').toLowerCase()];
    return 'Online Pay (' + (withChannels ? info.channels : info.name) + ')';
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

    return loadConfig().then(function () {
      var provider = activeProvider();

      // DOKU berdiri sendiri: halaman pembayaran milik gateway. Tidak memuat
      // Snap.js, tidak menyentuh window.snap, dan tidak meminta kredensial Midtrans.
      if (provider === 'doku') {
        if (!redirectUrl) throw new Error('DOKU_REDIRECT_MISSING');
        window.location.href = redirectUrl;
        return { opened: 'redirect', provider: provider };
      }

      // Midtrans memakai Snap. Hanya di jalur ini kredensial Midtrans dibutuhkan.
      if (!snapToken) throw new Error('NO_PAYMENT_INSTRUCTION');
      return loadSnap().then(function (snap) {
        snap.pay(snapToken, {
          onSuccess: handlers.onSuccess,
          onPending: handlers.onPending,
          onError: handlers.onError,
          onClose: handlers.onClose
        });
        return { opened: 'snap', provider: provider };
      });
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
    if (code === 'NO_PAYMENT_INSTRUCTION' || code === 'DOKU_REDIRECT_MISSING') {
      return 'Tidak ada instruksi pembayaran untuk pesanan ini. Hubungi cabang.';
    }
    return 'Pembayaran tidak dapat dibuka. Silakan coba lagi.';
  }

  window.Xentra = window.Xentra || {};
  window.Xentra.PaymentGateway = {
    loadConfig: loadConfig,
    ensureSnap: loadSnap,
    pay: pay,
    messageFor: messageFor,
    // Dipakai checkout & order-received supaya keduanya tidak menebak sendiri
    // provider mana yang aktif (dulu keduanya menulis 'midtrans' langsung).
    activeProvider: activeProvider,
    isOnlineMethod: isOnlineMethod,
    onlineLabel: onlineLabel,
    onlineMethod: activeProvider
  };
})();
