/**
 * XENTRA CORE — MERCHANT APP (BRANCH MANAGER OPERATING APP)
 *
 * Standalone mobile-first operating surface for the Branch Manager role.
 * The Owner and Platform surfaces stay in apps/merchant-dashboard; shared
 * auth/session, UI widgets and branch-catalog logic come from apps/merchant-shared.
 *
 * Load order: shared.js -> shell.js -> branch-catalog.js -> merchant-app.js
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
  var isBranchManager = S.isBranchManager;
  var checkAuth = S.checkAuth;
  var handleHandoffExchange = S.handleHandoffExchange;
  var validateServerSession = S.validateServerSession;
  var enforceSurface = S.enforceSurface;
  var Catalog = window.XentraBranchCatalog;
  var getActiveBranchId = Catalog.getActiveBranchId;
  var loadInlineBranchCatalog = Catalog.loadInlineBranchCatalog;

  /* =========================================================================
     ROUTING (Branch Manager routes only)
     ========================================================================= */
  var BM_ROUTE_META = {
    "hari-ini":         { title: "Hari Ini",         sub: "Ringkasan operasional harian cabang dan kendali layanan", tab: "hari-ini" },
    "pesanan":          { title: "Pesanan",          sub: "Antrean pesanan dan branch acceptance operasional",       tab: "bm-pesanan" },
    "meja":             { title: "Meja",             sub: "Status operasional meja dan dine-in cabang",              tab: "bm-meja" },
    "menu":             { title: "Menu",             sub: "Ketersediaan produk dan operasional menu cabang",         tab: "bm-menu" },
    "promo":            { title: "Promo",            sub: "Promosi dan diskon operasional aktif cabang",             tab: "bm-promo" },
    "stok":             { title: "Stok",             sub: "Pemantauan stok dan peringatan inventaris cabang",        tab: "bm-stok" },
    "staff":            { title: "Staff",            sub: "Daftar staf operasional dan kasir cabang",                tab: "bm-staff" },
    "reports":          { title: "Laporan",          sub: "Laporan penjualan dan operasional harian cabang",         tab: "bm-reports" },
    "jam-operasional":  { title: "Jam Operasional",  sub: "Jam operasional dan pengecualian libur cabang",           tab: "bm-jam-operasional" }
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

  function applyRoute(route) {
    var meta = BM_ROUTE_META[route] || BM_ROUTE_META['hari-ini'];
    var tabId = meta.tab;

    // Sidebar active state
    document.querySelectorAll('#x-dash-nav .x-nav-item[data-route]').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.route === route);
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
      startBMOrdersPolling();
      loadBMOrders();
    } else {
      stopBMOrdersPolling();
    }

    if (tabId === 'bm-meja') loadBMTables();
    if (tabId === 'bm-menu') loadBMMenu();
    if (tabId === 'bm-stok') loadBMStock();
    if (tabId === 'bm-promo') loadBMPromotions();
    if (tabId === 'hari-ini') loadHariIni();
    if (tabId === 'bm-staff') loadBMStaff();
    if (tabId === 'bm-jam-operasional') loadBMJamOperasional();
    if (tabId === 'bm-reports') loadBMReports();
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
      "</button>";

    nav.querySelectorAll(".x-nav-item[data-route]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        navigateTo(btn.dataset.route);
      });
    });
  }

  /* ==========================================================================
     BRANCH MANAGER OPERATIONAL CENTER (moved from merchant-dashboard)
     ========================================================================== */

  /* =========================================================================
     BRANCH MANAGER OPERATIONAL CENTER — HARI INI (BM-1)
     ========================================================================= */
  var _hariIniState = {
    branch: null,
    orders: [],
    layout: null,
    inventory: []
  };

  async function loadHariIni() {
    var user = getStoredUser();
    if (!user || !user.branch_id) {
      console.warn("[BM Hari Ini]: User is not a branch manager or branch_id missing");
      return;
    }
    var branchId = user.branch_id;

    // 1. Fetch assigned branch details
    try {
      var bRes = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId), { headers: getAuthHeaders() });
      if (bRes.ok) {
        var bData = await bRes.json();
        if (bData.success && bData.branch) {
          _hariIniState.branch = bData.branch;
          var b = bData.branch;

          var nameEl = $("bm-hero-branch-name");
          if (nameEl) nameEl.textContent = b.name || ("Cabang " + branchId);

          var topbarBMBranchEl = $("dash-bm-branch-name");
          if (topbarBMBranchEl) topbarBMBranchEl.textContent = b.name || ("Cabang " + branchId);

          var dotEl = $("bm-hero-status-dot");
          var badgeEl = $("bm-hero-status-badge");
          var onlineBadgeEl = $("bm-hero-online-badge");
          var toggleBtn = $("btn-bm-toggle-open");

          var isOpen = b.is_open_override === 1 || b.is_open_override === true;
          var isDeliveryActive = b.is_delivery_active !== 0 && b.is_delivery_active !== false;

          if (dotEl) {
            dotEl.className = "x-status-dot " + (isOpen ? "x-status-dot-open" : "x-status-dot-closed");
          }
          if (badgeEl) {
            badgeEl.className = "x-badge " + (isOpen ? "x-badge-success" : "x-badge-danger");
            badgeEl.textContent = isOpen ? "CABANG: BUKA" : "CABANG: TUTUP";
          }
          if (onlineBadgeEl) {
            onlineBadgeEl.className = "x-badge " + (isDeliveryActive ? "x-badge-info" : "x-badge-warning");
            onlineBadgeEl.textContent = isDeliveryActive ? "ONLINE: AKTIF" : "ONLINE: DIJEDA";
          }
          if (toggleBtn) {
            toggleBtn.innerHTML = isOpen ? "<span>Tutup Sementara</span>" : "<span>Buka Cabang</span>";
            toggleBtn.className = isOpen ? "x-btn-secondary" : "x-btn-primary";
          }

          var onlineBtn = $("btn-bm-toggle-online-orders");
          if (onlineBtn) {
            onlineBtn.innerHTML = isDeliveryActive
              ? "<span>Pause Order Online</span>"
              : "<span>Resume Order Online</span>";
            onlineBtn.className = isDeliveryActive ? "x-btn-secondary" : "x-btn-primary";
            onlineBtn.style.color = isDeliveryActive ? "var(--text-main)" : "#ffffff";
          }
          // Live WIB date context
          var dateEl = $("bm-hero-date");
          if (dateEl) {
            try {
              var now = new Date();
              var days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
              var months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
              dateEl.textContent = days[now.getDay()] + ", " + now.getDate() + " " + months[now.getMonth()] + " " + now.getFullYear() + " • WIB";
            } catch (_) {
              dateEl.textContent = new Date().toISOString().substring(0, 10);
            }
          }
        }
      }
    } catch (e) {
      console.warn("[BM Hari Ini Branch Error]:", e);
    }

    // 2. Fetch assigned branch orders
    try {
      var oRes = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/orders?status=all", { headers: getAuthHeaders() });
      if (oRes.ok) {
        var oData = await oRes.json();
        if (oData.success && Array.isArray(oData.orders)) {
          var orders = oData.orders;
          _hariIniState.orders = orders;

          var pendingList = orders.filter(function (o) { return o.status === "pending"; });
          var activeList = orders.filter(function (o) { return ["confirmed", "preparing"].indexOf(o.status) !== -1; });
          var readyList = orders.filter(function (o) { return o.status === "ready"; });

          var todayStr = new Date().toISOString().substring(0, 10);
          var completedToday = orders.filter(function (o) {
            return o.status === "completed" && (o.created_at || "").substring(0, 10) === todayStr;
          });

          var completedSales = completedToday.reduce(function (acc, o) {
            return acc + (Number(o.grand_total) || 0);
          }, 0);

          if ($("bm-stat-pending-orders")) $("bm-stat-pending-orders").textContent = pendingList.length;
          if ($("bm-stat-active-orders")) $("bm-stat-active-orders").textContent = activeList.length;
          if ($("bm-stat-ready-orders")) $("bm-stat-ready-orders").textContent = readyList.length;
          if ($("bm-stat-completed-orders")) $("bm-stat-completed-orders").textContent = completedToday.length;
          if ($("bm-stat-net-sales-today")) $("bm-stat-net-sales-today").textContent = formatMoney(completedSales) + " total penjualan";

          renderHariIniPendingOrders(pendingList);
        }
      }
    } catch (e) {
      console.warn("[BM Hari Ini Orders Error]:", e);
    }

    // 3. Fetch dine-in tables layout
    try {
      var tRes = await adminFetch(API_BASE + "/dine-in/layout?branch_id=" + encodeURIComponent(branchId), { headers: getAuthHeaders() });
      if (tRes.ok) {
        var tData = await tRes.json();
        if (tData.success && Array.isArray(tData.tables)) {
          var tables = tData.tables;
          var avail = tables.filter(function (t) { return (t.operational_status || t.status) === "available"; }).length;
          var occupied = tables.filter(function (t) { return (t.operational_status || t.status) === "occupied"; }).length;
          var held = tables.filter(function (t) { return (t.operational_status || t.status) === "held"; }).length;
          var blocked = tables.filter(function (t) { return ["blocked", "out_of_service"].indexOf(t.operational_status || t.status) !== -1; }).length;

          if ($("bm-stat-tables-available")) $("bm-stat-tables-available").textContent = avail;
          if ($("bm-stat-tables-occupied")) $("bm-stat-tables-occupied").textContent = occupied;
          if ($("bm-stat-tables-held")) $("bm-stat-tables-held").textContent = held;
          if ($("bm-stat-tables-blocked")) $("bm-stat-tables-blocked").textContent = blocked;
        }
      }
    } catch (e) {
      console.warn("[BM Hari Ini Layout Error]:", e);
    }

    // 4. Fetch low stock inventory alerts & unavailable products
    try {
      var iRes = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/inventory", { headers: getAuthHeaders() });
      var pRes = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/products", { headers: getAuthHeaders() });
      
      var lowItems = [];
      var unavailItems = [];

      if (iRes.ok) {
        var iData = await iRes.json();
        if (iData.success && Array.isArray(iData.inventory)) {
          lowItems = iData.inventory.filter(function (item) {
            return item.stock <= (item.low_stock_threshold || 5);
          });
        }
      }

      if (pRes.ok) {
        var pData = await pRes.json();
        if (pData.success && Array.isArray(pData.assignments)) {
          unavailItems = pData.assignments.filter(function (p) {
            return p.is_available === 0 || p.is_available === false;
          });
        }
      }

      renderHariIniAttention(lowItems, unavailItems);
    } catch (e) {
      console.warn("[BM Hari Ini Inventory/Menu Error]:", e);
    }

    // 5. Fetch active approved branch marketing promotions
    try {
      var promoRes = await adminFetch(API_BASE + "/admin/marketing/promotions", { headers: getAuthHeaders() });
      if (promoRes.ok) {
        var promoData = await promoRes.json();
        if (promoData.success && Array.isArray(promoData.promotions)) {
          var activePromos = promoData.promotions.filter(function (p) {
            var active = (p.is_active === 1 || p.is_active === true || p.status === "active");
            if (!active) return false;
            // Branch scope check: null branch_id applies to all branches
            if (!p.branch_id || p.branch_id === branchId) return true;
            return false;
          });
          renderHariIniPromos(activePromos);
        }
      }
    } catch (e) {
      console.warn("[BM Hari Ini Promos Error]:", e);
    }

    // 6. Fetch authoritative recent branch operational activity logs
    try {
      var logsRes = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/operation-logs?limit=5", { headers: getAuthHeaders() });
      if (logsRes.ok) {
        var logsData = await logsRes.json();
        if (logsData.success && Array.isArray(logsData.logs)) {
          renderHariIniRecentActivity(logsData.logs);
        }
      }
    } catch (e) {
      console.warn("[BM Hari Ini Logs Error]:", e);
    }
  }
  window.loadHariIni = loadHariIni;

  function renderHariIniPromos(promos) {
    var container = $("bm-active-promos-list");
    if (!container) return;

    if (!promos || !promos.length) {
      container.innerHTML = "<div class=\"text-muted text-center py-4\" style=\"font-size:13px;\">Belum ada promosi aktif di cabang ini.</div>";
      return;
    }

    container.innerHTML = promos.slice(0, 4).map(function (p) {
      var discountStr = p.discount_type === "percentage" ? (p.discount_value + "%") : formatMoney(p.discount_value);
      return "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#f0fdf4;border-radius:6px;border:1px solid #dcfce7;\">" +
        "<div>" +
          "<div style=\"display:flex;align-items:center;gap:6px;\">" +
            "<strong style=\"font-size:13px;color:#166534;\">" + esc(p.name || p.title) + "</strong>" +
            (p.code ? ("<code style=\"font-size:11px;background:#bbf7d0;color:#14532d;padding:1px 5px;border-radius:3px;\">" + esc(p.code) + "</code>") : "") +
          "</div>" +
          "<div style=\"font-size:11px;color:#15803d;margin-top:2px;\">" + esc(p.description || "Promosi aktif dapat digunakan pelanggan.") + "</div>" +
        "</div>" +
        "<span class=\"x-badge x-badge-success\" style=\"font-size:11px;\">" + discountStr + "</span>" +
      "</div>";
    }).join("");
  }

  function renderHariIniRecentActivity(logs) {
    var container = $("bm-recent-activity-list");
    if (!container) return;

    if (!logs || !logs.length) {
      container.innerHTML = "<div class=\"text-muted text-center py-4\" style=\"font-size:13px;\">Belum ada aktivitas operasional tercatat hari ini.</div>";
      return;
    }

    container.innerHTML = logs.slice(0, 5).map(function (l) {
      var timeStr = l.created_at ? l.created_at.substring(11, 16) : "—";
      var actorDesc = esc(l.actor_id || "Staf") + " (" + esc(l.actor_role || "system") + ")";
      var actionDesc = "";

      if (l.field === "is_open_override") {
        var isOpen = l.new_value === "1" || l.new_value === 1 || l.new_value === "true";
        actionDesc = isOpen ? "Membuka operasional cabang" : "Menutup operasional cabang sementara";
      } else if (l.field === "is_delivery_active") {
        var isDel = l.new_value === "1" || l.new_value === 1 || l.new_value === "true";
        actionDesc = isDel ? "Mengaktifkan layanan pesanan online" : "Menjeda pesanan online cabang";
      } else if (l.field === "is_available") {
        var isAvail = l.new_value === "1" || l.new_value === 1 || l.new_value === "true";
        actionDesc = (isAvail ? "Mengaktifkan kembali menu" : "Menandai menu habis") + (l.product_id ? (" [ID: " + esc(l.product_id) + "]") : "");
      } else {
        actionDesc = "Perubahan " + esc(l.field) + " &rarr; " + esc(l.new_value || "null");
      }

      return "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;font-size:12px;\">" +
        "<div>" +
          "<span style=\"font-weight:700;color:var(--text-main);\">" + actionDesc + "</span>" +
          "<div style=\"font-size:11px;color:var(--text-muted);margin-top:2px;\">Oleh: " + actorDesc + "</div>" +
        "</div>" +
        "<span style=\"color:var(--text-muted);font-weight:600;font-size:11px;\">" + timeStr + "</span>" +
      "</div>";
    }).join("");
  }

  function renderHariIniPendingOrders(orders) {
    var tbody = $("bm-tbody-pending-orders");
    var countBadge = $("bm-badge-pending-count");
    if (countBadge) {
      if (orders && orders.length > 0) {
        countBadge.textContent = orders.length + " Menunggu";
        countBadge.style.display = "inline-block";
      } else {
        countBadge.style.display = "none";
      }
    }
    if (!tbody) return;

    if (!orders || orders.length === 0) {
      tbody.innerHTML = "<tr><td colspan=\"7\" class=\"text-center py-6 text-muted\"><span style=\"color:var(--accent-green);font-weight:700;\">✓</span> Tidak ada antrean pesanan yang memerlukan tindakan saat ini.</td></tr>";
      return;
    }

    tbody.innerHTML = orders.map(function (o) {
      var orderNum = esc(o.order_number || o.id);
      var cust = esc(o.customer_name || "Pelanggan");
      var typeBadge = (o.order_type === "delivery")
        ? "<span class=\"x-badge x-badge-info\">DELIVERY</span>"
        : (o.order_type === "dine_in" ? "<span class=\"x-badge\" style=\"background:#ede9fe;color:#6d28d9;\">DINE IN</span>" : "<span class=\"x-badge x-badge-warning\">PICKUP</span>");
      var time = (o.created_at || "").substring(11, 16) || "—";
      var total = formatMoney(o.grand_total);
      var statusBadge = "<span class=\"x-badge x-badge-warning\">MENUNGGU KONFIRMASI</span>";

      return "<tr>" +
        "<td><strong>" + orderNum + "</strong></td>" +
        "<td>" + cust + "</td>" +
        "<td>" + typeBadge + "</td>" +
        "<td>" + time + "</td>" +
        "<td><strong>" + total + "</strong></td>" +
        "<td>" + statusBadge + "</td>" +
        "<td>" +
          "<div style=\"display:flex;gap:6px;\">" +
            "<button type=\"button\" class=\"x-btn-primary\" style=\"font-size:11px;padding:4px 8px;\" onclick=\"quickAcceptBMOrder('" + esc(o.id) + "', this)\">Terima</button>" +
            "<button type=\"button\" class=\"x-btn-secondary\" style=\"font-size:11px;padding:4px 8px;color:#dc2626;border-color:#fecaca;\" onclick=\"quickRejectBMOrder('" + esc(o.id) + "')\">Tolak</button>" +
          "</div>" +
        "</td>" +
      "</tr>";
    }).join("");
  }

  function renderHariIniAttention(lowItems, unavailItems) {
    var hasLow = lowItems && lowItems.length > 0;
    var hasUnavail = unavailItems && unavailItems.length > 0;

    var menuContainer = $("bm-menu-unavail-list");
    var menuBadge = $("bm-badge-menu-unavail");
    if (menuBadge) {
      menuBadge.textContent = hasUnavail ? (unavailItems.length + " Habis") : "0 Habis";
      menuBadge.className = "x-badge " + (hasUnavail ? "x-badge-danger" : "");
      if (!hasUnavail) {
        menuBadge.style.background = "#e2e8f0";
        menuBadge.style.color = "var(--text-muted)";
      } else {
        menuBadge.style.background = "";
        menuBadge.style.color = "";
      }
    }
    if (menuContainer) {
      if (!hasUnavail) {
        menuContainer.innerHTML = "<div class=\"text-muted text-center py-3\" style=\"font-size:12px;\"><span style=\"color:var(--accent-green);font-weight:700;\">✓</span> Semua menu tersedia</div>";
      } else {
        menuContainer.innerHTML = unavailItems.slice(0, 4).map(function (p) {
          return "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#fef2f2;border-radius:6px;border:1px solid #fee2e2;\">" +
            "<div>" +
              "<strong style=\"font-size:12px;color:#991b1b;\">" + esc(p.product_name || p.name) + "</strong>" +
              "<div style=\"font-size:11px;color:#b91c1c;\">Status: Ditandai Habis di Cabang</div>" +
            "</div>" +
            "<span class=\"x-badge x-badge-danger\" style=\"font-size:10px;\">HABIS</span>" +
          "</div>";
        }).join("");
      }
    }

    var stockContainer = $("bm-stock-low-list");
    var stockBadge = $("bm-badge-stock-low");
    if (stockBadge) {
      stockBadge.textContent = hasLow ? (lowItems.length + " Menipis") : "0 Menipis";
      stockBadge.className = "x-badge " + (hasLow ? "x-badge-warning" : "");
      if (!hasLow) {
        stockBadge.style.background = "#e2e8f0";
        stockBadge.style.color = "var(--text-muted)";
      } else {
        stockBadge.style.background = "";
        stockBadge.style.color = "";
      }
    }
    if (stockContainer) {
      if (!hasLow) {
        stockContainer.innerHTML = "<div class=\"text-muted text-center py-3\" style=\"font-size:12px;\"><span style=\"color:var(--accent-green);font-weight:700;\">✓</span> Tidak ada stok yang perlu diperhatikan</div>";
      } else {
        stockContainer.innerHTML = lowItems.slice(0, 4).map(function (it) {
          return "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#fffbeb;border-radius:6px;border:1px solid #fef3c7;\">" +
            "<div>" +
              "<strong style=\"font-size:12px;color:#92400e;\">" + esc(it.product_name || it.name || it.product_id) + "</strong>" +
              "<div style=\"font-size:11px;color:#b45309;\">Tersisa " + esc(it.stock) + " (Batas: " + esc(it.low_stock_threshold || 5) + ")</div>" +
            "</div>" +
            "<span class=\"x-badge x-badge-warning\" style=\"font-size:10px;\">STOK TIPIS</span>" +
          "</div>";
        }).join("");
      }
    }

    // Backwards compatibility for legacy container
    var legacyContainer = $("bm-low-stock-list");
    if (legacyContainer) {
      if (!hasLow && !hasUnavail) {
        legacyContainer.innerHTML = "<div class=\"text-muted text-center py-4\" style=\"font-size:13px;\">✓ Semua menu tersedia &amp; stok dalam batas aman.</div>";
      } else {
        legacyContainer.innerHTML = (menuContainer ? menuContainer.innerHTML : '') + (stockContainer ? stockContainer.innerHTML : '');
      }
    }
  }

  function renderHariIniLowStock(items) {
    renderHariIniAttention(items, []);
  }

  async function toggleBranchOpen() {
    var user = getStoredUser();
    if (!user || !user.branch_id) return;
    var branch = _hariIniState.branch;
    var curOpen = branch ? (branch.is_open_override === 1 || branch.is_open_override === true) : true;
    var newOpen = curOpen ? 0 : 1;
    var actionName = newOpen ? "Buka Cabang" : "Tutup Sementara";

    if (!confirm("Apakah Anda yakin ingin melakukan " + actionName + " untuk operasional cabang?")) {
      return;
    }

    try {
      var res = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(user.branch_id), {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_open_override: newOpen })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast("Status operasional cabang berhasil diubah menjadi " + (newOpen ? "BUKA" : "TUTUP"));
        loadHariIni();
      } else {
        showToast("Gagal mengubah status: " + (data.error || "Terjadi kesalahan"));
      }
    } catch (e) {
      showToast("Kesalahan jaringan.");
    }
  }
  window.toggleBranchOpen = toggleBranchOpen;

  async function toggleBranchOnlineOrders() {
    var user = getStoredUser();
    if (!user || !user.branch_id) return;
    var branch = _hariIniState.branch;
    var curDelivery = branch ? (branch.is_delivery_active !== 0 && branch.is_delivery_active !== false) : true;
    var newDelivery = curDelivery ? 0 : 1;
    var actionName = newDelivery ? "Resume Order Online" : "Pause Order Online";

    if (!confirm("Apakah Anda yakin ingin melakukan " + actionName + " untuk cabang ini?")) {
      return;
    }

    try {
      var res = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(user.branch_id), {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_delivery_active: newDelivery })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast("Layanan pesanan online cabang berhasil " + (newDelivery ? "DIAKTIFKAN" : "DIJEDA"));
        loadHariIni();
        if (typeof loadBMJamOperasional === 'function') loadBMJamOperasional();
      } else {
        showToast("Gagal mengubah status: " + (data.error || "Terjadi kesalahan"));
      }
    } catch (e) {
      showToast("Kesalahan jaringan.");
    }
  }
  window.toggleBranchOnlineOrders = toggleBranchOnlineOrders;

  async function quickAcceptBMOrder(orderId, btnEl) {
    if (!confirm("Terima pesanan #" + orderId + "? Dapur akan mulai menyiapkan pesanan.")) return;
    if (_bmOrdersState.inFlightAccept[orderId]) return;
    _bmOrdersState.inFlightAccept[orderId] = true;

    if (btnEl) {
      btnEl.disabled = true;
      btnEl.dataset.originalText = btnEl.innerHTML;
      btnEl.innerHTML = 'Memproses...';
    }

    try {
      var res = await adminFetch(API_BASE + "/orders/" + encodeURIComponent(orderId) + "/branch-acceptance", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ decision: "accept", note: "Diterima melalui Aksi Cepat Dashboard" })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast("Pesanan #" + orderId + " berhasil diterima.");
        loadHariIni();
        if (typeof loadBMOrders === 'function') loadBMOrders({ background: true });
      } else {
        showToast("Gagal menerima pesanan: " + (data.error || "Terjadi kesalahan"));
        loadHariIni();
        if (typeof loadBMOrders === 'function') loadBMOrders();
      }
    } catch (e) {
      showToast("Kesalahan jaringan.");
    } finally {
      delete _bmOrdersState.inFlightAccept[orderId];
      if (btnEl) {
        btnEl.disabled = false;
        if (btnEl.dataset.originalText) btnEl.innerHTML = btnEl.dataset.originalText;
      }
    }
  }
  window.quickAcceptBMOrder = quickAcceptBMOrder;

  function quickRejectBMOrder(orderId) {
    openBMRejectModal(orderId, 'hari-ini');
  }
  window.quickRejectBMOrder = quickRejectBMOrder;

  /* =========================================================================
     BM-4: STAF OPERASIONAL CABANG (BRANCH-SCOPED WORKFORCE)
     ========================================================================= */
  var _bmStaffState = {
    users: [],
    fetchSeq: 0
  };

  async function loadBMStaff() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var tbody = $('bm-staff-tbody');
    if (tbody && (!_bmStaffState.users || !_bmStaffState.users.length)) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Memuat daftar staf cabang...</td></tr>';
    }

    var currentSeq = ++_bmStaffState.fetchSeq;

    try {
      var res = await adminFetch(API_BASE + '/admin/users?limit=100&branch_id=' + encodeURIComponent(branchId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (currentSeq !== _bmStaffState.fetchSeq) return;

      if (res.ok && data.success && Array.isArray(data.users)) {
        _bmStaffState.users = data.users;
        renderBMStaffTable(data.users);
      } else {
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Gagal memuat staf cabang: ' + esc(data.error || 'Terjadi kesalahan') + '</td></tr>';
        }
      }
    } catch (err) {
      if (currentSeq !== _bmStaffState.fetchSeq) return;
      console.warn('[BM Staff Load Error]:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat staf.</td></tr>';
      }
    }
  }
  window.loadBMStaff = loadBMStaff;

  function renderBMStaffTable(users) {
    var tbody = $('bm-staff-tbody');
    if (!tbody) return;

    var totalCount = (users || []).length;
    var activeCount = (users || []).filter(function (u) { return u.status === 'active'; }).length;
    var inactiveCount = totalCount - activeCount;

    if ($('bm-staff-stat-total')) $('bm-staff-stat-total').textContent = totalCount;
    if ($('bm-staff-stat-active')) $('bm-staff-stat-active').textContent = activeCount;
    if ($('bm-staff-stat-inactive')) $('bm-staff-stat-inactive').textContent = inactiveCount;

    if (!users || !users.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Belum ada staf kasir atau operasional terdaftar di cabang ini.</td></tr>';
      return;
    }

    var myId = (getStoredUser() || {}).id;

    tbody.innerHTML = users.map(function (u) {
      var isMe = u.id === myId;
      var isActive = u.status === 'active';
      var roleBadge = u.role === 'cashier'
        ? '<span class="x-badge x-badge-warning">KASIR</span>'
        : (u.role === 'kitchen' ? '<span class="x-badge" style="background:#ede9fe;color:#6d28d9;">DAPUR</span>' : '<span class="x-badge x-badge-info">' + esc(u.role).toUpperCase() + '</span>');

      var statusToggle = '' +
        '<label class="x-toggle' + (isActive ? ' x-toggle-on' : '') + '" style="margin:0 auto;display:inline-block;vertical-align:middle;">' +
          '<input type="checkbox" ' + (isActive ? 'checked ' : '') + (isMe ? 'disabled ' : '') +
            'onchange="toggleBMStaffStatus(\'' + u.id + '\', \'' + esc(u.full_name) + '\', this)">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      var actions = '';
      if (isMe) {
        actions = '<span class="text-muted" style="font-size:11px;">Akun Anda</span>';
      } else {
        actions = '<div style="display:flex; justify-content:flex-end; gap:6px;">' +
          '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="openEditUser(\'' + u.id + '\')">Edit</button>' +
          '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="resetBMStaffPassword(\'' + u.id + '\', \'' + esc(u.full_name) + '\')">Reset Password</button>' +
        '</div>';
      }

      return '<tr>' +
        '<td><strong>' + esc(u.full_name) + '</strong></td>' +
        '<td><code style="font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px;">' + esc(u.username) + '</code></td>' +
        '<td>' + roleBadge + '</td>' +
        '<td style="color:var(--text-muted);">' + esc(u.email || '—') + '</td>' +
        '<td class="text-center" style="vertical-align:middle;text-align:center;">' + statusToggle + '</td>' +
        '<td class="text-right" style="white-space:nowrap;vertical-align:middle;">' + actions + '</td>' +
      '</tr>';
    }).join('');
  }

  function openBMAddCashierModal() {
    if (typeof openCreateUserModal === 'function') {
      openCreateUserModal();
      var roleSelect = $('user-role');
      if (roleSelect) {
        roleSelect.innerHTML = '<option value="cashier" selected>Kasir</option>';
        roleSelect.value = 'cashier';
      }
      var branchSelect = $('user-branch');
      var user = getStoredUser();
      if (branchSelect && user && user.branch_id) {
        branchSelect.value = user.branch_id;
        branchSelect.disabled = true;
      }
    }
  }
  window.openBMAddCashierModal = openBMAddCashierModal;

  async function toggleBMStaffStatus(userId, name, inputElem) {
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
      if (!confirm('Nonaktifkan akun kasir "' + name + '"? Kasir ini tidak akan bisa login sampai diaktifkan kembali.')) {
        revert();
        return;
      }
    }

    if (inputElem) inputElem.disabled = true;

    try {
      var endpoint = willActivate ? '/enable' : '/disable';
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + endpoint, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Akun "' + name + '" berhasil ' + (willActivate ? 'diaktifkan.' : 'dinonaktifkan.'));
        loadBMStaff();
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
        revert();
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
      revert();
    }
  }
  window.toggleBMStaffStatus = toggleBMStaffStatus;

  async function resetBMStaffPassword(userId, name) {
    if (!confirm('Generate token reset password untuk kasir "' + name + '"? Token hanya dapat dilihat sekali.')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + '/reset-password', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success && data.reset_token) {
        if ($('reset-password-user-name')) $('reset-password-user-name').value = name;
        if ($('reset-password-token')) $('reset-password-token').value = data.reset_token;
        if ($('modal-reset-password')) $('modal-reset-password').style.display = 'flex';
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.resetBMStaffPassword = resetBMStaffPassword;

  /* =========================================================================
     BM-4: JAM OPERASIONAL & JADWAL CABANG
     ========================================================================= */
  async function loadBMJamOperasional() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success && data.branch) {
        var b = data.branch;
        var isOpen = b.is_open_override === 1 || b.is_open_override === true;
        var isDeliveryActive = b.is_delivery_active !== 0 && b.is_delivery_active !== false;

        var statusText = $('bm-jam-status-text');
        var toggleOpenBtn = $('btn-bm-jam-toggle-open');
        if (statusText) {
          statusText.innerHTML = isOpen
            ? '<span class="x-badge x-badge-success" style="font-size:11px;">BUKA (Operational Active)</span>'
            : '<span class="x-badge x-badge-danger" style="font-size:11px;">TUTUP SEMENTARA</span>';
        }
        if (toggleOpenBtn) {
          toggleOpenBtn.textContent = isOpen ? 'Tutup Toko' : 'Buka Toko';
          toggleOpenBtn.className = isOpen ? 'x-btn-secondary' : 'x-btn-primary';
        }

        var deliveryText = $('bm-jam-delivery-text');
        var toggleDeliveryBtn = $('btn-bm-jam-toggle-delivery');
        if (deliveryText) {
          deliveryText.innerHTML = isDeliveryActive
            ? '<span class="x-badge x-badge-success" style="font-size:11px;">AKTIF (Menerima Pesanan Online)</span>'
            : '<span class="x-badge x-badge-warning" style="font-size:11px;">DIJEDA (Online Orders Paused)</span>';
        }
        if (toggleDeliveryBtn) {
          toggleDeliveryBtn.textContent = isDeliveryActive ? 'Jeda Pesanan Online' : 'Aktifkan Layanan Online';
          toggleDeliveryBtn.className = isDeliveryActive ? 'x-btn-secondary' : 'x-btn-primary';
        }
      }
    } catch (err) {
      console.warn('[BM Jam Operasional Load Error]:', err);
    }
  }
  window.loadBMJamOperasional = loadBMJamOperasional;

  /* =========================================================================
     BM-5: LAPORAN OPERASIONAL HARIAN CABANG
     ========================================================================= */
  async function loadBMReports() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/orders?status=all', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success && Array.isArray(data.orders)) {
        var orders = data.orders;
        var todayStr = new Date().toISOString().substring(0, 10);

        var todayOrders = orders.filter(function (o) {
          return (o.created_at || '').substring(0, 10) === todayStr;
        });

        var completedOrders = todayOrders.filter(function (o) {
          return o.status === 'completed';
        });

        var netSales = completedOrders.reduce(function (acc, o) {
          return acc + (Number(o.grand_total) || 0);
        }, 0);

        var aov = completedOrders.length > 0 ? Math.round(netSales / completedOrders.length) : 0;

        if ($('bm-report-stat-sales')) $('bm-report-stat-sales').textContent = formatMoney(netSales);
        if ($('bm-report-stat-total-orders')) $('bm-report-stat-total-orders').textContent = todayOrders.length;
        if ($('bm-report-stat-completed-orders')) $('bm-report-stat-completed-orders').textContent = completedOrders.length + ' pesanan selesai';
        if ($('bm-report-stat-aov')) $('bm-report-stat-aov').textContent = formatMoney(aov);

        // Breakdown by channel (completed today)
        var deliveryOrders = completedOrders.filter(function (o) { return o.order_type === 'delivery'; });
        var pickupOrders = completedOrders.filter(function (o) { return o.order_type === 'pickup'; });
        var dineInOrders = completedOrders.filter(function (o) { return o.order_type === 'dine_in'; });

        var deliverySales = deliveryOrders.reduce(function (acc, o) { return acc + (Number(o.grand_total) || 0); }, 0);
        var pickupSales = pickupOrders.reduce(function (acc, o) { return acc + (Number(o.grand_total) || 0); }, 0);
        var dineInSales = dineInOrders.reduce(function (acc, o) { return acc + (Number(o.grand_total) || 0); }, 0);

        if ($('bm-report-channel-delivery')) $('bm-report-channel-delivery').textContent = deliveryOrders.length;
        if ($('bm-report-channel-delivery-sales')) $('bm-report-channel-delivery-sales').textContent = formatMoney(deliverySales);

        if ($('bm-report-channel-pickup')) $('bm-report-channel-pickup').textContent = pickupOrders.length;
        if ($('bm-report-channel-pickup-sales')) $('bm-report-channel-pickup-sales').textContent = formatMoney(pickupSales);

        if ($('bm-report-channel-dinein')) $('bm-report-channel-dinein').textContent = dineInOrders.length;
        if ($('bm-report-channel-dinein-sales')) $('bm-report-channel-dinein-sales').textContent = formatMoney(dineInSales);

        // Recent completed table
        var tbody = $('bm-report-completed-tbody');
        if (tbody) {
          if (!completedOrders.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">Belum ada pesanan selesai hari ini.</td></tr>';
          } else {
            tbody.innerHTML = completedOrders.slice(0, 5).map(function (o) {
              var typeBadge = (o.order_type === 'delivery')
                ? '<span class="x-badge x-badge-info">DELIVERY</span>'
                : (o.order_type === 'dine_in' ? '<span class="x-badge" style="background:#ede9fe;color:#6d28d9;">DINE IN</span>' : '<span class="x-badge x-badge-warning">PICKUP</span>');
              return '<tr>' +
                '<td><strong>' + esc(o.order_number || o.id) + '</strong></td>' +
                '<td>' + esc(o.customer_name || 'Pelanggan') + '</td>' +
                '<td>' + typeBadge + '</td>' +
                '<td><strong style="color:var(--accent-teal);">' + formatMoney(o.grand_total) + '</strong></td>' +
              '</tr>';
            }).join('');
          }
        }
      }
    } catch (err) {
      console.warn('[BM Reports Load Error]:', err);
    }
  }
  window.loadBMReports = loadBMReports;

  /* =========================================================================
     BM-2: OPERASIONAL PESANAN & MEJA (BRANCH MANAGER OPERATIONAL CENTER)
     ========================================================================= */
  var _bmOrdersState = {
    orders: [],
    searchQuery: '',
    statusFilter: 'all',
    typeFilter: 'all',
    pollTimer: null,
    fetchSeq: 0,
    inFlightAccept: {},
    inFlightStatus: {},
    currentDetailOrderId: null,
    detailCountdownTimer: null,
    seenPendingOrderIds: null, // Set of order IDs seen as pending in previous authoritative poll
    newPendingOrderIds: {}     // Map of order IDs that are genuinely new in current snapshot
  };

  var _bmTablesState = {
    tables: [],
    filterStatus: 'all',
    fetchSeq: 0
  };

  /* =========================================================================
     BM-3: OPERASIONAL MENU, STOK & PROMO (BRANCH MANAGER OPERATIONAL CENTER)
     ========================================================================= */
  var _bmMenuState = {
    products: [],
    categories: [],
    availableProducts: [],
    searchQuery: '',
    statusFilter: 'all',
    categoryFilter: 'all',
    addCatalogSearchQuery: '',
    fetchSeq: 0
  };

  // The shared branch-catalog module reads BM menu categories from this state.
  if (window.XentraBranchCatalog) window.XentraBranchCatalog.setBmMenuState(_bmMenuState);

  var _bmStockState = {
    inventory: [],
    searchQuery: '',
    statusFilter: 'all',
    fetchSeq: 0
  };

  var _bmPromoState = {
    promotions: [],
    redemptions: [],
    fetchSeq: 0
  };

  function stopBMOrdersPolling() {
    if (_bmOrdersState.pollTimer) {
      clearInterval(_bmOrdersState.pollTimer);
      _bmOrdersState.pollTimer = null;
    }
  }

  function startBMOrdersPolling() {
    stopBMOrdersPolling();
    _bmOrdersState.pollTimer = setInterval(function () {
      if (document.visibilityState === 'hidden') return;
      loadBMOrders({ background: true });
    }, 10000);
  }

  window.startBMOrdersPolling = startBMOrdersPolling;
  window.stopBMOrdersPolling = stopBMOrdersPolling;

  // Browser-local audible chime for genuinely new pending orders (Web Audio API synthesis)
  // Fails gracefully if browser autoplay policy blocks un-interacted audio without spamming errors
  function playNewOrderAudibleChime() {
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      var ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        // Autoplay blocked by browser policy before user interaction; fail gracefully
        ctx.close().catch(function () {});
        return;
      }
      var now = ctx.currentTime;
      var osc1 = ctx.createOscillator();
      var osc2 = ctx.createOscillator();
      var gain = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);        // A5 note
      osc1.frequency.setValueAtTime(1174.66, now + 0.15); // D6 note

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(440, now);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.5);
      osc2.stop(now + 0.5);

      setTimeout(function () {
        ctx.close().catch(function () {});
      }, 700);
    } catch (_) {
      // Ignore audio failure cleanly
    }
  }

  async function loadBMOrders(opts) {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var isBg = opts && opts.background;
    var tbody = $('bm-orders-tbody');
    var cardsContainer = $('bm-orders-cards-container');
    if (tbody && !isBg && (!_bmOrdersState.orders || !_bmOrdersState.orders.length)) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-muted">Memuat antrean pesanan cabang...</td></tr>';
    }
    if (cardsContainer && !isBg && (!_bmOrdersState.orders || !_bmOrdersState.orders.length)) {
      cardsContainer.innerHTML = '<div class="text-center py-6 text-muted">Memuat antrean pesanan cabang...</div>';
    }

    var currentSeq = ++_bmOrdersState.fetchSeq;

    try {
      var queryParams = [];
      if (_bmOrdersState.statusFilter && _bmOrdersState.statusFilter !== 'all') {
        queryParams.push('status=' + encodeURIComponent(_bmOrdersState.statusFilter));
      }
      var qs = queryParams.length ? ('?' + queryParams.join('&')) : '';
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/orders' + qs, {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (currentSeq !== _bmOrdersState.fetchSeq) return;

      if (res.ok && data.success && Array.isArray(data.orders)) {
        var currentPendingOrders = data.orders.filter(function (o) { return o.status === 'pending'; });
        var currentPendingIds = {};
        currentPendingOrders.forEach(function (o) { currentPendingIds[o.id] = true; });

        if (_bmOrdersState.seenPendingOrderIds !== null) {
          var newlyAppeared = [];
          currentPendingOrders.forEach(function (o) {
            if (!_bmOrdersState.seenPendingOrderIds[o.id]) {
              newlyAppeared.push(o.id);
            }
          });

          if (newlyAppeared.length > 0) {
            newlyAppeared.forEach(function (id) {
              _bmOrdersState.newPendingOrderIds[id] = true;
            });
            playNewOrderAudibleChime();
          }
        } else {
          // Initial snapshot boot: baseline established, do not sound alert on first page load
          _bmOrdersState.newPendingOrderIds = {};
        }

        // Clean up attention for orders that are no longer pending
        Object.keys(_bmOrdersState.newPendingOrderIds).forEach(function (id) {
          if (!currentPendingIds[id]) {
            delete _bmOrdersState.newPendingOrderIds[id];
          }
        });

        // Store authoritative seen set
        _bmOrdersState.seenPendingOrderIds = currentPendingIds;
        _bmOrdersState.orders = data.orders;

        renderBMOrdersTable();
      } else {
        if (tbody && !isBg) {
          tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-danger">Gagal memuat pesanan: ' + esc(data.error || 'Terjadi kesalahan') + '</td></tr>';
        }
        if (cardsContainer && !isBg) {
          cardsContainer.innerHTML = '<div class="text-center py-6 text-danger">Gagal memuat pesanan: ' + esc(data.error || 'Terjadi kesalahan') + '</div>';
        }
      }
    } catch (err) {
      if (currentSeq !== _bmOrdersState.fetchSeq) return;
      console.warn('[BM Orders Load Error]:', err);
      if (tbody && !isBg) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat pesanan.</td></tr>';
      }
      if (cardsContainer && !isBg) {
        cardsContainer.innerHTML = '<div class="text-center py-6 text-danger">Kesalahan jaringan saat memuat pesanan.</div>';
      }
    }
  }
  window.loadBMOrders = loadBMOrders;

  function onBMOrdersFilterChange() {
    var searchEl = $('bm-orders-search');
    var statusEl = $('bm-orders-filter-status');
    var typeEl = $('bm-orders-filter-type');

    if (searchEl) _bmOrdersState.searchQuery = searchEl.value.trim().toLowerCase();
    if (statusEl) _bmOrdersState.statusFilter = statusEl.value;
    if (typeEl) _bmOrdersState.typeFilter = typeEl.value;

    loadBMOrders();
  }
  window.onBMOrdersFilterChange = onBMOrdersFilterChange;

  function formatBMTimeRemaining(ms) {
    if (ms <= 0) return '00:00';
    var totalSec = Math.floor(ms / 1000);
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }

  function renderBMOrdersTable() {
    var tbody = $('bm-orders-tbody');
    var cardsContainer = $('bm-orders-cards-container');
    if (!tbody && !cardsContainer) return;

    var filtered = (_bmOrdersState.orders || []).filter(function (ord) {
      if (_bmOrdersState.typeFilter && _bmOrdersState.typeFilter !== 'all') {
        var ordType = ord.order_type || ord.fulfillment_type || 'delivery';
        if (ordType !== _bmOrdersState.typeFilter) return false;
      }
      if (_bmOrdersState.searchQuery) {
        var q = _bmOrdersState.searchQuery;
        var num = (ord.order_number || ord.id || '').toLowerCase();
        var cust = (ord.customer_name || '').toLowerCase();
        var phone = (ord.customer_phone || '').toLowerCase();
        if (num.indexOf(q) === -1 && cust.indexOf(q) === -1 && phone.indexOf(q) === -1) {
          return false;
        }
      }
      return true;
    });

    // Deterministic pending-first sorting without mutating server orders array:
    // 1. Genuinely new pending orders (tier 0)
    // 2. Existing pending orders (tier 1)
    // 3. Other orders preserved in original server order (tier 2)
    var sorted = filtered.slice().sort(function (a, b) {
      var aIsPending = (a.status === 'pending');
      var bIsPending = (b.status === 'pending');
      var aIsNew = aIsPending && !!_bmOrdersState.newPendingOrderIds[a.id];
      var bIsNew = bIsPending && !!_bmOrdersState.newPendingOrderIds[b.id];

      var aRank = aIsNew ? 0 : (aIsPending ? 1 : 2);
      var bRank = bIsNew ? 0 : (bIsPending ? 1 : 2);

      if (aRank !== bRank) return aRank - bRank;
      return 0; // Preserve relative server order
    });

    if (!sorted.length) {
      var emptyMsg = 'Belum ada pesanan yang sesuai filter.';
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-muted">' + emptyMsg + '</td></tr>';
      }
      if (cardsContainer) {
        cardsContainer.innerHTML = '<div class="text-center py-6 text-muted">' + emptyMsg + '</div>';
      }
      return;
    }

    var statusBadges = {
      pending: '<span class="x-badge x-badge-warning">MENUNGGU KONFIRMASI</span>',
      confirmed: '<span class="x-badge x-badge-info">DITERIMA (CONFIRMED)</span>',
      preparing: '<span class="x-badge x-badge-info">SEDANG DISIAPKAN</span>',
      ready: '<span class="x-badge x-badge-success">SIAP (READY)</span>',
      out_for_delivery: '<span class="x-badge x-badge-info">PENGIRIMAN</span>',
      completed: '<span class="x-badge x-badge-success">SELESAI</span>',
      rejected: '<span class="x-badge x-badge-danger">DITOLAK</span>',
      cancelled: '<span class="x-badge x-badge-danger">DIBATALKAN</span>',
      timeout: '<span class="x-badge x-badge-danger">TIMEOUT</span>'
    };

    var now = Date.now();

    var rowsHtml = [];
    var cardsHtml = [];

    sorted.forEach(function (ord) {
      var ordType = ord.order_type || ord.fulfillment_type || 'delivery';
      var typeBadge = (ordType === 'delivery')
        ? '<span class="x-badge x-badge-info">DELIVERY</span>'
        : (ordType === 'dine_in' ? '<span class="x-badge" style="background:#ede9fe;color:#6d28d9;">DINE-IN</span>' : '<span class="x-badge x-badge-warning">PICKUP</span>');

      var timeStr = (ord.created_at || '').substring(11, 16) || '—';
      var tableInfo = ord.table_number ? ('Meja ' + esc(ord.table_number)) : '—';
      var totalStr = formatMoney(ord.grand_total || ord.subtotal || 0);

      var isNewPending = (ord.status === 'pending') && !!_bmOrdersState.newPendingOrderIds[ord.id];

      // Build deadline / status representation (shared logic)
      var statusBadgeHtml = statusBadges[ord.status] || ('<span class="x-badge">' + esc(ord.status.toUpperCase()) + '</span>');
      var countdownHtml = '';
      if (ord.status === 'pending') {
        if (!ord.acceptance_deadline_at) {
          countdownHtml = '<div style="font-size:11px; font-weight:700; color:#b45309; margin-top:3px;">⏱ Memeriksa status...</div>';
          if (!_bmOrdersState.refreshPendingTimeout) {
            _bmOrdersState.refreshPendingTimeout = setTimeout(function () {
              _bmOrdersState.refreshPendingTimeout = null;
              loadBMOrders({ background: true });
            }, 3000);
          }
        } else {
          var expiresAtMs = new Date(ord.acceptance_deadline_at).getTime();
          if (isNaN(expiresAtMs)) {
            countdownHtml = '<div style="font-size:11px; font-weight:700; color:#6b7280; margin-top:3px;">⏱ Deadline tidak tersedia</div>';
          } else {
            var remainingMs = expiresAtMs - now;
            if (remainingMs > 0) {
              countdownHtml = '<div style="font-size:11px; font-weight:700; color:#b45309; margin-top:3px;">⏱ ' + formatBMTimeRemaining(remainingMs) + '</div>';
            } else {
              countdownHtml = '<div style="font-size:11px; font-weight:700; color:#dc2626; margin-top:3px;">⏱ Memeriksa status...</div>';
              if (!_bmOrdersState.refreshPendingTimeout) {
                _bmOrdersState.refreshPendingTimeout = setTimeout(function () {
                  _bmOrdersState.refreshPendingTimeout = null;
                  loadBMOrders({ background: true });
                }, 3000);
              }
            }
          }
        }
      }

      var statusCol = statusBadgeHtml + countdownHtml;
      var isAccepting = !!_bmOrdersState.inFlightAccept[ord.id];
      var isMutatingStatus = !!(_bmOrdersState.inFlightStatus && _bmOrdersState.inFlightStatus[ord.id]);

      // --- Actions HTML for Desktop Table ---
      var actionsHtml = '';
      if (ord.status === 'pending') {
        actionsHtml =
          '<div style="display:flex; gap:6px; justify-content:flex-end;">' +
            '<button type="button" class="x-btn-primary" style="font-size:11px; padding:4px 8px;" ' + (isAccepting ? 'disabled' : '') + ' onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'pending\', \'' + esc(ordType) + '\', this)">' + (isAccepting ? 'Memproses...' : 'Terima') + '</button>' +
            '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px; color:#dc2626; border-color:#fecaca;" ' + (isAccepting ? 'disabled' : '') + ' onclick="rejectBMOrder(\'' + esc(ord.id) + '\')">Tolak</button>' +
            '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Detail</button>' +
          '</div>';
      } else if (ord.status === 'confirmed' || ord.status === 'preparing') {
        var kitchenNextLabel = ord.status === 'confirmed' ? 'Mulai Masak' : 'Tandai Siap';
        actionsHtml =
          '<div style="display:flex; gap:6px; justify-content:flex-end;">' +
            '<button type="button" class="x-btn-primary" style="font-size:11px; padding:4px 8px;" ' + (isMutatingStatus ? 'disabled' : '') + ' onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'' + esc(ord.status) + '\', \'' + esc(ordType) + '\', this)">' + kitchenNextLabel + '</button>' +
            '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Detail</button>' +
          '</div>';
      } else if (ord.status === 'ready') {
        var nextLabel = (ordType === 'delivery') ? 'Kirim Pesanan ➔' : 'Selesaikan ➔';
        actionsHtml =
          '<div style="display:flex; gap:6px; justify-content:flex-end;">' +
            '<button type="button" class="x-btn-primary" style="font-size:11px; padding:4px 8px;" ' + (isMutatingStatus ? 'disabled' : '') + ' onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'ready\', \'' + esc(ordType) + '\', this)">' + nextLabel + '</button>' +
            '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Detail</button>' +
          '</div>';
      } else if (ord.status === 'out_for_delivery') {
        // Completion is recorded by the Driver lifecycle.
        actionsHtml =
          '<div style="display:flex; gap:6px; justify-content:flex-end; align-items:center;">' +
            '<small class="text-muted" style="font-size:11px; font-weight:700;">Dalam pengantaran</small>' +
            '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Detail</button>' +
          '</div>';
      } else {
        // Terminal states: completed, rejected, cancelled, timeout
        actionsHtml =
          '<div style="display:flex; gap:6px; justify-content:flex-end;">' +
            '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Detail</button>' +
          '</div>';
      }

      rowsHtml.push(
        '<tr>' +
          '<td><strong>#' + esc(ord.order_number || ord.id.substring(0, 8)) + '</strong></td>' +
          '<td><small class="text-muted">' + timeStr + '</small></td>' +
          '<td><strong>' + esc(ord.customer_name || 'Pelanggan') + '</strong><br><small class="text-muted">' + esc(ord.customer_phone || '—') + '</small></td>' +
          '<td>' + typeBadge + '</td>' +
          '<td>' + tableInfo + '</td>' +
          '<td><strong>' + totalStr + '</strong></td>' +
          '<td>' + statusCol + '</td>' +
          '<td class="text-right">' + actionsHtml + '</td>' +
        '</tr>'
      );

      // --- Operational Mobile Card HTML ---
      var cardActionsHtml = '';
      if (ord.status === 'pending') {
        cardActionsHtml =
          '<div class="bm-order-card-actions">' +
            '<button type="button" class="x-btn-primary" ' + (isAccepting ? 'disabled' : '') + ' onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'pending\', \'' + esc(ordType) + '\', this)" aria-label="Terima Pesanan #' + esc(ord.order_number || ord.id) + '">' + (isAccepting ? 'Memproses...' : 'Terima') + '</button>' +
            '<button type="button" class="x-btn-secondary bm-btn-danger" ' + (isAccepting ? 'disabled' : '') + ' onclick="rejectBMOrder(\'' + esc(ord.id) + '\')" aria-label="Tolak Pesanan #' + esc(ord.order_number || ord.id) + '">Tolak</button>' +
            '<button type="button" class="x-btn-secondary bm-btn-detail" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')" aria-label="Detail Pesanan #' + esc(ord.order_number || ord.id) + '">Detail</button>' +
          '</div>';
      } else if (ord.status === 'confirmed' || ord.status === 'preparing') {
        var kitchenCardNextLabel = ord.status === 'confirmed' ? 'Mulai Masak' : 'Tandai Siap';
        cardActionsHtml =
          '<div class="bm-order-card-actions">' +
            '<button type="button" class="x-btn-primary" ' + (isMutatingStatus ? 'disabled' : '') + ' onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'' + esc(ord.status) + '\', \'' + esc(ordType) + '\', this)">' + kitchenCardNextLabel + '</button>' +
            '<button type="button" class="x-btn-secondary bm-btn-detail" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Detail</button>' +
          '</div>';
      } else if (ord.status === 'ready') {
        var cardNextLabel = (ordType === 'delivery') ? 'Kirim Pesanan ➔' : 'Selesaikan ➔';
        cardActionsHtml =
          '<div class="bm-order-card-actions">' +
            '<button type="button" class="x-btn-primary" ' + (isMutatingStatus ? 'disabled' : '') + ' onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'ready\', \'' + esc(ordType) + '\', this)">' + cardNextLabel + '</button>' +
            '<button type="button" class="x-btn-secondary bm-btn-detail" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Detail</button>' +
          '</div>';
      } else if (ord.status === 'out_for_delivery') {
        cardActionsHtml =
          '<div class="bm-order-card-actions">' +
            '<small class="text-muted" style="flex:1; font-size:12px; font-weight:700;">Dalam pengantaran (kurir)</small>' +
            '<button type="button" class="x-btn-secondary bm-btn-detail" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Detail</button>' +
          '</div>';
      } else {
        cardActionsHtml =
          '<div class="bm-order-card-actions">' +
            '<button type="button" class="x-btn-secondary" style="width:100%;" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Lihat Detail Pesanan</button>' +
          '</div>';
      }

      var newAttentionClass = isNewPending ? ' bm-order-card-attention' : '';
      var newAttentionBadge = isNewPending ? '<span class="x-badge x-badge-warning" style="animation:none; font-size:10px;">BARU</span>' : '';

      cardsHtml.push(
        '<article class="bm-order-card' + newAttentionClass + '" data-order-id="' + esc(ord.id) + '" aria-labelledby="bm-card-title-' + esc(ord.id) + '">' +
          '<div class="bm-order-card-header">' +
            '<div class="bm-order-card-title-group">' +
              '<span id="bm-card-title-' + esc(ord.id) + '" class="bm-order-card-number">#' + esc(ord.order_number || ord.id.substring(0, 8)) + '</span>' +
              newAttentionBadge +
            '</div>' +
            '<span class="bm-order-card-time">' + timeStr + '</span>' +
          '</div>' +
          '<div class="bm-order-card-meta">' +
            '<div class="bm-order-card-customer">' + esc(ord.customer_name || 'Pelanggan') + '</div>' +
            '<div class="bm-order-card-phone">' + esc(ord.customer_phone || '—') + '</div>' +
            '<div class="bm-order-card-badges">' +
              typeBadge +
              (ord.table_number ? ('<span class="bm-order-card-table">• Meja ' + esc(ord.table_number) + '</span>') : '') +
            '</div>' +
          '</div>' +
          '<div class="bm-order-card-summary">' +
            '<div class="bm-order-card-total-wrap">' +
              '<span class="bm-order-card-total-label">Total Pesanan</span>' +
              '<span class="bm-order-card-total-val">' + totalStr + '</span>' +
            '</div>' +
            '<div class="bm-order-card-status-wrap">' +
              statusBadgeHtml +
              countdownHtml +
            '</div>' +
          '</div>' +
          cardActionsHtml +
        '</article>'
      );
    });

    if (tbody) {
      tbody.innerHTML = rowsHtml.join('');
    }
    if (cardsContainer) {
      cardsContainer.innerHTML = cardsHtml.join('');
    }
  }

  async function advanceBMOrderStatus(orderId, currentStatus, fulfillmentType, btnEl) {
    if (currentStatus === 'pending') {
      if (!confirm('Terima pesanan #' + orderId + '? Dapur akan mulai mempersiapkan pesanan.')) return;
      if (_bmOrdersState.inFlightAccept[orderId]) return;
      _bmOrdersState.inFlightAccept[orderId] = true;

      if (btnEl) {
        btnEl.disabled = true;
        btnEl.dataset.originalText = btnEl.innerHTML;
        btnEl.innerHTML = 'Memproses...';
      }

      try {
        var res = await adminFetch(API_BASE + '/orders/' + encodeURIComponent(orderId) + '/branch-acceptance', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ decision: 'accept', note: 'Diterima oleh Branch Manager' })
        });
        var data = await res.json();
        if (res.ok && data.success) {
          showToast('Pesanan berhasil diterima (CONFIRMED).');
          loadBMOrders();
          if (typeof loadHariIni === 'function') loadHariIni();
          var detailView = $('bm-orders-detail-view');
          if (detailView && detailView.style.display !== 'none' && _bmOrdersState.currentDetailOrderId === orderId) {
            viewBMOrderDetail(orderId);
          }
        } else {
          showToast('Gagal menerima pesanan: ' + (data.error || 'Terjadi kesalahan'));
          loadBMOrders();
          if (typeof loadHariIni === 'function') loadHariIni();
          var detailView = $('bm-orders-detail-view');
          if (detailView && detailView.style.display !== 'none' && _bmOrdersState.currentDetailOrderId === orderId) {
            viewBMOrderDetail(orderId);
          }
        }
      } catch (e) {
        showToast('Kesalahan jaringan.');
      } finally {
        delete _bmOrdersState.inFlightAccept[orderId];
        if (btnEl) {
          btnEl.disabled = false;
          if (btnEl.dataset.originalText) btnEl.innerHTML = btnEl.dataset.originalText;
        }
      }
      return;
    }

    var isDelivery = (fulfillmentType === 'delivery');
    // MVP: Branch Manager handles the full required operational order flow,
    // including cooking stages. The same Core endpoint and state machine are
    // reused; KDS remains an optional future add-on.
    var nextMap = {
      confirmed: 'preparing',
      preparing: 'ready',
      ready: isDelivery ? 'out_for_delivery' : 'completed'
    };

    var nextStatus = nextMap[currentStatus];
    if (!nextStatus) {
      showToast('Status tidak dapat diubah lagi.');
      return;
    }

    // In-flight / double-click protection for status updates
    _bmOrdersState.inFlightStatus = _bmOrdersState.inFlightStatus || {};
    if (_bmOrdersState.inFlightStatus[orderId]) return;
    _bmOrdersState.inFlightStatus[orderId] = true;

    if (btnEl) {
      btnEl.disabled = true;
      btnEl.dataset.originalText = btnEl.innerHTML;
      btnEl.innerHTML = 'Menyimpan...';
    }

    try {
      // MVP uses this same Core endpoint for BM kitchen-stage actions and
      // dispatch. Future KDS uses the same endpoint with its own role boundary.
      var patchRes = await adminFetch(API_BASE + '/kitchen/orders/' + encodeURIComponent(orderId) + '/status', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: nextStatus, note: 'Status diperbarui oleh Branch Manager' })
      });
      var patchData = await patchRes.json();
      if (patchRes.ok && patchData.success) {
        showToast('Status pesanan berhasil diubah menjadi ' + nextStatus.toUpperCase());
        loadBMOrders();
        if (typeof loadHariIni === 'function') loadHariIni();
        var detailView = $('bm-orders-detail-view');
        if (detailView && detailView.style.display !== 'none' && _bmOrdersState.currentDetailOrderId === orderId) {
          viewBMOrderDetail(orderId);
        }
      } else {
        showToast('Gagal mengubah status: ' + (patchData.message || patchData.error || 'Terjadi kesalahan'));
        loadBMOrders();
        if (typeof loadHariIni === 'function') loadHariIni();
        var detailView = $('bm-orders-detail-view');
        if (detailView && detailView.style.display !== 'none' && _bmOrdersState.currentDetailOrderId === orderId) {
          viewBMOrderDetail(orderId);
        }
      }
    } catch (e) {
      showToast('Kesalahan jaringan saat memperbarui status.');
    } finally {
      delete _bmOrdersState.inFlightStatus[orderId];
      if (btnEl) {
        btnEl.disabled = false;
        if (btnEl.dataset.originalText) btnEl.innerHTML = btnEl.dataset.originalText;
      }
    }
  }
  window.advanceBMOrderStatus = advanceBMOrderStatus;

  /* =========================================================================
     BRANCH ACCEPTANCE: REJECTION MODAL & SUBMIT
     ========================================================================= */
  var _bmRejectOrigin = 'orders';

  function openBMRejectModal(orderId, origin) {
    _bmRejectOrigin = origin || 'orders';
    var modal = $('modal-bm-reject-order');
    var idInput = $('bm-reject-order-id');
    var reasonInput = $('bm-reject-reason-input');
    var errorEl = $('bm-reject-error');
    var subtitle = $('bm-reject-order-subtitle');
    var btnText = $('bm-reject-btn-text');
    var confirmBtn = $('btn-bm-confirm-reject');

    if (idInput) idInput.value = orderId;
    if (reasonInput) reasonInput.value = '';
    if (errorEl) errorEl.style.display = 'none';
    if (subtitle) subtitle.textContent = 'Pesanan #' + orderId;
    if (btnText) btnText.textContent = 'Konfirmasi Tolak Pesanan';
    if (confirmBtn) confirmBtn.disabled = false;

    if (modal) modal.style.display = 'flex';
    if (reasonInput) setTimeout(function () { reasonInput.focus(); }, 50);
  }
  window.openBMRejectModal = openBMRejectModal;

  function closeBMRejectModal() {
    var modal = $('modal-bm-reject-order');
    if (modal) modal.style.display = 'none';
    var idInput = $('bm-reject-order-id');
    if (idInput) idInput.value = '';
  }
  window.closeBMRejectModal = closeBMRejectModal;

  function setBMRejectReason(reasonText) {
    var reasonInput = $('bm-reject-reason-input');
    var errorEl = $('bm-reject-error');
    if (reasonInput) {
      reasonInput.value = reasonText;
      reasonInput.focus();
    }
    if (errorEl) errorEl.style.display = 'none';
  }
  window.setBMRejectReason = setBMRejectReason;

  async function submitBMRejectOrder(event) {
    if (event && event.preventDefault) event.preventDefault();

    var idInput = $('bm-reject-order-id');
    var reasonInput = $('bm-reject-reason-input');
    var errorEl = $('bm-reject-error');
    var confirmBtn = $('btn-bm-confirm-reject');
    var btnText = $('bm-reject-btn-text');

    var orderId = idInput ? idInput.value.trim() : '';
    var reason = reasonInput ? reasonInput.value.trim() : '';

    if (!orderId) {
      closeBMRejectModal();
      return;
    }

    if (!reason) {
      if (errorEl) {
        errorEl.textContent = 'Alasan penolakan wajib diisi untuk catatan audit.';
        errorEl.style.display = 'block';
      }
      if (reasonInput) reasonInput.focus();
      return;
    }

    if (confirmBtn) confirmBtn.disabled = true;
    if (btnText) btnText.textContent = 'Menolak Pesanan...';

    try {
      var res = await adminFetch(API_BASE + '/orders/' + encodeURIComponent(orderId) + '/branch-acceptance', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ decision: 'reject', reason: reason })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Pesanan #' + orderId + ' telah ditolak.');
        closeBMRejectModal();
        if (_bmRejectOrigin === 'hari-ini' && typeof loadHariIni === 'function') {
          loadHariIni();
        }
        loadBMOrders();
        var detailView = $('bm-orders-detail-view');
        if (detailView && detailView.style.display !== 'none' && $('bm-detail-order-number') && $('bm-detail-order-number').textContent.indexOf(orderId) !== -1) {
          viewBMOrderDetail(orderId);
        }
      } else {
        showToast('Gagal menolak pesanan: ' + (data.error || 'Terjadi kesalahan'));
        if (confirmBtn) confirmBtn.disabled = false;
        if (btnText) btnText.textContent = 'Konfirmasi Tolak Pesanan';
        loadBMOrders();
      }
    } catch (e) {
      showToast('Kesalahan jaringan.');
      if (confirmBtn) confirmBtn.disabled = false;
      if (btnText) btnText.textContent = 'Konfirmasi Tolak Pesanan';
    }
  }
  window.submitBMRejectOrder = submitBMRejectOrder;

  function rejectBMOrder(orderId) {
    openBMRejectModal(orderId, 'orders');
  }
  window.rejectBMOrder = rejectBMOrder;

  async function viewBMOrderDetail(orderId) {
    _bmOrdersState.currentDetailOrderId = orderId;
    var listView = $('bm-orders-list-view');
    var detailView = $('bm-orders-detail-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';

    if (_bmOrdersState.detailCountdownTimer) {
      clearInterval(_bmOrdersState.detailCountdownTimer);
      _bmOrdersState.detailCountdownTimer = null;
    }

    if ($('bm-detail-order-number')) $('bm-detail-order-number').textContent = '#' + orderId;
    if ($('bm-detail-items-tbody')) {
      $('bm-detail-items-tbody').innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Memuat rincian pesanan...</td></tr>';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/orders/' + encodeURIComponent(orderId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!res.ok || !data.success || !data.order) {
        showToast('Gagal memuat detail pesanan: ' + (data.error || 'Pesanan tidak ditemukan'));
        closeBMOrderDetail();
        return;
      }

      var ord = data.order;
      if ($('bm-detail-order-number')) $('bm-detail-order-number').textContent = '#' + (ord.order_number || ord.id);
      if ($('bm-detail-status-badge')) {
        $('bm-detail-status-badge').textContent = (ord.status || '').toUpperCase();
        $('bm-detail-status-badge').className = 'x-badge ' + (ord.status === 'completed' || ord.status === 'ready' ? 'x-badge-success' : (ord.status === 'rejected' || ord.status === 'cancelled' || ord.status === 'timeout' ? 'x-badge-danger' : 'x-badge-warning'));
      }

      var ordType = ord.order_type || ord.fulfillment_type || 'delivery';
      if ($('bm-detail-cust-name')) $('bm-detail-cust-name').textContent = ord.customer_name || 'Pelanggan';
      if ($('bm-detail-cust-phone')) $('bm-detail-cust-phone').textContent = ord.customer_phone || '—';
      if ($('bm-detail-fulfillment-badge')) $('bm-detail-fulfillment-badge').textContent = ordType.toUpperCase();
      if ($('bm-detail-order-time')) $('bm-detail-order-time').textContent = ord.created_at ? new Date(ord.created_at).toLocaleString('id-ID') : '—';
      if ($('bm-detail-order-notes')) $('bm-detail-order-notes').textContent = ord.notes || ord.order_notes || '—';

      var tableRow = $('bm-detail-table-row');
      if (tableRow) {
        if (ord.table_number) {
          tableRow.style.display = 'block';
          if ($('bm-detail-table-number')) $('bm-detail-table-number').textContent = 'Meja ' + ord.table_number;
        } else {
          tableRow.style.display = 'none';
        }
      }

      if ($('bm-detail-calc-subtotal')) $('bm-detail-calc-subtotal').textContent = formatMoney(ord.subtotal || 0);
      if ($('bm-detail-calc-delivery')) $('bm-detail-calc-delivery').textContent = formatMoney(ord.delivery_fee || 0);
      if ($('bm-detail-calc-discount')) $('bm-detail-calc-discount').textContent = formatMoney(ord.discount_amount || 0);
      if ($('bm-detail-calc-grandtotal')) $('bm-detail-calc-grandtotal').textContent = formatMoney(ord.grand_total || 0);
      if ($('bm-detail-pay-status')) $('bm-detail-pay-status').textContent = ((ord.payment_method || 'Tunai') + ' (' + (ord.payment_status || 'unpaid') + ')').toUpperCase();

      // P8: Branch Acceptance Warning Banner & Countdown
      var acceptanceBanner = $('bm-detail-acceptance-banner');
      var countdownText = $('bm-detail-countdown-text');

      if (acceptanceBanner) {
        if (ord.status === 'pending') {
          acceptanceBanner.style.display = 'block';

          if (!ord.acceptance_deadline_at) {
            if (countdownText) countdownText.textContent = 'Memeriksa status...';
            _bmOrdersState.detailCountdownTimer = setTimeout(function () {
              _bmOrdersState.detailCountdownTimer = null;
              viewBMOrderDetail(ord.id);
            }, 3000);
          } else {
            var expiresAtMs = new Date(ord.acceptance_deadline_at).getTime();
            if (isNaN(expiresAtMs)) {
              if (countdownText) countdownText.textContent = 'Deadline tidak tersedia';
            } else {
              var updateDetailCountdown = function () {
                var diff = expiresAtMs - Date.now();
                if (diff > 0) {
                  if (countdownText) countdownText.textContent = formatBMTimeRemaining(diff);
                } else {
                  if (countdownText) countdownText.textContent = 'Memeriksa status...';
                  if (_bmOrdersState.detailCountdownTimer) {
                    clearInterval(_bmOrdersState.detailCountdownTimer);
                    _bmOrdersState.detailCountdownTimer = null;
                  }
                  // Authoritative refresh from server; never mutate locally
                  viewBMOrderDetail(ord.id);
                }
              };

              updateDetailCountdown();
              _bmOrdersState.detailCountdownTimer = setInterval(updateDetailCountdown, 1000);
            }
          }
        } else {
          acceptanceBanner.style.display = 'none';
        }
      }

      // Render items
      var tbody = $('bm-detail-items-tbody');
      if (tbody) {
        var items = ord.items || [];
        if (!items.length) {
          tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Tidak ada item dalam pesanan ini.</td></tr>';
        } else {
          tbody.innerHTML = items.map(function (it) {
            var sub = it.item_subtotal != null ? it.item_subtotal : ((it.unit_price || 0) * (it.quantity || 1));
            return '<tr>' +
              '<td><strong>' + esc(it.product_name || it.product_id) + '</strong></td>' +
              '<td>' + formatMoney(it.unit_price || 0) + '</td>' +
              '<td>' + (it.quantity || 1) + '</td>' +
              '<td><small class="text-muted">' + esc(it.note || '—') + '</small></td>' +
              '<td class="text-right"><strong>' + formatMoney(sub) + '</strong></td>' +
            '</tr>';
          }).join('');
        }
      }

      // Render audit logs
      var logsList = $('bm-detail-logs-list');
      if (logsList) {
        var logs = ord.status_logs || [];
        if (!logs.length) {
          logsList.innerHTML = '<span class="text-muted">Tidak ada catatan audit tambahan.</span>';
        } else {
          logsList.innerHTML = logs.map(function (l) {
            var time = l.created_at ? new Date(l.created_at).toLocaleTimeString('id-ID') : '—';
            return '<div style="background:#f8fafc; padding:8px 12px; border-radius:6px; border:1px solid #e2e8f0;">' +
              '<div><strong>' + esc((l.previous_status || 'INIT') + ' ➔ ' + l.new_status) + '</strong> <small class="text-muted">(' + time + ')</small></div>' +
              '<div style="color:var(--text-muted); margin-top:2px;">' + esc(l.note || 'Pembaruan status sistem') + '</div>' +
            '</div>';
          }).join('');
        }
      }

      // Top action buttons in detail
      var topActions = $('bm-detail-actions-top');
      if (topActions) {
        if (ord.status === 'pending') {
          var isAccepting = !!_bmOrdersState.inFlightAccept[ord.id];
          topActions.innerHTML =
            '<button type="button" class="x-btn-primary" style="font-size:13px; padding:6px 14px;" ' + (isAccepting ? 'disabled' : '') + ' onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'pending\', \'' + esc(ordType) + '\', this);">Terima Pesanan</button>' +
            '<button type="button" class="x-btn-secondary" style="font-size:13px; padding:6px 14px; color:#dc2626; border-color:#fecaca;" ' + (isAccepting ? 'disabled' : '') + ' onclick="rejectBMOrder(\'' + esc(ord.id) + '\');">Tolak Pesanan</button>';
        } else if (ord.status === 'confirmed' || ord.status === 'preparing') {
          var detailKitchenLabel = ord.status === 'confirmed' ? 'Mulai Masak' : 'Tandai Siap';
          topActions.innerHTML =
            '<button type="button" class="x-btn-primary" style="font-size:13px; padding:6px 14px;" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'' + esc(ord.status) + '\', \'' + esc(ordType) + '\', this);">' +
            detailKitchenLabel + '</button>';
        } else if (ord.status === 'ready') {
          var label = (ordType === 'delivery') ? 'Kirim Pesanan ➔' : 'Selesaikan Pesanan ➔';
          topActions.innerHTML =
            '<button type="button" class="x-btn-primary" style="font-size:13px; padding:6px 14px;" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'ready\', \'' + esc(ordType) + '\', this);">' + label + '</button>';
        } else if (ord.status === 'out_for_delivery') {
          // Completion is recorded by the Driver lifecycle.
          topActions.innerHTML =
            '<small class="text-muted" style="font-size:12.5px; font-weight:700;">Dalam pengantaran (kurir)</small>';
        } else {
          topActions.innerHTML = '';
        }
      }

    } catch (e) {
      console.warn('[BM Detail Load Error]:', e);
      showToast('Kesalahan jaringan saat memuat detail.');
      closeBMOrderDetail();
    }
  }
  window.viewBMOrderDetail = viewBMOrderDetail;

  function closeBMOrderDetail() {
    _bmOrdersState.currentDetailOrderId = null;
    if (_bmOrdersState.detailCountdownTimer) {
      clearInterval(_bmOrdersState.detailCountdownTimer);
      _bmOrdersState.detailCountdownTimer = null;
    }
    var listView = $('bm-orders-list-view');
    var detailView = $('bm-orders-detail-view');
    if (detailView) detailView.style.display = 'none';
    if (listView) listView.style.display = 'block';
  }
  window.closeBMOrderDetail = closeBMOrderDetail;

  /* =========================================================================
     BM-2: OPERASIONAL MEJA / DINE-IN CONTROLLER
     ========================================================================= */
  async function loadBMTables() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var grid = $('bm-tables-grid');
    if (grid && (!_bmTablesState.tables || !_bmTablesState.tables.length)) {
      grid.innerHTML = '<div class="text-center py-6 text-muted" style="grid-column:1/-1;">Memuat data meja cabang...</div>';
    }

    var currentSeq = ++_bmTablesState.fetchSeq;

    try {
      var res = await adminFetch(API_BASE + '/dine-in/layout?branch_id=' + encodeURIComponent(branchId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (currentSeq !== _bmTablesState.fetchSeq) return;

      if (res.ok && data.success && data.layout && Array.isArray(data.layout.tables)) {
        _bmTablesState.tables = data.layout.tables;
        updateBMTableStats(data.layout.tables);
        renderBMTablesGrid();
      } else {
        if (grid) {
          grid.innerHTML = '<div class="text-center py-6 text-danger" style="grid-column:1/-1;">Gagal memuat meja: ' + esc(data.error || 'Terjadi kesalahan') + '</div>';
        }
      }
    } catch (err) {
      if (currentSeq !== _bmTablesState.fetchSeq) return;
      console.warn('[BM Tables Load Error]:', err);
      if (grid) {
        grid.innerHTML = '<div class="text-center py-6 text-danger" style="grid-column:1/-1;">Kesalahan jaringan saat memuat meja.</div>';
      }
    }
  }
  window.loadBMTables = loadBMTables;

  function updateBMTableStats(tables) {
    var avail = 0, occupied = 0, held = 0, blocked = 0;
    (tables || []).forEach(function (t) {
      var st = t.operational_state || 'available';
      if (st === 'available') avail++;
      else if (st === 'occupied') occupied++;
      else if (st === 'held') held++;
      else if (st === 'blocked' || st === 'out_of_service') blocked++;
    });

    if ($('bm-tables-stat-available')) $('bm-tables-stat-available').textContent = avail;
    if ($('bm-tables-stat-occupied')) $('bm-tables-stat-occupied').textContent = occupied;
    if ($('bm-tables-stat-held')) $('bm-tables-stat-held').textContent = held;
    if ($('bm-tables-stat-blocked')) $('bm-tables-stat-blocked').textContent = blocked;
  }

  function onBMTablesFilterChange() {
    var filterEl = $('bm-tables-filter-status');
    if (filterEl) _bmTablesState.filterStatus = filterEl.value;
    renderBMTablesGrid();
  }
  window.onBMTablesFilterChange = onBMTablesFilterChange;

  function renderBMTablesGrid() {
    var grid = $('bm-tables-grid');
    if (!grid) return;

    var filtered = (_bmTablesState.tables || []).filter(function (t) {
      var st = t.operational_state || 'available';
      if (_bmTablesState.filterStatus === 'available') return st === 'available';
      if (_bmTablesState.filterStatus === 'occupied') return st === 'occupied';
      if (_bmTablesState.filterStatus === 'held') return st === 'held';
      if (_bmTablesState.filterStatus === 'blocked') return (st === 'blocked' || st === 'out_of_service');
      return true;
    });

    if (!filtered.length) {
      grid.innerHTML = '<div class="text-center py-6 text-muted" style="grid-column:1/-1;">Tidak ada meja yang sesuai filter status saat ini.</div>';
      return;
    }

    var stateCardConfigs = {
      available: { bg: '#ffffff', border: '#bbf7d0', badge: '<span class="x-badge x-badge-success">TERSEDIA</span>' },
      occupied: { bg: '#ffffff', border: '#bfdbfe', badge: '<span class="x-badge x-badge-info">TERISI</span>' },
      held: { bg: '#ffffff', border: '#fde68a', badge: '<span class="x-badge x-badge-warning">DITAHAN</span>' },
      blocked: { bg: '#fef2f2', border: '#fecaca', badge: '<span class="x-badge x-badge-danger">DIBLOKIR</span>' },
      out_of_service: { bg: '#fef2f2', border: '#fecaca', badge: '<span class="x-badge x-badge-danger">RUSAK</span>' }
    };

    grid.innerHTML = filtered.map(function (t) {
      var st = t.operational_state || 'available';
      var cfg = stateCardConfigs[st] || stateCardConfigs.available;
      var isBlocked = (st === 'blocked' || st === 'out_of_service');

      var actionsHtml = '';
      if (isBlocked) {
        actionsHtml = '<button type="button" class="x-btn-secondary" style="font-size:12px; padding:6px 12px; width:100%; color:#166534; border-color:#bbf7d0;" onclick="toggleBMTableBlocked(\'' + esc(t.id) + '\', false)">Buka Blokir (Tersedia)</button>';
      } else if (st === 'available') {
        actionsHtml = '<button type="button" class="x-btn-secondary" style="font-size:12px; padding:6px 12px; width:100%; color:#dc2626; border-color:#fecaca;" onclick="toggleBMTableBlocked(\'' + esc(t.id) + '\', true)">Blokir Meja</button>';
      } else if (st === 'occupied' && t.current_session_id) {
        actionsHtml = '<button type="button" class="x-btn-secondary" style="font-size:12px; padding:6px 12px; width:100%;" onclick="completeBMTableSession(\'' + esc(t.current_session_id) + '\')">Selesaikan Sesi Makan</button>';
      } else {
        actionsHtml = '<button type="button" class="x-btn-secondary" style="font-size:12px; padding:6px 12px; width:100%;" disabled>Sedang Digunakan</button>';
      }

      return '<div class="x-card" style="padding:16px; border:1px solid ' + cfg.border + '; border-radius:10px; background:' + cfg.bg + '; display:flex; flex-direction:column; justify-content:space-between; min-height:160px;">' +
        '<div>' +
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">' +
            '<h4 style="font-size:16px; font-weight:800; margin:0; color:var(--text-main);">' + esc(t.label || ('Meja ' + t.table_number)) + '</h4>' +
            cfg.badge +
          '</div>' +
          '<div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">Kapasitas: <strong>' + (t.capacity || 4) + ' Kursi</strong></div>' +
          (t.notes ? ('<div style="font-size:11px; color:#b91c1c; margin-bottom:8px; font-style:italic;">Catatan: ' + esc(t.notes) + '</div>') : '') +
        '</div>' +
        '<div style="margin-top:12px;">' + actionsHtml +
          '<button type="button" class="x-btn-secondary" style="font-size:12px; padding:6px 12px; width:100%; margin-top:8px;" onclick="openBMTableQr(\'' + esc(t.id) + '\', \'' + esc(t.label || ('Meja ' + t.table_number)) + '\')">QR Meja</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ── QR meja: lihat, cetak, bagikan ──
  // QR berisi URL gabung (lihat endpoint /dine-in/tables/:id/qr), jadi kamera
  // bawaan HP mana pun bisa membukanya tanpa aplikasi kita.
  async function openBMTableQr(tableId, label) {
    if (!tableId) return;
    try {
      var res = await adminFetch(API_BASE + '/dine-in/tables/' + encodeURIComponent(tableId) + '/qr', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!res.ok || !data.success || !data.svg) {
        var msg = (data && data.error) || 'Gagal memuat QR meja.';
        if (typeof showToast === 'function') showToast(msg); else console.warn(msg);
        return;
      }
      showBMTableQrOverlay(data);
    } catch (err) {
      console.warn('[BM Table QR Error]:', err);
      if (typeof showToast === 'function') showToast(msg); else console.warn(msg);2
    }
  }
  window.openBMTableQr = openBMTableQr;

  function showBMTableQrOverlay(data) {
    var previous = document.getElementById('bm-qr-overlay');
    if (previous) previous.remove();

    var title = (data.table && (data.table.label || data.table.table_number)) || 'Meja';
    var overlay = document.createElement('div');
    overlay.id = 'bm-qr-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:3000;padding:16px;';
    overlay.innerHTML =
      '<div style="background:#fff;border-radius:16px;padding:20px;max-width:340px;width:100%;text-align:center;">' +
        '<h3 style="margin:0 0 4px;font-size:16px;font-weight:800;">QR ' + esc(title) + '</h3>' +
        '<p style="margin:0 0 12px;font-size:12px;color:#64748b;">Tempel di meja. Konsumen scan pakai kamera HP, langsung masuk ke bill meja ini.</p>' +
        '<div id="bm-qr-svg" style="display:flex;justify-content:center;margin-bottom:12px;">' + data.svg + '</div>' +
        '<button type="button" id="bm-qr-print" class="x-btn-secondary" style="width:100%;margin-bottom:8px;">Cetak QR</button>' +
        '<button type="button" id="bm-qr-share" class="x-btn-secondary" style="width:100%;margin-bottom:8px;">Bagikan link</button>' +
        '<button type="button" id="bm-qr-close" class="x-btn-secondary" style="width:100%;">Tutup</button>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.querySelector('#bm-qr-close').onclick = function () { overlay.remove(); };
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    overlay.querySelector('#bm-qr-print').onclick = function () { printBMTableQr(data); };
    overlay.querySelector('#bm-qr-share').onclick = function () {
      if (!data.join_url) return;
      window.open('https://wa.me/?text=' + encodeURIComponent('QR ' + title + ': ' + data.join_url), '_blank');
    };
  }
  window.showBMTableQrOverlay = showBMTableQrOverlay;

  // Cetak lewat jendela sendiri supaya hasilnya bersih: hanya QR + nama meja.
  // Nanti bisa disambungkan ke printer bluetooth tanpa mengubah endpoint-nya.
  function printBMTableQr(data) {
    var title = (data.table && (data.table.label || data.table.table_number)) || 'Meja';
    var w = window.open('', '_blank');
    if (!w) return;
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>QR ' + esc(title) + '</title>' +
      '<style>body{font-family:sans-serif;text-align:center;padding:32px;}h1{font-size:20px;margin:0 0 4px;}p{font-size:12px;color:#555;margin:0 0 20px;}svg{width:280px;height:280px;}</style>' +
      '</head><body><h1>' + esc(title) + '</h1><p>Scan untuk pesan / lihat bill meja ini</p>' + (data.svg || '') + '</body></html>');
    w.document.close();
    w.focus();
    w.print();
  }
  window.printBMTableQr = printBMTableQr;

  async function toggleBMTableBlocked(tableId, isBlocked) {
    var reason = '';
    if (isBlocked) {
      reason = prompt('Masukkan alasan pemblokiran meja (misal: Rusak, Renovasi, Khusus VIP):');
      if (reason === null) return;
    }

    try {
      var res = await adminFetch(API_BASE + '/dine-in/tables/' + encodeURIComponent(tableId) + '/block', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_blocked: isBlocked, reason: reason.trim() })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast(isBlocked ? 'Meja telah diblokir.' : 'Meja dibuka kembali (Tersedia).');
        loadBMTables();
      } else {
        showToast('Gagal mengubah status meja: ' + (data.error || 'Terjadi kesalahan'));
        loadBMTables();
      }
    } catch (e) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.toggleBMTableBlocked = toggleBMTableBlocked;

  async function completeBMTableSession(sessionId) {
    if (!confirm('Selesaikan sesi makan ini dan kosongkan meja untuk tamu berikutnya?')) return;
    try {
      var res = await adminFetch(API_BASE + '/dine-in/sessions/' + encodeURIComponent(sessionId) + '/complete', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Sesi makan selesai, meja kembali tersedia.');
        loadBMTables();
      } else {
        showToast('Gagal menyelesaikan sesi: ' + (data.error || 'Terjadi kesalahan'));
        loadBMTables();
      }
    } catch (e) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.completeBMTableSession = completeBMTableSession;

  function getBMTargetBranchId() {
    var user = getStoredUser();
    var fromUser = user ? (user.branch_id || user.branchId || (user.branch && user.branch.id)) : null;
    var fromActive = (typeof getActiveBranchId === 'function' ? getActiveBranchId() : null);
    var fromManaging = XentraBranchCatalog.state.branchId || null;
    var fromEffective = (typeof getEffectiveBranchId === 'function' ? getEffectiveBranchId() : null);
    var branchId = fromUser || fromManaging || fromActive || fromEffective || null;
    if (branchId) XentraBranchCatalog.state.branchId = branchId;
    return branchId;
  }

  /* =========================================================================
     BM-3: MENU OPERATIONAL CONTROLLER (PHASE 2: ADOPTION & CATEGORIES)
     ========================================================================= */
  async function loadBMMenu() {
    var branchId = getBMTargetBranchId();
    if (!branchId) return;

    XentraBranchCatalog.state.branchId = branchId;

    var tbody = $('bm-menu-tbody');
    if (tbody && (!_bmMenuState.products || !_bmMenuState.products.length)) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Memuat daftar menu cabang...</td></tr>';
    }

    var currentSeq = ++_bmMenuState.fetchSeq;

    try {
      var [prodRes, catRes] = await Promise.all([
        adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/products', {
          headers: getAuthHeaders()
        }),
        adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/catalog', {
          headers: getAuthHeaders()
        })
      ]);

      var prodData = await prodRes.json();
      var catData = await catRes.json();

      if (currentSeq !== _bmMenuState.fetchSeq) return;

      if (catRes.ok && catData.success) {
        XentraBranchCatalog.state.catalogData = catData;
        _bmMenuState.categories = catData.categories || [];
        _bmMenuState.availableProducts = catData.available_master_products || [];
        renderBMMenuCategoriesBar();
      }

      if (prodRes.ok && prodData.success && Array.isArray(prodData.assignments)) {
        var catalogAdoptedMap = {};
        if (catData && catData.success && Array.isArray(catData.adopted_products)) {
          catData.adopted_products.forEach(function (ap) {
            catalogAdoptedMap[ap.product_id] = ap;
          });
        }

        _bmMenuState.products = prodData.assignments.map(function (p) {
          var ap = catalogAdoptedMap[p.product_id] || {};
          return Object.assign({}, ap, p, {
            branch_category_id: ap.branch_category_id || null,
            branch_category_name: ap.branch_category_name || null,
            category_ids: ap.category_ids || (ap.branch_category_id ? [ap.branch_category_id] : []),
            categories: ap.categories || [],
            pricing_mode: ap.pricing_mode || 'lock',
            master_price: ap.master_price || p.price,
            min_price: ap.min_price || null,
            max_price: ap.max_price || null,
            name_override: ap.name_override || null,
            description_override: ap.description_override || null,
            image_override: ap.image_override || null
          });
        });

        updateBMMenuStats(_bmMenuState.products);
        renderBMMenuTable();
      } else {
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-danger">Gagal memuat menu: ' + esc(prodData.error || 'Terjadi kesalahan') + '</td></tr>';
        }
      }
    } catch (err) {
      if (currentSeq !== _bmMenuState.fetchSeq) return;
      console.warn('[BM Menu Load Error]:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat menu cabang.</td></tr>';
      }
    }
  }
  window.loadBMMenu = loadBMMenu;

  function updateBMMenuStats(products) {
    var total = (products || []).length;
    var avail = (products || []).filter(function (p) { return p.is_available === 1 || p.is_available === true; }).length;
    var unavail = total - avail;

    if ($('bm-menu-stat-total')) $('bm-menu-stat-total').textContent = total;
    if ($('bm-menu-stat-available')) $('bm-menu-stat-available').textContent = avail;
    if ($('bm-menu-stat-unavailable')) $('bm-menu-stat-unavailable').textContent = unavail;
  }

  function onBMMenuFilterChange() {
    var searchEl = $('bm-menu-search');
    var filterEl = $('bm-menu-filter-status');
    if (searchEl) _bmMenuState.searchQuery = searchEl.value.trim().toLowerCase();
    if (filterEl) _bmMenuState.statusFilter = filterEl.value;
    renderBMMenuTable();
  }
  window.onBMMenuFilterChange = onBMMenuFilterChange;

  function setBMMenuCategoryFilter(catId) {
    _bmMenuState.categoryFilter = catId;
    var label = $('bm-menu-cat-filter-label');
    if (label) {
      if (catId === 'all') {
        label.textContent = 'Semua kategori';
      } else {
        var cat = (_bmMenuState.categories || []).find(function (c) { return String(c.id) === String(catId); });
        label.textContent = 'Filter: ' + (cat ? cat.name : catId);
      }
    }
    renderBMMenuCategoriesBar();
    renderBMMenuTable();
  }
  window.setBMMenuCategoryFilter = setBMMenuCategoryFilter;

  function renderBMMenuCategoriesBar() {
    var bar = $('bm-menu-categories-bar');
    if (!bar) return;

    bar.innerHTML = '';

    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'x-cat-filter-btn' + (_bmMenuState.categoryFilter === 'all' ? ' active' : '');
    allBtn.style.borderRadius = '20px';
    allBtn.textContent = 'Semua';
    allBtn.addEventListener('click', function () { setBMMenuCategoryFilter('all'); });
    bar.appendChild(allBtn);

    var categories = _bmMenuState.categories || [];
    if (!categories.length) {
      var hint = document.createElement('span');
      hint.className = 'text-muted';
      hint.style.fontSize = '12px';
      hint.textContent = 'Belum ada kategori cabang. Klik "+ Kategori Cabang" untuk membuat.';
      bar.appendChild(hint);
      return;
    }

    categories.forEach(function (cat) {
      var isActive = String(_bmMenuState.categoryFilter) === String(cat.id);

      var chip = document.createElement('span');
      chip.dataset.catId = cat.id;
      chip.draggable = true;
      chip.style.cssText = [
        'display:inline-flex;align-items:center;gap:0;border-radius:20px;overflow:hidden;',
        'border:1px solid ' + (isActive ? 'var(--x-primary,#10b981)' : '#e2e8f0') + ';',
        'background:' + (isActive ? '#f0fdf4' : '#f8fafc') + ';',
        'transition:box-shadow 0.15s,opacity 0.15s;',
        'cursor:grab;'
      ].join('');

      var handle = document.createElement('span');
      handle.title = 'Tahan & geser untuk ubah urutan';
      handle.style.cssText = 'padding:5px 4px 5px 10px;font-size:13px;color:#94a3b8;cursor:grab;user-select:none;';
      handle.textContent = '⠿';
      chip.appendChild(handle);

      var thumbWrap = document.createElement('span');
      thumbWrap.style.cssText = 'width:22px;height:22px;border-radius:6px;overflow:hidden;background:#eef2f6;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:2px;';
      if (cat.image_url) {
        var thumbImg = document.createElement('img');
        thumbImg.src = cat.image_url;
        thumbImg.alt = '';
        thumbImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        thumbWrap.appendChild(thumbImg);
      } else {
        var thumbMono = document.createElement('span');
        thumbMono.style.cssText = 'font-size:10px;font-weight:700;color:#94a3b8;';
        thumbMono.textContent = (cat.name || '?').trim().slice(0, 1).toUpperCase();
        thumbWrap.appendChild(thumbMono);
      }
      chip.appendChild(thumbWrap);

      var nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.draggable = false;
      nameBtn.style.cssText = 'border:none;background:none;padding:6px 8px 6px 2px;font-size:13px;font-weight:' + (isActive ? '700' : '500') + ';cursor:pointer;color:#1e293b;';
      nameBtn.textContent = cat.name;
      nameBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        setBMMenuCategoryFilter(cat.id);
      });
      chip.appendChild(nameBtn);

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.draggable = false;
      editBtn.title = 'Ubah nama & gambar kategori';
      editBtn.style.cssText = 'border:none;background:none;padding:5px 5px;font-size:12px;cursor:pointer;color:#64748b;';
      editBtn.textContent = '✏️';
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openBranchCategoryEditModal(cat);
      });
      chip.appendChild(editBtn);

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.draggable = false;
      delBtn.title = 'Hapus kategori cabang';
      delBtn.style.cssText = 'border:none;background:none;padding:6px 10px 6px 4px;font-size:12px;cursor:pointer;color:#ef4444;opacity:0.8;';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteBMBranchCategory(cat.id, cat.name);
      });
      chip.appendChild(delBtn);

      // Drag and drop ordering
      chip.addEventListener('dragstart', function (e) {
        _dragSrcCatId = cat.id;
        _dragSrcEl = chip;
        chip.style.cursor = 'grabbing';
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', cat.id);
        setTimeout(function () {
          chip.style.opacity = '0.4';
          chip.style.transform = 'scale(0.96)';
        }, 0);
      });

      chip.addEventListener('dragend', function () {
        chip.style.opacity = '1';
        chip.style.cursor = 'grab';
        chip.style.transform = '';
        bar.querySelectorAll('[data-cat-id]').forEach(function (el) {
          el.style.borderLeft = '';
          el.style.borderRight = '';
          el.style.boxShadow = '';
        });
      });

      chip.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (chip !== _dragSrcEl) {
          var rect = chip.getBoundingClientRect();
          var midX = rect.left + rect.width / 2;
          if (e.clientX < midX) {
            chip.style.borderLeft = '3px solid var(--x-primary,#10b981)';
            chip.style.borderRight = '';
          } else {
            chip.style.borderLeft = '';
            chip.style.borderRight = '3px solid var(--x-primary,#10b981)';
          }
        }
      });

      chip.addEventListener('dragleave', function () {
        chip.style.borderLeft = '';
        chip.style.borderRight = '';
      });

      chip.addEventListener('drop', function (e) {
        e.preventDefault();
        chip.style.borderLeft = '';
        chip.style.borderRight = '';
        if (!_dragSrcCatId || _dragSrcCatId === cat.id || !_dragSrcEl) return;

        var rect = chip.getBoundingClientRect();
        var midX = rect.left + rect.width / 2;
        var insertBefore = e.clientX < midX;

        if (insertBefore) {
          bar.insertBefore(_dragSrcEl, chip);
        } else {
          bar.insertBefore(_dragSrcEl, chip.nextSibling);
        }

        var newOrder = Array.from(bar.querySelectorAll('[data-cat-id]')).map(function (el) {
          return el.dataset.catId;
        });

        saveBMBranchCategoryOrder(newOrder);
      });

      bar.appendChild(chip);
    });
  }

  async function saveBMBranchCategoryOrder(orderedIds) {
    var branchId = getBMTargetBranchId();
    if (!branchId) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/categories/reorder', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ order: orderedIds })
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Urutan kategori cabang disimpan.');
        if (_bmMenuState.categories) {
          var catMap = {};
          _bmMenuState.categories.forEach(function (c) { catMap[c.id] = c; });
          _bmMenuState.categories = orderedIds.map(function (id) { return catMap[id]; }).filter(Boolean);
        }
      } else {
        showToast('❌ ' + (data.error || 'Gagal menyimpan urutan kategori.'));
        loadBMMenu();
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan saat menyimpan urutan.');
      loadBMMenu();
    }
  }

  window.promptAddBMBranchCategory = function () {
    var branchId = getBMTargetBranchId();
    if (!branchId) {
      showToast('❌ Cabang tidak valid atau belum dipilih.');
      return;
    }
    XentraBranchCatalog.state.branchId = branchId;
    openBranchCategoryCreateModal();
  };

  window.deleteBMBranchCategory = async function (catId, catName) {
    if (!confirm('Hapus kategori "' + catName + '"? Produk di kategori ini tidak akan dihapus, hanya dipindah ke tanpa kategori.')) return;

    var branchId = getBMTargetBranchId();
    if (!branchId) return;
    XentraBranchCatalog.state.branchId = branchId;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/categories/' + encodeURIComponent(catId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Kategori cabang berhasil dihapus.');
        if (String(_bmMenuState.categoryFilter) === String(catId)) _bmMenuState.categoryFilter = 'all';
        loadBMMenu();
      } else {
        showToast('❌ ' + (data.error || 'Gagal menghapus kategori.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };

  function renderBMMenuTable() {
    var tbody = $('bm-menu-tbody');
    if (!tbody) return;

    var filtered = (_bmMenuState.products || []).filter(function (p) {
      var name = (p.product_name || p.name || '').toLowerCase();
      var matchesSearch = !_bmMenuState.searchQuery || name.indexOf(_bmMenuState.searchQuery) !== -1;
      if (!matchesSearch) return false;

      var isAvail = (p.is_available === 1 || p.is_available === true);
      if (_bmMenuState.statusFilter === 'available' && !isAvail) return false;
      if (_bmMenuState.statusFilter === 'unavailable' && isAvail) return false;

      if (_bmMenuState.categoryFilter && _bmMenuState.categoryFilter !== 'all') {
        var pCatIds = Array.isArray(p.category_ids) && p.category_ids.length > 0
          ? p.category_ids.map(String)
          : (p.branch_category_id ? [String(p.branch_category_id)] : []);
        if (pCatIds.indexOf(String(_bmMenuState.categoryFilter)) === -1) return false;
      }

      return true;
    });

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Tidak ada produk yang sesuai dengan kriteria filter.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (p) {
      var isAvail = (p.is_available === 1 || p.is_available === true);
      var isMasterActive = (p.is_master_active === 1 || p.is_master_active === true || p.is_master_active === undefined);

      var branchStatusBadge = isAvail
        ? '<span class="x-badge x-badge-success" style="font-size:11px;">TERSEDIA</span>'
        : '<span class="x-badge x-badge-danger" style="font-size:11px;">HABIS (OFF)</span>';

      var masterStatusBadge = isMasterActive
        ? '<span class="x-badge" style="font-size:10px; background:#f1f5f9; color:#475569;">AKTIF (BRAND)</span>'
        : '<span class="x-badge x-badge-danger" style="font-size:10px;">NONAKTIF (BRAND)</span>';

      var toggleBtn = '<label class="x-toggle' + (isAvail ? ' x-toggle-on' : '') + '" title="' + (isAvail ? 'Menu tersedia' : 'Menu habis') + '">' +
        '<input type="checkbox" ' + (isAvail ? 'checked' : '') + ' onchange="toggleBMProductAvailability(\'' + esc(p.product_id) + '\', this.checked ? 1 : 0)" aria-label="Ubah ketersediaan menu cabang">' +
        '<span class="x-toggle-slider"></span>' +
      '</label>';

      var catBadges = (p.category_names && p.category_names.length)
        ? p.category_names.map(function (cn) { return '<span class="x-badge x-badge-info" style="font-size:10px; margin-right:4px;">' + esc(cn) + '</span>'; }).join('')
        : (p.branch_category_name ? '<span class="x-badge x-badge-info" style="font-size:10px;">' + esc(p.branch_category_name) + '</span>' : '<span class="text-muted" style="font-size:11px;">—</span>');

      var productDataJson = esc(JSON.stringify({
        product_id: p.product_id,
        name: p.product_name || p.name,
        price: p.price,
        master_price: p.master_price || p.price,
        pricing_mode: p.pricing_mode || 'lock',
        min_price: p.min_price,
        max_price: p.max_price,
        branch_category_id: p.branch_category_id,
        category_ids: p.category_ids || (p.branch_category_id ? [p.branch_category_id] : []),
        categories: p.categories || []
      }));

      return '<tr>' +
        '<td><strong>' + esc(p.product_name || p.name) + '</strong></td>' +
        '<td>' + catBadges + '</td>' +
        '<td>' + formatMoney(p.price) + '</td>' +
        '<td><strong>' + esc(p.stock != null ? p.stock : '—') + '</strong></td>' +
        '<td>' + branchStatusBadge + '</td>' +
        '<td>' + masterStatusBadge + '</td>' +
        '<td style="text-align:right; white-space:nowrap;">' +
          '<div style="display:inline-flex; align-items:center; gap:8px;">' +
            toggleBtn +
            '<button type="button" class="x-action-menu-trigger" aria-label="Aksi menu ' + esc(p.product_name || p.name) + '" onclick="XentraActionMenu.open(this, [' +
              '{ label: \'Edit Menu / Kategori Cabang\', icon: \'✏️\', onClick: function() { openBranchOverrideModal(\'' + productDataJson + '\'); } },' +
              '{ divider: true },' +
              '{ label: \'Hapus dari Cabang\', icon: \'🗑️\', destructive: true, onClick: function() { removeBMBranchProduct(\'' + esc(p.product_id) + '\', \'' + esc(p.product_name || p.name) + '\'); } }' +
            '])">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  async function toggleBMProductAvailability(productId, nextVal) {
    var branchId = getBMTargetBranchId();
    if (!branchId) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/products/' + encodeURIComponent(productId), {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_available: nextVal })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast(nextVal === 1 ? 'Produk berhasil ditandai Tersedia.' : 'Produk ditandai Habis.');
        loadBMMenu();
      } else {
        showToast('Gagal mengubah ketersediaan: ' + (data.error || 'Terjadi kesalahan'));
        loadBMMenu();
      }
    } catch (e) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.toggleBMProductAvailability = toggleBMProductAvailability;

  window.removeBMBranchProduct = async function (productId, productName) {
    var branchId = getBMTargetBranchId();
    if (!branchId) return;

    if (!confirm('Hapus "' + productName + '" dari katalog cabang ini? Menu tidak akan lagi tampil di halaman pemesanan pelanggan.')) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/products/' + encodeURIComponent(productId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Produk berhasil dihapus dari cabang.');
        loadBMMenu();
      } else {
        showToast('❌ ' + (data.error || 'Gagal menghapus produk.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };

  /* Modal Pick Available Master Products to Adopt (BM Phase 4B) */
  window.openBMAddCatalogModal = async function () {
    var modal = $('modal-bm-add-catalog');
    if (!modal) return;

    _bmMenuState.addCatalogSearchQuery = '';
    _bmMenuState.selectedCatalogProductIds = new Set();
    var searchInput = $('bm-add-catalog-search');
    if (searchInput) searchInput.value = '';

    updateBMAddCatalogFooter();

    var container = $('bm-add-catalog-list');
    if (container) {
      container.innerHTML = '<div style="padding:32px 16px; text-align:center; color:#64748b; font-size:13px;">' +
        '<div style="font-size:24px; margin-bottom:8px;">⏳</div>' +
        '<div>Memuat katalog produk master...</div>' +
      '</div>';
    }
    modal.style.display = 'flex';

    var branchId = getBMTargetBranchId();
    if (!branchId) {
      if (container) container.innerHTML = '<div style="padding:24px; text-align:center; color:#dc2626; font-size:13px;">Cabang tidak teridentifikasi. Pastikan Anda telah memilih atau ditugaskan ke cabang.</div>';
      return;
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/catalog', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success) {
        XentraBranchCatalog.state.catalogData = data;
        _bmMenuState.availableProducts = data.available_master_products || [];

        // Distinguish between already adopted and available master products
        var unadopted = (data.available_master_products || []).map(function (p) {
          return Object.assign({}, p, { is_adopted: false });
        });

        var adopted = (data.adopted_products || []).map(function (ap) {
          return {
            id: ap.product_id,
            name: ap.name,
            price: ap.price,
            master_price: ap.master_price,
            image_url: ap.image_url,
            pricing_mode: ap.pricing_mode,
            min_price: ap.min_price,
            max_price: ap.max_price,
            description: ap.description,
            is_adopted: true
          };
        });

        // Unadopted first, then adopted marked
        _bmMenuState.allCatalogProducts = unadopted.concat(adopted);

        // Populate branch categories target dropdown
        var catSelect = $('bm-add-catalog-target-category');
        if (catSelect) {
          var branchCats = data.categories || (_bmMenuState && _bmMenuState.categories) || [];
          var opts = ['<option value="">Otomatis / Menu Utama</option>'];
          branchCats.forEach(function (c) {
            opts.push('<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>');
          });
          catSelect.innerHTML = opts.join('');
        }

        renderBMAddCatalogList();
      } else {
        if (container) {
          container.innerHTML = '<div style="padding:24px; text-align:center; color:#dc2626; font-size:13px;">Gagal memuat katalog: ' + esc(data.error || 'Terjadi kesalahan') + '</div>';
        }
      }
    } catch (err) {
      console.warn('[BM Add Catalog Load Error]:', err);
      if (container) {
        container.innerHTML = '<div style="padding:24px; text-align:center; color:#dc2626; font-size:13px;">Kesalahan jaringan saat memuat katalog master.</div>';
      }
    }
  };

  window.closeBMAddCatalogModal = function () {
    var modal = $('modal-bm-add-catalog');
    if (modal) modal.style.display = 'none';
  };

  window.toggleBMAddCatalogSelectAll = function (isChecked) {
    if (!_bmMenuState.selectedCatalogProductIds) _bmMenuState.selectedCatalogProductIds = new Set();
    var all = _bmMenuState.allCatalogProducts || [];
    var q = (_bmMenuState.addCatalogSearchQuery || '').toLowerCase();
    var filtered = all.filter(function (p) {
      if (!q) return true;
      return (p.name || '').toLowerCase().indexOf(q) !== -1 || (p.description || '').toLowerCase().indexOf(q) !== -1;
    });

    filtered.forEach(function (p) {
      if (p.is_adopted) return;
      var pid = String(p.id);
      if (isChecked) {
        _bmMenuState.selectedCatalogProductIds.add(pid);
      } else {
        _bmMenuState.selectedCatalogProductIds.delete(pid);
      }
      var card = $('catalog-pick-card-' + pid);
      if (card) {
        if (isChecked) card.classList.add('is-selected');
        else card.classList.remove('is-selected');
      }
      var cb = $('catalog-pick-cb-' + pid);
      if (cb) cb.checked = isChecked;
    });

    updateBMAddCatalogFooter();
  };

  window.onBMAddCatalogFilterChange = function () {
    var searchInput = $('bm-add-catalog-search');
    if (searchInput) _bmMenuState.addCatalogSearchQuery = searchInput.value.trim().toLowerCase();
    renderBMAddCatalogList();
  };

  window.onBMSelectCatalogProduct = function (productId, isChecked) {
    if (!_bmMenuState.selectedCatalogProductIds) _bmMenuState.selectedCatalogProductIds = new Set();
    var pid = String(productId);
    if (isChecked) {
      _bmMenuState.selectedCatalogProductIds.add(pid);
    } else {
      _bmMenuState.selectedCatalogProductIds.delete(pid);
    }
    var card = $('catalog-pick-card-' + pid);
    if (card) {
      if (isChecked) card.classList.add('is-selected');
      else card.classList.remove('is-selected');
    }
    updateBMAddCatalogFooter();
  };

  window.toggleBMSelectCatalogProduct = function (productId) {
    var pid = String(productId);
    var checkbox = $('catalog-pick-cb-' + pid);
    if (!checkbox || checkbox.disabled) return;
    checkbox.checked = !checkbox.checked;
    window.onBMSelectCatalogProduct(pid, checkbox.checked);
  };

  function updateBMAddCatalogFooter() {
    var count = (_bmMenuState.selectedCatalogProductIds && _bmMenuState.selectedCatalogProductIds.size) || 0;
    var countEl = $('bm-add-catalog-count');
    if (countEl) {
      countEl.textContent = count + ' produk dipilih';
    }
    var submitBtn = $('btn-bm-submit-adopt-catalog');
    if (submitBtn) {
      submitBtn.disabled = count === 0;
      submitBtn.textContent = count > 0 ? ('Tambahkan (' + count + ') Menu') : 'Tambahkan Menu';
    }

    // Sync select-all checkbox state
    var selectAllCb = $('bm-add-catalog-select-all');
    if (selectAllCb) {
      var all = _bmMenuState.allCatalogProducts || [];
      var unadopted = all.filter(function (p) { return !p.is_adopted; });
      if (unadopted.length > 0 && count >= unadopted.length) {
        selectAllCb.checked = true;
      } else {
        selectAllCb.checked = false;
      }
    }
  }

  function renderBMAddCatalogList() {
    var container = $('bm-add-catalog-list');
    if (!container) return;

    var all = _bmMenuState.allCatalogProducts || [];
    var q = (_bmMenuState.addCatalogSearchQuery || '').toLowerCase();
    var filtered = all.filter(function (p) {
      if (!q) return true;
      return (p.name || '').toLowerCase().indexOf(q) !== -1 || (p.description || '').toLowerCase().indexOf(q) !== -1;
    });

    if (!filtered.length) {
      container.innerHTML = '<div style="background:#f8fafc; border:1px dashed #cbd5e1; border-radius:8px; padding:28px; text-align:center; color:#64748b; font-size:13px;">' +
        (q ? 'Tidak ada produk master yang sesuai dengan pencarian "' + esc(q) + '".' : 'Belum ada produk master yang tersedia untuk brand ini.') +
      '</div>';
      updateBMAddCatalogFooter();
      return;
    }

    var selectedSet = _bmMenuState.selectedCatalogProductIds || new Set();

    container.innerHTML = filtered.map(function (p) {
      var pid = String(p.id);
      var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isRange = p.pricing_mode === 'range';
      var modeBadge = isRange
        ? '<span class="x-badge x-badge-range" style="font-size:11px;">Range (' + formatMoney(p.min_price) + ' - ' + formatMoney(p.max_price) + ')</span>'
        : '<span class="x-badge x-badge-lock" style="font-size:11px;">Harga Terkunci</span>';

      if (p.is_adopted) {
        return '<div class="x-catalog-picker-card is-adopted" id="catalog-pick-card-' + esc(pid) + '">' +
          '<div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">' +
            '<img src="' + esc(img) + '" style="width:44px; height:44px; border-radius:6px; object-fit:cover; flex-shrink:0; border:1px solid #e2e8f0;" alt="">' +
            '<div style="min-width:0; flex:1;">' +
              '<div style="font-weight:700; font-size:13.5px; color:#334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(p.name) + '</div>' +
              '<div style="display:flex; gap:6px; align-items:center; margin-top:2px; flex-wrap:wrap;">' +
                '<span style="font-size:12px; font-weight:700; color:#64748b;">' + formatMoney(p.price || p.master_price) + '</span>' +
                modeBadge +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">' +
            '<span class="x-badge x-badge-success" style="font-size:11px; padding:4px 10px;">✓ Sudah Diadopsi</span>' +
          '</div>' +
        '</div>';
      }

      var isSelected = selectedSet.has(pid);
      return '<div class="x-catalog-picker-card' + (isSelected ? ' is-selected' : '') + '" id="catalog-pick-card-' + esc(pid) + '" onclick="toggleBMSelectCatalogProduct(\'' + esc(pid) + '\')">' +
        '<div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">' +
          '<input type="checkbox" class="x-catalog-picker-checkbox" id="catalog-pick-cb-' + esc(pid) + '" ' + (isSelected ? 'checked' : '') + ' onclick="event.stopPropagation(); onBMSelectCatalogProduct(\'' + esc(pid) + '\', this.checked)">' +
          '<img src="' + esc(img) + '" style="width:44px; height:44px; border-radius:6px; object-fit:cover; flex-shrink:0; border:1px solid #e2e8f0;" alt="">' +
          '<div style="min-width:0; flex:1;">' +
            '<div style="font-weight:700; font-size:13.5px; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(p.name) + '</div>' +
            '<div style="display:flex; gap:6px; align-items:center; margin-top:2px; flex-wrap:wrap;">' +
              '<span style="font-size:12px; font-weight:700; color:var(--text-main);">' + formatMoney(p.price) + '</span>' +
              modeBadge +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">' +
          '<span style="font-size:12px; font-weight:600; color:' + (isSelected ? '#2563eb' : '#64748b') + ';">' + (isSelected ? '✓ Terpilih' : 'Pilih') + '</span>' +
        '</div>' +
      '</div>';
    }).join('');

    updateBMAddCatalogFooter();
  }

  window.submitBMAdoptCatalogBatch = async function () {
    var branchId = getBMTargetBranchId();
    if (!branchId) {
      showToast('❌ Cabang tidak valid atau belum dipilih.');
      return;
    }

    var selectedSet = _bmMenuState.selectedCatalogProductIds;
    if (!selectedSet || selectedSet.size === 0) {
      showToast('⚠️ Pilih minimal 1 produk master untuk diadopsi.');
      return;
    }

    var targetCatSelect = $('bm-add-catalog-target-category');
    var targetCatId = targetCatSelect ? targetCatSelect.value : '';

    var btn = $('btn-bm-submit-adopt-catalog');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Menambahkan...';
    }

    var pids = Array.from(selectedSet);
    var successCount = 0;
    var errorCount = 0;
    var lastError = '';

    for (var i = 0; i < pids.length; i++) {
      var pid = pids[i];
      try {
        var adoptPayload = { product_id: pid };
        if (targetCatId) {
          adoptPayload.branch_category_id = targetCatId;
          adoptPayload.category_ids = [targetCatId];
        }

        var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/adopt', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(adoptPayload)
        });
        var data = await res.json();
        if (res.ok && data.success) {
          successCount++;
        } else {
          errorCount++;
          lastError = data.message || data.error || 'Gagal mengadopsi';
        }
      } catch (e) {
        errorCount++;
        lastError = 'Kesalahan jaringan';
      }
    }

    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Tambahkan Menu';
    }

    if (successCount > 0) {
      showToast('✅ Berhasil menambahkan ' + successCount + ' menu ke cabang!');
      closeBMAddCatalogModal();
      if (typeof loadBMMenu === 'function') await loadBMMenu();
      if (typeof loadInlineBranchCatalog === 'function') loadInlineBranchCatalog();
    } else {
      showToast('❌ ' + (lastError || 'Gagal mengadopsi produk terpilih.'));
    }
  };

  /* =========================================================================
     BM-3: STOK & INVENTARIS OPERATIONAL CONTROLLER
     ========================================================================= */
  async function loadBMStock() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var tbody = $('bm-stock-tbody');
    if (tbody && (!_bmStockState.inventory || !_bmStockState.inventory.length)) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Memuat inventaris cabang...</td></tr>';
    }

    var currentSeq = ++_bmStockState.fetchSeq;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/inventory', {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (currentSeq !== _bmStockState.fetchSeq) return;

      if (res.ok && data.success && Array.isArray(data.inventory)) {
        _bmStockState.inventory = data.inventory;
        updateBMStockStats(data.inventory);
        renderBMStockTable();
      } else {
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Gagal memuat inventaris: ' + esc(data.error || 'Terjadi kesalahan') + '</td></tr>';
        }
      }
    } catch (err) {
      if (currentSeq !== _bmStockState.fetchSeq) return;
      console.warn('[BM Stock Load Error]:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat inventaris.</td></tr>';
      }
    }
  }
  window.loadBMStock = loadBMStock;

  function updateBMStockStats(items) {
    var total = (items || []).length;
    var outOfStock = (items || []).filter(function (it) { return Number(it.stock) <= 0; }).length;
    var lowStock = (items || []).filter(function (it) {
      var s = Number(it.stock);
      var th = Number(it.low_stock_threshold || 5);
      return s > 0 && s <= th;
    }).length;
    var safeStock = total - outOfStock - lowStock;

    if ($('bm-stock-stat-total')) $('bm-stock-stat-total').textContent = total;
    if ($('bm-stock-stat-safe')) $('bm-stock-stat-safe').textContent = safeStock;
    if ($('bm-stock-stat-low')) $('bm-stock-stat-low').textContent = lowStock;
    if ($('bm-stock-stat-out')) $('bm-stock-stat-out').textContent = outOfStock;
  }

  function onBMStockFilterChange() {
    var searchEl = $('bm-stock-search');
    var filterEl = $('bm-stock-filter-status');
    if (searchEl) _bmStockState.searchQuery = searchEl.value.trim().toLowerCase();
    if (filterEl) _bmStockState.statusFilter = filterEl.value;
    renderBMStockTable();
  }
  window.onBMStockFilterChange = onBMStockFilterChange;

  function renderBMStockTable() {
    var tbody = $('bm-stock-tbody');
    if (!tbody) return;

    var filtered = (_bmStockState.inventory || []).filter(function (it) {
      var name = (it.product_name || '').toLowerCase();
      var matchesSearch = !_bmStockState.searchQuery || name.indexOf(_bmStockState.searchQuery) !== -1;
      if (!matchesSearch) return false;

      var s = Number(it.stock);
      var th = Number(it.low_stock_threshold || 5);
      if (_bmStockState.statusFilter === 'out') return s <= 0;
      if (_bmStockState.statusFilter === 'low') return s > 0 && s <= th;
      if (_bmStockState.statusFilter === 'safe') return s > th;
      return true;
    });

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Tidak ada item inventaris yang sesuai kriteria filter.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (it) {
      var s = Number(it.stock);
      var th = Number(it.low_stock_threshold || 5);

      var badge = '';
      if (s <= 0) {
        badge = '<span class="x-badge x-badge-danger" style="font-size:11px;">HABIS (0)</span>';
      } else if (s <= th) {
        badge = '<span class="x-badge x-badge-warning" style="font-size:11px;">MENIPIS (&le; ' + th + ')</span>';
      } else {
        badge = '<span class="x-badge x-badge-success" style="font-size:11px;">AMAN</span>';
      }

      return '<tr>' +
        '<td><strong>' + esc(it.product_name) + '</strong></td>' +
        '<td>' + formatMoney(it.price) + '</td>' +
        '<td><strong style="font-size:14px;">' + s + '</strong></td>' +
        '<td><span class="text-muted">' + th + '</span></td>' +
        '<td>' + badge + '</td>' +
        '<td style="text-align:right;">' +
          '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 10px;" onclick="openBMStockAdjustmentModal(\'' + esc(it.product_id) + '\')">Sesuaikan Stok</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  function openBMStockAdjustmentModal(productId) {
    var item = (_bmStockState.inventory || []).find(function (it) { return it.product_id === productId; });
    if (!item) return;

    var modal = $('modal-bm-stock-adjust');
    if (!modal) return;

    if ($('bm-adjust-product-id')) $('bm-adjust-product-id').value = item.product_id;
    if ($('bm-adjust-product-name')) $('bm-adjust-product-name').textContent = item.product_name;
    if ($('bm-adjust-current-stock')) $('bm-adjust-current-stock').textContent = item.stock;

    var selectType = $('bm-adjust-movement-type');
    if (selectType) selectType.value = 'audit_adjustment';

    var qtyInput = $('bm-adjust-quantity');
    if (qtyInput) qtyInput.value = '';

    var notesInput = $('bm-adjust-notes');
    if (notesInput) notesInput.value = '';

    onBMAdjustTypeChange();
    modal.style.display = 'flex';
  }
  window.openBMStockAdjustmentModal = openBMStockAdjustmentModal;

  function closeBMStockAdjustModal() {
    var modal = $('modal-bm-stock-adjust');
    if (modal) modal.style.display = 'none';
  }
  window.closeBMStockAdjustModal = closeBMStockAdjustModal;

  function onBMAdjustTypeChange() {
    var selectType = $('bm-adjust-movement-type');
    var hint = $('bm-adjust-qty-hint');
    var qtyInput = $('bm-adjust-quantity');
    if (!selectType || !hint) return;

    if (selectType.value === 'waste_spoilage') {
      hint.textContent = 'Barang rusak/basi harus bernilai pengurangan negatif (misal: -3).';
      hint.style.color = '#dc2626';
      if (qtyInput && Number(qtyInput.value) > 0) {
        qtyInput.value = '-' + qtyInput.value;
      }
    } else {
      hint.textContent = 'Gunakan angka positif untuk menambah, negatif untuk mengurangi.';
      hint.style.color = 'var(--text-muted)';
    }
  }
  window.onBMAdjustTypeChange = onBMAdjustTypeChange;

  async function submitBMStockAdjustment(e) {
    if (e) e.preventDefault();
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var productId = $('bm-adjust-product-id') ? $('bm-adjust-product-id').value : '';
    var movementType = $('bm-adjust-movement-type') ? $('bm-adjust-movement-type').value : '';
    var qty = $('bm-adjust-quantity') ? Number($('bm-adjust-quantity').value) : NaN;
    var notes = $('bm-adjust-notes') ? $('bm-adjust-notes').value.trim() : '';

    if (!productId || isNaN(qty) || qty === 0) {
      showToast('Masukkan jumlah penyesuaian yang valid (bukan 0).');
      return;
    }

    if (movementType === 'waste_spoilage' && qty > 0) {
      showToast('Barang rusak (waste_spoilage) hanya menerima pengurangan stok (angka negatif).');
      return;
    }

    var submitBtn = $('btn-bm-submit-adjust');
    if (submitBtn) submitBtn.disabled = true;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/inventory/' + encodeURIComponent(productId), {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          movement_type: movementType,
          quantity: qty,
          notes: notes
        })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Stok operasional berhasil diperbarui!');
        closeBMStockAdjustModal();
        loadBMStock();
      } else {
        showToast('Gagal menyesuaikan stok: ' + (data.message || data.error || 'Terjadi kesalahan'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }
  window.submitBMStockAdjustment = submitBMStockAdjustment;

  /* =========================================================================
     BM-3: PROMOSI OPERATIONAL CONTROLLER
     ========================================================================= */
  async function loadBMPromotions() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;

    var listContainer = $('bm-promo-list');
    var redemptionsTbody = $('bm-promo-redemptions-tbody');

    if (listContainer && (!_bmPromoState.promotions || !_bmPromoState.promotions.length)) {
      listContainer.innerHTML = '<div class="text-center py-6 text-muted">Memuat promosi...</div>';
    }
    if (redemptionsTbody && (!_bmPromoState.redemptions || !_bmPromoState.redemptions.length)) {
      redemptionsTbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-muted">Memuat riwayat penebusan...</td></tr>';
    }

    var currentSeq = ++_bmPromoState.fetchSeq;

    try {
      var pRes = await adminFetch(API_BASE + '/admin/marketing/promotions', { headers: getAuthHeaders() });
      var pData = await pRes.json();

      var rUrl = API_BASE + '/admin/marketing/redemptions' + (branchId ? ('?branch_id=' + encodeURIComponent(branchId)) : '');
      var rRes = await adminFetch(rUrl, { headers: getAuthHeaders() });
      var rData = await rRes.json();

      if (currentSeq !== _bmPromoState.fetchSeq) return;

      var promos = (pRes.ok && pData.success && Array.isArray(pData.promotions)) ? pData.promotions : [];
      var redemptions = (rRes.ok && rData.success && Array.isArray(rData.redemptions)) ? rData.redemptions : [];

      _bmPromoState.promotions = promos;
      _bmPromoState.redemptions = redemptions;

      updateBMPromoStats(promos, redemptions);
      renderBMPromotionsList(promos);
      renderBMRedemptionsTable(redemptions);

    } catch (err) {
      if (currentSeq !== _bmPromoState.fetchSeq) return;
      console.warn('[BM Promo Load Error]:', err);
      if (listContainer) listContainer.innerHTML = '<div class="text-center py-6 text-danger">Kesalahan jaringan saat memuat promosi.</div>';
      if (redemptionsTbody) redemptionsTbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-danger">Kesalahan jaringan.</td></tr>';
    }
  }
  window.loadBMPromotions = loadBMPromotions;

  function updateBMPromoStats(promos, redemptions) {
    var activeCount = (promos || []).filter(function (p) { return p.is_active === 1 || p.is_active === true; }).length;
    var totalRedemptions = (redemptions || []).length;
    var totalDiscount = (redemptions || []).reduce(function (acc, r) {
      return acc + (Number(r.benefit_amount || r.discount_amount || r.discount_applied) || 0);
    }, 0);

    if ($('bm-promo-stat-active')) $('bm-promo-stat-active').textContent = activeCount;
    if ($('bm-promo-stat-redemptions')) $('bm-promo-stat-redemptions').textContent = totalRedemptions;
    if ($('bm-promo-stat-discount-given')) $('bm-promo-stat-discount-given').textContent = formatMoney(totalDiscount);
  }

  function renderBMPromotionsList(promos) {
    var container = $('bm-promo-list');
    if (!container) return;

    if (!promos || !promos.length) {
      container.innerHTML = '<div class="text-center py-6 text-muted">Belum ada promosi aktif dari Brand untuk cabang ini.</div>';
      return;
    }

    var now = new Date().toISOString();

    container.innerHTML = promos.map(function (p) {
      // Branch-level activation state
      var isBranchActive = p.branch_is_active !== undefined ? (p.branch_is_active === 1 || p.branch_is_active === true) : (p.is_active === 1 || p.is_active === true);
      var isBrandActive = (p.is_active === 1 || p.is_active === true);

      // Operational Status derivation
      var statusBadge = '';
      var canToggle = true;

      if (!isBrandActive) {
        statusBadge = '<span class="x-badge" style="background:#f1f5f9;color:#64748b;font-size:11px;">NONAKTIF (BRAND)</span>';
        canToggle = false;
      } else if (p.end_at && p.end_at < now) {
        statusBadge = '<span class="x-badge" style="background:#fee2e2;color:#991b1b;font-size:11px;">KADALUARSA</span>';
        canToggle = false;
      } else if (p.start_at && p.start_at > now) {
        statusBadge = '<span class="x-badge" style="background:#fef3c7;color:#92400e;font-size:11px;">TERJADWAL</span>';
      } else if (isBranchActive) {
        statusBadge = '<span class="x-badge x-badge-success" style="font-size:11px;font-weight:700;">AKTIF DI CABANG</span>';
      } else {
        statusBadge = '<span class="x-badge" style="background:#f1f5f9;color:#475569;font-size:11px;">NONAKTIF (CABANG)</span>';
      }

      // Action button
      var actionBtnHtml = '';
      if (canToggle) {
        if (isBranchActive) {
          actionBtnHtml = '<button type="button" class="x-btn-secondary" onclick="toggleBMPromoActivation(\'' + esc(p.id) + '\', 0, this)" style="padding:5px 12px;font-size:12px;color:#dc2626;border-color:#fca5a5;">Nonaktifkan di Cabang</button>';
        } else {
          actionBtnHtml = '<button type="button" class="x-btn-primary" onclick="toggleBMPromoActivation(\'' + esc(p.id) + '\', 1, this)" style="padding:5px 12px;font-size:12px;">Aktifkan di Cabang</button>';
        }
      } else {
        actionBtnHtml = '<span style="font-size:11px;color:#94a3b8;font-style:italic;">Dikelola Pusat</span>';
      }

      // Rewards summary text
      var rewardText = '';
      if (Array.isArray(p.rewards) && p.rewards.length > 0) {
        var rw = p.rewards[0];
        rewardText = (rw.reward_type === 'freebie_product' ? 'Gratis: ' : '') + (rw.target_product_name || rw.target_product_id || 'Produk Promo');
      } else if (p.discount_type) {
        rewardText = p.discount_type === 'percentage' ? (p.discount_value + '%') : formatMoney(p.discount_value);
      } else {
        rewardText = 'Insentif Promo';
      }

      var promoCode = p.code || p.promo_code;

      return '<div class="x-card" style="padding:14px 16px; border:1px solid var(--border-color); border-radius:8px; background:#ffffff;">' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">' +
          '<div>' +
            '<strong style="font-size:15px; color:var(--text-main);">' + esc(p.name || p.title || 'Promosi') + '</strong>' +
            (promoCode ? ('<div style="font-size:12px; margin-top:3px;">Kode: <code style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-weight:700;">' + esc(promoCode) + '</code></div>') : '') +
          '</div>' +
          statusBadge +
        '</div>' +
        (p.description ? ('<p style="font-size:12px; color:var(--text-muted); margin:4px 0 8px;">' + esc(p.description) + '</p>') : '') +
        '<div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; border-top:1px dashed var(--border-color); padding-top:10px; margin-top:8px;">' +
          '<div>Benefit: <strong style="color:var(--accent-teal);">' + esc(rewardText) + '</strong></div>' +
          actionBtnHtml +
        '</div>' +
      '</div>';
    }).join('');
  }

  async function toggleBMPromoActivation(promoId, newStatus, btnEl) {
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = 'Memproses...';
    }

    try {
      var res = await adminFetch('/api/v1/admin/marketing/promotions/' + encodeURIComponent(promoId) + '/branch-activation', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: newStatus })
      });
      var json = await res.json();
      if (!res.ok || !json.success) throw new Error((json && json.error) || 'Gagal mengubah status aktivasi promo di cabang.');

      showToast(newStatus === 1 ? 'Promo berhasil diaktifkan untuk operasional cabang ini.' : 'Promo berhasil dinonaktifkan di cabang ini.');
      loadBMPromotions();
    } catch (err) {
      console.error('[BM Promo Toggle Error]:', err);
      showToast(err.message || 'Gagal mengubah status promosi.');
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.textContent = newStatus === 1 ? 'Aktifkan di Cabang' : 'Nonaktifkan di Cabang';
      }
    }
  }
  window.toggleBMPromoActivation = toggleBMPromoActivation;

  function renderBMRedemptionsTable(redemptions) {
    var tbody = $('bm-promo-redemptions-tbody');
    if (!tbody) return;

    if (!redemptions || !redemptions.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-muted">Belum ada penebusan promo di cabang ini.</td></tr>';
      return;
    }

    tbody.innerHTML = redemptions.slice(0, 10).map(function (r) {
      var time = (r.redeemed_at || r.created_at || '').substring(0, 16).replace('T', ' ') || '—';
      var discountVal = Number(r.benefit_amount || r.discount_amount || r.discount_applied) || 0;
      return '<tr>' +
        '<td><strong>' + esc(r.order_number || r.order_id) + '</strong></td>' +
        '<td><code>' + esc(r.promo_code || r.promotion_name || 'Promo') + '</code></td>' +
        '<td><strong style="color:var(--accent-teal);">' + formatMoney(discountVal) + '</strong></td>' +
        '<td style="font-size:12px; color:var(--text-muted);">' + time + '</td>' +
      '</tr>';
    }).join('');
  }

  /* =========================================================================
     BM-4: STAF OPERASIONAL CABANG (BRANCH-SCOPED WORKFORCE)
     ========================================================================= */
  var _bmStaffState = {
    users: [],
    fetchSeq: 0
  };

  async function loadBMStaff() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var tbody = $('bm-staff-tbody');
    if (tbody && (!_bmStaffState.users || !_bmStaffState.users.length)) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Memuat daftar staf cabang...</td></tr>';
    }

    var currentSeq = ++_bmStaffState.fetchSeq;

    try {
      var res = await adminFetch(API_BASE + '/admin/users?limit=100&branch_id=' + encodeURIComponent(branchId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (currentSeq !== _bmStaffState.fetchSeq) return;

      if (res.ok && data.success && Array.isArray(data.users)) {
        _bmStaffState.users = data.users;
        renderBMStaffTable(data.users);
      } else {
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Gagal memuat staf cabang: ' + esc(data.error || 'Terjadi kesalahan') + '</td></tr>';
        }
      }
    } catch (err) {
      if (currentSeq !== _bmStaffState.fetchSeq) return;
      console.warn('[BM Staff Load Error]:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat staf.</td></tr>';
      }
    }
  }
  window.loadBMStaff = loadBMStaff;

  function renderBMStaffTable(users) {
    var tbody = $('bm-staff-tbody');
    if (!tbody) return;

    var totalCount = (users || []).length;
    var activeCount = (users || []).filter(function (u) { return u.status === 'active'; }).length;
    var inactiveCount = totalCount - activeCount;

    if ($('bm-staff-stat-total')) $('bm-staff-stat-total').textContent = totalCount;
    if ($('bm-staff-stat-active')) $('bm-staff-stat-active').textContent = activeCount;
    if ($('bm-staff-stat-inactive')) $('bm-staff-stat-inactive').textContent = inactiveCount;

    if (!users || !users.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Belum ada staf kasir atau operasional terdaftar di cabang ini.</td></tr>';
      return;
    }

    var myId = (getStoredUser() || {}).id;

    tbody.innerHTML = users.map(function (u) {
      var isMe = u.id === myId;
      var isActive = u.status === 'active';
      var roleBadge = u.role === 'cashier'
        ? '<span class="x-badge x-badge-warning">KASIR</span>'
        : (u.role === 'kitchen' ? '<span class="x-badge" style="background:#ede9fe;color:#6d28d9;">DAPUR</span>' : '<span class="x-badge x-badge-info">' + esc(u.role).toUpperCase() + '</span>');

      var statusToggle = '' +
        '<label class="x-toggle' + (isActive ? ' x-toggle-on' : '') + '" style="margin:0 auto;display:inline-block;vertical-align:middle;">' +
          '<input type="checkbox" ' + (isActive ? 'checked ' : '') + (isMe ? 'disabled ' : '') +
            'onchange="toggleBMStaffStatus(\'' + u.id + '\', \'' + esc(u.full_name) + '\', this)">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      var actions = '';
      if (isMe) {
        actions = '<span class="text-muted" style="font-size:11px;">Akun Anda</span>';
      } else {
        actions = '<div style="display:flex; justify-content:flex-end; gap:6px;">' +
          '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="resetBMStaffPassword(\'' + u.id + '\', \'' + esc(u.full_name) + '\')">Reset Password</button>' +
        '</div>';
      }

      return '<tr>' +
        '<td><strong>' + esc(u.full_name) + '</strong></td>' +
        '<td><code style="font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px;">' + esc(u.username) + '</code></td>' +
        '<td>' + roleBadge + '</td>' +
        '<td style="color:var(--text-muted);">' + esc(u.email || '—') + '</td>' +
        '<td class="text-center" style="vertical-align:middle;text-align:center;">' + statusToggle + '</td>' +
        '<td class="text-right" style="white-space:nowrap;vertical-align:middle;">' + actions + '</td>' +
      '</tr>';
    }).join('');
  }

  function openBMAddCashierModal() {
    var modal = $('modal-bm-add-cashier');
    if (modal) {
      var form = $('form-bm-add-cashier');
      if (form) form.reset();
      modal.style.display = 'flex';
    }
  }
  window.openBMAddCashierModal = openBMAddCashierModal;

  function closeBMAddCashierModal() {
    var modal = $('modal-bm-add-cashier');
    if (modal) modal.style.display = 'none';
  }
  window.closeBMAddCashierModal = closeBMAddCashierModal;

  async function submitBMAddCashier(e) {
    if (e && e.preventDefault) e.preventDefault();
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) {
      showToast('Gagal: Sesi branch manager tidak valid.');
      return;
    }

    var fullName = ($('bm-cashier-fullname') ? $('bm-cashier-fullname').value : '').trim();
    var username = ($('bm-cashier-username') ? $('bm-cashier-username').value : '').trim();
    var password = ($('bm-cashier-password') ? $('bm-cashier-password').value : '').trim();
    var email = ($('bm-cashier-email') ? $('bm-cashier-email').value : '').trim();

    if (!fullName || !username || !password) {
      showToast('Harap lengkapi semua kolom wajib.');
      return;
    }

    var btn = $('btn-bm-submit-cashier');
    if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

    try {
      var res = await adminFetch(API_BASE + '/admin/users', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          full_name: fullName,
          username: username,
          password: password,
          email: email || undefined,
          role: 'cashier',
          branch_id: branchId
        })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Akun kasir ' + username + ' berhasil ditambahkan.');
        closeBMAddCashierModal();
        loadBMStaff();
      } else {
        showToast('Gagal menambahkan kasir: ' + (data.error || data.message || 'Terjadi kesalahan'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Simpan Akun'; }
    }
  }
  window.submitBMAddCashier = submitBMAddCashier;

  async function toggleBMStaffStatus(userId, name, inputElem) {
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
      if (!confirm('Nonaktifkan akun kasir "' + name + '"? Kasir ini tidak akan bisa login sampai diaktifkan kembali.')) {
        revert();
        return;
      }
    }

    if (inputElem) inputElem.disabled = true;

    try {
      var endpoint = willActivate ? '/enable' : '/disable';
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + endpoint, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Akun "' + name + '" berhasil ' + (willActivate ? 'diaktifkan.' : 'dinonaktifkan.'));
        loadBMStaff();
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
        revert();
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
      revert();
    }
  }
  window.toggleBMStaffStatus = toggleBMStaffStatus;

  async function resetBMStaffPassword(userId, name) {
    if (!confirm('Generate token reset password untuk kasir "' + name + '"? Token hanya dapat dilihat sekali.')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + '/reset-password', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success && data.reset_token) {
        if ($('reset-password-user-name')) $('reset-password-user-name').value = name;
        if ($('reset-password-token')) $('reset-password-token').value = data.reset_token;
        if ($('modal-reset-password')) $('modal-reset-password').style.display = 'flex';
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.resetBMStaffPassword = resetBMStaffPassword;


  /* =========================================================================
     SURFACE WIRING + BOOT
     ========================================================================= */

  // The shared branch-catalog module refreshes the BM menu after mutations.
  if (Catalog) {
    Catalog.setHooks({ refreshBMMenu: function () { loadBMMenu(); } });
    Catalog.setBmMenuState(_bmMenuState);
  }

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
    if ($('dash-user-role')) $('dash-user-role').textContent = (user.role || 'branch_manager').toUpperCase();

    var searchBtn = $('btn-global-search');
    if (searchBtn) searchBtn.style.display = 'none';
    var topbarBrandBadge = $('topbar-brand-badge');
    if (topbarBrandBadge) topbarBrandBadge.style.display = 'none';

    // Branch context is locked to the authenticated branch; no switcher affordance.
    var branchSelectorWrap = $('x-branch-selector');
    if (branchSelectorWrap) branchSelectorWrap.style.display = 'none';
    var bmBranchBadge = $('dash-bm-branch-badge');
    if (bmBranchBadge) bmBranchBadge.style.display = 'flex';
    if (user.branch_id) {
      Catalog.state.branchId = user.branch_id;
      var bmBranchName = $('dash-bm-branch-name');
      if (bmBranchName && (user.branch_name || user.brand_name)) {
        bmBranchName.textContent = user.branch_name || user.brand_name;
      }
    }
  }

  async function boot() {
    await handleHandoffExchange();

    if (!checkAuth()) return;

    var user = getStoredUser();
    // Not signed in at all → the unified login.
    if (!user) { window.location.replace('/login'); return; }

    var isValid = await validateServerSession();
    if (!isValid) return;

    // Surface guard: the server resolves the landing surface for this role, so
    // swapping the URL can never grant a surface this role does not own.
    if (enforceSurface(['/merchant/', '/merchant-app/'])) return;

    applyRoleBasedUI();
    renderBranchManagerNavigation();
    applyRoute(getCurrentRoute());
  }

  window.addEventListener('hashchange', function () { applyRoute(getCurrentRoute()); });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
