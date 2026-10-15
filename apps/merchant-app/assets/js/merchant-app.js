/**
 * XENTRA CORE — MERCHANT APP (BRANCH MANAGER OPERATING APP)
 *
 * Standalone mobile-first operating surface for the Branch Manager role.
 * The Owner and Platform surfaces stay in apps/merchant-dashboard; shared
 * auth/session, UI widgets and branch-catalog logic come from apps/merchant-shared.
 *
 * Load order: shared.js -> shell.js -> surface-owned branch-catalog-ui.js -> merchant-app.js
 */
(function () {
  'use strict';

  var S = window.XentraShared;
  var API_BASE = S.API_BASE;
  var $ = S.$;
  var esc = S.esc;
  var formatMoney = S.formatMoney;
  var showToast = S.showToast;
  var adminFetch = S.adminFetch;
  var getAuthHeaders = S.getAuthHeaders;
  var getStoredUser = S.getStoredUser;
  var isBranchManager = (S && typeof S.isBranchManager === 'function' ? S.isBranchManager : null) ||
    function () {
      var u = (S && typeof S.getStoredUser === 'function' ? S.getStoredUser() : null);
      return !!(u && (u.role === 'branch_manager' || u.role === 'manager'));
    };
  var checkAuth = S.checkAuth;
  var clearStoredSession = S.clearStoredSession;
  var redirectToLogin = S.redirectToLogin;
  var handleHandoffExchange = S.handleHandoffExchange;
  var validateServerSession = S.validateServerSession;
  var enforceSurface = S.enforceSurface;
  var Catalog = window.XentraMerchantBranchCatalog;

  /* =========================================================================
     ROUTING (Branch Manager routes only)
     ========================================================================= */
  var BM_ROUTE_META = {
    "hari-ini":         { title: "Hari Ini",         sub: "Ringkasan operasional dan kendali resto hari ini", tab: "hari-ini" },
    "pesanan":          { title: "Pesanan",          sub: "Antrean pesanan masuk dan status pesanan",       tab: "bm-pesanan" },
    "meja":             { title: "Meja",             sub: "Status dan ketersediaan meja makan (dine-in)",   tab: "bm-meja" },
    "menu":             { title: "Menu",             sub: "Katalog menu dan pengaturan etalase",            tab: "bm-menu" },
    "promo":            { title: "Promo",            sub: "Daftar promosi dan diskon yang sedang aktif",    tab: "bm-promo" },
    "stok":             { title: "Stok Porsi",       sub: "Pantau dan atur sisa porsi menu yang siap disajikan", tab: "bm-stok" },
    "belanja":          { title: "Belanja Pasar",    sub: "Catatan belanja bahan baku dan kasbon",          tab: "bm-belanja" },
    "purchasing":       { title: "Belanja Pasar",    sub: "Catatan belanja bahan baku dan kasbon",          tab: "bm-belanja" },
    "staff":            { title: "Staff",            sub: "Daftar akun kasir dan staf resto",               tab: "bm-staff" },
    "reports":          { title: "Laporan",          sub: "Laporan transaksi dan omzet penjualan",          tab: "bm-reports" },
    "jam-operasional":  { title: "Jam Operasional",  sub: "Jadwal buka dan jam operasional resto",          tab: "bm-jam-operasional" },
    "pengaturan":       { title: "Pengaturan",       sub: "Pengaturan profil dan preferensi aplikasi",      tab: "bm-settings" },
    "printer":          { title: "Printer Struk",    sub: "Pengaturan printer kasir dan cetak struk",       tab: "bm-printer" },
    "bantuan":          { title: "Bantuan",          sub: "Pusat bantuan operasional merchant",             tab: "bm-help" },
    "ketentuan":        { title: "Ketentuan",        sub: "Syarat layanan dan kebijakan privasi",          tab: "bm-terms" }
  };

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

  function getCurrentRoute() {
    var hash = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase();
    if (!hash) return 'hari-ini';
    return BM_ROUTE_META[hash] ? hash : 'hari-ini';
  }

  function navigateTo(route) {
    if (!route) return;
    closeMobileSidebar();
    closeMobileAccount();
    if (window.location.hash === '#' + route) {
      applyRoute(route);
    } else {
      window.location.hash = route;
      applyRoute(route);
    }
  }
  window.navigateTo = navigateTo;

  // Backward-compatible entry for elements still using data-tab / onclick="switchTab(...)".
  function switchTab(tabId) {
    var tabToRoute = {};
    Object.keys(BM_ROUTE_META).forEach(function (r) { tabToRoute[BM_ROUTE_META[r].tab] = r; });
    navigateTo(tabToRoute[tabId] || tabId);
  }
  window.switchTab = switchTab;
  window.switchBMTab = function (tabOrRoute) {
    if (tabOrRoute === 'purchasing' || tabOrRoute === 'bm-belanja') {
      navigateTo('belanja');
    } else {
      switchTab(tabOrRoute);
    }
  };

  var BM_SUBPAGE_ROUTES = {
    'jam-operasional': true,
    'staff': true,
    'pengaturan': true,
    'printer': true,
    'bantuan': true,
    'ketentuan': true,
    'reports': true
  };

  function applyRoute(route) {
    if (window.XentraNav && typeof window.XentraNav.clear === 'function') {
      window.XentraNav.clear();
    }
    // Synchronize adaptive status bar with active route topbar
    setAppStatusBarColor('#ffffff', true);

    var meta = BM_ROUTE_META[route] || BM_ROUTE_META['hari-ini'];
    var tabId = meta.tab;

    var isSubpage = !!BM_SUBPAGE_ROUTES[route];
    document.body.classList.toggle('is-subpage-view', isSubpage);
    if (isSubpage) {
      var activeSection = document.getElementById('tab-' + tabId);
      if (activeSection) activeSection.scrollTop = 0;
      window.scrollTo(0, 0);
    }

    // Sidebar active state (desktop)
    document.querySelectorAll('#x-dash-nav .x-nav-item[data-route]').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.route === route);
    });

    // Bottom navigation active state (mobile)
    document.querySelectorAll('#x-merchant-mobile-nav .x-merchant-mobile-nav-item[data-route]').forEach(function (btn) {
      var isActive = btn.dataset.route === route;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-current', isActive ? 'page' : 'false');
    });

    // Show the matching content section
    document.querySelectorAll('.x-tab-content').forEach(function (section) {
      section.classList.toggle('active', section.id === 'tab-' + tabId);
    });

    var titleEl = $('dash-page-title');
    var subEl = $('dash-page-subtitle');
    if (titleEl) titleEl.textContent = meta.title;
    if (subEl) subEl.textContent = meta.sub;

    // Order queue polling: exactly one poller, only while the queue is visible.
    if (tabId === 'bm-pesanan') {
      if (typeof startBMOrdersPolling === 'function') startBMOrdersPolling();
      if (typeof loadBMOrders === 'function') loadBMOrders();
    } else {
      if (typeof stopBMOrdersPolling === 'function') stopBMOrdersPolling();
      if (typeof closeBMOrderDetail === 'function') closeBMOrderDetail({ fromPopState: true });
    }

    if (tabId === 'bm-meja' && typeof loadBMTables === 'function') loadBMTables();
    if (tabId === 'bm-menu' && typeof loadBMMenu === 'function') loadBMMenu();
    if (tabId === 'bm-stok' && typeof loadBMStock === 'function') loadBMStock();
    if (tabId === 'bm-belanja') {
      document.body.classList.add('is-belanja-active');
      if (typeof loadPurchasingChecklist === 'function') loadPurchasingChecklist();
    } else {
      document.body.classList.remove('is-belanja-active');
      if (!document.body.classList.contains('is-purchasing-mode')) {
        var pBottomBar = $('purchasing-bottom-bar');
        if (pBottomBar) {
          pBottomBar.classList.add('is-hidden');
          pBottomBar.style.setProperty('display', 'none', 'important');
        }
      }
    }
    if (tabId === 'bm-promo' && typeof loadBMPromotions === 'function') loadBMPromotions();
    if (tabId === 'hari-ini') {
      if (typeof loadHariIni === 'function') loadHariIni();
      if (typeof startHariIniPolling === 'function') startHariIniPolling();
    } else {
      if (typeof stopHariIniPolling === 'function') stopHariIniPolling();
    }
    if (tabId === 'bm-staff' && typeof loadBMStaff === 'function') loadBMStaff();
    if (tabId === 'bm-jam-operasional' && typeof loadBMJamOperasional === 'function') loadBMJamOperasional();
    if (tabId === 'bm-reports' && typeof loadBMReports === 'function') loadBMReports();
    if (tabId === 'bm-printer' && typeof initBMPrinterView === 'function') initBMPrinterView();
  }
  window.applyRoute = applyRoute;

  // Render Branch Manager Navigation in Sidebar (BM-1)
  function renderBranchManagerNavigation() {
    var nav = $("x-dash-nav");
    if (!nav) return;

    nav.innerHTML =
      "<div class=\"x-nav-group-label\">HARI INI</div>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"hari-ini\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"10\"></circle><polyline points=\"12 6 12 12 16 14\"></polyline></svg>" +
        "<span>Hari Ini</span>" +
      "</button>" +

      "<div class=\"x-nav-group-label\" style=\"margin-top: 10px;\">OPERASIONAL</div>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"pesanan\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z\"></path><line x1=\"3\" y1=\"6\" x2=\"21\" y2=\"6\"></line><path d=\"M16 10a4 4 0 0 1-8 0\"></path></svg>" +
        "<span>Pesanan</span>" +
      "</button>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"meja\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M4 18v3\"></path><path d=\"M20 18v3\"></path><path d=\"M4 11h16\"></path><path d=\"M4 11V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5\"></path></svg>" +
        "<span>Meja</span>" +
      "</button>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"menu\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M18 8h1a4 4 0 0 1 0 8h-1\"></path><path d=\"M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z\"></path><line x1=\"6\" y1=\"1\" x2=\"6\" y2=\"4\"></line><line x1=\"10\" y1=\"1\" x2=\"10\" y2=\"4\"></line><line x1=\"14\" y1=\"1\" x2=\"14\" y2=\"4\"></line></svg>" +
        "<span>Menu</span>" +
      "</button>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"promo\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><polygon points=\"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2\"></polygon></svg>" +
        "<span>Promo</span>" +
      "</button>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"stok\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z\"></path><polyline points=\"3.27 6.96 12 12.01 20.73 6.96\"></polyline><line x1=\"12\" y1=\"22.08\" x2=\"12\" y2=\"12\"></line></svg>" +
        "<span>Stok</span>" +
      "</button>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"belanja\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"9\" cy=\"21\" r=\"1\"></circle><circle cx=\"20\" cy=\"21\" r=\"1\"></circle><path d=\"M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6\"></path></svg>" +
        "<span>Belanja Pasar</span>" +
      "</button>" +

      "<div class=\"x-nav-group-label\" style=\"margin-top: 10px;\">TIM</div>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"staff\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2\"></path><circle cx=\"9\" cy=\"7\" r=\"4\"></circle><path d=\"M23 21v-2a4 4 0 0 0-3-3.87\"></path><path d=\"M16 3.13a4 4 0 0 1 0 7.75\"></path></svg>" +
        "<span>Staff</span>" +
      "</button>" +

      "<div class=\"x-nav-group-label\" style=\"margin-top: 10px;\">LAPORAN</div>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"reports\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><line x1=\"18\" y1=\"20\" x2=\"18\" y2=\"10\"></line><line x1=\"12\" y1=\"20\" x2=\"12\" y2=\"4\"></line><line x1=\"6\" y1=\"20\" x2=\"6\" y2=\"14\"></line></svg>" +
        "<span>Penjualan Hari Ini</span>" +
      "</button>" +

      "<div class=\"x-nav-group-label\" style=\"margin-top: 10px;\">PENGATURAN</div>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"jam-operasional\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"10\"></circle><polyline points=\"12 6 12 12 16 14\"></polyline></svg>" +
        "<span>Jam Operasional</span>" +
      "</button>" +
      "<button type=\"button\" class=\"x-nav-item\" data-route=\"pengaturan\">" +
        "<span>⚙️</span><span>Pengaturan</span>" +
      "</button>";

    nav.querySelectorAll(".x-nav-item[data-route]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        navigateTo(btn.dataset.route);
      });
    });
  }




  /* =========================================================================
     BM-2: OPERASIONAL PESANAN & MEJA (BRANCH MANAGER OPERATIONAL CENTER)
     ========================================================================= */


  /* =========================================================================
     BM-3: OPERASIONAL MENU, STOK & PROMO (BRANCH MANAGER OPERATIONAL CENTER)
     ========================================================================= */









  /* =========================================================================
     SURFACE WIRING + BOOT
     ========================================================================= */



  /**
   * Branch-Manager-only shell adjustments (this surface has a single role).
   * RBAC/scope are still enforced server-side; this is presentation + the
   * branch lock derived from the authenticated session.
   */
  function applyRoleBasedUI() {
    var user = getStoredUser();
    if (!user) return;

    var titleEl = $('dash-brand-title');
    if (titleEl && user.brand_name) titleEl.textContent = user.brand_name;

    var portalBadge = document.querySelector('.x-dash-badge-pro');
    if (portalBadge) portalBadge.textContent = 'Branch Portal';

    if ($('dash-user-name')) $('dash-user-name').textContent = user.full_name || user.username || 'Branch Manager';
    if ($('dash-user-avatar')) $('dash-user-avatar').textContent = (user.full_name || user.username || 'B').charAt(0).toUpperCase();
    var roleLabel = user.role === 'purchasing' ? 'Petugas Belanja' : (user.role || 'branch_manager').toUpperCase();
    if ($('dash-user-role')) $('dash-user-role').textContent = roleLabel;

    // Purchasing staff specific surface redirect: standalone isolated surface (/belanja/)
    if (user.role === 'purchasing') {
      window.location.replace('/belanja/');
      return;
    }

    var purchasingTopbar = $('purchasing-mobile-topbar');
    var mobileTopbar = document.querySelector('.x-mobile-topbar');
    document.body.classList.remove('is-purchasing-mode');
    if (purchasingTopbar) purchasingTopbar.style.display = 'none';
    if (mobileTopbar) mobileTopbar.style.display = '';
    var bottomBar = $('purchasing-bottom-bar');
    if (bottomBar) {
      bottomBar.classList.add('is-hidden');
      bottomBar.style.setProperty('display', 'none', 'important');
    }

    // Show Mandat tab button for Branch Manager / Manager
    var btnMandatesNav = $('btn-purchasing-nav-mandates');
    if (btnMandatesNav) {
      btnMandatesNav.style.display = (user.role === 'branch_manager' || user.role === 'manager' || user.role === 'owner') ? 'flex' : 'none';
    }

    var searchBtn = $('btn-global-search');
    if (searchBtn) searchBtn.style.display = 'none';
    var topbarBrandBadge = $('topbar-brand-badge');
    if (topbarBrandBadge) topbarBrandBadge.style.display = 'none';
    var mobileBranchBadge = $('mobile-branch-badge');
    if (mobileBranchBadge) mobileBranchBadge.style.display = 'flex';
    var brandDisplayName = user.branch_name || user.brand_name || 'MyBangjo';
    document.querySelectorAll('.bm-topbar-brand-name, #topbar-brand-name, #pesanan-topbar-brand-name').forEach(function (el) {
      el.textContent = brandDisplayName;
    });
    var desktopTopbarBrandName = $('desktop-topbar-brand-name');
    if (desktopTopbarBrandName) desktopTopbarBrandName.textContent = user.brand_name || 'Bangjo Resto';


    // Branch context is locked to the authenticated branch; no switcher affordance.
    var branchSelectorWrap = $('x-branch-selector');
    if (branchSelectorWrap) branchSelectorWrap.style.display = 'none';
    var bmBranchBadge = $('dash-bm-branch-badge');
    if (bmBranchBadge) bmBranchBadge.style.display = 'flex';
    var bId = (typeof window.getBMTargetBranchId === 'function' ? window.getBMTargetBranchId() : null) || (user ? (user.branch_id || user.branchId) : null);
    if (bId) {
      if (Catalog && Catalog.state) Catalog.state.branchId = bId;
      var bmBranchName = $('dash-bm-branch-name');
      if (bmBranchName && (user.branch_name || user.brand_name)) {
        bmBranchName.textContent = user.branch_name || user.brand_name;
      }
    }
  }

  /**
   * Tombol keluar di header.
   *
   * Sesi merchant disimpan di localStorage oleh apps/merchant-shared, jadi keluar
   * berarti membersihkan sesi itu lalu kembali ke login terpadu. Tanpa handler ini
   * tombolnya tampil tapi tidak melakukan apa pun — persis seperti keluhan
   * "tidak bisa logout".
   */
  window.__subpageReturnToAccount = false;
  function navigateBackFromSubpage() {
    document.body.classList.remove('is-subpage-view');
    if (window.__subpageReturnToAccount) {
      window.__subpageReturnToAccount = false;
      window.location.hash = 'hari-ini';
      applyRoute('hari-ini');
      openMobileAccount();
    } else {
      navigateTo('hari-ini');
    }
  }
  window.navigateBackFromSubpage = navigateBackFromSubpage;

  function closeMerchantSettings(returnToAccount) {
    if (returnToAccount) {
      window.__subpageReturnToAccount = true;
    }
    navigateBackFromSubpage();
  }
  window.closeMerchantSettings = closeMerchantSettings;

  function bindMerchantSettingsControls() {
    var settingsBtn = $('btn-mobile-account-settings');
    if (settingsBtn && !settingsBtn.dataset.bound) {
      settingsBtn.dataset.bound = '1';
      settingsBtn.addEventListener('click', function () {
        window.__subpageReturnToAccount = true;
        closeMobileAccount();
        navigateTo('pengaturan');
      });
    }
    var backBtn = $('btn-bm-settings-back');
    if (backBtn && !backBtn.dataset.bound) {
      backBtn.dataset.bound = '1';
      backBtn.addEventListener('click', function () {
        closeMerchantSettings(true);
      });
    }
    var closeBtn = $('btn-bm-settings-close');
    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.dataset.bound = '1';
      closeBtn.addEventListener('click', function () {
        closeMerchantSettings(false);
      });
    }
    var refreshBtn = $('btn-bm-refresh-app-data');
    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = '1';
      refreshBtn.addEventListener('click', function () {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Menyegarkan...';
        window.location.reload();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindMerchantSettingsControls);
  } else {
    bindMerchantSettingsControls();
  }

  function populateMobileAccount() {
    var user = getStoredUser ? getStoredUser() : null;
    if (!user) return;
    var name = user.full_name || user.username || user.email || 'Pengguna';
    var roleMap = { owner: 'Pemilik', branch_manager: 'Pemilik', manager: 'Manager', cashier: 'Kasir' };
    var role = roleMap[String(user.role || '').toLowerCase()] || 'Pemilik';
    var nameEl = $('mobile-account-name');
    var roleEl = $('mobile-account-role');
    var emailEl = $('mobile-account-email');
    var phoneEl = $('mobile-account-phone');
    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.textContent = role;
    if (emailEl) emailEl.textContent = user.email || '-';
    if (phoneEl) phoneEl.textContent = user.phone || user.phone_number || '-';
  }

  function closeMobileAccount() {
    document.body.classList.remove('x-mobile-account-open');
    var page = $('x-mobile-account-page');
    if (page) page.setAttribute('aria-hidden', 'true');
  }

  function openMobileAccount() {
    populateMobileAccount();
    document.body.classList.add('x-mobile-account-open');
    var page = $('x-mobile-account-page');
    if (page) page.setAttribute('aria-hidden', 'false');
  }

  function logoutFromMobileAccount() {
    if (!confirm('Apakah Anda ingin keluar?')) return;
    if (window.XentraNative && typeof window.XentraNative.clearAuth === 'function') {
      window.XentraNative.clearAuth();
    }
    clearStoredSession();
    redirectToLogin();
  }

  function initMobileAccount() {
    var profile = $('mobile-user-profile');
    var back = $('btn-mobile-account-back');
    var logout = $('btn-mobile-account-logout');
    var profileCard = $('mobile-account-profile-card');
    var notifBtn = $('btn-mobile-account-notifications');
    var opsHoursBtn = $('btn-mobile-account-operational-hours');
    var staffBtn = $('btn-mobile-account-staff');
    var settingsBtn = $('btn-mobile-account-settings');
    var printerBtn = $('btn-mobile-account-printer');
    var helpBtn = $('btn-mobile-account-help');
    var termsBtn = $('btn-mobile-account-terms');
    var versionBtn = $('btn-mobile-account-version');

    if (profile && !profile.dataset.accountBound) {
      profile.dataset.accountBound = '1';
      profile.addEventListener('click', openMobileAccount);
    }
    if (back && !back.dataset.accountBound) {
      back.dataset.accountBound = '1';
      back.addEventListener('click', closeMobileAccount);
    }
    if (logout && !logout.dataset.accountBound) {
      logout.dataset.accountBound = '1';
      logout.addEventListener('click', logoutFromMobileAccount);
    }
    if (profileCard && !profileCard.dataset.accountBound) {
      profileCard.dataset.accountBound = '1';
      profileCard.addEventListener('click', function () {
        var user = getStoredUser ? getStoredUser() : null;
        var name = (user && (user.full_name || user.username)) || 'Pengguna';
        var role = (user && user.role) || 'Branch Manager';
        showToast('Masuk sebagai ' + name + ' (' + role + ')', 'info');
      });
    }
    if (notifBtn && !notifBtn.dataset.accountBound) {
      notifBtn.dataset.accountBound = '1';
      notifBtn.addEventListener('click', function () {
        if (window.XentraWebPush && typeof window.XentraWebPush.requestAndSubscribe === 'function') {
          window.XentraWebPush.requestAndSubscribe().then(function (success) {
            if (success) {
              showToast('Notifikasi pesanan & latar belakang (Web Push) aktif', 'success');
            } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              showToast('Notifikasi pesanan aktif', 'success');
            } else {
              showToast('Notifikasi browser belum diizinkan', 'info');
            }
            if (window.XentraAudio && typeof window.XentraAudio.orderIncoming === 'function') {
              window.XentraAudio.orderIncoming({ single: true });
            }
          });
        } else if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission().then(function (perm) {
            if (perm === 'granted') {
              showToast('Notifikasi pesanan diizinkan & alarm suara aktif', 'success');
              if (window.XentraWebPush && typeof window.XentraWebPush.register === 'function') {
                window.XentraWebPush.register();
              }
            } else {
              showToast('Notifikasi browser diblokir. Alarm suara tetap aktif.', 'info');
            }
            if (window.XentraAudio && typeof window.XentraAudio.orderIncoming === 'function') {
              window.XentraAudio.orderIncoming({ single: true });
            }
          }).catch(function () {
            showToast('Alarm suara pesanan aktif', 'info');
          });
        } else {
          if (window.XentraWebPush && typeof window.XentraWebPush.register === 'function') {
            window.XentraWebPush.register();
          }
          if (window.XentraAudio && typeof window.XentraAudio.orderIncoming === 'function') {
            window.XentraAudio.orderIncoming({ single: true });
          }
          showToast('Alarm suara dan notifikasi pesanan aktif', 'success');
        }
      });
    }
    if (opsHoursBtn && !opsHoursBtn.dataset.accountBound) {
      opsHoursBtn.dataset.accountBound = '1';
      opsHoursBtn.addEventListener('click', function () {
        window.__subpageReturnToAccount = true;
        closeMobileAccount();
        navigateTo('jam-operasional');
      });
    }
    if (staffBtn && !staffBtn.dataset.accountBound) {
      staffBtn.dataset.accountBound = '1';
      staffBtn.addEventListener('click', function () {
        window.__subpageReturnToAccount = true;
        closeMobileAccount();
        navigateTo('staff');
      });
    }
    if (settingsBtn && !settingsBtn.dataset.bound) {
      settingsBtn.dataset.bound = '1';
      settingsBtn.addEventListener('click', function () {
        window.__subpageReturnToAccount = true;
        closeMobileAccount();
        navigateTo('pengaturan');
      });
    }
    if (printerBtn && !printerBtn.dataset.accountBound) {
      printerBtn.dataset.accountBound = '1';
      printerBtn.addEventListener('click', function () {
        window.__subpageReturnToAccount = true;
        closeMobileAccount();
        navigateTo('printer');
      });
    }
    if (helpBtn && !helpBtn.dataset.accountBound) {
      helpBtn.dataset.accountBound = '1';
      helpBtn.addEventListener('click', function () {
        window.__subpageReturnToAccount = true;
        closeMobileAccount();
        navigateTo('bantuan');
      });
    }
    var privacyBtn = $('btn-mobile-account-privacy');
    if (privacyBtn && !privacyBtn.dataset.accountBound) {
      privacyBtn.dataset.accountBound = '1';
      privacyBtn.addEventListener('click', function () {
        window.__subpageReturnToAccount = true;
        closeMobileAccount();
        navigateTo('ketentuan');
      });
    }
    if (termsBtn && !termsBtn.dataset.accountBound) {
      termsBtn.dataset.accountBound = '1';
      termsBtn.addEventListener('click', function () {
        window.__subpageReturnToAccount = true;
        closeMobileAccount();
        navigateTo('ketentuan');
      });
    }
    if (versionBtn && !versionBtn.dataset.accountBound) {
      versionBtn.dataset.accountBound = '1';
      versionBtn.addEventListener('click', function () {
        showToast('Xentra Core Merchant App v1.4.7 (Versi Terbaru)', 'success');
      });
    }
  }

  window.openMobileAccount = openMobileAccount;
  window.closeMobileAccount = closeMobileAccount;

  function initAuthListeners() {
    initMobileAccount();
    var btnLogout = $('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', function () {
        if (!confirm('Apakah Anda ingin keluar dari Merchant App?')) return;
        clearStoredSession();
        redirectToLogin();
      });
    }
    var btnPurchasingLogout = $('btn-purchasing-logout');
    if (btnPurchasingLogout) {
      btnPurchasingLogout.addEventListener('click', function () {
        if (!confirm('Apakah Anda ingin keluar dari aplikasi belanja?')) return;
        clearStoredSession();
        redirectToLogin();
      });
    }
  }

  /* =========================================================================
     NOTIFICATION BELL & NOTIFICATION CENTER (Contract v1)
     ========================================================================= */
  var _notificationsState = {
    items: [],
    unreadCount: 0,
    pollTimer: null
  };

  async function fetchUnreadNotificationCount() {
    try {
      var res = await adminFetch(API_BASE + '/notifications/unread-count', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data && data.success) {
        updateNotificationBadge(data.unread_count || 0);
      }
    } catch (_) {}
  }

  function updateNotificationBadge(count) {
    _notificationsState.unreadCount = count;
    var num = Number(count) || 0;
    var badges = document.querySelectorAll('.x-mobile-notification-badge');
    var pill = $('notif-unread-pill');

    badges.forEach(function (badge) {
      if (!badge) return;
      if (num > 0) {
        badge.textContent = num > 99 ? '99+' : String(num);
        badge.style.setProperty('display', 'flex', 'important');
      } else {
        badge.textContent = '0';
        badge.style.setProperty('display', 'none', 'important');
      }
    });

    if (pill) {
      pill.textContent = (num > 99 ? '99+' : num) + ' Baru';
      pill.style.setProperty('display', num > 0 ? 'inline-block' : 'none', 'important');
    }
  }

  function updateMobileOrdersBadge(count) {
    var badge = $('mobile-orders-count');
    if (!badge) return;
    var num = Number(count) || 0;
    if (num > 0) {
      badge.textContent = num > 99 ? '99+' : String(num);
      badge.style.setProperty('display', 'flex', 'important');
    } else {
      badge.textContent = '0';
      badge.style.setProperty('display', 'none', 'important');
    }
  }
  window.updateMobileOrdersBadge = updateMobileOrdersBadge;

  async function fetchActionableOrdersCount() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/orders?status=pending', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data && data.success && Array.isArray(data.orders)) {
        var count = data.orders.filter(function (o) {
          return o.status === 'pending' || Number(o.pending_additions_count || 0) > 0;
        }).length;
        updateMobileOrdersBadge(count);
        if (typeof checkAndNotifyNewPendingOrders === 'function') {
          checkAndNotifyNewPendingOrders(data.orders);
        }
        var activeTab = document.querySelector('.x-tab-content.active');
        if (activeTab && activeTab.id === 'tab-hari-ini') {
          if (typeof window.renderHariIniPendingOrders === 'function') {
            var pendingOnly = data.orders.filter(function (o) { return o.status === 'pending'; });
            window.renderHariIniPendingOrders(pendingOnly);
          }
          var pendingStatEl = $('bm-stat-pending-orders');
          if (pendingStatEl) {
            pendingStatEl.textContent = count;
          }
        }
      }
    } catch (_) {}
  }
  window.fetchActionableOrdersCount = fetchActionableOrdersCount;

  var _actionableOrdersTimeout = null;
  function scheduleActionableOrdersCheck(delayMs) {
    if (_actionableOrdersTimeout) clearTimeout(_actionableOrdersTimeout);
    _actionableOrdersTimeout = setTimeout(async function () {
      if (document.visibilityState === 'hidden' && !window.IS_NATIVE_APP) {
        scheduleActionableOrdersCheck(10000);
        return;
      }
      var activeTab = document.querySelector('.x-tab-content.active');
      if (!activeTab || (activeTab.id !== 'tab-bm-pesanan' && activeTab.id !== 'tab-hari-ini')) {
        await fetchActionableOrdersCount();
      } else if (activeTab && activeTab.id === 'tab-hari-ini') {
        if (typeof loadHariIniOrders === 'function') {
          await loadHariIniOrders({ background: true });
        }
      }
      scheduleActionableOrdersCheck(10000);
    }, delayMs || 10000);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      fetchActionableOrdersCount();
    }
  });

  function initBMPrinterView() {
    var nativePanel = $('bm-native-printer-panel');
    var webPanel = $('bm-web-printer-panel');
    var statusEl = $('bm-native-printer-status');
    var selectEl = $('bm-native-printer-select');
    var btnConnect = $('btn-native-printer-connect');
    var btnTest = $('btn-native-printer-test');
    var chkAutoprint = $('chk-native-autoprint');

    if (!window.XentraPrinter || !window.XentraPrinter.isNative()) {
      if (nativePanel) nativePanel.style.display = 'none';
      if (webPanel) webPanel.style.display = 'block';
      return;
    }

    if (nativePanel) nativePanel.style.display = 'block';
    if (webPanel) webPanel.style.display = 'none';

    var paired = window.XentraPrinter.getPairedPrinters();
    var savedMac = window.XentraPrinter.getSavedPrinter();

    if (selectEl) {
      if (!paired || paired.length === 0) {
        selectEl.innerHTML = '<option value="">Tidak ada printer paired. Silakan pairing di Bluetooth Android dahulu.</option>';
      } else {
        selectEl.innerHTML = paired.map(function (dev) {
          var sel = (dev.address === savedMac) ? ' selected' : '';
          return '<option value="' + dev.address + '"' + sel + '>' + dev.name + ' (' + dev.address + ')</option>';
        }).join('');
      }
    }

    var isConn = window.XentraPrinter.isConnected();
    if (statusEl) {
      statusEl.textContent = isConn ? '● Terhubung ke Printer' : '○ Belum terhubung';
      statusEl.style.color = isConn ? '#059669' : '#64748b';
    }

    if (chkAutoprint) {
      chkAutoprint.checked = window.XentraPrinter.isAutoPrintEnabled();
      chkAutoprint.onchange = function () {
        window.XentraPrinter.setAutoPrint(chkAutoprint.checked);
        showToast(chkAutoprint.checked ? 'Auto-cetak struk diaktifkan' : 'Auto-cetak struk dinonaktifkan');
      };
    }

    if (btnConnect && !btnConnect.dataset.bound) {
      btnConnect.dataset.bound = '1';
      btnConnect.onclick = function () {
        var mac = selectEl ? selectEl.value : '';
        if (!mac) {
          showToast('Pilih printer Bluetooth terlebih dahulu.');
          return;
        }
        btnConnect.disabled = true;
        btnConnect.textContent = 'Menghubungkan...';
        setTimeout(function () {
          var ok = window.XentraPrinter.connect(mac);
          btnConnect.disabled = false;
          btnConnect.textContent = 'Hubungkan';
          if (ok) {
            showToast('Berhasil terhubung ke printer!');
            if (statusEl) {
              statusEl.textContent = '● Terhubung ke Printer';
              statusEl.style.color = '#059669';
            }
          } else {
            showToast('Gagal terhubung. Pastikan printer menyala.');
          }
        }, 150);
      };
    }

    if (btnTest && !btnTest.dataset.bound) {
      btnTest.dataset.bound = '1';
      btnTest.onclick = function () {
        var ok = window.XentraPrinter.testPrint();
        if (ok) {
          showToast('Perintah cetak terkirim ke printer!');
        } else {
          showToast('Gagal mencetak. Hubungkan printer terlebih dahulu.');
        }
      };
    }
  }
  window.initBMPrinterView = initBMPrinterView;

  async function openNotificationsSheet() {
    var sheet = $('sheet-notifications');
    if (!sheet) return;
    sheet.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    await loadNotificationsList();
  }

  function closeNotificationsSheet() {
    var sheet = $('sheet-notifications');
    if (!sheet) return;
    sheet.style.display = 'none';
    document.body.style.overflow = '';
  }

  async function loadNotificationsList() {
    var container = $('notif-list-container');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:28px 16px;color:#64748b;font-size:13px;">Memuat notifikasi...</div>';

    try {
      var res = await adminFetch(API_BASE + '/notifications?limit=30', { headers: getAuthHeaders() });
      var data = await res.json();
      if (!data || !data.success || !Array.isArray(data.notifications)) {
        container.innerHTML = '<div style="text-align:center;padding:28px 16px;color:#64748b;font-size:13px;">Gagal memuat notifikasi.</div>';
        return;
      }

      _notificationsState.items = data.notifications;
      updateNotificationBadge(data.unread_count || 0);

      if (data.notifications.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:40px 16px;color:#94a3b8;font-size:13px;"><div style="font-size:32px;margin-bottom:8px;">🔔</div>Belum ada notifikasi baru.</div>';
        return;
      }

      var html = '';
      data.notifications.forEach(function (n) {
        var isUnread = !n.read_at;
        var icon = '🔔';
        if (n.source_type === 'order') icon = '🛍️';
        else if (n.source_type === 'delivery') icon = '🛵';
        else if (n.source_type === 'payment') icon = '💵';
        else if (n.source_type === 'announcement') icon = '📢';

        var bg = isUnread ? '#f0fdf4' : '#ffffff';
        var border = isUnread ? '#bbf7d0' : '#e2e8f0';

        html += '<div onclick="handleNotificationClick(\'' + esc(n.id) + '\', \'' + esc(n.action_url || '') + '\')" style="background:' + bg + ';border:1px solid ' + border + ';border-radius:12px;padding:12px 14px;cursor:pointer;display:flex;gap:12px;align-items:flex-start;transition:all 0.15s ease;">';
        html += '<span style="font-size:22px;line-height:1;margin-top:2px;">' + icon + '</span>';
        html += '<div style="flex:1;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">';
        html += '<strong style="font-size:13px;color:#0f172a;">' + esc(n.title) + '</strong>';
        if (isUnread) html += '<span style="width:8px;height:8px;border-radius:50%;background:#16a34a;display:inline-block;"></span>';
        html += '</div>';
        html += '<p style="margin:0 0 6px 0;font-size:12.5px;color:#475569;line-height:1.4;">' + esc(n.body) + '</p>';
        html += '<small style="color:#94a3b8;font-size:11px;">' + new Date(n.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' · ' + new Date(n.created_at).toLocaleDateString('id-ID') + '</small>';
        html += '</div>';
        html += '</div>';
      });

      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = '<div style="text-align:center;padding:28px 16px;color:#ef4444;font-size:13px;">Error: ' + esc(err.message) + '</div>';
    }
  }

  async function handleNotificationClick(id, actionUrl) {
    try {
      await adminFetch(API_BASE + '/notifications/' + encodeURIComponent(id) + '/read', { method: 'POST', headers: getAuthHeaders() });
      fetchUnreadNotificationCount();
    } catch (_) {}

    closeNotificationsSheet();

    if (actionUrl) {
      if (actionUrl.startsWith('/merchant/orders/')) {
        navigateTo('pesanan');
      } else if (actionUrl.startsWith('/pos/')) {
        window.location.href = '/pos/';
      } else if (actionUrl.startsWith('/driver/')) {
        window.location.href = '/driver/';
      }
    }
  }

  async function markAllNotificationsAsRead() {
    try {
      await adminFetch(API_BASE + '/notifications/read-all', { method: 'POST', headers: getAuthHeaders() });
      showToast('Semua notifikasi telah ditandai dibaca.');
      loadNotificationsList();
      fetchUnreadNotificationCount();
    } catch (err) {
      showToast('Gagal menandai notifikasi: ' + err.message);
    }
  }

  function startNotificationPolling() {
    fetchUnreadNotificationCount();
    fetchActionableOrdersCount();
    if (_notificationsState.pollTimer) clearInterval(_notificationsState.pollTimer);
    _notificationsState.pollTimer = setInterval(function () {
      if (document.visibilityState === 'hidden' && !window.IS_NATIVE_APP) return;
      fetchUnreadNotificationCount();
      var activeTab = document.querySelector('.x-tab-content.active');
      if (!activeTab || activeTab.id !== 'tab-bm-pesanan') {
        fetchActionableOrdersCount();
      }
    }, 15000);
  }

  window.openNotificationsSheet = openNotificationsSheet;
  window.closeNotificationsSheet = closeNotificationsSheet;
  window.handleNotificationClick = handleNotificationClick;
  window.markAllNotificationsAsRead = markAllNotificationsAsRead;
  window.updateNotificationBadge = updateNotificationBadge;

  function initNotificationListeners() {
    var btnDesktop = $('btn-notifications-desktop');
    var btnMobile = $('btn-notifications');
    var btnPesanan = $('pesanan-btn-notifications');
    if (btnDesktop) btnDesktop.onclick = openNotificationsSheet;
    if (btnMobile) btnMobile.onclick = openNotificationsSheet;
    if (btnPesanan) btnPesanan.onclick = openNotificationsSheet;
  }

  // ── Adaptive Dynamic Status Bar Architecture (GoBiz Parity) ──
  function setAppStatusBarColor(hexColor, darkIcons) {
    if (!hexColor) hexColor = '#ffffff';
    if (typeof darkIcons === 'undefined') {
      darkIcons = true;
    }

    // 1. Update native Android status bar via bridge (instant)
    if (window.XentraNative && typeof window.XentraNative.setStatusBarColor === 'function') {
      try {
        window.XentraNative.setStatusBarColor(hexColor, !!darkIcons);
      } catch (_) {}
    }

    // 2. Update PWA meta theme-color for Chrome / WebAPK / mobile browsers
    var metaTheme = document.querySelectorAll('meta[name="theme-color"]');
    metaTheme.forEach(function (m) {
      m.setAttribute('content', hexColor);
    });
  }
  window.setAppStatusBarColor = setAppStatusBarColor;


  async function boot() {
    try {
      initAuthListeners();

      await handleHandoffExchange();

      if (!checkAuth()) return;

      var user = getStoredUser();
      // Not signed in at all → the unified login.
      if (!user) { window.location.replace('/login'); return; }

      var isValid = await validateServerSession();
      if (!isValid) return;

      // Sync authenticated session with native Android background monitoring service
      var token = localStorage.getItem('xentra_merchant_token');
      var bId = (typeof window.getBMTargetBranchId === 'function' ? window.getBMTargetBranchId() : null) || (user ? (user.branch_id || user.branchId) : null);
      if (token && bId && window.XentraNative && typeof window.XentraNative.syncAuth === 'function') {
        try { window.XentraNative.syncAuth(token, bId); } catch (_) {}
      }

      // Surface guard: the server resolves the landing surface for this role, so
      // swapping the URL can never grant a surface this role does not own.
      if (enforceSurface(['/merchant/', '/merchant-app/'])) return;

      applyRoleBasedUI();
      renderBranchManagerNavigation();
      initNotificationListeners();
      fetchUnreadNotificationCount();
      fetchActionableOrdersCount();
      scheduleActionableOrdersCheck(15000);

      if (typeof loadHariIni === 'function') {
        loadHariIni();
      }

      var currentRoute = getCurrentRoute();
      if (user.role === 'purchasing' && (!window.location.hash || window.location.hash === '#hari-ini')) {
        currentRoute = 'belanja';
      }
      applyRoute(currentRoute);
    } catch (err) {
      console.error('[Merchant App Boot Error]:', err);
    } finally {
      if (window.Xentra && typeof window.Xentra.hideSplash === 'function') {
        window.Xentra.hideSplash();
      }
    }
  }

  window.addEventListener('merchant:home-ready', function () {
    if (window.Xentra && typeof window.Xentra.hideSplash === 'function') {
      window.Xentra.hideSplash();
    }
  });

  window.addEventListener('hashchange', function () { applyRoute(getCurrentRoute()); });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
