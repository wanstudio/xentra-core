/**
 * Xentra Customer PWA — Order Received & Branch Acceptance Waiting Screen
 * P7.1–P7.7: Branch Acceptance lifecycle display.
 *
 * Authority rule: ALL order state comes from server (GET /orders/:id).
 * The client DISPLAYS, POLLS, and NAVIGATES. It NEVER mutates order state.
 * The 3-minute countdown is a UX timer anchored to the server-supplied
 * acceptance_deadline_at — reaching zero triggers a server fetch, not a
 * state mutation.
 *
 * P7.4 Refresh/re-entry: mount() always fetches from server; no local
 * variable or timer instance is the source of truth.
 */
(function () {
  'use strict';

  var API = window.Xentra.API;
  var Store = window.Xentra.Store;
  var UI = window.Xentra.UI;
  var Router = window.Xentra.Router;

  var currentOrderId = null;
  var targetContainer = null;
  var pollingTimer = null;
  var countdownTimer = null;

  // P7.13 Stale-response guard: increment on each fetch; discard responses
  // whose sequence number is older than the current one.
  var fetchSeq = 0;

  // P7.3 Platform policy: 3 minutes (matches server ACCEPTANCE_TIMEOUT_SECONDS = 180)
  var ACCEPTANCE_TIMEOUT_SECONDS = 180;

  // P8.6 Terminal states — polling stops unconditionally here
  var TERMINAL_STATES = { rejected: 1, timeout: 1, cancelled: 1, completed: 1, refunded: 1 };

  // ─── P7.4 Entry point ─────────────────────────────────────────────────────
  // Always fetches from server; never relies on window memory or local state.
  function mount(container, orderId) {
    targetContainer = container
      || document.getElementById('x-order-content')
      || document.getElementById('xentra-order-view');
    currentOrderId = orderId
      || (Router && Router.getOrderIdFromUrl())
      || getOrderIdFromLocation();

    // Clear local cart upon reaching confirmation screen
    try {
      Store.clearCart();
      localStorage.removeItem('xentra_checkout_draft');
      localStorage.removeItem('xentra_order_note');
    } catch (_) {}

    if (!currentOrderId) {
      renderNotFound('Nomor pesanan tidak disertakan.');
      return;
    }

    renderLoading();
    loadOrder(currentOrderId);
  }

  function getOrderIdFromLocation() {
    var hash = window.location.hash || '';
    var matchHash = hash.match(/#order-received[\\/=]([a-zA-Z0-9_-]+)/);
    if (matchHash && matchHash[1]) return matchHash[1];

    var path = window.location.pathname;
    var match = path.match(/\/order-received\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) return match[1];

    var params = new URLSearchParams(window.location.search);
    return params.get('order_id') || params.get('id') || null;
  }

  function stopTimers() {
    if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  function renderLoading() {
    if (!targetContainer) return;
    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div style="padding:60px 20px;text-align:center;color:#6b7280;font-size:15px;font-weight:600;">' +
      '  <div style="width:40px;height:40px;border:3px solid #e5e7eb;border-top-color:var(--x-primary);border-radius:50%;margin:0 auto 16px;animation:spin 1s linear infinite;"></div>' +
      '  Memuat status pesanan...' +
      '</div>';
  }

  // P7.2 Server-authoritative fetch with stale-response guard
  function loadOrder(id) {
    var seq = ++fetchSeq;
    API.get('/orders/' + encodeURIComponent(id))
      .then(function (data) {
        if (seq !== fetchSeq) return; // P7.13: stale — discard
        if (data.success && data.order) {
          stopTimers();
          renderOrder(data);
          var payStatus = (data.payment && data.payment.payment_status) || data.order.payment_status || 'pending';
          schedulePolling(data.order.status, payStatus, data.order.acceptance_deadline_at);
        } else {
          renderNotFound(data.error || 'Pesanan tidak ditemukan.');
        }
      })
      .catch(function (err) {
        if (seq !== fetchSeq) return;
        renderNotFound('Gagal memuat status pesanan: ' + err.message);
      });
  }

  function renderNotFound(msg) {
    if (!targetContainer) return;
    stopTimers();
    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div class="x-order-status-container" style="padding:40px 18px;text-align:center;">' +
      '  <div style="font-size:48px;margin-bottom:12px;">⚠️</div>' +
      '  <h2 style="font-size:18px;font-weight:800;color:#111;margin-bottom:8px;">Pesanan Tidak Ditemukan</h2>' +
      '  <p style="color:#6b7280;font-size:14px;line-height:1.5;margin-bottom:24px;">' + UI.escape(msg) + '</p>' +
      '  <button type="button" id="x-btn-back-home" style="display:inline-block;padding:12px 28px;font-size:14px;border:none;border-radius:24px;cursor:pointer;background:#d6ff00;color:#111;font-weight:800;">Kembali ke Menu</button>' +
      '</div>';

    var btn = document.getElementById('x-btn-back-home');
    if (btn && Router) btn.onclick = function () { Router.navigate('home'); };
  }

  // ─── Top-level dispatcher ─────────────────────────────────────────────────
  function renderOrder(data) {
    if (!targetContainer) return;
    var order = data.order;
    var payment = data.payment || {};
    var status = order.status;
    var payMethod = (order.payment_method || payment.payment_method || 'cash').toLowerCase();
    var payStatus = (payment.payment_status || order.payment_status || 'pending').toLowerCase();
    var isOnline = payMethod === 'midtrans';

    // P6.5 PAYMENT FAILURE: Online payment cancelled, denied, or expired
    if (isOnline && (payStatus === 'deny' || payStatus === 'cancel' || payStatus === 'expire')) {
      renderPaymentFailed(data, payStatus);
      return;
    }

    // P6.3 PAYMENT PENDING / PROCESSING: Online payment has not settled yet
    if (isOnline && (payStatus === 'pending' || payStatus === 'reconciliation_pending')) {
      if (status === 'cancelled') {
        renderCancelled(order);
        return;
      }
      renderPaymentPending(data);
      return;
    }

    // P6.4 / P6.6 PAYMENT SUCCESS -> AWAITING_BRANCH_ACCEPTANCE
    // When payment is settled (or cash), and order status is 'pending',
    // the order is awaiting branch confirmation.
    if (status === 'pending') {
      renderWaiting(data);
      return;
    }

    // P7.6 REJECTED
    if (status === 'rejected') {
      renderRejected(order, data.logs || []);
      return;
    }

    // P7.7 TIMEOUT
    if (status === 'timeout') {
      renderTimeout(order);
      return;
    }

    // Cancelled (customer-initiated)
    if (status === 'cancelled') {
      renderCancelled(order);
      return;
    }

    // P7.5 ACCEPTED and beyond (confirmed/preparing/ready/out_for_delivery/completed)
    renderFulfillmentOrder(data);
  }

  // ─── P6.3 PAYMENT PENDING SURFACE ─────────────────────────────────────────
  function renderPaymentPending(data) {
    if (!targetContainer) return;
    var order = data.order;
    var payment = data.payment || {};
    var payStatus = (payment.payment_status || order.payment_status || 'pending').toLowerCase();
    var branchName = order.branch_name || 'Cabang';
    var orderNumber = order.order_number || ('XTR-' + order.id);
    var snapToken = payment.snap_token || order.snap_token || null;
    var isRecon = payStatus === 'reconciliation_pending';

    var headerTitle = isRecon ? 'Memverifikasi Pembayaran' : 'Menunggu Pembayaran';
    var headerDesc = isRecon
      ? 'Pembayaran online sedang diverifikasi dengan sistem gateway. Mohon tunggu sejenak.'
      : 'Selesaikan pembayaran online sebesar <strong>' + UI.money(order.grand_total || 0) + '</strong> agar pesanan dapat diteruskan ke cabang <strong>' + UI.escape(branchName) + '</strong>.';

    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div id="x-payment-pending-screen" class="x-payment-pending-screen" style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +
      '  <div style="background:#fff;padding:28px 18px 22px;margin-bottom:12px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      '    <div style="width:56px;height:56px;border-radius:50%;background:#e0f2fe;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:28px;">💳</div>' +
      '    <h1 id="x-pay-pending-title" style="font-size:20px;font-weight:800;color:#111;margin:0 0 8px;">' + headerTitle + '</h1>' +
      '    <p style="font-size:13px;color:#6b7280;margin:0 0 18px;line-height:1.5;">' + headerDesc + '</p>' +
      '    <div style="background:#fef9c3;border:1px solid #fde047;border-radius:12px;padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;justify-content:center;gap:8px;">' +
      '      <span style="font-size:14px;">' + (isRecon ? '🔄' : '⏱️') + '</span>' +
      '      <span id="x-pay-status-label" style="font-size:13px;font-weight:700;color:#854d0e;">' + (isRecon ? 'Verifikasi Gateway Sedang Berjalan' : 'Status: Menunggu Pembayaran') + '</span>' +
      '    </div>' +
      '    <div style="background:#f8f9fa;border-radius:14px;padding:12px 16px;text-align:left;display:flex;flex-direction:column;gap:8px;">' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Nomor Pesanan</span><strong style="color:#111;">' + UI.escape(orderNumber) + '</strong></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Cabang</span><span style="font-weight:700;color:#111;">' + UI.escape(branchName) + '</span></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Metode Pembayaran</span><span style="font-weight:700;color:#111;">Online Pay (Midtrans / QRIS)</span></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Total Tagihan</span><span style="font-weight:700;color:#111;">' + UI.money(order.grand_total || 0) + '</span></div>' +
      '    </div>' +
      '  </div>' +
      '  <div style="padding:0 14px;display:flex;flex-direction:column;gap:10px;">' +
      (snapToken ? '    <button type="button" id="x-btn-resume-pay" style="display:block;width:100%;height:48px;font-size:15px;font-weight:800;border:none;border-radius:24px;cursor:pointer;background:var(--x-primary);color:var(--x-primary-text);">Bayar Sekarang</button>' : '') +
      '    <button type="button" id="x-btn-cancel-pending" style="display:block;width:100%;height:44px;font-size:14px;font-weight:700;border:2px solid #e5e7eb;border-radius:24px;cursor:pointer;background:#fff;color:#6b7280;">Batalkan Pesanan</button>' +
      '  </div>' +
      '</div>';

    var resumeBtn = document.getElementById('x-btn-resume-pay');
    if (resumeBtn && snapToken) {
      resumeBtn.onclick = function () {
        if (window.snap && window.snap.pay) {
          window.snap.pay(snapToken, {
            onSuccess: function () { loadOrder(order.id); },
            onPending: function () { loadOrder(order.id); },
            onError: function () { loadOrder(order.id); },
            onClose: function () { loadOrder(order.id); }
          });
        } else {
          if (UI && UI.toast) UI.toast('Gateway pembayaran sedang dimuat, silakan coba lagi.');
        }
      };
    }

    var cancelBtn = document.getElementById('x-btn-cancel-pending');
    if (cancelBtn) cancelBtn.onclick = function () { confirmCancel(order.id); };
  }

  // ─── P6.5 PAYMENT FAILURE SURFACE ─────────────────────────────────────────
  function renderPaymentFailed(data, payStatus) {
    if (!targetContainer) return;
    stopTimers();
    var order = data.order;
    var orderNumber = order.order_number || ('XTR-' + order.id);
    var branchName = order.branch_name || 'Cabang';

    var failTitle = 'Pembayaran Gagal';
    var failDesc = 'Pembayaran tidak dapat diproses.';
    if (payStatus === 'expire') {
      failTitle = 'Waktu Pembayaran Habis';
      failDesc = 'Batas waktu pembayaran online telah berakhir. Pesanan otomatis dibatalkan.';
    } else if (payStatus === 'deny') {
      failTitle = 'Pembayaran Ditolak';
      failDesc = 'Pembayaran ditolak oleh penyedia pembayaran/bank. Saldo Anda tidak terpotong.';
    } else if (payStatus === 'cancel') {
      failTitle = 'Pembayaran Dibatalkan';
      failDesc = 'Transaksi pembayaran online telah dibatalkan.';
    }

    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div id="x-payment-failed-screen" class="x-payment-failed-screen" style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +
      '  <div style="background:#fff;padding:28px 18px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.06);margin-bottom:12px;">' +
      '    <div style="font-size:48px;margin-bottom:12px;">❌</div>' +
      '    <h1 id="x-pay-failed-title" style="font-size:20px;font-weight:800;color:#dc2626;margin:0 0 8px;">' + failTitle + '</h1>' +
      '    <p style="font-size:13px;color:#6b7280;margin:0 0 16px;line-height:1.5;">' + failDesc + '</p>' +
      '    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:12px 14px;font-size:13px;color:#dc2626;margin-bottom:16px;text-align:left;">' +
      '      Pesanan tidak diproses oleh cabang karena pembayaran belum berhasil.' +
      '    </div>' +
      '    <div style="background:#f8f9fa;border-radius:14px;padding:12px 16px;text-align:left;display:flex;flex-direction:column;gap:8px;">' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Nomor Pesanan</span><strong style="color:#111;">' + UI.escape(orderNumber) + '</strong></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Cabang</span><span style="font-weight:700;color:#111;">' + UI.escape(branchName) + '</span></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Total</span><span style="font-weight:700;color:#111;">' + UI.money(order.grand_total || 0) + '</span></div>' +
      '    </div>' +
      '  </div>' +
      '  <div style="padding:0 14px;">' +
      '    <button type="button" id="x-btn-pay-retry" style="display:block;width:100%;height:48px;font-size:15px;font-weight:800;border:none;border-radius:24px;cursor:pointer;background:var(--x-primary);color:var(--x-primary-text);">Pesan Lagi</button>' +
      '  </div>' +
      '</div>';

    var btn = document.getElementById('x-btn-pay-retry');
    if (btn && Router) btn.onclick = function () { Router.navigate('home'); };
  }

  // ─── P7.1 AWAITING BRANCH ACCEPTANCE SURFACE ─────────────────────────────
  function renderWaiting(data) {
    if (!targetContainer) return;
    var order = data.order;
    var payment = data.payment || {};
    var branchName = order.branch_name || 'Cabang';
    var orderNumber = order.order_number || ('XTR-' + order.id);
    var deadlineAt = order.acceptance_deadline_at || null;
    var payMethod = (order.payment_method || payment.payment_method || 'cash').toLowerCase();
    var isOnline = payMethod === 'midtrans';

    // P7.3 Derive seconds remaining from server-authoritative deadline
    var secsRemaining = ACCEPTANCE_TIMEOUT_SECONDS;
    if (deadlineAt) {
      var msRemaining = new Date(deadlineAt).getTime() - Date.now();
      secsRemaining = Math.max(0, Math.floor(msRemaining / 1000));
    }

    var payBadgeHtml = isOnline
      ? '<div id="x-badge-pay-confirmed" style="display:inline-flex;align-items:center;gap:6px;background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;margin-bottom:12px;">✓ Pembayaran Berhasil Dikonfirmasi</div>'
      : '<div id="x-badge-pay-cash" style="display:inline-flex;align-items:center;gap:6px;background:#f3f4f6;border:1px solid #e5e7eb;color:#374151;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;margin-bottom:12px;">💵 Pembayaran Tunai (COD)</div>';

    var waitingDesc = isOnline
      ? 'Pembayaran berhasil dikonfirmasi. Cabang <strong>' + UI.escape(branchName) + '</strong> sedang memproses konfirmasi penerimaan pesanan.'
      : 'Pesananmu sudah diterima sistem. Cabang <strong>' + UI.escape(branchName) + '</strong> sedang memproses konfirmasi penerimaan pesanan.';

    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div id="x-waiting-screen" style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +

      // Status Header Card
      '  <div style="background:#fff;padding:28px 18px 22px;margin-bottom:12px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      '    <div style="width:56px;height:56px;border-radius:50%;background:#fef9c3;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:28px;">⏳</div>' +
      payBadgeHtml +
      '    <h1 style="font-size:20px;font-weight:800;color:#111;margin:0 0 8px;">Menunggu Konfirmasi Cabang</h1>' +
      '    <p style="font-size:13px;color:#6b7280;margin:0 0 18px;line-height:1.5;">' + waitingDesc + '</p>' +

      // P7.3 Countdown — display only, never authoritative
      '    <div style="background:#fef9c3;border-radius:14px;padding:14px 16px;margin-bottom:16px;">' +
      '      <div style="font-size:12px;color:#92400e;font-weight:600;margin-bottom:4px;">Batas waktu konfirmasi cabang</div>' +
      '      <div id="x-acceptance-countdown" style="font-size:32px;font-weight:900;color:#92400e;font-variant-numeric:tabular-nums;">' + fmtCountdown(secsRemaining) + '</div>' +
      '      <div style="font-size:11px;color:#92400e;margin-top:4px;">Timer ini hanya tampilan. Status pesanan selalu dari server.</div>' +
      '    </div>' +

      // Order summary
      '    <div style="background:#f8f9fa;border-radius:14px;padding:12px 16px;text-align:left;display:flex;flex-direction:column;gap:8px;">' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Nomor Pesanan</span><strong style="color:#111;">' + UI.escape(orderNumber) + '</strong></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Cabang</span><span style="font-weight:700;color:#111;">' + UI.escape(branchName) + '</span></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Total</span><span style="font-weight:700;color:#111;">' + UI.money(order.grand_total || 0) + '</span></div>' +
      '    </div>' +
      '  </div>' +

      // Info card
      '  <div style="background:#fff;padding:18px;margin:0 14px 12px;border-radius:16px;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      '    <h2 style="font-size:15px;font-weight:800;margin:0 0 12px;color:#111;">Yang Terjadi Selanjutnya</h2>' +
      '    <div style="display:flex;flex-direction:column;gap:12px;">' +
      renderInfoStep('1', 'Menunggu Konfirmasi', 'Cabang ' + branchName + ' akan mengkonfirmasi pesanan dalam batas waktu yang ditentukan.') +
      renderInfoStep('2', 'Pesanan Diterima', 'Jika diterima, pesananmu langsung masuk ke dapur dan kamu dapat memantau statusnya.') +
      renderInfoStep('3', 'Jika Ditolak atau Timeout', 'Cabang dapat menolak atau tidak merespons. Kamu akan diberitahu dan pesanan tidak diproses.') +
      '    </div>' +
      '  </div>' +

      // Cancel button (only valid while pending — server enforces)
      '  <div style="padding:0 14px;">' +
      '    <button type="button" id="x-btn-cancel-order" style="display:block;width:100%;height:44px;font-size:14px;font-weight:700;border:2px solid #e5e7eb;border-radius:24px;cursor:pointer;background:#fff;color:#6b7280;">Batalkan Pesanan</button>' +
      '  </div>' +

      '</div>';

    var cancelBtn = document.getElementById('x-btn-cancel-order');
    if (cancelBtn) cancelBtn.onclick = function () { confirmCancel(order.id); };

    // P7.3 Start countdown anchored to server deadline
    startCountdown(secsRemaining, order.id);
  }

  function fmtCountdown(s) {
    var m = Math.floor(Math.max(0, s) / 60);
    var sec = Math.max(0, s) % 60;
    return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function renderInfoStep(num, title, desc) {
    return (
      '<div style="display:flex;align-items:flex-start;gap:10px;">' +
      '  <div style="width:24px;height:24px;border-radius:50%;background:#fef9c3;color:#92400e;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0;">' + num + '</div>' +
      '  <div>' +
      '    <div style="font-size:13px;font-weight:700;color:#111;">' + UI.escape(title) + '</div>' +
      '    <div style="font-size:12px;color:#6b7280;margin-top:2px;line-height:1.4;">' + UI.escape(desc) + '</div>' +
      '  </div>' +
      '</div>'
    );
  }

  // P7.3 UX countdown — purely presentational.
  // When it reaches zero: fetch server state. NEVER mutate order state.
  function startCountdown(initialSeconds, orderId) {
    if (countdownTimer) clearInterval(countdownTimer);
    var secs = initialSeconds;
    countdownTimer = setInterval(function () {
      secs = Math.max(0, secs - 1);
      var el = document.getElementById('x-acceptance-countdown');
      if (el) el.textContent = fmtCountdown(secs);
      if (secs <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        // P7.3: timer at zero → fetch authoritative state; never assume timeout
        loadOrder(orderId);
      }
    }, 1000);
  }

  // ─── P7.6 REJECTED STATE ─────────────────────────────────────────────────
  function renderRejected(order, logs) {
    if (!targetContainer) return;
    var orderNumber = order.order_number || ('XTR-' + order.id);
    var branchName = order.branch_name || 'Cabang';

    // Extract rejection reason from audit log (server-provided, never fabricated)
    var rejectionNote = '';
    for (var i = logs.length - 1; i >= 0; i--) {
      if (logs[i].new_status === 'rejected' && logs[i].note) {
        rejectionNote = String(logs[i].note).replace(/^\[REJECT by [^\]]+\]\s*/, '').trim();
        break;
      }
    }

    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +
      '  <div style="background:#fff;padding:28px 18px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.06);margin-bottom:12px;">' +
      '    <div style="font-size:48px;margin-bottom:12px;">❌</div>' +
      '    <h1 style="font-size:20px;font-weight:800;color:#dc2626;margin:0 0 8px;">Pesanan Ditolak</h1>' +
      '    <p style="font-size:13px;color:#6b7280;margin:0 0 16px;line-height:1.5;">Cabang <strong>' + UI.escape(branchName) + '</strong> tidak dapat memproses pesananmu saat ini.</p>' +
      (rejectionNote ? '    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:12px 14px;font-size:13px;color:#dc2626;margin-bottom:16px;text-align:left;">' + UI.escape(rejectionNote) + '</div>' : '') +
      '    <div style="background:#f8f9fa;border-radius:14px;padding:12px 16px;text-align:left;">' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Nomor Pesanan</span><strong style="color:#111;">' + UI.escape(orderNumber) + '</strong></div>' +
      '    </div>' +
      '  </div>' +
      '  <div style="padding:0 14px;">' +
      '    <button type="button" id="x-btn-order-again" style="display:block;width:100%;height:48px;font-size:15px;font-weight:800;border:none;border-radius:24px;cursor:pointer;background:var(--x-primary);color:var(--x-primary-text);">Pesan Menu Lainnya</button>' +
      '  </div>' +
      '</div>';

    var btn = document.getElementById('x-btn-order-again');
    if (btn && Router) btn.onclick = function () { Router.navigate('home'); };
  }

  // ─── P7.7 TIMEOUT STATE ──────────────────────────────────────────────────
  function renderTimeout(order) {
    if (!targetContainer) return;
    var orderNumber = order.order_number || ('XTR-' + order.id);
    var branchName = order.branch_name || 'Cabang';

    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +
      '  <div style="background:#fff;padding:28px 18px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.06);margin-bottom:12px;">' +
      '    <div style="font-size:48px;margin-bottom:12px;">⌛</div>' +
      '    <h1 style="font-size:20px;font-weight:800;color:#d97706;margin:0 0 8px;">Waktu Konfirmasi Habis</h1>' +
      '    <p style="font-size:13px;color:#6b7280;margin:0 0 16px;line-height:1.5;">Cabang <strong>' + UI.escape(branchName) + '</strong> tidak merespons dalam batas waktu. Pesananmu tidak diproses.</p>' +
      '    <div style="background:#f8f9fa;border-radius:14px;padding:12px 16px;text-align:left;">' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Nomor Pesanan</span><strong style="color:#111;">' + UI.escape(orderNumber) + '</strong></div>' +
      '    </div>' +
      '  </div>' +
      '  <div style="padding:0 14px;">' +
      '    <button type="button" id="x-btn-try-again" style="display:block;width:100%;height:48px;font-size:15px;font-weight:800;border:none;border-radius:24px;cursor:pointer;background:var(--x-primary);color:var(--x-primary-text);">Coba Pesan Lagi</button>' +
      '  </div>' +
      '</div>';

    var btn = document.getElementById('x-btn-try-again');
    if (btn && Router) btn.onclick = function () { Router.navigate('home'); };
  }

  // Cancelled by customer
  function renderCancelled(order) {
    if (!targetContainer) return;
    var orderNumber = order.order_number || ('XTR-' + order.id);

    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +
      '  <div style="background:#fff;padding:28px 18px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.06);margin-bottom:12px;">' +
      '    <div style="font-size:48px;margin-bottom:12px;">🚫</div>' +
      '    <h1 style="font-size:20px;font-weight:800;color:#6b7280;margin:0 0 8px;">Pesanan Dibatalkan</h1>' +
      '    <p style="font-size:13px;color:#6b7280;margin:0 0 16px;line-height:1.5;">Pesanan <strong>' + UI.escape(orderNumber) + '</strong> telah dibatalkan.</p>' +
      '  </div>' +
      '  <div style="padding:0 14px;">' +
      '    <button type="button" id="x-btn-new-order" style="display:block;width:100%;height:48px;font-size:15px;font-weight:800;border:none;border-radius:24px;cursor:pointer;background:var(--x-primary);color:var(--x-primary-text);">Pesan Menu Baru</button>' +
      '  </div>' +
      '</div>';

    var btn = document.getElementById('x-btn-new-order');
    if (btn && Router) btn.onclick = function () { Router.navigate('home'); };
  }

  // ─── P7.5 ACCEPTED STATE and fulfillment tracking ─────────────────────────
  function renderFulfillmentOrder(data) {
    if (!targetContainer) return;
    var order = data.order;
    var items = data.items || [];
    var delivery = data.delivery || {};
    var payment = data.payment || {};

    var orderNumber = order.order_number || ('XTR-' + order.id);
    var orderType = order.order_type || 'delivery';
    var status = order.status;
    var isCash = (payment.payment_method || order.payment_method || 'cash') === 'cash';

    var statusTitle = 'Pesanan Diterima Cabang!';
    var statusDesc = 'Cabang telah mengonfirmasi pesananmu. Dapur sedang menyiapkan makanan.';
    var badgeIcon = '✓';

    if (status === 'preparing') {
      statusTitle = 'Sedang Disiapkan di Dapur';
      statusDesc = 'Dapur cabang sedang memasak dan menyiapkan pesananmu.';
      badgeIcon = '🍳';
    } else if (status === 'ready') {
      if (orderType === 'delivery') {
        statusTitle = 'Pesanan Siap Diantar';
        statusDesc = 'Makanan sudah selesai dimasak dan siap diserahkan kepada kurir.';
      } else if (orderType === 'pickup') {
        statusTitle = 'Pesanan Siap Diambil!';
        statusDesc = 'Makananmu sudah siap. Silakan ambil di konter cabang ' + UI.escape(order.branch_name || '') + '.';
      } else if (orderType === 'dine_in') {
        statusTitle = 'Pesanan Siap Disajikan';
        statusDesc = 'Makananmu sudah siap dan akan segera disajikan ke mejamu.';
      } else {
        statusTitle = 'Pesanan Siap';
        statusDesc = 'Pesananmu sudah selesai disiapkan.';
      }
      badgeIcon = '🔔';
    } else if (status === 'out_for_delivery') {
      statusTitle = 'Dalam Pengantaran Kurir';
      statusDesc = 'Kurir sedang dalam perjalanan mengantarkan pesanan ke alamat tujuan.';
      badgeIcon = '🛵';
    } else if (status === 'completed') {
      statusTitle = 'Pesanan Selesai';
      statusDesc = 'Pesanan telah selesai dinikmati. Terima kasih telah memesan di ' + UI.escape(order.branch_name || 'kami') + '!';
      badgeIcon = '🎉';
    } else if (orderType === 'reservation') {
      statusTitle = 'Reservasi Berhasil Dikonfirmasi!';
      statusDesc = 'Reservasi mejamu sudah tercatat di cabang ' + UI.escape(order.branch_name || '') + '. Kasir akan melakukan Check-in saat kamu tiba.';
    }

    // Stepper completion rules
    var step1Done = true; // Acceptance is completed
    var step2Done = ['preparing', 'ready', 'out_for_delivery', 'completed'].includes(status);
    var step3Done = ['ready', 'out_for_delivery', 'completed'].includes(status);
    if (orderType === 'delivery') {
      step3Done = ['out_for_delivery', 'completed'].includes(status);
    }
    var step4Done = (status === 'completed');

    var itemsHtml = '';
    if (items.length > 0) {
      items.forEach(function (item) {
        var itemTotal = Number(item.unit_price || 0) * Number(item.quantity || 0);
        var noteHtml = item.note
          ? '<div style="font-size:12px;color:#6b7280;margin-top:2px;">Catatan: ' + UI.escape(item.note) + '</div>'
          : '';
        itemsHtml +=
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:1px solid #f3f4f6;">' +
          '  <div style="flex:1;min-width:0;padding-right:12px;">' +
          '    <div style="font-size:14px;font-weight:700;color:#111;">' + item.quantity + '× ' + UI.escape(item.product_name || item.name) + '</div>' +
          noteHtml +
          '  </div>' +
          '  <div style="font-size:14px;font-weight:700;color:#111;white-space:nowrap;">' + UI.money(itemTotal) + '</div>' +
          '</div>';
      });
    } else if (orderType === 'reservation') {
      itemsHtml = '<div style="padding:8px 0;font-size:13px;color:#6b7280;font-style:italic;">Booking meja belum membawa item menu. Menu dapat dipesan langsung saat tiba.</div>';
    }

    var orderTypeBadge = '🛵 Delivery';
    if (orderType === 'pickup') orderTypeBadge = '🛍️ Pick-up';
    if (orderType === 'dine_in') orderTypeBadge = '🍽️ Dine-in ' + (order.table_number ? '(' + order.table_number + ')' : '');
    if (orderType === 'reservation') orderTypeBadge = '📅 Reservasi (' + (order.guest_count || 2) + ' Tamu)';

    var paymentStatusText = isCash ? 'Bayar di Tempat' : 'Online Pay (Midtrans)';
    if (order.payment_status === 'settlement' || order.payment_status === 'paid' || payment.payment_status === 'settlement' || payment.payment_status === 'paid') {
      paymentStatusText += ' • Lunas';
    }

    targetContainer.innerHTML =
      '<div class="x-order-status-screen" style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +

      // 1. Status Header Card
      '  <div class="x-status-card" style="background:#fff;padding:24px 18px;margin-bottom:12px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      '    <div style="width:48px;height:48px;border-radius:50%;background:#f0fdf4;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;color:#16a34a;font-size:24px;font-weight:bold;">' + badgeIcon + '</div>' +
      '    <h1 style="font-size:20px;font-weight:800;color:#111;margin:0 0 6px;">' + statusTitle + '</h1>' +
      '    <p style="font-size:13px;color:#6b7280;margin:0 0 16px;line-height:1.4;">' + statusDesc + '</p>' +
      '    <div style="background:#f8f9fa;border-radius:14px;padding:12px 16px;display:flex;flex-direction:column;gap:8px;text-align:left;">' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Nomor Pesanan</span><strong style="color:#111;">' + UI.escape(orderNumber) + '</strong></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Cabang</span><strong style="color:#111;">' + UI.escape(order.branch_name || 'Cabang Utama') + '</strong></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Tipe Layanan</span><span style="font-weight:700;color:#111;">' + orderTypeBadge + '</span></div>' +
      (orderType === 'dine_in' && order.table_number ? '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Nomor Meja</span><strong style="color:#111;">' + UI.escape(order.table_number) + '</strong></div>' : '') +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Metode Bayar</span><span style="font-weight:700;color:#111;">' + paymentStatusText + '</span></div>' +
      '    </div>' +
      '  </div>' +

      // 2. Stepper
      '  <div style="background:#fff;padding:18px;margin:12px 14px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
      '    <h2 style="font-size:15px;font-weight:800;margin:0 0 16px;color:#111;">Status Alur Pesanan</h2>' +
      '    <div style="display:flex;flex-direction:column;gap:16px;">' +
      (orderType === 'reservation' ? (
        renderStep(1, 'Reservasi Tercatat', 'Jadwal kedatangan sudah tercatat di sistem', step1Done) +
        renderStep(2, 'Menunggu Waktu Kedatangan', 'Silakan hadir sesuai jadwal reservasi', step2Done) +
        renderStep(3, 'Check-in di Outlet', 'Kasir melakukan Check-in dan membuka meja aktif', step3Done) +
        renderStep(4, 'Selesai', 'Kunjungan dan transaksi diselesaikan', step4Done)
      ) : (
        renderStep(1, 'Pesanan Diterima Cabang', 'Cabang telah mengonfirmasi penerimaan pesanan', step1Done) +
        renderStep(2, 'Dapur Menyiapkan', 'Restoran sedang menyiapkan makananmu', step2Done) +
        renderStep(3, orderType === 'delivery' ? 'Dalam Pengantaran' : (orderType === 'pickup' ? 'Siap Diambil di Cabang' : 'Siap Disajikan di Meja'),
          orderType === 'delivery' ? 'Kurir sedang dalam perjalanan ke lokasimu' : (orderType === 'pickup' ? 'Makanan siap diambil di konter cabang' : 'Makanan siap disajikan di mejamu'),
          step3Done) +
        renderStep(4, 'Selesai', 'Pesanan telah selesai dinikmati', step4Done)
      )) +
      '    </div>' +
      '  </div>' +

      // 3. Delivery Address & Driver Info
      (orderType === 'delivery' && (delivery.address_text || delivery.destination_address)
        ? '  <div style="background:#fff;padding:18px;margin:12px 14px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
          '    <h2 style="font-size:15px;font-weight:800;margin:0 0 10px;color:#111;">Alamat Pengantaran</h2>' +
          '    <div style="font-size:14px;color:#111;font-weight:600;line-height:1.4;">' + UI.escape(delivery.address_text || delivery.destination_address) + '</div>' +
          (delivery.driver_name
            ? '    <div style="margin-top:10px;padding:10px 12px;background:#f0fdf4;border-radius:10px;font-size:13px;color:#166534;">' +
              '      🛵 Kurir: <strong>' + UI.escape(delivery.driver_name) + '</strong>' +
              (delivery.driver_phone ? ' (' + UI.escape(delivery.driver_phone) + ')' : '') +
              (delivery.tracking_url ? '<div style="margin-top:6px;"><a href="' + UI.escape(delivery.tracking_url) + '" target="_blank" rel="noopener noreferrer" style="color:#16a34a;font-weight:700;text-decoration:underline;">Lacak Pengiriman Langsung →</a></div>' : '') +
              '    </div>'
            : '') +
          '</div>'
        : '') +

      // 4. Items
      '  <div style="background:#fff;padding:18px;margin:12px 14px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
      '    <h2 style="font-size:15px;font-weight:800;margin:0 0 8px;color:#111;">Rincian Pesanan</h2>' +
      itemsHtml +
      (order.order_note ? '    <div style="margin-top:12px;padding:10px 14px;background:#f9fafb;border-radius:10px;font-size:13px;color:#4b5563;border-left:3px solid var(--x-primary);"><strong style="color:#111;">Catatan Pesanan:</strong> ' + UI.escape(order.order_note) + '</div>' : '') +
      '  </div>' +

      // 5. Payment Summary
      (orderType !== 'reservation'
        ? '  <div style="background:#fff;padding:18px;margin:12px 14px 20px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
          '    <h2 style="font-size:15px;font-weight:800;margin:0 0 12px;color:#111;">Rincian Pembayaran</h2>' +
          '    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;"><span style="color:#6b7280;">Subtotal</span><span>' + UI.money(order.subtotal || 0) + '</span></div>' +
          (orderType === 'delivery' ? '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;"><span style="color:#6b7280;">Biaya Pengiriman</span><span>' + UI.money(order.delivery_fee || 0) + '</span></div>' : '') +
          (Number(order.discount_amount) > 0 ? '    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;color:#ff4040;"><span>Diskon</span><span>−' + UI.money(order.discount_amount) + '</span></div>' : '') +
          '    <div style="height:1px;background:#e5e7eb;margin:10px 0;"></div>' +
          '    <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:800;color:#111;"><span>Total Tagihan</span><span>' + UI.money(order.grand_total || order.total_amount || 0) + '</span></div>' +
          '  </div>'
        : '') +

      // 6. Action
      '  <div style="padding:0 14px;">' +
      '    <button type="button" id="x-btn-reorder" style="display:block;width:100%;height:48px;font-size:15px;font-weight:800;border:none;border-radius:24px;cursor:pointer;background:var(--x-primary);color:var(--x-primary-text);box-shadow:0 4px 12px var(--x-primary-shadow,rgba(0,0,0,0.06));">Pesan Menu Lainnya</button>' +
      '  </div>' +

      '</div>';

    var reorderBtn = document.getElementById('x-btn-reorder');
    if (reorderBtn && Router) reorderBtn.onclick = function () { Router.navigate('home'); };
  }

  function renderStep(num, title, desc, isDone) {
    var markerBg = isDone ? 'var(--x-primary)' : '#e5e7eb';
    var markerColor = isDone ? 'var(--x-primary-text, #111)' : '#9ca3af';
    var icon = isDone ? '✓' : num;
    return (
      '<div style="display:flex;align-items:flex-start;gap:12px;">' +
      '  <div style="width:28px;height:28px;border-radius:50%;background:' + markerBg + ';color:' + markerColor + ';display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0;margin-top:1px;">' + icon + '</div>' +
      '  <div style="flex:1;">' +
      '    <div style="font-size:14px;font-weight:700;color:#111;">' + title + '</div>' +
      '    <div style="font-size:12px;color:#6b7280;margin-top:2px;">' + desc + '</div>' +
      '  </div>' +
      '</div>'
    );
  }

  // Customer cancellation while awaiting acceptance (server-enforced gate)
  function confirmCancel(orderId) {
    if (!confirm('Yakin ingin membatalkan pesanan ini?')) return;
    API.post('/orders/' + encodeURIComponent(orderId) + '/cancel', {
      reason: 'Dibatalkan customer dari halaman menunggu konfirmasi'
    })
      .then(function () { loadOrder(orderId); })
      .catch(function (err) {
        var msg = (err && err.data && err.data.error) || (err && err.message) || 'Gagal membatalkan pesanan.';
        if (UI && UI.toast) UI.toast(msg);
      });
  }

  // ─── P7.2 Server-authoritative polling ───────────────────────────────────
  // P7.14 Stops on all terminal states.
  // P7.13 Stale responses discarded via fetchSeq.
  function schedulePolling(currentStatus, currentPayStatus, deadlineAt) {
    if (TERMINAL_STATES[currentStatus]) return;
    if (['deny', 'cancel', 'expire'].includes(currentPayStatus)) return;
    if (pollingTimer) clearInterval(pollingTimer);

    pollingTimer = setInterval(function () {
      if (!currentOrderId) return;
      var seq = ++fetchSeq;
      API.get('/orders/' + encodeURIComponent(currentOrderId))
        .then(function (data) {
          if (seq !== fetchSeq) return; // P7.13: stale — discard
          if (!data.success || !data.order) return;
          var newStatus = data.order.status;
          var newPayStatus = (data.payment && data.payment.payment_status) || data.order.payment_status || 'pending';
          if (newStatus !== currentStatus || newPayStatus !== currentPayStatus) {
            stopTimers();
            renderOrder(data);
            currentStatus = newStatus;
            currentPayStatus = newPayStatus;
            if (!TERMINAL_STATES[newStatus] && !['deny', 'cancel', 'expire'].includes(newPayStatus)) {
              schedulePolling(newStatus, newPayStatus, data.order.acceptance_deadline_at);
            }
          }
        })
        .catch(function () {});
    }, 4000);
  }

  function unmount() {
    stopTimers();
    targetContainer = null;
    currentOrderId = null;
    fetchSeq = 0;
  }

  // ── Export ──
  window.Xentra = window.Xentra || {};
  window.Xentra.OrderReceived = {
    mount: mount,
    unmount: unmount
  };
})();
