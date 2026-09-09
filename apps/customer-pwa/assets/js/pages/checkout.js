/**
 * Xentra Customer PWA — Checkout Controller
 * Pixel-perfect implementation conforming to Xentra-Core Architecture & Locked Decisions.
 * 
 * Features:
 * 1. 4 Order Types: Delivery (now/scheduled), Pick-up (now/scheduled, same UI), Dine-in (table context), Reservation (min. tomorrow, same-day rejected)
 *    Scheduling uses DEVICE-LOCAL time: first slot = device now + 1 hour,
 *    rounded UP to a 30-minute boundary (see core/delivery-schedule.js).
 * 2. Customer Identity: WhatsApp OTP authentication & verified session binding
 * 3. Pre-Payment Verification Gate: Realtime price/stock check with "Ada perubahan di pesananmu, cek dulu yuk" modal
 * 4. Dual Payment: Tunai (COD / Bayar di Kasir) & Online Payment (Midtrans Snap)
 * 5. PWA Install Incentive: configuration-driven reward (promotion domain)
 * 6. Add-on recommendation rail — Branch-scoped ONLY (GET /catalog/menu?branch_id=<Checkout fulfillment branch>)
 */
(function () {
  'use strict';

  var API = window.Xentra && window.Xentra.API;
  var Store = window.Xentra.Store;
  var UI = window.Xentra.UI;
  var Router = window.Xentra.Router;
  // Delivery schedule slot/timezone math lives in core/delivery-schedule.js and
  // is DEVICE-LOCAL. The customer schedule picker NEVER uses the server or
  // WordPress timezone as its current-time source.
  var DeliverySchedule = window.Xentra && window.Xentra.DeliverySchedule;

  var checkoutContainer = null;
  var upsellItems = [];
  var availableBranches = [];
  var currentItemId = null;
  // R1 CART/CHECKOUT BOUNDARY: a checkout is single-branch. When the URL carries
  // #checkout/branch/<id>, this page consumes ONLY that branch's cart lines.
  // null = no scope filter (legacy whole-cart flow).
  var currentBranchId = null;

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
  // PwaRuntime (core/pwa-runtime.js) is the single source of truth for the
  // install lifecycle (deferred prompt, VERIFIED install marker, appinstalled).
  // Prompt acceptance alone is NEVER treated as installed; the requirement is
  // satisfied only after a verified install (appinstalled / standalone).
  var isIosPwa = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  // PROMOTION INSTALL STATE (not runtime display-mode): is the install
  // requirement satisfied (verified install only)? The same context is sent to
  // the server at Pay; entitlement authority stays in the Promotion Domain.
  function checkIsPwaInstalled() {
    if (window.Xentra && window.Xentra.PwaRuntime) {
      return window.Xentra.PwaRuntime.getPwaRuntimeContext().install_requirement_satisfied === true;
    }
    return Boolean(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

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
        // Discovery comes only from the authoritative promotion service.
        // (Locked business contract 68ac710: no client-injected promo when the
        // API is empty or fails.)
        return promoEvaluation;
      }).catch(function () {
        return promoEvaluation;
      });
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
      var promoId = rewardPromo.reward ? (rewardPromo.reward.promo_id || rewardPromo.promo_id) : rewardPromo.promo_id;
      var bridge = window.Xentra && window.Xentra.PromotionRewardCart;
      // Bridge check is canonical (promotion_id / reward_<promo> id); the loose
      // scan keeps legacy hydrated carts from an older claim shape claimable-free.
      // Canonical reward identity first; legacy hydration fallback keeps
      // older claim shapes (id reward_* / is_promo_reward flag) claimable-free.
      var hasRewardInCart = (bridge ? bridge.hasReward(items, promoId) : false) ||
        (items || []).some(function (i) {
          return String(i.id) === 'reward_' + promoId ||
                 String(i.id).indexOf('reward_') === 0 ||
                 Boolean(i.is_promo_reward);
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
          '    <div class="x-alt-promo-copy"><div class="x-alt-promo-title">' + UI.escape(r.claim_title || 'Klaim hadiah spesial untuk pesanan pertamamu!') + '</div><div class="x-alt-promo-snk">' + UI.escape(r.claim_subtitle || 'syarat & ketentuan berlaku') + '</div></div>' +
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
    if (claimBtn) claimBtn.onclick = claimRewardIntoCart;
  }

  // ── Single Claim execution path ──
  // Server-provided entitlement (promoEvaluation.applied) is converted into one
  // checkout item through the shared PromotionRewardCart bridge. Idempotent:
  // if the reward line is already present, Claim does nothing.
  function claimRewardIntoCart() {
    var bridge = window.Xentra && window.Xentra.PromotionRewardCart;
    if (!bridge) return;
    var rewardPromo = getAppliedRewardPromo();
    if (!rewardPromo || !rewardPromo.reward) return;

    var rew = rewardPromo.reward;
    var promoId = rew.promo_id || rewardPromo.promo_id;
    var items = getCheckoutItems();
    if (bridge.hasReward(items, promoId)) return;

    // Reward line economics come from the authoritative server payload
    // (reward_price / regular_price / product identity) — no client hardcodes.
    var display = rewardPromo.display || {};
    var res = bridge.claim(items, {
      promo_id: promoId,
      product_id: rew.product_id,
      name: rew.product_name || display.reward_title || 'Hadiah Promo',
      reward_type: rew.reward_type || 'freebie_product',
      reward_price: rew.reward_price,
      regular_price: rew.regular_price,
      image_url: rew.image_url || display.icon_url || '',
      description: rew.description || display.reward_title || 'Hadiah Promo'
    });
    if (!res || !res.claimed || !res.items.length) return;

    Store.addItem(res.items[0], 1);
  }

  // beforeinstallprompt is captured ONCE in <head> on every page (stored on
  // window.__xentra_deferred_prompt) and consumed by PwaRuntime.promptInstall().
  // appinstalled is handled once in PwaRuntime (marker + broadcast). This page
  // reacts to the broadcast to refresh the reward state.
  document.addEventListener('xentra:pwa-installed', function () {
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
    var tagline = (promo && promo.display && (promo.display.banner_subtitle || promo.display.reward_badge_text)) || 'Dapatkan promo spesial untuk pesanan pertamamu';
    var html =
      '<div class="x-pwa-guide-backdrop"></div>' +
      '<div class="x-pwa-guide-sheet">' +
      '  <div class="x-sheet-handle" style="margin-bottom:12px;"></div>' +
      '  <div class="x-pwa-guide-head"><img src="' + icon + '" alt="Bangjo" class="x-pwa-guide-icon"><div><h3>Pasang Aplikasi Bangjo</h3><p>' + UI.escape(tagline) + '</p></div></div>' +
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

    var pwaRt = window.Xentra && window.Xentra.PwaRuntime;
    if (!pwaRt || typeof pwaRt.promptInstall !== 'function') {
      showPwaGuideSheet(isIosPwa ? 'ios' : 'android');
      return;
    }

    pwaRt.promptInstall().then(function (res) {
      if (res && res.accepted) {
        // Accepted only means the user accepted the prompt — the requirement
        // is NOT satisfied yet. Stay on the install/discovery state until the
        // appinstalled broadcast (verified install) refreshes the banner into
        // the claim/reward state. Never treat prompt acceptance as entitlement.
        if (UI && UI.toast) UI.toast('Terima kasih! Selesaikan pemasangan aplikasi.');
      } else if (!res || !res.prompted) {
        // No native prompt available (iOS Safari / unsupported): guide instead
        // of pretending the install happened.
        showPwaGuideSheet(isIosPwa ? 'ios' : 'android');
      }
    });
  }

  // Delegated install click listener on document for 100% reliable tap response.
  // Covers BOTH install entry points: the promo card button on checkout
  // (#x-btn-promo-install) and the persistent top "Bangjo App" banner button
  // (#x-pwa-install) shown on every view for guests.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('#x-btn-promo-install, #x-pwa-install');
    if (btn) {
      handleInstallClick(e);
    }
  });

  // Reward/promo line identity: canonical metadata or the synthetic line id.
  // Price-0 or name "Gratis" heuristics are intentionally NOT used here so a
  // legitimately discounted/free product is never misclassified as a promo.
  function isPromoItem(item) {
    if (!item) return false;
    return Boolean(
      item.is_promo_reward ||
      item.promotion_id ||
      String(item.id).indexOf('reward_') === 0
    );
  }

  function getCheckoutItems() {
    var all;
    if (currentBranchId) {
      // Branch-scoped checkout: only this branch's cart lines, never a merge.
      var scopeBranchId = currentBranchId === '__unassigned__' ? null : currentBranchId;
      all = Store.getCartItemsForBranch(scopeBranchId);
    } else {
      all = (Store.getState().cart.items || []).slice();
    }
    var filtered = !currentItemId ? all : all.filter(function (i) { return String(i.id) === String(currentItemId); });
    return filtered.sort(function (a, b) {
      var aPromo = isPromoItem(a);
      var bPromo = isPromoItem(b);
      if (aPromo && !bPromo) return -1;
      if (!aPromo && bPromo) return 1;
      return 0;
    });
  }

  // ── Mount ──
  function mount(container) {
    checkoutContainer = container || $('xentra-checkout-view');
    if (!checkoutContainer) return;

    var urlItemId = Router && Router.getItemIdFromUrl ? Router.getItemIdFromUrl() : null;
    if (urlItemId) currentItemId = String(urlItemId);

    var urlBranchId = Router && Router.getBranchIdFromUrl ? Router.getBranchIdFromUrl() : null;
    currentBranchId = urlBranchId ? String(urlBranchId) : null;

    // Restore customer session from Store
    var storeState = Store.getState();
    if (storeState.customerSession) {
      state.customer.phone = storeState.customerSession.phone || '';
      state.customer.name = storeState.customerSession.name || state.customer.name;
      var hasValidToken = storeState.customerSession.token &&
        storeState.customerSession.token.indexOf('xnt_cust_') === 0;
      state.customer.isVerified = !!hasValidToken;
    }

    // Restore canonical active destination / location
    var savedDest = storeState.activeDestination || storeState.location;
    if (savedDest && (savedDest.address || savedDest.formatted_address)) {
      state.address.formatted_address = savedDest.address || savedDest.formatted_address;
      if (savedDest.latitude != null) state.address.latitude = Number(savedDest.latitude);
      if (savedDest.longitude != null) state.address.longitude = Number(savedDest.longitude);
      if (savedDest.label) state.address.label = savedDest.label;
      if (savedDest.detail) state.address.detail = savedDest.detail;
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

    // The single Store subscriber is registered ONCE at module scope (see
    // "Sync with Store changes" at the bottom). Registering inside mount()
    // would ACCUMULATE a duplicate subscriber on every checkout visit and
    // duplicate every row render per mutation.

    syncRowsFromItems(getCheckoutItems());
    loadUpsell();
    quoteNow();
  }

  function loadBranches() {
    if (!API) return;
    API.get('/brand/branches').then(function (res) {
      if (res && res.success && Array.isArray(res.branches)) {
        availableBranches = res.branches;
        if (!state.matchedBranch) {
          // An explicit branch-scoped checkout (#checkout/branch/<id>) prefills
          // the branch it came from — never silently re-scopes the cart to a
          // different branch. The bare availableBranches[0] fallback only
          // survives when no branch scope and no branch context exist at all.
          if (currentBranchId && currentBranchId !== '__unassigned__') {
            var fromBranchParam = availableBranches.find(function (b) {
              return String(b.id) === String(currentBranchId);
            });
            state.matchedBranch = fromBranchParam || null;
          }
          if (!state.matchedBranch) {
            // P2 HOME DISCOVERY CONTEXT: a Home-selected branch prefills the
            // checkout branch (customer-selected). It is still authoritatively
            // re-validated by Core at clarify/submit; it is never AUTO-resolved
            // and never silently rematched.
            var ctx = null;
            try { ctx = Store.getState().branchContext; } catch (_) {}
            if (ctx && (ctx.branch_id != null || ctx.id != null)) {
              var ctxId = ctx.branch_id != null ? ctx.branch_id : ctx.id;
              var fromCtx = availableBranches.find(function (b) {
                return String(b.id) === String(ctxId);
              });
              state.matchedBranch = fromCtx || null;
            }
            if (!state.matchedBranch && availableBranches.length > 0) {
              state.matchedBranch = availableBranches[0];
            }
          }
        }
      }
      // Branch list resolved -> the Checkout fulfillment Branch is now known
      // (may have been unresolved at the initial mount): scope the upsell rail.
      loadUpsell();
    }).catch(function () {});
  }

  // ── Cart row sync (single source of truth for the items DOM) ──
  // Re-render strategy per mutation:
  //  * empty cart            -> full empty-state render (includes promo slot)
  //  * first item / new line -> full rows rebuild + rebind + promo banner
  //  * qty-only change       -> in-place quantity patch (NO innerHTML rebuild,
  //                             NO event rebinding, NO promo re-render)
  // The promo banner is only re-rendered when the LINE SET changes (add/remove/
  // reward claim); a pure qty change cannot alter server-provided promo
  // presentation. A delivery quote landing can change the per-row ongkir
  // discount, so we also force a full rebuild when the discount changed.
  var lastRowKeys = null;
  var lastRowDiscount = 0;

  function itemRowKey(item) {
    return String(item.id) + '::' + (item && item.branch_id ? String(item.branch_id) : 'u');
  }

  function syncRowsFromItems(items) {
    var isReservation = state.fulfillment.type === 'reservation';

    if (!items.length) {
      lastRowKeys = null;
      lastRowDiscount = 0;
      if (!isReservation) {
        renderEmpty();
        renderPromoBanner();
      } else {
        // Reservation checkout with no menu lines: still show the reservation
        // layout (booking card), unlike the empty-cart state for other types.
        renderLayout();
        calculateTotals();
      }
      return;
    }

    var rowsEl = $('x-checkout-items-rows') || $('x-checkout-items-list');
    if (!rowsEl) {
      // First item arrived while the empty-state view was on screen
      // (e.g. welcome reward claimed): transition to the full checkout layout.
      renderLayout();
      lastRowKeys = null;
      lastRowDiscount = 0;
      rowsEl = $('x-checkout-items-rows') || $('x-checkout-items-list');
      if (!rowsEl) { calculateTotals(); return; }
    }

    var keys = items.map(itemRowKey).join('|');
    var discount = Number(state.discount) || 0;
    if (rowsEl && (keys !== lastRowKeys || discount !== lastRowDiscount)) {
      rowsEl.innerHTML = renderItemsHtml(items);
      bindItemEvents();
      renderPromoBanner();
      lastRowKeys = keys;
      lastRowDiscount = discount;
    } else if (rowsEl) {
      // Qty-only change: patch the visible quantity, keep existing DOM/events.
      items.forEach(function (i) {
        var row = rowsEl.querySelector('[data-item-key="' + itemRowKey(i) + '"]');
        if (!row) return;
        var q = row.querySelector('.x-quantity-value');
        if (q) q.textContent = String(i.quantity);
      });
    }
    calculateTotals();
  }

  // ── Delivery quote calculation via BranchMatcher ──
  // Delivery ongkir / subtotal-sensitive discount eligibility is a SERVER-side
  // (delivery domain) decision: the client must re-quote after cart changes,
  // but NEVER synchronously per keystroke. This pipeline is async, trailing-
  // debounced (400ms), and latest-wins: every response carries a sequence id so
  // a stale reply (for an older qty) can never overwrite a newer cart state.
  //
  // Loop breaker: the module-scope Store subscriber previously called
  // refreshDeliveryQuote -> Store.setMatchedBranch(res) -> notify() -> the same
  // subscriber -> refreshDeliveryQuote ... forever. Now the quote path applies
  // results LOCALLY first and only propagates a *changed* branch id to the
  // Store (and the subscriber only reacts to 'cart'/'location', then schedules,
  // debounced — never a hard re-enter loop).
  var quoteTimer = null;
  var quoteSeq = 0;

  function quoteNow() {
    clearTimeout(quoteTimer);
    quoteTimer = null;
    runDeliveryQuote(++quoteSeq);
  }

  function scheduleDeliveryQuote() {
    if (state.fulfillment.type !== 'delivery') {
      clearTimeout(quoteTimer);
      quoteTimer = null;
      state.deliveryFee = 0;
      state.discount = 0;
      state.deliveryQuote = null;
      calculateTotals();
      return;
    }
    clearTimeout(quoteTimer);
    var seq = ++quoteSeq;
    quoteTimer = setTimeout(function () { runDeliveryQuote(seq); }, 400);
  }

  function runDeliveryQuote(seq) {
    quoteTimer = null;
    if (seq !== quoteSeq) return; // superseded by a newer schedule/cart change
    if (!API) return;
    if (state.fulfillment.type !== 'delivery') return;
    var items = getCheckoutItems();
    if (!items.length) {
      state.deliveryFee = 0;
      state.discount = 0;
      state.deliveryQuote = null;
      calculateTotals();
      return;
    }
    var subtotal = items.reduce(function (s, i) { return s + Number(i.price || 0) * Number(i.quantity || 0); }, 0);

    API.post('/delivery/match-branch', {
      latitude: state.address.latitude,
      longitude: state.address.longitude,
      subtotal: subtotal
    }).then(function (res) {
      if (seq !== quoteSeq) return; // a newer cart already superseded this reply
      if (res && res.eligible && res.delivery) {
        var previousBranch = state.matchedBranch;
        state.matchedBranch = res.branch || null;
        state.deliveryQuote = res.delivery;
        state.deliveryFee = Number(res.delivery.final_delivery_fee || 0);
        state.discount = Number(res.delivery.discount_amount || 0);

        // Only persist when the resolved branch actually changed — persisting
        // the same branch per quote would re-notify and re-enter the quote path.
        if (res.branch && (!previousBranch || String(previousBranch.id) !== String(res.branch.id))) {
          try { Store.setMatchedBranch(res); } catch (_) {}
          // The observed fulfillment Branch changed -> the upsell rail must
          // follow the Checkout fulfillment Branch authority (same as the
          // order's branch_id) and re-scope to the newly resolved Branch.
          loadUpsell();
        }
      } else if (res && !res.eligible) {
        state.deliveryFee = 0;
        state.discount = 0;
        state.deliveryQuote = res.delivery || null;
        if (UI && UI.toast) UI.toast(res.reason || 'Alamat di luar jangkauan pengantaran.');
      }
      syncRowsFromItems(getCheckoutItems());
    }).catch(function () {
      if (seq !== quoteSeq) return;
      syncRowsFromItems(getCheckoutItems());
    });
  }

  function renderEmpty() {
    checkoutContainer.innerHTML =
      '<div class="xentra-checkout x-checkout-alt2">' +
      '  <div class="x-alt-header"><button type="button" id="x-back-empty" class="x-alt-back" aria-label="Kembali"><img src="/assets/icons/arrowback.svg" alt=""></button><span>Checkout Pesanan</span></div>' +
      '  <div id="x-promo-slot">' + getPromoBannerHtml([]) + '</div>' +
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
    var fulSub = state.fulfillment.scheduled
      ? ((state.fulfillment.date || 'Hari ini') + ' | ' + (state.fulfillment.timeSlot || '12.00 - 12.30'))
      : 'Sekarang (15–25 menit)';
    var fulIcon = '/assets/icons/delivery.png';

    if (isPickup) {
      fulTitle = 'Pick-up (Ambil Sendiri)';
      var bName = state.matchedBranch ? state.matchedBranch.name : 'Pilih Cabang';
      fulSub = state.fulfillment.scheduled
        ? (bName + ' | ' + (state.fulfillment.date || 'Hari ini') + ' | ' + (state.fulfillment.timeSlot || '12.00 - 12.30'))
        : 'Ambil di ' + bName;
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
      fulIcon = '/assets/icons/reservasi.png';
    }

    var customerName = state.customer.name || 'Pelanggan';
    var customerPhone = state.customer.phone || '';
    var isPhoneVerified = state.customer.isVerified && !!customerPhone;

    checkoutContainer.innerHTML =
      '<div class="xentra-checkout x-checkout-alt2">' +

      // 1. Header
      '  <div class="x-alt-header"><button type="button" id="x-checkout-back" class="x-alt-back" aria-label="Kembali"><img src="/assets/icons/arrowback.svg" alt=""></button><span>Checkout Bangjo</span></div>' +

      // 2. Dynamic Promo Presentation (Slot for zero-blink targeted updates)
      '  <div id="x-promo-slot">' + getPromoBannerHtml(items) + '</div>' +

      // 3. Card 2: Items & Upsell Unified Card (Directly below promo banner)
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

      // 4. Card 3: Order Type / Fulfillment Selection Card
      '  <div class="x-card x-alt-delivery-card" id="x-card-fulfillment" style="margin:0 14px 10px;padding:16px;border-radius:18px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.04);">' +
      '    <div class="x-alt-card-top" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">' +
      '      <div class="x-alt-icon-wrap" style="width:48px;height:48px;flex:0 0 48px;display:flex;align-items:center;justify-content:center;"><img src="' + fulIcon + '" alt="" style="width:44px;height:44px;object-fit:contain;"></div>' +
      '      <div class="x-alt-delivery-copy" style="flex:1 1 auto;min-width:0;">' +
      '        <div class="x-alt-delivery-type" style="font-size:15px;font-weight:700;color:#111;">' + UI.escape(fulTitle) + '</div>' +
      '        <div class="x-alt-delivery-types-sub" style="font-size:11.5px;color:#888;margin-top:1px;">delivery / pick-up / dine-in</div>' +
      '        <div class="x-alt-delivery-time" style="font-size:13px;font-weight:700;color:#111;margin-top:2px;">' + UI.escape(fulSub) + '</div>' +
      '      </div>' +
      '      <button type="button" class="x-pill-btn" id="x-btn-choose-fulfillment">Pilih</button>' +
      '    </div>' +
      (state.fulfillment.note ? '<div class="x-alt-delivery-note-text" style="font-size:12.5px;color:#555;margin-top:12px;line-height:1.4;"><b>Catatan :</b> ' + UI.escape(state.fulfillment.note) + '</div>' : '') +
      '    <div style="margin-top:10px;"><button type="button" class="x-note-button ' + (state.fulfillment.note ? 'has-note' : '') + '" id="x-btn-fulfillment-note"><img src="' + (state.fulfillment.note ? '/assets/icons/write.svg' : '/assets/icons/file.svg') + '" alt="" class="x-note-icon">Catatan</button></div>' +
      '  </div>' +

      // 5. Card 4: Delivery Address Card (Shown when delivery)
      (isDelivery ? (
        '  <div class="x-card x-alt-address-card" id="x-card-address" style="margin:0 14px 10px;padding:16px;border-radius:18px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.04);">' +
        '    <div class="x-alt-address-head" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;"><span style="font-size:15px;font-weight:700;color:#111;">Alamat Pengiriman</span><button type="button" class="x-pill-btn" id="x-btn-change-address">Pilih</button></div>' +
        '    <div class="x-alt-addr-label" style="font-size:14px;font-weight:700;color:#111;margin-top:4px;">' + UI.escape(state.address.label || 'Rumah') + '</div>' +
        '    <div class="x-alt-addr-text" style="font-size:12.5px;color:#666;line-height:18px;margin-top:2px;">' + UI.escape(state.address.formatted_address || 'Pilih alamat pengiriman') + '</div>' +
        (state.address.detail ? '<div class="x-alt-addr-note" style="font-size:12px;color:#777;margin-top:4px;font-style:italic;">Patokan: ' + UI.escape(state.address.detail) + '</div>' : '') +
        '  </div>'
      ) : '') +

      // 6. Card 5: Payment Summary & Methods Card
      '  <div class="x-card x-alt-summary-card" id="x-payment-summary-card" style="margin:0 14px;padding:16px;border-radius:18px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.04);">' +
      '    <div class="x-alt-summary-title" style="font-size:15px;font-weight:700;color:#111;margin-bottom:12px;">Ringkasan pembayaran</div>' +
      (!isReservation ? (
        '    <div class="x-alt-sum-row" style="display:flex;justify-content:space-between;font-size:13.5px;color:#666;padding:3px 0;"><span>Harga</span><span id="x-sum-subtotal" style="font-weight:600;color:#111;">' + fmtIDR(subtotal) + '</span></div>' +
        (isDelivery ? '<div class="x-alt-sum-row" style="display:flex;justify-content:space-between;font-size:13.5px;color:#666;padding:3px 0;"><span>Biaya Penanganan dan Pengiriman</span><span id="x-sum-delivery" style="font-weight:600;color:#111;">' + fmtIDR(fee) + '</span></div>' : '') +
        (discount > 0 ? '<div class="x-alt-sum-row x-alt-discount-row" style="display:flex;justify-content:space-between;font-size:13.5px;color:#ef4444;font-weight:700;padding:3px 0;"><span>Diskon</span><span id="x-sum-discount">-' + fmtIDR(discount) + '</span></div>' : '') +
        '    <div class="x-alt-sum-divider" style="height:1px;background:#f0f0f0;margin:12px 0 10px;"></div>' +
        '    <div class="x-alt-sum-total" style="display:flex;align-items:baseline;justify-content:space-between;"><span style="font-size:15px;font-weight:700;color:#111;">Total pembayaran</span><div style="display:flex;align-items:baseline;gap:8px;">' + (oldTotal > grand ? '<s id="x-sum-oldtotal" style="color:#9ca3af;font-size:13px;text-decoration:line-through;">' + fmtIDR(oldTotal) + '</s>' : '') + '<b id="x-sum-total" style="font-size:18px;font-weight:800;color:#111;">' + fmtIDR(grand) + '</b></div></div>'
      ) : (
        '    <div class="x-alt-sum-row" style="display:flex;justify-content:space-between;font-size:13.5px;padding:3px 0;"><span>Biaya Booking Reservasi</span><span style="color:#16a34a;font-weight:700;">Gratis (Rp0)</span></div>'
      )) +
      '    <div class="x-alt-pay-methods" style="margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
      '      <button type="button" class="x-alt-pay-opt ' + (state.paymentMethod === 'cash' ? 'is-active' : '') + '" id="x-opt-cash" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid ' + (state.paymentMethod === 'cash' ? '#b6ff00' : '#e5e7eb') + ';border-radius:14px;background:' + (state.paymentMethod === 'cash' ? '#f7ffd9' : '#fff') + ';cursor:pointer;text-align:left;font-family:inherit;">' +
      '        <img src="/assets/icons/cashblack.svg" alt="" style="width:24px;height:24px;object-fit:contain;flex-shrink:0;">' +
      '        <div style="display:flex;flex-direction:column;min-width:0;">' +
      '          <span style="font-size:13px;font-weight:700;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Tunai (COD)</span>' +
      '          <span style="font-size:11px;color:#777;">Bayar di tempat</span>' +
      '        </div>' +
      '      </button>' +
      '      <button type="button" class="x-alt-pay-opt ' + (state.paymentMethod === 'midtrans' ? 'is-active' : '') + '" id="x-opt-online" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid ' + (state.paymentMethod === 'midtrans' ? '#b6ff00' : '#e5e7eb') + ';border-radius:14px;background:' + (state.paymentMethod === 'midtrans' ? '#f7ffd9' : '#fff') + ';cursor:pointer;text-align:left;font-family:inherit;">' +
      '        <img src="/assets/icons/qrisgreen.svg" alt="" style="width:24px;height:24px;object-fit:contain;flex-shrink:0;">' +
      '        <div style="display:flex;flex-direction:column;min-width:0;">' +
      '          <span style="font-size:13px;font-weight:700;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Online Pay</span>' +
      '          <span style="font-size:11px;color:#777;">QRIS / E-Wallet</span>' +
      '        </div>' +
      '      </button>' +
      '    </div>' +
      '    <div class="x-alt-trust" style="font-size:11.5px;color:#6b7280;text-align:center;margin-top:14px;display:flex;flex-direction:column;align-items:center;gap:3px;">' +
      '      <div style="display:flex;align-items:center;gap:4px;"><span>🔒</span><span>Transaksi aman dan terenkripsi</span></div>' +
      '      <div style="display:flex;align-items:center;gap:4px;font-size:11px;color:#888;"><span>Diproses oleh</span><span style="color:#00a3e0;font-weight:700;">midtrans</span></div>' +
      '    </div>' +
      '  </div>' +

      // 7. Sticky Submit CTA Bar
      '  <div class="x-alt-cta-bar" style="position:fixed;bottom:0;left:0;right:0;max-width:480px;margin:0 auto;padding:12px 14px max(12px,env(safe-area-inset-bottom));background:#fff;box-shadow:0 -4px 18px rgba(0,0,0,.08);z-index:1000;"><button type="button" id="x-btn-submit-order" class="x-alt-submit-btn" style="width:100%;height:50px;border-radius:999px;border:0;background:var(--x-lime,#b6ff00);color:#111;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit;">' + (isReservation ? 'Konfirmasi Reservasi' : 'Pesan sekarang') + '</button></div>' +

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
      // Visual classification only — reward identity is canonical (flag / reward_ id),
      // never price-based, so a legitimately free catalog product is not mislabelled "Gratis".
      var isPromoFreebie = Boolean(item.is_promo_reward || String(item.id).indexOf('reward_') === 0);

      html +=
        '<div class="x-product x-checkout-item" data-item-id="' + item.id + '" data-item-key="' + itemRowKey(item) + '">' +
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
        '      <button type="button" data-minus-item="' + item.id + '" data-branch-item="' + (item.branch_id || '') + '" aria-label="Kurang"><img src="/assets/icons/minus.svg" alt="minus" style="width:13px;height:13px;display:block;margin:auto;"></button>' +
        '      <span class="x-quantity-value">' + qty + '</span>' +
        '      <button type="button" data-plus-item="' + item.id + '" data-branch-item="' + (item.branch_id || '') + '" aria-label="Tambah"><img src="/assets/icons/plus.svg" alt="plus" style="width:13px;height:13px;display:block;margin:auto;"></button>' +
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
            // Locked rule: Checkout is one fulfillment cycle for one Branch, so
            // an upsell item enters the cart in the SAME scope the checkout list
            // reads (getCheckoutItems): the URL branch scope for a scoped
            // checkout (instantly visible + part of THIS Branch's order), or a
            // classical provenance-free line for the legacy branch-less checkout.
            // Never a different branch: an added item in another scope would be
            // in the cart yet never appear in this checkout's item list.
            var addScope = getCheckoutItemScope();
            Store.addItem(found, 1, addScope ? { branch_id: addScope.id, branch_name: addScope.name } : undefined);
          }
        };
      })(buttons[b]);
    }
  }

  // ── Checkout Upsell: fulfillment-branch-scoped rail ──
  // Locked rule (docs/XENTRA_CART_CHECKOUT_CONTRACT.md — Checkout Upsell Branch
  // Scope): Checkout is exactly ONE fulfillment cycle for exactly ONE Branch, so
  // this rail may contain products from the Checkout fulfillment Branch ONLY.
  // Its source is the authoritative Branch-scoped catalog contract
  // `GET /catalog/menu?branch_id=<id>` (Catalog domain returns only products
  // assigned to that Branch). There is strictly NO global-catalog fallback and
  // NO other-Branch fallback on this page: if the Branch cannot be resolved the
  // rail stays hidden until the Branch is known.
  var upsellFetchedBranch = null; // branch id the current rail was sourced for

  // Re-adding the customer's own friction: a line the customer clears with the
  // minus button (qty → 0) is remembered for this checkout session and re-enters
  // the upsell rail IMMEDIATELY, so clearing items can never drain the rail and
  // an accidental removal is one tap away. Scope-filtered at render time, so the
  // "one fulfillment Branch only" contract is preserved.
  var recentlyRemoved = [];

  function rememberRemoved(line) {
    if (!line || line.id == null) return;
    if (line.is_promo_reward || String(line.id).indexOf('reward_') === 0) return; // rewards re-claim via their own flow
    recentlyRemoved = recentlyRemoved.filter(function (x) { return String(x.id) !== String(line.id); });
    recentlyRemoved.unshift({
      id: line.id,
      name: line.name || 'Produk',
      price: Number(line.price || 0),
      regular_price: line.regular_price ? Number(line.regular_price) : null,
      image_url: line.image_url || '',
      description: line.description || '',
      branch_id: line.branch_id || null,
      branch_name: line.branch_name || ''
    });
    if (recentlyRemoved.length > 10) recentlyRemoved.pop();
  }

  // Resolves the Checkout fulfillment Branch — same authority as the order's
  // branch_id in proceedCreateOrder (state.matchedBranch, falling back to the
  // URL branch scope, then the Home branchContext prefill).
  function getFulfillmentBranch() {
    if (state.matchedBranch && state.matchedBranch.id != null) {
      return { id: String(state.matchedBranch.id), name: state.matchedBranch.name || '' };
    }
    if (currentBranchId) {
      var scope = currentBranchId === '__unassigned__' ? null : String(currentBranchId);
      if (scope) {
        var found = null;
        for (var i = 0; i < availableBranches.length; i++) {
          if (String(availableBranches[i].id) === scope) { found = availableBranches[i]; break; }
        }
        return { id: scope, name: found ? found.name : '' };
      }
    }
    try {
      var ctx = Store.getState().branchContext;
      if (ctx && (ctx.branch_id != null || ctx.id != null)) {
        return {
          id: String(ctx.branch_id != null ? ctx.branch_id : ctx.id),
          name: ctx.branch_name || ''
        };
      }
    } catch (_) {}
    return null;
  }

  // Scope an upsell ADD lands in = the exact scope the checkout LIST reads from
  // (getCheckoutItems): for a branch-scoped checkout that is the URL branch
  // scope, so the added item becomes visible in the list immediately and joins
  // THIS Branch's order. A branch-less (legacy) checkout keeps the classical
  // provenance-free add, which its full list shows. NEVER a different branch —
  // an added item in another scope would silently never appear here.
  function getCheckoutItemScope() {
    if (!currentBranchId) return null;
    if (currentBranchId === '__unassigned__') return null;
    var sid = String(currentBranchId);
    var name = '';
    if (state.matchedBranch && String(state.matchedBranch.id) === sid) {
      name = state.matchedBranch.name || '';
    }
    for (var i = 0; i < availableBranches.length; i++) {
      if (String(availableBranches[i].id) === sid) { name = availableBranches[i].name || ''; break; }
    }
    return { id: sid, name: name };
  }

  function applyUpsellPool(pool) {
    var wrap = $('x-upsell-container');
    var track = $('x-addon-track');
    if (!wrap || !track) return;

    var cartIds = {};
    getCheckoutItems().forEach(function (i) { cartIds[String(i.id)] = true; });

    // Recently-removed lines re-enter the rail FIRST (the item the customer just
    // cleared is the most likely one-tap re-add), then the fulfillment-branch
    // catalog pool. Removed lines are scope-filtered exactly like the list they
    // came from (scoped -> that branch only; branch-less -> the legacy,
    // provenance-free family), so a cleared item can surface WITHOUT ever
    // leaking another Branch into the rail. While the fulfillment Branch is
    // unresolved, nothing is merged (the rail stays hidden — no leak ever).
    var removedScopeKey = '__unassigned__';
    if (currentBranchId && currentBranchId !== '__unassigned__') {
      removedScopeKey = String(currentBranchId);
    }
    var branchResolved = Boolean(upsellFetchedBranch) || Boolean(currentBranchId);

    var merged = [];
    var seen = {};
    function add(p) {
      if (!p || p.id == null) return;
      var k = String(p.id);
      if (seen[k] || cartIds[k]) return;
      seen[k] = true;
      merged.push(p);
    }
    if (branchResolved) {
      recentlyRemoved.forEach(function (r) {
        var rKey = (r.branch_id == null || String(r.branch_id) === '') ? '__unassigned__' : String(r.branch_id);
        if (rKey === removedScopeKey) add(r);
      });
    }
    (pool || []).forEach(add);

    var newUpsell = merged.slice(0, 10);

    // Rail identity includes the fulfillment branch: a quote resolving a
    // different fulfillment Branch MUST re-render (never keep the old scope),
    // and an empty Branch result MUST hide the rail (never show old/global items).
    var newKey = 'B' + (upsellFetchedBranch || '') + '|' + newUpsell.map(function (x) { return x.id; }).join(',');
    if (track.__renderedKey && track.__renderedKey === newKey) {
      return;
    }
    track.__renderedKey = newKey;
    upsellItems = newUpsell;

    if (upsellItems.length > 0) {
      wrap.style.display = 'block';
      renderUpsellTrack(track, upsellItems);
    } else {
      wrap.style.display = 'none';
    }
  }

  function loadUpsell() {
    var wrap = $('x-upsell-container');
    var track = $('x-addon-track');
    if (!wrap || !track) return;

    var branch = getFulfillmentBranch();
    var branchKey = (branch && branch.id) || '';

    if (branchKey !== upsellFetchedBranch) {
      upsellFetchedBranch = branchKey;
      applyUpsellPool([]); // drop any previous-scope rail immediately
      if (!branch) return; // fulfillment Branch unresolved: NEVER fall back to a global catalog
      if (!API) return;
      API.get('/catalog/menu?branch_id=' + encodeURIComponent(branch.id))
        .then(function (data) {
          if (upsellFetchedBranch !== branchKey) return; // superseded by a newer scope
          var freshPool = extractCatalogProducts(data);
          if (freshPool && freshPool.length > 0) {
            applyUpsellPool(freshPool);
          } else {
            applyUpsellPool([]);
          }
        })
        .catch(function (err) {
          if (upsellFetchedBranch !== branchKey) return;
          console.warn('[Checkout] Load upsell error:', err);
          applyUpsellPool([]);
        });
      return;
    }

    // Same Branch as the sourced rail: just re-apply the pool for a freshly
    // rendered layout (no re-fetch, no cross-scope risk).
    applyUpsellPool(upsellItems);
  }

  // ── Events Binding ──
  function bindEvents() {
    var back = $('x-checkout-back'); if (back) back.onclick = function () { Router.navigate('home'); };
    var promoBtn = $('x-btn-promo-install'); if (promoBtn) promoBtn.onclick = handleInstallClick;

    var claimBtn = $('x-btn-promo-claim');
    if (claimBtn) claimBtn.onclick = claimRewardIntoCart;

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
        var bid = btn.dataset.branchItem || null;
        var it = Store.findCartItem(btn.dataset.plusItem, bid);
        if (it) Store.setQty(it.id, Number(it.quantity) + 1, it.branch_id == null ? null : it.branch_id);
      };
    });
    checkoutContainer.querySelectorAll('[data-minus-item]').forEach(function (btn) {
      btn.onclick = function () {
        var bid = btn.dataset.branchItem || null;
        var it = Store.findCartItem(btn.dataset.minusItem, bid);
        if (!it) return;
        // Clearing the line (qty → 0) moves it into the upsell rail so the rail
        // never empties as the customer trims the checkout list.
        if (Number(it.quantity) - 1 <= 0) rememberRemoved(it);
        Store.setQty(it.id, Number(it.quantity) - 1, it.branch_id == null ? null : it.branch_id);
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

  // ── 1. Fulfillment Sheet (4 Order Types: Delivery, Pick-up, Dine-in, Reservasi) ──
  function openFulfillmentSheet() {
    // Determine dynamic branch capability availability
    var curBranch = state.matchedBranch || (availableBranches && availableBranches[0]) || null;
    var isDeliveryAvail = !curBranch || curBranch.is_delivery_active !== 0;
    var isPickupAvail = !curBranch || curBranch.is_pickup_active !== 0;
    var isDineInAvail = !curBranch || curBranch.is_dine_in_active !== 0;
    var isReservationAvail = !curBranch || curBranch.is_reservation_active !== 0;

    var availabilityMap = {
      delivery: isDeliveryAvail,
      pickup: isPickupAvail,
      dine_in: isDineInAvail,
      reservation: isReservationAvail
    };

    // Initial committed values
    var committedType = state.fulfillment.type || 'delivery';
    if (committedType === 'dinein') committedType = 'dine_in';
    if (!availabilityMap[committedType]) {
      // Fallback to first available type
      if (isDeliveryAvail) committedType = 'delivery';
      else if (isPickupAvail) committedType = 'pickup';
      else if (isDineInAvail) committedType = 'dine_in';
      else if (isReservationAvail) committedType = 'reservation';
    }

    // Clone committed state into DRAFT
    var draft = {
      type: committedType,
      scheduled: Boolean(state.fulfillment.scheduled),
      date: state.fulfillment.date || 'Hari ini',
      timeSlot: state.fulfillment.timeSlot || '16:00-16:30',
      tableNumber: state.fulfillment.tableNumber || '',
      selectedTableIds: Array.isArray(state.fulfillment.table_ids) ? state.fulfillment.table_ids.slice() : [],
      reservationDate: state.fulfillment.reservationDate || '',
      reservationTime: state.fulfillment.reservationTime || '12:00',
      guestCount: state.fulfillment.guestCount || 2
    };

    var WHEEL_ITEM_HEIGHT = 44;

    // DEVICE-LOCAL schedule days (7). Today/Besok/weekday labels AND their ISO
    // dates come from the device calendar, never from the server/WordPress
    // timezone. The static list below is only a legacy fallback for contexts
    // where core/delivery-schedule.js is not loaded.
    function buildScheduleDates() {
      if (DeliverySchedule && typeof DeliverySchedule.buildScheduleDays === 'function') {
        return DeliverySchedule.buildScheduleDays(new Date());
      }
      var list = [];
      var now = new Date();
      var daysMap = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
      for (var i = 0; i < 7; i++) {
        var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
        var label = i === 0 ? 'Hari ini' : (i === 1 ? 'Besok' : daysMap[d.getDay()]);
        list.push({
          value: label,
          label: label,
          iso: d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2)
        });
      }
      return list;
    }

    // DEVICE-LOCAL slot pools (day -> 30-min slots). First available slot =
    // now(device) + 1 hour, ROUND UP to the next 30-min boundary (order: +1h
    // first, round UP second). `buildDayPools` carries a past-midnight first
    // slot onto the next device-local day. Legacy static 10:00-20:30 list is
    // only the fallback for non-module harness contexts.
    function buildDayPools() {
      if (DeliverySchedule && typeof DeliverySchedule.buildDayPools === 'function') {
        return DeliverySchedule.buildDayPools(new Date());
      }
      var legacy = [
        '10:00-10:30', '10:30-11:00', '11:00-11:30', '11:30-12:00',
        '12:00-12:30', '12:30-13:00', '13:00-13:30', '13:30-14:00',
        '14:00-14:30', '14:30-15:00', '15:00-15:30', '15:30-16:00',
        '16:00-16:30', '16:30-17:00', '17:00-17:30', '17:30-18:00',
        '18:00-18:30', '18:30-19:00', '19:00-19:30', '19:30-20:00',
        '20:00-20:30', '20:30-21:00'
      ];
      return buildScheduleDates().map(function (d) {
        return { day: d, slots: legacy.map(function (s) { return { value: s, label: s }; }) };
      });
    }

    var sh = makeOverlay(
      '<div class="x-fulfillment-sheet" style="padding:0;font-family:var(--x-font, \'Plus Jakarta Sans\', sans-serif);">' +
      '  <h3 class="x-fulfillment-title">Pilih tipe pembelian</h3>' +
      '  <div class="x-fulfillment-types" id="x-ful-grid">' +
      '    <!-- Rendered dynamically -->' +
      '  </div>' +
      '  <div id="x-ful-schedule-container">' +
      '    <!-- Rendered dynamically for delivery -->' +
      '  </div>' +
      '  <div class="x-fulfillment-promo">' +
      '    <span class="x-fulfillment-promo-icon">i</span>' +
      '    <span>Ketersediaan promo tergantung pada tipe pembelian</span>' +
      '  </div>' +
      '  <div class="x-fulfillment-actions">' +
      '    <button type="button" class="x-fulfillment-cancel" id="x-ful-btn-cancel">Gak jadi</button>' +
      '    <button type="button" class="x-fulfillment-confirm" id="x-ful-btn-confirm">Konfirmasi</button>' +
      '  </div>' +
      '</div>'
    );

    var overlay = sh.overlay;
    var gridEl = overlay.querySelector('#x-ful-grid');
    var schedContainer = overlay.querySelector('#x-ful-schedule-container');

    function renderGrid() {
      var options = [
        { type: 'delivery', label: 'Delivery', icon: '/assets/icons/delivery.png', avail: availabilityMap.delivery },
        { type: 'pickup', label: 'Pick-up', icon: '/assets/icons/pick_up.png', avail: availabilityMap.pickup },
        { type: 'dine_in', label: 'Dine-in', icon: '/assets/icons/dine_in.png', avail: availabilityMap.dine_in },
        { type: 'reservation', label: 'Reservasi', icon: '/assets/icons/reservasi.png', avail: availabilityMap.reservation }
      ];

      var html = '';
      options.forEach(function (opt) {
        var isAct = draft.type === opt.type;
        var isDis = !opt.avail;
        html +=
          '<button type="button" class="x-fulfillment-type ' + (isAct ? 'active' : '') + ' ' + (isDis ? 'disabled' : '') + '" data-type="' + opt.type + '" ' + (isDis ? 'disabled' : '') + '>' +
          '  <img src="' + opt.icon + '" alt="">' +
          '  <div class="x-fulfillment-type-text">' +
          '    <strong>' + opt.label + '</strong>' +
          (isDis ? '<small>Unavailable</small>' : '') +
          '  </div>' +
          '</button>';
      });
      gridEl.innerHTML = html;

      gridEl.querySelectorAll('.x-fulfillment-type:not(.disabled)').forEach(function (btn) {
        btn.onclick = function () {
          var chosen = btn.dataset.type;
          if (!availabilityMap[chosen]) return; // Guard: rejection on unavailable
          draft.type = chosen;
          // Switching away from the schedulable types (delivery/pickup) clears
          // scheduling; switching between delivery and pickup keeps it.
          if (chosen !== 'delivery' && chosen !== 'pickup') {
            draft.scheduled = false;
          }
          renderGrid();
          renderScheduleSection();
        };
      });
    }

    function buildWheel(container, items, selectedVal, onSelect) {
      if (!container) return;
      container.innerHTML = '';
      if (!items || !items.length) return;

      var padTop = document.createElement('div');
      padTop.className = 'x-wheel-pad';
      padTop.style.height = WHEEL_ITEM_HEIGHT + 'px';
      container.appendChild(padTop);

      var itemEls = items.map(function (it) {
        var el = document.createElement('div');
        el.className = 'x-wheel-item';
        el.style.height = WHEEL_ITEM_HEIGHT + 'px';
        el.textContent = it.label;
        container.appendChild(el);
        return el;
      });

      var padBottom = document.createElement('div');
      padBottom.className = 'x-wheel-pad';
      padBottom.style.height = WHEEL_ITEM_HEIGHT + 'px';
      container.appendChild(padBottom);

      var currentIndex = 0;
      items.forEach(function (it, idx) {
        if (it.value === selectedVal) currentIndex = idx;
      });

      function updateVisual(activeIndex) {
        itemEls.forEach(function (el, idx) {
          var dist = Math.abs(idx - activeIndex);
          el.classList.toggle('active', dist < 0.5);
          el.style.opacity = dist < 0.5 ? '1' : (dist < 1.5 ? '0.45' : '0.22');
          el.style.transform = 'scale(' + (dist < 0.5 ? 1 : 0.92) + ')';
        });
      }

      var isScrolling = null;
      container.addEventListener('scroll', function () {
        var rawIdx = container.scrollTop / WHEEL_ITEM_HEIGHT;
        updateVisual(rawIdx);
        clearTimeout(isScrolling);
        isScrolling = setTimeout(function () {
          var settledIdx = Math.round(container.scrollTop / WHEEL_ITEM_HEIGHT);
          settledIdx = Math.max(0, Math.min(items.length - 1, settledIdx));
          container.scrollTo({ top: settledIdx * WHEEL_ITEM_HEIGHT, behavior: 'smooth' });
          updateVisual(settledIdx);
          if (typeof onSelect === 'function') {
            onSelect(items[settledIdx], settledIdx);
          }
        }, 80);
      });

      // Direct click on wheel item
      itemEls.forEach(function (el, idx) {
        el.onclick = function (e) {
          e.stopPropagation();
          container.scrollTo({ top: idx * WHEEL_ITEM_HEIGHT, behavior: 'smooth' });
          updateVisual(idx);
          if (typeof onSelect === 'function') {
            onSelect(items[idx], idx);
          }
        };
      });

      // Initial scroll position
      container.scrollTop = currentIndex * WHEEL_ITEM_HEIGHT;
      updateVisual(currentIndex);
    }

    function renderScheduleSection() {
      if (draft.type === 'dine_in') {
        renderDineInFloorPlan();
        return;
      }

      if (draft.type !== 'delivery' && draft.type !== 'pickup') {
        schedContainer.innerHTML = '';
        return;
      }

      var scheduleLabel = draft.type === 'delivery' ? 'Jadwalkan delivery' : 'Jadwalkan pengambilan';

      var html =
        '<div class="x-fulfillment-divider"></div>' +
        '<div class="x-fulfillment-schedule-head">' +
        '  <span style="font-size:14px;font-weight:600;color:#1f2937;">' + scheduleLabel + '</span>' +
        '  <button type="button" class="x-fulfillment-toggle ' + (draft.scheduled ? 'on' : '') + '" id="x-ful-schedule-toggle" aria-pressed="' + (draft.scheduled ? 'true' : 'false') + '">' +
        '    <span></span>' +
        '  </button>' +
        '</div>';

      if (draft.scheduled) {
        html +=
          '<div class="x-fulfillment-schedule-picker" id="x-ful-picker">' +
          '  <div class="x-fulfillment-picker-row">' +
          '    <div class="x-wheel-highlight"></div>' +
          '    <div class="x-wheel-divider"></div>' +
          '    <div class="x-wheel-col" id="x-wheel-date-col"></div>' +
          '    <div class="x-wheel-col" id="x-wheel-time-col"></div>' +
          '  </div>' +
          '</div>' +
          '<div class="x-fulfillment-selected-summary">' +
          '  <span>Pembelianmu bakal sampai pada</span>' +
          '  <strong id="x-ful-summary-text">' + UI.escape(draft.date) + ' | ' + UI.escape(draft.timeSlot) + '</strong>' +
          '</div>';
      }

      schedContainer.innerHTML = html;

      var toggleBtn = schedContainer.querySelector('#x-ful-schedule-toggle');
      if (toggleBtn) {
        toggleBtn.onclick = function () {
          draft.scheduled = !draft.scheduled;
          if (!draft.scheduled) {
            draft.date = 'Hari ini';
            draft.timeSlot = '16:00-16:30';
          }
          renderScheduleSection();
        };
      }

      if (draft.scheduled) {
        var dateCol = schedContainer.querySelector('#x-wheel-date-col');
        var timeCol = schedContainer.querySelector('#x-wheel-time-col');
        var sumText = schedContainer.querySelector('#x-ful-summary-text');

        // Device-local day pools. Days without any available slot (e.g. today
        // when the first slot lands after midnight) are hidden from the wheel.
        var pools = buildDayPools();
        var dates = [];
        var poolByValue = {};
        pools.forEach(function (p) {
          if (p.slots.length) {
            dates.push(p.day);
            poolByValue[p.day.value] = p;
          }
        });

        function updateSummary() {
          if (sumText) {
            sumText.textContent = draft.date + ' | ' + draft.timeSlot;
          }
        }

        if (!poolByValue[draft.date]) {
          draft.date = dates.length ? dates[0].value : 'Hari ini';
        }
        var pool = poolByValue[draft.date];
        var slots = pool ? pool.slots : [];
        if (!draft.timeSlot || !slots.some(function (s) { return s.value === draft.timeSlot; })) {
          draft.timeSlot = slots.length ? slots[0].value : '';
        }
        updateSummary();

        buildWheel(dateCol, dates, draft.date, function (selectedDate) {
          draft.date = selectedDate.value;
          var p = poolByValue[selectedDate.value];
          var daySlots = p ? p.slots : [];
          if (!daySlots.some(function (s) { return s.value === draft.timeSlot; })) {
            draft.timeSlot = daySlots.length ? daySlots[0].value : '';
          }
          buildWheel(timeCol, daySlots, draft.timeSlot, function (selectedSlot) {
            draft.timeSlot = selectedSlot.value;
            updateSummary();
          });
          updateSummary();
        });

        buildWheel(timeCol, slots, draft.timeSlot, function (selectedSlot) {
          draft.timeSlot = selectedSlot.value;
          updateSummary();
        });
      }
    }

    var dineInLayoutData = null;

    function renderDineInFloorPlan() {
      var fb = getFulfillmentBranch();
      var curBranch = state.matchedBranch || (fb ? { id: fb.id, name: fb.name } : null) || (availableBranches && availableBranches[0]) || null;
      var branchId = curBranch ? curBranch.id : (currentBranchId || '');

      schedContainer.innerHTML =
        '<div class="x-fulfillment-divider"></div>' +
        '<div class="x-dinein-container">' +
        '  <!-- Guest count filtering temporarily hidden per user request -->' +
        '  <div class="x-dinein-guest-row" style="display:none !important;">' +
        '    <span class="x-dinein-guest-label">Jumlah Tamu</span>' +
        '    <div class="x-dinein-guest-control">' +
        '      <button type="button" class="x-dinein-guest-btn" id="x-btn-guest-minus">−</button>' +
        '      <span class="x-dinein-guest-count" id="x-txt-guest-count">' + (draft.guestCount || 1) + '</span>' +
        '      <button type="button" class="x-dinein-guest-btn" id="x-btn-guest-plus">+</button>' +
        '    </div>' +
        '  </div>' +
        '  <div class="x-dinein-header-title">Pilih meja</div>' +
        '  <div id="x-dinein-floor-canvas" class="x-floor-wrapper">' +
        '    <div style="text-align:center;padding:30px;color:#9ca3af;font-size:13px;">Memuat tata letak meja…</div>' +
        '  </div>' +
        '</div>';

      var minusBtn = schedContainer.querySelector('#x-btn-guest-minus');
      var plusBtn = schedContainer.querySelector('#x-btn-guest-plus');
      var countTxt = schedContainer.querySelector('#x-txt-guest-count');

      if (minusBtn) {
        minusBtn.onclick = function () {
          if (draft.guestCount > 1) {
            draft.guestCount--;
            if (countTxt) countTxt.textContent = draft.guestCount;
            autoRecommendTable();
          }
        };
      }

      if (plusBtn) {
        plusBtn.onclick = function () {
          draft.guestCount++;
          if (countTxt) countTxt.textContent = draft.guestCount;
          autoRecommendTable();
        };
      }

      function fetchLayout(bid) {
        var endpoint = bid ? ('/dine-in/layout?branch_id=' + encodeURIComponent(bid)) : '/dine-in/layout';
        API.get(endpoint)
          .then(function (res) {
            if (res && res.success && res.layout) {
              dineInLayoutData = res.layout;
              if (res.layout.branch_id && (!state.matchedBranch || !state.matchedBranch.id)) {
                state.matchedBranch = { id: res.layout.branch_id, name: 'Bangjo' };
              }
              // Render layout immediately
              renderFloorCanvas();
            } else {
              var msg = (res && res.error) ? res.error : 'Gagal memuat denah meja.';
              schedContainer.querySelector('#x-dinein-floor-canvas').innerHTML =
                '<div style="text-align:center;padding:20px;color:#ef4444;font-size:13px;">' + msg + '</div>';
            }
          })
          .catch(function (err) {
            console.warn('[Checkout] Load dine-in layout error:', err);
            var errMsg = (err && (err.message || (err.data && err.data.error))) || 'Gagal memuat denah meja.';
            schedContainer.querySelector('#x-dinein-floor-canvas').innerHTML =
              '<div style="text-align:center;padding:20px;color:#ef4444;font-size:13px;">' + errMsg + '</div>';
          });
      }

      fetchLayout(branchId);
    }

    function computeSelectedTableNumbers(tableIds) {
      if (!tableIds || !tableIds.length || !dineInLayoutData || !dineInLayoutData.tables) {
        return draft.tableNumber || '';
      }
      var idMap = {};
      dineInLayoutData.tables.forEach(function (t) {
        idMap[t.id] = t.table_number || (t.label ? t.label.replace(/^meja\s*/i, '') : '');
      });
      var nums = tableIds.map(function (id) {
        return idMap[id];
      }).filter(Boolean);

      // Unique and sort numerically / alphabetically
      var uniqueNums = [];
      nums.forEach(function (n) {
        if (uniqueNums.indexOf(n) === -1) uniqueNums.push(n);
      });
      uniqueNums.sort(function (a, b) {
        var na = parseInt(a, 10), nb = parseInt(b, 10);
        return (!isNaN(na) && !isNaN(nb)) ? (na - nb) : String(a).localeCompare(String(b));
      });

      return uniqueNums.join(', ');
    }

    function autoRecommendTable() {
      if (!dineInLayoutData) return;
      var fb = getFulfillmentBranch();
      var curBranch = state.matchedBranch || (fb ? { id: fb.id } : null) || (availableBranches && availableBranches[0]) || null;
      var branchId = curBranch ? curBranch.id : (currentBranchId || (dineInLayoutData && dineInLayoutData.branch_id) || '');

      API.post('/dine-in/recommend-tables', {
        branch_id: branchId,
        guest_count: draft.guestCount || 1
      }).then(function (res) {
        if (res && res.success && res.recommendation && res.recommendation.table_ids) {
          draft.selectedTableIds = res.recommendation.table_ids;
          draft.tableNumber = computeSelectedTableNumbers(draft.selectedTableIds);
          draft.selectedTables = res.recommendation.tables || [];
        }
        renderFloorCanvas();
      }).catch(function () {
        renderFloorCanvas();
      });
    }

    function renderFloorCanvas() {
      var canvasEl = schedContainer.querySelector('#x-dinein-floor-canvas');
      if (!canvasEl || !dineInLayoutData) return;

      var tables = dineInLayoutData.tables || [];
      var nonTables = dineInLayoutData.non_table_objects || [];

      var indoorTables = tables.filter(function (t) { return t.section_id === 'sec_indoor'; });
      var smokingTables = tables.filter(function (t) { return t.section_id === 'sec_smoking'; });

      var html =
        '<div class="x-floor-section-indoor">' +
        '  <div class="x-floor-badge-group">' +
        '    <img src="/assets/icons/ac.svg" alt="AC" class="x-floor-badge-icon">' +
        '    <img src="/assets/icons/no_smoking.png" alt="No Smoking" class="x-floor-badge-icon">' +
        '  </div>' +
        '  <div class="x-floor-mushola-lshape">' +
        '    <div class="x-floor-mushola-part-top">Mushola</div>' +
        '    <div class="x-floor-mushola-part-bottom"></div>' +
        '  </div>';

      indoorTables.forEach(function (t) {
        html += renderTableHtml(t, 0);
      });
      html += '</div>';

      html +=
        '<div class="x-floor-section-smoking">' +
        '  <div class="x-floor-badge-group">' +
        '    <img src="/assets/icons/smoking.png" alt="Smoking Area" class="x-floor-badge-icon">' +
        '  </div>';

      smokingTables.forEach(function (t) {
        html += renderTableHtml(t, 375);
      });
      html += '</div>';

      canvasEl.innerHTML = html;

      canvasEl.querySelectorAll('.x-table-card:not(.is-unavailable)').forEach(function (card) {
        card.onclick = function (e) {
          e.stopPropagation();
          var tid = card.dataset.tableId;
          var tnum = card.dataset.tableNumber;
          var isSel = card.classList.contains('is-selected');

          if (!draft.selectedTableIds) draft.selectedTableIds = [];

          if (isSel) {
            draft.selectedTableIds = draft.selectedTableIds.filter(function (id) { return id !== tid; });
          } else {
            // Customer manual override / multiple selection
            draft.selectedTableIds.push(tid);
          }
          draft.tableNumber = computeSelectedTableNumbers(draft.selectedTableIds);
          renderFloorCanvas();
        };
      });
    }

    function renderTableHtml(t, sectionBaseY) {
      var isSelected = (draft.selectedTableIds || []).indexOf(t.id) !== -1;
      var isUnavailable = t.operational_state !== 'available';

      var relY = (t.y != null ? t.y : 0) - (sectionBaseY || 0);
      if (relY < 0) relY = 0;

      var styleStr =
        'left:' + (t.x || 0) + 'px;' +
        'top:' + relY + 'px;' +
        'width:' + (t.width || 86) + 'px;' +
        'height:' + (t.height || 68) + 'px;';

      var cardClass = 'x-table-card' +
        (isSelected ? ' is-selected' : '') +
        (isUnavailable ? ' is-unavailable' : '');

      // Dynamic SVG colors: selected => #c6ff00, unavailable => #7d8288, normal => #2d2d2d
      var tableFill = isSelected ? '#c6ff00' : (isUnavailable ? '#7d8288' : '#2d2d2d');
      var textFill = isSelected ? '#1f2937' : '#ffffff';
      var labelText = UI.escape(t.label || ('meja ' + t.table_number));

      var textY = isUnavailable ? '21' : '26';

      var svgContent =
        '<svg class="x-table-svg" viewBox="0 0 66 48" width="100%" height="100%">' +
        '  <rect x="0" y="0" width="66" height="48" rx="5" ry="5" fill="' + tableFill + '"/>' +
        '  <text x="33" y="' + textY + '" fill="' + textFill + '" font-size="11" font-style="italic" font-weight="700" text-anchor="middle" dominant-baseline="middle" letter-spacing="-0.2">' + labelText + '</text>' +
        (isUnavailable ? '  <text x="33" y="33" fill="#e5e7eb" font-size="7" font-style="italic" font-weight="400" text-anchor="middle" dominant-baseline="middle" letter-spacing="-0.2">unavailable</text>' : '') +
        '</svg>';

      return (
        '<div class="' + cardClass + '" ' +
        '     data-table-id="' + t.id + '" data-table-number="' + t.table_number + '" style="' + styleStr + '">' +
        svgContent +
        '</div>'
      );
    }

    renderGrid();
    renderScheduleSection();

    // Cancel: "Gak jadi" closes and discards draft
    var cancelBtn = overlay.querySelector('#x-ful-btn-cancel');
    if (cancelBtn) {
      cancelBtn.onclick = function () {
        sh.close();
      };
    }

    // Confirm: "Konfirmasi" validates and commits draft state
    var confirmBtn = overlay.querySelector('#x-ful-btn-confirm');
    if (confirmBtn) {
      confirmBtn.onclick = function () {
        if (!availabilityMap[draft.type]) {
          if (UI && UI.toast) UI.toast('Tipe pembelian yang dipilih tidak tersedia.');
          return;
        }

        if (draft.type === 'dine_in') {
          if (!draft.selectedTableIds || draft.selectedTableIds.length === 0) {
            if (UI && UI.toast) UI.toast('Silakan pilih nomor meja untuk makan di tempat (Dine-in).');
            return;
          }
        }

        // Commit to state.fulfillment
        state.fulfillment.type = draft.type;
        state.fulfillment.scheduled = Boolean(draft.scheduled);
        if (draft.type === 'delivery' || draft.type === 'pickup') {
          state.fulfillment.date = draft.date || 'Hari ini';
          state.fulfillment.timeSlot = draft.scheduled ? (draft.timeSlot || '16:00-16:30') : 'Sekarang (15–25 menit)';
        } else if (draft.type === 'dine_in') {
          state.fulfillment.scheduled = false;
          var tNumStr = draft.tableNumber || computeSelectedTableNumbers(draft.selectedTableIds);
          state.fulfillment.tableNumber = tNumStr;
          state.fulfillment.table_ids = draft.selectedTableIds || [];
          state.fulfillment.guestCount = draft.guestCount || 1;
        } else {
          state.fulfillment.scheduled = false;
        }

        Store.setOrderType(draft.type);

        sh.close();
        var y = window.scrollY;
        renderLayout();
        calculateTotals();
        loadUpsell();
        scheduleDeliveryQuote();
        window.scrollTo(0, y);
      };
    }
  }

  // ── 2. Customer Auth / OTP Verification Sheet ──
  // Two-step flow: phone entry → OTP entry. Server OTP endpoints are the sole
  // authority for customer identity. Client never generates tokens.
  function openCustomerAuthSheet(onSuccess) {
    renderOtpPhoneStep(state.customer.phone || '', state.customer.name || '', onSuccess);
  }

  function renderOtpPhoneStep(phone, name, onSuccess) {
    var sh = makeOverlay(
      '<h3 class="x-alt-sheet-title">Verifikasi Nomor WhatsApp</h3>' +
      '<div style="font-size:13px;color:#6b7280;margin-bottom:12px;">Masukkan nomor WhatsApp aktif untuk menerima kode verifikasi.</div>' +
      '<div class="x-alt-sheet-label">Nama Lengkap</div>' +
      '<input type="text" id="x-otp-input-name" class="x-alt-input" placeholder="Contoh: Budi Santoso" value="' + UI.escape(name) + '">' +
      '<div class="x-alt-sheet-label" style="margin-top:10px;">Nomor WhatsApp</div>' +
      '<input type="tel" id="x-otp-input-phone" class="x-alt-input" placeholder="081234567890" value="' + UI.escape(phone) + '">' +
      '<button type="button" class="x-alt-submit-btn" id="x-otp-send-btn" style="margin-top:16px;">Kirim Kode OTP</button>'
    );

    var sendBtn = sh.overlay.querySelector('#x-otp-send-btn');

    sendBtn.onclick = function () {
      var n = sh.overlay.querySelector('#x-otp-input-name').value.trim();
      var p = sh.overlay.querySelector('#x-otp-input-phone').value.trim();

      if (!p) {
        if (UI && UI.toast) UI.toast('Nomor WhatsApp wajib diisi.');
        return;
      }

      sendBtn.disabled = true;
      sendBtn.textContent = 'Mengirim kode…';

      API.post('/auth/otp/send', { phone: p }).then(function (res) {
        if (res && res.success && res.challenge_id) {
          sh.close();
          renderOtpVerifyStep(p, n || 'Pelanggan', res.challenge_id, res.retry_after || 60, onSuccess);
        } else {
          sendBtn.disabled = false;
          sendBtn.textContent = 'Kirim Kode OTP';
          if (UI && UI.toast) UI.toast((res && res.message) || 'Gagal mengirim kode OTP.');
        }
      }).catch(function () {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Kirim Kode OTP';
        if (UI && UI.toast) UI.toast('Gagal mengirim kode OTP. Periksa koneksi Anda.');
      });
    };
  }

  function renderOtpVerifyStep(phone, name, challengeId, retryAfter, onSuccess) {
    var sh = makeOverlay(
      '<h3 class="x-alt-sheet-title">Masukkan Kode OTP</h3>' +
      '<div style="font-size:13px;color:#6b7280;margin-bottom:12px;">Kode verifikasi telah dikirim ke <b>' + UI.escape(phone) + '</b>.</div>' +
      '<div class="x-alt-sheet-label">Kode OTP (6 digit)</div>' +
      '<input type="tel" id="x-otp-input-code" class="x-alt-input" placeholder="123456" maxlength="6" inputmode="numeric" autocomplete="one-time-code" style="letter-spacing:6px;text-align:center;font-size:18px;font-weight:700;">' +
      '<button type="button" class="x-alt-submit-btn" id="x-otp-verify-btn" style="margin-top:16px;">Verifikasi</button>' +
      '<button type="button" id="x-otp-resend-btn" style="width:100%;margin-top:12px;padding:10px;border:0;background:transparent;color:#6b7280;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Kirim Ulang OTP</button>'
    );

    var verifyBtn = sh.overlay.querySelector('#x-otp-verify-btn');
    var resendBtn = sh.overlay.querySelector('#x-otp-resend-btn');
    var codeInput = sh.overlay.querySelector('#x-otp-input-code');
    var countdown = retryAfter;
    var countdownTimer = null;

    function startCountdown(seconds) {
      countdown = seconds;
      resendBtn.disabled = true;
      function tick() {
        if (countdown <= 0) {
          resendBtn.disabled = false;
          resendBtn.textContent = 'Kirim Ulang OTP';
          return;
        }
        resendBtn.textContent = 'Kirim Ulang OTP (' + countdown + ' detik)';
        countdown--;
        countdownTimer = setTimeout(tick, 1000);
      }
      tick();
    }

    startCountdown(countdown);

    if (codeInput) {
      setTimeout(function () { codeInput.focus(); }, 400);
    }

    verifyBtn.onclick = function () {
      var code = codeInput ? codeInput.value.trim() : '';

      if (!code || code.length < 4) {
        if (UI && UI.toast) UI.toast('Masukkan kode OTP yang valid.');
        return;
      }

      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Memverifikasi…';

      API.post('/auth/otp/verify', {
        challenge_id: challengeId,
        otp: code,
        phone: phone
      }).then(function (res) {
        if (res && res.success && res.verified && res.token) {
          state.customer.phone = phone;
          state.customer.name = name;
          state.customer.isVerified = true;

          Store.setCustomerSession({
            phone: phone,
            name: name,
            token: res.token
          });

          if (countdownTimer) clearTimeout(countdownTimer);
          sh.close();
          renderLayout();
          calculateTotals();
          if (UI && UI.toast) UI.toast('Nomor WhatsApp berhasil diverifikasi!');
          if (typeof onSuccess === 'function') {
            try { onSuccess(); } catch (e) { console.error('[Auth Callback]', e); }
          }
        } else {
          verifyBtn.disabled = false;
          verifyBtn.textContent = 'Verifikasi';
          if (UI && UI.toast) UI.toast((res && res.message) || 'Kode OTP tidak valid.');
          if (codeInput) { codeInput.value = ''; codeInput.focus(); }
        }
      }).catch(function () {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verifikasi';
        if (UI && UI.toast) UI.toast('Gagal memverifikasi. Periksa koneksi Anda.');
      });
    };

    resendBtn.onclick = function () {
      resendBtn.disabled = true;
      resendBtn.textContent = 'Mengirim…';

      API.post('/auth/otp/send', { phone: phone }).then(function (res) {
        if (res && res.success && res.challenge_id) {
          challengeId = res.challenge_id;
          startCountdown(res.retry_after || 60);
          if (UI && UI.toast) UI.toast('Kode OTP baru telah dikirim.');
        } else {
          resendBtn.disabled = false;
          resendBtn.textContent = 'Kirim Ulang OTP';
          if (UI && UI.toast) UI.toast((res && res.message) || 'Gagal mengirim ulang OTP.');
        }
      }).catch(function () {
        resendBtn.disabled = false;
        resendBtn.textContent = 'Kirim Ulang OTP';
        if (UI && UI.toast) UI.toast('Gagal mengirim ulang OTP. Periksa koneksi Anda.');
      });
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
    if (window.XentraLocationPicker && typeof window.XentraLocationPicker.open === 'function') {
      window.XentraLocationPicker.open({
        onSelect: function () {
          var savedDest = (Store.getActiveDestination && Store.getActiveDestination()) || Store.getState().activeDestination || Store.getState().location;
          if (savedDest && (savedDest.address || savedDest.formatted_address)) {
            state.address.formatted_address = savedDest.address || savedDest.formatted_address;
            if (savedDest.latitude != null) state.address.latitude = Number(savedDest.latitude);
            if (savedDest.longitude != null) state.address.longitude = Number(savedDest.longitude);
            if (savedDest.label) state.address.label = savedDest.label;
            if (savedDest.detail) state.address.detail = savedDest.detail;
          }
          var y = window.scrollY;
          renderLayout();
          calculateTotals();
          loadUpsell();
          scheduleDeliveryQuote();
          window.scrollTo(0, y);
        }
      });
      return;
    }

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
        if (Store.setActiveDestination) {
          Store.setActiveDestination({
            address: state.address.formatted_address,
            formatted_address: state.address.formatted_address,
            latitude: state.address.latitude,
            longitude: state.address.longitude,
            label: state.address.label,
            detail: state.address.detail,
            source: 'manual',
            is_explicit: true
          });
        } else {
          Store.setLocation({
            formatted_address: state.address.formatted_address,
            latitude: state.address.latitude,
            longitude: state.address.longitude,
            label: state.address.label,
            detail: state.address.detail
          });
        }
      } catch (_) {}

      sh.close();
      var y = window.scrollY;
      renderLayout();
      calculateTotals();
      loadUpsell();
      scheduleDeliveryQuote();
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
  // The pwa_runtime context (display_mode + install_state) is sent to the
  // authoritative PrePaymentVerificationGate; the client never decides whether
  // a claimed reward may be paid.
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

    var activeSession = Store.getState().customerSession;
    if (!activeSession || !activeSession.token || activeSession.token.indexOf('xnt_cust_') !== 0) {
      if (UI && UI.toast) UI.toast('Silakan verifikasi nomor WhatsApp Anda terlebih dahulu.');
      openCustomerAuthSheet();
      return;
    }

    var branchId = state.matchedBranch ? state.matchedBranch.id : undefined;

    // R1 CART/CHECKOUT BOUNDARY — this page submits ONE single-branch checkout
    // scope. A multi-branch cart is allowed at cart level, but a checkout must
    // never bundle items from different branch scopes, nor ship one scope
    // against a different branch. Fail fast with an explicit message instead of
    // silently selecting/merging/splitting/rematching scopes. The server gate
    // enforces the identical rule authoritatively.
    var itemBranchKeys = [];
    items.forEach(function (i) {
      if (i.branch_id) {
        var ik = String(i.branch_id);
        if (itemBranchKeys.indexOf(ik) === -1) itemBranchKeys.push(ik);
      }
    });
    var scopeBroken = itemBranchKeys.length > 1 ||
      (itemBranchKeys.length === 1 && branchId && String(branchId) !== itemBranchKeys[0]);
    if (scopeBroken) {
      if (UI && UI.toast) UI.toast('Checkout hanya dapat berisi produk dari satu cabang. Pisahkan pesanan Anda per cabang.');
      return;
    }

    state.isSubmitting = true;
    var btn = $('x-btn-submit-order');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Memverifikasi pesanan…';
      btn.style.opacity = '0.7';
    }

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
          name: i.name,
          branch_id: i.branch_id || null
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

  // R1.5 INDEPENDENT CHECKOUT: returns true when every line currently in the
  // cart is part of the submitted order ids — i.e. this checkout consumed the
  // WHOLE cart (legacy single-branch flow) and the cart may be cleared as today.
  function allCartItemsOrdered(orderedIds) {
    var set = {};
    orderedIds.forEach(function (id) { set[String(id)] = true; });
    var cartItems = (Store.getState().cart.items || []);
    if (!cartItems.length) return true;
    return cartItems.every(function (it) { return set[String(it.id)]; });
  }

  function proceedCreateOrder() {
    var btn = $('x-btn-submit-order');
    if (btn) btn.textContent = 'Memproses pesanan…';

    var items = getCheckoutItems();
    var orderedIds = items.map(function (i) { return String(i.id); });
    var itemsHaveBranchProvenance = items.some(function (i) { return Boolean(i.branch_id); });
    var branchId = state.matchedBranch ? state.matchedBranch.id : undefined;
    var fulType = state.fulfillment.type;
    var isDelivery = fulType === 'delivery';

    var pwaRuntime = (window.Xentra && window.Xentra.PwaRuntime) ? window.Xentra.PwaRuntime.getPwaRuntimeContext() : { display_mode: 'browser' };

    // Canonical, DEVICE-LOCAL, timezone-aware timestamp for the selected slot.
    // The human-readable day label ("Hari ini"/"Besok"/weekday) is resolved to
    // a device-local ISO date; the offset is the device's own UTC offset. The
    // value is never converted back to a server/WordPress timezone.
    function resolveScheduledIso() {
      if (DeliverySchedule && typeof DeliverySchedule.selectedSlotToIso === 'function') {
        var iso = DeliverySchedule.selectedSlotToIso(new Date(), state.fulfillment.date, state.fulfillment.timeSlot);
        if (iso && iso.start) return iso;
      }
      // Fallback (no module in context): keep legacy human-readable text.
      return { start: state.fulfillment.date + ' ' + state.fulfillment.timeSlot, end: null };
    }

    var payload = {
      branch_id: branchId,
      customer: {
        name: state.customer.name || 'Pelanggan Bangjo',
        phone: state.customer.phone
      },
      pwa_runtime: pwaRuntime,
      order_type: fulType === 'dinein' ? 'dine_in' : fulType,
      fulfillment: {
        type: fulType === 'dinein' ? 'dine_in' : fulType,
        table_number: state.fulfillment.tableNumber || null,
        table_ids: Array.isArray(state.fulfillment.table_ids) ? state.fulfillment.table_ids : [],
        reservation_date: state.fulfillment.reservationDate || null,
        guest_count: state.fulfillment.guestCount || null
      },
      table_number: state.fulfillment.tableNumber || null,
      table_ids: Array.isArray(state.fulfillment.table_ids) ? state.fulfillment.table_ids : [],
      reservation_date: state.fulfillment.reservationDate || null,
      guest_count: state.fulfillment.guestCount || null,
      schedule_type: state.fulfillment.scheduled ? 'scheduled' : 'asap',
      scheduled_slot_start: state.fulfillment.scheduled ? resolveScheduledIso().start : null,
      scheduled_slot_end: state.fulfillment.scheduled ? resolveScheduledIso().end : null,
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
          note: i.note || '',
          branch_id: i.branch_id || null
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
      // R1 CART/CHECKOUT BOUNDARY — clear only what THIS single-branch checkout
      // consumed: whole cart when the checkout covered it (legacy flow, cart
      // cleared as before), otherwise drop only the ordered branch scope so an
      // independent checkout of another branch scope survives (R1.5).
      if (currentItemId) {
        Store.removeItem(currentItemId);
      } else if (allCartItemsOrdered(orderedIds)) {
        Store.clearCart();
      } else if (itemsHaveBranchProvenance && branchId) {
        Store.removeBranchItems(branchId);
      } else {
        orderedIds.forEach(function (id) { Store.removeItem(id); });
      }
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
  // Registered ONCE at module scope. Reacts only to cart / location mutations
  // (the ops that actually change checkout rows or delivery eligibility) and
  // delegates rendering to syncRowsFromItems (targeted qty patch / full rebuild
  // when the line set changed). Delivery re-quote is scheduled (debounced +
  // latest-wins), never fired synchronously from here.
  Store.subscribe(function (mutation) {
    if (!checkoutContainer || state.isSubmitting) return;
    if (Router && Router.getCurrentView && Router.getCurrentView() !== 'checkout') return;
    if (checkoutContainer.style.display === 'none') return;
    var mt = mutation && mutation.type;
    if (mt !== 'cart' && mt !== 'location' && mt !== 'activeDestination') return;

    if (mt === 'location' || mt === 'activeDestination') {
      var savedDest = (Store.getActiveDestination && Store.getActiveDestination()) || Store.getState().activeDestination || Store.getState().location;
      if (savedDest && (savedDest.address || savedDest.formatted_address)) {
        state.address.formatted_address = savedDest.address || savedDest.formatted_address;
        if (savedDest.latitude != null) state.address.latitude = Number(savedDest.latitude);
        if (savedDest.longitude != null) state.address.longitude = Number(savedDest.longitude);
        if (savedDest.label) state.address.label = savedDest.label;
        if (savedDest.detail) state.address.detail = savedDest.detail;
      }
      renderLayout();
      calculateTotals();
    }

    // Cart membership changed: re-apply the rail so a cleared line re-enters it
    // (recentlyRemoved) and a re-added line drops out of it — without a refetch.
    if (mt === 'cart') applyUpsellPool(upsellItems);
    syncRowsFromItems(getCheckoutItems());
    scheduleDeliveryQuote();
  });

  window.Xentra = window.Xentra || {};
  window.Xentra.Checkout = {
    mount: mount,
    openCustomerAuthSheet: openCustomerAuthSheet
  };
  window.openCustomerAuthSheet = openCustomerAuthSheet;
})();
