/**
 * XENTRA CORE — MERCHANT APP ORDER CENTER
 *
 * Branch Manager order queue: polling, acceptance, status transitions,
 * reservation operational actions, rejection modal and order detail.
 *
 * Loaded after merchant-shared and branch-catalog, before merchant-app.js.
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
  var FulfillmentEnv = window.Xentra && window.Xentra.FulfillmentEnvironments;

  function getBMOrderType(ord) {
    return (ord && (ord.order_type || ord.fulfillment_type)) || 'delivery';
  }

  function getBMStatusBadgeHtml(ord) {
    var type = getBMOrderType(ord);
    var status = String((ord && ord.status) || '');
    var label = FulfillmentEnv && typeof FulfillmentEnv.getStatusLabel === 'function'
      ? FulfillmentEnv.getStatusLabel(type, status)
      : status.replace(/_/g, ' ');
    var cls = 'x-badge-warning';
    if (['rejected', 'cancelled', 'timeout', 'fulfillment_exception'].indexOf(status) !== -1) cls = 'x-badge-danger';
    else if (status === 'ready' || status === 'completed') cls = 'x-badge-success';
    else if (status === 'confirmed' || status === 'preparing' || status === 'out_for_delivery') cls = 'x-badge-info';
    return '<span class="x-badge ' + cls + '">' + esc(label.toUpperCase()) + '</span>';
  }

  var _bmOrdersState = {
    orders: [],
    searchQuery: '',
    queueView: 'attention',
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

    function setBMOrdersView(view) {
    _bmOrdersState.queueView = view === 'all' ? 'all' : 'attention';
    var attentionBtn = $('bm-orders-view-attention');
    var allBtn = $('bm-orders-view-all');
    if (attentionBtn) {
      attentionBtn.classList.toggle('active', _bmOrdersState.queueView === 'attention');
      attentionBtn.setAttribute('aria-selected', _bmOrdersState.queueView === 'attention' ? 'true' : 'false');
    }
    if (allBtn) {
      allBtn.classList.toggle('active', _bmOrdersState.queueView === 'all');
      allBtn.setAttribute('aria-selected', _bmOrdersState.queueView === 'all' ? 'true' : 'false');
    }
    renderBMOrdersFeed();
  }
  window.setBMOrdersView = setBMOrdersView;

  function setBMOrderTypeFilter(type) {
    _bmOrdersState.typeFilter = type || 'all';
    document.querySelectorAll('#bm-orders-type-chips .bm-order-type-chip').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.orderType === _bmOrdersState.typeFilter);
    });
    renderBMOrdersFeed();
  }
  window.setBMOrderTypeFilter = setBMOrderTypeFilter;

  function onBMOrdersFilterChange() {
    var searchEl = $('bm-orders-search');
    if (searchEl) _bmOrdersState.searchQuery = searchEl.value.trim().toLowerCase();
    renderBMOrdersFeed();
  }
  window.onBMOrdersFilterChange = onBMOrdersFilterChange;

  function getBMOrderPaymentState(ord) {
    var total = Number(ord && (ord.grand_total != null ? ord.grand_total : ord.subtotal) || 0);
    var paid = Number(ord && ord.paid_amount || 0);
    var outstanding = Math.max(0, ord && ord.outstanding_amount != null ? Number(ord.outstanding_amount) : total - paid);

    if (outstanding <= 0 && total > 0) {
      return { key: 'paid', label: 'Lunas', amount: 0, className: 'paid' };
    }
    if (paid > 0 && outstanding > 0) {
      return { key: 'partial', label: 'Sebagian dibayar', amount: outstanding, className: 'partial' };
    }
    return { key: 'unpaid', label: 'Belum dibayar', amount: total, className: 'unpaid' };
  }

  function getBMReservationScheduleMs(ord) {
    if (!ord || ord.order_type !== 'reservation' || ord.status !== 'confirmed') return NaN;
    var date = String(ord.reservation_date || (ord.scheduled_slot_start || '').substring(0, 10) || '').trim();
    var time = String(ord.reservation_time || (ord.scheduled_slot_start || '').substring(11, 16) || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NaN;
    var parsed = new Date(date + 'T' + time + ':00').getTime();
    return isNaN(parsed) ? NaN : parsed;
  }

  function getBMOrderProjection(ord) {
    var type = getBMOrderType(ord);
    var status = String((ord && ord.status) || '');
    var projection = {
      type: type,
      label: 'Pesanan',
      stateLabel: 'Perlu diperiksa',
      actionLabel: null,
      actionType: 'detail',
      actionTarget: ord && ord.id,
      attention: false,
      muted: false
    };

    if (type === 'reservation') {
      if (status === 'pending') {
        projection.label = 'Reservasi';
        projection.stateLabel = 'Menunggu konfirmasi';
        projection.actionLabel = 'Konfirmasi';
        projection.actionType = 'accept';
        projection.attention = true;
      } else if (status === 'confirmed') {
        var scheduleMs = getBMReservationScheduleMs(ord);
        projection.label = 'Reservasi';
        projection.stateLabel = !isNaN(scheduleMs) && scheduleMs <= Date.now() ? 'Waktu kedatangan' : 'Menunggu kedatangan';
        if (!isNaN(scheduleMs) && scheduleMs <= Date.now()) {
          projection.actionLabel = 'Check-in';
          projection.actionType = 'reservation_checkin';
          projection.attention = true;
        } else {
          projection.muted = true;
        }
      } else if (status === 'cancelled' || status === 'rejected' || status === 'timeout') {
        projection.label = 'Reservasi';
        projection.stateLabel = 'Tidak dilanjutkan';
        projection.muted = true;
      }
      return projection;
    }

    if (status === 'pending') {
      projection.stateLabel = 'Menunggu diterima';
      projection.actionLabel = 'Terima';
      projection.actionType = 'accept';
      projection.attention = true;
    } else if (status === 'confirmed') {
      projection.stateLabel = 'Menunggu disiapkan';
      projection.actionLabel = 'Mulai Siapkan';
      projection.actionType = 'advance';
      projection.attention = true;
    } else if (status === 'preparing') {
      projection.stateLabel = 'Sedang disiapkan';
      projection.actionLabel = 'Tandai Siap';
      projection.actionType = 'advance';
      projection.attention = true;
    } else if (status === 'ready') {
      if (type === 'dine_in') {
        projection.stateLabel = 'Siap disajikan';
        projection.actionLabel = 'Tandai Disajikan';
      } else if (type === 'pickup') {
        projection.stateLabel = 'Siap diambil';
        projection.actionLabel = 'Tandai Diambil';
      } else {
        projection.stateLabel = 'Siap diantar';
        projection.actionLabel = 'Kirim Pesanan';
      }
      projection.actionType = 'advance';
      projection.attention = true;
    } else if (status === 'out_for_delivery') {
      projection.stateLabel = 'Sedang diantar';
      projection.muted = true;
    } else if (status === 'completed') {
      projection.stateLabel = 'Pesanan selesai';
      projection.muted = true;
    } else if (['cancelled', 'rejected', 'timeout', 'fulfillment_exception'].indexOf(status) !== -1) {
      projection.stateLabel = status === 'fulfillment_exception' ? 'Perlu penanganan' : 'Tidak dilanjutkan';
      projection.muted = status !== 'fulfillment_exception';
      projection.attention = status === 'fulfillment_exception';
    }

    return projection;
  }

  function renderBMOrderStatusPill(projection) {
    var cls = projection.attention ? 'attention' : (projection.muted ? 'muted' : 'neutral');
    return '<span class="bm-order-state-pill ' + cls + '">' + esc(projection.stateLabel) + '</span>';
  }

  function renderBMOrderPaymentLine(ord) {
    var pay = getBMOrderPaymentState(ord);
    if (pay.key === 'paid') {
      return '<div class="bm-order-payment-line paid">✓ Lunas</div>';
    }
    if (pay.key === 'partial') {
      return '<div class="bm-order-payment-line partial">Sebagian dibayar · sisa ' + formatMoney(pay.amount) + '</div>';
    }
    return '<div class="bm-order-payment-line unpaid">Belum dibayar · ' + formatMoney(pay.amount) + '</div>';
  }

  function renderBMOrdersFeed() {
    var container = $('bm-orders-cards-container');
    if (!container) return;

    var all = (_bmOrdersState.orders || []).slice();
    var typeFilter = _bmOrdersState.typeFilter || 'all';
    if (typeFilter !== 'all') {
      all = all.filter(function (ord) {
        return getBMOrderType(ord) === typeFilter;
      });
    }
    if (_bmOrdersState.searchQuery) {
      var q = _bmOrdersState.searchQuery;
      all = all.filter(function (ord) {
        var num = String(ord.order_number || ord.id || '').toLowerCase();
        var cust = String(ord.customer_name || '').toLowerCase();
        var phone = String(ord.customer_phone || '').toLowerCase();
        return num.indexOf(q) !== -1 || cust.indexOf(q) !== -1 || phone.indexOf(q) !== -1;
      });
    }

    var projections = all.map(function (ord) {
      return { order: ord, projection: getBMOrderProjection(ord) };
    });

    var attentionItems = projections.filter(function (item) {
      return item.projection.attention || Number(item.order.pending_additions_count || 0) > 0;
    });

    var visible = _bmOrdersState.queueView === 'all' ? projections : attentionItems;

    // Newly arrived pending orders stay at the top. Then other actionable work.
    visible.sort(function (a, b) {
      var aNew = a.order.status === 'pending' && !!_bmOrdersState.newPendingOrderIds[a.order.id];
      var bNew = b.order.status === 'pending' && !!_bmOrdersState.newPendingOrderIds[b.order.id];
      if (aNew !== bNew) return aNew ? -1 : 1;
      if (a.projection.attention !== b.projection.attention) return a.projection.attention ? -1 : 1;
      var aTime = new Date(a.order.created_at || 0).getTime();
      var bTime = new Date(b.order.created_at || 0).getTime();
      return bTime - aTime;
    });

    var attentionCount = attentionItems.length;
    var allCount = projections.length;
    var attentionBtn = $('bm-orders-view-attention');
    var allBtn = $('bm-orders-view-all');
    if (attentionBtn && $('bm-orders-attention-count')) $('bm-orders-attention-count').textContent = attentionCount;
    if (allBtn && $('bm-orders-all-count')) $('bm-orders-all-count').textContent = allCount;

    if (!visible.length) {
      var emptyTitle = _bmOrdersState.queueView === 'attention' ? 'Tidak ada yang perlu ditangani.' : 'Belum ada pesanan.';
      var emptySub = _bmOrdersState.queueView === 'attention'
        ? 'Semua antrean cabang aman untuk sekarang.'
        : 'Pesanan baru akan muncul di sini.';
      container.innerHTML =
        '<div class="bm-order-empty">' +
          '<div class="bm-order-empty-icon">' + (_bmOrdersState.queueView === 'attention' ? '✓' : '🍽️') + '</div>' +
          '<strong>' + emptyTitle + '</strong>' +
          '<span>' + emptySub + '</span>' +
        '</div>';
      return;
    }

    container.innerHTML = visible.map(function (item) {
      var ord = item.order;
      var p = item.projection;
      var type = getBMOrderType(ord);
      var typeLabel = type === 'dine_in' ? 'Dine-in' : (type === 'pickup' ? 'Pickup' : (type === 'delivery' ? 'Delivery' : 'Reservasi'));
      var typeClass = 'type-' + type.replace('_', '-');
      var number = '#' + String(ord.order_number || ord.id || '').slice(0, 24);
      var location = type === 'dine_in'
        ? (ord.table_number ? 'Meja ' + ord.table_number : 'Makan di tempat')
        : (type === 'reservation'
          ? ((ord.reservation_time || (ord.scheduled_slot_start || '').substring(11, 16) || '—') + (getBMReservationGuestCount(ord) ? ' · ' + getBMReservationGuestCount(ord) + ' tamu' : ''))
          : type === 'pickup' ? 'Pickup' : 'Pengantaran');
      var itemCount = (ord.items || []).reduce(function (sum, i) { return sum + (Number(i.quantity) || 0); }, 0);
      var preview = (ord.items || []).slice(0, 2).map(function (i) {
        return esc(i.product_name || i.product_id || 'Item') + ' ×' + (Number(i.quantity) || 0);
      }).join(' · ');
      if ((ord.items || []).length > 2) preview += ' · +' + ((ord.items || []).length - 2) + ' lainnya';
      var deadline = '';
      if (ord.status === 'pending' && ord.acceptance_deadline_at) {
        var ms = new Date(ord.acceptance_deadline_at).getTime() - Date.now();
        if (ms > 0) deadline = '<span class="bm-order-deadline">⏱ ' + formatBMTimeRemaining(ms) + '</span>';
      }
      var pendingAdditions = Number(ord.pending_additions_count || 0);
      var attentionClass = (p.attention || pendingAdditions > 0) ? ' needs-attention' : '';
      var paymentLine = renderBMOrderPaymentLine(ord);

      var primary = '';
      if (pendingAdditions > 0) {
        primary = '<button type="button" class="bm-order-primary-action" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Tinjau tambahan +' + pendingAdditions + '</button>';
      } else if (p.actionType === 'accept') {
        if (type === 'reservation') {
          primary = '<button type="button" class="bm-order-primary-action" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'pending\', \'reservation\', this)">Konfirmasi</button>';
        } else {
          primary = '<button type="button" class="bm-order-primary-action" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'pending\', \'\' + esc(type) + '\', this)">Terima</button>';
        }
      } else if (p.actionType === 'reservation_checkin') {
        primary = '<button type="button" class="bm-order-primary-action" onclick="checkInBMReservation(\'' + esc(ord.id) + '\')">Check-in</button>';
      } else if (p.actionType === 'advance') {
        primary = '<button type="button" class="bm-order-primary-action" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'';
        primary += esc(String(ord.status)) + '\', \'';
        primary += esc(type) + '\', this)">' + esc(p.actionLabel || 'Lanjutkan') + '</button>';
      }

      var detail = '<button type="button" class="bm-order-detail-action" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Detail</button>';

      return '<article class="bm-order-feed-card' + attentionClass + '">' +
        '<div class="bm-order-feed-top">' +
          '<div class="bm-order-feed-context">' +
            '<span class="bm-order-type-pill ' + typeClass + '">' + esc(typeLabel) + '</span>' +
            '<strong>' + esc(location) + '</strong>' +
          '</div>' +
          '<time>' + esc((ord.created_at || '').substring(11, 16) || '—') + '</time>' +
        '</div>' +
        '<div class="bm-order-feed-main">' +
          '<div class="bm-order-feed-number">' + esc(number) + '</div>' +
          '<div class="bm-order-feed-customer">' + esc(ord.customer_name || 'Tamu') + '</div>' +
          '<div class="bm-order-feed-items">' + (preview || (type === 'reservation' ? 'Detail reservasi tersedia' : itemCount + ' item')) + '</div>' +
        '</div>' +
        '<div class="bm-order-feed-state">' +
          renderBMOrderStatusPill(p) +
          deadline +
        '</div>' +
        renderBMOrderPaymentLine(ord) +
        (pendingAdditions > 0 ? '<div class="bm-order-addition-alert">+' + pendingAdditions + ' tambahan menunggu diterima</div>' : '') +
        '<div class="bm-order-feed-actions">' + (primary || '') + detail + '</div>' +
      '</article>';
    }).join('');
  }


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
      var ordType = getBMOrderType(ord);
      if ($('bm-detail-order-number')) $('bm-detail-order-number').textContent = '#' + (ord.order_number || ord.id);
      if ($('bm-detail-status-badge')) {
        var detailStatusLabel = FulfillmentEnv && typeof FulfillmentEnv.getStatusLabel === 'function'
          ? FulfillmentEnv.getStatusLabel(ordType, ord.status)
          : String(ord.status || '').replace(/_/g, ' ');
        $('bm-detail-status-badge').textContent = detailStatusLabel.toUpperCase();
        $('bm-detail-status-badge').className = 'x-badge ' + (['completed', 'ready'].indexOf(ord.status) !== -1 ? 'x-badge-success' : (['rejected', 'cancelled', 'timeout', 'fulfillment_exception'].indexOf(ord.status) !== -1 ? 'x-badge-danger' : 'x-badge-warning'));
      }
      if ($('bm-detail-cust-name')) $('bm-detail-cust-name').textContent = ord.customer_name || 'Pelanggan';
      if ($('bm-detail-cust-phone')) $('bm-detail-cust-phone').textContent = ord.customer_phone || '—';
      if ($('bm-detail-fulfillment-badge')) $('bm-detail-fulfillment-badge').textContent = ordType.toUpperCase();
      if ($('bm-detail-order-time')) $('bm-detail-order-time').textContent = ord.created_at ? new Date(ord.created_at).toLocaleString('id-ID') : '—';
      var reservationRow = $('bm-detail-reservation-row');
      if (reservationRow) {
        if (ordType === 'reservation') {
          reservationRow.style.display = 'block';
          if ($('bm-detail-reservation-datetime')) $('bm-detail-reservation-datetime').textContent = formatBMReservationDateTime(ord);
          if ($('bm-detail-reservation-guests')) $('bm-detail-reservation-guests').textContent = Number(ord.guest_count || 0) + ' tamu';
        } else {
          reservationRow.style.display = 'none';
        }
      }
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

      // Pending Additional Orders require their own explicit acceptance action.
      var pendingAdditions = (ord.additions || []).filter(function (addition) {
        return addition.status === 'pending_acceptance';
      });
      var tbodyAdditions = $('bm-detail-items-tbody');
      if (tbodyAdditions && pendingAdditions.length) {
        var currentItemsHtml = tbodyAdditions.innerHTML;
        var additionsHtml = pendingAdditions.map(function (addition) {
          var header = '<tr><td colspan="5" style="background:#fff7ed;border-top:2px solid #fed7aa;padding:10px 12px;">' +
            '<div style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;">' +
              '<div><strong>Tambahan #' + esc(addition.sequence_no) + '</strong> <span class="x-badge x-badge-warning">MENUNGGU DITERIMA</span>' +
                '<small style="display:block;color:#6b7280;margin-top:3px;">' + esc(addition.source_channel || 'POS') + ' · ' + esc(addition.created_at || '') + '</small></div>' +
              '<div style="display:flex;gap:6px;">' +
                '<button type="button" class="x-btn-primary" style="font-size:11px;padding:5px 9px;" onclick="decideBMOrderAddition(\'' + esc(ord.id) + '\',\'' + esc(addition.id) + '\',\'accept\')">Terima</button>' +
                '<button type="button" class="x-btn-secondary" style="font-size:11px;padding:5px 9px;color:#dc2626;border-color:#fecaca;" onclick="decideBMOrderAddition(\'' + esc(ord.id) + '\',\'' + esc(addition.id) + '\',\'reject\')">Tolak</button>' +
              '</div>' +
            '</div></td></tr>';
          var itemsHtml = (addition.items || []).map(function (it) {
            var sub = it.subtotal != null ? it.subtotal : ((it.unit_price || 0) * (it.quantity || 1));
            return '<tr>' +
              '<td><span style="padding-left:12px;">↳ ' + esc(it.name || it.product_name || it.product_id) + '</span></td>' +
              '<td>' + formatMoney(it.unit_price || 0) + '</td>' +
              '<td>' + (it.quantity || 1) + '</td>' +
              '<td><small class="text-muted">' + esc(it.note || '—') + '</small></td>' +
              '<td class="text-right"><strong>' + formatMoney(sub) + '</strong></td>' +
            '</tr>';
          }).join('');
          return header + itemsHtml;
        }).join('');
        tbodyAdditions.innerHTML = currentItemsHtml + additionsHtml;
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
        if (ordType === 'reservation' && ord.status === 'confirmed') {
          topActions.innerHTML =
            '<button type="button" class="x-btn-primary" style="font-size:13px; padding:6px 14px;" onclick="checkInBMReservation(\'' + esc(ord.id) + '\');">Check-in Reservasi</button>' +
            '<button type="button" class="x-btn-secondary" style="font-size:13px; padding:6px 14px; color:#dc2626; border-color:#fecaca;" onclick="noShowBMReservation(\'' + esc(ord.id) + '\');">No-show</button>';
        } else if (ord.status === 'pending') {
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

})();
