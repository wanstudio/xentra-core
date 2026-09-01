/**
 * Xentra Customer PWA — Checkout Alternative 2
 * Pixel replica of mobile checkout "Checkout Bangjo" (Bangjo) reference image.
 * Sections: header → promo banner → item cards → add-on rail → delivery card
 *          → address card → payment summary → Pesan sekarang CTA
 * English code / Indonesian UI copy.
 */
(function () {
  'use strict';

  var API = window.Xentra && window.Xentra.API;
  var Store = window.Xentra.Store;
  var UI = window.Xentra.UI;
  var Router = window.Xentra.Router;

  var checkoutContainer = null;
  var upsellItems = [];
  var currentItemId = null;

  var state = {
    fulfillment: {
      type: 'delivery',
      scheduled: false,
      date: 'Hari Ini',
      timeSlot: '12.00 - 12.30',
      typeLabel: 'delivery / pick-up / dine-in',
      note: 'titipin satpam aja ddddd asdd dads adsasd dffff dfsfer er...'
    },
    customer: { name: 'Pelanggan Bangjo', phone: '' },
    address: {
      label: 'Rumah Gw',
      formatted_address: 'Jl. Dewi 18, Padaa 1, Panjang Bandar Lampung 35241',
      detail: 'catatannya di samping vihara ada gang, masuk aja tanya rumah Budi',
      driver_note: '',
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

  // — PWA Install (Android / iOS) Guide —
  var deferredPrompt = null;
  var isIosPwa = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  var isStandalonePwa = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  window.addEventListener('beforeinstallprompt', function(e){ e.preventDefault(); deferredPrompt = e; });
  window.addEventListener('appinstalled', function(){ deferredPrompt = null; try{ localStorage.setItem('xentra_pwa_installed','1'); }catch(_){} UI.toast('Aplikasi berhasil dipasang!'); });

  function showPwaGuideSheet(platform){
    if(document.getElementById('x-pwa-guide-overlay')) return;
    var isIos = platform === 'ios';
    var steps = isIos ? (
      '<div class="x-pwa-guide-step"><div class="x-pwa-step-badge">1</div><div class="x-pwa-step-body"><strong>Ketuk tombol Bagikan</strong><span>Cari ikon Share di menu bawah Safari.</span></div></div>' +
      '<div class="x-pwa-guide-step"><div class="x-pwa-step-badge">2</div><div class="x-pwa-step-body"><strong>Pilih "Tambah ke Layar Utama"</strong><span>Geser ke bawah lalu pilih <b>Tambahkan ke Layar Utama</b>.</span></div></div>' +
      '<div class="x-pwa-guide-step"><div class="x-pwa-step-badge">3</div><div class="x-pwa-step-body"><strong>Ketuk "Tambah"</strong><span>Tekan <b>Tambah</b> di pojok kanan atas.</span></div></div>'
    ) : (
      '<div class="x-pwa-guide-step"><div class="x-pwa-step-badge">1</div><div class="x-pwa-step-body"><strong>Buka Menu Browser</strong><span>Ketuk titik tiga (⋮) di Chrome.</span></div></div>' +
      '<div class="x-pwa-guide-step"><div class="x-pwa-step-badge">2</div><div class="x-pwa-step-body"><strong>Pilih "Install Aplikasi"</strong><span>Pilih <b>Install Aplikasi</b> atau <b>Tambahkan ke Layar Utama</b>.</span></div></div>' +
      '<div class="x-pwa-guide-step"><div class="x-pwa-step-badge">3</div><div class="x-pwa-step-body"><strong>Konfirmasi Install</strong><span>Tekan <b>Install</b> saat pop-up muncul.</span></div></div>'
    );
    var icon = '/assets/pwa/icon-192.png';
    var html = '<div class="x-pwa-guide-backdrop"></div><div class="x-pwa-guide-sheet"><div class="x-sheet-handle"></div><div class="x-pwa-guide-head"><img src="'+icon+'" alt="Bangjo" class="x-pwa-guide-icon"><div><h3>Pasang Aplikasi Bangjo</h3><p>Nikmati pemesanan instan tanpa buka browser</p></div></div><div class="x-pwa-guide-steps">'+steps+'</div><button type="button" id="x-pwa-guide-close" class="x-pwa-guide-close-btn">Mengerti, Saya Coba</button></div>';
    var overlay = document.createElement('div');
    overlay.id = 'x-pwa-guide-overlay';
    overlay.className = 'x-pwa-guide-overlay open';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
    requestAnimationFrame(function(){ overlay.classList.add('open'); });
    function closeGuide(){ overlay.classList.remove('open'); setTimeout(function(){ if(overlay.parentNode) overlay.remove(); }, 260); }
    var bg = overlay.querySelector('.x-pwa-guide-backdrop');
    var btn = overlay.querySelector('#x-pwa-guide-close');
    if(bg) bg.addEventListener('click', closeGuide);
    if(btn) btn.addEventListener('click', function(){ closeGuide(); });
  }
  function handleInstallClick(){
    if(isStandalonePwa){ UI.toast('Aplikasi sudah terpasang di perangkat Anda.'); return; }
    if(deferredPrompt){
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function(choice){
        if(choice.outcome === 'accepted'){
          try{ localStorage.setItem('xentra_pwa_installed','1'); }catch(_){}
          UI.toast('Terima kasih telah memasang aplikasi Bangjo!');
        }
        deferredPrompt = null;
      }).catch(function(){});
      return;
    }
    // iOS atau Android tanpa prompt -> tampilkan panduan
    showPwaGuideSheet(isIosPwa ? 'ios' : 'android');
  }

  function $(id) { return document.getElementById(id); }

  function fmt(n) {
    n = Number(n) || 0;
    return n.toLocaleString('id-ID');
  }
  function fmtIDR(n) { return fmt(n); }

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
    // allow explicit param via hash query? keep simple
    if (urlItemId) currentItemId = String(urlItemId);

    // restore saved location
    var savedLoc = Store.getState().location;
    if (savedLoc && savedLoc.formatted_address) {
      state.address.formatted_address = savedLoc.formatted_address;
      if (savedLoc.latitude) state.address.latitude = savedLoc.latitude;
      if (savedLoc.longitude) state.address.longitude = savedLoc.longitude;
    }

    var items = getCheckoutItems();
    if (!items.length) {
      // Seed demo items so designer review shows the replica even when cart empty
      // Comment out if you want true empty state only
      // renderEmpty(); return;
      // For empty cart we still show empty state, but add a demo hint button
      renderEmpty();
      return;
    }
    renderLayout();
    calculateTotals();
    loadUpsell();
    refreshDeliveryQuote();
  }

  // ── Delivery quote via BranchMatcher/RouteService/DeliveryCalculator (single source of truth) ──
  function refreshDeliveryQuote() {
    if (!API) return;
    var isDelivery = state.fulfillment.type === 'delivery';
    if (!isDelivery) { state.deliveryFee = 0; state.discount = 0; state.deliveryQuote = null; calculateTotals(); return; }
    var items = getCheckoutItems();
    var subtotal = items.reduce(function(s,i){ return s + Number(i.price||0)*Number(i.quantity||0); }, 0);
    // persist location to Store for other pages
    try { var loc = Store.getState().location; if (!loc || loc.latitude !== state.address.latitude) Store.setLocation({ formatted_address: state.address.formatted_address, latitude: state.address.latitude, longitude: state.address.longitude }); } catch(_){}
    API.post('/delivery/match-branch', { latitude: state.address.latitude, longitude: state.address.longitude, subtotal: subtotal }).then(function(res){
      if (res && res.eligible && res.delivery) {
        state.matchedBranch = res.branch || null;
        state.deliveryQuote = res.delivery;
        state.deliveryFee = Number(res.delivery.final_delivery_fee || 0);
        state.discount = Number(res.delivery.discount_amount || 0);
        try { Store.setMatchedBranch(res); } catch(_){}
      } else if (res && !res.eligible) {
        state.deliveryFee = 0; state.discount = 0; state.deliveryQuote = res.delivery || null;
        UI.toast(res.reason || 'Alamat di luar jangkauan');
      }
      calculateTotals();
    }).catch(function(){
      // keep previous fee - backend will recalc on create-order anyway
      calculateTotals();
    });
  }

  function renderEmpty() {
    checkoutContainer.innerHTML =
      '<div class="xentra-checkout x-checkout-alt2">' +
      '  <div class="x-alt-header"><button type="button" id="x-back-empty" class="x-alt-back" aria-label="Kembali"><img src="/assets/icons/arrowback.svg" alt=""></button><span>Checkout Bangjo</span></div>' +
      '  <div style="text-align:center;padding:48px 20px;">' +
      '    <div style="font-size:44px;margin-bottom:10px;">🛒</div>' +
      '    <div style="font-weight:800;font-size:18px;color:#111;margin-bottom:6px;">Keranjang masih kosong</div>' +
      '    <div style="font-size:13px;color:#6b7280;margin-bottom:18px;">Tambah menu dulu untuk melihat tampilan checkout replica.</div>' +
      '    <button type="button" id="x-btn-demo-fill" class="x-alt-submit-btn" style="max-width:280px;margin:0 auto;">Isi contoh & lihat checkout</button>' +
      '    <button type="button" id="x-btn-browse-empty" style="margin-top:10px;background:#fff;border:1px solid #e5e7eb;border-radius:999px;padding:10px 22px;font-weight:700;cursor:pointer;">Lihat Menu</button>' +
      '  </div>' +
      '</div>';
    var b1 = $('x-back-empty'); if (b1) b1.onclick = function(){ Router.navigate('home'); };
    var b2 = $('x-btn-browse-empty'); if (b2) b2.onclick = function(){ Router.navigate('home'); };
    var demo = $('x-btn-demo-fill');
    if (demo) demo.onclick = function(){
      Store.addItem({ id: 'demo-mie', name: 'Mie Gurith', price: 15000, regular_price: 17000, image_url: '', description: '', note: 'pedas banget' }, 5);
      Store.addItem({ id: 'demo-esteh', name: 'Es Teh', price: 5000, image_url: '' }, 1);
      mount();
    };
  }

  // ── Layout ──
  function renderLayout() {
    var items = getCheckoutItems();
    var isDelivery = state.fulfillment.type === 'delivery';
    var subtotal = items.reduce(function(s,i){ return s + Number(i.price||0)*Number(i.quantity||0); }, 0);
    var fee = isDelivery ? state.deliveryFee : 0;
    var discount = state.discount;
    var grand = Math.max(0, subtotal + fee - discount);
    var oldTotal = subtotal + fee;

    // Address note truncation hint: keep one line in card, full on sheet
    var addrNote = state.address.detail || '';
    var driverNote = state.fulfillment.note || '';

    checkoutContainer.innerHTML =
      '<div class="xentra-checkout x-checkout-alt2">' +

      // 1. Header
      '  <div class="x-alt-header"><button type="button" id="x-checkout-back" class="x-alt-back" aria-label="Kembali"><img src="/assets/icons/arrowback.svg" alt=""></button><span>Checkout Bangjo</span></div>' +

      // 2. Install Promo Banner
      '  <div class="x-alt-promo-banner" id="x-promo-banner">' +
      '    <img class="x-alt-promo-img" src="/assets/img/iced-tea.png" alt="Es Teh" onerror="this.style.display=\'none\'">' +
      '    <div class="x-alt-promo-copy"><div class="x-alt-promo-title">Install sekarang &amp; dapatkan gratis es teh</div><div class="x-alt-promo-snk">syarat &amp; ketentuan berlaku</div></div>' +
      '    <button type="button" class="x-alt-promo-install" id="x-btn-promo-install">Install</button>' +
      '  </div>' +

      // 3+4. Order Items (each as white card)
      '  <div id="x-checkout-items-list" class="x-alt-items-stack">' + renderItemsHtml(items) + '</div>' +

      // 5. Add-on rail
      '  <div class="x-alt-addon-card" id="x-upsell-container">' +
      '    <div class="x-alt-addon-head">Tambah ini untuk melengkapi pesananmu</div>' +
      '    <div class="x-alt-addon-track" id="x-addon-track"><div class="x-alt-addon-loading">Memuat rekomendasi…</div></div>' +
      '  </div>' +

      // 6. Delivery selection card
      '  <div class="x-alt-card x-alt-delivery-card" id="x-card-fulfillment">' +
      '    <div class="x-alt-card-top">' +
      '      <div class="x-alt-icon-wrap"><img src="/assets/icons/delivery.png" alt="" onerror="this.src=\'/assets/icons/bike.svg\'"></div>' +
      '      <div class="x-alt-delivery-copy">' +
      '        <div class="x-alt-delivery-type">' + UI.escape(state.fulfillment.typeLabel) + '</div>' +
      '        <div class="x-alt-delivery-time">Hari ini | ' + UI.escape(state.fulfillment.timeSlot) + '</div>' +
      '        <div class="x-alt-delivery-note">Catatan: ' + UI.escape(driverNote) + '</div>' +
      '      </div>' +
      '      <button type="button" class="x-alt-pill" id="x-btn-choose-fulfillment">Pilih</button>' +
      '    </div>' +
      '    <button type="button" class="x-alt-note-btn" id="x-btn-fulfillment-note"><img src="/assets/icons/write.svg" alt="">Catatan</button>' +
      '  </div>' +

      // 7. Delivery Address card
      '  <div class="x-alt-card x-alt-address-card" id="x-card-address">' +
      '    <div class="x-alt-address-head"><span>Alamat Pengiriman</span><button type="button" class="x-alt-pill" id="x-btn-change-address">Pilih</button></div>' +
      '    <div class="x-alt-addr-label">' + UI.escape(state.address.label) + '</div>' +
      '    <div class="x-alt-addr-text">' + UI.escape(state.address.formatted_address) + '</div>' +
      '    <div class="x-alt-addr-note">' + UI.escape(addrNote) + '</div>' +
      '  </div>' +

      // 8. Payment Summary card
      '  <div class="x-alt-card x-alt-summary-card" id="x-payment-summary-card">' +
      '    <div class="x-alt-summary-title">Ringkasan pembayaran</div>' +
      '    <div class="x-alt-sum-row"><span>Harga</span><span id="x-sum-subtotal">' + fmtIDR(subtotal) + '</span></div>' +
      '    <div class="x-alt-sum-row"><span>Biaya Penanganan dan Pengiriman</span><span id="x-sum-delivery">' + fmtIDR(fee) + '</span></div>' +
      '    <div class="x-alt-sum-row x-alt-discount-row"><span>Diskon</span><span id="x-sum-discount" class="x-alt-discount">-' + fmtIDR(discount) + '</span></div>' +
      '    <div class="x-alt-sum-divider"></div>' +
      '    <div class="x-alt-sum-total"><span>Total pembayaran</span><span><s id="x-sum-oldtotal" class="x-alt-strike">' + fmtIDR(oldTotal) + '</s><b id="x-sum-total">' + fmtIDR(grand) + '</b></span></div>' +
      '    <div class="x-alt-pay-methods">' +
      '      <button type="button" class="x-alt-pay-opt ' + (state.paymentMethod==='cash'?'is-active':'') + '" id="x-opt-cash"><span class="x-alt-pay-opt-icon">⌖</span><span>Tunai (COD) / Bayar di tempat</span></button>' +
      '      <button type="button" class="x-alt-pay-opt x-alt-pay-opt--muted ' + (state.paymentMethod==='midtrans'?'is-active':'') + '" id="x-opt-online"><span class="x-alt-pay-opt-icon">◈</span><span>Online Pay / QRIS / E-Wallet</span></button>' +
      '    </div>' +
      '    <div class="x-alt-trust"><span>🔒 Transaksi aman dan terenkripsi</span><span class="x-alt-trust-sep">|</span><span>Diproses oleh <b>midtrans</b></span></div>' +
      '  </div>' +

      // 9. CTA sticky spacer + bar
      '  <div class="x-alt-cta-spacer"></div>' +
      '  <div class="x-alt-cta-bar"><button type="button" id="x-btn-submit-order" class="x-alt-submit-btn">Pesan sekarang</button></div>' +

      '</div>';

    bindEvents();
    // apply pay selection visual
    syncPayVisual();
  }

  function renderItemsHtml(items) {
    if (!items.length) return '<div class="x-alt-empty">Keranjang kosong</div>';
    var html = '';
    items.forEach(function(item, idx){
      var hasOld = item.regular_price && Number(item.regular_price) > Number(item.price);
      var img = item.image_url || item.image || '';
      // placeholder if no image
      var qty = Number(item.quantity||1);
      var note = item.note || (idx===0 ? 'pedas banget ddddd asdd dadds adsasd' : '');
      html +=
        '<div class="x-alt-card x-alt-item-card">' +
        '  <div class="x-alt-item-left">' +
        '    <div class="x-alt-item-name">' + UI.escape(item.name) + '</div>' +
        (note ? '<div class="x-alt-item-note">Catatan: ' + UI.escape(note) + '</div>' : '') +
        '    <div class="x-alt-item-price">' + (Number(item.price)===0 ? '<s class="x-alt-old">' + fmtIDR(item.regular_price || 5000) + '</s> <b style="color:#16a34a">Gratis</b>' : (hasOld ? '<s class="x-alt-old">' + fmtIDR(item.regular_price) + '</s> ' : '') + '<b>' + fmtIDR(item.price) + '</b>') + '</div>' +
        (idx===0 ? '<div class="x-alt-item-tag"><img src="/assets/icons/diskon.svg" alt="" onerror="this.style.display=\'none\'"> Discount ongkir 7rb</div>' : '') +
        '    <div class="x-alt-item-actions">' +
        '      <button type="button" class="x-alt-note-btn" data-note-item="' + item.id + '"><img src="/assets/icons/write.svg" alt="">Catatan</button>' +
        '      <div class="x-alt-qty"><button type="button" class="x-alt-qty-btn" data-minus-item="' + item.id + '">−</button><span class="x-alt-qty-val">' + qty + '</span><button type="button" class="x-alt-qty-btn" data-plus-item="' + item.id + '">+</button></div>' +
        '    </div>' +
        '  </div>' +
        '  <div class="x-alt-item-right">' +
        '    <div class="x-alt-item-img-wrap">' + (img ? '<img src="' + UI.escape(img) + '" alt="" onerror="this.parentElement.innerHTML=\'<div class=\\\'x-alt-img-ph\\\'></div>\'">' : '<div class="x-alt-img-ph"></div>') + '</div>' +
        '  </div>' +
        '</div>';
    });
    return html;
  }

  function calculateTotals() {
    var items = getCheckoutItems();
    var subtotal = items.reduce(function(s,i){ return s + Number(i.price||0)*Number(i.quantity||0); }, 0);
    var isDelivery = state.fulfillment.type === 'delivery';
    var fee = isDelivery ? state.deliveryFee : 0;
    var discount = state.discount;
    var grand = Math.max(0, subtotal + fee - discount);
    var oldTotal = subtotal + fee;
    var elSub = $('x-sum-subtotal'); if (elSub) elSub.textContent = fmtIDR(subtotal);
    var elDel = $('x-sum-delivery'); if (elDel) elDel.textContent = fmtIDR(fee);
    var elDisc = $('x-sum-discount'); if (elDisc) elDisc.textContent = '-' + fmtIDR(discount);
    var elOld = $('x-sum-oldtotal'); if (elOld) elOld.textContent = fmtIDR(oldTotal);
    var elGrand = $('x-sum-total'); if (elGrand) elGrand.textContent = fmtIDR(grand);
  }

  // ── Upsell via GET /catalog/menu (reuse existing catalog service) ──
  function loadUpsell() {
    var track = $('x-addon-track');
    if (!track) return;
    if (!API) return;
    API.get('/catalog/menu').then(function(data){
      var pool = [];
      if (data && Array.isArray(data.all_products) && data.all_products.length) pool = data.all_products;
      else if (data && data.products && Array.isArray(data.products.items)) pool = data.products.items;
      else if (data && Array.isArray(data.products)) pool = data.products;
      else if (data && Array.isArray(data.items)) pool = data.items;
      if (!pool.length) throw new Error('empty menu');
      // filter out items already in cart, pick 3 random
      var cartIds = {};
      getCheckoutItems().forEach(function(i){ cartIds[String(i.id)] = true; });
      var filtered = pool.filter(function(p){ return !cartIds[String(p.id)]; });
      var src = filtered.length >= 3 ? filtered : pool;
      upsellItems = src.slice(0, 6);
      renderUpsellTrack(track, upsellItems);
    }).catch(function(){
      // fallback to dedicated upsell endpoint (existing)
      API.get('/catalog/upsell').then(function(data){
        var items = (data && (data.products || data.items || data.data)) || [];
        if (Array.isArray(items) && items.length) {
          upsellItems = items.slice(0,6);
          renderUpsellTrack(track, upsellItems);
        }
      }).catch(function(){});
    });
  }

  function renderUpsellTrack(container, items) {
    var html = '';
    items.forEach(function(p){
      var img = p.image_url || p.image || '';
      html +=
        '<div class="x-alt-addon-item">' +
        '  <div class="x-alt-addon-img">' + (img ? '<img src="' + UI.escape(img) + '" alt="" onerror="this.style.display=\'none\'">' : '<div class="x-alt-addon-ph"></div>') + '</div>' +
        '  <div class="x-alt-addon-name">' + UI.escape(p.name || 'Es Jeruk') + '</div>' +
        '  <div class="x-alt-addon-price">' + fmtIDR(p.price || 5000) + '</div>' +
        '  <button type="button" class="x-alt-addon-add" data-add-upsell="' + p.id + '" aria-label="Tambah">+</button>' +
        '</div>';
    });
    container.innerHTML = html;
    container.querySelectorAll('[data-add-upsell]').forEach(function(btn){
      btn.onclick = function(){
        var pid = btn.dataset.addUpsell;
        var found = items.find(function(x){ return String(x.id)===String(pid); });
        // fallback items map to generic Es Jeruk
        if (found) {
          if (String(pid).indexOf('fallback')===0) {
            Store.addItem({ id: 'esjeruk-'+Date.now(), name: 'Es Jeruk', price: 5000, image_url: '' }, 1);
          } else {
            Store.addItem(found, 1);
          }
          UI.toast((found.name||'Item')+' ditambahkan');
          // re-render qty/totals without full mount (keeps scroll)
          var listEl = $('x-checkout-items-list');
          if (listEl) { listEl.innerHTML = renderItemsHtml(getCheckoutItems()); bindItemEvents(); }
          calculateTotals();
        }
      };
    });
  }

  // ── Events ──
  function bindEvents() {
    var back = $('x-checkout-back'); if (back) back.onclick = function(){ Router.navigate('home'); };
    var promoBtn = $('x-btn-promo-install'); if (promoBtn) promoBtn.onclick = handleInstallClick;

    bindItemEvents();

    var cardFul = $('x-card-fulfillment');
    // Pilih button specifically, but also whole card click is common - keep Pilih only to avoid accidental
    var btnFul = $('x-btn-choose-fulfillment');
    if (btnFul) btnFul.onclick = function(e){ e.stopPropagation(); openFulfillmentSheet(); };
    // also allow tapping card area
    if (cardFul) cardFul.addEventListener('click', function(e){
      if (e.target.closest('button')) return;
      openFulfillmentSheet();
    });

    var btnFulNote = $('x-btn-fulfillment-note');
    if (btnFulNote) btnFulNote.onclick = function(e){ e.stopPropagation(); openFulfillmentNoteSheet(); };

    var btnAddr = $('x-btn-change-address'); if (btnAddr) btnAddr.onclick = openAddressSheet;
    var addrCard = $('x-card-address'); if (addrCard) addrCard.addEventListener('click', function(e){ if(e.target.closest('button')) return; openAddressSheet(); });

    var optCash = $('x-opt-cash'); if (optCash) optCash.onclick = function(){ state.paymentMethod='cash'; syncPayVisual(); };
    var optOn = $('x-opt-online'); if (optOn) optOn.onclick = function(){ state.paymentMethod='midtrans'; syncPayVisual(); };

    var submit = $('x-btn-submit-order'); if (submit) submit.onclick = submitOrder;

    // note buttons per item
    checkoutContainer.querySelectorAll('[data-note-item]').forEach(function(btn){
      btn.onclick = function(){ openItemNoteSheet(btn.dataset.noteItem); };
    });
  }

  function bindItemEvents(){
    if (!checkoutContainer) return;
    checkoutContainer.querySelectorAll('[data-plus-item]').forEach(function(btn){
      btn.onclick = function(){
        var it = Store.findCartItem(btn.dataset.plusItem);
        if (it) Store.setQty(it.id, Number(it.quantity)+1);
      };
    });
    checkoutContainer.querySelectorAll('[data-minus-item]').forEach(function(btn){
      btn.onclick = function(){
        var it = Store.findCartItem(btn.dataset.minusItem);
        if (it) Store.setQty(it.id, Number(it.quantity)-1);
      };
    });
  }

  function syncPayVisual(){
    var c = $('x-opt-cash'), o = $('x-opt-online');
    if (c) c.classList.toggle('is-active', state.paymentMethod==='cash');
    if (o) o.classList.toggle('is-active', state.paymentMethod==='midtrans');
  }

  // ── Sheets ──
  function makeOverlay(innerHtml) {
    var overlay = document.createElement('div');
    overlay.className = 'x-overlay open';
    overlay.innerHTML = '<div class="x-sheet open x-alt-sheet"><div class="x-sheet-handle"></div>' + innerHtml + '</div>';
    document.body.appendChild(overlay);
    // animate in (CSS handles)
    requestAnimationFrame(function(){ overlay.classList.add('open'); });
    function close(){
      overlay.classList.remove('open');
      setTimeout(function(){ if(overlay.parentNode) overlay.remove(); }, 260);
    }
    overlay.addEventListener('click', function(e){ if(e.target===overlay) close(); });
    return { overlay: overlay, close: close };
  }

  function openFulfillmentSheet(){
    var draftType = state.fulfillment.type;
    var sh = makeOverlay(
      '<h3 class="x-alt-sheet-title">Pilih tipe pembelian</h3>' +
      '<div class="x-alt-fulfillment-grid">' +
      '  <button type="button" class="x-alt-fulfill-opt '+(draftType==='delivery'?'is-active':'')+'" data-type="delivery"><img src="/assets/icons/delivery.png" alt=""><span>Delivery</span></button>' +
      '  <button type="button" class="x-alt-fulfill-opt '+(draftType==='pickup'?'is-active':'')+'" data-type="pickup"><img src="/assets/icons/pick_up.png" alt=""><span>Pick-up</span></button>' +
      '  <button type="button" class="x-alt-fulfill-opt '+(draftType==='dinein'?'is-active':'')+'" data-type="dinein"><img src="/assets/icons/dine_in.png" alt=""><span>Dine-in</span></button>' +
      '</div>' +
      '<div class="x-alt-sheet-divider"></div>' +
      '<div class="x-alt-sheet-label">Waktu</div>' +
      '<div class="x-alt-time-options">' +
      '  <label class="x-alt-radio"><input type="radio" name="ful-time" value="now" checked><span>Sekarang (15–25 menit)</span></label>' +
      '  <label class="x-alt-radio"><input type="radio" name="ful-time" value="schedule"><span>Jadwalkan — Hari ini 12.00–12.30</span></label>' +
      '</div>' +
      '<button type="button" class="x-alt-submit-btn" id="x-save-fulfillment" style="margin-top:18px;">Simpan</button>'
    );
    var overlay = sh.overlay;
    overlay.querySelectorAll('[data-type]').forEach(function(b){
      b.onclick = function(){
        draftType = b.dataset.type;
        overlay.querySelectorAll('[data-type]').forEach(function(x){ x.classList.toggle('is-active', x===b); });
      };
    });
    overlay.querySelector('#x-save-fulfillment').onclick = function(){
      state.fulfillment.type = draftType;
      var v = overlay.querySelector('input[name="ful-time"]:checked');
      state.fulfillment.scheduled = !!(v && v.value==='schedule');
      if (state.fulfillment.scheduled) state.fulfillment.timeSlot = '12.00 - 12.30';
      else state.fulfillment.timeSlot = '12.00 - 12.30';
      state.fulfillment.typeLabel = draftType==='delivery' ? 'delivery / pick-up / dine-in' : draftType;
      sh.close();
      var y = window.scrollY;
      renderLayout(); calculateTotals(); loadUpsell(); refreshDeliveryQuote();
      window.scrollTo(0, y);
    };
  }

  function openFulfillmentNoteSheet(){
    var sh = makeOverlay(
      '<h3 class="x-alt-sheet-title">Catatan pengantaran</h3>' +
      '<textarea id="x-input-ful-note" class="x-alt-textarea" rows="4" placeholder="Contoh: titipin satpam aja, rumah pagar hitam…">' + UI.escape(state.fulfillment.note) + '</textarea>' +
      '<button type="button" class="x-alt-submit-btn" id="x-save-ful-note" style="margin-top:14px;">Simpan Catatan</button>'
    );
    sh.overlay.querySelector('#x-save-ful-note').onclick = function(){
      state.fulfillment.note = sh.overlay.querySelector('#x-input-ful-note').value.trim();
      sh.close();
      var el = document.querySelector('.x-alt-delivery-note');
      if (el) el.textContent = 'Catatan: ' + state.fulfillment.note;
    };
  }

  function openItemNoteSheet(itemId){
    var item = Store.findCartItem(itemId);
    if (!item) return;
    var sh = makeOverlay(
      '<h3 class="x-alt-sheet-title">Catatan untuk ' + UI.escape(item.name) + '</h3>' +
      '<textarea id="x-input-item-note" class="x-alt-textarea" rows="4" placeholder="Contoh: pedas banget, tanpa bawang…">' + UI.escape(item.note||'') + '</textarea>' +
      '<button type="button" class="x-alt-submit-btn" id="x-save-item-note" style="margin-top:14px;">Simpan</button>'
    );
    sh.overlay.querySelector('#x-save-item-note').onclick = function(){
      var v = sh.overlay.querySelector('#x-input-item-note').value.trim();
      Store.setNote(itemId, v);
      sh.close();
    };
  }

  function openAddressSheet(){
    var sh = makeOverlay(
      '<h3 class="x-alt-sheet-title">Alamat Pengiriman</h3>' +
      '<div style="font-size:13px;color:#6b7280;margin-bottom:10px;">Pilih atau ketik alamat lengkapmu</div>' +
      '<input id="x-input-addr" class="x-alt-input" type="text" value="' + UI.escape(state.address.formatted_address) + '" placeholder="Jl. Dewi 18, Bandar Lampung…">' +
      '<input id="x-input-addr-label" class="x-alt-input" type="text" value="' + UI.escape(state.address.label) + '" placeholder="Label: Rumah Gw / Kantor">' +
      '<textarea id="x-input-addr-detail" class="x-alt-textarea" rows="3" placeholder="Patokan: di samping vihara ada gang…">' + UI.escape(state.address.detail) + '</textarea>' +
      '<button type="button" class="x-alt-submit-btn" id="x-save-addr" style="margin-top:14px;">Simpan Alamat</button>'
    );
    sh.overlay.querySelector('#x-save-addr').onclick = function(){
      var a = sh.overlay.querySelector('#x-input-addr').value.trim();
      var l = sh.overlay.querySelector('#x-input-addr-label').value.trim();
      var d = sh.overlay.querySelector('#x-input-addr-detail').value.trim();
      if (a) state.address.formatted_address = a;
      if (l) state.address.label = l;
      state.address.detail = d;
      try { Store.setLocation({ formatted_address: state.address.formatted_address, latitude: state.address.latitude, longitude: state.address.longitude }); } catch(_){}
      sh.close();
      var y = window.scrollY;
      renderLayout(); calculateTotals(); loadUpsell(); refreshDeliveryQuote();
      window.scrollTo(0,y);
    };
  }

  function submitOrder(){
    if (state.isSubmitting) return;
    var items = getCheckoutItems();
    if (!items.length) { UI.toast('Keranjang kosong'); return; }
    if (!API) { UI.toast('API belum terhubung'); return; }
    state.isSubmitting = true;
    var btn = $('x-btn-submit-order');
    if (btn) { btn.disabled = true; btn.textContent = 'Memproses…'; btn.style.opacity = '0.7'; }

    // Build payload sesuai kontrak backend POST /checkout/create-order
    // Backend: { branch_id, customer:{name,phone}, order_type, fulfillment, schedule_type, delivery, address, items:[{id,quantity,note}], payment_method, order_note }
    var payload = {
      branch_id: state.matchedBranch && state.matchedBranch.id ? state.matchedBranch.id : undefined,
      customer: { name: state.customer.name || 'Pelanggan Bangjo', phone: state.customer.phone || '081234567890' },
      order_type: state.fulfillment.type || 'delivery',
      fulfillment: { type: state.fulfillment.type || 'delivery' },
      schedule_type: state.fulfillment.scheduled ? 'scheduled' : 'asap',
      scheduled_slot_start: state.fulfillment.scheduled ? (state.fulfillment.date + ' ' + state.fulfillment.timeSlot) : null,
      scheduled_slot_end: null,
      delivery: state.fulfillment.type === 'delivery' ? { latitude: state.address.latitude, longitude: state.address.longitude, address: state.address.formatted_address } : undefined,
      address: state.fulfillment.type === 'delivery' ? { latitude: state.address.latitude, longitude: state.address.longitude, formatted_address: state.address.formatted_address, detail: state.address.detail } : undefined,
      items: items.map(function(i){ return { id: i.id, quantity: Number(i.quantity)||1, note: i.note||'' }; }),
      payment_method: state.paymentMethod || 'cash',
      order_note: state.fulfillment.note || '',
      note: state.fulfillment.note || ''
    };

    function onSuccess(orderId, snapToken){
      if (snapToken && state.paymentMethod==='midtrans' && window.snap && window.snap.pay) {
        window.snap.pay(snapToken, {
          onSuccess: function(){ Router.navigate('order-received', { orderId: orderId }); },
          onPending: function(){ Router.navigate('order-received', { orderId: orderId }); },
          onError: function(){ Router.navigate('order-received', { orderId: orderId }); },
          onClose: function(){ Router.navigate('order-received', { orderId: orderId }); }
        });
      } else {
        Router.navigate('order-received', { orderId: orderId });
      }
      if (!currentItemId) Store.clearCart(); else Store.removeItem(currentItemId);
    }

    function onFail(msg){
      state.isSubmitting = false;
      if (btn) { btn.disabled=false; btn.textContent='Pesan sekarang'; btn.style.opacity='1'; }
      UI.toast(msg || 'Gagal membuat pesanan');
      renderLayout(); calculateTotals(); loadUpsell(); refreshDeliveryQuote();
    }

    // Immutable snapshot handled by backend: BranchMatcher + DeliveryCalculator + PaymentService
    API.post('/checkout/create-order', payload).then(function(res){
      state.isSubmitting=false;
      if (res && res.success && res.order_id) {
        onSuccess(res.order_id, res.snap_token || (res.payment && res.payment.snap_token) || null);
      } else if (res && res.success && res.order) {
        var oid = res.order.id || res.order.order_id || res.orderId || res.order_id;
        onSuccess(oid, res.snap_token || res.snapToken || null);
      } else {
        onFail((res && (res.error || res.message)) || 'Terjadi kesalahan');
      }
    }).catch(function(err){
      onFail(err && err.message || 'Koneksi gagal');
    });
  }

  // Keep checkout in sync when cart changes elsewhere; re-quote delivery via backend (subtotal affects promo)
  Store.subscribe(function(){
    if (!checkoutContainer || checkoutContainer.style.display==='none' || state.isSubmitting) return;
    var items = getCheckoutItems();
    if (!items.length) { renderEmpty(); return; }
    var listEl = $('x-checkout-items-list');
    if (listEl) { listEl.innerHTML = renderItemsHtml(items); bindItemEvents(); checkoutContainer.querySelectorAll('[data-note-item]').forEach(function(b){ b.onclick=function(){ openItemNoteSheet(b.dataset.noteItem); }; }); }
    calculateTotals();
    refreshDeliveryQuote();
  });

  window.Xentra = window.Xentra || {};
  window.Xentra.Checkout = { mount: mount };
})();
