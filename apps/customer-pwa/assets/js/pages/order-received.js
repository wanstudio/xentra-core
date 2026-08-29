/**
 * Xentra Customer PWA — Order Received & Live Confirmation Screen
 * Clean Vanilla JS controller connecting to Xentra Core REST API.
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
      '  <button type="button" id="x-btn-back-home" class="x-btn-lime" style="display:inline-block;padding:12px 28px;font-size:14px;border:none;border-radius:24px;cursor:pointer;">Kembali ke Menu</button>' +
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

    var orderNumber = 'XTR-' + order.id;
    var status = order.status; // pending, confirmed, preparing, ready, delivery, completed, cancelled
    var isCash = (payment.payment_method || 'cash') === 'cash';

    // Status Card Configuration
    var statusTitle = 'Pesanan berhasil dibuat!';
    var statusDesc = isCash
      ? 'Siapkan uang tunai pas saat kurir tiba atau saat ambil di resto.'
      : 'Pembayaranmu telah diverifikasi. Dapur segera menyiapkan pesanan.';

    if (status === 'cancelled' || status === 'rejected') {
      statusTitle = 'Pesanan Dibatalkan';
      statusDesc = 'Pesanan ini telah dibatalkan.';
    } else if (status === 'pending' && !isCash) {
      statusTitle = 'Menunggu Pembayaran';
      statusDesc = 'Selesaikan pembayaran QRIS / Online Pay kamu agar pesanan segera diproses.';
    }

    // Tracker Active Step
    var stepIndex = 1;
    if (status === 'confirmed' || status === 'preparing') stepIndex = 2;
    if (status === 'ready' || status === 'delivery' || status === 'on_delivery') stepIndex = 3;
    if (status === 'completed') stepIndex = 4;

    // Build Items HTML
    var itemsHtml = '';
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

    targetContainer.innerHTML =
      '<div class="x-order-status-screen" style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +

      // 1. Status Header Card
      '  <div class="x-status-card" style="background:#fff;padding:24px 18px;margin-bottom:12px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      '    <div style="width:48px;height:48px;border-radius:50%;background:#f0fdf4;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;color:#16a34a;font-size:24px;font-weight:bold;">✓</div>' +
      '    <h1 style="font-size:20px;font-weight:800;color:#111;margin:0 0 6px;">' + statusTitle + '</h1>' +
      '    <p style="font-size:13px;color:#6b7280;margin:0 0 16px;line-height:1.4;">' + statusDesc + '</p>' +
      '    <div style="background:#f8f9fa;border-radius:14px;padding:12px 16px;display:flex;flex-direction:column;gap:8px;text-align:left;">' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Nomor Pesanan</span><strong style="color:#111;">' + orderNumber + '</strong></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Metode</span><span style="font-weight:700;color:#111;">' + (isCash ? 'Tunai (COD)' : 'Online Pay') + '</span></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Estimasi</span><span style="font-weight:700;color:#16a34a;">25–35 menit</span></div>' +
      '    </div>' +
      '  </div>' +

      // 2. Stepper Card
      '  <div style="background:#fff;padding:18px;margin:12px 14px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
      '    <h2 style="font-size:15px;font-weight:800;margin:0 0 16px;color:#111;">Status Pengerjaan</h2>' +
      '    <div style="display:flex;flex-direction:column;gap:16px;">' +
      renderStep(1, 'Pesanan Diterima', 'Pesanan sudah tercatat di sistem resto', stepIndex >= 1) +
      renderStep(2, 'Dapur Menyiapkan', 'Restoran sedang menyiapkan makananmu', stepIndex >= 2) +
      renderStep(3, 'Dalam Pengantaran', 'Kurir sedang dalam perjalanan ke lokasimu', stepIndex >= 3) +
      renderStep(4, 'Selesai', 'Pesanan telah sampai dan dinikmati', stepIndex >= 4) +
      '    </div>' +
      '  </div>' +

      // 3. Address Card
      (delivery && delivery.address_text
        ? '  <div style="background:#fff;padding:18px;margin:12px 14px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
          '    <h2 style="font-size:15px;font-weight:800;margin:0 0 10px;color:#111;">Alamat Pengantaran</h2>' +
          '    <div style="font-size:14px;color:#111;font-weight:600;line-height:1.4;">' + UI.escape(delivery.address_text) + '</div>' +
          (delivery.driver_note ? '<div style="font-size:12px;color:#6b7280;margin-top:4px;">Catatan driver: ' + UI.escape(delivery.driver_note) + '</div>' : '') +
          '  </div>'
        : '') +

      // 4. Items Card
      '  <div style="background:#fff;padding:18px;margin:12px 14px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
      '    <h2 style="font-size:15px;font-weight:800;margin:0 0 8px;color:#111;">Rincian Pesanan</h2>' +
      itemsHtml +
      '  </div>' +

      // 5. Payment Summary Card
      '  <div style="background:#fff;padding:18px;margin:12px 14px 20px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
      '    <h2 style="font-size:15px;font-weight:800;margin:0 0 12px;color:#111;">Rincian Pembayaran</h2>' +
      '    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;"><span style="color:#6b7280;">Subtotal</span><span>' + UI.money(order.subtotal) + '</span></div>' +
      '    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;"><span style="color:#6b7280;">Biaya Pengiriman</span><span>' + UI.money(order.delivery_fee) + '</span></div>' +
      (Number(order.discount_amount) > 0 ? '    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;color:#ff4040;"><span>Diskon</span><span>−' + UI.money(order.discount_amount) + '</span></div>' : '') +
      '    <div style="height:1px;background:#e5e7eb;margin:10px 0;"></div>' +
      '    <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:800;color:#111;"><span>Total Pembayaran</span><span>' + UI.money(order.total_amount) + '</span></div>' +
      '  </div>' +

      // 6. Action Button
      '  <div style="padding:0 18px;text-align:center;">' +
      '    <button type="button" id="x-btn-reorder" class="x-btn-lime" style="display:block;width:100%;height:48px;font-size:15px;font-weight:800;border:none;border-radius:24px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.1);">Pesan Menu Lainnya</button>' +
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
