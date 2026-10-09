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

  // DOM Helpers
  function $(id) {
    return document.getElementById(id);
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
     ========================================================================= */

  // State extensions for Phase 1
  var _catalogState = {
    searchQuery: '',
    categoryFilter: 'all',
    activeDetailProductId: null
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 1. MASTER PRODUCTS CONTROLLER
  // ─────────────────────────────────────────────────────────────────────────

  function showProductListSection() {
    var listView = $('product-list-view');
    var detailView = $('product-detail-view');
    var editorView = $('product-editor-view');
    if (listView) listView.style.display = 'block';
    if (detailView) detailView.style.display = 'none';
    if (editorView) editorView.style.display = 'none';
  }

  function showProductDetailSection() {
    var listView = $('product-list-view');
    var detailView = $('product-detail-view');
    var editorView = $('product-editor-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';
    if (editorView) editorView.style.display = 'none';
  }

  function showProductEditorSection() {
    var listView = $('product-list-view');
    var detailView = $('product-detail-view');
    var editorView = $('product-editor-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'none';
    if (editorView) editorView.style.display = 'block';
  }

  async function loadMasterProducts() {
    try {
      var authHeaders = getAuthHeaders();
      var prodRes = await adminFetch(API_BASE + '/admin/composed/products?active_only=0', { headers: authHeaders });
      var prodData = await prodRes.json();

      if (prodData.success) state.products = prodData.products || [];

      renderMasterProductsTable();
    } catch (err) {
      console.error('[Master Products Load Error]:', err);
    }
  }

  // Alias for backward compatibility
  var loadCatalog = loadMasterProducts;

  function renderProductCategoryFilterChips() {
    var container = $('catalog-products-category-chips');
    if (!container) return;

    var html = '<button type="button" class="x-cat-filter-btn ' + (_catalogState.categoryFilter === 'all' ? 'active' : '') + '" data-cat="all">Semua Kategori (' + state.products.length + ')</button>';

    state.categories.forEach(function (cat) {
      var count = state.products.filter(function (p) { return String(p.category_id) === String(cat.id); }).length;
      var active = String(_catalogState.categoryFilter) === String(cat.id) ? 'active' : '';
      html += '<button type="button" class="x-cat-filter-btn ' + active + '" data-cat="' + cat.id + '">' + esc(cat.name) + ' (' + count + ')</button>';
    });

    container.innerHTML = html;

    container.querySelectorAll('.x-cat-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _catalogState.categoryFilter = btn.dataset.cat;
        var select = $('prod-filter-category');
        if (select) select.value = _catalogState.categoryFilter;
        renderProductCategoryFilterChips();
        renderMasterProductsTable();
      });
    });
  }

  // Menu dropdown filter kategori dibangun dari opsi select aslinya, sehingga nilainya
  // hanya punya satu sumber. Dipanggil setiap kali opsinya diisi ulang.
  function renderProductCategoryFilterMenu() {
    var select = $('prod-filter-category');
    var menu = $('prod-filter-category-menu');
    if (!select || !menu) return;
    var current = String(select.value || 'all');
    var html = '';
    Array.prototype.forEach.call(select.options, function (option) {
      var isCurrent = String(option.value) === current;
      html += '<button type="button" class="x-occ-dropdown-item' + (isCurrent ? ' active' : '') +
        '" role="option" data-value="' + esc(option.value) + '" aria-selected="' + (isCurrent ? 'true' : 'false') +
        '" onclick="pickProductCategoryFilter(this)">' +
        '<span>' + esc(option.textContent) + '</span>' +
        '<svg class="x-occ-check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>' +
        '</button>';
      if (isCurrent) {
        var label = $('prod-filter-category-label');
        if (label) label.textContent = option.textContent;
      }
    });
    menu.innerHTML = html;
  }

  function closeProductCategoryFilter() {
    var dropdown = $('prod-filter-category-dropdown');
    if (dropdown) dropdown.classList.remove('open');
    var trigger = $('btn-prod-filter-category');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  window.toggleProductCategoryFilter = function () {
    var dropdown = $('prod-filter-category-dropdown');
    if (!dropdown) return;
    var open = dropdown.classList.toggle('open');
    var trigger = $('btn-prod-filter-category');
    if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  window.pickProductCategoryFilter = function (item) {
    if (!item) return;
    var select = $('prod-filter-category');
    closeProductCategoryFilter();
    if (!select) return;
    select.value = item.dataset.value;
    renderProductCategoryFilterMenu();
    // Perilaku select aslinya tetap dijalankan, termasuk pendengar onchange-nya.
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  document.addEventListener('click', function (e) {
    var dropdown = $('prod-filter-category-dropdown');
    if (dropdown && !dropdown.contains(e.target)) closeProductCategoryFilter();
  });

  window.renderProductCategoryFilterMenu = renderProductCategoryFilterMenu;

  function populateProductCategorySelect() {
    var select = $('prod-filter-category');
    if (select) {
      var opts = '<option value="all">Semua Kategori</option>';
      state.categories.forEach(function (cat) {
        opts += '<option value="' + cat.id + '">' + esc(cat.name) + '</option>';
      });
      select.innerHTML = opts;
      select.value = _catalogState.categoryFilter;
        renderProductCategoryFilterMenu();
    }

    var formSelect = $('prod-category');
    if (formSelect) {
      formSelect.innerHTML = state.categories.map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
      }).join('');
    }
  }

  function getFilteredMasterProducts() {
    return state.products.filter(function (p) {
      if (!_catalogState.searchQuery) return true;
      var q = _catalogState.searchQuery.toLowerCase();
      return String(p.name || '').toLowerCase().indexOf(q) !== -1 ||
        String(p.description || '').toLowerCase().indexOf(q) !== -1 ||
        String(p.sku || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderMasterProductsTable() {
    var tbody = $('master-products-table-body');
    if (!tbody) return;

    var filtered = getFilteredMasterProducts();

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-muted">Belum ada Product yang cocok dengan pencarian.</td></tr>';
      return;
    }

    var rows = filtered.map(function (prod) {
      var img = prod.image || prod.image_url || '';
      var isActive = prod.is_active !== 0;
      var toggleSwitch = '' +
        '<label class="x-toggle' + (isActive ? ' x-toggle-on' : '') + '" title="' + (isActive ? 'Product aktif' : 'Product nonaktif') + '">' +
          '<input type="checkbox" ' + (isActive ? 'checked' : '') + ' onchange="toggleStock(\'' + esc(prod.id) + '\', this.checked ? 1 : 0)" aria-label="Status Product ' + esc(prod.name) + '">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      return [
        '<tr>',
          '<td>' + (img ? '<img src="' + esc(img) + '" alt="" class="x-table-thumb">' : '<div class="x-table-thumb" aria-hidden="true">🍲</div>') + '</td>',
          '<td>',
            '<a href="#catalog/products/' + encodeURIComponent(prod.id) + '" style="font-weight:700;color:var(--text-main);text-decoration:none;display:inline-block;">' + esc(prod.name) + '</a>',
            '<p class="text-muted" style="font-size:12px;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:2px 0 0;">' + esc(prod.description || '') + '</p>',
          '</td>',
          '<td><code style="font-size:11px;">' + esc(prod.sku || 'Belum ada SKU') + '</code></td>',
          '<td>' + toggleSwitch + '</td>',
          '<td class="text-right" style="white-space:nowrap;">',
            '<div class="x-item-actions">',
              '<button type="button" class="x-action-menu-trigger" aria-label="Aksi Product ' + esc(prod.name) + '" onclick="XentraActionMenu.open(this, [' +
                '{ label: \'Lihat Detail\', icon: \'🔍\', onClick: function() { navigateTo(\'catalog/products/' + encodeURIComponent(prod.id) + '\'); } },' +
                '{ label: \'+ Buat Menu Satuan\', icon: \'🍽️\', onClick: function() { window.createMenuFromProduct(\'' + esc(prod.id) + '\'); } },' +
                '{ label: \'Edit Product\', icon: \'✏️\', onClick: function() { openEditProduct(\'' + esc(prod.id) + '\'); } },' +
                '{ divider: true },' +
                '{ label: \'Arsipkan Product\', icon: \'🗑️\', destructive: true, onClick: function() { deleteProduct(\'' + esc(prod.id) + '\'); } }' +
              '])">',
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
              '</button>',
            '</div>',
          '</td>',
        '</tr>'
      ].join('');
    });

    tbody.innerHTML = rows.join('');
    var legacyBody = $('products-table-body');
    if (legacyBody) legacyBody.innerHTML = rows.join('');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRODUCT DETAIL VIEW (Showing Branch Adoption Status)
  // ─────────────────────────────────────────────────────────────────────────

  async function loadProductDetailView(productId) {
    _catalogState.activeDetailProductId = productId;
    var tbody = $('prod-detail-branches-tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4">Memuat status cabang...</td></tr>';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/products/' + productId, { headers: getAuthHeaders() });
      var data = await res.json();
      if (!data.success || !data.product) {
        showToast('❌ ' + (data.error || 'Produk tidak ditemukan.'));
        navigateTo('catalog/products');
        return;
      }

      var prod = data.product;
      var branchAdoptions = data.branch_adoptions || [];

      // Product detail is intentionally atomic. Do not render legacy
      // Product price/category as customer/commercial identity.
      if ($('prod-detail-breadcrumb')) $('prod-detail-breadcrumb').textContent = prod.name;
      if ($('product-detail-mobile-title')) $('product-detail-mobile-title').textContent = 'Detail Product · ' + (prod.name || 'Product');
      if ($('prod-detail-name')) $('prod-detail-name').textContent = prod.name || 'Product';
      if ($('prod-detail-desc')) $('prod-detail-desc').textContent = prod.description || 'Tidak ada deskripsi.';
      if ($('prod-detail-sku')) $('prod-detail-sku').textContent = prod.sku || 'Belum ada SKU';

      var img = prod.image || prod.image_url || '';
      if ($('prod-detail-img')) {
        if (img) {
          $('prod-detail-img').src = img;
          $('prod-detail-img').style.display = 'block';
        } else {
          $('prod-detail-img').removeAttribute('src');
          $('prod-detail-img').style.display = 'none';
        }
      }

      var statusBadge = $('prod-detail-status-badge');
      if (statusBadge) {
        var isActive = prod.is_active !== 0;
        statusBadge.className = 'x-badge ' + (isActive ? 'x-badge-success' : 'x-badge-warning');
        statusBadge.textContent = isActive ? 'Aktif' : 'Nonaktif';
      }

      // Render branch adoptions table
      renderProductDetailBranchesTable(branchAdoptions, prod);
    } catch (err) {
      console.error('[Product Detail Error]:', err);
      showToast('❌ Kesalahan jaringan saat memuat detail produk.');
    }
  }

  function renderProductDetailBranchesTable(adoptions, prod) {
    var tbody = $('prod-detail-branches-tbody');
    if (!tbody) return;

    if (!adoptions || !adoptions.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">Belum ada cabang terdaftar pada brand ini.</td></tr>';
      return;
    }

    var rows = adoptions.map(function (b) {
      var isAdopted = b.is_adopted === 1 || b.is_adopted === true;
      var isAvailable = b.branch_is_available === 1 || b.branch_is_available === true;
      var adoptedBadge = isAdopted
        ? '<span class="x-badge x-badge-success">Diadopsi</span>'
        : '<span class="x-badge" style="background:#f1f5f9;color:#64748b;">Belum Diadopsi</span>';

      var priceDisplay = isAdopted ? formatMoney(b.branch_price != null ? b.branch_price : prod.price) : '—';
      var stockDisplay = isAdopted ? (b.branch_stock != null ? b.branch_stock : '100') : '—';
      var availDisplay = isAdopted
        ? (isAvailable ? '<span class="x-badge x-badge-success">● Tersedia</span>' : '<span class="x-badge x-badge-warning">○ Habis</span>')
        : '—';

      var actionBtn = isAdopted
        ? '<button type="button" class="x-btn-secondary" style="font-size:12px;padding:4px 8px;" onclick="openBranchMenuFromDetail(\'' + b.branch_id + '\')">Lihat Menu Cabang</button>'
        : '<button type="button" class="x-btn-primary" style="font-size:12px;padding:4px 8px;" onclick="adoptProductDirectly(\'' + b.branch_id + '\', \'' + prod.id + '\')">+ Adopsi ke Cabang</button>';

      return [
        '<tr>',
          '<td><strong>' + esc(b.branch_name) + '</strong><br><small class="text-muted">' + esc(b.branch_address || '') + '</small></td>',
          '<td>' + adoptedBadge + '</td>',
          '<td>' + priceDisplay + '</td>',
          '<td>' + stockDisplay + '</td>',
          '<td>' + availDisplay + '</td>',
          '<td class="text-right">' + actionBtn + '</td>',
        '</tr>'
      ].join('');
    });

    tbody.innerHTML = rows.join('');
  }

  window.openBranchMenuFromDetail = function (branchId) {
    var sel = $('dash-branch-context');
    if (sel) {
      sel.value = branchId;
      _branchContextState.selected = branchId;
    }
    navigateTo('catalog/menus');
  };

  window.adoptProductDirectly = async function (branchId, prodId) {
    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + branchId + '/adopt', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ product_id: prodId })
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Produk berhasil diadopsi ke cabang!');
        if (_catalogState.activeDetailProductId) {
          loadProductDetailView(_catalogState.activeDetailProductId);
        }
      } else {
        showToast('❌ ' + (data.message || data.error || 'Gagal mengadopsi produk.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 2. MASTER REFERENCE MANAGEMENT PAGE (CATEGORY + FLAVOR)
  // ─────────────────────────────────────────────────────────────────────────

  var _masterReferenceTab = 'category';
  // Prevent stale/overlapping catalog-reference requests from overwriting newer data.
  var _masterReferenceLoadSeq = 0;

  function showCategoryEditorSection() {
    var page = $('master-categories-page');
    var catEditor = $('category-editor-view');
    var productList = $('product-list-view');
    var productDetail = $('product-detail-view');
    if (page) page.style.display = 'none';
    if (catEditor) catEditor.style.display = 'block';
    if (productList) productList.style.display = 'none';
    if (productDetail) productDetail.style.display = 'none';
  }

  function showMasterCategoriesPage() {
    var page = $('master-categories-page');
    var catEditor = $('category-editor-view');
    var productList = $('product-list-view');
    var productDetail = $('product-detail-view');
    if (page) page.style.display = 'block';
    if (catEditor) catEditor.style.display = 'none';
    if (productList) productList.style.display = 'none';
    if (productDetail) productDetail.style.display = 'none';
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
      populateProductCategorySelect();
      renderMasterReferenceList(_masterReferenceTab);
      renderMasterMenuSelectors();
      renderMasterMenuCustomerPreview();
      setMasterReferenceTab(_masterReferenceTab);
    }
  }
  function referenceStatusBadge(active) {
    return '<span class="x-master-reference-status ' + (active ? 'is-active' : 'is-inactive') + '">' +
      (active ? 'Aktif' : 'Nonaktif') + '</span>';
  }

  function referenceRows(type) {
    if (type === 'category') return state.categories || [];
    return _masterMenuComponents[type] || [];
  }

  function referenceTypeLabel(type) {
    if (type === 'title') return 'Judul';
    if (type === 'item') return 'Item';
    return type === 'category' ? 'Kategori' : type === 'flavor' ? 'Rasa' : type === 'complement' ? 'Kelengkapan' : 'Level';
  }

  // ── Tab Item: unit internal + pengelolaan stok berbasis SKU ────────────────
  // Item memakai satu komponen kartu yang sama dengan tab lain (x-master-reference-card).
  // SKU adalah identitas stok: checkbox "Kelola stok (pakai SKU)" membuka input SKU,
  // dan mematikannya = mengosongkan SKU — operasi yang dijaga server
  // (PRODUCT_SKU_REMOVAL_BLOCKED_STOCK: stok harus nol dulu di semua cabang).

  function renderMasterItemsList() {
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
            '<div class="x-master-reference-card-right" style="display:flex;align-items:center;">',
              '<label class="x-toggle' + (isActive ? ' x-toggle-on' : '') + '" title="' + (isActive ? 'Item aktif (klik untuk nonaktifkan)' : 'Item nonaktif (klik untuk aktifkan)') + '" style="margin:0;">',
                '<input type="checkbox" ' + (isActive ? 'checked' : '') + ' onchange="toggleMasterItemActive(\'' + id + '\', this)" aria-label="Status item ' + esc(item.name) + '">',
                '<span class="x-toggle-slider"></span>',
              '</label>',
            '</div>',
          '</div>'
      ].join('');
    }).join('');
  }

  // Toggle kartu Item = aktif/nonaktif item (bukan pengelolaan stok). Dipakai untuk
  // menghentikan sementara item yang tidak boleh dijual, dan bisa dinyalakan kembali.
  window.toggleMasterItemActive = async function(productId, inputEl) {
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

    list.innerHTML = rows.map(function(row) {
      var description = '';
      if (type === 'category') {
        var catMenus = (_ownerMasterMenuState.menus || []).filter(function(m) {
          return String(m.category_id || (m.category && m.category.id) || '') === String(row.id);
        });
        if (catMenus.length) {
          var menuTitles = catMenus.map(function(m) { return ownerMasterMenuTitle(m); });
          description = '<span class="x-master-category-menu-list" title="' + esc(menuTitles.join(', ')) + '">' + esc(menuTitles.join(', ')) + '</span>';
        } else {
          description = '<span class="x-master-category-menu-list text-muted">Belum ada menu</span>';
        }
      } else if (type === 'title') {
        description = 'Judul Menu di Customer PWA · wajib dipilih tiap Menu';
      } else if (type === 'flavor') {
        description = 'Dipakai sebagai pilihan Rasa pada Item';
      } else if (type === 'complement') {
        description = 'Detail Customer · bisa dipilih lebih dari satu';
      } else {
        description = 'Indikator Customer · satu per Produk Master';
      }

      var rightControls = '';
      var isRowActive = row.is_active !== 0 && row.is_active !== null;
      var typeNoun = referenceTypeLabel(type);
      var toggleSwitch = '' +
        '<label class="x-toggle' + (isRowActive ? ' x-toggle-on' : '') + '" title="' + (isRowActive ? typeNoun + ' Aktif (klik untuk nonaktifkan)' : typeNoun + ' Nonaktif (klik untuk aktifkan)') + '" style="margin:0;">' +
          '<input type="checkbox" ' + (isRowActive ? 'checked' : '') + ' onchange="toggleMasterReferenceStatus(\'' + esc(String(type)) + '\', \'' + esc(String(row.id)) + '\', this)" aria-label="Status ' + typeNoun + ' ' + esc(row.name) + '">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      var actionMenuBtn = '' +
        '<button type="button" class="x-action-menu-trigger" aria-label="Aksi ' + typeNoun.toLowerCase() + '" data-master-reference-action="' + esc(String(type)) + '" data-reference-id="' + esc(String(row.id)) + '">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>' +
        '</button>';

      rightControls = toggleSwitch + actionMenuBtn;

      var iconHtml = '';
      if (type === 'category' && (row.image_url || row.image)) {
        var catImg = row.image_url || row.image;
        iconHtml = '<div class="x-master-reference-icon" aria-hidden="true" style="background:#f1f5f9;"><img src="' + esc(catImg) + '" alt="' + esc(row.name) + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;"></div>';
      } else {
        iconHtml = '<div class="x-master-reference-icon ' + referenceIconClass(type) + '" aria-hidden="true">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">' + referenceIconSvg(type) + '</svg>' +
        '</div>';
      }

      var cardClickableAttr = '';
      var cardExtraClass = '';
      if (type === 'category') {
        cardExtraClass = ' x-master-item-card-clickable';
        cardClickableAttr = ' tabindex="0" role="button" aria-label="Buka editor kategori ' + esc(row.name) + '" onclick="if (!event.target.closest(\'.x-toggle, .x-action-menu-trigger, .x-action-menu\')) { openEditCategory(\'' + esc(String(row.id)) + '\'); }" onkeydown="if ((event.key === \'Enter\' || event.key === \' \') && !event.target.closest(\'.x-toggle, .x-action-menu-trigger, .x-action-menu\')) { event.preventDefault(); openEditCategory(\'' + esc(String(row.id)) + '\'); }"';
      }

      return [
        '<div class="x-master-reference-card' + cardExtraClass + '"' + cardClickableAttr + '>',
          '<div class="x-master-reference-card-main">',
            iconHtml,
            '<div class="x-master-reference-copy">',
              '<strong>' + esc(row.name) + '</strong>' + (isRowActive ? '' : ' ' + referenceStatusBadge(false)),
              (type === 'category' ? description : '<span>' + esc(description) + '</span>'),
            '</div>',
          '</div>',
          '<div class="x-master-reference-card-right" style="display:flex;align-items:center;gap:10px;">',
            rightControls,
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function renderMasterCategoriesPage() {
    renderMasterReferenceList('category');
  }

  function renderMasterFlavorsPage() {
    renderMasterReferenceList('flavor');
  }
  function openEditMasterReference(type, id) {
    var meta = MASTER_REFERENCE_META[type];
    var content = $('master-reference-editor');
    if (!meta || !content || !window.XentraPresentation) return;

    var row = referenceRows(type).find(function(item) { return String(item.id) === String(id); });
    if (!row) return;

    $('master-reference-quick-add-type').value = type;
    $('master-reference-quick-add-id').value = String(id);
    $('master-reference-quick-add-title').textContent = 'Ubah ' + referenceTypeLabel(type);
    $('master-reference-quick-add-label').textContent = meta.label;
    $('master-reference-quick-add-name').value = row.name || '';
    $('master-reference-quick-add-name').placeholder = meta.placeholder;
    window.XentraPresentation.open({
      id: 'master-reference-quick-add',
      type: 'bottom-sheet',
      content: content,
      onOpen: function () {
        setTimeout(function() {
          var input = $('master-reference-quick-add-name');
          if (input) {
            input.focus();
            input.select();
          }
        }, 0);
      }
    });
  }
  window.openEditMasterReference = openEditMasterReference;

  // ── Category Editor (Page View) ──────────────────────────────────────────
  var _categoryImageFile = null;
  var _categoryCropSpec = null;
  var _categoryImageRemoved = false;
  var _categoryEditorLoadSeq = 0;

  function setCategoryImagePreview(src, hasImage) {
    var previewImg = $('cat-image-preview');
    var emptyBox = $('cat-image-empty');
    var btnRemove = $('btn-cat-image-remove');
    var btnPick = $('btn-cat-image-pick');
    if (!previewImg || !emptyBox) return;
    if (hasImage && src) {
      previewImg.src = src;
      previewImg.style.display = 'block';
      emptyBox.style.display = 'none';
      if (btnRemove) btnRemove.style.display = 'inline-block';
      if (btnPick) btnPick.textContent = '📁 Ganti Foto';
    } else {
      previewImg.removeAttribute('src');
      previewImg.style.display = 'none';
      emptyBox.style.display = 'flex';
      if (btnRemove) btnRemove.style.display = 'none';
      if (btnPick) btnPick.textContent = '📁 Pilih Foto';
    }
  }

  function resetCategoryEditorForAdd() {
    $('category-editor-breadcrumb').textContent = 'Tambah Kategori';
    if ($('category-editor-mobile-title')) $('category-editor-mobile-title').textContent = 'Tambah Kategori';
    if ($('category-editor-mobile-subtitle')) $('category-editor-mobile-subtitle').textContent = 'Pengelompokan utama menu komersial di storefront.';
    $('cat-id').value = '';
    $('cat-name').value = '';
    $('cat-desc').value = '';
    $('cat-image-removed').value = '0';
    _categoryImageFile = null;
    _categoryCropSpec = null;
    _categoryImageRemoved = false;
    var fileInput = $('cat-image-file');
    if (fileInput) fileInput.value = '';
    setCategoryImagePreview('', false);

    var menusContainer = $('cat-menus-container');
    if (menusContainer) {
      menusContainer.innerHTML = '<div class="text-muted" style="font-size:13px;padding:8px 0;">Kategori baru belum memiliki menu. Menu dapat ditambahkan melalui Menu Master setelah kategori disimpan.</div>';
    }
  }

  function populateCategoryEditorForm(category) {
    var catName = category.name || '';
    $('category-editor-breadcrumb').textContent = 'Edit Kategori: ' + catName;
    if ($('category-editor-mobile-title')) $('category-editor-mobile-title').textContent = 'Edit Kategori';
    if ($('category-editor-mobile-subtitle')) $('category-editor-mobile-subtitle').textContent = 'Perbarui Foto, Nama Kategori, Menu, dan Catatan.';
    $('cat-id').value = String(category.id || '');
    $('cat-name').value = catName;
    $('cat-desc').value = category.description || '';
    $('cat-image-removed').value = '0';
    _categoryImageFile = null;
    _categoryCropSpec = null;
    _categoryImageRemoved = false;
    var fileInput = $('cat-image-file');
    if (fileInput) fileInput.value = '';
    var existingImage = category.image_url || category.image || '';
    setCategoryImagePreview(existingImage, existingImage !== '');

    renderCategoryMenusList(category.id);
  }

  function renderCategoryMenusList(categoryId) {
    var container = $('cat-menus-container');
    if (!container) return;

    var menus = (_ownerMasterMenuState.menus || []).filter(function(m) {
      return String(m.category_id || (m.category && m.category.id) || '') === String(categoryId);
    });

    if (!menus.length) {
      container.innerHTML = '<div class="text-muted" style="font-size:13px;padding:8px 0;">Belum ada menu dalam kategori ini.</div>';
      return;
    }

    container.innerHTML = menus.map(function(m, idx) {
      var menuTitle = ownerMasterMenuTitle(m);
      var menuId = esc(String(m.id));
      return [
        '<div class="x-cat-menu-card">',
          '<div class="x-cat-menu-card-info">',
            '<span class="x-cat-menu-card-label">Menu ' + (idx + 1) + '</span>',
            '<span class="x-cat-menu-card-name" title="' + esc(menuTitle) + '">' + esc(menuTitle) + '</span>',
          '</div>',
          '<button type="button" class="x-cat-menu-card-delete" aria-label="Hapus ' + esc(menuTitle) + ' dari kategori" onclick="deleteMenuFromCategory(\'' + menuId + '\', \'' + esc(menuTitle).replace(/'/g, "\\'") + '\', \'' + esc(String(categoryId)) + '\')">',
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>',
          '</button>',
        '</div>'
      ].join('');
    }).join('');
  }

  window.deleteMenuFromCategory = async function(menuId, menuTitle, categoryId) {
    var confirmed = false;
    var message = 'Hapus "' + menuTitle + '" dari daftar menu? Tindakan ini tidak dapat dibatalkan.';
    if (window.XentraPresentation && typeof window.XentraPresentation.confirm === 'function') {
      confirmed = await window.XentraPresentation.confirm({
        id: 'delete-cat-menu',
        title: 'Hapus Menu dari Kategori',
        message: message,
        okLabel: 'Hapus',
        cancelLabel: 'Batal'
      });
    } else {
      confirmed = window.confirm(message);
    }
    if (!confirmed) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/menus/' + encodeURIComponent(menuId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Gagal menghapus menu.');

      showToast('✅ Menu "' + menuTitle + '" berhasil dihapus.');

      var menusRes = await adminFetch(API_BASE + '/admin/menus', { headers: getAuthHeaders() });
      var menusData = await menusRes.json();
      if (menusData.success) {
        _ownerMasterMenuState.menus = menusData.menus || [];
      }
      renderCategoryMenusList(categoryId);
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal menghapus menu.'));
    }
  };

  async function loadCategoryEditorPage(categoryId) {
    var requestSeq = ++_categoryEditorLoadSeq;
    showCategoryEditorSection();

    if (!categoryId) {
      resetCategoryEditorForAdd();
      return;
    }

    var existing = (state.categories || []).find(function(c) { return String(c.id) === String(categoryId); });
    if (existing) {
      populateCategoryEditorForm(existing);
    } else {
      resetCategoryEditorForAdd();
    }

    try {
      var headers = getAuthHeaders();
      var [catRes, menusRes] = await Promise.all([
        adminFetch(API_BASE + '/admin/categories', { headers: headers }),
        adminFetch(API_BASE + '/admin/menus', { headers: headers })
      ]);
      var catData = await catRes.json();
      var menusData = await menusRes.json();

      if (requestSeq !== _categoryEditorLoadSeq) return;

      if (menusData.success) {
        _ownerMasterMenuState.menus = menusData.menus || [];
      }
      if (catData.success) {
        state.categories = catData.categories || [];
        var found = (state.categories || []).find(function(c) { return String(c.id) === String(categoryId); });
        if (found) {
          populateCategoryEditorForm(found);
        }
      }
    } catch (err) {
      console.warn('[Category Editor Fetch Warn]:', err);
    }
  }

  function openNewCategory() {
    navigateTo('catalog/categories/new');
  }
  window.openNewCategory = openNewCategory;

  function openEditCategory(id) {
    if (!id) return;
    navigateTo('catalog/categories/' + encodeURIComponent(id) + '/edit');
  }
  window.openEditCategory = openEditCategory;

  async function deleteMasterReference(type, id) {
    var meta = MASTER_REFERENCE_META[type];
    if (!meta) return;

    var row = referenceRows(type).find(function(item) { return String(item.id) === String(id); });
    if (!row) return;

    var noun = referenceTypeLabel(type).toLowerCase();
    var actionLabel = 'Hapus permanen';
    var actionMessage = 'Hapus permanen ' + noun + ' "' + row.name + '"? ' +
      'Tindakan ini TIDAK dapat dibatalkan. ' +
      noun.charAt(0).toUpperCase() + noun.slice(1) + ' yang masih dipakai Produk atau Menu akan ditolak — matikan toggle untuk menonaktifkannya.';
    if (window.XentraPresentation && !await window.XentraPresentation.confirm({
      id: 'delete-master-reference',
      title: actionLabel + ' ' + referenceTypeLabel(type),
      message: actionMessage,
      okLabel: actionLabel,
      cancelLabel: 'Batal'
    })) return;

    try {
      var endpoint = meta.deleteEndpoint ? meta.deleteEndpoint(String(id)) : (API_BASE + '/admin/' + type + 's/' + encodeURIComponent(id));
      var res = await adminFetch(endpoint, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (!res.ok || !data.success) {
        var code = data.error || '';
        if (code === 'TITLE_IN_USE_BY_MENUS') {
          var used = (data.details && data.details.used_by_menu_count) || (data.message || '').match(/\d+/);
          throw new Error('Judul ini masih dipakai ' + (used || 'beberapa') + ' Menu, jadi tidak dihapus. Matikan toggle untuk menonaktifkannya.');
        }
        if (code === 'PRODUCT_MENU_USAGE_BLOCKED') {
          throw new Error('Data ini masih dipakai Produk atau Menu, jadi tidak dihapus. Matikan toggle untuk menonaktifkannya.');
        }
        throw new Error(data.error || ('Gagal menghapus ' + noun + '.'));
      }

      if (type === 'category') {
        state.categories = (state.categories || []).filter(function(item) { return String(item.id) !== String(id); });
        populateProductCategorySelect();
        renderProductCategoryFilterChips();
        renderMasterProductsTable();
      } else {
        _masterMenuComponents[type] = (_masterMenuComponents[type] || []).filter(function(item) { return String(item.id) !== String(id); });
        renderMasterMenuSelectors();
      }

      renderMasterReferenceList(type);
      renderMasterMenuCustomerPreview();
      showToast(data.message || (referenceTypeLabel(type) + ' berhasil dihapus.'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
  window.deleteMasterReference = deleteMasterReference;

  async function toggleMasterReferenceStatus(type, id, inputEl) {
    if (!id || !type) return;
    var noun = referenceTypeLabel(type);
    var prevChecked = inputEl ? !inputEl.checked : null;
    try {
      if (inputEl) inputEl.disabled = true;
      var isTitle = type === 'title';
      var endpoint = type === 'category'
        ? API_BASE + '/admin/categories/' + encodeURIComponent(id) + '/toggle'
        : isTitle
          ? API_BASE + '/admin/menu-titles/' + encodeURIComponent(id)
          : API_BASE + '/admin/menu/components/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '/toggle';

      var res = await adminFetch(endpoint, isTitle ? {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: inputEl && inputEl.checked ? 1 : 0 })
      } : {
        method: 'PATCH',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal mengubah status ' + noun.toLowerCase() + '.');
      }

      if (type === 'category') {
        var updatedCategory = data.category;
        if (updatedCategory) {
          var categoryRows = state.categories || [];
          var idx = categoryRows.findIndex(function(c) { return String(c.id) === String(id); });
          if (idx >= 0) categoryRows[idx] = updatedCategory;
          state.categories = categoryRows;
        } else {
          var cat = (state.categories || []).find(function(c) { return String(c.id) === String(id); });
          if (cat) cat.is_active = inputEl.checked ? 1 : 0;
        }
        populateProductCategorySelect();
        renderProductCategoryFilterChips();
        renderMasterProductsTable();
      } else {
        var comp = (_masterMenuComponents[type] || []).find(function(c) { return String(c.id) === String(id); });
        if (comp) {
          comp.is_active = (data.component && typeof data.component.is_active !== 'undefined')
            ? data.component.is_active
            : (inputEl.checked ? 1 : 0);
        }
        renderMasterMenuSelectors();
      }

      renderMasterReferenceList(type);
      renderMasterMenuCustomerPreview();
      var activeText = inputEl.checked ? 'diaktifkan' : 'dinonaktifkan';
      showToast(data.message || (noun + ' berhasil ' + activeText + '.'), 'success');
    } catch (err) {
      if (inputEl && prevChecked !== null) {
        inputEl.checked = prevChecked;
        var parentLabel = inputEl.closest ? inputEl.closest('.x-toggle') : null;
        if (parentLabel) parentLabel.classList.toggle('x-toggle-on', prevChecked);
      }
      showToast(err.message, 'error');
    } finally {
      if (inputEl) inputEl.disabled = false;
    }
  }
  window.toggleMasterReferenceStatus = toggleMasterReferenceStatus;
  window.toggleCategoryStatus = function(id, inputEl) { return toggleMasterReferenceStatus('category', id, inputEl); };

  // ─────────────────────────────────────────────────────────────────────────
  // 2. MASTER REFERENCE QUICK-ADD (Product Assembly)
  // ─────────────────────────────────────────────────────────────────────────

  var MASTER_REFERENCE_META = {
    category: {
      title: 'Tambah Kategori',
      label: 'Nama Kategori',
      placeholder: 'Contoh: Makanan Berat',
      description: 'Pengelompokan Item / Judul Menu',
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
      placeholder: 'Contoh: Sambal Ijo',
      description: 'Pilihan Rasa untuk Subtitle Customer',
      endpoint: function () { return API_BASE + '/admin/menu/components/flavor'; },
      deleteEndpoint: function (id) { return API_BASE + '/admin/menu/components/flavor/' + encodeURIComponent(id); },
      payload: function (name) { return { name: name }; }
    },
    complement: {
      title: 'Tambah Kelengkapan',
      label: 'Nama Kelengkapan',
      placeholder: 'Contoh: Nasi',
      description: 'Detail Customer; dapat dipilih lebih dari satu pada Item',
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
    var meta = MASTER_REFERENCE_META[type];
    var content = $('master-reference-editor');
    if (!meta || !content || !window.XentraPresentation) return;

    $('master-reference-quick-add-type').value = type;
    $('master-reference-quick-add-id').value = '';
    $('master-reference-quick-add-title').textContent = meta.title;
    $('master-reference-quick-add-label').textContent = meta.label;
    $('master-reference-quick-add-name').value = '';
    $('master-reference-quick-add-name').placeholder = meta.placeholder;

    window.XentraPresentation.open({
      id: 'master-reference-quick-add',
      type: 'bottom-sheet',
      content: content,
      onOpen: function () {
        setTimeout(function () {
          var input = $('master-reference-quick-add-name');
          if (input) input.focus();
        }, 0);
      }
    });
  }
  window.openMasterReferenceQuickAdd = openMasterReferenceQuickAdd;

  function closeMasterReferenceQuickAdd() {
    if (window.XentraPresentation) {
      window.XentraPresentation.close('master-reference-quick-add');
    }
    var form = $('form-master-reference-quick-add');
    if (form) form.reset();
  }
  window.closeMasterReferenceQuickAdd = closeMasterReferenceQuickAdd;

  async function saveMasterReferenceQuickAdd() {
    var type = $('master-reference-quick-add-type').value;
    var referenceId = String($('master-reference-quick-add-id').value || '').trim();
    var nameInput = $('master-reference-quick-add-name');
    var meta = MASTER_REFERENCE_META[type];
    var name = nameInput ? String(nameInput.value || '').trim() : '';

    if (!meta || !name) return;

    var saveBtn = $('btn-save-master-reference-quick-add');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = referenceId ? 'Menyimpan...' : 'Menambahkan...';
    }

    try {
      var endpoint = referenceId
        ? meta.endpoint() + '/' + encodeURIComponent(referenceId)
        : meta.endpoint();

      var res = await adminFetch(endpoint, {
        method: referenceId ? 'PUT' : 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(meta.payload(name))
      });
      var data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menyimpan data master.');
      }

      var row = type === 'category' ? data.category : (type === 'title' ? data.title : data.component);
      if (!row) throw new Error('Server tidak mengembalikan hasil simpan.');

      var rows = referenceRows(type);
      var rowIndex = rows.findIndex(function(item) { return String(item.id) === String(row.id); });
      if (rowIndex >= 0) rows[rowIndex] = row;
      else rows.push(row);

      if (type === 'category') {
        populateProductCategorySelect();
        if (!referenceId) {
          var categorySelect = $('prod-category');
          if (categorySelect) categorySelect.value = row.id;
        }
        renderProductCategoryFilterChips();
        renderMasterProductsTable();
      } else {
        if (!referenceId && type === 'complement') {
          var newComplementId = String(row.id);
          if (_masterMenuSelected.complement_ids.indexOf(newComplementId) === -1) {
            _masterMenuSelected.complement_ids.push(newComplementId);
          }
        }

        renderMasterMenuSelectors();

        if (!referenceId && type === 'flavor') {
          _masterMenuSelected.flavor_id = String(row.id);
          var flavorSelect = $('prod-flavor');
          if (flavorSelect) flavorSelect.value = String(row.id);
        }
      }

      closeMasterReferenceQuickAdd();
      renderMasterReferenceList(type);
      renderMasterMenuCustomerPreview();
      showToast('✅ ' + (referenceId ? referenceTypeLabel(type) + ' diperbarui.' : referenceTypeLabel(type) + ' ditambahkan.'));
    } catch (err) {
      showToast('❌ ' + err.message);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Simpan';
      }
    }
  }


  var _productOptionsDraft = [];

  var _masterMenuComponents = {
    flavor: [],
    complement: [],
    level: []
  };
  var _masterMenuComponentType = 'flavor';
  var _masterMenuSelected = {
    flavor_id: '',
    complement_ids: [],
    level_id: ''
  };

  function masterMenuComponentTypeLabel(type) {
    return type === 'flavor' ? 'Rasa' : (type === 'complement' ? 'Kelengkapan' : 'Level');
  }

  async function loadMasterMenuComponents() {
    var headers = getAuthHeaders();
    var results = await Promise.all(['flavor', 'complement', 'level'].map(function(type) {
      var prepare = type === 'level'
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

      return prepare
        .then(function() {
          return adminFetch(API_BASE + '/admin/menu/components/' + type, { headers: headers })
            .then(function(res) { return res.json(); });
        })
        .then(function(data) {
          if (!data.success) throw new Error(data.error || 'Gagal memuat ' + masterMenuComponentTypeLabel(type) + '.');
          return { type: type, rows: data.components || [] };
        })
        .catch(function(err) {
          console.warn('[Master Menu Components] gagal memuat ' + masterMenuComponentTypeLabel(type) + ':', err.message);
          return null;
        });
    }));

    results.forEach(function(result) {
      if (result) _masterMenuComponents[result.type] = result.rows;
    });

    renderMasterMenuSelectors();
    renderMasterMenuComponentManager();
    renderMasterMenuCustomerPreview();
    return results;
  }

  function renderMasterMenuCustomerPreview() {
    var titleEl = $('master-preview-title');
    var subtitleEl = $('master-preview-subtitle');
    var detailEl = $('master-preview-detail');
    var indicatorEl = $('master-preview-indicator');
    var priceEl = $('master-preview-price');
    var imageEl = $('master-preview-image');
    var emptyImageEl = $('master-preview-image-empty');
    if (!titleEl || !subtitleEl || !detailEl || !indicatorEl || !priceEl) return;

    var nameInput = $('prod-name');
    var productName = nameInput ? String(nameInput.value || '').trim() : '';
    var flavorSelect = $('prod-flavor');
    var levelSelect = $('prod-level');

    // Product Name is the Customer card title. Category remains grouping metadata.
    titleEl.textContent = productName || 'Masukkan Nama Produk';
    subtitleEl.textContent = '';
    detailEl.textContent = '';
    indicatorEl.textContent = '';

    var flavorId = flavorSelect ? String(flavorSelect.value || '') : String(_masterMenuSelected.flavor_id || '');
    var flavor = _masterMenuComponents.flavor.find(function(row) { return String(row.id) === flavorId; });
    if (flavor) subtitleEl.textContent = flavor.name;

    var selectedComplementIds = _masterMenuSelected.complement_ids || [];
    var complementNames = selectedComplementIds.map(function(id) {
      var row = _masterMenuComponents.complement.find(function(item) { return String(item.id) === String(id); });
      return row ? row.name : null;
    }).filter(Boolean);
    detailEl.textContent = complementNames.join(' · ');

    var levelId = levelSelect ? String(levelSelect.value || '') : String(_masterMenuSelected.level_id || '');
    var level = _masterMenuComponents.level.find(function(row) { return String(row.id) === levelId; });
    if (level) {
      var levelPosition = Number(level.sort_order);
      if (!Number.isFinite(levelPosition) || levelPosition < 1) levelPosition = 1;
      levelPosition = Math.min(4, levelPosition);
      var indicatorHtml = '<span class="x-master-customer-preview-spice-label">Pedas</span>' +
        '<span class="x-master-customer-preview-spice-dots" aria-label="Level Pedas ' + levelPosition + ' dari 4">';
      for (var i = 1; i <= 4; i += 1) {
        indicatorHtml += '<span class="x-master-customer-preview-spice-dot' + (i <= levelPosition ? ' is-filled' : '') + '" aria-hidden="true"></span>';
      }
      indicatorHtml += '</span>';
      indicatorEl.innerHTML = indicatorHtml;
    }

    var price = Number(($('prod-price') && $('prod-price').value) || 0);
    priceEl.textContent = formatMoney(price);

    var previewInput = $('prod-image-preview');
    var src = previewInput && previewInput.style.display !== 'none' ? previewInput.getAttribute('src') : '';
    if (imageEl && emptyImageEl) {
      if (src) {
        imageEl.src = src;
        imageEl.alt = productName || 'Foto Menu';
        imageEl.style.display = 'block';
        emptyImageEl.style.display = 'none';
      } else {
        imageEl.removeAttribute('src');
        imageEl.alt = '';
        imageEl.style.display = 'none';
        emptyImageEl.style.display = 'inline-flex';
      }
    }
  }

  function renderMasterLevelSelector(containerId, rows, selectedId) {
    var box = $(containerId);
    if (!box) return;

    var selected = selectedId == null ? '' : String(selectedId);
    var activeRows = (rows || []).filter(function(row) {
      return row && (row.is_active !== false && Number(row.is_active) !== 0 || String(row.id) === selected);
    });

    if (!activeRows.length) {
      box.innerHTML = '<span class="x-master-spice-level-label">Level Pedas</span><span class="x-master-spice-level-empty">Belum ada level</span>';
      return;
    }

    var selectedIndex = -1;
    activeRows.some(function(row, index) {
      if (String(row.id) === selected) {
        selectedIndex = index;
        return true;
      }
      return false;
    });

    var html = '<span class="x-master-spice-level-label">Level Pedas</span><span class="x-master-spice-level-segments" role="presentation">';
    activeRows.forEach(function(row, index) {
      var isFilled = selectedIndex >= 0 && index <= selectedIndex;
      html += '<button type="button" class="x-master-spice-level-segment' +
        (isFilled ? ' is-filled' : '') +
        '" data-master-level-id="' + esc(row.id) + '"' +
        ' aria-label="' + esc(row.name) + '"' +
        ' aria-pressed="' + (String(row.id) === selected ? 'true' : 'false') + '"' +
        ' title="' + esc(row.name) + '">' +
        '<span aria-hidden="true"></span>' +
      '</button>';
    });
    html += '</span>';

    box.innerHTML = html;

    box.querySelectorAll('[data-master-level-id]').forEach(function(button) {
      button.addEventListener('click', function() {
        var id = String(button.getAttribute('data-master-level-id') || '');
        if (typeof box._xentraLevelSelect === 'function') box._xentraLevelSelect(id);
      });
    });
  }

  function renderMasterChoiceGrid(containerId, rows, selectedId, options) {
    var box = $(containerId);
    if (!box) return;

    options = options || {};
    var allowEmpty = !!options.allowEmpty;
    var emptyLabel = options.emptyLabel || 'Tidak ada';
    var addLabel = options.addLabel || 'Tambah';
    var addAction = options.addAction || null;
    var selected = selectedId == null ? '' : String(selectedId);

    var activeRows = (rows || []).filter(function(row) {
      return row && (row.is_active !== false && Number(row.is_active) !== 0 || String(row.id) === selected);
    });

    var html = '';

    if (allowEmpty) {
      html += '<button type="button" class="x-master-choice-chip x-master-choice-empty-chip' +
        (selected === '' ? ' is-selected' : '') +
        '" data-master-choice-empty="1" aria-pressed="' + (selected === '' ? 'true' : 'false') + '">' +
        esc(emptyLabel) + '</button>';
    }

    activeRows.forEach(function(row) {
      var id = String(row.id);
      var isSelected = id === selected;
      var suffix = (row.is_active === false || Number(row.is_active) === 0) ? ' (Nonaktif)' : '';
      html += '<button type="button" class="x-master-choice-chip' +
        (options.variant ? ' ' + options.variant : '') +
        (isSelected ? ' is-selected' : '') +
        '" data-master-choice-id="' + esc(id) + '"' +
        ' aria-pressed="' + (isSelected ? 'true' : 'false') + '"' +
        ' title="' + esc(row.name + suffix) + '">' +
        esc(row.name + suffix) +
      '</button>';
    });

    if (addAction) {
      html += '<button type="button" class="x-master-choice-chip x-master-choice-add" data-master-choice-add="1" aria-label="' +
        esc(addLabel) + '">' +
        '<span aria-hidden="true">+</span><span>' + esc(addLabel) + '</span>' +
      '</button>';
    }

    box.innerHTML = html;

    box.querySelectorAll('[data-master-choice-id]').forEach(function(button) {
      button.addEventListener('click', function() {
        var id = String(button.getAttribute('data-master-choice-id') || '');
        if (typeof options.onSelect === 'function') options.onSelect(id);
      });
    });

    box.querySelectorAll('[data-master-choice-empty]').forEach(function(button) {
      button.addEventListener('click', function() {
        if (typeof options.onSelect === 'function') options.onSelect('');
      });
    });

    box.querySelectorAll('[data-master-choice-add]').forEach(function(button) {
      button.addEventListener('click', function() {
        if (typeof addAction === 'function') addAction();
      });
    });
  }

  function renderMasterMenuSelectors() {
    var categorySelect = $('prod-category');
    if (categorySelect) {
      var categoryRows = state.categories || [];
      var categoryId = String(categorySelect.value || '');
      if (!categoryId && _masterMenuSelected.category_id) categoryId = String(_masterMenuSelected.category_id);

      var categoryHtml = '<option value="">Pilih Kategori</option>';
      categoryRows.forEach(function(row) {
        var selected = categoryId === String(row.id);
        if (!row.is_active && !selected) return;
        var suffix = row.is_active ? '' : ' (Nonaktif)';
        categoryHtml += '<option value="' + esc(row.id) + '"' +
          (selected ? ' selected' : '') +
          (row.is_active ? '' : ' data-inactive="1"') + '>' +
          esc(row.name + suffix) + '</option>';
      });
      categorySelect.innerHTML = categoryHtml;
      categorySelect.value = categoryId;
      _masterMenuSelected.category_id = categorySelect.value || '';
    }

    var flavorSelect = $('prod-flavor');
    if (flavorSelect) {
      var flavorHtml = '<option value="">Tidak ada Rasa</option>';
      _masterMenuComponents.flavor.forEach(function(row) {
        var selected = String(_masterMenuSelected.flavor_id || '') === String(row.id);
        if (!row.is_active && !selected) return;
        var suffix = row.is_active ? '' : ' (Nonaktif)';
        flavorHtml += '<option value="' + esc(row.id) + '"' +
          (selected ? ' selected' : '') +
          (row.is_active ? '' : ' data-inactive="1"') + '>' +
          esc(row.name + suffix) + '</option>';
      });
      flavorSelect.innerHTML = flavorHtml;
      flavorSelect.value = _masterMenuSelected.flavor_id || '';
    }

    var levelSelect = $('prod-level');
    if (levelSelect) {
      levelSelect.value = _masterMenuSelected.level_id || '';
    }

    var levelBox = $('prod-level-chips');
    if (levelBox) {
      levelBox._xentraLevelSelect = function(id) {
        if (levelSelect) levelSelect.value = id;
        _masterMenuSelected.level_id = id;
        renderMasterMenuSelectors();
        renderMasterMenuCustomerPreview();
      };
    }

    renderMasterLevelSelector('prod-level-chips', _masterMenuComponents.level,
      String(_masterMenuSelected.level_id || ''));

    var complementBox = $('prod-complements-editor');
    var empty = $('prod-complements-empty');
    if (complementBox) {
      var rows = _masterMenuComponents.complement || [];
      if (!rows.length) {
        // Empty Master Kelengkapan is still an actionable state: show + Add,
        // never a dead-end "belum ada data" message.
        complementBox.innerHTML =
          '<button type="button" class="x-master-choice-chip x-master-choice-add" data-master-choice-add="1" aria-label="Tambah Kelengkapan">' +
            '<span aria-hidden="true">+</span><span>Tambah</span>' +
          '</button>';
        if (empty) {
          empty.hidden = true;
          empty.setAttribute('aria-hidden', 'true');
          empty.style.display = 'none';
        }
      } else {
        if (empty) {
          empty.hidden = true;
          empty.setAttribute('aria-hidden', 'true');
          empty.style.display = 'none';
        }
        var selectedIds = _masterMenuSelected.complement_ids || [];
        complementBox.innerHTML = rows.filter(function(row) {
          return row.is_active || selectedIds.indexOf(String(row.id)) !== -1;
        }).map(function(row) {
          var id = String(row.id);
          var isSelected = selectedIds.indexOf(id) !== -1;
          var suffix = row.is_active ? '' : ' (Nonaktif)';
          return '<button type="button" class="x-master-choice-chip x-master-complement-chip' +
            (isSelected ? ' is-selected' : '') +
            '" data-master-complement-id="' + esc(id) + '"' +
            ' aria-pressed="' + (isSelected ? 'true' : 'false') + '"' +
            ' title="' + esc(row.name + suffix) + '">' +
            esc(row.name + suffix) +
          '</button>';
        }).join('') +
        '<button type="button" class="x-master-choice-chip x-master-choice-add" data-master-choice-add="1" aria-label="Tambah Kelengkapan">' +
          '<span aria-hidden="true">+</span><span>Tambah</span>' +
        '</button>';

        complementBox.querySelectorAll('[data-master-complement-id]').forEach(function(button) {
          button.addEventListener('click', function() {
            var id = String(button.getAttribute('data-master-complement-id') || '');
            var next = (_masterMenuSelected.complement_ids || []).filter(function(existing) {
              return existing !== id;
            });
            if (next.length === (_masterMenuSelected.complement_ids || []).length) next.push(id);
            _masterMenuSelected.complement_ids = next;
            renderMasterMenuSelectors();
            renderMasterMenuCustomerPreview();
          });
        });
      }

    }

    renderMasterMenuCustomerPreview();
  }

  function normalizeLegacyMenuText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/&/g, ' dan ')
      .replace(/[+\\/|,_-]+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function findLegacyMenuMatch(text, rows, excludedIds) {
    var source = normalizeLegacyMenuText(text);
    if (!source) return null;
    var excluded = excludedIds || {};
    return (rows || [])
      .filter(function(row) {
        if (!row || !row.name || excluded[String(row.id)]) return false;
        if (row.is_active === 0) return false;
        var name = normalizeLegacyMenuText(row.name);
        if (!name || name.length < 3) return false;
        return source.indexOf(name) !== -1;
      })
      .sort(function(a, b) {
        var aLen = normalizeLegacyMenuText(a.name).length;
        var bLen = normalizeLegacyMenuText(b.name).length;
        if (bLen !== aLen) return bLen - aLen;
        return String(a.name).localeCompare(String(b.name), 'id');
      })[0] || null;
  }

  function renderMasterMenuComponentManager() {
    var box = $('master-menu-component-list');
    if (!box) return;
    var rows = _masterMenuComponents[_masterMenuComponentType] || [];
    if (!rows.length) {
      box.innerHTML = '<div class="text-muted" style="padding:16px;text-align:center;">Belum ada Master ' + masterMenuComponentTypeLabel(_masterMenuComponentType) + '.</div>';
      return;
    }
    box.innerHTML = rows.map(function(row) {
      var active = row.is_active !== 0;
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid #eef2f7;padding:10px 2px;">' +
        '<div style="min-width:0;"><strong style="font-size:13px;">' + esc(row.name) + '</strong><div class="text-muted" style="font-size:10px;">' + esc(row.slug) + '</div></div>' +
        '<div style="display:flex;gap:6px;flex:0 0 auto;">' +
          '<button type="button" class="x-btn-secondary" data-master-edit="' + esc(row.id) + '" style="font-size:11px;padding:5px 8px;">Edit</button>' +
          '<button type="button" class="x-btn-secondary" data-master-toggle="' + esc(row.id) + '" style="font-size:11px;padding:5px 8px;">' + (active ? 'Nonaktifkan' : 'Aktifkan') + '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    box.querySelectorAll('[data-master-edit]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var id = btn.getAttribute('data-master-edit');
        var current = rows.find(function(row) { return String(row.id) === String(id); });
        if (!current) return;
        var name = await requestTextInputSheet({ title: 'Edit ' + masterMenuComponentTypeLabel(_masterMenuComponentType), label: 'Nama', value: current.name });
        if (name === null) return;
        name = String(name).trim();
        if (!name) return;
        try {
          var res = await adminFetch(API_BASE + '/admin/menu/components/' + _masterMenuComponentType + '/' + encodeURIComponent(id), {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ name: name })
          });
          var data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || 'Gagal mengubah data.');
          showToast('✅ Master ' + masterMenuComponentTypeLabel(_masterMenuComponentType) + ' diperbarui.');
          await loadMasterMenuComponents();
        } catch (err) {
          showToast('❌ ' + err.message);
        }
      });
    });

    box.querySelectorAll('[data-master-toggle]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var id = btn.getAttribute('data-master-toggle');
        try {
          var res = await adminFetch(API_BASE + '/admin/menu/components/' + _masterMenuComponentType + '/' + encodeURIComponent(id) + '/toggle', {
            method: 'PATCH',
            headers: getAuthHeaders()
          });
          var data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || 'Gagal mengubah status.');
          showToast('✅ Status Master ' + masterMenuComponentTypeLabel(_masterMenuComponentType) + ' diperbarui.');
          await loadMasterMenuComponents();
        } catch (err) {
          showToast('❌ ' + err.message);
        }
      });
    });
  }

  function openMasterMenuComponentManager(type) {
    if (type) _masterMenuComponentType = type;
    var modal = $('modal-master-menu-components');
    if (!modal) return;

    var titleEl = modal.querySelector('.x-modal-header h3');
    var subtitleEl = modal.querySelector('.x-modal-header p');
    var labels = {
      flavor: { title: 'Master Rasa', sub: 'Pilihan rasa yang tersedia untuk Item' },
      complement: { title: 'Master Kelengkapan', sub: 'Pilihan kelengkapan yang tersedia untuk Item' },
      level: { title: 'Master Level', sub: 'Pilihan level yang tersedia untuk Item' }
    };
    var meta = labels[_masterMenuComponentType] || { title: 'Master Menu', sub: 'Data pilihan yang dipakai untuk menyusun Produk Master' };
    if (titleEl) titleEl.textContent = meta.title;
    if (subtitleEl) subtitleEl.textContent = meta.sub;

    openExistingCardInPresentation('modal-master-menu-components', 'master-menu-component-manager', 'bottom-sheet');
    renderMasterMenuComponentManager();
  }

  function closeMasterMenuComponentManager() {
    if (window.XentraPresentation && window.XentraPresentation.isOpen('master-menu-component-manager')) {
      window.XentraPresentation.close('master-menu-component-manager');
    } else {
      var modal = $('modal-master-menu-components');
      if (modal) modal.style.display = 'none';
    }
  }

  async function addMasterMenuComponent() {
    var name = await requestTextInputSheet({ title: 'Tambah Master ' + masterMenuComponentTypeLabel(_masterMenuComponentType), label: 'Nama' });
    if (name === null) return;
    name = String(name).trim();
    if (!name) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/menu/components/' + _masterMenuComponentType, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: name })
      });
      var data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Gagal menambah data.');
      showToast('✅ Master ' + masterMenuComponentTypeLabel(_masterMenuComponentType) + ' ditambahkan.');
      await loadMasterMenuComponents();
      _masterMenuSelected = {
        flavor_id: _masterMenuSelected.flavor_id,
        complement_ids: _masterMenuSelected.complement_ids.slice(),
        level_id: _masterMenuSelected.level_id
      };
      if (_masterMenuComponentType === 'flavor') _masterMenuSelected.flavor_id = data.component.id;
      if (_masterMenuComponentType === 'level') _masterMenuSelected.level_id = data.component.id;
      if (_masterMenuComponentType === 'complement' && _masterMenuSelected.complement_ids.indexOf(String(data.component.id)) === -1) {
        _masterMenuSelected.complement_ids.push(String(data.component.id));
      }
      renderMasterMenuSelectors();
    } catch (err) {
      showToast('❌ ' + err.message);
    }
  }

  // Product Image State — explicitly scoped to the Product Editor.
  // The file stays in memory only until the Product save pipeline uploads it.
  var _productImageFile = null;
  var _productCropSpec = null;
  var _productImageRemoved = false;

  // Product Actions
  function setProductImagePreview(src, hasImage) {
    var previewImg = $('prod-image-preview');
    var emptyBox = $('prod-image-empty');
    var btnRemove = $('btn-prod-image-remove');
    var btnPick = $('btn-prod-image-pick');
    if (!previewImg || !emptyBox) return;
    if (hasImage && src) {
      previewImg.src = src;
      previewImg.style.display = 'block';
      emptyBox.style.display = 'none';
      if (btnRemove) btnRemove.style.display = 'inline-block';
      if (btnPick) btnPick.textContent = '\ud83d\udcc1 Ganti Foto';
    } else {
      previewImg.removeAttribute('src');
      previewImg.style.display = 'none';
      emptyBox.style.display = 'flex';
      if (btnRemove) btnRemove.style.display = 'none';
      if (btnPick) btnPick.textContent = '\ud83d\udcc1 Pilih Foto';
    }
    renderMasterMenuCustomerPreview();
  }

  var _productEditorLoadSeq = 0;
  var _productEditorActiveState = 1;

  function updateProductStockManageUI(hasStockManagement) {
    var toggle = $('prod-manage-stock-toggle');
    var container = $('prod-sku-container');
    var skuInput = $('prod-sku');
    var note = $('prod-stock-note');
    if (toggle) toggle.checked = !!hasStockManagement;
    if (container) container.style.display = hasStockManagement ? 'block' : 'none';
    if (skuInput) {
      skuInput.required = !!hasStockManagement;
      if (!hasStockManagement) skuInput.value = '';
    }
    if (note) {
      note.textContent = hasStockManagement
        ? 'data item ini digunakan sebagai acuan inventaris di tiap cabang'
        : 'item non-stock tetap bisa di pakai untuk membuat menu';
    }
  }

  function resetProductEditorForAdd() {
    $('product-editor-title').textContent = 'Tambah Item';
    $('prod-editor-breadcrumb').textContent = 'Tambah Item';
    $('prod-editor-subtitle').textContent = 'Item satuan yang dipakai dan dihitung dalam stok — seperti ayam, ikan, bumbu, dan lainnya.';
    if ($('product-editor-mobile-title')) $('product-editor-mobile-title').textContent = 'Tambah Item';
    if ($('product-editor-mobile-subtitle')) $('product-editor-mobile-subtitle').textContent = 'Item satuan yang dipakai dan dihitung dalam stok — seperti ayam, ikan, bumbu, dan lainnya.';
    $('prod-id').value = '';
    $('prod-name').value = '';
    $('prod-sku').value = '';
    $('prod-desc').value = '';
    if ($('prod-cost-price')) {
      if (window.XentraCurrencyInput) window.XentraCurrencyInput.setValue($('prod-cost-price'), '');
      else $('prod-cost-price').value = '';
    }
    updateProductStockManageUI(false);
    _productEditorActiveState = 1;
    _productImageFile = null;
    _productCropSpec = null;
    _productImageRemoved = false;
    var fileInput = $('prod-image-file');
    if (fileInput) fileInput.value = '';
    setProductImagePreview('', false);
  }

  function populateProductEditorForm(prod) {
    $('product-editor-title').textContent = 'Edit Item: ' + prod.name;
    $('prod-editor-breadcrumb').textContent = prod.name;
    $('prod-editor-subtitle').textContent = 'Perbarui data item. Menu tetap dikelola di workspace Master Menu.';
    if ($('product-editor-mobile-title')) $('product-editor-mobile-title').textContent = 'Edit Item';
    if ($('product-editor-mobile-subtitle')) $('product-editor-mobile-subtitle').textContent = 'Perbarui item tanpa mengubah identitas komersial Menu.';
    $('prod-id').value = prod.id;
    $('prod-name').value = prod.name || '';
    var hasSku = prod.sku != null && String(prod.sku).trim() !== '';
    $('prod-sku').value = hasSku ? String(prod.sku).trim() : '';
    updateProductStockManageUI(hasSku);
    $('prod-desc').value = prod.description || '';
    if ($('prod-cost-price')) {
      var costVal = prod.cost_price != null ? prod.cost_price : '';
      if (window.XentraCurrencyInput) window.XentraCurrencyInput.setValue($('prod-cost-price'), costVal);
      else $('prod-cost-price').value = costVal;
    }
    _productEditorActiveState = (prod.is_active !== undefined && prod.is_active !== null) ? (prod.is_active !== 0 ? 1 : 0) : 1;
    _productImageFile = null;
    _productCropSpec = null;
    _productImageRemoved = false;
    var fileInput = $('prod-image-file');
    if (fileInput) fileInput.value = '';
    var existingImage = prod.image_url || prod.image || '';
    setProductImagePreview(existingImage, existingImage !== '');
  }

  async function loadProductEditorPage(productId) {
    var requestSeq = ++_productEditorLoadSeq;
    showProductEditorSection();

    if (!productId) {
      resetProductEditorForAdd();
      return;
    }

    try {
      // Contract Product (locked) hanya menyediakan LIST canonical:
      // GET /admin/composed/products. Tidak ada GET by-id di contract composed,
      // jadi Product diambil dari list lalu dipilih berdasarkan id — bukan
      // memakai endpoint legacy /admin/products/:id.
      var res = await adminFetch(API_BASE + '/admin/composed/products?active_only=0', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (requestSeq !== _productEditorLoadSeq) return;

      var products = (data && Array.isArray(data.products)) ? data.products : [];
      var product = null;
      for (var i = 0; i < products.length; i += 1) {
        if (String(products[i].id) === String(productId)) { product = products[i]; break; }
      }

      if (!data || !data.success || !product) {
        showToast('❌ ' + ((data && data.error) || 'Product tidak ditemukan.'));
        navigateTo('catalog/products');
        return;
      }

      populateProductEditorForm(product);
    } catch (err) {
      if (requestSeq !== _productEditorLoadSeq) return;
      console.error('[Product Editor Load Error]:', err);
      showToast('❌ Gagal memuat Product Editor.');
    }
  }

  window.openAddProduct = function () {
    navigateTo('catalog/products/new');
  };

  window.openEditProduct = function (id) {
    if (!id) return;
    navigateTo('catalog/products/' + encodeURIComponent(id) + '/edit');
  };

  window.closeProductModal = function () {
    _productEditorLoadSeq++;
    navigateTo('catalog/products', { history: 'replace' });
  };

  window.toggleStock = async function (id, nextActive) {
    try {
      var desiredActive = nextActive === undefined ? true : (nextActive !== 0);
      var res = await adminFetch(API_BASE + '/admin/composed/products/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: desiredActive })
      });
      var data = await res.json();
      if (!res.ok || !data.success) {
        showToast('❌ ' + (data.error || data.message || 'Gagal mengubah status Product.'));
        return;
      }
      showToast('Status Product diperbarui.');
      loadMasterProducts();
      if (_catalogState.activeDetailProductId) {
        loadProductDetailView(_catalogState.activeDetailProductId);
      }
    } catch (e) {
      showToast('Gagal mengubah status Product.');
    }
  };

  window.deleteProduct = async function (id) {
    if (window.XentraPresentation && !await window.XentraPresentation.confirm({
      id: 'archive-master-product',
      title: 'Arsipkan Product Master',
      message: 'Product akan dinonaktifkan dan tetap mempertahankan identitasnya untuk Menu, histori, dan inventory.',
      okLabel: 'Arsipkan',
      cancelLabel: 'Batal'
    })) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/composed/products/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: false })
      });
      var data = await res.json();
      if (!res.ok || !data.success) {
        showToast('❌ ' + (data.error || data.message || 'Gagal mengarsipkan Product.'));
        return;
      }
      showToast('Product Master diarsipkan.');
      if (_catalogState.activeDetailProductId === id) {
        navigateTo('catalog/products');
      } else {
        loadMasterProducts();
      }
    } catch (e) {
      showToast('Gagal mengarsipkan Product.');
    }
  };

async function loadMenusView() {
    var selectedBranchId = _branchContextState.selected;

    var allView = $('menus-all-branches-view');
    var singleView = $('menus-single-branch-view');
    var headerActions = $('menus-header-actions');
    var badge = $('menus-context-badge');
    var subtitle = $('menus-context-subtitle');

    if (selectedBranchId === 'all' || !selectedBranchId) {
      // Show All Branches Overview View
      if (allView) allView.style.display = 'block';
      if (singleView) singleView.style.display = 'none';
      if (headerActions) headerActions.style.display = 'none';
      if (badge) {
        badge.textContent = 'All Branches';
        badge.className = 'x-badge x-badge-info';
      }
      if (subtitle) {
        subtitle.textContent = 'Pilih cabang pada Branch Context selector untuk mengelola menu jual spesifik per cabang.';
      }

      await loadMenusAllBranchesTable();
    } else {
      // Show Single Branch Menu View
      if (allView) allView.style.display = 'none';
      if (singleView) singleView.style.display = 'block';
      if (headerActions) headerActions.style.display = 'flex';

      var b = state.branches.find(function (x) { return String(x.id) === String(selectedBranchId); });
      var branchName = b ? b.name : selectedBranchId;
      if (badge) {
        badge.textContent = 'Cabang: ' + branchName;
        badge.className = 'x-badge x-badge-success';
      }
      if (subtitle) {
        subtitle.textContent = 'Mengatur menu jual, harga override, dan kategori cabang untuk ' + branchName;
      }

      XentraOwnerBranchCatalog.state.branchId = selectedBranchId;
      await loadSingleBranchMenuView(selectedBranchId);
    }
  }

  async function loadMenusAllBranchesTable() {
    var tbody = $('menus-branches-table-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6">Memuat daftar cabang...</td></tr>';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/branches', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data.success && data.branches) {
        state.branches = data.branches;
        populateBranchSelector(data.branches);
      }

      var branches = state.branches || [];
      if (!branches.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Belum ada cabang terdaftar. Buat cabang di menu Branches terlebih dahulu.</td></tr>';
        return;
      }

      // Fetch adoption summary for each branch
      var summaries = await Promise.all(branches.map(async function (b) {
        try {
          var cRes = await adminFetch(API_BASE + '/admin/branches/' + b.id + '/menu', { headers: getAuthHeaders() });
          var cData = await cRes.json();
          var adoptedList = cData.adopted_menus || cData.adopted_products || [];
          return {
            branch: b,
            adoptedCount: adoptedList.length,
            categoryCount: (cData.categories || []).length
          };
        } catch (_) {
          return { branch: b, adoptedCount: 0, categoryCount: 0 };
        }
      }));

      var rows = summaries.map(function (s) {
        var b = s.branch;
        var isOpen = b.is_open_override === 1 || b.is_open_override === true;
        var statusBadge = isOpen
          ? '<span class="x-badge x-badge-success">● Buka</span>'
          : '<span class="x-badge x-badge-warning">○ Tutup</span>';

        return [
          '<tr>',
            '<td><strong>' + esc(b.name) + '</strong></td>',
            '<td><small class="text-muted">' + esc(b.address_text || '-') + '</small></td>',
            '<td>' + statusBadge + '</td>',
            '<td><span class="x-badge x-badge-info">' + s.adoptedCount + ' Menu Aktif</span></td>',
            '<td><span class="x-badge">' + s.categoryCount + ' Kategori</span></td>',
            '<td class="text-right">',
              '<button type="button" class="x-btn-primary" style="padding:6px 12px;font-size:12px;" onclick="switchToBranchMenu(\'' + b.id + '\')">Kelola Menu Cabang ➔</button>',
            '</td>',
          '</tr>'
        ].join('');
      });

      tbody.innerHTML = rows.join('');
    } catch (err) {
      console.error('[Menus All Branches Load Error]:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Gagal memuat daftar cabang.</td></tr>';
    }
  }

  window.switchToBranchMenu = function (branchId) {
    var sel = $('dash-branch-context');
    if (sel) {
      sel.value = branchId;
      _branchContextState.selected = branchId;
    }
    loadMenusView();
  };

  async function loadSingleBranchMenuView(branchId) {
    XentraOwnerBranchCatalog.state.branchId = branchId;

    var adoptedEl = $('menus-branch-adopted-container');
    var availableEl = $('menus-branch-available-container');
    var catsEl = $('menus-branch-categories-bar');
    if (adoptedEl) adoptedEl.innerHTML = '<p class="text-muted" style="font-size:13px;">Memuat menu aktif cabang...</p>';
    if (availableEl) availableEl.innerHTML = '<p class="text-muted" style="font-size:13px;">Memuat rekomendasi Owner...</p>';
    if (catsEl) catsEl.innerHTML = '<span class="text-muted" style="font-size:13px;">Memuat kategori...</span>';

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + branchId + '/menu', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!data.success) {
        showToast('❌ ' + (data.error || 'Gagal memuat katalog menu cabang.'));
        return;
      }

      XentraOwnerBranchCatalog.state.catalogData = data;

      var categories = data.categories || [];
      var adopted = data.adopted_menus || data.adopted_products || [];
      var available = data.available_master_menus || data.available_master_products || [];

      if ($('menus-branch-cat-count')) $('menus-branch-cat-count').textContent = categories.length;
      if ($('menus-branch-active-count')) $('menus-branch-active-count').textContent = adopted.length;
      if ($('menus-branch-available-count')) $('menus-branch-available-count').textContent = available.length;

      renderMenusBranchCategoriesBar(categories);
      renderMenusBranchAdoptedProducts(adopted, XentraOwnerBranchCatalog.state.inlineFilter);
      renderMenusBranchAvailableProducts(available);
    } catch (err) {
      console.error('[Single Branch Menu Load Error]:', err);
      showToast('❌ Kesalahan jaringan saat memuat menu cabang.');
    }
  }

  function renderMenusBranchCategoriesBar(categories) {
    var bar = $('menus-branch-categories-bar');
    if (!bar) return;

    bar.innerHTML = '';

    // "Semua" filter button
    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'x-cat-filter-btn' + (XentraOwnerBranchCatalog.state.inlineFilter === 'all' ? ' active' : '');
    allBtn.style.borderRadius = '20px';
    allBtn.textContent = 'Semua';
    allBtn.addEventListener('click', function () {
      XentraOwnerBranchCatalog.state.inlineFilter = 'all';
      if ($('menus-branch-filter-label')) $('menus-branch-filter-label').textContent = 'Menampilkan semua kategori';
      renderMenusBranchCategoriesBar(categories);
      renderMenusBranchAdoptedProducts(XentraOwnerBranchCatalog.state.catalogData.adopted_products || [], 'all');
    });
    bar.appendChild(allBtn);

    if (!categories.length) {
      var hint = document.createElement('span');
      hint.className = 'text-muted';
      hint.style.fontSize = '12px';
      hint.textContent = 'Belum ada kategori cabang. Klik "+ Tambah Kategori Cabang" untuk membuat.';
      bar.appendChild(hint);
      return;
    }

    categories.forEach(function (cat) {
      var isActive = XentraOwnerBranchCatalog.state.inlineFilter === cat.id;

      var chip = document.createElement('span');
      chip.dataset.catId = cat.id;
      chip.style.cssText = [
        'display:inline-flex;align-items:center;gap:0;border-radius:20px;overflow:hidden;',
        'border:1px solid ' + (isActive ? 'var(--x-primary,#10b981)' : '#e2e8f0') + ';',
        'background:' + (isActive ? '#f0fdf4' : '#f8fafc') + ';',
        'transition:box-shadow 0.15s,opacity 0.15s;'
      ].join('');

      // Category name filter button
      var nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.style.cssText = 'border:none;background:none;padding:6px 10px 6px 12px;font-size:13px;font-weight:' + (isActive ? '700' : '500') + ';cursor:pointer;color:#1e293b;';
      nameBtn.textContent = cat.name;
      nameBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        XentraOwnerBranchCatalog.state.inlineFilter = cat.id;
        if ($('menus-branch-filter-label')) $('menus-branch-filter-label').textContent = 'Filter: ' + cat.name;
        renderMenusBranchCategoriesBar(categories);
        renderMenusBranchAdoptedProducts(XentraOwnerBranchCatalog.state.catalogData.adopted_products || [], cat.id);
      });
      chip.appendChild(nameBtn);

      // Edit category button
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.title = 'Ubah nama & gambar kategori';
      editBtn.style.cssText = 'border:none;background:none;padding:5px 6px;font-size:12px;cursor:pointer;color:#64748b;';
      editBtn.textContent = '✏️';
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openBranchCategoryEditModal(cat);
      });
      chip.appendChild(editBtn);

      // Delete category button
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.title = 'Hapus kategori';
      delBtn.style.cssText = 'border:none;background:none;padding:6px 10px 6px 4px;font-size:12px;cursor:pointer;color:#ef4444;opacity:0.8;';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteBranchCategory(cat.id, cat.name);
      });
      chip.appendChild(delBtn);

      bar.appendChild(chip);
    });
  }

  function renderMenusBranchAdoptedProducts(adopted, filterCatId) {
    var container = $('menus-branch-adopted-container');
    if (!container) return;

    var filtered = adopted;
    if (filterCatId && filterCatId !== 'all') {
      filtered = adopted.filter(function (p) {
        if (p.category_ids && Array.isArray(p.category_ids)) {
          return p.category_ids.map(String).indexOf(String(filterCatId)) !== -1;
        }
        return String(p.branch_category_id) === String(filterCatId);
      });
    }

    if (!filtered.length) {
      var msg = filterCatId && filterCatId !== 'all'
        ? 'Belum ada menu di kategori ini. Adopsi produk dari Master dan pilih kategori ini.'
        : 'Belum ada menu yang diadopsi oleh cabang ini. Pilih dari daftar rekomendasi Master di bawah!';
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">' + msg + '</div>';
      return;
    }

    // FORWARD MENU: card may show Master Menu Composition as read-only; no Branch content overrides.
    container.innerHTML = filtered.map(function (p) {
      var menuId = p.menu_id || p.id;
      var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isAvailable = p.is_available === 1 || p.is_available === true;
      var catName = (p.category_names && p.category_names.length)
        ? p.category_names.join(', ')
        : (p.branch_category_name || 'Tanpa Kategori');
      var modeBadge = p.pricing_mode === 'range'
        ? '<span class="x-badge x-badge-range">Range (' + formatMoney(p.min_price) + ' - ' + formatMoney(p.max_price) + ')</span>'
        : '<span class="x-badge x-badge-lock">Harga Terkunci</span>';

      var availabilityToggle = '' +
        '<label class="x-toggle' + (isAvailable ? ' x-toggle-on' : '') + '" title="' + (isAvailable ? 'Menu tersedia' : 'Menu habis') + '">' +
          '<input type="checkbox" ' + (isAvailable ? 'checked' : '') + ' onchange="toggleBranchMenuAvailability(\'' + esc(menuId) + '\', this.checked ? 1 : 0)" aria-label="Ubah ketersediaan menu cabang">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      return [
        '<div class="x-product-card-simple">',
          '<img src="' + esc(img) + '" class="x-product-card-thumb" alt="' + esc(p.name || p.title) + '">',
          '<div class="x-product-card-content">',
            '<h5>' + esc(p.name || p.title) + '</h5>',
            '<div style="display:flex;gap:4px;flex-wrap:wrap;margin:4px 0;">',
              '<span class="x-badge x-badge-info" style="font-size:10px;">' + esc(catName) + '</span>',
              modeBadge,
            '</div>',
            '<div class="x-product-card-price">Jual: ' + formatMoney(p.price) + ' <small class="text-muted" style="font-weight:normal;">(Owner: ' + formatMoney(p.master_price || p.selling_price || p.price) + ')</small></div>',
            '<div class="x-product-card-actions">',
              '<div>' + availabilityToggle + '</div>',
              '<div class="x-item-actions">',
                '<button type="button" class="x-action-menu-trigger" aria-label="Aksi menu cabang ' + esc(p.name || p.title) + '" onclick="XentraActionMenu.open(this, [' +
                  '{ label: \'Hapus dari Cabang\', icon: \'🗑️\', destructive: true, onClick: function() { removeBranchMenu(\'' + esc(menuId) + '\', \'' + esc(p.name || p.title) + '\'); } }' +
                '])">',
                  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
                '</button>',
              '</div>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function renderMenusBranchAvailableProducts(available) {
    var container = $('menus-branch-available-container');
    if (!container) return;

    if (!available.length) {
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">Semua Master Menu telah diadopsi oleh cabang ini.</div>';
      return;
    }

    container.innerHTML = available.map(function (p) {
      var menuId = p.menu_id || p.id;
      var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isRange = p.pricing_mode === 'range';
      var modeBadge = isRange
        ? '<span class="x-badge x-badge-range">Range (' + formatMoney(p.min_price) + ' - ' + formatMoney(p.max_price) + ')</span>'
        : '<span class="x-badge x-badge-lock">Harga Terkunci</span>';

      return [
        '<div class="x-product-card-simple" style="background:#f8fafc;">',
          '<img src="' + img + '" class="x-product-card-thumb" alt="' + esc(p.name || p.title) + '">',
          '<div class="x-product-card-content">',
            '<h5>' + esc(p.name || p.title) + '</h5>',
            '<div style="margin:4px 0;">' + modeBadge + '</div>',
            '<div class="x-product-card-price">Harga Dasar Master: ' + formatMoney(p.selling_price || p.price) + '</div>',
            '<div class="x-product-card-actions">',
              '<button type="button" class="x-btn-primary" style="padding:6px 12px;font-size:12px;" onclick="openAdoptModal(\'' + esc(menuId) + '\')">＋ Adopsi ke Cabang</button>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function initCatalogListeners() {
    var masterReferenceActionHandler = function (event) {
      var trigger = event.target.closest ? event.target.closest('[data-master-reference-action]') : null;
      if (!trigger) return;

      var type = trigger.getAttribute('data-master-reference-action');
      var id = trigger.getAttribute('data-reference-id');
      if (!type || !id || !XentraActionMenu) return;

      event.preventDefault();
      event.stopPropagation();

      XentraActionMenu.open(trigger, [
        {
          label: 'Edit',
          icon: '✏️',
          onClick: function () {
            if (type === 'category') {
              openEditCategory(id);
            } else {
              openEditMasterReference(type, id);
            }
          }
        },
        {
          label: 'Hapus',
          icon: '🗑️',
          destructive: true,
          onClick: function () { deleteMasterReference(type, id); }
        }
      ]);
    };

    ['master-categories-page-list', 'master-flavors-page-list', 'master-complements-page-list', 'master-levels-page-list', 'master-titles-page-list'].forEach(function (listId) {
      var list = $(listId);
      if (list && !list.dataset.actionMenuBound) {
        list.dataset.actionMenuBound = 'true';
        list.addEventListener('click', masterReferenceActionHandler);
      }
    });

    var referenceTabs = $('master-reference-tabs');
    if (referenceTabs && !referenceTabs.dataset.bound) {
      referenceTabs.dataset.bound = 'true';
      referenceTabs.querySelectorAll('[data-master-reference-tab]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          setMasterReferenceTab(btn.getAttribute('data-master-reference-tab'));
        });
      });
    }

    var btnAddCategoryPage = $('btn-add-master-category-page');
    if (btnAddCategoryPage && !btnAddCategoryPage.dataset.bound) {
      btnAddCategoryPage.dataset.bound = 'true';
      btnAddCategoryPage.addEventListener('click', function() {
        openNewCategory();
      });
    }

    var btnAddFlavorPage = $('btn-add-master-flavor-page');
    if (btnAddFlavorPage && !btnAddFlavorPage.dataset.bound) {
      btnAddFlavorPage.dataset.bound = 'true';
      btnAddFlavorPage.addEventListener('click', function() {
        openMasterReferenceQuickAdd('flavor');
      });
    }

    var btnAddTitlePage = $('btn-add-master-title-page');
    if (btnAddTitlePage && !btnAddTitlePage.dataset.bound) {
      btnAddTitlePage.dataset.bound = 'true';
      btnAddTitlePage.addEventListener('click', function() {
        openMasterReferenceQuickAdd('title');
      });
    }

    // Tab Item menambah item lewat alur tambah-item yang sudah ada (Produk Master),
    // bukan alur master reference — item bukan master teks bebas.
    var btnAddItemPage = $('btn-add-master-item-page');
    if (btnAddItemPage && !btnAddItemPage.dataset.bound) {
      btnAddItemPage.dataset.bound = 'true';
      btnAddItemPage.addEventListener('click', function() {
        if (typeof window.openAddProduct === 'function') window.openAddProduct();
      });
    }

    // Tombol kembali di editor item (header mobile + breadcrumb "Kembali ke Daftar
    // Produk") diarahkan ke Master Category tab Item, bukan history stack.
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

    var btnAddComplementPage = $('btn-add-master-complement-page');
    if (btnAddComplementPage && !btnAddComplementPage.dataset.bound) {
      btnAddComplementPage.dataset.bound = 'true';
      btnAddComplementPage.addEventListener('click', function() {
        openMasterReferenceQuickAdd('complement');
      });
    }

    var btnAddCategoryFromProduct = $('btn-add-master-category-from-product');
    if (btnAddCategoryFromProduct) btnAddCategoryFromProduct.addEventListener('click', function () {
      openMasterReferenceQuickAdd('category');
    });

    var btnAddFlavorFromProduct = $('btn-add-master-flavor-from-product');
    if (btnAddFlavorFromProduct) btnAddFlavorFromProduct.addEventListener('click', function () {
      openMasterReferenceQuickAdd('flavor');
    });

    // Product Master only exposes Add for reference values. Delegate the
    // complement + action so the empty-state fallback and rerendered button
    // always invoke the same create-only flow.
    var complementEditor = $('prod-complements-editor');
    if (complementEditor && !complementEditor.dataset.addBound) {
      complementEditor.dataset.addBound = 'true';
      complementEditor.addEventListener('click', function (event) {
        var addButton = event.target.closest('[data-master-choice-add]');
        if (!addButton) return;
        event.preventDefault();
        openMasterReferenceQuickAdd('complement');
      });
    }

    var closeQuickAdd = $('btn-close-master-reference-quick-add');
    if (closeQuickAdd) closeQuickAdd.addEventListener('click', closeMasterReferenceQuickAdd);

    var cancelQuickAdd = $('btn-cancel-master-reference-quick-add');
    if (cancelQuickAdd) cancelQuickAdd.addEventListener('click', closeMasterReferenceQuickAdd);

    var quickAddForm = $('form-master-reference-quick-add');
    if (quickAddForm) quickAddForm.addEventListener('submit', function (event) {
      event.preventDefault();
      saveMasterReferenceQuickAdd();
    });
    var btnAddCategoryPage = $('btn-add-master-category-page');

    var btnCloseCategoryModal = $('btn-close-master-category');
    if (btnCloseCategoryModal) btnCloseCategoryModal.addEventListener('click', closeMasterCategoryModal);

    var btnCancelCategoryModal = $('btn-cancel-master-category');
    if (btnCancelCategoryModal) btnCancelCategoryModal.addEventListener('click', closeMasterCategoryModal);

    var formMasterCategory = $('form-master-category');
    if (formMasterCategory) formMasterCategory.addEventListener('submit', async function(event) {
      event.preventDefault();

      var id = String($('master-cat-id').value || '').trim();
      var name = String($('master-cat-name').value || '').trim();
      if (!name) return;

      var saveBtn = $('btn-save-master-category');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Menyimpan...';
      }

      try {
        var res = await adminFetch(
          id ? API_BASE + '/admin/categories/' + encodeURIComponent(id) : API_BASE + '/admin/categories',
          {
            method: id ? 'PUT' : 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ name: name })
          }
        );
        var data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Gagal menyimpan kategori.');

        var saved = data.category;
        if (saved) {
          var idx = state.categories.findIndex(function(row) { return String(row.id) === String(saved.id); });
          if (idx >= 0) state.categories[idx] = saved;
          else state.categories.push(saved);
        }

        closeMasterCategoryModal();
        renderMasterCategoriesPage();
        populateProductCategorySelect();
        renderProductCategoryFilterChips();
        renderMasterProductsTable();
        renderMasterMenuCustomerPreview();
        showToast(id ? '✅ Kategori diperbarui.' : '✅ Kategori ditambahkan.');
      } catch (err) {
        showToast('❌ ' + err.message);
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Simpan';
        }
      }
    });

    // ── Category Editor Form & Image Listeners ──
    var btnPickCatImage = $('btn-cat-image-pick');
    var btnRemoveCatImage = $('btn-cat-image-remove');
    var fileInputCatImage = $('cat-image-file');

    if (btnPickCatImage && !btnPickCatImage.dataset.bound) {
      btnPickCatImage.dataset.bound = 'true';
      btnPickCatImage.addEventListener('click', function () {
        if (fileInputCatImage) fileInputCatImage.click();
      });
    }

    if (fileInputCatImage && !fileInputCatImage.dataset.bound) {
      fileInputCatImage.dataset.bound = 'true';
      fileInputCatImage.addEventListener('change', function () {
        var file = fileInputCatImage.files && fileInputCatImage.files[0];
        if (!file) return;

        var allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.');
          fileInputCatImage.value = '';
          return;
        }
        if (file.size > 20 * 1024 * 1024) {
          showToast('❌ Ukuran gambar melebihi batas maksimal 20MB.');
          fileInputCatImage.value = '';
          return;
        }

        _categoryImageFile = file;

        if (XentraCropEditor && typeof XentraCropEditor.open === 'function') {
          XentraCropEditor.open({
            source: file,
            assetType: 'category',
            aspectRatio: 1.0,
            title: 'Potong & Posisikan Foto Kategori (1:1)',
            onConfirm: function (cropSpec, previewDataUrl) {
              _categoryCropSpec = cropSpec;
              _categoryImageRemoved = false;
              if ($('cat-image-removed')) $('cat-image-removed').value = '0';
              setCategoryImagePreview(previewDataUrl || URL.createObjectURL(file), true);
              showToast('✓ Foto kategori disesuaikan.');
            },
            onCancel: function () {
              _categoryImageFile = null;
              _categoryCropSpec = null;
              if (fileInputCatImage) fileInputCatImage.value = '';
            }
          });
        } else {
          _categoryCropSpec = null;
          _categoryImageRemoved = false;
          if ($('cat-image-removed')) $('cat-image-removed').value = '0';
          setCategoryImagePreview(URL.createObjectURL(file), true);
        }
      });
    }

    if (btnRemoveCatImage && !btnRemoveCatImage.dataset.bound) {
      btnRemoveCatImage.dataset.bound = 'true';
      btnRemoveCatImage.addEventListener('click', function () {
        _categoryImageFile = null;
        _categoryCropSpec = null;
        _categoryImageRemoved = true;
        if ($('cat-image-removed')) $('cat-image-removed').value = '1';
        if (fileInputCatImage) fileInputCatImage.value = '';
        setCategoryImagePreview('', false);
      });
    }

    var formCategory = $('form-category');
    if (formCategory && !formCategory.dataset.bound) {
      formCategory.dataset.bound = 'true';
      formCategory.addEventListener('submit', async function (event) {
        event.preventDefault();

        var id = String($('cat-id').value || '').trim();
        var name = String($('cat-name').value || '').trim();
        var description = String($('cat-desc').value || '').trim();

        if (!name) {
          showToast('❌ Nama kategori wajib diisi.');
          return;
        }

        var saveBtn = $('btn-save-category-editor');
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.textContent = 'Menyimpan...';
        }

        try {
          var payload = {
            name: name,
            description: description
          };

          var endpoint = id ? (API_BASE + '/admin/categories/' + encodeURIComponent(id)) : (API_BASE + '/admin/categories');
          var method = id ? 'PUT' : 'POST';

          var res = await adminFetch(endpoint, {
            method: method,
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
          });
          var data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || 'Gagal menyimpan kategori.');

          var savedId = (data.category && data.category.id) || id;
          if (!savedId) {
            showToast('❌ Kategori tersimpan tetapi ID Kategori tidak valid.');
            return;
          }

          if (_categoryImageRemoved && id) {
            var removeRes = await adminFetch(API_BASE + '/admin/media/entity/categories/' + encodeURIComponent(savedId) + '/image', {
              method: 'DELETE',
              headers: getAuthHeaders()
            });
            var removeData = {};
            try { removeData = await removeRes.json(); } catch (_) {}
            if (!removeRes.ok || !removeData.success) {
              console.warn('[Category Media Delete Warn]:', removeData.error);
            }
          }

          if (_categoryImageFile) {
            var base64 = await new Promise(function (resolve, reject) {
              var reader = new FileReader();
              reader.onload = function () { resolve(reader.result); };
              reader.onerror = reject;
              reader.readAsDataURL(_categoryImageFile);
            });

            var mediaPayload = {
              image_base64: base64,
              mime_type: _categoryImageFile.type,
              original_filename: _categoryImageFile.name || null
            };
            if (_categoryCropSpec) mediaPayload.crop_spec = _categoryCropSpec;

            var mediaRes = await adminFetch(API_BASE + '/admin/media/entity/categories/' + encodeURIComponent(savedId) + '/image', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify(mediaPayload)
            });
            var mediaData = {};
            try { mediaData = await mediaRes.json(); } catch (_) {}
            if (!mediaRes.ok || !mediaData.success) {
              showToast('⚠️ Kategori disimpan, namun upload foto gagal: ' + (mediaData.error || 'kesalahan media.'));
            }
          }

          showToast(id ? '✅ Kategori berhasil diperbarui.' : '✅ Kategori baru berhasil ditambahkan.');
          _categoryImageFile = null;
          _categoryCropSpec = null;
          _categoryImageRemoved = false;

          navigateTo('catalog/categories', { history: 'replace' });
        } catch (err) {
          showToast('❌ ' + (err.message || 'Gagal menyimpan kategori.'));
        } finally {
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Simpan Kategori';
          }
        }
      });
    }


    var btnBackFromProductEditor = $('btn-back-from-product-editor');
    if (btnBackFromProductEditor && !btnBackFromProductEditor.dataset.bound) {
      btnBackFromProductEditor.dataset.bound = 'true';
      btnBackFromProductEditor.addEventListener('click', function () {
        goBackFromChildPage();
      });
    }

    var btnCancelProductEditor = $('btn-cancel-product-editor');
    if (btnCancelProductEditor && !btnCancelProductEditor.dataset.bound) {
      btnCancelProductEditor.dataset.bound = 'true';
      btnCancelProductEditor.addEventListener('click', function () {
        navigateTo('catalog/products', { history: 'replace' });
      });
    }

    // Master Products Add buttons
    var btnAddProd = $('btn-add-product');
    if (btnAddProd) btnAddProd.addEventListener('click', window.openAddProduct);
    var btnAddProdMain = $('btn-add-product-main');
    if (btnAddProdMain) btnAddProdMain.addEventListener('click', window.openAddProduct);

    // Search and filter controls for Master Products
    var searchInput = $('prod-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        _catalogState.searchQuery = searchInput.value.trim();
        renderMasterProductsTable();
      });
    }

    var catFilterSelect = $('prod-filter-category');
    if (catFilterSelect) {
      catFilterSelect.addEventListener('change', function () {
        _catalogState.categoryFilter = catFilterSelect.value;
        renderProductCategoryFilterChips();
        renderMasterProductsTable();
      });
    }

    // Back to products from detail view
    var btnBack = $('btn-back-to-products');
    if (btnBack) {
      btnBack.addEventListener('click', function () {
        goBackFromChildPage();
      });
    }

    var btnCreateMenuFromDetail = $('btn-create-menu-from-detail');
    if (btnCreateMenuFromDetail) {
      btnCreateMenuFromDetail.addEventListener('click', function () {
        if (_catalogState.activeDetailProductId) {
          window.createMenuFromProduct(_catalogState.activeDetailProductId);
        }
      });
    }

    var btnEditFromDetail = $('btn-edit-from-detail');
    if (btnEditFromDetail) {
      btnEditFromDetail.addEventListener('click', function () {
        if (_catalogState.activeDetailProductId) {
          navigateTo('catalog/products/' + encodeURIComponent(_catalogState.activeDetailProductId) + '/edit');
        }
      });
    }


  

    // Menus View Buttons
    var btnSwitchAll = $('btn-menus-switch-all');
    if (btnSwitchAll) {
      btnSwitchAll.addEventListener('click', function () {
        var sel = $('dash-branch-context');
        if (sel) {
          sel.value = 'all';
          _branchContextState.selected = 'all';
        }
        loadMenusView();
      });
    }

    var btnMenusAddBranchCat = $('btn-menus-add-branch-category');
    if (btnMenusAddBranchCat) {
      btnMenusAddBranchCat.addEventListener('click', async function () {
        if (!XentraOwnerBranchCatalog.state.branchId) {
          showToast('❌ Pilih cabang terlebih dahulu.');
          return;
        }
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
            showToast('✅ Kategori cabang berhasil dibuat!');
            loadMenusView();
          } else {
            showToast('❌ ' + (data.error || 'Gagal membuat kategori.'));
          }
        } catch (err) {
          showToast('❌ Kesalahan jaringan.');
        }
      });
    }

    // Master Product Image Picker
    var btnPick = $('btn-prod-image-pick');
    var prodFileInput = $('prod-image-file');
    var btnRemoveProd = $('btn-prod-image-remove');
    if (btnPick && prodFileInput) {
      btnPick.addEventListener('click', function () { prodFileInput.click(); });
      prodFileInput.addEventListener('change', function () {
        var file = prodFileInput.files && prodFileInput.files[0];
        if (!file) { _productImageFile = null; _productCropSpec = null; return; }
        _productImageRemoved = false;
        _productCropSpec = null;

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.');
          prodFileInput.value = '';
          return;
        }
        if (file.size > 20 * 1024 * 1024) {
          showToast('❌ Ukuran gambar melebihi batas maksimal 20MB.');
          prodFileInput.value = '';
          return;
        }

        _productImageFile = file;

        // Open reusable Crop Editor (M2)
        XentraCropEditor.open({
          source: file,
          assetType: 'product',
          aspectRatio: 1.0,
          title: 'Potong & Posisikan Foto Product (1:1)',
          onConfirm: function (cropSpec, previewDataUrl) {
            _productCropSpec = cropSpec;
            setProductImagePreview(previewDataUrl || URL.createObjectURL(file), true);
            showToast('✓ Potongan foto Product disesuaikan.');
          },
          onCancel: function () {
            _productImageFile = null;
            _productCropSpec = null;
            if (prodFileInput) prodFileInput.value = '';
          }
        });
      });
    }

    if (btnRemoveProd) {
      btnRemoveProd.addEventListener('click', function () {
        _productImageFile = null;
        _productCropSpec = null;
        _productImageRemoved = true;
        if (prodFileInput) prodFileInput.value = '';
        setProductImagePreview('', false);
      });
    }

    var stockManageToggle = $('prod-manage-stock-toggle');
    if (stockManageToggle && !stockManageToggle.dataset.bound) {
      stockManageToggle.dataset.bound = 'true';
      stockManageToggle.addEventListener('change', function () {
        updateProductStockManageUI(stockManageToggle.checked);
        if (stockManageToggle.checked) {
          var skuInput = $('prod-sku');
          if (skuInput) skuInput.focus();
        }
      });
    }

    // Item name is a first-class Master Item identity and the
    // authoritative Customer card title. Kategori is only the grouping/reference.
    // Form Master Item Submit
    // Canonical Product Editor submit: Product owns only atomic identity
    // Canonical Item Editor submit: Item owns only atomic identity,
    // SKU/media, internal description, and lifecycle. Menu owns customer
    // taxonomy, selling price, and commercial presentation.
    var formProduct = $('form-product');
    if (formProduct) {
      formProduct.addEventListener('submit', async function (e) {
        e.preventDefault();

        var id = $('prod-id').value;
        var manageStock = $('prod-manage-stock-toggle') ? $('prod-manage-stock-toggle').checked : false;
        var rawSku = String($('prod-sku').value || '').trim();
        if (manageStock && !rawSku) {
          showToast('❌ SKU wajib diisi jika kelola stok diaktifkan.');
          var skuEl = $('prod-sku');
          if (skuEl) skuEl.focus();
          return;
        }
        var sku = manageStock ? rawSku : null;
        var costPrice = null;
        if ($('prod-cost-price')) {
          var rawCost = window.XentraCurrencyInput ? window.XentraCurrencyInput.getValue($('prod-cost-price')) : $('prod-cost-price').value.replace(/\D/g, '');
          costPrice = rawCost !== '' && !isNaN(Number(rawCost)) ? Number(rawCost) : null;
        }
        var payload = {
          name: $('prod-name').value.trim(),
          sku: sku || null,
          cost_price: costPrice,
          description: $('prod-desc').value,
          is_active: id ? _productEditorActiveState : 1
        };

        if (!payload.name) {
          showToast('❌ Nama Item wajib diisi.');
          return;
        }

        var url = id
          ? (API_BASE + '/admin/composed/products/' + encodeURIComponent(id))
          : (API_BASE + '/admin/composed/products');
        var method = id ? 'PUT' : 'POST';

        try {
          var res = await adminFetch(url, {
            method: method,
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
          });
          var data = await res.json();
          if (!res.ok || !data.success) {
            var errCode = data.error || data.message || '';
            var errMsg = 'Gagal menyimpan Item.';
            if (errCode === 'PRODUCT_SKU_REMOVAL_BLOCKED_STOCK') {
              errMsg = 'Item ini masih memiliki stok di cabang. Nolkan stok terlebih dahulu sebelum mematikan pengelolaan stok (SKU).';
            } else if (errCode === 'PRODUCT_SKU_ALREADY_EXISTS') {
              errMsg = 'SKU sudah digunakan oleh Item lain.';
            } else if (errCode) {
              errMsg = errCode;
            }
            showToast('❌ ' + errMsg);
            return;
          }

          var savedId = (data.product && data.product.id) || id;
          if (!savedId) {
            showToast('❌ Item tersimpan tetapi ID Item tidak kembali dari server.');
            return;
          }

          if (_productImageRemoved) {
            var removeRes = await adminFetch(API_BASE + '/admin/media/entity/products/' + encodeURIComponent(savedId) + '/image', {
              method: 'DELETE',
              headers: getAuthHeaders()
            });
            var removeData = {};
            try {
              removeData = await removeRes.json();
            } catch (_) {
              removeData = { success: false, error: 'Gagal membaca respons penghapusan foto (HTTP ' + removeRes.status + ').' };
            }
            if (!removeRes.ok || !removeData.success) {
              showToast('❌ ' + (removeData.error || removeData.message || 'Gagal menghapus foto Product.'));
              return;
            }
          }

          if (_productImageFile && !_productImageRemoved) {
            var base64 = await new Promise(function (resolve, reject) {
              var imgReader = new FileReader();
              imgReader.onload = function () { resolve(imgReader.result); };
              imgReader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
              imgReader.readAsDataURL(_productImageFile);
            });

            var imagePayload = {
              image_base64: base64,
              mime_type: _productImageFile.type,
              original_filename: _productImageFile.name || null
            };
            if (_productCropSpec) imagePayload.crop_spec = _productCropSpec;

            var imageRes = await adminFetch(API_BASE + '/admin/media/entity/products/' + encodeURIComponent(savedId) + '/image', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify(imagePayload)
            });
            var imageData = {};
            try {
              imageData = await imageRes.json();
            } catch (_) {
              imageData = { success: false, error: 'Upload foto Product gagal (HTTP ' + imageRes.status + ').' };
            }
            if (!imageRes.ok || !imageData.success) {
              showToast('❌ ' + (imageData.error || imageData.message || 'Gagal mengunggah foto Item.'));
              return;
            }
          }

          showToast('✅ Item berhasil disimpan.');
          await loadMasterProducts();
          navigateTo('catalog/categories', { history: 'replace' });
        } catch (err) {
          showToast('❌ ' + ((err && err.message) || 'Gagal menyimpan Item.'));
        }
      });
    }
  }

  /* =========================================================================
     MODUL 3: CABANG & PENGATURAN ONGKIR CONTROLLER
     ========================================================================= */
  /* =========================================================================
     MODUL 3: CABANG & PENGATURAN ONGKIR CONTROLLER
     ========================================================================= */
  async function loadBranches() {
    try {
      var res = await adminFetch(API_BASE + '/admin/branches', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data.success && data.branches) {
        state.branches = data.branches;
        renderBranchesGrid();
      }
    } catch (e) {
      console.warn('[Branches Load Warn]:', e);
    }
  }

  function renderBranchesGrid() {
    var container = $('branches-list-container');
    if (!container) return;

    var q = (_branchSearchQuery || '').toLowerCase();
    var statusFilter = _branchStatusFilter || 'all';

    var filtered = state.branches.filter(function (b) {
      if (q) {
        var nameMatch = (b.name || '').toLowerCase().indexOf(q) !== -1;
        var addrMatch = (b.address_text || '').toLowerCase().indexOf(q) !== -1;
        if (!nameMatch && !addrMatch) return false;
      }
      if (statusFilter === 'active') {
        if (b.is_active !== 1 && b.is_active !== true) return false;
      } else if (statusFilter === 'inactive') {
        if (b.is_active === 1 || b.is_active === true) return false;
      } else if (statusFilter === 'open') {
        var isOpen = b.is_open_override === 1 || b.is_open_override === true || b.is_open_override == null;
        if (!isOpen) return false;
      } else if (statusFilter === 'closed') {
        var isOpen2 = b.is_open_override === 1 || b.is_open_override === true || b.is_open_override == null;
        if (isOpen2) return false;
      }
      return true;
    });

    if (!filtered.length) {
      container.innerHTML = '<div class="text-muted text-center py-6">Tidak ada cabang yang cocok dengan pencarian / filter.</div>';
      return;
    }

    var html = filtered.map(function (b) {
      var isGloballyActive = b.is_active === 1 || b.is_active === true;
      var isOpen = b.is_open_override === 1 || b.is_open_override === true || b.is_open_override == null;

      var openBadge = isOpen
        ? '<span class="x-badge x-badge-info" style="font-size:11px;">Buka Operasional</span>'
        : '<span class="x-badge x-badge-warning" style="font-size:11px;">Tutup Operasional</span>';

      var toggleSwitch = '' +
        '<label class="x-toggle' + (isGloballyActive ? ' x-toggle-on' : '') + '">' +
          '<input type="checkbox" ' + (isGloballyActive ? 'checked' : '') + ' onchange="toggleBranchActivation(\'' + b.id + '\', this.checked)" aria-label="Aktifkan atau nonaktifkan cabang">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      return [
        '<div class="x-branch-card' + (isGloballyActive ? '' : ' style="opacity:0.85;background:#f8fafc;"') + '">',
          '<div class="x-branch-card-header">',
            '<div>',
              '<h4 style="display:inline-block;margin-right:8px;"><a href="#branches/' + b.id + '" style="color:var(--text-main);text-decoration:none;" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + esc(b.name) + '</a></h4>',
              openBadge,
            '</div>',
            '<div>' + toggleSwitch + '</div>',
          '</div>',
          '<p class="text-muted" style="font-size:13px;">📍 ' + esc(b.address_text || '') + '</p>',
          '<div class="x-branch-detail-row"><span>📱 WhatsApp Cabang:</span><span style="font-weight:600;color:var(--x-primary);">' + (b.phone || b.whatsapp_number || '<span style="color:#ef4444;">(Wajib diisi)</span>') + '</span></div>',
          '<div class="x-branch-detail-row"><span>Koordinat GPS:</span><span>' + (b.latitude || 0) + ', ' + (b.longitude || 0) + '</span></div>',
          '<div class="x-branch-detail-row"><span>Gratis Ongkir:</span><span style="color:#10b981;">' + (b.free_delivery_km || 0) + ' KM Pertama Gratis</span></div>',
          '<div class="x-branch-detail-row"><span>Tarif per KM:</span><span>' + formatMoney(b.price_per_km || 3000) + ' / km</span></div>',
          '<div class="x-branch-detail-row"><span>Radius Maksimal:</span><span>' + (b.max_radius_km || 12) + ' KM</span></div>',
          '<div class="x-branch-detail-row"><span>Promo Diskon Ongkir:</span><span>Diskon ' + formatMoney(b.promo_delivery_discount || 10000) + ' (Min. ' + formatMoney(b.promo_min_order || 50000) + ')</span></div>',
          '<div class="x-branch-actions-row">',
            '<div class="x-branch-primary-actions">',
              '<button type="button" class="x-btn-secondary" style="font-size:12px;font-weight:700;color:#0284c7;" onclick="navigateTo(\'branches/' + b.id + '\')">Detail Cabang ➔</button>',
            '</div>',
            '<div class="x-item-actions">',
              '<button type="button" class="x-action-menu-trigger" aria-label="Aksi cabang ' + esc(b.name) + '" onclick="XentraActionMenu.open(this, [' +
                '{ label: \'Detail Cabang\', icon: \'🏢\', onClick: function() { navigateTo(\'branches/' + b.id + '\'); } },' +
                '{ label: \'Edit Profil Cabang\', icon: \'✏️\', onClick: function() { openBranchModal(\'' + b.id + '\'); } },' +
                '{ label: \'Kelola Menu Cabang\', icon: \'📋\', onClick: function() { openBranchCatalogModal(\'' + b.id + '\'); } },' +
                '{ divider: true },' +
                '{ label: \'' + (isGloballyActive ? 'Hapus Cabang' : 'Arsipkan / Hapus Cabang') + '\', icon: \'🗑️\', destructive: true, onClick: function() { deleteBranch(\'' + b.id + '\'); } }' +
              '])">',
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
              '</button>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    });

    container.innerHTML = html.join('');
  }

  /* =========================================================================
     BRANCH SEARCH & FILTER STATE
     ========================================================================= */
  var _branchSearchQuery = '';
  var _branchStatusFilter = 'all';

  function initBranchSearchAndFilter() {
    var searchInput = $('branch-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        _branchSearchQuery = searchInput.value.trim();
        renderBranchesGrid();
      });
    }

    var filterSelect = $('branch-filter-status');
    if (filterSelect) {
      filterSelect.addEventListener('change', function () {
        _branchStatusFilter = filterSelect.value;
        renderBranchesGrid();
      });
    }
  }

  /* =========================================================================
     BRANCH DETAIL VIEW CONTROLLER (Overview, Operations, Menu, Team, Reports)
     ========================================================================= */
  var _activeBranchDetailId = null;
  var _activeBranchDetailSubtab = 'overview';
  var _activeBranchDetailData = null;

  function showBranchListView() {
    var listView = $('branch-list-view');
    var detailView = $('branch-detail-view');
    var editorView = $('branch-editor-view');
    if (listView) listView.style.display = 'block';
    if (detailView) detailView.style.display = 'none';
    if (editorView) editorView.style.display = 'none';
  }

  function showBranchDetailView() {
    var listView = $('branch-list-view');
    var detailView = $('branch-detail-view');
    var editorView = $('branch-editor-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';
    if (editorView) editorView.style.display = 'none';
  }

  async function showBranchEditorView(branchId) {
    var listView = $('branch-list-view');
    var detailView = $('branch-detail-view');
    var editorView = $('branch-editor-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'none';
    if (!editorView) return;
    editorView.style.display = 'block';

    var b = branchId ? (state.branches.find(function (x) { return String(x.id) === String(branchId); }) || null) : null;
    if (branchId && !b) {
      try {
        var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId), { headers: getAuthHeaders() });
        var data = await res.json();
        if (data && data.success && data.branch) b = data.branch;
      } catch (err) {
        showToast('❌ Gagal memuat data cabang untuk diedit.');
        navigateTo('branches');
        return;
      }
    }
    if (branchId && !b) {
      showToast('❌ Cabang tidak ditemukan.');
      navigateTo('branches');
      return;
    }
    $('branch-id').value = b ? b.id : '';
    $('branch-name').value = b ? (b.name || '') : '';
    $('branch-address').value = b ? (b.address_text || '') : '';
    $('branch-phone').value = b ? (b.whatsapp_number || b.phone || '') : '';
    $('branch-latitude').value = b ? Number(b.latitude || 0) : '';
    $('branch-longitude').value = b ? Number(b.longitude || 0) : '';
    $('branch-free-km').value = b ? (b.free_delivery_km != null ? b.free_delivery_km : 0) : 0;
    $('branch-price-km').value = b ? (b.price_per_km != null ? b.price_per_km : 3000) : 3000;
    $('branch-radius').value = b ? (b.max_radius_km != null ? b.max_radius_km : 10) : 10;
    $('branch-promo-minorder').value = b ? (b.promo_min_order != null ? b.promo_min_order : 50000) : 50000;
    $('branch-promo-discount').value = b ? (b.promo_delivery_discount != null ? b.promo_delivery_discount : 0) : 0;
    $('branch-open-override').checked = b ? !(b.is_open_override === 0 || b.is_open_override === false) : true;
    $('branch-editor-title').textContent = b ? ('Edit Cabang: ' + (b.name || '')) : 'Tambah Cabang';
    $('branch-editor-breadcrumb').textContent = b ? 'Edit Cabang' : 'Tambah Cabang';
    if ($('branch-editor-mobile-title')) $('branch-editor-mobile-title').textContent = b ? 'Edit Cabang' : 'Tambah Cabang';
    setTimeout(function () { $('branch-name').focus(); }, 40);
  }

  window.switchBranchDetailSubtab = function (subtab) {
    _activeBranchDetailSubtab = subtab || 'overview';

    // Update subnav buttons
    var subnav = $('branch-detail-subnav');
    if (subnav) {
      subnav.querySelectorAll('.x-cat-filter-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.subtab === _activeBranchDetailSubtab);
      });
    }

    // Toggle subtab panels
    document.querySelectorAll('.branch-subtab-content').forEach(function (p) {
      p.style.display = p.id === 'branch-subtab-' + _activeBranchDetailSubtab ? 'block' : 'none';
    });

    if (_activeBranchDetailId) {
      var targetHash = _activeBranchDetailSubtab === 'overview'
        ? ('branches/' + _activeBranchDetailId)
        : ('branches/' + _activeBranchDetailId + '/' + _activeBranchDetailSubtab);
      if (window.location.hash !== '#' + targetHash) {
        window.location.hash = targetHash;
      }
    }
  };

  async function loadBranchDetail(branchId, subtab) {
    _activeBranchDetailId = branchId;
    _activeBranchDetailSubtab = subtab || 'overview';
    showBranchDetailView();
    window.switchBranchDetailSubtab(_activeBranchDetailSubtab);

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!data.success || !data.branch) {
        showToast('❌ ' + (data.error || 'Cabang tidak ditemukan.'));
        navigateTo('branches');
        return;
      }

      var b = data.branch;
      _activeBranchDetailData = b;

      // Update header
      if ($('branch-detail-breadcrumb')) $('branch-detail-breadcrumb').textContent = b.name;
      if ($('branch-detail-title')) $('branch-detail-title').textContent = b.name;
      if ($('branch-detail-address')) $('branch-detail-address').textContent = '📍 ' + (b.address_text || '-');

      var isGloballyActive = b.is_active === 1 || b.is_active === true;
      var isOpen = b.is_open_override === 1 || b.is_open_override === true || b.is_open_override == null;

      var activeBadge = $('branch-detail-active-badge');
      if (activeBadge) {
        activeBadge.className = 'x-badge ' + (isGloballyActive ? 'x-badge-success' : 'x-badge-warning');
        activeBadge.textContent = isGloballyActive ? 'Aktif di Sistem' : 'Nonaktif';
      }

      var openBadge = $('branch-detail-open-badge');
      if (openBadge) {
        openBadge.className = 'x-badge ' + (isOpen ? 'x-badge-info' : 'x-badge-warning');
        openBadge.textContent = isOpen ? 'Buka Operasional' : 'Tutup Operasional';
      }

      var editBtn = $('btn-edit-branch-detail');
      if (editBtn) {
        editBtn.onclick = function () { openBranchModal(b.id); };
      }

      // Overview Tab Values
      if ($('branch-overview-op-status')) {
        $('branch-overview-op-status').innerHTML = isOpen
          ? '<span style="color:#0284c7;">● Buka</span>'
          : '<span style="color:#eab308;">○ Tutup</span>';
      }
      if ($('branch-overview-op-sub')) {
        $('branch-overview-op-sub').textContent = isGloballyActive ? 'Cabang aktif menerima pesanan' : 'Cabang dinonaktifkan secara global';
      }
      if ($('branch-overview-menu-count')) $('branch-overview-menu-count').textContent = (b.adopted_products_count || 0) + ' Menu';
      if ($('branch-overview-cat-count')) $('branch-overview-cat-count').textContent = (b.branch_categories_count || 0) + ' Kategori Cabang';
      if ($('branch-overview-staff-count')) $('branch-overview-staff-count').textContent = (b.staff_count || 0) + ' Anggota';
      if ($('branch-overview-orders-count')) $('branch-overview-orders-count').textContent = (b.total_orders || 0) + ' Order';
      if ($('branch-overview-active-orders')) $('branch-overview-active-orders').textContent = (b.active_orders || 0) + ' order aktif';

      if ($('branch-overview-id')) $('branch-overview-id').textContent = b.id;
      if ($('branch-overview-wa')) $('branch-overview-wa').textContent = b.phone || b.whatsapp_number || '-';
      if ($('branch-overview-coords')) $('branch-overview-coords').textContent = (b.latitude || 0) + ', ' + (b.longitude || 0);

      var deliv = b.is_delivery_active !== 0;
      var pick = b.is_pickup_active !== 0;
      var fulfillText = [];
      if (deliv) fulfillText.push('Delivery');
      if (pick) fulfillText.push('Pickup');
      if ($('branch-overview-fulfillment')) $('branch-overview-fulfillment').textContent = fulfillText.join(' & ') || 'None';
      if ($('branch-overview-radius')) $('branch-overview-radius').textContent = (b.max_radius_km || 10) + ' KM';
      if ($('branch-overview-rate')) $('branch-overview-rate').textContent = formatMoney(b.price_per_km || 3000) + ' / km';

      // Operations Tab form
      if ($('op-is-active')) $('op-is-active').checked = isGloballyActive;
      if ($('op-is-open-override')) $('op-is-open-override').checked = isOpen;
      if ($('op-is-delivery')) $('op-is-delivery').checked = deliv;
      if ($('op-is-pickup')) $('op-is-pickup').checked = pick;

      // Menu Tab Jump button
      var jumpBtn = $('btn-jump-to-menus');
      if (jumpBtn) {
        jumpBtn.onclick = function () {
          var sel = $('dash-branch-context');
          if (sel) {
            sel.value = b.id;
            _branchContextState.selected = b.id;
          }
          navigateTo('catalog/menus');
        };
      }

      // Load sub-content
      loadBranchMenuPreview(b.id);
      loadBranchTeamPreview(b.id);
    } catch (err) {
      console.error('[Load Branch Detail Error]:', err);
      showToast('❌ Gagal memuat detail cabang.');
    }
  }

  async function loadBranchMenuPreview(branchId) {
    var tbody = $('branch-menu-preview-tbody');
    if (!tbody) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/catalog', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      var adopted = (data && data.adopted_products) || [];
      if (!adopted.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Belum ada menu yang diadopsi oleh cabang ini.</td></tr>';
        return;
      }
      tbody.innerHTML = adopted.map(function (p) {
        var isAvail = p.is_available === 1 || p.is_available === true;
        var availBadge = isAvail
          ? '<span class="x-badge x-badge-success">● Tersedia</span>'
          : '<span class="x-badge x-badge-warning">○ Habis</span>';
        var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=60';
        return [
          '<tr>',
            '<td><div style="display:flex;align-items:center;gap:10px;"><img src="' + esc(img) + '" class="x-table-thumb"><div><strong>' + esc(p.name) + '</strong>' + (p.name !== p.master_name ? '<br><small class="text-muted">Master: ' + esc(p.master_name) + '</small>' : '') + '</div></div></td>',
            '<td><span class="x-badge x-badge-info">' + esc(p.category_name || 'Umum') + '</span></td>',
            '<td><strong>' + formatMoney(p.price) + '</strong></td>',
            '<td>' + (p.stock != null ? p.stock : '100') + '</td>',
            '<td>' + availBadge + '</td>',
          '</tr>'
        ].join('');
      }).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Menu cabang belum dapat dimuat.</td></tr>';
    }
  }

  async function loadBranchTeamPreview(branchId) {
    var tbody = $('branch-team-preview-tbody');
    if (!tbody) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/users?branch_id=' + encodeURIComponent(branchId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      var users = (data && data.users) || [];
      if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">Belum ada staf yang terdaftar di cabang ini.</td></tr>';
        return;
      }
      tbody.innerHTML = users.map(function (u) {
        var statusBadge = u.status === 'active'
          ? '<span class="x-badge x-badge-success">Aktif</span>'
          : '<span class="x-badge x-badge-warning">' + esc(u.status || '-') + '</span>';
        return [
          '<tr>',
            '<td><strong>' + esc(u.full_name || u.username) + '</strong></td>',
            '<td>' + esc(u.username) + '</td>',
            '<td><span class="x-badge x-badge-info">' + esc(u.role) + '</span></td>',
            '<td>' + statusBadge + '</td>',
          '</tr>'
        ].join('');
      }).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">Staf cabang belum dapat dimuat.</td></tr>';
    }
  }

  function initBranchOperationsForm() {
    var form = $('form-branch-operations');
    if (!form) return;
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!_activeBranchDetailId) return;

      var btn = $('btn-save-branch-operations');
      if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

      var payload = {
        is_active: $('op-is-active').checked ? 1 : 0,
        is_open_override: $('op-is-open-override').checked ? 1 : 0,
        is_delivery_active: $('op-is-delivery').checked ? 1 : 0,
        is_pickup_active: $('op-is-pickup').checked ? 1 : 0
      };

      try {
        var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(_activeBranchDetailId), {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (res.ok && data.success) {
          showToast('✅ Pengaturan operasional cabang berhasil disimpan.');
          loadBranchDetail(_activeBranchDetailId, 'operations');
          loadBranches();
        } else {
          showToast('❌ ' + ((data && (data.error || data.message)) || 'Gagal menyimpan operasional cabang.'));
        }
      } catch (err) {
        showToast('❌ Kesalahan jaringan.');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Simpan Perubahan Operasional'; }
      }
    });
  }



  window.toggleBranchActivation = async function (id, isChecked) {
    var nextActive = isChecked ? 1 : 0;
    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + id, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: nextActive })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast(nextActive ? '✅ Cabang telah aktif.' : '⛔ Cabang telah nonaktif.');
        loadBranches();
      } else {
        alert((data && (data.message || data.error)) || 'Gagal mengubah status cabang.');
        loadBranches();
      }
    } catch (err) {
      if (err.status === 401) return;
      alert('Terjadi kesalahan saat mengubah status cabang: ' + err.message);
      loadBranches();
    }
  };

  window.openBranchModal = function (branchId) {
    navigateTo(branchId ? ('branches/' + encodeURIComponent(branchId) + '/edit') : 'branches/new');
  };

  window.closeBranchModal = function () {
    navigateTo('branches');
  };

  window.deleteBranch = async function (branchId) {
    var b = state.branches.find(function (x) { return x.id === branchId; }) || {};
    var isActive = b.is_active === 1 || b.is_active === true;
    var confirmMsg = isActive
      ? 'Yakin ingin menghapus cabang "' + (b.name || branchId) + '"?\n\nCabang aktif hanya dapat dihapus jika tidak ada pesanan aktif yang sedang berjalan.'
      : 'Yakin ingin memproses cabang "' + (b.name || branchId) + '"?\n\n• Jika ada riwayat transaksi → cabang akan diarsipkan (data aman).\n• Jika tidak ada riwayat → cabang akan dihapus permanen.';
    var confirmed = window.XentraPresentation && typeof window.XentraPresentation.confirm === 'function'
      ? await window.XentraPresentation.confirm({ id: 'delete-branch', title: 'Proses Cabang', message: confirmMsg, okLabel: 'Lanjutkan', cancelLabel: 'Batal' })
      : await confirmFeatureAction('delete-branch-fallback', 'Proses Cabang', confirmMsg, 'Lanjutkan');
    if (!confirmed) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!res.ok || !data.success) {
        alert((data && (data.error || data.message)) || 'Gagal memproses cabang.');
        return;
      }
      if (data.archived) {
        showToast('📦 Cabang berhasil diarsipkan. Riwayat transaksi tetap tersimpan.');
      } else {
        showToast('✅ Cabang berhasil dihapus permanen.');
      }
      loadBranches();
    } catch (err) {
      if (err.status === 401) return;
      alert('Terjadi kesalahan saat memproses cabang: ' + err.message);
    }
  };


  var formBranchEl = $('form-branch');
  if (formBranchEl) {
    formBranchEl.addEventListener('submit', async function (e) {
      e.preventDefault();
      var id = $('branch-id').value;
      var payload = {
        name: $('branch-name').value.trim(),
        address_text: $('branch-address').value.trim(),
        phone: $('branch-phone').value.trim(),
        whatsapp_number: $('branch-phone').value.trim(),
        latitude: $('branch-latitude').value !== '' ? Number($('branch-latitude').value) : 0,
        longitude: $('branch-longitude').value !== '' ? Number($('branch-longitude').value) : 0,
        free_delivery_km: $('branch-free-km').value !== '' ? Number($('branch-free-km').value) : 0,
        price_per_km: $('branch-price-km').value !== '' ? Number($('branch-price-km').value) : 3000,
        max_radius_km: $('branch-radius').value !== '' ? Number($('branch-radius').value) : 10,
        promo_min_order: $('branch-promo-minorder').value !== '' ? Number($('branch-promo-minorder').value) : 50000,
        promo_delivery_discount: $('branch-promo-discount').value !== '' ? Number($('branch-promo-discount').value) : 0,
        is_open_override: $('branch-open-override').checked ? 1 : 0
      };

      var btn = this.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

      try {
        var url = id ? (API_BASE + '/admin/branches/' + encodeURIComponent(id)) : (API_BASE + '/admin/branches');
        var method = id ? 'PUT' : 'POST';
        var res = await adminFetch(url, {
          method: method,
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (!res.ok || !data.success) {
          alert((data && (data.message || data.error)) || 'Gagal menyimpan cabang.');
          return;
        }
        showToast(id ? '✅ Perubahan cabang disimpan.' : '✅ Cabang baru berhasil ditambahkan.');
        navigateTo('branches');
        loadBranches();
      } catch (err) {
        if (err.status === 401) return;
        alert('Terjadi kesalahan saat menyimpan cabang: ' + err.message);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Simpan Cabang'; }
      }
    });
  }

  /* =========================================================================
     MODUL 4: PESANAN CONTROLLER (ORDER LIST & ORDER DETAIL)
     ========================================================================= */
  var _ordersSearchQuery = '';
  var _ordersStatusFilter = 'all';
  var _ordersChannelFilter = 'all';
  var _ordersFulfillmentFilter = 'all';
  var _activeDetailOrderId = null;

  function showOrdersListView() {
    var listView = $('orders-list-view');
    var detailView = $('order-detail-view');
    if (listView) listView.style.display = 'block';
    if (detailView) detailView.style.display = 'none';
  }

  function showOrderDetailView() {
    var listView = $('orders-list-view');
    var detailView = $('order-detail-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';
  }

  var _ordersFetchSeq = 0;
  var _ordersPollTimer = null;

  function stopOrdersPolling() {
    if (_ordersPollTimer) {
      clearInterval(_ordersPollTimer);
      _ordersPollTimer = null;
    }
  }

  function startOrdersPolling() {
    stopOrdersPolling();
    _ordersPollTimer = setInterval(function () {
      if (document.visibilityState === 'hidden') return;
      loadOrders({ background: true });
    }, 10000);
  }

  // Expose to window for testing and lifecycle hooks
  window.startOrdersPolling = startOrdersPolling;
  window.stopOrdersPolling = stopOrdersPolling;

  async function loadOrders(opts) {
    var isBg = opts && opts.background;
    var tbody = $('orders-table-body');
    if (tbody && !isBg && (!state.orders || !state.orders.length)) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6">Memuat data pesanan...</td></tr>';
    }

    var currentSeq = ++_ordersFetchSeq;

    try {
      var queryParams = [];
      if (_branchContextState && _branchContextState.selected && _branchContextState.selected !== 'all') {
        queryParams.push('branch_id=' + encodeURIComponent(_branchContextState.selected));
      }
      if (_ordersStatusFilter && _ordersStatusFilter !== 'all') {
        queryParams.push('status=' + encodeURIComponent(_ordersStatusFilter));
      }
      if (_ordersChannelFilter && _ordersChannelFilter !== 'all') {
        queryParams.push('order_channel=' + encodeURIComponent(_ordersChannelFilter));
      }
      if (_ordersFulfillmentFilter && _ordersFulfillmentFilter !== 'all') {
        queryParams.push('fulfillment_type=' + encodeURIComponent(_ordersFulfillmentFilter));
      }
      if (_ordersSearchQuery) {
        queryParams.push('search=' + encodeURIComponent(_ordersSearchQuery));
      }

      var qs = queryParams.length ? ('?' + queryParams.join('&')) : '';
      var res = await adminFetch(API_BASE + '/admin/orders' + qs, { headers: getAuthHeaders() });
      var data = await res.json();

      // Discard response if a newer fetch was initiated in the meantime
      if (currentSeq !== _ordersFetchSeq) {
        return;
      }

      if (data.success && data.orders) {
        state.orders = data.orders;
        renderOrdersTable();
      }
    } catch (e) {
      if (currentSeq !== _ordersFetchSeq) return;
      console.warn('[Orders Load Error]:', e);
      if (tbody && !isBg && (!state.orders || !state.orders.length)) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6 text-danger">Gagal memuat daftar pesanan.</td></tr>';
      }
    }
  }

  function renderOrdersTable() {
    var tbody = $('orders-table-body');
    if (!tbody) return;

    if (!state.orders.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6 text-muted">Belum ada pesanan yang sesuai filter.</td></tr>';
      return;
    }

    var statusBadges = {
      pending: 'x-badge-warning',
      confirmed: 'x-badge-info',
      preparing: 'x-badge-info',
      ready: 'x-badge-success',
      out_for_delivery: 'x-badge-info',
      completed: 'x-badge-success',
      cancelled: 'x-badge-danger'
    };

    var rows = state.orders.map(function (ord) {
      var orderChannel = ord.order_channel || 'customer_app';
      var fulfillmentType = ord.fulfillment_type || ord.order_type || 'delivery';
      var timeStr = ord.created_at ? (new Date(ord.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })) : '-';
      // Owner/Brand view: acceptance (pending) is the only exception path offered here.
      // Branch Manager operational cooking stages live in Merchant App.
      var canAdvance = ord.status === 'pending';

      return [
        '<tr>',
          '<td><a href="#orders/' + ord.id + '" style="font-weight:700;color:var(--text-main);text-decoration:none;" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">#' + esc(ord.order_number || ord.id.substring(0, 8)) + '</a></td>',
          '<td><small class="text-muted">' + timeStr + '</small></td>',
          '<td><strong>' + esc(ord.branch_name || ord.branch_id || '-') + '</strong></td>',
          '<td><strong>' + esc(ord.customer_name || 'Pelanggan') + '</strong><br><small class="text-muted">' + esc(ord.customer_phone || '-') + '</small></td>',
          '<td><span class="x-badge" style="background:#e0f2fe;color:#0369a1;font-size:11px;">' + esc(orderChannel) + '</span></td>',
          '<td><span class="x-badge" style="background:#fef3c7;color:#b45309;font-size:11px;">' + esc(fulfillmentType) + '</span></td>',
          '<td><strong>' + formatMoney(ord.grand_total) + '</strong></td>',
          '<td><span class="x-badge ' + (statusBadges[ord.status] || 'x-badge-info') + '">' + esc(ord.status.toUpperCase()) + '</span></td>',
          '<td class="text-right" style="white-space:nowrap;">',
            '<div class="x-item-actions" style="justify-content:flex-end;">',
              (canAdvance
                ? '<button type="button" class="x-btn-primary" style="padding:6px 12px;font-size:12px;" onclick="advanceOrderStatus(\'' + ord.id + '\', \'' + ord.status + '\', \'' + fulfillmentType + '\')">' + (ord.status === 'pending' ? 'Terima Pesanan' : 'Ubah Status ➔') + '</button>'
                : ''),
              '<button type="button" class="x-action-menu-trigger" aria-label="Menu aksi pesanan ' + esc(ord.order_number || ord.id) + '" onclick="XentraActionMenu.open(this, [' +
                '{ label: \'Lihat Rincian Pesanan\', icon: \'📄\', onClick: function() { navigateTo(\'orders/' + ord.id + '\'); } }' +
                (canAdvance ? ',{ divider: true }, { label: \'' + (ord.status === 'pending' ? 'Terima Pesanan' : 'Lanjut Status Pesanan ➔') + '\', icon: \'⚡\', onClick: function() { advanceOrderStatus(\'' + ord.id + '\', \'' + ord.status + '\', \'' + fulfillmentType + '\'); } }' : '') +
                (ord.status === 'pending' ? ',{ label: \'Tolak Pesanan\', icon: \'❌\', onClick: function() { rejectOrder(\'' + ord.id + '\'); } }' : '') +
              '])">',
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
              '</button>',
            '</div>',
          '</td>',
        '</tr>'
      ].join('');
    });

    tbody.innerHTML = rows.join('');
  }

  /* =========================================================================
     ORDER DETAIL VIEW CONTROLLER
     ========================================================================= */
  async function loadOrderDetailView(orderId) {
    _activeDetailOrderId = orderId;
    showOrderDetailView();

    var tbody = $('order-detail-items-tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4">Memuat rincian pesanan...</td></tr>';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/orders/' + encodeURIComponent(orderId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!data.success || !data.order) {
        showToast('❌ ' + (data.error || 'Pesanan tidak ditemukan.'));
        navigateTo('orders');
        return;
      }

      var ord = data.order;

      // Update Summary Header
      if ($('order-detail-breadcrumb')) $('order-detail-breadcrumb').textContent = '#' + (ord.order_number || ord.id);
      if ($('order-detail-mobile-title')) $('order-detail-mobile-title').textContent = 'Detail Pesanan · #' + (ord.order_number || ord.id);
      if ($('order-detail-number')) $('order-detail-number').textContent = '#' + (ord.order_number || ord.id);

      var statusBadges = {
        pending: 'x-badge-warning',
        confirmed: 'x-badge-info',
        preparing: 'x-badge-info',
        ready: 'x-badge-success',
        out_for_delivery: 'x-badge-info',
        completed: 'x-badge-success',
        cancelled: 'x-badge-danger'
      };

      var statusBadge = $('order-detail-status-badge');
      if (statusBadge) {
        statusBadge.className = 'x-badge ' + (statusBadges[ord.status] || 'x-badge-info');
        statusBadge.textContent = (ord.status || 'UNKNOWN').toUpperCase();
      }

      var channelBadge = $('order-detail-channel-badge');
      if (channelBadge) {
        channelBadge.textContent = 'Channel: ' + (ord.order_channel || 'customer_app');
      }

      var fulfillmentBadge = $('order-detail-fulfillment-badge');
      if (fulfillmentBadge) {
        fulfillmentBadge.textContent = 'Fulfillment: ' + (ord.fulfillment_type || ord.order_type || 'delivery');
      }

      if ($('order-detail-time')) {
        $('order-detail-time').textContent = 'Waktu Pemesanan: ' + (ord.created_at ? new Date(ord.created_at).toLocaleString('id-ID') : '-');
      }

      if ($('order-detail-branch')) $('order-detail-branch').textContent = ord.branch_name || ord.branch_id || '-';
      if ($('order-detail-customer')) $('order-detail-customer').textContent = ord.customer_name || 'Pelanggan';
      if ($('order-detail-phone')) $('order-detail-phone').textContent = ord.customer_phone || '-';

      var tableWrap = $('order-detail-table-wrap');
      if (tableWrap) {
        if (ord.table_number) {
          tableWrap.style.display = 'block';
          if ($('order-detail-table')) $('order-detail-table').textContent = 'Meja ' + ord.table_number;
        } else {
          tableWrap.style.display = 'none';
        }
      }

      if ($('order-detail-total')) $('order-detail-total').textContent = formatMoney(ord.grand_total);
      if ($('order-detail-payment-status')) {
        var pStat = ord.payment_status || (ord.status === 'completed' ? 'paid' : 'unpaid');
        $('order-detail-payment-status').textContent = 'Status Pembayaran: ' + pStat.toUpperCase();
        $('order-detail-payment-status').style.color = pStat === 'paid' ? '#10b981' : '#f59e0b';
      }

      // Shared Dine-In Session Box
      var sessionBox = $('order-detail-session-box');
      if (sessionBox) {
        if (ord.dining_session_id && ord.session_orders && ord.session_orders.length) {
          sessionBox.style.display = 'block';
          if ($('order-detail-session-id')) {
            $('order-detail-session-id').textContent = '(Session: ' + ord.dining_session_id.substring(0, 8) + ')';
          }
          var sessionList = $('order-detail-session-list');
          if (sessionList) {
            sessionList.innerHTML = ord.session_orders.map(function (so) {
              return '<div style="display:flex;justify-content:space-between;align-items:center;background:#ffffff;padding:6px 10px;border-radius:4px;border:1px solid #dcfce7;">' +
                '<span><a href="#orders/' + so.id + '" style="font-weight:700;color:#166534;text-decoration:none;">#' + (so.order_number || so.id) + '</a> (' + so.order_channel + ')</span>' +
                '<span><strong>' + formatMoney(so.grand_total) + '</strong> &bull; ' + (so.payment_status || 'unpaid').toUpperCase() + '</span>' +
              '</div>';
            }).join('');
          }
        } else {
          sessionBox.style.display = 'none';
        }
      }

      // Items Table
      var items = ord.items || [];
      if (tbody) {
        if (!items.length) {
          tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Tidak ada item dalam pesanan ini.</td></tr>';
        } else {
          tbody.innerHTML = items.map(function (it) {
            var sub = it.item_subtotal != null ? it.item_subtotal : (it.subtotal != null ? it.subtotal : (it.unit_price * it.quantity));
            return [
              '<tr>',
                '<td><strong>' + esc(it.product_name || it.product_id) + '</strong></td>',
                '<td>' + formatMoney(it.unit_price) + '</td>',
                '<td>' + it.quantity + '</td>',
                '<td><small class="text-muted">' + esc(it.note || '-') + '</small></td>',
                '<td class="text-right"><strong>' + formatMoney(sub) + '</strong></td>',
              '</tr>'
            ].join('');
          }).join('');
        }
      }

      // Financial Calculation
      if ($('order-calc-subtotal')) $('order-calc-subtotal').textContent = formatMoney(ord.subtotal || ord.grand_total);
      if ($('order-calc-delivery')) $('order-calc-delivery').textContent = formatMoney(ord.delivery_fee || 0);
      if ($('order-calc-discount')) $('order-calc-discount').textContent = formatMoney(ord.discount_amount || 0);
      if ($('order-calc-grandtotal')) $('order-calc-grandtotal').textContent = formatMoney(ord.grand_total);

      // Delivery & Note Info
      var dest = (ord.delivery && ord.delivery.destination_address) || (ord.table_number ? ('Dine-in di Meja ' + ord.table_number) : 'Pickup di Outlet');
      if ($('order-detail-dest')) $('order-detail-dest').textContent = dest;
      if ($('order-detail-paymethod')) $('order-detail-paymethod').textContent = (ord.payment_method || 'Tunai').toUpperCase();
      if ($('order-detail-notes')) $('order-detail-notes').textContent = ord.order_note || 'Tidak ada catatan tambahan.';

    } catch (err) {
      console.error('[Order Detail Load Error]:', err);
      showToast('❌ Kesalahan saat memuat detail pesanan.');
    }
  }

  function initOrdersFilterListeners() {
    var searchInput = $('orders-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        _ordersSearchQuery = searchInput.value.trim();
        loadOrders();
      });
    }

    var filterStatus = $('orders-filter-status');
    if (filterStatus) {
      filterStatus.addEventListener('change', function () {
        _ordersStatusFilter = filterStatus.value;
        loadOrders();
      });
    }

    var filterChannel = $('orders-filter-channel');
    if (filterChannel) {
      filterChannel.addEventListener('change', function () {
        _ordersChannelFilter = filterChannel.value;
        loadOrders();
      });
    }

    var filterFulfillment = $('orders-filter-fulfillment');
    if (filterFulfillment) {
      filterFulfillment.addEventListener('change', function () {
        _ordersFulfillmentFilter = filterFulfillment.value;
        loadOrders();
      });
    }
  }

  window.rejectOrder = async function (orderId) {
    var reason = await requestTextInputSheet({ title: 'Tolak Pesanan', label: 'Alasan Penolakan', saveLabel: 'Tolak' });
    if (reason === null) return; // User cancelled prompt
    reason = reason.trim();
    if (!reason) {
      showToast('❌ Alasan penolakan wajib diisi.');
      return;
    }

    var authHeaders = getAuthHeaders();
    try {
      var res = await adminFetch(API_BASE + '/orders/' + orderId + '/branch-acceptance', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ decision: 'reject', reason: reason, note: reason })
      });
      var data = await res.json();
      if (data && data.success) {
        showToast('Pesanan DITOLAK: ' + (data.new_status || 'rejected').toUpperCase());
        loadOrders();
      } else {
        showToast((data && data.error) || 'Gagal menolak pesanan.');
      }
    } catch (e) {
      showToast('Gagal menolak pesanan.');
    }
  };

  window.advanceOrderStatus = async function (orderId, currentStatus, fulfillmentType) {
    var authHeaders = getAuthHeaders();

    // R5 CHECK-1: acceptance ('pending' → 'confirmed') is EXCLUSIVELY Branch
    // ACCEPT via /orders/:id/branch-acceptance — never the generic status
    // PATCH. The branch acceptance endpoint is server-authoritative, audited,
    // and idempotent.
    if (currentStatus === 'pending') {
      try {
        var acceptRes = await adminFetch(API_BASE + '/orders/' + orderId + '/branch-acceptance', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ decision: 'accept', note: 'Diterima dari Merchant Dashboard' })
        });
        var acceptData = await acceptRes.json();
        if (acceptData && acceptData.success) {
          showToast('Pesanan DITERIMA: ' + (acceptData.new_status || 'confirmed').toUpperCase());
          loadOrders();
        } else {
          showToast((acceptData && acceptData.error) || 'Gagal menerima pesanan.');
        }
      } catch (e) {
        showToast('Gagal menerima pesanan.');
      }
      return;
    }

    // Fulfillment-type-aware progression:
    // Delivery: pending → confirmed → preparing → ready → out_for_delivery → completed
    // Pickup / Dine-in: pending → confirmed → preparing → ready → completed
    var isDelivery = (fulfillmentType === 'delivery');
    var nextMap = {
      ready: isDelivery ? 'out_for_delivery' : 'completed'
    };

    var nextStatus = nextMap[currentStatus];
    if (!nextStatus) {
      showToast('Status ini dikelola oleh surface Kitchen / Driver.');
      return;
    }
    try {
      var res = await adminFetch(API_BASE + '/kitchen/orders/' + orderId + '/status', {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: nextStatus, note: 'Status diupdate dari Merchant Dashboard' })
      });
      var data = await res.json();
      if (data && data.success) {
        showToast('Pesanan diubah ke status: ' + nextStatus.toUpperCase());
        loadOrders();
      } else {
        showToast((data && data.error) || 'Gagal update status pesanan.');
      }
    } catch (e) {
      showToast('Gagal update status pesanan.');
    }
  };

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
     OWNER STOCK OVERVIEW — read-only inventory health
     Uses the authoritative Reporting inventory/operations endpoint.
     Owner may observe stock health; stock mutation remains Branch operations.
     ========================================================================= */

  var _ownerStockLoadedOnce = false;

  function formatUnitCount(value) {
    return Number(value || 0).toLocaleString('id-ID');
  }

  function ownerStockMovementLabel(type) {
    var labels = {
      purchase_in: 'Pembelian masuk',
      transfer_in: 'Transfer masuk',
      return_in: 'Retur masuk',
      sale_deduction: 'Penjualan keluar',
      transfer_out: 'Transfer keluar',
      waste_spoilage: 'Waste / rusak',
      audit_adjustment: 'Koreksi stok'
    };
    return labels[type] || String(type || '-');
  }

  function ownerStockMovementClass(type) {
    if (type === 'purchase_in' || type === 'transfer_in' || type === 'return_in') return 'in';
    if (type === 'sale_deduction' || type === 'transfer_out' || type === 'waste_spoilage') return 'out';
    return 'adjust';
  }

  function loadOwnerStockOverview() {
    if (!_inventoryWorkflowState) loadInventoryWorkflowContext();
    var root = $('tab-stock');
    var alertList = $('owner-stock-alerts-list');
    var branchList = $('owner-stock-branch-list');
    var movementList = $('owner-stock-movement-list');
    var branchId = getEffectiveBranchId();
    var query = branchId ? '?branch_id=' + encodeURIComponent(branchId) : '';

    if (alertList) alertList.innerHTML = '<div class="x-owner-stock-loading">Memuat stok...</div>';
    if (branchList) branchList.innerHTML = '<div class="x-owner-stock-loading">Memuat cabang...</div>';
    if (movementList) movementList.innerHTML = '<div class="x-owner-stock-loading">Memuat mutasi...</div>';
    if (root) root.setAttribute('aria-busy', 'true');

    if (branchId) {
      var selected = (_branchContextState.branches || []).find(function (b) {
        return String(b.id) === String(branchId);
      });
      var scopeEl = $('owner-stock-scope');
      if (scopeEl) scopeEl.textContent = selected ? selected.name : 'Cabang terpilih';
    } else {
      var allScopeEl = $('owner-stock-scope');
      if (allScopeEl) allScopeEl.textContent = 'Semua Cabang';
    }

    return adminFetch(API_BASE + '/reports/operations' + query, {
      headers: getAuthHeaders()
    }).then(function (res) {
      return res.json();
    }).then(function (json) {
      if (!json.success || !json.data) {
        throw new Error((json && (json.error || json.message)) || 'Gagal memuat data stok.');
      }
      renderOwnerStockOverview(json.data);
      _ownerStockLoadedOnce = true;
    }).catch(function (err) {
      console.warn('[Owner Stock Load Error]:', err);
      var message = err && err.message === 'SESSION_EXPIRED'
        ? 'Sesi berakhir. Silakan masuk kembali.'
        : 'Data stok belum dapat dimuat. Coba lagi.';
      if (alertList) alertList.innerHTML = '<div class="x-owner-stock-error">' + escapeHtml(message) + '</div>';
      if (branchList) branchList.innerHTML = '<div class="x-owner-stock-error">' + escapeHtml(message) + '</div>';
      if (movementList) movementList.innerHTML = '<div class="x-owner-stock-error">' + escapeHtml(message) + '</div>';
    }).finally(function () {
      if (root) root.setAttribute('aria-busy', 'false');
    });
  }

  function renderOwnerStockOverview(data) {
    var summary = data.stock_summary || {};
    var alerts = Array.isArray(data.low_stock_alerts) ? data.low_stock_alerts : [];
    var branchRows = Array.isArray(data.stock_by_branch) ? data.stock_by_branch : [];
    var movements = Array.isArray(data.movement_breakdown) ? data.movement_breakdown : [];

    var trackedEl = $('owner-stock-tracked-count');
    var lowEl = $('owner-stock-low-count');
    var outEl = $('owner-stock-out-count');
    var unitsEl = $('owner-stock-total-units');
    if (trackedEl) trackedEl.textContent = formatUnitCount(summary.tracked_item_count);
    if (lowEl) lowEl.textContent = formatUnitCount(summary.low_stock_count);
    if (outEl) outEl.textContent = formatUnitCount(summary.out_of_stock_count);
    if (unitsEl) unitsEl.textContent = formatUnitCount(summary.total_units);

    var alertList = $('owner-stock-alerts-list');
    if (alertList) {
      if (!alerts.length) {
        alertList.innerHTML =
          '<div class="x-owner-stock-empty">' +
            '<span class="x-owner-stock-empty-icon">✓</span>' +
            '<div><strong>Stok aman</strong><p>Tidak ada item yang berada di bawah batas minimum pada scope ini.</p></div>' +
          '</div>';
      } else {
        var alertHtml = '';
        alerts.slice(0, 8).forEach(function (a) {
          var current = Number(a.current_stock);
          var threshold = Number(a.low_stock_threshold);
          var isOut = current <= 0;
          var gap = Math.max(threshold - current, 0);
          alertHtml +=
            '<div class="x-owner-stock-alert-row ' + (isOut ? 'is-out' : '') + '">' +
              '<div class="x-owner-stock-alert-main">' +
                '<span class="x-owner-stock-alert-status">' + (isOut ? 'Habis' : 'Menipis') + '</span>' +
                '<strong>' + escapeHtml(a.product_name || '-') + '</strong>' +
                '<small>' + escapeHtml(a.branch_name || '-') + '</small>' +
              '</div>' +
              '<div class="x-owner-stock-alert-number">' +
                '<strong>' + formatUnitCount(current) + '</strong>' +
                '<small>min. ' + formatUnitCount(threshold) + '</small>' +
              '</div>' +
              '<span class="x-owner-stock-alert-arrow" aria-hidden="true">›</span>' +
            '</div>';
        });
        if (alerts.length > 8) {
          alertHtml += '<button type="button" class="x-owner-stock-more" id="btn-owner-stock-more-alerts">Lihat ' + formatUnitCount(alerts.length - 8) + ' perhatian lainnya</button>';
        }
        alertList.innerHTML = alertHtml;
        var moreBtn = $('btn-owner-stock-more-alerts');
        if (moreBtn) {
          moreBtn.addEventListener('click', function () {
            navigateTo('reports/operations');
          });
        }
      }
    }

    var branchList = $('owner-stock-branch-list');
    if (branchList) {
      if (!branchRows.length) {
        branchList.innerHTML = '<div class="x-owner-stock-empty-compact">Belum ada data stok cabang.</div>';
      } else {
        branchList.innerHTML = branchRows.map(function (row) {
          var low = Number(row.low_stock_count || 0);
          var out = Number(row.out_of_stock_count || 0);
          var status = out > 0 ? 'Perlu perhatian' : (low > 0 ? 'Menipis' : 'Aman');
          var statusClass = out > 0 ? 'danger' : (low > 0 ? 'warning' : 'good');
          return (
            '<div class="x-owner-stock-branch-row">' +
              '<div class="x-owner-stock-branch-copy">' +
                '<strong>' + escapeHtml(row.branch_name || '-') + '</strong>' +
                '<span>' + formatUnitCount(row.tracked_item_count) + ' item · ' + formatUnitCount(row.total_units) + ' unit</span>' +
              '</div>' +
              '<div class="x-owner-stock-branch-meta">' +
                '<span class="x-owner-stock-branch-badge ' + statusClass + '">' + status + '</span>' +
                '<small>' + formatUnitCount(out) + ' habis · ' + formatUnitCount(low) + ' menipis</small>' +
              '</div>' +
            '</div>'
          );
        }).join('');
      }
    }

    var movementList = $('owner-stock-movement-list');
    if (movementList) {
      if (!movements.length) {
        movementList.innerHTML = '<div class="x-owner-stock-empty-compact">Belum ada mutasi persediaan yang tercatat.</div>';
      } else {
        movementList.innerHTML = movements.map(function (m) {
          var total = Number(m.total_quantity || 0);
          var cls = ownerStockMovementClass(m.movement_type);
          var sign = total > 0 ? '+' : '';
          return (
            '<div class="x-owner-stock-movement-row">' +
              '<div class="x-owner-stock-movement-icon ' + cls + '">' +
                (cls === 'in' ? '↓' : (cls === 'out' ? '↑' : '↔')) +
              '</div>' +
              '<div class="x-owner-stock-movement-copy">' +
                '<strong>' + escapeHtml(ownerStockMovementLabel(m.movement_type)) + '</strong>' +
                '<span>' + formatUnitCount(m.record_count) + ' catatan</span>' +
              '</div>' +
              '<strong class="x-owner-stock-movement-value ' + cls + '">' + sign + formatUnitCount(total) + '</strong>' +
            '</div>'
          );
        }).join('');
      }
    }
  }

  function initOwnerStockControls() {
    var refresh = $('btn-owner-stock-refresh');
    var report = $('btn-owner-stock-full-report');
    if (refresh) refresh.addEventListener('click', loadOwnerStockOverview);
    if (report) report.addEventListener('click', function () {
      navigateTo('reports/operations');
    });
  }

  /* =========================================================================
     MATERIAL MASTER (BAHAN BAKU) & UOM CONTROLS
     Owner & Brand Manager catalog management for production & procurement.
     ========================================================================= */
  var _ownerMaterials = [];
  var _ownerUoms = [];

  var _inventoryWorkflowState = null;
  var _iwPoLineCount = 0;
  var _iwRecipeLineCount = 0;

  function switchStockSubtab(subtab) {
    if (!subtab) subtab = 'branches';
    document.querySelectorAll('#stock-subnav-tabs .x-subnav-tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.subtab === subtab);
    });
    ['branches', 'materials', 'procurement', 'production'].forEach(function (name) {
      var panel = $('subtab-content-stock-' + name);
      if (panel) panel.style.display = name === subtab ? 'block' : 'none';
    });
    if (subtab === 'branches') loadOwnerStockOverview();
    if (subtab === 'materials') {
      loadOwnerMaterials();
      loadOwnerUoms();
    }
    if (subtab === 'materials' || subtab === 'procurement' || subtab === 'production' || subtab === 'branches') {
      loadInventoryWorkflowContext();
    }
  }

  function iwEsc(value) { return escapeHtml(value === null || value === undefined ? '' : String(value)); }
  function iwMoney(value) {
    return 'Rp ' + Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
  }
  function iwLocationId() {
    return $('iw-stock-location') ? $('iw-stock-location').value : '';
  }
  function iwBranchId() {
    return $('iw-stock-branch') ? $('iw-stock-branch').value : '';
  }
  function iwRequest(path, options) {
    options = options || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders());
    var request = { method: options.method || 'GET', headers: headers };
    if (options.body !== undefined) request.body = JSON.stringify(options.body);
    return adminFetch('/api/admin/inventory-workflow' + path, request).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.success === false) {
          var requestError = new Error(data.code || data.error || 'Permintaan inventory gagal.');
          if (data.batch_id) requestError.batchId = data.batch_id;
          throw requestError;
        }
        return data;
      });
    });
  }
  function iwSetOptions(id, rows, valueKey, labelFn, placeholder, selectedValue) {
    var select = $(id);
    if (!select) return;
    var previous = selectedValue !== undefined ? String(selectedValue || '') : String(select.value || '');
    var html = '<option value="">' + iwEsc(placeholder || 'Pilih...') + '</option>';
    (rows || []).forEach(function (row) {
      var value = String(row[valueKey] || '');
      if (!value) return;
      html += '<option value="' + iwEsc(value) + '">' + iwEsc(labelFn(row)) + '</option>';
    });
    select.innerHTML = html;
    if (previous && Array.from(select.options).some(function (option) { return option.value === previous; })) select.value = previous;
    else if (select.options.length > 1) select.value = select.options[1].value;
  }
  function loadInventoryWorkflowContext() {
    return iwRequest('/context').then(function (result) {
      _inventoryWorkflowState = result.data || null;
      iwRenderContext();
      return _inventoryWorkflowState;
    }).catch(function (error) {
      var text = 'Gagal memuat inventory: ' + error.message;
      ['iw-material-stock-table', 'iw-product-stock-table', 'iw-purchase-order-list', 'iw-production-batch-list'].forEach(function (id) {
        var el = $(id);
        if (el) el.innerHTML = '<div class="x-owner-stock-error">' + iwEsc(text) + '</div>';
      });
      return null;
    });
  }
  function iwRenderContext() {
    var state = _inventoryWorkflowState;
    if (!state) return;
    var oldBranch = iwBranchId();
    iwSetOptions('iw-stock-branch', state.branches, 'id', function (b) { return b.name; }, 'Pilih cabang', oldBranch);
    var branchId = iwBranchId();
    var branchLocations = (state.locations || []).filter(function (location) {
      return !branchId || String(location.branch_id || '') === String(branchId);
    });
    var oldLocation = iwLocationId();
    iwSetOptions('iw-stock-location', branchLocations, 'id', function (location) {
      return (location.branch_name ? location.branch_name + ' · ' : '') + location.name;
    }, branchLocations.length ? 'Pilih lokasi stok' : 'Lokasi belum disiapkan', oldLocation);
    iwSetOptions('iw-map-supplier', state.suppliers, 'id', function (supplier) { return supplier.name + ' (' + supplier.supplier_code + ')'; }, 'Pilih pemasok');
    iwSetOptions('iw-map-material', state.materials, 'id', function (material) { return material.name + ' · ' + material.material_code; }, 'Pilih bahan baku');
    iwSetOptions('iw-pack-supplier-material', state.supplier_materials, 'supplier_material_id', function (item) {
      return item.supplier_name + ' · ' + item.material_name + (item.supplier_item_code ? ' (' + item.supplier_item_code + ')' : '');
    }, 'Pilih bahan dari pemasok');
    iwSetOptions('iw-pack-uom', state.uoms, 'id', function (uom) { return uom.name + ' (' + uom.code + ')'; }, 'Satuan isi');
    iwSetOptions('iw-recipe-output-product', (state.products || []).filter(function (p) { return p.product_stock_uom_id; }), 'id', function (p) { return p.name + ' · ' + p.sku; }, 'Pilih Product/SKU');
    iwSetOptions('iw-recipe-yield-uom', state.uoms, 'id', function (uom) { return uom.name + ' (' + uom.code + ')'; }, 'Satuan hasil');
    var latestPublishedByRecipe = {};
    (state.recipes || []).forEach(function (recipe) {
      if (recipe.recipe_version_status !== 'PUBLISHED') return;
      var key = String(recipe.recipe_id);
      if (!latestPublishedByRecipe[key] || Number(recipe.version_number) > Number(latestPublishedByRecipe[key].version_number)) {
        latestPublishedByRecipe[key] = recipe;
      }
    });
    var resumableRecipeVersionIds = (state.batches || []).filter(function (batch) {
      return batch.status === 'IN_PROGRESS';
    }).map(function (batch) { return String(batch.recipe_version_id); });
    var batchRecipeOptions = (state.recipes || []).filter(function (recipe) {
      var latest = latestPublishedByRecipe[String(recipe.recipe_id)];
      var isLatestPublished = recipe.recipe_version_status === 'PUBLISHED' && latest && String(latest.recipe_version_id) === String(recipe.recipe_version_id);
      return isLatestPublished || resumableRecipeVersionIds.indexOf(String(recipe.recipe_version_id)) >= 0;
    });
    iwSetOptions('iw-batch-recipe', batchRecipeOptions, 'recipe_version_id', function (recipe) {
      var latest = latestPublishedByRecipe[String(recipe.recipe_id)];
      var historicalLabel = latest && String(latest.recipe_version_id) === String(recipe.recipe_version_id) ? '' : ' · versi untuk batch berjalan';
      return recipe.production_item_name + ' · hasil ' + recipe.planned_yield_quantity + ' ' + recipe.yield_uom_name + ' · ' + recipe.output_product_sku + historicalLabel;
    }, 'Pilih resep aktif');
    if ($('iw-po-lines') && !$('iw-po-lines').children.length) addIWPoLine();
    renderIWPoLines();
    if ($('iw-recipe-components') && !$('iw-recipe-components').children.length) addIWRecipeComponent();
    onIWRecipeProductChange();
    renderIWRecipeComponentOptions();
    renderIWMaterialStock();
    renderIWProductStock();
    renderIWLowStockAlerts();
    renderIWPurchaseOrders();
    renderIWProductionBatches();
    renderIWBatchComponents();
  }
  function onIWBranchChange() {
    if ($('iw-stock-location')) $('iw-stock-location').value = '';
    iwRenderContext();
    loadInventoryWorkflowContext();
  }
  function onIWLocationChange() {
    renderIWMaterialStock();
    renderIWProductStock();
    renderIWLowStockAlerts();
    renderIWPurchaseOrders();
    renderIWProductionBatches();
  }
  function ensureIWStockLocation() {
    var branchId = iwBranchId();
    if (!branchId) return showToast('Pilih cabang terlebih dahulu.', 'warning');
    iwRequest('/locations/branch', { method: 'POST', body: { branch_id: branchId } }).then(function () {
      showToast('Lokasi stok cabang siap digunakan.', 'success');
      return loadInventoryWorkflowContext();
    }).catch(function (error) { showToast('Gagal menyiapkan lokasi: ' + error.message, 'error'); });
  }
  function iwPolicyButton(type, id, minimum, target) {
    return '<div style="display:flex;gap:5px;align-items:center;justify-content:flex-end;flex-wrap:wrap;">' +
      '<input type="number" min="0" step="any" class="x-input" style="width:88px;padding:6px;" aria-label="Batas minimum" data-iw-min="' + iwEsc(type + ':' + id) + '" value="' + iwEsc(minimum) + '" title="Batas minimum">' +
      '<input type="number" min="0" step="any" class="x-input" style="width:88px;padding:6px;" aria-label="Target stok" data-iw-target="' + iwEsc(type + ':' + id) + '" value="' + iwEsc(target) + '" title="Target stok">' +
      '<button type="button" class="x-btn-secondary" style="padding:6px 8px;" onclick="saveIWReorderPolicy(\'' + iwEsc(type) + '\',\'' + iwEsc(id) + '\')">Simpan</button></div>';
  }
  function saveIWReorderPolicy(type, id) {
    var locationId = iwLocationId();
    var key = type + ':' + id;
    var minInput = document.querySelector('[data-iw-min="' + key + '"]');
    var targetInput = document.querySelector('[data-iw-target="' + key + '"]');
    if (!locationId) return showToast('Siapkan dan pilih lokasi stok terlebih dahulu.', 'warning');
    if (!minInput || !targetInput) return;
    var minimum = Number(minInput.value), target = Number(targetInput.value);
    if (!Number.isFinite(minimum) || minimum < 0 || !Number.isFinite(target) || target < minimum) {
      return showToast('Target stok harus sama dengan atau lebih besar dari batas minimum.', 'warning');
    }
    iwRequest('/reorder-policy', { method: 'PUT', body: {
      stock_location_id: locationId, identity_type: type, identity_id: id,
      minimum_quantity: minimum, target_quantity: target
    }}).then(function () {
      showToast('Batas minimum dan target stok disimpan.', 'success');
      return loadInventoryWorkflowContext();
    }).catch(function (error) { showToast('Gagal menyimpan kebijakan stok: ' + error.message, 'error'); });
  }
  function renderIWMaterialStock() {
    var root = $('iw-material-stock-table');
    if (!root || !_inventoryWorkflowState) return;
    var locationId = iwLocationId();
    if (!locationId) { root.innerHTML = '<div class="x-owner-stock-empty">Pilih cabang yang sudah memiliki lokasi stok, atau tekan “Siapkan Lokasi Cabang”.</div>'; return; }
    var rows = (_inventoryWorkflowState.materials || []).map(function (material) {
      var balance = (_inventoryWorkflowState.material_balances || []).find(function (item) {
        return String(item.stock_location_id) === String(locationId) && String(item.material_id) === String(material.id);
      });
      var policy = (_inventoryWorkflowState.reorder_policies || []).find(function (item) {
        return String(item.stock_location_id) === String(locationId) && item.identity_type === 'MATERIAL' && String(item.identity_id) === String(material.id);
      });
      var quantity = balance ? Number(balance.quantity) : null;
      var minimum = policy ? Number(policy.minimum_quantity || 0) : (balance ? Number(balance.minimum_quantity || 0) : 0);
      var target = policy ? Number(policy.target_quantity || 0) : (balance ? Number(balance.target_quantity || 0) : 0);
      var isBelowMinimum = policy ? (quantity === null ? 0 : quantity) <= minimum : (minimum > 0 && (quantity === null ? 0 : quantity) <= minimum);
      var status = isBelowMinimum ? (quantity === null ? 'Belum ada saldo · perlu belanja' : 'Perlu belanja') : (!balance ? 'Belum ada saldo' : 'Tercatat');
      var badge = isBelowMinimum ? 'x-badge-warning' : (!balance ? 'x-badge-muted' : 'x-badge-success');
      return '<tr><td><strong>' + iwEsc(material.name) + '</strong><div class="text-muted" style="font-size:11px;">' + iwEsc(material.material_code) + '</div></td>' +
        '<td>' + (quantity === null ? '—' : iwEsc(quantity)) + ' ' + iwEsc(balance ? balance.base_uom_name : (( _inventoryWorkflowState.uoms || []).find(function (u) { return u.id === material.base_uom_id; }) || {}).name || '') + '</td>' +
        '<td>' + (balance ? iwMoney(balance.carrying_value) : '—') + '</td>' +
        '<td><span class="x-badge ' + badge + '">' + iwEsc(status) + '</span></td>' +
        '<td>' + iwPolicyButton('MATERIAL', material.id, minimum, target) + '</td></tr>';
    }).join('');
    root.innerHTML = '<table class="x-table"><thead><tr><th>Bahan</th><th>Saldo fisik</th><th>Nilai stok</th><th>Status</th><th>Batas minimum / target</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5">Belum ada Master Bahan.</td></tr>') + '</tbody></table>' +
      '<p style="font-size:11px;color:#64748B;margin:8px 0 0;">— berarti saldo belum pernah diposting, bukan angka nol. Batas minimum dan target berlaku per lokasi.</p>';
  }
  function renderIWProductStock() {
    var root = $('iw-product-stock-table');
    if (!root || !_inventoryWorkflowState) return;
    var locationId = iwLocationId();
    if (!locationId) { root.innerHTML = '<div class="x-owner-stock-empty">Siapkan lokasi stok cabang terlebih dahulu untuk melihat saldo canonical.</div>'; return; }
    var products = (_inventoryWorkflowState.products || []).filter(function (product) { return product.product_stock_uom_id; });
    var rows = products.map(function (product) {
      var balance = (_inventoryWorkflowState.product_balances || []).find(function (item) {
        return String(item.stock_location_id) === String(locationId) && String(item.product_id) === String(product.id);
      });
      var policy = (_inventoryWorkflowState.reorder_policies || []).find(function (item) {
        return String(item.stock_location_id) === String(locationId) && item.identity_type === 'PRODUCT' && String(item.identity_id) === String(product.id);
      });
      var quantity = balance ? Number(balance.quantity) : null;
      var minimum = policy ? Number(policy.minimum_quantity || 0) : (balance ? Number(balance.minimum_quantity || 0) : 0);
      var target = policy ? Number(policy.target_quantity || 0) : (balance ? Number(balance.target_quantity || 0) : 0);
      var isBelowMinimum = policy ? (quantity === null ? 0 : quantity) <= minimum : (minimum > 0 && (quantity === null ? 0 : quantity) <= minimum);
      var status = isBelowMinimum ? (quantity === null ? 'Belum ada saldo · perlu restock/produksi' : 'Perlu restock/produksi') : (!balance ? 'Belum ada saldo' : 'Tercatat');
      var badge = isBelowMinimum ? 'x-badge-warning' : (!balance ? 'x-badge-muted' : 'x-badge-success');
      return '<tr><td><strong>' + iwEsc(product.name) + '</strong><div class="text-muted" style="font-size:11px;">' + iwEsc(product.sku) + '</div></td>' +
        '<td>' + (quantity === null ? '—' : iwEsc(quantity)) + ' ' + iwEsc(product.stock_uom_name || '') + '</td>' +
        '<td>' + (balance ? iwMoney(balance.carrying_value) : '—') + '</td>' +
        '<td><span class="x-badge ' + badge + '">' + iwEsc(status) + '</span></td>' +
        '<td>' + iwPolicyButton('PRODUCT', product.id, minimum, target) + '</td></tr>';
    }).join('');
    root.innerHTML = '<table class="x-table"><thead><tr><th>Product / SKU</th><th>Saldo siap jual</th><th>Nilai stok</th><th>Status</th><th>Batas minimum / target</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5">Belum ada Product ber-SKU dengan satuan stok.</td></tr>') + '</tbody></table>';
  }
  function renderIWLowStockAlerts() {
    var state = _inventoryWorkflowState;
    var root = $('iw-low-stock-alerts');
    var procurementRoot = $('iw-procurement-alerts');
    if (!state) return;
    var locationId = iwLocationId();
    var alerts = [];

    (state.materials || []).forEach(function (material) {
      var balance = (state.material_balances || []).find(function (row) {
        return String(row.stock_location_id) === String(locationId) && String(row.material_id) === String(material.id);
      });
      var policy = (state.reorder_policies || []).find(function (row) {
        return String(row.stock_location_id) === String(locationId) && row.identity_type === 'MATERIAL' && String(row.identity_id) === String(material.id);
      });
      var minimum = policy ? Number(policy.minimum_quantity || 0) : (balance ? Number(balance.minimum_quantity || 0) : 0);
      var target = policy ? Number(policy.target_quantity || 0) : (balance ? Number(balance.target_quantity || 0) : 0);
      var quantity = balance ? Number(balance.quantity) : 0;
      var uom = balance ? balance.base_uom_name : (((state.uoms || []).find(function (item) { return String(item.id) === String(material.base_uom_id); }) || {}).name || '');
      if (locationId && (policy || minimum > 0) && quantity <= minimum) {
        alerts.push({ type: 'MATERIAL', id: material.id, name: material.name, quantity: quantity, uom: uom, target: target, minimum: minimum, hasBalance: Boolean(balance) });
      }
    });

    (state.products || []).forEach(function (product) {
      if (!product.product_stock_uom_id) return;
      var balance = (state.product_balances || []).find(function (row) {
        return String(row.stock_location_id) === String(locationId) && String(row.product_id) === String(product.id);
      });
      var policy = (state.reorder_policies || []).find(function (row) {
        return String(row.stock_location_id) === String(locationId) && row.identity_type === 'PRODUCT' && String(row.identity_id) === String(product.id);
      });
      var minimum = policy ? Number(policy.minimum_quantity || 0) : (balance ? Number(balance.minimum_quantity || 0) : 0);
      var target = policy ? Number(policy.target_quantity || 0) : (balance ? Number(balance.target_quantity || 0) : 0);
      var quantity = balance ? Number(balance.quantity) : 0;
      if (locationId && (policy || minimum > 0) && quantity <= minimum) {
        alerts.push({ type: 'PRODUCT', id: product.id, name: product.name, quantity: quantity, uom: product.stock_uom_name || 'unit', target: target, minimum: minimum, hasBalance: Boolean(balance) });
      }
    });

    var html = alerts.length ? alerts.map(function (alert) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 12px;margin:8px 0;border:1px solid #F3D28B;border-radius:8px;background:#FFFBEB;">' +
        '<div><strong>' + iwEsc(alert.name) + ' perlu diisi ulang</strong><div style="font-size:12px;color:#92400E;">Sisa ' + iwEsc(alert.quantity) + ' ' + iwEsc(alert.uom) + (alert.hasBalance ? '' : ' · saldo belum pernah diposting') + ' · minimum ' + iwEsc(alert.minimum) + ' · target ' + iwEsc(alert.target) + '</div></div>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span class="x-badge x-badge-warning">' + (alert.type === 'MATERIAL' ? 'Belanja bahan' : 'Produksi / restock') + '</span>' +
        '<button type="button" class="x-btn-secondary" style="padding:6px 10px;" onclick="switchStockSubtab(\'' + (alert.type === 'MATERIAL' ? 'procurement' : 'production') + '\')">' + (alert.type === 'MATERIAL' ? 'Buka Pengadaan' : 'Buka Produksi') + '</button></div></div>';
    }).join('') : '<div class="x-owner-stock-empty">Tidak ada stok di bawah batas minimum pada lokasi ini. Atur minimum/target di tabel saldo untuk mengaktifkan peringatan.</div>';
    if (root) root.innerHTML = html;
    if (procurementRoot) procurementRoot.innerHTML = html;
  }
  function submitIWSupplier(event) {
    if (event) event.preventDefault();
    iwRequest('/suppliers', { method: 'POST', body: { supplier_code: $('iw-supplier-code').value.trim(), name: $('iw-supplier-name').value.trim() } })
      .then(function () { showToast('Pemasok berhasil disimpan.', 'success'); $('iw-form-supplier').reset(); return loadInventoryWorkflowContext(); })
      .catch(function (error) { showToast('Gagal menyimpan pemasok: ' + error.message, 'error'); });
  }
  function submitIWSupplierMaterial(event) {
    if (event) event.preventDefault();
    iwRequest('/supplier-materials', { method: 'POST', body: {
      supplier_id: $('iw-map-supplier').value, material_id: $('iw-map-material').value,
      supplier_item_code: $('iw-map-item-code').value.trim() || null
    }}).then(function () { showToast('Bahan sudah terhubung ke pemasok.', 'success'); $('iw-form-supplier-material').reset(); return loadInventoryWorkflowContext(); })
      .catch(function (error) { showToast('Gagal menghubungkan bahan: ' + error.message, 'error'); });
  }
  function submitIWSupplierPack(event) {
    if (event) event.preventDefault();
    iwRequest('/supplier-packs', { method: 'POST', body: {
      supplier_material_id: $('iw-pack-supplier-material').value, name: $('iw-pack-name').value.trim(),
      content_quantity: Number($('iw-pack-content').value), content_uom_id: $('iw-pack-uom').value,
      unit_price: Number($('iw-pack-price').value), currency_code: 'IDR',
      minimum_order_quantity: Number($('iw-pack-minimum').value || 1)
    }}).then(function () { showToast('Satuan beli dan harga tersimpan.', 'success'); $('iw-form-supplier-pack').reset(); return loadInventoryWorkflowContext(); })
      .catch(function (error) { showToast('Gagal menyimpan satuan beli: ' + error.message, 'error'); });
  }
  function addIWPoLine() {
    var root = $('iw-po-lines');
    if (!root) return;
    _iwPoLineCount += 1;
    var id = _iwPoLineCount;
    var row = document.createElement('div');
    row.setAttribute('data-iw-po-row', String(id));
    row.style.cssText = 'display:grid;grid-template-columns:minmax(180px,2fr) minmax(90px,1fr) minmax(120px,1fr) auto;gap:8px;align-items:end;border:1px solid #E2E8F0;padding:10px;border-radius:8px;';
    row.innerHTML = '<label style="font-size:12px;">Bahan/kemasan<select class="x-input" data-iw-po-pack="' + id + '" required></select></label>' +
      '<label style="font-size:12px;">Jumlah beli<input type="number" class="x-input" min="0.000001" step="any" data-iw-po-qty="' + id + '" value="1" required></label>' +
      '<label style="font-size:12px;">Harga/kemasan<input type="number" class="x-input" min="0" step="any" data-iw-po-price="' + id + '" value="0" required></label>' +
      '<button type="button" class="x-btn-secondary" onclick="removeIWPoLine(' + id + ')">Hapus</button>';
    root.appendChild(row);
    renderIWPoLines();
  }
  function removeIWPoLine(id) {
    var row = document.querySelector('[data-iw-po-row="' + id + '"]');
    if (row) row.remove();
    if ($('iw-po-lines') && !$('iw-po-lines').children.length) addIWPoLine();
  }
  function renderIWPoLines() {
    if (!_inventoryWorkflowState) return;
    var supplierId = $('iw-po-supplier') ? $('iw-po-supplier').value : '';
    if ($('iw-po-supplier')) {
      var oldSupplier = $('iw-po-supplier').value;
      iwSetOptions('iw-po-supplier', _inventoryWorkflowState.suppliers, 'id', function (supplier) { return supplier.name + ' (' + supplier.supplier_code + ')'; }, 'Pilih pemasok', oldSupplier);
      supplierId = $('iw-po-supplier').value;
    }
    document.querySelectorAll('[data-iw-po-pack]').forEach(function (select) {
      var rowId = select.getAttribute('data-iw-po-pack');
      var current = select.value;
      var packs = (_inventoryWorkflowState.supplier_packs || []).filter(function (pack) { return !supplierId || String(pack.supplier_id) === String(supplierId); });
      iwSetOptions(select.id || ('iw-po-pack-' + rowId), packs, 'id', function (pack) {
        return pack.material_name + ' · ' + pack.name + ' · ' + iwMoney(pack.unit_price) + '/' + pack.content_uom_name;
      }, 'Pilih kemasan', current);
      // Existing selects may be created with data attributes only.
      var html = '<option value="">Pilih kemasan</option>';
      packs.forEach(function (pack) {
        html += '<option value="' + iwEsc(pack.id) + '">' + iwEsc(pack.material_name + ' · ' + pack.name + ' · ' + iwMoney(pack.unit_price)) + '</option>';
      });
      select.innerHTML = html;
      if (current && packs.some(function (pack) { return String(pack.id) === String(current); })) select.value = current;
      var priceInput = document.querySelector('[data-iw-po-price="' + rowId + '"]');
      if (priceInput && !priceInput.dataset.initialized) {
        select.addEventListener('change', function () {
          var selectedPack = (_inventoryWorkflowState.supplier_packs || []).find(function (pack) { return String(pack.id) === String(select.value); });
          if (selectedPack && priceInput) priceInput.value = selectedPack.unit_price;
        });
        priceInput.dataset.initialized = 'true';
        var selectedPack = packs.find(function (pack) { return String(pack.id) === String(select.value); });
        if (selectedPack) priceInput.value = selectedPack.unit_price;
      }
    });
  }
  function submitIWPurchaseOrder(event) {
    if (event) event.preventDefault();
    var locationId = iwLocationId();
    if (!locationId) return showToast('Siapkan lokasi stok cabang terlebih dahulu.', 'warning');
    var supplierId = $('iw-po-supplier').value;
    var lines = [];
    document.querySelectorAll('[data-iw-po-row]').forEach(function (row) {
      var rowId = row.getAttribute('data-iw-po-row');
      var packId = row.querySelector('[data-iw-po-pack]').value;
      var pack = (_inventoryWorkflowState.supplier_packs || []).find(function (item) { return String(item.id) === String(packId); });
      var qty = Number(row.querySelector('[data-iw-po-qty]').value);
      var price = Number(row.querySelector('[data-iw-po-price]').value);
      if (pack && qty > 0 && price >= 0) lines.push({ supplier_material_id: pack.supplier_material_id, supplier_pack_id: pack.id, ordered_purchase_quantity: qty, unit_price: price, currency_code: pack.currency_code || 'IDR' });
    });
    if (!supplierId || !lines.length) return showToast('Pilih pemasok dan setidaknya satu bahan/kemasan yang valid.', 'warning');
    iwRequest('/purchase-orders', { method: 'POST', body: {
      supplier_id: supplierId, destination_stock_location_id: locationId, required_at: $('iw-po-required-at').value || null, lines: lines
    }}).then(function (result) {
      return iwRequest('/purchase-orders/' + encodeURIComponent(result.purchase_order.id) + '/order', { method: 'POST', body: {} });
    }).then(function () {
      showToast('PO dibuat dan ditandai telah dipesan. Stok belum bertambah sampai barang diterima.', 'success');
      $('iw-po-lines').innerHTML = ''; _iwPoLineCount = 0; addIWPoLine(); $('iw-po-required-at').value = '';
      return loadInventoryWorkflowContext();
    }).catch(function (error) { showToast('Gagal membuat PO: ' + error.message, 'error'); });
  }
  function renderIWPurchaseOrders() {
    var root = $('iw-purchase-order-list');
    if (!root || !_inventoryWorkflowState) return;
    var locationId = iwLocationId();
    var orders = (_inventoryWorkflowState.purchase_orders || []).filter(function (po) { return !locationId || String(po.destination_stock_location_id) === String(locationId); });
    if (!orders.length) { root.innerHTML = '<div class="x-owner-stock-empty">Belum ada Purchase Order pada lokasi ini.</div>'; return; }
    var rows = orders.map(function (po) {
      var lines = (_inventoryWorkflowState.purchase_order_lines || []).filter(function (line) { return String(line.purchase_order_id) === String(po.id); });
      var action = '';
      if (po.status === 'DRAFT' || po.status === 'APPROVED') action = '<button class="x-btn-secondary" type="button" onclick="orderIWPurchaseOrder(\'' + iwEsc(po.id) + '\')">Tandai dipesan</button>';
      if (po.status === 'ORDERED' || po.status === 'PARTIALLY_RECEIVED') action = '<button class="x-btn-primary" type="button" onclick="receiveIWPurchaseOrder(\'' + iwEsc(po.id) + '\')">Terima barang</button>';
      var brief = lines.map(function (line) { return iwEsc(line.material_name) + ' · ' + iwEsc(line.ordered_purchase_quantity) + ' kemasan'; }).join('<br>');
      return '<tr><td><strong>' + iwEsc(po.id) + '</strong><div style="font-size:11px;color:#64748B;">' + iwEsc(po.created_at || '') + '</div></td><td>' + iwEsc(po.supplier_name) + '<div style="font-size:12px;">' + brief + '</div></td><td>' + iwMoney(po.ordered_value) + '</td><td><span class="x-badge ' + (po.status === 'RECEIVED' ? 'x-badge-success' : 'x-badge-warning') + '">' + iwEsc(po.status) + '</span></td><td>' + action + '</td></tr>';
    }).join('');
    root.innerHTML = '<table class="x-table"><thead><tr><th>PO</th><th>Pemasok / bahan</th><th>Nilai pesanan</th><th>Status</th><th>Aksi</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  function orderIWPurchaseOrder(id) {
    iwRequest('/purchase-orders/' + encodeURIComponent(id) + '/order', { method: 'POST', body: {} })
      .then(function () { showToast('PO ditandai telah dipesan. Belum menambah stok.', 'success'); return loadInventoryWorkflowContext(); })
      .catch(function (error) { showToast('Gagal memproses PO: ' + error.message, 'error'); });
  }
  function receiveIWPurchaseOrder(id) {
    var lines = (_inventoryWorkflowState.purchase_order_lines || []).filter(function (line) { return String(line.purchase_order_id) === String(id); });
    var accepted = [];
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      var remainingBase = Number(line.resolved_base_quantity) - Number(line.received_base_quantity || 0);
      var perPack = Number(line.base_quantity_per_purchase_unit || 1);
      var remainingPurchase = Math.max(0, remainingBase / perPack);
      if (remainingPurchase <= 0) continue;
      var value = window.prompt('Jumlah kemasan diterima untuk ' + line.material_name + ' (sisa ' + remainingPurchase + '):', String(Number(remainingPurchase.toFixed(4))));
      if (value === null) return;
      var qty = Number(value);
      if (Number.isFinite(qty) && qty > 0) accepted.push({ purchase_order_line_id: line.id, accepted_purchase_quantity: qty, rejected_purchase_quantity: 0 });
    }
    if (!accepted.length) return showToast('Isi minimal satu jumlah penerimaan yang lebih besar dari nol.', 'warning');
    var postingId = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : ('gr_' + Date.now() + '_' + Math.random().toString(36).slice(2));
    iwRequest('/purchase-orders/' + encodeURIComponent(id) + '/receive', { method: 'POST', body: { goods_receipt_posting_id: postingId, lines: accepted } })
      .then(function () { showToast('Penerimaan diposting. Stok bahan dan nilai persediaan diperbarui.', 'success'); return loadInventoryWorkflowContext(); })
      .catch(function (error) { showToast('Gagal menerima barang: ' + error.message, 'error'); });
  }
  function addIWRecipeComponent() {
    var root = $('iw-recipe-components');
    if (!root) return;
    _iwRecipeLineCount += 1;
    var id = _iwRecipeLineCount;
    var row = document.createElement('div');
    row.setAttribute('data-iw-recipe-row', String(id));
    row.style.cssText = 'display:grid;grid-template-columns:minmax(180px,2fr) minmax(100px,1fr) auto;gap:8px;align-items:end;';
    row.innerHTML = '<label style="font-size:12px;">Bahan<select class="x-input" data-iw-recipe-material="' + id + '" required></select></label>' +
      '<label style="font-size:12px;">Jumlah per batch<input type="number" min="0.000001" step="any" class="x-input" data-iw-recipe-qty="' + id + '" value="1" required></label>' +
      '<button type="button" class="x-btn-secondary" onclick="removeIWRecipeComponent(' + id + ')">Hapus</button>';
    root.appendChild(row);
    renderIWRecipeComponentOptions();
  }
  function removeIWRecipeComponent(id) {
    var row = document.querySelector('[data-iw-recipe-row="' + id + '"]');
    if (row) row.remove();
    if ($('iw-recipe-components') && !$('iw-recipe-components').children.length) addIWRecipeComponent();
  }
  function renderIWRecipeComponentOptions() {
    if (!_inventoryWorkflowState) return;
    document.querySelectorAll('[data-iw-recipe-material]').forEach(function (select) {
      var current = select.value;
      iwSetOptions(select.id || 'iw-unused-select', _inventoryWorkflowState.materials, 'id', function (material) {
        var uom = (_inventoryWorkflowState.uoms || []).find(function (u) { return String(u.id) === String(material.base_uom_id); }) || {};
        return material.name + ' · ' + (uom.code || uom.name || 'satuan dasar');
      }, 'Pilih bahan baku', current);
    });
  }
  function onIWRecipeProductChange() {
    var product = (_inventoryWorkflowState && _inventoryWorkflowState.products || []).find(function (item) {
      return String(item.id) === String($('iw-recipe-output-product').value);
    });
    if (product && $('iw-recipe-yield-uom')) $('iw-recipe-yield-uom').value = product.product_stock_uom_id || '';
    if (product && $('iw-recipe-name') && !$('iw-recipe-name').value) $('iw-recipe-name').value = product.name;
  }
  function submitIWRecipe(event) {
    if (event) event.preventDefault();
    var locationId = iwLocationId();
    if (!locationId) return showToast('Siapkan lokasi stok cabang terlebih dahulu.', 'warning');
    var outputProductId = $('iw-recipe-output-product').value;
    var product = (_inventoryWorkflowState.products || []).find(function (item) { return String(item.id) === String(outputProductId); });
    var components = [];
    document.querySelectorAll('[data-iw-recipe-row]').forEach(function (row) {
      var materialId = row.querySelector('[data-iw-recipe-material]').value;
      var qty = Number(row.querySelector('[data-iw-recipe-qty]').value);
      var material = (_inventoryWorkflowState.materials || []).find(function (item) { return String(item.id) === String(materialId); });
      if (material && qty > 0) components.push({ material_id: materialId, planned_quantity: qty, planned_uom_id: material.base_uom_id });
    });
    if (!product || !product.product_stock_uom_id) return showToast('Pilih Product SKU yang memiliki satuan stok aktif.', 'warning');
    if (!components.length) return showToast('Tambahkan minimal satu bahan resep.', 'warning');
    iwRequest('/recipes', { method: 'POST', body: {
      stock_location_id: locationId, output_product_id: outputProductId, name: $('iw-recipe-name').value.trim(),
      planned_yield_quantity: Number($('iw-recipe-yield').value), yield_uom_id: $('iw-recipe-yield-uom').value,
      components: components
    }}).then(function () {
      showToast('Resep disimpan dan diaktifkan. Produksi dapat dicatat.', 'success');
      $('iw-form-recipe').reset(); $('iw-recipe-components').innerHTML = ''; _iwRecipeLineCount = 0; addIWRecipeComponent();
      return loadInventoryWorkflowContext();
    }).catch(function (error) { showToast('Gagal menyimpan resep: ' + error.message, 'error'); });
  }
  function renderIWBatchComponents() {
    var root = $('iw-batch-components');
    if (!root || !_inventoryWorkflowState) return;
    var versionId = $('iw-batch-recipe').value;
    var recipe = (_inventoryWorkflowState.recipes || []).find(function (item) { return String(item.recipe_version_id) === String(versionId); });
    if (!recipe) { root.innerHTML = '<div class="x-owner-stock-empty">Pilih resep untuk menampilkan bahan yang akan dikonsumsi.</div>'; return; }
    var plannedOutput = Number($('iw-batch-planned-output').value || recipe.planned_yield_quantity);
    var ratio = plannedOutput > 0 ? plannedOutput / Number(recipe.planned_yield_quantity) : 1;
    root.innerHTML = '<div style="font-size:12px;color:#475569;font-weight:700;">Pemakaian aktual per bahan (boleh dikoreksi)</div>' + (recipe.components || []).map(function (component, index) {
      var defaultQuantity = Number(component.planned_quantity) * ratio;
      return '<label style="display:grid;grid-template-columns:minmax(130px,1fr) minmax(100px,140px);gap:8px;align-items:center;font-size:12px;">' +
        '<span>' + iwEsc(component.material_name) + '<small style="display:block;color:#64748B;">Rencana ' + iwEsc(Number(defaultQuantity.toFixed(4))) + ' ' + iwEsc(component.planned_uom_name) + '</small></span>' +
        '<input type="number" min="0.000001" step="any" required class="x-input" data-iw-batch-material="' + iwEsc(component.material_id) + '" data-iw-batch-uom="' + iwEsc(component.planned_uom_id) + '" value="' + iwEsc(Number(defaultQuantity.toFixed(4))) + '">' +
        '</label>';
    }).join('');
  }
  function submitIWProductionBatch(event) {
    if (event) event.preventDefault();
    var locationId = iwLocationId();
    if (!locationId) return showToast('Siapkan lokasi stok cabang terlebih dahulu.', 'warning');
    var recipe = (_inventoryWorkflowState.recipes || []).find(function (item) { return String(item.recipe_version_id) === String($('iw-batch-recipe').value); });
    if (!recipe) return showToast('Pilih resep aktif.', 'warning');
    var consumptions = [];
    document.querySelectorAll('[data-iw-batch-material]').forEach(function (input) {
      var qty = Number(input.value);
      if (qty > 0) consumptions.push({ material_id: input.getAttribute('data-iw-batch-material'), source_uom_id: input.getAttribute('data-iw-batch-uom'), actual_quantity: qty });
    });
    if (!consumptions.length) return showToast('Masukkan pemakaian bahan aktual.', 'warning');
    var batchId = $('iw-batch-id') ? $('iw-batch-id').value.trim() : '';
    var postingInput = $('iw-batch-posting-id');
    var postingId = postingInput && postingInput.value.trim();
    if (!postingId) {
      postingId = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : ('prod_' + Date.now() + '_' + Math.random().toString(36).slice(2));
      if (postingInput) postingInput.value = postingId;
    }
    var payload = {
      stock_location_id: locationId, output_product_id: recipe.output_product_id,
      planned_output_quantity: Number($('iw-batch-planned-output').value),
      actual_output_quantity: Number($('iw-batch-actual-output').value),
      actual_consumptions: consumptions, production_posting_id: postingId, currency_code: 'IDR'
    };
    if (batchId) payload.production_batch_id = batchId;
    iwRequest('/production-batches', { method: 'POST', body: payload }).then(function (result) {
      var snapshot = result.posting && result.posting.snapshot || {};
      showToast('Produksi diposting: stok bahan berkurang dan stok produk bertambah. Biaya bahan aktual ' + iwMoney(snapshot.actual_material_cost) + '.', 'success');
      $('iw-form-batch').reset();
      if ($('iw-batch-id')) $('iw-batch-id').value = '';
      if ($('iw-batch-posting-id')) $('iw-batch-posting-id').value = '';
      var note = $('iw-batch-resume-note');
      if (note) { note.style.display = 'none'; note.textContent = ''; }
      return loadInventoryWorkflowContext();
    }).catch(function (error) {
      if (error.batchId) {
        if ($('iw-batch-id')) $('iw-batch-id').value = error.batchId;
        var note = $('iw-batch-resume-note');
        if (note) {
          note.style.display = 'block';
          note.textContent = 'Batch ' + error.batchId + ' belum selesai. Perbaiki penyebabnya lalu coba lagi; sistem akan melanjutkan batch yang sama, bukan membuat batch baru.';
        }
        showToast('Batch belum diposting: ' + error.message + '. Batch yang sama disimpan untuk dicoba ulang.', 'warning');
        loadInventoryWorkflowContext();
      } else {
        showToast('Produksi gagal diposting: ' + error.message, 'error');
      }
    });
  }
  function resumeIWProductionBatch(batchId) {
    var batch = (_inventoryWorkflowState && _inventoryWorkflowState.batches || []).find(function (item) { return String(item.id) === String(batchId); });
    if (!batch || batch.status !== 'IN_PROGRESS') return showToast('Hanya batch yang sedang berjalan yang dapat dilanjutkan.', 'warning');
    var recipe = (_inventoryWorkflowState.recipes || []).find(function (item) { return String(item.recipe_version_id) === String(batch.recipe_version_id); });
    if (!recipe) return showToast('Resep versi batch ini tidak tersedia. Perlu pemeriksaan data.', 'error');
    if (String(batch.production_stock_location_id) !== String(iwLocationId())) return showToast('Pilih lokasi stok tempat batch ini dibuat terlebih dahulu.', 'warning');
    if ($('iw-batch-id')) $('iw-batch-id').value = batch.id;
    if ($('iw-batch-posting-id')) $('iw-batch-posting-id').value = batch.production_posting_id || '';
    if ($('iw-batch-recipe')) $('iw-batch-recipe').value = batch.recipe_version_id;
    if ($('iw-batch-planned-output')) $('iw-batch-planned-output').value = batch.planned_output_quantity;
    if ($('iw-batch-actual-output')) $('iw-batch-actual-output').value = batch.actual_output_quantity || batch.planned_output_quantity;
    renderIWBatchComponents();
    var note = $('iw-batch-resume-note');
    if (note) {
      note.style.display = 'block';
      note.textContent = 'Melanjutkan batch ' + batch.id + '. Masukkan kembali pemakaian aktual jika belum tersimpan.';
    }
    switchStockSubtab('production');
    showToast('Batch dipilih untuk dilanjutkan. Periksa pemakaian aktual sebelum memposting.', 'success');
  }
  function renderIWProductionBatches() {
    var root = $('iw-production-batch-list');
    if (!root || !_inventoryWorkflowState) return;
    var currentLocation = iwLocationId();
    var batches = (_inventoryWorkflowState.batches || []).filter(function (batch) {
      return !currentLocation || String(batch.production_stock_location_id) === String(currentLocation);
    });
    var rows = batches.map(function (batch) {
      var action = batch.status === 'IN_PROGRESS'
        ? '<button type="button" class="x-btn-primary" onclick="resumeIWProductionBatch(\'' + iwEsc(batch.id) + '\')">Lanjutkan</button>'
        : '';
      return '<tr><td><strong>' + iwEsc(batch.production_item_name) + '</strong><div style="font-size:11px;color:#64748B;">' + iwEsc(batch.id) + '</div></td>' +
        '<td>' + iwEsc(batch.planned_output_quantity) + ' rencana / ' + (batch.actual_output_quantity == null ? '—' : iwEsc(batch.actual_output_quantity)) + ' aktual</td>' +
        '<td><span class="x-badge ' + (batch.status === 'COMPLETED' ? 'x-badge-success' : 'x-badge-warning') + '">' + iwEsc(batch.status) + '</span></td>' +
        '<td>' + (batch.production_output_unit_cost == null ? '—' : iwMoney(batch.production_output_unit_cost) + ' per unit') + '</td><td>' + action + '</td></tr>';
    }).join('');
    root.innerHTML = rows ? '<table class="x-table"><thead><tr><th>Produksi</th><th>Jumlah hasil</th><th>Status</th><th>Biaya produk</th><th>Aksi</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<div class="x-owner-stock-empty">Belum ada batch produksi.</div>';
  }

  window.switchStockSubtab = switchStockSubtab;
  window.loadInventoryWorkflowContext = loadInventoryWorkflowContext;
  window.onIWBranchChange = onIWBranchChange;
  window.onIWLocationChange = onIWLocationChange;
  window.ensureIWStockLocation = ensureIWStockLocation;
  window.saveIWReorderPolicy = saveIWReorderPolicy;
  window.submitIWSupplier = submitIWSupplier;
  window.submitIWSupplierMaterial = submitIWSupplierMaterial;
  window.submitIWSupplierPack = submitIWSupplierPack;
  window.addIWPoLine = addIWPoLine;
  window.removeIWPoLine = removeIWPoLine;
  window.renderIWPoLines = renderIWPoLines;
  window.submitIWPurchaseOrder = submitIWPurchaseOrder;
  window.orderIWPurchaseOrder = orderIWPurchaseOrder;
  window.receiveIWPurchaseOrder = receiveIWPurchaseOrder;
  window.addIWRecipeComponent = addIWRecipeComponent;
  window.removeIWRecipeComponent = removeIWRecipeComponent;
  window.onIWRecipeProductChange = onIWRecipeProductChange;
  window.submitIWRecipe = submitIWRecipe;
  window.renderIWBatchComponents = renderIWBatchComponents;
  window.submitIWProductionBatch = submitIWProductionBatch;
  window.resumeIWProductionBatch = resumeIWProductionBatch;

  function loadOwnerUoms() {
    return adminFetch('/api/admin/uoms', { headers: getAuthHeaders() })
      .then(function (res) {
        if (!res.ok) throw new Error('Gagal memuat UOM');
        return res.json();
      })
      .then(function (data) {
        _ownerUoms = data.uoms || [];
        var select = $('mat-input-uom');
        if (select && _ownerUoms.length > 0) {
          var html = '<option value="">Pilih Satuan Dasar...</option>';
          _ownerUoms.forEach(function (u) {
            html += '<option value="' + escapeHtml(u.id) + '">' + escapeHtml(u.name) + ' (' + escapeHtml(u.code) + ')</option>';
          });
          select.innerHTML = html;
        }
      })
      .catch(function (err) {
        console.warn('[Materials] Load UOM error:', err.message);
      });
  }

  function loadOwnerMaterials() {
    var container = $('owner-materials-table-container');
    if (container) {
      container.innerHTML = '<div class="x-owner-stock-loading">Memuat daftar bahan baku...</div>';
    }

    adminFetch('/api/admin/materials', { headers: getAuthHeaders() })
      .then(function (res) {
        if (!res.ok) throw new Error('Gagal mengambil data bahan baku (HTTP ' + res.status + ')');
        return res.json();
      })
      .then(function (data) {
        _ownerMaterials = data.materials || [];
        renderOwnerMaterialsTable(_ownerMaterials);
      })
      .catch(function (err) {
        if (container) {
          container.innerHTML = '<div class="x-owner-stock-error" style="color:#DC2626; padding:16px;">' + escapeHtml(err.message) + '</div>';
        }
      });
  }

  function renderOwnerMaterialsTable(materials) {
    var container = $('owner-materials-table-container');
    if (!container) return;

    if (!materials || materials.length === 0) {
      container.innerHTML = (
        '<div style="text-align:center; padding:32px 16px; color:#64748B;">' +
          '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="1.5" style="margin-bottom:8px;"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>' +
          '<div style="font-size:14px; font-weight:600; color:#334155; margin-bottom:4px;">Belum ada bahan baku</div>' +
          '<p style="font-size:13px; margin:0 0 16px 0;">Tambahkan bahan baku pertama untuk menyusun resep dan procurement.</p>' +
          '<button type="button" onclick="openAddMaterialModal()" style="display:inline-flex; align-items:center; gap:6px; padding:8px 16px; border-radius:8px; font-weight:600; font-size:13px; background:#0F172A; color:#FFFFFF; border:none; cursor:pointer;">+ Tambah Bahan</button>' +
        '</div>'
      );
      return;
    }

    var rows = materials.map(function (m) {
      var isArchived = m.status === 'archived';
      var statusBadge = isArchived
        ? '<span style="background:#F1F5F9; color:#64748B; padding:3px 8px; border-radius:4px; font-size:11px; font-weight:600;">Diarsipkan</span>'
        : '<span style="background:#ECFDF5; color:#059669; padding:3px 8px; border-radius:4px; font-size:11px; font-weight:600;">Aktif</span>';

      var actionBtn = isArchived
        ? '<span style="font-size:12px; color:#94A3B8;">-</span>'
        : '<button type="button" onclick="archiveOwnerMaterial(\'' + escapeHtml(m.id) + '\', \'' + escapeHtml(m.name).replace(/'/g, "\\'") + '\')" style="background:none; border:none; color:#DC2626; cursor:pointer; font-size:12px; font-weight:600; padding:4px 8px;">Arsipkan</button>';

      var uomLabel = m.base_uom_name ? (m.base_uom_name + ' (' + m.base_uom_code + ')') : (m.base_uom_code || m.base_uom_id);

      return (
        '<tr style="border-bottom:1px solid #F1F5F9;">' +
          '<td style="padding:12px 14px; font-weight:600; color:#0F172A; font-size:13px;">' + escapeHtml(m.material_code) + '</td>' +
          '<td style="padding:12px 14px; color:#334155; font-size:13px;">' +
            '<div style="font-weight:600;">' + escapeHtml(m.name) + '</div>' +
            (m.description ? '<div style="font-size:11px; color:#64748B;">' + escapeHtml(m.description) + '</div>' : '') +
          '</td>' +
          '<td style="padding:12px 14px; color:#475569; font-size:13px;">' + escapeHtml(uomLabel) + '</td>' +
          '<td style="padding:12px 14px; font-size:13px;">' + statusBadge + '</td>' +
          '<td style="padding:12px 14px; text-align:right; font-size:13px;">' + actionBtn + '</td>' +
        '</tr>'
      );
    }).join('');

    container.innerHTML = (
      '<div style="overflow-x:auto;">' +
        '<table style="width:100%; border-collapse:collapse; text-align:left;">' +
          '<thead>' +
            '<tr style="background:#F8FAFC; border-bottom:1px solid #E2E8F0; color:#64748B; font-size:12px; text-transform:uppercase; letter-spacing:0.025em;">' +
              '<th style="padding:10px 14px; font-weight:600;">Kode</th>' +
              '<th style="padding:10px 14px; font-weight:600;">Nama Bahan</th>' +
              '<th style="padding:10px 14px; font-weight:600;">Satuan Dasar</th>' +
              '<th style="padding:10px 14px; font-weight:600;">Status</th>' +
              '<th style="padding:10px 14px; font-weight:600; text-align:right;">Aksi</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>'
    );
  }

  function openAddMaterialModal() {
    var modal = $('modal-add-material');
    if (modal) {
      modal.style.display = 'flex';
      loadOwnerUoms();
    }
  }

  function closeAddMaterialModal() {
    var modal = $('modal-add-material');
    if (modal) modal.style.display = 'none';
    var form = $('form-add-material');
    if (form) form.reset();
  }

  function submitAddMaterialForm(event) {
    if (event && event.preventDefault) event.preventDefault();

    var code = ($('mat-input-code') ? $('mat-input-code').value : '').trim();
    var name = ($('mat-input-name') ? $('mat-input-name').value : '').trim();
    var uomId = ($('mat-input-uom') ? $('mat-input-uom').value : '').trim();
    var desc = ($('mat-input-desc') ? $('mat-input-desc').value : '').trim();
    var btn = $('btn-save-material');

    if (!code || !name || !uomId) {
      showToast('Harap lengkapi kode, nama, dan satuan dasar bahan.', 'warning');
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Menyimpan...';
    }

    var payload = {
      material_code: code,
      name: name,
      base_uom_id: uomId,
      description: desc || null
    };

    adminFetch('/api/admin/materials', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (errData) {
            throw new Error(errData.message || 'Gagal menyimpan bahan baku');
          });
        }
        return res.json();
      })
      .then(function () {
        showToast('✅ Bahan baku berhasil ditambahkan.', 'success');
        closeAddMaterialModal();
        loadOwnerMaterials();
      })
      .catch(function (err) {
        showToast('❌ Gagal: ' + err.message, 'error');
      })
      .finally(function () {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Simpan Bahan';
        }
      });
  }

  async function archiveOwnerMaterial(id, name) {
    var confirmed = await confirmFeatureAction('archive-material', 'Arsipkan Bahan Baku', 'Apakah Anda yakin ingin mengarsipkan bahan baku "' + name + '"?', 'Arsipkan');
    if (!confirmed) return;

    adminFetch('/api/admin/materials/' + encodeURIComponent(id) + '/archive', {
      method: 'PUT',
      headers: getAuthHeaders()
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (errData) {
            throw new Error(errData.message || 'Gagal mengarsipkan');
          });
        }
        return res.json();
      })
      .then(function () {
        showToast('✅ Bahan baku berhasil diarsipkan.', 'success');
        loadOwnerMaterials();
      })
      .catch(function (err) {
        showToast('❌ Gagal: ' + err.message, 'error');
      });
  }

  // Export to window for inline HTML onclick handlers
  window.switchStockSubtab = switchStockSubtab;
  window.openAddMaterialModal = openAddMaterialModal;
  window.closeAddMaterialModal = closeAddMaterialModal;
  window.submitAddMaterialForm = submitAddMaterialForm;
  window.archiveOwnerMaterial = archiveOwnerMaterial;
  window.loadOwnerMaterials = loadOwnerMaterials;

  /* =========================================================================
     MODUL 6: REPORTS ENGINE (PHASE 4)
     ========================================================================= */
  var _activeReportType = 'overview';
  var _reportFilter = {
    startDate: '',
    endDate: ''
  };

  async function loadReports(reportType) {
    if (reportType) _activeReportType = reportType;

    // Update active subnav tab
    document.querySelectorAll('#reports-subnav .x-subnav-tab').forEach(function (tab) {
      var rt = tab.dataset.report;
      tab.classList.toggle('active', rt === _activeReportType);
    });

    // Update branch badge indicator
    var branchId = getEffectiveBranchId();
    var branchBadge = $('report-branch-badge');
    if (branchBadge) {
      var branchName = 'Semua Cabang';
      if (branchId) {
        var found = (_branchContextState.branches || []).find(function (b) { return String(b.id) === String(branchId); });
        if (found) branchName = found.name;
      }
      branchBadge.textContent = branchName;
    }

    // Role-based subnav visibility
    var branchesTab = document.querySelector('#reports-subnav .x-subnav-tab[data-report="branches"]');
    var customersTab = document.querySelector('#reports-subnav .x-subnav-tab[data-report="customers"]');
    if (isBranchManager()) {
      if (branchesTab) branchesTab.style.display = 'none';
      if (customersTab) customersTab.style.display = 'none';
      if (_activeReportType === 'branches' || _activeReportType === 'customers') {
        _activeReportType = 'overview';
      }
    } else {
      if (branchesTab) branchesTab.style.display = '';
      if (customersTab) customersTab.style.display = '';
    }

    var queryParams = [];
    if (branchId) queryParams.push('branch_id=' + encodeURIComponent(branchId));
    if (_reportFilter.startDate) queryParams.push('start_date=' + encodeURIComponent(_reportFilter.startDate));
    if (_reportFilter.endDate) queryParams.push('end_date=' + encodeURIComponent(_reportFilter.endDate));

    var summaryCards = $('report-summary-cards');
    var tableContainer = $('report-table-container');
    var titleEl = $('report-table-title');
    var subEl = $('report-table-subtitle');

    if (tableContainer) tableContainer.innerHTML = '<div class="x-empty-state">Memuat data laporan...</div>';

    try {
      var endpoint = _activeReportType === 'overview'
        ? '/admin/overview'
        : '/reports/' + encodeURIComponent(_activeReportType);

      var url = API_BASE + endpoint + (queryParams.length > 0 ? '?' + queryParams.join('&') : '');
      var res = await adminFetch(url, { headers: getAuthHeaders() });
      var json = await res.json();

      if (!json.success) {
        if (tableContainer) tableContainer.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">⚠️</div>' + escapeHtml(json.error || json.message || 'Gagal memuat laporan.') + '</div>';
        return;
      }

      renderReportPayload(_activeReportType, json.data);
    } catch (e) {
      console.warn('[Reports Load Error]:', e);
      if (tableContainer) tableContainer.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">⚠️</div>Terjadi kesalahan saat memuat laporan.</div>';
    }
  }

  function renderReportPayload(reportType, data) {
    var summaryCards = $('report-summary-cards');
    var tableContainer = $('report-table-container');
    var titleEl = $('report-table-title');
    var subEl = $('report-table-subtitle');

    if (!data) {
      if (tableContainer) tableContainer.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">📄</div>Tidak ada data untuk periode ini.</div>';
      return;
    }

    switch (reportType) {
      case 'overview':
        if (titleEl) titleEl.textContent = 'Ringkasan Laporan Bisnis';
        if (subEl) subEl.textContent = 'Indikator performa utama per cabang dan periode';
        renderOverviewReport(data, summaryCards, tableContainer);
        break;

      case 'sales':
      case 'orders':
        if (titleEl) titleEl.textContent = reportType === 'sales' ? 'Laporan Penjualan (Sales)' : 'Laporan Pesanan (Orders)';
        if (subEl) subEl.textContent = 'Rincian transaksi, pesanan per channel, dan per metode pemenuhan';
        renderSalesReport(data, summaryCards, tableContainer);
        break;

      case 'products':
        if (titleEl) titleEl.textContent = 'Laporan Produk & Menu';
        if (subEl) subEl.textContent = 'Performa penjualan menu dan kontribusi kategori';
        renderProductsReport(data, summaryCards, tableContainer);
        break;

      case 'customers':
        if (titleEl) titleEl.textContent = 'Laporan Pelanggan';
        if (subEl) subEl.textContent = 'Analitik basis pelanggan, frekuensi belanja, dan total transaksi';
        renderCustomersReport(data, summaryCards, tableContainer);
        break;

      case 'branches':
        if (titleEl) titleEl.textContent = 'Laporan Perbandingan Cabang';
        if (subEl) subEl.textContent = 'Komparasi omzet, pesanan, dan AOV antar seluruh cabang';
        renderBranchesReport(data, summaryCards, tableContainer);
        break;

      case 'operations':
        if (titleEl) titleEl.textContent = 'Laporan Operasional & Stok';
        if (subEl) subEl.textContent = 'Peringatan stok menipis dan pergerakan persediaan';
        renderOperationsReport(data, summaryCards, tableContainer);
        break;

      default:
        if (tableContainer) tableContainer.innerHTML = '<div class="x-empty-state">Laporan tidak dikenali.</div>';
    }
  }

  function renderOverviewReport(data, cardsEl, tableEl) {
    var kpis = data.kpis || {};
    if (cardsEl) {
      cardsEl.innerHTML =
        '<div class="x-metric-card"><div class="x-metric-icon bg-green">💰</div><div class="x-metric-info"><span class="x-metric-label">Net Sales</span><h3 class="x-metric-value">' + formatMoney(kpis.net_sales || 0) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-blue">📦</div><div class="x-metric-info"><span class="x-metric-label">Orders</span><h3 class="x-metric-value">' + (kpis.orders || 0) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-amber">👥</div><div class="x-metric-info"><span class="x-metric-label">Customers</span><h3 class="x-metric-value">' + (kpis.customers || 0) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-green">🎯</div><div class="x-metric-info"><span class="x-metric-label">AOV</span><h3 class="x-metric-value">' + formatMoney(kpis.aov || 0) + '</h3></div></div>';
    }

    var timeline = (data.sales_performance && data.sales_performance.timeline) || [];
    if (!timeline || timeline.length === 0) {
      if (tableEl) tableEl.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">📅</div>Belum ada riwayat penjualan pada filter ini.</div>';
      return;
    }

    var html = '<table class="x-data-table"><thead><tr><th>Tanggal</th><th>Jumlah Pesanan</th><th>Total Omzet</th></tr></thead><tbody>';
    timeline.forEach(function (row) {
      html += '<tr><td><strong>' + escapeHtml(row.date) + '</strong></td><td>' + (row.order_count || 0) + ' pesanan</td><td><strong>' + formatMoney(row.revenue || 0) + '</strong></td></tr>';
    });
    html += '</tbody></table>';
    if (tableEl) tableEl.innerHTML = html;
  }

  function renderSalesReport(data, cardsEl, tableEl) {
    var summary = data.summary || {};
    if (cardsEl) {
      cardsEl.innerHTML =
        '<div class="x-metric-card"><div class="x-metric-icon bg-green">💰</div><div class="x-metric-info"><span class="x-metric-label">Total Omzet</span><h3 class="x-metric-value">' + formatMoney(summary.gross_revenue || 0) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-blue">📦</div><div class="x-metric-info"><span class="x-metric-label">Total Pesanan</span><h3 class="x-metric-value">' + (summary.total_orders || 0) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-amber">🛵</div><div class="x-metric-info"><span class="x-metric-label">Total Ongkir</span><h3 class="x-metric-value">' + formatMoney(summary.total_delivery_fees || 0) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-green">🎯</div><div class="x-metric-info"><span class="x-metric-label">Rata-rata Nilai (AOV)</span><h3 class="x-metric-value">' + formatMoney(summary.average_order_value || 0) + '</h3></div></div>';
    }

    var byChannel = data.by_channel || [];
    var byFulfillment = data.by_fulfillment || [];

    if (byChannel.length === 0 && byFulfillment.length === 0) {
      if (tableEl) tableEl.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">📊</div>Belum ada transaksi penjualan tercatat.</div>';
      return;
    }

    var html = '<h4 style="font-size:14px;font-weight:700;margin-bottom:10px;">Penjualan per Channel</h4>';
    html += '<table class="x-data-table mb-4"><thead><tr><th>Channel</th><th>Pesanan</th><th>Omzet</th></tr></thead><tbody>';
    byChannel.forEach(function (c) {
      html += '<tr><td><span class="x-badge">' + escapeHtml(c.order_channel || 'customer_app') + '</span></td><td>' + (c.order_count || 0) + '</td><td><strong>' + formatMoney(c.total_revenue || 0) + '</strong></td></tr>';
    });
    html += '</tbody></table>';

    html += '<h4 style="font-size:14px;font-weight:700;margin:20px 0 10px;">Penjualan per Fulfillment Type</h4>';
    html += '<table class="x-data-table"><thead><tr><th>Fulfillment</th><th>Pesanan</th><th>Omzet</th></tr></thead><tbody>';
    byFulfillment.forEach(function (f) {
      html += '<tr><td><span class="x-badge" style="background:#ecfdf5;color:#065f46;">' + escapeHtml(f.fulfillment_type || 'delivery') + '</span></td><td>' + (f.order_count || 0) + '</td><td><strong>' + formatMoney(f.total_revenue || 0) + '</strong></td></tr>';
    });
    html += '</tbody></table>';

    if (tableEl) tableEl.innerHTML = html;
  }

  function renderProductsReport(data, cardsEl, tableEl) {
    var topProducts = data.top_products || [];
    var categories = data.category_contribution || [];

    if (cardsEl) {
      var totalUnits = topProducts.reduce(function (sum, p) { return sum + (p.total_units_sold || 0); }, 0);
      var totalSales = topProducts.reduce(function (sum, p) { return sum + (p.total_gross_sales || 0); }, 0);

      cardsEl.innerHTML =
        '<div class="x-metric-card"><div class="x-metric-icon bg-green">🍔</div><div class="x-metric-info"><span class="x-metric-label">Item Terjual</span><h3 class="x-metric-value">' + totalUnits + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-blue">💰</div><div class="x-metric-info"><span class="x-metric-label">Penjualan Produk</span><h3 class="x-metric-value">' + formatMoney(totalSales) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-amber">🏷️</div><div class="x-metric-info"><span class="x-metric-label">Kategori Aktif</span><h3 class="x-metric-value">' + categories.length + '</h3></div></div>';
    }

    if (topProducts.length === 0) {
      if (tableEl) tableEl.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">🍔</div>Belum ada data penjualan menu pada filter ini.</div>';
      return;
    }

    var html = '<table class="x-data-table"><thead><tr><th>Produk</th><th>Kategori</th><th>Total Terjual</th><th>Total Omzet</th></tr></thead><tbody>';
    topProducts.forEach(function (p) {
      html += '<tr><td><strong>' + escapeHtml(p.product_name) + '</strong></td><td><span class="x-badge">' + escapeHtml(p.category_name || 'Uncategorized') + '</span></td><td>' + (p.total_units_sold || 0) + ' item</td><td><strong>' + formatMoney(p.total_gross_sales || 0) + '</strong></td></tr>';
    });
    html += '</tbody></table>';

    if (tableEl) tableEl.innerHTML = html;
  }

  function renderCustomersReport(data, cardsEl, tableEl) {
    var summary = data.summary || {};
    var customers = data.top_customers || [];

    if (cardsEl) {
      cardsEl.innerHTML =
        '<div class="x-metric-card"><div class="x-metric-icon bg-blue">👥</div><div class="x-metric-info"><span class="x-metric-label">Pelanggan Unik</span><h3 class="x-metric-value">' + (summary.total_unique_customers || 0) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-green">📦</div><div class="x-metric-info"><span class="x-metric-label">Total Pesanan</span><h3 class="x-metric-value">' + (summary.total_orders || 0) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-amber">💰</div><div class="x-metric-info"><span class="x-metric-label">Rata-rata Belanja</span><h3 class="x-metric-value">' + formatMoney(summary.average_spend_per_customer || 0) + '</h3></div></div>';
    }

    if (customers.length === 0) {
      if (tableEl) tableEl.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">👥</div>Belum ada data pelanggan dengan riwayat transaksi.</div>';
      return;
    }

    var html = '<table class="x-data-table"><thead><tr><th>Nama Pelanggan</th><th>No. WhatsApp</th><th>Total Transaksi</th><th>Total Belanja</th><th>Pesanan Terakhir</th></tr></thead><tbody>';
    customers.forEach(function (c) {
      html += '<tr>' +
        '<td><strong>' + escapeHtml(c.customer_name || 'Pelanggan') + '</strong></td>' +
        '<td>' + escapeHtml(c.customer_phone || '-') + '</td>' +
        '<td>' + (c.total_orders || 0) + ' pesanan</td>' +
        '<td><strong style="color:#059669;">' + formatMoney(c.total_spent || 0) + '</strong></td>' +
        '<td><span class="text-muted">' + escapeHtml(c.last_order_date || '-') + '</span></td>' +
      '</tr>';
    });
    html += '</tbody></table>';

    if (tableEl) tableEl.innerHTML = html;
  }

  function renderBranchesReport(data, cardsEl, tableEl) {
    var branches = data.branches || [];

    if (cardsEl) {
      var totalRev = branches.reduce(function (sum, b) { return sum + (b.total_revenue || 0); }, 0);
      var totalOrd = branches.reduce(function (sum, b) { return sum + (b.total_orders || 0); }, 0);

      cardsEl.innerHTML =
        '<div class="x-metric-card"><div class="x-metric-icon bg-green">🏢</div><div class="x-metric-info"><span class="x-metric-label">Jumlah Cabang</span><h3 class="x-metric-value">' + branches.length + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-blue">💰</div><div class="x-metric-info"><span class="x-metric-label">Total Omzet Jaringan</span><h3 class="x-metric-value">' + formatMoney(totalRev) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-amber">📦</div><div class="x-metric-info"><span class="x-metric-label">Total Pesanan Seluruh Cabang</span><h3 class="x-metric-value">' + totalOrd + '</h3></div></div>';
    }

    if (branches.length === 0) {
      if (tableEl) tableEl.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">🏢</div>Belum ada data cabang.</div>';
      return;
    }

    var html = '<table class="x-data-table"><thead><tr><th>Cabang</th><th>Total Pesanan</th><th>AOV</th><th>Total Omzet</th></tr></thead><tbody>';
    branches.forEach(function (b) {
      html += '<tr>' +
        '<td><strong>' + escapeHtml(b.branch_name) + '</strong></td>' +
        '<td>' + (b.total_orders || 0) + '</td>' +
        '<td>' + formatMoney(b.average_order_value || 0) + '</td>' +
        '<td><strong style="color:#059669;">' + formatMoney(b.total_revenue || 0) + '</strong></td>' +
      '</tr>';
    });
    html += '</tbody></table>';

    if (tableEl) tableEl.innerHTML = html;
  }

  function renderOperationsReport(data, cardsEl, tableEl) {
    var alerts = data.low_stock_alerts || [];
    var movements = data.movement_breakdown || [];

    if (cardsEl) {
      cardsEl.innerHTML =
        '<div class="x-metric-card"><div class="x-metric-icon bg-amber">⚠️</div><div class="x-metric-info"><span class="x-metric-label">Alert Stok Menipis</span><h3 class="x-metric-value">' + alerts.length + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-blue">🔄</div><div class="x-metric-info"><span class="x-metric-label">Tipe Mutasi Stok</span><h3 class="x-metric-value">' + movements.length + '</h3></div></div>';
    }

    var html = '<h4 style="font-size:14px;font-weight:700;margin-bottom:10px;">Daftar Item Stok Menipis (Di Bawah Threshold)</h4>';
    if (alerts.length === 0) {
      html += '<p class="text-muted" style="font-size:13px;margin-bottom:20px;">✅ Seluruh item berada di atas batas minimum stok.</p>';
    } else {
      html += '<table class="x-data-table mb-4"><thead><tr><th>Cabang</th><th>Nama Produk</th><th>Sisa Stok</th><th>Batas Minimum</th></tr></thead><tbody>';
      alerts.forEach(function (a) {
        html += '<tr>' +
          '<td>' + escapeHtml(a.branch_name || '-') + '</td>' +
          '<td><strong>' + escapeHtml(a.product_name) + '</strong></td>' +
          '<td><span class="x-badge" style="background:#fee2e2;color:#991b1b;font-weight:700;">' + a.current_stock + ' unit</span></td>' +
          '<td>' + a.low_stock_threshold + ' unit</td>' +
        '</tr>';
      });
      html += '</tbody></table>';
    }

    if (movements.length > 0) {
      html += '<h4 style="font-size:14px;font-weight:700;margin:20px 0 10px;">Ringkasan Mutasi Persediaan</h4>';
      html += '<table class="x-data-table"><thead><tr><th>Tipe Mutasi</th><th>Jumlah Catatan</th><th>Total Kuantitas</th></tr></thead><tbody>';
      movements.forEach(function (m) {
        html += '<tr>' +
          '<td><span class="x-badge">' + escapeHtml(m.movement_type) + '</span></td>' +
          '<td>' + (m.record_count || 0) + ' transaksi</td>' +
          '<td>' + (m.total_quantity || 0) + '</td>' +
        '</tr>';
      });
      html += '</tbody></table>';
    }

    if (tableEl) tableEl.innerHTML = html;
  }

  function initReportsControls() {
    // Subnav click listener
    document.querySelectorAll('#reports-subnav .x-subnav-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var reportType = tab.dataset.report;
        navigateTo('reports/' + reportType);
      });
    });

    // Date filter controls
    var btnFilter = $('btn-report-filter');
    var btnReset = $('btn-report-reset');
    var inputStart = $('report-start-date');
    var inputEnd = $('report-end-date');

    if (btnFilter) {
      btnFilter.addEventListener('click', function () {
        _reportFilter.startDate = inputStart ? inputStart.value : '';
        _reportFilter.endDate = inputEnd ? inputEnd.value : '';
        loadReports();
      });
    }

    if (btnReset) {
      btnReset.addEventListener('click', function () {
        if (inputStart) inputStart.value = '';
        if (inputEnd) inputEnd.value = '';
        _reportFilter.startDate = '';
        _reportFilter.endDate = '';
        loadReports();
      });
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
     ========================================================================= */
  var _timUsers = [];
  var _timBranches = [];
  var _timRoleFilter = 'all';
  var _timCurrentUserRole = (getStoredUser() || {}).role;

  function _canManageTim() {
    return ['owner', 'brand_manager', 'branch_manager'].indexOf(_timCurrentUserRole) !== -1;
  }

  function _timRoleLabel(role) {
    var labels = { owner: 'Owner', brand_manager: 'Brand Manager', branch_manager: 'Branch Manager', cashier: 'Kasir', kitchen: 'Dapur', driver: 'Driver' };
    return labels[role] || role;
  }

  function _timRoleBadgeClass(role) {
    if (role === 'owner') return 'x-badge-info';
    if (role === 'brand_manager') return 'x-badge-success';
    if (role === 'branch_manager') return 'x-badge-warning';
    if (role === 'driver') return 'x-badge-primary';
    return 'x-badge-muted';
  }

  function _timStatusBadge(status) {
    return '';
  }

  function _timBranchName(branchId) {
    if (!branchId) return '<span class="text-muted">—</span>';
    var b = _timBranches.find(function (x) { return x.id === branchId; });
    return b ? esc(b.name) : esc(branchId);
  }

  async function loadTim() {
    if (!_canManageTim()) return;
    try {
      var url = API_BASE + '/admin/users?limit=200';
      if (_branchContextState.selected && _branchContextState.selected !== 'all') {
        url += '&branch_id=' + encodeURIComponent(_branchContextState.selected);
      }
      var res = await adminFetch(url, { headers: getAuthHeaders() });
      var data = await res.json();
      if (data.success) {
        _timUsers = data.users || [];
        renderTimTable();
      }
    } catch (e) {
      console.warn('[Tim Load Error]:', e);
    }
    // Also load branches for branch name display
    try {
      var bRes = await adminFetch(API_BASE + '/admin/branches', { headers: getAuthHeaders() });
      var bData = await bRes.json();
      if (bData.success) _timBranches = bData.branches || [];
    } catch (e) { /* ignore */ }
  }

  function renderTimTable() {
    var filtered = _timUsers;
    if (_timRoleFilter !== 'all') {
      filtered = _timUsers.filter(function (u) { return u.role === _timRoleFilter; });
    }

    var tbody = $('tim-table-body');
    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Tidak ada anggota tim ditemukan.</td></tr>';
      return;
    }

    var myId = (getStoredUser() || {}).id;
    var rows = filtered.map(function (u) {
      var isMe = u.id === myId;
      var isTargetOwner = u.role === 'owner';
      var isLastOwner = isTargetOwner && _timUsers.filter(function (x) { return x.role === 'owner'; }).length <= 1;
      var isActive = u.status === 'active';

      // STATUS COLUMN: ONLY the toggle switch. Centered horizontally and vertically.
      // Toggle ON = active, Toggle OFF = inactive.
      // Disabling self (isMe) or the sole owner (isLastOwner) is not allowed by RBAC, so render disabled toggle.
      var isToggleDisabled = isMe || isLastOwner;
      var toggleTitle = '';
      if (isMe) {
        toggleTitle = 'Akun Anda (tidak dapat dinonaktifkan)';
      } else if (isLastOwner) {
        toggleTitle = 'Owner Utama (tidak dapat dinonaktifkan)';
      } else {
        toggleTitle = isActive ? 'Akun Aktif (klik untuk nonaktifkan)' : 'Akun Nonaktif (klik untuk aktifkan)';
      }

      var statusToggle = '' +
        '<label class="x-toggle' + (isActive ? ' x-toggle-on' : '') + '" title="' + toggleTitle + '" style="margin:0 auto;display:inline-block;vertical-align:middle;">' +
          '<input type="checkbox" id="tim-toggle-' + u.id + '" ' + (isActive ? 'checked ' : '') + (isToggleDisabled ? 'disabled ' : '') +
            'onchange="toggleUserStatus(\'' + u.id + '\', \'' + esc(u.full_name) + '\', this)" aria-label="Ubah status akun ' + esc(u.full_name) + '">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      // ACTIONS COLUMN: Action menu or indicator text only
      var actions = '';
      if (isMe) {
        actions = '<span class="text-muted" style="font-size:11px;">Akun Anda</span>';
      } else {
        var menuItems = [
          "{ label: 'Edit Data & Peran', icon: '✏️', onClick: function() { openEditUser('" + u.id + "'); } }",
          "{ label: 'Reset Password', icon: '🔑', onClick: function() { resetUserPassword('" + u.id + "', '" + esc(u.full_name) + "'); } }"
        ];

        // Owner capability: Delete / Remove member (cannot delete last owner)
        if (_timCurrentUserRole === 'owner' && !isLastOwner) {
          menuItems.push("{ divider: true }");
          menuItems.push("{ label: 'Hapus Anggota', icon: '🗑️', destructive: true, onClick: function() { deleteUser('" + u.id + "', '" + esc(u.full_name) + "'); } }");
        }

        actions = [
          '<div class="x-item-actions" style="justify-content:flex-end;">',
            '<button type="button" class="x-action-menu-trigger" aria-label="Aksi anggota tim ' + esc(u.full_name) + '" onclick="XentraActionMenu.open(this, [' +
              menuItems.join(',') +
            '])">',
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
            '</button>',
          '</div>'
        ].join('');
      }

      return '<tr>' +
        '<td><strong>' + esc(u.full_name) + '</strong></td>' +
        '<td><code style="font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px;">' + esc(u.username) + '</code></td>' +
        '<td><span class="x-badge ' + _timRoleBadgeClass(u.role) + '">' + _timRoleLabel(u.role) + '</span></td>' +
        '<td>' + _timBranchName(u.branch_id) + '</td>' +
        '<td class="text-center" style="vertical-align:middle;text-align:center;">' + statusToggle + '</td>' +
        '<td class="text-right" style="white-space:nowrap;vertical-align:middle;">' + actions + '</td>' +
      '</tr>';
    });

    tbody.innerHTML = rows.join('');
  }

  function filterTimByRole(role) {
    _timRoleFilter = role;
    document.querySelectorAll('#tim-role-filters .x-cat-filter-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.role === role);
    });
    renderTimTable();
  }
  window.filterTimByRole = filterTimByRole;

  function openCreateUserModal() {
    $('modal-user-title').textContent = 'Tambah Anggota Tim';
    $('user-id').value = '';
    $('user-fullname').value = '';
    $('user-username').value = '';
    $('user-username').readOnly = false;
    $('user-password').value = '';
    $('user-password-group').style.display = '';
    $('user-password-hint').textContent = 'Wajib diisi saat membuat akun baru.';
    $('user-email').value = '';
    $('user-role').value = '';
    $('user-branch').value = '';

    // Populate role options based on actor role
    var roleSelect = $('user-role');
    roleSelect.innerHTML = '';
    if (_timCurrentUserRole === 'owner') {
      roleSelect.innerHTML = '<option value="brand_manager">Brand Manager</option><option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option><option value="driver">Driver (Kurir)</option>';
    } else if (_timCurrentUserRole === 'brand_manager') {
      roleSelect.innerHTML = '<option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option><option value="driver">Driver (Kurir)</option>';
    } else if (_timCurrentUserRole === 'branch_manager') {
      roleSelect.innerHTML = '<option value="cashier">Kasir</option><option value="driver">Driver (Kurir)</option>';
    }

    // Populate branch options
    var branchSelect = $('user-branch');
    branchSelect.innerHTML = '<option value="">— Tanpa Cabang —</option>';
    _timBranches.forEach(function (b) {
      branchSelect.innerHTML += '<option value="' + b.id + '">' + esc(b.name) + '</option>';
    });

    // branch_manager: lock to own branch
    if (_timCurrentUserRole === 'branch_manager') {
      var myBranch = (getStoredUser() || {}).branch_id;
      if (myBranch) {
        branchSelect.value = myBranch;
        branchSelect.disabled = true;
      }
    } else {
      branchSelect.disabled = false;
    }

    openExistingCardInPresentation('modal-user', 'team-user-editor', 'bottom-sheet');
  }
  window.openCreateUserModal = openCreateUserModal;

  function openEditUser(userId) {
    var user = _timUsers.find(function (u) { return u.id === userId; });
    if (!user) return;

    $('modal-user-title').textContent = 'Edit Anggota Tim';
    $('user-id').value = user.id;
    $('user-fullname').value = user.full_name || '';
    $('user-username').value = user.username || '';
    $('user-username').readOnly = true;
    $('user-password-group').style.display = 'none';
    $('user-email').value = user.email || '';

    // Populate role options (restricted by actor role)
    var roleSelect = $('user-role');
    roleSelect.innerHTML = '';
    if (_timCurrentUserRole === 'owner') {
      roleSelect.innerHTML = '<option value="brand_manager">Manager</option><option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option><option value="driver">Driver (Kurir)</option>';
    } else if (_timCurrentUserRole === 'brand_manager') {
      roleSelect.innerHTML = '<option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option><option value="driver">Driver (Kurir)</option>';
    } else if (_timCurrentUserRole === 'branch_manager') {
      roleSelect.innerHTML = '<option value="cashier">Kasir</option><option value="driver">Driver (Kurir)</option>';
    }
    roleSelect.value = user.role;

    // Branch options
    var branchSelect = $('user-branch');
    branchSelect.innerHTML = '<option value="">— Tanpa Cabang —</option>';
    _timBranches.forEach(function (b) {
      branchSelect.innerHTML += '<option value="' + b.id + '">' + esc(b.name) + '</option>';
    });
    branchSelect.value = user.branch_id || '';

    if (_timCurrentUserRole === 'branch_manager') {
      var myBranch = (getStoredUser() || {}).branch_id;
      if (myBranch) {
        branchSelect.value = myBranch;
        branchSelect.disabled = true;
      }
    } else {
      branchSelect.disabled = false;
    }

    openExistingCardInPresentation('modal-user', 'team-user-editor', 'bottom-sheet');
  }
  window.openEditUser = openEditUser;

  function closeUserModal() {
    if (window.XentraPresentation && window.XentraPresentation.isOpen('team-user-editor')) {
      window.XentraPresentation.close('team-user-editor');
    } else {
      $('modal-user').style.display = 'none';
    }
  }
  window.closeUserModal = closeUserModal;

  async function submitUserForm(e) {
    e.preventDefault();
    var userId = $('user-id').value;
    var isEdit = !!userId;
    var payload = {
      full_name: $('user-fullname').value.trim(),
      role: $('user-role').value,
      branch_id: $('user-branch').value || undefined,
      email: $('user-email').value.trim() || undefined
    };

    if (!isEdit) {
      payload.username = $('user-username').value.trim();
      payload.password = $('user-password').value;
      if (!payload.username || payload.username.length < 3) {
        showToast('Username minimal 3 karakter.');
        return;
      }
      if (!payload.password || payload.password.length < 8) {
        showToast('Password minimal 8 karakter.');
        return;
      }
    }

    if (!payload.full_name) {
      showToast('Nama lengkap wajib diisi.');
      return;
    }

    if (payload.role === 'driver' && !payload.branch_id) {
      showToast('Role Driver wajib ditugaskan ke salah satu cabang.');
      return;
    }

    try {
      var url = isEdit ? (API_BASE + '/admin/users/' + userId) : (API_BASE + '/admin/users');
      var method = isEdit ? 'PUT' : 'POST';
      var res = await adminFetch(url, {
        method: method,
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (data.success) {
        showToast(isEdit ? 'Profil anggota tim berhasil diperbarui.' : 'Anggota tim berhasil ditambahkan.');
        closeUserModal();
        loadTim();
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }

  async function toggleUserStatus(userId, name, inputElem) {
    var willActivate = inputElem ? inputElem.checked : false;
    var revert = function () {
      if (inputElem) {
        inputElem.checked = !willActivate;
        inputElem.disabled = false;
        var parentLabel = inputElem.closest('.x-toggle');
        if (parentLabel) {
          parentLabel.classList.toggle('x-toggle-on', !willActivate);
        }
      }
    };

    if (!willActivate) {
      var confirmed = await confirmFeatureAction('disable-user', 'Nonaktifkan Akun', 'Nonaktifkan akun "' + name + '"? Staf ini tidak akan bisa login sampai diaktifkan kembali.', 'Nonaktifkan');
      if (!confirmed) {
        revert();
        return;
      }
    }

    if (inputElem) {
      inputElem.disabled = true;
    }

    try {
      var endpoint = willActivate ? '/enable' : '/disable';
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + endpoint, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Akun "' + name + '" berhasil ' + (willActivate ? 'diaktifkan.' : 'dinonaktifkan.'));
        loadTim();
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
        revert();
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
      revert();
    }
  }
  window.toggleUserStatus = toggleUserStatus;

  async function disableUser(userId, name) {
    if (!await confirmFeatureAction('disable-user-action', 'Nonaktifkan Akun', 'Nonaktifkan akun "' + name + '"? Staf ini tidak akan bisa login sampai diaktifkan kembali.', 'Nonaktifkan')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + '/disable', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Akun "' + name + '" berhasil dinonaktifkan.');
        loadTim();
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.disableUser = disableUser;

  async function enableUser(userId, name) {
    try {
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + '/enable', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Akun "' + name + '" berhasil diaktifkan.');
        loadTim();
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.enableUser = enableUser;

  async function deleteUser(userId, name) {
    var confirmed = await confirmFeatureAction('delete-user', 'Hapus Anggota Tim', 'Hapus anggota "' + name + '"? Anggota akan kehilangan akses ke dashboard dan tim ini. Tindakan ini tidak dapat dibatalkan.', 'Hapus');
    if (!confirmed) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/users/' + userId, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Anggota "' + name + '" berhasil dihapus.');
        loadTim();
      } else {
        showToast('Gagal: ' + (data.error || data.message || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan saat menghapus anggota.');
    }
  }
  window.deleteUser = deleteUser;

  async function resetUserPassword(userId, name) {
    if (!await confirmFeatureAction('reset-user-password', 'Reset Password', 'Generate token reset password untuk "' + name + '"? Token hanya ditampilkan sekali.', 'Generate Token')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + '/reset-password', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success && data.reset_token) {
        $('reset-password-user-name').value = name;
        $('reset-password-token').value = data.reset_token;
        openExistingCardInPresentation('modal-reset-password', 'team-reset-password', 'dialog');
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.resetUserPassword = resetUserPassword;

  function closeResetPasswordModal() {
    if (window.XentraPresentation && window.XentraPresentation.isOpen('team-reset-password')) {
      window.XentraPresentation.close('team-reset-password');
    } else {
      $('modal-reset-password').style.display = 'none';
    }
  }
  window.closeResetPasswordModal = closeResetPasswordModal;

  /* =========================================================================
     MODUL: TEAM SECTION SWITCHER (Members, Invitations, Roles, Permissions)
     ========================================================================= */

  function switchTeamSection(sectionName, updateHash) {
    var valid = ['members', 'invitations', 'roles', 'permissions'];
    var sec = valid.indexOf(sectionName) !== -1 ? sectionName : 'members';

    ['members', 'invitations', 'roles', 'permissions'].forEach(function (name) {
      var el = $('team-section-' + name);
      if (el) el.style.display = name === sec ? '' : 'none';
    });

    document.querySelectorAll('#team-subnav .x-subnav-tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.teamSection === sec);
    });

    if (sec === 'invitations') {
      loadInvitations();
    }

    if (updateHash !== false) {
      navigateTo('team/' + sec);
    }
  }
  window.switchTeamSection = switchTeamSection;

  /* =========================================================================
     MODUL: WORKFORCE INVITATIONS (Owner & Manager Operations)
     ========================================================================= */

  var _invitationsList = [];

  async function loadInvitations() {
    var tbody = $('invitations-table-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Memuat data undangan...</td></tr>';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/invitations', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data.success) {
        _invitationsList = data.invitations || [];
        renderInvitationsTable(_invitationsList);
      } else {
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">' + esc(data.error || 'Gagal memuat undangan.') + '</td></tr>';
        }
      }
    } catch (err) {
      console.error('[Load Invitations Error]:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat undangan.</td></tr>';
      }
    }
  }
  window.loadInvitations = loadInvitations;

  function renderInvitationsTable(invitations) {
    var tbody = $('invitations-table-body');
    if (!tbody) return;

    if (!invitations || invitations.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Belum ada undangan yang dibuat.</td></tr>';
      return;
    }

    var rows = invitations.map(function (inv) {
      var statusBadge = '';
      if (inv.status === 'pending') {
        statusBadge = '<span class="x-badge" style="background:#fef3c7;color:#92400e;font-weight:600;">Pending</span>';
      } else if (inv.status === 'accepted') {
        statusBadge = '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:600;">Accepted</span>';
      } else if (inv.status === 'revoked') {
        statusBadge = '<span class="x-badge" style="background:#fef2f2;color:#991b1b;font-weight:600;">Revoked</span>';
      } else if (inv.status === 'expired') {
        statusBadge = '<span class="x-badge" style="background:#f1f5f9;color:#64748b;font-weight:600;">Expired</span>';
      }

      var branchName = inv.branch_id ? _timBranchName(inv.branch_id) : '<span class="text-muted">Brand-wide</span>';
      var expiresFormatted = inv.expires_at ? new Date(inv.expires_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

      var actions = '—';
      if (inv.status === 'pending') {
        actions = '<div class="x-item-actions" style="justify-content:flex-end;gap:6px;">' +
          '<button type="button" class="x-btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="resendInvitation(\'' + inv.id + '\', \'' + esc(inv.email) + '\')">Kirim Ulang</button>' +
          '<button type="button" class="x-btn-secondary" style="padding:4px 8px;font-size:11px;color:#dc2626;" onclick="revokeInvitation(\'' + inv.id + '\', \'' + esc(inv.email) + '\')">Batalkan</button>' +
        '</div>';
      }

      return '<tr>' +
        '<td><strong>' + esc(inv.email) + '</strong></td>' +
        '<td><span class="x-badge ' + _timRoleBadgeClass(inv.role) + '">' + _timRoleLabel(inv.role) + '</span></td>' +
        '<td>' + branchName + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td>' + expiresFormatted + '</td>' +
        '<td class="text-right">' + actions + '</td>' +
      '</tr>';
    });

    tbody.innerHTML = rows.join('');
  }

  function openInviteUserModal() {
    $('invite-input-email').value = '';
    
    // Populate role options for invitation
    var roleSelect = $('invite-input-role');
    roleSelect.innerHTML = '';
    if (_timCurrentUserRole === 'owner') {
      roleSelect.innerHTML = '<option value="branch_manager">Branch Manager</option><option value="brand_manager">Brand Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option><option value="driver">Driver (Kurir)</option>';
    } else if (_timCurrentUserRole === 'brand_manager') {
      roleSelect.innerHTML = '<option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option><option value="driver">Driver (Kurir)</option>';
    } else if (_timCurrentUserRole === 'branch_manager') {
      roleSelect.innerHTML = '<option value="cashier">Kasir</option><option value="kitchen">Dapur</option><option value="driver">Driver (Kurir)</option>';
    }

    // Populate branches
    var branchSelect = $('invite-input-branch');
    branchSelect.innerHTML = '<option value="">— Pilih Cabang —</option>';
    _timBranches.forEach(function (b) {
      branchSelect.innerHTML += '<option value="' + b.id + '">' + esc(b.name) + '</option>';
    });

    if (_timCurrentUserRole === 'branch_manager') {
      var myBranch = (getStoredUser() || {}).branch_id;
      if (myBranch) {
        branchSelect.value = myBranch;
        branchSelect.disabled = true;
      }
    } else {
      branchSelect.disabled = false;
    }

    handleInviteRoleChange();
    openExistingCardInPresentation('modal-invite-user', 'team-invite-editor', 'bottom-sheet');
  }
  window.openInviteUserModal = openInviteUserModal;

  function closeInviteUserModal() {
    if (window.XentraPresentation && window.XentraPresentation.isOpen('team-invite-editor')) {
      window.XentraPresentation.close('team-invite-editor');
    } else {
      $('modal-invite-user').style.display = 'none';
    }
  }
  window.closeInviteUserModal = closeInviteUserModal;

  function handleInviteRoleChange() {
    var role = $('invite-input-role').value;
    var branchGroup = $('invite-branch-group');
    var branchSelect = $('invite-input-branch');
    var isBranchRequired = role === 'branch_manager' || role === 'cashier' || role === 'kitchen' || role === 'driver';
    
    if (role === 'brand_manager') {
      if (branchGroup) branchGroup.style.display = 'none';
      if (branchSelect) branchSelect.required = false;
    } else {
      if (branchGroup) branchGroup.style.display = 'block';
      if (branchSelect) branchSelect.required = isBranchRequired;
    }
  }
  window.handleInviteRoleChange = handleInviteRoleChange;

  async function submitInviteUserForm(e) {
    e.preventDefault();
    var email = $('invite-input-email').value.trim();
    var role = $('invite-input-role').value;
    var branchId = $('invite-input-branch').value || undefined;

    if (!email) {
      showToast('Alamat email wajib diisi.');
      return;
    }

    if ((role === 'branch_manager' || role === 'cashier' || role === 'kitchen' || role === 'driver') && !branchId) {
      showToast('Peran ' + role + ' wajib memilih cabang penugasan.');
      return;
    }

    var btnSend = $('btn-send-invitation');
    if (btnSend) {
      btnSend.disabled = true;
      btnSend.textContent = 'Mengirim...';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/invitations', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ email: email, role: role, branch_id: branchId })
      });
      var data = await res.json();

      if (data.success) {
        showToast('Undangan berhasil dikirim ke ' + email);
        closeInviteUserModal();
        switchTeamSection('invitations');
      } else {
        showToast('Gagal: ' + (data.message || data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan saat mengirim undangan.');
    } finally {
      if (btnSend) {
        btnSend.disabled = false;
        btnSend.textContent = 'Kirim Undangan';
      }
    }
  }
  window.submitInviteUserForm = submitInviteUserForm;

  async function resendInvitation(invId, email) {
    if (!await confirmFeatureAction('resend-invitation', 'Kirim Ulang Undangan', 'Kirim ulang email undangan ke "' + email + '"? Token sebelumnya akan diperbarui.', 'Kirim Ulang')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/invitations/' + invId + '/resend', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Undangan berhasil dikirim ulang ke ' + email);
        loadInvitations();
      } else {
        showToast('Gagal: ' + (data.message || data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.resendInvitation = resendInvitation;

  async function revokeInvitation(invId, email) {
    if (!await confirmFeatureAction('revoke-invitation', 'Batalkan Undangan', 'Batalkan undangan untuk "' + email + '"? Tautan undangan tidak akan dapat digunakan lagi.', 'Batalkan')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/invitations/' + invId + '/revoke', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Undangan untuk ' + email + ' berhasil dibatalkan.');
        loadInvitations();
      } else {
        showToast('Gagal: ' + (data.message || data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.revokeInvitation = revokeInvitation;


  /* =========================================================================
     MODUL: CUSTOMERS & LOYALTY (Phase 5)
     ========================================================================= */

  var _customersList = [];
  var _activeCustomerSegment = 'all';

  async function loadCustomers() {
    var tbody = $('customers-table-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6 text-muted">Memuat data pelanggan...</td></tr>';
    }

    try {
      var queryParams = [];
      if (_branchContextState.selected && _branchContextState.selected !== 'all') {
        queryParams.push('branch_id=' + encodeURIComponent(_branchContextState.selected));
      }

      var searchInput = $('customers-search-input');
      var searchVal = searchInput ? searchInput.value.trim() : '';
      if (searchVal) {
        queryParams.push('search=' + encodeURIComponent(searchVal));
      }

      if (_activeCustomerSegment && _activeCustomerSegment !== 'all' && _activeCustomerSegment !== 'segments') {
        queryParams.push('segment=' + encodeURIComponent(_activeCustomerSegment));
      }

      var url = API_BASE + '/admin/customers' + (queryParams.length ? '?' + queryParams.join('&') : '');
      var res = await adminFetch(url, { headers: getAuthHeaders() });
      var data = await res.json();

      if (data.success) {
        _customersList = data.customers || [];
        renderCustomersTable(_customersList);
      } else {
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6 text-danger">' + esc(data.error || 'Gagal memuat data pelanggan.') + '</td></tr>';
        }
      }
    } catch (err) {
      console.error('[Load Customers Error]:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat data pelanggan.</td></tr>';
      }
    }
  }
  window.loadCustomers = loadCustomers;

  function renderCustomersTable(customers) {
    var tbody = $('customers-table-body');
    if (!tbody) return;

    if (!customers || customers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6 text-muted">Tidak ada pelanggan yang cocok dengan kriteria.</td></tr>';
      return;
    }

    var rows = customers.map(function (c) {
      var favBranchText = c.favorite_branch ? esc(c.favorite_branch.name) : '<span class="text-muted">—</span>';
      var lastOrderText = c.last_order ? esc(c.last_order) : '<span class="text-muted">—</span>';
      var segmentBadge = c.segment === 'returning'
        ? '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:600;">Returning</span>'
        : '<span class="x-badge" style="background:#eff6ff;color:#1d4ed8;font-weight:600;">New</span>';

      return '<tr>' +
        '<td><strong>' + esc(c.name || 'Pelanggan') + '</strong></td>' +
        '<td><code style="font-size:12px;background:#f8fafc;padding:2px 6px;border-radius:4px;">' + esc(c.phone) + '</code></td>' +
        '<td><strong>' + (c.order_count || 0) + '</strong> pesanan</td>' +
        '<td><strong>' + formatMoney(c.total_spend || 0) + '</strong></td>' +
        '<td>' + formatMoney(c.average_order_value || 0) + '</td>' +
        '<td>' + favBranchText + '</td>' +
        '<td>' + segmentBadge + '</td>' +
        '<td class="text-right" style="white-space:nowrap;">' +
          '<div class="x-item-actions" style="justify-content:flex-end;">' +
            '<button type="button" class="x-action-menu-trigger" aria-label="Aksi pelanggan ' + esc(c.name || c.phone) + '" onclick="XentraActionMenu.open(this, [' +
              '{ label: \'Lihat Profil Pelanggan\', icon: \'👤\', onClick: function() { navigateTo(\'customers/' + encodeURIComponent(c.phone || c.id) + '\'); } }' +
            '])">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    });

    tbody.innerHTML = rows.join('');
  }

  function filterCustomersBySegment(segment) {
    _activeCustomerSegment = segment;
    document.querySelectorAll('#customers-segment-tabs .x-subnav-tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.segment === segment);
    });

    var segmentsGuide = $('customers-segments-view');
    if (segmentsGuide) {
      segmentsGuide.style.display = segment === 'segments' ? '' : 'none';
    }

    loadCustomers();
  }
  window.filterCustomersBySegment = filterCustomersBySegment;

  function searchCustomers() {
    loadCustomers();
  }
  window.searchCustomers = searchCustomers;

  function showCustomersListView() {
    var listView = $('customers-list-view');
    var detailView = $('customers-detail-view');
    if (listView) listView.style.display = '';
    if (detailView) detailView.style.display = 'none';
  }
  window.showCustomersListView = function () {
    showCustomersListView();
    navigateTo('customers');
  };

  async function loadCustomerDetailView(customerId) {
    var listView = $('customers-list-view');
    var detailView = $('customers-detail-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = '';

    // Reset fields to loading state
    if ($('cdetail-name')) $('cdetail-name').textContent = 'Memuat Profil...';
    if ($('cdetail-subtitle')) $('cdetail-subtitle').textContent = 'Mengambil data transaksi Core...';
    if ($('cdetail-total-orders')) $('cdetail-total-orders').textContent = '-';
    if ($('cdetail-total-spend')) $('cdetail-total-spend').textContent = '-';
    if ($('cdetail-aov')) $('cdetail-aov').textContent = '-';
    if ($('cdetail-fav-branch')) $('cdetail-fav-branch').textContent = '-';

    try {
      var queryParams = [];
      if (_branchContextState.selected && _branchContextState.selected !== 'all') {
        queryParams.push('branch_id=' + encodeURIComponent(_branchContextState.selected));
      }
      var url = API_BASE + '/admin/customers/' + encodeURIComponent(customerId) + (queryParams.length ? '?' + queryParams.join('&') : '');
      var res = await adminFetch(url, { headers: getAuthHeaders() });
      var data = await res.json();

      if (!data.success || !data.customer) {
        showToast('Pelanggan tidak ditemukan.');
        showCustomersListView();
        return;
      }

      var c = data.customer;

      if ($('cdetail-name')) $('cdetail-name').textContent = c.name || 'Pelanggan';
      if ($('cdetail-subtitle')) $('cdetail-subtitle').textContent = 'Nomor Kontak: ' + (c.phone || '-');
      if ($('customers-mobile-detail-subtitle')) $('customers-mobile-detail-subtitle').textContent = 'Nomor Kontak: ' + (c.phone || '-');

      var badgeEl = $('cdetail-segment-badge');
      if (badgeEl) {
        if (c.segment === 'returning') {
          badgeEl.textContent = 'Returning Customer';
          badgeEl.style.background = '#ecfdf5';
          badgeEl.style.color = '#047857';
        } else {
          badgeEl.textContent = 'New Customer';
          badgeEl.style.background = '#eff6ff';
          badgeEl.style.color = '#1d4ed8';
        }
      }

      if ($('cdetail-total-orders')) $('cdetail-total-orders').textContent = String(c.total_orders || 0);
      if ($('cdetail-total-spend')) $('cdetail-total-spend').textContent = formatMoney(c.total_spend || 0);
      if ($('cdetail-aov')) $('cdetail-aov').textContent = formatMoney(c.average_order_value || 0);
      if ($('cdetail-fav-branch')) $('cdetail-fav-branch').textContent = c.favorite_branch ? c.favorite_branch.name : '—';

      // Render Top Products
      var prodCont = $('cdetail-top-products-container');
      if (prodCont) {
        if (!c.top_products || c.top_products.length === 0) {
          prodCont.innerHTML = '<div class="x-empty-state">Belum ada riwayat pesanan produk.</div>';
        } else {
          var pRows = c.top_products.map(function (p) {
            return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#f8fafc;border-radius:6px;margin-bottom:8px;border:1px solid #e2e8f0;">' +
              '<div>' +
                '<strong>' + esc(p.product_name) + '</strong>' +
                '<small style="display:block;color:#64748b;font-size:11px;">' + p.total_quantity + ' porsi dipesan</small>' +
              '</div>' +
              '<span style="font-weight:700;color:#0f172a;">' + formatMoney(p.total_sales || 0) + '</span>' +
            '</div>';
          });
          prodCont.innerHTML = pRows.join('');
        }
      }

      // Render Saved Addresses (Distinguishing Buyer vs Recipient context)
      var addrCont = $('cdetail-addresses-container');
      if (addrCont) {
        if (!c.addresses || c.addresses.length === 0) {
          addrCont.innerHTML = '<div class="x-empty-state">Tidak ada alamat pengiriman tersimpan.</div>';
        } else {
          var aRows = c.addresses.map(function (a) {
            var primaryBadge = a.is_primary ? ' <span class="x-badge x-badge-success" style="font-size:10px;">Utama</span>' : '';
            return '<div style="padding:10px 12px;background:#f8fafc;border-radius:6px;margin-bottom:8px;border:1px solid #e2e8f0;">' +
              '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
                '<strong>' + esc(a.label || 'Alamat') + primaryBadge + '</strong>' +
              '</div>' +
              '<div style="font-size:12px;color:#334155;">' + esc(a.address) + '</div>' +
              (a.detail ? '<div style="font-size:11px;color:#64748b;margin-top:2px;">Catatan: ' + esc(a.detail) + '</div>' : '') +
            '</div>';
          });
          addrCont.innerHTML = aRows.join('');
        }
      }

      // Render Order History
      var ordersTbody = $('cdetail-orders-table-body');
      if (ordersTbody) {
        if (!c.orders || c.orders.length === 0) {
          ordersTbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Belum ada riwayat transaksi.</td></tr>';
        } else {
          var ordRows = c.orders.map(function (o) {
            return '<tr>' +
              '<td><a href="#orders/' + encodeURIComponent(o.id) + '" style="font-weight:600;color:var(--primary);text-decoration:none;">#' + esc(o.order_number || o.id) + '</a></td>' +
              '<td style="font-size:12px;color:#64748b;">' + esc(o.created_at) + '</td>' +
              '<td>' + esc(o.branch_name || '—') + '</td>' +
              '<td><span class="x-badge" style="background:#e0f2fe;color:#0369a1;font-size:11px;">' + esc(o.order_channel || 'customer_app') + '</span></td>' +
              '<td><span class="x-badge" style="background:#fef3c7;color:#92400e;font-size:11px;">' + esc(o.fulfillment_type || 'delivery') + '</span></td>' +
              '<td><span class="x-badge ' + (o.status === 'completed' ? 'x-badge-success' : 'x-badge-info') + '">' + esc(o.status) + '</span></td>' +
              '<td><strong>' + formatMoney(o.grand_total || 0) + '</strong></td>' +
            '</tr>';
          });
          ordersTbody.innerHTML = ordRows.join('');
        }
      }

    } catch (err) {
      console.error('[Load Customer Detail Error]:', err);
      showToast('Gagal memuat detail pelanggan.');
    }
  }
  window.loadCustomerDetailView = loadCustomerDetailView;

  /* =========================================================================
     PHASE 6: CLIENT OWNER DASHBOARD — FINANCE & MARKETING FRONTEND LOGIC
     Authoritative Core data consumption with granular Branch Context scoping
     ========================================================================= */

  var _activeFinanceSubtab = 'overview';
  var _activeMarketingSubtab = 'promotions';

  // Bagian keuangan dipilih lewat dropdown inline, sama seperti pemilih periode di
  // Beranda. Bukan <select> bawaan browser, supaya tampilannya sama di semua HP.
  window.toggleFinanceDropdown = function () {
    var d = $('finance-section-dropdown');
    if (!d) return;
    var open = d.classList.toggle('open');
    var trigger = $('btn-finance-section-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  window.pickFinanceSection = function (item) {
    if (!item) return;
    closeFinanceDropdown();
    var value = item.dataset.value;
    if (value) navigateTo('finance/' + value);
  };

  // Filter transaksi (Metode & Status) memakai dropdown yang sama dengan pemilih
  // periode. Select aslinya tetap ada tapi disembunyikan, jadi logika filter tidak
  // perlu diubah sama sekali.
  var FIN_FILTERS = {
    method: { select: 'fin-filter-method' },
    status: { select: 'fin-filter-status' }
  };

  function syncFinanceFilter(kind) {
    var cfg = FIN_FILTERS[kind];
    if (!cfg) return;
    var sel = $(cfg.select);
    var dropdown = $('fin-filter-' + kind + '-dropdown');
    if (!sel || !dropdown) return;
    var label = $('fin-filter-' + kind + '-label');
    dropdown.querySelectorAll('.x-occ-dropdown-item').forEach(function (item) {
      var isCurrent = item.dataset.value === sel.value;
      item.classList.toggle('active', isCurrent);
      item.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
      if (isCurrent && label) label.textContent = item.querySelector('span').textContent;
    });
  }

  function syncFinanceFilters() {
    syncFinanceFilter('method');
    syncFinanceFilter('status');
  }

  function closeFinanceFilter(kind) {
    var dropdown = $('fin-filter-' + kind + '-dropdown');
    if (dropdown) dropdown.classList.remove('open');
    var trigger = $('btn-fin-filter-' + kind);
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  window.toggleFinanceFilter = function (kind) {
    var dropdown = $('fin-filter-' + kind + '-dropdown');
    if (!dropdown) return;
    var open = dropdown.classList.toggle('open');
    var trigger = $('btn-fin-filter-' + kind);
    if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  window.pickFinanceFilter = function (kind, item) {
    if (!item) return;
    closeFinanceFilter(kind);
    var cfg = FIN_FILTERS[kind];
    var sel = cfg && $(cfg.select);
    if (!sel) return;
    sel.value = item.dataset.value;
    syncFinanceFilter(kind);
    loadFinanceTransactions();
  };

  document.addEventListener('click', function (e) {
    Object.keys(FIN_FILTERS).forEach(function (kind) {
      var dropdown = $('fin-filter-' + kind + '-dropdown');
      if (dropdown && !dropdown.contains(e.target)) closeFinanceFilter(kind);
    });
  });

  function closeFinanceDropdown() {
    var d = $('finance-section-dropdown');
    if (d) d.classList.remove('open');
    var trigger = $('btn-finance-section-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  // Menutup saat menyentuh di luar dropdown, seperti pemilih periode.
  document.addEventListener('click', function (e) {
    var d = $('finance-section-dropdown');
    if (d && !d.contains(e.target)) closeFinanceDropdown();
  });

  function switchFinanceSection(subtab, updateHash) {
    if (!subtab) subtab = 'overview';
    _activeFinanceSubtab = subtab;

    if (updateHash !== false) {
      navigateTo('finance/' + subtab);
      return;
    }

    // Toggle subnav tabs active class
    document.querySelectorAll('#finance-subnav-tabs .x-subnav-tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.subtab === subtab);
    });

    // Label dan tanda centang dropdown (jika ada) dijaga tetap sinkron
    var menu = document.querySelectorAll('#finance-section-menu .x-occ-dropdown-item');
    menu.forEach(function (item) {
      var isCurrent = item.dataset.value === subtab;
      item.classList.toggle('active', isCurrent);
      item.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
      if (isCurrent) {
        var label = $('finance-section-label');
        if (label) label.textContent = item.querySelector('span').textContent;
      }
    });

    // Toggle subviews
    var views = {
      'overview': 'finance-view-overview',
      'transactions': 'finance-view-transactions',
      'payouts': 'finance-view-payouts',
      'reconciliation': 'finance-view-reconciliation',
      'payment-methods': 'finance-view-payment-methods'
    };

    Object.keys(views).forEach(function (key) {
      var el = $(views[key]);
      if (el) el.style.display = (key === subtab) ? '' : 'none';
    });

    // Load data for subtab
    if (subtab === 'overview') loadFinanceOverview();
    else if (subtab === 'transactions') loadFinanceTransactions();
    else if (subtab === 'reconciliation') loadFinanceReconciliation();
    else if (subtab === 'payment-methods') loadFinancePaymentMethods();
  }
  window.switchFinanceSection = switchFinanceSection;

  function loadFinanceCurrentSubtab() {
    switchFinanceSection(_activeFinanceSubtab, false);
  }
  window.loadFinanceCurrentSubtab = loadFinanceCurrentSubtab;

  async function loadFinanceOverview() {
    try {
      var branchId = getEffectiveBranchId();
      var query = branchId && branchId !== 'all' ? '?branch_id=' + encodeURIComponent(branchId) : '';
      var res = await adminFetch('/api/v1/admin/finance/overview' + query, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var json = await res.json();
      if (!json.success || !json.data) return;

      var s = json.data.summary || {};
      var grossEl = $('fin-gross-sales');
      var settledEl = $('fin-total-settled');
      var pendingEl = $('fin-total-pending');
      var reconCountEl = $('fin-unreconciled-count');
      var reconSubEl = $('fin-unreconciled-sub');

      if (grossEl) grossEl.textContent = formatMoney(s.gross_sales || 0);
      if (settledEl) settledEl.textContent = formatMoney(s.total_settled || 0);
      if (pendingEl) pendingEl.textContent = formatMoney(s.total_pending || 0);
      if (reconCountEl) reconCountEl.textContent = s.unreconciled_count || 0;
      if (reconSubEl) {
        reconSubEl.textContent = s.unreconciled_amount > 0 
          ? formatMoney(s.unreconciled_amount) + ' menunggu verifikasi' 
          : 'Semua transaksi sinkron';
      }

      var tbody = $('tbody-fin-breakdown');
      if (tbody) {
        var breakdown = json.data.breakdown || [];
        if (breakdown.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">Belum ada rincian pelunasan pembayaran.</td></tr>';
        } else {
          var rows = breakdown.map(function (b) {
            var badgeColor = b.payment_status === 'settlement' 
              ? 'background:#ecfdf5;color:#047857;' 
              : 'background:#fffbeb;color:#b45309;';
            return '<tr>' +
              '<td><strong>' + esc(b.provider === 'cash' ? 'Tunai (Cash)' : 'Midtrans Online') + '</strong></td>' +
              '<td><span class="x-badge" style="' + badgeColor + 'font-weight:600;">' + esc(b.payment_status) + '</span></td>' +
              '<td>' + (b.transaction_count || 0) + ' transaksi</td>' +
              '<td><strong>' + formatMoney(b.total_amount || 0) + '</strong></td>' +
            '</tr>';
          });
          tbody.innerHTML = rows.join('');
        }
      }
    } catch (err) {
      console.error('[Load Finance Overview Error]:', err);
      showToast('Gagal memuat ringkasan keuangan.');
    }
  }
  window.loadFinanceOverview = loadFinanceOverview;

  async function loadFinanceTransactions() {
    try {
      // Label dropdown diturunkan dari select aslinya, jadi membuka tab ini selalu
      // menampilkan pilihan yang benar walau filternya diubah dari tempat lain.
      if (typeof syncFinanceFilters === 'function') syncFinanceFilters();
      var tbody = $('tbody-fin-transactions');
      if (!tbody) return;

      var branchId = getEffectiveBranchId();
      var methodEl = $('fin-filter-method');
      var statusEl = $('fin-filter-status');
      var params = [];

      if (branchId && branchId !== 'all') params.push('branch_id=' + encodeURIComponent(branchId));
      if (methodEl && methodEl.value) params.push('payment_method=' + encodeURIComponent(methodEl.value));
      if (statusEl && statusEl.value) params.push('payment_status=' + encodeURIComponent(statusEl.value));

      var query = params.length > 0 ? '?' + params.join('&') : '';
      var res = await adminFetch('/api/v1/admin/finance/transactions' + query, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var json = await res.json();
      if (!json.success) return;

      var txs = json.transactions || [];
      if (txs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Tidak ada transaksi keuangan yang ditemukan.</td></tr>';
        return;
      }

      var rows = txs.map(function (t) {
        var statusBadge = t.payment_status === 'settlement'
          ? '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:600;">Settlement</span>'
          : (t.payment_status === 'reconciliation_pending'
            ? '<span class="x-badge" style="background:#fef3c7;color:#92400e;font-weight:600;">Reconciliation Pending</span>'
            : (t.payment_status === 'pending'
              ? '<span class="x-badge" style="background:#eff6ff;color:#1d4ed8;font-weight:600;">Pending</span>'
              : '<span class="x-badge" style="background:#fee2e2;color:#991b1b;font-weight:600;">' + esc(t.payment_status) + '</span>'));

        // DOKU dulu ikut tertulis "Midtrans" karena hanya ada dua cabang.
        var methodLabel = t.payment_method === 'cash' ? 'Tunai (Cash)'
          : (t.payment_method === 'doku' ? 'DOKU' : 'Midtrans');
        var timeText = t.created_at ? esc(t.created_at.substring(0, 19).replace('T', ' ')) : '—';

        return '<tr>' +
          '<td data-label="ID Transaksi"><code style="font-size:12px;background:#f8fafc;padding:2px 6px;border-radius:4px;">' + esc(t.id || '—') + '</code></td>' +
          '<td data-label="Waktu" style="font-size:12px;color:#64748b;">' + timeText + '</td>' +
          '<td data-label="Pesanan"><a href="#orders/' + encodeURIComponent(t.order_id) + '" style="font-weight:600;color:var(--primary);text-decoration:none;">#' + esc(t.order_number || t.order_id) + '</a></td>' +
          '<td data-label="Cabang">' + esc(t.branch_name || 'Cabang Utama') + '</td>' +
          '<td data-label="Metode"><strong>' + esc(methodLabel) + '</strong></td>' +
          '<td data-label="Nominal"><strong>' + formatMoney(t.amount || 0) + '</strong></td>' +
          '<td data-label="Status">' + statusBadge + '</td>' +
        '</tr>';
      });

      tbody.innerHTML = rows.join('');
    } catch (err) {
      console.error('[Load Finance Transactions Error]:', err);
      showToast('Gagal memuat daftar transaksi keuangan.');
    }
  }
  window.loadFinanceTransactions = loadFinanceTransactions;

  async function loadFinanceReconciliation() {
    try {
      var tbody = $('tbody-fin-reconciliation');
      if (!tbody) return;

      var branchId = getEffectiveBranchId();
      var query = branchId && branchId !== 'all' ? '?branch_id=' + encodeURIComponent(branchId) : '';
      var res = await adminFetch('/api/v1/admin/finance/reconciliation' + query, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var json = await res.json();
      if (!json.success || !json.reconciliation) return;

      var recs = json.reconciliation.records || [];
      if (recs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6" style="color:#059669;font-weight:600;">✅ Semua transaksi telah direkonsiliasi dengan benar. Tidak ada transaksi tertunda.</td></tr>';
        return;
      }

      var rows = recs.map(function (r) {
        var timeText = r.created_at ? esc(r.created_at.substring(0, 19).replace('T', ' ')) : '—';
        return '<tr>' +
          '<td><a href="#orders/' + encodeURIComponent(r.order_id) + '" style="font-weight:600;color:var(--primary);text-decoration:none;">#' + esc(r.order_number || r.order_id) + '</a></td>' +
          '<td>' + esc(r.branch_name || 'Cabang Utama') + '</td>' +
          '<td>' + esc(r.provider) + '</td>' +
          '<td><strong>' + formatMoney(r.amount || 0) + '</strong></td>' +
          '<td style="font-size:12px;color:#64748b;">' + timeText + '</td>' +
          '<td><span class="x-badge" style="background:#fef3c7;color:#92400e;font-weight:600;">' + esc(r.payment_status) + '</span></td>' +
        '</tr>';
      });

      tbody.innerHTML = rows.join('');
    } catch (err) {
      console.error('[Load Finance Reconciliation Error]:', err);
      showToast('Gagal memuat status rekonsiliasi.');
    }
  }
  window.loadFinanceReconciliation = loadFinanceReconciliation;

  async function loadFinancePaymentMethods() {
    try {
      var cont = $('fin-payment-methods-list');
      if (!cont) return;

      var branchId = getEffectiveBranchId();
      var query = branchId && branchId !== 'all' ? '?branch_id=' + encodeURIComponent(branchId) : '';
      var res = await adminFetch('/api/v1/admin/finance/payment-methods' + query, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var json = await res.json();
      if (!json.success || !json.payment_methods) return;

      var cards = json.payment_methods.map(function (m) {
        // Tiga keadaan yang berbeda dan tidak boleh tertukar: sedang AKTIF, sudah
        // siap tapi tidak dipakai, dan belum punya kredensial sama sekali.
        var isOnlineGateway = m.type === 'online_gateway';
        var providerBadge = '';
        if (m.is_active_provider === true) {
          providerBadge = '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#dcfce7;color:#166534;font-weight:700;">Aktif</span>';
        } else if (isOnlineGateway && !m.is_enabled) {
          providerBadge = '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#f1f5f9;color:#64748b;font-weight:600;">Belum dikonfigurasi</span>';
        } else if (isOnlineGateway) {
          providerBadge = '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#fef3c7;color:#92400e;font-weight:600;">Siap Digunakan</span>';
        }

        var configInfo = '';
        if (m.code !== 'cash') {
          var envLabel = m.environment ? (m.environment === 'production' ? 'Produksi' : 'Sandbox') : '';
          configInfo = '<div style="font-size:11px;color:#64748b;margin-top:4px;">' +
            (envLabel ? 'Lingkungan: <strong>' + envLabel + '</strong>' : '') +
            (m.has_branch_override ? ' (Override Cabang)' : '') +
          '</div>';
        }

        var typesHtml = '';
        if (m.types && m.types.length > 0) {
          var togglesHtml = m.types.map(function (t) {
            return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;">' +
              '<div style="display:flex;align-items:center;gap:8px;">' +
                '<span style="font-size:16px;">' + t.icon + '</span>' +
                '<span style="font-size:13px;font-weight:600;color:#1e293b;">' + esc(t.name) + '</span>' +
              '</div>' +
              '<label style="position:relative;display:inline-block;width:40px;height:22px;cursor:pointer;">' +
                '<input type="checkbox" data-provider="' + m.code + '" data-method-type="' + t.code + '" ' + (t.enabled ? 'checked' : '') + ' onchange="togglePaymentMethodType(this)" style="opacity:0;width:0;height:0;">' +
                '<span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:' + (t.enabled ? '#22c55e' : '#e2e8f0') + ';transition:0.2s;border-radius:22px;"></span>' +
                '<span style="position:absolute;content:\'\';height:18px;width:18px;left:' + (t.enabled ? '19px' : '3px') + ';bottom:2px;background-color:white;transition:0.2s;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.15);"></span>' +
              '</label>' +
            '</div>';
          }).join('');
          typesHtml = '<div style="margin-top:12px;padding-top:8px;">' +
            '<div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Channel Pembayaran</div>' +
            togglesHtml +
          '</div>';
        }

        // Hanya SATU gateway online yang boleh hijau. Toggle mencerminkan keadaan
        // aktif (bukan sekadar "kredensial ada"), dan mematikan salah satu berarti
        // tidak ada gateway online yang aktif.
        var isOn = isOnlineGateway ? (m.is_active_provider === true) : true;
        var trackColor = isOn ? '#22c55e' : '#ef4444';
        var knobLeft = isOn ? '19px' : '3px';
        var toggleHtml;
        if (isOnlineGateway || isOn) {
          toggleHtml = '<label style="position:relative;display:inline-block;width:40px;height:22px;cursor:pointer;" title="' + (isOn ? 'Aktif — klik untuk menonaktifkan' : 'Nonaktif — klik untuk mengaktifkan') + '">' +
            '<input type="checkbox" data-provider="' + m.code + '" data-toggle-provider="true" ' + (isOn ? 'checked' : '') + ' onchange="togglePaymentProvider(this)" style="opacity:0;width:0;height:0;">' +
            '<span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:' + trackColor + ';transition:0.2s;border-radius:22px;"></span>' +
            '<span style="position:absolute;content:\'\';height:18px;width:18px;left:' + knobLeft + ';bottom:2px;background-color:white;transition:0.2s;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.15);"></span>' +
          '</label>';
        } else {
          // Tunai tidak bisa dimatikan: alur bayar-di-kasir dan setoran tunai
          // bergantung padanya. Ditampilkan hijau dan terkunci, bukan disembunyikan,
          // supaya jelas bahwa ia memang selalu aktif.
          toggleHtml = '<span title="Tunai selalu aktif" style="display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;color:#166534;background:#dcfce7;border-radius:999px;padding:3px 10px;">Selalu aktif</span>';
        }

        var borderColor = m.is_active_provider ? '#22c55e' : '#e2e8f0';

        return '<div class="x-card" style="padding:18px;border:2px solid ' + borderColor + ';border-radius:var(--radius-md);background:#ffffff;">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">' +
            '<h4 style="font-size:15px;font-weight:800;margin:0;color:var(--text-main);">' + esc(m.name) + '</h4>' +
            '<div style="display:flex;align-items:center;gap:8px;">' + providerBadge + toggleHtml +
            '</div>' +
          '</div>' +
          '<p style="font-size:12px;color:var(--text-muted);margin:0;line-height:1.4;">' + esc(m.description) + '</p>' +
          configInfo +
          typesHtml +
        '</div>';
      });

      cont.innerHTML = cards.join('');
    } catch (err) {
      console.error('[Load Payment Methods Error]:', err);
      showToast('Gagal memuat daftar payment methods.');
    }
  }
  window.loadFinancePaymentMethods = loadFinancePaymentMethods;

  window.togglePaymentMethodType = async function (checkbox) {
    var provider = checkbox.dataset.provider;
    var methodType = checkbox.dataset.methodType;
    var enabled = checkbox.checked;
    try {
      var res = await adminFetch(API_BASE + '/admin/finance/payment-methods', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ provider: provider, method_type: methodType, enabled: enabled })
      });
      var json = await res.json();
      if (json.success) {
        showToast(esc(provider.toUpperCase()) + ' ' + esc(methodType) + (enabled ? ' diaktifkan' : ' dinonaktifkan'));
        var span = checkbox.nextElementSibling;
        var dot = span ? span.nextElementSibling : null;
        if (span) span.style.backgroundColor = enabled ? '#22c55e' : '#e2e8f0';
        if (dot) dot.style.left = enabled ? '19px' : '3px';
      } else {
        checkbox.checked = !enabled;
        showToast('Gagal: ' + (json.error || 'Terjadi kesalahan'));
      }
    } catch (err) {
      checkbox.checked = !enabled;
      showToast('Kesalahan jaringan saat menyimpan perubahan.');
    }
  };

  window.togglePaymentProvider = async function (checkbox) {
    var provider = checkbox.dataset.provider;
    var enabled = checkbox.checked;
    var label = provider === 'doku' ? 'DOKU' : 'Midtrans';
    try {
      // Mengaktifkan satu gateway online otomatis mematikan yang lain: `provider`
      // adalah satu-satunya gateway online yang aktif, jadi mengirim 'doku' berarti
      // Midtrans berhenti aktif. Mematikan keduanya berarti mengirim kosong.
      var res = await adminFetch(API_BASE + '/admin/settings/commerce/payments', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ provider: enabled ? provider : '' })
      });
      var json = await res.json();
      if (json.success) {
        // Muat ulang supaya gateway lain terlihat ikut berubah, bukan hanya yang diklik.
        loadFinancePaymentMethods();
        showToast(enabled
          ? label + ' diaktifkan. Hanya satu gateway online yang aktif.'
          : label + ' dinonaktifkan.');
      } else {
        checkbox.checked = !enabled;
        showToast('Gagal: ' + (json.error || 'Terjadi kesalahan'));
      }
    } catch (err) {
      checkbox.checked = !enabled;
      showToast('Kesalahan jaringan saat mengubah provider.');
    }
  };

  function switchMarketingSection(subtab, updateHash) {
    if (!subtab) subtab = 'overview';
    _activeMarketingSubtab = subtab;

    if (updateHash !== false) {
      navigateTo('marketing/' + subtab);
      return;
    }

    // Toggle subnav tabs active class
    document.querySelectorAll('#marketing-subnav-tabs .x-subnav-tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.subtab === subtab);
    });

    // Toggle subviews
    var views = {
      'overview': 'marketing-view-overview',
      'promotions': 'marketing-view-promotions',
      'discounts': 'marketing-view-discounts',
      'banners': 'marketing-view-banners',
      'campaigns': 'marketing-view-campaigns',
      'loyalty': 'marketing-view-loyalty'
    };

    Object.keys(views).forEach(function (key) {
      var el = $(views[key]);
      if (el) el.style.display = (key === subtab) ? '' : 'none';
    });

    // Load data for subtab
    if (subtab === 'overview') loadMarketingOverview();
    else if (subtab === 'promotions') loadMarketingPromotions();
    else if (subtab === 'banners') renderMarketingBannersSkeleton();
  }
  window.switchMarketingSection = switchMarketingSection;

  function loadMarketingCurrentSubtab() {
    switchMarketingSection(_activeMarketingSubtab, false);
  }
  window.loadMarketingCurrentSubtab = loadMarketingCurrentSubtab;


  /* =========================================================================
     MARKETING — STOREFRONT BANNER MANAGEMENT
     Real dashboard implementation for Banner Content + Assignment/Placement.
     Legacy brands.banners remains a fallback until a Branch uses the new system.
     ========================================================================= */

  var _marketingBannersState = {
    rows: [],
    branches: [],
    promotions: [],
    products: [],
    categories: [],
    branchFilter: ''
  };

  var _marketingBannerEditor = {
    mode: 'create',
    bannerId: null,
    mediaId: null,
    mediaFile: null,
    mediaReady: false,
    cropSpec: null,
    detail: null
  };

  // Re-entrancy guard: blocks concurrent save/publish requests (double click).
  var _marketingBannerSaving = false;

  var _marketingBannerAssignmentEditor = {
    bannerId: null,
    assignmentId: null,
    mode: 'create'
  };

  function getMarketingBannerRowKey(row, index) {
    return String(row.banner_id || row.id || '') + '::' + String(
      row.assignment && row.assignment.id ? row.assignment.id : 'unassigned'
    ) + '::' + String(index || 0);
  }

  function findMarketingBannerRow(key) {
    for (var i = 0; i < _marketingBannersState.rows.length; i++) {
      if (getMarketingBannerRowKey(_marketingBannersState.rows[i], i) === key) {
        return _marketingBannersState.rows[i];
      }
    }
    return null;
  }

  function getMarketingBannerUser() {
    return typeof getStoredUser === 'function' ? (getStoredUser() || {}) : {};
  }

  function isMarketingBannerOwner() {
    var user = getMarketingBannerUser();
    return user.role === 'owner' || user.role === 'brand_manager';
  }

  function isMarketingBannerBranchManager() {
    return getMarketingBannerUser().role === 'branch_manager';
  }

  function bannerDateTimeParts(date, timeZone) {
    try {
      var parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timeZone || 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(new Date(date));

      var out = {};
      parts.forEach(function (part) {
        if (part.type !== 'literal') out[part.type] = part.value;
      });

      return out;
    } catch (_) {
      return null;
    }
  }

  function formatMarketingBannerSchedule(assignment) {
    if (!assignment) return 'Belum ditempatkan';

    var tz = assignment.branch_timezone || assignment.timezone || 'Asia/Jakarta';
    if (!assignment.starts_at && !assignment.ends_at) {
      return 'Tanpa jadwal';
    }

    function one(value) {
      if (!value) return '';
      var p = bannerDateTimeParts(value, tz);
      if (!p) return 'Tanggal tidak valid';
      return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute;
    }

    var start = assignment.starts_at ? one(assignment.starts_at) : '';
    var end = assignment.ends_at ? one(assignment.ends_at) : '';

    if (start && end) return start + ' → ' + end;
    if (start) return 'Mulai ' + start;
    return 'Berakhir ' + end;
  }

  function formatMarketingBannerScheduleWithTz(assignment) {
    var base = formatMarketingBannerSchedule(assignment);
    if (!assignment) return base;
    if (!assignment.starts_at && !assignment.ends_at) return base;
    return base + ' · ' + (assignment.branch_timezone || assignment.timezone || 'Asia/Jakarta');
  }

  function bannerStatusBadge(status) {
    var meta = {
      'DRAFT': { label: 'Draft', cls: 'is-draft' },
      'PUBLISHED': { label: 'Published', cls: 'is-published' },
      'SCHEDULED': { label: 'Terjadwal', cls: 'is-scheduled' },
      'ACTIVE': { label: 'Aktif', cls: 'is-active' },
      'PAUSED': { label: 'Dijeda', cls: 'is-paused' },
      'ENDED': { label: 'Berakhir', cls: 'is-ended' }
    }[String(status || '').toUpperCase()] || { label: status || '—', cls: '' };

    return '<span class="x-marketing-banner-status ' + meta.cls + '">' + esc(meta.label) + '</span>';
  }

  function renderMarketingBannerPreview(row) {
    var src = row && row.media ? row.media.preview_url : null;
    var title = row && row.title ? row.title : 'Banner';

    if (src) {
      return '<div class="x-marketing-banner-preview">' +
        '<img src="' + esc(src) + '" alt="' + esc(title) + '" loading="lazy">' +
      '</div>';
    }

    return '<div class="x-marketing-banner-preview x-marketing-banner-preview-empty">' +
      '<span>🖼️</span>' +
    '</div>';
  }

  function renderMarketingBannerRows() {
    var tbody = $('mkt-banners-table-body');
    if (!tbody) return;

    var rows = _marketingBannersState.rows || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8">' +
        '<div style="font-size:36px;margin-bottom:8px;">🖼️</div>' +
        '<div style="font-weight:700;color:var(--text-main);margin-bottom:4px;">Belum ada Banner</div>' +
        '<p class="text-muted" style="font-size:12px;margin:0 0 14px;">Buat Banner Content pertama, lalu Publish dan tempatkan ke cabang yang diinginkan.</p>' +
        '<button type="button" class="x-btn-primary" onclick="openMarketingBannerCreate()">Tambah Banner</button>' +
      '</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(function (row, index) {
      var key = getMarketingBannerRowKey(row, index);
      var assignment = row.assignment;
      var publicationStatus = String(row.publication_status || 'DRAFT').toUpperCase();
      var effectiveStatus = assignment
        ? String(assignment.effective_status || (publicationStatus === 'PUBLISHED' ? 'ACTIVE' : 'DRAFT')).toUpperCase()
        : publicationStatus;

      var isAssignmentLocked = Boolean(assignment && assignment.governance_locked && isMarketingBannerBranchManager());
      var canToggle = Boolean(assignment) && !isAssignmentLocked;
      var checked = Boolean(assignment && assignment.active);
      var toggleDisabled = canToggle ? '' : ' disabled';

      var branchText = assignment
        ? (assignment.branch_name || assignment.branch_id || 'Cabang')
        : 'Belum ditempatkan';

      var publicationText = publicationStatus === 'PUBLISHED'
        ? (row.has_draft_changes ? 'Published · Ada Draft' : 'Published')
        : 'Draft';

      var visibilityText = !assignment
        ? '—'
        : isAssignmentLocked
          ? 'Dikunci'
          : assignment.effective_status === 'SCHEDULED'
            ? 'Menunggu jadwal'
            : assignment.effective_status === 'ENDED'
              ? 'Jadwal selesai'
              : checked ? 'Play' : 'Pause';

      return '<tr>' +
        '<td data-label="Banner">' +
          '<div class="x-marketing-banner-primary">' +
            renderMarketingBannerPreview(row) +
            '<div class="x-marketing-banner-name">' +
              '<strong>' + esc(row.title || 'Tanpa judul') + '</strong>' +
              bannerStatusBadge(effectiveStatus) +
              (row.has_draft_changes ? '<span class="x-marketing-banner-draft-hint">Ada perubahan Draft</span>' : '') +
            '</div>' +
          '</div>' +
        '</td>' +
        '<td data-label="Placement"><span class="x-marketing-banner-secondary">Homepage Banner</span></td>' +
        '<td data-label="Cabang / Scope"><span class="x-marketing-banner-secondary">' + esc(branchText) + '</span></td>' +
        '<td data-label="Publikasi"><span class="x-marketing-banner-secondary">' + esc(publicationText) + '</span></td>' +
        '<td data-label="Jadwal"><span class="x-marketing-banner-secondary">' + esc(formatMarketingBannerSchedule(assignment)) + '</span></td>' +
        '<td data-label="Visibility">' +
          '<div class="x-marketing-banner-visibility">' +
            (assignment ? (
              '<label class="x-toggle x-toggle-compact" title="' + esc(visibilityText) + '">' +
                '<input type="checkbox" ' + (checked ? 'checked' : '') + toggleDisabled + ' data-banner-toggle-key="' + esc(key) + '" aria-label="' + esc(visibilityText) + '">' +
                '<span class="x-toggle-slider"></span>' +
              '</label>'
            ) : '<span class="x-marketing-banner-no-assignment">—</span>') +
          '</div>' +
        '</td>' +
        '<td class="text-right" data-label="Aksi" style="white-space:nowrap;">' +
          '<div class="x-item-actions">' +
            '<button type="button" class="x-action-menu-trigger" aria-label="Aksi banner ' + esc(row.title || 'Banner') + '" data-banner-action-key="' + esc(key) + '">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('[data-banner-toggle-key]').forEach(function (input) {
      input.addEventListener('change', function () {
        var key = input.getAttribute('data-banner-toggle-key');
        var row = findMarketingBannerRow(key);
        if (!row || !row.assignment) return;
        toggleMarketingBannerAssignment(row.assignment.id, input.checked);
      });
    });

    tbody.querySelectorAll('[data-banner-action-key]').forEach(function (trigger) {
      trigger.addEventListener('click', function () {
        var key = trigger.getAttribute('data-banner-action-key');
        openMarketingBannerActionMenu(trigger, key);
      });
    });
  }

  async function loadMarketingBanners() {
    var tbody = $('mkt-banners-table-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-muted">Memuat Banner...</td></tr>';
    }

    try {
      var query = _marketingBannersState.branchFilter
        ? '?branch_id=' + encodeURIComponent(_marketingBannersState.branchFilter)
        : '';

      var res = await adminFetch(API_BASE + '/admin/marketing/banners' + query, {
        headers: getAuthHeaders()
      });

      var json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal memuat Banner.');
      }

      _marketingBannersState.rows = Array.isArray(json.banners) ? json.banners : [];
      _marketingBannersState.branches = Array.isArray(json.branches) ? json.branches : [];

      populateMarketingBannerBranchFilter();
      renderMarketingBannerRows();

      var legacyNotice = $('mkt-banners-legacy-notice');
      if (legacyNotice) {
        if (json.legacy && json.legacy.fallback_active && Number(json.legacy.count || 0) > 0) {
          legacyNotice.style.display = '';
          legacyNotice.innerHTML =
            '<strong>Legacy banner fallback masih aktif.</strong> ' +
            esc(String(json.legacy.count)) +
            ' banner lama tetap dipertahankan untuk cabang yang belum memakai Assignment baru.';
        } else {
          legacyNotice.style.display = 'none';
          legacyNotice.textContent = '';
        }
      }
    } catch (err) {
      console.error('[Banner] load error:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8">' +
          '<div style="font-weight:700;color:#dc2626;margin-bottom:4px;">Gagal memuat Banner</div>' +
          '<div class="text-muted" style="font-size:12px;">' + esc(err.message || 'Terjadi kesalahan.') + '</div>' +
        '</td></tr>';
      }
    }
  }
  window.loadMarketingBanners = loadMarketingBanners;

  function populateMarketingBannerBranchFilter() {
    var select = $('mkt-banners-branch-filter');
    if (!select) return;

    var user = getMarketingBannerUser();
    var current = _marketingBannersState.branchFilter || '';

    var options = ['<option value="">Semua Cabang</option>'];
    (_marketingBannersState.branches || []).forEach(function (branch) {
      options.push('<option value="' + esc(branch.id) + '">' + esc(branch.name || branch.id) + '</option>');
    });

    select.innerHTML = options.join('');
    if (current) select.value = current;

    if (user.role === 'branch_manager') {
      var ownBranch = user.branch_id || user.branchId || '';
      if (ownBranch) {
        select.value = ownBranch;
        select.disabled = true;
        _marketingBannersState.branchFilter = ownBranch;
      } else {
        select.disabled = true;
      }
    } else {
      select.disabled = false;
    }
  }

  function openMarketingBannerActionMenu(trigger, key) {
    var row = findMarketingBannerRow(key);
    if (!row) return;

    var assignment = row.assignment;
    var publicationStatus = String(row.publication_status || 'DRAFT').toUpperCase();
    var user = getMarketingBannerUser();
    var actions = [
      { label: 'Lihat Preview', icon: '👁️', onClick: function () { openMarketingBannerPreview(key); } }
    ];

    if (user.role !== 'branch_manager') {
      actions.push({
        label: 'Edit Content',
        icon: '✏️',
        onClick: function () { openMarketingBannerEditor(row.banner_id || row.id); }
      });
    }

    if (assignment) {
      if (!(user.role === 'branch_manager' && assignment.governance_locked)) {
        actions.push({
          label: 'Atur Penempatan / Jadwal',
          icon: '🗓️',
          onClick: function () { openMarketingBannerAssignmentEditor(row, false); }
        });
      }

      if (user.role === 'owner' || user.role === 'brand_manager') {
        actions.push({
          label: assignment.governance_locked ? 'Buka Kunci Manager' : 'Kunci untuk Branch Manager',
          icon: assignment.governance_locked ? '🔓' : '🔒',
          onClick: function () { toggleMarketingBannerGovernance(assignment.id, !assignment.governance_locked); }
        });
      }

      if (assignment.effective_status === 'ENDED' &&
          !(user.role === 'branch_manager' && assignment.governance_locked)) {
        actions.push({
          label: 'Gunakan Lagi',
          icon: '↻',
          onClick: function () { openMarketingBannerAssignmentEditor(row, true); }
        });
      }

      if (publicationStatus === 'PUBLISHED' && user.role !== 'branch_manager') {
        actions.push({ divider: true });
        actions.push({
          label: 'Tambah Penempatan Cabang',
          icon: '＋',
          onClick: function () { openMarketingBannerAssignmentEditor({ banner_id: row.banner_id || row.id }, false); }
        });
      }

      if (!(user.role === 'branch_manager' && assignment.governance_locked)) {
        actions.push({
          divider: true
        });
        actions.push({
          label: 'Hapus Penempatan',
          icon: '🗑️',
          destructive: true,
          onClick: function () { removeMarketingBannerAssignment(assignment.id); }
        });
      }
    } else {
      actions.push({
        label: 'Tempatkan ke Cabang',
        icon: '📍',
        onClick: function () { openMarketingBannerAssignmentEditor(row, false); }
      });
    }

    if (publicationStatus === 'DRAFT' && user.role !== 'branch_manager') {
      actions.push({
        label: 'Publish',
        icon: '🚀',
        onClick: function () { publishMarketingBanner(row.banner_id || row.id); }
      });
      actions.push({
        label: 'Hapus Draft',
        icon: '🗑️',
        destructive: true,
        onClick: function () { deleteMarketingBanner(row.banner_id || row.id); }
      });
    }

    if (publicationStatus === 'PUBLISHED' &&
        row.has_draft_changes &&
        user.role !== 'branch_manager') {
      actions.push({
        label: 'Buang Draft Perubahan',
        icon: '↩️',
        destructive: true,
        onClick: function () { discardMarketingBannerDraft(row.banner_id || row.id); }
      });
    }

    window.XentraActionMenu.open(trigger, actions);
  }

  function mountMarketingBannerEditorPage() {
    var backdrop = $('modal-marketing-banner');
    var page = $('marketing-banner-editor-view');
    if (!backdrop || !page) return;
    var card = backdrop.querySelector('.x-modal-card');
    if (!card) return;
    page.appendChild(card);
    ensureOwnerFeatureMobileHeader(
      page,
      $('modal-marketing-banner-title') ? $('modal-marketing-banner-title').textContent : 'Editor Banner',
      'Atur konten, penempatan, jadwal, dan publikasi banner.',
      'Kembali ke Marketing'
    );
    card.classList.add('x-feature-page-surface');
    card.style.maxWidth = 'none';
    card.style.width = '100%';
    card.style.maxHeight = 'none';
    card.style.height = 'auto';
    card.style.borderRadius = '14px';
    backdrop.style.display = 'none';
  }

  function openMarketingBannerCreate() {
    _marketingBannerEditor = {
      mode: 'create',
      bannerId: null,
      mediaId: null,
      mediaFile: null,
      cropSpec: null,
      detail: null
    };

    setMarketingBannerEditorFields(null);
    populateMarketingBannerTargets(null);
    renderMarketingBannerEditorBranches(null);
    if ($('mkt-banner-schedule-enabled')) $('mkt-banner-schedule-enabled').checked = false;
    if ($('mkt-banner-schedule-fields')) $('mkt-banner-schedule-fields').style.display = 'none';
    if ($('mkt-banner-starts-at')) $('mkt-banner-starts-at').value = '';
    if ($('mkt-banner-ends-at')) $('mkt-banner-ends-at').value = '';
    if ($('mkt-banner-active')) $('mkt-banner-active').checked = true;
    if ($('mkt-banner-governance-lock')) $('mkt-banner-governance-lock').checked = false;
    setMarketingBannerEditorMode('create');

    var modal = $('modal-marketing-banner');
    navigateTo('marketing/banners/new');
    mountMarketingBannerEditorPage();
  }
  window.openMarketingBannerCreate = openMarketingBannerCreate;

  async function openMarketingBannerEditor(bannerId) {
    try {
      var res = await adminFetch(API_BASE + '/admin/marketing/banners/' + encodeURIComponent(bannerId), {
        headers: getAuthHeaders()
      });
      var json = await res.json();
      if (!res.ok || !json.success || !json.banner) {
        throw new Error(json.error || 'Banner tidak ditemukan.');
      }

      _marketingBannerEditor = {
        mode: 'edit',
        bannerId: bannerId,
        mediaId: json.banner.draft_revision
          ? json.banner.draft_revision.media_id
          : (json.banner.published_revision ? json.banner.published_revision.media_id : null),
        mediaFile: null,
        cropSpec: null,
        detail: json.banner
      };

      setMarketingBannerEditorFields(json.banner);
      populateMarketingBannerTargets(json.banner);
      setMarketingBannerEditorMode('edit');

      var modal = $('modal-marketing-banner');
      navigateTo('marketing/banners/' + encodeURIComponent(bannerId) + '/edit');
    mountMarketingBannerEditorPage();
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal membuka Banner.'));
    }
  }
  window.openMarketingBannerEditor = openMarketingBannerEditor;

  function setMarketingBannerEditorMode(mode) {
    var title = $('modal-marketing-banner-title');
    var subtitle = $('modal-marketing-banner-subtitle');
    var placement = $('mkt-banner-create-placement');
    var saveBtn = $('mkt-banner-save-draft');
    var editorPreviewBtn = $('mkt-banner-preview-from-editor');
    if (editorPreviewBtn && !editorPreviewBtn.dataset.bound) {
      editorPreviewBtn.dataset.bound = '1';
      editorPreviewBtn.addEventListener('click', previewMarketingBannerEditor);
    }

    var publishBtn = $('mkt-banner-publish-action');
    var stateEl = $('mkt-banner-editor-state');

    if (mode === 'create') {
      if (title) title.textContent = 'Tambah Banner';
      if (subtitle) subtitle.textContent = 'Buat content draft lalu pilih penempatan dan publikasi.';
      if (placement) placement.style.display = '';
      if (saveBtn) saveBtn.textContent = 'Simpan Draft';
      if (publishBtn) publishBtn.textContent = ($('mkt-banner-schedule-enabled') && $('mkt-banner-schedule-enabled').checked) ? 'Publikasikan & Jadwalkan' : 'Publish Sekarang';
      if (stateEl) stateEl.textContent = 'Mode baru · Content + penempatan opsional';
    } else {
      var detail = _marketingBannerEditor.detail && _marketingBannerEditor.detail.draft_revision
        ? 'Ada Draft revision yang belum dipublish.'
        : 'Mengedit content yang sudah tersimpan. Publish tetap eksplisit.';

      if (title) title.textContent = 'Edit Banner Content';
      if (subtitle) subtitle.textContent = detail;
      if (placement) placement.style.display = 'none';
      if (saveBtn) saveBtn.textContent = 'Simpan Draft Update';
      if (publishBtn) publishBtn.textContent = 'Publish Update';
      if (stateEl) stateEl.textContent = detail;
    }
  }

  function setMarketingBannerEditorFields(detail) {
    var titleEl = $('mkt-banner-title-field');
    var altEl = $('mkt-banner-alt-field');
    var ctaEl = $('mkt-banner-cta-type');
    var bannerIdEl = $('mkt-banner-id');

    if (bannerIdEl) bannerIdEl.value = detail ? (detail.id || '') : '';
    if (titleEl) titleEl.value = detail
      ? ((detail.draft_revision && detail.draft_revision.title) || (detail.published_revision && detail.published_revision.title) || '')
      : '';
    if (altEl) altEl.value = detail
      ? ((detail.draft_revision && detail.draft_revision.alt_text) || (detail.published_revision && detail.published_revision.alt_text) || '')
      : '';

    var revision = detail
      ? (detail.draft_revision || detail.published_revision || null)
      : null;

    if (ctaEl) ctaEl.value = revision ? (revision.cta_type || 'NONE') : 'NONE';

    // State isolation: never carry a previously selected File into this session.
    var fileEl = $('mkt-banner-file');
    if (fileEl) fileEl.value = '';

    setMarketingBannerEditorPreview(
      detail && detail.media && detail.media.preview_url
        ? detail.media.preview_url
        : null
    );

    updateMarketingBannerCtaFields();
  }

  function setMarketingBannerEditorPreview(src) {
    var img = $('mkt-banner-preview');
    var empty = $('mkt-banner-preview-empty');
    var clear = $('mkt-banner-clear');

    if (img && src) {
      img.src = src;
      img.style.display = 'block';
      if (empty) empty.style.display = 'none';
      if (clear) clear.style.display = _marketingBannerEditor.mediaFile ? 'inline-flex' : 'none';
    } else {
      if (img) {
        img.src = '';
        img.style.display = 'none';
      }
      if (empty) empty.style.display = 'flex';
      if (clear) clear.style.display = _marketingBannerEditor.mediaFile ? 'inline-flex' : 'none';
    }
  }

  function clearMarketingBannerMedia() {
    _marketingBannerEditor.mediaFile = null;
    _marketingBannerEditor.mediaReady = false;
    _marketingBannerEditor.mediaId = _marketingBannerEditor.detail
      ? (_marketingBannerEditor.detail.draft_revision
        ? _marketingBannerEditor.detail.draft_revision.media_id
        : (_marketingBannerEditor.detail.published_revision
          ? _marketingBannerEditor.detail.published_revision.media_id
          : null))
      : null;
    _marketingBannerEditor.cropSpec = null;
    var file = $('mkt-banner-file');
    if (file) file.value = '';
    setMarketingBannerEditorPreview(
      _marketingBannerEditor.detail && _marketingBannerEditor.detail.media
        ? _marketingBannerEditor.detail.media.preview_url
        : null
    );
  }

  function closeMarketingBannerModal() {
    var backdrop = $('modal-marketing-banner');
    var page = $('marketing-banner-editor-view');
    var card = backdrop && backdrop.querySelector('.x-modal-card');
    if (!card && page) card = page.querySelector('.x-modal-card');
    if (card && backdrop) {
      backdrop.appendChild(card);
      card.classList.remove('x-feature-page-surface');
      card.style.maxWidth = '760px';
      card.style.width = '100%';
      card.style.maxHeight = '92vh';
      card.style.height = 'auto';
      card.style.borderRadius = '14px';
      backdrop.style.display = 'none';
    }
    if (page) page.style.display = 'none';
    navigateTo('marketing/banners');
  }
  window.closeMarketingBannerModal = closeMarketingBannerModal;

  function readMarketingBannerFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
      reader.readAsDataURL(file);
    });
  }

  async function processMarketingBannerMedia(file, cropSpec) {
    var base64 = await readMarketingBannerFileAsDataUrl(file);

    var uploadRes = await adminFetch(API_BASE + '/admin/media/upload', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        image_base64: base64,
        mime_type: file.type,
        original_filename: file.name,
        asset_type: 'banner',
        enforce_aspect_ratio: false
      })
    });

    var uploadJson = await uploadRes.json();
    if (!uploadRes.ok || !uploadJson.success || !uploadJson.asset) {
      throw new Error(uploadJson.error || 'Upload media Banner gagal.');
    }

    var mediaId = uploadJson.asset.media_id || uploadJson.asset.id;
    if (!mediaId) throw new Error('Media ID tidak dikembalikan server.');

    if (cropSpec) {
      var cropRes = await adminFetch(API_BASE + '/admin/media/' + encodeURIComponent(mediaId) + '/crop', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ crop_spec: cropSpec })
      });
      var cropJson = await cropRes.json();
      if (!cropRes.ok || !cropJson.success) {
        throw new Error(cropJson.error || 'Crop specification Banner gagal disimpan.');
      }
    }

    var processRes = await adminFetch(API_BASE + '/admin/media/' + encodeURIComponent(mediaId) + '/process', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ crop_spec: cropSpec || null })
    });
    var processJson = await processRes.json();
    if (!processRes.ok || !processJson.success || !processJson.asset) {
      throw new Error(processJson.error || 'Media Banner gagal diproses.');
    }

    return processJson.asset;
  }

  function onMarketingBannerFileSelected(file) {
    if (!file) return;

    var allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.indexOf(file.type) === -1) {
      showToast('❌ Format Banner harus JPG, PNG, atau WebP.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      showToast('❌ Ukuran Banner melebihi batas 20 MB.');
      return;
    }

    _marketingBannerEditor.mediaFile = file;
    _marketingBannerEditor.cropSpec = null;
    _marketingBannerEditor.mediaReady = false;

    XentraCropEditor.open({
      source: file,
      assetType: 'banner',
      aspectRatio: 350 / 180,
      title: 'Sesuaikan Banner (~1.94:1)',
      onConfirm: function (cropSpec, previewDataUrl) {
        _marketingBannerEditor.cropSpec = cropSpec;
        setMarketingBannerEditorPreview(previewDataUrl || URL.createObjectURL(file));
        showToast('✓ Framing Banner disimpan untuk pemrosesan server.');
      },
      onCancel: function () {
        _marketingBannerEditor.mediaFile = null;
        _marketingBannerEditor.mediaReady = false;
        _marketingBannerEditor.cropSpec = null;
        var fileInput = $('mkt-banner-file');
        if (fileInput) fileInput.value = '';
        setMarketingBannerEditorPreview(
          _marketingBannerEditor.detail && _marketingBannerEditor.detail.media
            ? _marketingBannerEditor.detail.media.preview_url
            : null
        );
      }
    });
  }

  function renderMarketingBannerEditorBranches(selectedIds) {
    var container = $('mkt-banner-branch-list');
    var allToggle = $('mkt-banner-all-branches');
    var countEl = $('mkt-banner-branch-selection-count');
    if (!container) return;

    var selected = new Set(Array.isArray(selectedIds) ? selectedIds.map(String) : []);
    var user = getMarketingBannerUser();
    var ownBranch = String(user.branch_id || user.branchId || '');

    var html = [];
    (_marketingBannersState.branches || []).forEach(function (branch) {
      if (user.role === 'branch_manager' && ownBranch && String(branch.id) !== ownBranch) return;

      html.push(
        '<label class="x-marketing-banner-branch-check">' +
          '<input type="checkbox" value="' + esc(branch.id) + '" data-banner-create-branch>' +
          '<span>' + esc(branch.name || branch.id) + '</span>' +
          '<small>' + esc(branch.timezone || 'Asia/Jakarta') + '</small>' +
        '</label>'
      );
    });

    container.innerHTML = html.length
      ? html.join('')
      : '<div class="text-muted" style="font-size:12px;padding:10px 0;">Tidak ada cabang yang tersedia dalam scope akun ini.</div>';

    container.querySelectorAll('[data-banner-create-branch]').forEach(function (input) {
      input.checked = selected.has(String(input.value));
      input.addEventListener('change', refreshMarketingBannerBranchSelection);
    });

    if (allToggle) {
      allToggle.checked = false;
      allToggle.indeterminate = false;
      allToggle.onchange = function () {
        var checkboxes = container.querySelectorAll('[data-banner-create-branch]');
        checkboxes.forEach(function (input) {
          input.checked = allToggle.checked;
        });
        refreshMarketingBannerBranchSelection();
      };
    }

    refreshMarketingBannerBranchSelection();
  }

  function refreshMarketingBannerBranchSelection() {
    var container = $('mkt-banner-branch-list');
    var countEl = $('mkt-banner-branch-selection-count');
    var allToggle = $('mkt-banner-all-branches');
    if (!container) return;

    var inputs = Array.prototype.slice.call(container.querySelectorAll('[data-banner-create-branch]'));
    var checked = inputs.filter(function (input) { return input.checked; }).length;

    if (countEl) countEl.textContent = checked + ' cabang dipilih';
    if (allToggle) {
      allToggle.checked = inputs.length > 0 && checked === inputs.length;
      allToggle.indeterminate = checked > 0 && checked < inputs.length;
    }
  }

  function getSelectedMarketingBannerBranchIds() {
    var container = $('mkt-banner-branch-list');
    if (!container) return [];
    return Array.prototype.slice.call(container.querySelectorAll('[data-banner-create-branch]:checked')).map(function (input) {
      return String(input.value);
    });
  }

  async function populateMarketingBannerTargets(detail) {
    var revision = detail
      ? (detail.draft_revision || detail.published_revision || null)
      : null;

    try {
      var results = await Promise.all([
        adminFetch(API_BASE + '/admin/marketing/promotions', { headers: getAuthHeaders() }),
        adminFetch(API_BASE + '/admin/products', { headers: getAuthHeaders() }),
        adminFetch(API_BASE + '/admin/categories', { headers: getAuthHeaders() })
      ]);

      var promoJson = await results[0].json();
      var productJson = await results[1].json();
      var categoryJson = await results[2].json();

      _marketingBannersState.promotions = promoJson && Array.isArray(promoJson.promotions) ? promoJson.promotions : [];
      _marketingBannersState.products = productJson && Array.isArray(productJson.products) ? productJson.products : [];
      _marketingBannersState.categories = categoryJson && Array.isArray(categoryJson.categories) ? categoryJson.categories : [];

      var promoSelect = $('mkt-banner-cta-promotion');
      var productSelect = $('mkt-banner-cta-product');
      var categorySelect = $('mkt-banner-cta-category');

      if (promoSelect) {
        promoSelect.innerHTML = '<option value="">Pilih Promotion</option>' +
          _marketingBannersState.promotions.map(function (item) {
            return '<option value="' + esc(item.id) + '">' + esc(item.name || item.code || item.id) + '</option>';
          }).join('');
        promoSelect.value = revision && revision.cta_type === 'PROMOTION' ? (revision.promotion_id || '') : '';
      }

      if (productSelect) {
        productSelect.innerHTML = '<option value="">Pilih Product</option>' +
          _marketingBannersState.products.map(function (item) {
            return '<option value="' + esc(item.id) + '">' + esc(item.name || item.id) + '</option>';
          }).join('');
        productSelect.value = revision && revision.cta_type === 'PRODUCT' ? (revision.cta_target_id || '') : '';
      }

      if (categorySelect) {
        categorySelect.innerHTML = '<option value="">Pilih Category</option>' +
          _marketingBannersState.categories.map(function (item) {
            return '<option value="' + esc(item.id) + '">' + esc(item.name || item.id) + '</option>';
          }).join('');
        categorySelect.value = revision && revision.cta_type === 'CATEGORY' ? (revision.cta_target_id || '') : '';
      }

      var urlInput = $('mkt-banner-cta-url');
      if (urlInput) {
        urlInput.value = revision && revision.cta_type === 'URL' ? (revision.cta_url || '') : '';
      }

      updateMarketingBannerCtaFields();
    } catch (err) {
      console.error('[Banner] target load error:', err);
      showToast('⚠️ Target CTA gagal dimuat. Banner tanpa CTA tetap dapat disimpan.');
    }
  }

  function updateMarketingBannerCtaFields() {
    var typeEl = $('mkt-banner-cta-type');
    var type = typeEl ? String(typeEl.value || 'NONE').toUpperCase() : 'NONE';

    var map = {
      PROMOTION: 'mkt-banner-cta-promotion-wrap',
      PRODUCT: 'mkt-banner-cta-product-wrap',
      CATEGORY: 'mkt-banner-cta-category-wrap',
      URL: 'mkt-banner-cta-url-wrap'
    };

    Object.keys(map).forEach(function (key) {
      var wrap = $(map[key]);
      if (wrap) wrap.style.display = key === type ? '' : 'none';
    });
  }

  function buildMarketingBannerContentPayload(mediaId) {
    var typeEl = $('mkt-banner-cta-type');
    var ctaType = typeEl ? String(typeEl.value || 'NONE').toUpperCase() : 'NONE';

    var payload = {
      media_id: mediaId,
      title: $('mkt-banner-title-field') ? $('mkt-banner-title-field').value.trim() : '',
      alt_text: $('mkt-banner-alt-field') ? $('mkt-banner-alt-field').value.trim() : '',
      cta_type: ctaType,
      cta_target_id: null,
      cta_url: null,
      promotion_id: null
    };

    if (ctaType === 'PROMOTION') {
      payload.promotion_id = $('mkt-banner-cta-promotion') ? $('mkt-banner-cta-promotion').value : null;
    } else if (ctaType === 'PRODUCT') {
      payload.cta_target_id = $('mkt-banner-cta-product') ? $('mkt-banner-cta-product').value : null;
    } else if (ctaType === 'CATEGORY') {
      payload.cta_target_id = $('mkt-banner-cta-category') ? $('mkt-banner-cta-category').value : null;
    } else if (ctaType === 'URL') {
      payload.cta_url = $('mkt-banner-cta-url') ? $('mkt-banner-cta-url').value.trim() : null;
    }

    return payload;
  }

  function getMarketingBannerPlacementPayload() {
    var selectedBranches = getSelectedMarketingBannerBranchIds();
    var scheduleEnabled = $('mkt-banner-schedule-enabled') ? $('mkt-banner-schedule-enabled').checked : false;

    return {
      branch_ids: selectedBranches,
      position: Number($('mkt-banner-position') && $('mkt-banner-position').value || 1),
      active: $('mkt-banner-active') ? $('mkt-banner-active').checked : true,
      starts_at_local: scheduleEnabled && $('mkt-banner-starts-at') ? $('mkt-banner-starts-at').value : '',
      ends_at_local: scheduleEnabled && $('mkt-banner-ends-at') ? $('mkt-banner-ends-at').value : '',
      governance_locked: $('mkt-banner-governance-lock') ? $('mkt-banner-governance-lock').checked : false
    };
  }

  async function saveMarketingBannerDraft(shouldPublish) {
    if (_marketingBannerSaving) return;
    var submitBtn = $('mkt-banner-save-draft');
    var publishBtn = $('mkt-banner-publish-action');

    _marketingBannerSaving = true;
    if (submitBtn) submitBtn.disabled = true;
    if (publishBtn) publishBtn.disabled = true;

    try {
      var mediaId = _marketingBannerEditor.mediaId;

      // Reuse the READY asset from a previous successful processing attempt
      // instead of re-uploading the same File (prevents orphaned READY assets
      // when a retry happens after a downstream failure).
      if (_marketingBannerEditor.mediaFile && !_marketingBannerEditor.mediaReady) {
        var asset = await processMarketingBannerMedia(
          _marketingBannerEditor.mediaFile,
          _marketingBannerEditor.cropSpec
        );
        mediaId = asset.media_id || asset.id;
        _marketingBannerEditor.mediaId = mediaId;
        _marketingBannerEditor.mediaReady = true;
      }

      if (!mediaId) {
        throw new Error('Media Banner wajib dipilih.');
      }

      var payload = buildMarketingBannerContentPayload(mediaId);
      var banner;

      if (_marketingBannerEditor.mode === 'create') {
        if (!_marketingBannerEditor.bannerId) {
          var createRes = await adminFetch(API_BASE + '/admin/marketing/banners', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
          });
          var createJson = await createRes.json();
          if (!createRes.ok || !createJson.success) {
            throw new Error(createJson.error || 'Gagal membuat Banner.');
          }
          banner = createJson.banner;
          _marketingBannerEditor.bannerId = banner.id;
        } else {
          // Retry after a failed placement: the Banner content already exists,
          // so update its draft instead of creating a duplicate banner.
          var retryRes = await adminFetch(
            API_BASE + '/admin/marketing/banners/' + encodeURIComponent(_marketingBannerEditor.bannerId) + '/draft',
            {
              method: 'PATCH',
              headers: getAuthHeaders(),
              body: JSON.stringify(payload)
            }
          );
          var retryJson = await retryRes.json();
          if (!retryRes.ok || !retryJson.success) {
            throw new Error(retryJson.error || 'Gagal menyimpan Draft Banner.');
          }
          banner = retryJson.banner;
        }

        var placementPayload = getMarketingBannerPlacementPayload();
        if (!placementPayload.branch_ids.length &&
            (placementPayload.starts_at_local || placementPayload.ends_at_local)) {
          throw new Error('Jadwal tayang membutuhkan minimal satu cabang target.');
        }

        if (placementPayload.branch_ids.length) {
          var assignRes = await adminFetch(
            API_BASE + '/admin/marketing/banners/' + encodeURIComponent(_marketingBannerEditor.bannerId) + '/assignments/bulk',
            {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify(placementPayload)
            }
          );
          var assignJson = await assignRes.json();
          if (!assignRes.ok || !assignJson.success) {
            throw new Error(assignJson.error || 'Banner dibuat, tetapi penempatan gagal.');
          }
        }
      } else {
        var updateRes = await adminFetch(
          API_BASE + '/admin/marketing/banners/' + encodeURIComponent(_marketingBannerEditor.bannerId) + '/draft',
          {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
          }
        );
        var updateJson = await updateRes.json();
        if (!updateRes.ok || !updateJson.success) {
          throw new Error(updateJson.error || 'Gagal menyimpan Draft Banner.');
        }
        banner = updateJson.banner;
      }

      if (shouldPublish) {
        var publishRes = await adminFetch(
          API_BASE + '/admin/marketing/banners/' + encodeURIComponent(_marketingBannerEditor.bannerId) + '/publish',
          {
            method: 'POST',
            headers: getAuthHeaders(),
            body: '{}'
          }
        );
        var publishJson = await publishRes.json();
        if (!publishRes.ok || !publishJson.success) {
          if (publishRes.status === 409 && publishJson.conflict) {
            throw new Error('Publish ditolak: position pada Branch memiliki visibility window yang bentrok. Atur penempatan/jadwal terlebih dahulu.');
          }
          throw new Error(publishJson.error || 'Gagal Publish Banner.');
        }
      }

      closeMarketingBannerModal();
      await loadMarketingBanners();
      showToast(shouldPublish ? '✅ Banner berhasil dipublish.' : '✅ Draft Banner tersimpan.');
    } catch (err) {
      console.error('[Banner] save error:', err);
      showToast('❌ ' + (err.message || 'Gagal menyimpan Banner.'));
    } finally {
      _marketingBannerSaving = false;
      if (submitBtn) submitBtn.disabled = false;
      if (publishBtn) publishBtn.disabled = false;
    }
  }

  function submitMarketingBannerForm(event) {
    if (event) event.preventDefault();
    saveMarketingBannerDraft(false);
  }

  async function publishMarketingBanner(bannerId) {
    try {
      var res = await adminFetch(API_BASE + '/admin/marketing/banners/' + encodeURIComponent(bannerId) + '/publish', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: '{}'
      });
      var json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal Publish Banner.');
      }
      await loadMarketingBanners();
      showToast('✅ Banner berhasil dipublish.');
    } catch (err) {
      showToast('❌ ' + (err.message || 'Publish gagal.'));
    }
  }
  window.publishMarketingBanner = publishMarketingBanner;

  async function discardMarketingBannerDraft(bannerId) {
    if (!await confirmFeatureAction('discard-banner-draft', 'Buang Draft Banner', 'Buang Draft perubahan ini? Versi Banner yang sedang Published akan tetap digunakan.', 'Buang Draft')) return;

    try {
      var res = await adminFetch(
        API_BASE + '/admin/marketing/banners/' + encodeURIComponent(bannerId) + '/discard-draft',
        {
          method: 'POST',
          headers: getAuthHeaders(),
          body: '{}'
        }
      );

      var json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal membuang Draft perubahan.');
      }

      await loadMarketingBanners();
      showToast('✅ Draft perubahan dibuang. Versi Published tetap aktif.');
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal membuang Draft perubahan.'));
    }
  }
  window.discardMarketingBannerDraft = discardMarketingBannerDraft;

  async function deleteMarketingBanner(bannerId) {
    if (!await confirmFeatureAction('delete-banner-draft', 'Hapus Draft Banner', 'Hapus Draft Banner ini? Banner yang sudah pernah dipublish tidak dapat dihapus dari menu ini.', 'Hapus')) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/marketing/banners/' + encodeURIComponent(bannerId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal menghapus Draft.');
      }
      await loadMarketingBanners();
      showToast('✅ Draft Banner dihapus.');
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal menghapus Draft.'));
    }
  }
  window.deleteMarketingBanner = deleteMarketingBanner;

  function previewMarketingBannerEditor() {
    var modal = $('modal-marketing-banner-preview');
    var stage = $('mkt-banner-preview-stage');
    var meta = $('mkt-banner-preview-meta');

    if (!modal || !stage) return;

    var title = $('mkt-banner-title-field') ? $('mkt-banner-title-field').value.trim() : 'Banner';
    var alt = $('mkt-banner-alt-field') ? $('mkt-banner-alt-field').value.trim() : title;
    // An empty img.src resolves to the document URL when read back, so only
    // trust src while the preview image is actually visible.
    var previewImg = $('mkt-banner-preview');
    var src = previewImg && previewImg.style.display !== 'none' ? previewImg.src : '';
    var ctaType = $('mkt-banner-cta-type') ? $('mkt-banner-cta-type').value : 'NONE';
    var scheduleEnabled = $('mkt-banner-schedule-enabled') ? $('mkt-banner-schedule-enabled').checked : false;
    var startsAt = scheduleEnabled && $('mkt-banner-starts-at') ? $('mkt-banner-starts-at').value : '';
    var endsAt = scheduleEnabled && $('mkt-banner-ends-at') ? $('mkt-banner-ends-at').value : '';
    var selectedBranches = getSelectedMarketingBannerBranchIds();

    $('modal-banner-preview-title').textContent = title || 'Preview Banner';
    $('modal-banner-preview-subtitle').textContent = 'Review / Preview · Belum dipublish';

    var img = src
      ? '<img src="' + esc(src) + '" alt="' + esc(alt || title || 'Banner') + '">'
      : '<div class="x-marketing-banner-preview-stage-empty">Belum ada media preview.</div>';

    stage.innerHTML =
      img +
      '<div class="x-marketing-banner-preview-stage-caption">' +
        '<strong>' + esc(title || 'Tanpa judul') + '</strong>' +
        '<span>' + esc(ctaType || 'NONE') + '</span>' +
      '</div>';

    var branchNames = [];
    (_marketingBannersState.branches || []).forEach(function (branch) {
      if (selectedBranches.indexOf(String(branch.id)) >= 0) {
        branchNames.push(branch.name || branch.id);
      }
    });

    meta.innerHTML = [
      '<div><span>Mode</span><strong>Draft / Review</strong></div>',
      '<div><span>CTA</span><strong>' + esc(ctaType || 'NONE') + '</strong></div>',
      '<div><span>Cabang</span><strong>' + esc(branchNames.length ? branchNames.join(', ') : 'Belum ditempatkan') + '</strong></div>',
      '<div><span>Schedule</span><strong>' + esc(scheduleEnabled ? ((startsAt || 'Mulai belum diisi') + (endsAt ? ' → ' + endsAt : '')) : 'Tanpa jadwal') + '</strong></div>'
    ].join('');

    modal.style.display = 'flex';
  }
  window.previewMarketingBannerEditor = previewMarketingBannerEditor;

  function openMarketingBannerPreview(key) {
    var row = findMarketingBannerRow(key);
    if (!row) return;

    var modal = $('modal-marketing-banner-preview');
    var stage = $('mkt-banner-preview-stage');
    var meta = $('mkt-banner-preview-meta');
    var title = $('modal-banner-preview-title');
    var subtitle = $('modal-banner-preview-subtitle');

    if (title) title.textContent = row.title || 'Preview Banner';

    var assignment = row.assignment;
    if (subtitle) {
      subtitle.textContent = assignment
        ? (assignment.branch_name || 'Customer Storefront') + ' · Homepage Banner'
        : 'Customer Storefront · Content belum ditempatkan';
    }

    if (stage) {
      var src = row.media && row.media.preview_url;
      var revision = row.draft_revision || row.published_revision || null;
      var img = src
        ? '<img src="' + esc(src) + '" alt="' + esc(row.alt_text || row.title || 'Banner') + '">'
        : '<div class="x-marketing-banner-preview-stage-empty">Belum ada media preview.</div>';

      stage.innerHTML =
        img +
        '<div class="x-marketing-banner-preview-stage-caption">' +
          '<strong>' + esc(row.title || 'Tanpa judul') + '</strong>' +
          '<span>' + esc((revision && revision.cta_type) || 'NONE') + '</span>' +
        '</div>';
    }

    if (meta) {
      var revision2 = row.draft_revision || row.published_revision || null;
      var lines = [
        '<div><span>Publikasi</span><strong>' + esc(String(row.publication_status || 'DRAFT')) + '</strong></div>',
        '<div><span>Placement</span><strong>Homepage Banner</strong></div>',
        '<div><span>Cabang</span><strong>' + esc(assignment ? assignment.branch_name : 'Belum ditempatkan') + '</strong></div>',
        '<div><span>Position</span><strong>' + esc(assignment ? String(assignment.position) : '—') + '</strong></div>',
        '<div><span>Jadwal</span><strong>' + esc(formatMarketingBannerScheduleWithTz(assignment)) + '</strong></div>',
        '<div><span>Visibility</span><strong>' + esc(assignment ? String(assignment.effective_status || '—') : '—') + '</strong></div>',
        '<div><span>CTA</span><strong>' + esc(revision2 ? (revision2.cta_type || 'NONE') : 'NONE') + '</strong></div>'
      ];

      if (revision2 && revision2.promotion_id) {
        lines.push('<div><span>Promotion</span><strong>' + esc(revision2.promotion_id) + '</strong></div>');
      }

      meta.innerHTML = lines.join('');
    }

    openExistingCardInPresentation('modal-marketing-banner-preview', 'marketing-banner-preview', 'dialog');
  }
  window.openMarketingBannerPreview = openMarketingBannerPreview;

  function closeMarketingBannerPreview() {
    if (window.XentraPresentation && window.XentraPresentation.isOpen('marketing-banner-preview')) {
      window.XentraPresentation.close('marketing-banner-preview');
    } else {
      var modal = $('modal-marketing-banner-preview');
      if (modal) modal.style.display = 'none';
    }
  }
  window.closeMarketingBannerPreview = closeMarketingBannerPreview;

  function branchLocalInputFromUtc(iso, timeZone) {
    if (!iso) return '';
    var p = bannerDateTimeParts(iso, timeZone || 'Asia/Jakarta');
    if (!p) return '';
    return p.year + '-' +
      String(p.month).padStart(2, '0') + '-' +
      String(p.day).padStart(2, '0') + 'T' +
      String(p.hour).padStart(2, '0') + ':' +
      String(p.minute).padStart(2, '0');
  }

  function populateMarketingBannerAssignmentBranchSelect(selectedBranchId, disabled) {
    var select = $('mkt-assignment-branch');
    if (!select) return;

    var user = getMarketingBannerUser();
    var ownBranch = String(user.branch_id || user.branchId || '');
    var options = [];

    (_marketingBannersState.branches || []).forEach(function (branch) {
      if (user.role === 'branch_manager' && ownBranch && String(branch.id) !== ownBranch) return;
      options.push('<option value="' + esc(branch.id) + '">' + esc(branch.name || branch.id) + '</option>');
    });

    select.innerHTML = options.length ? options.join('') : '<option value="">Tidak ada cabang</option>';
    if (selectedBranchId) select.value = String(selectedBranchId);

    select.disabled = Boolean(disabled);

    updateMarketingBannerAssignmentTimezone();
  }

  function updateMarketingBannerAssignmentTimezone() {
    var select = $('mkt-assignment-branch');
    var note = $('mkt-assignment-timezone');
    if (!select || !note) return;

    var selected = (_marketingBannersState.branches || []).find(function (branch) {
      return String(branch.id) === String(select.value);
    });

    note.textContent = selected
      ? 'Timezone Branch: ' + (selected.timezone || 'Asia/Jakarta') + '. Input jadwal menggunakan waktu lokal Branch.'
      : '';
  }

  function setAssignmentLocalFields(assignment) {
    var tz = assignment
      ? (assignment.branch_timezone || assignment.timezone || 'Asia/Jakarta')
      : 'Asia/Jakarta';

    var enabled = Boolean(assignment && (assignment.starts_at || assignment.ends_at));

    var scheduleToggle = $('mkt-assignment-schedule-enabled');
    var fields = $('mkt-assignment-schedule-fields');
    var start = $('mkt-assignment-starts-at');
    var end = $('mkt-assignment-ends-at');

    if (scheduleToggle) scheduleToggle.checked = enabled;
    if (fields) fields.style.display = enabled ? '' : 'none';
    if (start) start.value = enabled ? branchLocalInputFromUtc(assignment.starts_at, tz) : '';
    if (end) end.value = enabled ? branchLocalInputFromUtc(assignment.ends_at, tz) : '';
  }

  function openMarketingBannerAssignmentEditor(row, reuse) {
    var bannerId = row.banner_id || row.id;
    var assignment = row.assignment || null;

    _marketingBannerAssignmentEditor = {
      bannerId: bannerId,
      assignmentId: assignment && assignment.id ? assignment.id : null,
      mode: assignment && assignment.id ? 'edit' : 'create'
    };

    var title = $('modal-banner-assignment-title');
    var subtitle = $('modal-banner-assignment-subtitle');
    var saveBtn = $('btn-save-banner-assignment');
    var activeEl = $('mkt-assignment-active');
    var positionEl = $('mkt-assignment-position');
    var lockEl = $('mkt-assignment-governance-lock');
    var lockWrap = $('mkt-assignment-governance-wrap');

    if (title) title.textContent = reuse ? 'Gunakan Lagi Banner' : (assignment ? 'Atur Penempatan Banner' : 'Tempatkan Banner ke Cabang');
    if (subtitle) subtitle.textContent = assignment
      ? 'Branch, position, Active, dan jadwal. Record ENDED tetap dapat digunakan kembali.'
      : 'Pilih Branch target dan aturan visibility.';
    if (saveBtn) saveBtn.textContent = assignment ? 'Simpan Perubahan' : 'Simpan Penempatan';

    populateMarketingBannerAssignmentBranchSelect(
      assignment ? assignment.branch_id : '',
      Boolean(assignment)
    );

    if (positionEl) positionEl.value = assignment ? Number(assignment.position || 1) : 1;
    if (activeEl) activeEl.checked = assignment ? Boolean(assignment.active) : true;

    if (reuse && assignment) {
      var tz = assignment.branch_timezone || assignment.timezone || 'Asia/Jakarta';
      if ($('mkt-assignment-schedule-enabled')) $('mkt-assignment-schedule-enabled').checked = true;
      if ($('mkt-assignment-schedule-fields')) $('mkt-assignment-schedule-fields').style.display = '';
      if ($('mkt-assignment-starts-at')) $('mkt-assignment-starts-at').value = '';
      if ($('mkt-assignment-ends-at')) $('mkt-assignment-ends-at').value = '';
      if ($('mkt-assignment-timezone')) $('mkt-assignment-timezone').textContent = 'Timezone Branch: ' + tz + '. Masukkan jadwal baru untuk memakai Banner kembali.';
    } else {
      setAssignmentLocalFields(assignment);
    }

    if (lockEl) {
      lockEl.checked = assignment ? Boolean(assignment.governance_locked) : false;
    }

    var user = getMarketingBannerUser();
    if (lockWrap) {
      lockWrap.style.display = (user.role === 'owner' || user.role === 'brand_manager') ? 'inline-flex' : 'none';
      if (user.role === 'branch_manager') {
        lockEl.checked = false;
        lockEl.disabled = true;
      } else if (lockEl) {
        lockEl.disabled = false;
      }
    }

    openExistingCardInPresentation('modal-marketing-banner-assignment', 'marketing-banner-assignment', 'bottom-sheet');
  }
  window.openMarketingBannerAssignmentEditor = openMarketingBannerAssignmentEditor;

  function closeMarketingBannerAssignmentModal() {
    if (window.XentraPresentation && window.XentraPresentation.isOpen('marketing-banner-assignment')) {
      window.XentraPresentation.close('marketing-banner-assignment');
    } else {
      var modal = $('modal-marketing-banner-assignment');
      if (modal) modal.style.display = 'none';
    }
  }
  window.closeMarketingBannerAssignmentModal = closeMarketingBannerAssignmentModal;

  async function saveMarketingBannerAssignment(event) {
    if (event) event.preventDefault();

    var editor = _marketingBannerAssignmentEditor;
    var branchId = $('mkt-assignment-branch') ? $('mkt-assignment-branch').value : '';
    var position = $('mkt-assignment-position') ? Number($('mkt-assignment-position').value || 1) : 1;
    var scheduleEnabled = $('mkt-assignment-schedule-enabled') ? $('mkt-assignment-schedule-enabled').checked : false;
    var active = $('mkt-assignment-active') ? $('mkt-assignment-active').checked : true;

    if (!branchId) {
      showToast('❌ Branch wajib dipilih.');
      return;
    }

    var payload = {
      branch_id: branchId,
      placement: 'HOME_BANNER_CAROUSEL',
      position: position,
      active: active,
      starts_at_local: scheduleEnabled && $('mkt-assignment-starts-at') ? $('mkt-assignment-starts-at').value : '',
      ends_at_local: scheduleEnabled && $('mkt-assignment-ends-at') ? $('mkt-assignment-ends-at').value : '',
      governance_locked: $('mkt-assignment-governance-lock') ? $('mkt-assignment-governance-lock').checked : false
    };

    var btn = $('btn-save-banner-assignment');
    if (btn) btn.disabled = true;

    try {
      var url;
      var method;

      if (editor.mode === 'create') {
        url = API_BASE + '/admin/marketing/banners/' + encodeURIComponent(editor.bannerId) + '/assignments';
        method = 'POST';
      } else {
        url = API_BASE + '/admin/marketing/banners/' + encodeURIComponent(editor.bannerId) + '/assignments/' + encodeURIComponent(editor.assignmentId);
        method = 'PATCH';
        delete payload.branch_id;
        delete payload.placement;
      }

      var res = await adminFetch(url, {
        method: method,
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal menyimpan Assignment.');
      }

      closeMarketingBannerAssignmentModal();
      await loadMarketingBanners();
      showToast('✅ Penempatan Banner berhasil diperbarui.');
    } catch (err) {
      var suffix = err && err.message ? err.message : 'Gagal menyimpan Assignment.';
      showToast('❌ ' + suffix);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function toggleMarketingBannerAssignment(assignmentId, active) {
    var row = _marketingBannersState.rows.find(function (item) {
      return item.assignment && String(item.assignment.id) === String(assignmentId);
    });

    if (!row || !row.assignment) return;

    if (isMarketingBannerBranchManager() && row.assignment.governance_locked) {
      showToast('⚠️ Assignment ini dikunci Owner.');
      await loadMarketingBanners();
      return;
    }

    try {
      var res = await adminFetch(
        API_BASE + '/admin/marketing/banners/' + encodeURIComponent(row.banner_id || row.id) + '/assignments/' + encodeURIComponent(assignmentId),
        {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ active: Boolean(active) })
        }
      );

      var json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal mengubah visibility Banner.');
      }

      await loadMarketingBanners();
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal mengubah visibility Banner.'));
      await loadMarketingBanners();
    }
  }

  async function toggleMarketingBannerGovernance(assignmentId, locked) {
    var row = _marketingBannersState.rows.find(function (item) {
      return item.assignment && String(item.assignment.id) === String(assignmentId);
    });

    if (!row) return;

    try {
      var res = await adminFetch(
        API_BASE + '/admin/marketing/banners/' + encodeURIComponent(row.banner_id || row.id) + '/assignments/' + encodeURIComponent(assignmentId),
        {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ governance_locked: Boolean(locked) })
        }
      );
      var json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal mengubah governance lock.');
      }

      await loadMarketingBanners();
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal mengubah lock Banner.'));
    }
  }

  async function removeMarketingBannerAssignment(assignmentId) {
    var row = _marketingBannersState.rows.find(function (item) {
      return item.assignment && String(item.assignment.id) === String(assignmentId);
    });
    if (!row) return;

    if (!await confirmFeatureAction('remove-banner-assignment', 'Hapus Penempatan Banner', 'Hapus penempatan Banner dari cabang ini? Content Banner tetap tersimpan.', 'Hapus')) return;

    try {
      var res = await adminFetch(
        API_BASE + '/admin/marketing/banners/' + encodeURIComponent(row.banner_id || row.id) + '/assignments/' + encodeURIComponent(assignmentId),
        {
          method: 'DELETE',
          headers: getAuthHeaders()
        }
      );
      var json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal menghapus Assignment.');
      }

      await loadMarketingBanners();
      showToast('✅ Penempatan Banner dihapus.');
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal menghapus Assignment.'));
    }
  }
  window.removeMarketingBannerAssignment = removeMarketingBannerAssignment;

  function wireMarketingBannerUi() {
    var createBtn = $('btn-mkt-create-banner');
    if (createBtn && !createBtn.dataset.bound) {
      createBtn.dataset.bound = '1';
      createBtn.addEventListener('click', openMarketingBannerCreate);
    }

    var filter = $('mkt-banners-branch-filter');
    if (filter && !filter.dataset.bound) {
      filter.dataset.bound = '1';
      filter.addEventListener('change', function () {
        _marketingBannersState.branchFilter = filter.value || '';
        loadMarketingBanners();
      });
    }

    var filePick = $('mkt-banner-pick');
    var fileInput = $('mkt-banner-file');
    if (filePick && fileInput && !filePick.dataset.bound) {
      filePick.dataset.bound = '1';
      filePick.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) {
          onMarketingBannerFileSelected(fileInput.files[0]);
        }
      });
    }

    var clear = $('mkt-banner-clear');
    if (clear && !clear.dataset.bound) {
      clear.dataset.bound = '1';
      clear.addEventListener('click', clearMarketingBannerMedia);
    }

    var ctaType = $('mkt-banner-cta-type');
    if (ctaType && !ctaType.dataset.bound) {
      ctaType.dataset.bound = '1';
      ctaType.addEventListener('change', updateMarketingBannerCtaFields);
    }

    var schedule = $('mkt-banner-schedule-enabled');
    var scheduleFields = $('mkt-banner-schedule-fields');
    if (schedule && !schedule.dataset.bound) {
      schedule.dataset.bound = '1';
      schedule.addEventListener('change', function () {
        if (scheduleFields) scheduleFields.style.display = schedule.checked ? '' : 'none';
        var publishAction = $('mkt-banner-publish-action');
        if (publishAction && _marketingBannerEditor.mode === 'create') {
          publishAction.textContent = schedule.checked ? 'Publikasikan & Jadwalkan' : 'Publish Sekarang';
        }
      });
    }

    var assignmentBranch = $('mkt-assignment-branch');
    if (assignmentBranch && !assignmentBranch.dataset.bound) {
      assignmentBranch.dataset.bound = '1';
      assignmentBranch.addEventListener('change', updateMarketingBannerAssignmentTimezone);
    }

    var assignmentSchedule = $('mkt-assignment-schedule-enabled');
    var assignmentScheduleFields = $('mkt-assignment-schedule-fields');
    if (assignmentSchedule && !assignmentSchedule.dataset.bound) {
      assignmentSchedule.dataset.bound = '1';
      assignmentSchedule.addEventListener('change', function () {
        if (assignmentScheduleFields) assignmentScheduleFields.style.display = assignmentSchedule.checked ? '' : 'none';
      });
    }

    var form = $('form-marketing-banner');
    if (form && !form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', submitMarketingBannerForm);
    }

    var publishBtn = $('mkt-banner-publish-action');
    if (publishBtn && !publishBtn.dataset.bound) {
      publishBtn.dataset.bound = '1';
      publishBtn.addEventListener('click', function () { saveMarketingBannerDraft(true); });
    }

    var assignmentForm = $('form-marketing-banner-assignment');
    if (assignmentForm && !assignmentForm.dataset.bound) {
      assignmentForm.dataset.bound = '1';
      assignmentForm.addEventListener('submit', saveMarketingBannerAssignment);
    }

    if ($('mkt-banner-governance-wrap')) {
      var user = getMarketingBannerUser();
      $('mkt-banner-governance-wrap').style.display = (user.role === 'owner' || user.role === 'brand_manager') ? 'inline-flex' : 'none';
    }
  }

  function initializeMarketingBanners() {
    wireMarketingBannerUi();
    loadMarketingBanners();
  }

  window.renderMarketingBannersSkeleton = initializeMarketingBanners;
  window.initializeMarketingBanners = initializeMarketingBanners;

  async function loadMarketingOverview() {
    try {
      var branchId = getEffectiveBranchId();
      var query = branchId && branchId !== 'all' ? '?branch_id=' + encodeURIComponent(branchId) : '';
      var res = await adminFetch('/api/v1/admin/marketing/overview' + query, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var json = await res.json();
      if (!json.success || !json.data) return;

      var cm = json.data.customer_metrics || {};
      var pm = json.data.promotion_metrics || {};

      var totalCustEl = $('mkt-total-customers');
      var retCustEl = $('mkt-returning-customers');
      var repRateSubEl = $('mkt-repeat-rate-sub');
      var activePromoEl = $('mkt-active-promotions');
      var totalPromoSubEl = $('mkt-total-promotions-sub');
      var totalRedEl = $('mkt-total-redemptions');
      var benefitSubEl = $('mkt-benefit-sub');

      if (totalCustEl) totalCustEl.textContent = cm.total_customers || 0;
      if (retCustEl) retCustEl.textContent = cm.returning_customers || 0;
      if (repRateSubEl) repRateSubEl.textContent = 'Repeat rate: ' + (cm.repeat_purchase_rate_pct || 0) + '%';
      if (activePromoEl) activePromoEl.textContent = pm.active_promotions || 0;
      if (totalPromoSubEl) totalPromoSubEl.textContent = (pm.total_promotions || 0) + ' program terdaftar';
      if (totalRedEl) totalRedEl.textContent = pm.total_redemptions || 0;
      if (benefitSubEl) benefitSubEl.textContent = 'Total manfaat: ' + formatMoney(pm.total_benefit_amount || 0);

      var tbody = $('tbody-mkt-recent-redemptions');
      if (tbody) {
        var recs = json.data.recent_redemptions || [];
        if (recs.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Belum ada klaim promosi yang tercatat.</td></tr>';
        } else {
          var rows = recs.map(function (r) {
            var timeText = r.redeemed_at ? esc(r.redeemed_at.substring(0, 19).replace('T', ' ')) : '—';
            return '<tr>' +
              '<td><strong>' + esc(r.promotion_name || 'Program Promosi') + '</strong></td>' +
              '<td><a href="#orders/' + encodeURIComponent(r.order_id) + '" style="font-weight:600;color:var(--primary);text-decoration:none;">#' + esc(r.order_id) + '</a></td>' +
              '<td>' + esc(r.branch_name || 'Cabang Utama') + '</td>' +
              '<td><code style="font-size:12px;background:#f8fafc;padding:2px 6px;border-radius:4px;">' + esc(r.customer_phone || '—') + '</code></td>' +
              '<td><span style="color:#059669;font-weight:700;">' + formatMoney(r.benefit_amount || 0) + '</span></td>' +
              '<td style="font-size:12px;color:#64748b;">' + timeText + '</td>' +
            '</tr>';
          });
          tbody.innerHTML = rows.join('');
        }
      }
    } catch (err) {
      console.error('[Load Marketing Overview Error]:', err);
      showToast('Gagal memuat ringkasan marketing.');
    }
  }
  window.loadMarketingOverview = loadMarketingOverview;

  var _marketingPromotionsState = {
    promotions: [],
    masterMenus: [],
    branches: [],
    menusLoadStatus: 'idle', // 'idle' | 'loading' | 'success' | 'error'
    menusLoadError: null
  };

  async function loadMarketingPromotions() {
    try {
      var tbody = $('tbody-mkt-promotions');
      if (!tbody) return;

      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Memuat daftar promosi...</td></tr>';

      var res = await adminFetch('/api/v1/admin/marketing/promotions', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var json = await res.json();
      if (!json.success || !json.promotions) return;

      var promos = json.promotions || [];
      _marketingPromotionsState.promotions = promos;

      var user = getStoredUser();
      var isOwner = user && user.role === 'owner';

      if (promos.length === 0) {
        var createFirstBtn = isOwner ? '<button type="button" class="x-btn-primary" onclick="openCreatePromotionModal()" style="font-size:12px;padding:6px 14px;">Buat Promo Pertama</button>' : '';
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8">' +
          '<div style="font-size:36px;margin-bottom:8px;">🎁</div>' +
          '<div style="font-weight:700;color:var(--text-main);margin-bottom:4px;">Belum Ada Program Promosi</div>' +
          '<p class="text-muted" style="font-size:12px;margin:0 0 12px;">' + (isOwner ? 'Mulai buat promosi pertama seperti Insentif Instalasi PWA untuk mendorong retensi pelanggan.' : 'Belum ada program promosi.') + '</p>' +
          createFirstBtn +
          '</td></tr>';
        return;
      }

      var nowIso = new Date().toISOString();
      var rows = promos.map(function (p) {
        var statusBadge = '';
        if (p.is_active !== 1 && p.is_active !== true) {
          statusBadge = '<span class="x-badge" style="background:#f1f5f9;color:#64748b;font-weight:600;">Nonaktif</span>';
        } else if (p.start_at && p.start_at > nowIso) {
          statusBadge = '<span class="x-badge" style="background:#fef3c7;color:#b45309;font-weight:700;">Terjadwal</span>';
        } else if (p.end_at && p.end_at < nowIso) {
          statusBadge = '<span class="x-badge" style="background:#fee2e2;color:#b91c1c;font-weight:700;">Berakhir</span>';
        } else {
          statusBadge = '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:700;">Aktif</span>';
        }

        // Format Reward summary
        var rewardSummary = '—';
        if (Array.isArray(p.rewards) && p.rewards.length > 0) {
          var r0 = p.rewards[0];
          if (r0.reward_type === 'freebie_product') {
            rewardSummary = '<span style="font-weight:600;color:#0369a1;">🎁 ' + esc(r0.target_menu_title || r0.target_menu_id || r0.target_product_name || r0.target_product_id || 'Menu Gratis') + '</span>';
          } else {
            rewardSummary = esc(r0.reward_type);
          }
        }

        // Format Branch Scopes summary
        var scopeSummary = '<span class="x-badge" style="background:#f1f5f9;color:#475569;font-size:11px;">Semua Cabang</span>';
        if (Array.isArray(p.scopes) && p.scopes.length > 0) {
          var activeScopes = p.scopes.filter(function (s) { return s.is_active === 1; });
          scopeSummary = '<span class="x-badge" style="background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:600;">' +
            activeScopes.length + ' Cabang Aktif</span>';
        }

        // Capability display
        var capLabel = esc(p.capability_type || 'general');
        if (p.capability_type === 'install_incentive') capLabel = '📱 Insentif PWA';
        else if (p.capability_type === 'first_order') capLabel = '🥇 First Order';

        var isPromoActive = p.is_active === 1 || p.is_active === true;
        var toggleSwitch = '' +
          '<div style="display:inline-flex;align-items:center;gap:8px;">' +
            '<label class="x-toggle x-toggle-compact' + (isPromoActive ? ' x-toggle-on' : '') + '" title="' + (isPromoActive ? 'Promosi aktif' : 'Promosi nonaktif') + '">' +
              '<input type="checkbox" ' + (isPromoActive ? 'checked' : '') + ' onchange="toggleMarketingPromotionActive(\'' + esc(p.id) + '\', this.checked ? 1 : 0)" aria-label="Status aktif promosi ' + esc(p.name) + '">' +
              '<span class="x-toggle-slider"></span>' +
            '</label>' +
            statusBadge +
          '</div>';

        return '<tr>' +
          '<td><strong>' + esc(p.name) + '</strong>' + (p.code ? ' <code style="font-size:11px;background:#f1f5f9;padding:2px 4px;border-radius:4px;">' + esc(p.code) + '</code>' : '') + '</td>' +
          '<td><span class="x-badge" style="background:#f0f9ff;color:#0369a1;font-size:11px;">' + capLabel + '</span><br><code style="font-size:10px;color:#64748b;">' + esc(p.stacking_policy) + '</code></td>' +
          '<td>' + rewardSummary + '</td>' +
          '<td>' + scopeSummary + '</td>' +
          '<td><strong>' + (p.redemptions_count || 0) + '</strong> klaim</td>' +
          '<td>' + toggleSwitch + '</td>' +
          '<td class="text-right" style="white-space:nowrap;">' +
            '<div class="x-item-actions">' +
              '<button type="button" class="x-action-menu-trigger" aria-label="Aksi promosi ' + esc(p.name) + '" onclick="XentraActionMenu.open(this, [' +
                (isOwner ? '{ label: \'Edit Promosi\', icon: \'✏️\', onClick: function() { openEditPromotionModal(\'' + esc(p.id) + '\'); } },' : '') +
                '{ label: \'' + (isPromoActive ? 'Nonaktifkan' : 'Aktifkan') + '\', icon: \'' + (isPromoActive ? '⏸️' : '▶️') + '\', onClick: function() { toggleMarketingPromotionActive(\'' + esc(p.id) + '\', ' + (isPromoActive ? 0 : 1) + '); } }' +
                (isOwner ? ', { divider: true }, { label: \'Hapus Promosi\', icon: \'🗑️\', destructive: true, onClick: function() { deleteMarketingPromotion(\'' + esc(p.id) + '\'); } }' : '') +
              '])">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>' +
              '</button>' +
            '</div>' +
          '</td>' +
        '</tr>';
      });

      tbody.innerHTML = rows.join('');
    } catch (err) {
      console.error('[Load Marketing Promotions Error]:', err);
      showToast('Gagal memuat daftar promosi.');
    }
  }
  window.loadMarketingPromotions = loadMarketingPromotions;

  async function ensureMarketingDependenciesLoaded(forceReload) {
    var selectEl = $('mkt-promo-target-menu');
    var retryContainer = $('mkt-promo-target-menu-retry-container');

    if (!forceReload && _marketingPromotionsState.masterMenus.length > 0 && _marketingPromotionsState.branches.length > 0) {
      return;
    }

    if (forceReload || !_marketingPromotionsState.masterMenus.length) {
      _marketingPromotionsState.menusLoadStatus = 'loading';
      _marketingPromotionsState.menusLoadError = null;
      if (selectEl) {
        selectEl.disabled = true;
        selectEl.innerHTML = '<option value="">Memuat Menu Master...</option>';
      }
      if (retryContainer) retryContainer.style.display = 'none';

      try {
        var mRes = await adminFetch(API_BASE + '/admin/menus?status=ACTIVE', { headers: getAuthHeaders() });
        if (!mRes.ok) {
          throw new Error('Gagal memuat Menu Master (HTTP ' + mRes.status + ')');
        }
        var mData = await mRes.json();
        if (!mData || !mData.success) {
          throw new Error((mData && mData.error) || 'Gagal memuat Menu Master dari server.');
        }
        _marketingPromotionsState.masterMenus = Array.isArray(mData.menus) ? mData.menus : [];
        _marketingPromotionsState.menusLoadStatus = 'success';
      } catch (err) {
        console.error('[Marketing Menus Load Error]:', err);
        _marketingPromotionsState.menusLoadStatus = 'error';
        _marketingPromotionsState.menusLoadError = err.message || 'Gagal memuat Menu Master';
      }
    }

    if (forceReload || !_marketingPromotionsState.branches.length) {
      try {
        var bRes = await adminFetch(API_BASE + '/admin/branches', { headers: getAuthHeaders() });
        if (bRes.ok) {
          var bData = await bRes.json();
          _marketingPromotionsState.branches = (bData && (bData.branches || bData.data)) || [];
        }
      } catch (e) {
        console.warn('[Marketing Branches Load Warn]:', e);
      }
    }
  }

  function promotionMenuLabel(menu) {
    if (!menu) return 'Menu Promo';
    var name = menu.package_name || '';
    if (!name) {
      var parts = [];
      if (menu.sub_category_name) parts.push(menu.sub_category_name);
      if (menu.rasa_name && String(menu.rasa_name).trim().toLowerCase() !== 'original') {
        parts.push(menu.rasa_name);
      }
      name = parts.join(' — ') || ('Menu ' + menu.id);
    }
    var typeLabel = String(menu.menu_type || '').toUpperCase() === 'PACKAGE' ? 'Paket' : 'Satuan';
    var price = menu.selling_price !== undefined && menu.selling_price !== null
      ? ' (' + formatMoney(menu.selling_price) + ')'
      : '';
    return name + ' · ' + typeLabel + price;
  }

  function renderPromoMenuOptions(selectedMenuId) {
    var selectEl = $('mkt-promo-target-menu');
    var retryContainer = $('mkt-promo-target-menu-retry-container');
    if (!selectEl) return;

    if (_marketingPromotionsState.menusLoadStatus === 'error') {
      selectEl.disabled = true;
      selectEl.innerHTML = '<option value="">Gagal memuat Menu Master</option>';
      if (retryContainer) retryContainer.style.display = 'block';
      return;
    }

    if (retryContainer) retryContainer.style.display = 'none';

    if (_marketingPromotionsState.menusLoadStatus === 'loading') {
      selectEl.disabled = true;
      selectEl.innerHTML = '<option value="">Memuat Menu Master...</option>';
      return;
    }

    var menus = _marketingPromotionsState.masterMenus || [];
    if (!menus.length) {
      selectEl.disabled = true;
      selectEl.innerHTML = '<option value="">Belum ada Menu Master aktif</option>';
      return;
    }

    selectEl.disabled = false;
    var html = '<option value="">-- Pilih Menu Hadiah --</option>';
    var foundSavedMenu = false;

    menus.forEach(function (menu) {
      var isSel = selectedMenuId !== null && selectedMenuId !== undefined &&
        String(menu.id) === String(selectedMenuId);
      if (isSel) foundSavedMenu = true;
      html += '<option value="' + esc(menu.id) + '"' + (isSel ? ' selected' : '') + '>' +
        esc(promotionMenuLabel(menu)) + '</option>';
    });

    if (selectedMenuId && !foundSavedMenu) {
      html = '<option value="' + esc(selectedMenuId) + '" selected disabled style="color:#ef4444;">⚠️ Menu reward tersimpan tidak lagi aktif/tersedia (ID: ' + esc(selectedMenuId) + ')</option>' + html;
    }

    selectEl.innerHTML = html;
  }

  async function retryLoadPromoMenus() {
    await ensureMarketingDependenciesLoaded(true);
    var targetInput = $('mkt-promo-target-menu');
    var currentVal = targetInput ? targetInput.value : null;
    renderPromoMenuOptions(currentVal);
    onPromotionProductSelected();
  }
  window.retryLoadPromoMenus = retryLoadPromoMenus;

  function renderPromoBranchCheckboxes(selectedBranchIds) {
    var container = $('mkt-promo-branches-list');
    if (!container) return;

    var branches = _marketingPromotionsState.branches || [];
    if (!branches.length) {
      container.innerHTML = '<span class="text-muted" style="font-size:12px;">Tidak ada cabang ditemukan.</span>';
      return;
    }

    var selSet = {};
    (selectedBranchIds || []).forEach(function (id) { selSet[String(id)] = true; });

    var html = '';
    branches.forEach(function (b) {
      var checked = (selectedBranchIds === null || selectedBranchIds === undefined || selSet[String(b.id)]) ? ' checked' : '';
      html += '<label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;background:#f8fafc;padding:6px 10px;border-radius:6px;border:1px solid #e2e8f0;">' +
        '<input type="checkbox" name="mkt-promo-branch" value="' + esc(b.id) + '"' + checked + '> ' +
        '<span>' + esc(b.name) + '</span>' +
      '</label>';
    });
    container.innerHTML = html;
  }

  function togglePromoSelectAllBranches(checked) {
    var boxes = document.querySelectorAll('input[name="mkt-promo-branch"]');
    boxes.forEach(function (box) { box.checked = Boolean(checked); });
  }
  window.togglePromoSelectAllBranches = togglePromoSelectAllBranches;

  function onPromotionCapabilityChange() {
    var cap = $('mkt-promo-capability').value;
    var nameEl = $('mkt-promo-name');
    var codeEl = $('mkt-promo-code');
    var presBox = $('mkt-promo-presentation-box');
    if (presBox) {
      presBox.style.display = cap === 'install_incentive' ? 'block' : 'none';
    }
    if (cap === 'install_incentive' && (!nameEl.value || nameEl.value.indexOf('Hadiah') !== -1)) {
      if (!nameEl.value) nameEl.value = 'Hadiah Instalasi Aplikasi PWA';
      if (!codeEl.value) codeEl.value = 'PWABANGJO';
    }
  }
  window.onPromotionCapabilityChange = onPromotionCapabilityChange;

  function onPromotionBenefitTypeUiChange(type) {
    var rewardTypeInput = $('mkt-promo-reward-type');
    if (rewardTypeInput) rewardTypeInput.value = type || 'freebie_product';
    var freebieBox = $('mkt-promo-benefit-freebie-box');
    if (freebieBox) {
      freebieBox.style.display = (type === 'freebie_product') ? 'block' : 'none';
    }
  }
  window.onPromotionBenefitTypeUiChange = onPromotionBenefitTypeUiChange;

  function onPromotionProductSelected() {
    var selectEl = $('mkt-promo-target-menu');
    var normalPriceEl = $('mkt-promo-product-normal-price');
    var summaryLabel = document.querySelector('label[for="mkt-promo-target-menu"]');
    if (!selectEl || !normalPriceEl) return;

    var menuId = selectEl.value;
    if (!menuId) {
      normalPriceEl.textContent = '-';
      return;
    }

    var menus = _marketingPromotionsState.masterMenus || [];
    var menu = menus.find(function (item) { return String(item.id) === String(menuId); });
    if (menu && menu.selling_price !== undefined && menu.selling_price !== null) {
      normalPriceEl.textContent = formatMoney(menu.selling_price);
    } else {
      normalPriceEl.textContent = '-';
    }
    if (summaryLabel) summaryLabel.innerHTML = 'Menu yang Diberikan <span style="color:#ef4444;">*</span>';
  }
  window.onPromotionProductSelected = onPromotionProductSelected;

  function updatePromotionPresentationPreview() {
    var titleInput = $('mkt-promo-banner-title');
    var subtitleInput = $('mkt-promo-banner-subtitle');
    var ctaInput = $('mkt-promo-cta-text');
    var iconUrlInput = $('mkt-promo-icon-url');

    var title = (titleInput && titleInput.value.trim()) || 'Install sekarang & dapatkan promo spesial';
    var subtitle = (subtitleInput && subtitleInput.value.trim()) || 'syarat & ketentuan berlaku';
    var ctaText = (ctaInput && ctaInput.value.trim()) || 'Install';
    var iconUrl = (iconUrlInput && iconUrlInput.value.trim()) || '/assets/pwa/icon-192.png';

    var liveTitle = $('mkt-promo-live-title');
    var liveSubtitle = $('mkt-promo-live-subtitle');
    var liveCtaBtn = $('mkt-promo-live-cta-btn');
    var liveIcon = $('mkt-promo-live-icon');
    var previewIcon = $('mkt-promo-icon-preview');

    if (liveTitle) liveTitle.textContent = title;
    if (liveSubtitle) liveSubtitle.textContent = subtitle;
    if (liveCtaBtn) liveCtaBtn.textContent = ctaText;
    if (liveIcon) liveIcon.src = iconUrl;
    if (previewIcon) previewIcon.src = iconUrl;
  }
  window.updatePromotionPresentationPreview = updatePromotionPresentationPreview;

  function resetPromotionIconToDefault() {
    var mediaIdInput = $('mkt-promo-media-id');
    var iconUrlInput = $('mkt-promo-icon-url');
    var statusEl = $('mkt-promo-icon-status');

    if (mediaIdInput) mediaIdInput.value = '';
    if (iconUrlInput) iconUrlInput.value = '/assets/pwa/icon-192.png';
    if (statusEl) {
      statusEl.textContent = 'Menggunakan icon default sistem (/assets/pwa/icon-192.png).';
      statusEl.style.color = 'var(--text-muted)';
    }
    updatePromotionPresentationPreview();
  }
  window.resetPromotionIconToDefault = resetPromotionIconToDefault;

  async function onPromotionIconFileSelected(file) {
    if (!file) return;

    var fileInput = $('mkt-promo-icon-file');
    var statusEl = $('mkt-promo-icon-status');
    var mediaIdInput = $('mkt-promo-media-id');
    var iconUrlInput = $('mkt-promo-icon-url');

    var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.indexOf(file.type) === -1) {
      showToast('❌ Format icon tidak didukung. Gunakan JPG, PNG, atau WebP.');
      if (fileInput) fileInput.value = '';
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showToast('Ukuran file maksimal 10 MB.');
      if (fileInput) fileInput.value = '';
      return;
    }

    if (!XentraCropEditor || typeof XentraCropEditor.open !== 'function') {
      showToast('❌ Editor crop tidak tersedia. Upload dibatalkan; gambar tidak diproses tanpa Crop Editor.');
      if (fileInput) fileInput.value = '';
      return;
    }

    XentraCropEditor.open({
      source: file,
      assetType: 'promotion',
      aspectRatio: 1.0,
      title: 'Potong & Posisikan Icon Promo (1:1)',
      onConfirm: async function (cropSpec, previewDataUrl) {
        try {
          await uploadPromotionIconCanonical(file, cropSpec, fileInput, statusEl, mediaIdInput, iconUrlInput, previewDataUrl);
        } catch (_) {}
      },
      onCancel: function () {
        // Batal = discard the newly selected icon; persisted promotion media remains unchanged.
        if (fileInput) fileInput.value = '';
      }
    });
  }

  async function uploadPromotionIconCanonical(file, cropSpec, fileInput, statusEl, mediaIdInput, iconUrlInput, previewDataUrl) {
    try {
      if (statusEl) {
        statusEl.textContent = 'Memproses icon melalui Media System...';
        statusEl.style.color = '#3b82f6';
      }

      var base64 = await new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      var uploadRes = await adminFetch(API_BASE + '/admin/media/upload', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          image_base64: base64,
          mime_type: file.type,
          original_filename: file.name || null,
          asset_type: 'promotion',
          enforce_aspect_ratio: false
        })
      });

      var uploadJson = await uploadRes.json();
      if (!uploadRes.ok || !uploadJson.success || !uploadJson.asset) {
        throw new Error(uploadJson.error || 'Upload media icon gagal.');
      }

      var mediaId = uploadJson.asset.media_id || uploadJson.asset.id;
      if (!mediaId) throw new Error('Media ID tidak dikembalikan server.');

      var procRes = await adminFetch(API_BASE + '/admin/media/' + encodeURIComponent(mediaId) + '/process', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ crop_spec: cropSpec || null })
      });

      var procJson = await procRes.json();
      if (!procRes.ok || !procJson.success || !procJson.asset) {
        throw new Error(procJson.error || 'Proses media icon gagal.');
      }

      var processedAsset = procJson.asset;
      var preview = (processedAsset.variants || []).slice().sort(function (a, b) { return a.width - b.width; }).find(function (v) { return v.width >= 320; }) || (processedAsset.variants || [])[0];
      var iconUrl = preview && preview.url ? preview.url : processedAsset.url;

      if (mediaIdInput) mediaIdInput.value = processedAsset.media_id || processedAsset.id || mediaId;
      if (iconUrlInput) iconUrlInput.value = iconUrl;

      if (statusEl) {
        statusEl.textContent = '✓ Icon diproses otomatis: crop 1:1 + optimasi.';
        statusEl.style.color = '#16a34a';
      }
      updatePromotionPresentationPreview();
      showToast('Icon promosi berhasil diproses melalui Media System.');
    } catch (err) {
      console.error('[Promotion Icon Upload Error]:', err);
      if (statusEl) {
        statusEl.textContent = 'Gagal mengunggah icon: ' + err.message;
        statusEl.style.color = '#ef4444';
      }
      showToast(err.message || 'Gagal memproses file icon.');
      throw err;
    } finally {
      if (fileInput) fileInput.value = '';
    }
  }

  window.onPromotionIconFileSelected = onPromotionIconFileSelected;

  function formatDateTimeLocal(isoStr) {
    if (!isoStr) return '';
    try {
      var d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    } catch (e) {
      return '';
    }
  }

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

  function mountPromotionEditorPage() {
    var backdrop = $('modal-mkt-promotion');
    var page = $('marketing-promotion-editor-view');
    if (!backdrop || !page) return;
    var card = backdrop.querySelector('.x-modal-card');
    if (!card) return;
    page.appendChild(card);
    ensureOwnerFeatureMobileHeader(
      page,
      $('modal-mkt-promo-title') ? $('modal-mkt-promo-title').textContent : 'Editor Promosi',
      'Atur program promosi, benefit pelanggan, dan tampilan promo.',
      'Kembali ke Marketing'
    );
    card.classList.add('x-feature-page-surface');
    card.style.maxWidth = 'none';
    card.style.width = '100%';
    card.style.maxHeight = 'none';
    card.style.height = 'auto';
    card.style.borderRadius = '14px';
    backdrop.style.display = 'none';
  }

  async function openCreatePromotionModal() {
    var user = getStoredUser();
    if (!user || user.role !== 'owner') {
      showToast('Akses ditolak: Hanya Owner yang berwenang membuat program promosi.');
      return;
    }

    var modal = $('modal-mkt-promotion');
    if (!modal) return;

    $('modal-mkt-promo-title').textContent = 'Buat Program Promosi Baru';
    $('mkt-promo-id').value = '';
    $('mkt-promo-name').value = '';
    $('mkt-promo-code').value = '';
    $('mkt-promo-capability').value = 'install_incentive';
    $('mkt-promo-stacking').value = 'exclusive';
    $('mkt-promo-limit-per-user').value = '1';
    $('mkt-promo-limit-total').value = '';
    $('mkt-promo-status').value = '1';
    if ($('mkt-promo-start-at')) $('mkt-promo-start-at').value = '';
    if ($('mkt-promo-end-at')) $('mkt-promo-end-at').value = '';
    $('mkt-promo-reward-type').value = 'freebie_product';
    if ($('mkt-promo-branches-all')) $('mkt-promo-branches-all').checked = true;

    // Reset Presentation inputs
    if ($('mkt-promo-banner-title')) $('mkt-promo-banner-title').value = '';
    if ($('mkt-promo-banner-subtitle')) $('mkt-promo-banner-subtitle').value = '';
    if ($('mkt-promo-cta-text')) $('mkt-promo-cta-text').value = 'Install';
    if ($('mkt-promo-media-id')) $('mkt-promo-media-id').value = '';
    if ($('mkt-promo-icon-url')) $('mkt-promo-icon-url').value = '/assets/pwa/icon-192.png';
    if ($('mkt-promo-icon-status')) {
      $('mkt-promo-icon-status').textContent = 'JPG, PNG, WebP · Maks. 10 MB · Rasio 1:1';
      $('mkt-promo-icon-status').style.color = '#64748b';
    }

    navigateTo('marketing/promotions/new');
    mountPromotionEditorPage();

    await ensureMarketingDependenciesLoaded();
    renderPromoMenuOptions(null);
    onPromotionProductSelected();
    renderPromoBranchCheckboxes(null); // default all selected
    onPromotionCapabilityChange();
    updatePromotionPresentationPreview();
  }
  window.openCreatePromotionModal = openCreatePromotionModal;

  async function openEditPromotionModal(promoId) {
    var user = getStoredUser();
    if (!user || user.role !== 'owner') {
      showToast('Akses ditolak: Hanya Owner yang berwenang mengubah program promosi.');
      return;
    }

    var modal = $('modal-mkt-promotion');
    if (!modal) return;

    var promo = (_marketingPromotionsState.promotions || []).find(function (p) { return p.id === promoId; });
    if (!promo) {
      showToast('Data promosi tidak ditemukan.');
      return;
    }

    $('modal-mkt-promo-title').textContent = 'Edit Program Promosi';
    $('mkt-promo-id').value = promo.id;
    $('mkt-promo-name').value = promo.name || '';
    $('mkt-promo-code').value = promo.code || '';
    $('mkt-promo-capability').value = promo.capability_type || 'install_incentive';
    $('mkt-promo-stacking').value = promo.stacking_policy || 'exclusive';
    $('mkt-promo-limit-per-user').value = promo.max_redemptions_per_customer || 1;
    $('mkt-promo-limit-total').value = promo.max_redemptions_total || '';
    $('mkt-promo-status').value = promo.is_active === 1 ? '1' : '0';
    if ($('mkt-promo-start-at')) $('mkt-promo-start-at').value = formatDateTimeLocal(promo.start_at);
    if ($('mkt-promo-end-at')) $('mkt-promo-end-at').value = formatDateTimeLocal(promo.end_at);

    var targetMenuId = null;
    var legacyTargetProductId = null;
    var presPayload = {};
    if (Array.isArray(promo.rewards) && promo.rewards.length > 0) {
      var primaryReward = promo.rewards[0];
      targetMenuId = primaryReward.target_menu_id || primaryReward.menu_id || null;
      legacyTargetProductId = primaryReward.target_product_id || null;
      $('mkt-promo-reward-type').value = primaryReward.reward_type || 'freebie_product';
      if (primaryReward.presentation) {
        presPayload = primaryReward.presentation;
      } else if (primaryReward.presentation_payload) {
        try {
          presPayload = typeof primaryReward.presentation_payload === 'string'
            ? JSON.parse(primaryReward.presentation_payload)
            : primaryReward.presentation_payload;
        } catch (_) {}
      }
    }

    // Populate Presentation fields
    if ($('mkt-promo-banner-title')) $('mkt-promo-banner-title').value = presPayload.banner_title || '';
    if ($('mkt-promo-banner-subtitle')) $('mkt-promo-banner-subtitle').value = presPayload.banner_subtitle || '';
    if ($('mkt-promo-cta-text')) $('mkt-promo-cta-text').value = presPayload.cta_text || 'Install';
    if ($('mkt-promo-media-id')) $('mkt-promo-media-id').value = presPayload.media_id || '';
    if ($('mkt-promo-icon-url')) $('mkt-promo-icon-url').value = presPayload.icon_url || '/assets/pwa/icon-192.png';
    if ($('mkt-promo-icon-status')) {
      if (presPayload.media_id) {
        $('mkt-promo-icon-status').textContent = '✓ Menggunakan media kustom (ID: ' + presPayload.media_id + ')';
        $('mkt-promo-icon-status').style.color = '#16a34a';
      } else {
        $('mkt-promo-icon-status').textContent = 'Format: PNG, JPG, WebP. Maks 10MB (Rasio 1:1).';
        $('mkt-promo-icon-status').style.color = '#64748b';
      }
    }

    var selectedBranchIds = [];
    if (Array.isArray(promo.scopes) && promo.scopes.length > 0) {
      selectedBranchIds = promo.scopes.map(function (s) { return s.branch_id; });
    }

    navigateTo('marketing/promotions/' + encodeURIComponent(promoId) + '/edit');
    mountPromotionEditorPage();

    await ensureMarketingDependenciesLoaded();
    renderPromoMenuOptions(targetMenuId);
    onPromotionProductSelected();
    if (!targetMenuId && legacyTargetProductId) {
      showToast('Promo lama masih memakai target Product. Pilih Menu hadiah canonical sebelum menyimpan perubahan.');
    }
    renderPromoBranchCheckboxes(selectedBranchIds.length ? selectedBranchIds : null);
    onPromotionCapabilityChange();
    updatePromotionPresentationPreview();
  }
  window.openEditPromotionModal = openEditPromotionModal;

  function closePromotionModal() {
    var backdrop = $('modal-mkt-promotion');
    var page = $('marketing-promotion-editor-view');
    var card = backdrop && backdrop.querySelector('.x-modal-card');
    if (!card && page) card = page.querySelector('.x-modal-card');
    if (card && backdrop) {
      backdrop.appendChild(card);
      card.classList.remove('x-feature-page-surface');
      card.style.maxWidth = '760px';
      card.style.width = '100%';
      card.style.maxHeight = '92vh';
      card.style.height = 'auto';
      card.style.borderRadius = '14px';
      backdrop.style.display = 'none';
    }
    if (page) page.style.display = 'none';
    navigateTo('marketing/promotions');
  }
  window.closePromotionModal = closePromotionModal;

  async function submitPromotionForm(e) {
    if (e && e.preventDefault) e.preventDefault();

    var submitBtn = $('btn-mkt-submit-promo');
    var promoId = $('mkt-promo-id').value;
    var name = $('mkt-promo-name').value.trim();
    var code = $('mkt-promo-code').value.trim();
    var capability = $('mkt-promo-capability').value;
    var stacking = $('mkt-promo-stacking').value;
    var limitPerUser = parseInt($('mkt-promo-limit-per-user').value, 10) || 1;
    var limitTotal = parseInt($('mkt-promo-limit-total').value, 10) || null;
    var isActive = $('mkt-promo-status').value === '1' ? 1 : 0;
    var startAtVal = $('mkt-promo-start-at') ? $('mkt-promo-start-at').value : '';
    var endAtVal = $('mkt-promo-end-at') ? $('mkt-promo-end-at').value : '';
    var rewardType = $('mkt-promo-reward-type').value;
    var targetMenuId = $('mkt-promo-target-menu').value;

    if (!name) {
      showToast('Nama promosi wajib diisi.');
      return;
    }
    if (!targetMenuId) {
      showToast('Pilih Menu hadiah dari Menu Master.');
      return;
    }

    if (capability === 'install_incentive') {
      var checkBannerTitle = $('mkt-promo-banner-title') ? $('mkt-promo-banner-title').value.trim() : '';
      if (!checkBannerTitle) {
        showToast('Headline banner wajib diisi.');
        return;
      }
    }

    if (startAtVal && endAtVal) {
      var sTime = new Date(startAtVal).getTime();
      var eTime = new Date(endAtVal).getTime();
      if (eTime < sTime) {
        showToast('Tanggal berakhir promosi tidak boleh lebih awal dari tanggal mulai.');
        return;
      }
    }

    var branchBoxes = document.querySelectorAll('input[name="mkt-promo-branch"]:checked');
    var branchIds = Array.from(branchBoxes).map(function (b) { return b.value; });

    var rules = [];
    if (capability === 'install_incentive') {
      rules.push({
        rule_type: 'eligibility',
        rule_payload: {
          requires_pwa_installed: true,
          target_audience: 'anonymous_or_registered',
          first_order_only: true
        }
      });
    } else if (capability === 'first_order') {
      rules.push({
        rule_type: 'eligibility',
        rule_payload: {
          first_order_only: true
        }
      });
    }

    // Build presentation payload
    var bannerTitle = $('mkt-promo-banner-title') ? $('mkt-promo-banner-title').value.trim() : '';
    var bannerSubtitle = $('mkt-promo-banner-subtitle') ? $('mkt-promo-banner-subtitle').value.trim() : '';
    var ctaText = $('mkt-promo-cta-text') ? $('mkt-promo-cta-text').value.trim() : '';
    var mediaId = $('mkt-promo-media-id') ? $('mkt-promo-media-id').value.trim() : '';
    var iconUrl = $('mkt-promo-icon-url') ? $('mkt-promo-icon-url').value.trim() : '';

    var presentationPayload = {
      banner_title: bannerTitle || 'Install sekarang & dapatkan promo spesial',
      banner_subtitle: bannerSubtitle || 'syarat & ketentuan berlaku',
      cta_text: ctaText || 'Install',
      reward_title: 'Selamat! Hadiah spesial untuk pesanan pertamamu!',
      reward_badge_text: '✓ Bonus PWA Aktif (Rp0)',
      media_id: mediaId || null,
      icon_url: iconUrl || '/assets/pwa/icon-192.png'
    };

    var rewards = [{
      reward_type: rewardType,
      target_menu_id: targetMenuId,
      amount_in_cents: 0,
      presentation_payload: presentationPayload
    }];

    var payload = {
      name: name,
      code: code || null,
      capability_type: capability,
      stacking_policy: stacking,
      priority_weight: capability === 'install_incentive' ? 100 : 50,
      max_redemptions_total: limitTotal,
      max_redemptions_per_customer: limitPerUser,
      start_at: startAtVal ? new Date(startAtVal).toISOString() : null,
      end_at: endAtVal ? new Date(endAtVal).toISOString() : null,
      is_active: isActive,
      rules: rules,
      rewards: rewards,
      branch_ids: branchIds
    };

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Menyimpan...';
    }

    try {
      var url = promoId ? ('/api/v1/admin/marketing/promotions/' + encodeURIComponent(promoId)) : '/api/v1/admin/marketing/promotions';
      var method = promoId ? 'PUT' : 'POST';

      var res = await adminFetch(url, {
        method: method,
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error((json && json.error) || 'Gagal menyimpan promosi.');
      }

      showToast(promoId ? 'Promosi berhasil diperbarui.' : 'Program promosi baru berhasil dibuat.');
      closePromotionModal();
      loadMarketingPromotions();
    } catch (err) {
      console.error('[Submit Promotion Error]:', err);
      showToast(err.message || 'Gagal menyimpan promosi.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Simpan Program Promosi';
      }
    }
  }
  window.submitPromotionForm = submitPromotionForm;

  async function toggleMarketingPromotionActive(promoId, newStatus) {
    try {
      var res = await adminFetch('/api/v1/admin/marketing/promotions/' + encodeURIComponent(promoId), {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: newStatus })
      });
      var json = await res.json();
      if (!res.ok || !json.success) throw new Error((json && json.error) || 'Gagal memperbarui status promosi.');

      showToast(newStatus === 1 ? 'Promosi diaktifkan.' : 'Promosi dinonaktifkan.');
      loadMarketingPromotions();
    } catch (err) {
      console.error('[Toggle Marketing Promotion Error]:', err);
      showToast(err.message || 'Gagal mengubah status promosi.');
    }
  }
  window.toggleMarketingPromotionActive = toggleMarketingPromotionActive;

  async function deleteMarketingPromotion(promoId) {
    var user = getStoredUser();
    if (!user || user.role !== 'owner') {
      showToast('Akses ditolak: Hanya Owner yang berwenang menghapus program promosi.');
      return;
    }

    if (!await confirmFeatureAction('delete-promotion', 'Hapus Program Promosi', 'Apakah Anda yakin ingin menghapus program promosi ini? Tindakan ini tidak dapat dibatalkan.', 'Hapus')) return;

    try {
      var res = await adminFetch('/api/v1/admin/marketing/promotions/' + encodeURIComponent(promoId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var json = await res.json();
      if (!res.ok || !json.success) throw new Error((json && json.error) || 'Gagal menghapus promosi.');

      showToast('Promosi berhasil dihapus.');
      loadMarketingPromotions();
    } catch (err) {
      console.error('[Delete Marketing Promotion Error]:', err);
      showToast(err.message || 'Gagal menghapus promosi.');
    }
  }
  window.deleteMarketingPromotion = deleteMarketingPromotion;

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
     Product remains an atomic stock/composition unit. This controller talks
     directly to /admin/menus/* and never uses the legacy customer catalog route.
     ========================================================================= */

  var _ownerMasterMenuState = {
    menus: [],
    products: [],
    categories: [],
    titles: [],
    rasas: [],
    levels: [],
    search: '',
    typeFilter: 'all',
    editingId: null,
    editingType: 'SINGLE',
    createType: 'SINGLE',
    packageComponents: [],
    menuItems: []
  };

  function upsertOwnerMasterMenuDependency(type, row, options) {
    options = options || {};
    if (!row || !row.id) return false;

    var listMap = {
      product: 'products',
      category: 'categories',
      title: 'titles',
      rasa: 'rasas'
    };
    var listName = listMap[type];
    if (!listName || !Array.isArray(_ownerMasterMenuState[listName])) return false;

    var list = _ownerMasterMenuState[listName];
    var index = list.findIndex(function(item) { return String(item.id) === String(row.id); });
    if (index >= 0) list[index] = Object.assign({}, list[index], row);
    else list.push(row);

    renderOwnerMasterMenuEditorForm();

    var selectId = options.selectId;
    var select = selectId ? $(selectId) : null;
    if (select) select.value = String(row.id);

    renderOwnerMasterMenuPreview();
    return true;
  }

  function addOwnerMasterMenuPackageProduct(product) {
    if (!product || !product.id) return false;
    var productId = String(product.id);
    var exists = (_ownerMasterMenuState.packageComponents || []).some(function(item) {
      return String(item.product_id || '') === productId;
    });
    if (exists) return false;

    var products = _ownerMasterMenuState.products || [];
    var index = products.findIndex(function(item) { return String(item.id) === productId; });
    if (index >= 0) products[index] = Object.assign({}, products[index], product);
    else products.push(product);

    _ownerMasterMenuState.packageComponents.push({ product_id: productId, quantity: 1 });
    renderOwnerMasterMenuPackageComponents();
    renderOwnerMasterMenuPreview();
    return true;
  }

  function ownerMasterMenuStatusLabel(status) {
    var value = String(status || '').toUpperCase();
    if (value === 'ACTIVE') return 'Aktif';
    if (value === 'ARCHIVED') return 'Arsip';
    return 'Draft';
  }

  function ownerMasterMenuTitle(menu) {
    if (!menu) return 'Menu';
    if (String(menu.menu_type).toUpperCase() === 'PACKAGE') {
      return menu.package_name || menu.sub_category_name || 'Paket';
    }
    return menu.title_name || menu.sub_category_name || 'Menu';
  }

  function ownerMasterMenuRasaLabel(name) {
    var value = String(name || '').trim();
    return value && value.toLowerCase() !== 'original' ? value : '';
  }

  function showOwnerMasterMenuList() {
    var list = $('master-menu-list-view');
    var editor = $('master-menu-editor-view');
    if (list) list.style.display = 'block';
    if (editor) editor.style.display = 'none';
  }

  function showOwnerMasterMenuEditor() {
    var list = $('master-menu-list-view');
    var editor = $('master-menu-editor-view');
    if (list) list.style.display = 'none';
    if (editor) editor.style.display = 'block';
    if (window.XentraDropdown && typeof window.XentraDropdown.refresh === 'function') {
      window.XentraDropdown.refresh();
    }
  }

  function ownerMasterMenuResetEditor(type) {
    var nextType = type === 'PACKAGE' ? 'PACKAGE' : 'SINGLE';
    _ownerMasterMenuState.editingId = null;
    _ownerMasterMenuState.editingType = nextType;
    _ownerMasterMenuState.createType = nextType;
    _ownerMasterMenuState.packageComponents = nextType === 'PACKAGE'
      ? [{ product_id: '', quantity: 1 }, { product_id: '', quantity: 1 }]
      : [];

    $('master-menu-id').value = '';
    $('master-menu-type').value = nextType;
    $('cm-product').value = '';
    $('cm-package-name').value = '';
    var titleInput = $('cm-title-input');
    if (titleInput) titleInput.value = '';
    var charCount = $('cm-title-char-count');
    if (charCount) charCount.textContent = '0';
    var priceMin = $('cm-price-min');
    if (priceMin) setOwnerMasterMenuMoney('cm-price-min', '');
    var priceMax = $('cm-price-max');
    if (priceMax) setOwnerMasterMenuMoney('cm-price-max', '');
    if (typeof switchPricePolicyMode === 'function') switchPricePolicyMode('FIXED');
    setOwnerMasterMenuMoney('cm-price', '');
    setOwnerMasterMenuMoney('cm-cost', '');
    $('cm-status').value = 'DRAFT';
    var activeToggle = $('cm-toggle-active');
    if (activeToggle) activeToggle.checked = true;
    $('cm-category').value = '';
    $('cm-rasa').value = '';

    var title = nextType === 'PACKAGE' ? 'Tambah Menu Paket' : 'Tambah Menu Satuan';
    $('master-menu-editor-title').textContent = title;
    $('master-menu-editor-breadcrumb').textContent = 'Tambah Menu';
    $('master-menu-editor-mobile-title').textContent = 'Tambah Menu';
    $('master-menu-editor-mobile-subtitle').textContent = nextType === 'PACKAGE'
      ? 'Susun nama paket, Product penyusun, taxonomy, dan harga Menu.'
      : 'Pilih Item penyusun, Judul, Rasa, Kategori, dan harga Menu.';

    resetOwnerMasterMenuImageState('');
    renderOwnerMasterMenuEditorForm();
  }

  function setOwnerMasterMenuMoney(id, value) {
    var el = $(id);
    if (!el) return;
    if (window.XentraCurrencyInput) window.XentraCurrencyInput.setValue(el, value == null ? '' : value);
    else el.value = value == null ? '' : value;
  }

  function getOwnerMasterMenuMoney(id) {
    var el = $(id);
    if (!el) return NaN;
    var raw = String(el.value || '').replace(/\D/g, '');
    if (!raw) return NaN;
    return window.XentraCurrencyInput ? Number(window.XentraCurrencyInput.getValue(el)) : Number(raw);
  }

  function ownerMasterMenuFindProduct(id) {
    return _ownerMasterMenuState.products.find(function(p) {
      return String(p.id) === String(id);
    }) || null;
  }

  function ownerMasterMenuPopulateSelect(selectId, rows, valueKey, labelFn, emptyLabel) {
    var select = $(selectId);
    if (!select) return;
    var html = '';
    if (emptyLabel !== undefined) {
      html += '<option value="">' + esc(emptyLabel) + '</option>';
    }
    (rows || []).forEach(function(row) {
      var id = String(row[valueKey || 'id'] || '');
      if (!id) return;
      var label = typeof labelFn === 'function' ? labelFn(row) : String(row.name || id);
      var inactive = row.is_active === 0 || row.is_active === false;
      html += '<option value="' + esc(id) + '"' +
        (inactive ? ' data-inactive="1" disabled' : '') + '>' +
        esc(label + (inactive ? ' (Nonaktif)' : '')) + '</option>';
    });
    select.innerHTML = html;
  }

  function renderOwnerMasterMenuTitles() {
    var select = $('cm-title');
    if (!select) return;
    var current = String(select.value || '');
    var rows = _ownerMasterMenuState.titles || [];
    var html = '<option value="">Pilih Judul Menu</option>';
    rows.forEach(function(row) {
      var inactive = row.is_active === 0 || row.is_active === false;
      html += '<option value="' + esc(row.id) + '"' +
        (inactive ? ' data-inactive="1" disabled' : '') + '>' +
        esc(row.name + (inactive ? ' (Nonaktif)' : '')) + '</option>';
    });
    select.innerHTML = html;
    if (current && rows.some(function(row) { return String(row.id) === current; })) {
      select.value = current;
    }
    if (window.XentraDropdown && typeof window.XentraDropdown.refresh === 'function') {
      window.XentraDropdown.refresh();
    }
  }

  function renderOwnerMasterMenuEditorForm() {
    var type = String(($('master-menu-type') && $('master-menu-type').value) || _ownerMasterMenuState.editingType || 'SINGLE').toUpperCase();
    _ownerMasterMenuState.editingType = type === 'PACKAGE' ? 'PACKAGE' : 'SINGLE';

    var single = $('master-menu-single-fields');
    var pkg = $('master-menu-package-fields');
    if (single) single.style.display = 'none';
    if (pkg) pkg.style.display = 'none';

    ownerMasterMenuPopulateSelect('cm-category', _ownerMasterMenuState.categories, 'id', function(row) { return row.name; }, 'Pilih Kategori');
    renderOwnerMasterMenuTitles();
    ownerMasterMenuPopulateSelect('cm-rasa', _ownerMasterMenuState.rasas, 'id', function(row) {
      return row.name;
    }, '-');

    renderOwnerMasterMenuItems();
    renderOwnerMasterMenuPackageComponents();
    renderOwnerMasterMenuPreview();
    if (window.XentraDropdown && typeof window.XentraDropdown.refresh === 'function') {
      window.XentraDropdown.refresh();
    }
  }

  var _pickItemSelectedProductId = null;
  var _pickItemActiveCategory = 'all';

  function openPickItemSheet() {
    _pickItemSelectedProductId = null;
    _pickItemActiveCategory = 'all';
    var searchInput = $('pick-item-search');
    if (searchInput) searchInput.value = '';

    renderPickItemCategories();
    renderPickItemList('', 'all');

    document.body.classList.add('x-sheet-open');
    var overlay = $('sheet-pick-item-overlay');
    var sheet = $('sheet-pick-item');
    var extClose = $('sheet-pick-item-ext-close');

    if (overlay) {
      overlay.style.display = 'block';
      setTimeout(function () { overlay.classList.add('open'); }, 10);
    }
    if (sheet) {
      sheet.style.display = 'flex';
      setTimeout(function () {
        sheet.classList.add('open');
        if (extClose) {
          var sheetH = sheet.offsetHeight || 380;
          extClose.style.bottom = (sheetH + 12) + 'px';
          extClose.classList.add('open');
        }
      }, 10);
    }
  }

  function closePickItemSheet() {
    document.body.classList.remove('x-sheet-open');
    var extClose = $('sheet-pick-item-ext-close');
    var overlay = $('sheet-pick-item-overlay');
    var sheet = $('sheet-pick-item');

    if (extClose) extClose.classList.remove('open');
    if (overlay) {
      overlay.classList.remove('open');
      setTimeout(function () { overlay.style.display = 'none'; }, 260);
    }
    if (sheet) {
      sheet.classList.remove('open');
      setTimeout(function () { sheet.style.display = 'none'; }, 280);
    }
  }

  function renderPickItemCategories() {
    var pillContainer = $('pick-item-cat-pills');
    if (!pillContainer) return;

    var cats = _ownerMasterMenuState.categories || [];
    var html = '<button type="button" class="x-pick-item-pill' + (_pickItemActiveCategory === 'all' ? ' active' : '') + '" data-cat-id="all" onclick="filterPickItemCategory(\'all\')" style="padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;border:none;background:' + (_pickItemActiveCategory === 'all' ? '#0F172A' : '#F1F5F9') + ';color:' + (_pickItemActiveCategory === 'all' ? '#FFFFFF' : '#475569') + ';cursor:pointer;white-space:nowrap;">Semua</button>';

    cats.forEach(function(cat) {
      var isActive = String(cat.id) === String(_pickItemActiveCategory);
      html += '<button type="button" class="x-pick-item-pill' + (isActive ? ' active' : '') + '" data-cat-id="' + esc(cat.id) + '" onclick="filterPickItemCategory(\'' + esc(cat.id) + '\')" style="padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;border:none;background:' + (isActive ? '#0F172A' : '#F1F5F9') + ';color:' + (isActive ? '#FFFFFF' : '#475569') + ';cursor:pointer;white-space:nowrap;">' + esc(cat.name) + '</button>';
    });

    pillContainer.innerHTML = html;
  }

  function filterPickItemCategory(catId) {
    _pickItemActiveCategory = String(catId);
    renderPickItemCategories();
    var searchInput = $('pick-item-search');
    var query = searchInput ? searchInput.value : '';
    renderPickItemList(query, _pickItemActiveCategory);
  }

  function renderPickItemList(query, catId) {
    var listContainer = $('pick-item-list-container');
    if (!listContainer) return;

    var q = String(query || '').trim().toLowerCase();
    var products = (_ownerMasterMenuState.products || []).filter(function(p) {
      var active = p.is_active !== 0 && p.is_active !== false;
      if (!active) return false;
      if (q && !(p.name || '').toLowerCase().includes(q)) return false;
      if (catId && catId !== 'all' && String(p.category_id || '') !== String(catId)) return false;
      return true;
    });

    if (!products.length) {
      listContainer.innerHTML = '<div style="text-align:center;padding:32px 16px;color:#94A3B8;font-size:13px;">Tidak ada item ditemukan</div>';
      return;
    }

    listContainer.innerHTML = products.map(function(p) {
      var isChecked = String(p.id) === String(_pickItemSelectedProductId);
      var cost = Number(p.cost_price || 0);
      var img = p.image_url || p.image || '';
      var imgHtml = img
        ? '<img src="' + esc(img) + '" alt="' + esc(p.name) + '" style="width:40px;height:40px;border-radius:8px;object-fit:cover;">'
        : '<div style="width:40px;height:40px;border-radius:8px;background:#F1F5F9;display:flex;align-items:center;justify-content:center;font-size:18px;">🍽️</div>';

      return '<label class="x-pick-item-card" style="display:flex;align-items:center;justify-content:space-between;padding:12px;border:1px solid ' + (isChecked ? '#0F172A' : '#E2E8F0') + ';border-radius:12px;cursor:pointer;background:' + (isChecked ? '#F8FAFC' : '#FFFFFF') + ';transition:all 0.15s ease;">' +
        '<div style="display:flex;align-items:center;gap:12px;">' +
          imgHtml +
          '<div>' +
            '<div style="font-size:14px;font-weight:600;color:#0F172A;">' + esc(p.name) + '</div>' +
            '<div style="font-size:12px;color:#64748B;">Modal: ' + formatMoney(cost) + '</div>' +
          '</div>' +
        '</div>' +
        '<input type="radio" name="pick_item_radio" value="' + esc(p.id) + '" ' + (isChecked ? 'checked' : '') + ' onchange="selectPickItemRadio(\'' + esc(p.id) + '\')" style="width:18px;height:18px;accent-color:#0F172A;cursor:pointer;">' +
      '</label>';
    }).join('');
  }

  function selectPickItemRadio(productId) {
    _pickItemSelectedProductId = String(productId);
    var searchInput = $('pick-item-search');
    var query = searchInput ? searchInput.value : '';
    renderPickItemList(query, _pickItemActiveCategory);
  }

  function confirmPickedItem() {
    if (!_pickItemSelectedProductId) {
      showToast('⚠️ Silakan pilih minimal 1 item.');
      return;
    }

    var selectedProd = ownerMasterMenuFindProduct(_pickItemSelectedProductId);
    if (!selectedProd) {
      showToast('⚠️ Item tidak valid.');
      return;
    }

    // Cek apakah item sudah ada di daftar
    var exists = (_ownerMasterMenuState.menuItems || []).some(function(item) {
      return String(item.product_id) === String(_pickItemSelectedProductId);
    });

    if (exists) {
      showToast('⚠️ Item ini sudah ada di dalam daftar menu.');
      closePickItemSheet();
      return;
    }

    // Jika ada baris kosong pertama (product_id == ''), ganti baris itu
    var emptyIndex = (_ownerMasterMenuState.menuItems || []).findIndex(function(item) {
      return !item.product_id;
    });

    if (emptyIndex >= 0) {
      _ownerMasterMenuState.menuItems[emptyIndex].product_id = String(_pickItemSelectedProductId);
      _ownerMasterMenuState.menuItems[emptyIndex].quantity = 1;
    } else {
      _ownerMasterMenuState.menuItems.push({
        product_id: String(_pickItemSelectedProductId),
        quantity: 1
      });
    }

    _ownerMasterMenuState.packageComponents = _ownerMasterMenuState.menuItems.slice();

    closePickItemSheet();
    renderOwnerMasterMenuItems();
    renderOwnerMasterMenuPreview();
  }

  window.openPickItemSheet = openPickItemSheet;
  window.closePickItemSheet = closePickItemSheet;
  window.filterPickItemCategory = filterPickItemCategory;
  window.selectPickItemRadio = selectPickItemRadio;
  window.confirmPickedItem = confirmPickedItem;

  function renderOwnerMasterMenuItems() {
    var box = $('cm-items-container');
    if (!box) return;
    var rows = _ownerMasterMenuState.menuItems || [];
    if (!rows.length) {
      box.innerHTML = '';
      return;
    }

    box.innerHTML = rows.map(function(item, index) {
      var options = '<option value="">Pilih Item</option>';
      var selectedProduct = null;
      _ownerMasterMenuState.products.forEach(function(product) {
        var inactive = product.is_active === 0 || product.is_active === false;
        var isSelected = String(item.product_id) === String(product.id);
        if (isSelected) selectedProduct = product;
        var label = product.name + (inactive ? ' (Nonaktif)' : '');
        options += '<option value="' + esc(product.id) + '"' +
          (isSelected ? ' selected' : '') +
          (inactive ? ' data-inactive="1" disabled' : '') + '>' +
          esc(label) + '</option>';
      });

      var displayText = selectedProduct ? selectedProduct.name : 'Pilih Item';
      var qty = Math.max(1, parseInt(item.quantity, 10) || 1);

      return '<div class="x-composed-menu-component-row" data-cm-item-index="' + index + '" style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:12px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">' +
          '<div style="font-size:14px;font-weight:700;color:#0F172A;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
            esc(displayText) +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<div style="display:inline-flex;align-items:center;border:1px solid #CBD5E1;border-radius:8px;overflow:hidden;background:#FFFFFF;">' +
              '<button type="button" class="x-stepper-btn-minus" data-cm-stepper-minus="' + index + '" style="width:30px;height:30px;border:none;background:#F8FAFC;color:#0F172A;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;">-</button>' +
              '<input type="number" class="x-input" min="1" step="1" inputmode="numeric" value="' + esc(qty) + '" data-cm-item-qty style="width:40px;height:30px;border:none;border-left:1px solid #CBD5E1;border-right:1px solid #CBD5E1;text-align:center;padding:0;font-size:13px;font-weight:600;border-radius:0;">' +
              '<button type="button" class="x-stepper-btn-plus" data-cm-stepper-plus="' + index + '" style="width:30px;height:30px;border:none;background:#F8FAFC;color:#0F172A;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>' +
            '</div>' +
            '<button type="button" class="x-btn-secondary x-composed-menu-component-remove" data-cm-item-remove="' + index + '" aria-label="Hapus Item" title="Hapus Item" style="width:30px;height:30px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:8px;border:1px solid #CBD5E1;color:#EF4444;background:#FFFFFF;cursor:pointer;">' +
              '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<polyline points="3 6 5 6 21 6"></polyline>' +
                '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>' +
                '<line x1="10" y1="11" x2="10" y2="17"></line>' +
                '<line x1="14" y1="11" x2="14" y2="17"></line>' +
              '</svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="x-cm-combobox" style="display:none;">' +
          '<input type="text" class="x-input x-cm-combobox-input" data-cm-item-input="' + index + '" value="' + esc(displayText) + '">' +
          '<div class="x-cm-combobox-menu" data-cm-item-menu="' + index + '"></div>' +
          '<select class="x-input" data-cm-item-product tabindex="-1" aria-hidden="true">' + options + '</select>' +
        '</div>' +
      '</div>';
    }).join('');

    function syncOwnerMasterMenuItemsFromDom() {
      var box = $('cm-items-container');
      if (!box) return;
      var rows = box.querySelectorAll('[data-cm-item-index]');
      if (!rows || !rows.length) return;
      var synced = [];
      rows.forEach(function(row) {
        var sel = row.querySelector('[data-cm-item-product]');
        var txt = row.querySelector('.x-cm-combobox-input');
        var qtyInput = row.querySelector('[data-cm-item-qty]');
        var prodId = (sel && sel.value) ? String(sel.value).trim() : '';
        if (!prodId && txt && txt.value.trim()) {
          var query = txt.value.trim().toLowerCase();
          var matched = _ownerMasterMenuState.products.find(function(p) {
            var active = p.is_active !== 0 && p.is_active !== false;
            return active && (p.name || '').trim().toLowerCase() === query;
          }) || _ownerMasterMenuState.products.find(function(p) {
            var active = p.is_active !== 0 && p.is_active !== false;
            return active && (p.name || '').toLowerCase().includes(query);
          });
          if (matched) prodId = String(matched.id);
        }
        var qty = qtyInput ? (parseInt(qtyInput.value, 10) || 1) : 1;
        synced.push({ product_id: prodId, quantity: qty });
      });
      if (synced.length > 0) {
        _ownerMasterMenuState.menuItems = synced;
        _ownerMasterMenuState.packageComponents = synced.slice();
      }
    }

    // Stepper minus & plus listeners
    box.querySelectorAll('[data-cm-stepper-minus]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var index = Number(btn.dataset.cmStepperMinus);
        if (_ownerMasterMenuState.menuItems[index]) {
          var curQty = Math.max(1, parseInt(_ownerMasterMenuState.menuItems[index].quantity, 10) || 1);
          if (curQty > 1) {
            _ownerMasterMenuState.menuItems[index].quantity = curQty - 1;
            if (_ownerMasterMenuState.packageComponents[index]) {
              _ownerMasterMenuState.packageComponents[index].quantity = curQty - 1;
            }
            renderOwnerMasterMenuItems();
            renderOwnerMasterMenuPreview();
          }
        }
      });
    });

    box.querySelectorAll('[data-cm-stepper-plus]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var index = Number(btn.dataset.cmStepperPlus);
        if (_ownerMasterMenuState.menuItems[index]) {
          var curQty = Math.max(1, parseInt(_ownerMasterMenuState.menuItems[index].quantity, 10) || 1);
          _ownerMasterMenuState.menuItems[index].quantity = curQty + 1;
          if (_ownerMasterMenuState.packageComponents[index]) {
            _ownerMasterMenuState.packageComponents[index].quantity = curQty + 1;
          }
          renderOwnerMasterMenuItems();
          renderOwnerMasterMenuPreview();
        }
      });
    });

    box.querySelectorAll('[data-cm-item-qty]').forEach(function(input) {
      input.addEventListener('change', function() {
        var row = input.closest('[data-cm-item-index]');
        var index = row ? Number(row.dataset.cmItemIndex) : -1;
        if (index >= 0) {
          var val = Math.max(1, parseInt(input.value, 10) || 1);
          if (_ownerMasterMenuState.menuItems[index]) {
            _ownerMasterMenuState.menuItems[index].quantity = val;
          }
          if (_ownerMasterMenuState.packageComponents[index]) {
            _ownerMasterMenuState.packageComponents[index].quantity = val;
          }
          input.value = val;
          renderOwnerMasterMenuPreview();
        }
      });
    });

    box.querySelectorAll('[data-cm-item-remove]').forEach(function(button) {
      button.addEventListener('click', function() {
        syncOwnerMasterMenuItemsFromDom();
        var index = Number(button.dataset.cmItemRemove);
        _ownerMasterMenuState.menuItems.splice(index, 1);
        _ownerMasterMenuState.packageComponents.splice(index, 1);
        renderOwnerMasterMenuItems();
        renderOwnerMasterMenuPreview();
      });
    });

    if (window.XentraDropdown && typeof window.XentraDropdown.refresh === 'function') {
      window.XentraDropdown.refresh();
    }
  }

  function addOwnerMasterMenuItem() {
    openPickItemSheet();
  }

  function renderOwnerMasterMenuPackageComponents() {
    var box = $('cm-package-components');
    if (!box) return;
    var rows = _ownerMasterMenuState.packageComponents || [];
    if (!rows.length) {
      box.innerHTML = '<div class="x-empty-state text-muted">Belum ada Product. Tambahkan minimal dua unit.</div>';
      return;
    }

    box.innerHTML = rows.map(function(item, index) {
      var options = '<option value="">Pilih Product</option>';
      _ownerMasterMenuState.products.forEach(function(product) {
        var inactive = product.is_active === 0 || product.is_active === false;
        options += '<option value="' + esc(product.id) + '"' +
          (String(item.product_id) === String(product.id) ? ' selected' : '') +
          (inactive ? ' data-inactive="1" disabled' : '') + '>' +
          esc(product.name + (inactive ? ' (Nonaktif)' : '')) + '</option>';
      });
      return '<div class="x-composed-menu-component-row" data-cm-component-index="' + index + '">' +
        '<div class="x-composed-menu-component-product">' +
          '<label>Product ' + (index + 1) + '</label>' +
          '<select class="x-input" data-cm-product>' + options + '</select>' +
        '</div>' +
        '<div class="x-composed-menu-component-qty">' +
          '<label>Qty</label>' +
          '<input type="number" class="x-input" min="1" step="1" inputmode="numeric" value="' + esc(item.quantity || 1) + '" data-cm-qty>' +
        '</div>' +
        '<button type="button" class="x-btn-secondary x-composed-menu-component-remove" data-cm-remove="' + index + '" aria-label="Hapus Product dari paket">Hapus</button>' +
      '</div>';
    }).join('');

    box.querySelectorAll('[data-cm-product]').forEach(function(select) {
      select.addEventListener('change', function() {
        var row = select.closest('[data-cm-component-index]');
        var index = row ? Number(row.dataset.cmComponentIndex) : -1;
        if (index >= 0) _ownerMasterMenuState.packageComponents[index].product_id = select.value;
        renderOwnerMasterMenuPreview();
      });
    });
    box.querySelectorAll('[data-cm-qty]').forEach(function(input) {
      input.addEventListener('input', function() {
        var row = input.closest('[data-cm-component-index]');
        var index = row ? Number(row.dataset.cmComponentIndex) : -1;
        if (index >= 0) _ownerMasterMenuState.packageComponents[index].quantity = input.value;
        renderOwnerMasterMenuPreview();
      });
    });
    box.querySelectorAll('[data-cm-remove]').forEach(function(button) {
      button.addEventListener('click', function() {
        var index = Number(button.dataset.cmRemove);
        _ownerMasterMenuState.packageComponents.splice(index, 1);
        renderOwnerMasterMenuPackageComponents();
      });
    });
    if (window.XentraDropdown && typeof window.XentraDropdown.refresh === 'function') {
      window.XentraDropdown.refresh();
    }
  }

  function addOwnerMasterMenuPackageComponent() {
    _ownerMasterMenuState.packageComponents.push({ product_id: '', quantity: 1 });
    renderOwnerMasterMenuPackageComponents();
  }

  function ownerMasterMenuSelectedTitle() {
    var id = String(($('cm-title') && $('cm-title').value) || '');
    return _ownerMasterMenuState.titles.find(function(row) {
      return String(row.id) === id;
    }) || null;
  }

  function ownerMasterMenuSelectedRasa() {
    var id = String(($('cm-rasa') && $('cm-rasa').value) || '');
    return _ownerMasterMenuState.rasas.find(function(row) {
      return String(row.id) === id;
    }) || null;
  }

  function ownerMasterMenuSelectedLevel() {
    var toggle = $('cm-spice-toggle');
    if (toggle && toggle.checked) {
      var levelVal = Number(($('cm-spice-level-val') && $('cm-spice-level-val').value) || 1);
      return {
        name: 'Pedas',
        sort_order: Math.max(1, Math.min(4, levelVal))
      };
    }
    return null;
  }

  function setOwnerMasterMenuSpiceLevel(pos) {
    var val = Math.max(1, Math.min(4, Number(pos) || 1));
    var valInput = $('cm-spice-level-val');
    if (valInput) valInput.value = String(val);
    var dots = document.querySelectorAll('#cm-spice-dots-row .x-spice-dot-btn');
    dots.forEach(function(dot) {
      var p = Number(dot.dataset.spicePos);
      var active = p <= val;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-checked', p === val ? 'true' : 'false');
    });
    renderOwnerMasterMenuPreview();
  }

  // Menu Presentation Media state — scoped to the Master Menu editor.
  // The Menu owns its customer-facing photo (docs/decisions/xentra-menu-presentation-media-v1.md).
  // The file stays in memory until the Menu save pipeline uploads it.
  var _masterMenuImageFile = null;
  var _masterMenuCropSpec = null;
  var _masterMenuImageRemoved = false;
  var _masterMenuImagePreviewSrc = '';

  function setOwnerMasterMenuImagePreview(src, hasImage) {
    var previewImg = $('cm-image-preview');
    var emptyBox = $('cm-image-empty');
    var btnRemove = $('btn-cm-image-remove');
    var btnPick = $('btn-cm-image-pick');
    if (!previewImg || !emptyBox) return;
    if (hasImage && src) {
      previewImg.src = src;
      previewImg.style.display = 'block';
      emptyBox.style.display = 'none';
      if (btnRemove) btnRemove.style.display = 'inline-block';
      if (btnPick) btnPick.textContent = '\ud83d\udcc1 Ganti Foto';
    } else {
      previewImg.removeAttribute('src');
      previewImg.style.display = 'none';
      emptyBox.style.display = 'flex';
      if (btnRemove) btnRemove.style.display = 'none';
      if (btnPick) btnPick.textContent = '\ud83d\udcc1 Pilih Foto';
    }
  }

  function resetOwnerMasterMenuImageState(existingSrc) {
    _masterMenuImageFile = null;
    _masterMenuCropSpec = null;
    _masterMenuImageRemoved = false;
    _masterMenuImagePreviewSrc = existingSrc || '';
    var fileInput = $('cm-image-file');
    if (fileInput) fileInput.value = '';
    var removedFlag = $('cm-image-removed');
    if (removedFlag) removedFlag.value = '0';
    setOwnerMasterMenuImagePreview(_masterMenuImagePreviewSrc, !!_masterMenuImagePreviewSrc);
  }

  function renderOwnerMasterMenuPreview() {
    var titleEl = $('cm-preview-title');
    var subtitleEl = $('cm-preview-subtitle');
    var detailEl = $('cm-preview-detail');
    var indicatorEl = $('cm-preview-indicator');
    var priceEl = $('cm-preview-price');
    var imageEl = $('cm-preview-image');
    var emptyEl = $('cm-preview-image-empty');
    if (!titleEl || !subtitleEl || !detailEl || !priceEl) return;

    var titleObj = ownerMasterMenuSelectedTitle();
    var rasa = ownerMasterMenuSelectedRasa();
    var rasaLabel = rasa ? ownerMasterMenuRasaLabel(rasa.name) : '';
    var levelName = '';
    var levelPosition = 0;
    var selectedLevel = ownerMasterMenuSelectedLevel();
    if (selectedLevel) {
      levelName = String(selectedLevel.name || '');
      levelPosition = Number(selectedLevel.sort_order);
      if (!Number.isFinite(levelPosition) || levelPosition < 1) levelPosition = 1;
      levelPosition = Math.min(4, Math.floor(levelPosition));
    }
    var detail = '';
    var image = '';
    var title = '';

    if (titleObj) {
      title = titleObj.name;
    } else {
      title = String(($('cm-package-name') && $('cm-package-name').value) || '').trim() || 'Pilih Judul Menu';
    }

    var items = (_ownerMasterMenuState.menuItems && _ownerMasterMenuState.menuItems.length)
      ? _ownerMasterMenuState.menuItems
      : (_ownerMasterMenuState.packageComponents || []);

    if (items.length > 0) {
      detail = items.map(function(item) {
        var product = ownerMasterMenuFindProduct(item.product_id);
        if (!product) return null;
        var qty = Number(item.quantity || 1);
        return product.name + (qty > 1 ? ' × ' + qty : '');
      }).filter(Boolean).join(' · ');
    } else {
      var singleProd = ownerMasterMenuFindProduct($('cm-product') && $('cm-product').value);
      if (singleProd) detail = 'Item: ' + singleProd.name;
    }

    image = _masterMenuImagePreviewSrc || '';

    titleEl.textContent = title;
    subtitleEl.textContent = rasaLabel;
    detailEl.textContent = detail;
    priceEl.textContent = formatMoney(getOwnerMasterMenuMoney('cm-price') || 0);

    if (imageEl && emptyEl) {
      if (image) {
        imageEl.src = image;
        imageEl.alt = title;
        imageEl.style.display = 'block';
        emptyEl.style.display = 'none';
      } else {
        imageEl.removeAttribute('src');
        imageEl.alt = '';
        imageEl.style.display = 'none';
        emptyEl.style.display = 'inline-flex';
      }
    }

    // Hitung akumulasi modal menu otomatis dari items: (item 1 + item 2 + ...)
    var totalCost = 0;
    var formulaParts = [];
    var hppRowsHtml = '';
    var previewItemsArr = [];

    if (items.length > 0) {
      items.forEach(function(item, idx) {
        var product = ownerMasterMenuFindProduct(item.product_id);
        if (!product) return;
        var qty = Math.max(1, parseInt(item.quantity, 10) || 1);
        var itemCost = Number(product.cost_price || 0);
        var subTotal = itemCost * qty;
        totalCost += subTotal;

        var partText = esc(product.name) + ' (' + formatMoney(itemCost) + (qty > 1 ? ' × ' + qty : '') + ')';
        formulaParts.push(partText);
        previewItemsArr.push(esc(product.name) + (qty > 1 ? ' (' + qty + ')' : ''));

        hppRowsHtml += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">' +
          '<span style="color:#0F172A;font-weight:500;">' + esc(product.name) + (qty > 1 ? ' <span style="color:#64748B;">(' + qty + 'x)</span>' : '') + '</span>' +
          '<span style="color:#0F172A;font-weight:600;">' + formatMoney(subTotal) + '</span>' +
        '</div>';
      });
    }

    setOwnerMasterMenuMoney('cm-cost', totalCost);
    var costDisplayEl = $('cm-cost-display');
    var costFormulaEl = $('cm-cost-formula');
    if (costDisplayEl) costDisplayEl.textContent = formatMoney(totalCost);
    if (costFormulaEl) {
      if (formulaParts.length > 0) {
        costFormulaEl.innerHTML = formulaParts.join(' + ') + ' = <strong>' + formatMoney(totalCost) + '</strong>';
      } else {
        costFormulaEl.textContent = 'Belum ada item dipilih';
      }
    }

    var hppListEl = $('cm-hpp-items-list');
    var hppTotalEl = $('cm-hpp-total-display');
    if (hppListEl) {
      if (hppRowsHtml) {
        hppListEl.innerHTML = hppRowsHtml;
      } else {
        hppListEl.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#94A3B8;"><span>item 1</span><span>Rp0</span></div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#94A3B8;"><span>item 2</span><span>Rp0</span></div>' +
          '<div style="font-size:12px;color:#CBD5E1;margin-top:-2px;">dst.</div>';
      }
    }
    if (hppTotalEl) {
      hppTotalEl.textContent = formatMoney(totalCost);
    }

    // Sinkronisasi status visual tombol Simpan (aktif hijau saat valid, abu-abu saat belum)
    var btnSaveActive = $('btn-save-master-menu-active');
    if (btnSaveActive) {
      var isTitleValid = !!(titleObj || ($('cm-title-input') && $('cm-title-input').value.trim()));
      var isCatValid = !!($('cm-category') && $('cm-category').value);
      var isPriceValid = (getOwnerMasterMenuMoney('cm-price') > 0) || (getOwnerMasterMenuMoney('cm-price-min') > 0 && getOwnerMasterMenuMoney('cm-price-max') > 0);
      var isFormReady = isTitleValid && isCatValid && isPriceValid;
      if (isFormReady) {
        btnSaveActive.style.background = '#059669';
        btnSaveActive.style.color = '#FFFFFF';
        btnSaveActive.style.boxShadow = '0 2px 6px rgba(5,150,105,0.2)';
      } else {
        btnSaveActive.style.background = '#F1F5F9';
        btnSaveActive.style.color = '#94A3B8';
        btnSaveActive.style.boxShadow = 'none';
      }
    }

    var previewItemsEl = $('cm-preview-items-list');
    if (previewItemsEl) {
      previewItemsEl.textContent = previewItemsArr.length > 0 ? previewItemsArr.join(' · ') : 'list item dalam menu';
    }

    if (indicatorEl) {
      if (levelPosition > 0) {
        var indicatorHtml = '<span class="x-master-customer-preview-spice-label">Pedas</span>' +
          '<span class="x-master-customer-preview-spice-dots" aria-label="Level Pedas ' + levelPosition + ' dari 4">';
        for (var levelIndex = 1; levelIndex <= 4; levelIndex += 1) {
          indicatorHtml += '<span class="x-master-customer-preview-spice-dot' + (levelIndex <= levelPosition ? ' is-filled' : '') + '" aria-hidden="true"></span>';
        }
        indicatorHtml += '</span>';
        indicatorEl.innerHTML = indicatorHtml;
      } else {
        indicatorEl.innerHTML = '';
      }
    }
  }

  async function loadOwnerMasterMenuReferences() {
    var headers = getAuthHeaders();
    var results = await Promise.all([
      adminFetch(API_BASE + '/admin/composed/products?active_only=1', { headers: headers }).then(function(res){ return res.json(); }),
      adminFetch(API_BASE + '/admin/categories', { headers: headers }).then(function(res){ return res.json(); }),
      adminFetch(API_BASE + '/admin/rasas', { headers: headers }).then(function(res){ return res.json(); }),
      adminFetch(API_BASE + '/admin/menu-titles', { headers: headers }).then(function(res){ return res.json(); }).catch(function(){ return { success: true, titles: [] }; })
    ]);

    var productData = results[0] || {};
    var categoryData = results[1] || {};
    var rasaData = results[2] || {};
    var titleData = results[3] || {};

    if (!productData.success) throw new Error(productData.error || 'Produk Master gagal dimuat.');
    if (!categoryData.success) throw new Error(categoryData.error || 'Kategori gagal dimuat.');
    if (!rasaData.success) throw new Error(rasaData.error || 'Rasa gagal dimuat.');

    _ownerMasterMenuState.products = productData.products || [];
    _ownerMasterMenuState.categories = categoryData.categories || [];
    _ownerMasterMenuState.rasas = rasaData.rasas || [];
    _ownerMasterMenuState.titles = titleData.titles || [];
  }

  async function loadOwnerMasterMenus() {
    try {
      var res = await adminFetch(API_BASE + '/admin/menus', { headers: getAuthHeaders() });
      var data = await res.json();
      if (!data.success) throw new Error(data.error || 'Menu Master gagal dimuat.');
      _ownerMasterMenuState.menus = data.menus || [];
      renderOwnerMasterMenuList();
    } catch (err) {
      console.error('[Owner Master Menu Load Error]:', err);
      var box = $('master-menu-list');
      if (box) box.innerHTML = '<div class="x-empty-state text-muted">Gagal memuat Menu Master.</div>';
    }
  }

  function renderOwnerMasterMenuList() {
    var box = $('master-menu-list');
    if (!box) return;
    var query = String(_ownerMasterMenuState.search || '').trim().toLowerCase();
    var filter = String(_ownerMasterMenuState.typeFilter || 'all').toUpperCase();

    var menus = (_ownerMasterMenuState.menus || []).filter(function(menu) {
      var hay = [
        ownerMasterMenuTitle(menu),
        menu.sub_category_name || '',
        menu.category_name || '',
        menu.rasa_name || ''
      ].join(' ').toLowerCase();
      return (!query || hay.indexOf(query) !== -1) &&
        (filter === 'ALL' || String(menu.menu_type).toUpperCase() === filter);
    });

    if (!menus.length) {
      box.innerHTML = '<div class="x-empty-state text-center py-6 text-muted">Belum ada Menu Master yang cocok.</div>';
      return;
    }

    box.innerHTML = menus.map(function(menu) {
      var type = String(menu.menu_type || '').toUpperCase();
      var title = ownerMasterMenuTitle(menu);
      var rasa = ownerMasterMenuRasaLabel(menu.rasa_name);
      var status = String(menu.status || 'DRAFT').toUpperCase();
      var typeLabel = type === 'PACKAGE' ? 'Paket' : 'Satuan';
      var statusClass = status === 'ACTIVE' ? 'x-badge-success' : (status === 'ARCHIVED' ? 'x-badge-warning' : 'x-badge-info');
      var taxonomy = [menu.category_name, menu.sub_category_name].filter(Boolean).join(' › ');
      // Thumbnail foto Menu (bukan foto Product), supaya Owner langsung melihat mana yang belum ada foto.
      var thumb = menu.image_url || menu.image || '';
      var thumbHtml = thumb
        ? '<img class="x-master-menu-card-thumb" src="' + esc(thumb) + '" alt="' + esc(title) + '" loading="lazy" decoding="async">'
        : '<span class="x-master-menu-card-thumb x-master-menu-card-thumb-empty" aria-hidden="true"></span>';
      var isActive = status === 'ACTIVE';
      var itemsList = (menu.components || []).map(function(c) {
        var pName = c.product_name;
        if (!pName) {
          var p = ownerMasterMenuFindProduct(c.product_id);
          pName = p ? p.name : '';
        }
        if (!pName) return '';
        var q = Number(c.quantity || 1);
        return pName + (q > 1 ? ' × ' + q : '');
      }).filter(Boolean).join(', ');

      return '<article class="x-master-menu-card" tabindex="0" role="button" aria-label="Buka editor menu ' + esc(title) + '" onclick="if (!event.target.closest(\'.x-toggle, .x-action-menu-trigger, .x-action-menu\')) { openEditOwnerMasterMenu(\'' + esc(menu.id) + '\'); }" onkeydown="if ((event.key === \'Enter\' || event.key === \' \') && !event.target.closest(\'.x-toggle, .x-action-menu-trigger, .x-action-menu\')) { event.preventDefault(); openEditOwnerMasterMenu(\'' + esc(menu.id) + '\'); }">' +
        '<div class="x-master-menu-card-left">' +
          thumbHtml +
          '<div class="x-master-menu-card-content">' +
            '<h4 class="x-master-menu-card-title">' + esc(title) + '</h4>' +
            (rasa ? '<div class="x-master-menu-card-rasa">' + esc(rasa) + '</div>' : '') +
            (itemsList ? '<div class="x-master-menu-card-items" title="' + esc(itemsList) + '">' + esc(itemsList) + '</div>' : '') +
            '<div class="x-master-menu-card-price">' + formatMoney(menu.selling_price) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="x-master-menu-card-right">' +
          '<div class="x-master-menu-card-right-top">' +
            '<label class="x-toggle' + (isActive ? ' x-toggle-on' : '') + '" title="' + (isActive ? 'Menu aktif (klik untuk nonaktifkan/arsipkan)' : 'Menu nonaktif (klik untuk aktifkan)') + '" style="margin:0;">' +
              '<input type="checkbox" ' + (isActive ? 'checked' : '') + ' onchange="toggleOwnerMasterMenuStatus(\'' + esc(menu.id) + '\', this)" aria-label="Status menu ' + esc(title) + '">' +
              '<span class="x-toggle-slider"></span>' +
            '</label>' +
          '</div>' +
          '<div class="x-master-menu-card-right-bottom">' +
            '<button type="button" class="x-action-menu-trigger x-master-menu-card-option-btn" aria-label="Aksi menu ' + esc(title) + '" onclick="XentraActionMenu.open(this, [' +
              '{ label: \'Edit\', icon: \'✏️\', onClick: function() { openEditOwnerMasterMenu(\'' + esc(menu.id) + '\'); } },' +
              '{ divider: true },' +
              '{ label: \'Hapus\', icon: \'🗑️\', destructive: true, onClick: function() { deleteOwnerMasterMenu(\'' + esc(menu.id) + '\', \'' + esc(title).replace(/'/g, "\\'") + '\'); } }' +
            '])">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  async function loadOwnerMasterMenuEditor(menuId) {
    showOwnerMasterMenuEditor();

    if (!menuId) {
      ownerMasterMenuResetEditor(_ownerMasterMenuState.createType);
      try {
        await loadOwnerMasterMenuReferences();
        if (_ownerMasterMenuState.preselectedProductId) {
          var preId = String(_ownerMasterMenuState.preselectedProductId);
          _ownerMasterMenuState.menuItems = [{ product_id: preId, quantity: 1 }];
          _ownerMasterMenuState.packageComponents = [{ product_id: preId, quantity: 1 }];
          if ($('cm-product')) $('cm-product').value = preId;
          _ownerMasterMenuState.preselectedProductId = null;
        } else {
          _ownerMasterMenuState.menuItems = [{ product_id: '', quantity: 1 }];
          _ownerMasterMenuState.packageComponents = [{ product_id: '', quantity: 1 }];
        }
        renderOwnerMasterMenuEditorForm();
      } catch (err) {
        console.error('[Owner Master Menu References Error]:', err);
        showToast('⚠️ Referensi Menu Master belum tersedia.');
      }
      return;
    }

    try {
      await loadOwnerMasterMenuReferences();
      var res = await adminFetch(API_BASE + '/admin/menus/' + encodeURIComponent(menuId), { headers: getAuthHeaders() });
      var data = await res.json();
      if (!data.success || !data.menu) throw new Error(data.error || 'Menu tidak ditemukan.');

      var menu = data.menu;
      var type = String(menu.menu_type || 'SINGLE').toUpperCase() === 'PACKAGE' ? 'PACKAGE' : 'SINGLE';
      _ownerMasterMenuState.editingId = menu.id;
      _ownerMasterMenuState.editingType = type;
      _ownerMasterMenuState.createType = type;
      _ownerMasterMenuState.menuItems = (menu.components || []).map(function(item) {
        return { product_id: String(item.product_id), quantity: Number(item.quantity) };
      });
      _ownerMasterMenuState.packageComponents = (menu.components || []).map(function(item) {
        return { product_id: String(item.product_id), quantity: Number(item.quantity) };
      });

      $('master-menu-id').value = String(menu.id);
      $('master-menu-type').value = type;
      if ($('cm-product')) $('cm-product').value = menu.components && menu.components[0] ? String(menu.components[0].product_id) : '';
      if ($('cm-package-name')) $('cm-package-name').value = menu.package_name || '';
      if ($('cm-category')) $('cm-category').value = menu.category_id ? String(menu.category_id) : '';
      if ($('cm-title')) $('cm-title').value = menu.title_id ? String(menu.title_id) : '';
      if ($('cm-rasa')) $('cm-rasa').value = menu.rasa_id ? String(menu.rasa_id) : '';
      setOwnerMasterMenuMoney('cm-price', menu.selling_price != null ? menu.selling_price : '');
      setOwnerMasterMenuMoney('cm-cost', menu.cost_price != null ? menu.cost_price : '');
      if ($('cm-status')) $('cm-status').value = String(menu.status || 'DRAFT').toUpperCase();

      var spiceToggle = $('cm-spice-toggle');
      var spiceWrapper = $('cm-spice-scale-wrapper');
      var spiceEnabled = Number(menu.spice_enabled) === 1 || Boolean(menu.spice_level) || (menu.level && menu.level.value > 0);
      var spiceLevel = menu.spice_level ? Number(menu.spice_level) : (menu.level && menu.level.value ? Number(menu.level.value) : 1);
      if (spiceToggle) {
        spiceToggle.checked = spiceEnabled;
        if (spiceWrapper) spiceWrapper.style.display = spiceEnabled ? 'inline-flex' : 'none';
        if (spiceEnabled) setOwnerMasterMenuSpiceLevel(spiceLevel);
      }

      $('master-menu-editor-title').textContent = 'Edit Menu';
      $('master-menu-editor-breadcrumb').textContent = ownerMasterMenuTitle(menu);
      $('master-menu-editor-mobile-title').textContent = 'Edit Menu';
      $('master-menu-editor-mobile-subtitle').textContent = 'Perbarui Judul, Kategori, Komposisi Item, Harga, dan Status.';

      var categoryVal = menu.category_id || (menu.category && menu.category.id) || '';
      var titleVal = menu.title_id || (menu.title_ref && menu.title_ref.id) || '';
      var rasaVal = menu.rasa_id || (menu.rasa && menu.rasa.id) || '';
      var priceVal = menu.selling_price != null ? menu.selling_price : (menu.price != null ? menu.price : '');
      var costVal = menu.cost_price != null ? menu.cost_price : '';

      renderOwnerMasterMenuEditorForm();
      if ($('cm-category')) $('cm-category').value = String(categoryVal);
      if ($('cm-title')) $('cm-title').value = String(titleVal);
      var titleInputEl = $('cm-title-input');
      var titleName = menu.title_name || (menu.title_ref && menu.title_ref.name) || menu.package_name || '';
      if (titleInputEl) {
        titleInputEl.value = titleName;
        var countEl = $('cm-title-char-count');
        if (countEl) countEl.textContent = titleName.length;
      }
      if ($('cm-rasa')) $('cm-rasa').value = String(rasaVal);
      setOwnerMasterMenuMoney('cm-price', priceVal);
      setOwnerMasterMenuMoney('cm-cost', costVal);
      var statusUpper = String(menu.status || 'DRAFT').toUpperCase();
      if ($('cm-status')) $('cm-status').value = statusUpper;
      var activeToggle = $('cm-toggle-active');
      if (activeToggle) activeToggle.checked = statusUpper === 'ACTIVE';

      resetOwnerMasterMenuImageState(menu.image_url || menu.preview_url || menu.image || '');
      renderOwnerMasterMenuItems();
      renderOwnerMasterMenuPackageComponents();
      renderOwnerMasterMenuPreview();
    } catch (err) {
      console.error('[Owner Master Menu Editor Load Error]:', err);
      showToast('❌ ' + (err.message || 'Gagal memuat Menu Master.'));
      navigateTo('catalog/master-menus');
    }
  }

  async function saveOwnerMasterMenu(statusOverride) {
    var menuId = String(($('master-menu-id') && $('master-menu-id').value) || '');
    var activeToggle = $('cm-toggle-active');
    var isToggleActive = activeToggle ? activeToggle.checked : true;
    var status = statusOverride || (isToggleActive ? 'ACTIVE' : 'DRAFT');
    var price = getOwnerMasterMenuMoney('cm-price');
    if (!Number.isFinite(price) || price < 0) {
      showToast('❌ Harga Menu tidak valid.');
      return;
    }
    var cost = getOwnerMasterMenuMoney('cm-cost');
    if (!Number.isFinite(cost)) cost = 0;
    if (!Number.isFinite(cost) || cost < 0) {
      showToast('❌ Modal Menu tidak valid.');
      return;
    }

    var categoryId = String(($('cm-category') && $('cm-category').value) || '') || null;
    var titleId = String(($('cm-title') && $('cm-title').value) || '') || null;
    var titleInputText = String(($('cm-title-input') && $('cm-title-input').value) || '').trim();
    var rasaId = String(($('cm-rasa') && $('cm-rasa').value) || '') || null;

    var spiceToggle = $('cm-spice-toggle');
    var spiceEnabled = spiceToggle ? spiceToggle.checked : false;
    var spiceLevel = spiceEnabled ? Number(($('cm-spice-level-val') && $('cm-spice-level-val').value) || 1) : null;

    if (!categoryId) {
      showToast('❌ Kategori wajib dipilih.');
      return;
    }

    if (!titleId && !titleInputText) {
      showToast('❌ Judul Menu wajib diisi.');
      return;
    }

    // Auto-create title if titleId starts with 'custom:' or is empty but titleInputText is present
    if (!titleId || titleId.indexOf('custom:') === 0) {
      var nameToCreate = titleInputText || (titleId ? titleId.replace('custom:', '') : '');
      if (nameToCreate) {
        var existingT = (_ownerMasterMenuState.titles || []).find(function(t) {
          return (t.name || '').trim().toLowerCase() === nameToCreate.toLowerCase();
        });
        if (existingT) {
          titleId = String(existingT.id);
        } else {
          try {
            var tRes = await adminFetch(API_BASE + '/admin/menu-titles', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify({ name: nameToCreate })
            });
            var tData = await tRes.json();
            if (tData.success && tData.title) {
              titleId = String(tData.title.id);
              _ownerMasterMenuState.titles.push(tData.title);
            }
          } catch (e) {
            console.warn('[Auto Title Error]:', e);
          }
        }
      }
    }

    if (!titleId) {
      showToast('❌ Judul Menu wajib dipilih.');
      return;
    }

    // Collect items composition directly from DOM rows first, falling back to state
    var itemsList = [];
    var itemsBox = $('cm-items-container');
    if (itemsBox) {
      var domRows = itemsBox.querySelectorAll('[data-cm-item-index]');
      if (domRows && domRows.length > 0) {
        domRows.forEach(function(row) {
          var sel = row.querySelector('[data-cm-item-product]');
          var txt = row.querySelector('.x-cm-combobox-input');
          var qtyInput = row.querySelector('[data-cm-item-qty]');
          var prodId = (sel && sel.value) ? String(sel.value).trim() : '';
          if (!prodId && txt && txt.value.trim()) {
            var query = txt.value.trim().toLowerCase();
            var matched = _ownerMasterMenuState.products.find(function(p) {
              var active = p.is_active !== 0 && p.is_active !== false;
              return active && (p.name || '').trim().toLowerCase() === query;
            }) || _ownerMasterMenuState.products.find(function(p) {
              var active = p.is_active !== 0 && p.is_active !== false;
              return active && (p.name || '').toLowerCase().includes(query);
            });
            if (matched) prodId = String(matched.id);
          }
          var qty = qtyInput ? (parseInt(qtyInput.value, 10) || 1) : 1;
          if (prodId) {
            itemsList.push({ product_id: prodId, quantity: qty });
          }
        });
      }
    }

    if (!itemsList.length) {
      itemsList = (_ownerMasterMenuState.menuItems && _ownerMasterMenuState.menuItems.length)
        ? _ownerMasterMenuState.menuItems
        : (_ownerMasterMenuState.packageComponents || []);
    }
    if (!itemsList.length && $('cm-product') && $('cm-product').value) {
      itemsList = [{ product_id: $('cm-product').value, quantity: 1 }];
    }

    var seen = {};
    var validItems = [];
    for (var i = 0; i < itemsList.length; i++) {
      var item = itemsList[i];
      var pId = String(item.product_id || '').trim();
      var qty = Number(item.quantity);
      if (!pId) continue;
      if (!Number.isSafeInteger(qty) || qty <= 0) {
        showToast('❌ Qty Item harus bilangan bulat positif.');
        return;
      }
      if (seen[pId]) {
        showToast('❌ Satu Item tidak boleh muncul dua kali dalam Menu.');
        return;
      }
      seen[pId] = true;
      validItems.push({ product_id: pId, quantity: qty });
    }

    if (validItems.length === 0) {
      showToast('❌ Minimal 1 Item harus dipilih untuk Menu.');
      return;
    }

    try {
      var endpoint = menuId ? API_BASE + '/admin/menus/' + encodeURIComponent(menuId) : API_BASE + '/admin/menus';
      var method = menuId ? 'PUT' : 'POST';
      var payload = {
        category_id: categoryId,
        title_id: titleId,
        rasa_id: rasaId,
        spice_enabled: spiceEnabled,
        spice_level: spiceLevel,
        selling_price: price,
        cost_price: cost,
        items: validItems,
        status: status
      };

      var res = await adminFetch(endpoint, {
        method: method,
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Gagal menyimpan Menu Master.');

      // Foto Menu diproses SETELAH Menu tersimpan, memakai canonical Media Engine
      // (docs/decisions/xentra-menu-presentation-media-v1.md).
      var savedMenuId = (data.menu && data.menu.id) || menuId;
      if (!savedMenuId) {
        showToast('❌ Menu tersimpan tetapi ID Menu tidak kembali dari server.');
        return;
      }

      if (_masterMenuImageRemoved) {
        var removeRes = await adminFetch(API_BASE + '/admin/media/entity/menus/' + encodeURIComponent(savedMenuId) + '/image', {
          method: 'DELETE',
          headers: getAuthHeaders()
        });
        var removeData = {};
        try {
          removeData = await removeRes.json();
        } catch (_) {
          removeData = { success: false, error: 'Gagal membaca respons penghapusan foto Menu (HTTP ' + removeRes.status + ').' };
        }
        if (!removeRes.ok || !removeData.success) {
          showToast('❌ ' + (removeData.error || removeData.message || 'Gagal menghapus foto Menu.'));
          return;
        }
      }

      if (_masterMenuImageFile && !_masterMenuImageRemoved) {
        var menuImageBase64 = await new Promise(function(resolve, reject) {
          var menuImgReader = new FileReader();
          menuImgReader.onload = function() { resolve(menuImgReader.result); };
          menuImgReader.onerror = function() { reject(new Error('Gagal membaca file gambar.')); };
          menuImgReader.readAsDataURL(_masterMenuImageFile);
        });

        var menuImagePayload = {
          image_base64: menuImageBase64,
          mime_type: _masterMenuImageFile.type,
          original_filename: _masterMenuImageFile.name || null
        };
        if (_masterMenuCropSpec) menuImagePayload.crop_spec = _masterMenuCropSpec;

        var menuImageRes = await adminFetch(API_BASE + '/admin/media/entity/menus/' + encodeURIComponent(savedMenuId) + '/image', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(menuImagePayload)
        });
        var menuImageData = {};
        try {
          menuImageData = await menuImageRes.json();
        } catch (_) {
          menuImageData = { success: false, error: 'Upload foto Menu gagal (HTTP ' + menuImageRes.status + ').' };
        }
        if (!menuImageRes.ok || !menuImageData.success) {
          showToast('❌ ' + (menuImageData.error || menuImageData.message || 'Menu tersimpan, tetapi foto Menu gagal diunggah.'));
          return;
        }
      }

      showToast(status === 'ACTIVE' ? '✅ Menu Master aktif.' : '✅ Menu Master tersimpan sebagai draft.');
      navigateTo('catalog/master-menus', { history: 'replace' });
    } catch (err) {
      console.error('[Owner Master Menu Save Error]:', err);
      showToast('❌ ' + (err.message || 'Gagal menyimpan Menu Master.'));
    }
  }

  async function setOwnerMasterMenuStatus(id, status) {
    try {
      var res = await adminFetch(API_BASE + '/admin/menus/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: status })
      });
      var data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Gagal mengubah status Menu Master.');
      showToast('✅ Status Menu Master diperbarui.');
      loadOwnerMasterMenus();
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal mengubah status Menu Master.'));
    }
  }

  function openNewOwnerMasterMenu(type) {
    _ownerMasterMenuState.createType = type === 'PACKAGE' ? 'PACKAGE' : 'SINGLE';
    navigateTo('catalog/master-menus/new');
  }

  function openMenuTypeSheet() {
    document.body.classList.add('x-sheet-open');
    var overlay = $('sheet-menu-type-overlay');
    var sheet = $('sheet-menu-type');
    var extClose = $('sheet-menu-type-ext-close');

    if (overlay) {
      overlay.style.display = 'block';
      setTimeout(function () { overlay.classList.add('open'); }, 10);
    }
    if (sheet) {
      sheet.style.display = 'block';
      setTimeout(function () {
        sheet.classList.add('open');
        if (extClose) {
          var sheetH = sheet.offsetHeight || 280;
          extClose.style.bottom = (sheetH + 12) + 'px';
          extClose.classList.add('open');
        }
      }, 10);
    }
  }

  function closeMenuTypeSheet() {
    document.body.classList.remove('x-sheet-open');
    var extClose = $('sheet-menu-type-ext-close');
    var overlay = $('sheet-menu-type-overlay');
    var sheet = $('sheet-menu-type');

    if (extClose) extClose.classList.remove('open');
    if (overlay) {
      overlay.classList.remove('open');
      setTimeout(function () { overlay.style.display = 'none'; }, 260);
    }
    if (sheet) {
      sheet.classList.remove('open');
      setTimeout(function () { sheet.style.display = 'none'; }, 280);
    }
  }

  function selectMenuTypeAndProceed(type) {
    closeMenuTypeSheet();
    openNewOwnerMasterMenu(type);
  }

  window.openMenuTypeSheet = openMenuTypeSheet;
  window.closeMenuTypeSheet = closeMenuTypeSheet;
  window.selectMenuTypeAndProceed = selectMenuTypeAndProceed;

  window.XentraOwnerMasterMenu = {
    upsertDependency: upsertOwnerMasterMenuDependency,
    addPackageProduct: addOwnerMasterMenuPackageProduct
  };

  window.createMenuFromProduct = function(productId) {
    if (!productId) return;
    _ownerMasterMenuState.preselectedProductId = productId;
    _ownerMasterMenuState.createType = 'SINGLE';
    navigateTo('catalog/master-menus/new');
  };
  window.openAddMasterMenuSingle = function() {
    openNewOwnerMasterMenu('SINGLE');
  };
  window.openAddMasterMenuPackage = function() {
    openNewOwnerMasterMenu('PACKAGE');
  };
  async function toggleOwnerMasterMenuStatus(id, inputEl) {
    var nextActive = inputEl && inputEl.checked;
    var nextStatus = nextActive ? 'ACTIVE' : 'ARCHIVED';
    try {
      var res = await adminFetch(API_BASE + '/admin/menus/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: nextStatus })
      });
      var data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Gagal mengubah status Menu Master.');
      showToast('✅ Menu ' + (nextActive ? 'diaktifkan' : 'dinonaktifkan / diarsipkan') + '.');
      loadOwnerMasterMenus();
    } catch (err) {
      if (inputEl) inputEl.checked = !nextActive;
      showToast('❌ ' + (err.message || 'Gagal mengubah status Menu Master.'));
    }
  }

  async function deleteOwnerMasterMenu(id, menuName) {
    var title = menuName || 'Menu';
    var actionLabel = 'Hapus permanen';
    var actionMessage = 'Hapus permanen menu "' + title + '"? Tindakan ini TIDAK dapat dibatalkan.';
    var confirmed = false;
    if (window.XentraPresentation && typeof window.XentraPresentation.confirm === 'function') {
      confirmed = await window.XentraPresentation.confirm({
        id: 'delete-master-menu',
        title: actionLabel + ' Menu',
        message: actionMessage,
        okLabel: actionLabel,
        cancelLabel: 'Batal'
      });
    } else {
      confirmed = await confirmFeatureAction('delete-master-menu', actionLabel + ' Menu', actionMessage, actionLabel);
    }
    if (!confirmed) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/menus/' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Gagal menghapus Menu Master.');
      showToast('✅ Menu "' + title + '" berhasil dihapus permanen.');
      loadOwnerMasterMenus();
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal menghapus Menu Master.'));
    }
  }

  window.toggleOwnerMasterMenuStatus = toggleOwnerMasterMenuStatus;
  window.deleteOwnerMasterMenu = deleteOwnerMasterMenu;
  window.setOwnerMasterMenuStatus = setOwnerMasterMenuStatus;
  window.openEditOwnerMasterMenu = function(id) {
    if (id) navigateTo('catalog/master-menus/' + encodeURIComponent(id) + '/edit');
  };

  function initOwnerMasterMenuUI() {
    var addSingle = $('btn-add-master-menu-single');
    var addPackage = $('btn-add-master-menu-package');
    var search = $('master-menu-search');
    var typeFilter = $('master-menu-type-filter');
    var category = $('cm-category');
    var product = $('cm-product');
    var rasa = $('cm-rasa');
    var packageName = $('cm-package-name');
    var price = $('cm-price');
    var form = $('form-master-menu');
    var saveDraft = $('btn-save-master-menu-draft');
    var addComponent = $('btn-cm-add-component');

    // Foto Menu — pick → shared crop editor (1:1) → canonical entity media pipeline.
    // Menu owns its customer-facing photo, independent from Product photos.
    var menuImagePick = $('btn-cm-image-pick');
    var menuImageFile = $('cm-image-file');
    var menuImageRemove = $('btn-cm-image-remove');
    if (menuImagePick && menuImageFile) {
      menuImagePick.addEventListener('click', function() { menuImageFile.click(); });
      menuImageFile.addEventListener('change', function() {
        var file = menuImageFile.files && menuImageFile.files[0];
        if (!file) { _masterMenuImageFile = null; _masterMenuCropSpec = null; return; }
        _masterMenuImageRemoved = false;
        _masterMenuCropSpec = null;

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.');
          menuImageFile.value = '';
          return;
        }
        if (file.size > 20 * 1024 * 1024) {
          showToast('❌ Ukuran gambar melebihi batas maksimal 20MB.');
          menuImageFile.value = '';
          return;
        }

        _masterMenuImageFile = file;

        XentraCropEditor.open({
          source: file,
          assetType: 'menu',
          aspectRatio: 1.0,
          title: 'Potong & Posisikan Foto Menu (1:1)',
          onConfirm: function (cropSpec, previewDataUrl) {
            _masterMenuCropSpec = cropSpec;
            _masterMenuImagePreviewSrc = previewDataUrl || URL.createObjectURL(file);
            setOwnerMasterMenuImagePreview(_masterMenuImagePreviewSrc, true);
            renderOwnerMasterMenuPreview();
            showToast('✓ Potongan foto Menu disesuaikan.');
          },
          onCancel: function () {
            _masterMenuImageFile = null;
            _masterMenuCropSpec = null;
            if (menuImageFile) menuImageFile.value = '';
          }
        });
      });
    }

    if (menuImageRemove) {
      menuImageRemove.addEventListener('click', function() {
        _masterMenuImageFile = null;
        _masterMenuCropSpec = null;
        _masterMenuImageRemoved = true;
        _masterMenuImagePreviewSrc = '';
        if (menuImageFile) menuImageFile.value = '';
        var removedFlag = $('cm-image-removed');
        if (removedFlag) removedFlag.value = '1';
        setOwnerMasterMenuImagePreview('', false);
        renderOwnerMasterMenuPreview();
      });
    }

    var addMenu = $('btn-add-master-menu');
    if (addMenu) addMenu.addEventListener('click', function() { openNewOwnerMasterMenu('SINGLE'); });
    if (addSingle) addSingle.addEventListener('click', function() { openNewOwnerMasterMenu('SINGLE'); });
    if (addPackage) addPackage.addEventListener('click', function() { openNewOwnerMasterMenu('PACKAGE'); });

    var quickAddTitle = $('btn-quick-add-title');
    if (quickAddTitle) {
      quickAddTitle.addEventListener('click', function() {
        openMasterReferenceQuickAdd('title');
      });
    }

    var quickAddRasa = $('btn-quick-add-rasa');
    if (quickAddRasa) {
      quickAddRasa.addEventListener('click', function() {
        var inline = window.XentraOwnerMasterMenuInline;
        if (inline && typeof inline.createRasa === 'function') {
          inline.createRasa().catch(function(err) { showToast('❌ ' + (err.message || 'Gagal membuat Rasa.')); });
        } else {
          openMasterReferenceQuickAdd('flavor');
        }
      });
    }

    var addItemBtn = $('btn-cm-add-item');
    if (addItemBtn) addItemBtn.addEventListener('click', addOwnerMasterMenuItem);

    var spiceToggle = $('cm-spice-toggle');
    var spiceWrapper = $('cm-spice-scale-wrapper');
    if (spiceToggle) {
      spiceToggle.addEventListener('change', function() {
        var isChecked = spiceToggle.checked;
        if (spiceWrapper) spiceWrapper.style.display = isChecked ? 'inline-flex' : 'none';
        if (isChecked) {
          var curVal = Number(($('cm-spice-level-val') && $('cm-spice-level-val').value) || 1);
          setOwnerMasterMenuSpiceLevel(curVal || 1);
        } else {
          var valInput = $('cm-spice-level-val');
          if (valInput) valInput.value = '';
          renderOwnerMasterMenuPreview();
        }
      });
    }

    var spiceDots = document.querySelectorAll('#cm-spice-dots-row .x-spice-dot-btn');
    spiceDots.forEach(function(dot) {
      dot.addEventListener('click', function() {
        setOwnerMasterMenuSpiceLevel(dot.dataset.spicePos);
      });
    });

    if (search) search.addEventListener('input', function() {
      _ownerMasterMenuState.search = search.value || '';
      renderOwnerMasterMenuList();
    });

    if (typeFilter) typeFilter.querySelectorAll('[data-menu-filter]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        _ownerMasterMenuState.typeFilter = btn.dataset.menuFilter || 'all';
        typeFilter.querySelectorAll('[data-menu-filter]').forEach(function(other) {
          var active = other === btn;
          other.classList.toggle('active', active);
          other.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        renderOwnerMasterMenuList();
      });
    });

    var titleSelect = $('cm-title');
    var costInput = $('cm-cost');

    if (category) category.addEventListener('change', function() {
      renderOwnerMasterMenuPreview();
    });

    var titleInput = $('cm-title-input');
    if (titleInput) {
      titleInput.addEventListener('input', function() {
        var val = titleInput.value || '';
        var countEl = $('cm-title-char-count');
        if (countEl) countEl.textContent = val.length;

        var previewTitleEl = $('cm-preview-title');
        if (previewTitleEl) previewTitleEl.textContent = val.trim() || 'Judul Menu';

        // Auto-match or sync hidden #cm-title select
        if (titleSelect) {
          var matchedTitle = (_ownerMasterMenuState.titles || []).find(function(t) {
            return (t.name || '').trim().toLowerCase() === val.trim().toLowerCase();
          });
          if (matchedTitle) {
            titleSelect.value = String(matchedTitle.id);
          } else {
            // Check if matching option already exists
            var existingOpt = Array.from(titleSelect.options).find(function(opt) {
              return (opt.textContent || '').trim().toLowerCase() === val.trim().toLowerCase();
            });
            if (existingOpt) {
              titleSelect.value = existingOpt.value;
            } else if (val.trim()) {
              var newOpt = document.createElement('option');
              newOpt.value = 'custom:' + val.trim();
              newOpt.textContent = val.trim();
              titleSelect.appendChild(newOpt);
              titleSelect.value = newOpt.value;
            }
          }
        }
        renderOwnerMasterMenuPreview();
      });
    }

    var pickSearchInput = $('pick-item-search');
    if (pickSearchInput) {
      pickSearchInput.addEventListener('input', function() {
        renderPickItemList(pickSearchInput.value, _pickItemActiveCategory);
      });
    }

    var priceMinInput = $('cm-price-min');
    var priceMaxInput = $('cm-price-max');
    [priceMinInput, priceMaxInput].forEach(function(el) {
      if (!el) return;
      el.addEventListener('input', function() {
        var minVal = getOwnerMasterMenuMoney('cm-price-min') || 0;
        var maxVal = getOwnerMasterMenuMoney('cm-price-max') || 0;
        var previewPriceEl = $('cm-preview-price');
        if (previewPriceEl) {
          if (minVal > 0 && maxVal > 0) {
            previewPriceEl.textContent = formatMoney(minVal) + ' - ' + formatMoney(maxVal);
          } else if (minVal > 0) {
            previewPriceEl.textContent = formatMoney(minVal);
          } else if (maxVal > 0) {
            previewPriceEl.textContent = formatMoney(maxVal);
          } else {
            previewPriceEl.textContent = 'Rp0';
          }
        }
        renderOwnerMasterMenuPreview();
      });
    });

    [category, product, titleSelect, rasa, packageName, price, costInput].forEach(function(el) {
      if (!el) return;
      el.addEventListener('input', renderOwnerMasterMenuPreview);
      el.addEventListener('change', renderOwnerMasterMenuPreview);
    });

    if (addComponent) addComponent.addEventListener('click', addOwnerMasterMenuPackageComponent);
    if (form) form.addEventListener('submit', function(e) {
      e.preventDefault();
      saveOwnerMasterMenu('ACTIVE');
    });
    if (saveDraft) saveDraft.addEventListener('click', function() {
      saveOwnerMasterMenu('DRAFT');
    });

    var cancel = $('btn-cancel-master-menu');
    var desktopBack = $('btn-master-menu-editor-desktop-back');
    if (cancel) cancel.addEventListener('click', function() { navigateTo('catalog/master-menus'); });
    if (desktopBack) desktopBack.addEventListener('click', function() { goBackFromChildPage(); });
  }

  function switchPricePolicyMode(mode) {
    var fixedContainer = $('price-mode-fixed-container');
    var rangeContainer = $('price-mode-range-container');
    var tabFixed = $('tab-price-fixed');
    var tabRange = $('tab-price-range');

    if (mode === 'RANGE') {
      if (fixedContainer) fixedContainer.style.display = 'none';
      if (rangeContainer) rangeContainer.style.display = 'block';
      if (tabFixed) {
        tabFixed.style.color = '#94A3B8';
        tabFixed.style.borderBottom = '2px solid transparent';
      }
      if (tabRange) {
        tabRange.style.color = '#0F172A';
        tabRange.style.borderBottom = '2px solid #0F172A';
      }
    } else {
      if (fixedContainer) fixedContainer.style.display = 'block';
      if (rangeContainer) rangeContainer.style.display = 'none';
      if (tabFixed) {
        tabFixed.style.color = '#0F172A';
        tabFixed.style.borderBottom = '2px solid #0F172A';
      }
      if (tabRange) {
        tabRange.style.color = '#94A3B8';
        tabRange.style.borderBottom = '2px solid transparent';
      }
    }
  }
  window.switchPricePolicyMode = switchPricePolicyMode;


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
       ========================================================================= */
    var _activeSettingsSection = 'business/profile';

    function switchSettingsSection(sectionName, updateHash) {
      var validSections = [
        'business', 'business/profile', 'business/info', 'business/legal',
        'locations',
        'commerce', 'commerce/orders', 'commerce/payments', 'commerce/fulfillment',
        'channels', 'channels/website', 'channels/customer-app', 'channels/pos', 'channels/kiosk',
        'integrations',
        'notifications',
        'security',
        'data-refresh'
      ];

      var sec = sectionName;
      if (sec === 'business') sec = 'business/profile';
      if (sec === 'commerce') sec = 'commerce/orders';
      if (sec === 'channels') sec = 'channels/website';

      if (validSections.indexOf(sec) === -1) {
        sec = 'business/profile';
      }

      _activeSettingsSection = sec;

      // Update sidebar nav button active state
      document.querySelectorAll('.settings-nav-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.settingsSection === sec);
        if (btn.dataset.settingsSection === sec) {
          btn.style.background = '#f1f5f9';
          btn.style.color = 'var(--primary, #059669)';
        } else {
          btn.style.background = 'transparent';
          btn.style.color = '#334155';
        }
      });

      // Show the selected panel
      var panelId = 'settings-panel-' + sec.replace(/\//g, '-');
      document.querySelectorAll('.settings-panel').forEach(function (panel) {
        panel.style.display = panel.id === panelId ? 'block' : 'none';
      });

      if (updateHash !== false) {
        navigateTo('settings/' + sec);
      }

      loadSettingsCurrentSubtab();
    }
    window.switchSettingsSection = switchSettingsSection;

    function loadSettingsCurrentSubtab() {
      var sec = _activeSettingsSection;
      if (sec === 'business/profile') loadSettingsProfile();
      else if (sec === 'business/info') loadSettingsBusinessInfo();
      else if (sec === 'locations') loadSettingsLocations();
      else if (sec === 'commerce/orders') loadSettingsCommerceOrders();
      else if (sec === 'commerce/payments') loadSettingsPayments();
      else if (sec === 'commerce/fulfillment') loadSettingsFulfillment();
      else if (sec === 'channels/website') loadSettingsWebsite();
      else if (sec === 'channels/customer-app') loadSettingsCustomerApp();
      else if (sec === 'channels/pos') loadSettingsPos();
      else if (sec === 'integrations') loadSettingsIntegrations();
      else if (sec === 'security') loadSettingsSecurity();
    }
    window.loadSettingsCurrentSubtab = loadSettingsCurrentSubtab;

    // 1. Business Profile
    async function loadSettingsProfile() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/business/profile', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.profile) return;

        var p = json.profile;
        if ($('set-profile-name')) $('set-profile-name').value = p.name || '';
        if ($('set-profile-tagline')) $('set-profile-tagline').value = p.tagline || '';
        var logoUrl = p.logo_url || '/assets/pwa/icon-192.png';
        if ($('set-profile-logo')) $('set-profile-logo').value = logoUrl;
        if ($('set-profile-logo-preview')) {
          $('set-profile-logo-preview').src = logoUrl;
          $('set-profile-logo-preview').style.display = 'block';
        }
        if ($('set-profile-logo-empty')) $('set-profile-logo-empty').style.display = 'none';
        var hasCustomLogo = Boolean(logoUrl && logoUrl !== '/assets/pwa/icon-192.png');
        if ($('btn-set-profile-logo-remove')) $('btn-set-profile-logo-remove').style.display = hasCustomLogo ? 'inline-block' : 'none';
        if ($('btn-set-profile-logo-pick')) $('btn-set-profile-logo-pick').textContent = hasCustomLogo ? '📁 Ganti Logo' : '📁 Unggah Logo';

        if ($('set-profile-color')) $('set-profile-color').value = p.primary_color || '#b6ff00';
        if ($('set-profile-color-hex')) $('set-profile-color-hex').value = p.primary_color || '#b6ff00';
        if ($('set-profile-domain')) $('set-profile-domain').textContent = p.custom_domain || window.location.host || '-';

        // Installed PWA Identity Override
        var merchantIconUrl = p.merchant_pwa_icon_url || null;
        var posIconUrl = p.pos_pwa_icon_url || null;
        var defaultMerchantIcon = '/merchant-app/assets/icons/icon-192.png';
        var defaultPosIcon = '/assets/pwa/icon-192.png';

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

        // Sync brand tab previews too
        if ($('brand-tab-merchant-icon')) $('brand-tab-merchant-icon').value = merchantIconUrl || '';
        if ($('brand-tab-merchant-icon-preview')) $('brand-tab-merchant-icon-preview').src = merchantIconUrl || defaultMerchantIcon;
        if ($('btn-brand-tab-merchant-icon-remove')) $('btn-brand-tab-merchant-icon-remove').style.display = merchantIconUrl ? 'inline-block' : 'none';
        if ($('brand-tab-pos-icon')) $('brand-tab-pos-icon').value = posIconUrl || '';
        if ($('brand-tab-pos-icon-preview')) $('brand-tab-pos-icon-preview').src = posIconUrl || defaultPosIcon;
        if ($('btn-brand-tab-pos-icon-remove')) $('btn-brand-tab-pos-icon-remove').style.display = posIconUrl ? 'inline-block' : 'none';

        // Sync PWA custom name inputs across Settings and Brand tabs
        var merchantPwaName = p.merchant_pwa_name || '';
        var posPwaName = p.pos_pwa_name || '';
        if ($('set-profile-merchant-pwa-name')) $('set-profile-merchant-pwa-name').value = merchantPwaName;
        if ($('set-profile-pos-pwa-name')) $('set-profile-pos-pwa-name').value = posPwaName;
        if ($('brand-tab-merchant-pwa-name')) $('brand-tab-merchant-pwa-name').value = merchantPwaName;
        if ($('brand-tab-pos-pwa-name')) $('brand-tab-pos-pwa-name').value = posPwaName;
      } catch (err) {
        console.warn('[Load Settings Profile Warn]:', err);
      }
    }
    window.loadSettingsProfile = loadSettingsProfile;

    // Hook settings profile listeners (logo upload & color pickers)
    function initSettingsProfileListeners() {
      var btnPick = $('btn-set-profile-logo-pick');
      var fileInput = $('input-set-profile-logo-file');
      var btnRemove = $('btn-set-profile-logo-remove');

      if (btnPick && fileInput) {
        btnPick.addEventListener('click', function () { fileInput.click(); });
        fileInput.addEventListener('change', async function () {
          var file = fileInput.files && fileInput.files[0];
          if (!file) return;

          var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
          if (allowed.indexOf(file.type) === -1) {
            showToast('❌ Format file tidak didukung. Gunakan JPG, PNG, atau WebP.');
            fileInput.value = '';
            return;
          }

          if (file.size > 10 * 1024 * 1024) {
            showToast('❌ Ukuran file melebihi batas 10 MB.');
            fileInput.value = '';
            return;
          }

          // Immediate optimistic preview before crop editor opens
          (function (f) {
            var r = new FileReader();
            r.onload = function (ev) {
              if ($('set-profile-logo-preview')) { $('set-profile-logo-preview').src = ev.target.result; $('set-profile-logo-preview').style.display = 'block'; }
              if ($('set-profile-logo-empty')) $('set-profile-logo-empty').style.display = 'none';
              if ($('brand-logo-preview')) { $('brand-logo-preview').src = ev.target.result; $('brand-logo-preview').style.display = 'block'; }
              if ($('brand-logo-empty')) $('brand-logo-empty').style.display = 'none';
              if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = ev.target.result;
            };
            r.readAsDataURL(f);
          })(file);

          if (!XentraCropEditor || typeof XentraCropEditor.open !== 'function') {
            (function (f) {
              var r = new FileReader();
              r.onload = function (ev) { doUploadBrandLogo(f, null, ev.target.result, btnPick); };
              r.readAsDataURL(f);
            })(file);
            fileInput.value = '';
            return;
          }

          XentraCropEditor.open({
            source: file,
            assetType: 'logo',
            aspectRatio: 1.0,
            title: 'Potong & Posisikan Logo Brand (1:1)',
            onConfirm: async function (cropSpec, previewDataUrl) {
              try {
                await doUploadBrandLogo(file, cropSpec, previewDataUrl, btnPick);
              } finally {
                fileInput.value = '';
              }
            },
            onCancel: function () {
              // Batal = discard this new file. The persisted logo remains unchanged.
              fileInput.value = '';
            }
          });
        });
      }

      if (btnRemove) {
        btnRemove.addEventListener('click', async function () {
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
              if ($('set-profile-logo')) $('set-profile-logo').value = defaultLogo;
              if ($('set-profile-logo-preview')) $('set-profile-logo-preview').src = defaultLogo;
              btnRemove.style.display = 'none';
              if (btnPick) btnPick.textContent = '📁 Unggah Logo';

              if ($('brand-logo')) $('brand-logo').value = defaultLogo;
              if ($('brand-logo-preview')) $('brand-logo-preview').src = defaultLogo;
              if ($('btn-brand-logo-remove')) $('btn-brand-logo-remove').style.display = 'none';
              if ($('btn-brand-logo-pick')) $('btn-brand-logo-pick').textContent = '📁 Unggah Logo';
              if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = defaultLogo;

              loadBrandSettings();
              loadSettingsProfile();
            } else {
              showToast('❌ Gagal menghapus logo.');
            }
          } catch (err) {
            showToast('❌ Kesalahan jaringan.');
          }
        });
      }

      // Synchronize color picker and hex input in Settings Profile
      var setColor = $('set-profile-color');
      var setColorHex = $('set-profile-color-hex');
      if (setColor && setColorHex) {
        setColor.addEventListener('input', function () {
          setColorHex.value = setColor.value;
        });
        setColorHex.addEventListener('input', function () {
          if (/^#[0-9A-Fa-f]{6}$/.test(setColorHex.value)) {
            setColor.value = setColorHex.value;
          }
        });
      }

      // Settings Panel — Merchant Icon Upload
      var spMerchantPickBtn = $('btn-set-profile-merchant-icon-pick');
      var spMerchantFileInput = $('input-set-profile-merchant-icon-file');
      var spMerchantRemoveBtn = $('btn-set-profile-merchant-icon-remove');
      if (spMerchantPickBtn && spMerchantFileInput) {
        spMerchantPickBtn.addEventListener('click', function () { spMerchantFileInput.click(); });
      }
      if (spMerchantFileInput) {
        spMerchantFileInput.addEventListener('change', async function () {
          var file = spMerchantFileInput.files && spMerchantFileInput.files[0];
          if (!file) return;
          await doUploadPwaLauncherIcon(file, '/admin/brand/merchant-icon',
            $('set-profile-merchant-icon-preview'), $('set-profile-merchant-icon'),
            spMerchantRemoveBtn, $('btn-set-profile-merchant-icon-pick'));
          spMerchantFileInput.value = '';
        });
      }
      if (spMerchantRemoveBtn) {
        spMerchantRemoveBtn.addEventListener('click', async function () {
          if (!await confirmFeatureAction('remove-merchant-pwa-override', 'Hapus Override Icon', 'Hapus override icon Merchant PWA?', 'Hapus')) return;
          try {
            var res = await adminFetch(API_BASE + '/admin/brand/merchant-icon', { method: 'DELETE', headers: getAuthHeaders() });
            var data = await res.json();
            if (res.ok && data.success) {
              showToast('✅ Icon Merchant PWA dihapus.');
              var defaultMerchantIcon = '/merchant-app/assets/icons/icon-192.png';
              if ($('set-profile-merchant-icon')) $('set-profile-merchant-icon').value = '';
              if ($('set-profile-merchant-icon-preview')) $('set-profile-merchant-icon-preview').src = defaultMerchantIcon;
              spMerchantRemoveBtn.style.display = 'none';
              if ($('brand-tab-merchant-icon')) $('brand-tab-merchant-icon').value = '';
              if ($('brand-tab-merchant-icon-preview')) $('brand-tab-merchant-icon-preview').src = defaultMerchantIcon;
              if ($('btn-brand-tab-merchant-icon-remove')) $('btn-brand-tab-merchant-icon-remove').style.display = 'none';
            } else { showToast('❌ Gagal menghapus icon.'); }
          } catch (err) { showToast('❌ Kesalahan jaringan.'); }
        });
      }

      // Settings Panel — POS Icon Upload
      var spPosPickBtn = $('btn-set-profile-pos-icon-pick');
      var spPosFileInput = $('input-set-profile-pos-icon-file');
      var spPosRemoveBtn = $('btn-set-profile-pos-icon-remove');
      if (spPosPickBtn && spPosFileInput) {
        spPosPickBtn.addEventListener('click', function () { spPosFileInput.click(); });
      }
      if (spPosFileInput) {
        spPosFileInput.addEventListener('change', async function () {
          var file = spPosFileInput.files && spPosFileInput.files[0];
          if (!file) return;
          await doUploadPwaLauncherIcon(file, '/admin/brand/pos-icon',
            $('set-profile-pos-icon-preview'), $('set-profile-pos-icon'),
            spPosRemoveBtn, $('btn-set-profile-pos-icon-pick'));
          spPosFileInput.value = '';
        });
      }
      if (spPosRemoveBtn) {
        spPosRemoveBtn.addEventListener('click', async function () {
          if (!await confirmFeatureAction('remove-pos-pwa-override', 'Hapus Override Icon', 'Hapus override icon POS PWA?', 'Hapus')) return;
          try {
            var res = await adminFetch(API_BASE + '/admin/brand/pos-icon', { method: 'DELETE', headers: getAuthHeaders() });
            var data = await res.json();
            if (res.ok && data.success) {
              showToast('✅ Icon POS PWA dihapus.');
              var defaultPosIcon = '/assets/pwa/icon-192.png';
              if ($('set-profile-pos-icon')) $('set-profile-pos-icon').value = '';
              if ($('set-profile-pos-icon-preview')) $('set-profile-pos-icon-preview').src = defaultPosIcon;
              spPosRemoveBtn.style.display = 'none';
              if ($('brand-tab-pos-icon')) $('brand-tab-pos-icon').value = '';
              if ($('brand-tab-pos-icon-preview')) $('brand-tab-pos-icon-preview').src = defaultPosIcon;
              if ($('btn-brand-tab-pos-icon-remove')) $('btn-brand-tab-pos-icon-remove').style.display = 'none';
            } else { showToast('❌ Gagal menghapus icon.'); }
          } catch (err) { showToast('❌ Kesalahan jaringan.'); }
        });
      }
    }


    async function saveSettingsProfile(e) {
      if (e) e.preventDefault();
      var btn = $('btn-save-settings-profile');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Menyimpan...';
      }
      try {
        var rawHex = ($('set-profile-color-hex') && $('set-profile-color-hex').value.trim()) || ($('set-profile-color') && $('set-profile-color').value) || '#b6ff00';
        if (!rawHex.startsWith('#')) rawHex = '#' + rawHex;
        if (/^#[0-9a-fA-F]{3}$/.test(rawHex)) {
          rawHex = '#' + rawHex[1] + rawHex[1] + rawHex[2] + rawHex[2] + rawHex[3] + rawHex[3];
        }
        if (!/^#[0-9a-fA-F]{6}$/.test(rawHex)) {
          showToast('❌ Format warna HEX tidak valid. Gunakan format #RRGGBB (contoh: #FF5500).');
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Simpan Profil';
          }
          return;
        }
        rawHex = rawHex.toUpperCase();

        var merchantPwaVal = ($('set-profile-merchant-icon') && $('set-profile-merchant-icon').value.trim()) || null;
        var posPwaVal = ($('set-profile-pos-icon') && $('set-profile-pos-icon').value.trim()) || null;

        var payload = {
          name: $('set-profile-name').value.trim(),
          tagline: $('set-profile-tagline').value.trim(),
          logo_url: $('set-profile-logo').value.trim(),
          primary_color: rawHex,
          merchant_pwa_icon_url: merchantPwaVal,
          pos_pwa_icon_url: posPwaVal,
          merchant_pwa_name: $('set-profile-merchant-pwa-name') ? $('set-profile-merchant-pwa-name').value.trim() : undefined,
          pos_pwa_name: $('set-profile-pos-pwa-name') ? $('set-profile-pos-pwa-name').value.trim() : undefined
        };

        var res = await adminFetch(API_BASE + '/admin/settings/business/profile', {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var json = await res.json();
        if (json.success) {
          showToast('✅ Profil brand berhasil disimpan.');
          if (json.profile) {
            applyBrandToUI(json.profile);
          }
          loadBrandSettings();
          loadSettingsProfile();
        } else {
          showToast('❌ Gagal: ' + (json.error || 'Terjadi kesalahan.'));
        }
      } catch (err) {
        showToast('❌ Kesalahan jaringan saat menyimpan profil.');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Simpan Profil';
        }
      }
    }
    window.saveSettingsProfile = saveSettingsProfile;

    // 2. Business Info
    async function loadSettingsBusinessInfo() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/business/info', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.info) return;

        var info = json.info;
        if ($('set-info-org-name')) $('set-info-org-name').textContent = info.organization_name || '—';
        if ($('set-info-phone')) $('set-info-phone').textContent = info.contact_phone || info.contact_whatsapp || '—';
        if ($('set-info-address')) $('set-info-address').textContent = info.primary_address || '—';
      } catch (err) {
        console.warn('[Load Business Info Warn]:', err);
      }
    }
    window.loadSettingsBusinessInfo = loadSettingsBusinessInfo;

    // 3. Locations Defaults
    async function loadSettingsLocations() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/locations/defaults', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.defaults) return;

        var defs = json.defaults;
        if ($('set-locations-count')) $('set-locations-count').textContent = defs.branches_count || 0;

        var tbody = $('tbody-set-locations-branches');
        if (tbody) {
          var branches = defs.branches || [];
          if (branches.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Belum ada cabang terdaftar.</td></tr>';
          } else {
            tbody.innerHTML = branches.map(function (b) {
              return '<tr>' +
                '<td><strong>' + esc(b.name) + '</strong></td>' +
                '<td>' + (b.is_active ? '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:700;">Aktif</span>' : '<span class="x-badge" style="background:#f1f5f9;color:#64748b;">Non-aktif</span>') + '</td>' +
                '<td>' + b.max_radius_km + ' km</td>' +
                '<td>' + formatMoney(b.price_per_km) + ' / km</td>' +
                '<td><a href="#branches/' + encodeURIComponent(b.id) + '" style="font-size:12px;font-weight:600;color:var(--primary);text-decoration:none;">Lihat Override Cabang ↗</a></td>' +
              '</tr>';
            }).join('');
          }
        }
      } catch (err) {
        console.warn('[Load Settings Locations Warn]:', err);
      }
    }
    window.loadSettingsLocations = loadSettingsLocations;

    // 4. Commerce Orders
    async function loadSettingsCommerceOrders() {
      try {
        await adminFetch(API_BASE + '/admin/settings/commerce/orders', { headers: getAuthHeaders() });
      } catch (_) {}
    }
    window.loadSettingsCommerceOrders = loadSettingsCommerceOrders;

    // 5. Commerce Payments — Tabbed Provider Interface
    var _activePaymentTab = 'midtrans';

    function switchPaymentTab(tab) {
      _activePaymentTab = tab;
      var midtransBtn = $('payment-tab-midtrans');
      var dokuBtn = $('payment-tab-doku');
      var midtransContent = $('payment-tab-content-midtrans');
      var dokuContent = $('payment-tab-content-doku');

      if (midtransBtn) {
        midtransBtn.style.borderBottomColor = tab === 'midtrans' ? '#0f172a' : 'transparent';
        midtransBtn.style.color = tab === 'midtrans' ? '#0f172a' : '#94a3b8';
        midtransBtn.style.background = tab === 'midtrans' ? '#f8fafc' : 'transparent';
      }
      if (dokuBtn) {
        dokuBtn.style.borderBottomColor = tab === 'doku' ? '#0f172a' : 'transparent';
        dokuBtn.style.color = tab === 'doku' ? '#0f172a' : '#94a3b8';
        dokuBtn.style.background = tab === 'doku' ? '#f8fafc' : 'transparent';
      }
      if (midtransContent) midtransContent.style.display = tab === 'midtrans' ? 'block' : 'none';
      if (dokuContent) dokuContent.style.display = tab === 'doku' ? 'block' : 'none';
    }
    window.switchPaymentTab = switchPaymentTab;

    var _paymentTabInitialised = false;

    async function loadSettingsPayments() {
      try {
        var branchId = getEffectiveBranchId();
        var query = branchId && branchId !== 'all' ? '?branch_id=' + encodeURIComponent(branchId) : '';
        var res = await adminFetch(API_BASE + '/admin/settings/commerce/payments' + query, { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.payment_settings) return;

        var ps = json.payment_settings;
        var scopeBadge = $('set-payment-scope-badge');
        if (scopeBadge) {
          scopeBadge.textContent = ps.has_branch_override ? 'Branch Override Aktif' : 'Brand Default';
          scopeBadge.style.background = ps.has_branch_override ? '#fef3c7' : '#f1f5f9';
          scopeBadge.style.color = ps.has_branch_override ? '#92400e' : '#475569';
        }

        var scopeSel = $('set-payment-scope-select');
        if (scopeSel) {
          scopeSel.innerHTML = '<option value="brand">Seluruh Brand (Default)</option>';
          (state.branches || []).forEach(function (b) {
            var opt = document.createElement('option');
            opt.value = b.id;
            opt.textContent = 'Cabang: ' + b.name;
            scopeSel.appendChild(opt);
          });
          scopeSel.value = (branchId && branchId !== 'all') ? branchId : 'brand';
        }

        var activeProvider = ps.active_provider || '';

        // Tab gateway tidak menampilkan status aktif/nonaktif: pengaturan ini fokus
        // pada penyimpanan kredensial. Aktif/nonaktifnya ada di Finance → Payment Methods.

        // Setiap environment memuat bagiannya SENDIRI — Midtrans hanya menyentuh field
        // Midtrans, DOKU hanya field DOKU. Tidak ada lingkungan yang mengosongkan input
        // milik lingkungan lain.
        gatewayEnvs.midtrans.load(ps);
        gatewayEnvs.doku.load(ps);

        // Tab yang ditampilkan hanya ditentukan sekali, saat halaman pertama dibuka.
        // Memuat ulang setelah menyimpan tidak boleh memindahkan tab yang sedang dilihat.
        if (!_paymentTabInitialised) {
          _paymentTabInitialised = true;
          if (activeProvider) {
            switchPaymentTab(activeProvider);
          }
        }
      } catch (err) {
        console.warn('[Load Settings Payments Warn]:', err);
      }
    }
    window.loadSettingsPayments = loadSettingsPayments;

    function onPaymentScopeChange() {
      loadSettingsPayments();
    }
    window.onPaymentScopeChange = onPaymentScopeChange;

    /**
     * Environment satu provider payment gateway.
     *
     * Tiap provider berdiri sendiri: field yang dibacanya, payload yang dikirimnya,
     * endpoint yang ditujunya, dan cara memuat nilainya. Tidak ada field, jalur kode,
     * maupun endpoint yang dibagi antar provider — menyimpan DOKU tidak membaca,
     * menulis, memuat ulang, atau mengosongkan apa pun milik Midtrans, termasuk yang
     * sedang diketik di tab lain.
     *
     * `provider` sengaja tidak dikirim: menyimpan kredensial bukan tindakan
     * mengaktifkan gateway. Yang mengaktifkan hanya toggle di Finance → Payment Methods.
     */
    function createGatewayEnv(spec) {
      var env = {
        key: spec.key,
        label: spec.label,

        // Hanya field milik provider ini yang dibaca dari DOM.
        buildPayload: function () {
          var payload = {};
          Object.keys(spec.fields).forEach(function (field) {
            var el = $(spec.fields[field]);
            payload[field] = el ? el.value.trim() : '';
          });
          payload[spec.productionKey] = Boolean($(spec.productionField) && $(spec.productionField).checked);
          return payload;
        },

        async save(e) {
          if (e) e.preventDefault();
          var scopeSel = $('set-payment-scope-select');
          var scopeVal = scopeSel ? scopeSel.value : 'brand';
          var payload = this.buildPayload();
          payload.branch_id = scopeVal && scopeVal !== 'brand' ? scopeVal : null;

          try {
            var res = await adminFetch(
              API_BASE + '/admin/settings/commerce/payments/' + spec.key + '/credentials',
              { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(payload) }
            );
            var json = await res.json();
            if (json.success) {
              showToast(json.message || ('Kredensial ' + spec.label + ' berhasil disimpan.'));
              // Hanya environment ini yang disegarkan. Tab lain tidak tersentuh.
              await env.reload();
            } else {
              showToast('Gagal menyimpan kredensial ' + spec.label + ': ' + (json.error || 'Terjadi kesalahan.'));
            }
          } catch (err) {
            showToast('Kesalahan jaringan saat menyimpan kredensial ' + spec.label + '.');
          }
        },

        // Hanya elemen milik provider ini yang disentuh.
        //
        // Kolom yang BUKAN rahasia diisi dengan nilai tersimpan, supaya yang pernah
        // disimpan terlihat di form. Kolom rahasia memang tidak pernah dikirim server,
        // jadi selain dikosongkan, placeholder-nya diberi tanda "sudah tersimpan" —
        // kalau tidak, form tampak kosong dan tamu mengira simpanannya hilang.
        load: function (ps) {
          if (!ps) return;
          Object.keys(spec.fields).forEach(function (field) {
            var el = $(spec.fields[field]);
            if (!el) return;

            if (Object.prototype.hasOwnProperty.call(spec.populated, field)) {
              var value = ps[spec.populated[field]];
              el.value = value || '';
              return;
            }

            el.value = '';
            if (!Object.prototype.hasOwnProperty.call(el, 'xOriginalPlaceholder')) {
              el.xOriginalPlaceholder = el.placeholder || '';
            }
            var configuredFlag = spec.configured[field];
            var isStored = configuredFlag ? Boolean(ps[configuredFlag]) : false;
            el.placeholder = isStored
              ? 'Tersimpan — isi hanya jika ingin mengganti'
              : el.xOriginalPlaceholder;
          });

          var prodEl = $(spec.productionField);
          if (prodEl) prodEl.checked = Boolean(ps[spec.productionKey]);
        },

        reload: async function () {
          try {
            var res = await adminFetch(API_BASE + '/admin/settings/commerce/payments', { headers: getAuthHeaders() });
            var json = await res.json();
            if (json && json.success && json.payment_settings) env.load(json.payment_settings);
          } catch (_) { /* biarkan nilai yang tampil apa adanya */ }
        }
      };
      return env;
    }

    var gatewayEnvs = {
      midtrans: createGatewayEnv({
        key: 'midtrans',
        label: 'Midtrans',
        // field payload → id elemen
        fields: {
          server_key: 'set-payment-server-key',
          client_key: 'set-payment-client-key',
          merchant_id: 'set-payment-merchant-id'
        },
        // field payload → field respons GET yang mengisinya. Server Key tidak ada di
        // sini karena rahasia; Client Key dan Merchant ID publishable, jadi ditampilkan.
        populated: { client_key: 'client_key', merchant_id: 'merchant_id' },
        // field rahasia → flag "sudah tersimpan" dari respons GET.
        configured: { server_key: 'server_key_configured' },
        productionField: 'set-payment-is-production',
        productionKey: 'is_production'
      }),
      doku: createGatewayEnv({
        key: 'doku',
        label: 'DOKU',
        fields: {
          doku_client_id: 'set-payment-doku-client-id',
          doku_secret_key: 'set-payment-doku-secret-key',
          doku_callback_url: 'set-payment-doku-callback-url'
        },
        populated: { doku_client_id: 'doku_client_id', doku_callback_url: 'doku_callback_url' },
        // Hanya secret key yang rahasia; Client ID dan Callback URL ditampilkan.
        configured: { doku_secret_key: 'doku_secret_key_configured' },
        productionField: 'set-payment-doku-is-production',
        productionKey: 'doku_is_production'
      })
    };

    // Dua pintu masuk terpisah, masing-masing milik environment-nya sendiri.
    function saveSettingsPaymentsMidtrans(e) { return gatewayEnvs.midtrans.save(e); }
    function saveSettingsPaymentsDoku(e) { return gatewayEnvs.doku.save(e); }
    window.saveSettingsPaymentsMidtrans = saveSettingsPaymentsMidtrans;
    window.saveSettingsPaymentsDoku = saveSettingsPaymentsDoku;

    // Saling-kunci antar gateway tidak lagi diatur di sini: aturannya ada di
    // Finance → Payment Methods, dan ditegakkan server (satu gateway online aktif).

    // 6. Commerce Fulfillment
    async function loadSettingsFulfillment() {
      try {
        var branchId = getEffectiveBranchId();
        var query = branchId && branchId !== 'all' ? '?branch_id=' + encodeURIComponent(branchId) : '';
        var res = await adminFetch(API_BASE + '/admin/settings/commerce/fulfillment' + query, { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.fulfillment) return;

        var f = json.fulfillment;
        var sel = $('set-ful-branch-select');
        if (sel) {
          sel.innerHTML = '';
          (state.branches || []).forEach(function (b) {
            var opt = document.createElement('option');
            opt.value = b.id;
            opt.textContent = b.name;
            sel.appendChild(opt);
          });
          if (f.branch_id) sel.value = f.branch_id;
        }

        var badge = $('set-ful-branch-badge');
        if (badge) badge.textContent = f.branch_name || 'Cabang Terpilih';

        if ($('set-ful-delivery-active')) $('set-ful-delivery-active').checked = Boolean(f.is_delivery_active);
        if ($('set-ful-pickup-active')) $('set-ful-pickup-active').checked = Boolean(f.is_pickup_active);
        if ($('set-ful-max-radius')) $('set-ful-max-radius').value = f.max_radius_km || 10;
        if ($('set-ful-free-km')) $('set-ful-free-km').value = f.free_delivery_km || 3;
        if ($('set-ful-price-km')) $('set-ful-price-km').value = f.price_per_km || 2500;
      } catch (err) {
        console.warn('[Load Fulfillment Warn]:', err);
      }
    }
    window.loadSettingsFulfillment = loadSettingsFulfillment;

    function onFulfillmentBranchChange() {
      var sel = $('set-ful-branch-select');
      var val = sel ? sel.value : null;
      if (!val) return;
      adminFetch(API_BASE + '/admin/settings/commerce/fulfillment?branch_id=' + encodeURIComponent(val), { headers: getAuthHeaders() })
        .then(function (res) { return res.json(); })
        .then(function (json) {
          if (json.success && json.fulfillment) {
            var f = json.fulfillment;
            var badge = $('set-ful-branch-badge');
            if (badge) badge.textContent = f.branch_name || 'Cabang Terpilih';
            if ($('set-ful-delivery-active')) $('set-ful-delivery-active').checked = Boolean(f.is_delivery_active);
            if ($('set-ful-pickup-active')) $('set-ful-pickup-active').checked = Boolean(f.is_pickup_active);
            if ($('set-ful-max-radius')) $('set-ful-max-radius').value = f.max_radius_km || 10;
            if ($('set-ful-free-km')) $('set-ful-free-km').value = f.free_delivery_km || 3;
            if ($('set-ful-price-km')) $('set-ful-price-km').value = f.price_per_km || 2500;
          }
        });
    }
    window.onFulfillmentBranchChange = onFulfillmentBranchChange;

    async function saveSettingsFulfillment(e) {
      if (e) e.preventDefault();
      try {
        var sel = $('set-ful-branch-select');
        var branchId = sel ? sel.value : null;
        if (!branchId) {
          showToast('Pilih cabang terlebih dahulu.');
          return;
        }

        var payload = {
          branch_id: branchId,
          is_delivery_active: $('set-ful-delivery-active').checked,
          is_pickup_active: $('set-ful-pickup-active').checked,
          max_radius_km: parseFloat($('set-ful-max-radius').value) || 10.0,
          free_delivery_km: parseFloat($('set-ful-free-km').value) || 3.0,
          price_per_km: parseFloat($('set-ful-price-km').value) || 2500.0
        };

        var res = await adminFetch(API_BASE + '/admin/settings/commerce/fulfillment', {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var json = await res.json();
        if (json.success) {
          showToast('Pengaturan pemenuhan cabang berhasil disimpan.');
        } else {
          showToast('Gagal: ' + (json.error || 'Terjadi kesalahan.'));
        }
      } catch (err) {
        showToast('Kesalahan jaringan saat menyimpan pemenuhan.');
      }
    }
    window.saveSettingsFulfillment = saveSettingsFulfillment;

    // 7. Channels: Website, PWA, POS
    async function loadSettingsWebsite() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/channels/website', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.channel) return;
        if ($('set-ch-website-url')) $('set-ch-website-url').textContent = json.channel.url;
        if ($('set-ch-website-link')) $('set-ch-website-link').href = json.channel.url;
      } catch (_) {}
    }
    window.loadSettingsWebsite = loadSettingsWebsite;

    async function loadSettingsCustomerApp() {
      try {
        await adminFetch(API_BASE + '/admin/settings/channels/customer-app', { headers: getAuthHeaders() });
      } catch (_) {}
    }
    window.loadSettingsCustomerApp = loadSettingsCustomerApp;

    async function loadSettingsPos() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/channels/pos', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.channel) return;

        var ch = json.channel;
        if ($('set-pos-shifts-badge')) $('set-pos-shifts-badge').textContent = (ch.active_shifts_count || 0) + ' Shift Aktif';

        var listEl = $('set-pos-shifts-list');
        if (listEl) {
          var shifts = ch.open_shifts || [];
          if (shifts.length === 0) {
            listEl.innerHTML = '<div class="text-muted" style="padding:8px 0;">Tidak ada shift kasir yang sedang aktif saat ini. Shift dimulai saat kasir membuka float kasir di terminal POS.</div>';
          } else {
            listEl.innerHTML = shifts.map(function (s) {
              return '<div style="padding:10px 14px;background:#f8fafc;border-radius:var(--radius-sm);border:1px solid #e2e8f0;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">' +
                '<div><strong>' + esc(s.branch_name) + '</strong> &nbsp;|&nbsp; Kasir: <code>' + esc(s.cashier_id) + '</code></div>' +
                '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:700;">Shift Terbuka</span>' +
              '</div>';
            }).join('');
          }
        }
      } catch (err) {
        console.warn('[Load POS Channel Warn]:', err);
      }
    }
    window.loadSettingsPos = loadSettingsPos;

    // 8. Integrations
    async function loadSettingsIntegrations() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/integrations', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.integrations) return;

        var cont = $('set-integrations-list');
        if (!cont) return;

        cont.innerHTML = json.integrations.map(function (i) {
          var badge = '';
          if (i.status === 'connected') {
            badge = '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:700;">Terhubung</span>';
          } else if (i.status === 'on_hold') {
            badge = '<span class="x-badge" style="background:#f1f5f9;color:#64748b;font-weight:700;">HOLD</span>';
          } else {
            badge = '<span class="x-badge" style="background:#fef3c7;color:#92400e;font-weight:700;">Belum Terhubung</span>';
          }

          var actionBtn = i.is_configurable
            ? '<button type="button" class="x-btn-secondary" style="font-size:12px;padding:6px 12px;" onclick="switchSettingsSection(\'commerce/payments\', true)">Konfigurasi ⚙️</button>'
            : '<span style="font-size:12px;color:#94a3b8;">Sistem Bawaan</span>';

          return '<div style="padding:16px;background:#ffffff;border:1px solid var(--border-color);border-radius:var(--radius-md);display:flex;justify-content:space-between;align-items:center;">' +
            '<div style="max-width:70%;">' +
              '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">' +
                '<strong style="font-size:14px;color:#1e293b;">' + esc(i.name) + '</strong>' +
                badge +
              '</div>' +
              '<div style="font-size:12px;color:#64748b;">' + esc(i.description) + '</div>' +
            '</div>' +
            '<div>' + actionBtn + '</div>' +
          '</div>';
        }).join('');
      } catch (err) {
        console.warn('[Load Integrations Warn]:', err);
      }
    }
    window.loadSettingsIntegrations = loadSettingsIntegrations;

    // 9. Security
    async function loadSettingsSecurity() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/security', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.security) return;

        var sec = json.security;
        var u = sec.current_user || {};
        if ($('set-sec-user')) $('set-sec-user').textContent = u.username || 'User Session';
        if ($('set-sec-role')) $('set-sec-role').textContent = 'Role: ' + (u.role || '—') + (u.branch_id ? ' (Cabang: ' + u.branch_id + ')' : ' (Global)');

        var tbody = $('tbody-set-audit-logs');
        if (tbody) {
          var logs = sec.recent_audit_logs || [];
          if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Belum ada aktivitas keamanan tercatat.</td></tr>';
          } else {
            tbody.innerHTML = logs.map(function (l) {
              var timeStr = l.created_at ? esc(l.created_at.substring(0, 19).replace('T', ' ')) : '—';
              var resBadge = l.result === 'SUCCESS' || l.result === 'success'
                ? '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:700;">SUKSES</span>'
                : '<span class="x-badge" style="background:#fef2f2;color:#b91c1c;font-weight:700;">' + esc(l.result || 'INFO') + '</span>';
              return '<tr>' +
                '<td style="font-size:12px;color:#64748b;">' + timeStr + '</td>' +
                '<td><code>' + esc(l.actor_id || 'system') + '</code> (' + esc(l.actor_role || '-') + ')</td>' +
                '<td><strong>' + esc(l.action) + '</strong></td>' +
                '<td>' + esc(l.target_user_id || '—') + '</td>' +
                '<td>' + resBadge + '</td>' +
              '</tr>';
            }).join('');
          }
        }
      } catch (err) {
        console.warn('[Load Security Warn]:', err);
      }
    }
    window.loadSettingsSecurity = loadSettingsSecurity;

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
      'orders-filter-status',
      'orders-filter-channel',
      'orders-filter-fulfillment',
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

