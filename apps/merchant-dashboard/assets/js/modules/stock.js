/**
 * XENTRA OWNER DASHBOARD — STOCK & INVENTORY MODULE
 * Standalone modular controller for raw materials, recipes, replenishment, mandates, suppliers & purchase history.
 */
(function (window, document) {
  'use strict';

  var S = window.XentraShared || {};
  var $ = S.$ || function (id) { return document.getElementById(id); };
  var esc = S.esc || function (t) { return t || ''; };
  var escapeHtml = esc;
  var formatMoney = S.formatMoney || function (v) { return 'Rp ' + Number(v || 0).toLocaleString('id-ID'); };
  var showToast = S.showToast || function (m) { alert(m); };
  var API_BASE = S.API_BASE || '/api/v1';

  function getEffectiveBranchId() {
    if (typeof window.getEffectiveBranchId === 'function') return window.getEffectiveBranchId();
    var b = window._branchContextState;
    return (b && b.selected !== 'all') ? b.selected : '';
  }

  function adminFetch(url, options) {
    if (typeof window.adminFetch === 'function') return window.adminFetch(url, options);
    return fetch(url, options);
  }

  function getAuthHeaders(extraHeaders) {
    var headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    var token = localStorage.getItem(S.TOKEN_KEY || 'xentra_merchant_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
  }

  /* =========================================================================
     OWNER STOCK OVERVIEW — read-only inventory health
     Uses the authoritative Reporting inventory/operations endpoint.
     Owner may observe stock health; stock mutation remains Branch operations.
     ========================================================================= */

  var _ownerStockLoadedOnce = false;
  var _ownerStockShowAllAlerts = false;

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

    var allItemsContainer = $('owner-stock-all-items-container');
    if (allItemsContainer) allItemsContainer.innerHTML = '<div class="x-owner-stock-loading">Memuat seluruh data stok...</div>';

    return adminFetch(API_BASE + '/reports/operations' + query, {
      headers: getAuthHeaders()
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok || !json || !json.success || !json.data) {
          var errMsg = (json && (json.error || json.message)) || ('Gagal memuat data stok (HTTP ' + res.status + ')');
          throw new Error(errMsg);
        }
        return json;
      });
    }).then(function (json) {
      renderOwnerStockOverview(json.data);
      _ownerStockLoadedOnce = true;
    }).catch(function (err) {
      console.warn('[Owner Stock Load Error]:', err);
      var message = err && err.message === 'SESSION_EXPIRED'
        ? 'Sesi berakhir. Silakan masuk kembali.'
        : (err && err.message ? err.message : 'Data stok belum dapat dimuat. Coba lagi.');
      if (alertList) alertList.innerHTML = '<div class="x-owner-stock-error">' + escapeHtml(message) + '</div>';
      if (branchList) branchList.innerHTML = '<div class="x-owner-stock-error">' + escapeHtml(message) + '</div>';
      if (movementList) movementList.innerHTML = '<div class="x-owner-stock-error">' + escapeHtml(message) + '</div>';
      if (allItemsContainer) allItemsContainer.innerHTML = '<div class="x-owner-stock-error">' + escapeHtml(message) + '</div>';
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
        var maxInitial = _ownerStockShowAllAlerts ? alerts.length : 8;
        alerts.slice(0, maxInitial).forEach(function (a) {
          var current = Number(a.current_stock);
          var threshold = Number(a.low_stock_threshold);
          var isOut = current <= 0;
          var gap = Math.max(threshold - current, 0);
          var branchAttr = a.branch_id ? ' data-branch-id="' + escapeHtml(a.branch_id) + '"' : '';
          alertHtml +=
            '<div class="x-owner-stock-alert-row ' + (isOut ? 'is-out' : '') + '" style="cursor:pointer;"' + branchAttr + ' onclick="selectOwnerStockBranch(\'' + escapeHtml(a.branch_id || '') + '\')" title="Klik untuk filter ke cabang ini">' +
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
        if (alerts.length > 8 && !_ownerStockShowAllAlerts) {
          alertHtml += '<button type="button" class="x-owner-stock-more" id="btn-owner-stock-more-alerts">Tampilkan seluruh ' + formatUnitCount(alerts.length) + ' item perhatian</button>';
        } else if (_ownerStockShowAllAlerts && alerts.length > 8) {
          alertHtml += '<button type="button" class="x-owner-stock-more" id="btn-owner-stock-collapse-alerts" style="background:#F1F5F9; color:#475569;">▲ Ciutkan daftar (tampilkan 8)</button>';
        }
        alertList.innerHTML = alertHtml;
        var moreBtn = $('btn-owner-stock-more-alerts');
        if (moreBtn) {
          moreBtn.addEventListener('click', function () {
            _ownerStockShowAllAlerts = true;
            renderOwnerStockOverview(data);
          });
        }
        var collapseBtn = $('btn-owner-stock-collapse-alerts');
        if (collapseBtn) {
          collapseBtn.addEventListener('click', function () {
            _ownerStockShowAllAlerts = false;
            renderOwnerStockOverview(data);
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
          var branchId = escapeHtml(row.branch_id || '');
          return (
            '<div class="x-owner-stock-branch-row" style="cursor:pointer;" onclick="selectOwnerStockBranch(\'' + branchId + '\')" title="Klik untuk fokus pada cabang ini">' +
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

    var allItems = Array.isArray(data.all_stock_items) ? data.all_stock_items : [];
    _allStockItemsCache = allItems;
    renderOwnerStockAllItems();
  }

  var _allStockItemsCache = [];
  var _allStockItemsSearchQuery = '';
  var _allStockItemsStatusFilter = 'all';

  function onOwnerStockItemsSearch(val) {
    _allStockItemsSearchQuery = (val || '').trim().toLowerCase();
    renderOwnerStockAllItems();
  }
  window.onOwnerStockItemsSearch = onOwnerStockItemsSearch;

  function onOwnerStockStatusFilter(val) {
    _allStockItemsStatusFilter = val || 'all';
    renderOwnerStockAllItems();
  }
  window.onOwnerStockStatusFilter = onOwnerStockStatusFilter;

  function renderOwnerStockAllItems() {
    var container = $('owner-stock-all-items-container');
    if (!container) return;

    var items = _allStockItemsCache || [];

    if (_allStockItemsSearchQuery) {
      items = items.filter(function (it) {
        var name = (it.product_name || '').toLowerCase();
        var sku = (it.sku || '').toLowerCase();
        var branch = (it.branch_name || '').toLowerCase();
        var cat = (it.category_name || '').toLowerCase();
        return name.includes(_allStockItemsSearchQuery) ||
               sku.includes(_allStockItemsSearchQuery) ||
               branch.includes(_allStockItemsSearchQuery) ||
               cat.includes(_allStockItemsSearchQuery);
      });
    }

    if (_allStockItemsStatusFilter !== 'all') {
      items = items.filter(function (it) {
        var cur = Number(it.current_stock || 0);
        var th = Number(it.low_stock_threshold || 5);
        if (_allStockItemsStatusFilter === 'out') return cur <= 0;
        if (_allStockItemsStatusFilter === 'low') return cur > 0 && cur <= th;
        if (_allStockItemsStatusFilter === 'safe') return cur > th;
        return true;
      });
    }

    if (!items.length) {
      container.innerHTML = '<div class="x-owner-stock-empty-compact">Tidak ada data produk yang sesuai filter.</div>';
      return;
    }

    var mobileCards = items.map(function (it) {
      var cur = Number(it.current_stock || 0);
      var th = Number(it.low_stock_threshold || 5);
      var isOut = cur <= 0;
      var isLow = cur > 0 && cur <= th;
      var isDirect = (it.inventory_type || '').toUpperCase() === 'DIRECT';

      var statusText = isOut ? 'Habis' : (isLow ? 'Menipis' : 'Aman');
      var statusClass = isOut ? 'danger' : (isLow ? 'warning' : 'good');

      var typeBadge = isDirect
        ? '<span class="x-badge" style="background:#F1F5F9; color:#475569; font-size:10px; font-weight:700; padding:1px 6px; border-radius:4px;">Barang Jadi</span>'
        : '<span class="x-badge" style="background:#EFF6FF; color:#1D4ED8; font-size:10px; font-weight:700; padding:1px 6px; border-radius:4px;">Menu Olahan</span>';

      var modalArgs = '\'' + escapeHtml(it.branch_id) + '\', \'' + escapeHtml(it.product_id) + '\', \'' + escapeHtml(it.product_name || '').replace(/'/g, "\\'") + '\', \'' + escapeHtml(it.branch_name || '').replace(/'/g, "\\'") + '\', \'' + escapeHtml(it.sku || '').replace(/'/g, "\\'") + '\', ' + cur + ', ' + th;

      var actionBtn = '<button type="button" class="x-btn-secondary" style="margin-top:6px; font-size:11px; padding:5px 10px; border-radius:6px; font-weight:700; display:inline-flex; align-items:center; gap:4px; background:#FFFFFF; color:#0F172A; border:1px solid #CBD5E1; cursor:pointer;" onclick="event.stopPropagation(); openProductStockOpnameModal(' + modalArgs + ')">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> Atur' +
        '</button>';

      return (
        '<div class="x-owner-stock-item-card ' + (isOut ? 'is-out' : '') + '" onclick="openProductStockOpnameModal(' + modalArgs + ')" style="cursor:pointer;">' +
          '<div class="x-owner-stock-item-card-main">' +
            '<div class="x-owner-stock-item-card-top">' +
              '<span class="x-owner-stock-branch-badge ' + statusClass + '">' + statusText + '</span>' +
              '<span class="x-owner-stock-item-card-branch">' + escapeHtml(it.branch_name || '-') + '</span>' +
              typeBadge +
            '</div>' +
            '<strong class="x-owner-stock-item-card-title">' + escapeHtml(it.product_name || '-') + '</strong>' +
            '<div class="x-owner-stock-item-card-sub">' +
              (it.sku ? '<span class="x-owner-stock-item-sku">SKU: ' + escapeHtml(it.sku) + '</span>' : '') +
              (it.category_name ? '<span class="x-owner-stock-item-cat">' + escapeHtml(it.category_name) + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="x-owner-stock-item-card-stock">' +
            '<div class="x-owner-stock-item-card-cur ' + (isOut ? 'text-danger' : (isLow ? 'text-warning' : '')) + '">' +
              '<strong>' + formatUnitCount(cur) + '</strong> <small>unit</small>' +
            '</div>' +
            '<div class="x-owner-stock-item-card-min">Min. ' + formatUnitCount(th) + '</div>' +
            actionBtn +
          '</div>' +
        '</div>'
      );
    }).join('');

    var desktopRows = items.map(function (it) {
      var cur = Number(it.current_stock || 0);
      var th = Number(it.low_stock_threshold || 5);
      var isOut = cur <= 0;
      var isLow = cur > 0 && cur <= th;
      var isDirect = (it.inventory_type || '').toUpperCase() === 'DIRECT';

      var statusText = isOut ? 'Habis' : (isLow ? 'Menipis' : 'Aman');
      var statusClass = isOut ? 'danger' : (isLow ? 'warning' : 'good');

      var deskModalArgs = '\'' + escapeHtml(it.branch_id) + '\', \'' + escapeHtml(it.product_id) + '\', \'' + escapeHtml(it.product_name || '').replace(/'/g, "\\'") + '\', \'' + escapeHtml(it.branch_name || '').replace(/'/g, "\\'") + '\', \'' + escapeHtml(it.sku || '').replace(/'/g, "\\'") + '\', ' + cur + ', ' + th;

      var deskAction = '<button type="button" class="x-btn-secondary" style="font-size:11.5px; padding:5px 12px; border-radius:6px; font-weight:700; display:inline-flex; align-items:center; gap:5px; background:#FFFFFF; color:#0F172A; border:1px solid #CBD5E1; cursor:pointer;" onclick="event.stopPropagation(); openProductStockOpnameModal(' + deskModalArgs + ')">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> Atur' +
        '</button>';

      var deskTypeBadge = isDirect
        ? '<span class="x-badge" style="background:#F1F5F9; color:#475569; font-size:10px; font-weight:700; padding:1px 5px; border-radius:4px; margin-right:4px;">Barang Jadi</span>'
        : '<span class="x-badge" style="background:#EFF6FF; color:#1D4ED8; font-size:10px; font-weight:700; padding:1px 5px; border-radius:4px; margin-right:4px;">Menu Olahan</span>';

      return (
        '<tr class="x-owner-stock-table-tr">' +
          '<td class="x-owner-stock-table-td main-col">' +
            '<div class="x-owner-stock-td-title">' + escapeHtml(it.product_name || '-') + '</div>' +
            '<div class="x-owner-stock-td-sub">' +
              deskTypeBadge +
              (it.sku ? 'SKU: ' + escapeHtml(it.sku) : '') + (it.category_name ? ' • ' + escapeHtml(it.category_name) : '') +
            '</div>' +
          '</td>' +
          '<td class="x-owner-stock-table-td">' + escapeHtml(it.branch_name || '-') + '</td>' +
          '<td class="x-owner-stock-table-td text-center">' +
            '<strong class="' + (isOut ? 'text-danger' : (isLow ? 'text-warning' : '')) + '">' + formatUnitCount(cur) + '</strong> <small class="text-muted">unit</small>' +
          '</td>' +
          '<td class="x-owner-stock-table-td text-center text-muted">' + formatUnitCount(th) + ' unit</td>' +
          '<td class="x-owner-stock-table-td text-center">' +
            '<span class="x-owner-stock-branch-badge ' + statusClass + '">' + statusText + '</span>' +
          '</td>' +
          '<td class="x-owner-stock-table-td text-right">' + deskAction + '</td>' +
        '</tr>'
      );
    }).join('');

    container.innerHTML = (
      '<div class="x-owner-stock-items-mobile-list">' + mobileCards + '</div>' +
      '<div class="x-owner-stock-items-desktop-table">' +
        '<table class="x-owner-stock-table">' +
          '<thead>' +
            '<tr>' +
              '<th style="text-align:left;">Menu / Produk</th>' +
              '<th style="text-align:left;">Cabang</th>' +
              '<th style="text-align:center;">Sisa Stok</th>' +
              '<th style="text-align:center;">Batas Min.</th>' +
              '<th style="text-align:center;">Status</th>' +
              '<th style="text-align:right;">Aksi</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' + desktopRows + '</tbody>' +
        '</table>' +
      '</div>'
    );
  }

  function initOwnerStockControls() {
    var refresh = $('btn-owner-stock-refresh');
    var report = $('btn-owner-stock-full-report');
    if (refresh) refresh.addEventListener('click', loadOwnerStockOverview);
    if (report) report.addEventListener('click', function () {
      navigateTo('reports/operations');
    });
  }

  function selectOwnerStockBranch(branchId) {
    if (!branchId) return;
    var sel = $('dash-branch-context');
    if (sel) {
      sel.value = branchId;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  window.selectOwnerStockBranch = selectOwnerStockBranch;

  /* =========================================================================
     MATERIAL MASTER (BAHAN BAKU) & UOM CONTROLS
     Owner & Brand Manager catalog management for production & procurement.
     ========================================================================= */
  var _ownerMaterials = [];
  var _ownerUoms = [];

  function switchStockSubtab(subtab) {
    if (!subtab) subtab = 'branches';
    var branchContent = $('subtab-content-stock-branches');
    var replContent = $('subtab-content-stock-replenishment');
    var mandatesContent = $('subtab-content-stock-mandates');
    var recipesContent = $('subtab-content-stock-recipes');
    var matContent = $('subtab-content-stock-materials');
    var historyContent = $('subtab-content-stock-history');
    var suppliersContent = $('subtab-content-stock-suppliers');

    var editorView = $('recipe-editor-view');
    var mainView = $('owner-stock-main-view');
    if (editorView && editorView.style.display !== 'none') {
      editorView.style.display = 'none';
      if (mainView) mainView.style.display = 'block';
    }

    document.querySelectorAll('#stock-subnav-tabs .x-subnav-tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.subtab === subtab);
    });

    if (branchContent) branchContent.style.display = subtab === 'branches' ? 'block' : 'none';
    if (replContent) replContent.style.display = subtab === 'replenishment' ? 'block' : 'none';
    if (mandatesContent) mandatesContent.style.display = subtab === 'mandates' ? 'block' : 'none';
    if (recipesContent) recipesContent.style.display = subtab === 'recipes' ? 'block' : 'none';
    if (matContent) matContent.style.display = subtab === 'materials' ? 'block' : 'none';
    if (historyContent) historyContent.style.display = subtab === 'history' ? 'block' : 'none';
    if (suppliersContent) suppliersContent.style.display = subtab === 'suppliers' ? 'block' : 'none';

    if (subtab === 'replenishment') {
      loadOwnerReplenishmentSuggestions();
    } else if (subtab === 'mandates') {
      loadOwnerMandates();
    } else if (subtab === 'recipes') {
      loadOwnerRecipes();
    } else if (subtab === 'materials') {
      loadOwnerMaterials();
      loadOwnerUoms();
    } else if (subtab === 'history') {
      loadOwnerPurchasingHistory();
    } else if (subtab === 'suppliers') {
      loadOwnerSuppliers();
    } else {
      loadOwnerStockOverview();
    }
  }

  /* =========================================================================
     MODUL: AUTOMATED REPLENISHMENT / SARAN BELANJA BERBASIS RESEP & MOQ
     ========================================================================= */
  var _ownerReplenishmentData = null;
  var _ownerReplenishmentQuery = '';

  function onReplenishmentSearchInput(val) {
    _ownerReplenishmentQuery = (val || '').trim().toLowerCase();
    if (_ownerReplenishmentData) {
      renderOwnerReplenishmentSuggestions(_ownerReplenishmentData);
    }
  }
  window.onReplenishmentSearchInput = onReplenishmentSearchInput;

  async function loadOwnerReplenishmentSuggestions() {
    var container = $('owner-replenishment-suggestions-container');
    if (container) {
      container.innerHTML = '<div class="x-owner-stock-loading">Memeriksa stok bahan belanjaan...</div>';
    }

    var branchId = getEffectiveBranchId();
    var query = branchId ? '?branch_id=' + encodeURIComponent(branchId) : '';

    try {
      var res = await adminFetch(API_BASE + '/admin/inventory-workflow/replenishment-suggestions' + query, {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (res.ok && data.success) {
        _ownerReplenishmentData = data.data || {};
        renderOwnerReplenishmentSuggestions(_ownerReplenishmentData);
      } else {
        if (container) {
          container.innerHTML = '<div class="x-owner-stock-error" style="color:#DC2626; padding:16px;">Gagal memuat saran belanja: ' + escapeHtml(data.error || 'Server error') + '</div>';
        }
      }
    } catch (e) {
      if (container) {
        container.innerHTML = '<div class="x-owner-stock-error" style="color:#DC2626; padding:16px;">Gagal menghubungi server untuk saran belanja.</div>';
      }
    }
  }
  window.loadOwnerReplenishmentSuggestions = loadOwnerReplenishmentSuggestions;

  var _selectedReplenishmentIds = new Set();
  var _replenishmentInitialized = false;

  function toggleReplenishmentItem(matId) {
    if (_selectedReplenishmentIds.has(matId)) {
      _selectedReplenishmentIds.delete(matId);
    } else {
      _selectedReplenishmentIds.add(matId);
    }
    if (_ownerReplenishmentData) {
      renderOwnerReplenishmentSuggestions(_ownerReplenishmentData);
    }
  }
  window.toggleReplenishmentItem = toggleReplenishmentItem;

  function toggleAllReplenishmentItems(checked) {
    if (!_ownerReplenishmentData || !_ownerReplenishmentData.suggestions) return;
    _selectedReplenishmentIds.clear();
    if (checked) {
      _ownerReplenishmentData.suggestions.forEach(function (s) {
        _selectedReplenishmentIds.add(s.material_id);
      });
    }
    renderOwnerReplenishmentSuggestions(_ownerReplenishmentData);
  }
  window.toggleAllReplenishmentItems = toggleAllReplenishmentItems;

  function renderOwnerReplenishmentSuggestions(data) {
    var container = $('owner-replenishment-suggestions-container');
    if (!container) return;

    var allSuggestions = data.suggestions || [];
    if (!allSuggestions.length) {
      container.innerHTML = '<div class="text-center py-10 text-muted" style="padding:32px 16px;">' +
        '<div style="font-size:36px; margin-bottom:8px;">✨</div>' +
        '<div style="font-size:15px; font-weight:700; color:#1E293B;">Semua Bahan Baku Aman</div>' +
        '<p style="font-size:13px; max-width:440px; margin:4px auto 0 auto; color:#64748B; line-height:1.5;">' +
          'Tidak ada menu siap saji atau bahan baku yang berada di bawah batas minimum pada lokasi ini.' +
        '</p>' +
      '</div>';
      return;
    }

    // Default: inisialisasi pilih semua hanya pada kali pertama data dimuat
    if (!_replenishmentInitialized) {
      _selectedReplenishmentIds.clear();
      allSuggestions.forEach(function (s) {
        _selectedReplenishmentIds.add(s.material_id);
      });
      _replenishmentInitialized = true;
    }

    var suggestions = allSuggestions;
    if (_ownerReplenishmentQuery) {
      suggestions = allSuggestions.filter(function (s) {
        var name = (s.material_name || '').toLowerCase();
        var code = (s.material_code || '').toLowerCase();
        var supName = (s.supplier && s.supplier.supplier_name ? s.supplier.supplier_name : '').toLowerCase();
        return name.includes(_ownerReplenishmentQuery) || code.includes(_ownerReplenishmentQuery) || supName.includes(_ownerReplenishmentQuery);
      });
    }

    if (suggestions.length === 0) {
      container.innerHTML = '<div class="text-center py-10 text-muted" style="padding:32px 16px;">' +
        '<div style="font-size:32px; margin-bottom:8px;">🔍</div>' +
        '<div style="font-size:15px; font-weight:700; color:#1E293B;">Tidak Ada Bahan yang Cocok</div>' +
        '<p style="font-size:13px; color:#64748B; margin-top:4px;">Tidak ditemukan rekomendasi pembelian dengan kata kunci "' + escapeHtml(_ownerReplenishmentQuery) + '"</p>' +
      '</div>';
      return;
    }

    var selectedItems = allSuggestions.filter(function (s) {
      return _selectedReplenishmentIds.has(s.material_id);
    });
    var currentSelectedCost = selectedItems.reduce(function (sum, s) {
      return sum + Number(s.estimated_cost || 0);
    }, 0);

    var cardsHtml = suggestions.map(function (s) {
      var isChecked = _selectedReplenishmentIds.has(s.material_id);
      var purchaseQty = s.recommended_purchase_packs || 1;
      var purchaseUnit = escapeHtml(s.purchase_uom_name || s.base_uom_name || 'Unit');
      var retailCost = Number(s.estimated_cost || 0);

      var isDirectOut = Number(s.current_stock || 0) <= 0;
      var priorityBadge = isDirectOut
        ? '<span style="font-size:11px; font-weight:800; background:#FEE2E2; color:#991B1B; padding:3px 8px; border-radius:6px;">🚨 Habis</span>'
        : '<span style="font-size:11px; font-weight:700; background:#FEF3C7; color:#92400E; padding:3px 8px; border-radius:6px;">🟡 Menipis</span>';

      return '<div style="background:#FFFFFF; border:1.5px solid ' + (isChecked ? '#059669' : '#E2E8F0') + '; border-radius:12px; padding:14px 16px; margin-bottom:10px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; box-shadow:' + (isChecked ? '0 2px 8px rgba(5,150,105,0.08)' : 'none') + ';" onclick="toggleReplenishmentItem(\'' + escapeHtml(s.material_id) + '\')">' +
        '<div style="display:flex; align-items:center; gap:12px;">' +
          '<div style="width:22px; height:22px; border-radius:6px; border:2px solid ' + (isChecked ? '#059669' : '#cbd5e1') + '; background:' + (isChecked ? '#059669' : '#ffffff') + '; display:flex; align-items:center; justify-content:center;">' +
            '<svg viewBox="0 0 12 12" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; display:' + (isChecked ? 'block' : 'none') + ';"><polyline points="2 6 4.5 9 10 3"></polyline></svg>' +
          '</div>' +
          '<div>' +
            '<div style="display:flex; align-items:center; gap:8px;">' +
              '<strong style="font-size:15px; color:#0F172A;">' + escapeHtml(s.material_name) + '</strong>' +
              priorityBadge +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex; align-items:center; gap:16px;">' +
          '<div style="text-align:right;">' +
            '<div style="font-size:11px; color:#64748B; font-weight:600; text-transform:uppercase;">Saran Belanja:</div>' +
            '<strong style="font-size:17px; color:#059669;">' + purchaseQty + ' ' + purchaseUnit + '</strong>' +
          '</div>' +
          (retailCost > 0 ? (
            '<div style="text-align:right; border-left:1px solid #E2E8F0; padding-left:14px;">' +
              '<div style="font-size:11px; color:#64748B; font-weight:600; text-transform:uppercase;">Est. Biaya:</div>' +
              '<strong style="font-size:15px; color:#0F172A;">' + formatMoney(retailCost) + '</strong>' +
            '</div>'
          ) : '') +
        '</div>' +
      '</div>';
    }).join('');

    var isAllSelected = selectedItems.length === suggestions.length && suggestions.length > 0;
    var summaryHeader = '<div style="background:#F1F5F9; border-radius:12px; padding:12px 16px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">' +
      '<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">' +
        '<div onclick="toggleAllReplenishmentItems(' + (!isAllSelected) + ')" style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:700; color:#1E293B;">' +
          '<div style="width:22px; height:22px; border-radius:6px; border:2px solid ' + (isAllSelected ? '#059669' : '#cbd5e1') + '; background:' + (isAllSelected ? '#059669' : '#ffffff') + '; display:flex; align-items:center; justify-content:center; box-shadow:' + (isAllSelected ? '0 2px 4px rgba(5, 150, 105, 0.2)' : 'none') + '; transition:all 0.16s ease;">' +
            '<svg viewBox="0 0 12 12" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; display:' + (isAllSelected ? 'block' : 'none') + ';">' +
              '<polyline points="2 6 4.5 9 10 3"></polyline>' +
            '</svg>' +
          '</div>' +
          '<span>Pilih Semua</span>' +
        '</div>' +
        '<span style="color:#CBD5E1;">|</span>' +
        '<div>' +
          '<div style="font-size:12px; color:#64748B;" id="replenishment-selected-count">' + selectedItems.length + ' dari ' + suggestions.length + ' bahan dipilih</div>' +
          '<div style="font-size:16px; font-weight:800; color:#0F172A;">Estimasi Belanja: <span id="replenishment-selected-cost">' + formatMoney(currentSelectedCost) + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex; gap:8px;">' +
        '<button type="button" class="x-btn-primary" id="btn-release-mandate-action" onclick="releaseMandateFromSuggestions()" ' + (selectedItems.length === 0 ? 'disabled style="opacity:0.5; padding:8px 16px; font-size:13px; font-weight:700; border-radius:10px; background:#059669; border-color:#059669; cursor:not-allowed;"' : 'style="padding:8px 16px; font-size:13px; font-weight:700; border-radius:10px; background:#059669; border-color:#059669; cursor:pointer;"') + '>' +
          '📋 Rilis Tugas Belanja ke Staf (' + selectedItems.length + ' Bahan)' +
        '</button>' +
      '</div>' +
    '</div>';

    container.innerHTML = summaryHeader + cardsHtml;
  }

  // Release mandate from replenishment suggestions
  async function releaseMandateFromSuggestions() {
    if (!_ownerReplenishmentData || !_ownerReplenishmentData.suggestions || !_ownerReplenishmentData.suggestions.length) {
      showToast('Tidak ada item saran belanja untuk dirilis.', 'warning');
      return;
    }

    var selectedSuggestions = _ownerReplenishmentData.suggestions.filter(function (s) {
      return _selectedReplenishmentIds.has(s.material_id);
    });

    if (!selectedSuggestions.length) {
      showToast('Centang minimal 1 bahan baku yang ingin dibeli.', 'warning');
      return;
    }

    // Resolusi cabang: jika di filter 'all', gunakan cabang aktif pertama dari data saran atau context
    var branchId = getEffectiveBranchId();
    if (!branchId || branchId === 'all') {
      branchId = _ownerReplenishmentData.branch_id || (_branchContextState.branches && _branchContextState.branches[0] ? _branchContextState.branches[0].id : '');
    }

    if (!branchId) {
      showToast('Pilih cabang tertentu terlebih dahulu.', 'warning');
      return;
    }

    var estCost = selectedSuggestions.reduce(function (sum, s) {
      return sum + Number(s.estimated_cost || 0);
    }, 0);

    var cashPrompt = await requestTextInputSheet({
      title: 'Uang Belanja',
      label: 'Masukkan uang belanja yang diserahkan ke staf:',
      value: estCost > 0 ? String(estCost) : '100000',
      placeholder: '0'
    });
    if (cashPrompt === null || cashPrompt === undefined) return;
    var cashAdvance = Number(cashPrompt) || 0;

    var items = selectedSuggestions.map(function (s) {
      return {
        material_id: s.material_id,
        target_quantity: s.recommended_purchase_packs || s.net_deficit_quantity || 1,
        estimated_unit_price: s.supplier ? s.supplier.unit_price : (s.unit_price || 0)
      };
    });

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/mandates', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          cash_advance: cashAdvance,
          notes: 'Mandat Belanja Otomatis dari Rekomendasi Sistem',
          items: items
        })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('✅ Tugas belanja #' + data.mandate.mandate_number + ' (' + items.length + ' item) berhasil dirilis ke staf!', 'success');
        switchStockSubtab('mandates');
      } else {
        showToast('Gagal rilis tugas belanja: ' + (data.message || data.error || 'Terjadi kesalahan'), 'error');
      }
    } catch (err) {
      showToast('Gangguan jaringan saat merilis tugas belanja.', 'error');
    }
  }
  window.releaseMandateFromSuggestions = releaseMandateFromSuggestions;

  /* =========================================================================
     MANDAT BELANJA (PURCHASING MANDATES): LIST, EDIT, ARCHIVE, DELETE
     ========================================================================= */
  var _ownerMandatesList = [];
  var _ownerMandatesQuery = '';

  function mandateHasUnpurchasedItems(m) {
    var items = m.items || [];
    if (!items.length) return false;
    return items.some(function (itm) { return !itm.is_purchased; });
  }

  function isMandateActive(m) {
    if (m.status === 'ARCHIVED') return false;
    return m.status === 'RELEASED' || mandateHasUnpurchasedItems(m);
  }

  function onMandatesSearchInput(val) {
    _ownerMandatesQuery = (val || '').trim().toLowerCase();
    applyMandatesFilterAndRender();
  }
  window.onMandatesSearchInput = onMandatesSearchInput;

  function applyMandatesFilterAndRender() {
    // Tab ini murni hanya menampilkan tugas yang sedang berjalan atau masih ada item belum dibeli.
    // Tugas yang 100% tuntas langsung berpindah ke Laporan & Riwayat Belanja.
    var list = _ownerMandatesList.filter(function (m) {
      return isMandateActive(m);
    });

    if (_ownerMandatesQuery) {
      list = list.filter(function (m) {
        var num = (m.mandate_number || '').toLowerCase();
        var notes = (m.notes || '').toLowerCase();
        var status = (m.status || '').toLowerCase();
        var itemsMatch = (m.items || []).some(function (itm) {
          return (itm.material_name || '').toLowerCase().includes(_ownerMandatesQuery);
        });
        return num.includes(_ownerMandatesQuery) || notes.includes(_ownerMandatesQuery) || status.includes(_ownerMandatesQuery) || itemsMatch;
      });
    }

    renderOwnerMandatesList(list);
  }

  async function loadOwnerMandates() {
    var container = $('owner-mandates-list-container');
    if (container) {
      container.innerHTML = '<div class="x-owner-stock-loading">Memuat daftar mandat belanja...</div>';
    }

    var branchId = getEffectiveBranchId();
    if (!branchId || branchId === 'all') {
      branchId = 'branch_1789606246242_08knv';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/mandates', {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (res.ok && data.success) {
        _ownerMandatesList = data.mandates || [];
        applyMandatesFilterAndRender();
      } else {
        if (container) {
          container.innerHTML = '<div class="x-owner-stock-error" style="color:#DC2626; padding:16px;">Gagal memuat mandat: ' + escapeHtml(data.error || 'Server error') + '</div>';
        }
      }
    } catch (err) {
      if (container) {
        container.innerHTML = '<div class="x-owner-stock-error" style="color:#DC2626; padding:16px;">Gangguan jaringan saat memuat mandat belanja.</div>';
      }
    }
  }
  window.loadOwnerMandates = loadOwnerMandates;

  function renderOwnerMandatesList(mandates) {
    var container = $('owner-mandates-list-container');
    if (!container) return;

    if (!mandates || !mandates.length) {
      if (_ownerMandatesQuery) {
        container.innerHTML = '<div class="text-center py-10 text-muted" style="padding:32px 16px;">' +
          '<div style="font-size:32px; margin-bottom:8px;">🔍</div>' +
          '<div style="font-size:15px; font-weight:700; color:#1E293B;">Tidak Ada Tugas yang Cocok</div>' +
          '<p style="font-size:13px; color:#64748B; margin-top:4px;">Tidak ditemukan tugas belanja aktif dengan kata kunci "' + escapeHtml(_ownerMandatesQuery) + '"</p>' +
        '</div>';
        return;
      }

      container.innerHTML = '<div class="text-center py-10 text-muted" style="padding:36px 16px; background:#F8FAFC; border-radius:12px; border:1px dashed #CBD5E1;">' +
        '<div style="font-size:36px; margin-bottom:8px;">🎉</div>' +
        '<div style="font-size:16px; font-weight:700; color:#0F172A;">Tidak Ada Tugas Belanja Berjalan</div>' +
        '<p style="font-size:13px; max-width:480px; margin:6px auto 16px auto; color:#64748B; line-height:1.5;">' +
          'Semua daftar belanja yang selesai otomatis tercatat di <strong>Laporan &amp; Riwayat Belanja</strong>. ' +
          'Belanjaan baru dapat ditugaskan melalui tab <strong>Saran Belanja</strong>.' +
        '</p>' +
        '<div style="display:flex; justify-content:center; gap:8px; flex-wrap:wrap;">' +
          '<button type="button" class="x-btn-primary" onclick="switchStockSubtab(\'history\')" style="padding:8px 16px; font-size:13px; font-weight:600; border-radius:8px; cursor:pointer;">' +
            '🧾 Buka Laporan &amp; Riwayat Belanja' +
          '</button>' +
          '<button type="button" class="x-btn-secondary" onclick="switchStockSubtab(\'replenishment\')" style="padding:8px 16px; font-size:13px; font-weight:600; border-radius:8px; cursor:pointer;">' +
            '⚡ Buat Tugas Belanja Baru' +
          '</button>' +
        '</div>' +
      '</div>';
      return;
    }

    var html = mandates.map(function (m) {
      var statusBadge = '';
      var hasUnpurchased = mandateHasUnpurchasedItems(m);
      if (m.status === 'RELEASED') {
        statusBadge = '<span class="x-badge" style="background:#FEF3C7; color:#92400E; font-weight:700;">AKTIF (DI PASAR)</span>';
      } else if (m.status === 'COMPLETED') {
        if (hasUnpurchased) {
          statusBadge = '<span class="x-badge" style="background:#FEF3C7; color:#B45309; font-weight:700;">SELESAI SEBAGIAN (ADA SISA BELUM DIBELI)</span>';
        } else {
          statusBadge = '<span class="x-badge" style="background:#D1FAE5; color:#065F46; font-weight:700;">100% SELESAI BELANJA</span>';
        }
      } else if (m.status === 'ARCHIVED') {
        statusBadge = '<span class="x-badge" style="background:#F1F5F9; color:#64748B; font-weight:700;">DIARSIPKAN</span>';
      } else {
        statusBadge = '<span class="x-badge" style="background:#E2E8F0; color:#334155; font-weight:700;">' + escapeHtml(m.status) + '</span>';
      }

      var itemsListHtml = (m.items || []).map(function (itm) {
        var isPurchased = Boolean(itm.is_purchased);
        return '<div style="display:flex; align-items:center; gap:8px; font-size:12.5px; padding:6px 8px; border-bottom:1px dashed #E2E8F0;' + (isPurchased ? ' opacity:0.85;' : ' background:#FFFBEB; border-radius:6px; margin:2px 0;') + '">' +
          (isPurchased
            ? '<span style="color:#059669; font-weight:800; font-size:15px; width:20px; text-align:center; flex-shrink:0;">✓</span>'
            : '<span style="color:#D97706; font-weight:800; font-size:15px; width:20px; text-align:center; flex-shrink:0;">⚠️</span>') +
          '<div style="flex:1; min-width:0;">' +
            '<strong style="' + (isPurchased ? 'text-decoration:line-through; color:#475569;' : 'color:#0F172A;') + '">' + escapeHtml(itm.material_name) + '</strong>' +
            ' <span style="color:#64748B;">(' + itm.target_quantity + ' ' + escapeHtml(itm.base_uom_code || '') + ')</span>' +
          '</div>' +
          '<div style="flex-shrink:0;">' +
            (isPurchased
              ? '<span style="color:#059669; font-weight:700; font-size:11.5px;">✓ Terbeli (' + itm.purchased_quantity + ' ' + escapeHtml(itm.base_uom_code || '') + ')</span>'
              : '<span style="color:#B45309; background:#FEF3C7; padding:2px 6px; border-radius:4px; font-weight:700; font-size:11px;">⚠️ Belum Dibeli</span>') +
          '</div>' +
        '</div>';
      }).join('');

      var canEdit = m.status === 'RELEASED';
      var actionButtons = '<div style="display:flex; gap:6px; margin-top:12px; flex-wrap:wrap;">';
      if (canEdit) {
        actionButtons += '<button type="button" class="x-btn-secondary" onclick="openEditMandateModal(\'' + m.id + '\')" style="padding:5px 10px; font-size:12px; font-weight:600; border-radius:6px; cursor:pointer;">✏️ Edit Tugas</button>';
      }
      if (m.status !== 'ARCHIVED') {
        actionButtons += '<button type="button" class="x-btn-secondary" onclick="archiveMandate(\'' + m.id + '\')" style="padding:5px 10px; font-size:12px; font-weight:600; border-radius:6px; cursor:pointer;">📁 Arsipkan</button>';
      }
      actionButtons += '<button type="button" class="x-btn-secondary" onclick="deleteMandate(\'' + m.id + '\')" style="padding:5px 10px; font-size:12px; font-weight:600; border-radius:6px; color:#DC2626; border-color:#FCA5A5; cursor:pointer;">🗑️ Hapus Permanen</button>';
      actionButtons += '</div>';

      return '<div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:12px; padding:16px; margin-bottom:12px;">' +
        '<div style="display:flex; justify-content:space-between; align-items:start; flex-wrap:wrap; gap:8px;">' +
        '<div>' +
            '<div style="display:flex; align-items:center; gap:8px;">' +
              '<strong style="font-size:15px; color:#0F172A;">Tugas #' + escapeHtml(m.mandate_number) + '</strong>' +
              statusBadge +
            '</div>' +
            '<div style="font-size:12px; color:#64748B; margin-top:4px;">Dibuat: ' + (m.created_at ? new Date(m.created_at).toLocaleString('id-ID') : '—') + (m.notes ? ' | ' + escapeHtml(m.notes) : '') + '</div>' +
          '</div>' +
          '<div style="text-align:right;">' +
            '<div style="font-size:11px; color:#64748B;">Uang Belanja:</div>' +
            '<strong style="font-size:15px; color:#059669;">' + formatMoney(m.cash_advance || 0) + '</strong>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:10px; background:#F8FAFC; border-radius:8px; padding:8px 12px;">' +
          '<div style="font-size:11px; font-weight:700; color:#64748B; text-transform:uppercase; margin-bottom:4px;">Rincian Bahan Baku Ditugaskan:</div>' +
          itemsListHtml +
        '</div>' +
        actionButtons +
      '</div>';
    }).join('');

    container.innerHTML = html;
  }

  // Open Edit Mandate Modal
  function openEditMandateModal(mandateId) {
    var mandate = _ownerMandatesList.find(function (m) { return m.id === mandateId; });
    if (!mandate) return;

    var modal = $('modal-edit-mandate');
    if (!modal) return;

    $('edit-mandate-id').value = mandate.id;
    var rawCash = Number(mandate.cash_advance || 0);
    $('edit-mandate-cash-advance').value = rawCash > 0 ? (window.XentraCurrencyInput ? window.XentraCurrencyInput.format(rawCash) : (window.XentraShared && window.XentraShared.formatNumber ? window.XentraShared.formatNumber(rawCash) : String(rawCash))) : '';
    $('edit-mandate-notes').value = mandate.notes || '';
    $('modal-edit-mandate-title').textContent = 'Edit Tugas #' + mandate.mandate_number;

    var container = $('edit-mandate-items-container');
    if (container) {
      container.innerHTML = (mandate.items || []).map(function (itm) {
        return '<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 10px; background:#F8FAFC; border-radius:8px; border:1px solid #E2E8F0;">' +
          '<div style="flex:1; min-width:0;">' +
            '<strong style="font-size:13px; color:#0F172A; display:block;">' + escapeHtml(itm.material_name) + '</strong>' +
            '<small style="font-size:11px; color:#64748B;">@ ' + formatMoney(itm.estimated_unit_price) + '</small>' +
          '</div>' +
          '<div style="width:110px;">' +
            '<input type="number" class="edit-mandate-item-qty" data-material-id="' + itm.material_id + '" data-unit-price="' + itm.estimated_unit_price + '" min="1" step="1" value="' + itm.target_quantity + '" style="width:100%; box-sizing:border-box; padding:6px 8px; border:1px solid #CBD5E1; border-radius:6px; font-size:13px; font-weight:700; text-align:right;">' +
          '</div>' +
        '</div>';
      }).join('');
    }

    if (window.XentraUI && window.XentraUI.Modal) {
      window.XentraUI.Modal.open('modal-edit-mandate');
    } else {
      modal.style.display = 'flex';
    }
  }
  window.openEditMandateModal = openEditMandateModal;

  function closeEditMandateModal() {
    if (window.XentraUI && window.XentraUI.Modal) {
      window.XentraUI.Modal.close('modal-edit-mandate');
    } else {
      var modal = $('modal-edit-mandate');
      if (modal) modal.style.display = 'none';
    }
  }
  window.closeEditMandateModal = closeEditMandateModal;

  // Submit Edit Mandate
  async function submitEditMandateForm(e) {
    if (e && e.preventDefault) e.preventDefault();
    var mandateId = $('edit-mandate-id').value;
    var cashAdvance = Number($('edit-mandate-cash-advance').value) || 0;
    var notes = $('edit-mandate-notes').value.trim();

    var branchId = getEffectiveBranchId();
    if (!branchId || branchId === 'all') branchId = 'branch_1789606246242_08knv';

    var qtyInputs = document.querySelectorAll('.edit-mandate-item-qty');
    var items = [];
    qtyInputs.forEach(function (inp) {
      items.push({
        material_id: inp.dataset.materialId,
        target_quantity: Number(inp.value) || 1,
        estimated_unit_price: Number(inp.dataset.unitPrice) || 0
      });
    });

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/mandates/' + encodeURIComponent(mandateId), {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          cash_advance: cashAdvance,
          notes: notes,
          items: items
        })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('✅ Tugas belanja berhasil diperbarui.', 'success');
        closeEditMandateModal();
        loadOwnerMandates();
      } else {
        showToast('Gagal update tugas belanja: ' + (data.message || data.error || 'Terjadi kesalahan'), 'error');
      }
    } catch (err) {
      showToast('Gangguan jaringan saat memperbarui tugas belanja.', 'error');
    }
  }
  window.submitEditMandateForm = submitEditMandateForm;

  // Archive Mandate
  async function archiveMandate(mandateId) {
    var ok = await confirmFeatureAction('archive-mandate-confirm', 'Arsipkan Tugas', 'Arsipkan tugas belanja ini? Tugas yang diarsipkan tidak akan muncul lagi di daftar aktif staf.', 'Arsipkan');
    if (!ok) return;

    var branchId = getEffectiveBranchId();
    if (!branchId || branchId === 'all') branchId = 'branch_1789606246242_08knv';

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/mandates/' + encodeURIComponent(mandateId) + '/archive', {
        method: 'PATCH',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('📁 Tugas belanja berhasil diarsipkan.', 'success');
        loadOwnerMandates();
      } else {
        showToast('Gagal arsip tugas belanja: ' + (data.message || data.error || 'Terjadi kesalahan'), 'error');
      }
    } catch (err) {
      showToast('Gangguan jaringan saat mengarsipkan tugas belanja.', 'error');
    }
  }
  window.archiveMandate = archiveMandate;

  // Delete Mandate Permanently
  async function deleteMandate(mandateId) {
    var ok = await confirmFeatureAction('delete-mandate-confirm', 'Hapus Tugas', 'Hapus permanen tugas belanja ini? Tindakan ini tidak dapat dibatalkan.', 'Hapus Permanen');
    if (!ok) return;

    var branchId = getEffectiveBranchId();
    if (!branchId || branchId === 'all') branchId = 'branch_1789606246242_08knv';

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/mandates/' + encodeURIComponent(mandateId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('🗑️ Tugas belanja berhasil dihapus secara permanen.', 'success');
        loadOwnerMandates();
      } else {
        showToast('Gagal menghapus tugas belanja: ' + (data.message || data.error || 'Terjadi kesalahan'), 'error');
      }
    } catch (err) {
      showToast('Gangguan jaringan saat menghapus tugas belanja.', 'error');
    }
  }
  window.deleteMandate = deleteMandate;

  function loadOwnerUoms() {
    return adminFetch(API_BASE + '/admin/uoms', { headers: getAuthHeaders() })
      .then(function (res) {
        if (!res.ok) throw new Error('Gagal memuat UOM');
        return res.json();
      })
      .then(function (data) {
        _ownerUoms = data.uoms || [];
        var targets = [$('mat-input-uom'), $('edit-mat-uom')];
        targets.forEach(function (select) {
          if (select && _ownerUoms.length > 0) {
            var currentVal = select.value;
            var html = '<option value="">Pilih Satuan Dasar...</option>';
            _ownerUoms.forEach(function (u) {
              html += '<option value="' + escapeHtml(u.id) + '">' + escapeHtml(u.name) + ' (' + escapeHtml(u.code) + ')</option>';
            });
            select.innerHTML = html;
            if (currentVal) select.value = currentVal;
          }
        });
      })
      .catch(function (err) {
        console.warn('[Materials] Load UOM error:', err.message);
      });
  }

  var _ownerMaterialsQuery = '';

  function onMaterialsSearchInput(val) {
    _ownerMaterialsQuery = (val || '').trim().toLowerCase();
    var filtered = _ownerMaterials;
    if (_ownerMaterialsQuery) {
      filtered = _ownerMaterials.filter(function (m) {
        var name = (m.name || '').toLowerCase();
        var code = (m.code || '').toLowerCase();
        return name.includes(_ownerMaterialsQuery) || code.includes(_ownerMaterialsQuery);
      });
    }
    renderOwnerMaterialsTable(filtered);
  }
  window.onMaterialsSearchInput = onMaterialsSearchInput;

  function loadOwnerMaterials() {
    var container = $('owner-materials-table-container');
    if (container) {
      container.innerHTML = '<div class="x-owner-stock-loading">Memuat daftar bahan baku...</div>';
    }

    adminFetch(API_BASE + '/admin/materials', { headers: getAuthHeaders() })
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
      if (_ownerMaterialsQuery && _ownerMaterials && _ownerMaterials.length > 0) {
        container.innerHTML = (
          '<div style="text-align:center; padding:32px 16px; color:#64748B;">' +
            '<div style="font-size:32px; margin-bottom:8px;">🔍</div>' +
            '<div style="font-size:14px; font-weight:700; color:#1E293B; margin-bottom:4px;">Tidak Ada Bahan yang Cocok</div>' +
            '<p style="font-size:13px; color:#64748B; margin:0;">Tidak ditemukan bahan baku dengan kata kunci "' + escapeHtml(_ownerMaterialsQuery) + '"</p>' +
          '</div>'
        );
        return;
      }
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
      var isArchived = m.status === 'archived' || m.status === 'ARCHIVED';
      var currentStock = Number(m.current_stock || 0);
      var minQty = Number(m.minimum_quantity || 0);
      var targetQty = Number(m.target_quantity || 0);
      var unitCost = Number(m.moving_average_unit_cost || m.unit_cost || 0);
      var uomLabel = m.base_uom_name ? (m.base_uom_name + ' (' + m.base_uom_code + ')') : (m.base_uom_code || m.base_uom_id);

      var minRecipeReq = Number(m.min_recipe_requirement || 0);
      var effectiveLowThreshold = Math.max(minQty, minRecipeReq);

      var stockStatusBadge = '';
      if (isArchived) {
        stockStatusBadge = '<span style="background:#F1F5F9; color:#64748B; padding:3px 8px; border-radius:4px; font-size:11px; font-weight:600;">Diarsipkan</span>';
      } else if (currentStock <= 0) {
        stockStatusBadge = '<span style="background:#FEF2F2; color:#DC2626; border:1px solid #FECACA; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700;">🔴 Habis</span>';
      } else if (effectiveLowThreshold > 0 && currentStock <= effectiveLowThreshold) {
        var reasonText = (minRecipeReq > 0 && currentStock <= minRecipeReq) ? 'Kurang untuk Masak' : ('Sisa ' + currentStock);
        stockStatusBadge = '<span style="background:#FFFBEB; color:#B45309; border:1px solid #FDE68A; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700;">🟡 Menipis (' + reasonText + ')</span>';
      } else {
        stockStatusBadge = '<span style="background:#ECFDF5; color:#059669; border:1px solid #A7F3D0; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700;">🟢 Aman</span>';
      }

      var stockDisplay = '<strong style="font-size:14px; color:' + (currentStock <= effectiveLowThreshold ? '#DC2626' : '#0F172A') + ';">' + currentStock + '</strong> <span style="font-size:11.5px; color:#64748B;">' + escapeHtml(m.base_uom_code || m.base_uom_name || '') + '</span>';
      var costDisplay = unitCost > 0 ? ('<strong style="color:#0F172A;">' + formatMoney(unitCost) + '</strong> <span style="font-size:11px; color:#64748B;">/' + escapeHtml(m.base_uom_code || '') + '</span>') : '<span style="color:#94A3B8; font-style:italic;">Belum ada harga</span>';
      var targetDisplay = targetQty > 0
        ? ('<strong style="color:#0F172A;">' + targetQty + '</strong> <span style="font-size:11px; color:#64748B;">' + escapeHtml(m.base_uom_code || '') + '</span>')
        : (minRecipeReq > 0 ? ('<span style="color:#D97706; font-size:11px; font-weight:600;">Min. ' + minRecipeReq + ' (Resep)</span>') : '<span style="color:#94A3B8; font-style:italic;">Belum diatur</span>');

      var actionHtml = (
        '<div style="display:flex; justify-content:flex-end; gap:6px;">' +
          '<button type="button" onclick="event.stopPropagation(); openEditMaterialModal(\'' + escapeHtml(m.id) + '\')" style="display:inline-flex; align-items:center; gap:4px; padding:5px 10px; border-radius:6px; font-size:12px; font-weight:600; background:#F1F5F9; color:#0F172A; border:1px solid #CBD5E1; cursor:pointer;" title="Atur Stok & Target Belanja">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg> Atur' +
          '</button>' +
          (!isArchived ? (
            '<button type="button" onclick="event.stopPropagation(); archiveOwnerMaterial(\'' + escapeHtml(m.id) + '\', \'' + escapeHtml(m.name).replace(/'/g, "\\'") + '\')" style="background:none; border:none; color:#94A3B8; cursor:pointer; font-size:11px; padding:4px 6px;" title="Arsipkan">' +
              'Arsip' +
            '</button>'
          ) : '') +
        '</div>'
      );

      return (
        '<tr style="border-bottom:1px solid #F1F5F9; cursor:pointer;" onclick="if (!event.target.closest(\'button, input, select\')) { openEditMaterialModal(\'' + escapeHtml(m.id) + '\'); }">' +
          '<td style="padding:12px 14px; font-weight:600; color:#0F172A; font-size:13px;">' +
            '<div style="font-weight:700; color:#0F172A;">' + escapeHtml(m.name) + '</div>' +
            '<div style="font-size:11px; color:#64748B;">Kode: ' + escapeHtml(m.material_code) + (m.description ? ' • ' + escapeHtml(m.description) : '') + '</div>' +
          '</td>' +
          '<td style="padding:12px 14px; font-size:13px;">' + stockDisplay + '</td>' +
          '<td style="padding:12px 14px; font-size:13px;">' + costDisplay + '</td>' +
          '<td style="padding:12px 14px; font-size:12px;">' + targetDisplay + '</td>' +
          '<td style="padding:12px 14px; font-size:13px;">' + stockStatusBadge + '</td>' +
          '<td style="padding:12px 14px; text-align:right; font-size:13px;">' + actionHtml + '</td>' +
        '</tr>'
      );
    }).join('');

    container.innerHTML = (
      '<div style="overflow-x:auto;">' +
        '<table style="width:100%; border-collapse:collapse; text-align:left;">' +
          '<thead>' +
            '<tr style="background:#F8FAFC; border-bottom:1px solid #E2E8F0; color:#64748B; font-size:12px; text-transform:uppercase; letter-spacing:0.025em;">' +
              '<th style="padding:10px 14px; font-weight:600;">Bahan Baku Mentah</th>' +
              '<th style="padding:10px 14px; font-weight:600;">Sisa Stok Fisik</th>' +
              '<th style="padding:10px 14px; font-weight:600;">Harga Pasar / Beli</th>' +
              '<th style="padding:10px 14px; font-weight:600;">Target Stok Resto</th>' +
              '<th style="padding:10px 14px; font-weight:600;">Status</th>' +
              '<th style="padding:10px 14px; font-weight:600; text-align:right;">Aksi</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>'
    );
  }

  window.openEditMaterialModal = function(matId) {
    var material = (_ownerMaterials || []).find(function(m) {
      return String(m.id) === String(matId);
    });
    if (!material) {
      showToast('Data bahan baku tidak ditemukan', 'warning');
      return;
    }

    var modal = $('modal-edit-material');
    if (!modal) return;
    if (window.XentraUI && window.XentraUI.Modal) {
      window.XentraUI.Modal.open('modal-edit-material');
    } else {
      modal.style.display = 'flex';
    }

    if ($('edit-mat-id')) $('edit-mat-id').value = material.id;
    if ($('edit-mat-name')) $('edit-mat-name').value = material.name || '';
    if ($('edit-mat-code')) $('edit-mat-code').value = material.material_code || '';

    var uomSelect = $('edit-mat-uom');
    if (uomSelect) {
      if (_ownerUoms && _ownerUoms.length > 0) {
        var html = '<option value="">Pilih Satuan Dasar...</option>';
        _ownerUoms.forEach(function (u) {
          html += '<option value="' + escapeHtml(u.id) + '">' + escapeHtml(u.name) + ' (' + escapeHtml(u.code) + ')</option>';
        });
        uomSelect.innerHTML = html;
      }
      uomSelect.value = material.base_uom_id || '';

      var syncUomSuffix = function () {
        var selectedUom = (_ownerUoms || []).find(function (u) { return String(u.id) === String(uomSelect.value); });
        var code = selectedUom ? (selectedUom.code || selectedUom.name) : (material.base_uom_code || material.base_uom_name || '');
        if ($('edit-mat-base-uom-suffix')) $('edit-mat-base-uom-suffix').textContent = code;
        if ($('edit-mat-target-unit-label')) $('edit-mat-target-unit-label').textContent = code || 'Satuan';
      };

      uomSelect.onchange = syncUomSuffix;
      syncUomSuffix();

      var enhanceFn = window.createFloatingDropdown || (window.XentraDropdown && window.XentraDropdown.enhance);
      if (typeof enhanceFn === 'function') {
        setTimeout(function () {
          enhanceFn(uomSelect);
          uomSelect.dispatchEvent(new Event('change'));
        }, 50);
      }
    }

    if ($('edit-mat-desc')) $('edit-mat-desc').value = material.description || '';

    if ($('edit-mat-current-stock')) $('edit-mat-current-stock').value = material.current_stock != null ? material.current_stock : 0;
    if ($('edit-mat-unit-cost')) {
      var cost = Number(material.moving_average_unit_cost || material.unit_cost || 0);
      if (window.XentraCurrencyInput) window.XentraCurrencyInput.setValue($('edit-mat-unit-cost'), cost);
      else $('edit-mat-unit-cost').value = cost;
    }
    if ($('edit-mat-min-qty')) $('edit-mat-min-qty').value = material.minimum_quantity != null ? material.minimum_quantity : 0;

    var baseUomCode = material.base_uom_code || material.base_uom_name || '';
    if ($('edit-mat-base-uom-suffix')) $('edit-mat-base-uom-suffix').textContent = baseUomCode;

    var targetUnitLabel = $('edit-mat-target-unit-label');
    if (targetUnitLabel) targetUnitLabel.textContent = baseUomCode;

    var targetInput = $('edit-mat-target-qty');
    var existingTarget = material.target_quantity != null ? Number(material.target_quantity) : '';

    if (targetInput) {
      targetInput.min = "0";
      targetInput.value = existingTarget !== '' ? existingTarget : '';
    }

    var targetHint = $('edit-mat-target-hint');
    if (targetHint) {
      targetHint.textContent = 'Jumlah stok yang ingin selalu tersedia di resto. Jika stok fisik kurang dari ini, sistem otomatis sarankan belanja.';
    }
  };

  window.closeEditMaterialModal = function() {
    if (window.XentraUI && window.XentraUI.Modal) {
      window.XentraUI.Modal.close('modal-edit-material');
    } else {
      var modal = $('modal-edit-material');
      if (modal) modal.style.display = 'none';
    }
    var form = $('form-edit-material');
    if (form) form.reset();
  };

  window.submitEditMaterialForm = async function(event) {
    if (event && event.preventDefault) event.preventDefault();

    var matId = $('edit-mat-id') ? $('edit-mat-id').value : '';
    var name = $('edit-mat-name') ? $('edit-mat-name').value.trim() : '';
    var baseUomId = $('edit-mat-uom') ? $('edit-mat-uom').value : '';
    var desc = $('edit-mat-desc') ? $('edit-mat-desc').value.trim() : '';
    var currentStock = $('edit-mat-current-stock') ? Number($('edit-mat-current-stock').value) : 0;
    var rawCost = $('edit-mat-unit-cost') ? $('edit-mat-unit-cost').value : '0';
    var unitCost = Number(String(rawCost).replace(/\D/g, '')) || 0;
    var targetQty = $('edit-mat-target-qty') ? Number($('edit-mat-target-qty').value) : 0;

    var btn = $('btn-save-edit-material');

    if (!matId || !name) {
      showToast('Nama bahan baku tidak boleh kosong', 'warning');
      return;
    }

    if (!baseUomId) {
      showToast('Satuan dasar (UOM) tidak boleh kosong', 'warning');
      return;
    }

    var currentMat = (_ownerMaterials || []).find(function(m) { return String(m.id) === String(matId); }) || {};

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Menyimpan...';
    }

    try {
      var minQty = Number(currentMat.minimum_quantity || 0);

      var payload = {
        name: name,
        description: desc || null,
        base_uom_id: baseUomId,
        current_stock: Math.max(0, currentStock),
        unit_cost: Math.max(0, unitCost),
        minimum_quantity: minQty,
        target_quantity: Math.max(0, targetQty)
      };

      var res = await adminFetch(API_BASE + '/admin/materials/' + encodeURIComponent(matId), {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Gagal memperbarui data bahan');
      }

      showToast('✅ Data bahan baku, stok fisik, & target belanja berhasil disimpan.', 'success');
      closeEditMaterialModal();
      loadOwnerMaterials();
      if (typeof loadOwnerReplenishmentSuggestions === 'function') loadOwnerReplenishmentSuggestions();
    } catch (err) {
      showToast('❌ Gagal: ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Simpan Perubahan';
      }
    }
  };

  function openAddMaterialModal() {
    var modal = $('modal-add-material');
    if (modal) {
      if (window.XentraUI && window.XentraUI.Modal) {
        window.XentraUI.Modal.open('modal-add-material');
      } else {
        modal.style.display = 'flex';
      }
      loadOwnerUoms();
    }
  }

  function closeAddMaterialModal() {
    if (window.XentraUI && window.XentraUI.Modal) {
      window.XentraUI.Modal.close('modal-add-material');
    } else {
      var modal = $('modal-add-material');
      if (modal) modal.style.display = 'none';
    }
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

    adminFetch(API_BASE + '/admin/materials', {
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

    adminFetch(API_BASE + '/admin/materials/' + encodeURIComponent(id) + '/archive', {
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

  /* =========================================================================
     MODUL: RESEP MASAKAN & BOM (BILL OF MATERIALS)
     ========================================================================= */
  var _ownerRecipes = [];
  var _ownerRecipesQuery = '';
  var _ownerInventoryContext = null;

  function onRecipesSearchInput(val) {
    _ownerRecipesQuery = (val || '').trim().toLowerCase();
    var filtered = _ownerRecipes;
    if (_ownerRecipesQuery) {
      filtered = _ownerRecipes.filter(function (r) {
        var prod = (r.product_name || r.name || '').toLowerCase();
        var compMatch = (r.components || []).some(function (c) {
          return (c.material_name || c.material_code || '').toLowerCase().includes(_ownerRecipesQuery);
        });
        return prod.includes(_ownerRecipesQuery) || compMatch;
      });
    }
    renderOwnerRecipesList(filtered);
  }
  window.onRecipesSearchInput = onRecipesSearchInput;

  function loadOwnerRecipes() {
    var container = $('owner-recipes-list-container');
    if (container) {
      container.innerHTML = '<div class="x-owner-stock-loading">Memuat resep masakan & komposisi bahan...</div>';
    }

    return adminFetch(API_BASE + '/admin/inventory-workflow/context', { headers: getAuthHeaders() })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (err) {
            throw new Error(err.message || err.error || ('Gagal memuat konteks resep masakan (HTTP ' + res.status + ')'));
          }).catch(function (e) {
            throw new Error(e.message || ('Gagal memuat konteks resep masakan (HTTP ' + res.status + ')'));
          });
        }
        return res.json();
      })
      .then(function (resData) {
        var data = resData.data || resData;
        _ownerInventoryContext = data;
        _ownerRecipes = data.recipes || [];
        if (data.materials) _ownerMaterials = data.materials;
        if (data.uoms) _ownerUoms = data.uoms;
        renderOwnerRecipesList(_ownerRecipes);
      })
      .catch(function (err) {
        if (container) {
          container.innerHTML = '<div class="x-owner-stock-error" style="color:#DC2626; padding:16px;">' + escapeHtml(err.message) + '</div>';
        }
      });
  }

  function renderOwnerRecipesList(recipes) {
    var container = $('owner-recipes-list-container');
    if (!container) return;

    if (!recipes || recipes.length === 0) {
      if (_ownerRecipesQuery && _ownerRecipes && _ownerRecipes.length > 0) {
        container.innerHTML = (
          '<div style="text-align:center; padding:36px 16px; color:#64748B;">' +
            '<div style="font-size:32px; margin-bottom:8px;">🔍</div>' +
            '<div style="font-size:15px; font-weight:700; color:#1E293B; margin-bottom:4px;">Tidak Ada Resep yang Cocok</div>' +
            '<p style="font-size:13px; color:#64748B;">Tidak ditemukan menu atau komposisi bahan dengan kata kunci "' + escapeHtml(_ownerRecipesQuery) + '"</p>' +
          '</div>'
        );
        return;
      }
      container.innerHTML = (
        '<div style="text-align:center; padding:36px 16px; color:#64748B;">' +
          '<div style="font-size:36px; margin-bottom:8px;">🍲</div>' +
          '<div style="font-size:15px; font-weight:700; color:#1E293B; margin-bottom:6px;">Belum Ada Resep Masakan</div>' +
          '<p style="font-size:13px; max-width:440px; margin:0 auto 16px auto; color:#64748B; line-height:1.5;">' +
            'Hubungkan menu siap saji dengan bahan mentah (ayam, bumbu, minyak, dll). Saat staf mencatat masak di dapur, bahan baku otomatis terpotong.' +
          '</p>' +
          '<button type="button" onclick="openAddRecipeModal()" style="display:inline-flex; align-items:center; gap:6px; padding:9px 18px; border-radius:8px; font-weight:600; font-size:13px; background:#0F172A; color:#FFFFFF; border:none; cursor:pointer;">' +
            '<span>+ Buat Resep Pertama</span>' +
          '</button>' +
        '</div>'
      );
      return;
    }

    var cards = recipes.map(function (recipe) {
      var componentsHtml = '';
      if (recipe.components && recipe.components.length > 0) {
        componentsHtml = recipe.components.map(function (c) {
          return (
            '<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid #F1F5F9; font-size:12px;">' +
              '<span style="color:#334155; font-weight:500;">' + escapeHtml(c.material_name || c.material_code) + '</span>' +
              '<span style="color:#64748B; font-weight:600; background:#F8FAFC; padding:2px 8px; border-radius:4px; border:1px solid #E2E8F0;">' +
                escapeHtml(c.planned_quantity) + ' ' + escapeHtml(c.planned_uom_name || c.base_uom_name || '') +
              '</span>' +
            '</div>'
          );
        }).join('');
      } else {
        componentsHtml = '<div style="font-size:12px; color:#94A3B8; font-style:italic;">Tidak ada daftar rincian bahan</div>';
      }

      var yieldBadge = (recipe.planned_yield_quantity || 1) + ' ' + (recipe.yield_uom_name || 'porsi');
      var unitCost = Number(recipe.cost_per_unit || 0);
      var sellPrice = Number(recipe.selling_price || 0);
      var marginPct = (sellPrice > 0 && unitCost > 0) ? Math.round(((sellPrice - unitCost) / sellPrice) * 100) : null;

      var costEconomicsHtml = '';
      if (unitCost > 0) {
        costEconomicsHtml = (
          '<div style="margin-top:10px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">' +
            '<div>' +
              '<div style="font-size:11px; color:#64748B;">Modal Bahan (HPP) / Porsi</div>' +
              '<div style="font-size:14px; font-weight:800; color:#0F172A;">' + formatMoney(unitCost) + '</div>' +
            '</div>' +
            (sellPrice > 0 ? (
              '<div style="text-align:right;">' +
                '<div style="font-size:11px; color:#64748B;">Harga Jual / Margin</div>' +
                '<div style="font-size:13px; font-weight:700; color:#166534;">' +
                  formatMoney(sellPrice) + (marginPct !== null ? ' (' + marginPct + '%)' : '') +
                '</div>' +
              '</div>'
            ) : '') +
          '</div>'
        );
      }

      var recipeId = recipe.recipe_id || recipe.id;
      return (
        '<div class="x-owner-recipe-card" style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:12px; padding:16px; display:flex; flex-direction:column; justify-content:space-between; box-shadow:0 1px 3px rgba(0,0,0,0.02); cursor:pointer; transition:all 0.15s ease;" onclick="if (!event.target.closest(\'button, select, input\')) { openEditRecipeModal(\'' + escapeHtml(recipeId) + '\'); }">' +
          '<div>' +
            '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">' +
              '<div style="flex:1; margin-right:8px;">' +
                '<h4 style="margin:0 0 4px 0; font-size:15px; font-weight:700; color:#0F172A;">' + escapeHtml(recipe.output_product_name || recipe.recipe_name) + '</h4>' +
                '<div style="font-size:12px; color:#64748B;">Formula: <strong style="color:#334155;">' + escapeHtml(recipe.recipe_name) + '</strong> (v' + (recipe.version_number || 1) + ')</div>' +
              '</div>' +
              '<div style="display:flex; align-items:center; gap:6px;">' +
                '<span style="background:#F0FDF4; color:#166534; border:1px solid #BBF7D0; font-size:11px; font-weight:700; padding:3px 8px; border-radius:6px; white-space:nowrap;">' +
                  'Hasil: ' + escapeHtml(yieldBadge) +
                '</span>' +
              '</div>' +
            '</div>' +
            costEconomicsHtml +
            '<div style="margin-top:12px; background:#FAFAFA; border:1px solid #F1F5F9; border-radius:8px; padding:10px 12px;">' +
              '<div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748B; margin-bottom:6px;">Komposisi Bahan Masak</div>' +
              componentsHtml +
            '</div>' +
          '</div>' +
          '<div style="margin-top:14px; padding-top:10px; border-top:1px solid #F1F5F9; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">' +
            '<span style="font-size:11px; color:#94A3B8;">SKU: ' + escapeHtml(recipe.output_product_sku || '-') + '</span>' +
            '<div style="display:flex; align-items:center; gap:8px;">' +
              '<button type="button" onclick="event.stopPropagation(); openEditRecipeModal(\'' + escapeHtml(recipeId) + '\');" style="display:inline-flex; align-items:center; gap:4px; padding:5px 10px; border-radius:6px; font-size:12px; font-weight:600; background:#F1F5F9; color:#0F172A; border:1px solid #CBD5E1; cursor:pointer;" title="Edit Resep">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg> Edit' +
              '</button>' +
              '<button type="button" onclick="event.stopPropagation(); confirmDeleteRecipe(\'' + escapeHtml(recipeId) + '\', \'' + escapeHtml(recipe.recipe_name || recipe.output_product_name) + '\');" style="display:inline-flex; align-items:center; gap:4px; padding:5px 10px; border-radius:6px; font-size:12px; font-weight:600; background:#FEF2F2; color:#DC2626; border:1px solid #FECACA; cursor:pointer;" title="Hapus Resep">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> Hapus' +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    container.innerHTML = (
      '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:16px;">' +
        cards +
      '</div>'
    );
  }

  function openAddRecipeModal() {
    var mainView = $('owner-stock-main-view');
    var editorView = $('recipe-editor-view');
    if (!editorView) return;

    if (mainView) mainView.style.display = 'none';
    editorView.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    var form = $('form-add-recipe');
    if (form) {
      form.reset();
      delete form.dataset.editRecipeId;
      delete form.dataset.editProductId;
      delete form.dataset.editRecipeName;
    }

    var mobileTitle = $('recipe-editor-mobile-title');
    var mobileSub = $('recipe-editor-mobile-subtitle');
    var desktopTitle = $('recipe-editor-desktop-title');
    var desktopSub = $('recipe-editor-desktop-subtitle');
    var breadcrumb = $('recipe-editor-breadcrumb');

    if (mobileTitle) mobileTitle.textContent = 'Buat Formula Resep';
    if (mobileSub) mobileSub.textContent = 'Tentukan bahan mentah & takaran bumbu untuk menu siap saji.';
    if (desktopTitle) desktopTitle.textContent = 'Buat Formula Resep Masakan';
    if (desktopSub) desktopSub.textContent = 'Atur takaran bahan baku dan bumbu agar stok mentah terpotong otomatis dan HPP terhitung akurat.';
    if (breadcrumb) breadcrumb.textContent = 'Buat Formula Resep';

    var btnSave = $('btn-save-recipe');
    if (btnSave) btnSave.textContent = 'Simpan Resep Masakan';

    var prodSelect = $('recipe-input-product');
    if (prodSelect) {
      prodSelect.disabled = false;
      prodSelect.innerHTML = '<option value="">Memuat produk...</option>';
      var products = (_ownerInventoryContext && _ownerInventoryContext.products) ? _ownerInventoryContext.products : [];
      if (products.length > 0) {
        populateRecipeProducts(products);
      } else {
        adminFetch(API_BASE + '/admin/inventory-workflow/context', { headers: getAuthHeaders() })
          .then(function (res) { return res.json(); })
          .then(function (resData) {
            var data = resData.data || resData;
            _ownerInventoryContext = data;
            populateRecipeProducts(data.products || []);
          })
          .catch(function () {
            prodSelect.innerHTML = '<option value="">Gagal memuat produk menu</option>';
          });
      }
    }

    var ingContainer = $('recipe-ingredients-container');
    if (ingContainer) {
      ingContainer.innerHTML = '';
      addRecipeIngredientRow();
    }
  }

  window.openEditRecipeModal = function(recipeId) {
    var recipe = (_ownerRecipes || []).find(function(r) {
      return String(r.recipe_id || r.id) === String(recipeId);
    });
    if (!recipe) {
      showToast('Resep tidak ditemukan', 'warning');
      return;
    }

    var mainView = $('owner-stock-main-view');
    var editorView = $('recipe-editor-view');
    if (!editorView) return;

    if (mainView) mainView.style.display = 'none';
    editorView.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    var prodName = recipe.output_product_name || recipe.recipe_name || 'Menu';
    var mobileTitle = $('recipe-editor-mobile-title');
    var mobileSub = $('recipe-editor-mobile-subtitle');
    var desktopTitle = $('recipe-editor-desktop-title');
    var desktopSub = $('recipe-editor-desktop-subtitle');
    var breadcrumb = $('recipe-editor-breadcrumb');

    if (mobileTitle) mobileTitle.textContent = 'Edit Resep: ' + prodName;
    if (mobileSub) mobileSub.textContent = 'Perbarui formula takaran bahan masakan untuk ' + prodName;
    if (desktopTitle) desktopTitle.textContent = 'Edit Formula Resep: ' + prodName;
    if (desktopSub) desktopSub.textContent = 'Perbarui formula takaran bahan masakan untuk ' + prodName;
    if (breadcrumb) breadcrumb.textContent = 'Edit Resep: ' + prodName;

    var btnSave = $('btn-save-recipe');
    if (btnSave) btnSave.textContent = 'Perbarui Resep Masakan';

    var form = $('form-add-recipe');
    if (form) {
      form.dataset.editRecipeId = recipe.recipe_id || recipe.id;
      form.dataset.editProductId = recipe.output_product_id;
      form.dataset.editRecipeName = recipe.recipe_name;
    }

    var prodSelect = $('recipe-input-product');
    if (prodSelect) {
      var products = (_ownerInventoryContext && _ownerInventoryContext.products) ? _ownerInventoryContext.products : [];
      populateRecipeProducts(products, recipe.output_product_id);
      prodSelect.value = recipe.output_product_id;
      prodSelect.disabled = true;
    }

    if ($('recipe-input-yield')) $('recipe-input-yield').value = recipe.planned_yield_quantity || 1;
    if ($('recipe-input-yield-uom')) $('recipe-input-yield-uom').value = recipe.yield_uom_id || 'uom_pcs';

    var ingContainer = $('recipe-ingredients-container');
    if (ingContainer) {
      ingContainer.innerHTML = '';
      if (recipe.components && recipe.components.length > 0) {
        recipe.components.forEach(function(c) {
          addRecipeIngredientRow(c.material_id, c.planned_quantity, c.planned_uom_id);
        });
      } else {
        addRecipeIngredientRow();
      }
    }
  };

  window.confirmDeleteRecipe = async function(recipeId, recipeName) {
    if (!await confirmFeatureAction('delete-recipe-' + recipeId, 'Hapus Resep Masakan', 'Apakah Anda yakin ingin menghapus formula resep "' + (recipeName || '') + '"? Item olahan ini akan kembali menjadi item tanpa resep (HPP manual/0).', 'Hapus Resep')) {
      return;
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/inventory-workflow/recipes/' + encodeURIComponent(recipeId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Gagal menghapus resep masakan');
      }

      showToast('✅ Resep masakan berhasil dihapus.', 'success');
      loadOwnerRecipes();
      if (typeof loadMasterProducts === 'function') loadMasterProducts();
    } catch (err) {
      showToast('❌ Gagal: ' + err.message, 'error');
    }
  };

  function populateRecipeProducts(products, selectedProductId) {
    var prodSelect = $('recipe-input-product');
    if (!prodSelect) return;

    var cookableProducts = (products || []).filter(function (p) {
      return (p.inventory_type || 'COOKED').toUpperCase() !== 'DIRECT';
    });

    if (cookableProducts.length === 0) {
      prodSelect.innerHTML = '<option value="">Tidak ada menu olahan yang perlu dibuatkan resep</option>';
      return;
    }
    var html = '<option value="">Pilih Menu Makanan / Minuman Olahan...</option>';
    cookableProducts.forEach(function (p) {
      var isSel = selectedProductId && String(p.id) === String(selectedProductId) ? ' selected' : '';
      html += '<option value="' + escapeHtml(p.id) + '"' + isSel + '>' + escapeHtml(p.name) + '</option>';
    });
    prodSelect.innerHTML = html;
  }

  function closeRecipeEditorPage() {
    var mainView = $('owner-stock-main-view');
    var editorView = $('recipe-editor-view');
    if (editorView) editorView.style.display = 'none';
    if (mainView) mainView.style.display = 'block';

    var form = $('form-add-recipe');
    if (form) {
      form.reset();
      delete form.dataset.editRecipeId;
      delete form.dataset.editProductId;
      delete form.dataset.editRecipeName;
    }

    var prodSelect = $('recipe-input-product');
    if (prodSelect) prodSelect.disabled = false;

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeAddRecipeModal() {
    closeRecipeEditorPage();
  }
  window.closeAddRecipeModal = closeAddRecipeModal;
  window.closeRecipeEditorPage = closeRecipeEditorPage;
  window.goBackFromRecipeEditor = closeRecipeEditorPage;

  function addRecipeIngredientRow(defaultMatId, defaultQty, defaultUomId) {
    var container = $('recipe-ingredients-container');
    if (!container) return;

    var rowId = 'ing-row-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    var row = document.createElement('div');
    row.id = rowId;
    row.className = 'x-recipe-ingredient-row';

    var materials = _ownerMaterials || (_ownerInventoryContext && _ownerInventoryContext.materials) || [];
    var matOptions = '<option value="">Pilih Bahan Mentah...</option>';
    materials.forEach(function (m) {
      var isSel = defaultMatId && String(m.id) === String(defaultMatId) ? ' selected' : '';
      matOptions += '<option value="' + escapeHtml(m.id) + '" data-uom="' + escapeHtml(m.base_uom_id) + '"' + isSel + '>' + escapeHtml(m.name) + ' (' + escapeHtml(m.material_code) + ')</option>';
    });

    var uoms = _ownerUoms || (_ownerInventoryContext && _ownerInventoryContext.uoms) || [];
    var uomOptions = '<option value="">Satuan...</option>';
    uoms.forEach(function (u) {
      var isSel = defaultUomId && String(u.id) === String(defaultUomId) ? ' selected' : '';
      uomOptions += '<option value="' + escapeHtml(u.id) + '"' + isSel + '>' + escapeHtml(u.name) + ' (' + escapeHtml(u.code) + ')</option>';
    });

    var qtyVal = defaultQty != null ? Number(defaultQty) : '';

    row.innerHTML = (
      '<div class="x-recipe-ing-top">' +
        '<select class="recipe-ing-material x-input" required onchange="handleRecipeMaterialChange(this, \'' + rowId + '\')">' +
          matOptions +
        '</select>' +
        '<button type="button" class="x-recipe-ing-del-btn" onclick="removeRecipeIngredientRow(\'' + rowId + '\')" title="Hapus Bahan">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
        '</button>' +
      '</div>' +
      '<div class="x-recipe-ing-bottom">' +
        '<input type="number" step="any" min="0.001" inputmode="decimal" placeholder="Jumlah takaran" value="' + (qtyVal !== '' ? qtyVal : '') + '" required class="recipe-ing-qty x-input">' +
        '<select class="recipe-ing-uom x-input" required>' +
          uomOptions +
        '</select>' +
      '</div>'
    );

    container.appendChild(row);
  }

  function handleRecipeMaterialChange(selectElem, rowId) {
    var selectedOpt = selectElem.options[selectElem.selectedIndex];
    var baseUomId = selectedOpt ? selectedOpt.getAttribute('data-uom') : '';
    if (baseUomId && rowId) {
      var row = $(rowId);
      if (row) {
        var uomSelect = row.querySelector('.recipe-ing-uom');
        if (uomSelect && baseUomId) {
          uomSelect.value = baseUomId;
        }
      }
    }
  }

  function removeRecipeIngredientRow(rowId) {
    var row = $(rowId);
    if (row) row.remove();
  }

  function submitAddRecipeForm(event) {
    if (event && event.preventDefault) event.preventDefault();

    var form = $('form-add-recipe');
    var isEdit = form && form.dataset.editRecipeId;
    var productId = ((isEdit && form.dataset.editProductId) ? form.dataset.editProductId : ($('recipe-input-product') ? $('recipe-input-product').value : '')).trim();
    var yieldQty = Number($('recipe-input-yield') ? $('recipe-input-yield').value : 1);
    var yieldUomId = ($('recipe-input-yield-uom') ? $('recipe-input-yield-uom').value : 'uom_pcs').trim();
    var btn = $('btn-save-recipe');

    if (!productId || yieldQty <= 0) {
      showToast('Pilih menu dan tentukan hasil porsi masakan.', 'warning');
      return;
    }

    var ingRows = document.querySelectorAll('#recipe-ingredients-container > div');
    if (ingRows.length === 0) {
      showToast('Masukkan minimal satu bahan baku untuk resep ini.', 'warning');
      return;
    }

    var components = [];
    var seenMats = new Set();
    var hasError = false;

    ingRows.forEach(function (row) {
      var matId = (row.querySelector('.recipe-ing-material') ? row.querySelector('.recipe-ing-material').value : '').trim();
      var qty = Number(row.querySelector('.recipe-ing-qty') ? row.querySelector('.recipe-ing-qty').value : 0);
      var uomId = (row.querySelector('.recipe-ing-uom') ? row.querySelector('.recipe-ing-uom').value : '').trim();

      if (!matId || qty <= 0 || !uomId) {
        hasError = true;
        return;
      }
      if (seenMats.has(matId)) {
        hasError = true;
        showToast('Ada bahan baku yang terduplikasi di formulir.', 'warning');
        return;
      }
      seenMats.add(matId);

      components.push({
        material_id: matId,
        planned_quantity: qty,
        planned_uom_id: uomId
      });
    });

    if (hasError || components.length === 0) {
      if (!hasError) showToast('Harap lengkapi bahan, jumlah, dan satuan dengan benar.', 'warning');
      return;
    }

    var locationId = null;
    if (_ownerInventoryContext && _ownerInventoryContext.locations && _ownerInventoryContext.locations.length > 0) {
      locationId = _ownerInventoryContext.locations[0].id;
    }

    var selectedProdName = '';
    var prodSelect = $('recipe-input-product');
    if (prodSelect && prodSelect.selectedIndex >= 0) {
      selectedProdName = prodSelect.options[prodSelect.selectedIndex].text.split('(')[0].trim();
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = isEdit ? 'Memperbarui Resep...' : 'Menyimpan Resep...';
    }

    var recipeName = (isEdit && form.dataset.editRecipeName) ? form.dataset.editRecipeName : ('Resep Standar ' + (selectedProdName || 'Menu'));

    var payload = {
      output_product_id: productId,
      stock_location_id: locationId,
      name: recipeName,
      planned_yield_quantity: yieldQty,
      yield_uom_id: yieldUomId,
      components: components,
      is_update: !!isEdit,
      recipe_id: isEdit || null
    };

    var targetUrl = API_BASE + '/admin/inventory-workflow/recipes';
    adminFetch(targetUrl, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (err) {
            throw new Error(err.message || 'Gagal menyimpan resep masakan');
          }).catch(function (e) {
            throw new Error(e.message || 'Gagal menyimpan resep masakan');
          });
        }
        return res.json();
      })
      .then(function () {
        showToast(isEdit ? '✅ Resep masakan berhasil diperbarui.' : '✅ Resep masakan berhasil disimpan.', 'success');
        closeAddRecipeModal();
        loadOwnerRecipes();
        if (typeof loadMasterProducts === 'function') loadMasterProducts();
      })
      .catch(function (err) {
        showToast('❌ Gagal: ' + err.message, 'error');
      })
      .finally(function () {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Simpan Resep Masakan';
        }
      });
  }

  /* =========================================================================
     BANK DATA SUPPLIER / VENDOR MASTER
     ========================================================================= */
  var _ownerSuppliers = [];
  var _ownerSuppliersQuery = '';

  function onSuppliersSearchInput(val) {
    _ownerSuppliersQuery = (val || '').trim().toLowerCase();
    var filtered = _ownerSuppliers;
    if (_ownerSuppliersQuery) {
      filtered = _ownerSuppliers.filter(function (s) {
        var name = (s.name || '').toLowerCase();
        var cp = (s.contact_person || '').toLowerCase();
        var phone = (s.phone || '').toLowerCase();
        var bank = (s.bank_name || '').toLowerCase();
        return name.includes(_ownerSuppliersQuery) || cp.includes(_ownerSuppliersQuery) || phone.includes(_ownerSuppliersQuery) || bank.includes(_ownerSuppliersQuery);
      });
    }
    renderOwnerSuppliersTable(filtered);
  }
  window.onSuppliersSearchInput = onSuppliersSearchInput;

  function loadOwnerSuppliers() {
    var container = $('owner-suppliers-table-container');
    if (container) {
      container.innerHTML = '<div class="x-owner-stock-loading">Memuat daftar supplier resmi...</div>';
    }

    return adminFetch(API_BASE + '/admin/inventory-workflow/context', { headers: getAuthHeaders() })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (err) {
            throw new Error(err.message || err.error || ('Gagal memuat bank data supplier (HTTP ' + res.status + ')'));
          }).catch(function (e) {
            throw new Error(e.message || ('Gagal memuat bank data supplier (HTTP ' + res.status + ')'));
          });
        }
        return res.json();
      })
      .then(function (resData) {
        var data = resData.data || resData;
        _ownerSuppliers = data.suppliers || [];
        renderOwnerSuppliersTable(_ownerSuppliers);
      })
      .catch(function (err) {
        if (container) {
          container.innerHTML = '<div class="x-owner-stock-error" style="color:#DC2626; padding:16px;">' + escapeHtml(err.message) + '</div>';
        }
      });
  }

  function renderOwnerSuppliersTable(suppliers) {
    var container = $('owner-suppliers-table-container');
    if (!container) return;

    if (!suppliers || suppliers.length === 0) {
      if (_ownerSuppliersQuery && _ownerSuppliers && _ownerSuppliers.length > 0) {
        container.innerHTML = (
          '<div style="text-align:center; padding:36px 16px; color:#64748B;">' +
            '<div style="font-size:32px; margin-bottom:8px;">🔍</div>' +
            '<div style="font-size:15px; font-weight:700; color:#1E293B; margin-bottom:4px;">Tidak Ada Supplier yang Cocok</div>' +
            '<p style="font-size:13px; color:#64748B;">Tidak ditemukan supplier dengan kata kunci "' + escapeHtml(_ownerSuppliersQuery) + '"</p>' +
          '</div>'
        );
        return;
      }
      container.innerHTML = (
        '<div style="text-align:center; padding:36px 16px; color:#64748B;">' +
          '<div style="font-size:36px; margin-bottom:8px;">🏢</div>' +
          '<div style="font-size:15px; font-weight:700; color:#1E293B; margin-bottom:6px;">Belum Ada Data Supplier</div>' +
          '<p style="font-size:13px; max-width:440px; margin:0 auto 16px auto; color:#64748B; line-height:1.5;">' +
            'Daftarkan vendor rekanan, pedagang pasar, atau distributor bahan baku untuk memudahkan pembuatan PO dan monitoring pengiriman ke cabang.' +
          '</p>' +
          '<button type="button" onclick="openAddSupplierModal()" style="display:inline-flex; align-items:center; gap:6px; padding:9px 18px; border-radius:8px; font-weight:600; font-size:13px; background:#0F172A; color:#FFFFFF; border:none; cursor:pointer;">' +
            '<span>+ Tambah Supplier Pertama</span>' +
          '</button>' +
        '</div>'
      );
      return;
    }

    var termsLabels = {
      CASH: 'Tunai / COD',
      NET_7: 'Tempo 7 Hari',
      NET_14: 'Tempo 14 Hari',
      NET_30: 'Tempo 30 Hari',
      TRANSFER: 'Transfer'
    };

    var rows = suppliers.map(function (s) {
      var contactHtml = '-';
      if (s.phone || s.contact_person) {
        var waBtn = s.phone
          ? '<a href="https://wa.me/' + escapeHtml(s.phone.replace(/[^0-9]/g, '')) + '" target="_blank" style="display:inline-flex; align-items:center; gap:4px; font-size:11.5px; color:#059669; font-weight:700; text-decoration:none; margin-top:2px;">📱 ' + escapeHtml(s.phone) + '</a>'
          : '';
        contactHtml = '<div>' + (s.contact_person ? '<strong>' + escapeHtml(s.contact_person) + '</strong><br>' : '') + waBtn + '</div>';
      }

      var bankHtml = '-';
      if (s.bank_name || s.bank_account_number) {
        bankHtml = '<div style="font-size:12px;">' +
          '<strong>' + escapeHtml(s.bank_name || 'Bank') + '</strong> ' + escapeHtml(s.bank_account_number || '') +
          (s.bank_account_name ? '<div style="font-size:11px; color:#64748b;">a.n ' + escapeHtml(s.bank_account_name) + '</div>' : '') +
        '</div>';
      }

      var termsBadge = '<span class="x-badge" style="background:#F1F5F9; color:#475569; font-size:11px; font-weight:700;">' + escapeHtml(termsLabels[s.payment_terms] || s.payment_terms || 'Tunai') + '</span>';

      return (
        '<tr style="border-bottom:1px solid #F1F5F9;">' +
          '<td style="padding:12px 14px; font-weight:700; color:#0F172A; font-size:13px;">' +
            '<div>' + escapeHtml(s.name) + '</div>' +
            '<div style="font-size:11px; font-weight:700; color:#0284c7; margin-top:2px;">' + escapeHtml(s.supplier_code) + '</div>' +
          '</td>' +
          '<td style="padding:12px 14px; font-size:12.5px; color:#475569;">' + escapeHtml(s.category || 'Umum') + '</td>' +
          '<td style="padding:12px 14px; font-size:12.5px;">' + contactHtml + '</td>' +
          '<td style="padding:12px 14px; font-size:12.5px;">' + termsBadge + '</td>' +
          '<td style="padding:12px 14px; font-size:12.5px;">' + bankHtml + '</td>' +
          '<td style="padding:12px 14px; text-align:right; font-size:13px; white-space:nowrap;">' +
            '<button type="button" onclick="editOwnerSupplier(\'' + escapeHtml(s.id) + '\')" style="padding:5px 10px; font-size:11.5px; font-weight:600; border-radius:6px; border:1px solid #CBD5E1; background:#FFFFFF; color:#334155; cursor:pointer; margin-right:6px;">Ubah</button>' +
            '<button type="button" onclick="archiveOwnerSupplier(\'' + escapeHtml(s.id) + '\', \'' + escapeHtml(s.name) + '\')" style="padding:5px 10px; font-size:11.5px; font-weight:600; border-radius:6px; border:1px solid #FECACA; background:#FEF2F2; color:#DC2626; cursor:pointer;">Arsipkan</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');

    container.innerHTML = (
      '<div style="overflow-x:auto;">' +
        '<table style="width:100%; border-collapse:collapse; text-align:left;">' +
          '<thead>' +
            '<tr style="background:#F8FAFC; border-bottom:1px solid #E2E8F0; color:#64748B; font-size:12px; text-transform:uppercase; letter-spacing:0.025em;">' +
              '<th style="padding:10px 14px; font-weight:600;">Supplier</th>' +
              '<th style="padding:10px 14px; font-weight:600;">Kategori</th>' +
              '<th style="padding:10px 14px; font-weight:600;">Kontak / WA</th>' +
              '<th style="padding:10px 14px; font-weight:600;">Syarat Bayar</th>' +
              '<th style="padding:10px 14px; font-weight:600;">Rekening Bank</th>' +
              '<th style="padding:10px 14px; font-weight:600; text-align:right;">Aksi</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>'
    );
  }

  function openAddSupplierModal() {
    var modal = $('modal-add-supplier');
    if (!modal) return;
    var title = $('modal-supplier-title');
    if (title) title.textContent = 'Tambah Supplier Baru';
    var form = $('form-add-supplier');
    if (form) form.reset();
    var idInput = $('sup-input-id');
    if (idInput) idInput.value = '';
    if (window.XentraUI && window.XentraUI.Modal) {
      window.XentraUI.Modal.open('modal-add-supplier');
    } else {
      modal.style.display = 'flex';
    }
  }

  function closeAddSupplierModal() {
    if (window.XentraUI && window.XentraUI.Modal) {
      window.XentraUI.Modal.close('modal-add-supplier');
    } else {
      var modal = $('modal-add-supplier');
      if (modal) modal.style.display = 'none';
    }
    var form = $('form-add-supplier');
    if (form) form.reset();
  }

  function editOwnerSupplier(supplierId) {
    var s = _ownerSuppliers.find(function (item) { return item.id === supplierId; });
    if (!s) return;
    var modal = $('modal-add-supplier');
    if (!modal) return;

    var title = $('modal-supplier-title');
    if (title) title.textContent = 'Ubah Data Supplier (' + s.supplier_code + ')';

    if ($('sup-input-id')) $('sup-input-id').value = s.id;
    if ($('sup-input-name')) $('sup-input-name').value = s.name || '';
    if ($('sup-input-category')) $('sup-input-category').value = s.category || '';
    if ($('sup-input-pic')) $('sup-input-pic').value = s.contact_person || '';
    if ($('sup-input-phone')) $('sup-input-phone').value = s.phone || '';
    if ($('sup-input-payment-terms')) $('sup-input-payment-terms').value = s.payment_terms || 'CASH';
    if ($('sup-input-address')) $('sup-input-address').value = s.address || '';
    if ($('sup-input-bank-name')) $('sup-input-bank-name').value = s.bank_name || '';
    if ($('sup-input-bank-acc-no')) $('sup-input-bank-acc-no').value = s.bank_account_number || '';
    if ($('sup-input-bank-acc-name')) $('sup-input-bank-acc-name').value = s.bank_account_name || '';
    if ($('sup-input-notes')) $('sup-input-notes').value = s.notes || '';

    if (window.XentraUI && window.XentraUI.Modal) {
      window.XentraUI.Modal.open('modal-add-supplier');
    } else {
      modal.style.display = 'flex';
    }
  }

  function submitAddSupplierForm(event) {
    if (event && event.preventDefault) event.preventDefault();

    var supId = ($('sup-input-id') ? $('sup-input-id').value : '').trim();
    var name = ($('sup-input-name') ? $('sup-input-name').value : '').trim();
    var category = ($('sup-input-category') ? $('sup-input-category').value : '').trim();
    var pic = ($('sup-input-pic') ? $('sup-input-pic').value : '').trim();
    var phone = ($('sup-input-phone') ? $('sup-input-phone').value : '').trim();
    var paymentTerms = ($('sup-input-payment-terms') ? $('sup-input-payment-terms').value : 'CASH').trim();
    var address = ($('sup-input-address') ? $('sup-input-address').value : '').trim();
    var bankName = ($('sup-input-bank-name') ? $('sup-input-bank-name').value : '').trim();
    var bankAccNo = ($('sup-input-bank-acc-no') ? $('sup-input-bank-acc-no').value : '').trim();
    var bankAccName = ($('sup-input-bank-acc-name') ? $('sup-input-bank-acc-name').value : '').trim();
    var notes = ($('sup-input-notes') ? $('sup-input-notes').value : '').trim();
    var btn = $('btn-save-supplier');

    if (!name) {
      showToast('Harap isi nama perusahaan atau toko supplier.', 'warning');
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Menyimpan...';
    }

    var payload = {
      name: name,
      category: category || null,
      contact_person: pic || null,
      phone: phone || null,
      payment_terms: paymentTerms || 'CASH',
      address: address || null,
      bank_name: bankName || null,
      bank_account_number: bankAccNo || null,
      bank_account_name: bankAccName || null,
      notes: notes || null
    };

    var url = supId
      ? (API_BASE + '/admin/inventory-workflow/suppliers/' + encodeURIComponent(supId))
      : (API_BASE + '/admin/inventory-workflow/suppliers');
    var method = supId ? 'PUT' : 'POST';

    adminFetch(url, {
      method: method,
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (err) { throw new Error(err.message || 'Gagal menyimpan supplier'); });
        }
        return res.json();
      })
      .then(function (data) {
        showToast(supId ? '✅ Data supplier berhasil diperbarui.' : '✅ Supplier baru berhasil ditambahkan.', 'success');
        closeAddSupplierModal();
        loadOwnerSuppliers();
      })
      .catch(function (err) {
        showToast('❌ Gagal: ' + err.message, 'error');
      })
      .finally(function () {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Simpan Supplier';
        }
      });
  }

  async function archiveOwnerSupplier(id, name) {
    var confirmed = await confirmFeatureAction('archive-supplier', 'Arsipkan Supplier', 'Apakah Anda yakin ingin mengarsipkan supplier "' + name + '"?', 'Arsipkan');
    if (!confirmed) return;

    adminFetch(API_BASE + '/admin/inventory-workflow/suppliers/' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: getAuthHeaders()
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Gagal mengarsipkan supplier');
        return res.json();
      })
      .then(function () {
        showToast('✅ Supplier berhasil diarsipkan.', 'success');
        loadOwnerSuppliers();
      })
      .catch(function (err) {
        showToast('❌ ' + err.message, 'error');
      });
  }

  /* =========================================================================
     MODUL: LAPORAN & RIWAYAT BELANJA (STAFF BELANJA)
     ========================================================================= */
  var _ownerPurchasingHistorySessions = [];
  var _ownerPurchasingHistoryQuery = '';

  async function loadOwnerPurchasingHistory() {
    var container = $('owner-purchasing-history-container');
    if (container) {
      container.innerHTML = '<div class="x-owner-stock-loading">Memuat riwayat dan laporan belanja cabang...</div>';
    }

    var branchId = getEffectiveBranchId();
    if (!branchId || branchId === 'all') {
      branchId = 'branch_1789606246242_08knv';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/history', {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (res.ok && data.success) {
        _ownerPurchasingHistorySessions = data.sessions || [];
        renderOwnerPurchasingHistoryList(_ownerPurchasingHistorySessions);
      } else {
        if (container) {
          container.innerHTML = '<div class="x-owner-stock-error" style="color:#DC2626; padding:16px;">Gagal memuat riwayat belanja: ' + escapeHtml(data.error || 'Server error') + '</div>';
        }
      }
    } catch (err) {
      if (container) {
        container.innerHTML = '<div class="x-owner-stock-error" style="color:#DC2626; padding:16px;">Gangguan jaringan saat memuat riwayat belanja.</div>';
      }
    }
  }
  window.loadOwnerPurchasingHistory = loadOwnerPurchasingHistory;

  function onPurchasingHistorySearchInput(val) {
    _ownerPurchasingHistoryQuery = (val || '').trim().toLowerCase();
    var filtered = _ownerPurchasingHistorySessions;
    if (_ownerPurchasingHistoryQuery) {
      filtered = _ownerPurchasingHistorySessions.filter(function (s) {
        var actor = (s.actor_name || '').toLowerCase();
        var posting = (s.posting_id || '').toLowerCase();
        var dt = s.timestamp ? new Date(s.timestamp).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).toLowerCase() : '';
        var itemsMatch = (s.items || []).some(function (itm) {
          return (itm.material_name || '').toLowerCase().includes(_ownerPurchasingHistoryQuery);
        });
        return actor.includes(_ownerPurchasingHistoryQuery) || posting.includes(_ownerPurchasingHistoryQuery) || dt.includes(_ownerPurchasingHistoryQuery) || itemsMatch;
      });
    }
    renderOwnerPurchasingHistoryList(filtered);
  }
  window.onPurchasingHistorySearchInput = onPurchasingHistorySearchInput;

  function renderOwnerPurchasingHistoryList(sessions) {
    var container = $('owner-purchasing-history-container');
    if (!container) return;

    if (!sessions || !sessions.length) {
      if (_ownerPurchasingHistoryQuery && _ownerPurchasingHistorySessions && _ownerPurchasingHistorySessions.length > 0) {
        container.innerHTML = '<div class="text-center py-10 text-muted" style="padding:32px 16px;">' +
          '<div style="font-size:32px; margin-bottom:8px;">🔍</div>' +
          '<div style="font-size:15px; font-weight:700; color:#1E293B;">Tidak Ada Riwayat Belanja yang Cocok</div>' +
          '<p style="font-size:13px; color:#64748B; margin-top:4px;">Tidak ditemukan transaksi dengan kata kunci "' + escapeHtml(_ownerPurchasingHistoryQuery) + '"</p>' +
        '</div>';
        return;
      }
      container.innerHTML = '<div class="text-center py-10 text-muted" style="padding:36px 16px;">' +
        '<div style="font-size:36px; margin-bottom:8px;">🧾</div>' +
        '<div style="font-size:15px; font-weight:700; color:#1E293B;">Belum Ada Riwayat Belanja</div>' +
        '<p style="font-size:13px; max-width:460px; margin:4px auto 0 auto; color:#64748B; line-height:1.5;">' +
          'Semua catatan pembelanjaan pasar yang diselesaikan oleh staf toko (beserta nominal pengeluaran riil dan bukti nota) akan tersaji otomatis di sini.' +
        '</p>' +
      '</div>';
      return;
    }

    var totalAllSpend = sessions.reduce(function (sum, s) {
      return sum + Number(s.total_spend || 0);
    }, 0);

    var summaryHeader = '<div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:12px; padding:14px 18px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">' +
      '<div>' +
        '<div style="font-size:12px; font-weight:700; color:#64748B; text-transform:uppercase; letter-spacing:0.5px;">Ringkasan Belanja</div>' +
        '<div style="font-size:14px; font-weight:600; color:#1E293B; margin-top:2px;">Tercatat <strong>' + sessions.length + ' sesi pembelanjaan</strong></div>' +
      '</div>' +
      '<div style="text-align:right;">' +
        '<div style="font-size:11.5px; color:#64748B;">Total Pengeluaran Kas:</div>' +
        '<strong style="font-size:18px; color:#059669; font-weight:800;">' + formatMoney(totalAllSpend) + '</strong>' +
      '</div>' +
    '</div>';

    var cards = sessions.map(function (sess) {
      var dateStr = '—';
      if (sess.timestamp) {
        var d = new Date(sess.timestamp);
        dateStr = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }) + ' • ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
      }

      var itemsTableRows = (sess.items || []).map(function (itm) {
        return '<tr style="border-bottom:1px dashed #E2E8F0; font-size:12.5px;">' +
          '<td style="padding:8px 10px; color:#0F172A; font-weight:600;">' +
            escapeHtml(itm.material_name) +
          '</td>' +
          '<td style="padding:8px 10px; text-align:center; color:#334155; font-weight:600;">' +
            itm.quantity + ' <span style="font-size:11px; color:#64748B;">' + escapeHtml(itm.uom) + '</span>' +
          '</td>' +
          '<td style="padding:8px 10px; text-align:right; color:#64748B;">' +
            formatMoney(itm.unit_price) +
          '</td>' +
          '<td style="padding:8px 10px; text-align:right; color:#0F172A; font-weight:700;">' +
            formatMoney(itm.total_price) +
          '</td>' +
        '</tr>';
      }).join('');

      return '<div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:12px; padding:16px; margin-bottom:14px; box-shadow:0 1px 3px rgba(0,0,0,0.02);">' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; border-bottom:1px solid #F1F5F9; padding-bottom:12px; margin-bottom:12px;">' +
          '<div>' +
            '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">' +
              '<span style="background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; font-size:12px; font-weight:700; padding:3px 10px; border-radius:6px; display:inline-flex; align-items:center; gap:5px;">' +
                '<span>👤 Petugas:</span> <strong style="color:#047857;">' + escapeHtml(sess.actor_name || 'Petugas Belanja') + '</strong>' +
              '</span>' +
              '<span style="font-size:12px; color:#64748B;">' + escapeHtml(dateStr) + '</span>' +
            '</div>' +
            '<div style="font-size:11.5px; color:#94A3B8; margin-top:4px;">No. Referensi / Settle: <code style="color:#475569; font-size:11px;">' + escapeHtml(sess.posting_id) + '</code></div>' +
          '</div>' +
          '<div style="text-align:right;">' +
            '<div style="font-size:11px; color:#64748B;">Total Belanja:</div>' +
            '<strong style="font-size:16px; color:#0F172A; font-weight:800;">' + formatMoney(sess.total_spend) + '</strong>' +
          '</div>' +
        '</div>' +
        '<div style="background:#F8FAFC; border-radius:8px; border:1px solid #EDF2F7; overflow-x:auto;">' +
          '<table style="width:100%; border-collapse:collapse; min-width:320px;">' +
            '<thead>' +
              '<tr style="border-bottom:1px solid #E2E8F0; background:#F1F5F9; font-size:11px; font-weight:700; color:#475569; text-transform:uppercase;">' +
                '<th style="padding:6px 10px; text-align:left;">Bahan Baku</th>' +
                '<th style="padding:6px 10px; text-align:center;">Jumlah</th>' +
                '<th style="padding:6px 10px; text-align:right;">Harga Beli Satuan</th>' +
                '<th style="padding:6px 10px; text-align:right;">Subtotal</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' +
              itemsTableRows +
            '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
    }).join('');

    container.innerHTML = summaryHeader + cards;
  }
  /* ==========================================================================
     BRANCH PRODUCT DIRECT STOCK OPNAME & ADJUSTMENT MODAL
     ========================================================================== */
  function openProductStockOpnameModal(branchId, productId, prodName, branchName, sku, currentStock, threshold) {
    if ($('opname-prod-branch-id')) $('opname-prod-branch-id').value = branchId;
    if ($('opname-prod-product-id')) $('opname-prod-product-id').value = productId;
    if ($('opname-prod-current-val')) $('opname-prod-current-val').value = currentStock;

    if ($('opname-prod-name-display')) $('opname-prod-name-display').textContent = prodName || 'Produk';
    if ($('opname-prod-branch-display')) $('opname-prod-branch-display').textContent = 'Cabang: ' + (branchName || '-');
    if ($('opname-prod-sku-display')) $('opname-prod-sku-display').textContent = 'SKU: ' + (sku || '-');
    if ($('opname-prod-current-display')) $('opname-prod-current-display').textContent = formatUnitCount(currentStock);

    if ($('opname-new-stock')) $('opname-new-stock').value = currentStock;
    if ($('opname-add-qty')) $('opname-add-qty').value = '';
    if ($('opname-threshold')) $('opname-threshold').value = threshold || 5;
    if ($('opname-notes')) $('opname-notes').value = '';

    onOpnameModeChange('set');

    if (window.XentraUI && window.XentraUI.Modal) {
      window.XentraUI.Modal.open('modal-product-stock-opname');
    } else {
      var modal = $('modal-product-stock-opname');
      if (modal) modal.style.display = 'flex';
    }
  }

  function closeProductStockOpnameModal() {
    if (window.XentraUI && window.XentraUI.Modal) {
      window.XentraUI.Modal.close('modal-product-stock-opname');
    } else {
      var modal = $('modal-product-stock-opname');
      if (modal) modal.style.display = 'none';
    }
  }

  function onOpnameModeChange(mode) {
    var isSet = mode === 'set';
    var grpSet = $('group-opname-mode-set');
    var grpAdd = $('group-opname-mode-add');
    var lblSet = $('lbl-opname-mode-set');
    var lblAdd = $('lbl-opname-mode-add');

    if (grpSet) grpSet.style.display = isSet ? 'block' : 'none';
    if (grpAdd) grpAdd.style.display = isSet ? 'none' : 'block';

    if (lblSet) {
      lblSet.style.borderColor = isSet ? '#10B981' : '#CBD5E1';
      lblSet.style.background = isSet ? '#F0FDF4' : '#FFFFFF';
    }
    if (lblAdd) {
      lblAdd.style.borderColor = !isSet ? '#10B981' : '#CBD5E1';
      lblAdd.style.background = !isSet ? '#F0FDF4' : '#FFFFFF';
    }

    var radios = document.getElementsByName('opname-mode');
    for (var i = 0; i < radios.length; i++) {
      if (radios[i].value === mode) radios[i].checked = true;
    }

    updateOpnamePreview();
  }

  function updateOpnamePreview() {
    var cur = Number($('opname-prod-current-val') ? $('opname-prod-current-val').value : 0) || 0;
    var mode = 'set';
    var radios = document.getElementsByName('opname-mode');
    for (var i = 0; i < radios.length; i++) {
      if (radios[i].checked) { mode = radios[i].value; break; }
    }

    var deltaEl = $('opname-delta-preview');
    var addEl = $('opname-add-preview');

    if (mode === 'set') {
      var newVal = Number($('opname-new-stock') ? $('opname-new-stock').value : cur);
      var delta = newVal - cur;
      if (deltaEl) {
        if (delta === 0) {
          deltaEl.textContent = 'Stok tidak berubah (selisih: 0 unit)';
          deltaEl.style.color = '#059669';
        } else if (delta > 0) {
          deltaEl.textContent = 'Audit bertambah: +' + delta + ' unit (Stok akhir: ' + newVal + ')';
          deltaEl.style.color = '#2563EB';
        } else {
          deltaEl.textContent = 'Audit berkurang (selisih/waste): ' + delta + ' unit (Stok akhir: ' + newVal + ')';
          deltaEl.style.color = '#DC2626';
        }
      }
    } else {
      var addQty = Number($('opname-add-qty') ? $('opname-add-qty').value : 0) || 0;
      var finalVal = cur + addQty;
      if (addEl) {
        if (addQty > 0) {
          addEl.textContent = 'Stok akhir menjadi: ' + finalVal + ' unit (+ ' + addQty + ' unit baru)';
          addEl.style.color = '#2563EB';
        } else {
          addEl.textContent = 'Masukkan jumlah unit yang masuk';
          addEl.style.color = '#64748B';
        }
      }
    }
  }

  async function submitProductStockOpnameForm(e) {
    if (e && e.preventDefault) e.preventDefault();

    var branchId = $('opname-prod-branch-id') ? $('opname-prod-branch-id').value : '';
    var productId = $('opname-prod-product-id') ? $('opname-prod-product-id').value : '';
    var cur = Number($('opname-prod-current-val') ? $('opname-prod-current-val').value : 0) || 0;
    var threshold = Number($('opname-threshold') ? $('opname-threshold').value : 5);
    var notes = $('opname-notes') ? $('opname-notes').value.trim() : '';

    if (!branchId || !productId) {
      showToast('Data cabang/produk tidak valid.', 'error');
      return;
    }

    var mode = 'set';
    var radios = document.getElementsByName('opname-mode');
    for (var i = 0; i < radios.length; i++) {
      if (radios[i].checked) { mode = radios[i].value; break; }
    }

    var delta = 0;
    var movementType = 'audit_adjustment';

    if (mode === 'set') {
      var targetStock = Number($('opname-new-stock') ? $('opname-new-stock').value : cur);
      if (isNaN(targetStock) || targetStock < 0) {
        showToast('Jumlah stok fisik riil tidak boleh negatif.', 'warning');
        return;
      }
      delta = targetStock - cur;
    } else {
      var addQty = Number($('opname-add-qty') ? $('opname-add-qty').value : 0);
      if (isNaN(addQty) || addQty <= 0) {
        showToast('Jumlah unit restock harus lebih dari 0.', 'warning');
        return;
      }
      delta = addQty;
    }

    var btnSave = $('btn-save-product-opname');
    if (btnSave) {
      btnSave.disabled = true;
      btnSave.textContent = 'Menyimpan...';
    }

    try {
      var payload = {
        movement_type: movementType,
        low_stock_threshold: threshold,
        notes: notes || (mode === 'set' ? 'Stock opname fisik cabang' : 'Penambahan restock unit')
      };
      if (delta !== 0) {
        payload.quantity = delta;
      }

      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/inventory/' + encodeURIComponent(productId), {
        method: 'PATCH',
        headers: Object.assign({}, getAuthHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      });
      var data = await res.json();

      if (!res.ok || !data.success) {
        var errMsg = data.message || data.error || 'Gagal menyimpan penyesuaian stok.';
        showToast('❌ ' + errMsg, 'error');
        return;
      }

      showToast('✅ Stok produk cabang berhasil diperbarui!', 'success');
      closeProductStockOpnameModal();
      loadOwnerStockOverview();
    } catch (err) {
      console.error('[Stock Opname Error]:', err);
      showToast('❌ Terjadi kesalahan jaringan saat menyimpan stok.', 'error');
    } finally {
      if (btnSave) {
        btnSave.disabled = false;
        btnSave.textContent = 'Simpan Perubahan';
      }
    }
  }

  window.openProductStockOpnameModal = openProductStockOpnameModal;
  window.closeProductStockOpnameModal = closeProductStockOpnameModal;
  window.onOpnameModeChange = onOpnameModeChange;
  window.updateOpnamePreview = updateOpnamePreview;
  window.submitProductStockOpnameForm = submitProductStockOpnameForm;

  // Export to window for inline HTML onclick handlers & dashboard orchestration
  window.loadOwnerStockOverview = loadOwnerStockOverview;
  window.initOwnerStockControls = initOwnerStockControls;
  window.switchStockSubtab = switchStockSubtab;
  window.openAddMaterialModal = openAddMaterialModal;
  window.closeAddMaterialModal = closeAddMaterialModal;
  window.submitAddMaterialForm = submitAddMaterialForm;
  window.archiveOwnerMaterial = archiveOwnerMaterial;
  window.loadOwnerMaterials = loadOwnerMaterials;
  window.loadOwnerRecipes = loadOwnerRecipes;
  window.openAddRecipeModal = openAddRecipeModal;
  window.closeAddRecipeModal = closeAddRecipeModal;
  window.addRecipeIngredientRow = addRecipeIngredientRow;
  window.handleRecipeMaterialChange = handleRecipeMaterialChange;
  window.removeRecipeIngredientRow = removeRecipeIngredientRow;
  window.submitAddRecipeForm = submitAddRecipeForm;
  window.loadOwnerSuppliers = loadOwnerSuppliers;
  window.openAddSupplierModal = openAddSupplierModal;
  window.closeAddSupplierModal = closeAddSupplierModal;
  window.editOwnerSupplier = editOwnerSupplier;
  window.submitAddSupplierForm = submitAddSupplierForm;
  window.archiveOwnerSupplier = archiveOwnerSupplier;

  window.XentraStockModule = {
    loadOwnerStockOverview: loadOwnerStockOverview,
    initOwnerStockControls: initOwnerStockControls,
    selectOwnerStockBranch: selectOwnerStockBranch,
    switchStockSubtab: switchStockSubtab,
    loadOwnerMaterials: loadOwnerMaterials,
    loadOwnerRecipes: loadOwnerRecipes,
    loadOwnerSuppliers: loadOwnerSuppliers
  };


})(window, document);
