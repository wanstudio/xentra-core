/**
 * XENTRA OWNER DASHBOARD — FINANCE & SETTLEMENT MODULE
 * Standalone modular controller for Revenue overview, cash transactions, reconciliation, and payment gateways.
 */
(function (window, document) {
  'use strict';

  var S = window.XentraShared || {};
  var $ = S.$ || function (id) { return document.getElementById(id); };
  var esc = S.esc || function (t) { return t || ''; };
  var formatMoney = S.formatMoney || function (v) { return 'Rp ' + Number(v || 0).toLocaleString('id-ID'); };
  var showToast = S.showToast || function (m) { alert(m); };
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

  /* =========================================================================
     PHASE 6: CLIENT OWNER DASHBOARD — FINANCE FRONTEND LOGIC
     Authoritative Core data consumption with granular Branch Context scoping
     ========================================================================= */

  var _activeFinanceSubtab = 'overview';

  function toggleFinanceDropdown() {
    var d = $('finance-section-dropdown');
    if (!d) return;
    var open = d.classList.toggle('open');
    var trigger = $('btn-finance-section-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function pickFinanceSection(item) {
    if (!item) return;
    closeFinanceDropdown();
    var value = item.dataset.value;
    if (value) navigateTo('finance/' + value);
  }

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
      if (isCurrent && label) {
        var sp = item.querySelector('span');
        if (sp) label.textContent = sp.textContent;
      }
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

  function toggleFinanceFilter(kind) {
    var dropdown = $('fin-filter-' + kind + '-dropdown');
    if (!dropdown) return;
    var open = dropdown.classList.toggle('open');
    var trigger = $('btn-fin-filter-' + kind);
    if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function pickFinanceFilter(kind, item) {
    if (!item) return;
    closeFinanceFilter(kind);
    var cfg = FIN_FILTERS[kind];
    var sel = cfg && $(cfg.select);
    if (!sel) return;
    sel.value = item.dataset.value;
    syncFinanceFilter(kind);
    loadFinanceTransactions();
  }

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

    // Sync dropdown menu selection
    var menu = document.querySelectorAll('#finance-section-menu .x-occ-dropdown-item');
    menu.forEach(function (item) {
      var isCurrent = item.dataset.value === subtab;
      item.classList.toggle('active', isCurrent);
      item.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
      if (isCurrent) {
        var label = $('finance-section-label');
        var sp = item.querySelector('span');
        if (label && sp) label.textContent = sp.textContent;
      }
    });

    // Toggle subviews
    var views = {
      'overview': 'finance-view-overview',
      'transactions': 'finance-view-transactions',
      'payouts': 'finance-view-payouts',
      'reconciliation': 'finance-view-reconciliation',
      'payment-methods': 'finance-view-payment-methods',
      'channels': 'finance-view-channels'
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
    else if (subtab === 'channels') loadFinanceChannels();
  }

  function loadFinanceCurrentSubtab() {
    switchFinanceSection(_activeFinanceSubtab, false);
  }

  async function loadFinanceOverview() {
    try {
      var branchId = getEffectiveBranchId();
      var query = branchId && branchId !== 'all' ? '?branch_id=' + encodeURIComponent(branchId) : '';
      var res = await adminFetch(API_BASE + '/admin/finance/overview' + query, { headers: getAuthHeaders() });
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

  async function loadFinanceTransactions() {
    try {
      syncFinanceFilters();
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
      var res = await adminFetch(API_BASE + '/admin/finance/transactions' + query, { headers: getAuthHeaders() });
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

        var methodLabel = t.payment_method === 'cash' ? 'Tunai (Cash)'
          : (t.payment_method === 'doku' ? 'DOKU' : 'Midtrans');
        var timeText = t.created_at ? esc(t.created_at.substring(0, 19).replace('T', ' ')) : '—';
        var oCode = (window.formatDashOrderCode ? window.formatDashOrderCode(t) : (t.order_number ? (t.order_number.startsWith('#') ? t.order_number : ('#' + t.order_number)) : '#—'));

        return '<tr>' +
          '<td data-label="ID Transaksi"><code style="font-size:12px;background:#f8fafc;padding:2px 6px;border-radius:4px;">' + esc(t.id || '—') + '</code></td>' +
          '<td data-label="Waktu" style="font-size:12px;color:#64748b;">' + timeText + '</td>' +
          '<td data-label="Pesanan"><a href="#orders/' + encodeURIComponent(t.order_id) + '" style="font-weight:600;color:var(--primary);text-decoration:none;">' + esc(oCode) + '</a></td>' +
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

  async function loadFinanceReconciliation() {
    try {
      var tbody = $('tbody-fin-reconciliation');
      if (!tbody) return;

      var branchId = getEffectiveBranchId();
      var query = branchId && branchId !== 'all' ? '?branch_id=' + encodeURIComponent(branchId) : '';
      var res = await adminFetch(API_BASE + '/admin/finance/reconciliation' + query, { headers: getAuthHeaders() });
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
        var oCode = (window.formatDashOrderCode ? window.formatDashOrderCode(r) : (r.order_number ? (r.order_number.startsWith('#') ? r.order_number : ('#' + r.order_number)) : '#—'));
        return '<tr>' +
          '<td><a href="#orders/' + encodeURIComponent(r.order_id) + '" style="font-weight:600;color:var(--primary);text-decoration:none;">' + esc(oCode) + '</a></td>' +
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

  async function loadFinancePaymentMethods() {
    try {
      var cont = $('fin-payment-methods-list');
      if (!cont) return;

      var branchId = getEffectiveBranchId();
      var query = branchId && branchId !== 'all' ? '?branch_id=' + encodeURIComponent(branchId) : '';
      var res = await adminFetch(API_BASE + '/admin/finance/payment-methods' + query, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var json = await res.json();
      if (!json.success || !json.payment_methods) return;

      var cards = json.payment_methods.map(function (m) {
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

  async function togglePaymentMethodType(checkbox) {
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
  }

  async function togglePaymentProvider(checkbox) {
    var provider = checkbox.dataset.provider;
    var enabled = checkbox.checked;
    var label = provider === 'doku' ? 'DOKU' : 'Midtrans';
    try {
      var res = await adminFetch(API_BASE + '/admin/settings/commerce/payments', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ provider: enabled ? provider : '' })
      });
      var json = await res.json();
      if (json.success) {
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
  }

  /* =========================================================================
     REKONSILIASI SALURAN OJOL (GoFood, GrabFood, ShopeeFood)
     ========================================================================= */
  var _cachedOjolOrders = [];

  async function loadFinanceChannels() {
    var tbody = $('tbody-ojol-orders');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-muted">Memuat data rekonsiliasi ojol...</td></tr>';

    try {
      var branchId = getEffectiveBranchId();
      var channelFilter = $('ojol-filter-channel') ? $('ojol-filter-channel').value : 'all';
      var startDate = $('ojol-filter-start') ? $('ojol-filter-start').value : '';
      var endDate = $('ojol-filter-end') ? $('ojol-filter-end').value : '';

      var queryParams = [];
      if (branchId && branchId !== 'all') queryParams.push('branch_id=' + encodeURIComponent(branchId));
      if (startDate) queryParams.push('start_date=' + encodeURIComponent(startDate));
      if (endDate) queryParams.push('end_date=' + encodeURIComponent(endDate));
      var qs = queryParams.length > 0 ? '?' + queryParams.join('&') : '';

      // 1. Fetch channel financial summary
      var sumRes = await adminFetch(API_BASE + '/integrations/channel-summary' + qs, { headers: getAuthHeaders() });
      var sumJson = await sumRes.json();

      var summaryList = (sumJson.success && Array.isArray(sumJson.data)) ? sumJson.data : [];

      var totalGross = 0;
      var totalFee = 0;
      var totalNet = 0;
      var totalOrders = 0;

      var chMap = { gofood: null, grabfood: null, shopeefood: null };

      summaryList.forEach(function (row) {
        var ch = (row.channel || '').toLowerCase();
        var g = Number(row.total_gross || 0);
        var f = Number(row.total_commission_fee || 0);
        var n = Number(row.total_net_payout || 0);
        var o = Number(row.total_orders || 0);

        totalGross += g;
        totalFee += f;
        totalNet += n;
        totalOrders += o;

        chMap[ch] = { gross: g, fee: f, net: n, orders: o };
      });

      // Update KPI cards
      if ($('ojol-kpi-gross')) $('ojol-kpi-gross').textContent = formatMoney(totalGross);
      if ($('ojol-kpi-fee')) $('ojol-kpi-fee').textContent = '- ' + formatMoney(totalFee);
      if ($('ojol-kpi-net')) $('ojol-kpi-net').textContent = formatMoney(totalNet);
      if ($('ojol-kpi-orders')) $('ojol-kpi-orders').textContent = totalOrders + ' Pesanan';

      // Update channel cards
      ['gofood', 'grabfood', 'shopeefood'].forEach(function (ch) {
        var prefix = ch === 'gofood' ? 'gf' : (ch === 'grabfood' ? 'grb' : 'spf');
        var data = chMap[ch] || { gross: 0, fee: 0, net: 0, orders: 0 };
        if ($('card-' + prefix + '-orders')) $('card-' + prefix + '-orders').textContent = data.orders + ' Pesanan';
        if ($('card-' + prefix + '-gross')) $('card-' + prefix + '-gross').textContent = formatMoney(data.gross);
        if ($('card-' + prefix + '-fee')) $('card-' + prefix + '-fee').textContent = '- ' + formatMoney(data.fee);
        if ($('card-' + prefix + '-net')) $('card-' + prefix + '-net').textContent = formatMoney(data.net);
      });

      // 2. Fetch detailed order ledger
      var orderParams = [].concat(queryParams);
      if (channelFilter && channelFilter !== 'all') {
        orderParams.push('channel=' + encodeURIComponent(channelFilter));
      }
      var ledgerQs = orderParams.length > 0 ? '?' + orderParams.join('&') : '';
      var ledgerRes = await adminFetch(API_BASE + '/integrations/channel-orders' + ledgerQs, { headers: getAuthHeaders() });
      var ledgerJson = await ledgerRes.json();

      _cachedOjolOrders = (ledgerJson.success && Array.isArray(ledgerJson.data)) ? ledgerJson.data : [];

      if (!tbody) return;

      if (_cachedOjolOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-muted">Belum ada pesanan ojol yang dibukukan untuk periode ini.</td></tr>';
        return;
      }

      var html = '';
      _cachedOjolOrders.forEach(function (item) {
        var ch = (item.channel || '').toLowerCase();
        var badgeStyle = 'background:#f1f5f9;color:#334155;';
        var badgeLabel = ch.toUpperCase();
        if (ch === 'gofood') {
          badgeStyle = 'background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;';
          badgeLabel = '🟢 GoFood';
        } else if (ch === 'grabfood') {
          badgeStyle = 'background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;';
          badgeLabel = '🟢 GrabFood';
        } else if (ch === 'shopeefood') {
          badgeStyle = 'background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;';
          badgeLabel = '🟠 ShopeeFood';
        }

        var createdAt = item.created_at || '';
        var fee = Number(item.commission_amount || 0) + Number(item.platform_fee || 0);

        html += '<tr>' +
          '<td style="white-space:nowrap;font-size:12px;color:#64748b;">' + esc(createdAt) + '</td>' +
          '<td><span class="x-badge" style="' + badgeStyle + 'font-weight:700;">' + badgeLabel + '</span></td>' +
          '<td><strong style="color:#0f172a;">#' + esc(item.external_order_id) + '</strong><br><span style="font-size:11px;color:#94a3b8;">Xentra: ' + esc(item.order_number) + '</span></td>' +
          '<td><span style="font-size:13px;font-weight:600;color:#1e293b;">' + esc(item.driver_name || item.customer_name || '-') + '</span></td>' +
          '<td style="text-align:right;font-weight:700;color:#0f172a;">' + formatMoney(item.gross_amount) + '</td>' +
          '<td style="text-align:right;font-weight:600;color:#ef4444;">- ' + formatMoney(fee) + '</td>' +
          '<td style="text-align:right;font-weight:800;color:#059669;font-size:13.5px;">' + formatMoney(item.net_amount) + '</td>' +
          '<td style="text-align:center;"><span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:700;">Settled</span></td>' +
        '</tr>';
      });

      tbody.innerHTML = html;
    } catch (e) {
      console.warn('[Finance Channels Error]:', e);
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-red-500">Gagal memuat rekonsiliasi saluran ojol.</td></tr>';
    }
  }

  function exportOjolLedgerCSV() {
    if (!_cachedOjolOrders || _cachedOjolOrders.length === 0) {
      showToast('Tidak ada data transaksi ojol untuk diekspor.');
      return;
    }

    var csvRows = [
      ['Waktu', 'Saluran', 'ID Pesanan Ojol', 'No Pesanan Xentra', 'Driver/Customer', 'Gross Belanja', 'Potongan Komisi', 'Net Settlement', 'Status']
    ];

    _cachedOjolOrders.forEach(function (r) {
      var fee = Number(r.commission_amount || 0) + Number(r.platform_fee || 0);
      csvRows.push([
        r.created_at || '',
        r.channel || '',
        r.external_order_id || '',
        r.order_number || '',
        r.driver_name || r.customer_name || '',
        Number(r.gross_amount || 0),
        fee,
        Number(r.net_amount || 0),
        'Settled'
      ]);
    });

    var csvContent = 'data:text/csv;charset=utf-8,' + csvRows.map(function (e) {
      return e.map(function (val) {
        return '"' + String(val).replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\n');

    var encodedUri = encodeURI(csvContent);
    var link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'rekonsiliasi_ojol_' + new Date().toISOString().slice(0, 10) + '.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Global window bindings for inline HTML handlers & dashboard routing
  window.toggleFinanceDropdown = toggleFinanceDropdown;
  window.pickFinanceSection = pickFinanceSection;
  window.toggleFinanceFilter = toggleFinanceFilter;
  window.pickFinanceFilter = pickFinanceFilter;
  window.switchFinanceSection = switchFinanceSection;
  window.loadFinanceCurrentSubtab = loadFinanceCurrentSubtab;
  window.loadFinanceOverview = loadFinanceOverview;
  window.loadFinanceTransactions = loadFinanceTransactions;
  window.loadFinanceReconciliation = loadFinanceReconciliation;
  window.loadFinancePaymentMethods = loadFinancePaymentMethods;
  window.loadFinanceChannels = loadFinanceChannels;
  window.exportOjolLedgerCSV = exportOjolLedgerCSV;
  window.togglePaymentMethodType = togglePaymentMethodType;
  window.togglePaymentProvider = togglePaymentProvider;

  window.XentraFinanceModule = {
    switchFinanceSection: switchFinanceSection,
    loadFinanceCurrentSubtab: loadFinanceCurrentSubtab,
    loadFinanceOverview: loadFinanceOverview,
    loadFinanceTransactions: loadFinanceTransactions,
    loadFinanceReconciliation: loadFinanceReconciliation,
    loadFinancePaymentMethods: loadFinancePaymentMethods,
    loadFinanceChannels: loadFinanceChannels,
    exportOjolLedgerCSV: exportOjolLedgerCSV
  };

})(window, document);
