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
  var clearStoredSession = S.clearStoredSession;
  var redirectToLogin = S.redirectToLogin;
  var handleHandoffExchange = S.handleHandoffExchange;
  var validateServerSession = S.validateServerSession;
  var enforceSurface = S.enforceSurface;
  var Catalog = window.XentraBranchCatalog;

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




  /* =========================================================================
     BM-2: OPERASIONAL PESANAN & MEJA (BRANCH MANAGER OPERATIONAL CENTER)
     ========================================================================= */


  /* =========================================================================
     BM-3: OPERASIONAL MENU, STOK & PROMO (BRANCH MANAGER OPERATIONAL CENTER)
     ========================================================================= */

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

  /**
   * Tombol keluar di header.
   *
   * Sesi merchant disimpan di localStorage oleh apps/merchant-shared, jadi keluar
   * berarti membersihkan sesi itu lalu kembali ke login terpadu. Tanpa handler ini
   * tombolnya tampil tapi tidak melakukan apa pun — persis seperti keluhan
   * "tidak bisa logout".
   */
  function initAuthListeners() {
    var btnLogout = $('btn-logout');
    if (!btnLogout) return;
    btnLogout.addEventListener('click', function () {
      if (!confirm('Apakah Anda ingin keluar dari Merchant App?')) return;
      clearStoredSession();
      redirectToLogin();
    });
  }

  async function boot() {
    initAuthListeners();

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
