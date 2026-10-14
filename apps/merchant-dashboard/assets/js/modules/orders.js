/**
 * XENTRA OWNER DASHBOARD — ORDERS MODULE
 * Standalone modular controller for incoming order queue and order details.
 */
(function (window, document) {
  'use strict';

  var S = window.XentraShared || {};
  var $ = S.$ || function (id) { return document.getElementById(id); };
  var esc = S.esc || function (t) { return t || ''; };
  var formatMoney = S.formatMoney || function (v) { return 'Rp ' + Number(v || 0).toLocaleString('id-ID'); };
  var showToast = S.showToast || function (m) { alert(m); };
  var API_BASE = S.API_BASE || '/api/v1';

  var _ordersSearchQuery = '';
  var _ordersStatusFilter = 'all';
  var _ordersChannelFilter = 'all';
  var _ordersFulfillmentFilter = 'all';
  var _activeDetailOrderId = null;
  var _ordersFetchSeq = 0;
  var _ordersPollTimer = null;

  function getAuthHeaders(extraHeaders) {
    var headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    var token = localStorage.getItem(S.TOKEN_KEY || 'xentra_merchant_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
  }

  function adminFetch(url, options) {
    if (typeof window.adminFetch === 'function') {
      return window.adminFetch(url, options);
    }
    return fetch(url, options);
  }

  function formatDashOrderCode(ord) {
    if (!ord) return '#—';
    var raw = (typeof ord === 'string') ? ord : (ord.order_number || ord.orderNumber || ord.code || ord.id || '');
    raw = String(raw).trim();
    if (!raw) return '#—';
    var match = raw.match(/^(?:#)?(OD|DI|TK|RS|POS)-(\d{3,4})\b/i);
    if (match) {
      var prefix = match[1].toUpperCase();
      if (prefix === 'POS') prefix = 'TK';
      return '#' + prefix + '-' + match[2];
    }
    var type = (typeof ord === 'object' && ord !== null) ? (ord.order_type || ord.fulfillment_type || '') : '';
    var pfx = 'TK';
    if (type === 'delivery') pfx = 'OD';
    else if (type === 'dine_in') pfx = 'DI';
    else if (type === 'reservation') pfx = 'RS';
    var digits = raw.replace(/\D/g, '');
    var num = digits.length >= 3 ? digits.slice(-3) : ((digits + '100').slice(0, 3));
    return '#' + pfx + '-' + num;
  }
  window.formatDashOrderCode = formatDashOrderCode;

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

  async function loadOrders(opts) {
    var isBg = opts && opts.background;
    var tbody = $('orders-table-body');
    var state = window.state || {};
    if (tbody && !isBg && (!state.orders || !state.orders.length)) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6">Memuat data pesanan...</td></tr>';
    }

    var currentSeq = ++_ordersFetchSeq;

    try {
      var queryParams = [];
      var branchState = window._branchContextState;
      if (branchState && branchState.selected && branchState.selected !== 'all') {
        queryParams.push('branch_id=' + encodeURIComponent(branchState.selected));
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

      if (currentSeq !== _ordersFetchSeq) return;

      if (data.success && data.orders) {
        if (!window.state) window.state = {};
        window.state.orders = data.orders;
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

    var state = window.state || {};
    var orders = state.orders || [];

    if (!orders.length) {
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

    var rows = orders.map(function (ord) {
      var orderChannel = ord.order_channel || 'customer_app';
      var fulfillmentType = ord.fulfillment_type || ord.order_type || 'delivery';
      var timeStr = ord.created_at ? (new Date(ord.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })) : '-';
      var canAdvance = ord.status === 'pending';

      return [
        '<tr data-order-id="' + ord.id + '" style="cursor:pointer;" onclick="if (!event.target.closest(\'button, a, input\')) { navigateTo(\'orders/' + ord.id + '\'); }">',
          '<td><a href="#orders/' + ord.id + '" style="font-weight:700;color:var(--text-main);text-decoration:none;" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + esc(formatDashOrderCode(ord)) + '</a></td>',
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
                ? '<button type="button" class="x-btn-primary" style="padding:6px 12px;font-size:12px;" onclick="event.stopPropagation();advanceOrderStatus(\'' + ord.id + '\', \'' + ord.status + '\', \'' + fulfillmentType + '\')">' + (ord.status === 'pending' ? 'Terima Pesanan' : 'Ubah Status ➔') + '</button>'
                : ''),
            '</div>',
          '</td>',
        '</tr>'
      ].join('');
    });

    tbody.innerHTML = rows.join('');
  }

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
        if (typeof window.navigateTo === 'function') window.navigateTo('orders');
        return;
      }

      var ord = data.order;

      // Update Summary Header
      var orderCode = formatDashOrderCode(ord);
      if ($('order-detail-breadcrumb')) $('order-detail-breadcrumb').textContent = orderCode;
      if ($('order-detail-mobile-title')) $('order-detail-mobile-title').textContent = 'Detail Pesanan · ' + orderCode;
      if ($('order-detail-number')) $('order-detail-number').textContent = orderCode;

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
                '<span><a href="#orders/' + so.id + '" style="font-weight:700;color:#166534;text-decoration:none;">' + esc(formatDashOrderCode(so)) + '</a> (' + so.order_channel + ')</span>' +
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
    if (typeof window.bindLiveSearch === 'function') {
      window.bindLiveSearch('orders-search-input', function (state) {
        _ordersSearchQuery = state.raw.trim();
        loadOrders();
      }, { debounce: 300 });
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
    if (typeof window.requestTextInputSheet !== 'function') return;
    var reason = await window.requestTextInputSheet({ title: 'Tolak Pesanan', label: 'Alasan Penolakan', saveLabel: 'Tolak' });
    if (reason === null) return;
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

  // Expose Orders API to global window/namespace
  window.XentraOrdersModule = {
    loadOrders: loadOrders,
    renderOrdersTable: renderOrdersTable,
    loadOrderDetailView: loadOrderDetailView,
    showOrdersListView: showOrdersListView,
    showOrderDetailView: showOrderDetailView,
    startOrdersPolling: startOrdersPolling,
    stopOrdersPolling: stopOrdersPolling,
    initOrdersFilterListeners: initOrdersFilterListeners
  };

  // Global backward compatibility
  window.loadOrders = loadOrders;
  window.renderOrdersTable = renderOrdersTable;
  window.loadOrderDetailView = loadOrderDetailView;
  window.showOrdersListView = showOrdersListView;
  window.showOrderDetailView = showOrderDetailView;
  window.startOrdersPolling = startOrdersPolling;
  window.stopOrdersPolling = stopOrdersPolling;
  window.initOrdersFilterListeners = initOrdersFilterListeners;

})(window, document);
