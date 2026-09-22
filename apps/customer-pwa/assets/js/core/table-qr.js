/**
 * Scanner QR meja — dipakai bersama oleh Home dan Checkout.
 *
 * checkout.js di-lazy-load (ROUTE_ONLY), jadi scanner tidak bisa tinggal di sana:
 * tombol scan di Home butuh modul yang sudah dimuat sejak awal. Modul ini hanya
 * mengurus kamera dan pembacaan QR; apa yang dilakukan dengan hasilnya diserahkan
 * ke pemanggil lewat callback — satu jalur kamera, dipakai dua tempat.
 */
(function () {
  'use strict';

  var onToken = null;

  // ── Scanner QR meja (di dalam aplikasi) ──
  // Jalur utama tetap kamera bawaan HP. Scanner ini untuk konsumen yang ingin
  // langsung dari sini, DAN untuk HP yang kameranya tidak bisa membaca QR:
  // kalau browser tidak punya detektor barcode atau kamera ditolak, konsumen
  // diberi jalan memasukkan kode meja secara manual. Jadi tidak ada yang buntu.
  var tableQrScanner = { stream: null, raf: null };

  function extractMejaToken(text) {
    if (!text) return null;
    var url = /[?&]meja=([^&\s]+)/.exec(String(text));
    if (url) return decodeURIComponent(url[1]);
    var raw = String(text).trim();
    if (/^qr_[A-Za-z0-9_-]+$/.test(raw)) return raw;
    // Kode yang ditulis di kartu meja: "meja7" (juga menerima "7" atau "Meja 7").
    if (/^(meja\s*)?\d{1,4}$/i.test(raw)) return raw.toLowerCase().replace(/\s+/g, '');
    return null;
  }

  function stopTableQrScanner() {
    if (tableQrScanner.raf) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(tableQrScanner.raf);
      tableQrScanner.raf = null;
    }
    if (tableQrScanner.stream) {
      try {
        tableQrScanner.stream.getTracks().forEach(function (t) { t.stop(); });
      } catch (e) { /* kamera sudah tertutup */ }
      tableQrScanner.stream = null;
    }
    var overlay = document.getElementById('x-table-qr-scanner');
    if (overlay) overlay.remove();
  }

  function handleScannedTable(token) {
    if (!token) return;
    stopTableQrScanner();
    if (typeof onToken === 'function') onToken(token);
  }

  function openTableQrScanner() {
    stopTableQrScanner();

    var hasDetector = (typeof window.BarcodeDetector === 'function');
    var hasCamera = !!(window.navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    var canScan = hasDetector && hasCamera;
    var reason = hasDetector
      ? 'Kamera tidak bisa dipakai. Tulis saja kode yang tertulis di bawah QR meja, atau minta bantuan petugas.'
      : 'HP ini tidak bisa scan langsung. Coba buka kamera HP, arahkan ke QR meja, lalu ikuti tautannya. Kalau tetap tidak bisa, minta bantuan petugas.';

    // Harus DI ATAS bottom sheet yang sedang terbuka (pilih tipe pembelian),
    // karena scanner ini dipanggil dari dalam sheet itu.
    var overlay = document.createElement('div');
    overlay.id = 'x-table-qr-scanner';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.92);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML =
      '<div style="background:#fff;border-radius:16px;padding:18px;max-width:360px;width:100%;text-align:center;">' +
      '  <h3 style="margin:0 0 6px;font-size:16px;font-weight:800;">Dine-in, Scan QR di Meja</h3>' +
      '  <p style="margin:0 0 12px;font-size:12px;color:#64748b;">Arahkan kamera ke QR yang ada di meja.</p>' +
      '  <div id="x-qr-video-wrap" style="position:relative;width:100%;height:0;padding-bottom:100%;background:#0f172a;border-radius:14px;overflow:hidden;margin:0 auto 12px;display:' + (canScan ? 'block' : 'none') + ';">' +
      '    <video id="x-qr-video" playsinline autoplay muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;"></video>' +
      '    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">' +
      '      <div style="width:62%;height:62%;border:3px solid rgba(255,255,255,.95);border-radius:18px;box-shadow:0 0 0 9999px rgba(15,23,42,.35);"></div>' +
      '    </div>' +
      '  </div>' +
      '  <div id="x-qr-notice" style="font-size:11.5px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:8px;margin-bottom:12px;display:' + (canScan ? 'none' : 'block') + ';">' + reason + '</div>' +
      '  <div style="font-size:11.5px;color:#6b7280;margin-bottom:6px;">Tidak bisa scan? Tulis kode yang tertulis di bawah QR meja:</div>' +
      '  <input id="x-qr-manual" type="text" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;font-size:13px;font-family:inherit;margin-bottom:10px;">' +
      '  <button type="button" id="x-qr-manual-submit" style="width:100%;border:0;background:var(--x-primary);color:var(--x-primary-text,#111);font-weight:800;font-size:14px;padding:12px;border-radius:999px;cursor:pointer;margin-bottom:8px;font-family:inherit;">Gunakan kode ini</button>' +
      '  <button type="button" id="x-qr-close" style="display:block;width:100%;height:44px;font-size:14px;font-weight:700;border:2px solid #e5e7eb;border-radius:24px;cursor:pointer;background:#fff;color:#6b7280;font-family:inherit;">Tutup</button>' +
      '</div>';
    document.body.appendChild(overlay);

    function setNotice(msg) {
      var notice = document.getElementById('x-qr-notice');
      if (notice) { notice.textContent = msg; notice.style.display = 'block'; }
      var wrap = document.getElementById('x-qr-video-wrap');
      if (wrap) wrap.style.display = 'none';
    }

    overlay.querySelector('#x-qr-close').onclick = function () { stopTableQrScanner(); };

    overlay.querySelector('#x-qr-manual-submit').onclick = function () {
      var input = document.getElementById('x-qr-manual');
      var token = extractMejaToken(input ? input.value : '');
      if (!token) {
        setNotice('Kode tidak cocok. Coba periksa lagi, atau minta bantuan petugas.');
        return;
      }
      handleScannedTable(token);
    };

    if (!canScan) return;

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (stream) {
      tableQrScanner.stream = stream;

      var video = document.getElementById('x-qr-video');
      if (!video) { stopTableQrScanner(); return; }
      video.srcObject = stream;
      if (video.play) { var started = video.play(); if (started && started.catch) started.catch(function () {}); }

      var detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      var tick = function () {
        detector.detect(video).then(function (codes) {
          var text = codes && codes.length ? (codes[0].rawValue || '') : '';
          var token = extractMejaToken(text);
          if (token) { handleScannedTable(token); return; }
          tableQrScanner.raf = requestAnimationFrame(tick);
        }).catch(function () {
          tableQrScanner.raf = requestAnimationFrame(tick);
        });
      };
      tableQrScanner.raf = requestAnimationFrame(tick);
    }).catch(function () {
      setNotice('Kamera tidak bisa dipakai. Tulis saja kode yang tertulis di bawah QR meja, atau minta bantuan petugas.');
    });
  }

  // Kode meja hanya unik per cabang, jadi cabang yang sedang dipakai harus ikut
  // dikirim — supaya "meja7" tidak nyasar ke Meja 7 di cabang lain.
  function claimBranchId() {
    if (currentBranchId && currentBranchId !== '__unassigned__') return currentBranchId;
    if (state.matchedBranch && state.matchedBranch.id) return state.matchedBranch.id;
    return null;
  }

  // Dipanggil setelah tamu berhasil masuk: klaim meja yang discan sebelumnya.

  window.Xentra = window.Xentra || {};
  window.Xentra.TableQr = {
    open: function (handler) {
      onToken = typeof handler === 'function' ? handler : null;
      openTableQrScanner();
    },
    close: stopTableQrScanner,
    extractToken: extractMejaToken
  };
})();
