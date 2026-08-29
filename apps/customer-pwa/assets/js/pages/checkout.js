/**
 * Xentra Customer PWA — Integrated Checkout Page Controller
 * High-fidelity, GoFood-style checkout with iOS wheel picker, address map pin,
 * upsell carousel, and direct payment integration.
 */
(function () {
  'use strict';

  var API = window.Xentra.API;
  var Store = window.Xentra.Store;
  var UI = window.Xentra.UI;
  var Router = window.Xentra.Router;

  var checkoutContainer = null;
  var upsellItems = [];
  var currentItemId = null; // null: all cart items, string: single item checkout

  // Local Checkout State
  var state = {
    fulfillment: {
      type: 'delivery', // 'delivery' | 'pickup'
      scheduled: false,
      date: 'Hari Ini',
      timeSlot: 'Sekarang (15–25 mnt)'
    },
    customer: {
      name: 'Pelanggan Bangjo',
      phone: ''
    },
    address: {
      formatted_address: 'Jl. Raya Gading Serpong, Ruko Diamond No. 12',
      detail: '',
      driver_note: '',
      latitude: -6.2415,
      longitude: 106.6288
    },
    deliveryFee: 0,
    distanceKm: 1.5,
    promoDiscount: 0,
    paymentMethod: 'cash', // 'cash' | 'midtrans'
    isSubmitting: false
  };

  // ── Helper ──
  function $(id) {
    return document.getElementById(id);
  }

  function getCheckoutItems() {
    var allItems = Store.getState().cart.items || [];
    if (!currentItemId) return allItems;
    return allItems.filter(function (i) {
      return String(i.id) === String(currentItemId);
    });
  }

  // ======================================================================
  //  MOUNT / RENDER CHECKOUT VIEW
  // ======================================================================
  function mount(container, params) {
    checkoutContainer = container || $('xentra-checkout-view');
    if (!checkoutContainer) return;

    if (params && params.itemId !== undefined) {
      currentItemId = params.itemId ? String(params.itemId) : null;
    } else {
      var urlItemId = Router && Router.getItemIdFromUrl ? Router.getItemIdFromUrl() : null;
      currentItemId = urlItemId ? String(urlItemId) : null;
    }

    var items = getCheckoutItems();

    if (!items.length) {
      renderEmpty();
      return;
    }

    // Load saved address/notes
    var savedLoc = Store.getState().location;
    if (savedLoc && savedLoc.formatted_address) {
      state.address.formatted_address = savedLoc.formatted_address;
      if (savedLoc.latitude) state.address.latitude = savedLoc.latitude;
      if (savedLoc.longitude) state.address.longitude = savedLoc.longitude;
    }

    renderLayout();
    calculateTotals();
    loadUpsell();
  }

  function renderEmpty() {
    checkoutContainer.innerHTML =
      '<div class="xentra-checkout" style="padding:40px 18px;text-align:center;">' +
      '  <div class="x-header" style="margin-bottom:24px;">' +
      '    <button type="button" id="x-back-to-menu-empty" style="background:none;border:none;cursor:pointer;">' +
      '      <img src="/assets/icons/arrowback.svg" alt="Kembali" width="20" height="20">' +
      '    </button>' +
      '    <span>Checkout Bangjo</span>' +
      '  </div>' +
      '  <div style="font-size:48px;margin-bottom:12px;">🛒</div>' +
      '  <h2 style="font-size:18px;font-weight:800;color:#111;margin-bottom:8px;">Keranjangmu Masih Kosong</h2>' +
      '  <p style="color:#6b7280;font-size:14px;line-height:1.5;margin-bottom:24px;">Yuk, pilih menu lezat Bangjo dulu sebelum checkout!</p>' +
      '  <button type="button" id="x-btn-browse-menu" class="x-btn-lime" style="display:inline-block;padding:12px 28px;font-size:14px;">Lihat Menu</button>' +
      '</div>';

    var backBtn = $('x-back-to-menu-empty');
    var browseBtn = $('x-btn-browse-menu');
    if (backBtn) backBtn.onclick = function () { Router.navigate('home'); };
    if (browseBtn) browseBtn.onclick = function () { Router.navigate('home'); };
  }

  function renderLayout() {
    var items = getCheckoutItems();
    var isDelivery = state.fulfillment.type === 'delivery';
    var totalItemCount = items.reduce(function (s, i) { return s + Number(i.quantity || 0); }, 0);

    checkoutContainer.innerHTML =
      '<div class="xentra-checkout" style="padding-bottom:130px;min-height:100vh;background:#f5f5f5;">' +

      // 1. Header
      '  <div class="x-header" style="background:#fff;padding:16px 18px;position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:12px;border-bottom:1px solid #eee;">' +
      '    <button type="button" id="x-checkout-back-btn" style="background:none;border:none;cursor:pointer;display:flex;align-items:center;padding:0;" aria-label="Kembali">' +
      '      <img src="/assets/icons/arrowback.svg" alt="Kembali" width="20" height="20">' +
      '    </button>' +
      '    <span style="font-size:16px;font-weight:800;color:#111;">Checkout Bangjo</span>' +
      '  </div>' +

      // 2. Fulfillment Switcher (Delivery vs Pick-up)
      '  <div class="x-card" id="x-card-fulfillment" style="background:#fff;margin:12px 14px;padding:14px 16px;border-radius:18px;box-shadow:0 4px 14px rgba(0,0,0,0.06);display:flex;align-items:center;justify-content:space-between;cursor:pointer;">' +
      '    <div style="display:flex;align-items:center;gap:12px;min-width:0;">' +
      '      <img src="' + (isDelivery ? '/assets/icons/delivery.png' : '/assets/icons/pick_up.png') + '" style="width:36px;height:36px;object-fit:contain;" alt="">' +
      '      <div>' +
      '        <div style="font-size:15px;font-weight:800;color:#111;">' + (isDelivery ? 'Delivery' : 'Pick-up (Ambil Sendiri)') + '</div>' +
      '        <div style="font-size:12px;color:#6b7280;margin-top:1px;">' + UI.escape(state.fulfillment.timeSlot) + '</div>' +
      '      </div>' +
      '    </div>' +
      '    <button type="button" class="x-pill-btn" style="background:#f0fdf4;color:#16a34a;border:none;padding:6px 14px;border-radius:20px;font-size:13px;font-weight:700;">Ubah</button>' +
      '  </div>' +

      // 3. Address Card (Only if delivery)
      (isDelivery ?
      '  <div class="x-card" id="x-card-address" style="background:#fff;margin:12px 14px;padding:16px;border-radius:18px;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      '    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
      '      <span style="font-size:14px;font-weight:800;color:#111;">Alamat Pengantaran</span>' +
      '      <button type="button" id="x-btn-change-address" style="background:none;border:none;color:#16a34a;font-size:13px;font-weight:700;cursor:pointer;">Ganti</button>' +
      '    </div>' +
      '    <div style="display:flex;gap:10px;align-items:flex-start;">' +
      '      <img src="/assets/icons/pinlok.svg" style="width:20px;height:20px;margin-top:2px;flex-shrink:0;" alt="">' +
      '      <div style="flex:1;min-width:0;">' +
      '        <div style="font-size:13.5px;color:#111;font-weight:600;line-height:1.4;">' + UI.escape(state.address.formatted_address) + '</div>' +
      (state.address.driver_note ? '<div style="font-size:12px;color:#6b7280;margin-top:4px;">Catatan: ' + UI.escape(state.address.driver_note) + '</div>' : '') +
      '      </div>' +
      '    </div>' +
      '    <div style="margin-top:12px;padding-top:10px;border-top:1px dashed #e5e7eb;display:flex;gap:8px;">' +
      '      <button type="button" id="x-btn-driver-note" style="background:#f8f9fa;border:1px solid #e5e7eb;border-radius:12px;padding:8px 12px;font-size:12px;color:#374151;font-weight:600;display:flex;align-items:center;gap:6px;cursor:pointer;">' +
      '        <img src="/assets/icons/write.svg" style="width:14px;height:14px;" alt="">' +
      '        <span>' + (state.address.driver_note ? 'Edit Catatan Driver' : '+ Catatan Driver') + '</span>' +
      '      </button>' +
      '    </div>' +
      '  </div>' : '') +

      // 4. Cart Items Review Card
      '  <div class="x-card" style="background:#fff;margin:12px 14px;padding:16px;border-radius:18px;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      '    <div style="font-size:14px;font-weight:800;color:#111;margin-bottom:12px;">Pesanan Kamu</div>' +
      '    <div id="x-checkout-items-list">' + renderItemsHtml(items) + '</div>' +
      '    <div style="margin-top:12px;text-align:center;">' +
      '      <button type="button" id="x-btn-add-more-menu" style="background:#f8f9fa;border:1px solid #e5e7eb;border-radius:20px;padding:8px 20px;font-size:13px;font-weight:700;color:#111;cursor:pointer;">+ Tambah Menu Lainnya</button>' +
      '    </div>' +
      '  </div>' +

      // 5. Upsell Recommendations Carousel
      '  <div id="x-upsell-container" style="margin:16px 14px;"></div>' +

      // 6. Payment Method & Summary Card
      '  <div class="x-card" style="background:#fff;margin:12px 14px;padding:16px;border-radius:18px;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      '    <div style="font-size:14px;font-weight:800;color:#111;margin-bottom:12px;">Metode Pembayaran</div>' +
      '    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px;">' +
      '      <button type="button" class="x-pay-opt ' + (state.paymentMethod === 'cash' ? 'active' : '') + '" id="x-opt-cash" style="background:' + (state.paymentMethod === 'cash' ? '#f7ffd9;border:2px solid #b6ff00' : '#fff;border:1.5px solid #e5e7eb') + ';border-radius:14px;padding:12px;display:flex;align-items:center;gap:8px;cursor:pointer;">' +
      '        <img src="/assets/icons/cashblack.svg" style="width:22px;height:22px;" alt="">' +
      '        <div style="text-align:left;"><strong style="display:block;font-size:13px;color:#111;">Tunai (COD)</strong><span style="font-size:11px;color:#6b7280;">Bayar di tempat</span></div>' +
      '      </button>' +
      '      <button type="button" class="x-pay-opt ' + (state.paymentMethod === 'midtrans' ? 'active' : '') + '" id="x-opt-online" style="background:' + (state.paymentMethod === 'midtrans' ? '#f7ffd9;border:2px solid #b6ff00' : '#fff;border:1.5px solid #e5e7eb') + ';border-radius:14px;padding:12px;display:flex;align-items:center;gap:8px;cursor:pointer;">' +
      '        <img src="/assets/icons/qrisblack.svg" style="width:22px;height:22px;" alt="">' +
      '        <div style="text-align:left;"><strong style="display:block;font-size:13px;color:#111;">Online Pay</strong><span style="font-size:11px;color:#6b7280;">QRIS / E-Wallet</span></div>' +
      '      </button>' +
      '    </div>' +

      // Price Breakdown Summary
      '    <div style="font-size:14px;font-weight:800;color:#111;margin-bottom:10px;">Ringkasan Pembayaran</div>' +
      '    <div style="display:flex;justify-content:space-between;font-size:13px;color:#6b7280;margin-bottom:6px;"><span>Harga (' + items.reduce(function (s, i) { return s + i.quantity; }, 0) + ' item)</span><span id="x-sum-subtotal">-</span></div>' +
      (isDelivery ? '<div style="display:flex;justify-content:space-between;font-size:13px;color:#6b7280;margin-bottom:6px;"><span>Biaya Pengantaran</span><span id="x-sum-delivery">-</span></div>' : '') +
      '    <div id="x-sum-discount-row" style="display:none;justify-content:space-between;font-size:13px;color:#ff4040;margin-bottom:6px;"><span>Diskon Promo</span><span id="x-sum-discount">-</span></div>' +
      '    <div style="height:1px;background:#e5e7eb;margin:10px 0;"></div>' +
      '    <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:800;color:#111;"><span>Total Pembayaran</span><span id="x-sum-total">-</span></div>' +
      '  </div>' +

      // Trust badge
      '  <div style="display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:#9ca3af;margin:16px 0;">' +
      '    <span>🔒 Transaksi aman &amp; terenkripsi oleh</span>' +
      '    <img src="/assets/icons/midtrans.svg" style="height:12px;" alt="Midtrans">' +
      '  </div>' +

      // 7. Sticky Bottom Submit Bar
      '  <div class="x-bottom-submit-bar" style="position:fixed;bottom:0;left:0;right:0;max-width:480px;margin:0 auto;background:#fff;padding:12px 18px max(12px, env(safe-area-inset-bottom));box-shadow:0 -4px 18px rgba(0,0,0,0.08);z-index:1000;">' +
      '    <button type="button" id="x-btn-submit-order" class="x-btn-lime" style="width:100%;height:52px;font-size:16px;font-weight:800;display:flex;align-items:center;justify-content:space-between;padding:0 20px;border-radius:26px;">' +
      '      <span id="x-submit-label">Bayar Sekarang</span>' +
      '      <span id="x-submit-amount" style="font-size:17px;">-</span>' +
      '    </button>' +
      '  </div>' +

      '</div>';

    bindEvents();
  }

  function renderItemsHtml(items) {
    var html = '';
    items.forEach(function (item) {
      var itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
      var img = item.image_url || item.image || '';

      html +=
        '<div class="x-checkout-item-row" style="display:grid;grid-template-columns:52px 1fr 70px;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid #f3f4f6;">' +
        '  <img src="' + (img || '/assets/pwa/icon-192.png') + '" style="width:52px;height:52px;border-radius:12px;object-fit:cover;background:#fafafa;" alt="">' +
        '  <div style="min-width:0;">' +
        '    <div style="font-size:14px;font-weight:700;color:#111;line-height:1.3;">' + UI.escape(item.name) + '</div>' +
        '    <div style="font-size:13px;font-weight:600;color:#16a34a;margin-top:2px;">' + UI.money(item.price) + '</div>' +
        (item.note ? '<div style="font-size:11.5px;color:#6b7280;margin-top:2px;">Catatan: ' + UI.escape(item.note) + '</div>' : '') +
        '  </div>' +
        '  <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;">' +
        '    <button type="button" data-minus-item="' + item.id + '" style="width:26px;height:26px;border-radius:50%;background:#f3f4f6;border:none;font-weight:bold;cursor:pointer;">−</button>' +
        '    <span style="font-size:13px;font-weight:700;min-width:14px;text-align:center;">' + item.quantity + '</span>' +
        '    <button type="button" data-plus-item="' + item.id + '" style="width:26px;height:26px;border-radius:50%;background:#b6ff00;border:none;font-weight:bold;cursor:pointer;">＋</button>' +
        '  </div>' +
        '</div>';
    });
    return html;
  }

  function calculateTotals() {
    var items = getCheckoutItems();
    var subtotal = items.reduce(function (sum, item) {
      return sum + (Number(item.price || 0) * Number(item.quantity || 0));
    }, 0);
    var isDelivery = state.fulfillment.type === 'delivery';

    // Base delivery calculation: 3000/km, free under 1km
    var fee = 0;
    if (isDelivery) {
      fee = state.distanceKm <= 1 ? 0 : Math.round((state.distanceKm - 1) * 3000);
    }
    state.deliveryFee = fee;

    // Promo discount if subtotal >= 50000 -> 5000 off
    var discount = 0;
    if (subtotal >= 50000) {
      discount = 5000;
    }
    state.promoDiscount = discount;

    var grandTotal = Math.max(0, subtotal + fee - discount);

    var subtotalEl = $('x-sum-subtotal');
    var deliveryEl = $('x-sum-delivery');
    var discountRow = $('x-sum-discount-row');
    var discountEl = $('x-sum-discount');
    var totalEl = $('x-sum-total');
    var submitAmountEl = $('x-submit-amount');

    if (subtotalEl) subtotalEl.textContent = UI.money(subtotal);
    if (deliveryEl) deliveryEl.textContent = fee === 0 ? 'GRATIS' : UI.money(fee);
    if (discountRow) discountRow.style.display = discount > 0 ? 'flex' : 'none';
    if (discountEl) discountEl.textContent = '−' + UI.money(discount);
    if (totalEl) totalEl.textContent = UI.money(grandTotal);
    if (submitAmountEl) submitAmountEl.textContent = UI.money(grandTotal);
  }

  // ======================================================================
  //  UPSELL CAROUSEL
  // ======================================================================
  function loadUpsell() {
    var container = $('x-upsell-container');
    if (!container) return;

    API.get('/catalog/upsell')
      .then(function (data) {
        if (data.success && Array.isArray(data.items) && data.items.length > 0) {
          upsellItems = data.items;
          renderUpsellHtml(container, upsellItems);
        }
      })
      .catch(function () {});
  }

  function renderUpsellHtml(container, items) {
    var cardsHtml = '';
    items.forEach(function (p) {
      cardsHtml +=
        '<div style="flex:0 0 140px;background:#fff;border-radius:14px;padding:10px;box-shadow:0 2px 10px rgba(0,0,0,0.05);display:flex;flex-direction:column;justify-content:space-between;">' +
        '  <div>' +
        '    <img src="' + (p.image_url || '/assets/pwa/icon-192.png') + '" style="width:100%;height:90px;object-fit:cover;border-radius:10px;" alt="">' +
        '    <div style="font-size:12.5px;font-weight:700;color:#111;margin-top:6px;line-height:1.2;">' + UI.escape(p.name) + '</div>' +
        '    <div style="font-size:12px;font-weight:700;color:#16a34a;margin-top:3px;">' + UI.money(p.price) + '</div>' +
        '  </div>' +
        '  <button type="button" data-add-upsell="' + p.id + '" style="width:100%;height:28px;background:#b6ff00;border:none;border-radius:14px;font-size:12px;font-weight:700;margin-top:8px;cursor:pointer;">+ Tambah</button>' +
        '</div>';
    });

    container.innerHTML =
      '<div style="font-size:14px;font-weight:800;color:#111;margin-bottom:10px;">Tambah Menu Pelengkap?</div>' +
      '<div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;scrollbar-width:none;">' + cardsHtml + '</div>';

    container.querySelectorAll('[data-add-upsell]').forEach(function (btn) {
      btn.onclick = function () {
        var pid = btn.dataset.addUpsell;
        var found = items.find(function (x) { return String(x.id) === String(pid); });
        if (found) {
          Store.addItem(found, 1);
          mount();
          UI.toast(found.name + ' ditambahkan!');
        }
      };
    });
  }

  // ======================================================================
  //  EVENTS & SHEETS
  // ======================================================================
  function bindEvents() {
    // Back to menu
    var backBtn = $('x-checkout-back-btn');
    if (backBtn) backBtn.onclick = function () { Router.navigate('home'); };

    var addMoreBtn = $('x-btn-add-more-menu');
    if (addMoreBtn) addMoreBtn.onclick = function () { Router.navigate('home'); };

    // Item quantity buttons
    bindItemEvents();

    // Fulfillment Sheet Trigger
    var fulfillmentCard = $('x-card-fulfillment');
    if (fulfillmentCard) fulfillmentCard.onclick = openFulfillmentSheet;

    // Address Change Trigger
    var changeAddressBtn = $('x-btn-change-address');
    if (changeAddressBtn) changeAddressBtn.onclick = openAddressSheet;

    // Driver Note Trigger
    var driverNoteBtn = $('x-btn-driver-note');
    if (driverNoteBtn) driverNoteBtn.onclick = openDriverNoteSheet;

    // Payment Option Buttons
    var optCash = $('x-opt-cash');
    var optOnline = $('x-opt-online');
    if (optCash) optCash.onclick = function () { setPaymentMethod('cash'); };
    if (optOnline) optOnline.onclick = function () { setPaymentMethod('midtrans'); };

    // Submit Order Button
    var submitBtn = $('x-btn-submit-order');
    if (submitBtn) submitBtn.onclick = submitOrder;
  }

  function setPaymentMethod(method) {
    state.paymentMethod = method;
    var optCash = $('x-opt-cash');
    var optOnline = $('x-opt-online');

    if (optCash) {
      optCash.style.background = method === 'cash' ? '#f7ffd9' : '#fff';
      optCash.style.border = method === 'cash' ? '2px solid #b6ff00' : '1.5px solid #e5e7eb';
    }
    if (optOnline) {
      optOnline.style.background = method === 'midtrans' ? '#f7ffd9' : '#fff';
      optOnline.style.border = method === 'midtrans' ? '2px solid #b6ff00' : '1.5px solid #e5e7eb';
    }
  }

  // ======================================================================
  //  FULFILLMENT & TIME WHEEL SHEET
  // ======================================================================
  function openFulfillmentSheet() {
    var overlay = document.createElement('div');
    overlay.className = 'x-overlay open';
    overlay.innerHTML =
      '<div class="x-sheet open" style="max-height:85vh;border-radius:24px 24px 0 0;background:#fff;padding:20px 18px 30px;">' +
      '  <div class="x-sheet-handle" style="width:42px;height:4px;background:#e5e7eb;border-radius:10px;margin:0 auto 18px;"></div>' +
      '  <h3 style="font-size:17px;font-weight:800;color:#111;margin:0 0 16px;text-align:center;">Pilih Tipe Pembelian</h3>' +

      // Type Selector
      '  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">' +
      '    <button type="button" id="x-sheet-pick-del" style="background:' + (state.fulfillment.type === 'delivery' ? '#f7ffd9;border:2px solid #b6ff00' : '#fff;border:1.5px solid #e5e7eb') + ';border-radius:16px;padding:14px;display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;">' +
      '      <img src="/assets/icons/delivery.png" style="width:40px;height:40px;" alt="">' +
      '      <strong style="font-size:14px;color:#111;">Delivery</strong>' +
      '    </button>' +
      '    <button type="button" id="x-sheet-pick-pickup" style="background:' + (state.fulfillment.type === 'pickup' ? '#f7ffd9;border:2px solid #b6ff00' : '#fff;border:1.5px solid #e5e7eb') + ';border-radius:16px;padding:14px;display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;">' +
      '      <img src="/assets/icons/pick_up.png" style="width:40px;height:40px;" alt="">' +
      '      <strong style="font-size:14px;color:#111;">Pick-up</strong>' +
      '    </button>' +
      '  </div>' +

      // Time Slot Selector
      '  <div style="font-size:14px;font-weight:800;color:#111;margin-bottom:10px;">Waktu Pengambilan / Antar</div>' +
      '  <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px;">' +
      '    <label style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#f8f9fa;border-radius:12px;cursor:pointer;">' +
      '      <input type="radio" name="time_opt" value="now" checked style="accent-color:#111;">' +
      '      <div><strong style="display:block;font-size:13.5px;color:#111;">Sekarang</strong><span style="font-size:11.5px;color:#6b7280;">Estimasi 15–25 menit</span></div>' +
      '    </label>' +
      '    <label style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#f8f9fa;border-radius:12px;cursor:pointer;">' +
      '      <input type="radio" name="time_opt" value="schedule" style="accent-color:#111;">' +
      '      <div><strong style="display:block;font-size:13.5px;color:#111;">Jadwalkan Jam Tertentu</strong><span style="font-size:11.5px;color:#6b7280;">Pilih slot waktu hari ini</span></div>' +
      '    </label>' +
      '  </div>' +

      '  <button type="button" id="x-btn-save-fulfillment" class="x-btn-lime" style="width:100%;height:48px;font-size:15px;font-weight:800;">Simpan Pilihan</button>' +
      '</div>';

    document.body.appendChild(overlay);

    var selType = state.fulfillment.type;
    var btnDel = overlay.querySelector('#x-sheet-pick-del');
    var btnPickup = overlay.querySelector('#x-sheet-pick-pickup');

    btnDel.onclick = function () {
      selType = 'delivery';
      btnDel.style.background = '#f7ffd9';
      btnDel.style.border = '2px solid #b6ff00';
      btnPickup.style.background = '#fff';
      btnPickup.style.border = '1.5px solid #e5e7eb';
    };

    btnPickup.onclick = function () {
      selType = 'pickup';
      btnPickup.style.background = '#f7ffd9';
      btnPickup.style.border = '2px solid #b6ff00';
      btnDel.style.background = '#fff';
      btnDel.style.border = '1.5px solid #e5e7eb';
    };

    overlay.querySelector('#x-btn-save-fulfillment').onclick = function () {
      state.fulfillment.type = selType;
      var isSched = overlay.querySelector('input[name="time_opt"]:checked').value === 'schedule';
      state.fulfillment.timeSlot = isSched ? 'Jadwal Hari Ini: 18:00–18:30' : 'Sekarang (15–25 mnt)';
      overlay.remove();
      mount();
    };

    overlay.onclick = function (e) {
      if (e.target === overlay) overlay.remove();
    };
  }

  // ======================================================================
  //  ADDRESS MODAL & DRIVER NOTE
  // ======================================================================
  function openAddressSheet() {
    var overlay = document.createElement('div');
    overlay.className = 'x-overlay open';
    overlay.innerHTML =
      '<div class="x-sheet open" style="max-height:85vh;border-radius:24px 24px 0 0;background:#fff;padding:20px 18px 30px;">' +
      '  <div class="x-sheet-handle" style="width:42px;height:4px;background:#e5e7eb;border-radius:10px;margin:0 auto 18px;"></div>' +
      '  <h3 style="font-size:17px;font-weight:800;color:#111;margin:0 0 16px;">Ubah Alamat Pengantaran</h3>' +
      '  <input type="text" id="x-input-address-search" placeholder="Cari nama jalan / perumahan / patokan..." style="width:100%;height:44px;padding:0 14px;border:1.5px solid #e5e7eb;border-radius:12px;font-size:14px;margin-bottom:14px;outline:none;" value="' + UI.escape(state.address.formatted_address) + '">' +
      '  <div style="font-size:12px;color:#6b7280;margin-bottom:16px;">📍 Geser pin lokasi peta atau ketik alamat lengkapmu.</div>' +
      '  <button type="button" id="x-btn-save-address" class="x-btn-lime" style="width:100%;height:48px;font-size:15px;font-weight:800;">Simpan Alamat</button>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.querySelector('#x-btn-save-address').onclick = function () {
      var val = overlay.querySelector('#x-input-address-search').value.trim();
      if (val) state.address.formatted_address = val;
      overlay.remove();
      mount();
    };

    overlay.onclick = function (e) {
      if (e.target === overlay) overlay.remove();
    };
  }

  function openDriverNoteSheet() {
    var overlay = document.createElement('div');
    overlay.className = 'x-overlay open';
    overlay.innerHTML =
      '<div class="x-sheet open" style="max-height:80vh;border-radius:24px 24px 0 0;background:#fff;padding:20px 18px 30px;">' +
      '  <div class="x-sheet-handle" style="width:42px;height:4px;background:#e5e7eb;border-radius:10px;margin:0 auto 18px;"></div>' +
      '  <h3 style="font-size:17px;font-weight:800;color:#111;margin:0 0 14px;">Catatan untuk Driver</h3>' +
      '  <textarea id="x-input-driver-note" placeholder="Contoh: Rumah pagar hitam samping pos satpam, titip di teras saja..." style="width:100%;height:100px;padding:12px;border:1.5px solid #e5e7eb;border-radius:14px;font-size:13.5px;outline:none;resize:none;margin-bottom:16px;">' + UI.escape(state.address.driver_note) + '</textarea>' +
      '  <button type="button" id="x-btn-save-driver-note" class="x-btn-lime" style="width:100%;height:48px;font-size:15px;font-weight:800;">Simpan Catatan</button>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.querySelector('#x-btn-save-driver-note').onclick = function () {
      state.address.driver_note = overlay.querySelector('#x-input-driver-note').value.trim();
      overlay.remove();
      mount();
    };

    overlay.onclick = function (e) {
      if (e.target === overlay) overlay.remove();
    };
  }

  // ======================================================================
  //  SUBMIT ORDER FLOW
  // ======================================================================
  function submitOrder() {
    if (state.isSubmitting) return;

    var items = Store.getState().cart.items || [];
    if (!items.length) {
      UI.toast('Keranjang belanja kosong!');
      return;
    }

    state.isSubmitting = true;
    var submitBtn = $('x-btn-submit-order');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.7';
      $('x-submit-label').textContent = 'Memproses Pesanan...';
    }

    var payload = {
      customer_name: state.customer.name,
      customer_phone: state.customer.phone || '081234567890',
      fulfillment_type: state.fulfillment.type,
      payment_method: state.paymentMethod,
      address_text: state.fulfillment.type === 'delivery' ? state.address.formatted_address : 'Ambil di Restoran',
      latitude: state.address.latitude,
      longitude: state.address.longitude,
      driver_note: state.address.driver_note,
      items: items.map(function (i) {
        return {
          product_id: i.id,
          product_name: i.name,
          quantity: i.quantity,
          price: i.price,
          note: i.note || ''
        };
      })
    };

    API.post('/checkout/submit', payload)
      .then(function (res) {
        state.isSubmitting = false;
        if (res.success && res.order) {
          var orderId = res.order.id;
          if (currentItemId) {
            Store.removeItem(currentItemId);
          } else {
            Store.clearCart();
          }

          if (state.paymentMethod === 'midtrans' && res.snap_token) {
            // Online Midtrans Snap popup
            if (window.snap && window.snap.pay) {
              window.snap.pay(res.snap_token, {
                onSuccess: function () { Router.navigate('order-received', { orderId: orderId }); },
                onPending: function () { Router.navigate('order-received', { orderId: orderId }); },
                onError: function () { Router.navigate('order-received', { orderId: orderId }); },
                onClose: function () { Router.navigate('order-received', { orderId: orderId }); }
              });
            } else {
              Router.navigate('order-received', { orderId: orderId });
            }
          } else {
            // Direct Cash confirmation
            Router.navigate('order-received', { orderId: orderId });
          }
        } else {
          alert('Gagal membuat pesanan: ' + (res.error || 'Terjadi kesalahan.'));
          mount();
        }
      })
      .catch(function (err) {
        state.isSubmitting = false;
        alert('Gagal memproses pesanan: ' + err.message);
        mount();
      });
  }

  function bindItemEvents() {
    if (!checkoutContainer) return;
    checkoutContainer.querySelectorAll('[data-plus-item]').forEach(function (btn) {
      btn.onclick = function () {
        var item = Store.findCartItem(btn.dataset.plusItem);
        if (item) {
          Store.setQty(item.id, item.quantity + 1);
        }
      };
    });

    checkoutContainer.querySelectorAll('[data-minus-item]').forEach(function (btn) {
      btn.onclick = function () {
        var item = Store.findCartItem(btn.dataset.minusItem);
        if (item) {
          Store.setQty(item.id, item.quantity - 1);
        }
      };
    });
  }

  // Subscribe to store updates for real-time 2-way sync
  Store.subscribe(function () {
    if (checkoutContainer && checkoutContainer.style.display !== 'none' && !state.isSubmitting) {
      var items = getCheckoutItems();
      if (!items.length) {
        renderEmpty();
      } else {
        var listEl = $('x-checkout-items-list');
        if (listEl) {
          listEl.innerHTML = renderItemsHtml(items);
          bindItemEvents();
        }
        calculateTotals();
      }
    }
  });

  // Export
  window.Xentra = window.Xentra || {};
  window.Xentra.Checkout = {
    mount: mount
  };
})();