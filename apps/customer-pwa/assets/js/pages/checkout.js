/**
 * Xentra Customer PWA — Checkout Controller
 * Pixel-perfect implementation conforming to Xentra-Core Architecture & Locked Decisions.
 * 
 * Features:
 * 1. 4 Order Types: Delivery (now/scheduled), Pick-up, Dine-in (table context), Reservation (min. tomorrow, same-day rejected)
 * 2. Customer Identity: WhatsApp OTP authentication & verified session binding
 * 3. Pre-Payment Verification Gate: Realtime price/stock check with "Ada perubahan di pesananmu, cek dulu yuk" modal
 * 4. Dual Payment: Tunai (COD / Bayar di Kasir) & Online Payment (Midtrans Snap)
 * 5. PWA Install Incentive: Es Teh Gratis Rp0 (promo-es-teh-gratis)
 * 6. Add-on recommendation rail (GET /catalog/menu)
 */
(function () {
  'use strict';

  var API = window.Xentra && window.Xentra.API;
  var Store = window.Xentra.Store;
  var UI = window.Xentra.UI;
  var Router = window.Xentra.Router;

  var checkoutContainer = null;
  var upsellItems = [];
  var availableBranches = [];
  var currentItemId = null;

  var state = {
    fulfillment: {
      type: 'delivery', // 'delivery' | 'pickup' | 'dinein' (mapped to dine_in) | 'reservation'
      scheduled: false,
      date: 'Hari Ini',
      timeSlot: '12.00 - 12.30',
      typeLabel: 'Delivery',
      note: '',
      tableNumber: '',
      reservationDate: '',
      reservationTime: '12:00',
      guestCount: 2
    },
    customer: {
      name: 'Pelanggan Bangjo',
      phone: '',
      isVerified: false
    },
    address: {
      label: 'Rumah',
      formatted_address: 'Jl. Dewi 18, Panjang, Bandar Lampung 35241',
      detail: '',
      latitude: -7.2912,
      longitude: 112.7154
    },
    deliveryFee: 0,
    discount: 0,
    matchedBranch: null,
    deliveryQuote: null,
    paymentMethod: 'cash',
    isSubmitting: false
  };

  // ── Helper formatters ──
  function $(id) { return document.getElementById(id); }
  function fmtIDR(n) { return (Number(n) || 0).toLocaleString('id-ID'); }

  // ── PWA Install Detection Logic ──
  var deferredPrompt = null;
  var isIosPwa = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  function checkIsPwaInstalled() {
    if (window.Xentra && window.Xentra.PwaRuntime) {
      return window.Xentra.PwaRuntime.getPwaRuntimeContext().display_mode === 'standalone';
    }
    return Boolean(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  var isPwaInstalled = checkIsPwaInstalled();
  var promoEvaluation = { discovery: [], applied: [], rejected: [] };

  function loadActivePromotions() {
    if (!API) return Promise.resolve(promoEvaluation);
    var isPwa = checkIsPwaInstalled();
    var phone = state.customer.phone || '';
    return API.get('/promotions/active?is_pwa=' + (isPwa ? '1' : '0') + '&phone=' + encodeURIComponent(phone))
      .then(function (res) {
        if (res && res.success) {
          promoEvaluation = {
            discovery: Array.isArray(res.promotions) ? res.promotions : [],
            applied: Array.isArray(res.applied) ? res.applied : [],
            rejected: Array.isArray(res.rejected) ? res.rejected : []
          };
        }
        return promoEvaluation;
      }).catch(function () { return promoEvaluation; });
  }

  function getBannerPromo() {
    var p = promoEvaluation.discovery.find(function (p) { return p.should_show_banner === true; });
    return p || null;
  }

  function getAppliedRewardPromo() {
    var p = promoEvaluation.applied.find(function (p) { return p.should_grant_reward === true && p.reward; });
    return p || null;
  }

  function getPromoBannerHtml(items) {
    var bannerPromo = getBannerPromo();
    var rewardPromo = getAppliedRewardPromo();

    if (bannerPromo && bannerPromo.display) {
      var b = bannerPromo.display;
      return (
        '  <div class="x-alt-promo-banner" id="x-promo-banner">' +
        '    <img class="x-alt-promo-img" src="' + UI.escape(b.icon_url || '/assets/pwa/icon-192.png') + '" alt="" onerror="this.style.display=\'none\'">' +
        '    <div class="x-alt-promo-copy"><div class="x-alt-promo-title">' + UI.escape(b.banner_title || 'Promo Menarik') + '</div><div class="x-alt-promo-snk">' + UI.escape(b.banner_subtitle || '') + '</div></div>' +
        '    <button type="button" class="x-alt-promo-install" id="x-btn-promo-install">Install</button>' +
        '  </div>'
      );
    } else if (rewardPromo && rewardPromo.display) {
      var r = rewardPromo.display;
      var rewardItemId = 'reward_' + (rewardPromo.reward ? (rewardPromo.reward.promo_id || rewardPromo.promo_id) : rewardPromo.promo_id);
      var hasRewardInCart = (items || []).some(function (i) {
        return String(i.id) === rewardItemId ||
               String(i.id).indexOf('reward_') === 0 ||
               Boolean(i.is_promo_reward) ||
               Number(i.price || 0) === 0;
      });

      if (hasRewardInCart) {
        return (
          '  <div class="x-alt-promo-banner" id="x-welcome-reward-banner" style="background:#f0fdf4;border:1px solid #bbf7d0;box-shadow:0 2px 10px rgba(22,163,74,0.06);">' +
          '    <img class="x-alt-promo-img" src="' + UI.escape(r.icon_url || '/assets/pwa/icon-192.png') + '" alt="" onerror="this.style.display=\'none\'">' +
          '    <div class="x-alt-promo-copy"><div class="x-alt-promo-title" style="color:#15803d;font-size:13px;line-height:1.35;font-weight:700;">' + UI.escape(r.reward_title || 'Bonus Spesial') + '</div><div class="x-alt-promo-snk" style="color:#16a34a;font-weight:600;">✓ Hadiah telah masuk ke keranjang</div></div>' +
          '  </div>'
        );
      } else {
        return (
          '  <div class="x-alt-promo-banner" id="x-welcome-reward-banner">' +
          '    <img class="x-alt-promo-img" src="' + UI.escape(r.icon_url || '/assets/pwa/icon-192.png') + '" alt="" onerror="this.style.display=\'none\'">' +
          '    <div class="x-alt-promo-copy"><div class="x-alt-promo-title">' + UI.escape(r.claim_title || 'Klaim Es Teh Gratis untuk pesanan pertamamu!') + '</div><div class="x-alt-promo-snk">' + UI.escape(r.claim_subtitle || 'syarat & ketentuan berlaku') + '</div></div>' +
          '    <button type="button" class="x-alt-promo-install" id="x-btn-promo-claim">Claim</button>' +
          '  </div>'
        );
      }
    }
    return '';
  }

  function renderPromoBanner() {
    var slot = $('x-promo-slot');
    if (!slot) return;
    var items = getCheckoutItems();
    slot.innerHTML = getPromoBannerHtml(items);
    var promoBtn = $('x-btn-promo-install'); if (promoBtn) promoBtn.onclick = handleInstallClick;
    var claimBtn = $('x-btn-promo-claim');
    if (claimBtn) {
      claimBtn.onclick = function () {
        var rewardPromo = getAppliedRewardPromo();
        if (rewardPromo && rewardPromo.reward) {
          var rew = rewardPromo.reward;
          var rewardItemId = 'reward_' + (rew.promo_id || rewardPromo.promo_id);
          Store.addItem({
            id: rewardItemId,
            name: (rewardPromo.display && rewardPromo.display.reward_title) || 'Hadiah Promo',
            price: Number(rew.reward_price || 0),
            regular_price: 5000,
            image_url: (rewardPromo.display && rewardPromo.display.icon_url) || '/assets/pwa/icon-192.png',
            description: (rewardPromo.display && rewardPromo.display.reward_title) || 'Hadiah Promo'
          }, 1);
          var rowsEl = $('x-checkout-items-rows') || $('x-checkout-items-list');
          if (rowsEl) {
            rowsEl.innerHTML = renderItemsHtml(getCheckoutItems());
            bindItemEvents();
          }
          calculateTotals();
          refreshDeliveryQuote();
          renderPromoBanner();
        }
      };
    }
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    isPwaInstalled = true;
    var banner = document.getElementById('x-promo-banner');
    if (banner) banner.style.display = 'none';
    if (UI && UI.toast) UI.toast('Aplikasi berhasil dipasang!');
    loadActivePromotions().then(function () {
      renderPromoBanner();
    });
  });

  function showPwaGuideSheet(platform) {
    var existing = document.getElementById('x-pwa-guide-overlay');
    if (existing) existing.remove();

    var isIos = platform === 'ios';
    var steps = isIos ? (
      '<div class="x-pwa-guide-step"><div class="x-pwa-step-badge">1</div><div class="x-pwa-step-body"><strong>Ketuk tombol Bagikan (Share)</strong><span>Cari ikon Share (kotak panah ke atas) di bilah bawah Safari.</span></div></div>' +
      '<div class="x-pwa-guide-step"><div class="x-pwa-step-badge">2</div><div class="x-pwa-step-body"><strong>Pilih "Tambah ke Layar Utama"</strong><span>Gulir menu dan pilih <b>Add to Home Screen</b>.</span></div></div>' +
      '<div class="x-pwa-guide-step"><div class="x-pwa-step-badge">3</div><div class="x-pwa-step-body"><strong>Ketuk "Tambah" (Add)</strong><span>Tekan tombol <b>Tambah</b> di pojok kanan atas.</span></div></div>'
    ) : (
      '<div class="x-pwa-guide-step"><div class="x-pwa-step-badge">1</div><div class="x-pwa-step-body"><strong>Buka Menu Browser</strong><span>Ketuk ikon titik tiga (⋮) di pojok kanan atas Chrome.</span></div></div>' +
      '<div class="x-pwa-guide-step"><div class="x-pwa-step-badge">2</div><div class="x-pwa-step-body"><strong>Pilih "Install Aplikasi"</strong><span>Pilih <b>Install Aplikasi</b> atau <b>Tambahkan ke Layar Utama</b>.</span></div></div>' +
      '<div class="x-pwa-guide-step"><div class="x-pwa-step-badge">3</div><div class="x-pwa-step-body"><strong>Konfirmasi Pasang</strong><span>Tekan <b>Install</b> saat dialog konfirmasi muncul.</span></div></div>'
    );

    var promo = getBannerPromo() || getAppliedRewardPromo();
    var icon = (promo && promo.display && promo.display.icon_url) || '/assets/pwa/icon-192.png';
    var html =
      '<div class="x-pwa-guide-backdrop"></div>' +
      '<div class="x-pwa-guide-sheet">' +
      '  <div class="x-sheet-handle" style="margin-bottom:12px;"></div>' +
      '  <div class="x-pwa-guide-head"><img src="' + icon + '" alt="Bangjo" class="x-pwa-guide-icon"><div><h3>Pasang Aplikasi Bangjo</h3><p>Nikmati gratis es teh & kemudahan order</p></div></div>' +
      '  <div class="x-pwa-guide-steps">' + steps + '</div>' +
      '  <button type="button" id="x-pwa-guide-close" class="x-pwa-guide-close-btn">Mengerti, Saya Pasang</button>' +
      '</div>';

    var overlay = document.createElement('div');
    overlay.id = 'x-pwa-guide-overlay';
    overlay.className = 'x-pwa-guide-overlay';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    requestAnimationFrame(function () {
      overlay.classList.add('open');
    });

    function closeGuide() {
      overlay.classList.remove('open');
      setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 280);
    }

    var bg = overlay.querySelector('.x-pwa-guide-backdrop');
    var btn = overlay.querySelector('#x-pwa-guide-close');
    if (bg) bg.addEventListener('click', closeGuide);
    if (btn) btn.addEventListener('click', closeGuide);
  }

  function handleInstallClick(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();

    if (checkIsPwaInstalled()) {
      if (UI && UI.toast) UI.toast('Aplikasi sudah terpasang di perangkat Anda.');
      return;
    }

    var promptEvent = window.__xentra_deferred_prompt || deferredPrompt;

    if (promptEvent) {
      promptEvent.prompt();
      promptEvent.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted') {
          try { localStorage.setItem('xentra_pwa_installed', '1'); } catch (_) {}
          if (UI && UI.toast) UI.toast('Terima kasih telah memasang aplikasi!');
        }
        window.__xentra_deferred_prompt = null;
        deferredPrompt = null;
      }).catch(function () {
        showPwaGuideSheet(isIosPwa ? 'ios' : 'android');
      });
      return;
    }

    showPwaGuideSheet(isIosPwa ? 'ios' : 'android');
  }

  // Delegated install click listener on document for 100% reliable tap response
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('#x-btn-promo-install');
    if (btn) {
      handleInstallClick(e);
    }
  });

  function getCheckoutItems() {
    var all = (Store.getState().cart.items || []);
    if (!currentItemId) return all;
    return all.filter(function (i) { return String(i.id) === String(currentItemId); });
  }

  // ── Mount ──
  function mount(container) {
    checkoutContainer = container || $('xentra-checkout-view');
    if (!checkoutContainer) return;

    var urlItemId = Router && Router.getItemIdFromUrl ? Router.getItemIdFromUrl() : null;
    if (urlItemId) currentItemId = String(urlItemId);

    // Restore customer session from Store
    var storeState = Store.getState();
    if (storeState.customerSession) {
      state.customer.phone = storeState.customerSession.phone || '';
      state.customer.name = storeState.customerSession.name || state.customer.name;
      state.customer.isVerified = true;
    }

    // Restore location
    var savedLoc = storeState.location;
    if (savedLoc && savedLoc.formatted_address) {
      state.address.formatted_address = savedLoc.formatted_address;
      if (savedLoc.latitude) state.address.latitude = savedLoc.latitude;
      if (savedLoc.longitude) state.address.longitude = savedLoc.longitude;
      if (savedLoc.label) state.address.label = savedLoc.label;
      if (savedLoc.detail) state.address.detail = savedLoc.detail;
    }

    // Restore order type
    if (storeState.orderType) {
      state.fulfillment.type = storeState.orderType;
    }

    // Load available branches & active promotions (targeted update, zero blinking)
    loadBranches();
    loadActivePromotions().then(function () {
      renderPromoBanner();
    });

    // Subscribe to Store updates (Reactivity on cart item changes/deletions)
    Store.subscribe(function () {
      var activeItems = getCheckoutItems();
      if (!activeItems.length && state.fulfillment.type !== 'reservation') {
        renderEmpty();
        return;
      }
      var rowsEl = $('x-checkout-items-rows');
      if (rowsEl) {
        rowsEl.innerHTML = renderItemsHtml(activeItems);
        bindItemEvents();
      }
      calculateTotals();
    });

    var items = getCheckoutItems();
    if (!items.length && state.fulfillment.type !== 'reservation') {
      renderEmpty();
      return;
    }

    renderLayout();
    calculateTotals();
    loadUpsell();
    refreshDeliveryQuote();
  }

  function loadBranches() {
    if (!API) return;
    API.get('/brand/branches').then(function (res) {
      if (res && res.success && Array.isArray(res.branches)) {
        availableBranches = res.branches;
        if (!state.matchedBranch && availableBranches.length > 0) {
          state.matchedBranch = availableBranches[0];
        }
      }
    }).catch(function () {});
  }

  // ── Delivery quote calculation via BranchMatcher ──
  function refreshDeliveryQuote() {
    if (!API) return;
    var isDelivery = state.fulfillment.type === 'delivery';
    if (!isDelivery) {
      state.deliveryFee = 0;
      state.discount = 0;
      state.deliveryQuote = null;
      calculateTotals();
      return;
    }

    var items = getCheckoutItems();
    var subtotal = items.reduce(function (s, i) { return s + Number(i.price || 0) * Number(i.quantity || 0); }, 0);

    API.post('/delivery/match-branch', {
      latitude: state.address.latitude,
      longitude: state.address.longitude,
      subtotal: subtotal
    }).then(function (res) {
      if (res && res.eligible && res.delivery) {
        state.matchedBranch = res.branch || null;
        state.deliveryQuote = res.delivery;
        state.deliveryFee = Number(res.delivery.final_delivery_fee || 0);
        state.discount = Number(res.delivery.discount_amount || 0);
        try { Store.setMatchedBranch(res); } catch (_) {}
      } else if (res && !res.eligible) {
        state.deliveryFee = 0;
        state.discount = 0;
        state.deliveryQuote = res.delivery || null;
        if (UI && UI.toast) UI.toast(res.reason || 'Alamat di luar jangkauan pengantaran.');
      }
      calculateTotals();
    }).catch(function () {
      calculateTotals();
    });
  }

  function renderEmpty() {
    checkoutContainer.innerHTML =
      '<div class="xentra-checkout x-checkout-alt2">' +
      '  <div class="x-alt-header"><button type="button" id="x-back-empty" class="x-alt-back" aria-label="Kembali"><img src="/assets/icons/arrowback.svg" alt=""></button><span>Checkout Pesanan</span></div>' +
      '  <div style="text-align:center;padding:56px 20px;">' +
      '    <div style="font-size:48px;margin-bottom:12px;">🛒</div>' +
      '    <div style="font-weight:800;font-size:18px;color:#111;margin-bottom:6px;">Keranjang Masih Kosong</div>' +
      '    <div style="font-size:13px;color:#6b7280;margin-bottom:20px;">Pilih menu favoritmu terlebih dahulu untuk melanjutkan pemesanan.</div>' +
      '    <button type="button" id="x-btn-browse-empty" class="x-alt-submit-btn" style="max-width:260px;margin:0 auto;">Lihat Menu Spesial</button>' +
      '  </div>' +
      '</div>';
    var b1 = $('x-back-empty'); if (b1) b1.onclick = function () { Router.navigate('home'); };
    var b2 = $('x-btn-browse-empty'); if (b2) b2.onclick = function () { Router.navigate('home'); };
  }

  // ── Render Main Layout ──
  function renderLayout() {
    var items = getCheckoutItems();
    var fulType = state.fulfillment.type;
    var isDelivery = fulType === 'delivery';
    var isReservation = fulType === 'reservation';
    var isDineIn = fulType === 'dinein' || fulType === 'dine_in';
    var isPickup = fulType === 'pickup';

    var subtotal = items.reduce(function (s, i) { return s + Number(i.price || 0) * Number(i.quantity || 0); }, 0);
    var fee = isDelivery ? state.deliveryFee : 0;
    var discount = isDelivery ? state.discount : 0;
    var grand = Math.max(0, subtotal + fee - discount);
    var oldTotal = subtotal + fee;

    // Fulfillment subtitle & info
    var fulTitle = 'Delivery';
    var fulSub = 'Hari ini | ' + state.fulfillment.timeSlot;
    var fulIcon = '/assets/icons/delivery.png';

    if (isPickup) {
      fulTitle = 'Pick-up (Ambil Sendiri)';
      var bName = state.matchedBranch ? state.matchedBranch.name : 'Pilih Cabang';
      fulSub = 'Ambil di ' + bName;
      fulIcon = '/assets/icons/pick_up.png';
    } else if (isDineIn) {
      fulTitle = 'Makan di Tempat (Dine-in)';
      fulSub = state.fulfillment.tableNumber ? ('Nomor Meja: ' + state.fulfillment.tableNumber) : 'Belum input nomor meja';
      fulIcon = '/assets/icons/dine_in.png';
    } else if (isReservation) {
      fulTitle = 'Reservasi Meja';
      var rDate = state.fulfillment.reservationDate || 'Pilih tanggal';
      var rTime = state.fulfillment.reservationTime || '12:00';
      var rGuests = state.fulfillment.guestCount || 2;
      fulSub = rDate + ' • ' + rTime + ' (' + rGuests + ' Orang)';
      fulIcon = '/assets/icons/info_green.svg';
    }

    var customerName = state.customer.name || 'Pelanggan';
    var customerPhone = state.customer.phone || '';
    var isPhoneVerified = state.customer.isVerified && !!customerPhone;

    checkoutContainer.innerHTML =
      '<div class="xentra-checkout x-checkout-alt2">' +

      // 1. Header
      '  <div class="x-alt-header"><button type="button" id="x-checkout-back" class="x-alt-back" aria-label="Kembali"><img src="/assets/icons/arrowback.svg" alt=""></button><span>Checkout Pesanan</span></div>' +

      // 2. Dynamic Promo Presentation (Slot for zero-blink targeted updates)
      '  <div id="x-promo-slot">' + getPromoBannerHtml(items) + '</div>' +

      // 3. Customer Identity Card (Phone & WhatsApp OTP status)
      '  <div class="x-card x-alt-customer-card" id="x-card-customer" style="margin:0 14px 10px;padding:16px;border-radius:18px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.04);">' +
      '    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
      '      <div style="font-size:14px;font-weight:700;color:#111;">Data Pemesan (WhatsApp)</div>' +
      '      <button type="button" class="x-pill-btn" id="x-btn-edit-customer">' + (customerPhone ? 'Ubah' : 'Isi Data') + '</button>' +
      '    </div>' +
      '    <div style="font-size:14px;font-weight:700;color:#111;">' + UI.escape(customerName) + '</div>' +
      '    <div style="font-size:12px;color:#777;margin-top:2px;display:flex;align-items:center;gap:6px;">' +
      '      <span>' + (customerPhone ? UI.escape(customerPhone) : 'Nomor WhatsApp belum diisi') + '</span>' +
      (isPhoneVerified ? '<span style="color:#16a34a;font-weight:700;font-size:11px;">✓ Terverifikasi</span>' : '') +
      '    </div>' +
      '  </div>' +

      // 4. Order Type / Fulfillment Selection Card
      '  <div class="x-card x-alt-delivery-card" id="x-card-fulfillment" style="margin:0 14px 10px;padding:16px;border-radius:18px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.04);">' +
      '    <div class="x-alt-card-top" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
      '      <div class="x-alt-icon-wrap" style="width:38px;height:38px;flex:0 0 38px;display:flex;align-items:center;justify-content:center;"><img src="' + fulIcon + '" alt="" style="width:36px;height:36px;object-fit:contain;"></div>' +
      '      <div class="x-alt-delivery-copy" style="flex:1 1 auto;min-width:0;">' +
      '        <div class="x-alt-delivery-type" style="font-size:14px;font-weight:700;color:#111;">' + UI.escape(fulTitle) + '</div>' +
      '        <div class="x-alt-delivery-time" style="font-size:12px;color:#777;margin-top:1px;">' + UI.escape(fulSub) + '</div>' +
      (state.fulfillment.note ? '<div class="x-alt-delivery-note" style="font-size:12px;color:#111;margin-top:2px;font-weight:600;">Catatan: ' + UI.escape(state.fulfillment.note) + '</div>' : '') +
      '      </div>' +
      '      <button type="button" class="x-pill-btn" id="x-btn-choose-fulfillment">Ubah</button>' +
      '    </div>' +
      '    <button type="button" class="x-note-button ' + (state.fulfillment.note ? 'has-note' : '') + '" id="x-btn-fulfillment-note" style="margin-top:12px;width:100%;"><img src="' + (state.fulfillment.note ? '/assets/icons/write.svg' : '/assets/icons/file.svg') + '" alt="" class="x-note-icon">Catatan Pengantaran/Meja</button>' +
      '  </div>' +

      // 5. Delivery Address Card (Only shown if fulfillment is delivery)
      (isDelivery ? (
        '  <div class="x-card x-alt-address-card" id="x-card-address" style="margin:0 14px 10px;padding:16px;border-radius:18px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.04);">' +
        '    <div class="x-alt-address-head" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;"><span style="font-size:14px;font-weight:700;color:#111;">Alamat Pengiriman</span><button type="button" class="x-pill-btn" id="x-btn-change-address">Pilih</button></div>' +
        '    <div class="x-alt-addr-label" style="font-size:13px;font-weight:700;color:#111;">' + UI.escape(state.address.label) + '</div>' +
        '    <div class="x-alt-addr-text" style="font-size:12px;color:#666;line-height:17px;margin-top:2px;">' + UI.escape(state.address.formatted_address) + '</div>' +
        (state.address.detail ? '<div class="x-alt-addr-note" style="font-size:12px;color:#777;margin-top:2px;">Patokan: ' + UI.escape(state.address.detail) + '</div>' : '') +
        '  </div>'
      ) : '') +

      // 6. Items & Upsell Unified Card (Hide or show empty for pure reservation)
      (!isReservation || items.length > 0 ? (
        '  <div class="x-card" id="x-items-card" style="margin:0 14px 10px;padding:16px 16px 14px;border-radius:18px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.04);min-width:0;max-width:calc(100% - 28px);overflow:hidden;box-sizing:border-box;">' +
        '    <div id="x-checkout-items-list" class="x-checkout-items" style="min-width:0;width:100%;max-width:100%;overflow:hidden;box-sizing:border-box;">' +
        '      <div id="x-checkout-items-rows">' + renderItemsHtml(items) + '</div>' +
        '      <div class="x-complement-section" id="x-upsell-container" style="margin-top:16px;padding-top:16px;border-top:1px solid #f0f0f0;min-width:0;width:100%;max-width:100%;overflow:hidden;box-sizing:border-box;">' +
        '        <div class="x-section-title" style="font-size:15px;font-weight:700;color:#111;margin:0 0 12px;">Tambah ini untuk melengkapi pesananmu</div>' +
        '        <div class="x-complement-track x-scroll-hide" id="x-addon-track" style="display:flex;flex-direction:row;flex-wrap:nowrap;gap:12px;overflow-x:auto;overflow-y:hidden;padding:4px 0 14px;margin:0;min-width:0;width:100%;max-width:100%;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;scrollbar-width:none;box-sizing:border-box;cursor:grab;">' +
        '          <div class="x-loading-inline">Memuat rekomendasi…</div>' +
        '        </div>' +
        '      </div>' +
        '    </div>' +
        '  </div>'
      ) : (
        '  <div class="x-card" style="margin:0 14px 10px;text-align:center;padding:24px 16px;border-radius:18px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.04);">' +
        '    <div style="font-size:32px;margin-bottom:8px;">📅</div>' +
        '    <div style="font-size:14px;font-weight:700;color:#111;">Reservasi Meja Restoran</div>' +
        '    <div style="font-size:12px;color:#6b7280;margin-top:4px;">Pesanan menu dapat dipilih langsung saat tiba di lokasi atau ditambahkan nanti.</div>' +
        '  </div>'
      )) +

      // 7. Payment Summary Card
      '  <div class="x-card x-alt-summary-card" id="x-payment-summary-card" style="margin:10px 14px 14px;padding:16px;border-radius:18px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.04);">' +
      '    <div class="x-alt-summary-title" style="font-size:15px;font-weight:700;color:#111;margin-bottom:12px;">Ringkasan Pembayaran</div>' +
      (!isReservation ? (
        '    <div class="x-alt-sum-row" style="display:flex;justify-content:space-between;font-size:13.5px;color:#555;padding:3px 0;"><span>Total Harga Menu</span><span id="x-sum-subtotal" style="font-weight:600;color:#111;">' + fmtIDR(subtotal) + '</span></div>' +
        (isDelivery ? '<div class="x-alt-sum-row" style="display:flex;justify-content:space-between;font-size:13.5px;color:#555;padding:3px 0;"><span>Biaya Ongkos Kirim</span><span id="x-sum-delivery" style="font-weight:600;color:#111;">' + fmtIDR(fee) + '</span></div>' : '') +
        (discount > 0 ? '<div class="x-alt-sum-row x-alt-discount-row" style="display:flex;justify-content:space-between;font-size:13.5px;color:#ff4040;padding:3px 0;"><span>Diskon Promo</span><span id="x-sum-discount" class="x-alt-discount" style="font-weight:700;">-' + fmtIDR(discount) + '</span></div>' : '') +
        '    <div class="x-alt-sum-divider" style="height:1px;background:#eee;margin:10px 0;"></div>' +
        '    <div class="x-alt-sum-total" style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;color:#111;"><span>Total Pembayaran</span><span>' + (oldTotal > grand ? '<s id="x-sum-oldtotal" class="x-alt-strike" style="color:#999;font-size:13px;margin-right:6px;">' + fmtIDR(oldTotal) + '</s>' : '') + '<b id="x-sum-total" style="color:#111;">' + fmtIDR(grand) + '</b></span></div>'
      ) : (
        '    <div class="x-alt-sum-row" style="display:flex;justify-content:space-between;font-size:13.5px;padding:3px 0;"><span>Biaya Booking Reservasi</span><span style="color:#16a34a;font-weight:700;">Gratis (Rp0)</span></div>'
      )) +
      '    <div class="x-alt-pay-methods" style="margin-top:14px;display:flex;flex-direction:column;gap:8px;">' +
      '      <button type="button" class="x-alt-pay-opt ' + (state.paymentMethod === 'cash' ? 'is-active' : '') + '" id="x-opt-cash" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid ' + (state.paymentMethod === 'cash' ? '#b6ff00' : '#e5e7eb') + ';border-radius:14px;background:' + (state.paymentMethod === 'cash' ? '#f7ffd9' : '#fff') + ';cursor:pointer;text-align:left;font-family:inherit;font-size:13px;font-weight:600;color:#111;"><img src="/assets/icons/cashblack.svg" alt="" style="width:22px;height:22px;object-fit:contain;flex-shrink:0;"><span>Tunai / Bayar di Tempat (COD / Kasir)</span></button>' +
      '      <button type="button" class="x-alt-pay-opt ' + (state.paymentMethod === 'midtrans' ? 'is-active' : '') + '" id="x-opt-online" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid ' + (state.paymentMethod === 'midtrans' ? '#b6ff00' : '#e5e7eb') + ';border-radius:14px;background:' + (state.paymentMethod === 'midtrans' ? '#f7ffd9' : '#fff') + ';cursor:pointer;text-align:left;font-family:inherit;font-size:13px;font-weight:600;color:#111;"><img src="/assets/icons/qrisgreen.svg" alt="" style="width:22px;height:22px;object-fit:contain;flex-shrink:0;"><span>Online Pay (QRIS / GoPay / ShopeePay / VA)</span></button>' +
      '    </div>' +
      '    <div class="x-alt-trust" style="font-size:11px;color:#888;text-align:center;margin-top:10px;"><span>🔒 Transaksi aman &amp; terenkripsi</span><span class="x-alt-trust-sep" style="margin:0 6px;">|</span><span>Diproses oleh <b>Midtrans</b></span></div>' +
      '  </div>' +

      // 8. Sticky Submit CTA Bar
      '  <div class="x-alt-cta-spacer" style="height:80px;"></div>' +
      '  <div class="x-alt-cta-bar" style="position:fixed;bottom:0;left:0;right:0;max-width:480px;margin:0 auto;padding:12px 14px max(12px,env(safe-area-inset-bottom));background:#fff;box-shadow:0 -4px 18px rgba(0,0,0,.08);z-index:1000;"><button type="button" id="x-btn-submit-order" class="x-alt-submit-btn" style="width:100%;height:50px;border-radius:32px;border:0;background:var(--x-lime,#b6ff00);color:#111;font-size:15px;font-weight:700;cursor:pointer;">' + (isReservation ? 'Konfirmasi Reservasi' : 'Pesan Sekarang') + '</button></div>' +

      '</div>';

    bindEvents();
    syncPayVisual();
    loadUpsell();
  }

  function renderItemsHtml(items) {
    if (!items.length) return '<div class="x-empty-state"><p>Keranjang kosong.</p></div>';
    var html = '';
    items.forEach(function (item) {
      var hasOld = item.regular_price && Number(item.regular_price) > Number(item.price);
      var img = item.image_url || item.image || '';
      var qty = Number(item.quantity || 1);
      var note = (state.notes && state.notes[item.id]) || item.note || '';
      var isPromoFreebie = Boolean(item.is_promo_reward || String(item.id).indexOf('reward_') === 0 || Number(item.price) === 0);

      html +=
        '<div class="x-product x-checkout-item" data-item-id="' + item.id + '">' +
        '  <div class="x-product-info">' +
        '    <div class="x-product-name">' + UI.escape(item.name || '') + '</div>' +
        (note ? '<div class="x-product-note-inline">Catatan : ' + UI.escape(note) + '</div>' : '') +
        '    <div class="x-price">' +
        (isPromoFreebie
          ? '<div class="x-old-price">' + fmtIDR(item.regular_price || 5000) + '</div><div class="x-current-price" style="color:#16a34a;">Gratis</div>'
          : (hasOld ? '<div class="x-old-price">' + fmtIDR(item.regular_price) + '</div>' : '') + '<div class="x-current-price">' + fmtIDR(item.price) + '</div>'
        ) +
        '    </div>' +
        (state.discount > 0 && state.fulfillment.type === 'delivery'
          ? '<div class="x-product-discount"><img src="/assets/icons/diskon.svg" alt="" class="x-product-discount-icon" onerror="this.style.display=\'none\'"><span>Discount ongkir ' + fmtIDR(state.discount) + '</span></div>'
          : ''
        ) +
        '  </div>' +
        '  <div class="x-product-right">' +
        (img
          ? '<img class="x-product-image" src="' + UI.escape(img) + '" alt="' + UI.escape(item.name || '') + '" loading="lazy" onerror="this.src=\'/assets/icons/food-default.png\'">'
          : '<div class="x-product-image" style="background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:24px;">🍱</div>'
        ) +
        '    <div class="x-quantity">' +
        '      <button type="button" data-minus-item="' + item.id + '" aria-label="Kurang"><img src="/assets/icons/minus.svg" alt="minus" style="width:13px;height:13px;display:block;margin:auto;"></button>' +
        '      <span class="x-quantity-value">' + qty + '</span>' +
        '      <button type="button" data-plus-item="' + item.id + '" aria-label="Tambah"><img src="/assets/icons/plus.svg" alt="plus" style="width:13px;height:13px;display:block;margin:auto;"></button>' +
        '    </div>' +
        '    <button type="button" class="x-note-button ' + (note ? 'has-note' : '') + '" data-note-item="' + item.id + '">' +
        '      <img src="' + (note ? '/assets/icons/write.svg' : '/assets/icons/file.svg') + '" alt="Catatan" class="x-note-icon">' +
        '      Catatan' +
        '    </button>' +
        '  </div>' +
        '</div>';
    });
    return html;
  }

  function calculateTotals() {
    var items = getCheckoutItems();
    var subtotal = items.reduce(function (s, i) { return s + Number(i.price || 0) * Number(i.quantity || 0); }, 0);
    var isDelivery = state.fulfillment.type === 'delivery';
    var fee = isDelivery ? state.deliveryFee : 0;
    var discount = isDelivery ? state.discount : 0;
    var grand = Math.max(0, subtotal + fee - discount);
    var oldTotal = subtotal + fee;

    var elSub = $('x-sum-subtotal'); if (elSub) elSub.textContent = fmtIDR(subtotal);
    var elDel = $('x-sum-delivery'); if (elDel) elDel.textContent = fmtIDR(fee);
    var elDisc = $('x-sum-discount'); if (elDisc) elDisc.textContent = '-' + fmtIDR(discount);
    var elOld = $('x-sum-oldtotal'); if (elOld) elOld.textContent = fmtIDR(oldTotal);
    var elGrand = $('x-sum-total'); if (elGrand) elGrand.textContent = fmtIDR(grand);
  }

  // ── Upsell Recommendation Rail (Dynamic API/Catalog Integration) ──
  function extractCatalogProducts(data) {
    var list = [];
    if (!data) return list;
    if (Array.isArray(data.categories)) {
      data.categories.forEach(function (cat) {
        if (Array.isArray(cat.products)) {
          cat.products.forEach(function (p) {
            if (p && p.id && p.name) list.push(p);
          });
        }
      });
    } else if (Array.isArray(data.all_products)) {
      list = data.all_products;
    } else if (Array.isArray(data.products)) {
      list = data.products;
    } else if (data.products && Array.isArray(data.products.items)) {
      list = data.products.items;
    }
    return list;
  }

  function enableTrackDragScroll(track) {
    if (!track || track.__dragInit) return;
    track.__dragInit = true;

    // 1. Mouse wheel horizontal scrolling on desktop
    track.addEventListener('wheel', function (e) {
      var delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta !== 0) {
        track.scrollLeft += delta;
      }
    }, { passive: true });

    // 2. Desktop Mouse Drag-to-Scroll
    var isMouseDown = false;
    var mouseStartX = 0;
    var mouseStartScroll = 0;
    var hasMouseDragged = false;

    track.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('.x-upsell-add-btn')) return;
      isMouseDown = true;
      hasMouseDragged = false;
      mouseStartX = e.clientX;
      mouseStartScroll = track.scrollLeft;
      track.style.cursor = 'grabbing';
      track.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', function (e) {
      if (!isMouseDown) return;
      var diffX = e.clientX - mouseStartX;
      if (Math.abs(diffX) > 3) {
        hasMouseDragged = true;
        track.scrollLeft = mouseStartScroll - diffX;
      }
    });

    window.addEventListener('mouseup', function () {
      if (!isMouseDown) return;
      isMouseDown = false;
      track.style.cursor = '';
      track.style.userSelect = '';
    });

    track.addEventListener('click', function (e) {
      if (hasMouseDragged) {
        e.preventDefault();
        e.stopPropagation();
        hasMouseDragged = false;
      }
    }, true);
  }

  function renderUpsellTrack(container, items) {
    if (!container) return;
    container.innerHTML = (items || []).map(function (p) {
      return (UI && UI.upsellCard) ? UI.upsellCard(p) : '';
    }).join('');

    enableTrackDragScroll(container);

    if (typeof console !== 'undefined' && console.log) {
      setTimeout(function () {
        console.log('[Upsell Track Geometry]', {
          clientWidth: container.clientWidth,
          scrollWidth: container.scrollWidth,
          scrollLeft: container.scrollLeft,
          canScroll: container.scrollWidth > container.clientWidth,
          overflowX: window.getComputedStyle ? window.getComputedStyle(container).overflowX : '',
          touchAction: window.getComputedStyle ? window.getComputedStyle(container).touchAction : ''
        });
      }, 100);
    }

    var buttons = container.querySelectorAll('.x-upsell-add-btn');
    for (var b = 0; b < buttons.length; b++) {
      (function (btn) {
        btn.onclick = function (e) {
          if (e) e.stopPropagation();
          var pid = btn.getAttribute('data-add-upsell');
          var found = null;
          for (var i = 0; i < items.length; i++) {
            if (String(items[i].id) === String(pid)) {
              found = items[i];
              break;
            }
          }
          if (found) {
            Store.addItem(found, 1);
            var rowsEl = $('x-checkout-items-rows') || $('x-checkout-items-list');
            if (rowsEl) {
              rowsEl.innerHTML = renderItemsHtml(getCheckoutItems());
              bindItemEvents();
            }
            calculateTotals();
            refreshDeliveryQuote();
          }
        };
      })(buttons[b]);
    }
  }

  var FALLBACK_CATALOG = [
    { id: 272, name: 'Paket Spesial Semar', price: 35000, image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png' },
    { id: 285, name: 'Paket Spesial Petruk', price: 35000, image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-04_05_15-PM-300x300.png' },
    { id: 345, name: 'Mie Gurih', price: 15000, image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png' },
    { id: 286, name: 'Ayam Tulang Lunak Bakar', price: 28000, image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png' },
    { id: 287, name: 'Mie Godog Jawa Asli', price: 22000, image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png' },
    { id: 288, name: 'Es Kopi Susu Bangjo', price: 15000, image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png' },
    { id: 401, name: 'Es Teh Manis', price: 5000, image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png' },
    { id: 402, name: 'Es Jeruk Segar', price: 8000, image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/unnamed-7-2.png' }
  ];

  function applyUpsellPool(pool) {
    var wrap = $('x-upsell-container');
    var track = $('x-addon-track');
    if (!wrap || !track) return;

    var cartIds = {};
    getCheckoutItems().forEach(function (i) { cartIds[String(i.id)] = true; });
    var filtered = (pool || []).filter(function (p) { return p && p.id && !cartIds[String(p.id)]; });
    var newUpsell = (filtered.length >= 3 ? filtered : filtered.concat(FALLBACK_CATALOG.filter(function (f) { return !cartIds[String(f.id)]; }))).slice(0, 10);

    var newKey = newUpsell.map(function (x) { return x.id; }).join(',');
    if (track.__renderedKey && track.__renderedKey === newKey) {
      return;
    }
    track.__renderedKey = newKey;
    upsellItems = newUpsell;

    if (upsellItems.length > 0) {
      wrap.style.display = 'block';
      renderUpsellTrack(track, upsellItems);
    }
  }

  function loadUpsell() {
    var wrap = $('x-upsell-container');
    var track = $('x-addon-track');
    if (!track) return;

    if (upsellItems && upsellItems.length) {
      applyUpsellPool(upsellItems);
      return;
    }

    // 1. Check local catalog cache from DB
    var pool = [];
    try {
      var rawCached = localStorage.getItem('xentra_catalog_cache');
      if (rawCached) {
        pool = extractCatalogProducts(JSON.parse(rawCached));
      }
    } catch (_) {}

    if (!pool.length) {
      pool = FALLBACK_CATALOG;
    }

    applyUpsellPool(pool);

    // 2. Fetch fresh catalog from API in background
    if (!API) return;
    API.get('/catalog/menu')
      .then(function (data) {
        var freshPool = extractCatalogProducts(data);
        if (freshPool && freshPool.length > 0) {
          try { localStorage.setItem('xentra_catalog_cache', JSON.stringify(data)); } catch (_) {}
          applyUpsellPool(freshPool);
        }
      })
      .catch(function (err) {
        console.warn('[Checkout] Load upsell error:', err);
      });
  }

  // ── Events Binding ──
  function bindEvents() {
    var back = $('x-checkout-back'); if (back) back.onclick = function () { Router.navigate('home'); };
    var promoBtn = $('x-btn-promo-install'); if (promoBtn) promoBtn.onclick = handleInstallClick;

    var claimBtn = $('x-btn-promo-claim');
    if (claimBtn) {
      claimBtn.onclick = function () {
        var rewardPromo = getAppliedRewardPromo();
        if (rewardPromo && rewardPromo.reward) {
          var r = rewardPromo.reward;
          var rewardItemId = 'reward_' + (r.promo_id || rewardPromo.promo_id);
          Store.addItem({
            id: rewardItemId,
            name: (rewardPromo.display && rewardPromo.display.reward_title) || 'Hadiah Promo',
            price: Number(r.reward_price || 0),
            regular_price: 5000,
            image_url: (rewardPromo.display && rewardPromo.display.icon_url) || '/assets/pwa/icon-192.png',
            description: (rewardPromo.display && rewardPromo.display.reward_title) || 'Hadiah Promo'
          }, 1);
          renderLayout();
          bindEvents();
          calculateTotals();
        }
      };
    }

    bindItemEvents();

    var btnCust = $('x-btn-edit-customer');
    if (btnCust) btnCust.onclick = openCustomerAuthSheet;

    var btnFul = $('x-btn-choose-fulfillment');
    if (btnFul) btnFul.onclick = function (e) { e.stopPropagation(); openFulfillmentSheet(); };

    var cardFul = $('x-card-fulfillment');
    if (cardFul) cardFul.addEventListener('click', function (e) {
      if (e.target.closest('button')) return;
      openFulfillmentSheet();
    });

    var btnFulNote = $('x-btn-fulfillment-note');
    if (btnFulNote) btnFulNote.onclick = function (e) { e.stopPropagation(); openFulfillmentNoteSheet(); };

    var btnAddr = $('x-btn-change-address'); if (btnAddr) btnAddr.onclick = openAddressSheet;
    var addrCard = $('x-card-address'); if (addrCard) addrCard.addEventListener('click', function (e) { if (e.target.closest('button')) return; openAddressSheet(); });

    var optCash = $('x-opt-cash'); if (optCash) optCash.onclick = function () { state.paymentMethod = 'cash'; syncPayVisual(); };
    var optOn = $('x-opt-online'); if (optOn) optOn.onclick = function () { state.paymentMethod = 'midtrans'; syncPayVisual(); };

    var submit = $('x-btn-submit-order'); if (submit) submit.onclick = executePrePaymentAndSubmit;

    checkoutContainer.querySelectorAll('[data-note-item]').forEach(function (btn) {
      btn.onclick = function () { openItemNoteSheet(btn.dataset.noteItem); };
    });
  }

  function bindItemEvents() {
    if (!checkoutContainer) return;
    checkoutContainer.querySelectorAll('[data-plus-item]').forEach(function (btn) {
      btn.onclick = function () {
        var it = Store.findCartItem(btn.dataset.plusItem);
        if (it) Store.setQty(it.id, Number(it.quantity) + 1);
      };
    });
    checkoutContainer.querySelectorAll('[data-minus-item]').forEach(function (btn) {
      btn.onclick = function () {
        var it = Store.findCartItem(btn.dataset.minusItem);
        if (it) Store.setQty(it.id, Number(it.quantity) - 1);
      };
    });
    checkoutContainer.querySelectorAll('[data-note-item]').forEach(function (btn) {
      btn.onclick = function () { openItemNoteSheet(btn.dataset.noteItem); };
    });
  }

  function syncPayVisual() {
    var c = $('x-opt-cash'), o = $('x-opt-online');
    if (c) {
      var isCash = state.paymentMethod === 'cash';
      c.classList.toggle('is-active', isCash);
      c.style.borderColor = isCash ? '#b6ff00' : '#e5e7eb';
      c.style.background = isCash ? '#f7ffd9' : '#fff';
    }
    if (o) {
      var isOnline = state.paymentMethod === 'midtrans';
      o.classList.toggle('is-active', isOnline);
      o.style.borderColor = isOnline ? '#b6ff00' : '#e5e7eb';
      o.style.background = isOnline ? '#f7ffd9' : '#fff';
    }
  }

  // ── Overlay Modal Helper (Rule: Overlay in DOM first before query, smooth slide physics) ──
  function makeOverlay(innerHtml) {
    var overlay = document.createElement('div');
    overlay.className = 'x-overlay';
    overlay.innerHTML = '<div class="x-sheet x-alt-sheet"><div class="x-sheet-handle"></div>' + innerHtml + '</div>';
    document.body.appendChild(overlay);

    // Force layout reflow so browser registers the off-screen translateY(105%) start position
    void overlay.offsetHeight;

    window.requestAnimationFrame(function () {
      overlay.classList.add('open');
    });

    var isClosing = false;
    function close() {
      if (isClosing) return;
      isClosing = true;
      overlay.classList.remove('open');
      setTimeout(function () {
        if (overlay.parentNode) overlay.remove();
      }, 380);
    }

    if (window.XentraNav && typeof window.XentraNav.pushClose === 'function') {
      window.XentraNav.pushClose(close);
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        if (window.XentraNav && typeof window.XentraNav.close === 'function') {
          window.XentraNav.close();
        } else {
          close();
        }
      }
    });

    return { overlay: overlay, close: close };
  }

  // ── 1. Fulfillment Sheet (4 Order Types: Delivery, Pick-up, Dine-in, Reservation) ──
  function openFulfillmentSheet() {
    var draftType = state.fulfillment.type || 'delivery';
    if (draftType === 'dinein') draftType = 'dine_in';

    // Calculate tomorrow's date for minimum reservation date constraint
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var minDateStr = tomorrow.toISOString().slice(0, 10);
    var defaultResDate = state.fulfillment.reservationDate || minDateStr;

    var branchOptionsHtml = '';
    availableBranches.forEach(function (b) {
      var isSel = state.matchedBranch && String(state.matchedBranch.id) === String(b.id);
      branchOptionsHtml += '<option value="' + b.id + '" ' + (isSel ? 'selected' : '') + '>' + UI.escape(b.name) + '</option>';
    });

    var sh = makeOverlay(
      '<h3 class="x-alt-sheet-title">Pilih Tipe Pembelian</h3>' +
      '<div class="x-alt-fulfillment-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
      '  <button type="button" class="x-alt-fulfill-opt ' + (draftType === 'delivery' ? 'is-active' : '') + '" data-type="delivery"><img src="/assets/icons/delivery.png" alt=""><span>🛵 Delivery</span></button>' +
      '  <button type="button" class="x-alt-fulfill-opt ' + (draftType === 'pickup' ? 'is-active' : '') + '" data-type="pickup"><img src="/assets/icons/pick_up.png" alt=""><span>🛍️ Pick-up</span></button>' +
      '  <button type="button" class="x-alt-fulfill-opt ' + (draftType === 'dine_in' ? 'is-active' : '') + '" data-type="dine_in"><img src="/assets/icons/dine_in.png" alt=""><span>🍽️ Dine-in</span></button>' +
      '  <button type="button" class="x-alt-fulfill-opt ' + (draftType === 'reservation' ? 'is-active' : '') + '" data-type="reservation"><img src="/assets/icons/info_green.svg" alt=""><span>📅 Reservasi</span></button>' +
      '</div>' +

      '<div class="x-alt-sheet-divider"></div>' +

      // Dynamic Context Section
      '<div id="x-ful-dynamic-section">' +
      '  <!-- Rendered dynamically depending on selected order_type -->' +
      '</div>' +

      '<button type="button" class="x-alt-submit-btn" id="x-save-fulfillment" style="margin-top:18px;">Simpan Pilihan</button>'
    );

    var overlay = sh.overlay;
    var dynSection = overlay.querySelector('#x-ful-dynamic-section');

    function renderDynamicOptions(type) {
      if (!dynSection) return;
      if (type === 'delivery') {
        dynSection.innerHTML =
          '<div class="x-alt-sheet-label">Waktu Pengantaran</div>' +
          '<div class="x-alt-time-options">' +
          '  <label class="x-alt-radio"><input type="radio" name="ful-time" value="now" ' + (!state.fulfillment.scheduled ? 'checked' : '') + '><span>⚡ Sekarang (15–25 menit)</span></label>' +
          '  <label class="x-alt-radio"><input type="radio" name="ful-time" value="schedule" ' + (state.fulfillment.scheduled ? 'checked' : '') + '><span>🕒 Jadwalkan — Hari ini 12.00–12.30</span></label>' +
          '</div>';
      } else if (type === 'pickup') {
        dynSection.innerHTML =
          '<div class="x-alt-sheet-label">Pilih Cabang Outlet</div>' +
          '<select id="x-select-branch" class="x-alt-input" style="background:#fff;">' + (branchOptionsHtml || '<option>Cabang Utama</option>') + '</select>' +
          '<div style="font-size:12px;color:#6b7280;margin-top:6px;">Pesanan akan disiapkan dan dapat diambil langsung di kasir cabang pilihanmu.</div>';
      } else if (type === 'dine_in') {
        dynSection.innerHTML =
          '<div class="x-alt-sheet-label">Nomor Meja</div>' +
          '<input type="text" id="x-input-table" class="x-alt-input" placeholder="Contoh: Meja 03 / Area Outdoor 5" value="' + UI.escape(state.fulfillment.tableNumber || '') + '">' +
          '<div style="font-size:12px;color:#6b7280;margin-top:6px;">Makanan akan diantar langsung ke meja kamu.</div>';
      } else if (type === 'reservation') {
        dynSection.innerHTML =
          '<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:#92400e;line-height:1.4;">' +
          '  ⚠️ <b>Aturan Reservasi:</b> Reservasi hanya berlaku untuk <b>besok atau tanggal setelahnya</b>. Reservasi hari yang sama tidak diperkenankan.' +
          '</div>' +
          '<div class="x-alt-sheet-label">Pilih Cabang Reservasi</div>' +
          '<select id="x-select-res-branch" class="x-alt-input" style="background:#fff;margin-bottom:10px;">' + (branchOptionsHtml || '<option>Cabang Utama</option>') + '</select>' +
          '<div class="x-alt-sheet-label">Tanggal Kedatangan (Min. Besok)</div>' +
          '<input type="date" id="x-input-res-date" class="x-alt-input" min="' + minDateStr + '" value="' + defaultResDate + '" style="margin-bottom:10px;">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
          '  <div>' +
          '    <div class="x-alt-sheet-label">Jam Kedatangan</div>' +
          '    <input type="time" id="x-input-res-time" class="x-alt-input" value="' + (state.fulfillment.reservationTime || '12:00') + '">' +
          '  </div>' +
          '  <div>' +
          '    <div class="x-alt-sheet-label">Jumlah Tamu</div>' +
          '    <input type="number" id="x-input-res-guests" class="x-alt-input" min="1" max="100" value="' + (state.fulfillment.guestCount || 2) + '">' +
          '  </div>' +
          '</div>';
      }
    }

    renderDynamicOptions(draftType);

    overlay.querySelectorAll('[data-type]').forEach(function (b) {
      b.onclick = function () {
        draftType = b.dataset.type;
        overlay.querySelectorAll('[data-type]').forEach(function (x) { x.classList.toggle('is-active', x === b); });
        renderDynamicOptions(draftType);
      };
    });

    overlay.querySelector('#x-save-fulfillment').onclick = function () {
      state.fulfillment.type = draftType;
      Store.setOrderType(draftType);

      if (draftType === 'delivery') {
        var v = overlay.querySelector('input[name="ful-time"]:checked');
        state.fulfillment.scheduled = !!(v && v.value === 'schedule');
        state.fulfillment.timeSlot = state.fulfillment.scheduled ? '12.00 - 12.30' : 'Sekarang';
      } else if (draftType === 'pickup') {
        var selB = overlay.querySelector('#x-select-branch');
        if (selB && selB.value) {
          var found = availableBranches.find(function (x) { return String(x.id) === String(selB.value); });
          if (found) state.matchedBranch = found;
        }
      } else if (draftType === 'dine_in') {
        var tbl = overlay.querySelector('#x-input-table');
        state.fulfillment.tableNumber = tbl ? tbl.value.trim() : '';
      } else if (draftType === 'reservation') {
        var rDateInput = overlay.querySelector('#x-input-res-date');
        var rTimeInput = overlay.querySelector('#x-input-res-time');
        var rGuestInput = overlay.querySelector('#x-input-res-guests');
        var rBranchSel = overlay.querySelector('#x-select-res-branch');

        var rDateVal = rDateInput ? rDateInput.value : '';
        if (!rDateVal || rDateVal < minDateStr) {
          if (UI && UI.toast) UI.toast('Reservasi hari yang sama tidak diperkenankan. Pilih minimal besok.');
          return;
        }

        state.fulfillment.reservationDate = rDateVal;
        state.fulfillment.reservationTime = rTimeInput ? rTimeInput.value : '12:00';
        state.fulfillment.guestCount = rGuestInput ? Math.max(1, parseInt(rGuestInput.value, 10) || 2) : 2;

        if (rBranchSel && rBranchSel.value) {
          var foundB = availableBranches.find(function (x) { return String(x.id) === String(rBranchSel.value); });
          if (foundB) state.matchedBranch = foundB;
        }
      }

      sh.close();
      var y = window.scrollY;
      renderLayout();
      calculateTotals();
      loadUpsell();
      refreshDeliveryQuote();
      window.scrollTo(0, y);
    };
  }

  // ── 2. Customer Auth / Phone Sheet ──
  function openCustomerAuthSheet() {
    var sh = makeOverlay(
      '<h3 class="x-alt-sheet-title">Data Diri Pemesan</h3>' +
      '<div style="font-size:13px;color:#6b7280;margin-bottom:12px;">Masukkan nama dan nomor WhatsApp aktif untuk notifikasi pesanan.</div>' +
      '<div class="x-alt-sheet-label">Nama Lengkap</div>' +
      '<input type="text" id="x-input-cust-name" class="x-alt-input" placeholder="Contoh: Budi Santoso" value="' + UI.escape(state.customer.name || '') + '">' +
      '<div class="x-alt-sheet-label" style="margin-top:10px;">Nomor WhatsApp</div>' +
      '<input type="tel" id="x-input-cust-phone" class="x-alt-input" placeholder="081234567890" value="' + UI.escape(state.customer.phone || '') + '">' +
      '<button type="button" class="x-alt-submit-btn" id="x-save-customer" style="margin-top:16px;">Simpan Data</button>'
    );

    sh.overlay.querySelector('#x-save-customer').onclick = function () {
      var n = sh.overlay.querySelector('#x-input-cust-name').value.trim();
      var p = sh.overlay.querySelector('#x-input-cust-phone').value.trim();

      if (!p) {
        if (UI && UI.toast) UI.toast('Nomor WhatsApp wajib diisi.');
        return;
      }

      state.customer.name = n || 'Pelanggan';
      state.customer.phone = p;
      state.customer.isVerified = true;

      Store.setCustomerSession({
        phone: p,
        name: state.customer.name,
        token: 'cust_' + Date.now()
      });

      sh.close();
      renderLayout();
      calculateTotals();
    };
  }

  // ── 3. Fulfillment Note Sheet ──
  function openFulfillmentNoteSheet() {
    var val = state.fulfillment.note || '';
    var sh = makeOverlay(
      '<div style="height:min(52dvh, 360px) !important;max-height:52dvh !important;display:flex !important;flex-direction:column;">' +
      '  <div class="x-note-header">' +
      '    <h3 style="margin:0;font-size:16px;font-weight:700;color:#111;">Catatan Pengantaran / Toko</h3>' +
      '  </div>' +
      '  <textarea id="x-input-ful-note" maxlength="200" style="flex:1 1 auto;width:100%;min-height:0;padding:12px 0;border:0;outline:0;resize:none;background:transparent;color:#333;font-family:inherit;font-size:14px;line-height:21px;" placeholder="Tambahkan catatan (contoh: titip di satpam, pagar hitam)…">' + UI.escape(val) + '</textarea>' +
      '  <div class="x-note-footer" style="display:flex;align-items:center;justify-content:space-between;padding-top:10px;border-top:1px solid #dedede;flex:0 0 auto;">' +
      '    <span id="x-ful-note-count" style="font-size:12px;color:#777;">' + val.length + '/200</span>' +
      '    <button type="button" id="x-save-ful-note" style="width:86px;height:34px;border:0;border-radius:18px;background:#b6ff00;color:#111;font-size:13px;font-weight:600;cursor:pointer;">Simpan</button>' +
      '  </div>' +
      '</div>'
    );

    var txt = sh.overlay.querySelector('#x-input-ful-note');
    var cnt = sh.overlay.querySelector('#x-ful-note-count');
    if (txt && cnt) {
      txt.addEventListener('input', function () { cnt.textContent = txt.value.length + '/200'; });
      setTimeout(function () { txt.focus(); }, 350);
    }

    sh.overlay.querySelector('#x-save-ful-note').onclick = function () {
      state.fulfillment.note = (txt ? txt.value : '').trim();
      sh.close();
      renderLayout();
      calculateTotals();
    };
  }

  // ── 4. Item Note Sheet ──
  function openItemNoteSheet(itemId) {
    var item = Store.findCartItem(itemId);
    if (!item) return;
    var val = (state.notes && state.notes[itemId]) || item.note || '';
    var sh = makeOverlay(
      '<div style="height:min(52dvh, 360px) !important;max-height:52dvh !important;display:flex !important;flex-direction:column;">' +
      '  <div class="x-note-header">' +
      '    <h3 style="margin:0;font-size:16px;font-weight:700;color:#111;">Catatan : ' + UI.escape(item.name) + '</h3>' +
      '  </div>' +
      '  <textarea id="x-input-item-note" maxlength="200" style="flex:1 1 auto;width:100%;min-height:0;padding:12px 0;border:0;outline:0;resize:none;background:transparent;color:#333;font-family:inherit;font-size:14px;line-height:21px;" placeholder="Tambahkan catatan (contoh: pedas sedang, pisah sambal)…">' + UI.escape(val) + '</textarea>' +
      '  <div class="x-note-footer" style="display:flex;align-items:center;justify-content:space-between;padding-top:10px;border-top:1px solid #dedede;flex:0 0 auto;">' +
      '    <span id="x-item-note-count" style="font-size:12px;color:#777;">' + val.length + '/200</span>' +
      '    <button type="button" id="x-save-item-note" style="width:86px;height:34px;border:0;border-radius:18px;background:#b6ff00;color:#111;font-size:13px;font-weight:600;cursor:pointer;">Simpan</button>' +
      '  </div>' +
      '</div>'
    );

    var txt = sh.overlay.querySelector('#x-input-item-note');
    var cnt = sh.overlay.querySelector('#x-item-note-count');
    if (txt && cnt) {
      txt.addEventListener('input', function () { cnt.textContent = txt.value.length + '/200'; });
      setTimeout(function () { txt.focus(); }, 350);
    }

    sh.overlay.querySelector('#x-save-item-note').onclick = function () {
      var noteVal = (txt ? txt.value : '').trim();
      Store.setNote(itemId, noteVal);
      sh.close();
      renderLayout();
      calculateTotals();
    };
  }

  // ── 5. Delivery Address Sheet ──
  function openAddressSheet() {
    var sh = makeOverlay(
      '<h3 class="x-alt-sheet-title">Alamat Pengiriman</h3>' +
      '<div style="font-size:13px;color:#6b7280;margin-bottom:10px;">Pastikan alamat dan titik pengantaran sudah sesuai.</div>' +
      '<div class="x-alt-sheet-label">Alamat Lengkap</div>' +
      '<input id="x-input-addr" class="x-alt-input" type="text" value="' + UI.escape(state.address.formatted_address) + '" placeholder="Jl. Dewi 18, Panjang…">' +
      '<div class="x-alt-sheet-label" style="margin-top:10px;">Label Alamat</div>' +
      '<input id="x-input-addr-label" class="x-alt-input" type="text" value="' + UI.escape(state.address.label) + '" placeholder="Rumah / Kantor / Kos">' +
      '<div class="x-alt-sheet-label" style="margin-top:10px;">Patokan / Detail Alamat</div>' +
      '<textarea id="x-input-addr-detail" class="x-alt-textarea" rows="3" placeholder="Samping minimarket, pagar hitam…">' + UI.escape(state.address.detail) + '</textarea>' +
      '<button type="button" class="x-alt-submit-btn" id="x-save-addr" style="margin-top:14px;">Gunakan Alamat Ini</button>'
    );
    sh.overlay.querySelector('#x-save-addr').onclick = function () {
      var a = sh.overlay.querySelector('#x-input-addr').value.trim();
      var l = sh.overlay.querySelector('#x-input-addr-label').value.trim();
      var d = sh.overlay.querySelector('#x-input-addr-detail').value.trim();
      if (a) state.address.formatted_address = a;
      if (l) state.address.label = l;
      state.address.detail = d;

      try {
        Store.setLocation({
          formatted_address: state.address.formatted_address,
          latitude: state.address.latitude,
          longitude: state.address.longitude,
          label: state.address.label,
          detail: state.address.detail
        });
      } catch (_) {}

      sh.close();
      var y = window.scrollY;
      renderLayout();
      calculateTotals();
      loadUpsell();
      refreshDeliveryQuote();
      window.scrollTo(0, y);
    };
  }

  // ── 6. Pre-Payment Verification Gate Modal Dialog ──
  function showPrePaymentVerificationDialog(verificationData, onConfirm) {
    var diffs = verificationData.price_diffs || [];
    var errors = verificationData.errors || [];

    var diffHtml = '';
    diffs.forEach(function (d) {
      diffHtml +=
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;">' +
        '  <div><b>' + UI.escape(d.product_name || d.product_id) + '</b></div>' +
        '  <div><s style="color:#9ca3af;margin-right:6px;">' + fmtIDR(d.expected_price) + '</s> <b style="color:#16a34a;">' + fmtIDR(d.actual_price) + '</b></div>' +
        '</div>';
    });

    var errHtml = '';
    errors.forEach(function (e) {
      errHtml += '<div style="color:#dc2626;font-size:12px;margin-top:4px;">• ' + UI.escape(e) + '</div>';
    });

    var sh = makeOverlay(
      '<div style="text-align:center;margin-bottom:12px;">' +
      '  <div style="font-size:36px;margin-bottom:8px;">⚠️</div>' +
      '  <h3 class="x-alt-sheet-title" style="margin:0 0 6px;">Ada perubahan di pesananmu, cek dulu yuk</h3>' +
      '  <p style="font-size:13px;color:#6b7280;margin:0;">Beberapa harga atau ketersediaan menu baru saja diperbarui oleh restoran.</p>' +
      '</div>' +
      '<div style="background:#f9fafb;border-radius:14px;padding:12px 14px;margin:12px 0;">' +
      diffHtml + errHtml +
      '</div>' +
      '<button type="button" class="x-alt-submit-btn" id="x-btn-accept-changes" style="margin-top:14px;">Perbarui Pesanan &amp; Lanjutkan</button>'
    );

    sh.overlay.querySelector('#x-btn-accept-changes').onclick = function () {
      // Sync cart items with actual prices
      if (Array.isArray(verificationData.verified_items)) {
        verificationData.verified_items.forEach(function (v) {
          var item = Store.findCartItem(v.product_id);
          if (item) {
            item.price = Number(v.price);
          }
        });
      }
      sh.close();
      renderLayout();
      calculateTotals();
      if (typeof onConfirm === 'function') onConfirm();
    };
  }

  // ── 7. Execute Pre-Payment Verification & Submit Order ──
  function executePrePaymentAndSubmit() {
    if (state.isSubmitting) return;

    var fulType = state.fulfillment.type;
    var isReservation = fulType === 'reservation';
    var items = getCheckoutItems();

    if (!isReservation && !items.length) {
      if (UI && UI.toast) UI.toast('Keranjang belanja kosong');
      return;
    }

    if (!state.customer.phone) {
      if (UI && UI.toast) UI.toast('Silakan masukkan nomor WhatsApp pemesan.');
      openCustomerAuthSheet();
      return;
    }

    state.isSubmitting = true;
    var btn = $('x-btn-submit-order');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Memverifikasi pesanan…';
      btn.style.opacity = '0.7';
    }

    var branchId = state.matchedBranch ? state.matchedBranch.id : undefined;
    var pwaRuntime = (window.Xentra && window.Xentra.PwaRuntime) ? window.Xentra.PwaRuntime.getPwaRuntimeContext() : { display_mode: 'browser' };

    // Call Pre-Payment Verification Gate first
    API.post('/checkout/verify', {
      branch_id: branchId,
      customer: {
        name: state.customer.name,
        phone: state.customer.phone
      },
      pwa_runtime: pwaRuntime,
      items: items.map(function (i) {
        return {
          product_id: i.id,
          id: i.id,
          quantity: Number(i.quantity) || 1,
          expected_price: Number(i.price) || 0,
          name: i.name
        };
      }),
      order_type: fulType
    }).then(function (verRes) {
      if (verRes && !verRes.is_valid) {
        state.isSubmitting = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Pesan Sekarang'; btn.style.opacity = '1'; }
        showPrePaymentVerificationDialog(verRes, function () {
          // Retry submit with updated prices
          executePrePaymentAndSubmit();
        });
        return;
      }

      // Pre-payment check passed → Proceed with Order Placement
      proceedCreateOrder();
    }).catch(function () {
      // If verify route fails or network glitch, attempt create-order directly (backend has authoritative guard)
      proceedCreateOrder();
    });
  }

  function proceedCreateOrder() {
    var btn = $('x-btn-submit-order');
    if (btn) btn.textContent = 'Memproses pesanan…';

    var items = getCheckoutItems();
    var fulType = state.fulfillment.type;
    var isDelivery = fulType === 'delivery';

    var pwaRuntime = (window.Xentra && window.Xentra.PwaRuntime) ? window.Xentra.PwaRuntime.getPwaRuntimeContext() : { display_mode: 'browser' };

    var payload = {
      branch_id: state.matchedBranch ? state.matchedBranch.id : undefined,
      customer: {
        name: state.customer.name || 'Pelanggan Bangjo',
        phone: state.customer.phone
      },
      pwa_runtime: pwaRuntime,
      order_type: fulType === 'dinein' ? 'dine_in' : fulType,
      fulfillment: {
        type: fulType === 'dinein' ? 'dine_in' : fulType,
        table_number: state.fulfillment.tableNumber || null,
        reservation_date: state.fulfillment.reservationDate || null,
        guest_count: state.fulfillment.guestCount || null
      },
      table_number: state.fulfillment.tableNumber || null,
      reservation_date: state.fulfillment.reservationDate || null,
      guest_count: state.fulfillment.guestCount || null,
      schedule_type: state.fulfillment.scheduled ? 'scheduled' : 'asap',
      scheduled_slot_start: state.fulfillment.scheduled ? (state.fulfillment.date + ' ' + state.fulfillment.timeSlot) : null,
      scheduled_slot_end: null,
      delivery: isDelivery ? {
        latitude: state.address.latitude,
        longitude: state.address.longitude,
        address: state.address.formatted_address
      } : undefined,
      address: isDelivery ? {
        latitude: state.address.latitude,
        longitude: state.address.longitude,
        formatted_address: state.address.formatted_address,
        detail: state.address.detail
      } : undefined,
      items: items.map(function (i) {
        return {
          id: i.id,
          product_id: i.id,
          quantity: Number(i.quantity) || 1,
          expected_price: Number(i.price) || 0,
          note: i.note || ''
        };
      }),
      payment_method: state.paymentMethod || 'cash',
      order_note: state.fulfillment.note || '',
      note: state.fulfillment.note || ''
    };

    function onSuccess(orderId, snapToken) {
      state.isSubmitting = false;
      if (snapToken && state.paymentMethod === 'midtrans' && window.snap && window.snap.pay) {
        window.snap.pay(snapToken, {
          onSuccess: function () { Router.navigate('order-received', { orderId: orderId }); },
          onPending: function () { Router.navigate('order-received', { orderId: orderId }); },
          onError: function () { Router.navigate('order-received', { orderId: orderId }); },
          onClose: function () { Router.navigate('order-received', { orderId: orderId }); }
        });
      } else {
        Router.navigate('order-received', { orderId: orderId });
      }
      if (!currentItemId) Store.clearCart(); else Store.removeItem(currentItemId);
    }

    function onFail(errData) {
      state.isSubmitting = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = state.fulfillment.type === 'reservation' ? 'Konfirmasi Reservasi' : 'Pesan Sekarang';
        btn.style.opacity = '1';
      }

      if (errData && (errData.status === 'PRICE_CHANGED' || errData.status === 'OUT_OF_STOCK' || (errData.price_diffs && errData.price_diffs.length > 0))) {
        showPrePaymentVerificationDialog(errData, function () {
          executePrePaymentAndSubmit();
        });
        return;
      }

      var msg = (errData && (errData.error || errData.message)) || 'Gagal memproses pesanan.';
      if (UI && UI.toast) UI.toast(msg);
      renderLayout();
      calculateTotals();
    }

    API.post('/checkout/create-order', payload).then(function (res) {
      if (res && res.success && (res.order_id || res.order)) {
        var oid = res.order_id || (res.order && res.order.id) || (res.order && res.order.order_id);
        var st = res.snap_token || (res.payment && res.payment.snap_token) || null;
        onSuccess(oid, st);
      } else {
        onFail(res);
      }
    }).catch(function (err) {
      onFail(err && err.data ? err.data : { error: err.message });
    });
  }

  // ── Sync with Store changes ──
  Store.subscribe(function () {
    if (!checkoutContainer || checkoutContainer.style.display === 'none' || state.isSubmitting) return;
    var items = getCheckoutItems();
    if (!items.length && state.fulfillment.type !== 'reservation') {
      renderEmpty();
      return;
    }
    var rowsEl = $('x-checkout-items-rows') || $('x-checkout-items-list');
    if (rowsEl) {
      rowsEl.innerHTML = renderItemsHtml(items);
      bindItemEvents();
      checkoutContainer.querySelectorAll('[data-note-item]').forEach(function (b) {
        b.onclick = function () { openItemNoteSheet(b.dataset.noteItem); };
      });
    }
    calculateTotals();
    refreshDeliveryQuote();
  });

  window.Xentra = window.Xentra || {};
  window.Xentra.Checkout = { mount: mount };
})();
