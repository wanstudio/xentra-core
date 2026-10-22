/**
 * XENTRA CORE — MERCHANT & OWNER DASHBOARD JAVASCRIPT
 * Real-time SPA for Brand Theme, Product CRUD, Delivery Formula, & Live Orders
 */

(function () {
  'use strict';

  /* =========================================================================
     SHARED INFRASTRUCTURE ALIASES
     When merchant-shared/js/shared.js is loaded first, re-use its globals so
     both files stay in sync. Falls back to inline definitions if absent
     (backwards compatible — no behavioral change in either case).
     ========================================================================= */
  var _shared    = window.XentraShared || {};
  var API_BASE   = _shared.API_BASE   || '/api/v1';
  var TOKEN_KEY  = _shared.TOKEN_KEY  || 'xentra_merchant_token';
  var USER_KEY   = _shared.USER_KEY   || 'xentra_merchant_user';

  // Shared UI widgets are owned by merchant-shared/js/shared.js (loaded first).
  // dashboard.js only aliases them so every merchant surface shares one implementation.
  var XentraActionMenu = window.XentraActionMenu;
  var XentraCropEditor = window.XentraCropEditor;

  // Owner branch-catalog UI is owned by this dashboard surface.
  var XentraOwnerBranchCatalog = window.XentraOwnerBranchCatalog || {};
  var getActiveBranchId = typeof XentraOwnerBranchCatalog.getActiveBranchId === 'function'
    ? XentraOwnerBranchCatalog.getActiveBranchId.bind(XentraOwnerBranchCatalog)
    : function () { return null; };

  // Legacy dashboard Branch Manager menu view remains local to this surface.
  function loadInlineBranchCatalog() {
    var branchId = getActiveBranchId();
    if (!branchId) return;
    if (typeof loadSingleBranchMenuView === 'function') return loadSingleBranchMenuView(branchId);
  }

  // Drag state for the Branch Manager menu category bar (surface-local).
  var _dragSrcCatId = null;
  var _dragSrcEl = null;

  function getAuthHeaders(extraHeaders) {
    var headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    var token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    return headers;
  }

  function clearStoredSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function redirectToLogin() {
    if (typeof checkAppRoute === 'function') {
      checkAppRoute();
    } else if (!window.location.pathname.includes('login')) {
      window.location.href = '/login';
    }
  }

  // Every admin call goes through this wrapper. A 401 means the session is gone
  // on the server (e.g. Passenger restart wiped the in-memory TokenSessionStore),
  // so the stale local token must never keep the dashboard rendering empty UI.
  function adminFetch(url, options) {
    return fetch(url, options).then(function (res) {
      if (res.status === 401) {
        clearStoredSession();
        redirectToLogin();
        var err = new Error('SESSION_EXPIRED');
        err.status = 401;
        throw err;
      }
      return res;
    });
  }

  var state = window.state || {};
  if (!state.categories) state.categories = [];
  if (!state.products) state.products = [];
  if (!state.branches) state.branches = [];
  if (!state.orders) state.orders = [];
  if (!state.activeCategoryFilter) state.activeCategoryFilter = 'all';
  window.state = state;

  function $(id) {
    return document.getElementById(id);
  }

  function bindLiveSearch(inputOrId, onChange, options) {
    if (window.XentraLiveSearch && typeof window.XentraLiveSearch.bind === 'function') {
      var el = typeof inputOrId === 'string' ? $(inputOrId) : inputOrId;
      return window.XentraLiveSearch.bind(el, onChange, options);
    }
    var target = typeof inputOrId === 'string' ? $(inputOrId) : inputOrId;
    if (!target || typeof onChange !== 'function') return function () {};
    var onInput = function () {
      onChange({ query: String(target.value || '').trim().toLowerCase(), raw: target.value || '', empty: !String(target.value || '').trim() });
    };
    target.addEventListener('input', onInput);
    return function () { target.removeEventListener('input', onInput); };
  }
  window.bindLiveSearch = bindLiveSearch;

  function formatMoney(amount) {
    return 'Rp' + Number(amount || 0).toLocaleString('id-ID');
  }

  // HTML-safe string escaping (prevents XSS in rendered product names, etc.)
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  var escapeHtml = esc;

  function requestTextInputSheet(options) {
    options = options || {};
    return new Promise(function(resolve) {
      // Isi sheet memakai pola reusable .x-master-inline-*; tidak ada CSS inline
      // yang ditulis JavaScript.
      var wrap = document.createElement('div');
      wrap.className = 'x-master-inline-sheet-content';
      wrap.innerHTML =
        '<div class="x-master-inline-sheet">' +
          '<div class="x-master-inline-sheet-intro">' +
            '<strong>' + esc(options.title || 'Input') + '</strong>' +
            (options.description ? '<p>' + esc(options.description) + '</p>' : '') +
          '</div>' +
          '<div class="x-master-inline-sheet-fields">' +
            '<div class="x-master-inline-field">' +
              '<label for="x-text-input-sheet-field">' + esc(options.label || 'Nama') + '</label>' +
              '<input id="x-text-input-sheet-field" class="x-input" type="text" value="' + esc(options.value || '') + '" autocomplete="off">' +
              (options.help ? '<small>' + esc(options.help) + '</small>' : '') +
            '</div>' +
          '</div>' +
          '<div class="x-master-inline-sheet-actions">' +
            '<button type="button" class="x-btn-secondary" data-action="cancel">Batal</button>' +
            '<button type="button" class="x-btn-primary" data-action="save">' + esc(options.saveLabel || 'Simpan') + '</button>' +
          '</div>' +
        '</div>';
      var field = wrap.querySelector('#x-text-input-sheet-field');
      var done = false;
      function finish(value) {
        if (done) return;
        done = true;
        if (window.XentraPresentation) window.XentraPresentation.close('text-input-sheet');
        resolve(value);
      }
      wrap.querySelector('[data-action="cancel"]').addEventListener('click', function () { finish(null); });
      wrap.querySelector('[data-action="save"]').addEventListener('click', function () { finish(field.value); });
      if (window.XentraPresentation) {
        window.XentraPresentation.open({
          id: 'text-input-sheet',
          type: 'bottom-sheet',
          title: options.title || 'Input',
          content: wrap,
          dismissible: true,
          onClose: function () { if (!done) { done = true; resolve(null); } }
        });
        setTimeout(function () { if (field) { field.focus(); field.select(); } }, 0);
      } else {
        finish(window.prompt(options.title || 'Input', options.value || ''));
      }
    });
  }
  window.requestTextInputSheet = requestTextInputSheet;

  function openExistingCardInPresentation(modalId, shellId, type) {
    var backdrop = $(modalId);
    if (!backdrop || !window.XentraPresentation) return false;
    var card = backdrop.querySelector('.x-modal-card');
    if (!card) return false;
    window.XentraPresentation.open({
      id: shellId,
      type: type,
      content: card,
      dismissible: true
    });
    return true;
  }
  window.openExistingCardInPresentation = openExistingCardInPresentation;
  window.confirmFeatureAction = confirmFeatureAction;

  async function confirmFeatureAction(id, title, message, okLabel) {
    if (window.XentraPresentation && typeof window.XentraPresentation.confirm === 'function') {
      return await window.XentraPresentation.confirm({
        id: id,
        title: title,
        message: message,
        okLabel: okLabel || 'Lanjutkan',
        cancelLabel: 'Batal'
      });
    }
    return window.confirm(message);
  }

  function showToast(message, type) {
    if (window.XentraShared && typeof window.XentraShared.showToast === 'function') {
      window.XentraShared.showToast(message, type);
      return;
    }
    var container = $('x-toast-container');
    if (!container) return;

    var text = String(message || '').trim();
    var resolvedType = type;
    if (!resolvedType) {
      if (/^[❌🚫⚠️]/.test(text) || text.indexOf('❌') !== -1 || text.indexOf('Gagal') !== -1 || text.indexOf('gagal') !== -1 || text.indexOf('Error') !== -1 || text.indexOf('tidak') !== -1) {
        resolvedType = (text.indexOf('⚠️') !== -1) ? 'warning' : 'error';
      } else if (/^[✅✓]/.test(text) || text.indexOf('✅') !== -1 || text.indexOf('berhasil') !== -1 || text.indexOf('Berhasil') !== -1) {
        resolvedType = 'success';
      }
    }

    var cleanText = text.replace(/^[✅✓❌⚡⚠️\s]+/, '');
    var icon = resolvedType === 'error' ? '❌'
      : (resolvedType === 'success' ? '✅'
      : (resolvedType === 'warning' ? '⚠️' : '⚡'));

    var toast = document.createElement('div');
    toast.className = 'x-toast' + (resolvedType ? ' x-toast-' + resolvedType : '');
    toast.innerHTML = '<span>' + icon + '</span> <span>' + esc(cleanText || text) + '</span>';
    container.appendChild(toast);

    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transform = 'scale(0.92)';
      toast.style.transition = 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 250);
    }, 3000);
  }
  window.showToast = showToast;


  window.toggleStockChecked = function (id, checked) {
    window.toggleStock(id, checked ? 1 : 0);
  };


  /* =========================================================================
     CONTEXT DETECTION — PLATFORM DASHBOARD vs CLIENT OWNER DASHBOARD
     - Platform Dashboard: xentra.cloud/dashboard or ?context=platform
     - Client Owner Dashboard: <client-domain>/dashboard or ?context=client
     ========================================================================= */

  function isPlatformContext() {
    var host = (window.location.hostname || '').toLowerCase();
    var urlParams = new URLSearchParams(window.location.search);
    var contextParam = (urlParams.get('context') || '').toLowerCase();
    if (contextParam === 'platform') return true;
    if (contextParam === 'client') return false;
    return host === 'xentra.cloud';
  }

  /* =========================================================================
     ROUTING — HASH URL ADAPTER
     The URL remains deep-linkable, while owner-navigation.js owns the canonical
     application stack persisted in history.state.
     Pattern: /dashboard#<route>   e.g. #overview, #organizations
     ========================================================================= */

  // Client Owner Dashboard routes
  var CLIENT_ROUTE_META = {
    'overview':           { title: 'Overview',    sub: 'Ringkasan bisnis dan aktivitas terkini', tab: 'overview' },
    'orders':             { title: 'Orders',       sub: 'Antrean pesanan realtime dan status dapur', tab: 'orders' },
    'catalog':            { title: 'Catalog',      sub: 'Kelola taksonomi, produk master, menu komersial, dan menu cabang', tab: 'catalog-master-menus' },
    'catalog/products':   { title: 'Produk Master', sub: 'Kelola Product atomic, SKU, media, dan status inventory', tab: 'catalog-products' },
    'catalog/categories': { title: 'Kategori',     sub: 'Kelola taksonomi Menu pelanggan (Kategori, Sub Kategori, & Rasa)', tab: 'catalog-categories' },
    'catalog/master-menus': { title: 'Menu Master', sub: 'Susun menu komersial brand yang dijual ke pelanggan', tab: 'catalog-master-menus' },
    
    'catalog/menus':      { title: 'Menu Cabang',  sub: 'Atur assortment dan kategori jual per cabang', tab: 'catalog-menus' },
    'branches':           { title: 'Branches',     sub: 'Atur lokasi cabang, radius, dan formula ongkir', tab: 'branches' },
    'customers':          { title: 'Customers',    sub: 'Data pelanggan dan riwayat pembelian', tab: 'customers' },
    'customers/:id':      { title: 'Customer Detail', sub: 'Profil pelanggan, riwayat pesanan, dan loyalitas', tab: 'customers' },
    'reports':            { title: 'Reports',      sub: 'Laporan penjualan dan analitik bisnis', tab: 'reports' },
    'reports/sales':      { title: 'Sales Report', sub: 'Laporan rincian penjualan dan performa channel', tab: 'reports' },
    'reports/orders':     { title: 'Orders Report', sub: 'Laporan analitik volume dan status pesanan', tab: 'reports' },
    'reports/products':   { title: 'Products Report', sub: 'Laporan performa produk dan kontribusi menu', tab: 'reports' },
    'reports/customers':  { title: 'Customers Report', sub: 'Laporan analitik pelanggan dan retensi', tab: 'reports' },
    'reports/branches':   { title: 'Branches Report', sub: 'Laporan perbandingan kinerja antar cabang', tab: 'reports' },
    'reports/operations': { title: 'Operations Report', sub: 'Laporan operasional dan pergerakan stok', tab: 'reports' },
    'reports/affiliate':  { title: 'Affiliate Report',  sub: 'Laporan performa omzet referral, ranking mitra, dan menu terlaris', tab: 'reports' },
    'stock':               { title: 'Stok',         sub: 'Kesehatan persediaan dan perhatian stok seluruh cabang', tab: 'stock' },
    'team':               { title: 'Team',         sub: 'Kelola akun staf, role, dan hak akses', tab: 'tim' },
    'team/members':       { title: 'Team Members', sub: 'Daftar staf dan akun operator', tab: 'tim' },
    'team/invitations':   { title: 'Undangan Tim', sub: 'Kelola status dan kirim undangan anggota tim', tab: 'tim' },
    'team/roles':         { title: 'Team Roles',   sub: 'Struktur role dan hak akses Xentra RBAC', tab: 'tim' },
    'team/permissions':   { title: 'Team Permissions', sub: 'Matriks wewenang dan batasan akses sistem', tab: 'tim' },
    'finance':                     { title: 'Finance',         sub: 'Laporan keuangan terverifikasi dan riwayat pelunasan', tab: 'finance' },
    'finance/overview':            { title: 'Finance Overview', sub: 'Ringkasan penjualan kotor, pelunasan, dan status settlement', tab: 'finance' },
    'finance/transactions':        { title: 'Transactions',    sub: 'Riwayat transaksi pembayaran pesanan (Order Payments)', tab: 'finance' },
    'finance/payouts':             { title: 'Payouts',         sub: 'Pencairan dana settlement gateway ke rekening merchant', tab: 'finance' },
    'finance/reconciliation':      { title: 'Reconciliation',  sub: 'Status rekonsiliasi dan verifikasi gateway pembayaran', tab: 'finance' },
    'finance/payment-methods':     { title: 'Payment Methods', sub: 'Metode pembayaran terverifikasi untuk checkout dan kasir', tab: 'finance' },
    'finance/channels':            { title: 'Rekonsiliasi Ojol', sub: 'Rekonsiliasi omzet dan pencairan GoFood, GrabFood, ShopeeFood', tab: 'finance' },
    'marketing':                   { title: 'Marketing',        sub: 'Program promosi, insentif konversi, dan performa retensi', tab: 'marketing' },
    'marketing/overview':          { title: 'Marketing Overview', sub: 'Metrik retensi pelanggan dan performa promosi aktif', tab: 'marketing' },
    'marketing/promotions':        { title: 'Promotions',       sub: 'Daftar program promosi dan aturan insentif brand', tab: 'marketing' },
    'marketing/discounts':         { title: 'Discounts',        sub: 'Aturan diskon harga dan kupon potongan pesanan', tab: 'marketing' },
    'marketing/banners':          { title: 'Banners',          sub: 'Kelola banner storefront, penempatan, jadwal, dan visibilitas pelanggan', tab: 'marketing' },
    'marketing/campaigns':         { title: 'Campaigns',        sub: 'Kampanye broadcast dan pesan pemasaran multi-channel', tab: 'marketing' },
    'marketing/loyalty':           { title: 'Loyalty',          sub: 'Program poin pelanggan setia dan reward belanja', tab: 'marketing' },
    'settings':                    { title: 'Settings',          sub: 'Konfigurasi brand, cabang, pemenuhan, dan integrasi sistem', tab: 'settings' },
    'settings/business':           { title: 'Business Settings', sub: 'Identitas brand, profil perusahaan, dan legalitas', tab: 'settings' },
    'settings/business/profile':   { title: 'Brand Profile',     sub: 'Identitas visual, nama toko, logo, dan tema brand', tab: 'settings' },
    'settings/business/info':      { title: 'Business Info',     sub: 'Informasi badan usaha, organisasi, dan kontak operasional', tab: 'settings' },
    'settings/business/legal':     { title: 'Legal & Tax',       sub: 'Status konfigurasi pajak restoran (PB1/PPN) dan legalitas', tab: 'settings' },
    'settings/locations':          { title: 'Branch Defaults',   sub: 'Nilai acuan default pengiriman dan formula ongkir cabang', tab: 'settings' },
    'settings/commerce':           { title: 'Commerce Settings', sub: 'Kebijakan pesanan, payment gateway, dan pemenuhan layanan', tab: 'settings' },
    'settings/commerce/orders':    { title: 'Order Settings',    sub: 'Aturan validasi pesanan, batas kedaluwarsa, dan reservasi', tab: 'settings' },
    'settings/commerce/payments':  { title: 'Payment Settings',  sub: 'Kredensial payment gateway Midtrans dan direct payment', tab: 'settings' },
    'settings/commerce/fulfillment': { title: 'Fulfillment',     sub: 'Pengaturan radius delivery, pickup, dan tarif antar cabang', tab: 'settings' },
    'settings/channels':           { title: 'Channels',          sub: 'Status kanal penjualan: Website, PWA, POS, dan Kiosk', tab: 'settings' },
    'settings/channels/website':   { title: 'Channel Website',   sub: 'Status toko online web ordering resmi merchant', tab: 'settings' },
    'settings/channels/customer-app': { title: 'Customer App',   sub: 'Status Progressive Web App (PWA) aplikasi pelanggan', tab: 'settings' },
    'settings/channels/pos':       { title: 'Channel POS',       sub: 'Status kasir Point of Sale native dan shift aktif', tab: 'settings' },
    'settings/channels/kiosk':     { title: 'Channel Kiosk',     sub: 'Status terminal pemesanan mandiri self-service kiosk', tab: 'settings' },
    'settings/channels/delivery':  { title: 'Integrasi Saluran Ojol', sub: 'Konfigurasi komisi dan listener GoFood, GrabFood, ShopeeFood', tab: 'settings' },
    'settings/integrations':       { title: 'Integrations',      sub: 'Modul integrasi payment gateway, POS, dan Xentra ecosystem', tab: 'settings' },
    'settings/notifications':      { title: 'Notifications',     sub: 'Preferensi notifikasi multi-channel WhatsApp, Email & Push', tab: 'settings' },
    'settings/security':           { title: 'Security & RBAC',   sub: 'Model otorisasi, sesi pengguna, dan jejak audit keamanan', tab: 'settings' },
    'settings/data-refresh':       { title: 'Data Aplikasi',     sub: 'Segarkan cache dan sinkronisasi data aplikasi dari server', tab: 'settings' },
    // Owner mobile modules & hubs
    'business':                    { title: 'Bisnis',            sub: 'Pusat pengelolaan katalog, operasional, pelanggan, pemasaran, tim, dan brand', tab: 'business' },
    'business/catalog':            { title: 'Katalog & Menu',    sub: 'Master menu, kategori, item penyusun, dan pilihan item', tab: 'business' },
    'business/materials-production': { title: 'Bahan & Produksi', sub: 'Standar baku, resep, hasil produksi, dan hubungan bahan dengan hasil produksi', tab: 'business' },
    'business/materials':          { title: 'Bahan Baku',        sub: 'Identitas bahan mentah untuk resep dapur dan pengadaan belanja', tab: 'materials' },
    'materials':                   { title: 'Bahan Baku',        sub: 'Identitas bahan mentah untuk resep dapur dan pengadaan belanja', tab: 'materials' },
    'business/recipes':            { title: 'Resep Produksi',    sub: 'Kelola resep acuan perhitungan HPP dan pemotongan stok bahan', tab: 'recipes' },
    'recipes':                     { title: 'Resep Produksi',    sub: 'Kelola resep acuan perhitungan HPP dan pemotongan stok bahan', tab: 'recipes' },
    'more':                        { title: 'Lainnya',           sub: 'Pengaturan sistem, integrasi, keamanan, notifikasi, dan akun', tab: 'more' },
    'lainnya':                     { title: 'Lainnya',           sub: 'Pengaturan sistem, integrasi, keamanan, notifikasi, dan akun', tab: 'more' },
    // Legacy routes (internal tabs that still exist from old dashboard)
    'brand':              { title: 'Brand & Tampilan', sub: 'Kustomisasi logo, warna tema, dan identitas visual', tab: 'brand' },
    'payments':           { title: 'Integrasi Pembayaran', sub: 'Kredensial direct payment Midtrans & Tunai', tab: 'payments' }
  };

  // Platform Dashboard routes (xentra.cloud)
  var PLATFORM_ROUTE_META = {
    'overview':           { title: 'Platform Overview',      sub: 'Global ecosystem overview & platform telemetry',        tab: 'platform-overview' },
    'organizations':      { title: 'Organizations',          sub: 'Enterprise organizations & business group structures',  tab: 'platform-organizations' },
    'brands':             { title: 'Brands',                 sub: 'Registered merchant brands & multi-tenant fleet',        tab: 'platform-brands' },
    'domains':            { title: 'Domains',                sub: 'Custom domains mapping, SSL/TLS & ingress routing',      tab: 'platform-domains' },
    'provisioning':       { title: 'Provisioning',           sub: 'Automated tenant orchestration & cluster provisioning', tab: 'platform-provisioning' },
    'users-access':       { title: 'Users & Access',         sub: 'Platform operator RBAC & centralized IAM credentials',  tab: 'platform-users' },
    'billing':            { title: 'Subscriptions / Billing', sub: 'SaaS recurring subscriptions, invoices & billing plans', tab: 'platform-billing' },
    'audit-logs':         { title: 'Audit Logs',             sub: 'Platform security audit trail & operator access logs',  tab: 'platform-audit-logs' },
    'integrations':       { title: 'Integrations',           sub: 'Global ecosystem webhooks & upstream cloud services',   tab: 'platform-integrations' },
    'settings':           { title: 'Platform Settings',      sub: 'Global core engine configuration & system parameters',  tab: 'platform-settings' }
  };

  // Active route metadata dictionary according to context
  function getActiveRouteMeta() {
    if (isPlatformContext()) return PLATFORM_ROUTE_META;
    return CLIENT_ROUTE_META;
  }

  var OWNER_LAST_ROUTE_KEY = 'xentra_owner_last_route';

  function getSavedOwnerRoute() {
    try {
      return (sessionStorage.getItem(OWNER_LAST_ROUTE_KEY) || '').replace(/^#\/?/, '').trim();
    } catch (_) {
      return '';
    }
  }

  function saveOwnerRoute(route) {
    if (!route) return;
    try {
      sessionStorage.setItem(OWNER_LAST_ROUTE_KEY, String(route).replace(/^#\/?/, '').trim());
    } catch (_) {}
  }

  // Parse the active route from the current URL hash
  function getCurrentRoute() {
    var hash = window.location.hash.replace(/^#\/?/, '').trim();
    var meta = getActiveRouteMeta();

    if (!hash) {
      var savedRoute = getSavedOwnerRoute();
      if (savedRoute) {
        hash = savedRoute;
      } else {
        return 'overview';
      }
    }

    if (!isPlatformContext()) {
      if (hash === 'catalog') return 'catalog/master-menus';
      if (hash === 'catalog/categories' || hash.indexOf('catalog/categories/') === 0) return hash;
      // Handle dynamic route: catalog/products/:id
      if (hash.indexOf('catalog/products/') === 0) {
        return hash;
      }
      // Handle dynamic route: catalog/master-menus/:id/edit
      if (hash.indexOf('catalog/master-menus/') === 0) {
        return hash;
      }
      if (hash === 'business/catalog' || hash === 'business/materials-production' || hash === 'business/materials' || hash === 'business/recipes' || hash === 'materials' || hash === 'recipes') {
        return hash;
      }
      // Handle dynamic route: branches/:id and branches/:id/:subtab
      if (hash.indexOf('branches/') === 0) {
        return hash;
      }
      // Handle dynamic route: orders/:id
      if (hash.indexOf('orders/') === 0) {
        return hash;
      }
      // Handle dynamic route: reports/:type
      if (hash.indexOf('reports/') === 0) {
        return hash;
      }
      // Handle dynamic route: customers/:id
      if (hash.indexOf('customers/') === 0) {
        return hash;
      }
      // Handle dynamic route: team/:subtab
      if (hash.indexOf('team/') === 0) {
        return hash;
      }
      // Handle dynamic route: finance/:subtab
      if (hash.indexOf('finance/') === 0) {
        return hash;
      }
      // Handle dynamic route: marketing/:subtab
      if (hash.indexOf('marketing/') === 0) {
        return hash;
      }
      // Handle dynamic route: settings/:subtab
      if (hash.indexOf('settings/') === 0) {
        return hash;
      }
    }

    // Validate the route exists, default to 'overview'
    var defaultRoute = 'overview';
    return meta[hash.toLowerCase()] ? hash.toLowerCase() : defaultRoute;
  }

  function closeMobileSidebar() {
    var sidebar = $('x-dash-sidebar');
    var overlay = $('x-sidebar-overlay');
    var btnOpen = $('btn-hamburger');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    if (btnOpen) btnOpen.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }
  window.closeMobileSidebar = closeMobileSidebar;

  function openMobileSidebar() {
    var sidebar = $('x-dash-sidebar');
    var overlay = $('x-sidebar-overlay');
    var btnOpen = $('btn-hamburger');
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('open');
    if (btnOpen) btnOpen.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }
  window.openMobileSidebar = openMobileSidebar;

  // ---------------------------------------------------------------------------
  // Owner navigation configuration
  //
  // The actual stack/history engine lives in owner-navigation.js. This surface
  // only describes its route tree and provides the renderer.
  // ---------------------------------------------------------------------------
  var OWNER_ROUTE_ALIASES = {
    'overview': 'overview',
    'orders': 'orders',
    'catalog': 'catalog/master-menus',
    'catalog-products': 'catalog/products',
    'catalog-menus': 'catalog/menus',
    'catalog-categories': 'catalog/categories',
    'catalog/categories': 'catalog/categories',
    'catalog-master-menus': 'catalog/master-menus',
    'catalog/master-menus': 'catalog/master-menus',
    'business/catalog': 'business/catalog',
    'business/materials-production': 'business/materials-production',
    'branches': 'branches',
    'tim': 'team',
    'team': 'team',
    'customers': 'customers',
    'reports': 'reports',
    'finance': 'finance/overview',
    'marketing': 'marketing/promotions',
    'settings': 'settings',
    'brand': 'brand',
    'payments': 'payments',
    'business': 'business',
    'business/materials': 'business/materials',
    'materials': 'business/materials',
    'business/recipes': 'business/recipes',
    'recipes': 'business/recipes',
    'more': 'more',
    'lainnya': 'more'
  };

  var OWNER_ROOT_ROUTES = {
    overview: true,
    business: true,
    orders: true,
    'finance/overview': true,
    more: true
  };

  function canonicalizeOwnerRoute(route) {
    var value = String(route || '');
    if (isPlatformContext()) return value;
    return OWNER_ROUTE_ALIASES[value] || value;
  }

  function isOwnerRootRoute(route) {
    if (isPlatformContext()) return true;
    return !!OWNER_ROOT_ROUTES[route];
  }

  function ownerParentRoute(route) {
    if (isPlatformContext()) return null;

    var current = canonicalizeOwnerRoute(route || '');

    if (current === 'business/catalog' || current === 'business/materials-production') {
      return 'business';
    }

    if (current === 'business/materials' || current === 'materials' ||
        current === 'business/recipes' || current === 'recipes') {
      return 'business/materials-production';
    }

    if (current === 'catalog/products/new' ||
        /^catalog\/products\/[^/]+\/edit$/.test(current) ||
        /^catalog\/products\/[^/]+$/.test(current)) {
      return 'catalog/products';
    }

    if (current === 'catalog/master-menus/new' ||
        /^catalog\/master-menus\/[^/]+\/edit$/.test(current)) {
      return 'catalog/master-menus';
    }

    if (/^catalog\/categories\/[^/]+\/(?:edit|sort-menus|sort)$/.test(current)) {
      return 'catalog/categories/' + current.split('catalog/categories/')[1].replace(/\/(?:edit|sort-menus|sort)$/, '');
    }

    if (current === 'catalog/categories/new' ||
        current === 'catalog/categories/sort' ||
        current === 'catalog/categories/reorder' ||
        /^catalog\/categories\/[^/]+$/.test(current)) {
      return 'catalog/categories';
    }

    if (current === 'catalog/products' ||
        current === 'catalog/categories' ||
        current === 'catalog/master-menus' ||
        current === 'catalog/menus') {
      return 'business/catalog';
    }

    if (current === 'branches') return 'business';
    if (current === 'branches/new' ||
        /^branches\/[^/]+\/edit$/.test(current) ||
        /^branches\/[^/]+(?:\/[^/]+)?$/.test(current)) {
      return 'branches';
    }

    if (current === 'orders') return null;
    if (current.indexOf('orders/') === 0) return 'orders';

    if (current === 'customers') return 'business';
    if (current.indexOf('customers/') === 0) return 'customers';

    if (current === 'stock') return 'overview';

    if (current === 'team') return 'business';
    if (current.indexOf('team/') === 0) return 'team';

    if (current === 'reports') return 'business';
    if (current.indexOf('reports/') === 0) return 'reports';

    if (current === 'finance/overview') return null;
    if (current === 'finance') return 'business';
    if (current.indexOf('finance/') === 0) return 'finance/overview';

    if (current === 'marketing/promotions/new' || /^marketing\/promotions\/[^/]+\/edit$/.test(current)) {
      return 'marketing/promotions';
    }
    if (current === 'marketing/banners/new' || /^marketing\/banners\/[^/]+\/edit$/.test(current)) {
      return 'marketing/banners';
    }
    if (current === 'marketing' || current.indexOf('marketing/') === 0) {
      return 'business';
    }

    if (current === 'settings/business/profile') return 'business';
    if (current === 'settings') return 'more';
    if (current.indexOf('settings/') === 0) return 'settings';

    if (current === 'brand') return 'business';
    if (current === 'payments') return 'more';

    return null;
  }

  function configureOwnerNavigationEngine() {
    if (!window.XentraNavigationController) {
      throw new Error('XentraNavigationController is not loaded');
    }

    window.XentraNavigationController.configure({
      canonicalize: canonicalizeOwnerRoute,
      isRootRoute: isOwnerRootRoute,
      parentRoute: ownerParentRoute,
      defaultRoute: isPlatformContext() ? 'overview' : 'overview',
      getRoute: getCurrentRoute,
      renderRoute: applyRoute
    });
  }

  function ensureOwnerNavigationHistory() {
    configureOwnerNavigationEngine();
    window.XentraNavigationController.initialize();
  }

  function navigateTo(route, options) {
    if (!route) return;
    closeMobileSidebar();
    configureOwnerNavigationEngine();
    window.XentraNavigationController.navigate(route, options);
  }
  window.navigateTo = navigateTo;

  // Canonical Back for every Owner child Page. Individual pages only call this
  // adapter; stack semantics stay entirely inside the navigation engine.
  window.goBackFromChildPage = function () {
    configureOwnerNavigationEngine();
    window.XentraNavigationController.back();
  };

  // Compatibility aliases for existing markup/callers.
  window.goBackFromMasterProducts = window.goBackFromChildPage;
  window.goBackFromCategory = window.goBackFromChildPage;
  window.goBackFromCatalogChild = window.goBackFromChildPage;

  // Editor item dibuka dari konteks Master Category atau Produk Master
  window.setMasterReferenceTab = setMasterReferenceTab;
  window.goBackFromItemEditor = function () {
    if (window.XentraNavigationController) {
      var snapshot = window.XentraNavigationController.getSnapshot && window.XentraNavigationController.getSnapshot();
      var stack = snapshot ? snapshot.stack : [];
      if (stack.length > 1) {
        window.XentraNavigationController.back();
        return;
      }
    }
    setMasterReferenceTab('item');
    navigateTo('catalog/categories', { history: 'replace' });
  };

  function ensureOwnerFeatureMobileHeader(page, title, subtitle, backLabel) {
    if (!page) return null;

    var header = page.querySelector('[data-owner-feature-mobile-header]');
    if (!header) {
      header = document.createElement('div');
      header.className = 'x-owner-child-mobile-header';
      header.setAttribute('data-owner-feature-mobile-header', 'true');
      header.innerHTML =
        '<h3 class="x-owner-mobile-page-title">' +
          '<button type="button" class="x-title-back-btn x-owner-mobile-page-back" data-owner-feature-mobile-back aria-label="Kembali">' +
            '<svg class="x-owner-page-back-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>' +
          '</button>' +
          '<span data-owner-feature-mobile-title></span>' +
        '</h3>' +
        '<p class="x-owner-mobile-page-sub" data-owner-feature-mobile-subtitle></p>';

      page.insertBefore(header, page.firstChild);

      var back = header.querySelector('[data-owner-feature-mobile-back]');
      if (back) {
        back.addEventListener('click', function () { goBackFromChildPage(); });
      }
    }

    var titleEl = header.querySelector('[data-owner-feature-mobile-title]');
    var subtitleEl = header.querySelector('[data-owner-feature-mobile-subtitle]');
    var backEl = header.querySelector('[data-owner-feature-mobile-back]');
    if (titleEl) titleEl.textContent = title || '';
    if (subtitleEl) subtitleEl.textContent = subtitle || '';
    if (backEl) backEl.setAttribute('aria-label', backLabel || 'Kembali');

    return header;
  }
  window.ensureOwnerFeatureMobileHeader = ensureOwnerFeatureMobileHeader;

  // Editor item dibuka dari konteks Master Category atau Produk Master
  window.setMasterReferenceTab = setMasterReferenceTab;
  window.goBackFromItemEditor = function () {
    if (window.XentraNavigationController) {
      var snapshot = window.XentraNavigationController.getSnapshot && window.XentraNavigationController.getSnapshot();
      var stack = snapshot ? snapshot.stack : [];
      if (stack.length > 1) {
        window.XentraNavigationController.back();
        return;
      }
    }
    setMasterReferenceTab('item');
    navigateTo('catalog/categories', { history: 'replace' });
  };
  window.goBackFromCategoryEditor = function () {
    setMasterReferenceTab('category');
    if (window.XentraNavigationController) {
      var snapshot = window.XentraNavigationController.getSnapshot && window.XentraNavigationController.getSnapshot();
      var stack = snapshot ? snapshot.stack : [];
      if (stack.length > 1) {
        window.XentraNavigationController.back();
        return;
      }
    }
    navigateTo('catalog/categories', { history: 'replace' });
  };

  function openBusinessSubHub(type) {
    if (type === 'catalog') {
      navigateTo('business/catalog');
    } else if (type === 'materials-production') {
      navigateTo('business/materials-production');
    } else {
      var mainView = $('owner-business-main-view');
      var catHub = $('subpage-catalog-menu-hub');
      var matHub = $('subpage-materials-production-hub');

      if (mainView) mainView.style.display = 'none';
      if (catHub) catHub.style.display = (type === 'catalog') ? 'block' : 'none';
      if (matHub) matHub.style.display = (type === 'materials-production') ? 'block' : 'none';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
  window.openBusinessSubHub = openBusinessSubHub;

  function closeBusinessSubHub() {
    if (window.XentraNavigationController) {
      var snapshot = window.XentraNavigationController.getSnapshot && window.XentraNavigationController.getSnapshot();
      var stack = snapshot ? snapshot.stack : [];
      if (stack.length > 1 && snapshot.route && snapshot.route.indexOf('business/') === 0) {
        window.XentraNavigationController.back();
        return;
      }
    }
    var mainView = $('owner-business-main-view');
    var catHub = $('subpage-catalog-menu-hub');
    var matHub = $('subpage-materials-production-hub');

    if (mainView) mainView.style.display = 'block';
    if (catHub) catHub.style.display = 'none';
    if (matHub) matHub.style.display = 'none';

    var modernMount = $('modern-business-hub-mount');
    var legacyContent = $('legacy-business-main-content');
    if (modernMount && typeof window.mountBusinessHub === 'function') {
      modernMount.style.display = 'block';
      if (legacyContent) legacyContent.style.display = 'none';
      window.mountBusinessHub(modernMount, {
        onNavigate: function(targetRoute, id) {
          if (id === 'catalog') {
            openBusinessSubHub('catalog');
          } else if (id === 'materials-production') {
            openBusinessSubHub('materials-production');
          } else {
            navigateTo(targetRoute.replace(/^#/, ''));
          }
        }
      });
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.closeBusinessSubHub = closeBusinessSubHub;

  window.openBahanBakuPage = function () {
    navigateTo('business/materials');
  };

  window.openResepProduksiPage = function () {
    navigateTo('business/recipes');
  };

  function onBusinessHubSearch(query) {
    var q = String(query || '').trim().toLowerCase();
    var cards = document.querySelectorAll('#owner-business-cards-container .x-hub-card');
    cards.forEach(function (card) {
      if (!q) {
        card.style.display = 'flex';
        return;
      }
      var text = (card.getAttribute('data-hub-item') || '') + ' ' + (card.innerText || '');
      if (text.toLowerCase().indexOf(q) !== -1) {
        card.style.display = 'flex';
      } else {
        card.style.display = 'none';
      }
    });
  }
  window.onBusinessHubSearch = onBusinessHubSearch;

  // Render Platform Navigation in Sidebar
  function renderPlatformNavigation() {
    var nav = $('x-dash-nav');
    if (!nav) return;

    nav.innerHTML = 
      '<button type="button" class="x-nav-item" data-route="overview">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>' +
        '<span>Overview</span>' +
      '</button>' +

      '<div style="height: 10px;"></div>' +

      '<button type="button" class="x-nav-item" data-route="organizations">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18"></path><path d="M5 21V7l8-4v18"></path><path d="M19 21V11l-6-3"></path><path d="M9 9h1"></path><path d="M9 13h1"></path><path d="M9 17h1"></path></svg>' +
        '<span>Organizations</span>' +
      '</button>' +
      '<button type="button" class="x-nav-item" data-route="brands">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>' +
        '<span>Brands</span>' +
      '</button>' +
      '<button type="button" class="x-nav-item" data-route="domains">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>' +
        '<span>Domains</span>' +
      '</button>' +
      '<button type="button" class="x-nav-item" data-route="provisioning">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path></svg>' +
        '<span>Provisioning</span>' +
      '</button>' +

      '<div style="height: 10px;"></div>' +

      '<button type="button" class="x-nav-item" data-route="users-access">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>' +
        '<span>Users & Access</span>' +
      '</button>' +

      '<div style="height: 10px;"></div>' +

      '<button type="button" class="x-nav-item" data-route="billing">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>' +
        '<span>Subscriptions / Billing</span>' +
      '</button>' +

      '<div class="x-nav-group-label" style="margin-top: 6px;">SYSTEM</div>' +

      '<button type="button" class="x-nav-item" data-route="audit-logs">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>' +
        '<span>Audit Logs</span>' +
      '</button>' +
      '<button type="button" class="x-nav-item" data-route="integrations">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>' +
        '<span>Integrations</span>' +
      '</button>' +

      '<div style="height: 10px;"></div>' +

      '<button type="button" class="x-nav-item" data-route="settings">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>' +
        '<span>Settings</span>' +
      '</button>';

    // Wire clicks on newly rendered nav items
    nav.querySelectorAll('.x-nav-item[data-route]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        navigateTo(btn.dataset.route);
      });
    });
  }

  var _lastRenderedOwnerRoute = null;
  var _lastRenderedStackDepth = 1;

  function getOwnerRouteDepth(r) {
    if (!r || isOwnerRootRoute(r)) return 1;
    if (r === 'business/catalog' || r === 'business/materials-production') return 2;
    if (r === 'catalog/categories' || r === 'catalog/products' || r === 'catalog/master-menus' || r === 'catalog/menus') return 3;
    if (/^catalog\/categories\/[^/]+$/.test(r) && r !== 'catalog/categories/new' && r !== 'catalog/categories/sort' && r !== 'catalog/categories/reorder') return 4;
    if (/^catalog\/categories\/[^/]+\/(?:edit|sort-menus|sort)$/.test(r) || r === 'catalog/categories/new' || r === 'catalog/categories/sort' || r === 'catalog/categories/reorder' || r === 'catalog/master-menus/new' || /^catalog\/master-menus\/[^/]+\/edit$/.test(r) || r === 'catalog/products/new' || /^catalog\/products\/[^/]+\/edit$/.test(r)) return 5;
    var parent = ownerParentRoute(r);
    return parent ? 2 + (r.split('/').length - 1) : 1;
  }

  function triggerOwnerPageSlideTransition(nextRoute) {
    if (typeof document === 'undefined' || !document.body) return;
    var nextDepth = getOwnerRouteDepth(nextRoute);
    var dir = 'push';
    if (_lastRenderedOwnerRoute === null) {
      dir = 'tab';
    } else if (isOwnerRootRoute(nextRoute) && isOwnerRootRoute(_lastRenderedOwnerRoute)) {
      dir = 'tab';
    } else if (nextDepth < _lastRenderedStackDepth) {
      dir = 'pop';
    } else {
      dir = 'push';
    }
    _lastRenderedOwnerRoute = nextRoute;
    _lastRenderedStackDepth = nextDepth;
    document.body.setAttribute('data-nav-dir', dir);

    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(function () {
        var targets = document.querySelectorAll(
          '#modern-business-hub-root, #modern-catalog-subhub-root, #modern-categories-page-root, #modern-category-detail-page-root, #modern-category-editor-page-root, #modern-category-sort-page-root, #modern-category-menu-sort-page-root, #modern-item-master-page-root, #modern-menu-editor-root, .x-tab-content.active > .x-owner-child-page-shell, .x-tab-content.active > #x-owner-command-center'
        );
        var animClass = dir === 'pop' ? 'x-owner-page-anim-pop' : (dir === 'tab' ? 'x-owner-page-anim-tab' : 'x-owner-page-anim-push');
        targets.forEach(function (el) {
          el.classList.remove('x-owner-page-anim-push', 'x-owner-page-anim-pop', 'x-owner-page-anim-tab');
          void el.offsetWidth;
          el.classList.add(animClass);
        });
      });
    }
  }

  // Apply the route: update nav active state, show correct section, load data
  function applyRoute(route) {
    var isPlatform = isPlatformContext();
    var metaDict = getActiveRouteMeta();

    if (!isPlatform && route === 'catalog') {
      navigateTo('catalog/master-menus');
      return;
    }

    if (!isPlatform && route === 'marketing') {
      navigateTo('marketing/promotions');
      return;
    }

    if (isBranchManager() && (route === 'marketing' || route.indexOf('marketing/') === 0)) {
      navigateTo('promo');
      return;
    }

    saveOwnerRoute(route);
    triggerOwnerPageSlideTransition(route);

    var isCategoryEditor = !isPlatform && (
      route === 'catalog/categories/new' ||
      /^catalog\/categories\/[^/]+\/edit$/.test(route)
    );
    var isCategorySort = !isPlatform && (
      route === 'catalog/categories/sort' ||
      route === 'catalog/categories/reorder' ||
      /^catalog\/categories\/[^/]+\/(?:sort-menus|sort)$/.test(route)
    );
    var isCategoryDetail = !isPlatform &&
      /^catalog\/categories\/[^/]+$/.test(route) &&
      !isCategoryEditor &&
      !isCategorySort;
    var categoryEditorId = isCategoryEditor && route !== 'catalog/categories/new'
      ? route.split('catalog/categories/')[1].split('/edit')[0]
      : null;

    var isProductEditor = !isPlatform && (
      route === 'catalog/products/new' ||
      /^catalog\/products\/[^/]+\/edit$/.test(route)
    );
    var productEditorId = isProductEditor && route !== 'catalog/products/new'
      ? route.split('catalog/products/')[1].split('/edit')[0]
      : null;
    
    var isMasterMenuEditor = !isPlatform && (
      route === 'catalog/master-menus/new' ||
      /^catalog\/master-menus\/[^/]+\/edit$/.test(route)
    );
    var masterMenuEditorId = isMasterMenuEditor && route !== 'catalog/master-menus/new'
      ? route.split('catalog/master-menus/')[1].split('/edit')[0]
      : null;
    var isProductDetail = !isPlatform &&
      route.indexOf('catalog/products/') === 0 &&
      !isProductEditor;
    var productDetailId = isProductDetail ? route.split('catalog/products/')[1] : null;

    var isBranchEditor = !isPlatform && (route === 'branches/new' || /^branches\/[^/]+\/edit$/.test(route));
    var branchEditorId = isBranchEditor && route !== 'branches/new' ? route.split('branches/')[1].split('/edit')[0] : null;
    var isBranchDetail = !isPlatform && route.indexOf('branches/') === 0 && !isBranchEditor;
    var branchDetailParts = isBranchDetail ? route.split('/') : [];
    var branchDetailId = isBranchDetail ? branchDetailParts[1] : null;
    var branchDetailSubtab = isBranchDetail ? (branchDetailParts[2] || 'overview') : 'overview';

    var isOrderDetail = !isPlatform && route.indexOf('orders/') === 0;
    var orderDetailId = isOrderDetail ? route.split('orders/')[1] : null;

    var isCustomerDetail = !isPlatform && route.indexOf('customers/') === 0;
    var customerDetailId = isCustomerDetail ? route.split('customers/')[1] : null;

    var isTeamRoute = !isPlatform && (route === 'team' || route.indexOf('team/') === 0);
    var teamSubtab = isTeamRoute ? (route.indexOf('team/') === 0 ? route.split('team/')[1] : 'members') : 'members';

    var isReportsRoute = !isPlatform && (route === 'reports' || route.indexOf('reports/') === 0);
    var reportSubtype = isReportsRoute ? (route.indexOf('reports/') === 0 ? route.split('reports/')[1] : 'overview') : 'overview';

    var isFinanceRoute = !isPlatform && (route === 'finance' || route.indexOf('finance/') === 0);
    var financeSubtab = isFinanceRoute ? (route.indexOf('finance/') === 0 ? route.split('finance/')[1] : 'overview') : 'overview';

    var isMarketingEditor = !isPlatform && (route === 'marketing/promotions/new' || /^marketing\/promotions\/[^/]+\/edit$/.test(route) || route === 'marketing/banners/new' || /^marketing\/banners\/[^/]+\/edit$/.test(route));
    var marketingEditorType = route.indexOf('marketing/promotions/') === 0 ? 'promotion' : (route.indexOf('marketing/banners/') === 0 ? 'banner' : null);
    var marketingEditorId = isMarketingEditor && route.indexOf('/edit') !== -1 ? route.split('/')[2] : null;
    var isMarketingRoute = !isPlatform && (route === 'marketing' || route.indexOf('marketing/') === 0);
    var marketingSubtab = isMarketingRoute ? (route.indexOf('marketing/') === 0 ? route.split('marketing/')[1] : 'promotions') : 'promotions';
    if (isMarketingEditor) marketingSubtab = marketingEditorType === 'banner' ? 'banners' : 'promotions';

    var isSettingsRoute = !isPlatform && (route === 'settings' || route.indexOf('settings/') === 0);
    var settingsSubtab = isSettingsRoute ? (route.indexOf('settings/') === 0 ? route.split('settings/')[1] : 'business/profile') : 'business/profile';

    var metaKey = (isCategoryEditor || isCategorySort || isCategoryDetail)
      ? 'catalog/categories'
      : ((isMasterMenuEditor || route === 'catalog/master-menus')
        ? 'catalog/master-menus'
        : ((isProductDetail || isProductEditor) ? 'catalog/products' : (isBranchEditor ? 'branches' : (isBranchDetail ? 'branches' : (isOrderDetail ? 'orders' : (isCustomerDetail ? 'customers/:id' : (isTeamRoute ? ('team/' + teamSubtab) : (isReportsRoute ? 'reports' : (isFinanceRoute ? ('finance/' + financeSubtab) : (isMarketingRoute ? ('marketing/' + marketingSubtab) : (isSettingsRoute ? ('settings/' + settingsSubtab) : route)))))))))));
    if (isMarketingEditor) metaKey = 'marketing/' + marketingSubtab;
    var meta = metaDict[metaKey] || metaDict[route] || metaDict['overview'];
    var tabId = meta.tab;
    var isCatalogChild = !isPlatform && route.indexOf('catalog/') === 0;

    // 1. Update all top-level nav items active state
    document.querySelectorAll('.x-nav-item[data-route]').forEach(function (btn) {
      var btnRoute = btn.dataset.route;
      var isActive;
      if (btnRoute === 'catalog') {
        // Catalog parent is active if we're on 'catalog' or any catalog sub-route
        isActive = route === 'catalog' || isCatalogChild;
      } else if (btnRoute === 'branches') {
        isActive = route === 'branches' || isBranchDetail || isBranchEditor;
      } else if (btnRoute === 'orders') {
        isActive = route === 'orders' || isOrderDetail;
      } else if (btnRoute === 'customers') {
        isActive = route === 'customers' || isCustomerDetail;
      } else if (btnRoute === 'team') {
        isActive = isTeamRoute;
      } else if (btnRoute === 'reports') {
        isActive = isReportsRoute;
      } else if (btnRoute === 'finance') {
        isActive = isFinanceRoute;
      } else if (btnRoute === 'marketing') {
        isActive = isMarketingRoute;
      } else if (btnRoute === 'settings') {
        isActive = isSettingsRoute;
      } else {
        isActive = btnRoute === route;
      }
      btn.classList.toggle('active', isActive);
    });

    // 2. Update catalog sub-nav items (client context only)
    if (!isPlatform) {
      document.querySelectorAll('.x-nav-sub-item[data-route]').forEach(function (btn) {
        var targetRoute = btn.dataset.route;
        var isActiveSub = targetRoute === route || (isProductDetail && targetRoute === 'catalog/products') || (isMasterMenuEditor && targetRoute === 'catalog/master-menus') || ((isCategoryEditor || isCategoryDetail || isCategorySort) && targetRoute === 'catalog/categories');
        btn.classList.toggle('active', isActiveSub);
      });

      // 3. Toggle catalog sub-nav open/closed
      var catalogSub = $('nav-catalog-sub');
      var catalogParent = $('nav-catalog-parent');
      var catalogOpen = route === 'catalog' || isCatalogChild;
      if (catalogSub) catalogSub.classList.toggle('open', catalogOpen);
      if (catalogParent) {
        catalogParent.setAttribute('aria-expanded', catalogOpen ? 'true' : 'false');
      }
    }

    // 4. Show correct content section
    document.querySelectorAll('.x-tab-content').forEach(function (section) {
      section.classList.toggle('active', section.id === 'tab-' + tabId);
    });
    var mktHeader = $('marketing-main-header');
    var mktSubnav = $('marketing-subnav-tabs');

    if (isMarketingEditor) {
      if (mktHeader) mktHeader.style.display = 'none';
      if (mktSubnav) mktSubnav.style.display = 'none';
      document.querySelectorAll('.x-marketing-subview').forEach(function (view) { view.style.display = 'none'; });
      var promoPage = $('marketing-promotion-editor-view');
      var bannerPage = $('marketing-banner-editor-view');
      if (promoPage) promoPage.style.display = marketingEditorType === 'promotion' ? 'block' : 'none';
      if (bannerPage) bannerPage.style.display = marketingEditorType === 'banner' ? 'block' : 'none';
    } else {
      if (mktHeader) mktHeader.style.display = '';
      if (mktSubnav) mktSubnav.style.display = '';
      var promoPage2 = $('marketing-promotion-editor-view');
      var bannerPage2 = $('marketing-banner-editor-view');
      if (promoPage2) promoPage2.style.display = 'none';
      if (bannerPage2) bannerPage2.style.display = 'none';
      if (typeof unmountMarketingEditors === 'function') unmountMarketingEditors();
    }

    // 5. Update topbar title
    var titleEl = $('dash-page-title');
    var subEl = $('dash-page-subtitle');
    if (titleEl) titleEl.textContent = isMarketingEditor
      ? (marketingEditorType === 'banner' ? (marketingEditorId ? 'Edit Banner' : 'Tambah Banner') : (marketingEditorId ? 'Edit Promosi' : 'Buat Promosi Baru'))
      : (isMasterMenuEditor
        ? (masterMenuEditorId ? 'Edit Menu Master' : 'Tambah Menu Master')
        : (isCategoryEditor
          ? (categoryEditorId ? 'Edit Kategori' : 'Tambah Kategori')
          : (isProductEditor
            ? (productEditorId ? 'Edit Item' : 'Tambah Item')
            : (isBranchEditor ? (branchEditorId ? 'Edit Cabang' : 'Tambah Cabang') : (isProductDetail ? 'Product Detail' : (isBranchDetail ? 'Branch Detail' : (isOrderDetail ? 'Order Detail' : (isCustomerDetail ? 'Customer Detail' : (isReportsRoute ? 'Reports' : meta.title)))))))));
    if (subEl) subEl.textContent = isMarketingEditor
      ? (marketingEditorType === 'banner' ? 'Atur konten, penempatan, jadwal, dan publikasi banner' : 'Atur program promosi, benefit pelanggan, dan tampilan promo')
      : (isMasterMenuEditor
        ? 'Susun menu komersial brand yang dijual ke pelanggan'
        : (isCategoryEditor
          ? 'Pengelompokan utama menu komersial di storefront'
          : (isProductEditor
            ? 'Kelola Product atomic, SKU, media, dan status inventory'
            : (isBranchEditor ? 'Kelola identitas, lokasi, kontak, dan aturan operasional cabang' : (isProductDetail ? 'Detail produk master dan status adopsi di cabang' : (isBranchDetail ? 'Detail informasi, operasional, menu, dan tim cabang' : (isOrderDetail ? 'Detail transaksi, rincian biaya, dan status pesanan' : (isCustomerDetail ? 'Profil pelanggan, riwayat pesanan, dan loyalitas' : (isReportsRoute ? 'Laporan penjualan, analitik bisnis, dan kinerja cabang' : meta.sub)))))))));

    // 6. Sync Owner bottom nav active module (no-op on desktop, hidden by CSS)
    if (typeof syncOwnerBottomNavActive === 'function') {
      syncOwnerBottomNavActive(route);
    } else if (typeof window !== 'undefined' && typeof window.syncOwnerBottomNavActive === 'function') {
      window.syncOwnerBottomNavActive(route);
    }

    // 7. In Platform Context: UI shells only, do not invoke merchant business loaders
    if (isPlatform) {
      return;
    }

    // 7. In Client Context: Load merchant business data for the route
    if (tabId === 'orders' && !isOrderDetail) {
      startOrdersPolling();
    } else {
      stopOrdersPolling();
    }

    if (tabId === 'business') {
      var mainView = $('owner-business-main-view');
      var catHub = $('subpage-catalog-menu-hub');
      var matHub = $('subpage-materials-production-hub');
      if (route === 'business/catalog') {
        var modernMount = $('modern-business-hub-mount');
        if (modernMount && typeof window.mountBusinessHub === 'function') {
          if (mainView) mainView.style.display = 'block';
          if (catHub) catHub.style.display = 'none';
          if (matHub) matHub.style.display = 'none';
          var legacyContent = $('legacy-business-main-content');
          if (legacyContent) legacyContent.style.display = 'none';
          modernMount.style.display = 'block';
          window.mountBusinessHub(modernMount, {
            initialSubHub: 'catalog',
            onNavigate: function(targetRoute, id) {
              if (id === 'catalog') {
                openBusinessSubHub('catalog');
              } else if (id === 'materials-production') {
                openBusinessSubHub('materials-production');
              } else {
                navigateTo(targetRoute.replace(/^#/, ''));
              }
            }
          });
        } else {
          if (mainView) mainView.style.display = 'none';
          if (catHub) catHub.style.display = 'block';
          if (matHub) matHub.style.display = 'none';
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (route === 'business/materials-production') {
        if (mainView) mainView.style.display = 'none';
        if (catHub) catHub.style.display = 'none';
        if (matHub) matHub.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        closeBusinessSubHub();
      }
    }
    if (tabId === 'overview') loadOverview();
    if (tabId === 'reports') loadReports(reportSubtype);
    if (tabId === 'stock') loadOwnerStockOverview();
    if (tabId === 'materials') {
      if (typeof loadOwnerMaterials === 'function') loadOwnerMaterials();
    }
    if (tabId === 'recipes') {
      var rEditor = $('recipe-editor-view');
      var rList = $('recipe-list-view');
      if (rEditor) rEditor.style.display = 'none';
      if (rList) rList.style.display = 'block';
      if (typeof loadOwnerRecipes === 'function') loadOwnerRecipes();
    }
    if (tabId === 'customers') {
      if (isCustomerDetail && customerDetailId) {
        loadCustomerDetailView(customerDetailId);
      } else {
        showCustomersListView();
        loadCustomers();
      }
    }
    if (tabId === 'orders') {
      if (isOrderDetail && orderDetailId) {
        loadOrderDetailView(orderDetailId);
      } else {
        showOrdersListView();
        loadOrders();
      }
    }
    if (tabId === 'branches') {
      if (isBranchEditor) {
        showBranchEditorView(branchEditorId);
      } else if (isBranchDetail && branchDetailId) {
        loadBranchDetail(branchDetailId, branchDetailSubtab);
      } else {
        showBranchListView();
        loadBranches();
      }
    }
    if (tabId === 'tim') {
      if (typeof switchTeamSection === 'function') switchTeamSection(teamSubtab, false);
      if (teamSubtab === 'invitations') {
        if (typeof loadInvitations === 'function') loadInvitations();
      } else {
        if (typeof loadTim === 'function') loadTim();
      }
    }
    if (tabId === 'finance') {
      switchFinanceSection(financeSubtab, false);
    }
    if (tabId === 'marketing' && !isMarketingEditor) {
      switchMarketingSection(marketingSubtab, false);
    }
    if (isMarketingEditor) {
      if (marketingEditorType === 'promotion' && typeof mountPromotionEditorPage === 'function') mountPromotionEditorPage();
      if (marketingEditorType === 'banner' && typeof mountMarketingBannerEditorPage === 'function') mountMarketingBannerEditorPage();
    }
    if (tabId === 'settings') {
      switchSettingsSection(settingsSubtab, false);
    }

    // Catalog Routes
    if (isBranchManager()) {
      if (isCatalogChild) loadInlineBranchCatalog();
    } else {
      if (isMasterMenuEditor) {
        showOwnerMasterMenuEditor(masterMenuEditorId);
        loadOwnerMasterMenuEditor(masterMenuEditorId);
      } else if (isCategoryEditor) {
        showCategoryEditorSection();
        loadCategoryEditorPage(categoryEditorId);
      } else if (isProductEditor) {
        showProductEditorSection();
        loadProductEditorPage(productEditorId);
      } else if (isProductDetail && productDetailId) {
        showProductDetailSection();
        loadProductDetailView(productDetailId);
      } else if (tabId === 'catalog-master-menus') {
        showOwnerMasterMenuList();
        loadOwnerMasterMenus();
      } else if (tabId === 'catalog-products') {
        showProductListSection();
        loadMasterProducts();
      } else if (tabId === 'catalog-categories') {
        showMasterCategoriesPage();
        loadMasterCategoriesPage();
      } else if (tabId === 'catalog-menus') {
        loadMenusView();
      }
    }
  }

  // switchTab kept for backward compat (called from quick-action buttons in HTML)
  function switchTab(tabId) {
    // Map old tab IDs to new routes
    var legacyMap = {
      'overview': 'overview', 'brand': 'brand', 'catalog': 'catalog/master-menus',
      'branches': 'branches', 'tim': 'team', 'orders': 'orders',
      'payments': 'payments'
    };
    navigateTo(legacyMap[tabId] || tabId);
  }
  window.switchTab = switchTab;

  /* =========================================================================
     BRANCH CONTEXT SELECTOR
     Populates the topbar branch dropdown from loaded branch data.
     The selector maintains a UI/state contract so real data can connect later.
     ========================================================================= */

  // State for currently selected branch context
  var _branchContextState = window._branchContextState || {
    selected: 'all',   // 'all' or a branch id string
    branches: []       // loaded branch objects [{id, name}]
  };
  window._branchContextState = _branchContextState;

  // Populate branch selector from branches list
  function populateBranchSelector(branches) {
    var sel = $('dash-branch-context');
    if (!sel) return;
    var allBranches = branches || [];
    var user = getStoredUser();

    // Role-scoped branch list filtering:
    // If brand_manager, only show branches matching user's brand_id
    var scopedBranches = allBranches;
    if (user && user.role === 'brand_manager' && user.brand_id) {
      scopedBranches = allBranches.filter(function (b) {
        return String(b.brand_id) === String(user.brand_id);
      });
    } else if (user && user.role === 'branch_manager' && user.branch_id) {
      scopedBranches = allBranches.filter(function (b) {
        return String(b.id) === String(user.branch_id);
      });
    }

    _branchContextState.branches = scopedBranches;

    // Rebuild native select options
    sel.innerHTML = '<option value="all">All Branches</option>';
    (_branchContextState.branches).forEach(function (b) {
      var opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.name;
      sel.appendChild(opt);
    });

    // Rebuild custom inline dropdown menu items
    var menu = $('branch-dropdown-menu');
    if (menu) {
      menu.innerHTML = '';
      var allOpt = document.createElement('button');
      allOpt.type = 'button';
      allOpt.className = 'x-branch-dropdown-item';
      allOpt.setAttribute('role', 'option');
      allOpt.dataset.value = 'all';
      allOpt.innerHTML = '<span>Semua Cabang</span><svg class="x-branch-check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      menu.appendChild(allOpt);
      (_branchContextState.branches).forEach(function (b) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'x-branch-dropdown-item';
        btn.setAttribute('role', 'option');
        btn.dataset.value = String(b.id);
        btn.innerHTML = '<span>' + b.name + '</span><svg class="x-branch-check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        menu.appendChild(btn);
      });
      updateBranchDropdownActive(sel.value || 'all');
      wirebranchDropdownItems();
    }

    // Restore previous selection if still valid
    if (user && user.role === 'branch_manager' && user.branch_id) {
      _branchContextState.selected = user.branch_id;
      sel.value = user.branch_id;
      sel.disabled = true;

      // Update BM branch badge text if available
      var bmBadgeName = $('dash-bm-branch-name');
      if (bmBadgeName) {
        var foundB = (_branchContextState.branches).find(function (b) { return String(b.id) === String(user.branch_id); }) ||
                     allBranches.find(function (b) { return String(b.id) === String(user.branch_id); });
        if (foundB && foundB.name) {
          bmBadgeName.textContent = foundB.name;
        }
      }
    } else if (user && (user.role === 'cashier' || user.role === 'kitchen')) {
      sel.disabled = true;
    } else {
      var validIds = ['all'].concat((_branchContextState.branches).map(function (b) { return String(b.id); }));
      if (validIds.indexOf(_branchContextState.selected) === -1) {
        _branchContextState.selected = 'all';
      }
      sel.value = _branchContextState.selected;
      sel.disabled = false;
    }
  }

  function updateBranchDropdownActive(value) {
    var label = $('branch-current-label');
    var menu = $('branch-dropdown-menu');
    if (!menu) return;
    var items = menu.querySelectorAll('.x-branch-dropdown-item');
    items.forEach(function (btn) {
      var isActive = btn.dataset.value === String(value);
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      if (isActive && label) {
        label.textContent = btn.querySelector('span') ? btn.querySelector('span').textContent : btn.textContent;
      }
    });
  }

  function wirebranchDropdownItems() {
    var menu = $('branch-dropdown-menu');
    var sel = $('dash-branch-context');
    var wrapper = $('x-branch-selector');
    if (!menu) return;
    menu.querySelectorAll('.x-branch-dropdown-item').forEach(function (btn) {
      // Remove previous listeners by replacing node
      var fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
      fresh.addEventListener('click', function (e) {
        e.stopPropagation();
        var val = this.dataset.value;
        // Close dropdown
        if (wrapper) wrapper.classList.remove('open');
        var trigger = $('btn-branch-trigger');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
        // Sync native select
        if (sel) {
          sel.value = val;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        updateBranchDropdownActive(val);
      });
    });
  }

  function initBranchContextSelector() {
    var sel = $('dash-branch-context');
    if (!sel) return;

    // Custom dropdown trigger (seluruh pill x-branch-selector dan isinya dapat diklik)
    var trigger = $('btn-branch-trigger');
    var wrapper = $('x-branch-selector');
    if (wrapper) {
      wrapper.addEventListener('click', function (e) {
        // Jangan toggle ulang jika yang diklik adalah item di dalam dropdown menu itu sendiri
        if (e.target.closest('#branch-dropdown-menu')) return;
        e.stopPropagation();
        var isOpen = wrapper.classList.contains('open');
        wrapper.classList.toggle('open', !isOpen);
        if (trigger) trigger.setAttribute('aria-expanded', !isOpen ? 'true' : 'false');
      });
      document.addEventListener('click', function (e) {
        if (wrapper.classList.contains('open') && !wrapper.contains(e.target)) {
          wrapper.classList.remove('open');
          if (trigger) trigger.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // Native select change handler (fired both by custom items and any programmatic changes)
    sel.addEventListener('change', function () {
      _branchContextState.selected = sel.value;
      updateBranchDropdownActive(sel.value);
      var curRoute = getCurrentRoute();
      var tabOverview = $('tab-overview');
      var isOverviewTabActive = tabOverview && tabOverview.classList.contains('active');
      if (curRoute === 'overview' || curRoute === 'beranda' || isOverviewTabActive) {
        loadOverview();
      } else if (curRoute === 'reports' || curRoute.indexOf('reports/') === 0) {
        var subType = curRoute.indexOf('reports/') === 0 ? curRoute.split('reports/')[1] : 'overview';
        loadReports(subType);
      } else if (curRoute === 'stock') {
        loadOwnerStockOverview();
      } else if (curRoute === 'catalog/menus') {
        loadMenusView();
      } else if (curRoute === 'orders') {
        loadOrders();
      } else if (curRoute === 'customers') {
        loadCustomers();
      } else if (curRoute === 'team' || curRoute.indexOf('team/') === 0) {
        loadTim();
      } else if (curRoute === 'finance' || curRoute.indexOf('finance/') === 0) {
        loadFinanceCurrentSubtab();
      } else if (curRoute === 'marketing' || curRoute.indexOf('marketing/') === 0) {
        loadMarketingCurrentSubtab();
      } else if (curRoute === 'settings' || curRoute.indexOf('settings/') === 0) {
        loadSettingsCurrentSubtab();
      } else if (isBranchManager() && (curRoute === 'catalog' || curRoute.indexOf('catalog/') === 0)) {
        loadInlineBranchCatalog();
      }
    });
  }

  /* =========================================================================
     MOBILE SIDEBAR — Hamburger / Overlay / Close
     ========================================================================= */

  function initMobileSidebar() {
    var sidebar = $('x-dash-sidebar');
    var overlay = $('x-sidebar-overlay');
    var btnOpen = $('btn-hamburger');
    var btnClose = $('btn-sidebar-close');

    if (btnOpen) btnOpen.addEventListener('click', openMobileSidebar);
    if (btnClose) btnClose.addEventListener('click', closeMobileSidebar);
    if (overlay) overlay.addEventListener('click', closeMobileSidebar);

    // Event delegation: Close sidebar whenever any nav item or sub-item is clicked (mobile & tablet drawer)
    if (sidebar) {
      sidebar.addEventListener('click', function (e) {
        var navBtn = e.target.closest('.x-nav-item:not(.x-nav-parent)[data-route], .x-nav-sub-item');
        if (navBtn) {
          closeMobileSidebar();
        }
      });
    }

    // Dismiss drawer on Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sidebar && sidebar.classList.contains('open')) {
        closeMobileSidebar();
      }
    });

    // Automatically close mobile drawer when viewport crosses to desktop breakpoint
    window.addEventListener('resize', function () {
      if (window.innerWidth >= 1024) {
        closeMobileSidebar();
      }
    });
  }



  /* =========================================================================
     MODUL 1: BRAND & THEME COLOR CONTROLLER
     Extracted to standalone module: assets/js/modules/brand.js
     ========================================================================= */
  async function loadBrandSettings() {
    if (window.XentraBrandModule && window.XentraBrandModule.loadBrandSettings) {
      return window.XentraBrandModule.loadBrandSettings();
    }
  }

  function applyBrandToUI(brand) {
    if (window.XentraBrandModule && window.XentraBrandModule.applyBrandToUI) {
      return window.XentraBrandModule.applyBrandToUI(brand);
    }
  }

  function updateLiveMockupPreview(name, logo, color) {
    if (window.XentraBrandModule && window.XentraBrandModule.updateLiveMockupPreview) {
      return window.XentraBrandModule.updateLiveMockupPreview(name, logo, color);
    }
  }

  async function doUploadBrandLogo(file, cropSpec, previewDataUrl, triggerBtn) {
    if (window.XentraBrandModule && window.XentraBrandModule.doUploadBrandLogo) {
      return window.XentraBrandModule.doUploadBrandLogo(file, cropSpec, previewDataUrl, triggerBtn);
    }
  }

  async function doUploadPwaLauncherIcon(file, endpoint, previewEl, hiddenEl, removeBtn, pickBtn, cropSpec) {
    if (window.XentraBrandModule && window.XentraBrandModule.doUploadPwaLauncherIcon) {
      return window.XentraBrandModule.doUploadPwaLauncherIcon(file, endpoint, previewEl, hiddenEl, removeBtn, pickBtn, cropSpec);
    }
  }

  function initBrandListeners() {
    if (window.XentraBrandModule && window.XentraBrandModule.initBrandListeners) {
      return window.XentraBrandModule.initBrandListeners();
    }
  }

  function renderBannersList(banners) {
    if (window.XentraBrandModule && window.XentraBrandModule.renderBannersList) {
      return window.XentraBrandModule.renderBannersList(banners);
    }
  }

  async function deleteBannerSlide(id) {
    if (window.XentraBrandModule && window.XentraBrandModule.deleteBannerSlide) {
      return window.XentraBrandModule.deleteBannerSlide(id);
    }
  }

  window.loadBrandSettings = loadBrandSettings;
  window.applyBrandToUI = applyBrandToUI;
  window.updateLiveMockupPreview = updateLiveMockupPreview;
  window.doUploadBrandLogo = doUploadBrandLogo;
  window.doUploadPwaLauncherIcon = doUploadPwaLauncherIcon;
  window.deleteBannerSlide = deleteBannerSlide;


  /* =========================================================================
     PHASE 1: CATALOG CONTROLLERS (PRODUCTS, CATEGORIES, MENUS)
     Extracted to standalone module: assets/js/modules/catalog.js
     ========================================================================= */
  async function loadMasterProducts() {
    if (window.XentraCatalogModule && window.XentraCatalogModule.loadMasterProducts) {
      return window.XentraCatalogModule.loadMasterProducts();
    }
  }
  var loadCatalog = loadMasterProducts;

  async function loadProductDetailView(productId) {
    if (window.XentraCatalogModule && window.XentraCatalogModule.loadProductDetailView) {
      return window.XentraCatalogModule.loadProductDetailView(productId);
    }
  }

  function showProductListSection() {
    if (window.XentraCatalogModule && window.XentraCatalogModule.showProductListSection) {
      return window.XentraCatalogModule.showProductListSection();
    }
    if (typeof window.showProductListSection === 'function') {
      return window.showProductListSection();
    }
  }

  function showProductDetailSection() {
    if (window.XentraCatalogModule && window.XentraCatalogModule.showProductDetailSection) {
      return window.XentraCatalogModule.showProductDetailSection();
    }
    if (typeof window.showProductDetailSection === 'function') {
      return window.showProductDetailSection();
    }
  }

  function showProductEditorSection() {
    if (window.XentraCatalogModule && window.XentraCatalogModule.showProductEditorSection) {
      return window.XentraCatalogModule.showProductEditorSection();
    }
    if (typeof window.showProductEditorSection === 'function') {
      return window.showProductEditorSection();
    }
  }

  var _masterReferenceTab = 'category';
  var _masterReferenceLoadSeq = 0;
  var _masterMenuComponents = { title: [], flavor: [], complement: [], level: [] };
  var _ownerMasterMenuState = window._ownerMasterMenuState || { menus: [] };
  window._ownerMasterMenuState = _ownerMasterMenuState;

  function showCategoryEditorSection() {
    if (window.XentraCatalogReference && window.XentraCatalogReference.showCategoryEditorSection) {
      return window.XentraCatalogReference.showCategoryEditorSection();
    }
    if (window.XentraCatalogModule && window.XentraCatalogModule.showCategoryEditorSection) {
      return window.XentraCatalogModule.showCategoryEditorSection();
    }
    if (typeof window.showCategoryEditorSection === 'function') {
      return window.showCategoryEditorSection();
    }
  }

  function showMasterCategoriesPage() {
    if (window.XentraCatalogReference && window.XentraCatalogReference.showMasterCategoriesPage) {
      return window.XentraCatalogReference.showMasterCategoriesPage();
    }
    if (window.XentraCatalogModule && window.XentraCatalogModule.showMasterCategoriesPage) {
      return window.XentraCatalogModule.showMasterCategoriesPage();
    }
    if (typeof window.showMasterCategoriesPage === 'function') {
      return window.showMasterCategoriesPage();
    }
  }

  function setMasterReferenceTab(type) {
    if (window.XentraCatalogReference && window.XentraCatalogReference.setMasterReferenceTab) {
      return window.XentraCatalogReference.setMasterReferenceTab(type);
    }
    if (window.XentraCatalogModule && window.XentraCatalogModule.setMasterReferenceTab) {
      return window.XentraCatalogModule.setMasterReferenceTab(type);
    }
    if (typeof window.setMasterReferenceTab === 'function') {
      return window.setMasterReferenceTab(type);
    }
  }

  async function loadMasterCategoriesPage() {
    if (window.XentraCatalogReference && window.XentraCatalogReference.loadMasterCategoriesPage) {
      return window.XentraCatalogReference.loadMasterCategoriesPage();
    }
    if (window.XentraCatalogModule && window.XentraCatalogModule.loadMasterCategoriesPage) {
      return window.XentraCatalogModule.loadMasterCategoriesPage();
    }
    if (typeof window.loadMasterCategoriesPage === 'function') {
      return window.loadMasterCategoriesPage();
    }
  }

  function renderMasterItemsList() {
    if (window.XentraCatalogReference && window.XentraCatalogReference.renderMasterItemsList) {
      return window.XentraCatalogReference.renderMasterItemsList();
    }
    if (window.XentraCatalogModule && window.XentraCatalogModule.renderMasterItemsList) {
      return window.XentraCatalogModule.renderMasterItemsList();
    }
    if (typeof window.renderMasterItemsList === 'function') {
      return window.renderMasterItemsList();
    }
  }

  function renderMasterReferenceList(type) {
    if (window.XentraCatalogReference && window.XentraCatalogReference.renderMasterReferenceList) {
      return window.XentraCatalogReference.renderMasterReferenceList(type);
    }
    if (window.XentraCatalogModule && window.XentraCatalogModule.renderMasterReferenceList) {
      return window.XentraCatalogModule.renderMasterReferenceList(type);
    }
    if (typeof window.renderMasterReferenceList === 'function') {
      return window.renderMasterReferenceList(type);
    }
  }

  function renderMasterCategoriesPage() {
    if (window.XentraCatalogReference && window.XentraCatalogReference.renderMasterCategoriesPage) {
      return window.XentraCatalogReference.renderMasterCategoriesPage();
    }
    if (window.XentraCatalogModule && window.XentraCatalogModule.renderMasterCategoriesPage) {
      return window.XentraCatalogModule.renderMasterCategoriesPage();
    }
    if (typeof window.renderMasterCategoriesPage === 'function') {
      return window.renderMasterCategoriesPage();
    }
  }

  function renderMasterFlavorsPage() {
    if (window.XentraCatalogReference && window.XentraCatalogReference.renderMasterFlavorsPage) {
      return window.XentraCatalogReference.renderMasterFlavorsPage();
    }
    if (window.XentraCatalogModule && window.XentraCatalogModule.renderMasterFlavorsPage) {
      return window.XentraCatalogModule.renderMasterFlavorsPage();
    }
    if (typeof window.renderMasterFlavorsPage === 'function') {
      return window.renderMasterFlavorsPage();
    }
  }

  function openMasterReferenceQuickAdd(type) {
    if (window.XentraCatalogReference && window.XentraCatalogReference.openMasterReferenceQuickAdd) {
      return window.XentraCatalogReference.openMasterReferenceQuickAdd(type);
    }
    if (window.XentraCatalogModule && window.XentraCatalogModule.openMasterReferenceQuickAdd) {
      return window.XentraCatalogModule.openMasterReferenceQuickAdd(type);
    }
    if (typeof window.openMasterReferenceQuickAdd === 'function') {
      return window.openMasterReferenceQuickAdd(type);
    }
  }

  async function loadCategoryEditorPage(categoryId) {
    if (window.XentraCatalogReference && window.XentraCatalogReference.loadCategoryEditorPage) {
      return window.XentraCatalogReference.loadCategoryEditorPage(categoryId);
    }
    if (window.XentraCatalogModule && window.XentraCatalogModule.loadCategoryEditorPage) {
      return window.XentraCatalogModule.loadCategoryEditorPage(categoryId);
    }
    if (typeof window.loadCategoryEditorPage === 'function') {
      return window.loadCategoryEditorPage(categoryId);
    }
  }

  async function loadProductEditorPage(productId) {
    if (window.XentraCatalogModule && window.XentraCatalogModule.loadProductEditorPage) {
      return window.XentraCatalogModule.loadProductEditorPage(productId);
    }
  }

  async function loadMenusView() {
    if (window.XentraCatalogModule && window.XentraCatalogModule.loadMenusView) {
      return window.XentraCatalogModule.loadMenusView();
    }
  }

  async function loadSingleBranchMenuView(branchId) {
    if (window.XentraCatalogModule && window.XentraCatalogModule.loadSingleBranchMenuView) {
      return window.XentraCatalogModule.loadSingleBranchMenuView(branchId);
    }
  }

  function initCatalogListeners() {
    if (window.XentraCatalogModule && window.XentraCatalogModule.initCatalogListeners) {
      return window.XentraCatalogModule.initCatalogListeners();
    }
  }
  /* =========================================================================
     MODUL 3: CABANG & PENGATURAN ONGKIR CONTROLLER
     Extracted to standalone module: assets/js/modules/branches.js
     ========================================================================= */
  async function loadBranches() {
    if (window.XentraBranchesModule && window.XentraBranchesModule.loadBranches) {
      return window.XentraBranchesModule.loadBranches();
    }
  }

  function initBranchSearchAndFilter() {
    if (window.XentraBranchesModule && window.XentraBranchesModule.initBranchSearchAndFilter) {
      return window.XentraBranchesModule.initBranchSearchAndFilter();
    }
  }

  function initBranchOperationsForm() {
    if (window.XentraBranchesModule && window.XentraBranchesModule.initBranchOperationsForm) {
      return window.XentraBranchesModule.initBranchOperationsForm();
    }
  }

  function showBranchListView() {
    if (window.XentraBranchesModule && window.XentraBranchesModule.showBranchListView) {
      return window.XentraBranchesModule.showBranchListView();
    }
  }

  function showBranchDetailView() {
    if (window.XentraBranchesModule && window.XentraBranchesModule.showBranchDetailView) {
      return window.XentraBranchesModule.showBranchDetailView();
    }
  }

  async function showBranchEditorView(branchId) {
    if (window.XentraBranchesModule && window.XentraBranchesModule.showBranchEditorView) {
      return window.XentraBranchesModule.showBranchEditorView(branchId);
    }
  }

  async function loadBranchDetail(branchId, subtab) {
    if (window.XentraBranchesModule && window.XentraBranchesModule.loadBranchDetail) {
      return window.XentraBranchesModule.loadBranchDetail(branchId, subtab);
    }
  }

  /* =========================================================================
     MODUL 4: PESANAN CONTROLLER (ORDER LIST & ORDER DETAIL)
     Extracted to standalone module: assets/js/modules/orders.js
     ========================================================================= */
  function showOrdersListView() {
    if (window.XentraOrdersModule) return window.XentraOrdersModule.showOrdersListView();
  }
  function showOrderDetailView() {
    if (window.XentraOrdersModule) return window.XentraOrdersModule.showOrderDetailView();
  }
  function stopOrdersPolling() {
    if (window.XentraOrdersModule) return window.XentraOrdersModule.stopOrdersPolling();
  }
  function startOrdersPolling() {
    if (window.XentraOrdersModule) return window.XentraOrdersModule.startOrdersPolling();
  }
  function loadOrders(opts) {
    if (window.XentraOrdersModule) return window.XentraOrdersModule.loadOrders(opts);
  }
  function renderOrdersTable() {
    if (window.XentraOrdersModule) return window.XentraOrdersModule.renderOrdersTable();
  }
  function loadOrderDetailView(orderId) {
    if (window.XentraOrdersModule) return window.XentraOrdersModule.loadOrderDetailView(orderId);
  }
  function initOrdersFilterListeners() {
    if (window.XentraOrdersModule) return window.XentraOrdersModule.initOrdersFilterListeners();
  }


  /* =========================================================================
     MODUL 5: RINGKASAN & OVERVIEW (PHASE 4)
     Extracted to standalone module: assets/js/modules/overview.js
     ========================================================================= */
  function getEffectiveBranchId() {
    return _branchContextState.selected !== 'all' ? _branchContextState.selected : '';
  }

  async function loadOverview() {
    if (window.XentraOverviewModule && window.XentraOverviewModule.loadOverview) {
      return window.XentraOverviewModule.loadOverview();
    }
  }

  function setOverviewPeriodPreset(preset, skipReload) {
    if (window.XentraOverviewModule && window.XentraOverviewModule.setOverviewPeriodPreset) {
      return window.XentraOverviewModule.setOverviewPeriodPreset(preset, skipReload);
    }
  }

  function initOverviewControls() {
    if (window.XentraOverviewModule && window.XentraOverviewModule.initOverviewControls) {
      return window.XentraOverviewModule.initOverviewControls();
    }
  }


  /* =========================================================================
     MODUL 5: STOCK & INVENTORY MODULE
     Delegated to window.XentraStockModule (/merchant-dashboard/assets/js/modules/stock.js)
     ========================================================================= */
  function loadOwnerStockOverview() {
    if (window.XentraStockModule && window.XentraStockModule.loadOwnerStockOverview) {
      return window.XentraStockModule.loadOwnerStockOverview();
    }
    if (typeof window.loadOwnerStockOverview === "function" && window.loadOwnerStockOverview !== loadOwnerStockOverview) {
      return window.loadOwnerStockOverview();
    }
  }

  function initOwnerStockControls() {
    if (window.XentraStockModule && window.XentraStockModule.initOwnerStockControls) {
      return window.XentraStockModule.initOwnerStockControls();
    }
    if (typeof window.initOwnerStockControls === "function" && window.initOwnerStockControls !== initOwnerStockControls) {
      return window.initOwnerStockControls();
    }
  }
  /* =========================================================================
     MODUL 6: REPORTS ENGINE (PHASE 4)
     Extracted to standalone module: assets/js/modules/reports.js
     ========================================================================= */
  async function loadReports(reportType) {
    if (window.XentraReportsModule && window.XentraReportsModule.loadReports) {
      return window.XentraReportsModule.loadReports(reportType);
    }
  }

  function initReportsControls() {
    if (window.XentraReportsModule && window.XentraReportsModule.initReportsControls) {
      return window.XentraReportsModule.initReportsControls();
    }
  }

  /* =========================================================================
     MODUL 0: MERCHANT AUTH & SESSION GUARD
     Extracted to standalone module: assets/js/modules/auth.js
     ========================================================================= */
  var getStoredUser = (_shared && _shared.getStoredUser) || (window.XentraShared && window.XentraShared.getStoredUser) || function () {
    if (window.XentraAuthModule && window.XentraAuthModule.getStoredUser) return window.XentraAuthModule.getStoredUser();
  };

  var isBranchManager = (_shared && typeof _shared.isBranchManager === 'function' ? _shared.isBranchManager : null) ||
    (window.XentraShared && typeof window.XentraShared.isBranchManager === 'function' ? window.XentraShared.isBranchManager : null) ||
    function () {
      if (window.XentraAuthModule && window.XentraAuthModule.isBranchManager) return window.XentraAuthModule.isBranchManager();
      var u = (typeof getStoredUser === 'function' ? getStoredUser() : null);
      return !!(u && (u.role === 'branch_manager' || u.role === 'manager'));
    };

  var checkAuth = (_shared && _shared.checkAuth) || (window.XentraShared && window.XentraShared.checkAuth);
  var handleHandoffExchange = (_shared && _shared.handleHandoffExchange) || (window.XentraShared && window.XentraShared.handleHandoffExchange);
  var validateServerSession = (_shared && _shared.validateServerSession) || (window.XentraShared && window.XentraShared.validateServerSession);
  var enforceSurface = (_shared && _shared.enforceSurface) || (window.XentraShared && window.XentraShared.enforceSurface);

  function applyRoleBasedUI() {
    if (window.XentraAuthModule && window.XentraAuthModule.applyRoleBasedUI) {
      return window.XentraAuthModule.applyRoleBasedUI();
    }
  }

  async function handleLogout() {
    if (window.XentraAuthModule && window.XentraAuthModule.handleLogout) {
      return window.XentraAuthModule.handleLogout();
    }
  }

  function populateMobileAccount() {
    if (window.XentraAuthModule && window.XentraAuthModule.populateMobileAccount) {
      return window.XentraAuthModule.populateMobileAccount();
    }
  }

  function closeMobileAccount(skipHistory) {
    if (window.XentraAuthModule && window.XentraAuthModule.closeMobileAccount) {
      return window.XentraAuthModule.closeMobileAccount(skipHistory);
    }
  }

  function openMobileAccount() {
    if (window.XentraAuthModule && window.XentraAuthModule.openMobileAccount) {
      return window.XentraAuthModule.openMobileAccount();
    }
  }

  window.openMobileAccount = openMobileAccount;
  window.closeMobileAccount = closeMobileAccount;

  function initAuthListeners() {
    if (window.XentraAuthModule && window.XentraAuthModule.initAuthListeners) {
      return window.XentraAuthModule.initAuthListeners();
    }
  }



  /* =========================================================================
     MODUL: WORKFORCE / TIM MANAGEMENT
     Extracted to standalone module: assets/js/modules/team.js
     ========================================================================= */
  async function loadTim() {
    if (window.XentraTeamModule && window.XentraTeamModule.loadTim) {
      return window.XentraTeamModule.loadTim();
    }
  }

  async function loadInvitations() {
    if (window.XentraTeamModule && window.XentraTeamModule.loadInvitations) {
      return window.XentraTeamModule.loadInvitations();
    }
  }

  /* =========================================================================
     MODUL: CUSTOMERS & LOYALTY (Phase 5)
     Extracted to standalone module: assets/js/modules/customers.js
     ========================================================================= */
  async function loadCustomers() {
    if (window.XentraCustomersModule && window.XentraCustomersModule.loadCustomers) {
      return window.XentraCustomersModule.loadCustomers();
    }
  }

  function showCustomersListView() {
    if (window.XentraCustomersModule && window.XentraCustomersModule.showCustomersListView) {
      return window.XentraCustomersModule.showCustomersListView();
    }
  }

  async function loadCustomerDetailView(customerId) {
    if (window.XentraCustomersModule && window.XentraCustomersModule.loadCustomerDetailView) {
      return window.XentraCustomersModule.loadCustomerDetailView(customerId);
    }
  }

  /* =========================================================================
     MODUL: FINANCE & SETTLEMENT
     Extracted to standalone module: assets/js/modules/finance.js
     ========================================================================= */
  function switchFinanceSection(subtab, updateHash) {
    if (window.XentraFinanceModule && window.XentraFinanceModule.switchFinanceSection) {
      return window.XentraFinanceModule.switchFinanceSection(subtab, updateHash);
    }
  }

  function loadFinanceCurrentSubtab() {
    if (window.XentraFinanceModule && window.XentraFinanceModule.loadFinanceCurrentSubtab) {
      return window.XentraFinanceModule.loadFinanceCurrentSubtab();
    }
  }

  /* =========================================================================
     MODUL: MARKETING, BANNERS & PROMOTIONS
     Extracted to standalone module: assets/js/modules/marketing.js
     ========================================================================= */
  var MARKETING_VIEWS = {
    'overview': 'marketing-view-overview',
    'promotions': 'marketing-view-promotions',
    'banners': 'marketing-view-banners',
    'broadcasts': 'marketing-view-broadcasts'
  };

  function switchMarketingSection(subtab, updateHash) {
    if (window.XentraMarketingModule && window.XentraMarketingModule.switchMarketingSection) {
      return window.XentraMarketingModule.switchMarketingSection(subtab, updateHash);
    }
  }

  function loadMarketingCurrentSubtab() {
    if (window.XentraMarketingModule && window.XentraMarketingModule.loadMarketingCurrentSubtab) {
      return window.XentraMarketingModule.loadMarketingCurrentSubtab();
    }
  }

  function unmountMarketingEditors() {
    if (typeof window.unmountPromotionEditorPage === 'function') {
      window.unmountPromotionEditorPage();
    }
    if (typeof window.unmountMarketingBannerEditorPage === 'function') {
      window.unmountMarketingBannerEditorPage();
    }
  }
  window.unmountMarketingEditors = unmountMarketingEditors;

  // Wire shared branch-catalog hooks: the Owner surface supplies the branch list.
  if (window.XentraOwnerBranchCatalog) {
    window.XentraOwnerBranchCatalog.setHooks({
      getBranches: function () { return state.branches; }
    });
  }

  window.__xentraInitDashboard = function () {
    checkAuth();
    validateServerSession();
    applyRoleBasedUI();
    loadBrandSettings();
    if (isBranchManager()) {
      loadInlineBranchCatalog();
    } else {
      loadCatalog();
    }
    loadOverview();
  };

  /* =========================================================================
     INITIALIZATION ON DOM READY
     ========================================================================= */

  /* =========================================================================
     OWNER MASTER MENU — CANONICAL COMMERCIAL MENU WORKSPACE
     Extracted to standalone module: assets/js/modules/master-menu.js
     ========================================================================= */
  function showOwnerMasterMenuList() {
    if (window.XentraMasterMenuModule && typeof window.XentraMasterMenuModule.showOwnerMasterMenuList === 'function') {
      return window.XentraMasterMenuModule.showOwnerMasterMenuList();
    }
    if (typeof window.showOwnerMasterMenuList === 'function') {
      return window.showOwnerMasterMenuList();
    }
  }

  function showOwnerMasterMenuEditor(menuId) {
    if (window.XentraMasterMenuModule && typeof window.XentraMasterMenuModule.showOwnerMasterMenuEditor === 'function') {
      return window.XentraMasterMenuModule.showOwnerMasterMenuEditor(menuId);
    }
    if (typeof window.showOwnerMasterMenuEditor === 'function') {
      return window.showOwnerMasterMenuEditor(menuId);
    }
  }

  async function loadOwnerMasterMenus() {
    if (window.XentraMasterMenuModule && window.XentraMasterMenuModule.loadOwnerMasterMenus) {
      return window.XentraMasterMenuModule.loadOwnerMasterMenus();
    }
    if (typeof window.loadOwnerMasterMenus === 'function') {
      return window.loadOwnerMasterMenus();
    }
  }

  async function loadOwnerMasterMenuEditor(menuId) {
    if (window.XentraMasterMenuModule && window.XentraMasterMenuModule.loadOwnerMasterMenuEditor) {
      return window.XentraMasterMenuModule.loadOwnerMasterMenuEditor(menuId);
    }
    if (typeof window.loadOwnerMasterMenuEditor === 'function') {
      return window.loadOwnerMasterMenuEditor(menuId);
    }
  }

  function initOwnerMasterMenuUI() {
    if (window.XentraMasterMenuModule && window.XentraMasterMenuModule.initOwnerMasterMenuUI) {
      return window.XentraMasterMenuModule.initOwnerMasterMenuUI();
    }
    if (typeof window.initOwnerMasterMenuUI === 'function') {
      return window.initOwnerMasterMenuUI();
    }
  }

  var _isInitialized = false;
  async function initializeDashboard() {
    if (_isInitialized) return;
    _isInitialized = true;

    // Wire navigation click handlers for nav items (supports data-route and data-tab)
    document.querySelectorAll('.x-nav-item:not(.x-nav-parent)').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var route = btn.dataset.route || btn.dataset.tab;
        if (route) {
          navigateTo(route);
        }
      });
    });

    // Wire catalog sub-nav click handlers
    document.querySelectorAll('.x-nav-sub-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var route = btn.dataset.route || btn.dataset.tab;
        if (route) {
          navigateTo(route);
        }
      });
    });

    // Catalog parent: toggle sub-nav on click if already on catalog route
    var catalogParentBtn = $('nav-catalog-parent');
    if (catalogParentBtn) {
      catalogParentBtn.addEventListener('click', function () {
        var currentRoute = getCurrentRoute();
        var isCatalogActive = currentRoute === 'catalog' || currentRoute.indexOf('catalog/') === 0;
        if (!isCatalogActive) {
          // Navigate to catalog (will open sub-nav via applyRoute)
          navigateTo('catalog');
        } else {
          // Toggle sub-nav open/close without changing route
          var sub = $('nav-catalog-sub');
          if (sub) sub.classList.toggle('open');
          var expanded = sub && sub.classList.contains('open');
          catalogParentBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        }
      });
    }

    initAuthListeners();
    initBrandListeners();
    initSettingsProfileListeners();
    initCatalogListeners();
    initOwnerMasterMenuUI();
    initBranchSearchAndFilter();
    initBranchOperationsForm();

    var backFromBranchEditor = $('btn-back-from-branch-editor');
    if (backFromBranchEditor) backFromBranchEditor.addEventListener('click', function () { goBackFromChildPage(); });
    var cancelBranchEditor = $('btn-cancel-branch-editor');
    if (cancelBranchEditor) cancelBranchEditor.addEventListener('click', function () { navigateTo('branches'); });
    initOrdersFilterListeners();
    initMobileSidebar();
    initBranchContextSelector();
    if (typeof initOwnerBottomNav === 'function') {
      initOwnerBottomNav();
    } else if (typeof window !== 'undefined' && typeof window.initOwnerBottomNav === 'function') {
      window.initOwnerBottomNav();
    }
    initOverviewControls();

    var refreshAppBtn = $('btn-settings-refresh-app-data');
    if (refreshAppBtn) {
      refreshAppBtn.addEventListener('click', function () {
        refreshAppBtn.disabled = true;
        refreshAppBtn.textContent = 'Menyegarkan...';
        window.location.reload();
      });
    }

    // Workforce form submit
    var formUser = $('form-user');
    if (formUser && typeof submitUserForm === 'function') {
      formUser.addEventListener('submit', submitUserForm);
    }

    // Inline branch category button
    var btnAddBranchCatInline = $('btn-add-branch-category-inline');
    if (btnAddBranchCatInline) {
      btnAddBranchCatInline.addEventListener('click', async function () {
        if (!XentraOwnerBranchCatalog.state.branchId) return;
        var name = await requestTextInputSheet({ title: 'Tambah Kategori Cabang', label: 'Nama Kategori' });
        if (!name || !name.trim()) return;
        try {
          var res = await adminFetch(API_BASE + '/admin/branches/' + XentraOwnerBranchCatalog.state.branchId + '/categories', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ name: name.trim() })
          });
          var data = await res.json();
          if (data.success) {
            showToast('\u2705 Kategori cabang berhasil dibuat!');
            loadInlineBranchCatalog();
          } else {
            showToast('\u274C ' + (data.error || 'Gagal membuat kategori.'));
          }
        } catch (err) {
          showToast('\u274C Kesalahan jaringan.');
        }
      });
    }

    /* =========================================================================
       PHASE 7: SETTINGS & INTEGRATIONS CONTROLLER
       Extracted to standalone module: assets/js/modules/settings.js
       ========================================================================= */
    function switchSettingsSection(sectionName, updateHash) {
      if (window.XentraSettingsModule && window.XentraSettingsModule.switchSettingsSection) {
        return window.XentraSettingsModule.switchSettingsSection(sectionName, updateHash);
      }
    }
    window.switchSettingsSection = switchSettingsSection;

    function loadSettingsCurrentSubtab() {
      if (window.XentraSettingsModule && window.XentraSettingsModule.loadSettingsCurrentSubtab) {
        return window.XentraSettingsModule.loadSettingsCurrentSubtab();
      }
    }
    window.loadSettingsCurrentSubtab = loadSettingsCurrentSubtab;

    function initSettingsProfileListeners() {
      if (window.XentraSettingsModule && window.XentraSettingsModule.initSettingsProfileListeners) {
        return window.XentraSettingsModule.initSettingsProfileListeners();
      }
    }

    // Check for handoff ticket from xentra.cloud before initial auth check
    await handleHandoffExchange();

    // Branch Manager gets the dedicated Merchant App surface.
    // KDS is held/future and must not become an active login destination.
    if (isBranchManager()) {
      window.location.replace('/merchant/' + window.location.hash);
      return;
    }

    var isPlatform = isPlatformContext();

    if (isPlatform) {
      // -------------------------------------------------------------
      // PLATFORM DASHBOARD SHELL INITIALIZATION (xentra.cloud)
      // -------------------------------------------------------------
      // Set platform sidebar brand and badge
      var brandTitle = $('dash-brand-title');
      if (brandTitle) brandTitle.textContent = 'XENTRA PLATFORM';
      var brandLogo = $('dash-sidebar-logo');
      if (brandLogo) brandLogo.src = '/assets/img/xentra-logo.png';
      var badgePro = document.querySelector('.x-dash-badge-pro');
      if (badgePro) badgePro.textContent = 'Platform Control Plane';

      // Topbar adjustments for platform
      var topbarBrandName = $('topbar-brand-name');
      if (topbarBrandName) topbarBrandName.textContent = 'Xentra Cloud Platform';
      var branchSelector = $('x-branch-selector');
      if (branchSelector) branchSelector.style.display = 'none';

      // Hide view store footer button in platform sidebar
      var viewStoreBtn = document.querySelector('.x-btn-view-store');
      if (viewStoreBtn) viewStoreBtn.style.display = 'none';

      // Render platform navigation menu items
      renderPlatformNavigation();

      // Check platform session/auth
      var isAuth = checkAuth();
      if (isAuth) {
        validateServerSession().then(function (isValid) {
          if (!isValid) return;
          var storedUser = getStoredUser();
          if (storedUser && storedUser.role !== 'platform_superadmin' && storedUser.brand_id) {
            fetch(API_BASE + '/auth/handoff/create', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify({ brand_id: storedUser.brand_id })
            }).then(function (res) {
              return res.json();
            }).then(function (data) {
              if (data && data.success && data.redirect_url) {
                window.location.replace(data.redirect_url);
              }
            }).catch(function () {});
          }
        });
      }

      // Establish the initial platform/Owner route as the root app entry.
      ensureOwnerNavigationHistory();

    } else {
      // -------------------------------------------------------------
      // CLIENT OWNER DASHBOARD SHELL INITIALIZATION (<client-domain>)
      // -------------------------------------------------------------
      // Apply role-based UI before data load
      var isAuth = checkAuth();
      applyRoleBasedUI();
      validateServerSession().then(function (isValid) {
        if (!isValid) return;
        // Owner Dashboard has one canonical role landing: /owner/.
        // /dashboard/ remains a legacy/compatibility route, not the Owner landing URL.
        // Semua jalur yang melayani permukaan ini harus ada di daftar — kalau tidak,
        // penjaganya mengalihkan ke jalur yang ia sendiri tolak dan halaman berputar.
        enforceSurface(['/owner/', '/owner', '/dashboard/', '/dashboard']);
      }).catch(function () {});

      // Establish the initial Owner route as the root app entry.
      ensureOwnerNavigationHistory();

      // Initial data fetch if authenticated
      loadBrandSettings();
      initReportsControls();
      initOwnerStockControls();
      if (isAuth) {
        loadCatalog();
        // Load branches and populate branch context selector
        loadBranches().then(function () {
          populateBranchSelector(state.branches || []);
        }).catch(function () {});
      }
    }

    // Standardize all filter selects into floating dropdown templates
    initOwnerFloatingDropdowns();

    // Owner Notification Center wiring
    initOwnerNotifications();

    // Owner Mobile Pull-To-Refresh wiring
    initOwnerPullToRefresh();

    if (window.Xentra && typeof window.Xentra.hideSplash === 'function') {
      window.Xentra.hideSplash();
    }
  }

  /* =========================================================================
     STANDARDIZED FLOATING DROPDOWN (Delegated to /merchant-shared/js/dropdown.js)
     ========================================================================= */
  function initOwnerFloatingDropdowns() {
    var enhanceFn = window.createFloatingDropdown || (window.XentraDropdown && window.XentraDropdown.enhance);
    if (typeof enhanceFn !== 'function') return;
    var targets = [
      'branch-filter-status',
      'mkt-banners-branch-filter'
    ];

    targets.forEach(function (id) {
      var sel = $(id);
      if (sel) enhanceFn(sel);
    });
  }

  /* =========================================================================
     OWNER NOTIFICATIONS CENTER (Bell Icon Wiring)
     ========================================================================= */
  async function openOwnerNotificationsSheet() {
    var sheet = $('sheet-notifications');
    if (!sheet) return;
    sheet.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    await loadOwnerNotificationsList();
  }
  window.openOwnerNotificationsSheet = openOwnerNotificationsSheet;

  function closeOwnerNotificationsSheet() {
    var sheet = $('sheet-notifications');
    if (!sheet) return;
    sheet.style.display = 'none';
    document.body.style.overflow = '';
  }
  window.closeOwnerNotificationsSheet = closeOwnerNotificationsSheet;

  async function loadOwnerNotificationsList() {
    var container = $('notif-list-container');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:28px 16px;color:#64748b;font-size:13px;">Memuat notifikasi...</div>';

    try {
      var res = await adminFetch(API_BASE + '/notifications?limit=30', { headers: getAuthHeaders() });
      var data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal memuat notifikasi');
      }

      var items = data.notifications || [];
      if (!items.length) {
        container.innerHTML = '<div style="text-align:center;padding:32px 16px;color:#64748b;font-size:13px;">Tidak ada notifikasi saat ini.</div>';
        updateOwnerNotificationBadge(0);
        return;
      }

      updateOwnerNotificationBadge(data.unread_count || 0);

      var html = '';
      items.forEach(function (n) {
        var isUnread = !n.read_at;
        var icon = n.source_type === 'CASH_ADVANCE_REQUEST' ? '💵' : (n.source_type === 'order' ? '🛒' : '🔔');
        var timeStr = n.created_at ? new Date(n.created_at).toLocaleDateString('id-ID', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : '';
        
        var actionBtn = '';
        if (n.action_url) {
          actionBtn = '<div style="margin-top:6px;"><button type="button" class="x-btn-secondary" style="font-size:11px; font-weight:700; padding:4px 10px; border-radius:6px; color:#2563eb; background:#eff6ff; border:1px solid #bfdbfe; cursor:pointer;">Buka Pengaturan & Setujui ↗</button></div>';
        }

        html += '<div onclick="handleOwnerNotificationClick(\'' + esc(n.id) + '\', \'' + esc(n.action_url || '') + '\')" style="cursor:pointer; display:flex; gap:10px; padding:12px; border-radius:10px; background:' + (isUnread ? '#f0f9ff' : '#ffffff') + '; border:1px solid ' + (isUnread ? '#bae6fd' : '#f1f5f9') + '; margin-bottom:8px; transition:all 0.15s ease;">';
        html += '<div style="font-size:20px; line-height:1; flex-shrink:0; padding-top:2px;">' + icon + '</div>';
        html += '<div style="flex:1; min-width:0;">';
        html += '<div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:2px;">';
        html += '<strong style="font-size:13px; color:#0f172a; font-weight:700;">' + esc(n.title) + '</strong>';
        html += '<span style="font-size:10.5px; color:#94a3b8; margin-left:6px; flex-shrink:0;">' + esc(timeStr) + '</span>';
        html += '</div>';
        html += '<p style="margin:0; font-size:12px; color:#475569; line-height:1.45;">' + esc(n.body) + '</p>';
        html += actionBtn;
        html += '</div>';
        if (isUnread) {
          html += '<div style="width:7px; height:7px; border-radius:50%; background:#0284c7; flex-shrink:0; margin-top:6px;"></div>';
        }
        html += '</div>';
      });

      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = '<div style="text-align:center;padding:28px 16px;color:#ef4444;font-size:13px;">Error: ' + esc(err.message) + '</div>';
    }
  }

  async function handleOwnerNotificationClick(id, actionUrl) {
    try {
      await adminFetch(API_BASE + '/notifications/' + encodeURIComponent(id) + '/read', { method: 'POST', headers: getAuthHeaders() });
      fetchOwnerUnreadNotificationCount();
    } catch (_) {}

    closeOwnerNotificationsSheet();

    if (actionUrl) {
      if (actionUrl.startsWith('#')) {
        window.location.hash = actionUrl;
      } else {
        window.location.href = actionUrl;
      }
    }
  }
  window.handleOwnerNotificationClick = handleOwnerNotificationClick;

  async function markAllOwnerNotificationsAsRead() {
    try {
      await adminFetch(API_BASE + '/notifications/read-all', { method: 'POST', headers: getAuthHeaders() });
      if (typeof showToast === 'function') showToast('Semua notifikasi telah ditandai dibaca.');
      loadOwnerNotificationsList();
      fetchOwnerUnreadNotificationCount();
    } catch (err) {
      if (typeof showToast === 'function') showToast('Gagal menandai notifikasi: ' + err.message);
    }
  }
  window.markAllOwnerNotificationsAsRead = markAllOwnerNotificationsAsRead;

  async function fetchOwnerUnreadNotificationCount() {
    try {
      var res = await adminFetch(API_BASE + '/notifications/unread-count', { headers: getAuthHeaders() });
      var data = await res.json();
      if (res.ok && data.success) {
        updateOwnerNotificationBadge(data.unread_count || 0);
      }
    } catch (_) {}
  }

  function updateOwnerNotificationBadge(count) {
    var btn = $('btn-notifications');
    var pill = $('notif-unread-pill');
    if (pill) {
      if (count > 0) {
        pill.textContent = count + ' Baru';
        pill.style.display = 'inline-block';
      } else {
        pill.style.display = 'none';
      }
    }
    if (btn) {
      var badge = btn.querySelector('.x-notif-badge');
      if (count > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'x-notif-badge';
          badge.style.cssText = 'position:absolute; top:-2px; right:-2px; background:#ef4444; color:#fff; font-size:10px; font-weight:800; border-radius:10px; padding:1px 5px; min-width:16px; text-align:center; border:2px solid #fff; line-height:1.2;';
          btn.style.position = 'relative';
          btn.appendChild(badge);
        }
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = 'inline-block';
      } else if (badge) {
        badge.style.display = 'none';
      }
    }
  }

  function initOwnerNotifications() {
    var btn = $('btn-notifications');
    if (btn) {
      btn.onclick = openOwnerNotificationsSheet;
    }
    fetchOwnerUnreadNotificationCount();
    setInterval(fetchOwnerUnreadNotificationCount, 15000);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MOBILE PULL-TO-REFRESH CONTROLLER
  // ─────────────────────────────────────────────────────────────────────────
  function initOwnerPullToRefresh() {
    if (window._ownerPullToRefreshInitialized) return;
    window._ownerPullToRefreshInitialized = true;

    var indicator = document.getElementById('x-pull-to-refresh');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'x-pull-to-refresh';
      indicator.className = 'x-pull-refresh-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      indicator.innerHTML =
        '<div class="x-pull-refresh-spinner">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<polyline points="23 4 23 10 17 10"></polyline>' +
            '<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>' +
          '</svg>' +
        '</div>';
      document.body.appendChild(indicator);
    }

    var spinner = indicator.querySelector('.x-pull-refresh-spinner');
    var startY = 0;
    var currentY = 0;
    var isPulling = false;
    var isRefreshing = false;

    function isEditorOrModalOpen() {
      var active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
        return true;
      }
      var protectedIds = [
        'product-editor-view',
        'category-editor-view',
        'master-menu-editor-view',
        'branch-editor-view',
        'modal-item-saved-prompt',
        'modal-add-supplier',
        'modal-owner-notifications-sheet'
      ];
      for (var i = 0; i < protectedIds.length; i++) {
        var el = document.getElementById(protectedIds[i]);
        if (el && el.style.display && el.style.display !== 'none') {
          return true;
        }
      }
      var openModals = document.querySelectorAll('.x-modal-backdrop, .x-modal');
      for (var j = 0; j < openModals.length; j++) {
        var m = openModals[j];
        if (m && m.style.display && m.style.display !== 'none') {
          return true;
        }
      }
      return false;
    }

    function getScrollTop() {
      return window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }

    window.addEventListener('touchstart', function (e) {
      if (isRefreshing) return;
      if (window.innerWidth > 820) return;
      if (getScrollTop() > 5) return;
      if (isEditorOrModalOpen()) return;
      if (!e.touches || e.touches.length !== 1) return;

      startY = e.touches[0].clientY;
      currentY = startY;
      isPulling = true;
    }, { passive: true });

    window.addEventListener('touchmove', function (e) {
      if (!isPulling || isRefreshing) return;
      if (isEditorOrModalOpen()) {
        isPulling = false;
        resetIndicator();
        return;
      }

      currentY = e.touches[0].clientY;
      var deltaY = currentY - startY;

      if (deltaY <= 0 || getScrollTop() > 5) {
        if (deltaY < -10) {
          isPulling = false;
          resetIndicator();
        }
        return;
      }

      var pullDistance = Math.min(deltaY * 0.42, 70);
      if (pullDistance > 10) {
        var progress = Math.min(pullDistance / 50, 1);
        indicator.style.transition = 'none';
        indicator.style.opacity = String(progress);
        indicator.style.transform = 'translate(-50%, ' + (pullDistance - 50) + 'px)';
        if (spinner) {
          spinner.style.transform = 'rotate(' + (pullDistance * 4.5) + 'deg)';
          spinner.style.color = pullDistance >= 48 ? '#00A637' : '#0F172A';
        }
      }
    }, { passive: true });

    window.addEventListener('touchend', async function () {
      if (!isPulling || isRefreshing) return;
      isPulling = false;

      var deltaY = currentY - startY;
      var pullDistance = Math.min(deltaY * 0.42, 70);

      if (pullDistance >= 48 && !isEditorOrModalOpen()) {
        isRefreshing = true;
        indicator.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease';
        indicator.classList.add('refreshing');

        var startTime = Date.now();
        await triggerOwnerRefresh();
        var elapsed = Date.now() - startTime;
        var minWait = Math.max(0, 500 - elapsed);

        setTimeout(function () {
          indicator.classList.remove('refreshing');
          resetIndicator();
          setTimeout(function () {
            isRefreshing = false;
          }, 250);
        }, minWait);
      } else {
        resetIndicator();
      }
    }, { passive: true });

    function resetIndicator() {
      indicator.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease';
      indicator.style.transform = 'translate(-50%, -60px)';
      indicator.style.opacity = '0';
      if (spinner) {
        spinner.style.transform = 'rotate(0deg)';
        spinner.style.color = '#0F172A';
      }
    }
  }

  async function triggerOwnerRefresh() {
    var route = (window.location.hash || '').replace(/^#\/?/, '') || 'overview';
    try {
      if (typeof loadBranchSelectorContext === 'function') {
        loadBranchSelectorContext();
      }
      if (route === 'overview' || route === '') {
        if (typeof loadOverview === 'function') await loadOverview();
        if (typeof renderOwnerCommandCenter === 'function') renderOwnerCommandCenter();
      } else if (route === 'catalog/products') {
        if (typeof loadMasterProducts === 'function') await loadMasterProducts();
      } else if (route.indexOf('catalog/categories') === 0) {
        if (typeof window.loadMasterCategoriesPage === 'function') await window.loadMasterCategoriesPage();
      } else if (route.indexOf('catalog/master-menus') === 0) {
        if (typeof window.loadOwnerMasterMenus === 'function') await window.loadOwnerMasterMenus();
      } else if (route === 'orders') {
        if (typeof loadOrders === 'function') await loadOrders();
      } else if (route === 'stock') {
        if (typeof loadOwnerStockOverview === 'function') await loadOwnerStockOverview();
      } else if (route === 'customers') {
        if (typeof loadCustomers === 'function') await loadCustomers();
      } else if (route === 'branches') {
        if (typeof loadBranches === 'function') await loadBranches();
      } else if (route.indexOf('finance') === 0) {
        if (typeof loadFinanceOverview === 'function') await loadFinanceOverview();
      } else if (typeof applyRoute === 'function') {
        applyRoute(route);
      }
      if (typeof fetchOwnerUnreadNotificationCount === 'function') {
        fetchOwnerUnreadNotificationCount();
      }
      if (typeof showToast === 'function') {
        showToast('✅ Data diperbarui');
      }
    } catch (err) {
      console.warn('[PullToRefresh] Error executing refresh:', err);
    }
  }

  window.initOwnerPullToRefresh = initOwnerPullToRefresh;
  window.triggerOwnerRefresh = triggerOwnerRefresh;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDashboard);
  } else {
    initializeDashboard();
  }

})();

