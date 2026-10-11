/**
 * XENTRA OWNER DASHBOARD — OVERVIEW & COMMAND CENTER MODULE
 * Standalone modular controller for Command Center hero KPIs, branch performance,
 * order summaries, top products, alerts/needs attention, and period filters.
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
    if (typeof window.getAuthHeaders === 'function') return window.getAuthHeaders(extraHeaders);
    var headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    var token = localStorage.getItem(S.TOKEN_KEY || 'xentra_merchant_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
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
    return !!(user && (user.role === 'branch_manager' || user.role === 'manager'));
  }

  /* =========================================================================
     MODUL: RINGKASAN & OVERVIEW (COMMAND CENTER)
     ========================================================================= */
  var _overviewFilter = {
    startDate: '',
    endDate: ''
  };

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
        var bState = window._branchContextState;
        if (branchId && bState) {
          var found = (bState.branches || []).find(function (b) { return String(b.id) === String(branchId); });
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
      var bState = window._branchContextState;
      if (bState && bState.branches) {
        var found = bState.branches.find(function (b) { return String(b.id) === String(branchId); });
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
            '<button type="button" class="x-occ-retry-btn" onclick="window.XentraOverviewModule.loadOverview()">Coba lagi</button>' +
          '</div>';
      }
    });
    var attention = $('occ-attention-content');
    if (attention) {
      attention.innerHTML = '<div class="x-occ-error-state" role="alert">' +
        '<div class="x-occ-error-copy"><strong>Ringkasan belum tersedia</strong><span>Coba muat ulang data.</span></div>' +
        '<button type="button" class="x-occ-retry-btn" onclick="window.XentraOverviewModule.loadOverview()">Coba lagi</button>' +
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

  // Export module public API
  var moduleApi = {
    loadOverview: loadOverview,
    setOverviewPeriodPreset: setOverviewPeriodPreset,
    initOverviewControls: initOverviewControls,
    renderOverviewData: renderOverviewData,
    renderOverviewEmpty: renderOverviewEmpty,
    renderOccHeroKpi: renderOccHeroKpi,
    renderOccBranchPerformance: renderOccBranchPerformance,
    renderOccOrdersSummary: renderOccOrdersSummary,
    renderOccTopProducts: renderOccTopProducts,
    renderOccAttention: renderOccAttention
  };

  window.XentraOverviewModule = moduleApi;
  window.loadOverview = loadOverview;
  window.loadOwnerOverview = loadOverview;
  window.initOverviewControls = initOverviewControls;

})(window, document);
