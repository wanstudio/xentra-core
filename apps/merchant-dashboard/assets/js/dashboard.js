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

  var getStoredUser = (_shared && _shared.getStoredUser) || function () {
    try {
      var u = localStorage.getItem(USER_KEY);
      return u ? JSON.parse(u) : null;
    } catch (_) { return null; }
  };
  var isBranchManager = (_shared && _shared.isBranchManager) || function () {
    var u = getStoredUser();
    return !!(u && u.role === 'branch_manager');
  };
  var checkAuth = (_shared && _shared.checkAuth) || function () {
    return !!localStorage.getItem(TOKEN_KEY);
  };
  var handleHandoffExchange = (_shared && _shared.handleHandoffExchange) || async function () {};
  var validateServerSession = (_shared && _shared.validateServerSession) || async function () { return true; };

  // Shared UI widgets are owned by merchant-shared/js/shared.js (loaded first).
  // dashboard.js only aliases them so every merchant surface shares one implementation.
  var XentraActionMenu = window.XentraActionMenu;
  var XentraCropEditor = window.XentraCropEditor;

  // Owner branch-catalog UI is owned by this dashboard surface.
  var XentraOwnerBranchCatalog = window.XentraOwnerBranchCatalog || {};
  var getActiveBranchId = typeof XentraOwnerBranchCatalog.getActiveBranchId === 'function'
    ? function () { return XentraOwnerBranchCatalog.getActiveBranchId(); }
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
    if (typeof window.checkAppRoute === 'function') {
      window.checkAppRoute();
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

  function showToast(message, type) {
    var container = $('x-toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'x-toast';
    toast.innerHTML = '<span>⚡</span> <span>' + esc(message) + '</span>';
    container.appendChild(toast);

    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 3500);
  }


  window.toggleStockChecked = function (id, checked) {
    window.toggleStock(id);
  };


  /* =========================================================================
     CONTEXT DETECTION — PLATFORM DASHBOARD vs CLIENT OWNER DASHBOARD
     - Platform Dashboard: xentra.cloud/dashboard or ?context=platform
     - Client Owner Dashboard: <client-domain>/dashboard or ?context=client
     ========================================================================= */

  function isPlatformContext() {
    var path = (window.location.pathname || '').toLowerCase();
    if (path.startsWith('/owner')) return false;

    var urlParams = new URLSearchParams(window.location.search);
    var contextParam = (urlParams.get('context') || '').toLowerCase();
    if (contextParam === 'platform') return true;
    if (contextParam === 'client') return false;

    var user = getStoredUser();
    if (user && user.role && user.role !== 'platform_superadmin') {
      return false;
    }

    var host = (window.location.hostname || '').toLowerCase();
    return host === 'xentra.cloud';
  }

  /* =========================================================================
     ROUTING — HASH-BASED URL ROUTER
     URL is the source of truth for active navigation state.
     Pattern: /dashboard#<route>   e.g. #overview, #organizations
     ========================================================================= */

  // Client Owner Dashboard routes
  var CLIENT_ROUTE_META = {
    'overview':           { title: 'Overview',    sub: 'Ringkasan bisnis dan aktivitas terkini', tab: 'overview' },
    'orders':             { title: 'Orders',       sub: 'Antrean pesanan realtime dan status dapur', tab: 'orders' },
    'catalog':            { title: 'Catalog',      sub: 'Kelola produk, kategori, dan menu per cabang', tab: 'catalog-products' },
    'catalog/products':   { title: 'Products',     sub: 'Kelola daftar produk master brand', tab: 'catalog-products' },
    'catalog/categories': { title: 'Categories',   sub: 'Atur kategori produk master', tab: 'catalog-categories' },
    'catalog/menus':      { title: 'Menus',        sub: 'Atur menu jual per cabang', tab: 'catalog-menus' },
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
    'team':               { title: 'Team',         sub: 'Kelola akun staf, role, dan hak akses', tab: 'tim' },
    'team/members':       { title: 'Team Members', sub: 'Daftar staf dan akun operator', tab: 'tim' },
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
      if (hash === 'catalog') return 'catalog/products';
      // Handle dynamic route: catalog/products/:id
      if (hash.indexOf('catalog/products/') === 0) {
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

  // Navigate to a route: update URL hash, then apply the route
  function navigateTo(route) {
    if (!route) return;
    closeMobileSidebar();
    var legacyMap = {
      'overview': 'overview',
      'orders': 'orders',
      'catalog': 'catalog/products',
      'catalog-products': 'catalog/products',
      'catalog-categories': 'catalog/categories',
      'catalog-menus': 'catalog/menus',
      'branches': 'branches',
      'tim': 'team',
      'team': 'team',
      'customers': 'customers',
      'reports': 'reports',
      'finance': 'finance/overview',
      'marketing': 'marketing/promotions',
      'settings': 'settings',
      'brand': 'brand',
      'payments': 'payments'
    };
    var canonicalRoute = legacyMap[route] || route;
    if (window.location.hash === '#' + canonicalRoute) {
      applyRoute(canonicalRoute);
    } else {
      window.location.hash = canonicalRoute;
      applyRoute(canonicalRoute);
    }
  }
  window.navigateTo = navigateTo;

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
      navigateTo('catalog/products');
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

    var isProductDetail = !isPlatform && route.indexOf('catalog/products/') === 0;
    var productDetailId = isProductDetail ? route.split('catalog/products/')[1] : null;

    var isBranchDetail = !isPlatform && route.indexOf('branches/') === 0;
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

    var isMarketingRoute = !isPlatform && (route === 'marketing' || route.indexOf('marketing/') === 0);
    var marketingSubtab = isMarketingRoute ? (route.indexOf('marketing/') === 0 ? route.split('marketing/')[1] : 'promotions') : 'promotions';

    var isSettingsRoute = !isPlatform && (route === 'settings' || route.indexOf('settings/') === 0);
    var settingsSubtab = isSettingsRoute ? (route.indexOf('settings/') === 0 ? route.split('settings/')[1] : 'business/profile') : 'business/profile';

    var metaKey = isProductDetail ? 'catalog/products' : (isBranchDetail ? 'branches' : (isOrderDetail ? 'orders' : (isCustomerDetail ? 'customers/:id' : (isTeamRoute ? ('team/' + teamSubtab) : (isReportsRoute ? 'reports' : (isFinanceRoute ? ('finance/' + financeSubtab) : (isMarketingRoute ? ('marketing/' + marketingSubtab) : (isSettingsRoute ? ('settings/' + settingsSubtab) : route))))))));
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
        isActive = route === 'branches' || isBranchDetail;
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
        var isActiveSub = targetRoute === route || (isProductDetail && targetRoute === 'catalog/products');
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

    // 5. Update topbar title
    var titleEl = $('dash-page-title');
    var subEl = $('dash-page-subtitle');
    if (titleEl) titleEl.textContent = isProductDetail ? 'Product Detail' : (isBranchDetail ? 'Branch Detail' : (isOrderDetail ? 'Order Detail' : (isCustomerDetail ? 'Customer Detail' : (isReportsRoute ? 'Reports' : meta.title))));
    if (subEl) subEl.textContent = isProductDetail ? 'Detail produk master dan status adopsi di cabang' : (isBranchDetail ? 'Detail informasi, operasional, menu, dan tim cabang' : (isOrderDetail ? 'Detail transaksi, rincian biaya, dan status pesanan' : (isCustomerDetail ? 'Profil pelanggan, riwayat pesanan, dan loyalitas' : (isReportsRoute ? 'Laporan penjualan, analitik bisnis, dan kinerja cabang' : meta.sub))));

    // 6. In Platform Context: UI shells only, do not invoke merchant business loaders
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
      if (isBranchDetail && branchDetailId) {
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
    if (tabId === 'marketing') {
      switchMarketingSection(marketingSubtab, false);
    }
    if (tabId === 'settings') {
      switchSettingsSection(settingsSubtab, false);
    }

    // Catalog Routes
    if (isBranchManager()) {
      if (isCatalogChild) loadInlineBranchCatalog();
    } else {
      if (isProductDetail && productDetailId) {
        showProductDetailSection();
        loadProductDetailView(productDetailId);
      } else if (tabId === 'catalog-products') {
        showProductListSection();
        loadMasterProducts();
      } else if (tabId === 'catalog-categories') {
        loadMasterCategories();
      } else if (tabId === 'catalog-menus') {
        loadMenusView();
      }
    }
  }

  // Listen to hash changes (browser back/forward, direct URL)
  window.addEventListener('hashchange', function () {
    applyRoute(getCurrentRoute());
  });

  // switchTab kept for backward compat (called from quick-action buttons in HTML)
  function switchTab(tabId) {
    // Map old tab IDs to new routes
    var legacyMap = {
      'overview': 'overview', 'brand': 'brand', 'catalog': 'catalog/products',
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

    // Rebuild options
    sel.innerHTML = '<option value="all">All Branches</option>';
    (_branchContextState.branches).forEach(function (b) {
      var opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.name;
      sel.appendChild(opt);
    });

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

  function initBranchContextSelector() {
    var sel = $('dash-branch-context');
    if (!sel) return;
    sel.addEventListener('change', function () {
      _branchContextState.selected = sel.value;
      var curRoute = getCurrentRoute();
      if (curRoute === 'overview') {
        loadOverview();
      } else if (curRoute === 'reports' || curRoute.indexOf('reports/') === 0) {
        var subType = curRoute.indexOf('reports/') === 0 ? curRoute.split('reports/')[1] : 'overview';
        loadReports(subType);
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

    if ($('auth-brand-name')) $('auth-brand-name').textContent = brand.name || 'Bangjo Resto';
    if ($('auth-logo')) $('auth-logo').src = logoUrl;

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

    // Reusable Brand Logo Upload Flow (Media System M1/M2/M3)
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
        if (nameInput && colorPicker) {
          updateLiveMockupPreview(nameInput.value, previewDataUrl, colorPicker.value);
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
          if (logoInput) logoInput.value = logoUrl;
          if ($('brand-logo-preview')) {
            $('brand-logo-preview').src = logoUrl;
            $('brand-logo-preview').style.display = 'block';
          }
          if ($('brand-logo-empty')) $('brand-logo-empty').style.display = 'none';
          if (btnRemoveLogo) btnRemoveLogo.style.display = 'inline-block';
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
          if (nameInput && colorPicker) {
            updateLiveMockupPreview(nameInput.value, logoUrl, colorPicker.value);
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
          onCancel: async function () {
            // If user cancels crop modal, allow direct upload of the original image
            try {
              var reader = new FileReader();
              reader.onload = function (ev) {
                doUploadBrandLogo(file, null, ev.target.result, btnPickLogo);
              };
              reader.readAsDataURL(file);
            } catch (_) {}
            fileInputLogo.value = '';
          }
        });
      });
    }

    if (btnRemoveLogo) {
      btnRemoveLogo.addEventListener('click', async function () {
        if (!confirm('Hapus logo brand kustom dan kembali ke default?')) return;
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
            var reader = new FileReader();
            reader.onload = function (ev) {
              if (bannerPreviewImg) {
                bannerPreviewImg.src = ev.target.result;
                bannerPreviewImg.style.display = 'block';
              }
              if (bannerEmptyBox) bannerEmptyBox.style.display = 'none';
              if (btnBannerClear) btnBannerClear.style.display = 'inline-block';
              if (btnBannerPick) btnBannerPick.textContent = '📁 Ganti File';
            };
            reader.readAsDataURL(file);
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
    if (!confirm('Hapus slide banner ini?')) return;
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
    if (listView) listView.style.display = 'block';
    if (detailView) detailView.style.display = 'none';
  }

  function showProductDetailSection() {
    var listView = $('product-list-view');
    var detailView = $('product-detail-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';
  }

  async function loadMasterProducts() {
    try {
      var authHeaders = getAuthHeaders();
      var [catRes, prodRes] = await Promise.all([
        adminFetch(API_BASE + '/admin/categories', { headers: authHeaders }),
        adminFetch(API_BASE + '/admin/products', { headers: authHeaders })
      ]);

      var catData = await catRes.json();
      var prodData = await prodRes.json();

      if (catData.success) state.categories = catData.categories || [];
      if (prodData.success) state.products = prodData.products || [];

      renderProductCategoryFilterChips();
      populateProductCategorySelect();
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

  function populateProductCategorySelect() {
    var select = $('prod-filter-category');
    if (select) {
      var opts = '<option value="all">Semua Kategori</option>';
      state.categories.forEach(function (cat) {
        opts += '<option value="' + cat.id + '">' + esc(cat.name) + '</option>';
      });
      select.innerHTML = opts;
      select.value = _catalogState.categoryFilter;
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
      var matchesSearch = true;
      if (_catalogState.searchQuery) {
        var q = _catalogState.searchQuery.toLowerCase();
        var nameMatch = (p.name || '').toLowerCase().indexOf(q) !== -1;
        var descMatch = (p.description || '').toLowerCase().indexOf(q) !== -1;
        matchesSearch = nameMatch || descMatch;
      }

      var matchesCat = true;
      if (_catalogState.categoryFilter !== 'all') {
        matchesCat = String(p.category_id) === String(_catalogState.categoryFilter);
      }

      return matchesSearch && matchesCat;
    });
  }

  function renderMasterProductsTable() {
    var tbody = $('master-products-table-body');
    if (!tbody) return;

    var filtered = getFilteredMasterProducts();

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Belum ada produk yang cocok dengan pencarian / filter.</td></tr>';
      return;
    }

    var rows = filtered.map(function (prod) {
      var cat = state.categories.find(function (c) { return String(c.id) === String(prod.category_id); });
      var catName = cat ? cat.name : 'Umum';
      var img = prod.image || prod.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isActive = prod.is_active !== 0;
      var isRange = prod.pricing_mode === 'range';
      var modeBadge = isRange
        ? '<span class="x-badge x-badge-range">Range (' + formatMoney(prod.min_price || prod.price) + ' - ' + formatMoney(prod.max_price || prod.price) + ')</span>'
        : '<span class="x-badge x-badge-lock">Lock</span>';

      var toggleSwitch = '' +
        '<label class="x-toggle' + (isActive ? ' x-toggle-on' : '') + '" title="' + (isActive ? 'Produk aktif' : 'Produk nonaktif') + '">' +
          '<input type="checkbox" ' + (isActive ? 'checked' : '') + ' onchange="toggleStock(\'' + prod.id + '\')" aria-label="Status aktif produk ' + esc(prod.name) + '">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      return [
        '<tr>',
          '<td><img src="' + esc(img) + '" alt="" class="x-table-thumb"></td>',
          '<td>',
            '<a href="#catalog/products/' + prod.id + '" style="font-weight:700;color:var(--text-main);text-decoration:none;display:inline-block;" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + esc(prod.name) + '</a>',
            '<p class="text-muted" style="font-size:12px;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:2px 0 0;">' + esc(prod.description || '') + '</p>',
          '</td>',
          '<td><span class="x-badge x-badge-info">' + esc(catName) + '</span></td>',
          '<td><strong>' + formatMoney(prod.price) + '</strong>' + (prod.regular_price > prod.price ? ' <del class="text-muted" style="font-size:11px;">' + formatMoney(prod.regular_price) + '</del>' : '') + '</td>',
          '<td>' + modeBadge + '</td>',
          '<td>' + toggleSwitch + '</td>',
          '<td class="text-right" style="white-space:nowrap;">',
            '<div class="x-item-actions">',
              '<button type="button" class="x-action-menu-trigger" aria-label="Aksi produk ' + esc(prod.name) + '" onclick="XentraActionMenu.open(this, [' +
                '{ label: \'Lihat Detail\', icon: \'🔍\', onClick: function() { navigateTo(\'catalog/products/' + prod.id + '\'); } },' +
                '{ label: \'Edit Produk\', icon: \'✏️\', onClick: function() { openEditProduct(\'' + prod.id + '\'); } },' +
                '{ divider: true },' +
                '{ label: \'Hapus Produk\', icon: \'🗑️\', destructive: true, onClick: function() { deleteProduct(\'' + prod.id + '\'); } }' +
              '])">',
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
              '</button>',
            '</div>',
          '</td>',
        '</tr>'
      ].join('');
    });

    tbody.innerHTML = rows.join('');

    // Also populate legacy products-table-body if present in DOM
    var legacyBody = $('products-table-body');
    if (legacyBody) {
      legacyBody.innerHTML = rows.join('');
    }
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

      // Update Header & Breadcrumb
      if ($('prod-detail-breadcrumb')) $('prod-detail-breadcrumb').textContent = prod.name;
      if ($('prod-detail-name')) $('prod-detail-name').textContent = prod.name;
      if ($('prod-detail-desc')) $('prod-detail-desc').textContent = prod.description || 'Tidak ada deskripsi.';
      if ($('prod-detail-price')) $('prod-detail-price').textContent = formatMoney(prod.price);

      var img = prod.image || prod.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      if ($('prod-detail-img')) $('prod-detail-img').src = img;

      // Category badge
      var cat = state.categories.find(function (c) { return String(c.id) === String(prod.category_id); });
      if ($('prod-detail-category-badge')) {
        $('prod-detail-category-badge').textContent = cat ? cat.name : 'Umum';
      }

      // Pricing mode badge
      var modeBadge = $('prod-detail-pricing-mode-badge');
      if (modeBadge) {
        var isRange = prod.pricing_mode === 'range';
        modeBadge.className = 'x-badge ' + (isRange ? 'x-badge-range' : 'x-badge-lock');
        modeBadge.textContent = isRange ? 'Mode: Range' : 'Mode: Fixed (Lock)';
      }

      var rangeBox = $('prod-detail-range-box');
      if (rangeBox) {
        if (prod.pricing_mode === 'range') {
          rangeBox.style.display = 'block';
          if ($('prod-detail-range')) {
            $('prod-detail-range').textContent = formatMoney(prod.min_price || prod.price) + ' - ' + formatMoney(prod.max_price || prod.price);
          }
        } else {
          rangeBox.style.display = 'none';
        }
      }

      // Status badge
      var statusBadge = $('prod-detail-status-badge');
      if (statusBadge) {
        var isActive = prod.is_active !== 0;
        statusBadge.className = 'x-badge ' + (isActive ? 'x-badge-success' : 'x-badge-warning');
        statusBadge.textContent = isActive ? 'Master: Aktif' : 'Master: Nonaktif';
      }

      // Edit button handler
      var editBtn = $('btn-edit-from-detail');
      if (editBtn) {
        editBtn.onclick = function () { openEditProduct(prod.id); };
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
  // 2. MASTER CATEGORIES CONTROLLER
  // ─────────────────────────────────────────────────────────────────────────

  async function loadMasterCategories() {
    var tbody = $('master-categories-table-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6">Memuat daftar kategori...</td></tr>';
    }

    try {
      var authHeaders = getAuthHeaders();
      var [catRes, prodRes] = await Promise.all([
        adminFetch(API_BASE + '/admin/categories', { headers: authHeaders }),
        adminFetch(API_BASE + '/admin/products', { headers: authHeaders })
      ]);

      var catData = await catRes.json();
      var prodData = await prodRes.json();

      if (catData.success) state.categories = catData.categories || [];
      if (prodData.success) state.products = prodData.products || [];

      renderMasterCategoriesTable();
    } catch (err) {
      console.error('[Master Categories Load Error]:', err);
      showToast('❌ Gagal memuat daftar kategori.');
    }
  }

  function renderMasterCategoriesTable() {
    var tbody = $('master-categories-table-body');
    if (!tbody) return;

    if (!state.categories.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-muted">Belum ada kategori master. Klik "+ Tambah Kategori Master" untuk membuat.</td></tr>';
      return;
    }

    var rows = state.categories.map(function (cat) {
      var productCount = state.products.filter(function (p) {
        return String(p.category_id) === String(cat.id);
      }).length;

      return [
        '<tr>',
          '<td><strong>' + esc(cat.name) + '</strong></td>',
          '<td><code style="font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px;">' + esc(cat.slug || '-') + '</code></td>',
          '<td><span class="x-badge x-badge-info">' + productCount + ' Produk</span></td>',
          '<td class="text-right" style="white-space:nowrap;">',
            '<div class="x-item-actions">',
              '<button type="button" class="x-action-menu-trigger" aria-label="Aksi kategori ' + esc(cat.name) + '" onclick="XentraActionMenu.open(this, [' +
                '{ label: \'Edit Kategori\', icon: \'✏️\', onClick: function() { openEditMasterCategory(\'' + cat.id + '\'); } },' +
                '{ divider: true },' +
                '{ label: \'Hapus Kategori\', icon: \'🗑️\', destructive: true, onClick: function() { deleteMasterCategory(\'' + cat.id + '\', \'' + esc(cat.name) + '\', ' + productCount + '); } }' +
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

  window.openAddMasterCategory = function () {
    $('modal-master-category-title').textContent = 'Tambah Kategori Master';
    $('master-cat-id').value = '';
    $('master-cat-name').value = '';
    $('modal-master-category').style.display = 'flex';
  };

  window.openEditMasterCategory = function (id) {
    var cat = state.categories.find(function (c) { return String(c.id) === String(id); });
    if (!cat) return;

    $('modal-master-category-title').textContent = 'Edit Kategori Master';
    $('master-cat-id').value = cat.id;
    $('master-cat-name').value = cat.name;
    $('modal-master-category').style.display = 'flex';
  };

  window.closeMasterCategoryModal = function () {
    $('modal-master-category').style.display = 'none';
  };

  window.deleteMasterCategory = async function (id, name, productCount) {
    if (productCount > 0) {
      alert('Kategori "' + name + '" tidak dapat dihapus karena masih digunakan oleh ' + productCount + ' produk. Pindahkan atau hapus produk terlebih dahulu.');
      return;
    }

    if (!confirm('Apakah Anda yakin ingin menghapus kategori master "' + name + '"?')) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/categories/' + id, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Kategori master berhasil dihapus.');
        loadMasterCategories();
      } else {
        showToast('❌ ' + (data.error || 'Gagal menghapus kategori.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 3. MENUS CONTROLLER (Branch Selling Assortment)
  // ─────────────────────────────────────────────────────────────────────────

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
          var cRes = await adminFetch(API_BASE + '/admin/branches/' + b.id + '/catalog', { headers: getAuthHeaders() });
          var cData = await cRes.json();
          return {
            branch: b,
            adoptedCount: (cData.adopted_products || []).length,
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
      var res = await adminFetch(API_BASE + '/admin/branches/' + branchId + '/catalog', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!data.success) {
        showToast('❌ ' + (data.error || 'Gagal memuat katalog menu cabang.'));
        return;
      }

      XentraOwnerBranchCatalog.state.catalogData = data;

      var categories = data.categories || [];
      var adopted = data.adopted_products || [];
      var available = data.available_master_products || [];

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

    container.innerHTML = filtered.map(function (p) {
      var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isAvailable = p.is_available === 1 || p.is_available === true;
      var catName = (p.category_names && p.category_names.length)
        ? p.category_names.join(', ')
        : (p.branch_category_name || 'Tanpa Kategori');
      var modeBadge = p.pricing_mode === 'range'
        ? '<span class="x-badge x-badge-range">Range (' + formatMoney(p.min_price) + ' - ' + formatMoney(p.max_price) + ')</span>'
        : '<span class="x-badge x-badge-lock">Harga Terkunci</span>';

      var nameSrc = p.name_override ? '<span class="x-badge" style="background:#fef9c3;color:#854d0e;font-size:9px;">OVERRIDE</span>' : '<span class="x-badge" style="background:#f0fdf4;color:#166534;font-size:9px;">DEFAULT</span>';
      var descSrc = p.description_override ? '<span class="x-badge" style="background:#fef9c3;color:#854d0e;font-size:9px;">OVERRIDE</span>' : '<span class="x-badge" style="background:#f0fdf4;color:#166534;font-size:9px;">DEFAULT</span>';

      var productDataJson = esc(JSON.stringify({
        product_id: p.product_id,
        name: p.name, name_override: p.name_override, master_name: p.master_name,
        description: p.description, description_override: p.description_override, master_description: p.master_description,
        image_url: p.image_url, image_override: p.image_override, master_image_url: p.master_image_url,
        price: p.price, master_price: p.master_price, pricing_mode: p.pricing_mode,
        min_price: p.min_price, max_price: p.max_price,
        branch_category_id: p.branch_category_id,
        category_ids: p.category_ids || (p.branch_category_id ? [p.branch_category_id] : []),
        categories: p.categories || []
      }));

      var availabilityToggle = '' +
        '<label class="x-toggle' + (isAvailable ? ' x-toggle-on' : '') + '" title="' + (isAvailable ? 'Menu tersedia' : 'Menu habis') + '">' +
          '<input type="checkbox" ' + (isAvailable ? 'checked' : '') + ' onchange="toggleBranchProductAvailability(\'' + p.product_id + '\', this.checked ? 1 : 0)" aria-label="Ubah ketersediaan menu cabang">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      return [
        '<div class="x-product-card-simple">',
          '<img src="' + esc(img) + '" class="x-product-card-thumb" alt="' + esc(p.name) + '">',
          '<div class="x-product-card-content">',
            '<h5>' + esc(p.name) + '</h5>',
            '<div style="display:flex;gap:4px;flex-wrap:wrap;margin:4px 0;">',
              '<span class="x-badge x-badge-info" style="font-size:10px;">' + esc(catName) + '</span>',
              modeBadge,
            '</div>',
            '<div class="x-product-card-price">Jual: ' + formatMoney(p.price) + ' <small class="text-muted" style="font-weight:normal;">(Owner: ' + formatMoney(p.master_price) + ')</small></div>',
            '<div style="font-size:11px;color:#64748b;margin:4px 0;display:flex;gap:8px;flex-wrap:wrap;">',
              '<span>Nama: ' + nameSrc + '</span>',
              '<span>Deskripsi: ' + descSrc + '</span>',
            '</div>',
            '<div class="x-product-card-actions">',
              '<div>' + availabilityToggle + '</div>',
              '<div class="x-item-actions">',
                '<button type="button" class="x-action-menu-trigger" aria-label="Aksi menu cabang ' + esc(p.name) + '" onclick="XentraActionMenu.open(this, [' +
                  '{ label: \'Edit Menu Cabang\', icon: \'✏️\', onClick: function() { openBranchOverrideModal(\'' + productDataJson + '\'); } },' +
                  '{ divider: true },' +
                  '{ label: \'Hapus dari Cabang\', icon: \'🗑️\', destructive: true, onClick: function() { removeBranchProduct(\'' + p.product_id + '\', \'' + esc(p.name) + '\'); } }' +
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
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">Semua produk dari katalog Master telah diadopsi oleh cabang ini.</div>';
      return;
    }

    container.innerHTML = available.map(function (p) {
      var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isRange = p.pricing_mode === 'range';
      var modeBadge = isRange
        ? '<span class="x-badge x-badge-range">Range (' + formatMoney(p.min_price) + ' - ' + formatMoney(p.max_price) + ')</span>'
        : '<span class="x-badge x-badge-lock">Harga Terkunci</span>';

      return [
        '<div class="x-product-card-simple" style="background:#f8fafc;">',
          '<img src="' + img + '" class="x-product-card-thumb" alt="' + esc(p.name) + '">',
          '<div class="x-product-card-content">',
            '<h5>' + esc(p.name) + '</h5>',
            '<div style="margin:4px 0;">' + modeBadge + '</div>',
            '<div class="x-product-card-price">Harga Dasar Master: ' + formatMoney(p.price) + '</div>',
            '<div class="x-product-card-actions">',
              '<button type="button" class="x-btn-primary" style="padding:6px 12px;font-size:12px;" onclick="openAdoptModal(\'' + p.id + '\')">＋ Adopsi ke Cabang</button>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRODUCT MODAL & IMAGE PICKER LOGIC
  // ─────────────────────────────────────────────────────────────────────────

  // File object staged for menu photo upload on save (null when none chosen).
  var _productImageFile = null;
  var _productCropSpec = null;

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
      if (btnPick) btnPick.textContent = '📁 Ganti Foto';
    } else {
      previewImg.removeAttribute('src');
      previewImg.style.display = 'none';
      emptyBox.style.display = 'flex';
      if (btnRemove) btnRemove.style.display = 'none';
      if (btnPick) btnPick.textContent = '📁 Pilih Foto';
    }
  }

  // Product Actions
  window.openAddProduct = function () {
    $('modal-product-title').textContent = 'Tambah Produk Master Baru';
    $('prod-id').value = '';
    $('prod-name').value = '';
    $('prod-price').value = '';
    $('prod-regular-price').value = '';
    $('prod-pricing-mode').value = 'lock';
    $('prod-min-price').value = '';
    $('prod-max-price').value = '';
    toggleRangeFields();
    $('prod-desc').value = '';
    _productImageFile = null;
    var fileInput = $('prod-image-file');
    if (fileInput) fileInput.value = '';
    setProductImagePreview('', false);
    populateProductCategorySelect();
    $('modal-product').style.display = 'flex';
  };

  window.openEditProduct = function (id) {
    var prod = state.products.find(function (p) { return String(p.id) === String(id); });
    if (!prod) return;

    $('modal-product-title').textContent = 'Edit Produk: ' + prod.name;
    $('prod-id').value = prod.id;
    $('prod-name').value = prod.name;
    populateProductCategorySelect();
    $('prod-category').value = prod.category_id;
    $('prod-price').value = prod.price;
    $('prod-regular-price').value = prod.regular_price || prod.price;
    $('prod-pricing-mode').value = prod.pricing_mode || 'lock';
    $('prod-min-price').value = prod.min_price || '';
    $('prod-max-price').value = prod.max_price || '';
    toggleRangeFields();
    $('prod-desc').value = prod.description || '';
    _productImageFile = null;
    var fileInput = $('prod-image-file');
    if (fileInput) fileInput.value = '';
    var existingImage = prod.image || prod.image_url || '';
    setProductImagePreview(existingImage, existingImage !== '');
    $('modal-product').style.display = 'flex';
  };

  window.closeProductModal = function () {
    $('modal-product').style.display = 'none';
    _productImageFile = null;
  };

  function toggleRangeFields() {
    var ppm = $('prod-pricing-mode');
    var prf = $('prod-range-fields');
    if (!ppm || !prf) return;
    var isRange = ppm.value === 'range';
    prf.style.display = isRange ? 'flex' : 'none';
  }

  window.toggleStock = async function (id) {
    try {
      var res = await adminFetch(API_BASE + '/admin/products/' + id + '/toggle', {
        method: 'PATCH',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Status ketersediaan menu diperbarui.');
        loadMasterProducts();
        if (_catalogState.activeDetailProductId) {
          loadProductDetailView(_catalogState.activeDetailProductId);
        }
      }
    } catch (e) {
      showToast('Gagal mengubah status stok.');
    }
  };

  window.deleteProduct = async function (id) {
    if (!confirm('Apakah Anda yakin ingin menghapus produk master ini?')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/products/' + id, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Produk master berhasil dihapus.');
        if (_catalogState.activeDetailProductId === id) {
          navigateTo('catalog/products');
        } else {
          loadMasterProducts();
        }
      }
    } catch (e) {
      showToast('Gagal menghapus produk.');
    }
  };

  function initCatalogListeners() {
    var prodPricingMode = $('prod-pricing-mode');
    if (prodPricingMode) {
      prodPricingMode.addEventListener('change', toggleRangeFields);
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
        navigateTo('catalog/products');
      });
    }

    // Master Categories buttons
    var btnAddMasterCat = $('btn-add-master-category');
    if (btnAddMasterCat) btnAddMasterCat.addEventListener('click', window.openAddMasterCategory);

    var formMasterCat = $('form-master-category');
    if (formMasterCat) {
      formMasterCat.addEventListener('submit', async function (e) {
        e.preventDefault();
        var catId = $('master-cat-id').value;
        var name = $('master-cat-name').value.trim();
        if (!name) return;

        var url = catId ? (API_BASE + '/admin/categories/' + catId) : (API_BASE + '/admin/categories');
        var method = catId ? 'PUT' : 'POST';

        try {
          var res = await adminFetch(url, {
            method: method,
            headers: getAuthHeaders(),
            body: JSON.stringify({ name: name })
          });
          var data = await res.json();
          if (data.success) {
            showToast('✅ Kategori master berhasil disimpan!');
            window.closeMasterCategoryModal();
            loadMasterCategories();
          } else {
            showToast('❌ ' + (data.error || 'Gagal menyimpan kategori master.'));
          }
        } catch (err) {
          showToast('❌ Kesalahan jaringan.');
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
        var name = prompt('Nama Kategori Baru untuk Cabang ini:');
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
          title: 'Potong & Posisikan Foto Menu (1:1)',
          onConfirm: function (cropSpec, previewDataUrl) {
            _productCropSpec = cropSpec;
            setProductImagePreview(previewDataUrl || URL.createObjectURL(file), true);
            showToast('✓ Potongan foto menu disesuaikan.');
          },
          onCancel: function () {
            // Keep original uncropped preview if user cancels editor
            var reader = new FileReader();
            reader.onload = function (e) {
              setProductImagePreview(e.target.result, true);
            };
            reader.readAsDataURL(file);
          }
        });
      });
    }

    if (btnRemoveProd) {
      btnRemoveProd.addEventListener('click', function () {
        _productImageFile = null;
        _productCropSpec = null;
        if (prodFileInput) prodFileInput.value = '';
        setProductImagePreview('', false);
      });
    }

    // Form Master Product Submit
    var formProduct = $('form-product');
    if (formProduct) {
      formProduct.addEventListener('submit', async function (e) {
        e.preventDefault();
        var id = $('prod-id').value;
        var pricingMode = $('prod-pricing-mode').value;
        var payload = {
          name: $('prod-name').value,
          category_id: $('prod-category').value,
          price: Number($('prod-price').value),
          regular_price: Number($('prod-regular-price').value || $('prod-price').value),
          pricing_mode: pricingMode,
          min_price: pricingMode === 'range' ? Number($('prod-min-price').value || $('prod-price').value) : null,
          max_price: pricingMode === 'range' ? Number($('prod-max-price').value || $('prod-price').value) : null,
          description: $('prod-desc').value
        };

        var url = id ? (API_BASE + '/admin/products/' + id) : (API_BASE + '/admin/products');
        var method = id ? 'PUT' : 'POST';

        try {
          var res = await adminFetch(url, {
            method: method,
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
          });
          var data = await res.json();
          if (!data.success) {
            showToast('❌ ' + (data.error || data.message || 'Gagal menyimpan menu.'));
            return;
          }

          var savedId = (data.product && data.product.id) || id;
          if (_productImageFile && savedId) {
            var base64 = await new Promise(function (resolve, reject) {
              var imgReader = new FileReader();
              imgReader.onload = function () { resolve(imgReader.result); };
              imgReader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
              imgReader.readAsDataURL(_productImageFile);
            });

            var imagePayload = { image_base64: base64, mime_type: _productImageFile.type };
            if (_productCropSpec) {
              imagePayload.crop_spec = _productCropSpec;
            }

            var imageRes = await adminFetch(API_BASE + '/admin/products/' + savedId + '/image', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify(imagePayload)
            });
            var imageData = {};
            try {
              imageData = await imageRes.json();
            } catch (_) {
              var rawBody = '';
              try { rawBody = await imageRes.text(); } catch (_) {}
              var detail = rawBody.length > 160 ? (rawBody.slice(0, 160) + '…') : rawBody;
              imageData = { success: false, error: 'Upload foto gagal (HTTP ' + imageRes.status + '). ' + (detail ? detail + ' ' : '') };
            }
            if (!imageRes.ok || !imageData.success) {
              showToast('❌ ' + (imageData.error || imageData.message || 'Gagal mengunggah foto menu.'));
              return;
            }
          }

          showToast('✅ Produk master berhasil disimpan!');
          window.closeProductModal();
          loadMasterProducts();
          if (_catalogState.activeDetailProductId) {
            loadProductDetailView(_catalogState.activeDetailProductId);
          }
        } catch (err) {
          showToast('Gagal menyimpan menu.');
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
    if (listView) listView.style.display = 'block';
    if (detailView) detailView.style.display = 'none';
  }

  function showBranchDetailView() {
    var listView = $('branch-list-view');
    var detailView = $('branch-detail-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';
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
    var b = branchId ? (state.branches.find(function (x) { return x.id === branchId; }) || null) : null;
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
    $('modal-branch-title').textContent = b ? ('Edit Cabang: ' + (b.name || '')) : 'Tambah Cabang';
    var modal = $('modal-branch');
    if (!modal) return;
    modal.style.display = 'flex';
    setTimeout(function () { $('branch-name').focus(); }, 80);
  };

  window.closeBranchModal = function () {
    var modal = $('modal-branch');
    if (!modal) return;
    modal.style.display = 'none';
    $('form-branch').reset();
    $('branch-id').value = '';
  };

  window.deleteBranch = async function (branchId) {
    var b = state.branches.find(function (x) { return x.id === branchId; }) || {};
    var isActive = b.is_active === 1 || b.is_active === true;
    var confirmMsg = isActive
      ? 'Yakin ingin menghapus cabang "' + (b.name || branchId) + '"?\n\nCabang aktif hanya dapat dihapus jika tidak ada pesanan aktif yang sedang berjalan.'
      : 'Yakin ingin memproses cabang "' + (b.name || branchId) + '"?\n\n• Jika ada riwayat transaksi → cabang akan diarsipkan (data aman).\n• Jika tidak ada riwayat → cabang akan dihapus permanen.';
    if (!confirm(confirmMsg)) return;
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
        closeBranchModal();
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

  window.loadOrders = loadOrders;
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
    var reason = window.prompt('Masukkan alasan penolakan pesanan:');
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
      renderOverviewEmpty();
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
            ' <a href="#reports/operations" style="font-weight:700;color:#92400e;text-decoration:underline;">Lihat Laporan Operasional &rarr;</a>' +
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
  }

  function initOverviewControls() {
    var btnFilter = $('btn-overview-filter');
    var btnReset = $('btn-overview-reset');
    var inputStart = $('overview-start-date');
    var inputEnd = $('overview-end-date');

    if (btnFilter) {
      btnFilter.addEventListener('click', function () {
        _overviewFilter.startDate = inputStart ? inputStart.value : '';
        _overviewFilter.endDate = inputEnd ? inputEnd.value : '';
        loadOverview();
      });
    }

    if (btnReset) {
      btnReset.addEventListener('click', function () {
        if (inputStart) inputStart.value = '';
        if (inputEnd) inputEnd.value = '';
        _overviewFilter.startDate = '';
        _overviewFilter.endDate = '';
        loadOverview();
      });
    }
  }

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

  // Core auth/session helpers initialized at top of module closure

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

    // Role-based sidebar nav item visibility
    if (isBM) {
      // Branch Manager is served by the standalone Merchant App.
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
  }

  function initAuthListeners() {
    var btnLogout = $('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', function () {
        if (!confirm('Apakah Anda ingin keluar dari Dashboard?')) return;
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        if (typeof window.checkAppRoute === 'function') {
          window.checkAppRoute();
        } else {
          window.location.href = '/login';
        }
      });
    }
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
    var labels = { owner: 'Owner', brand_manager: 'Brand Manager', branch_manager: 'Branch Manager', cashier: 'Kasir', kitchen: 'Dapur' };
    return labels[role] || role;
  }

  function _timRoleBadgeClass(role) {
    if (role === 'owner') return 'x-badge-info';
    if (role === 'brand_manager') return 'x-badge-success';
    if (role === 'branch_manager') return 'x-badge-warning';
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
      roleSelect.innerHTML = '<option value="brand_manager">Brand Manager</option><option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option>';
    } else if (_timCurrentUserRole === 'brand_manager') {
      roleSelect.innerHTML = '<option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option>';
    } else if (_timCurrentUserRole === 'branch_manager') {
      roleSelect.innerHTML = '<option value="cashier">Kasir</option>';
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

    $('modal-user').style.display = 'flex';
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
      roleSelect.innerHTML = '<option value="brand_manager">Manager</option><option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option>';
    } else if (_timCurrentUserRole === 'brand_manager') {
      roleSelect.innerHTML = '<option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option>';
    } else if (_timCurrentUserRole === 'branch_manager') {
      roleSelect.innerHTML = '<option value="cashier">Kasir</option>';
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

    $('modal-user').style.display = 'flex';
  }
  window.openEditUser = openEditUser;

  function closeUserModal() {
    $('modal-user').style.display = 'none';
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
      var confirmed = confirm('Nonaktifkan akun "' + name + '"? Staf ini tidak akan bisa login sampai diaktifkan kembali.');
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
    if (!confirm('Nonaktifkan akun "' + name + '"? Staf ini tidak akan bisa login sampai diaktifkan kembali.')) return;
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
    var confirmed = confirm(
      'Hapus anggota "' + name + '"?\n\n' +
      'Anggota akan kehilangan akses ke dashboard dan tim ini. Tindakan ini tidak dapat dibatalkan.'
    );
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
    if (!confirm('Generate token reset password untuk "' + name + '"? Token hanya ditampilkan sekali.')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + '/reset-password', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success && data.reset_token) {
        $('reset-password-user-name').value = name;
        $('reset-password-token').value = data.reset_token;
        $('modal-reset-password').style.display = 'flex';
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.resetUserPassword = resetUserPassword;

  function closeResetPasswordModal() {
    $('modal-reset-password').style.display = 'none';
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
      roleSelect.innerHTML = '<option value="branch_manager">Branch Manager</option><option value="brand_manager">Brand Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option>';
    } else if (_timCurrentUserRole === 'brand_manager') {
      roleSelect.innerHTML = '<option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option>';
    } else if (_timCurrentUserRole === 'branch_manager') {
      roleSelect.innerHTML = '<option value="cashier">Kasir</option><option value="kitchen">Dapur</option>';
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
    $('modal-invite-user').style.display = 'flex';
  }
  window.openInviteUserModal = openInviteUserModal;

  function closeInviteUserModal() {
    $('modal-invite-user').style.display = 'none';
  }
  window.closeInviteUserModal = closeInviteUserModal;

  function handleInviteRoleChange() {
    var role = $('invite-input-role').value;
    var branchGroup = $('invite-branch-group');
    var branchSelect = $('invite-input-branch');
    var isBranchRequired = role === 'branch_manager' || role === 'cashier' || role === 'kitchen';
    
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

    if ((role === 'branch_manager' || role === 'cashier' || role === 'kitchen') && !branchId) {
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
    if (!confirm('Kirim ulang email undangan ke "' + email + '"? Token sebelumnya akan diperbarui.')) return;
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
    if (!confirm('Batalkan undangan untuk "' + email + '"? Tautan undangan tidak akan dapat digunakan lagi.')) return;
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

        var methodLabel = t.payment_method === 'cash' ? 'Tunai (Cash)' : 'Midtrans';
        var timeText = t.created_at ? esc(t.created_at.substring(0, 19).replace('T', ' ')) : '—';

        return '<tr>' +
          '<td><code style="font-size:12px;background:#f8fafc;padding:2px 6px;border-radius:4px;">' + esc(t.id || '—') + '</code></td>' +
          '<td style="font-size:12px;color:#64748b;">' + timeText + '</td>' +
          '<td><a href="#orders/' + encodeURIComponent(t.order_id) + '" style="font-weight:600;color:var(--primary);text-decoration:none;">#' + esc(t.order_number || t.order_id) + '</a></td>' +
          '<td>' + esc(t.branch_name || 'Cabang Utama') + '</td>' +
          '<td><strong>' + esc(methodLabel) + '</strong></td>' +
          '<td><strong>' + formatMoney(t.amount || 0) + '</strong></td>' +
          '<td>' + statusBadge + '</td>' +
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
    if (modal) modal.style.display = 'flex';
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
      if (modal) modal.style.display = 'flex';
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
    var modal = $('modal-marketing-banner');
    if (modal) modal.style.display = 'none';
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
        _marketingBannerEditor.cropSpec = null;
        readMarketingBannerFileAsDataUrl(file).then(function (src) {
          setMarketingBannerEditorPreview(src);
        }).catch(function () {});
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
    if (!confirm('Buang Draft perubahan ini? Versi Banner yang sedang Published akan tetap digunakan.')) return;

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
    if (!confirm('Hapus Draft Banner ini? Banner yang sudah pernah dipublish tidak dapat dihapus dari menu ini.')) return;

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

    if (modal) modal.style.display = 'flex';
  }
  window.openMarketingBannerPreview = openMarketingBannerPreview;

  function closeMarketingBannerPreview() {
    var modal = $('modal-marketing-banner-preview');
    if (modal) modal.style.display = 'none';
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

    var modal = $('modal-marketing-banner-assignment');
    if (modal) modal.style.display = 'flex';
  }
  window.openMarketingBannerAssignmentEditor = openMarketingBannerAssignmentEditor;

  function closeMarketingBannerAssignmentModal() {
    var modal = $('modal-marketing-banner-assignment');
    if (modal) modal.style.display = 'none';
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

    if (!confirm('Hapus penempatan Banner dari cabang ini? Content Banner tetap tersimpan.')) return;

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
    masterProducts: [],
    branches: [],
    productsLoadStatus: 'idle', // 'idle' | 'loading' | 'success' | 'error'
    productsLoadError: null
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
            rewardSummary = '<span style="font-weight:600;color:#0369a1;">🎁 ' + esc(r0.target_product_name || r0.target_product_id || 'Produk Gratis') + '</span>';
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
    var selectEl = $('mkt-promo-target-product');
    var retryContainer = $('mkt-promo-target-product-retry-container');

    if (!forceReload && _marketingPromotionsState.masterProducts.length > 0 && _marketingPromotionsState.branches.length > 0) {
      return;
    }

    if (forceReload || !_marketingPromotionsState.masterProducts.length) {
      _marketingPromotionsState.productsLoadStatus = 'loading';
      _marketingPromotionsState.productsLoadError = null;
      if (selectEl) {
        selectEl.disabled = true;
        selectEl.innerHTML = '<option value="">Memuat produk katalog...</option>';
      }
      if (retryContainer) retryContainer.style.display = 'none';

      try {
        var pRes = await adminFetch(API_BASE + '/admin/products', { headers: getAuthHeaders() });
        if (!pRes.ok) {
          throw new Error('Gagal memuat produk (HTTP ' + pRes.status + ')');
        }
        var pData = await pRes.json();
        if (!pData || !pData.success) {
          throw new Error((pData && pData.error) || 'Gagal memuat produk dari server.');
        }
        _marketingPromotionsState.masterProducts = Array.isArray(pData.products) ? pData.products : [];
        _marketingPromotionsState.productsLoadStatus = 'success';
      } catch (err) {
        console.error('[Marketing Products Load Error]:', err);
        _marketingPromotionsState.productsLoadStatus = 'error';
        _marketingPromotionsState.productsLoadError = err.message || 'Gagal memuat produk';
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

  function renderPromoProductOptions(selectedProductId) {
    var selectEl = $('mkt-promo-target-product');
    var retryContainer = $('mkt-promo-target-product-retry-container');
    if (!selectEl) return;

    // Handle Error State
    if (_marketingPromotionsState.productsLoadStatus === 'error') {
      selectEl.disabled = true;
      selectEl.innerHTML = '<option value="">Gagal memuat produk katalog</option>';
      if (retryContainer) retryContainer.style.display = 'block';
      return;
    }

    if (retryContainer) retryContainer.style.display = 'none';

    // Handle Loading State
    if (_marketingPromotionsState.productsLoadStatus === 'loading') {
      selectEl.disabled = true;
      selectEl.innerHTML = '<option value="">Memuat produk katalog...</option>';
      return;
    }

    var prods = _marketingPromotionsState.masterProducts || [];

    // Handle Empty State
    if (!prods.length) {
      selectEl.disabled = true;
      selectEl.innerHTML = '<option value="">Belum ada produk di Master Catalog</option>';
      return;
    }

    // Success State
    selectEl.disabled = false;
    var html = '<option value="">-- Pilih Produk Hadiah --</option>';
    var foundSavedProduct = false;

    prods.forEach(function (p) {
      var isSel = (selectedProductId !== null && selectedProductId !== undefined && String(p.id) === String(selectedProductId));
      if (isSel) foundSavedProduct = true;
      var priceText = (p.price !== undefined && p.price !== null) ? ' (' + formatMoney(p.price) + ')' : '';
      var skuText = p.sku ? ' [SKU: ' + esc(p.sku) + ']' : '';
      html += '<option value="' + esc(p.id) + '"' + (isSel ? ' selected' : '') + '>' + esc(p.name) + skuText + priceText + '</option>';
    });

    // If a saved product ID was supplied but is no longer in the master catalog, display warning option
    if (selectedProductId && !foundSavedProduct) {
      html = '<option value="' + esc(selectedProductId) + '" selected disabled style="color:#ef4444;">⚠️ Produk reward tersimpan (ID: ' + esc(selectedProductId) + ') tidak lagi tersedia di Master Catalog</option>' + html;
    }

    selectEl.innerHTML = html;
  }

  async function retryLoadPromoProducts() {
    await ensureMarketingDependenciesLoaded(true);
    var targetInput = $('mkt-promo-target-product');
    var currentVal = targetInput ? targetInput.value : null;
    renderPromoProductOptions(currentVal);
    onPromotionProductSelected();
  }
  window.retryLoadPromoProducts = retryLoadPromoProducts;

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
    var selectEl = $('mkt-promo-target-product');
    var normalPriceEl = $('mkt-promo-product-normal-price');
    if (!selectEl || !normalPriceEl) return;

    var prodId = selectEl.value;
    if (!prodId) {
      normalPriceEl.textContent = '-';
      return;
    }

    var prods = _marketingPromotionsState.masterProducts || [];
    var prod = prods.find(function (p) { return String(p.id) === String(prodId); });
    if (prod && prod.price !== undefined && prod.price !== null) {
      normalPriceEl.textContent = formatMoney(prod.price);
    } else {
      normalPriceEl.textContent = '-';
    }
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
    var statusEl = $('mkt-promo-icon-status');
    var mediaIdInput = $('mkt-promo-media-id');
    var iconUrlInput = $('mkt-promo-icon-url');

    if (file.size > 10 * 1024 * 1024) {
      showToast('Ukuran file maksimal 10 MB.');
      return;
    }

    try {
      if (statusEl) {
        statusEl.textContent = 'Mengunggah & memproses aset media...';
        statusEl.style.color = '#3b82f6';
      }

      // Convert to base64
      var base64 = await new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // 1. Stage upload via /admin/media/upload
      var uploadRes = await adminFetch(API_BASE + '/admin/media/upload', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          image_base64: base64,
          mime_type: file.type,
          original_filename: file.name,
          asset_type: 'general',
          enforce_aspect_ratio: false
        })
      });

      var uploadJson = await uploadRes.json();
      if (!uploadRes.ok || !uploadJson.success || !uploadJson.asset) {
        throw new Error(uploadJson.error || 'Upload media icon gagal.');
      }

      var mediaId = uploadJson.asset.media_id || uploadJson.asset.id;

      // 2. Process to ready state via /admin/media/:id/process
      var procRes = await adminFetch(API_BASE + '/admin/media/' + encodeURIComponent(mediaId) + '/process', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ crop_spec: null })
      });

      var procJson = await procRes.json();
      if (!procRes.ok || !procJson.success || !procJson.asset) {
        throw new Error(procJson.error || 'Proses media icon gagal.');
      }

      var processedAsset = procJson.asset;
      if (mediaIdInput) mediaIdInput.value = processedAsset.media_id || processedAsset.id;
      if (iconUrlInput) iconUrlInput.value = processedAsset.url;

      if (statusEl) {
        statusEl.textContent = '✓ Icon media berhasil diunggah dan siap digunakan.';
        statusEl.style.color = '#16a34a';
      }

      updatePromotionPresentationPreview();
      showToast('Icon promosi berhasil diunggah.');
    } catch (err) {
      console.error('[Promotion Icon Upload Error]:', err);
      if (statusEl) {
        statusEl.textContent = 'Gagal mengunggah icon: ' + err.message;
        statusEl.style.color = '#ef4444';
      }
      showToast(err.message || 'Gagal memproses file icon.');
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
      $('mkt-promo-icon-status').textContent = 'Format: PNG, JPG, WebP. Maks 10MB (Rasio 1:1).';
      $('mkt-promo-icon-status').style.color = '#64748b';
    }

    modal.style.display = 'flex';

    await ensureMarketingDependenciesLoaded();
    renderPromoProductOptions(null);
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

    var targetProdId = null;
    var presPayload = {};
    if (Array.isArray(promo.rewards) && promo.rewards.length > 0) {
      var primaryReward = promo.rewards[0];
      targetProdId = primaryReward.target_product_id;
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

    modal.style.display = 'flex';

    await ensureMarketingDependenciesLoaded();
    renderPromoProductOptions(targetProdId);
    onPromotionProductSelected();
    renderPromoBranchCheckboxes(selectedBranchIds.length ? selectedBranchIds : null);
    onPromotionCapabilityChange();
    updatePromotionPresentationPreview();
  }
  window.openEditPromotionModal = openEditPromotionModal;

  function closePromotionModal() {
    var modal = $('modal-mkt-promotion');
    if (modal) modal.style.display = 'none';
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
    var targetProductId = $('mkt-promo-target-product').value;

    if (!name) {
      showToast('Nama promosi wajib diisi.');
      return;
    }
    if (!targetProductId) {
      showToast('Pilih produk gratis dari menu master.');
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
      target_product_id: targetProductId,
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

    if (!confirm('Apakah Anda yakin ingin menghapus program promosi ini? Tindakan ini tidak dapat dibatalkan.')) return;

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
  if (window.XentraOwnerBranchCatalog && typeof window.XentraOwnerBranchCatalog.setHooks === 'function') {
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
        'security'
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
            onCancel: async function () {
              try {
                var reader = new FileReader();
                reader.onload = function (ev) {
                  doUploadBrandLogo(file, null, ev.target.result, btnPick);
                };
                reader.readAsDataURL(file);
              } catch (_) {}
              fileInput.value = '';
            }
          });
        });
      }

      if (btnRemove) {
        btnRemove.addEventListener('click', async function () {
          if (!confirm('Hapus logo brand kustom dan kembali ke default?')) return;
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

        var payload = {
          name: $('set-profile-name').value.trim(),
          tagline: $('set-profile-tagline').value.trim(),
          logo_url: $('set-profile-logo').value.trim(),
          primary_color: rawHex
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


  /* =========================================================================
     INITIALIZATION ON DOM READY
     ========================================================================= */
  var _isInitialized = false;
  async function initializeDashboard() {
    if (_isInitialized) return;
    _isInitialized = true;

    // Wire navigation via event delegation on nav container (reliable across DOM renders)
    var navContainer = $('x-dash-nav');
    if (navContainer) {
      navContainer.addEventListener('click', function (e) {
        var btn = e.target.closest('.x-nav-item, .x-nav-sub-item');
        if (!btn) return;
        if (btn.classList.contains('x-nav-parent')) {
          var currentRoute = getCurrentRoute();
          var isCatalogActive = currentRoute === 'catalog' || currentRoute.indexOf('catalog/') === 0;
          if (!isCatalogActive) {
            navigateTo('catalog');
          } else {
            var sub = $('nav-catalog-sub');
            if (sub) sub.classList.toggle('open');
            var expanded = sub && sub.classList.contains('open');
            btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
          }
          return;
        }
        var route = btn.dataset.route || btn.dataset.tab;
        if (route) {
          navigateTo(route);
        }
      });
    }

    // Direct click handlers for nav items (supports data-route and data-tab)
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
    initBranchSearchAndFilter();
    initBranchOperationsForm();
    initOrdersFilterListeners();
    initMobileSidebar();
    initBranchContextSelector();

    // Workforce form submit
    var formUser = $('form-user');
    if (formUser) {
      formUser.addEventListener('submit', submitUserForm);
    }

    if ($('btn-refresh-orders')) {
      $('btn-refresh-orders').addEventListener('click', loadOrders);
    }

    // Inline branch category button
    var btnAddBranchCatInline = $('btn-add-branch-category-inline');
    if (btnAddBranchCatInline) {
      btnAddBranchCatInline.addEventListener('click', async function () {
        if (!XentraOwnerBranchCatalog || !XentraOwnerBranchCatalog.state || !XentraOwnerBranchCatalog.state.branchId) return;
        var name = prompt('Nama Kategori Baru untuk Cabang ini:');
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

      // Apply initial route from URL hash
      applyRoute(getCurrentRoute());

    } else {
      // -------------------------------------------------------------
      // CLIENT OWNER DASHBOARD SHELL INITIALIZATION (<client-domain>)
      // -------------------------------------------------------------
      // Apply role-based UI before data load
      var isAuth = checkAuth();
      applyRoleBasedUI();
      validateServerSession();

      // Apply initial route from URL hash (enables deep-link and browser refresh)
      applyRoute(getCurrentRoute());

      // Initial data fetch if authenticated
      loadBrandSettings();
      initOverviewControls();
      initReportsControls();
      if (isAuth) {
        loadCatalog();
        // Load branches and populate branch context selector
        loadBranches().then(function () {
          populateBranchSelector(state.branches || []);
        }).catch(function () {});
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDashboard);
  } else {
    initializeDashboard();
  }

})();
