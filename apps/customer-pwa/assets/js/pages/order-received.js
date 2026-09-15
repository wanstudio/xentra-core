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

  // P7.14 Terminal states — polling stops unconditionally here
  var TERMINAL_STATES = { confirmed: 1, rejected: 1, timeout: 1, cancelled: 1, completed: 1 };

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
          schedulePolling(data.order.status, data.order.acceptance_deadline_at);
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
    var status = order.status;

    // P7.1 AWAITING_BRANCH_ACCEPTANCE: all 'pending' orders post-checkout
    // are awaiting branch acceptance (not "awaiting payment" — payment
    // completion is the prerequisite for order creation).
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

  // ─── P7.1 AWAITING BRANCH ACCEPTANCE SURFACE ─────────────────────────────
  function renderWaiting(data) {
    if (!targetContainer) return;
    var order = data.order;
    var branchName = order.branch_name || 'Cabang';
    var orderNumber = order.order_number || ('XTR-' + order.id);
    var deadlineAt = order.acceptance_deadline_at || null;

    // P7.3 Derive seconds remaining from server-authoritative deadline
    var secsRemaining = ACCEPTANCE_TIMEOUT_SECONDS;
    if (deadlineAt) {
      var msRemaining = new Date(deadlineAt).getTime() - Date.now();
      secsRemaining = Math.max(0, Math.floor(msRemaining / 1000));
    }

    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div id="x-waiting-screen" style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +

      // Status Header Card
      '  <div style="background:#fff;padding:28px 18px 22px;margin-bottom:12px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      '    <div style="width:56px;height:56px;border-radius:50%;background:#fef9c3;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:28px;">⏳</div>' +
      '    <h1 style="font-size:20px;font-weight:800;color:#111;margin:0 0 8px;">Menunggu Konfirmasi Cabang</h1>' +
      '    <p style="font-size:13px;color:#6b7280;margin:0 0 18px;line-height:1.5;">Pesananmu sudah diterima sistem. Cabang <strong>' + UI.escape(branchName) + '</strong> sedang memproses konfirmasi penerimaan pesanan.</p>' +

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
    var statusDesc = 'Cabang telah mengkonfirmasi pesananmu. Dapur sedang mempersiapkan makanan.';

    if (orderType === 'reservation') {
      statusTitle = 'Reservasi Berhasil Diajukan!';
      statusDesc = 'Reservasi mejamu sudah tercatat. Kasir akan melakukan Check-in saat kamu tiba di outlet.';
    }

    var stepIndex = 1;
    if (status === 'confirmed' || status === 'preparing') stepIndex = 2;
    if (status === 'ready' || status === 'delivery' || status === 'out_for_delivery') stepIndex = 3;
    if (status === 'completed') stepIndex = 4;

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

    targetContainer.innerHTML =
      '<div class="x-order-status-screen" style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +

      // 1. Status Header Card
      '  <div class="x-status-card" style="background:#fff;padding:24px 18px;margin-bottom:12px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      '    <div style="width:48px;height:48px;border-radius:50%;background:#f0fdf4;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;color:#16a34a;font-size:24px;font-weight:bold;">✓</div>' +
      '    <h1 style="font-size:20px;font-weight:800;color:#111;margin:0 0 6px;">' + statusTitle + '</h1>' +
      '    <p style="font-size:13px;color:#6b7280;margin:0 0 16px;line-height:1.4;">' + statusDesc + '</p>' +
      '    <div style="background:#f8f9fa;border-radius:14px;padding:12px 16px;display:flex;flex-direction:column;gap:8px;text-align:left;">' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Nomor Pesanan</span><strong style="color:#111;">' + UI.escape(orderNumber) + '</strong></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Tipe Layanan</span><span style="font-weight:700;color:#111;">' + orderTypeBadge + '</span></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Metode Bayar</span><span style="font-weight:700;color:#111;">' + (isCash ? 'Tunai (COD / Kasir)' : 'Online Pay (Midtrans)') + '</span></div>' +
      '    </div>' +
      '  </div>' +

      // 2. Stepper
      '  <div style="background:#fff;padding:18px;margin:12px 14px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
      '    <h2 style="font-size:15px;font-weight:800;margin:0 0 16px;color:#111;">Status Alur Pesanan</h2>' +
      '    <div style="display:flex;flex-direction:column;gap:16px;">' +
      (orderType === 'reservation' ? (
        renderStep(1, 'Reservasi Tercatat', 'Jadwal kedatangan sudah tercatat di sistem', stepIndex >= 1) +
        renderStep(2, 'Menunggu Waktu Kedatangan', 'Silakan hadir sesuai jadwal reservasi', stepIndex >= 2) +
        renderStep(3, 'Check-in di Outlet', 'Kasir melakukan Check-in dan membuka meja aktif', stepIndex >= 3) +
        renderStep(4, 'Selesai', 'Kunjungan dan transaksi diselesaikan', stepIndex >= 4)
      ) : (
        renderStep(1, 'Pesanan Diterima Cabang', 'Cabang telah mengkonfirmasi penerimaan pesanan', stepIndex >= 1) +
        renderStep(2, 'Dapur Menyiapkan', 'Restoran sedang menyiapkan makananmu', stepIndex >= 2) +
        renderStep(3, orderType === 'delivery' ? 'Dalam Pengantaran' : 'Siap Diambil / Disajikan',
          orderType === 'delivery' ? 'Kurir sedang dalam perjalanan ke lokasimu' : 'Pesanan siap disajikan di meja/kasir',
          stepIndex >= 3) +
        renderStep(4, 'Selesai', 'Pesanan telah selesai dinikmati', stepIndex >= 4)
      )) +
      '    </div>' +
      '  </div>' +

      // 3. Delivery Address
      (orderType === 'delivery' && (delivery.address_text || delivery.destination_address)
        ? '  <div style="background:#fff;padding:18px;margin:12px 14px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
          '    <h2 style="font-size:15px;font-weight:800;margin:0 0 10px;color:#111;">Alamat Pengantaran</h2>' +
          '    <div style="font-size:14px;color:#111;font-weight:600;line-height:1.4;">' + UI.escape(delivery.address_text || delivery.destination_address) + '</div>' +
          '</div>'
        : '') +

      // 4. Items
      '  <div style="background:#fff;padding:18px;margin:12px 14px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
      '    <h2 style="font-size:15px;font-weight:800;margin:0 0 8px;color:#111;">Rincian Pesanan</h2>' +
      itemsHtml +
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
  function schedulePolling(currentStatus, deadlineAt) {
    if (TERMINAL_STATES[currentStatus]) return;
    if (pollingTimer) clearInterval(pollingTimer);

    pollingTimer = setInterval(function () {
      if (!currentOrderId) return;
      var seq = ++fetchSeq;
      API.get('/orders/' + encodeURIComponent(currentOrderId))
        .then(function (data) {
          if (seq !== fetchSeq) return; // P7.13: stale — discard
          if (!data.success || !data.order) return;
          var newStatus = data.order.status;
          if (newStatus !== currentStatus) {
            stopTimers();
            renderOrder(data);
            currentStatus = newStatus;
            if (!TERMINAL_STATES[newStatus]) {
              schedulePolling(newStatus, data.order.acceptance_deadline_at);
            }
          }
        })
        .catch(function () {});
    }, 5000);
  }

  // ── Export ──
  window.Xentra = window.Xentra || {};
  window.Xentra.OrderReceived = {
    mount: mount
  };
})();
