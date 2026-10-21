/**
 * XENTRA OWNER DASHBOARD — REPORTS ENGINE MODULE
 * Standalone modular controller for analytics, KPIs, sales, orders, products, customers, and branch comparisons.
 */
(function (window, document) {
  'use strict';

  var S = window.XentraShared || {};
  var $ = S.$ || function (id) { return document.getElementById(id); };
  var esc = S.esc || function (t) { return t || ''; };
  var escapeHtml = esc;
  var formatMoney = S.formatMoney || function (v) { return 'Rp ' + Number(v || 0).toLocaleString('id-ID'); };
  var API_BASE = S.API_BASE || '/api/v1';

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

  function navigateTo(route) {
    if (typeof window.navigateTo === 'function') return window.navigateTo(route);
    window.location.hash = '#' + route;
  }

  function getEffectiveBranchId() {
    if (typeof window.getEffectiveBranchId === 'function') return window.getEffectiveBranchId();
    var b = window._branchContextState;
    return (b && b.selected !== 'all') ? b.selected : '';
  }

  function isBranchManager() {
    if (window.XentraShared && typeof window.XentraShared.isBranchManager === 'function') {
      return window.XentraShared.isBranchManager();
    }
    var user = (window.XentraShared && window.XentraShared.getStoredUser) ? window.XentraShared.getStoredUser() : null;
    return !!(user && user.role === 'branch_manager');
  }

  /* =========================================================================
     REPORTS ENGINE STATE & CONTROLLER
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
        var found = (window._branchContextState && window._branchContextState.branches || []).find(function (b) {
          return String(b.id) === String(branchId);
        });
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

      case 'affiliate':
        if (titleEl) titleEl.textContent = 'Laporan Program Afiliasi';
        if (subEl) subEl.textContent = 'Performa omzet referral, ranking mitra, dan menu terlaris';
        renderAffiliateReport(data, summaryCards, tableContainer);
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

  function renderAffiliateReport(data, cardsEl, tableEl) {
    var summary = data.summary || {};
    if (cardsEl) {
      cardsEl.innerHTML =
        '<div class="x-metric-card"><div class="x-metric-icon bg-green">💰</div><div class="x-metric-info"><span class="x-metric-label">Omzet Referral</span><h3 class="x-metric-value">' + formatMoney(summary.total_sales || 0) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-amber">🍗</div><div class="x-metric-info"><span class="x-metric-label">Menu Terjual</span><h3 class="x-metric-value">' + (summary.total_items_sold || 0) + ' porsi</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-blue">🎁</div><div class="x-metric-info"><span class="x-metric-label">Komisi Diberikan</span><h3 class="x-metric-value">' + formatMoney(summary.total_commission || 0) + '</h3><small style="color:var(--text-muted);font-size:11px;">' + (summary.effective_commission_rate || '0.0') + '% dari omzet</small></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-green">👥</div><div class="x-metric-info"><span class="x-metric-label">Mitra Aktif</span><h3 class="x-metric-value">' + (summary.active_affiliates_count || 0) + ' orang</h3></div></div>';
    }

    var topAffiliates = data.top_affiliates || [];
    var topProducts = data.top_products || [];
    var recentConversions = data.recent_conversions || [];

    if (topAffiliates.length === 0 && recentConversions.length === 0) {
      if (tableEl) tableEl.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">🍗</div>Belum ada transaksi dari link affiliate pada periode ini.</div>';
      return;
    }

    var html =
      '<div style="margin-bottom:16px;display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;" class="x-aff-report-tabs">' +
      '  <button type="button" class="x-btn-secondary x-aff-report-tab-btn active" id="btn-tab-top-aff" style="font-size:12.5px;padding:6px 14px;border-radius:20px;font-weight:700;">🏆 Top Affiliator (' + topAffiliates.length + ')</button>' +
      '  <button type="button" class="x-btn-secondary x-aff-report-tab-btn" id="btn-tab-top-prod" style="font-size:12.5px;padding:6px 14px;border-radius:20px;font-weight:700;">🍗 Menu Terlaris (' + topProducts.length + ')</button>' +
      '  <button type="button" class="x-btn-secondary x-aff-report-tab-btn" id="btn-tab-conversions" style="font-size:12.5px;padding:6px 14px;border-radius:20px;font-weight:700;">📋 Log Transaksi (' + recentConversions.length + ')</button>' +
      '</div>';

    // 1. TOP AFFILIATES SECTION (Mobile Cards & Desktop Table)
    html += '<div id="sec-top-aff">';
    if (topAffiliates.length === 0) {
      html += '<div class="x-empty-state">Belum ada mitra yang menghasilkan penjualan.</div>';
    } else {
      html += '<div class="x-mobile-card-list" style="display:flex;flex-direction:column;gap:10px;">';
      topAffiliates.forEach(function (aff, idx) {
        var rankBadge = idx === 0 ? '🥇 #1' : (idx === 1 ? '🥈 #2' : (idx === 2 ? '🥉 #3' : '#' + (idx + 1)));
        var waBtn = aff.phone ? '<a href="https://wa.me/' + aff.phone.replace(/[^0-9]/g, '') + '" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;color:#16a34a;font-size:12px;font-weight:700;text-decoration:none;margin-top:2px;">💬 ' + escapeHtml(aff.phone) + '</a>' : '';

        html +=
          '<div style="background:#fff;border:1px solid var(--border-color, #e2e8f0);border-radius:12px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,0.02);">' +
          '  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
          '    <div>' +
          '      <span style="display:inline-block;background:#f1f5f9;color:#0f172a;font-size:11px;font-weight:800;padding:2px 8px;border-radius:6px;margin-bottom:4px;">' + rankBadge + '</span>' +
          '      <h4 style="margin:0;font-size:14px;font-weight:800;color:var(--text-main, #0f172a);">' + escapeHtml(aff.affiliate_name) + '</h4>' +
          '      <div style="font-size:11.5px;color:var(--text-muted, #64748b);margin-top:2px;">Kode: <strong style="color:#0284c7;">' + escapeHtml(aff.referral_code) + '</strong></div>' +
          waBtn +
          '    </div>' +
          '    <div style="text-align:right;">' +
          '      <div style="font-size:15px;font-weight:900;color:#16a34a;">' + formatMoney(aff.total_commission || 0) + '</div>' +
          '      <div style="font-size:11px;color:var(--text-muted, #64748b);">Komisi Diterima</div>' +
          '    </div>' +
          '  </div>' +
          '  <div style="margin-top:10px;padding-top:8px;border-top:1px dashed #f1f5f9;display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted, #64748b);">' +
          '    <span>' + (aff.orders_count || 0) + ' pesanan (' + (aff.items_sold || 0) + ' menu)</span>' +
          '    <span>Omzet: <strong style="color:var(--text-main, #0f172a);">' + formatMoney(aff.total_sales || 0) + '</strong></span>' +
          '  </div>' +
          '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    // 2. TOP PRODUCTS SECTION
    html += '<div id="sec-top-prod" style="display:none;">';
    if (topProducts.length === 0) {
      html += '<div class="x-empty-state">Belum ada rincian menu yang terjual dari link affiliate.</div>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:8px;">';
      topProducts.forEach(function (p, idx) {
        html +=
          '<div style="background:#fff;border:1px solid var(--border-color, #e2e8f0);border-radius:12px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;">' +
          '  <div>' +
          '    <div style="font-size:11px;font-weight:700;color:#64748b;">#' + (idx + 1) + ' Terlaris</div>' +
          '    <h4 style="margin:2px 0 0;font-size:14px;font-weight:800;color:var(--text-main, #0f172a);">' + escapeHtml(p.product_name) + '</h4>' +
          '    <div style="font-size:12px;color:#16a34a;font-weight:700;margin-top:2px;">' + (p.quantity_sold || 0) + ' porsi terjual via link</div>' +
          '  </div>' +
          '  <div style="text-align:right;">' +
          '    <div style="font-size:14px;font-weight:800;color:var(--text-main, #0f172a);">' + formatMoney(p.total_sales || 0) + '</div>' +
          '    <div style="font-size:11px;color:#64748b;">Total Omzet</div>' +
          '  </div>' +
          '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    // 3. RECENT CONVERSIONS SECTION
    html += '<div id="sec-conversions" style="display:none;">';
    if (recentConversions.length === 0) {
      html += '<div class="x-empty-state">Belum ada riwayat pesanan affiliate.</div>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:8px;">';
      recentConversions.forEach(function (c) {
        var stBadge = c.status === 'APPROVED'
          ? '<span style="background:#ecfdf5;color:#059669;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">Disetujui</span>'
          : (c.status === 'VOID'
              ? '<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">Batal</span>'
              : '<span style="background:#fef3c7;color:#b45309;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">Tertunda</span>');
        var dateStr = c.created_at ? new Date(c.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

        html +=
          '<div style="background:#fff;border:1px solid var(--border-color, #e2e8f0);border-radius:12px;padding:12px 14px;">' +
          '  <div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
          '    <div>' +
          '      <div style="font-size:13px;font-weight:800;color:var(--text-main, #0f172a);">' + escapeHtml(c.order_number) + '</div>' +
          '      <div style="font-size:11px;color:#64748b;margin-top:2px;">' + dateStr + ' • Ref: <strong style="color:#0284c7;">' + escapeHtml(c.referral_code) + '</strong> (' + escapeHtml(c.affiliate_name) + ')</div>' +
          '    </div>' +
          '    <div>' + stBadge + '</div>' +
          '  </div>' +
          '  <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #f1f5f9;display:flex;justify-content:space-between;align-items:center;font-size:12px;">' +
          '    <span>' + (c.total_items || 1) + ' menu • Omzet: <strong>' + formatMoney(c.eligible_subtotal || 0) + '</strong></span>' +
          '    <span style="color:#16a34a;font-weight:800;">+' + formatMoney(c.commission_amount || 0) + '</span>' +
          '  </div>' +
          '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    if (tableEl) {
      tableEl.innerHTML = html;

      // Attach sub-tab event listeners
      var btnTopAff = tableEl.querySelector('#btn-tab-top-aff');
      var btnTopProd = tableEl.querySelector('#btn-tab-top-prod');
      var btnConversions = tableEl.querySelector('#btn-tab-conversions');

      var secTopAff = tableEl.querySelector('#sec-top-aff');
      var secTopProd = tableEl.querySelector('#sec-top-prod');
      var secConversions = tableEl.querySelector('#sec-conversions');

      function switchSubTab(target) {
        [btnTopAff, btnTopProd, btnConversions].forEach(function (b) { if (b) b.classList.remove('active'); });
        if (secTopAff) secTopAff.style.display = 'none';
        if (secTopProd) secTopProd.style.display = 'none';
        if (secConversions) secConversions.style.display = 'none';

        if (target === 'aff') {
          if (btnTopAff) btnTopAff.classList.add('active');
          if (secTopAff) secTopAff.style.display = '';
        } else if (target === 'prod') {
          if (btnTopProd) btnTopProd.classList.add('active');
          if (secTopProd) secTopProd.style.display = '';
        } else if (target === 'conv') {
          if (btnConversions) btnConversions.classList.add('active');
          if (secConversions) secConversions.style.display = '';
        }
      }

      if (btnTopAff) btnTopAff.onclick = function () { switchSubTab('aff'); };
      if (btnTopProd) btnTopProd.onclick = function () { switchSubTab('prod'); };
      if (btnConversions) btnConversions.onclick = function () { switchSubTab('conv'); };
    }
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

  // Global window bindings
  window.loadReports = loadReports;
  window.initReportsControls = initReportsControls;

  window.XentraReportsModule = {
    loadReports: loadReports,
    initReportsControls: initReportsControls
  };

})(window, document);
