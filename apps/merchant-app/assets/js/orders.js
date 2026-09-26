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

    function getBMReservationScheduleMs(ord) {
      if (!ord || ord.order_type !== 'reservation' || ord.status !== 'confirmed') return NaN;

      var date = String(ord.reservation_date || (ord.scheduled_slot_start || '').substring(0, 10) || '').trim();
      var time = String(ord.reservation_time || (ord.scheduled_slot_start || '').substring(11, 16) || '').trim();

      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date) || !/^\\d{2}:\\d{2}$/.test(time)) return NaN;

      var parsed = new Date(date + 'T' + time + ':00').getTime();
      return isNaN(parsed) ? NaN : parsed;
    }

    // Deterministic operational queue sorting without mutating server orders array:
    // 1. Genuinely new pending orders (tier 0)
    // 2. Existing pending orders (tier 1)
    // 3. Upcoming confirmed reservations (tier 2), nearest reservation first
    // 4. Everything else preserved in original server order (tier 3)
    //
    // Reservation urgency is visibility-only: it does not alter business state,
    // payment flow or server-side ordering.
    var sortNow = Date.now();
    var sorted = filtered.slice().sort(function (a, b) {
      var aIsPending = (a.status === 'pending');
      var bIsPending = (b.status === 'pending');
      var aIsNew = aIsPending && !!_bmOrdersState.newPendingOrderIds[a.id];
      var bIsNew = bIsPending && !!_bmOrdersState.newPendingOrderIds[b.id];

      var aReservationMs = getBMReservationScheduleMs(a);
      var bReservationMs = getBMReservationScheduleMs(b);
      var aIsUpcomingReservation = !isNaN(aReservationMs) && aReservationMs >= sortNow;
      var bIsUpcomingReservation = !isNaN(bReservationMs) && bReservationMs >= sortNow;

      var aRank = aIsNew ? 0 : (aIsPending ? 1 : (aIsUpcomingReservation ? 2 : 3));
      var bRank = bIsNew ? 0 : (bIsPending ? 1 : (bIsUpcomingReservation ? 2 : 3));

      if (aRank !== bRank) return aRank - bRank;

      if (aIsUpcomingReservation && bIsUpcomingReservation) {
        if (aReservationMs !== bReservationMs) return aReservationMs - bReservationMs;
      }

      return 0; // Preserve relative server order within the same operational tier
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

    var now = Date.now();

    var rowsHtml = [];
    var cardsHtml = [];

    sorted.forEach(function (ord) {
      var ordType = ord.order_type || ord.fulfillment_type || 'delivery';
      var typeBadge = (ordType === 'delivery')
        ? '<span class="x-badge x-badge-info">DELIVERY</span>'
        : (ordType === 'dine_in'
          ? '<span class="x-badge" style="background:#ede9fe;color:#6d28d9;">DINE-IN</span>'
          : (ordType === 'reservation'
            ? '<span class="x-badge" style="background:#fef3c7;color:#92400e;">RESERVASI</span>'
            : '<span class="x-badge x-badge-warning">PICKUP</span>'));

      var timeStr = (ord.created_at || '').substring(11, 16) || '—';
      var reservationDate = ord.order_type === 'reservation' ? String(ord.reservation_date || (ord.scheduled_slot_start || '').substring(0, 10) || '') : '';
      var reservationTime = ord.order_type === 'reservation' ? String(ord.reservation_time || (ord.scheduled_slot_start || '').substring(11, 16) || '') : '';
      var reservationGuests = ord.order_type === 'reservation' ? getBMReservationGuestCount(ord) : 0;
      var reservationInfo = ord.order_type === 'reservation'
        ? (esc(reservationDate || '—') + ' • ' + esc(reservationTime || '—') + (reservationGuests ? (' • ' + reservationGuests + ' tamu') : ''))
        : '';
      var tableInfo = ord.table_number ? ('Meja ' + esc(ord.table_number)) : '—';
      var totalStr = formatMoney(ord.grand_total || ord.subtotal || 0);

      var isNewPending = (ord.status === 'pending') && !!_bmOrdersState.newPendingOrderIds[ord.id];

      // Build deadline / status representation (shared logic)
      var statusBadgeHtml = getBMStatusBadgeHtml(ord);
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
      if (ordType === 'reservation' && ord.status === 'confirmed') {
        actionsHtml =
          '<div style="display:flex; gap:6px; justify-content:flex-end; flex-wrap:wrap;">' +
            '<button type="button" class="x-btn-primary" style="font-size:11px; padding:4px 8px;" onclick="checkInBMReservation(\'' + esc(ord.id) + '\')">Check-in</button>' +
            '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px; color:#dc2626; border-color:#fecaca;" onclick="noShowBMReservation(\'' + esc(ord.id) + '\')">No-show</button>' +
            '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Detail</button>' +
          '</div>';
      } else if (ord.status === 'pending') {
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
          '<td><small class="text-muted">' + timeStr + '</small>' + (reservationInfo ? '<br><small style="color:#92400e;font-weight:700;">' + reservationInfo + '</small>' : '') + '</td>' +
          '<td><strong>' + esc(ord.customer_name || 'Pelanggan') + '</strong><br><small class="text-muted">' + esc(ord.customer_phone || '—') + '</small></td>' +
          '<td>' + typeBadge + '</td>' +
          '<td>' + (ordType === 'reservation' ? (reservationGuests ? (reservationGuests + ' tamu') : '—') : tableInfo) + '</td>' +
          '<td><strong>' + totalStr + '</strong></td>' +
          '<td>' + statusCol + '</td>' +
          '<td class="text-right">' + actionsHtml + '</td>' +
        '</tr>'
      );

      // --- Operational Mobile Card HTML ---
      var cardActionsHtml = '';
      if (ordType === 'reservation' && ord.status === 'confirmed') {
        cardActionsHtml =
          '<div class="bm-order-card-actions">' +
            '<button type="button" class="x-btn-primary" onclick="checkInBMReservation(\'' + esc(ord.id) + '\')">Check-in</button>' +
            '<button type="button" class="x-btn-secondary bm-btn-danger" onclick="noShowBMReservation(\'' + esc(ord.id) + '\')">No-show</button>' +
            '<button type="button" class="x-btn-secondary bm-btn-detail" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Detail</button>' +
          '</div>';
      } else if (ord.status === 'pending') {
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
              (ordType === 'reservation'
                ? ('<span class="bm-order-card-table">• ' + reservationInfo + '</span>')
                : (ord.table_number ? ('<span class="bm-order-card-table">• Meja ' + esc(ord.table_number) + '</span>') : '')) +
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

  function getBMReservationGuestCount(ord) {
    if (!ord) return 0;
    var explicit = Number(ord.guest_count);
    if (Number.isInteger(explicit) && explicit > 0) return explicit;

    var note = String(ord.order_note || ord.notes || ord.order_notes || '');
    var match = /Reservasi\s*\(\s*(\d+)\s*Tamu/i.exec(note);
    return match ? Number(match[1]) : 0;
  }

  function formatBMReservationDateTime(ord) {
    var raw = ord && (ord.scheduled_slot_start || '');
    var date = String(ord && (ord.reservation_date || raw.substring(0, 10)) || '').trim();
    var time = String(ord && (ord.reservation_time || raw.substring(11, 16)) || '').trim();
    if (!date) return '—';
    return date + (time ? ' • ' + time : '');
  }

  async function checkInBMReservation(orderId) {
    var tableNumber = prompt('Masukkan nomor meja untuk check-in reservasi:');
    if (tableNumber === null) return;
    tableNumber = String(tableNumber).trim();
    if (!tableNumber) {
      showToast('Nomor meja wajib diisi.');
      return;
    }

    try {
      var res = await adminFetch(API_BASE + '/pos/reservations/' + encodeURIComponent(orderId) + '/check-in', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ table_number: tableNumber })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Reservasi #' + orderId + ' berhasil check-in di meja ' + tableNumber + '.');
        await loadBMOrders({ background: true });
        viewBMOrderDetail(orderId);
      } else {
        showToast('Check-in gagal: ' + (data.error || 'Terjadi kesalahan'));
        loadBMOrders({ background: true });
      }
    } catch (e) {
      showToast('Kesalahan jaringan saat check-in reservasi.');
    }
  }
  window.checkInBMReservation = checkInBMReservation;

  async function noShowBMReservation(orderId) {
    if (!confirm('Tandai reservasi #' + orderId + ' sebagai NO-SHOW? Ini hanya berhasil setelah jadwal + grace period.')) return;

    try {
      var res = await adminFetch(API_BASE + '/pos/reservations/' + encodeURIComponent(orderId) + '/no-show', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({})
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Reservasi #' + orderId + ' ditandai NO-SHOW.');
        await loadBMOrders({ background: true });
        closeBMOrderDetail();
      } else {
        showToast('No-show gagal: ' + (data.error || 'Belum melewati grace period'));
        loadBMOrders({ background: true });
      }
    } catch (e) {
      showToast('Kesalahan jaringan saat memproses no-show.');
    }
  }
  window.noShowBMReservation = noShowBMReservation;

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
