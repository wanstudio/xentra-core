/**
 * Xentra Customer PWA — Order Received & Live Tracking Screen
 * Pixel-perfect confirmation & live tracking conforming to Xentra-Core architecture.
 * Supports all 4 order types: Delivery, Pick-up, Dine-in, Reservation.
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

  function mount(container, orderId) {
    targetContainer = container || document.getElementById('x-order-content') || document.getElementById('xentra-order-view');
    currentOrderId = orderId || (Router && Router.getOrderIdFromUrl()) || getOrderIdFromLocation();

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
    var matchHash = hash.match(/#order-received[\/=]([a-zA-Z0-9_-]+)/);
    if (matchHash && matchHash[1]) return matchHash[1];

    var path = window.location.pathname;
    var match = path.match(/\/order-received\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) return match[1];

    var params = new URLSearchParams(window.location.search);
    return params.get('order_id') || params.get('id') || null;
  }

  function renderLoading() {
    if (!targetContainer) return;
    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div style="padding:60px 20px;text-align:center;color:#6b7280;font-size:15px;font-weight:600;">' +
      '  <div style="width:40px;height:40px;border:3px solid #e5e7eb;border-top-color:#b6ff00;border-radius:50%;margin:0 auto 16px;animation:spin 1s linear infinite;"></div>' +
      '  Memuat status pesanan...' +
      '</div>';
  }

  function loadOrder(id) {
    API.get('/orders/' + encodeURIComponent(id))
      .then(function (data) {
        if (data.success && data.order) {
          renderOrder(data);
          startPolling(data.order.status);
        } else {
          renderNotFound(data.error || 'Pesanan tidak ditemukan.');
        }
      })
      .catch(function (err) {
        renderNotFound('Gagal memuat status pesanan: ' + err.message);
      });
  }

  function renderNotFound(msg) {
    if (!targetContainer) return;
    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div class="x-order-status-container" style="padding:40px 18px;text-align:center;">' +
      '  <div style="font-size:48px;margin-bottom:12px;">⚠️</div>' +
      '  <h2 style="font-size:18px;font-weight:800;color:#111;margin-bottom:8px;">Pesanan Tidak Ditemukan</h2>' +
      '  <p style="color:#6b7280;font-size:14px;line-height:1.5;margin-bottom:24px;">' + UI.escape(msg) + '</p>' +
      '  <button type="button" id="x-btn-back-home" class="x-btn-lime" style="display:inline-block;padding:12px 28px;font-size:14px;border:none;border-radius:24px;cursor:pointer;background:#d6ff00;color:#111;font-weight:800;">Kembali ke Menu</button>' +
      '</div>';

    var btn = document.getElementById('x-btn-back-home');
    if (btn && Router) {
      btn.onclick = function () { Router.navigate('home'); };
    }
  }

  function renderOrder(data) {
    if (!targetContainer) return;
    targetContainer.style.display = 'block';

    var order = data.order;
    var items = data.items || [];
    var delivery = data.delivery || {};
    var payment = data.payment || {};
    var branch = data.branch || {};

    var orderNumber = order.order_number || ('XTR-' + order.id);
    var orderType = order.order_type || 'delivery';
    var status = order.status; // pending, confirmed, preparing, ready, delivery, completed, cancelled
    var isCash = (payment.payment_method || order.payment_method || 'cash') === 'cash';

    // Status Card Configuration
    var statusTitle = 'Pesanan Berhasil Dibuat!';
    var statusDesc = isCash
      ? 'Siapkan uang tunai pas saat pesanan tiba atau saat bertransaksi di outlet.'
      : 'Pembayaranmu telah diverifikasi. Dapur segera menyiapkan pesanan.';

    if (orderType === 'reservation') {
      statusTitle = 'Reservasi Berhasil Diajukan!';
      statusDesc = 'Reservasi mejamu sudah tercatat. Kasir akan melakukan Check-in saat kamu tiba di outlet.';
    } else if (status === 'cancelled' || status === 'rejected') {
      statusTitle = 'Pesanan Dibatalkan';
      statusDesc = 'Pesanan ini telah dibatalkan.';
    } else if (status === 'pending' && !isCash) {
      statusTitle = 'Menunggu Pembayaran';
      statusDesc = 'Selesaikan pembayaran Online Pay kamu agar pesanan segera diproses.';
    }

    // Tracker Active Step
    var stepIndex = 1;
    if (status === 'confirmed' || status === 'preparing') stepIndex = 2;
    if (status === 'ready' || status === 'delivery' || status === 'on_delivery') stepIndex = 3;
    if (status === 'completed') stepIndex = 4;

    // Build Items HTML
    var itemsHtml = '';
    if (items.length > 0) {
      items.forEach(function (item) {
        var itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
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

    var branchPhone = branch.phone || '6281234567890';
    var cleanBranchPhone = branchPhone.replace(/[^0-9]/g, '');
    if (cleanBranchPhone.startsWith('0')) cleanBranchPhone = '62' + cleanBranchPhone.slice(1);
    var waUrl = 'https://wa.me/' + cleanBranchPhone + '?text=' + encodeURIComponent('Halo kak, saya ingin tanya pesanan #' + orderNumber);

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
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Status Pembayaran</span><span style="font-weight:700;color:' + (isCash ? '#ea580c' : '#16a34a') + ';">' + (isCash ? 'Pending Tunai' : 'Lunas (Settlement)') + '</span></div>' +
      '    </div>' +
      '  </div>' +

      // 2. Stepper Card (Workflow Tracker)
      '  <div style="background:#fff;padding:18px;margin:12px 14px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
      '    <h2 style="font-size:15px;font-weight:800;margin:0 0 16px;color:#111;">Status Alur Pesanan</h2>' +
      '    <div style="display:flex;flex-direction:column;gap:16px;">' +
      (orderType === 'reservation' ? (
        renderStep(1, 'Reservasi Tercatat', 'Jadwal kedatangan sudah tercatat di sistem', stepIndex >= 1) +
        renderStep(2, 'Menunggu Waktu Kedatangan', 'Silakan hadir sesuai jadwal reservasi', stepIndex >= 2) +
        renderStep(3, 'Check-in di Outlet', 'Kasir melakukan Check-in dan membuka meja aktif', stepIndex >= 3) +
        renderStep(4, 'Selesai', 'Kunjungan dan transaksi diselesaikan', stepIndex >= 4)
      ) : (
        renderStep(1, 'Pesanan Diterima', 'Pesanan sudah tercatat di sistem restoran', stepIndex >= 1) +
        renderStep(2, 'Dapur Menyiapkan', 'Restoran sedang menyiapkan makananmu', stepIndex >= 2) +
        renderStep(3, orderType === 'delivery' ? 'Dalam Pengantaran' : 'Siap Diambil / Disajikan', orderType === 'delivery' ? 'Kurir sedang dalam perjalanan ke lokasimu' : 'Pesanan siap disajikan di meja/kasir', stepIndex >= 3) +
        renderStep(4, 'Selesai', 'Pesanan telah selesai dinikmati', stepIndex >= 4)
      )) +
      '    </div>' +
      '  </div>' +

      // 3. Location / Delivery Address Card
      (orderType === 'delivery' && (delivery.address_text || delivery.destination_address)
        ? '  <div style="background:#fff;padding:18px;margin:12px 14px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
          '    <h2 style="font-size:15px;font-weight:800;margin:0 0 10px;color:#111;">Alamat Pengantaran</h2>' +
          '    <div style="font-size:14px;color:#111;font-weight:600;line-height:1.4;">' + UI.escape(delivery.address_text || delivery.destination_address) + '</div>' +
          (delivery.driver_note ? '<div style="font-size:12px;color:#6b7280;margin-top:4px;">Catatan driver: ' + UI.escape(delivery.driver_note) + '</div>' : '') +
          '  </div>'
        : '') +

      // 4. Items Card
      '  <div style="background:#fff;padding:18px;margin:12px 14px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
      '    <h2 style="font-size:15px;font-weight:800;margin:0 0 8px;color:#111;">Rincian Pesanan</h2>' +
      itemsHtml +
      '  </div>' +

      // 5. Payment Summary Card
      (orderType !== 'reservation' ? (
        '  <div style="background:#fff;padding:18px;margin:12px 14px 20px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
        '    <h2 style="font-size:15px;font-weight:800;margin:0 0 12px;color:#111;">Rincian Pembayaran</h2>' +
        '    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;"><span style="color:#6b7280;">Subtotal</span><span>' + UI.money(order.subtotal || 0) + '</span></div>' +
        (orderType === 'delivery' ? '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;"><span style="color:#6b7280;">Biaya Pengiriman</span><span>' + UI.money(order.delivery_fee || 0) + '</span></div>' : '') +
        (Number(order.discount_amount) > 0 ? '    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;color:#ff4040;"><span>Diskon</span><span>−' + UI.money(order.discount_amount) + '</span></div>' : '') +
        '    <div style="height:1px;background:#e5e7eb;margin:10px 0;"></div>' +
        '    <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:800;color:#111;"><span>Total Tagihan</span><span>' + UI.money(order.grand_total || order.total_amount || 0) + '</span></div>' +
        '  </div>'
      ) : '') +

      // 6. Action Buttons (WhatsApp Branch & Reorder)
      '  <div style="padding:0 14px;display:flex;flex-direction:column;gap:10px;text-align:center;">' +
      '    <a href="' + waUrl + '" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;height:48px;background:#25d366;color:#fff;font-size:14px;font-weight:700;border-radius:24px;text-decoration:none;box-shadow:0 4px 12px rgba(37,211,102,0.25);">💬 Hubungi WhatsApp Cabang</a>' +
      '    <button type="button" id="x-btn-reorder" style="display:block;width:100%;height:48px;font-size:15px;font-weight:800;border:none;border-radius:24px;cursor:pointer;background:#d6ff00;color:#111;box-shadow:0 4px 12px rgba(0,0,0,0.06);">Pesan Menu Lainnya</button>' +
      '  </div>' +

      '</div>';

    var reorderBtn = document.getElementById('x-btn-reorder');
    if (reorderBtn && Router) {
      reorderBtn.onclick = function () { Router.navigate('home'); };
    }
  }

  function renderStep(num, title, desc, isDone) {
    var markerBg = isDone ? '#111' : '#e5e7eb';
    var markerColor = isDone ? '#b6ff00' : '#9ca3af';
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

  function startPolling(currentStatus) {
    if (currentStatus === 'completed' || currentStatus === 'cancelled') return;
    if (pollingTimer) clearInterval(pollingTimer);

    pollingTimer = setInterval(function () {
      if (!currentOrderId) return;
      API.get('/orders/' + encodeURIComponent(currentOrderId))
        .then(function (data) {
          if (data.success && data.order) {
            if (data.order.status !== currentStatus) {
              renderOrder(data);
              currentStatus = data.order.status;
            }
          }
        })
        .catch(function () {});
    }, 5000);
  }

  // Export
  window.Xentra = window.Xentra || {};
  window.Xentra.OrderReceived = {
    mount: mount
  };
})();
