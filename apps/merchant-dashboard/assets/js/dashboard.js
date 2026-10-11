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

  var state = {
    brand: null,
    categories: [],
    products: [],
    branches: [],
    orders: [],
    activeCategoryFilter: 'all'
  };

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
    'settings/integrations':       { title: 'Integrations',      sub: 'Modul integrasi payment gateway, POS, dan Xentra ecosystem', tab: 'settings' },
    'settings/notifications':      { title: 'Notifications',     sub: 'Preferensi notifikasi multi-channel WhatsApp, Email & Push', tab: 'settings' },
    'settings/security':           { title: 'Security & RBAC',   sub: 'Model otorisasi, sesi pengguna, dan jejak audit keamanan', tab: 'settings' },
    'settings/data-refresh':       { title: 'Data Aplikasi',     sub: 'Segarkan cache dan sinkronisasi data aplikasi dari server', tab: 'settings' },
    // Owner mobile modules & hubs
    'business':                    { title: 'Bisnis',            sub: 'Pusat pengelolaan katalog, operasional, pelanggan, pemasaran, tim, dan brand', tab: 'business' },
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

  // Parse the active route from the current URL hash
  function getCurrentRoute() {
    var hash = window.location.hash.replace(/^#\/?/, '').trim();
    var meta = getActiveRouteMeta();

    if (!hash) return 'overview';

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

    if (current === 'catalog/products/new' ||
        /^catalog\/products\/[^/]+\/edit$/.test(current) ||
        /^catalog\/products\/[^/]+$/.test(current)) {
      return 'catalog/products';
    }

    if (current === 'catalog/master-menus/new' ||
        /^catalog\/master-menus\/[^/]+\/edit$/.test(current)) {
      return 'catalog/master-menus';
    }

    if (current === 'catalog/categories/new' ||
        /^catalog\/categories\/[^/]+\/edit$/.test(current)) {
      return 'catalog/categories';
    }

    if (current === 'catalog/products' ||
        current === 'catalog/categories' ||
        current === 'catalog/master-menus' ||
        current === 'catalog/menus') {
      return 'business';
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

    if (current === 'stock') return 'business';

    if (current === 'team') return 'business';
    if (current.indexOf('team/') === 0) return 'team';

    if (current === 'reports') return 'business';
    if (current.indexOf('reports/') === 0) return 'reports';

    if (current === 'finance/overview') return null;
    if (current === 'finance') return 'business';
    if (current.indexOf('finance/') === 0) return 'finance/overview';

    if (current === 'marketing/promotions') return 'business';
    if (current.indexOf('marketing/') === 0) return 'marketing/promotions';

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

  // Editor item dibuka dari konteks Master Category, jadi kembalinya harus
  // deterministik ke sana dengan tab Item aktif — bukan menuruni history stack
  // (yang bisa mendarat di daftar Produk atau halaman lain).
  window.setMasterReferenceTab = setMasterReferenceTab;
  window.goBackFromItemEditor = function () {
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

  // Editor item dibuka dari konteks Master Category, jadi kembalinya harus
  // deterministik ke sana dengan tab Item aktif — bukan menuruni history stack
  // (yang bisa mendarat di daftar Produk atau halaman lain).
  window.setMasterReferenceTab = setMasterReferenceTab;
  window.goBackFromItemEditor = function () {
    setMasterReferenceTab('item');
    navigateTo('catalog/categories', { history: 'replace' });
  };
  window.goBackFromCategoryEditor = function () {
    setMasterReferenceTab('category');
    navigateTo('catalog/categories', { history: 'replace' });
  };

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

    var isCategoryEditor = !isPlatform && (
      route === 'catalog/categories/new' ||
      /^catalog\/categories\/[^/]+\/edit$/.test(route)
    );
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

    var metaKey = isCategoryEditor
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
        var isActiveSub = targetRoute === route || (isProductDetail && targetRoute === 'catalog/products') || (isMasterMenuEditor && targetRoute === 'catalog/master-menus') || (isCategoryEditor && targetRoute === 'catalog/categories');
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
    if (isMarketingEditor) {
      document.querySelectorAll('.x-marketing-subview').forEach(function (view) { view.style.display = 'none'; });
      var promoPage = $('marketing-promotion-editor-view');
      var bannerPage = $('marketing-banner-editor-view');
      if (promoPage) promoPage.style.display = marketingEditorType === 'promotion' ? 'block' : 'none';
      if (bannerPage) bannerPage.style.display = marketingEditorType === 'banner' ? 'block' : 'none';
    } else {
      var promoPage2 = $('marketing-promotion-editor-view');
      var bannerPage2 = $('marketing-banner-editor-view');
      if (promoPage2) promoPage2.style.display = 'none';
      if (bannerPage2) bannerPage2.style.display = 'none';
    }

    // 5. Update topbar title
    var titleEl = $('dash-page-title');
    var subEl = $('dash-page-subtitle');
    if (titleEl) titleEl.textContent = isMasterMenuEditor
      ? (masterMenuEditorId ? 'Edit Menu Master' : 'Tambah Menu Master')
      : (isCategoryEditor
        ? (categoryEditorId ? 'Edit Kategori' : 'Tambah Kategori')
        : (isProductEditor
          ? (productEditorId ? 'Edit Item' : 'Tambah Item')
          : (isBranchEditor ? (branchEditorId ? 'Edit Cabang' : 'Tambah Cabang') : (isProductDetail ? 'Product Detail' : (isBranchDetail ? 'Branch Detail' : (isOrderDetail ? 'Order Detail' : (isCustomerDetail ? 'Customer Detail' : (isReportsRoute ? 'Reports' : meta.title))))))));
    if (subEl) subEl.textContent = isMasterMenuEditor
      ? 'Susun menu komersial brand yang dijual ke pelanggan'
      : (isCategoryEditor
        ? 'Pengelompokan utama menu komersial di storefront'
        : (isProductEditor
          ? 'Kelola Product atomic, SKU, media, dan status inventory'
          : (isBranchEditor ? 'Kelola identitas, lokasi, kontak, dan aturan operasional cabang' : (isProductDetail ? 'Detail produk master dan status adopsi di cabang' : (isBranchDetail ? 'Detail informasi, operasional, menu, dan tim cabang' : (isOrderDetail ? 'Detail transaksi, rincian biaya, dan status pesanan' : (isCustomerDetail ? 'Profil pelanggan, riwayat pesanan, dan loyalitas' : (isReportsRoute ? 'Laporan penjualan, analitik bisnis, dan kinerja cabang' : meta.sub))))))));

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

    if (tabId === 'overview') loadOverview();
    if (tabId === 'reports') loadReports(reportSubtype);
    if (tabId === 'stock') loadOwnerStockOverview();
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
      switchTeamSection(teamSubtab, false);
      if (teamSubtab === 'invitations') {
        loadInvitations();
      } else {
        loadTim();
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
        showOwnerMasterMenuEditor();
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
  var _branchContextState = {
    selected: 'all',   // 'all' or a branch id string
    branches: []       // loaded branch objects [{id, name}]
  };

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
     ========================================================================= */

  // ── Installed PWA Identity Override — shared upload helper ─────────────────
  // Uploads a launcher icon file directly to the given PWA icon endpoint.
  // This avoids mutating or overwriting the main brand logo.
  async function doUploadPwaLauncherIcon(file, endpoint, previewEl, hiddenEl, removeBtn, pickBtn, cropSpec) {
    if (pickBtn) { pickBtn.disabled = true; pickBtn.textContent = 'Mengunggah...'; }
    // Optimistic preview
    try {
      var previewDataUrl = await new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(new Error('Gagal membaca file.')); };
        reader.readAsDataURL(file);
      });
      if (previewEl) { previewEl.src = previewDataUrl; previewEl.style.display = 'block'; }
    } catch (_) {}

    try {
      var base64 = await new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
        reader.readAsDataURL(file);
      });

      // Upload directly to the specific PWA icon endpoint
      var iconRes = await adminFetch(API_BASE + endpoint, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ image_base64: base64, mime_type: file.type, original_filename: file.name || null, crop_spec: cropSpec || null })
      });
      var iconData = await iconRes.json();
      if (iconRes.ok && iconData.success) {
        var iconUrl = iconData.merchant_pwa_icon_url || iconData.pos_pwa_icon_url || iconData.url || (previewEl ? previewEl.src : '');
        showToast('✅ Icon PWA berhasil diperbarui.');
        if (previewEl && iconUrl) { previewEl.src = iconUrl; previewEl.style.display = 'block'; }
        if (hiddenEl && iconUrl) hiddenEl.value = iconUrl;
        if (removeBtn) removeBtn.style.display = 'inline-block';
        if (typeof window.loadSettingsProfile === 'function') {
          window.loadSettingsProfile();
        }
      } else {
        showToast('❌ ' + (iconData.error || 'Gagal menyimpan icon.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan saat mengunggah icon PWA.');
    } finally {
      if (pickBtn) { pickBtn.disabled = false; pickBtn.textContent = '📁 Unggah'; }
    }
  }

  async function loadBrandSettings() {
    try {
      var res = await adminFetch(API_BASE + '/admin/brand', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data && data.brand) {
        state.brand = data.brand;
        applyBrandToUI(data.brand);
      }
    } catch (e) {
      console.warn('[Dashboard Brand Load Warn]:', e);
    }
  }

  function applyBrandToUI(brand) {
    if (!brand) return;

    $('brand-name').value = brand.name || 'Bangjo Resto';
    $('brand-tagline').value = brand.tagline || 'Official Online Food Ordering';
    var logoUrl = brand.logo_url || '/assets/pwa/icon-192.png';
    $('brand-logo').value = logoUrl;
    if ($('brand-logo-preview')) {
      $('brand-logo-preview').src = logoUrl;
      $('brand-logo-preview').style.display = 'block';
    }
    if ($('brand-logo-empty')) $('brand-logo-empty').style.display = 'none';
    if ($('btn-brand-logo-remove')) $('btn-brand-logo-remove').style.display = (logoUrl && logoUrl !== '/assets/pwa/icon-192.png') ? 'inline-block' : 'none';

    $('brand-color').value = brand.primary_color || '#b6ff00';
    $('brand-color-hex').value = brand.primary_color || '#b6ff00';
    $('brand-domain').value = brand.custom_domain || 'app.mybangjo.com';

    $('dash-brand-title').textContent = brand.name || 'Bangjo Resto';
    $('dash-sidebar-logo').src = logoUrl;
    if ($('topbar-brand-name')) $('topbar-brand-name').textContent = brand.name || 'Bangjo Resto';
    var user = getStoredUser();
    if (user && user.role === 'branch_manager' && $('topbar-brand-badge')) {
      $('topbar-brand-badge').style.display = 'none';
    }

    if ($('set-profile-name')) $('set-profile-name').value = brand.name || '';
    if ($('set-profile-tagline')) $('set-profile-tagline').value = brand.tagline || '';
    if ($('set-profile-logo')) $('set-profile-logo').value = logoUrl;
    if ($('set-profile-logo-preview')) {
      $('set-profile-logo-preview').src = logoUrl;
      $('set-profile-logo-preview').style.display = 'block';
    }
    if ($('set-profile-logo-empty')) $('set-profile-logo-empty').style.display = 'none';
    if ($('btn-set-profile-logo-remove')) $('btn-set-profile-logo-remove').style.display = (logoUrl && logoUrl !== '/assets/pwa/icon-192.png') ? 'inline-block' : 'none';
    if ($('btn-set-profile-logo-pick')) $('btn-set-profile-logo-pick').textContent = (logoUrl && logoUrl !== '/assets/pwa/icon-192.png') ? '📁 Ganti Logo' : '📁 Unggah Logo';
    if ($('set-profile-color')) $('set-profile-color').value = brand.primary_color || '#b6ff00';
    if ($('set-profile-color-hex')) $('set-profile-color-hex').value = brand.primary_color || '#b6ff00';
    if ($('set-profile-domain')) $('set-profile-domain').textContent = brand.custom_domain || window.location.host || '-';

    // Installed PWA Identity Override — populate launcher icon previews
    var merchantIconUrl = brand.merchant_pwa_icon_url || null;
    var posIconUrl = brand.pos_pwa_icon_url || null;
    var defaultMerchantIcon = '/merchant-app/assets/icons/icon-192.png';
    var defaultPosIcon = '/assets/pwa/icon-192.png';

    if ($('brand-tab-merchant-icon')) $('brand-tab-merchant-icon').value = merchantIconUrl || '';
    if ($('brand-tab-merchant-icon-preview')) {
      $('brand-tab-merchant-icon-preview').src = merchantIconUrl || defaultMerchantIcon;
      $('brand-tab-merchant-icon-preview').style.display = 'block';
    }
    if ($('brand-tab-merchant-icon-empty')) $('brand-tab-merchant-icon-empty').style.display = 'none';
    if ($('btn-brand-tab-merchant-icon-remove')) $('btn-brand-tab-merchant-icon-remove').style.display = merchantIconUrl ? 'inline-block' : 'none';

    if ($('brand-tab-pos-icon')) $('brand-tab-pos-icon').value = posIconUrl || '';
    if ($('brand-tab-pos-icon-preview')) {
      $('brand-tab-pos-icon-preview').src = posIconUrl || defaultPosIcon;
      $('brand-tab-pos-icon-preview').style.display = 'block';
    }
    if ($('brand-tab-pos-icon-empty')) $('brand-tab-pos-icon-empty').style.display = 'none';
    if ($('btn-brand-tab-pos-icon-remove')) $('btn-brand-tab-pos-icon-remove').style.display = posIconUrl ? 'inline-block' : 'none';

    if ($('set-profile-merchant-icon')) $('set-profile-merchant-icon').value = merchantIconUrl || '';
    if ($('set-profile-merchant-icon-preview')) {
      $('set-profile-merchant-icon-preview').src = merchantIconUrl || defaultMerchantIcon;
      $('set-profile-merchant-icon-preview').style.display = 'block';
    }
    if ($('set-profile-merchant-icon-empty')) $('set-profile-merchant-icon-empty').style.display = 'none';
    if ($('btn-set-profile-merchant-icon-remove')) $('btn-set-profile-merchant-icon-remove').style.display = merchantIconUrl ? 'inline-block' : 'none';

    if ($('set-profile-pos-icon')) $('set-profile-pos-icon').value = posIconUrl || '';
    if ($('set-profile-pos-icon-preview')) {
      $('set-profile-pos-icon-preview').src = posIconUrl || defaultPosIcon;
      $('set-profile-pos-icon-preview').style.display = 'block';
    }
    if ($('set-profile-pos-icon-empty')) $('set-profile-pos-icon-empty').style.display = 'none';
    if ($('btn-set-profile-pos-icon-remove')) $('btn-set-profile-pos-icon-remove').style.display = posIconUrl ? 'inline-block' : 'none';

    // PWA custom name overrides
    var merchantPwaName = brand.merchant_pwa_name || '';
    var posPwaName = brand.pos_pwa_name || '';
    if ($('brand-tab-merchant-pwa-name')) $('brand-tab-merchant-pwa-name').value = merchantPwaName;
    if ($('brand-tab-pos-pwa-name')) $('brand-tab-pos-pwa-name').value = posPwaName;
    if ($('set-profile-merchant-pwa-name')) $('set-profile-merchant-pwa-name').value = merchantPwaName;
    if ($('set-profile-pos-pwa-name')) $('set-profile-pos-pwa-name').value = posPwaName;

    if ($('auth-brand-name')) $('auth-brand-name').textContent = brand.name || 'Bangjo Resto';
    if ($('auth-logo')) $('auth-logo').src = logoUrl;

    // Installed App Identity (PWA Launcher Icon Overrides)
    var merchantIcon = brand.merchant_pwa_icon_url || '';
    if ($('brand-tab-merchant-icon')) $('brand-tab-merchant-icon').value = merchantIcon;
    var defaultMerchantIcon = '/merchant-app/assets/icons/icon-192.png';
    var effectiveMerchantIcon = merchantIcon || logoUrl || defaultMerchantIcon;
    if ($('brand-tab-merchant-icon-preview')) $('brand-tab-merchant-icon-preview').src = effectiveMerchantIcon;
    var hasCustomMerchant = Boolean(merchantIcon);
    if ($('btn-brand-tab-merchant-icon-remove')) $('btn-brand-tab-merchant-icon-remove').style.display = hasCustomMerchant ? 'inline-block' : 'none';
    if ($('btn-brand-tab-merchant-icon-pick')) $('btn-brand-tab-merchant-icon-pick').textContent = hasCustomMerchant ? '📁 Ganti Icon' : '📁 Unggah Icon';

    var posIcon = brand.pos_pwa_icon_url || '';
    if ($('brand-tab-pos-icon')) $('brand-tab-pos-icon').value = posIcon;
    var defaultPosIcon = '/pos/assets/icons/icon-192.png';
    var effectivePosIcon = posIcon || logoUrl || defaultPosIcon;
    if ($('brand-tab-pos-icon-preview')) $('brand-tab-pos-icon-preview').src = effectivePosIcon;
    var hasCustomPos = Boolean(posIcon);
    if ($('btn-brand-tab-pos-icon-remove')) $('btn-brand-tab-pos-icon-remove').style.display = hasCustomPos ? 'inline-block' : 'none';
    if ($('btn-brand-tab-pos-icon-pick')) $('btn-brand-tab-pos-icon-pick').textContent = hasCustomPos ? '📁 Ganti Icon' : '📁 Unggah Icon';

    renderBannersList(brand.banners);
    updateLiveMockupPreview(brand.name, logoUrl, brand.primary_color);
  }

  function updateLiveMockupPreview(name, logo, color) {
    color = color || $('brand-color').value || '#b6ff00';
    logo = logo || $('brand-logo').value || '/assets/pwa/icon-192.png';
    name = name || $('brand-name').value || 'Bangjo Resto';

    $('mock-title').textContent = name;
    $('mock-logo').src = logo;

    document.documentElement.style.setProperty('--primary-color', color);

    var mockPill = $('mock-cat-1');
    if (mockPill) mockPill.style.backgroundColor = color;

    var mockAddBtn = $('mock-btn-tambah');
    if (mockAddBtn) mockAddBtn.style.backgroundColor = color;

    var mockCartBtn = $('mock-cart-btn');
    if (mockCartBtn) mockCartBtn.style.backgroundColor = color;
  }

  // ── Reusable Brand Logo Upload Flow ─────────────────────────────────────────
  // Lifted to module scope so both initBrandListeners and initSettingsProfileListeners
  // can call it without closure dependencies.
  async function doUploadBrandLogo(file, cropSpec, previewDataUrl, triggerBtn) {
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = 'Mengunggah...';
    }

    // Optimistic preview immediately so user sees immediate feedback
    if (previewDataUrl) {
      if ($('brand-logo-preview')) {
        $('brand-logo-preview').src = previewDataUrl;
        $('brand-logo-preview').style.display = 'block';
      }
      if ($('brand-logo-empty')) $('brand-logo-empty').style.display = 'none';
      if ($('set-profile-logo-preview')) {
        $('set-profile-logo-preview').src = previewDataUrl;
        $('set-profile-logo-preview').style.display = 'block';
      }
      if ($('set-profile-logo-empty')) $('set-profile-logo-empty').style.display = 'none';
      if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = previewDataUrl;
      var _nameInput = $('brand-name');
      var _colorPicker = $('brand-color');
      if (_nameInput && _colorPicker) {
        updateLiveMockupPreview(_nameInput.value, previewDataUrl, _colorPicker.value);
      }
    }

    try {
      var base64 = await new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
        reader.readAsDataURL(file);
      });

      var payload = { image_base64: base64, mime_type: file.type };
      if (cropSpec) payload.crop_spec = cropSpec;

      var res = await adminFetch(API_BASE + '/admin/brand/logo', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var data = await res.json();

      if (res.ok && data.success) {
        showToast('✅ Logo brand berhasil diunggah.');
        var logoUrl = data.logo_url;
        var _logoInput = $('brand-logo');
        if (_logoInput) _logoInput.value = logoUrl;
        if ($('brand-logo-preview')) {
          $('brand-logo-preview').src = logoUrl;
          $('brand-logo-preview').style.display = 'block';
        }
        if ($('brand-logo-empty')) $('brand-logo-empty').style.display = 'none';
        if ($('btn-brand-logo-remove')) $('btn-brand-logo-remove').style.display = 'inline-block';
        if ($('btn-brand-logo-pick')) $('btn-brand-logo-pick').textContent = '📁 Ganti Logo';

        if ($('set-profile-logo')) $('set-profile-logo').value = logoUrl;
        if ($('set-profile-logo-preview')) {
          $('set-profile-logo-preview').src = logoUrl;
          $('set-profile-logo-preview').style.display = 'block';
        }
        if ($('set-profile-logo-empty')) $('set-profile-logo-empty').style.display = 'none';
        if ($('btn-set-profile-logo-remove')) $('btn-set-profile-logo-remove').style.display = 'inline-block';
        if ($('btn-set-profile-logo-pick')) $('btn-set-profile-logo-pick').textContent = '📁 Ganti Logo';

        if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = logoUrl;
        var _nameInput2 = $('brand-name');
        var _colorPicker2 = $('brand-color');
        if (_nameInput2 && _colorPicker2) {
          updateLiveMockupPreview(_nameInput2.value, logoUrl, _colorPicker2.value);
        }
        loadBrandSettings();
        if (typeof window.loadSettingsProfile === 'function') {
          window.loadSettingsProfile();
        }
      } else {
        showToast('❌ ' + (data.error || 'Gagal mengunggah logo brand.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan saat mengunggah logo.');
    } finally {
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = '📁 Ganti Logo';
      }
    }
  }

  function initBrandListeners() {
    var colorPicker = $('brand-color');
    var colorHex = $('brand-color-hex');
    var logoInput = $('brand-logo');
    var nameInput = $('brand-name');

    if (colorPicker && colorHex && nameInput && logoInput) {
      colorPicker.addEventListener('input', function () {
        colorHex.value = colorPicker.value;
        updateLiveMockupPreview(nameInput.value, logoInput.value, colorPicker.value);
      });

      colorHex.addEventListener('input', function () {
        if (/^#[0-9A-Fa-f]{6}$/.test(colorHex.value)) {
          colorPicker.value = colorHex.value;
          updateLiveMockupPreview(nameInput.value, logoInput.value, colorHex.value);
        }
      });

      logoInput.addEventListener('input', function () {
        updateLiveMockupPreview(nameInput.value, logoInput.value, colorPicker.value);
      });

      nameInput.addEventListener('input', function () {
        updateLiveMockupPreview(nameInput.value, logoInput.value, colorPicker.value);
      });
    }

    // Swatches
    document.querySelectorAll('.x-swatch').forEach(function (swatch) {
      swatch.addEventListener('click', function () {
        var c = swatch.dataset.color;
        if (colorPicker) colorPicker.value = c;
        if (colorHex) colorHex.value = c;
        if (nameInput && logoInput) {
          updateLiveMockupPreview(nameInput.value, logoInput.value, c);
        }
      });
    });

    // Brand Logo File Picker & Upload
    var btnPickLogo = $('btn-brand-logo-pick');
    var fileInputLogo = $('input-brand-logo-file');
    var btnRemoveLogo = $('btn-brand-logo-remove');

    if (btnPickLogo && fileInputLogo) {
      btnPickLogo.addEventListener('click', function () {
        fileInputLogo.click();
      });

      fileInputLogo.addEventListener('change', async function () {
        var file = fileInputLogo.files && fileInputLogo.files[0];
        if (!file) return;

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format file tidak didukung. Gunakan JPG, PNG, atau WebP.');
          fileInputLogo.value = '';
          return;
        }

        if (file.size > 10 * 1024 * 1024) {
          showToast('❌ Ukuran file melebihi batas 10 MB.');
          fileInputLogo.value = '';
          return;
        }

        // Immediate optimistic preview before crop editor opens
        (function (f) {
          var r = new FileReader();
          r.onload = function (ev) {
            if ($('brand-logo-preview')) { $('brand-logo-preview').src = ev.target.result; $('brand-logo-preview').style.display = 'block'; }
            if ($('brand-logo-empty')) $('brand-logo-empty').style.display = 'none';
            if ($('set-profile-logo-preview')) { $('set-profile-logo-preview').src = ev.target.result; $('set-profile-logo-preview').style.display = 'block'; }
            if ($('set-profile-logo-empty')) $('set-profile-logo-empty').style.display = 'none';
            if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = ev.target.result;
          };
          r.readAsDataURL(f);
        })(file);

        if (!XentraCropEditor || typeof XentraCropEditor.open !== 'function') {
          // Crop editor not available — upload directly
          (function (f) {
            var r = new FileReader();
            r.onload = function (ev) { doUploadBrandLogo(f, null, ev.target.result, btnPickLogo); };
            r.readAsDataURL(f);
          })(file);
          fileInputLogo.value = '';
          return;
        }

        XentraCropEditor.open({
          source: file,
          assetType: 'logo',
          aspectRatio: 1.0,
          title: 'Potong & Posisikan Logo Brand (1:1)',
          onConfirm: async function (cropSpec, previewDataUrl) {
            try {
              await doUploadBrandLogo(file, cropSpec, previewDataUrl, btnPickLogo);
            } finally {
              fileInputLogo.value = '';
            }
          },
          onCancel: function () {
            // Batal = discard this new file. The persisted logo remains unchanged.
            fileInputLogo.value = '';
          }
        });
      });
    }

    if (btnRemoveLogo) {
      btnRemoveLogo.addEventListener('click', async function () {
        if (!await confirmFeatureAction('remove-brand-logo', 'Hapus Logo Brand', 'Hapus logo brand kustom dan kembali ke default?', 'Hapus')) return;
        try {
          var res = await adminFetch(API_BASE + '/admin/brand/logo', {
            method: 'DELETE',
            headers: getAuthHeaders()
          });
          var data = await res.json();
          if (res.ok && data.success) {
            showToast('✅ Logo brand kustom dihapus.');
            var defaultLogo = '/assets/pwa/icon-192.png';
            if (logoInput) logoInput.value = defaultLogo;
            if ($('brand-logo-preview')) {
              $('brand-logo-preview').src = defaultLogo;
              $('brand-logo-preview').style.display = 'block';
            }
            btnRemoveLogo.style.display = 'none';
            if (btnPickLogo) btnPickLogo.textContent = '📁 Unggah Logo';
            if ($('set-profile-logo')) $('set-profile-logo').value = defaultLogo;
            if ($('set-profile-logo-preview')) $('set-profile-logo-preview').src = defaultLogo;
            if ($('btn-set-profile-logo-remove')) $('btn-set-profile-logo-remove').style.display = 'none';
            if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = defaultLogo;
            updateLiveMockupPreview(nameInput.value, defaultLogo, colorPicker.value);
            loadBrandSettings();
            if (typeof window.loadSettingsProfile === 'function') {
              window.loadSettingsProfile();
            }
          } else {
            showToast('❌ Gagal menghapus logo.');
          }
        } catch (err) {
          showToast('❌ Kesalahan jaringan.');
        }
      });
    }

    var btnUseBangjo = $('btn-use-bangjo-logo');
    if (btnUseBangjo) {
      btnUseBangjo.addEventListener('click', function () {
        var defaultLogo = '/assets/pwa/icon-192.png';
        if (logoInput) logoInput.value = defaultLogo;
        if ($('brand-logo-preview')) {
          $('brand-logo-preview').src = defaultLogo;
          $('brand-logo-preview').style.display = 'block';
        }
        if ($('brand-logo-empty')) $('brand-logo-empty').style.display = 'none';
        if (btnRemoveLogo) btnRemoveLogo.style.display = 'none';
        if (btnPickLogo) btnPickLogo.textContent = '📁 Unggah Logo';

        if ($('set-profile-logo')) $('set-profile-logo').value = defaultLogo;
        if ($('set-profile-logo-preview')) {
          $('set-profile-logo-preview').src = defaultLogo;
          $('set-profile-logo-preview').style.display = 'block';
        }
        if ($('btn-set-profile-logo-remove')) $('btn-set-profile-logo-remove').style.display = 'none';
        if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = defaultLogo;

        if (nameInput && logoInput && colorPicker) {
          updateLiveMockupPreview(nameInput.value, defaultLogo, colorPicker.value);
        }
      });
    }

    var formBrand = $('form-brand-settings');
    if (formBrand) {
      formBrand.addEventListener('submit', async function (e) {
        e.preventDefault();
        var btn = $('btn-save-brand');
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Menyimpan...';
        }

      var rawColor = ($('brand-color-hex') && $('brand-color-hex').value.trim()) || ($('brand-color') && $('brand-color').value) || '#b6ff00';
      if (!rawColor.startsWith('#')) rawColor = '#' + rawColor;
      if (/^#[0-9a-fA-F]{3}$/.test(rawColor)) {
        rawColor = '#' + rawColor[1] + rawColor[1] + rawColor[2] + rawColor[2] + rawColor[3] + rawColor[3];
      }
      if (!/^#[0-9a-fA-F]{6}$/.test(rawColor)) {
        showToast('❌ Format warna HEX tidak valid. Gunakan format #RRGGBB (contoh: #FF5500).');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Simpan Pengaturan Brand';
        }
        return;
      }
      rawColor = rawColor.toUpperCase();

      var payload = {
        name: $('brand-name').value,
        tagline: $('brand-tagline').value,
        logo_url: $('brand-logo').value,
        merchant_pwa_icon_url: $('brand-tab-merchant-icon') ? $('brand-tab-merchant-icon').value.trim() : null,
        pos_pwa_icon_url: $('brand-tab-pos-icon') ? $('brand-tab-pos-icon').value.trim() : null,
        merchant_pwa_name: $('brand-tab-merchant-pwa-name') ? $('brand-tab-merchant-pwa-name').value.trim() : undefined,
        pos_pwa_name: $('brand-tab-pos-pwa-name') ? $('brand-tab-pos-pwa-name').value.trim() : undefined,
        primary_color: rawColor,
        custom_domain: $('brand-domain').value
      };

      try {
        var res = await adminFetch(API_BASE + '/admin/brand', {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (data.success) {
          showToast('✅ Brand dan tema berhasil disimpan!');
          applyBrandToUI(data.brand);
          if (typeof window.loadSettingsProfile === 'function') {
            window.loadSettingsProfile();
          }
        } else {
          showToast('❌ Gagal menyimpan: ' + data.error);
        }
      } catch (err) {
        showToast('❌ Terjadi kesalahan jaringan.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Simpan Pengaturan Brand';
      }
      });
    }

    // Brand Tab PWA Launcher Icon Listeners
    var btnPickBrandTabMerchant = $('btn-brand-tab-merchant-icon-pick');
    var fileInputBrandTabMerchant = $('input-brand-tab-merchant-icon-file');
    var btnRemoveBrandTabMerchant = $('btn-brand-tab-merchant-icon-remove');

    if (btnPickBrandTabMerchant && fileInputBrandTabMerchant) {
      btnPickBrandTabMerchant.addEventListener('click', function () { fileInputBrandTabMerchant.click(); });
      fileInputBrandTabMerchant.addEventListener('change', async function () {
        var file = fileInputBrandTabMerchant.files && fileInputBrandTabMerchant.files[0];
        if (!file) return;

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format file tidak didukung. Gunakan JPG, PNG, atau WebP.');
          fileInputBrandTabMerchant.value = '';
          return;
        }
        if (file.size > 10 * 1024 * 1024) {
          showToast('❌ Ukuran file melebihi batas 10 MB.');
          fileInputBrandTabMerchant.value = '';
          return;
        }

        // Immediate optimistic preview
        (function (f) {
          var r = new FileReader();
          r.onload = function (ev) {
            if ($('brand-tab-merchant-icon-preview')) { $('brand-tab-merchant-icon-preview').src = ev.target.result; $('brand-tab-merchant-icon-preview').style.display = 'block'; }
            if ($('set-profile-merchant-icon-preview')) { $('set-profile-merchant-icon-preview').src = ev.target.result; $('set-profile-merchant-icon-preview').style.display = 'block'; }
          };
          r.readAsDataURL(f);
        })(file);

        if (!XentraCropEditor || typeof XentraCropEditor.open !== 'function') {
          doUploadPwaLauncherIcon(file, '/admin/brand/merchant-icon',
            $('brand-tab-merchant-icon-preview'), $('brand-tab-merchant-icon'),
            btnRemoveBrandTabMerchant, btnPickBrandTabMerchant);
          fileInputBrandTabMerchant.value = '';
          return;
        }

        XentraCropEditor.open({
          source: file,
          assetType: 'logo',
          aspectRatio: 1.0,
          title: 'Potong Icon Merchant/Owner PWA (1:1)',
          onConfirm: async function (cropSpec, previewDataUrl) {
            try {
              if ($('brand-tab-merchant-icon-preview') && previewDataUrl) { $('brand-tab-merchant-icon-preview').src = previewDataUrl; }
              if ($('set-profile-merchant-icon-preview') && previewDataUrl) { $('set-profile-merchant-icon-preview').src = previewDataUrl; }
              await doUploadPwaLauncherIcon(file, '/admin/brand/merchant-icon',
                $('brand-tab-merchant-icon-preview'), $('brand-tab-merchant-icon'),
                btnRemoveBrandTabMerchant, btnPickBrandTabMerchant, cropSpec);
              loadBrandSettings();
            } finally {
              fileInputBrandTabMerchant.value = '';
            }
          },
          onCancel: function () {
            // User cancelled crop — restore previous preview, do NOT upload
            fileInputBrandTabMerchant.value = '';
          }
        });
      });
    }

    if (btnRemoveBrandTabMerchant) {
      btnRemoveBrandTabMerchant.addEventListener('click', async function () {
        if (!await confirmFeatureAction('remove-merchant-pwa-icon', 'Hapus Icon Merchant/Owner PWA', 'Hapus icon kustom Merchant/Owner PWA dan kembali ke default?', 'Hapus')) return;
        try {
          var res = await adminFetch(API_BASE + '/admin/brand/merchant-icon', {
            method: 'DELETE',
            headers: getAuthHeaders()
          });
          var data = await res.json();
          if (res.ok && data.success) {
            showToast('✅ Icon kustom Merchant/Owner PWA dihapus.');
            loadBrandSettings();
            if (typeof window.loadSettingsProfile === 'function') window.loadSettingsProfile();
          } else {
            showToast('❌ Gagal menghapus icon Merchant PWA.');
          }
        } catch (err) {
          showToast('❌ Kesalahan jaringan.');
        }
      });
    }

    var btnPickBrandTabPos = $('btn-brand-tab-pos-icon-pick');
    var fileInputBrandTabPos = $('input-brand-tab-pos-icon-file');
    var btnRemoveBrandTabPos = $('btn-brand-tab-pos-icon-remove');

    if (btnPickBrandTabPos && fileInputBrandTabPos) {
      btnPickBrandTabPos.addEventListener('click', function () { fileInputBrandTabPos.click(); });
      fileInputBrandTabPos.addEventListener('change', async function () {
        var file = fileInputBrandTabPos.files && fileInputBrandTabPos.files[0];
        if (!file) return;

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format file tidak didukung. Gunakan JPG, PNG, atau WebP.');
          fileInputBrandTabPos.value = '';
          return;
        }
        if (file.size > 10 * 1024 * 1024) {
          showToast('❌ Ukuran file melebihi batas 10 MB.');
          fileInputBrandTabPos.value = '';
          return;
        }

        // Immediate optimistic preview
        (function (f) {
          var r = new FileReader();
          r.onload = function (ev) {
            if ($('brand-tab-pos-icon-preview')) { $('brand-tab-pos-icon-preview').src = ev.target.result; $('brand-tab-pos-icon-preview').style.display = 'block'; }
            if ($('set-profile-pos-icon-preview')) { $('set-profile-pos-icon-preview').src = ev.target.result; $('set-profile-pos-icon-preview').style.display = 'block'; }
          };
          r.readAsDataURL(f);
        })(file);

        if (!XentraCropEditor || typeof XentraCropEditor.open !== 'function') {
          doUploadPwaLauncherIcon(file, '/admin/brand/pos-icon',
            $('brand-tab-pos-icon-preview'), $('brand-tab-pos-icon'),
            btnRemoveBrandTabPos, btnPickBrandTabPos);
          fileInputBrandTabPos.value = '';
          return;
        }

        XentraCropEditor.open({
          source: file,
          assetType: 'logo',
          aspectRatio: 1.0,
          title: 'Potong Icon POS PWA (1:1)',
          onConfirm: async function (cropSpec, previewDataUrl) {
            try {
              if ($('brand-tab-pos-icon-preview') && previewDataUrl) { $('brand-tab-pos-icon-preview').src = previewDataUrl; }
              if ($('set-profile-pos-icon-preview') && previewDataUrl) { $('set-profile-pos-icon-preview').src = previewDataUrl; }
              await doUploadPwaLauncherIcon(file, '/admin/brand/pos-icon',
                $('brand-tab-pos-icon-preview'), $('brand-tab-pos-icon'),
                btnRemoveBrandTabPos, btnPickBrandTabPos, cropSpec);
              loadBrandSettings();
            } finally {
              fileInputBrandTabPos.value = '';
            }
          },
          onCancel: function () {
            // User cancelled crop — restore previous preview, do NOT upload
            fileInputBrandTabPos.value = '';
          }
        });
      });
    }

    if (btnRemoveBrandTabPos) {
      btnRemoveBrandTabPos.addEventListener('click', async function () {
        if (!await confirmFeatureAction('remove-pos-pwa-icon', 'Hapus Icon POS PWA', 'Hapus icon kustom POS PWA dan kembali ke default?', 'Hapus')) return;
        try {
          var res = await adminFetch(API_BASE + '/admin/brand/pos-icon', {
            method: 'DELETE',
            headers: getAuthHeaders()
          });
          var data = await res.json();
          if (res.ok && data.success) {
            showToast('✅ Icon kustom POS PWA dihapus.');
            loadBrandSettings();
            if (typeof window.loadSettingsProfile === 'function') window.loadSettingsProfile();
          } else {
            showToast('❌ Gagal menghapus icon POS PWA.');
          }
        } catch (err) {
          showToast('❌ Kesalahan jaringan.');
        }
      });
    }

    // Form Add Banner Carousel (File Upload flow)
    var _bannerUploadFile = null;
    var _bannerCropSpec = null;
    var btnBannerPick = $('btn-banner-pick');
    var fileInputBanner = $('input-banner-file');
    var btnBannerClear = $('btn-banner-clear');
    var bannerPreviewImg = $('banner-upload-preview');
    var bannerEmptyBox = $('banner-upload-empty');

    if (btnBannerPick && fileInputBanner) {
      btnBannerPick.addEventListener('click', function () {
        fileInputBanner.click();
      });

      fileInputBanner.addEventListener('change', function () {
        var file = fileInputBanner.files && fileInputBanner.files[0];
        if (!file) {
          _bannerUploadFile = null;
          _bannerCropSpec = null;
          return;
        }

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format file banner tidak didukung. Gunakan JPG, PNG, atau WebP.');
          fileInputBanner.value = '';
          return;
        }

        if (file.size > 20 * 1024 * 1024) {
          showToast('❌ Ukuran file banner melebihi batas 20 MB.');
          fileInputBanner.value = '';
          return;
        }

        _bannerUploadFile = file;

        // Open reusable Crop Editor (M2) configured for Banner (~1.94:1)
        XentraCropEditor.open({
          source: file,
          assetType: 'banner',
          aspectRatio: 350 / 180,
          title: 'Sesuaikan Posisi Banner (~1.94:1)',
          onConfirm: function (cropSpec, previewDataUrl) {
            _bannerCropSpec = cropSpec;
            if (bannerPreviewImg) {
              bannerPreviewImg.src = previewDataUrl || URL.createObjectURL(file);
              bannerPreviewImg.style.display = 'block';
            }
            if (bannerEmptyBox) bannerEmptyBox.style.display = 'none';
            if (btnBannerClear) btnBannerClear.style.display = 'inline-block';
            if (btnBannerPick) btnBannerPick.textContent = '📁 Ganti File';
            showToast('✓ Potongan banner disesuaikan.');
          },
          onCancel: function () {
            _bannerUploadFile = null;
            _bannerCropSpec = null;
            if (fileInputBanner) fileInputBanner.value = '';
          }
        });
      });
    }

    if (btnBannerClear) {
      btnBannerClear.addEventListener('click', function () {
        _bannerUploadFile = null;
        _bannerCropSpec = null;
        if (fileInputBanner) fileInputBanner.value = '';
        if (bannerPreviewImg) {
          bannerPreviewImg.src = '';
          bannerPreviewImg.style.display = 'none';
        }
        if (bannerEmptyBox) bannerEmptyBox.style.display = 'flex';
        btnBannerClear.style.display = 'none';
        if (btnBannerPick) btnBannerPick.textContent = '📁 Pilih File Banner';
      });
    }

    var formAddBanner = $('form-add-banner');
    if (formAddBanner) {
      formAddBanner.addEventListener('submit', async function (e) {
        e.preventDefault();
        var titleInput = $('input-banner-title');
        var title = titleInput.value.trim();

        if (!_bannerUploadFile) {
          showToast('❌ Silakan pilih file gambar banner terlebih dahulu.');
          return;
        }

        var submitBtn = $('btn-submit-banner');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Mengunggah...'; }

        try {
          var base64 = await new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.onerror = function () { reject(new Error('Gagal membaca file gambar banner.')); };
            reader.readAsDataURL(_bannerUploadFile);
          });

          var bannerPayload = {
            image_base64: base64,
            mime_type: _bannerUploadFile.type,
            title: title
          };
          if (_bannerCropSpec) {
            bannerPayload.crop_spec = _bannerCropSpec;
          }

          var res = await adminFetch(API_BASE + '/admin/banners', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(bannerPayload)
          });
          var data = await res.json();
          if (res.ok && data.success) {
            showToast('✅ Banner carousel berhasil ditambahkan!');
            titleInput.value = '';
            if (btnBannerClear) btnBannerClear.click();
            renderBannersList(data.banners);
          } else {
            showToast('❌ ' + (data.error || 'Gagal menambahkan banner.'));
          }
        } catch (err) {
          showToast('❌ Terjadi kesalahan jaringan saat menambah banner.');
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '＋ Tambah Banner'; }
        }
      });
    }

  }

  function renderBannersList(banners) {
    var container = $('dash-banners-list');
    if (!container) return;
    banners = banners || state.brand?.banners || [];
    if (!Array.isArray(banners)) banners = [];

    if (banners.length === 0) {
      container.innerHTML = '<div style="grid-column:1/-1; color:#94a3b8; font-size:13px; text-align:center; padding:20px 0;">Belum ada banner promo. Tambahkan di atas (Maks. 5 slide).</div>';
      return;
    }

    container.innerHTML = banners.map(function (b, idx) {
      return [
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 2px 6px rgba(0,0,0,0.04);">',
          '<div style="width:100%; aspect-ratio:350/180; background:#e2e8f0; overflow:hidden;">',
            '<img src="' + esc(b.image_url) + '" alt="' + esc(b.title || 'Banner') + '" style="width:100%; height:100%; object-fit:cover; display:block;">',
          '</div>',
          '<div style="padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:8px;">',
            '<div style="min-width:0;">',
              '<strong style="font-size:12px; color:#1e293b; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Slide ' + (idx + 1) + ': ' + esc(b.title || 'Promo Banner') + '</strong>',
            '</div>',
            '<div class="x-item-actions">',
              '<button type="button" class="x-action-menu-trigger" aria-label="Aksi banner ' + esc(b.title || ('Slide ' + (idx + 1))) + '" onclick="XentraActionMenu.open(this, [' +
                '{ label: \'Hapus Banner\', icon: \'🗑️\', destructive: true, onClick: function() { deleteBannerSlide(\'' + esc(b.id) + '\'); } }' +
              '])">',
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
              '</button>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  window.deleteBannerSlide = async function (id) {
    if (!await confirmFeatureAction('delete-banner-slide', 'Hapus Slide Banner', 'Hapus slide banner ini?', 'Hapus')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/banners/' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Banner berhasil dihapus.');
        renderBannersList(data.banners);
      } else {
        showToast('❌ ' + data.error);
      }
    } catch (err) {
      showToast('❌ Gagal menghapus banner.');
    }
  };

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

  var _masterReferenceTab = 'category';
  var _masterReferenceLoadSeq = 0;
  var _masterMenuComponents = { title: [], flavor: [], complement: [], level: [] };
  var _ownerMasterMenuState = { menus: [] };

  function showCategoryEditorSection() {
    if (window.XentraCatalogModule && window.XentraCatalogModule.showCategoryEditorSection) {
      return window.XentraCatalogModule.showCategoryEditorSection();
    }
  }

  function showMasterCategoriesPage() {
    if (window.XentraCatalogModule && window.XentraCatalogModule.showMasterCategoriesPage) {
      return window.XentraCatalogModule.showMasterCategoriesPage();
    }
  }

  function setMasterReferenceTab(type) {
    var allowed = ['category', 'title', 'flavor', 'item'];
    _masterReferenceTab = allowed.indexOf(type) !== -1 ? type : 'category';

    var panels = {
      category: $('master-reference-category-panel'),
      flavor: $('master-reference-flavor-panel'),
      complement: $('master-reference-complement-panel'),
      title: $('master-reference-title-panel'),
      item: $('master-reference-item-panel'),
    };
    Object.keys(panels).forEach(function(key) {
      if (panels[key]) panels[key].hidden = _masterReferenceTab !== key;
    });

    var tabs = $('master-reference-tabs');
    if (tabs) {
      tabs.querySelectorAll('[data-master-reference-tab]').forEach(function(btn) {
        var active = btn.getAttribute('data-master-reference-tab') === _masterReferenceTab;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }

    if (_masterReferenceTab === 'item') {
      renderMasterItemsList();
      if (!(state.products || []).length) loadMasterProducts().then(renderMasterItemsList);
    } else {
      renderMasterReferenceList(_masterReferenceTab);
    }
  }

  async function loadMasterCategoriesPage() {
    if (window.XentraCatalogModule && window.XentraCatalogModule.loadMasterCategoriesPage) {
      return window.XentraCatalogModule.loadMasterCategoriesPage();
    }
    var listEls = {
      category: $('master-categories-page-list'),
      flavor: $('master-flavors-page-list'),
      complement: $('master-complements-page-list'),
      title: $('master-titles-page-list'),
    };
    var requestSeq = ++_masterReferenceLoadSeq;

    Object.keys(listEls).forEach(function(type) {
      if (listEls[type]) {
        listEls[type].innerHTML = '<div class="x-empty-state text-center py-6 text-muted">Memuat ' + (MASTER_REFERENCE_META[type] ? MASTER_REFERENCE_META[type].label.replace('Nama ', '').toLowerCase() : 'data') + '...</div>';
      }
    });

    var headers = getAuthHeaders();
    var menusPromise = adminFetch(API_BASE + '/admin/menus', { headers: headers })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.success) {
          _ownerMasterMenuState.menus = data.menus || [];
        }
      })
      .catch(function(err) {
        console.warn('[Master Category Menus Load Warn]:', err);
      });

    var categoryPromise = adminFetch(API_BASE + '/admin/categories', { headers: headers })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (requestSeq !== _masterReferenceLoadSeq) return;
        if (!data.success) throw new Error(data.error || 'Gagal memuat kategori.');
        state.categories = data.categories || [];
        renderMasterCategoriesPage();
      })
      .catch(function(err) {
        if (requestSeq !== _masterReferenceLoadSeq) return;
        console.error('[Master Category Load Error]:', err);
        if (listEls.category) listEls.category.innerHTML = '<div class="x-empty-state text-center py-8 text-muted">Gagal memuat kategori. Coba lagi.</div>';
      });

    var titlePromise = adminFetch(API_BASE + '/admin/menu-titles', { headers: headers })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (requestSeq !== _masterReferenceLoadSeq) return;
        if (!data.success) throw new Error(data.error || 'Gagal memuat judul.');
        _masterMenuComponents.title = data.titles || [];
        renderMasterReferenceList('title');
      })
      .catch(function(err) {
        if (requestSeq !== _masterReferenceLoadSeq) return;
        console.error('[Master Judul Load Error]:', err);
        if (listEls.title) listEls.title.innerHTML = '<div class="x-empty-state text-center py-8 text-muted">Gagal memuat judul. Coba lagi.</div>';
      });

    var componentPromises = ['flavor', 'complement', 'level'].map(function(type) {
      var loadPromise = type === 'level'
        ? adminFetch(API_BASE + '/admin/menu/components/level/ensure-defaults', {
            method: 'POST',
            headers: headers
          }).then(function(res) {
            return res.json().then(function(data) {
              if (!res.ok || !data.success) throw new Error(data.error || 'Gagal menyiapkan Level.');
              return data;
            });
          })
        : Promise.resolve(null);

      return loadPromise
        .then(function() {
          return adminFetch(API_BASE + '/admin/menu/components/' + type, { headers: headers })
            .then(function(res) { return res.json(); });
        })
        .then(function(data) {
          if (requestSeq !== _masterReferenceLoadSeq) return;
          if (!data.success) throw new Error(data.error || 'Gagal memuat ' + type + '.');
          _masterMenuComponents[type] = data.components || [];
          renderMasterReferenceList(type);
          if (type === 'flavor') renderMasterFlavorsPage();
        })
        .catch(function(err) {
          if (requestSeq !== _masterReferenceLoadSeq) return;
          console.error('[Master ' + type + ' Load Error]:', err);
          if (listEls[type]) listEls[type].innerHTML = '<div class="x-empty-state text-center py-8 text-muted">Gagal memuat data. Coba lagi.</div>';
        });
    });

    await Promise.allSettled([menusPromise, categoryPromise, titlePromise].concat(componentPromises));

    if (requestSeq === _masterReferenceLoadSeq) {
      if (typeof populateProductCategorySelect === 'function') populateProductCategorySelect();
      renderMasterReferenceList(_masterReferenceTab);
      if (typeof renderMasterMenuSelectors === 'function') renderMasterMenuSelectors();
      if (typeof renderMasterMenuCustomerPreview === 'function') renderMasterMenuCustomerPreview();
      setMasterReferenceTab(_masterReferenceTab);
    }
  }

  function referenceStatusBadge(active) {
    return '<span class="x-master-reference-status ' + (active ? 'is-active' : 'is-inactive') + '">' +
      (active ? 'Aktif' : 'Nonaktif') + '</span>';
  }

  function referenceRows(type) {
    if (type === 'category') return state.categories || [];
    if (type === 'item') return state.products || [];
    return _masterMenuComponents[type] || [];
  }

  function referenceTypeLabel(type) {
    if (type === 'title') return 'Judul';
    if (type === 'item') return 'Item';
    return type === 'category' ? 'Kategori' : type === 'flavor' ? 'Rasa' : type === 'complement' ? 'Kelengkapan' : 'Level';
  }

  function renderMasterItemsList() {
    if (window.XentraCatalogModule && window.XentraCatalogModule.renderMasterItemsList) {
      return window.XentraCatalogModule.renderMasterItemsList();
    }
    var list = $('master-items-page-list');
    if (!list) return;

    var rows = state.products || [];
    if (!rows.length) {
      list.innerHTML = '<div class="x-empty-state text-center py-6 text-muted">Belum ada item.</div>';
      return;
    }

    list.innerHTML = rows.map(function(item) {
      var sku = item.sku == null ? '' : String(item.sku).trim();
      var hasSku = !!sku;
      var isActive = item.is_active !== 0 && item.is_active !== null;
      var id = esc(String(item.id));
      var img = item.image_url || item.image || '';
      var costPrice = Number(item.cost_price || 0);

      var iconOrPhotoHtml = img
        ? '<div class="x-master-reference-icon" aria-hidden="true" style="background:#f1f5f9;"><img src="' + esc(img) + '" alt="' + esc(item.name) + '" loading="lazy"></div>'
        : '<div class="x-master-reference-icon x-master-reference-icon-category" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 7h16"></path><path d="M4 12h16"></path><path d="M4 17h10"></path></svg></div>';

      return [
        '<div class="x-master-reference-card x-master-item-card-clickable" tabindex="0" role="button" aria-label="Buka editor item ' + esc(item.name) + '" onclick="if (!event.target.closest(\'.x-toggle, .x-action-menu-trigger, .x-action-menu\')) { openEditProduct(\'' + id + '\'); }" onkeydown="if ((event.key === \'Enter\' || event.key === \' \') && !event.target.closest(\'.x-toggle, .x-action-menu-trigger, .x-action-menu\')) { event.preventDefault(); openEditProduct(\'' + id + '\'); }">',
            '<div class="x-master-reference-card-main">',
              iconOrPhotoHtml,
              '<div class="x-master-reference-copy">',
                '<strong>' + esc(item.name) + '</strong>',
                '<span>' + (hasSku ? esc(sku) : 'non-SKU') + '</span>',
                '<span style="font-size:12px;font-weight:600;color:#0f172a;">' + formatMoney(costPrice) + '</span>',
              '</div>',
            '</div>',
            '<div class="x-master-reference-card-right" style="display:flex;align-items:center;gap:10px;">',
              '<label class="x-toggle' + (isActive ? ' x-toggle-on' : '') + '" title="' + (isActive ? 'Item aktif (klik untuk nonaktifkan)' : 'Item nonaktif (klik untuk aktifkan)') + '" style="margin:0;">',
                '<input type="checkbox" ' + (isActive ? 'checked' : '') + ' onchange="toggleMasterItemActive(\'' + id + '\', this)" aria-label="Status item ' + esc(item.name) + '">',
                '<span class="x-toggle-slider"></span>',
              '</label>',
              '<button type="button" class="x-action-menu-trigger" aria-label="Aksi item ' + esc(item.name) + '" data-master-reference-action="item" data-reference-id="' + id + '">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>' +
              '</button>',
            '</div>',
          '</div>'
      ].join('');
    }).join('');
  }

  window.toggleMasterItemActive = async function(productId, inputEl) {
    if (window.XentraCatalogModule && window.XentraCatalogModule.toggleMasterItemActive) {
      return window.XentraCatalogModule.toggleMasterItemActive(productId, inputEl);
    }
    var nextActive = inputEl && inputEl.checked ? 1 : 0;
    try {
      var res = await adminFetch(API_BASE + '/admin/composed/products/' + encodeURIComponent(productId) + '/status', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: nextActive })
      });
      var data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || data.error || 'Gagal mengubah status item.');

      var rows = state.products || [];
      var index = rows.findIndex(function (item) { return String(item.id) === String(productId); });
      if (index >= 0) { rows[index] = Object.assign({}, rows[index], { is_active: nextActive }); state.products = rows; }

      renderMasterItemsList();
      showToast('✅ Item ' + (nextActive ? 'diaktifkan' : 'dinonaktifkan') + '.');
    } catch (err) {
      renderMasterItemsList();
      showToast('❌ ' + err.message);
    }
  };

  function referenceIconClass(type) {
    return (type === 'category' || type === 'title')
      ? 'x-master-reference-icon-category'
      : type === 'flavor'
        ? 'x-master-reference-icon-flavor'
        : type === 'complement'
          ? 'x-master-reference-icon-complement'
          : 'x-master-reference-icon-level';
  }

  function referenceIconSvg(type) {
    if (type === 'title') return '<path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h9"></path>';
    if (type === 'category') return '<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect>';
    if (type === 'flavor') return '<path d="M5 12h14"></path><path d="M12 5v14"></path><circle cx="12" cy="12" r="9"></circle>';
    if (type === 'complement') return '<path d="M4 7h16"></path><path d="M6 7v12"></path><path d="M18 7v12"></path><path d="M3 19h18"></path><path d="M9 7V4h6v3"></path>';
    return '<path d="M7 4h10"></path><path d="M7 20h10"></path><path d="M9 4v16"></path><path d="M15 4v16"></path><path d="M7 8h8"></path><path d="M7 16h8"></path>';
  }

  function renderMasterReferenceList(type) {
    if (window.XentraCatalogModule && window.XentraCatalogModule.renderMasterReferenceList) {
      return window.XentraCatalogModule.renderMasterReferenceList(type);
    }
    var listMap = {
      category: 'master-categories-page-list',
      flavor: 'master-flavors-page-list',
      complement: 'master-complements-page-list',
      title: 'master-titles-page-list',
      level: 'master-levels-page-list'
    };
    var list = $(listMap[type]);
    if (!list) return;

    var rows = referenceRows(type);
    if (!rows.length) {
      list.innerHTML = '<div class="x-empty-state text-center py-8 text-muted">Belum ada ' + referenceTypeLabel(type).toLowerCase() + '. Tambahkan data pertama.</div>';
      return;
    }
  }

  function renderMasterCategoriesPage() {
    renderMasterReferenceList('category');
  }

  function renderMasterFlavorsPage() {
    renderMasterReferenceList('flavor');
  }

  var MASTER_REFERENCE_META = {
    item: {
      title: 'Tambah Item',
      label: 'Nama Item',
      placeholder: 'Contoh: Ayam Goreng Potong',
      description: 'Unit fisik internal & stok',
      endpoint: function () { return API_BASE + '/admin/products'; },
      deleteEndpoint: function (id) { return API_BASE + '/admin/products/' + encodeURIComponent(id); },
      payload: function (name) { return { name: name }; }
    },
    category: {
      title: 'Tambah Kategori',
      label: 'Nama Kategori',
      placeholder: 'Contoh: Makanan Berat',
      description: 'Grup menu customer; otomatis tampil di Storefront',
      endpoint: function () { return API_BASE + '/admin/categories'; },
      deleteEndpoint: function (id) { return API_BASE + '/admin/categories/' + encodeURIComponent(id); },
      archiveEndpoint: function (id) { return API_BASE + '/admin/categories/' + encodeURIComponent(id) + '/archive'; },
      payload: function (name) { return { name: name }; }
    },
    title: {
      title: 'Tambah Judul',
      label: 'Nama Judul',
      placeholder: 'Contoh: Ayam Geprek',
      description: 'Judul Menu di Customer PWA; wajib dipilih tiap Menu',
      endpoint: function () { return API_BASE + '/admin/menu-titles'; },
      deleteEndpoint: function (id) { return API_BASE + '/admin/menu-titles/' + encodeURIComponent(id); },
      payload: function (name) { return { name: name }; }
    },
    flavor: {
      title: 'Tambah Rasa',
      label: 'Nama Rasa',
      placeholder: 'Contoh: Original',
      description: 'Pilihan rasa pada Item',
      endpoint: function () { return API_BASE + '/admin/menu/components/flavor'; },
      deleteEndpoint: function (id) { return API_BASE + '/admin/menu/components/flavor/' + encodeURIComponent(id); },
      payload: function (name) { return { name: name }; }
    },
    complement: {
      title: 'Tambah Kelengkapan',
      label: 'Nama Kelengkapan',
      placeholder: 'Contoh: Sambal Bawang',
      description: 'Detail Customer; bisa dipilih lebih dari satu',
      endpoint: function () { return API_BASE + '/admin/menu/components/complement'; },
      deleteEndpoint: function (id) { return API_BASE + '/admin/menu/components/complement/' + encodeURIComponent(id); },
      payload: function (name) { return { name: name }; }
    },
    level: {
      title: 'Tambah Level',
      label: 'Nama Level',
      placeholder: 'Contoh: 1 — Tidak Pedas',
      description: 'Indikator Customer; satu Level dipilih pada Item',
      endpoint: function () { return API_BASE + '/admin/menu/components/level'; },
      deleteEndpoint: function (id) { return API_BASE + '/admin/menu/components/level/' + encodeURIComponent(id); },
      payload: function (name) { return { name: name }; }
    }
  };

  function openMasterReferenceQuickAdd(type) {
    if (window.XentraCatalogModule && window.XentraCatalogModule.openMasterReferenceQuickAdd) {
      return window.XentraCatalogModule.openMasterReferenceQuickAdd(type);
    }
  }

  async function loadCategoryEditorPage(categoryId) {
    if (window.XentraCatalogModule && window.XentraCatalogModule.loadCategoryEditorPage) {
      return window.XentraCatalogModule.loadCategoryEditorPage(categoryId);
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
    var btnAddTitlePage = $('btn-add-master-title-page');
    if (btnAddTitlePage && !btnAddTitlePage.dataset.bound) {
      btnAddTitlePage.dataset.bound = 'true';
      btnAddTitlePage.addEventListener('click', function() {
        openMasterReferenceQuickAdd('title');
      });
    }

    var btnAddMasterItemPage = $('btn-add-master-item-page');
    if (btnAddMasterItemPage && !btnAddMasterItemPage.dataset.bound) {
      btnAddMasterItemPage.dataset.bound = 'true';
      btnAddMasterItemPage.addEventListener('click', function() {
        window.openAddProduct();
      });
    }

    var itemEditorView = $('product-editor-view');
    if (itemEditorView) {
      itemEditorView.querySelectorAll('button').forEach(function (btn) {
        var isBackControl = btn.classList.contains('x-title-back-btn') ||
          /Kembali ke Daftar Produk/.test(btn.textContent || '');
        if (!isBackControl || btn.dataset.itemBackBound) return;
        btn.dataset.itemBackBound = 'true';
        if (!btn.classList.contains('x-title-back-btn')) btn.textContent = '← Kembali ke Item';
        // Buang handler inline lama (history stack) supaya tidak jalan dua kali.
        btn.removeAttribute('onclick');
        btn.addEventListener('click', function (event) {
          event.preventDefault();
          if (typeof window.goBackFromItemEditor === 'function') window.goBackFromItemEditor();
        });
      });
    }

    var btnBackFromProductEditor = $('btn-back-from-product-editor');
    if (btnBackFromProductEditor && !btnBackFromProductEditor.dataset.bound) {
      btnBackFromProductEditor.dataset.bound = 'true';
      btnBackFromProductEditor.addEventListener('click', function () {
        goBackFromItemEditor();
      });
    }

    var btnCancelProductEditor = $('btn-cancel-product-editor');
    if (btnCancelProductEditor && !btnCancelProductEditor.dataset.bound) {
      btnCancelProductEditor.dataset.bound = 'true';
      btnCancelProductEditor.addEventListener('click', function () {
        goBackFromItemEditor();
      });
    }

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
     ========================================================================= */
  var _overviewFilter = {
    startDate: '',
    endDate: ''
  };

  function getEffectiveBranchId() {
    return _branchContextState.selected !== 'all' ? _branchContextState.selected : '';
  }

  async function loadOverview() {
    var occHero = $('occ-hero-card');
    var occCenter = $('x-owner-command-center');
    if (occHero) occHero.style.opacity = '0.72';
    if (occCenter) occCenter.setAttribute('aria-busy', 'true');
    try {
      var branchId = getEffectiveBranchId();
      var queryParams = [];
      if (branchId) queryParams.push('branch_id=' + encodeURIComponent(branchId));
      if (_overviewFilter.startDate) queryParams.push('start_date=' + encodeURIComponent(_overviewFilter.startDate));
      if (_overviewFilter.endDate) queryParams.push('end_date=' + encodeURIComponent(_overviewFilter.endDate));

      var url = API_BASE + '/admin/overview' + (queryParams.length > 0 ? '?' + queryParams.join('&') : '');
      var res = await adminFetch(url, { headers: getAuthHeaders() });
      var data = await res.json();

      // Update badge in overview filter
      var branchBadge = $('overview-branch-badge');
      if (branchBadge) {
        var branchName = 'Semua Cabang';
        if (branchId) {
          var found = (_branchContextState.branches || []).find(function (b) { return String(b.id) === String(branchId); });
          if (found) branchName = found.name;
        }
        branchBadge.textContent = branchName;
      }

      if (data.success && data.data) {
        renderOverviewData(data.data);
      } else {
        renderOverviewEmpty();
      }
    } catch (e) {
      console.warn('[Overview Load Error]:', e);
      renderOccError();
    } finally {
      if (occHero) occHero.style.opacity = '1';
      if (occCenter) occCenter.setAttribute('aria-busy', 'false');
    }
  }

  function renderOverviewData(overview) {
    var kpis = overview.kpis || {};
    var salesPerf = overview.sales_performance || {};
    var branchPerf = overview.branch_performance || [];
    var topProducts = overview.top_products || [];
    var needsAttention = overview.needs_attention || {};

    // 1. Primary KPIs
    if ($('stat-net-sales')) $('stat-net-sales').textContent = formatMoney(kpis.net_sales || 0);
    if ($('stat-orders-count')) $('stat-orders-count').textContent = kpis.orders || 0;
    if ($('stat-customers-count')) $('stat-customers-count').textContent = kpis.customers || 0;
    if ($('stat-aov')) $('stat-aov').textContent = formatMoney(kpis.aov || 0);

    // 2. Needs Attention Banner
    var attentionContainer = $('overview-needs-attention-container');
    if (attentionContainer) {
      if (needsAttention.low_stock_items && needsAttention.low_stock_items.length > 0) {
        var alertHtml = '<div class="x-alert-banner">' +
          '<span style="font-size:20px;">⚠️</span>' +
          '<div>' +
            '<strong>Peringatan Stok Menipis:</strong> Ada ' + needsAttention.low_stock_items.length + ' item produk yang stoknya menipis di bawah batas minimum.' +
            ' <a href="#reports/operations" style="font-weight:700;color:#92400e;text-decoration:underline;display:inline-flex;align-items:center;gap:4px;">Lihat Laporan Operasional <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></a>' +
          '</div>' +
        '</div>';
        attentionContainer.innerHTML = alertHtml;
        attentionContainer.style.display = 'block';
      } else {
        attentionContainer.innerHTML = '';
        attentionContainer.style.display = 'none';
      }
    }

    // 3. Sales Performance Breakdown (by channel & fulfillment)
    var salesContainer = $('overview-sales-performance-container');
    if (salesContainer) {
      var channels = salesPerf.by_channel || [];
      var fulfillments = salesPerf.by_fulfillment || [];

      if (channels.length === 0 && fulfillments.length === 0) {
        salesContainer.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">📊</div>Belum ada transaksi penjualan pada periode ini.</div>';
      } else {
        var html = '<h5 style="font-size:12px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-bottom:8px;">Berdasarkan Channel</h5>';
        html += '<table class="x-data-table mb-4"><thead><tr><th>Channel</th><th>Pesanan</th><th>Omzet</th></tr></thead><tbody>';
        channels.forEach(function (c) {
          html += '<tr>' +
            '<td><span class="x-badge">' + escapeHtml(c.order_channel || 'customer_app') + '</span></td>' +
            '<td>' + (c.order_count || 0) + '</td>' +
            '<td><strong>' + formatMoney(c.total_revenue || 0) + '</strong></td>' +
          '</tr>';
        });
        html += '</tbody></table>';

        html += '<h5 style="font-size:12px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin:16px 0 8px;">Berdasarkan Pemenuhan (Fulfillment)</h5>';
        html += '<table class="x-data-table"><thead><tr><th>Tipe</th><th>Pesanan</th><th>Omzet</th></tr></thead><tbody>';
        fulfillments.forEach(function (f) {
          html += '<tr>' +
            '<td><span class="x-badge" style="background:#ecfdf5;color:#065f46;">' + escapeHtml(f.fulfillment_type || 'delivery') + '</span></td>' +
            '<td>' + (f.order_count || 0) + '</td>' +
            '<td><strong>' + formatMoney(f.total_revenue || 0) + '</strong></td>' +
          '</tr>';
        });
        html += '</tbody></table>';

        salesContainer.innerHTML = html;
      }
    }

    // 4. Top Products
    var topProdContainer = $('overview-top-products-container');
    if (topProdContainer) {
      if (!topProducts || topProducts.length === 0) {
        topProdContainer.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">🍔</div>Belum ada produk yang terjual pada periode ini.</div>';
      } else {
        var prodHtml = '<table class="x-data-table"><thead><tr><th>Produk</th><th>Kategori</th><th>Terjual</th><th>Total</th></tr></thead><tbody>';
        topProducts.forEach(function (p) {
          prodHtml += '<tr>' +
            '<td><strong>' + escapeHtml(p.product_name) + '</strong></td>' +
            '<td><span class="x-badge">' + escapeHtml(p.category_name || 'Uncategorized') + '</span></td>' +
            '<td>' + (p.total_units_sold || 0) + ' item</td>' +
            '<td><strong>' + formatMoney(p.total_gross_sales || 0) + '</strong></td>' +
          '</tr>';
        });
        prodHtml += '</tbody></table>';
        topProdContainer.innerHTML = prodHtml;
      }
    }

    // 5. Branch Performance Leaderboard
    var branchPanel = $('overview-branch-performance-panel');
    var branchContainer = $('overview-branch-performance-container');
    if (branchPanel && branchContainer) {
      if (isBranchManager()) {
        branchPanel.style.display = 'none';
      } else {
        branchPanel.style.display = 'block';
        if (!branchPerf || branchPerf.length === 0) {
          branchContainer.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">🏢</div>Belum ada data cabang atau transaksi.</div>';
        } else {
          var bHtml = '<table class="x-data-table"><thead><tr><th>Cabang</th><th>Total Pesanan</th><th>AOV</th><th>Total Omzet</th></tr></thead><tbody>';
          branchPerf.forEach(function (b) {
            bHtml += '<tr>' +
              '<td><strong>' + escapeHtml(b.branch_name) + '</strong></td>' +
              '<td>' + (b.total_orders || 0) + ' pesanan</td>' +
              '<td>' + formatMoney(b.average_order_value || 0) + '</td>' +
              '<td><strong style="color:#059669;">' + formatMoney(b.total_revenue || 0) + '</strong></td>' +
            '</tr>';
          });
          bHtml += '</tbody></table>';
          branchContainer.innerHTML = bHtml;
        }
      }
    }

    // 6. Mobile Owner Command Center Renderers
    renderOccHeroKpi(kpis);
    renderOccBranchPerformance(overview);
    renderOccOrdersSummary(overview);
    renderOccTopProducts(overview);
    renderOccAttention(overview);
  }

  function setOverviewPeriodPreset(preset, skipReload) {
    var now = new Date();
    var startStr = '';
    var endStr = '';

    function toYMD(d) {
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    }

    if (preset === 'today') {
      startStr = toYMD(now);
      endStr = toYMD(now);
    } else if (preset === '7d') {
      var past7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      startStr = toYMD(past7);
      endStr = toYMD(now);
    } else if (preset === '30d') {
      var past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      startStr = toYMD(past30);
      endStr = toYMD(now);
    }

    _overviewFilter.startDate = startStr;
    _overviewFilter.endDate = endStr;
    _overviewFilter.preset = preset;

    var startInput = $('overview-start-date');
    var endInput = $('overview-end-date');
    if (startInput) startInput.value = startStr;
    if (endInput) endInput.value = endStr;

    var occStart = $('occ-start-date');
    var occEnd = $('occ-end-date');
    if (occStart) occStart.value = startStr;
    if (occEnd) occEnd.value = endStr;

    var periodSelect = $('occ-period-select');
    if (periodSelect && periodSelect.value !== preset) {
      periodSelect.value = preset;
    }

    // Update custom inline dropdown trigger label and active item
    var occLabel = $('occ-period-current-label');
    if (occLabel) {
      var presetLabels = {
        'today': 'Hari ini',
        '7d': '7 hari',
        '30d': '30 hari',
        'custom': 'Kustom'
      };
      occLabel.textContent = presetLabels[preset] || 'Pilih periode';
    }
    var occPeriodMenu = $('occ-period-menu');
    if (occPeriodMenu) {
      occPeriodMenu.querySelectorAll('.x-occ-dropdown-item').forEach(function (btn) {
        var isActive = btn.dataset.value === preset;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    }

    if (!skipReload) {
      loadOverview();
    }
  }

  function renderOccHeroKpi(kpis) {
    if ($('occ-hero-sales')) $('occ-hero-sales').textContent = formatMoney(kpis.net_sales || 0);
    if ($('occ-hero-orders')) $('occ-hero-orders').textContent = kpis.orders || 0;
    if ($('occ-hero-aov')) $('occ-hero-aov').textContent = formatMoney(kpis.aov || 0);
    if ($('occ-hero-customers')) $('occ-hero-customers').textContent = kpis.customers || 0;

    var trendEl = $('occ-hero-trend');
    if (trendEl) {
      if (kpis.trend && typeof kpis.trend.percent === 'number') {
        var dir = kpis.trend.direction || 'up';
        var arrow = dir === 'up' ? '\u2191' : '\u2193';
        var cls = dir === 'up' ? 'positive' : 'negative';
        trendEl.className = 'x-occ-hero-trend ' + cls;
        trendEl.innerHTML = '<span class="x-occ-trend-icon">' + arrow + '</span> <span id="occ-hero-trend-text">' + kpis.trend.percent + '% ' + escapeHtml(kpis.trend.label || 'vs kemarin') + '</span>';
      } else {
        trendEl.className = 'x-occ-hero-trend neutral';
        trendEl.innerHTML = '<span id="occ-hero-trend-text">Periode ini</span>';
      }
    }
  }

  function renderOccBranchPerformance(overview) {
    var branchPerf = overview.branch_performance || [];
    var kpis = overview.kpis || {};
    var branchId = getEffectiveBranchId();
    var titleEl = $('occ-branch-title');
    var linkEl = $('occ-branch-link');
    var contentEl = $('occ-branch-content');

    if (!contentEl) return;

    if (!branchId) {
      // Focus: Semua Cabang -> Multi-branch ranking list
      if (titleEl) titleEl.textContent = 'Performa Cabang';
      if (linkEl) {
        linkEl.href = '#reports/branches';
        linkEl.innerHTML = '<span>Lihat semua</span> <svg class="x-occ-link-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
        linkEl.style.display = 'inline-flex';
      }

      if (!branchPerf || branchPerf.length === 0) {
        contentEl.innerHTML = '<div class="x-occ-empty-placeholder">Belum ada data transaksi cabang.</div>';
        return;
      }

      var sorted = branchPerf.slice().sort(function (a, b) {
        return (b.total_revenue || 0) - (a.total_revenue || 0);
      });

      var html = '<div class="x-occ-branch-list">';
      sorted.forEach(function (b) {
        html += '<a href="#branches" class="x-occ-branch-row" aria-label="Buka cabang ' + escapeHtml(b.branch_name) + '">' +
          '<div class="x-occ-branch-info">' +
            '<span class="x-occ-branch-name">' + escapeHtml(b.branch_name) + '</span>' +
            '<span class="x-occ-branch-orders">' + (b.total_orders || 0) + ' pesanan</span>' +
          '</div>' +
          '<div class="x-occ-branch-revenue">' + formatMoney(b.total_revenue || 0) + '</div>' +
        '</a>';
      });
      html += '</div>';
      contentEl.innerHTML = html;
    } else {
      // Focus: Single Branch -> Focused Branch summary
      var bName = 'Cabang Terpilih';
      if (_branchContextState.branches) {
        var found = _branchContextState.branches.find(function (b) { return String(b.id) === String(branchId); });
        if (found) bName = found.name;
      }
      if (titleEl) titleEl.textContent = 'Performa ' + bName;
      if (linkEl) {
        linkEl.href = '#branches';
        linkEl.innerHTML = '<span>Rincian</span> <svg class="x-occ-link-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
        linkEl.style.display = 'inline-flex';
      }

      contentEl.innerHTML = '<div class="x-occ-branch-single">' +
        '<div class="x-occ-single-kpi-main">' + formatMoney(kpis.net_sales || 0) + '</div>' +
        '<div class="x-occ-single-kpi-sub">' +
          '<span>' + (kpis.orders || 0) + ' pesanan</span>' +
          '<span class="x-occ-dot">&bull;</span>' +
          '<span>' + formatMoney(kpis.aov || 0) + ' avg order</span>' +
        '</div>' +
      '</div>';
    }
  }

  function renderOccOrdersSummary(overview) {
    var summary = overview.orders_summary || {};
    var kpis = overview.kpis || {};
    var totalOrders = typeof summary.total === 'number' ? summary.total : (kpis.orders || 0);
    var completed = summary.completed || 0;
    var inProgress = summary.in_progress || 0;
    var cancelled = summary.cancelled || 0;

    if ($('occ-orders-total')) $('occ-orders-total').textContent = totalOrders;
    if ($('occ-orders-completed')) $('occ-orders-completed').textContent = completed;
    if ($('occ-orders-in-progress')) $('occ-orders-in-progress').textContent = inProgress;
    if ($('occ-orders-cancelled')) $('occ-orders-cancelled').textContent = cancelled;
  }

  function renderOccTopProducts(overview) {
    var topProducts = overview.top_products || [];
    var contentEl = $('occ-products-content');
    if (!contentEl) return;

    if (!topProducts || topProducts.length === 0) {
      contentEl.innerHTML = '<div class="x-occ-empty-placeholder">Belum ada produk yang terjual pada periode ini.</div>';
      return;
    }

    var medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}', '4.', '5.'];
    var html = '<div class="x-occ-product-list">';
    topProducts.slice(0, 5).forEach(function (p, idx) {
      var badge = medals[idx] || (idx + 1) + '.';
      html += '<div class="x-occ-product-row">' +
        '<div class="x-occ-product-rank">' + badge + '</div>' +
        '<div class="x-occ-product-info">' +
          '<span class="x-occ-product-name">' + escapeHtml(p.product_name) + '</span>' +
          '<span class="x-occ-product-sold">' + (p.total_units_sold || 0) + ' terjual</span>' +
        '</div>' +
        '<div class="x-occ-product-revenue">' + formatMoney(p.total_gross_sales || 0) + '</div>' +
      '</div>';
    });
    html += '</div>';
    contentEl.innerHTML = html;
  }

  function renderOccAttention(overview) {
    var needsAttention = overview.needs_attention || {};
    var branchPerf = overview.branch_performance || [];
    var branchId = getEffectiveBranchId();
    var contentEl = $('occ-attention-content');
    if (!contentEl) return;

    var alerts = [];

    // 1. Low stock items
    if (needsAttention.low_stock_items && needsAttention.low_stock_items.length > 0) {
      alerts.push({
        icon: '\u26A0\uFE0F',
        text: needsAttention.low_stock_items.length + ' item produk stok menipis di bawah minimum',
        link: '#reports/operations'
      });
    }

    // 2. Pending / unverified payments
    if (needsAttention.pending_payments_count > 0) {
      alerts.push({
        icon: '\u26A0\uFE0F',
        text: needsAttention.pending_payments_count + ' transaksi pembayaran perlu verifikasi',
        link: '#finance'
      });
    }

    // 3. Multi-branch alert: branch with 0 revenue when others have revenue
    if (!branchId && branchPerf.length > 1) {
      var hasActiveBranches = branchPerf.some(function (b) { return (b.total_revenue || 0) > 0; });
      if (hasActiveBranches) {
        var zeroBranches = branchPerf.filter(function (b) { return (b.total_revenue || 0) === 0; });
        zeroBranches.slice(0, 2).forEach(function (zb) {
          alerts.push({
            icon: '\u26A0\uFE0F',
            text: 'Cabang ' + zb.branch_name + ' transaksi \u2193 (belum ada omzet)',
            link: '#branches'
          });
        });
      }
    }

    if (alerts.length === 0) {
      contentEl.innerHTML = '<div class="x-occ-normal-state">' +
        '<span class="x-occ-normal-icon">\u2713</span>' +
        '<span class="x-occ-normal-text">Semua berjalan normal</span>' +
      '</div>';
    } else {
      var html = '<div class="x-occ-alerts-list">';
      alerts.forEach(function (a) {
        html += '<a href="' + a.link + '" class="x-occ-alert-item">' +
          '<div class="x-occ-alert-left">' +
            '<span class="x-occ-alert-icon">' + a.icon + '</span>' +
            '<span class="x-occ-alert-text">' + escapeHtml(a.text) + '</span>' +
          '</div>' +
          '<span class="x-occ-alert-arrow"><svg class="x-occ-link-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></span>' +
        '</a>';
      });
      html += '</div>';
      contentEl.innerHTML = html;
    }
  }

  function renderOccEmpty() {
    if ($('occ-hero-sales')) $('occ-hero-sales').textContent = 'Rp0';
    if ($('occ-hero-orders')) $('occ-hero-orders').textContent = '0';
    if ($('occ-hero-aov')) $('occ-hero-aov').textContent = 'Rp0';
    if ($('occ-hero-customers')) $('occ-hero-customers').textContent = '0';
    if ($('occ-hero-trend')) {
      $('occ-hero-trend').className = 'x-occ-hero-trend neutral';
      $('occ-hero-trend').innerHTML = '<span id="occ-hero-trend-text">Periode ini</span>';
    }
    if ($('occ-orders-total')) $('occ-orders-total').textContent = '0';
    if ($('occ-orders-completed')) $('occ-orders-completed').textContent = '0';
    if ($('occ-orders-in-progress')) $('occ-orders-in-progress').textContent = '0';
    if ($('occ-orders-cancelled')) $('occ-orders-cancelled').textContent = '0';
    if ($('occ-branch-content')) {
      $('occ-branch-content').innerHTML = '<div class="x-occ-empty-placeholder">Data belum tersedia.</div>';
    }
    if ($('occ-products-content')) {
      $('occ-products-content').innerHTML = '<div class="x-occ-empty-placeholder">Data belum tersedia.</div>';
    }
    if ($('occ-attention-content')) {
      $('occ-attention-content').innerHTML = '<div class="x-occ-normal-state"><span class="x-occ-normal-icon">\u2713</span><span class="x-occ-normal-text">Semua berjalan normal</span></div>';
    }
  }

  window.loadOwnerOverview = loadOverview;

  function renderOccError() {
    var message = 'Periksa koneksi Anda lalu coba lagi.';
    ['occ-hero-sales', 'occ-hero-orders', 'occ-hero-aov', 'occ-hero-customers',
      'occ-orders-total', 'occ-orders-completed', 'occ-orders-in-progress', 'occ-orders-cancelled'
    ].forEach(function (id) {
      var el = $(id);
      if (el) el.textContent = '—';
    });
    var targets = ['occ-branch-content', 'occ-products-content'];
    targets.forEach(function (id) {
      var el = $(id);
      if (el) {
        el.innerHTML =
          '<div class="x-occ-error-state" role="alert">' +
            '<div class="x-occ-error-copy">' +
              '<strong>Data belum dapat dimuat</strong>' +
              '<span>' + escapeHtml(message) + '</span>' +
            '</div>' +
            '<button type="button" class="x-occ-retry-btn" onclick="loadOverview()">Coba lagi</button>' +
          '</div>';
      }
    });
    var attention = $('occ-attention-content');
    if (attention) {
      attention.innerHTML = '<div class="x-occ-error-state" role="alert">' +
        '<div class="x-occ-error-copy"><strong>Ringkasan belum tersedia</strong><span>Coba muat ulang data.</span></div>' +
        '<button type="button" class="x-occ-retry-btn" onclick="loadOverview()">Coba lagi</button>' +
      '</div>';
    }
  }

  function renderOverviewEmpty() {
    if ($('stat-net-sales')) $('stat-net-sales').textContent = 'Rp0';
    if ($('stat-orders-count')) $('stat-orders-count').textContent = '0';
    if ($('stat-customers-count')) $('stat-customers-count').textContent = '0';
    if ($('stat-aov')) $('stat-aov').textContent = 'Rp0';

    if ($('overview-sales-performance-container')) {
      $('overview-sales-performance-container').innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">📊</div>Data belum tersedia.</div>';
    }
    if ($('overview-top-products-container')) {
      $('overview-top-products-container').innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">🍔</div>Data belum tersedia.</div>';
    }
    if ($('overview-branch-performance-container')) {
      $('overview-branch-performance-container').innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">🏢</div>Data belum tersedia.</div>';
    }

    renderOccEmpty();
  }

  function initOverviewControls() {
    var btnFilter = $('btn-overview-filter');
    var btnReset = $('btn-overview-reset');
    var inputStart = $('overview-start-date');
    var inputEnd = $('overview-end-date');
    var occSelect = $('occ-period-select');
    var occStart = $('occ-start-date');
    var occEnd = $('occ-end-date');
    var btnOccSearch = $('btn-occ-search');
    var occDropdown = $('occ-period-dropdown');
    var btnOccDropdownTrigger = $('btn-occ-dropdown-trigger');
    var occDateSheet = $('occ-date-sheet');
    var occDateSheetOverlay = $('occ-date-sheet-overlay');
    var btnOccCustomToggle = $('btn-occ-custom-toggle');
    var occCustomRange = $('occ-custom-range-row');

    function toggleOccDropdown(forceOpen) {
      if (!occDropdown) return;
      var isOpen = typeof forceOpen === 'boolean' ? forceOpen : !occDropdown.classList.contains('open');
      occDropdown.classList.toggle('open', isOpen);
      if (btnOccDropdownTrigger) {
        btnOccDropdownTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      }
    }

    if (btnOccDropdownTrigger) {
      btnOccDropdownTrigger.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleOccDropdown();
      });
    }

    if (occDropdown) {
      occDropdown.querySelectorAll('.x-occ-dropdown-item').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var val = this.dataset.value;
          toggleOccDropdown(false);
          if (occSelect) {
            occSelect.value = val;
          }
          setOccCustomOpen(false);
          setOverviewPeriodPreset(val);
        });
      });
    }

    document.addEventListener('click', function (e) {
      if (occDropdown && occDropdown.classList.contains('open') && !occDropdown.contains(e.target)) {
        toggleOccDropdown(false);
      }
    });

    window.openOccDateSheet = function () {
      document.body.classList.add('x-sheet-open');
      if (occCustomRange) occCustomRange.hidden = false;
      if (btnOccCustomToggle) {
        btnOccCustomToggle.setAttribute('aria-expanded', 'true');
      }
      if (occDateSheetOverlay) {
        occDateSheetOverlay.style.display = 'block';
        setTimeout(function () { occDateSheetOverlay.classList.add('open'); }, 10);
      }
      if (occDateSheet) {
        occDateSheet.style.display = 'block';
        setTimeout(function () {
          occDateSheet.classList.add('open');
          var extClose = $('occ-date-sheet-ext-close');
          if (extClose) {
            var sheetH = occDateSheet.offsetHeight || 280;
            extClose.style.bottom = (sheetH + 12) + 'px';
            extClose.classList.add('open');
          }
        }, 10);
      }
    };

    window.closeOccDateSheet = function () {
      document.body.classList.remove('x-sheet-open');
      var extClose = $('occ-date-sheet-ext-close');
      if (extClose) extClose.classList.remove('open');
      if (occCustomRange) occCustomRange.hidden = true;
      if (btnOccCustomToggle) {
        btnOccCustomToggle.setAttribute('aria-expanded', 'false');
      }
      if (occDateSheetOverlay) {
        occDateSheetOverlay.classList.remove('open');
        setTimeout(function () { occDateSheetOverlay.style.display = 'none'; }, 260);
      }
      if (occDateSheet) {
        occDateSheet.classList.remove('open');
        setTimeout(function () { occDateSheet.style.display = 'none'; }, 280);
      }
    };

    function setOccCustomOpen(open) {
      if (open) {
        window.openOccDateSheet();
      } else {
        window.closeOccDateSheet();
      }
    }

    if (occSelect) {
      occSelect.addEventListener('change', function () {
        setOccCustomOpen(false);
        setOverviewPeriodPreset(this.value);
      });
    }

    if (btnOccCustomToggle) {
      btnOccCustomToggle.addEventListener('click', function () {
        var isOpen = occDateSheet && occDateSheet.classList.contains('open');
        setOccCustomOpen(!isOpen);
      });
    }

    function doOccSearch() {
      var sVal = occStart ? occStart.value.trim() : '';
      var eVal = occEnd ? occEnd.value.trim() : '';
      _overviewFilter.startDate = sVal;
      _overviewFilter.endDate = eVal;
      _overviewFilter.preset = 'custom';
      if (occSelect) {
        occSelect.selectedIndex = -1;
        occSelect.value = '';
      }
      var occLabel = $('occ-period-current-label');
      if (occLabel) {
        occLabel.textContent = 'Kustom';
      }
      var occPeriodMenu = $('occ-period-menu');
      if (occPeriodMenu) {
        occPeriodMenu.querySelectorAll('.x-occ-dropdown-item').forEach(function (btn) {
          btn.classList.remove('active');
          btn.setAttribute('aria-selected', 'false');
        });
      }
      if (inputStart) inputStart.value = sVal;
      if (inputEnd) inputEnd.value = eVal;
      setOccCustomOpen(false);
      loadOverview();
    }

    if (btnOccSearch) {
      btnOccSearch.addEventListener('click', doOccSearch);
    }

    if (occStart) {
      occStart.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          doOccSearch();
        }
      });
    }
    if (occEnd) {
      occEnd.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          doOccSearch();
        }
      });
    }

    if (btnFilter) {
      btnFilter.addEventListener('click', function () {
        _overviewFilter.startDate = inputStart ? inputStart.value : '';
        _overviewFilter.endDate = inputEnd ? inputEnd.value : '';
        if (occStart) occStart.value = _overviewFilter.startDate;
        if (occEnd) occEnd.value = _overviewFilter.endDate;
        loadOverview();
      });
    }

    if (btnReset) {
      btnReset.addEventListener('click', function () {
        if (inputStart) inputStart.value = '';
        if (inputEnd) inputEnd.value = '';
        if (occStart) occStart.value = '';
        if (occEnd) occEnd.value = '';
        _overviewFilter.startDate = '';
        _overviewFilter.endDate = '';
        if (occSelect) occSelect.value = 'today';
        loadOverview();
      });
    }

    // Initialize default preset to 'today' without triggering extra reload
    setOccCustomOpen(false);
    setOverviewPeriodPreset('today', true);
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
     Auth/session helpers are owned by merchant-shared/js/shared.js so every
     merchant surface shares one implementation.
     ========================================================================= */

  var getStoredUser = _shared.getStoredUser || window.XentraShared.getStoredUser;
  var isBranchManager = (_shared && typeof _shared.isBranchManager === 'function' ? _shared.isBranchManager : null) ||
    (window.XentraShared && typeof window.XentraShared.isBranchManager === 'function' ? window.XentraShared.isBranchManager : null) ||
    function () {
      var u = (typeof getStoredUser === 'function' ? getStoredUser() : null);
      return !!(u && (u.role === 'branch_manager' || u.role === 'manager'));
    };
  var checkAuth = _shared.checkAuth || window.XentraShared.checkAuth;
  var handleHandoffExchange = _shared.handleHandoffExchange || window.XentraShared.handleHandoffExchange;
  var validateServerSession = _shared.validateServerSession || window.XentraShared.validateServerSession;
  var enforceSurface = _shared.enforceSurface || window.XentraShared.enforceSurface;

  /**
   * Hides/shows UI panels depending on the logged-in user's role.
   * - branch_manager → shows inline Branch Catalog panel, hides Owner CRUD panel
   *                     hides sidebar items that are owner-only (Brand, Cabang, Payment)
   * - owner / brand_manager → shows Owner CRUD panel, hides branch panel
   */
  function applyRoleBasedUI() {
    var user = getStoredUser();
    if (!user) return;

    var role = user.role;
    var isBM = role === 'branch_manager';

    // Catalog tab panels
    var ownerPanel = $('panel-owner-catalog');
    var branchPanel = $('panel-branch-catalog');
    if (ownerPanel) ownerPanel.style.display = isBM ? 'none' : '';
    if (branchPanel) branchPanel.style.display = isBM ? '' : 'none';

    if (isBM) {
      // Branch Manager is served by the dedicated Merchant App within the managerial environment.
      window.location.replace('/merchant/' + window.location.hash);
      return;
    } else {
      var isStaff = role === 'cashier' || role === 'kitchen';
      document.querySelectorAll('.x-nav-item').forEach(function (btn) {
        var target = btn.dataset.route || btn.dataset.tab;
        if (isStaff && (target === 'team' || target === 'settings' || target === 'branches' || target === 'customers' || target === 'marketing' || target === 'finance')) {
          btn.style.display = 'none';
        }
      });
    }

    // Marketing campaign builder button is exclusive to Owner
    var btnCreatePromo = $('btn-mkt-create-promo');
    if (btnCreatePromo) {
      btnCreatePromo.style.display = (role === 'owner') ? 'inline-flex' : 'none';
    }

    // Role-Aware Portal Label in sidebar badge
    var portalBadge = document.querySelector('.x-dash-badge-pro');
    if (portalBadge) {
      if (role === 'owner') {
        portalBadge.textContent = 'Owner Portal';
      } else if (role === 'brand_manager') {
        portalBadge.textContent = 'Brand Portal';
      } else if (role === 'branch_manager') {
        portalBadge.textContent = 'Branch Portal';
      } else if (role === 'cashier') {
        portalBadge.textContent = 'Cashier Portal';
      } else {
        portalBadge.textContent = (role ? role.replace(/_/g, ' ') : 'Merchant') + ' Portal';
      }
    }

    // Topbar brand badge: hide for branch_manager (redundant with sidebar), show for owner/brand_manager
    var topbarBrandBadge = $('topbar-brand-badge');
    if (topbarBrandBadge) {
      topbarBrandBadge.style.display = isBM ? 'none' : 'flex';
    }

    // Global search affordance: hide non-functional affordance to avoid misleading placeholder
    var searchBtn = $('btn-global-search');
    if (searchBtn) {
      searchBtn.style.display = 'none';
    }

    // Set branch context visibility and locking
    var branchSelectorWrap = $('x-branch-selector');
    var bmBranchBadge = $('dash-bm-branch-badge');
    var branchSelector = $('dash-branch-context');

    if (isBM) {
      if (branchSelectorWrap) branchSelectorWrap.style.display = 'none';
      if (bmBranchBadge) bmBranchBadge.style.display = 'flex';
      if (user.branch_id) {
        XentraOwnerBranchCatalog.state.branchId = user.branch_id;
        _branchContextState.selected = user.branch_id;
        if (branchSelector) {
          branchSelector.value = user.branch_id;
          branchSelector.disabled = true;
        }
      }
    } else if (role === 'cashier' || role === 'kitchen') {
      if (branchSelectorWrap) branchSelectorWrap.style.display = 'none';
      if (bmBranchBadge) bmBranchBadge.style.display = 'none';
      if (branchSelector) {
        branchSelector.disabled = true;
      }
    } else {
      // owner or brand_manager
      if (branchSelectorWrap) branchSelectorWrap.style.display = 'flex';
      if (bmBranchBadge) bmBranchBadge.style.display = 'none';
      if (branchSelector) {
        branchSelector.disabled = false;
      }
    }

    // Update user profile info in top bar
    var nameEl = $('dash-user-name');
    var roleEl = $('dash-user-role');
    var avatarEl = $('dash-user-avatar');
    var displayName = user.full_name || user.name || user.username || 'Pemilik Toko';
    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) roleEl.textContent = role === 'owner' ? 'Owner' : (role === 'brand_manager' ? 'Brand Manager' : 'Staff');
    if (avatarEl) {
      if (!avatarEl.querySelector('svg')) {
        avatarEl.innerHTML = '<svg class="x-topbar-user-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
      }
    }
  }

  async function handleLogout() {
    if (!await confirmFeatureAction('logout-dashboard', 'Keluar Dashboard', 'Apakah Anda ingin keluar dari Dashboard?', 'Keluar')) return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    if (typeof checkAppRoute === 'function') {
      checkAppRoute();
    } else {
      window.location.href = '/login';
    }
  }

  function populateMobileAccount() {
    var user = (typeof getStoredUser === 'function' ? getStoredUser() : null) || {};
    var name = user.full_name || user.name || user.username || 'Pemilik Toko';
    var role = user.role === 'owner' ? 'Owner' : (user.role === 'brand_manager' ? 'Brand Manager' : 'Staff');
    var brandName = (state.brand && state.brand.name) ? state.brand.name : 'Bangjo Resto';

    var nameEl = $('mobile-account-name');
    var roleEl = $('mobile-account-role');
    var emailEl = $('mobile-account-email');
    var brandEl = $('mobile-account-brand');
    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.textContent = role;
    if (emailEl) emailEl.textContent = user.email || '-';
    if (brandEl) brandEl.textContent = brandName;
  }

  function closeMobileAccount() {
    var skipHistory = arguments[0];
    var page = $('x-mobile-account-page');
    if (page) {
      page.setAttribute('aria-hidden', 'true');
      page.style.transform = '';
      page.style.transition = '';
    }
    document.body.classList.remove('x-mobile-account-open');
    if (!skipHistory && window.history.state && window.history.state.mobileAccountOpen) {
      window.history.back();
    }
  }

  function openMobileAccount() {
    populateMobileAccount();
    var page = $('x-mobile-account-page');
    if (page) {
      page.setAttribute('aria-hidden', 'false');
      page.style.transform = '';
      page.style.transition = '';
    }
    document.body.classList.add('x-mobile-account-open');
    try {
      if (!window.history.state || !window.history.state.mobileAccountOpen) {
        window.history.pushState({ mobileAccountOpen: true }, '');
      }
    } catch (_) {}
  }

  window.openMobileAccount = openMobileAccount;
  window.closeMobileAccount = closeMobileAccount;

  function initMobileAccountSwipeBack() {
    var page = $('x-mobile-account-page');
    if (!page) return;

    var startX = 0;
    var startY = 0;
    var touchStartTime = 0;
    var isSwiping = false;
    var isHorizontalLocked = false;

    page.addEventListener('touchstart', function (e) {
      if (!document.body.classList.contains('x-mobile-account-open')) return;
      if (e.touches.length !== 1) return;

      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      touchStartTime = Date.now();
      isSwiping = false;
      isHorizontalLocked = false;
      page.style.transition = 'none';
    }, { passive: true });

    page.addEventListener('touchmove', function (e) {
      if (!document.body.classList.contains('x-mobile-account-open')) return;
      if (e.touches.length !== 1) return;

      var currentX = e.touches[0].clientX;
      var currentY = e.touches[0].clientY;
      var deltaX = currentX - startX;
      var deltaY = currentY - startY;

      if (!isHorizontalLocked) {
        if (Math.abs(deltaY) > 8 && Math.abs(deltaY) > Math.abs(deltaX)) {
          isSwiping = false;
          return;
        }
        if (deltaX > 8 && deltaX > Math.abs(deltaY) * 1.1) {
          isHorizontalLocked = true;
          isSwiping = true;
        }
      }

      if (isSwiping && deltaX > 0) {
        if (e.cancelable) e.preventDefault();
        page.style.transform = 'translateX(' + deltaX + 'px)';
      }
    }, { passive: false });

    function handleTouchEnd(e) {
      if (!isSwiping) {
        page.style.transform = '';
        page.style.transition = '';
        return;
      }
      isSwiping = false;
      isHorizontalLocked = false;

      var endX = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : startX;
      var deltaX = endX - startX;
      var duration = Math.max(1, Date.now() - touchStartTime);
      var velocity = deltaX / duration;

      if (deltaX > 70 || (deltaX > 30 && velocity > 0.25)) {
        var layout = document.querySelector('.x-dash-layout');
        if (layout) layout.style.display = 'flex';
        var bottomNav = document.querySelector('.x-owner-bottom-nav');
        if (bottomNav) bottomNav.style.display = 'flex';

        page.style.transition = 'transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        page.style.transform = 'translateX(100%)';
        setTimeout(function () {
          if (layout) layout.style.display = '';
          if (bottomNav) bottomNav.style.display = '';
          closeMobileAccount();
        }, 200);
      } else {
        page.style.transition = 'transform 0.2s ease-out';
        page.style.transform = 'translateX(0px)';
        setTimeout(function () {
          page.style.transform = '';
          page.style.transition = '';
        }, 200);
      }
    }

    page.addEventListener('touchend', handleTouchEnd, { passive: true });
    page.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    window.addEventListener('popstate', function () {
      if (document.body.classList.contains('x-mobile-account-open')) {
        closeMobileAccount(true);
      }
    });
  }

  function initAuthListeners() {
    var btnLogout = $('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', handleLogout);
    }
    var btnMobileLogout = $('btn-mobile-account-logout');
    if (btnMobileLogout) {
      btnMobileLogout.addEventListener('click', handleLogout);
    }
    var btnBack = $('btn-mobile-account-back');
    if (btnBack) {
      btnBack.addEventListener('click', closeMobileAccount);
    }
    var profileBtn = $('dash-user-profile');
    if (profileBtn) {
      profileBtn.addEventListener('click', function (e) {
        if (e.target.closest('#btn-logout')) return;
        openMobileAccount();
      });
    }
    initMobileAccountSwipeBack();
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
  async function loadOwnerMasterMenus() {
    if (window.XentraMasterMenuModule && window.XentraMasterMenuModule.loadOwnerMasterMenus) {
      return window.XentraMasterMenuModule.loadOwnerMasterMenus();
    }
  }

  async function loadOwnerMasterMenuEditor(menuId) {
    if (window.XentraMasterMenuModule && window.XentraMasterMenuModule.loadOwnerMasterMenuEditor) {
      return window.XentraMasterMenuModule.loadOwnerMasterMenuEditor(menuId);
    }
  }

  function initOwnerMasterMenuUI() {
    if (window.XentraMasterMenuModule && window.XentraMasterMenuModule.initOwnerMasterMenuUI) {
      return window.XentraMasterMenuModule.initOwnerMasterMenuUI();
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
    if (formUser) {
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
      ensureOwnerNavigationHistory(getCurrentRoute());
      applyRoute(getCurrentRoute());

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
      ensureOwnerNavigationHistory(getCurrentRoute());
      applyRoute(getCurrentRoute());

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

    if (window.Xentra && typeof window.Xentra.hideSplash === 'function') {
      window.Xentra.hideSplash();
    }
  }

  /* =========================================================================
     STANDARDIZED FLOATING DROPDOWN TEMPLATE ENGINE (Owner Context)
     Converts native filter <select> into .x-floating-dropdown while keeping
     underlying select fully synced with change events and form submissions.
     ========================================================================= */
  function createFloatingDropdown(select, options) {
    if (!select || select.dataset.floatingEnhanced === '1') return null;
    options = options || {};

    var wrapper = document.createElement('div');
    wrapper.className = 'x-floating-dropdown' + (options.className ? ' ' + options.className : '');
    if (options.style) {
      wrapper.setAttribute('style', options.style);
    }

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'x-floating-dropdown-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    if (select.disabled) trigger.disabled = true;

    var labelSpan = document.createElement('span');
    labelSpan.className = 'x-floating-dropdown-label';

    var chevronSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevronSvg.setAttribute('class', 'x-floating-dropdown-chevron');
    chevronSvg.setAttribute('width', '13');
    chevronSvg.setAttribute('height', '13');
    chevronSvg.setAttribute('viewBox', '0 0 24 24');
    chevronSvg.setAttribute('fill', 'none');
    chevronSvg.setAttribute('stroke', 'currentColor');
    chevronSvg.setAttribute('stroke-width', '2.2');
    chevronSvg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';

    trigger.appendChild(labelSpan);
    trigger.appendChild(chevronSvg);

    var menu = document.createElement('div');
    menu.className = 'x-floating-dropdown-menu';
    menu.setAttribute('role', 'listbox');

    function syncItems() {
      menu.innerHTML = '';
      var currentVal = String(select.value);
      var currentText = '';

      Array.prototype.forEach.call(select.options, function (opt) {
        var isCurrent = String(opt.value) === currentVal;
        if (isCurrent || !currentText) {
          currentText = opt.textContent;
        }

        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'x-floating-dropdown-item' + (isCurrent ? ' active' : '');
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
        item.dataset.value = opt.value;
        if (opt.disabled) item.disabled = true;

        item.innerHTML = '<span>' + esc(opt.textContent) + '</span>' +
          '<svg class="x-floating-check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';

        item.addEventListener('click', function (e) {
          e.stopPropagation();
          if (item.disabled) return;
          select.value = opt.value;
          wrapper.classList.remove('open');
          trigger.setAttribute('aria-expanded', 'false');
          syncItems();
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });

        menu.appendChild(item);
      });

      labelSpan.textContent = currentText || 'Pilih opsi';
      trigger.disabled = Boolean(select.disabled);
    }

    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);

    // Sembunyikan select asli tanpa memutus nilainya
    select.parentNode.insertBefore(wrapper, select);
    select.style.position = 'absolute';
    select.style.opacity = '0';
    select.style.pointerEvents = 'none';
    select.style.width = '1px';
    select.style.height = '1px';
    select.style.overflow = 'hidden';
    select.setAttribute('tabindex', '-1');
    select.dataset.floatingEnhanced = '1';

    // Interaktivitas
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (trigger.disabled) return;
      var isOpen = wrapper.classList.contains('open');
      document.querySelectorAll('.x-floating-dropdown.open').forEach(function (el) {
        if (el !== wrapper) {
          el.classList.remove('open');
          var tr = el.querySelector('.x-floating-dropdown-trigger');
          if (tr) tr.setAttribute('aria-expanded', 'false');
        }
      });
      wrapper.classList.toggle('open', !isOpen);
      trigger.setAttribute('aria-expanded', !isOpen ? 'true' : 'false');
    });

    document.addEventListener('click', function (e) {
      if (wrapper.classList.contains('open') && !wrapper.contains(e.target)) {
        wrapper.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    // Tangani perubahan programmatic select asli atau observer
    select.addEventListener('change', syncItems);
    if (typeof MutationObserver === 'function') {
      var observer = new MutationObserver(syncItems);
      observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    }

    syncItems();
    return { wrapper: wrapper, trigger: trigger, menu: menu, sync: syncItems };
  }
  window.createFloatingDropdown = createFloatingDropdown;

  function initOwnerFloatingDropdowns() {
    var targets = [
      'branch-filter-status',
      'mkt-banners-branch-filter'
    ];

    targets.forEach(function (id) {
      var sel = $(id);
      if (sel) createFloatingDropdown(sel);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDashboard);
  } else {
    initializeDashboard();
  }

})();

