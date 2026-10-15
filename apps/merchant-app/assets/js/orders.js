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

  var S = window.XentraShared || {};
  var API_BASE = (window.XentraShared && window.XentraShared.API_BASE) || S.API_BASE || '';
  function $(id) { return (window.XentraShared && window.XentraShared.$ ? window.XentraShared.$(id) : (S.$ ? S.$(id) : document.getElementById(id))); }
  function esc(val) { return (window.XentraShared && window.XentraShared.esc ? window.XentraShared.esc(val) : (S.esc ? S.esc(val) : String(val == null ? '' : val))); }
  function formatMoney(val) { return (window.XentraShared && window.XentraShared.formatMoney ? window.XentraShared.formatMoney(val) : (S.formatMoney ? S.formatMoney(val) : String(val || 0))); }
  function showToast(msg) { return (window.XentraShared && window.XentraShared.showToast ? window.XentraShared.showToast(msg) : (S.showToast ? S.showToast(msg) : null)); }
  function adminFetch(url, opts) { return (window.XentraShared && window.XentraShared.adminFetch ? window.XentraShared.adminFetch(url, opts) : S.adminFetch(url, opts)); }
  function getAuthHeaders() { return (window.XentraShared && window.XentraShared.getAuthHeaders ? window.XentraShared.getAuthHeaders() : (S.getAuthHeaders ? S.getAuthHeaders() : {})); }
  function getStoredUser() { return (window.XentraShared && window.XentraShared.getStoredUser ? window.XentraShared.getStoredUser() : (S.getStoredUser ? S.getStoredUser() : null)); }
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

  var _bmAcceptContext = null;

  window._bmOrdersState = _bmOrdersState;

  function findBMOrderById(orderId) {
    if (!orderId) return null;
    var strId = String(orderId).trim();
    var list = (_bmOrdersState.orders || []);
    var found = list.find(function (o) { return String(o.id) === strId || String(o.order_number) === strId; });
    if (!found && window._hariIniState && Array.isArray(window._hariIniState.orders)) {
      found = window._hariIniState.orders.find(function (o) { return String(o.id) === strId || String(o.order_number) === strId; });
    }
    return found || null;
  }

  function formatBMOrderCode(ord) {
    if (!ord) return '#—';
    var raw = (typeof ord === 'string') ? ord : (ord.order_number || ord.orderNumber || ord.code || ord.id || '');
    raw = String(raw).trim();
    if (!raw) return '#—';

    // Standard format: #OD-834, OD-834, DI-123, TK-456, RS-789
    var match = raw.match(/^(?:#)?(OD|DI|TK|RS|POS)-(\d{3,4})\b/i);
    if (match) {
      var prefix = match[1].toUpperCase();
      if (prefix === 'POS') prefix = 'TK';
      return '#' + prefix + '-' + match[2];
    }

    // Fallback for legacy format: derive prefix from order type + 3 digits
    var type = (typeof ord === 'object' && ord !== null) ? (ord.order_type || ord.fulfillment_type || '') : '';
    var pfx = 'TK';
    if (type === 'delivery') pfx = 'OD';
    else if (type === 'dine_in') pfx = 'DI';
    else if (type === 'reservation') pfx = 'RS';

    var digits = raw.replace(/\D/g, '');
    var num = digits.length >= 3 ? digits.slice(-3) : ((digits + '100').slice(0, 3));
    return '#' + pfx + '-' + num;
  }
  window.formatBMOrderCode = formatBMOrderCode;

  function formatBMItemModifiers(it) {
    if (!it) return '';
    var raw = it.modifiers_snapshot || it.modifiers || it.options;
    if (!raw) return '';
    try {
      var parsed = (typeof raw === 'string') ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) {
        return parsed.map(function (m) {
          if (typeof m === 'string') return m;
          var title = (m.group_name ? (m.group_name + ': ') : '') + (m.name || m.title || m.option_name || '');
          if (m.price && Number(m.price) > 0) title += ' (+' + formatMoney(m.price) + ')';
          return title;
        }).filter(Boolean).join(', ');
      } else if (typeof parsed === 'object' && parsed !== null) {
        var parts = [];
        Object.keys(parsed).forEach(function (k) {
          var v = parsed[k];
          if (Array.isArray(v)) {
            parts.push(k + ': ' + v.map(function (x) { return x.name || x.title || x; }).join(', '));
          } else if (typeof v === 'object' && v !== null) {
            parts.push((v.group_name || k) + ': ' + (v.name || v.title || JSON.stringify(v)));
          } else if (v) {
            parts.push(k + ': ' + v);
          }
        });
        return parts.join(', ');
      }
    } catch (e) {}
    return (typeof raw === 'string' && raw.length < 80) ? raw : '';
  }

  function populateBMAcceptOrderUI(ord) {
    if (!ord) return;

    var numEl = $('bm-accept-order-number');
    var badgeEl = $('bm-accept-order-type-badge');
    var custEl = $('bm-accept-order-customer');
    var totalEl = $('bm-accept-order-total');
    var itemsEl = $('bm-accept-order-items-preview');
    var itemsCountEl = $('bm-accept-order-items-count');
    var noteBox = $('bm-accept-order-note-box');
    var noteTextEl = $('bm-accept-order-note-text');
    var subtotalEl = $('bm-accept-order-subtotal');
    var delivRow = $('bm-accept-order-delivery-row');
    var delivFeeEl = $('bm-accept-order-delivery-fee');
    var discRow = $('bm-accept-order-discount-row');
    var discEl = $('bm-accept-order-discount');

    if (numEl) {
      numEl.textContent = formatBMOrderCode(ord);
    }

    if (badgeEl) {
      var ordType = (ord.order_type || ord.fulfillment_type) || 'delivery';
      var typeLabel = 'Pesanan Masuk';
      var badgeCls = 'background:#e0f2fe; color:#0369a1;';
      if (ordType === 'delivery') {
        typeLabel = '🛵 Delivery';
        badgeCls = 'background:#e0f2fe; color:#0369a1;';
      } else if (ordType === 'dine_in') {
        typeLabel = '🍽️ Dine-in' + (ord.table_number ? (' (Meja ' + ord.table_number + ')') : '');
        badgeCls = 'background:#fef3c7; color:#b45309;';
      } else if (ordType === 'pickup' || ordType === 'takeaway') {
        typeLabel = '🛍️ Takeaway';
        badgeCls = 'background:#f3e8ff; color:#7e22ce;';
      } else if (ordType === 'reservation') {
        typeLabel = '📅 Reservasi Meja';
        badgeCls = 'background:#fce7f3; color:#be185d;';
      }
      badgeEl.textContent = typeLabel;
      badgeEl.setAttribute('style', 'font-size:11px; font-weight:700; padding:3px 8px; border-radius:8px; ' + badgeCls);
    }

    if (custEl) {
      var custText = ord.customer_name ? ord.customer_name : 'Pelanggan';
      if (ord.customer_phone) {
        custText += ' (' + ord.customer_phone + ')';
      }
      if (ord.table_number && ord.order_type !== 'dine_in') {
        custText += ' • Meja ' + ord.table_number;
      }
      custEl.textContent = custText;
    }

    // Detail Daftar Menu & Isinya
    var items = Array.isArray(ord.items) ? ord.items : [];
    if (itemsCountEl) itemsCountEl.textContent = items.length + ' menu';

    if (itemsEl) {
      if (items.length) {
        itemsEl.innerHTML = items.map(function (it) {
          var qty = Number(it.quantity || 1);
          var name = esc(it.product_name || it.title || 'Item Menu');
          var itemSub = (it.item_subtotal != null) ? Number(it.item_subtotal) :
                        ((it.subtotal != null) ? Number(it.subtotal) :
                        (Number(it.unit_price || it.price || 0) * qty));
          var modText = esc(formatBMItemModifiers(it));
          var itemNote = esc(String(it.note || it.notes || '').trim());

          var html = '<div style="padding-bottom:6px; border-bottom:1px solid #f1f5f9;">' +
            '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">' +
              '<span style="font-size:13px; font-weight:700; color:#0f172a; line-height:1.4;">' +
                '<span style="color:#16a34a; margin-right:4px;">' + qty + 'x</span> ' + name +
              '</span>' +
              '<span style="font-size:12.5px; font-weight:700; color:#334155; white-space:nowrap;">' + formatMoney(itemSub) + '</span>' +
            '</div>';

          if (modText) {
            html += '<div style="font-size:11.5px; color:#64748b; margin-top:2px; padding-left:18px; line-height:1.35;">' +
              '🔹 ' + modText +
            '</div>';
          }

          if (itemNote) {
            html += '<div style="margin-top:3px; padding-left:18px;">' +
              '<span style="display:inline-block; font-size:11px; color:#d97706; background:#fffbeb; border:1px solid #fef3c7; border-radius:4px; padding:2px 6px; line-height:1.3;">' +
                '📝 ' + itemNote +
              '</span>' +
            '</div>';
          }

          html += '</div>';
          return html;
        }).join('');
        itemsEl.style.display = 'flex';
      } else {
        itemsEl.innerHTML = '<div style="color:#94a3b8; font-size:12px; text-align:center; padding:10px 0;">Tidak ada rincian item menu</div>';
        itemsEl.style.display = 'block';
      }
    }

    // Catatan Keseluruhan Pemesan
    var ordNote = String(ord.order_note || ord.notes || ord.order_notes || '').trim();
    if (noteBox && noteTextEl) {
      if (ordNote) {
        noteTextEl.textContent = ordNote;
        noteBox.style.display = 'block';
      } else {
        noteBox.style.display = 'none';
      }
    }

    // Subtotal, Ongkir, Diskon & Total Bersih
    var subtotalVal = (ord.subtotal != null) ? Number(ord.subtotal) :
                      items.reduce(function (s, it) { return s + (Number(it.item_subtotal || it.subtotal || 0) || (Number(it.unit_price || 0) * Number(it.quantity || 1))); }, 0);
    if (subtotalEl) subtotalEl.textContent = formatMoney(subtotalVal);

    var delivFee = (ord.delivery_fee != null) ? Number(ord.delivery_fee) : 0;
    if (delivRow && delivFeeEl) {
      if (delivFee > 0) {
        delivFeeEl.textContent = formatMoney(delivFee);
        delivRow.style.display = 'flex';
      } else {
        delivRow.style.display = 'none';
      }
    }

    var discountVal = (ord.discount_amount != null) ? Number(ord.discount_amount) : 0;
    if (discRow && discEl) {
      if (discountVal > 0) {
        discEl.textContent = '-' + formatMoney(discountVal);
        discRow.style.display = 'flex';
      } else {
        discRow.style.display = 'none';
      }
    }

    if (totalEl) {
      totalEl.textContent = (ord.grand_total != null) ? formatMoney(ord.grand_total) : formatMoney(subtotalVal + delivFee - discountVal);
    }
  }

  async function openBMAcceptOrderModal(orderId, btnEl, origin) {
    _bmAcceptContext = {
      orderId: orderId,
      btnEl: btnEl || null,
      origin: origin || 'orders'
    };

    var modal = $('modal-bm-accept-order');
    var btnConfirm = $('btn-bm-accept-confirm');
    var btnText = $('btn-bm-accept-text');
    var itemsEl = $('bm-accept-order-items-preview');

    if (btnConfirm) btnConfirm.disabled = false;
    if (btnText) btnText.textContent = 'Terima Pesanan';

    var ord = findBMOrderById(orderId);

    if (ord) {
      populateBMAcceptOrderUI(ord);
    } else {
      if (itemsEl) {
        itemsEl.innerHTML = '<div style="color:#64748b; font-size:12px; text-align:center; padding:12px 0;">Memuat rincian pesanan...</div>';
      }
    }

    if (modal) modal.style.display = 'flex';
    if (window.XentraNav && typeof window.XentraNav.push === 'function') {
      window.XentraNav.push(function () { closeBMAcceptOrderModal({ fromNav: true }); }, 'modal-bm-accept-order');
    }

    // Always fetch fresh authoritative items from API if missing or items array empty
    if (!ord || !Array.isArray(ord.items) || !ord.items.length) {
      try {
        var res = await adminFetch(API_BASE + '/admin/orders/' + encodeURIComponent(orderId), {
          headers: getAuthHeaders()
        });
        if (res && res.ok) {
          var data = await res.json();
          if (data && data.success && data.order) {
            var freshOrder = data.order;
            if (!_bmOrdersState.orders) _bmOrdersState.orders = [];
            var exIdx = _bmOrdersState.orders.findIndex(function (o) { return String(o.id) === String(orderId); });
            if (exIdx >= 0) {
              _bmOrdersState.orders[exIdx] = freshOrder;
            } else {
              _bmOrdersState.orders.push(freshOrder);
            }
            if (_bmAcceptContext && String(_bmAcceptContext.orderId) === String(orderId)) {
              populateBMAcceptOrderUI(freshOrder);
            }
          }
        }
      } catch (err) {
        console.warn('[BM Accept Modal] Fetch order detail error:', err);
      }
    }
  }
  window.openBMAcceptOrderModal = openBMAcceptOrderModal;

  function closeBMAcceptOrderModal(options) {
    options = options || {};
    var modal = $('modal-bm-accept-order');
    if (modal) modal.style.display = 'none';
    _bmAcceptContext = null;
    if (!options.fromNav && window.XentraNav && window.XentraNav.hasOpen('modal-bm-accept-order')) {
      window.XentraNav.pop('modal-bm-accept-order');
    }
  }
  window.closeBMAcceptOrderModal = closeBMAcceptOrderModal;

  async function confirmBMAcceptOrderSubmit() {
    if (!_bmAcceptContext || !_bmAcceptContext.orderId) {
      closeBMAcceptOrderModal();
      return;
    }

    var orderId = _bmAcceptContext.orderId;
    var btnEl = _bmAcceptContext.btnEl;
    var origin = _bmAcceptContext.origin;
    var btnConfirm = $('btn-bm-accept-confirm');
    var btnText = $('btn-bm-accept-text');

    if (_bmOrdersState.inFlightAccept[orderId]) return;
    _bmOrdersState.inFlightAccept[orderId] = true;

    if (btnConfirm) btnConfirm.disabled = true;
    if (btnText) btnText.textContent = 'Memproses...';
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.dataset.originalText = btnEl.innerHTML;
      btnEl.innerHTML = 'Memproses...';
    }

    try {
      var res = await adminFetch(API_BASE + "/orders/" + encodeURIComponent(orderId) + "/branch-acceptance", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ decision: "accept", note: "Diterima melalui Merchant App" })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        if (window.XentraAudio && typeof window.XentraAudio.orderAccepted === 'function') {
          window.XentraAudio.orderAccepted();
        } else if (window.XentraAudio && typeof window.XentraAudio.stopOrderAlert === 'function') {
          window.XentraAudio.stopOrderAlert();
        }
        if (window.XentraPrinter && window.XentraPrinter.isNative() && window.XentraPrinter.isAutoPrintEnabled()) {
          var matchedOrd = findBMOrderById(orderId);
          var u = getStoredUser();
          if (matchedOrd) {
            window.XentraPrinter.printOrder(matchedOrd, { name: (u && u.brand_name) || 'Mybangjo Resto', branch: u && u.branch_name });
          }
        }
        var acceptedOrd = findBMOrderById(orderId);
        showToast("Pesanan " + formatBMOrderCode(acceptedOrd || orderId) + " berhasil diterima.");
        closeBMAcceptOrderModal();
        if (typeof loadHariIni === 'function') loadHariIni();
        if (typeof loadBMOrders === 'function') loadBMOrders();
        var detailView = $('bm-orders-detail-view');
        if (detailView && detailView.style.display !== 'none' && _bmOrdersState.currentDetailOrderId === orderId) {
          viewBMOrderDetail(orderId);
        }
      } else {
        showToast("Gagal menerima pesanan: " + (data.error || "Terjadi kesalahan"));
        if (btnConfirm) btnConfirm.disabled = false;
        if (btnText) btnText.textContent = 'Terima Pesanan';
        if (btnEl) {
          btnEl.disabled = false;
          if (btnEl.dataset.originalText) btnEl.innerHTML = btnEl.dataset.originalText;
        }
      }
    } catch (e) {
      showToast("Kesalahan jaringan.");
      if (btnConfirm) btnConfirm.disabled = false;
      if (btnText) btnText.textContent = 'Terima Pesanan';
      if (btnEl) {
        btnEl.disabled = false;
        if (btnEl.dataset.originalText) btnEl.innerHTML = btnEl.dataset.originalText;
      }
    } finally {
      delete _bmOrdersState.inFlightAccept[orderId];
    }
  }
  window.confirmBMAcceptOrderSubmit = confirmBMAcceptOrderSubmit;

  function quickAcceptBMOrder(orderId, btnEl) {
    openBMAcceptOrderModal(orderId, btnEl, 'hari-ini');
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
      if (document.visibilityState === 'hidden' && !window.IS_NATIVE_APP) return;
      loadBMOrders({ background: true });
    }, 10000);
  }

  window.startBMOrdersPolling = startBMOrdersPolling;
  window.stopBMOrdersPolling = stopBMOrdersPolling;

  // Browser-local audible chime for genuinely new pending orders (Web Audio API synthesis)
  // Fails gracefully if browser autoplay policy blocks un-interacted audio without spamming errors
  function playNewOrderAudibleChime() {
    if (window.XentraAudio && typeof window.XentraAudio.orderReceived === 'function') {
      window.XentraAudio.orderReceived({ text: 'Ada pesanan baru masuk!' });
      return;
    }
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
  window.playNewOrderAudibleChime = playNewOrderAudibleChime;

  function showSystemOrderNotification(ord) {
    // In Native Android App, native Java OrderMonitorService handles notification & deep linking!
    if (window.IS_NATIVE_APP) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!navigator.serviceWorker) return;

    var typeMap = {
      delivery: 'Delivery',
      pickup: 'Pickup',
      dine_in: 'Dine-in',
      reservation: 'Reservasi'
    };
    var typeStr = typeMap[ord.order_type] || 'Pesanan';
    var number = formatBMOrderCode(ord);
    var customer = ord.customer_name || 'Pelanggan';
    var totalStr = (typeof formatMoney === 'function') ? formatMoney(ord.grand_total) : ('Rp ' + (ord.grand_total || 0));
    var tableStr = (ord.table_name || ord.table_number) ? (' · Meja ' + (ord.table_name || ord.table_number)) : '';

    var title = '🔔 Pesanan Masuk! ' + number;
    var body = typeStr + tableStr + ' · ' + customer + ' · ' + totalStr;
    var token = localStorage.getItem('xentra_merchant_token') || '';

    // Aggressive attention vibration pattern: buzz-pause-buzz-pause-long buzz-pause-long buzz
    var aggressiveVibratePattern = [500, 250, 500, 250, 1000, 250, 1000];
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(aggressiveVibratePattern);
      } catch (_) {}
    }

    navigator.serviceWorker.ready.then(function (reg) {
      reg.showNotification(title, {
        body: body,
        icon: '/merchant-app/assets/icons/icon-192.png',
        badge: '/merchant-app/assets/icons/icon-192.png',
        tag: 'order-pending-' + ord.id,
        renotify: true,
        requireInteraction: true,
        silent: true, // Keep notification silent so device ringtone does not clash with MP3 voice alert
        vibrate: aggressiveVibratePattern,
        timestamp: Date.now(),
        actions: [
          { action: 'accept', title: '✓ Terima Pesanan' },
          { action: 'view', title: 'Buka Detail' }
        ],
        data: {
          orderId: ord.id,
          orderNumber: ord.order_number || ord.id,
          token: token,
          url: '/merchant-app/#pesanan'
        }
      }).catch(function (err) {
        console.warn('[Show notification failed]:', err);
      });
    });
  }

  var _lastOrderAlertTriggerTime = 0;

  function checkAndNotifyNewPendingOrders(orders) {
    if (!Array.isArray(orders)) return;
    var currentPendingOrders = orders.filter(function (o) { return o.status === 'pending'; });
    var currentPendingIds = {};
    currentPendingOrders.forEach(function (o) { currentPendingIds[o.id] = true; });

    var seen = _bmOrdersState.seenPendingOrderIds || window.__xentraSeenPendingOrderIds;
    if (seen !== null && seen !== undefined) {
      var newlyAppeared = [];
      currentPendingOrders.forEach(function (o) {
        if (!seen[o.id]) {
          newlyAppeared.push(o.id);
        }
      });

      // Commit to seen set immediately to prevent concurrent polling races from double-alerting
      currentPendingOrders.forEach(function (o) {
        seen[o.id] = true;
      });
      _bmOrdersState.seenPendingOrderIds = currentPendingIds;
      window.__xentraSeenPendingOrderIds = currentPendingIds;

      if (newlyAppeared.length > 0) {
        newlyAppeared.forEach(function (id) {
          _bmOrdersState.newPendingOrderIds[id] = true;
          var matchedOrder = currentPendingOrders.find(function (o) { return o.id === id; });
          if (matchedOrder) {
            showSystemOrderNotification(matchedOrder);
          }
        });

        var now = Date.now();
        if (now - _lastOrderAlertTriggerTime > 2500) {
          _lastOrderAlertTriggerTime = now;
          playNewOrderAudibleChime();
        }
      }
    } else {
      _bmOrdersState.newPendingOrderIds = {};
      _bmOrdersState.seenPendingOrderIds = currentPendingIds;
      window.__xentraSeenPendingOrderIds = currentPendingIds;
      // If there are unconfirmed pending orders already waiting on startup, alert immediately
      if (currentPendingOrders.length > 0) {
        currentPendingOrders.forEach(function (o) {
          _bmOrdersState.newPendingOrderIds[o.id] = true;
        });
        playNewOrderAudibleChime();
      }
    }

    Object.keys(_bmOrdersState.newPendingOrderIds).forEach(function (id) {
      if (!currentPendingIds[id]) {
        delete _bmOrdersState.newPendingOrderIds[id];
      }
    });

    if (currentPendingOrders.length === 0) {
      if (window.XentraAudio && typeof window.XentraAudio.stopOrderAlert === 'function') {
        window.XentraAudio.stopOrderAlert();
      }
    }

    _bmOrdersState.seenPendingOrderIds = currentPendingIds;
    window.__xentraSeenPendingOrderIds = currentPendingIds;
  }
  window.checkAndNotifyNewPendingOrders = checkAndNotifyNewPendingOrders;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'ORDER_ACCEPTED_FROM_NOTIFICATION') {
        if (window.XentraAudio && typeof window.XentraAudio.orderAccepted === 'function') {
          window.XentraAudio.orderAccepted();
        }
        if (typeof loadBMOrders === 'function') loadBMOrders({ background: true });
        if (typeof loadHariIni === 'function') loadHariIni();
      } else if (event.data && event.data.type === 'NAVIGATE_TO_ORDER' && event.data.orderId) {
        if (typeof viewBMOrderDetail === 'function') {
          viewBMOrderDetail(event.data.orderId);
        }
      } else if (event.data && event.data.type === 'NEW_ORDER_PUSH_RECEIVED') {
        if (typeof loadBMOrders === 'function') loadBMOrders({ background: true });
        if (typeof loadHariIniOrders === 'function') loadHariIniOrders({ background: true });
        if (typeof fetchActionableOrdersCount === 'function') fetchActionableOrdersCount();
      }
    });
  }

  function formatBMTimeRemaining(ms) {
    if (ms <= 0) return '00:00';
    var totalSec = Math.floor(ms / 1000);
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }

  async function loadBMOrders(opts) {
    var user = getStoredUser();
    var branchId = (typeof window.getBMTargetBranchId === 'function' ? window.getBMTargetBranchId() : null) || (user ? (user.branch_id || user.branchId) : null);
    if (!branchId) return;

    var isBg = opts && opts.background;
    var tbody = $('bm-orders-tbody');
    var cardsContainer = $('bm-orders-cards-container');
    if (tbody && !isBg && (!_bmOrdersState.orders || !_bmOrdersState.orders.length)) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-muted">Memuat antrean pesanan...</td></tr>';
    }
    if (cardsContainer && !isBg && (!_bmOrdersState.orders || !_bmOrdersState.orders.length)) {
      cardsContainer.innerHTML = '<div class="text-center py-6 text-muted">Memuat antrean pesanan...</div>';
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
        checkAndNotifyNewPendingOrders(data.orders);
        _bmOrdersState.orders = data.orders;

        renderBMOrdersFeed();
        if (typeof applyHariIniOrders === 'function') {
          applyHariIniOrders(data.orders);
        }
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
        projection.actionLabel = 'Selesaikan Pesanan';
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
      var pay = getBMOrderPaymentState(ord);
      if (pay.key !== 'paid') {
        projection.stateLabel = 'Menunggu pembayaran';
        projection.attention = true;
      } else {
        projection.stateLabel = 'Pesanan selesai';
        projection.muted = true;
      }
    } else if (['cancelled', 'rejected', 'timeout', 'fulfillment_exception'].indexOf(status) !== -1) {
      if (status === 'rejected') {
        projection.stateLabel = 'Ditolak';
        projection.actionLabel = 'Lihat Info Ditolak';
        projection.actionType = 'rejected_info';
        projection.attention = false;
        projection.muted = false;
      } else {
        projection.stateLabel = status === 'fulfillment_exception' ? 'Perlu penanganan' : 'Tidak dilanjutkan';
        projection.muted = status !== 'fulfillment_exception';
        projection.attention = status === 'fulfillment_exception';
      }
    }

    return projection;
  }

  function renderBMOrderStatusPill(projection) {
    var cls = projection.attention ? 'attention' : (projection.muted ? 'muted' : 'neutral');
    if (projection.actionType === 'rejected_info') {
      cls = 'danger';
    }
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

  function getBMOrderItemTitle(item) {
    if (!item) return 'Item';
    var snapshot = item.menu_snapshot;
    if (typeof snapshot === 'string') {
      try { snapshot = JSON.parse(snapshot); } catch (_) { snapshot = null; }
    }
    return (snapshot && (snapshot.title || snapshot.package_name)) ||
      item.product_name ||
      (item.menu_id ? ('Menu ' + item.menu_id) : '') ||
      item.product_id ||
      'Item';
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
    var sortNow = Date.now();
    visible.sort(function (a, b) {
      var aNew = a.order.status === 'pending' && !!_bmOrdersState.newPendingOrderIds[a.order.id];
      var bNew = b.order.status === 'pending' && !!_bmOrdersState.newPendingOrderIds[b.order.id];
      if (aNew !== bNew) return aNew ? -1 : 1;

      var aReservationMs = getBMReservationScheduleMs(a.order);
      var bReservationMs = getBMReservationScheduleMs(b.order);
      var aIsUpcomingReservation = !isNaN(aReservationMs) && aReservationMs >= sortNow;
      var bIsUpcomingReservation = !isNaN(bReservationMs) && bReservationMs >= sortNow;

      if (a.projection.attention !== b.projection.attention) return a.projection.attention ? -1 : 1;

      if (aIsUpcomingReservation && bIsUpcomingReservation) {
        if (aReservationMs !== bReservationMs) return aReservationMs - bReservationMs;
      }
      if (aIsUpcomingReservation !== bIsUpcomingReservation) {
        return aIsUpcomingReservation ? -1 : 1;
      }

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

    // Synchronize bottom navigation badge with total actionable orders
    var totalAttentionOrders = (_bmOrdersState.orders || []).filter(function (ord) {
      var proj = getBMOrderProjection(ord);
      return proj.attention || Number(ord.pending_additions_count || 0) > 0;
    });
    if (typeof updateMobileOrdersBadge === 'function') {
      updateMobileOrdersBadge(totalAttentionOrders.length);
    }

    if (!visible.length) {
      var emptyTitle = _bmOrdersState.queueView === 'attention' ? 'Tidak ada pesanan menunggu.' : 'Belum ada pesanan.';
      var emptySub = _bmOrdersState.queueView === 'attention'
        ? 'Semua pesanan saat ini sudah ditangani.'
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
      var typeLabel = type === 'dine_in' ? 'Dine-in' : (type === 'pickup' ? 'Pickup' : (type === 'delivery' ? 'Delivery' : 'RESERVASI'));
      var typeClass = 'type-' + type.replace('_', '-');
      var number = formatBMOrderCode(ord);
      var reservationGuests = type === 'reservation' ? getBMReservationGuestCount(ord) : 0;
      var reservationInfo = type === 'reservation'
        ? (formatBMReservationDateTime(ord) + (reservationGuests ? ' · ' + reservationGuests + ' tamu' : ''))
        : '';
      var location = type === 'dine_in'
        ? (ord.table_number ? 'Meja ' + ord.table_number : 'Makan di tempat')
        : (type === 'reservation'
          ? (reservationInfo || ((ord.reservation_time || (ord.scheduled_slot_start || '').substring(11, 16) || '—') + (reservationGuests ? ' · ' + reservationGuests + ' tamu' : '')))
          : type === 'pickup' ? 'Pickup' : 'Pengantaran');
      var itemCount = (ord.items || []).reduce(function (sum, i) { return sum + (Number(i.quantity) || 0); }, 0);
      var preview = (ord.items || []).slice(0, 2).map(function (i) {
        return esc(getBMOrderItemTitle(i)) + ' ×' + (Number(i.quantity) || 0);
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
        primary = '<button type="button" class="bm-order-primary-action" onclick="event.stopPropagation(); viewBMOrderDetail(\'' + esc(ord.id) + '\')">Tinjau tambahan +' + pendingAdditions + '</button>';
      } else if (p.actionType === 'accept') {
        if (type === 'reservation') {
          primary = '<button type="button" class="bm-order-primary-action" onclick="event.stopPropagation(); advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'pending\', \'reservation\', this)">Konfirmasi</button>';
        } else {
          primary = '<button type="button" class="bm-order-primary-action" onclick="event.stopPropagation(); advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'pending\', \'' + esc(type) + '\', this)">Terima</button>';
        }
      } else if (p.actionType === 'reservation_checkin') {
        primary = '<button type="button" class="bm-order-primary-action" onclick="event.stopPropagation(); checkInBMReservation(\'' + esc(ord.id) + '\')">Check-in</button>';
      } else if (p.actionType === 'advance') {
        primary = '<button type="button" class="bm-order-primary-action" onclick="event.stopPropagation(); advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'';
        primary += esc(String(ord.status)) + '\', \'';
        primary += esc(type) + '\', this)">' + esc(p.actionLabel || 'Lanjutkan') + '</button>';
      } else if (p.actionType === 'rejected_info') {
        primary = '<button type="button" class="bm-order-primary-action" style="background:#fff1f2; color:#be123c; border:1px solid #fecdd3; font-weight:800;" onclick="event.stopPropagation(); openBMRejectedInfoModal(\'' + esc(ord.id) + '\')">Lihat Info Ditolak</button>';
      }

      var actionsHtml = primary
        ? '<div class="bm-order-feed-actions">' + primary + '</div>'
        : '';

      return '<article class="bm-order-feed-card' + attentionClass + '" data-order-id="' + esc(ord.id) + '" style="cursor:pointer;" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">' +
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
        actionsHtml +
      '</article>';
    }).join('');
  }


  async function advanceBMOrderStatus(orderId, currentStatus, fulfillmentType, btnEl) {
    if (currentStatus === 'pending') {
      openBMAcceptOrderModal(orderId, btnEl, 'orders');
      return;
    }

    var isDelivery = (fulfillmentType === 'delivery');
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

    _bmOrdersState.inFlightStatus = _bmOrdersState.inFlightStatus || {};
    if (_bmOrdersState.inFlightStatus[orderId]) return;
    _bmOrdersState.inFlightStatus[orderId] = true;

    if (btnEl) {
      btnEl.disabled = true;
      btnEl.dataset.originalText = btnEl.innerHTML;
      btnEl.innerHTML = 'Menyimpan...';
    }

    try {
      var patchRes = await adminFetch(API_BASE + '/kitchen/orders/' + encodeURIComponent(orderId) + '/status', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: nextStatus, note: 'Status diperbarui' })
      });
      var patchData = await patchRes.json();
      if (patchRes.ok && patchData.success) {
        showToast('Status pesanan diperbarui.');
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

    var ord = findBMOrderById(orderId);

    if (idInput) idInput.value = orderId;
    if (reasonInput) reasonInput.value = '';
    if (errorEl) errorEl.style.display = 'none';
    if (subtitle) {
      var subText = formatBMOrderCode(ord);
      if (ord && ord.customer_name) subText += ' • ' + ord.customer_name;
      subtitle.textContent = subText;
    }
    if (btnText) btnText.textContent = 'Tolak Pesanan';
    if (confirmBtn) confirmBtn.disabled = false;

    // Reset active chip state
    var chips = document.querySelectorAll('.bm-reject-chip');
    if (chips) {
      chips.forEach(function (c) { c.classList.remove('is-active'); });
    }

    if (modal) modal.style.display = 'flex';
    if (window.XentraNav && typeof window.XentraNav.push === 'function') {
      window.XentraNav.push(function () { closeBMRejectModal({ fromNav: true }); }, 'modal-bm-reject-order');
    }
    if (reasonInput) setTimeout(function () { reasonInput.focus(); }, 80);
  }
  window.openBMRejectModal = openBMRejectModal;

  function closeBMRejectModal(options) {
    options = options || {};
    var modal = $('modal-bm-reject-order');
    if (modal) modal.style.display = 'none';
    var idInput = $('bm-reject-order-id');
    if (idInput) idInput.value = '';
    if (!options.fromNav && window.XentraNav && window.XentraNav.hasOpen('modal-bm-reject-order')) {
      window.XentraNav.pop('modal-bm-reject-order');
    }
  }
  window.closeBMRejectModal = closeBMRejectModal;

  function setBMRejectReason(reasonText, chipEl) {
    var reasonInput = $('bm-reject-reason-input');
    var errorEl = $('bm-reject-error');
    if (reasonInput) {
      reasonInput.value = reasonText;
      reasonInput.focus();
    }
    if (errorEl) errorEl.style.display = 'none';
    var chips = document.querySelectorAll('.bm-reject-chip');
    if (chips) {
      chips.forEach(function (c) { c.classList.remove('is-active'); });
    }
    if (chipEl && chipEl.classList) chipEl.classList.add('is-active');
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
        if (window.XentraAudio && typeof window.XentraAudio.orderRejected === 'function') {
          window.XentraAudio.orderRejected();
        } else if (window.XentraAudio && typeof window.XentraAudio.stopOrderAlert === 'function') {
          window.XentraAudio.stopOrderAlert();
        }
        var rejectedOrd = findBMOrderById(orderId) || (data && data.order) || { id: orderId };
        var formattedCode = formatBMOrderCode(rejectedOrd);
        showToast('Pesanan ' + formattedCode + ' telah ditolak.');
        closeBMRejectModal({ fromNav: true });
        if (_bmRejectOrigin === 'hari-ini' && typeof loadHariIni === 'function') {
          loadHariIni();
        }
        loadBMOrders();
        var detailView = $('bm-orders-detail-view');
        if (detailView && detailView.style.display !== 'none' && $('bm-detail-order-number')) {
          viewBMOrderDetail(orderId);
        }
        // Tampilkan Jendela Informasi Pesanan Ditolak Senada Merah Pink Warning
        setTimeout(function () {
          openBMRejectedInfoModal(orderId, reason, rejectedOrd);
        }, 50);
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

  function populateBMRejectedInfoUI(ord, reason) {
    if (!ord) return;
    var numEl = $('bm-rejected-info-number');
    var badgeEl = $('bm-rejected-info-type-badge');
    var custEl = $('bm-rejected-info-customer');
    var reasonEl = $('bm-rejected-info-reason');
    var countEl = $('bm-rejected-info-items-count');
    var itemsEl = $('bm-rejected-info-items-preview');
    var totalEl = $('bm-rejected-info-total');

    if (numEl) numEl.textContent = formatBMOrderCode(ord);

    var ordType = getBMOrderType(ord);
    var typeLabel = ordType === 'dine_in' ? 'Dine In' :
                    (ordType === 'pickup' ? 'Pickup' :
                    (ordType === 'reservation' ? 'Reservasi' : 'Delivery'));
    if (badgeEl) badgeEl.textContent = typeLabel.toUpperCase();

    var custText = ord.customer_name || 'Pelanggan';
    if (ordType === 'dine_in') {
      var tbl = ord.table_number || ord.table_name;
      if (tbl) custText += ' • Meja ' + tbl;
    }
    if (custEl) custEl.textContent = custText;

    if (reasonEl) reasonEl.textContent = reason || ord.rejection_reason || 'Ditolak oleh resto';

    var items = ord.items || [];
    if (countEl) countEl.textContent = items.length + ' menu';

    if (itemsEl) {
      if (items.length) {
        itemsEl.innerHTML = items.map(function (it) {
          var itemTitle = getBMOrderItemTitle(it);
          var itemQty = Number(it.quantity || 1);
          var itemSub = (it.item_subtotal != null) ? Number(it.item_subtotal) :
                        ((it.subtotal != null) ? Number(it.subtotal) :
                        (Number(it.unit_price || 0) * itemQty));
          var modText = formatBMItemModifiers(it);
          var itemNote = (it.note || it.notes || '').trim();

          var html = '<div style="background:#ffffff; border:1px solid #fecdd3; border-radius:8px; padding:7px 9px;">' +
            '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">' +
              '<span style="font-size:13px; font-weight:800; color:#0f172a; line-height:1.35;">' +
                '<span style="color:#e11d48; margin-right:4px;">' + itemQty + 'x</span>' + esc(itemTitle) +
              '</span>' +
              '<span style="font-size:12.5px; font-weight:800; color:#be123c; white-space:nowrap;">' + formatMoney(itemSub) + '</span>' +
            '</div>';

          if (modText) {
            html += '<div style="font-size:11.5px; color:#64748b; margin-top:2px; padding-left:18px; line-height:1.35;">' +
              '🔹 ' + modText +
            '</div>';
          }

          if (itemNote) {
            html += '<div style="margin-top:3px; padding-left:18px;">' +
              '<span style="display:inline-block; font-size:11px; color:#be123c; background:#fff1f2; border:1px solid #fecdd3; border-radius:4px; padding:2px 6px; line-height:1.3;">' +
                '📝 ' + esc(itemNote) +
              '</span>' +
            '</div>';
          }

          html += '</div>';
          return html;
        }).join('');
        itemsEl.style.display = 'flex';
      } else {
        itemsEl.innerHTML = '<div style="color:#94a3b8; font-size:12px; text-align:center; padding:10px 0;">Tidak ada rincian item menu</div>';
        itemsEl.style.display = 'block';
      }
    }

    if (totalEl) {
      var grandTotal = (ord.grand_total != null) ? Number(ord.grand_total) :
                       items.reduce(function (s, it) { return s + (Number(it.item_subtotal || it.subtotal || 0) || (Number(it.unit_price || 0) * Number(it.quantity || 1))); }, 0);
      totalEl.textContent = formatMoney(grandTotal);
    }
  }

  async function openBMRejectedInfoModal(orderId, reason, ord) {
    var modal = $('modal-bm-rejected-info');
    if (!ord) ord = findBMOrderById(orderId);

    if (!reason && ord) {
      if (Array.isArray(ord.status_logs)) {
        for (var i = ord.status_logs.length - 1; i >= 0; i--) {
          var log = ord.status_logs[i];
          if (log.new_status === 'rejected' && log.note) {
            reason = String(log.note).replace(/^\[REJECT by [^\]]+\]\s*/, '').trim();
            break;
          }
        }
      }
      if (!reason) reason = ord.rejection_reason || 'Ditolak oleh resto';
    }

    if (ord) {
      populateBMRejectedInfoUI(ord, reason);
    }

    if (modal) modal.style.display = 'flex';
    if (window.XentraNav && typeof window.XentraNav.push === 'function') {
      window.XentraNav.push(function () { closeBMRejectedInfoModal({ fromNav: true }); }, 'modal-bm-rejected-info');
    }

    if (!ord || !Array.isArray(ord.items) || !ord.items.length) {
      try {
        var res = await adminFetch(API_BASE + '/admin/orders/' + encodeURIComponent(orderId), {
          headers: getAuthHeaders()
        });
        if (res && res.ok) {
          var data = await res.json();
          if (data && data.success && data.order) {
            var fresh = data.order;
            if (!_bmOrdersState.orders) _bmOrdersState.orders = [];
            var exIdx = _bmOrdersState.orders.findIndex(function (o) { return String(o.id) === String(orderId); });
            if (exIdx >= 0) _bmOrdersState.orders[exIdx] = fresh;
            else _bmOrdersState.orders.push(fresh);
            populateBMRejectedInfoUI(fresh, reason);
          }
        }
      } catch (err) {
        console.warn('[BM Rejected Info] Fetch error:', err);
      }
    }
  }
  window.openBMRejectedInfoModal = openBMRejectedInfoModal;

  function closeBMRejectedInfoModal(options) {
    options = options || {};
    var modal = $('modal-bm-rejected-info');
    if (modal) modal.style.display = 'none';
    if (!options.fromNav && window.XentraNav && window.XentraNav.hasOpen('modal-bm-rejected-info')) {
      window.XentraNav.pop('modal-bm-rejected-info');
    }
  }
  window.closeBMRejectedInfoModal = closeBMRejectedInfoModal;

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
        var ordObj = findBMOrderById(orderId);
        showToast('Reservasi ' + formatBMOrderCode(ordObj || orderId) + ' berhasil check-in di meja ' + tableNumber + '.');
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
    var ordObj = findBMOrderById(orderId);
    var formattedCode = formatBMOrderCode(ordObj || orderId);
    if (typeof window.showBranchStatusConfirm === 'function') {
      var ok = await window.showBranchStatusConfirm({
        title: 'Tandai Reservasi No-Show?',
        desc: 'Tamu ' + formattedCode + ' tidak hadir pada jadwal yang ditentukan. Status meja akan dikosongkan.',
        iconBg: '#ffedd5',
        iconHtml: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ea580c" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/></svg>',
        badgeText: 'Hanya berhasil setelah grace period berakhir',
        badgeBg: '#fff7ed',
        badgeColor: '#c2410c',
        submitText: 'Tandai No-Show',
        submitBg: '#ea580c',
        cancelText: 'Batal'
      });
      if (!ok) return;
    } else {
      if (!confirm('Tandai reservasi ' + formattedCode + ' sebagai NO-SHOW? Ini hanya berhasil setelah jadwal + grace period.')) return;
    }

    try {
      var res = await adminFetch(API_BASE + '/pos/reservations/' + encodeURIComponent(orderId) + '/no-show', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({})
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Reservasi ' + formattedCode + ' ditandai NO-SHOW.');
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

  async function viewBMOrderDetail(orderId, options) {
    options = options || {};
    _bmOrdersState.currentDetailOrderId = orderId;
    var listView = $('bm-orders-list-view');
    var detailView = $('bm-orders-detail-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';

    if (!options.skipNav && window.XentraNav && typeof window.XentraNav.push === 'function') {
      window.XentraNav.push(function () { closeBMOrderDetail({ fromNav: true }); }, 'order-detail');
    }

    if (_bmOrdersState.detailCountdownTimer) {
      clearInterval(_bmOrdersState.detailCountdownTimer);
      _bmOrdersState.detailCountdownTimer = null;
    }

    if ($('bm-detail-order-number')) $('bm-detail-order-number').textContent = formatBMOrderCode(orderId);
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
      var typeLabel = ordType === 'dine_in' ? 'Dine-in' : (ordType === 'pickup' ? 'Pickup' : (ordType === 'delivery' ? 'Delivery' : 'Reservasi'));
      if ($('bm-detail-order-number')) $('bm-detail-order-number').textContent = formatBMOrderCode(ord);
      if ($('bm-detail-status-badge')) {
        var detailStatusLabel = FulfillmentEnv && typeof FulfillmentEnv.getStatusLabel === 'function'
          ? FulfillmentEnv.getStatusLabel(ordType, ord.status)
          : String(ord.status || '').replace(/_/g, ' ');
        $('bm-detail-status-badge').textContent = detailStatusLabel;
        $('bm-detail-status-badge').className = 'x-badge ' + (['completed', 'ready'].indexOf(ord.status) !== -1 ? 'x-badge-success' : (['rejected', 'cancelled', 'timeout', 'fulfillment_exception'].indexOf(ord.status) !== -1 ? 'x-badge-danger' : 'x-badge-warning'));
      }
      if ($('bm-detail-cust-name')) $('bm-detail-cust-name').textContent = ord.customer_name || 'Pelanggan';
      if ($('bm-detail-cust-phone')) $('bm-detail-cust-phone').textContent = ord.customer_phone || '—';
      if ($('bm-detail-fulfillment-badge')) $('bm-detail-fulfillment-badge').textContent = typeLabel;
      if ($('bm-detail-order-time')) $('bm-detail-order-time').textContent = ord.created_at ? new Date(ord.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—';
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
      var notesCont = $('bm-detail-notes-container');
      var noteVal = ord.notes || ord.order_notes;
      if (notesCont) {
        if (noteVal) {
          notesCont.style.display = 'block';
          if ($('bm-detail-order-notes')) $('bm-detail-order-notes').textContent = noteVal;
        } else {
          notesCont.style.display = 'none';
        }
      }

      var tableNumberEl = $('bm-detail-table-number');
      if (tableNumberEl) {
        if (ord.table_number) {
          tableNumberEl.style.display = 'inline-block';
          tableNumberEl.textContent = '• Meja ' + ord.table_number;
        } else {
          tableNumberEl.style.display = 'none';
        }
      }

      if ($('bm-detail-calc-subtotal')) $('bm-detail-calc-subtotal').textContent = formatMoney(ord.subtotal || 0);
      if ($('bm-detail-calc-delivery')) $('bm-detail-calc-delivery').textContent = formatMoney(ord.delivery_fee || 0);
      if ($('bm-detail-calc-discount')) $('bm-detail-calc-discount').textContent = formatMoney(ord.discount_amount || 0);
      if ($('bm-detail-calc-grandtotal')) $('bm-detail-calc-grandtotal').textContent = formatMoney(ord.grand_total || 0);
      var pay = getBMOrderPaymentState(ord);
      var payMethod = (ord.payment_method || 'Tunai').toUpperCase();
      var payStatusText = pay.key === 'paid' ? 'Lunas' : (pay.key === 'partial' ? 'Sebagian dibayar' : 'Belum dibayar');
      if ($('bm-detail-pay-status')) {
        $('bm-detail-pay-status').textContent = payMethod + ' · ' + payStatusText;
        $('bm-detail-pay-status').style.color = pay.key === 'paid' ? '#16a34a' : (pay.key === 'partial' ? '#d97706' : '#dc2626');
      }

      // Branch Acceptance Countdown
      var acceptanceBanner = $('bm-detail-acceptance-banner');
      var countdownText = $('bm-detail-countdown-text');

      if (acceptanceBanner) {
        if (ord.status === 'pending') {
          acceptanceBanner.style.display = 'block';

          if (!ord.acceptance_deadline_at) {
            if (countdownText) countdownText.textContent = '--:--';
            _bmOrdersState.detailCountdownTimer = setTimeout(function () {
              _bmOrdersState.detailCountdownTimer = null;
              viewBMOrderDetail(ord.id);
            }, 3000);
          } else {
            var expiresAtMs = new Date(ord.acceptance_deadline_at).getTime();
            if (isNaN(expiresAtMs)) {
              if (countdownText) countdownText.textContent = '--:--';
            } else {
              var updateDetailCountdown = function () {
                var diff = expiresAtMs - Date.now();
                if (diff > 0) {
                  if (countdownText) countdownText.textContent = formatBMTimeRemaining(diff);
                } else {
                  if (countdownText) countdownText.textContent = '00:00';
                  if (_bmOrdersState.detailCountdownTimer) {
                    clearInterval(_bmOrdersState.detailCountdownTimer);
                    _bmOrdersState.detailCountdownTimer = null;
                  }
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

      // Rejection Banner (Merah Pink Warning Senada)
      var rejectedBanner = $('bm-detail-rejected-banner');
      var rejectedReasonEl = $('bm-detail-rejected-reason');
      if (rejectedBanner) {
        if (ord.status === 'rejected') {
          rejectedBanner.style.display = 'block';
          var rejReason = '';
          if (Array.isArray(ord.status_logs)) {
            for (var rIdx = ord.status_logs.length - 1; rIdx >= 0; rIdx--) {
              var rLog = ord.status_logs[rIdx];
              if (rLog.new_status === 'rejected' && rLog.note) {
                rejReason = String(rLog.note).replace(/^\[REJECT by [^\]]+\]\s*/, '').trim();
                break;
              }
            }
          }
          if (!rejReason) rejReason = ord.rejection_reason || 'Ditolak oleh resto';
          if (rejectedReasonEl) rejectedReasonEl.textContent = rejReason;
        } else {
          rejectedBanner.style.display = 'none';
        }
      }

      // Render items list
      var itemsContainer = $('bm-detail-items-container') || $('bm-detail-items-tbody');
      if (itemsContainer) {
        var items = ord.items || [];
        if (!items.length) {
          itemsContainer.innerHTML = '<div class="text-center py-4 text-muted" style="font-size:13px;">Tidak ada menu dalam pesanan ini.</div>';
        } else {
          var itemsHtml = items.map(function (it, idx) {
            var sub = it.item_subtotal != null ? it.item_subtotal : ((it.unit_price || 0) * (it.quantity || 1));
            var noteHtml = it.note ? '<div style="font-size:11.5px; color:#d97706; margin-top:2px;">Catatan: ' + esc(it.note) + '</div>' : '';
            var borderStyle = (idx < items.length - 1) ? 'border-bottom:1px solid #f1f5f9;' : '';
            return '<div style="display:flex; justify-content:space-between; align-items:flex-start; padding:8px 0; ' + borderStyle + '">' +
              '<div style="min-width:0; flex:1; padding-right:12px;">' +
                '<div style="display:flex; align-items:baseline; gap:6px;">' +
                  '<span style="font-size:13.5px; font-weight:800; color:#15803d; min-width:22px;">' + (it.quantity || 1) + 'x</span>' +
                  '<span style="font-size:13.5px; font-weight:700; color:var(--text-main);">' + esc(getBMOrderItemTitle(it)) + '</span>' +
                '</div>' +
                noteHtml +
              '</div>' +
              '<div style="text-align:right; flex-shrink:0;">' +
                '<div style="font-size:13.5px; font-weight:700; color:var(--text-main);">' + formatMoney(sub) + '</div>' +
                ((Number(it.quantity || 1) > 1) ? '<div style="font-size:11px; color:var(--text-muted);">@' + formatMoney(it.unit_price || 0) + '</div>' : '') +
              '</div>' +
            '</div>';
          }).join('');

          // Pending Additional Orders
          var pendingAdditions = (ord.additions || []).filter(function (addition) {
            return addition.status === 'pending_acceptance';
          });
          if (pendingAdditions.length) {
            var additionsHtml = pendingAdditions.map(function (addition) {
              var header = '<div style="margin-top:10px; background:#fff7ed; border:1px solid #fed7aa; border-radius:10px; padding:10px 12px;">' +
                '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">' +
                  '<div><strong>Tambahan #' + esc(addition.sequence_no) + '</strong> <span class="x-badge x-badge-warning" style="font-size:10px;">MENUNGGU DITERIMA</span></div>' +
                  '<div style="display:flex; gap:6px;">' +
                    '<button type="button" class="x-btn-primary" style="font-size:11px; padding:4px 8px;" onclick="decideBMOrderAddition(\'' + esc(ord.id) + '\',\'' + esc(addition.id) + '\',\'accept\')">Terima</button>' +
                    '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px; color:#dc2626; border-color:#fecaca;" onclick="decideBMOrderAddition(\'' + esc(ord.id) + '\',\'' + esc(addition.id) + '\',\'reject\')">Tolak</button>' +
                  '</div>' +
                '</div>';
              var subItemsHtml = (addition.items || []).map(function (it) {
                var sub = it.subtotal != null ? it.subtotal : ((it.unit_price || 0) * (it.quantity || 1));
                var noteHtml = it.note ? '<div style="font-size:11px; color:#d97706;">Catatan: ' + esc(it.note) + '</div>' : '';
                return '<div style="display:flex; justify-content:space-between; font-size:12.5px; padding:4px 0;">' +
                  '<div>↳ ' + esc(it.name || it.product_name || it.product_id) + ' x' + (it.quantity || 1) + noteHtml + '</div>' +
                  '<strong>' + formatMoney(sub) + '</strong>' +
                '</div>';
              }).join('');
              return header + subItemsHtml + '</div>';
            }).join('');
            itemsHtml += additionsHtml;
          }

          itemsContainer.innerHTML = itemsHtml;
        }
      }

      // Render status logs
      var logsList = $('bm-detail-logs-list');
      if (logsList) {
        var logs = ord.status_logs || [];
        if (!logs.length) {
          logsList.innerHTML = '<span class="text-muted">Belum ada riwayat status.</span>';
        } else {
          logsList.innerHTML = logs.map(function (l) {
            var time = l.created_at ? new Date(l.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—';
            return '<div style="background:#f8fafc; padding:8px 12px; border-radius:6px; border:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">' +
              '<div><strong>' + esc(l.new_status) + '</strong>' + (l.note ? ' <span class="text-muted">· ' + esc(l.note) + '</span>' : '') + '</div>' +
              '<small class="text-muted">' + time + '</small>' +
            '</div>';
          }).join('');
        }
      }

      // Action buttons in detail
      var topActions = $('bm-detail-actions-top');
      if (topActions) {
        if (ordType === 'reservation' && ord.status === 'confirmed') {
          topActions.style.display = 'flex';
          topActions.innerHTML =
            '<button type="button" class="x-btn-primary" style="flex:1; height:42px; font-size:13.5px; font-weight:700; justify-content:center;" onclick="checkInBMReservation(\'' + esc(ord.id) + '\');">Check-in</button>' +
            '<button type="button" class="x-btn-secondary" style="height:42px; padding:0 16px; font-size:13.5px; color:#dc2626; border-color:#fecaca; justify-content:center;" onclick="noShowBMReservation(\'' + esc(ord.id) + '\');">No-show</button>';
        } else if (ord.status === 'pending') {
          var isAccepting = !!_bmOrdersState.inFlightAccept[ord.id];
          topActions.style.display = 'flex';
          topActions.innerHTML =
            '<button type="button" class="x-btn-primary" style="flex:1; height:42px; font-size:14px; font-weight:700; background:#16a34a; border-color:#16a34a; justify-content:center;" ' + (isAccepting ? 'disabled' : '') + ' onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'pending\', \'' + esc(ordType) + '\', this);">Terima</button>' +
            '<button type="button" class="x-btn-secondary" style="height:42px; padding:0 18px; font-size:14px; font-weight:700; color:#dc2626; border-color:#fecaca; justify-content:center;" ' + (isAccepting ? 'disabled' : '') + ' onclick="rejectBMOrder(\'' + esc(ord.id) + '\');">Tolak</button>';
        } else if (ord.status === 'confirmed' || ord.status === 'preparing') {
          var detailKitchenLabel = ord.status === 'confirmed' ? 'Mulai Masak' : 'Tandai Siap';
          topActions.style.display = 'flex';
          topActions.innerHTML =
            '<button type="button" class="x-btn-primary" style="width:100%; height:42px; font-size:14px; font-weight:700; justify-content:center;" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'' + esc(ord.status) + '\', \'' + esc(ordType) + '\', this);">' +
            detailKitchenLabel + '</button>';
        } else if (ord.status === 'ready') {
          var label = (ordType === 'delivery') ? 'Kirim Pesanan' : 'Selesaikan';
          topActions.style.display = 'flex';
          topActions.innerHTML =
            '<button type="button" class="x-btn-primary" style="width:100%; height:42px; font-size:14px; font-weight:700; background:#16a34a; border-color:#16a34a; justify-content:center;" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'ready\', \'' + esc(ordType) + '\', this);">' + label + '</button>';
        } else if (ord.status === 'out_for_delivery') {
          topActions.style.display = 'flex';
          topActions.innerHTML =
            '<div style="width:100%; text-align:center; padding:10px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; font-size:13px; font-weight:700; color:#1d4ed8;">🚚 Sedang Diantar Kurir</div>';
        } else if (ord.status === 'rejected') {
          topActions.style.display = 'flex';
          topActions.innerHTML =
            '<button type="button" class="x-btn-secondary" style="width:100%; height:42px; font-size:13.5px; font-weight:800; color:#be123c; border:1px solid #fecdd3; background:#fff1f2; justify-content:center; gap:6px; cursor:pointer; border-radius:12px;" onclick="openBMRejectedInfoModal(\'' + esc(ord.id) + '\');">' +
              '<span>Lihat Rincian Penolakan</span>' +
            '</button>';
        } else {
          topActions.style.display = 'none';
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

  function closeBMOrderDetail(options) {
    options = options || {};
    _bmOrdersState.currentDetailOrderId = null;
    if (_bmOrdersState.detailCountdownTimer) {
      clearInterval(_bmOrdersState.detailCountdownTimer);
      _bmOrdersState.detailCountdownTimer = null;
    }
    var listView = $('bm-orders-list-view');
    var detailView = $('bm-orders-detail-view');
    if (detailView) detailView.style.display = 'none';
    if (listView) listView.style.display = 'block';

    if (!options.fromNav && window.XentraNav && window.XentraNav.hasOpen('order-detail')) {
      window.XentraNav.pop('order-detail');
    }
  }
  window.closeBMOrderDetail = closeBMOrderDetail;

  async function decideBMOrderAddition(orderId, additionId, decision) {
    var reason = '';
    if (decision === 'accept') {
      if (typeof window.showBranchStatusConfirm === 'function') {
        var ok = await window.showBranchStatusConfirm({
          title: 'Terima Tambahan Pesanan?',
          desc: 'Item tambahan akan dimasukkan ke pesanan dan stok bahan baku akan dipotong.',
          iconBg: '#dcfce7',
          iconHtml: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
          badgeText: 'Item baru akan masuk ke antrean dapur',
          badgeBg: '#f0fdf4',
          badgeColor: '#15803d',
          submitText: 'Ya, Terima Tambahan',
          submitBg: '#16a34a',
          cancelText: 'Batal'
        });
        if (!ok) return;
      } else {
        if (!confirm('Terima tambahan pesanan ini? Item akan masuk ke pesanan dan stok akan dipotong.')) return;
      }
    } else if (decision === 'reject') {
      if (typeof window.showBranchStatusConfirm === 'function') {
        var ok = await window.showBranchStatusConfirm({
          title: 'Tolak Tambahan Pesanan?',
          desc: 'Tambahan pesanan ini akan dibatalkan.',
          iconBg: '#ffe4e6',
          iconHtml: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e11d48" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
          badgeText: 'Item tambahan tidak akan dimasak',
          badgeBg: '#fff1f2',
          badgeColor: '#be123c',
          submitText: 'Ya, Tolak Tambahan',
          submitBg: '#e11d48',
          cancelText: 'Batal'
        });
        if (!ok) return;
        reason = 'Ditolak oleh resto';
      } else {
        reason = prompt('Alasan penolakan tambahan:') || '';
        if (!reason.trim()) return;
      }
    } else {
      return;
    }

    try {
      var res = await adminFetch(API_BASE + '/orders/' + encodeURIComponent(orderId) + '/additions/' + encodeURIComponent(additionId) + '/branch-acceptance', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ decision: decision, reason: reason })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        if (decision === 'accept' && window.XentraAudio && typeof window.XentraAudio.orderAccepted === 'function') {
          window.XentraAudio.orderAccepted();
        }
        showToast(decision === 'accept' ? 'Tambahan pesanan diterima.' : 'Tambahan pesanan ditolak.');
        loadBMOrders({ background: true });
        if (typeof loadHariIni === 'function') loadHariIni();
        if (_bmOrdersState.currentDetailOrderId === orderId) viewBMOrderDetail(orderId);
      } else {
        showToast((decision === 'accept' ? 'Gagal menerima tambahan: ' : 'Gagal menolak tambahan: ') + (data.error || 'Terjadi kesalahan'));
      }
    } catch (e) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.decideBMOrderAddition = decideBMOrderAddition;

  window.renderBMOrdersTable = renderBMOrdersFeed;

})();
