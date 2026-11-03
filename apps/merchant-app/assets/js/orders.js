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
  function formatRp(val) { return formatMoney(val); }
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
    stageSubfilter: 'all', // 'all' | 'incoming' | 'cooking' | 'ready'
    activeTab: 'in_process', // 'in_process' | 'scheduled' | 'completed' | 'cancelled'
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

    var ordType = (ord.order_type || ord.fulfillment_type) || 'delivery';

    var acceptCustLabelEl = $('bm-accept-order-customer-label');
    if (acceptCustLabelEl) {
      if (ordType === 'dine_in') {
        acceptCustLabelEl.textContent = 'Meja:';
      } else if (ordType === 'reservation') {
        acceptCustLabelEl.textContent = 'Reservasi:';
      } else {
        acceptCustLabelEl.textContent = 'Pelanggan:';
      }
    }

    if (badgeEl) {
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
      var custText = '';
      if (ordType === 'dine_in') {
        var tbl = ord.table_number || ord.table_name;
        custText = tbl ? ('Meja ' + tbl) : 'Makan di Tempat';
        if (ord.customer_name && ord.customer_name !== 'Pelanggan' && ord.customer_name !== 'Guest') {
          custText += ' (' + ord.customer_name + ')';
        }
      } else if (ordType === 'reservation') {
        var tbl = ord.table_number || ord.table_name;
        custText = (tbl ? ('Meja ' + tbl + ' • ') : '') + (ord.customer_name || 'Tamu');
        if (ord.guest_count) custText += ' (' + ord.guest_count + ' Tamu)';
      } else {
        custText = ord.customer_name ? ord.customer_name : 'Pelanggan';
        if (ord.customer_phone) {
          custText += ' (' + ord.customer_phone + ')';
        }
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

    var defaultChip = document.querySelector('#bm-accept-est-chips .est-time-chip[data-mins="20"]');
    if (defaultChip) {
      selectBMAcceptEstMinutes(20, defaultChip);
    }

    var ord = findBMOrderById(orderId);

    if (ord) {
      populateBMAcceptOrderUI(ord);
    } else {
      if (itemsEl) {
        itemsEl.innerHTML = '<div style="color:#64748b; font-size:12px; text-align:center; padding:12px 0;">Memuat rincian pesanan...</div>';
      }
    }

    if (modal) {
      modal.style.removeProperty('display');
      modal.style.display = 'flex';
    }
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
    if (modal) {
      modal.style.display = 'none';
      modal.style.setProperty('display', 'none', 'important');
    }
    _bmAcceptContext = null;
    if (window.XentraAudio && typeof window.XentraAudio.stopOrderAlert === 'function') {
      window.XentraAudio.stopOrderAlert();
    }
    if (!options.fromNav && window.XentraNav && window.XentraNav.hasOpen('modal-bm-accept-order')) {
      window.XentraNav.pop('modal-bm-accept-order');
    }
  }
  window.closeBMAcceptOrderModal = closeBMAcceptOrderModal;

  function rejectFromBMAcceptModal() {
    var orderId = _bmAcceptContext ? _bmAcceptContext.orderId : null;
    var origin = _bmAcceptContext ? _bmAcceptContext.origin : 'orders';
    closeBMAcceptOrderModal();
    if (orderId) {
      openBMRejectModal(orderId, origin);
    }
  }
  window.rejectFromBMAcceptModal = rejectFromBMAcceptModal;

  function selectBMAcceptEstMinutes(mins, btnEl) {
    var input = $('bm-accept-estimated-minutes');
    var label = $('bm-accept-est-label');
    if (input) input.value = String(mins);
    if (label) label.textContent = mins + ' menit';
    var container = $('bm-accept-est-chips');
    if (container) {
      var chips = container.querySelectorAll('.est-time-chip');
      chips.forEach(function (c) {
        c.classList.remove('is-selected');
        c.style.borderColor = '#cbd5e1';
        c.style.background = '#fff';
        c.style.color = '#475569';
        c.style.fontWeight = '700';
      });
    }
    if (btnEl) {
      btnEl.classList.add('is-selected');
      btnEl.style.borderColor = '#16a34a';
      btnEl.style.background = '#f0fdf4';
      btnEl.style.color = '#16a34a';
      btnEl.style.fontWeight = '800';
    }
  }
  window.selectBMAcceptEstMinutes = selectBMAcceptEstMinutes;

  async function confirmBMAcceptOrderSubmit() {
    if (!_bmAcceptContext || !_bmAcceptContext.orderId) {
      closeBMAcceptOrderModal();
      return;
    }

    // Immediately stop order sound alert on Terima tap
    if (window.XentraAudio && typeof window.XentraAudio.stopOrderAlert === 'function') {
      window.XentraAudio.stopOrderAlert();
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

    var estInput = $('bm-accept-estimated-minutes');
    var estMinutes = (estInput && Number(estInput.value)) ? Number(estInput.value) : 20;

    try {
      var res = await adminFetch(API_BASE + "/orders/" + encodeURIComponent(orderId) + "/branch-acceptance", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          decision: "accept",
          estimated_minutes: estMinutes,
          prep_time_minutes: estMinutes,
          note: "Diterima melalui Merchant App"
        })
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
    if (window.XentraAudio && typeof window.XentraAudio.stopOrderAlert === 'function') {
      window.XentraAudio.stopOrderAlert();
    }
    openBMAcceptOrderModal(orderId, btnEl, 'hari-ini');
  }
  window.quickAcceptBMOrder = quickAcceptBMOrder;

  function quickRejectBMOrder(orderId) {
    if (window.XentraAudio && typeof window.XentraAudio.stopOrderAlert === 'function') {
      window.XentraAudio.stopOrderAlert();
    }
    openBMRejectModal(orderId, 'hari-ini');
  }
  window.quickRejectBMOrder = quickRejectBMOrder;

  function stopBMOrdersPolling() {
    if (_bmOrdersState.pollTimer) {
      clearInterval(_bmOrdersState.pollTimer);
      _bmOrdersState.pollTimer = null;
    }
    if (_bmOrdersState.cardsCountdownTimer) {
      clearInterval(_bmOrdersState.cardsCountdownTimer);
      _bmOrdersState.cardsCountdownTimer = null;
    }
  }

  function startBMCardsCountdownTicker() {
    if (_bmOrdersState.cardsCountdownTimer) clearInterval(_bmOrdersState.cardsCountdownTimer);
    _bmOrdersState.cardsCountdownTimer = setInterval(function () {
      var timerEls = document.querySelectorAll('.urgent-timer-bar strong[data-deadline]');
      if (!timerEls || !timerEls.length) return;
      var now = Date.now();
      timerEls.forEach(function (el) {
        var deadline = Number(el.getAttribute('data-deadline') || 0);
        var rem = deadline - now;
        if (rem <= 0) {
          el.textContent = '0:00';
        } else {
          var m = Math.floor(rem / 60000);
          var s = Math.floor((rem % 60000) / 1000);
          el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
        }
      });
    }, 1000);
  }

  function startBMOrdersPolling() {
    stopBMOrdersPolling();
    _bmOrdersState.pollTimer = setInterval(function () {
      if (document.visibilityState === 'hidden' && !window.IS_NATIVE_APP) return;
      loadBMOrders({ background: true });
    }, 10000);

    // Instant zero-delay wake-up when app is foregrounded or screen turned on
    if (!window._bmVisibilityListenerBound) {
      window._bmVisibilityListenerBound = true;
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
          loadBMOrders({ background: true });
          if (typeof loadHariIni === 'function') loadHariIni();
        }
      });
      window.addEventListener('focus', function () {
        loadBMOrders({ background: true });
      });
    }

    // Keep screen awake while on orders feed if supported
    if ('wakeLock' in navigator && typeof navigator.wakeLock.request === 'function' && !_bmOrdersState.wakeLock) {
      navigator.wakeLock.request('screen').then(function (lock) {
        _bmOrdersState.wakeLock = lock;
      }).catch(function () {});
    }
  }

  window.startBMOrdersPolling = startBMOrdersPolling;
  window.stopBMOrdersPolling = stopBMOrdersPolling;

  // Browser-local audible chime for genuinely new pending orders (Web Audio API synthesis)
  // Fails gracefully if browser autoplay policy blocks un-interacted audio without spamming errors
  function playNewOrderAudibleChime() {
    if (window.XentraAudio && typeof window.XentraAudio.orderReceived === 'function') {
      window.XentraAudio.orderReceived({ text: 'Ada pesanan baru masuk!', maxRepeats: 5 });
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

  function isBMOrderAwaitingPayment(ord) {
    if (!ord) return false;
    if (ord.order_type === 'reservation') return false;
    var method = String(ord.payment_method || '').toLowerCase();
    if (!method || method === 'cash') return false;
    var payStatus = String(ord.payment_status || (ord.payment && ord.payment.payment_status) || '').toLowerCase();
    return payStatus !== 'settlement' && payStatus !== 'paid';
  }
  window.isBMOrderAwaitingPayment = isBMOrderAwaitingPayment;

  function isBMCustomerAppOrder(ord) {
    if (!ord) return false;
    // Default schema channel is customer_app; POS orders are pos_cashier, aggregators are gofood/grabfood/etc.
    var ch = String(ord.order_channel || 'customer_app').toLowerCase();
    return ch === 'customer_app';
  }
  window.isBMCustomerAppOrder = isBMCustomerAppOrder;

  function checkAndNotifyNewPendingOrders(orders) {
    if (!Array.isArray(orders)) return;
    var currentPendingOrders = orders.filter(function (o) {
      if (o.status !== 'pending') return false;
      if (isBMOrderAwaitingPayment(o)) return false;
      // Suara notifikasi dan alert sistem HANYA untuk pesanan masuk dari Customer PWA
      if (!isBMCustomerAppOrder(o)) return false;
      return true;
    });
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

  var _lastHybridTimeoutCheck = 0;
  async function checkBMDeliveryHybridTimeouts(branchId) {
    var now = Date.now();
    if (now - _lastHybridTimeoutCheck < 15000) return;
    _lastHybridTimeoutCheck = now;
    try {
      var res = await adminFetch(API_BASE + '/admin/orders/check-hybrid-timeouts?branch_id=' + encodeURIComponent(branchId), {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data && data.timed_out_count > 0) {
        showToast('⚠️ ' + data.timed_out_count + ' pesanan delivery belum direspons kurir (timeout). Silakan tugaskan manual.');
      }
    } catch (_) {}
  }

  async function loadBMOrders(opts) {
    var user = getStoredUser();
    var branchId = (typeof window.getBMTargetBranchId === 'function' ? window.getBMTargetBranchId() : null) || (user ? (user.branch_id || user.branchId) : null);
    if (!branchId) return;

    if (typeof loadHariIni === 'function' && (!window._hariIniState || !window._hariIniState.branch)) {
      loadHariIni();
    }

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

      if (currentSeq !== _bmOrdersState.fetchSeq) return;

      if (res.status === 304) {
        // Not modified — preserve valid cached orders in memory without crashing
        renderBMOrdersFeed();
        return;
      }

      var data = await res.json();

      if (res.ok && data.success && Array.isArray(data.orders)) {
        checkAndNotifyNewPendingOrders(data.orders);
        _bmOrdersState.orders = data.orders;

        renderBMOrdersFeed();
        checkBMDeliveryHybridTimeouts(branchId);
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

  function setBMPesananTab(tabKey) {
    _bmOrdersState.activeTab = tabKey || 'in_process';
    document.querySelectorAll('.bm-pesanan-nav-tab').forEach(function (btn) {
      var isAct = btn.dataset.tabStatus === _bmOrdersState.activeTab;
      btn.classList.toggle('active', isAct);
      btn.setAttribute('aria-selected', isAct ? 'true' : 'false');
      var badge = btn.querySelector('.bm-pesanan-tab-badge');
      if (badge) badge.classList.toggle('active', isAct);
    });

    var topbar = document.querySelector('.x-pesanan-topbar') || document.getElementById('bm-pesanan-topbar');
    var navTabs = document.querySelector('.bm-pesanan-nav-tabs') || document.getElementById('bm-pesanan-nav-tabs');
    var stageBar = document.getElementById('bm-stage-subfilter-bar');

    if (_bmOrdersState.activeTab === 'in_process') {
      if (stageBar) stageBar.style.display = 'flex';
      if (topbar) topbar.classList.add('has-subfilters');
      if (navTabs) navTabs.classList.add('has-subfilters');
      // Ensure active stage subfilter button highlights correctly
      document.querySelectorAll('#bm-stage-subfilter-bar .stage-subfilter-btn').forEach(function (b) {
        var isAct = (b.dataset.stageFilter === (_bmOrdersState.stageSubfilter || 'all'));
        b.classList.toggle('active', isAct);
        b.setAttribute('aria-selected', isAct ? 'true' : 'false');
      });
    } else {
      if (stageBar) stageBar.style.display = 'none';
      if (topbar) topbar.classList.remove('has-subfilters');
      if (navTabs) navTabs.classList.remove('has-subfilters');
    }

    renderBMOrdersFeed();
  }
  window.setBMPesananTab = setBMPesananTab;

  function setBMStageSubfilter(stage, btnEl) {
    _bmOrdersState.stageSubfilter = stage || 'all';
    _bmOrdersState.activeTab = 'in_process';
    document.querySelectorAll('#bm-stage-subfilter-bar .stage-subfilter-btn').forEach(function (b) {
      var isAct = (b.dataset.stageFilter === _bmOrdersState.stageSubfilter);
      b.classList.toggle('active', isAct);
      b.setAttribute('aria-selected', isAct ? 'true' : 'false');
    });
    if (btnEl) {
      btnEl.classList.add('active');
    }
    renderBMOrdersFeed();
  }
  window.setBMStageSubfilter = setBMStageSubfilter;

  function setBMPesananTypeFilter(type) {
    _bmOrdersState.typeFilter = type || 'all';
    document.querySelectorAll('.bm-pesanan-type-chip').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.typeFilter === _bmOrdersState.typeFilter);
    });
    renderBMOrdersFeed();
  }
  window.setBMPesananTypeFilter = setBMPesananTypeFilter;

  function setBMOrderTypeFilter(type) {
    setBMPesananTypeFilter(type);
  }
  window.setBMOrderTypeFilter = setBMOrderTypeFilter;

  function onBMOrdersFilterChange() {
    var searchEl = $('bm-orders-search');
    if (searchEl) _bmOrdersState.searchQuery = searchEl.value.trim().toLowerCase();
    renderBMOrdersFeed();
  }
  window.onBMOrdersFilterChange = onBMOrdersFilterChange;

  function updatePesananBranchOpenState(isOpen) {
    var filterCard = $('bm-pesanan-filter-card');
    var feedSec = document.querySelector('.bm-order-feed');
    var closedView = $('bm-orders-closed-view');

    if (typeof isOpen !== 'boolean') {
      if (window._hariIniState && window._hariIniState.branch) {
        var b = window._hariIniState.branch;
        isOpen = (b.is_open_override === 1 || b.is_open_override === true);
      } else {
        var sw = $('pesanan-open-switch') || $('mobile-open-switch');
        isOpen = sw ? sw.classList.contains('is-on') : true;
      }
    }

    if (!isOpen) {
      if (filterCard) filterCard.style.setProperty('display', 'none', 'important');
      if (feedSec) feedSec.style.setProperty('display', 'none', 'important');
      if (closedView) {
        closedView.classList.remove('is-hidden');
        closedView.classList.add('is-visible');
        closedView.style.setProperty('display', 'flex', 'important');
      }
    } else {
      if (closedView) {
        closedView.classList.remove('is-visible');
        closedView.classList.add('is-hidden');
        closedView.style.setProperty('display', 'none', 'important');
      }
      if (filterCard) filterCard.style.setProperty('display', 'block', 'important');
      if (feedSec) feedSec.style.setProperty('display', 'block', 'important');
    }
  }
  window.updatePesananBranchOpenState = updatePesananBranchOpenState;

  function getBMActionButton(ord, projection) {
    var type = getBMOrderType(ord);
    var status = String((ord && ord.status) || '');
    var pendingAdditions = Number((ord && ord.pending_additions_count) || 0);

    // If there are pending additions from customer
    if (pendingAdditions > 0) {
      return {
        label: 'Tinjau +' + pendingAdditions + ' pesanan tambahan',
        bg: '#1e5eb2',
        cls: 'btn-blue',
        action: 'detail'
      };
    }

    // 1. PENDING (Masuk)
    // Sesuai warna2 tombol.png & role contract:
    // Regular: Mulai Siapkan (Hijau #00a637)
    // Unpaid Online Gateway: ⏳ Menunggu Pembayaran Online Pelanggan (Abu-abu #94a3b8)
    // Reservasi: Konfirmasi Reservasi (Hijau #00a637)
    if (status === 'pending') {
      var awaitingOnlinePay = ['midtrans', 'doku'].indexOf(ord && ord.payment_method) !== -1 && ord && ord.payment && ord.payment.payment_status !== 'settlement';
      if (awaitingOnlinePay) {
        return {
          label: '⏳ Menunggu Pembayaran Online Pelanggan',
          bg: '#94a3b8',
          cls: 'btn-disabled',
          action: 'none'
        };
      }
      return {
        label: type === 'reservation' ? 'Konfirmasi Reservasi' : 'Mulai Siapkan',
        bg: '#00a637',
        cls: 'btn-green',
        action: 'accept'
      };
    }

    // 2. CONFIRMED (Dikonfirmasi / Menunggu Dimasak)
    // Sesuai warna2 tombol.png: Mulai Siapkan (Hijau #00a637)
    // Reservasi: Jadwal reservasi ditangani Kasir POS
    if (status === 'confirmed') {
      if (type === 'reservation') {
        return {
          label: '📅 Reservasi Terjadwal di Kasir POS',
          bg: '#f1f5f9',
          color: '#475569',
          cls: 'btn-secondary',
          action: 'detail'
        };
      }
      return {
        label: 'Mulai Siapkan',
        bg: '#00a637',
        cls: 'btn-green',
        action: 'advance'
      };
    }

    // 3. PREPARING (Sedang Dimasak)
    // Sesuai panduan warna2 tombol.png:
    // - Delivery (Online & COD): Tandai Siap (Biru #1e5eb2)
    // - Dine-in: Siap Disajikan (Merah Coral #fa3e3e)
    // - Takeaway/Pickup: Siap Diambil (Merah Coral #fa3e3e)
    if (status === 'preparing') {
      if (type === 'delivery') {
        return {
          label: 'Tandai Siap',
          bg: '#1e5eb2',
          cls: 'btn-blue',
          action: 'advance'
        };
      } else if (type === 'dine_in' || type === 'dinein') {
        return {
          label: 'Siap Disajikan',
          bg: '#fa3e3e',
          cls: 'btn-coral',
          action: 'advance'
        };
      } else if (type === 'pickup' || type === 'takeaway') {
        return {
          label: 'Siap Diambil',
          bg: '#fa3e3e',
          cls: 'btn-coral',
          action: 'advance'
        };
      } else {
        return {
          label: 'Siap Disajikan',
          bg: '#fa3e3e',
          cls: 'btn-coral',
          action: 'advance'
        };
      }
    }

    // 4. READY (Makanan Siap)
    // Sesuai panduan warna2 tombol.png & role contract:
    // - Delivery: Tugaskan Driver (Coral #fa3e3e) / Kurir Ditugaskan (Menunggu) (Amber #f59e0b) / Menunggu Diambil Kurir (Ganti Kurir) (Emerald #10b981)
    // - Takeaway/Pickup (unpaid di kasir): ⏳ Menunggu Bayar di Kasir (Amber #f59e0b, disabled)
    // - Takeaway/Pickup (paid): Pesanan Selesai (Charcoal #303030, serah terima)
    // - Dine-in: Sajikan ke Meja (Charcoal #303030, disajikan & kasir settlement fleksibel)
    if (status === 'ready') {
      if (type === 'delivery') {
        var dlv = ord && ord.delivery;
        var driverName = ord && (ord.driver_name || (dlv && dlv.driver_name));
        var hasDriver = !!(driverName || (dlv && dlv.driver_id));
        var assignStatus = dlv && dlv.driver_assignment_status;

        if (hasDriver && assignStatus === 'pending') {
          return {
            label: 'Kurir Ditugaskan (Menunggu)',
            bg: '#f59e0b',
            cls: 'btn-amber',
            action: 'assign_driver'
          };
        } else if (hasDriver && assignStatus === 'accepted') {
          return {
            label: 'Serahkan ke Driver',
            bg: '#fa3e3e',
            cls: 'btn-coral',
            action: 'assign_driver'
          };
        }
        return {
          label: 'Serahkan ke Driver',
          bg: '#fa3e3e',
          cls: 'btn-coral',
          action: 'assign_driver'
        };
      } else if (type === 'pickup' || type === 'takeaway') {
        var isPaid = getBMOrderPaymentState(ord).key === 'paid';
        if (!isPaid) {
          return {
            label: '⏳ Menunggu Bayar di Kasir',
            bg: '#f59e0b',
            cls: 'btn-amber',
            action: 'none'
          };
        }
        return {
          label: 'Pesanan Selesai',
          bg: '#303030',
          cls: 'btn-charcoal',
          action: 'advance'
        };
      } else if (type === 'dine_in' || type === 'dinein') {
        return {
          label: 'Sajikan ke Meja',
          bg: '#303030',
          cls: 'btn-charcoal',
          action: 'advance'
        };
      } else {
        return {
          label: 'Pesanan Selesai',
          bg: '#303030',
          cls: 'btn-charcoal',
          action: 'advance'
        };
      }
    }

    // 5. OUT FOR DELIVERY (Sedang Diantar Kurir)
    if (status === 'out_for_delivery') {
      return {
        label: 'Detail & Lacak',
        bg: '#f1f5f9',
        color: '#475569',
        cls: 'btn-secondary',
        action: 'detail'
      };
    }

    // 6. SCHEDULED (Tab Terjadwal)
    if (_bmOrdersState.activeTab === 'scheduled') {
      if (type === 'reservation') {
        return {
          label: '📅 Reservasi Terjadwal di Kasir POS',
          bg: '#f1f5f9',
          color: '#475569',
          cls: 'btn-secondary',
          action: 'detail'
        };
      }
      return {
        label: 'Mulai Siapkan',
        bg: '#00a637',
        cls: 'btn-green',
        action: 'advance'
      };
    }

    // 7. COMPLETED (Tab Selesai)
    if (status === 'completed' || _bmOrdersState.activeTab === 'completed') {
      return {
        label: 'Lihat Detail / Cetak',
        bg: '#f1f5f9',
        color: '#475569',
        cls: 'btn-secondary',
        action: 'detail'
      };
    }

    // 8. CANCELLED / REJECTED
    if (['rejected', 'cancelled', 'timeout', 'fulfillment_exception'].indexOf(status) !== -1 || _bmOrdersState.activeTab === 'cancelled') {
      return {
        label: 'Lihat Info Ditolak',
        bg: '#fff1f2',
        color: '#be123c',
        cls: 'btn-secondary',
        action: 'rejected_info'
      };
    }

    return null;
  }
  window.getBMActionButton = getBMActionButton;

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

  function getWibStartOfTodayMs() {
    try {
      var wibDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()); // 'YYYY-MM-DD'
      var start = new Date(wibDateStr + 'T00:00:00+07:00').getTime();
      return isNaN(start) ? new Date().setHours(0, 0, 0, 0) : start;
    } catch (_) {
      var d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
  }

  function getOrderCreationMs(ord) {
    if (!ord) return 0;
    var raw = ord.created_at || ord.createdAt || ord.order_time;
    if (!raw) return 0;
    var ms = new Date(raw).getTime();
    if (isNaN(ms)) {
      ms = new Date(String(raw).replace(' ', 'T') + 'Z').getTime();
    }
    return isNaN(ms) ? 0 : ms;
  }

  function formatBMOrderFullDateTime(dateVal) {
    if (!dateVal) return '—';
    var d = new Date(dateVal);
    if (isNaN(d.getTime())) {
      d = new Date(String(dateVal).replace(' ', 'T') + 'Z');
    }
    if (isNaN(d.getTime())) return '—';
    try {
      var dayName = new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' }).format(d);
      var datePart = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(d);
      var timePart = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(d);
      return dayName + ', ' + datePart + ' • ' + timePart + ' WIB';
    } catch (e) {
      return d.toLocaleString('id-ID') + ' WIB';
    }
  }
  window.formatBMOrderFullDateTime = formatBMOrderFullDateTime;

  function getBMDriverVehicle(vehicleType) {
    var type = String(vehicleType || '').trim().toLowerCase();
    if (type === 'car' || type === 'mobil') return { icon: '🚗', label: 'Mobil' };
    if (type === 'bicycle' || type === 'sepeda') return { icon: '🚲', label: 'Sepeda' };
    if (type === 'motorcycle' || type === 'motorbike' || type === 'motor' || type === 'sepeda motor') return { icon: '🏍️', label: 'Motor' };
    return { icon: '🚚', label: 'Kurir' };
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
      projection.stateLabel = 'Sedang diantar kurir';
      projection.actionLabel = 'Detail & Lacak';
      projection.actionType = 'view_detail';
      projection.attention = false;
      projection.muted = false;
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

  function formatBMCardTime(dateVal) {
    if (!dateVal) return '';
    var d = new Date(dateVal);
    if (isNaN(d.getTime())) d = new Date(String(dateVal).replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return '';
    var diffMs = Date.now() - d.getTime();
    if (diffMs < 60000 && diffMs >= 0) return 'Baru saja';
    if (diffMs < 3600000 && diffMs >= 0) return Math.floor(diffMs / 60000) + ' mnt lalu';
    try {
      return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(d) + ' WIB';
    } catch (e) {
      var h = d.getHours();
      var m = d.getMinutes();
      return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m) + ' WIB';
    }
  }

  function renderBMOrdersFeed() {
    var container = $('bm-orders-cards-container');
    if (!container) return;

    var all = (_bmOrdersState.orders || []).slice();

    // 1. Check branch operational state (Buka / Tutup)
    var isOpen = true;
    if (window._hariIniState && window._hariIniState.branch) {
      var b = window._hariIniState.branch;
      isOpen = (b.is_open_override === 1 || b.is_open_override === true);
    } else {
      var sw = $('pesanan-open-switch') || $('mobile-open-switch');
      if (sw) isOpen = sw.classList.contains('is-on');
    }
    updatePesananBranchOpenState(isOpen);

    // 2. Classify orders into the 4 canonical tabs (1-day cycle in WIB: 00:00:00 rollover)
    var nowMs = Date.now();
    var startOfTodayWibMs = getWibStartOfTodayMs();

    var inProcessOrders = getMobileInProcessOrders(all, nowMs);

    var scheduledOrders = all.filter(function (ord) {
      var st = String(ord.status || '');
      if (['cancelled', 'rejected', 'timeout', 'fulfillment_exception', 'completed'].indexOf(st) !== -1) return false;
      if (ord.order_type === 'reservation' && st === 'confirmed') {
        var ms = getBMReservationScheduleMs(ord);
        if (!isNaN(ms) && ms > nowMs) return true;
      }
      if (ord.scheduled_slot_start) {
        var slotMs = new Date(ord.scheduled_slot_start).getTime();
        if (!isNaN(slotMs) && slotMs > nowMs) return true;
      }
      return false;
    });

    var completedOrders = all.filter(function (ord) {
      if (ord.status !== 'completed') return false;
      var cMs = getOrderCreationMs(ord);
      // Only show completed orders from today (>= 00:00 WIB today); older days roll into reports
      return !cMs || cMs >= startOfTodayWibMs;
    });

    var cancelledOrders = all.filter(function (ord) {
      if (['cancelled', 'rejected', 'timeout', 'fulfillment_exception'].indexOf(ord.status) === -1) return false;
      var cMs = getOrderCreationMs(ord);
      // Only show cancelled orders from today (>= 00:00 WIB today); older days roll into reports
      return !cMs || cMs >= startOfTodayWibMs;
    });

    // Update tab badges (consistently shows count badges per Figma Frame 312 & GoBiz)
    function updateTabBadge(badgeEl, count) {
      if (!badgeEl) return;
      var num = Math.max(0, Number(count) || 0);
      badgeEl.textContent = String(num);
      badgeEl.style.removeProperty('display');
      badgeEl.classList.remove('is-hidden');
    }

    updateTabBadge($('badge-count-in-process'), inProcessOrders.length);
    updateTabBadge($('badge-count-scheduled'), scheduledOrders.length);
    updateTabBadge($('badge-count-completed'), completedOrders.length);
    updateTabBadge($('badge-count-cancelled'), cancelledOrders.length);

    // Update kitchen stage sub-filter counts (Semua, Masuk, Dimasak, Siap)
    var incomingCount = 0;
    var cookingCount = 0;
    var readyCount = 0;

    inProcessOrders.forEach(function (ord) {
      var st = String(ord.status || '');
      if (st === 'pending') {
        incomingCount++;
      } else if (st === 'confirmed' || st === 'preparing') {
        cookingCount++;
      } else if (st === 'ready' || st === 'out_for_delivery') {
        readyCount++;
      }
    });

    var subfilterAllEl = $('subfilter-count-all') || $('subbadge-all');
    var subfilterIncomingEl = $('subfilter-count-incoming') || $('subbadge-incoming');
    var subfilterCookingEl = $('subfilter-count-cooking') || $('subbadge-cooking');
    var subfilterReadyEl = $('subfilter-count-ready') || $('subbadge-ready');

    if (subfilterAllEl) subfilterAllEl.textContent = String(inProcessOrders.length);
    if (subfilterIncomingEl) subfilterIncomingEl.textContent = String(incomingCount);
    if (subfilterCookingEl) subfilterCookingEl.textContent = String(cookingCount);
    if (subfilterReadyEl) subfilterReadyEl.textContent = String(readyCount);

    // Synchronize bottom navigation badge with total in-process orders
    if (typeof updateMobileOrdersBadge === 'function') {
      updateMobileOrdersBadge(inProcessOrders.length);
    }

    if (!isOpen) {
      return; // Closed shop screen is visible; skip feed rendering
    }

    // Check if legacy nav tabs are absent (e.g. Test 7 environment with attention/all toggle)
    var hasNavTabs = !!$('bm-pesanan-nav-tabs') || !!document.querySelector('.bm-pesanan-nav-tabs');
    var activeTabKey = _bmOrdersState.activeTab || 'in_process';
    var stageFilter = _bmOrdersState.stageSubfilter || 'all';
    var tabOrders;

    if (!hasNavTabs && ($('bm-orders-view-attention') || $('bm-orders-view-all'))) {
      // Legacy queue view mode (for environments/tests with attention/all view toggle)
      var projections = all.map(function (ord) {
        return { order: ord, projection: getBMOrderProjection(ord) };
      });
      var attentionItems = projections.filter(function (item) {
        return item.projection.attention || Number(item.order.pending_additions_count || 0) > 0;
      });
      var visible = _bmOrdersState.queueView === 'all' ? projections : attentionItems;
      tabOrders = visible.map(function (it) { return it.order; });

      var attentionCount = attentionItems.length;
      var allCount = projections.length;
      if ($('bm-orders-attention-count')) $('bm-orders-attention-count').textContent = String(attentionCount);
      if ($('bm-orders-all-count')) $('bm-orders-all-count').textContent = String(allCount);
    } else {
      // 3. Select list by active tab
      tabOrders = inProcessOrders;
      if (activeTabKey === 'scheduled') tabOrders = scheduledOrders;
      else if (activeTabKey === 'completed') tabOrders = completedOrders;
      else if (activeTabKey === 'cancelled') tabOrders = cancelledOrders;
    }

    // 4. Filter by service type (Semua, Delivery, Dine-in, Takeaway, Reservasi)
    var typeFilter = _bmOrdersState.typeFilter || 'all';
    if (typeFilter !== 'all') {
      tabOrders = tabOrders.filter(function (ord) {
        var t = getBMOrderType(ord);
        if (typeFilter === 'pickup' || typeFilter === 'takeaway') return t === 'pickup' || t === 'takeaway';
        if (typeFilter === 'dine_in' || typeFilter === 'dinein') return t === 'dine_in' || t === 'dinein';
        return t === typeFilter;
      });
    }

    // 4b. Filter by kitchen stage subfilter for 'in_process' (Semua, Masuk, Dimasak, Siap)
    if (activeTabKey === 'in_process' && stageFilter !== 'all') {
      tabOrders = tabOrders.filter(function (ord) {
        var st = String(ord.status || '');
        if (stageFilter === 'incoming') {
          return st === 'pending';
        } else if (stageFilter === 'cooking') {
          return st === 'confirmed' || st === 'preparing';
        } else if (stageFilter === 'ready') {
          return st === 'ready' || st === 'out_for_delivery';
        }
        return true;
      });
    }

    // 5. Filter by search query (No. pesanan, pelanggan, telepon, meja, driver, atau nama menu)
    if (_bmOrdersState.searchQuery) {
      var q = _bmOrdersState.searchQuery;
      tabOrders = tabOrders.filter(function (ord) {
        var num = String(ord.order_number || ord.id || '').toLowerCase();
        var cust = String(ord.customer_name || '').toLowerCase();
        var phone = String(ord.customer_phone || '').toLowerCase();
        var tbl = String(ord.table_no || ord.table_number || ord.table_name || '').toLowerCase();
        var driver = String(ord.driver_name || (ord.delivery && ord.delivery.driver_name) || '').toLowerCase();
        var matchItem = Array.isArray(ord.items) && ord.items.some(function (it) {
          return String(it.product_name || it.item_name || it.name || '').toLowerCase().indexOf(q) !== -1;
        });
        return num.indexOf(q) !== -1 || cust.indexOf(q) !== -1 || phone.indexOf(q) !== -1 ||
               (tbl && ('meja ' + tbl).indexOf(q) !== -1) || (tbl && tbl.indexOf(q) !== -1) ||
               (driver && driver.indexOf(q) !== -1) || matchItem;
      });
    }

    // 6. Sort orders: new arrivals first, then urgent reservations, then attention, then newest
    var sortNow = Date.now();
    tabOrders.sort(function (a, b) {
      var aNew = a.status === 'pending' && !!_bmOrdersState.newPendingOrderIds[a.id];
      var bNew = b.status === 'pending' && !!_bmOrdersState.newPendingOrderIds[b.id];
      if (aNew !== bNew) return aNew ? -1 : 1;

      var aReservationMs = getBMReservationScheduleMs(a);
      var bReservationMs = getBMReservationScheduleMs(b);
      var aIsUpcomingReservation = !isNaN(aReservationMs) && aReservationMs >= sortNow;
      var bIsUpcomingReservation = !isNaN(bReservationMs) && bReservationMs >= sortNow;

      var aProj = getBMOrderProjection(a);
      var bProj = getBMOrderProjection(b);
      if (aProj.attention !== bProj.attention) return aProj.attention ? -1 : 1;

      if (aIsUpcomingReservation && bIsUpcomingReservation) {
        if (aReservationMs !== bReservationMs) return aReservationMs - bReservationMs;
      }
      if (aIsUpcomingReservation !== bIsUpcomingReservation) {
        return aIsUpcomingReservation ? -1 : 1;
      }

      var aTime = new Date(a.created_at || 0).getTime();
      var bTime = new Date(b.created_at || 0).getTime();
      return bTime - aTime;
    });

    // 7. Handle empty tab state
    if (!tabOrders.length) {
      var emptyTitle = 'Tidak ada pesanan dalam proses.';
      var emptySub = 'Pesanan baru yang perlu disiapkan akan muncul di sini.';
      if (activeTabKey === 'scheduled') {
        emptyTitle = 'Tidak ada pesanan terjadwal.';
        emptySub = 'Pesanan reservasi atau pre-order mendatang akan muncul di sini.';
      } else if (activeTabKey === 'completed') {
        emptyTitle = 'Belum ada pesanan selesai.';
        emptySub = 'Pesanan yang telah diselesaikan akan tercatat di sini.';
      } else if (activeTabKey === 'cancelled') {
        emptyTitle = 'Tidak ada pesanan dibatalkan.';
        emptySub = 'Riwayat pesanan yang dibatalkan atau ditolak akan muncul di sini.';
      } else if (activeTabKey === 'in_process' && stageFilter !== 'all') {
        if (stageFilter === 'incoming') {
          emptyTitle = 'Tidak ada pesanan baru masuk.';
          emptySub = 'Pesanan baru yang membutuhkan konfirmasi akan muncul di sini.';
        } else if (stageFilter === 'cooking') {
          emptyTitle = 'Tidak ada pesanan yang sedang dimasak.';
          emptySub = 'Pesanan yang sedang diproses di dapur akan muncul di sini.';
        } else if (stageFilter === 'ready') {
          emptyTitle = 'Tidak ada pesanan siap saji.';
          emptySub = 'Pesanan yang sudah matang dan siap disajikan/diantar kurir akan muncul di sini.';
        }
      }
      container.innerHTML =
        '<div class="bm-order-empty">' +
          '<div class="bm-order-empty-icon">' + (activeTabKey === 'in_process' ? '✓' : '🍽️') + '</div>' +
          '<strong>' + emptyTitle + '</strong>' +
          '<span>' + emptySub + '</span>' +
        '</div>';
      return;
    }

    // 8. Render cards matching Xentra Merchant - Pesanan Buka
    container.innerHTML = tabOrders.map(function (ord) {
      var p = getBMOrderProjection(ord);
      var type = getBMOrderType(ord);
      var iconSrc = '/merchant-app/assets/icons/delivery.png';
      var badgeCls = 'delivery';
      var badgeLabel = 'Delivery';
      if (type === 'dine_in' || type === 'dinein') {
        iconSrc = '/merchant-app/assets/icons/dine-in.png';
        badgeCls = 'dine_in';
        badgeLabel = 'Dine-in';
      } else if (type === 'pickup' || type === 'takeaway') {
        iconSrc = '/merchant-app/assets/icons/takeaway.png';
        badgeCls = 'takeaway';
        badgeLabel = 'Takeaway';
      } else if (type === 'reservation') {
        iconSrc = '/merchant-app/assets/icons/reservasi 1.png';
        badgeCls = 'reservation';
        badgeLabel = 'Reservasi';
      }

      var orderCode = formatBMOrderCode(ord);
      var customerName = esc(ord.customer_name || 'Pelanggan');

      // Urgent countdown banner (Batas terima pesanan) for pending orders
      var urgentBarHtml = '';
      if (ord.status === 'pending') {
        var deadlineMs = ord.acceptance_deadline_at ? new Date(ord.acceptance_deadline_at).getTime() : 0;
        var msRemaining = deadlineMs - Date.now();
        if (msRemaining > 0) {
          var m = Math.floor(msRemaining / 60000);
          var s = Math.floor((msRemaining % 60000) / 1000);
          var timeStr = m + ':' + (s < 10 ? '0' : '') + s;
          urgentBarHtml =
            '<div class="urgent-timer-bar">' +
              '<span style="display:flex; align-items:center; gap:6px;">' +
                '<span class="pulse-dot"></span>' +
                'Batas terima pesanan:' +
              '</span>' +
              '<strong data-deadline="' + deadlineMs + '">' + timeStr + '</strong>' +
            '</div>';
        }
      }

      // Card Header Time
      var cardTime = formatBMCardTime(ord.created_at);

      // Table / Guest badge info
      var channelPillLabel = badgeLabel;
      if (type === 'dine_in' || type === 'dinein') {
        var tbl = ord.table_no || ord.table_number || ord.table_name;
        if (tbl) channelPillLabel += ' • Meja ' + esc(tbl);
      } else if (type === 'reservation') {
        var guests = ord.guest_count || (ord.reservation && ord.reservation.guest_count);
        if (guests) channelPillLabel += ' • ' + guests + ' Tamu';
      }

      // Driver info (if delivery with assigned driver)
      var driverHtml = '';
      var dlv = ord.delivery;
      var driverName = ord.driver_name || (dlv && dlv.driver_name);
      if (type === 'delivery') {
        if (dlv && dlv.status === 'failed') {
          driverHtml =
            '<div style="font-size:11.5px; font-weight:700; color:#b91c1c; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:6px 10px; display:flex; align-items:center; gap:6px;">' +
              '❌ Gagal Antar (RTS): <strong>' + esc(dlv.pod_note || 'Kurir kembali ke outlet') + '</strong>' +
            '</div>';
        } else if (ord.status === 'out_for_delivery') {
          driverHtml =
            '<div style="font-size:12px; font-weight:700; color:#1d4ed8; background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:6px 10px; display:flex; align-items:center; gap:6px;">' +
              '🚚 Sedang Diantar: <strong>' + esc(driverName || 'Kurir') + '</strong>' +
            '</div>';
        } else if (dlv && dlv.driver_assignment_status === 'pending') {
          driverHtml =
            '<div style="font-size:11.5px; font-weight:700; color:#b45309; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:6px 10px; display:flex; align-items:center; gap:6px;">' +
              '⏳ Kurir Ditugaskan: <strong>' + esc(driverName || 'Kurir') + '</strong> <span style="font-size:10.5px; font-weight:600; color:#92400e;">(Menunggu Konfirmasi)</span>' +
            '</div>';
        } else if (dlv && dlv.driver_assignment_status === 'rejected') {
          driverHtml =
            '<div style="font-size:11.5px; font-weight:700; color:#b91c1c; background:#fff1f2; border:1px solid #fecdd3; border-radius:8px; padding:6px 10px; display:flex; align-items:center; gap:6px;">' +
              '⚠️ Kurir Menolak (' + esc(driverName || 'Driver') + ') • Silakan tugaskan ulang' +
            '</div>';
        } else if (driverName) {
          driverHtml =
            '<div style="font-size:11.5px; font-weight:700; color:#166534; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:6px 10px; display:flex; align-items:center; gap:6px;">' +
              '🛵 Kurir Siap: <strong>' + esc(driverName) + '</strong>' +
            '</div>';
        } else if (dlv && (dlv.dispatch_mode === 'automatic' || dlv.dispatch_mode === 'hybrid') && ord.status === 'ready') {
          driverHtml =
            '<div style="font-size:11.5px; font-weight:700; color:#2563eb; background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:6px 10px; display:flex; align-items:center; gap:6px;">' +
              '⚡ Auto-Dispatch: <span>Mencari kurir terdekat...</span>' +
            '</div>';
        }
      }

      // Cancel / Reject reason (if cancelled or rejected)
      var cancelReasonHtml = '';
      var cancelReason = ord.cancellation_reason || ord.cancel_reason;
      if (cancelReason && ['cancelled', 'rejected', 'timeout', 'fulfillment_exception'].indexOf(ord.status) !== -1) {
        cancelReasonHtml =
          '<div style="background:#fff1f2; border-radius:10px; padding:8px 12px; font-size:12px; color:#9f1239; font-weight:700;">' +
            'Alasan: ' + esc(cancelReason) +
          '</div>';
      }

      // Inline Kitchen Menu Preview (Gray Container with Quantity Badges & Notes)
      var items = ord.items || [];
      var itemsHtml = '';
      if (items.length) {
        itemsHtml = '<div class="card-items-box">' + items.map(function (it) {
          var q = Number(it.quantity || it.qty || 1);
          var name = esc(getBMOrderItemTitle(it));
          var notes = it.notes || it.kitchen_notes || '';
          var mods = formatBMItemModifiers(it);
          var noteParts = [];
          if (mods) noteParts.push(mods);
          if (notes) noteParts.push(notes);
          var noteStr = noteParts.join(' • ');

          return '<div>' +
            '<div class="item-row">' +
              '<span class="item-qty">' + q + 'x</span>' +
              '<strong class="item-name">' + name + '</strong>' +
            '</div>' +
            (noteStr ? '<div class="item-notes-box">Catatan: ' + esc(noteStr) + '</div>' : '') +
          '</div>';
        }).join('') + '</div>';
      } else {
        itemsHtml = '<div class="card-items-box"><div class="item-row"><span class="item-qty">1x</span><strong class="item-name">Pesanan Restoran</strong></div></div>';
      }

      // Pending Additions Alert
      var pendingAdditions = Number(ord.pending_additions_count || 0);
      var addonHtml = '';
      if (pendingAdditions > 0) {
        addonHtml =
          '<div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:12px; padding:10px 12px;">' +
            '<div style="display:flex; justify-content:space-between; align-items:center;">' +
              '<strong style="font-size:12px; color:#1d4ed8;">Pesanan tambahan tamu (' + pendingAdditions + ' kiriman)</strong>' +
              '<span style="font-size:11.5px; font-weight:800; color:#2563eb;">Lihat Detail</span>' +
            '</div>' +
          '</div>';
      }

      // Action Button (Konsep 1: 1 single capsule button per card matching Figma / warna2 tombol.png)
      var action = getBMActionButton(ord, p);
      var btnHtml = '';
      if (action) {
        var styleAttr = '';
        if (action.action === 'none') {
          styleAttr = 'cursor:not-allowed; opacity:0.9;';
        }
        if (action.bg) styleAttr += ' background:' + action.bg + ' !important;';
        if (action.color) styleAttr += ' color:' + action.color + ' !important;';
        if (action.cls === 'btn-secondary') styleAttr += ' border:1.5px solid #cbd5e1 !important;';

        var btnCls = 'bm-pesanan-action-btn ' + (action.cls || 'btn-green');

        if (action.action === 'none') {
          btnHtml =
            '<div class="card-actions-single" onclick="event.stopPropagation()">' +
              '<button type="button" class="' + btnCls + '" style="' + styleAttr + '" disabled>' + esc(action.label) + '</button>' +
            '</div>';
        } else if (action.action === 'detail' || action.action === 'view_detail') {
          btnHtml =
            '<div class="card-actions-single" onclick="event.stopPropagation()">' +
              '<button type="button" class="' + btnCls + '" style="' + styleAttr + '" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">' + esc(action.label) + '</button>' +
            '</div>';
        } else if (action.action === 'assign_driver') {
          btnHtml =
            '<div class="card-actions-single" onclick="event.stopPropagation()">' +
              '<button type="button" class="' + btnCls + '" style="' + styleAttr + '" onclick="openBMAssignDriverModal(\'' + esc(ord.id) + '\')">' + esc(action.label) + '</button>' +
            '</div>';
        } else if (action.action === 'accept') {
          btnHtml =
            '<div class="card-actions-single" onclick="event.stopPropagation()">' +
              '<button type="button" class="' + btnCls + '" style="' + styleAttr + '" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'pending\', \'' + esc(type) + '\', this)">' + esc(action.label) + '</button>' +
            '</div>';
        } else if (action.action === 'advance') {
          btnHtml =
            '<div class="card-actions-single" onclick="event.stopPropagation()">' +
              '<button type="button" class="' + btnCls + '" style="' + styleAttr + '" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'' + esc(String(ord.status)) + '\', \'' + esc(type) + '\', this)">' + esc(action.label) + '</button>' +
            '</div>';
        } else if (action.action === 'rejected_info') {
          btnHtml =
            '<div class="card-actions-single" onclick="event.stopPropagation()">' +
              '<button type="button" class="' + btnCls + '" style="background:#fff1f2 !important; color:#be123c !important; border:1px solid #fecdd3 !important;" onclick="openBMRejectedInfoModal(\'' + esc(ord.id) + '\')">' + esc(action.label) + '</button>' +
            '</div>';
        }
      }

      // COD Unsettled Badge on Card
      var codBannerHtml = '';
      if (ord.payment_method === 'cash' && ord.payment_status !== 'paid' && type === 'delivery') {
        var codAmt = Number(ord.grand_total || ord.subtotal || 0);
        codBannerHtml =
          '<div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:6px 10px; font-size:11.5px; font-weight:700; color:#b45309; display:flex; align-items:center; justify-content:space-between;">' +
            '<span>💵 COD di Kurir: ' + formatMoney(codAmt) + '</span>' +
            '<span style="background:#f59e0b; color:#fff; padding:1px 6px; border-radius:6px; font-size:10px;">Belum Disetor</span>' +
          '</div>';
      }

      // Kitchen Target Prep Timer on Card (confirmed & preparing)
      var targetTimeHtml = '';
      if (ord.status === 'confirmed' || ord.status === 'preparing') {
        if (ord.scheduled_slot_end) {
          var targetMs = new Date(ord.scheduled_slot_end).getTime();
          if (!isNaN(targetMs)) {
            var diffMins = Math.round((targetMs - Date.now()) / 60000);
            var targetClock = formatBMCardTime(ord.scheduled_slot_end);
            if (diffMins > 0) {
              targetTimeHtml =
                '<div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:5px 10px; font-size:11.5px; font-weight:700; color:#166534; display:flex; align-items:center; justify-content:space-between;">' +
                  '<span>⏱️ Target Siap: ' + targetClock + '</span>' +
                  '<span style="background:#22c55e; color:#fff; padding:1px 6px; border-radius:6px; font-size:10.5px;">' + diffMins + ' mnt lagi</span>' +
                '</div>';
            } else {
              targetTimeHtml =
                '<div style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:5px 10px; font-size:11.5px; font-weight:700; color:#dc2626; display:flex; align-items:center; justify-content:space-between;">' +
                  '<span>⚠️ Target Siap: ' + targetClock + '</span>' +
                  '<span style="background:#ef4444; color:#fff; padding:1px 6px; border-radius:6px; font-size:10.5px;">Lewat ' + Math.abs(diffMins) + ' mnt!</span>' +
                '</div>';
            }
          }
        }
      }

      return '<article class="bm-pesanan-card bm-order-feed-card" data-order-id="' + esc(ord.id) + '" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">' +
        urgentBarHtml +
        '<div class="card-head">' +
          '<div class="card-meta-left">' +
            '<img src="' + iconSrc + '" class="channel-avatar-icon" alt="' + esc(badgeLabel) + '">' +
            '<div class="order-meta-info">' +
              '<span class="order-code">' + esc(orderCode) + '</span>' +
              '<span class="channel-pill-badge ' + badgeCls + '">' + channelPillLabel + '</span>' +
            '</div>' +
          '</div>' +
          '<span class="card-time">' + esc(cardTime) + '</span>' +
        '</div>' +
        driverHtml +
        targetTimeHtml +
        codBannerHtml +
        cancelReasonHtml +
        itemsHtml +
        addonHtml +
        renderBMOrderPaymentLine(ord) +
        btnHtml +
      '</article>';
    }).join('');

    startBMCardsCountdownTicker();
  }

  // Keep the bottom navigation count aligned with the Pesanan > Dalam proses tab.
  function getMobileInProcessOrders(orders, nowMs) {
    var currentTime = typeof nowMs === 'number' ? nowMs : Date.now();
    return (Array.isArray(orders) ? orders : []).filter(function (ord) {
      if (isBMOrderAwaitingPayment(ord)) return false;
      var status = String(ord.status || '');
      if (['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'].indexOf(status) === -1) return false;
      if (ord.order_type === 'reservation' && status === 'confirmed') {
        var scheduledAt = getBMReservationScheduleMs(ord);
        if (!isNaN(scheduledAt) && scheduledAt > currentTime) return false;
      }
      return true;
    });
  }
  window.countMobileInProcessOrders = function (orders) {
    return getMobileInProcessOrders(orders).length;
  };


  async function advanceBMOrderStatus(orderId, currentStatus, fulfillmentType, btnEl) {
    if (currentStatus === 'pending') {
      if (window.XentraAudio && typeof window.XentraAudio.stopOrderAlert === 'function') {
        window.XentraAudio.stopOrderAlert();
      }
      openBMAcceptOrderModal(orderId, btnEl, 'orders');
      return;
    }

    var isDelivery = (fulfillmentType === 'delivery');
    if (currentStatus === 'ready' && isDelivery) {
      openBMAssignDriverModal(orderId);
      return;
    }

    var nextMap = {
      confirmed: 'preparing',
      preparing: 'ready',
      ready: 'completed'
    };

    var nextStatus = nextMap[currentStatus];
    if (!nextStatus) {
      if (currentStatus === 'out_for_delivery') {
        showToast('Pesanan sedang diantar kurir. Pengantaran diselesaikan oleh Kurir via Driver App.');
      } else {
        showToast('Status tidak dapat diubah lagi.');
      }
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

  async function settleBMOrderCod(orderId, grandTotal, btnEl) {
    showToast('Penerimaan kas COD dilakukan oleh Kasir melalui Aplikasi POS.');
  }
  window.settleBMOrderCod = settleBMOrderCod;

  function openBMEmergencyCancelModal(orderId) {
    var modal = $('modal-bm-emergency-cancel');
    var idInput = $('bm-emergency-cancel-order-id');
    var reasonInput = $('bm-emergency-cancel-reason');
    var errorEl = $('bm-emergency-cancel-error');
    var confirmBtn = $('btn-bm-emergency-cancel-confirm');
    var btnText = $('bm-emergency-cancel-btn-text');
    var subtitle = $('bm-emergency-cancel-order-subtitle');
    var order = findBMOrderById(orderId) || _bmOrdersState.currentDetailOrder || null;

    if (idInput) idInput.value = orderId || '';
    if (reasonInput) reasonInput.value = '';
    if (errorEl) errorEl.style.display = 'none';
    if (confirmBtn) confirmBtn.disabled = false;
    if (btnText) btnText.textContent = 'Batalkan pesanan';
    if (subtitle) {
      var label = formatBMOrderCode(order || { id: orderId });
      if (order && order.customer_name) label += ' · ' + order.customer_name;
      subtitle.textContent = label;
    }
    document.querySelectorAll('.bm-emergency-cancel-reason-chip').forEach(function (chip) {
      chip.classList.remove('is-active');
    });
    if (modal) modal.style.display = 'flex';
    if (window.XentraNav && typeof window.XentraNav.push === 'function') {
      window.XentraNav.push(function () { closeBMEmergencyCancelModal({ fromNav: true }); }, 'modal-bm-emergency-cancel');
    }
    if (reasonInput) setTimeout(function () { reasonInput.focus(); }, 80);
  }
  window.openBMEmergencyCancelModal = openBMEmergencyCancelModal;

  function closeBMEmergencyCancelModal(options) {
    options = options || {};
    var modal = $('modal-bm-emergency-cancel');
    var idInput = $('bm-emergency-cancel-order-id');
    if (modal) modal.style.display = 'none';
    if (idInput) idInput.value = '';
    if (!options.fromNav && window.XentraNav && window.XentraNav.hasOpen('modal-bm-emergency-cancel')) {
      window.XentraNav.pop('modal-bm-emergency-cancel');
    }
  }
  window.closeBMEmergencyCancelModal = closeBMEmergencyCancelModal;

  function setBMEmergencyCancelReason(reason, chipEl) {
    var reasonInput = $('bm-emergency-cancel-reason');
    var errorEl = $('bm-emergency-cancel-error');
    if (reasonInput) reasonInput.value = reason;
    if (errorEl) errorEl.style.display = 'none';
    document.querySelectorAll('.bm-emergency-cancel-reason-chip').forEach(function (chip) {
      chip.classList.remove('is-active');
    });
    if (chipEl) chipEl.classList.add('is-active');
  }
  window.setBMEmergencyCancelReason = setBMEmergencyCancelReason;

  async function cancelBMActiveOrder(event) {
    if (event && event.preventDefault) event.preventDefault();
    var idInput = $('bm-emergency-cancel-order-id');
    var reasonInput = $('bm-emergency-cancel-reason');
    var errorEl = $('bm-emergency-cancel-error');
    var confirmBtn = $('btn-bm-emergency-cancel-confirm');
    var btnText = $('bm-emergency-cancel-btn-text');
    var orderId = idInput ? idInput.value.trim() : '';
    var reason = reasonInput ? reasonInput.value.trim() : '';

    if (!orderId) {
      closeBMEmergencyCancelModal();
      return;
    }
    if (reason.length < 5) {
      if (errorEl) {
        errorEl.textContent = 'Tuliskan alasan pembatalan minimal 5 karakter.';
        errorEl.style.display = 'block';
      }
      if (reasonInput) reasonInput.focus();
      return;
    }
    if (confirmBtn) confirmBtn.disabled = true;
    if (btnText) btnText.textContent = 'Membatalkan pesanan…';
    try {
      var res = await adminFetch(API_BASE + '/kitchen/orders/' + encodeURIComponent(orderId) + '/status', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: 'cancelled', note: 'Pembatalan darurat cabang: ' + reason })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        closeBMEmergencyCancelModal();
        showToast('Pesanan berhasil dibatalkan.');
        loadBMOrders();
        if (typeof loadHariIni === 'function') loadHariIni();
        closeBMOrderDetail();
      } else {
        showToast('Gagal membatalkan: ' + (data.error || 'Terjadi kesalahan'));
        if (confirmBtn) confirmBtn.disabled = false;
        if (btnText) btnText.textContent = 'Batalkan pesanan';
      }
    } catch (e) {
      showToast('Kesalahan jaringan saat membatalkan pesanan.');
      if (confirmBtn) confirmBtn.disabled = false;
      if (btnText) btnText.textContent = 'Batalkan pesanan';
    }
  }
  window.cancelBMActiveOrder = cancelBMActiveOrder;

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
        closeBMRejectModal({ fromNav: true });
        if (_bmRejectOrigin === 'hari-ini' && typeof loadHariIni === 'function') {
          loadHariIni();
        }
        loadBMOrders();
        var detailView = $('bm-orders-detail-view');
        if (detailView && detailView.style.display !== 'none' && $('bm-detail-order-number')) {
          viewBMOrderDetail(orderId);
        }
        // Tampilkan Jendela Informasi Pesanan Ditolak Senada Merah Pink Warning (hanya 1 sistem info)
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

    var rejectedCustLabelEl = $('bm-rejected-info-customer-label');
    if (rejectedCustLabelEl) {
      if (ordType === 'dine_in') {
        rejectedCustLabelEl.textContent = 'Meja:';
      } else if (ordType === 'reservation') {
        rejectedCustLabelEl.textContent = 'Reservasi:';
      } else {
        rejectedCustLabelEl.textContent = 'Pelanggan:';
      }
    }

    if (custEl) {
      var custText = '';
      if (ordType === 'dine_in') {
        var tbl = ord.table_number || ord.table_name;
        custText = tbl ? ('Meja ' + tbl) : 'Makan di Tempat';
        if (ord.customer_name && ord.customer_name !== 'Pelanggan' && ord.customer_name !== 'Guest') {
          custText += ' (' + ord.customer_name + ')';
        }
      } else if (ordType === 'reservation') {
        var tbl = ord.table_number || ord.table_name;
        custText = (tbl ? ('Meja ' + tbl + ' • ') : '') + (ord.customer_name || 'Tamu');
        if (ord.guest_count) custText += ' (' + ord.guest_count + ' Tamu)';
      } else {
        // delivery / pickup
        custText = ord.customer_name ? ord.customer_name : 'Pelanggan';
        if (ord.customer_phone) {
          custText += ' (' + ord.customer_phone + ')';
        }
      }
      custEl.textContent = custText;
    }

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

  /* =========================================================================
     BRANCH MANAGER: ASSIGN DRIVER MODAL & SUBMIT
     ========================================================================= */
  var _bmActiveBranchDrivers = [];

  function switchBMDispatchMode(mode) {
    var modeVal = $('bm-assign-mode-val');
    var tabManual = $('bm-dispatch-tab-manual');
    var tabAuto = $('bm-dispatch-tab-auto');
    var panelManual = $('bm-dispatch-manual-panel');
    var panelAuto = $('bm-dispatch-auto-panel');
    var btnText = $('bm-assign-btn-text');
    var confirmBtn = $('btn-bm-confirm-assign-driver');

    if (mode === 'auto') {
      if (modeVal) modeVal.value = 'auto';
      if (tabAuto) {
        tabAuto.style.background = '#ffffff';
        tabAuto.style.color = '#0f172a';
        tabAuto.style.boxShadow = '0 1px 2px rgba(0,0,0,0.06)';
      }
      if (tabManual) {
        tabManual.style.background = 'transparent';
        tabManual.style.color = '#64748b';
        tabManual.style.boxShadow = 'none';
      }
      if (panelAuto) panelAuto.style.display = 'block';
      if (panelManual) panelManual.style.display = 'none';
      if (btnText) btnText.textContent = '⚡ Jalankan Auto-Dispatch';
      if (confirmBtn) confirmBtn.style.background = '#2563eb';
    } else {
      if (modeVal) modeVal.value = 'manual';
      if (tabManual) {
        tabManual.style.background = '#ffffff';
        tabManual.style.color = '#0f172a';
        tabManual.style.boxShadow = '0 1px 2px rgba(0,0,0,0.06)';
      }
      if (tabAuto) {
        tabAuto.style.background = 'transparent';
        tabAuto.style.color = '#64748b';
        tabAuto.style.boxShadow = 'none';
      }
      if (panelAuto) panelAuto.style.display = 'none';
      if (panelManual) panelManual.style.display = 'block';
      if (btnText) btnText.textContent = 'Tugaskan Driver';
      if (confirmBtn) confirmBtn.style.background = '#fa3e3e';
    }
  }
  window.switchBMDispatchMode = switchBMDispatchMode;

  async function openBMAssignDriverModal(orderId) {
    var modal = $('modal-bm-assign-driver');
    var idInput = $('bm-assign-order-id');
    var subtitle = $('bm-assign-driver-subtitle');
    var listContainer = $('bm-driver-list-container');
    var errorEl = $('bm-assign-error');
    var manualFields = $('bm-assign-manual-fields');
    var manualName = $('bm-assign-manual-name');
    var manualPhone = $('bm-assign-manual-phone');
    var btnText = $('bm-assign-btn-text');
    var confirmBtn = $('btn-bm-confirm-assign-driver');

    switchBMDispatchMode('manual');

    var ord = findBMOrderById(orderId);
    if (idInput) idInput.value = orderId;
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
    }
    if (subtitle) {
      var subText = formatBMOrderCode(ord);
      if (ord && ord.customer_name) subText += ' • ' + ord.customer_name;
      subtitle.textContent = subText;
    }
    if (manualFields) manualFields.style.display = 'none';
    if (manualName) manualName.value = '';
    if (manualPhone) manualPhone.value = '';
    if (btnText) btnText.textContent = 'Tugaskan Driver';
    if (confirmBtn) confirmBtn.disabled = false;

    if (modal) modal.style.display = 'flex';
    if (window.XentraNav && typeof window.XentraNav.push === 'function') {
      window.XentraNav.push(function () { closeBMAssignDriverModal({ fromNav: true }); }, 'modal-bm-assign-driver');
    }

    // Load branch drivers
    if (listContainer) {
      listContainer.innerHTML = '<p style="font-size:12px; color:#64748b; margin:0;">Memuat daftar driver...</p>';
    }

    try {
      var u = getStoredUser();
      var branchId = (ord && ord.branch_id) || (typeof window.getBMTargetBranchId === 'function' ? window.getBMTargetBranchId() : null) || (typeof currentBranchId === 'function' ? currentBranchId() : null) || (u ? (u.branch_id || u.branchId) : null) || window.__xentraCurrentBranchId;
      var url = API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/drivers';
      var res = await adminFetch(url, { cache: 'no-store', headers: getAuthHeaders() });
      var data = await res.json();

      if (res.ok && data && data.success) {
        _bmActiveBranchDrivers = data.drivers || [];
        renderBMDriverList(_bmActiveBranchDrivers, ord && ord.delivery && ord.delivery.driver_id);
      } else {
        if (listContainer) {
          listContainer.innerHTML = '<p style="font-size:12px; color:#e11d48; margin:0;">Gagal memuat driver cabang.</p>';
        }
      }
    } catch (err) {
      if (listContainer) {
        listContainer.innerHTML = '<p style="font-size:12px; color:#e11d48; margin:0;">Kesalahan koneksi memuat driver.</p>';
      }
    }
  }
  window.openBMAssignDriverModal = openBMAssignDriverModal;

  function renderBMDriverList(drivers, selectedDriverId) {
    var container = $('bm-driver-list-container');
    if (!container) return;

    if (!drivers || !drivers.length) {
      container.innerHTML =
        '<div style="background:#f8fafc; border:1px dashed #cbd5e1; border-radius:8px; padding:12px; text-align:center;">' +
          '<p style="font-size:12px; color:#64748b; margin:0 0 6px;">Belum ada driver aktif di cabang ini.</p>' +
          '<p style="font-size:11.5px; color:#94a3b8; margin:0;">Tambahkan akun Driver di menu Staff agar kurir memakai Driver App.</p>' +
        '</div>';
      return;
    }

    container.innerHTML = drivers.map(function (d, idx) {
      var isChecked = selectedDriverId ? (String(d.id) === String(selectedDriverId)) : (idx === 0);
      var taskBadge = d.active_tasks > 0
        ? '<span style="font-size:10.5px; background:#fef3c7; color:#b45309; padding:2px 6px; border-radius:4px; font-weight:600;">' + d.active_tasks + ' antar</span>'
        : '<span style="font-size:10.5px; background:#dcfce7; color:#15803d; padding:2px 6px; border-radius:4px; font-weight:600;">Siap antar</span>';

      return '<label style="display:flex; align-items:center; gap:10px; padding:8px 10px; background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; cursor:pointer;">' +
        '<input type="radio" name="bm_selected_driver" value="' + esc(d.id) + '" ' + (isChecked ? 'checked' : '') + ' style="accent-color:#fa3e3e; width:16px; height:16px;">' +
        '<div style="flex:1; min-width:0;">' +
          '<div style="display:flex; justify-content:space-between; align-items:center;">' +
            '<strong style="font-size:13px; color:#0f172a;">' + esc(d.name) + '</strong>' +
            taskBadge +
          '</div>' +
          '<div style="font-size:11.5px; color:#64748b; margin-top:2px;">' + esc(d.phone || 'Tanpa no. HP') + '</div>' +
        '</div>' +
      '</label>';
    }).join('');
  }

  function toggleBMManualDriverInput(forceShow) {
    var manualFields = $('bm-assign-manual-fields');
    if (!manualFields) return;
    var isHidden = manualFields.style.display === 'none';
    var shouldShow = (typeof forceShow === 'boolean') ? forceShow : isHidden;
    manualFields.style.display = shouldShow ? 'block' : 'none';

    // Deselect radio if showing manual
    if (shouldShow) {
      var radios = document.querySelectorAll('input[name="bm_selected_driver"]');
      radios.forEach(function (r) { r.checked = false; });
    }
  }
  window.toggleBMManualDriverInput = toggleBMManualDriverInput;

  function closeBMAssignDriverModal(options) {
    options = options || {};
    var modal = $('modal-bm-assign-driver');
    if (modal) modal.style.display = 'none';
    if (!options.fromNav && window.XentraNav && window.XentraNav.hasOpen('modal-bm-assign-driver')) {
      window.XentraNav.pop('modal-bm-assign-driver');
    }
  }
  window.closeBMAssignDriverModal = closeBMAssignDriverModal;

  async function submitBMAssignDriver(event) {
    if (event) event.preventDefault();
    var orderId = $('bm-assign-order-id') ? $('bm-assign-order-id').value : null;
    var errorEl = $('bm-assign-error');
    var btnText = $('bm-assign-btn-text');
    var confirmBtn = $('btn-bm-confirm-assign-driver');
    var mode = $('bm-assign-mode-val') ? $('bm-assign-mode-val').value : 'manual';

    if (!orderId) return;

    if (mode === 'auto') {
      if (errorEl) errorEl.style.display = 'none';
      if (confirmBtn) confirmBtn.disabled = true;
      if (btnText) btnText.textContent = 'Mencari Kurir...';
      try {
        var res = await adminFetch(API_BASE + '/admin/orders/' + encodeURIComponent(orderId) + '/auto-dispatch', {
          method: 'POST',
          headers: getAuthHeaders()
        });
        var data = await res.json();
        if (res.ok && data.success) {
          showToast('⚡ Auto-dispatch aktif: Kurir ' + (data.assigned_driver_name || 'cabang') + ' ditugaskan.');
          closeBMAssignDriverModal();
          loadBMOrders();
          if (typeof loadHariIni === 'function') loadHariIni();
          var detailView = $('bm-orders-detail-view');
          if (detailView && detailView.style.display !== 'none' && _bmOrdersState.currentDetailOrderId === orderId) {
            viewBMOrderDetail(orderId);
          }
        } else {
          if (errorEl) {
            errorEl.textContent = data.error || 'Gagal menjalankan auto-dispatch (kurir tidak tersedia atau offline).';
            errorEl.style.display = 'block';
          }
          if (confirmBtn) confirmBtn.disabled = false;
          if (btnText) btnText.textContent = '⚡ Jalankan Auto-Dispatch';
        }
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = 'Kesalahan jaringan saat auto-dispatch.';
          errorEl.style.display = 'block';
        }
        if (confirmBtn) confirmBtn.disabled = false;
        if (btnText) btnText.textContent = '⚡ Jalankan Auto-Dispatch';
      }
      return;
    }

    var selectedRadio = document.querySelector('input[name="bm_selected_driver"]:checked');
    var driverId = selectedRadio ? selectedRadio.value : null;
    var manualName = $('bm-assign-manual-name') ? $('bm-assign-manual-name').value.trim() : '';
    var manualPhone = $('bm-assign-manual-phone') ? $('bm-assign-manual-phone').value.trim() : '';

    var payload = {};
    if (driverId) {
      payload.driver_id = driverId;
      if (manualPhone) payload.driver_phone = manualPhone;
    } else {
      if (errorEl) {
        errorEl.textContent = 'Pilih salah satu akun Driver aktif cabang.';
        errorEl.style.display = 'block';
      }
      return;
    }

    if (errorEl) errorEl.style.display = 'none';
    if (confirmBtn) confirmBtn.disabled = true;
    if (btnText) btnText.textContent = 'Menugaskan...';

    try {
      var res = await adminFetch(API_BASE + '/admin/orders/' + encodeURIComponent(orderId) + '/assign-driver', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var data = await res.json();

      if (res.ok && data.success) {
        showToast('Driver berhasil ditugaskan.');
        closeBMAssignDriverModal();
        loadBMOrders();
        if (typeof loadHariIni === 'function') loadHariIni();
        var detailView = $('bm-orders-detail-view');
        if (detailView && detailView.style.display !== 'none' && _bmOrdersState.currentDetailOrderId === orderId) {
          viewBMOrderDetail(orderId);
        }
      } else {
        if (errorEl) {
          errorEl.textContent = data.error || 'Gagal menugaskan driver.';
          errorEl.style.display = 'block';
        }
      }
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = 'Kesalahan jaringan saat menugaskan driver.';
        errorEl.style.display = 'block';
      }
    } finally {
      if (confirmBtn) confirmBtn.disabled = false;
      if (btnText) btnText.textContent = 'Tugaskan Driver';
    }
  }
  window.submitBMAssignDriver = submitBMAssignDriver;

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

  function printBMReceipt(orderId, receiptType) {
    var ord = (_bmOrdersState.currentDetailOrder && String(_bmOrdersState.currentDetailOrder.id) === String(orderId))
      ? _bmOrdersState.currentDetailOrder
      : findBMOrderById(orderId);
    if (!ord) {
      showToast('Data pesanan tidak ditemukan untuk dicetak.');
      return;
    }
    var u = getStoredUser();
    var brandName = (u && u.brand_name) || 'Mybangjo Resto';
    var branchName = (u && u.branch_name) || '';
    var storeInfo = { name: brandName, branch: branchName };

    if (window.XentraPrinter) {
      if (receiptType === 'kitchen') {
        window.XentraPrinter.printKitchenTicket(ord, storeInfo);
        showToast('Tiket dapur dikirim ke printer.');
      } else {
        window.XentraPrinter.printOrder(ord, storeInfo);
        showToast('Struk kasir dikirim ke printer.');
      }
    } else {
      window.print();
    }
  }
  window.printBMReceipt = printBMReceipt;

  async function viewBMOrderDetail(orderId, options) {
    options = options || {};
    _bmOrdersState.currentDetailOrderId = orderId;
    var listView = $('bm-orders-list-view');
    var detailView = $('bm-orders-detail-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';
    bindOrderDetailSwipeGesture();

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
      _bmOrdersState.currentDetailOrder = ord;
      var ordType = getBMOrderType(ord);
      var typeLabel = ordType === 'dine_in' ? 'Dine-in' : (ordType === 'pickup' ? 'Pickup' : (ordType === 'delivery' ? 'Delivery' : 'Reservasi'));
      if ($('bm-detail-order-number')) $('bm-detail-order-number').textContent = formatBMOrderCode(ord);
      var isDeliveryInTransit = ordType === 'delivery' && ord.status === 'out_for_delivery';
      var driverVehicle = getBMDriverVehicle(ord.delivery && ord.delivery.driver_vehicle_type);
      if ($('bm-detail-status-badge')) {
        var detailStatusLabel = FulfillmentEnv && typeof FulfillmentEnv.getStatusLabel === 'function'
          ? FulfillmentEnv.getStatusLabel(ordType, ord.status)
          : String(ord.status || '').replace(/_/g, ' ');
        if (isDeliveryInTransit) detailStatusLabel = 'Sedang diantar kurir';
        $('bm-detail-status-badge').textContent = detailStatusLabel;
        $('bm-detail-status-badge').className = 'x-badge bm-detail-status-badge ' + (isDeliveryInTransit ? 'x-badge-info is-in-delivery' : (['completed', 'ready'].indexOf(ord.status) !== -1 ? 'x-badge-success' : (['rejected', 'cancelled', 'timeout', 'fulfillment_exception'].indexOf(ord.status) !== -1 ? 'x-badge-danger' : 'x-badge-warning')));
        $('bm-detail-status-badge').setAttribute('aria-label', detailStatusLabel);
        var statusWrap = document.querySelector('.bm-detail-nav-status-wrap');
        if (statusWrap) statusWrap.style.display = isDeliveryInTransit ? 'none' : '';
      }
      if ($('bm-detail-cust-name')) $('bm-detail-cust-name').textContent = ord.customer_name || 'Pelanggan';
      if ($('bm-detail-cust-phone')) $('bm-detail-cust-phone').textContent = ord.customer_phone || '—';
      if ($('bm-detail-fulfillment-badge')) {
        $('bm-detail-fulfillment-badge').textContent = typeLabel;
        var badgeCls = (ordType === 'dine_in' || ordType === 'dinein') ? 'dine_in' : ((ordType === 'pickup' || ordType === 'takeaway') ? 'takeaway' : (ordType === 'reservation' ? 'reservation' : 'delivery'));
        $('bm-detail-fulfillment-badge').className = 'channel-pill-badge ' + badgeCls;
      }
      if ($('bm-detail-order-time')) $('bm-detail-order-time').textContent = formatBMOrderFullDateTime(ord.created_at || ord.createdAt || ord.order_time);
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
          tableNumberEl.textContent = 'Meja ' + ord.table_number;
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
        $('bm-detail-pay-status').textContent = payMethod + ' • ' + payStatusText;
        if (pay.key === 'paid') {
          $('bm-detail-pay-status').style.background = '#f0fdf4';
          $('bm-detail-pay-status').style.color = '#15803d';
          $('bm-detail-pay-status').style.border = '1px solid #bbf7d0';
        } else if (pay.key === 'partial') {
          $('bm-detail-pay-status').style.background = '#fffbeb';
          $('bm-detail-pay-status').style.color = '#b45309';
          $('bm-detail-pay-status').style.border = '1px solid #fde68a';
        } else {
          $('bm-detail-pay-status').style.background = '#fef2f2';
          $('bm-detail-pay-status').style.color = '#dc2626';
          $('bm-detail-pay-status').style.border = '1px solid #fecaca';
        }
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
        var items = (ord.items || []).filter(function (item) { return !item.addition_batch_id; });
        var additions = ord.additions || [];
        if (!items.length && !additions.length) {
          itemsContainer.innerHTML = '<div class="text-center py-4 text-muted" style="font-size:13px;">Tidak ada menu dalam pesanan ini.</div>';
        } else {
          var itemsHtml = items.map(function (it, idx) {
            var sub = it.item_subtotal != null ? it.item_subtotal : ((it.unit_price || 0) * (it.quantity || 1));
            var noteHtml = it.note ? '<div class="bm-detail-item-note">Catatan: ' + esc(it.note) + '</div>' : '';
            return '<div class="bm-detail-item-row">' +
              '<span class="bm-detail-qty-badge">' + (it.quantity || 1) + 'x</span>' +
              '<div class="bm-detail-item-content">' +
                '<div class="bm-detail-item-title">' + esc(getBMOrderItemTitle(it)) + '</div>' +
                noteHtml +
              '</div>' +
              '<div class="bm-detail-item-price-col">' +
                '<div class="bm-detail-item-subtotal">' + formatMoney(sub) + '</div>' +
                ((Number(it.quantity || 1) > 1) ? '<div class="bm-detail-item-unit-price">@' + formatMoney(it.unit_price || 0) + '</div>' : '') +
              '</div>' +
            '</div>';
          }).join('');

          // Keep every member's batch visible after acceptance for staff audit.
          if (additions.length) {
            var additionsHtml = additions.map(function (addition) {
              var isPending = addition.status === 'pending_acceptance';
              var isRejected = addition.status === 'rejected';
              var isCancelled = addition.status === 'cancelled';
              var cardBg = isPending ? '#fff7ed' : (isRejected ? '#fff1f2' : (isCancelled ? '#f1f5f9' : '#f0fdf4'));
              var cardBorder = isPending ? '#fed7aa' : (isRejected ? '#fecdd3' : (isCancelled ? '#cbd5e1' : '#bbf7d0'));
              var statusLabel = isPending ? 'MENUNGGU DITERIMA' : (isRejected ? 'DITOLAK' : (isCancelled ? 'DIBATALKAN' : 'DITERIMA'));
              var statusColor = isPending ? '#b45309' : (isRejected ? '#be123c' : (isCancelled ? '#475569' : '#15803d'));
              var header = '<div style="margin-top:10px; background:' + cardBg + '; border:1px solid ' + cardBorder + '; border-radius:12px; padding:12px 14px;">' +
                '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">' +
                  '<div><strong style="font-size:13px; color:#0f172a;">Tambahan #' + esc(addition.sequence_no) + '</strong> <span style="display:inline-block;margin-left:4px;padding:3px 8px;border-radius:6px;background:#fff;color:' + statusColor + ';font-size:10px;font-weight:800;border:1px solid ' + cardBorder + ';">' + statusLabel + '</span>' +
                    (addition.created_by_name ? '<div style="font-size:11.5px;color:#64748b;margin-top:3px;">Dikirim oleh ' + esc(addition.created_by_name) + '</div>' : '') +
                  '</div>' +
                  (isPending ? '<div style="display:flex; gap:6px;">' +
                    '<button type="button" class="x-btn-primary" style="font-size:11.5px; padding:6px 12px; border-radius:8px;" onclick="decideBMOrderAddition(\'' + esc(ord.id) + '\',\'' + esc(addition.id) + '\',\'accept\')">Terima</button>' +
                    '<button type="button" class="x-btn-secondary" style="font-size:11.5px; padding:6px 12px; border-radius:8px; color:#dc2626; border-color:#fecaca;" onclick="decideBMOrderAddition(\'' + esc(ord.id) + '\',\'' + esc(addition.id) + '\',\'reject\')">Tolak</button>' +
                  '</div>' : '') +
                '</div>';
              var subItemsHtml = (addition.items || []).map(function (it) {
                var sub = it.subtotal != null ? it.subtotal : ((it.unit_price || 0) * (it.quantity || 1));
                var noteHtml = it.note ? '<div style="font-size:11.5px; color:#d97706;">Catatan: ' + esc(it.note) + '</div>' : '';
                return '<div style="display:flex; justify-content:space-between; font-size:13px; padding:4px 0;">' +
                  '<div>↳ ' + esc(it.name || it.product_name || it.product_id) + ' x' + (it.quantity || 1) + noteHtml + '</div>' +
                  '<strong>' + formatMoney(sub) + '</strong>' +
                '</div>';
              }).join('');
              var rejectionReason = (isRejected || isCancelled) && addition.rejection_reason
                ? '<div style="margin-top:6px;font-size:11.5px;color:#9f1239;">Alasan: ' + esc(addition.rejection_reason) + '</div>'
                : '';
              return header + subItemsHtml + rejectionReason + '</div>';
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
          logsList.innerHTML = '<span class="text-muted" style="font-size:12px;">Belum ada riwayat status.</span>';
        } else {
          logsList.innerHTML = '<div class="bm-detail-timeline">' + logs.map(function (l) {
            var time = l.created_at ? new Date(l.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—';
            var statusNice = String(l.new_status || '').replace(/_/g, ' ').toUpperCase();
            return '<div class="bm-detail-timeline-step">' +
              '<div class="bm-detail-timeline-dot"></div>' +
              '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">' +
                '<div>' +
                  '<div style="font-weight:700; font-size:12.5px; color:#0f172a;">' + esc(statusNice) + '</div>' +
                  (l.note ? '<div style="font-size:11.5px; color:#64748b; margin-top:2px;">' + esc(l.note) + '</div>' : '') +
                '</div>' +
                '<span style="font-size:11px; font-weight:600; color:#94a3b8; white-space:nowrap;">' + time + ' WIB</span>' +
              '</div>' +
            '</div>';
          }).join('') + '</div>';
        }
      }

      // Action buttons in detail
      var topActions = $('bm-detail-actions-top');
      if (topActions) {
        if (ordType === 'reservation' && ord.status === 'confirmed') {
          topActions.style.display = 'flex';
          topActions.innerHTML =
            '<div style="width:100%; text-align:center; padding:10px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; font-size:13px; font-weight:700; color:#1d4ed8;">📅 Reservasi terjadwal — Check-in / No-show dieksekusi oleh Kasir POS saat tamu datang.</div>';
        } else if (ord.status === 'pending') {
          var isAccepting = !!_bmOrdersState.inFlightAccept[ord.id];
          topActions.style.display = 'flex';
          topActions.innerHTML =
            '<button type="button" class="x-btn-primary" style="flex:1; min-height:46px; padding:12px 16px; font-size:14px; font-weight:700; background:#16a34a; border-color:#16a34a; border-radius:12px; justify-content:center;" ' + (isAccepting ? 'disabled' : '') + ' onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'pending\', \'' + esc(ordType) + '\', this);">Terima</button>' +
            '<button type="button" class="x-btn-secondary" style="min-height:46px; padding:12px 18px; font-size:14px; font-weight:700; color:#dc2626; border-color:#fecaca; border-radius:12px; justify-content:center;" ' + (isAccepting ? 'disabled' : '') + ' onclick="rejectBMOrder(\'' + esc(ord.id) + '\');">Tolak</button>';
        } else if (ord.status === 'confirmed' || ord.status === 'preparing' || ord.status === 'ready') {
          var act = getBMActionButton(ord, null);
          if (act) {
            var actCls = 'bm-pesanan-action-btn ' + (act.cls || 'btn-green');
            topActions.style.display = 'flex';
            topActions.style.flexDirection = 'column';
            topActions.style.gap = '6px';
            var mainBtnHtml = '';
            if (act.action === 'detail') {
              mainBtnHtml =
                '<button type="button" class="' + actCls + '" style="width:100%; min-height:46px; padding:12px 18px; font-size:14.5px; font-weight:700; border-radius:12px; justify-content:center;" onclick="var el=document.getElementById(\'bm-detail-items-container\')||document.getElementById(\'bm-detail-items-tbody\'); if(el) el.scrollIntoView({behavior:\'smooth\'});">' +
                esc(act.label) + '</button>';
            } else if (act.action === 'none') {
              mainBtnHtml =
                '<button type="button" class="' + actCls + '" style="width:100%; min-height:46px; padding:12px 18px; font-size:14.5px; font-weight:700; border-radius:12px; justify-content:center; cursor:not-allowed; opacity:.85;" disabled>' +
                esc(act.label) + '</button>';
            } else if (act.action === 'assign_driver') {
              mainBtnHtml =
                '<button type="button" class="' + actCls + '" style="width:100%; min-height:46px; padding:12px 18px; font-size:14.5px; font-weight:700; border-radius:12px; justify-content:center;" onclick="openBMAssignDriverModal(\'' + esc(ord.id) + '\');">' +
                esc(act.label) + '</button>';
            } else {
              mainBtnHtml =
                '<button type="button" class="' + actCls + '" style="width:100%; min-height:46px; padding:12px 18px; font-size:14.5px; font-weight:700; border-radius:12px; justify-content:center;" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'' + esc(ord.status) + '\', \'' + esc(ordType) + '\', this);">' +
                esc(act.label) + '</button>';
            }
            var printRowHtml =
              '<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; width:100%;">' +
                '<button type="button" class="x-btn-secondary" style="height:42px; font-size:13.5px; font-weight:700; border-radius:12px; justify-content:center; gap:6px;" onclick="printBMReceipt(\'' + esc(ord.id) + '\', \'customer\');">' +
                  '🖨️ Cetak Struk' +
                '</button>' +
                '<button type="button" class="x-btn-secondary" style="height:42px; font-size:13.5px; font-weight:700; border-radius:12px; justify-content:center; gap:6px;" onclick="printBMReceipt(\'' + esc(ord.id) + '\', \'kitchen\');">' +
                  'Tiket Dapur' +
                '</button>' +
              '</div>';
            var cancelBtnHtml =
              '<button type="button" class="x-btn-secondary" style="width:100%; height:40px; font-size:13px; font-weight:700; color:#dc2626; border:1px solid #fecaca; background:#fff; border-radius:12px; justify-content:center;" onclick="openBMEmergencyCancelModal(\'' + esc(ord.id) + '\');">' +
              'Batalkan Pesanan (Darurat)' +
              '</button>';
            topActions.innerHTML = mainBtnHtml + printRowHtml + cancelBtnHtml;
          } else {
            topActions.style.display = 'none';
          }
        } else if (ord.status === 'out_for_delivery') {
          topActions.style.display = 'flex';
          topActions.style.flexDirection = 'column';
          topActions.style.gap = '8px';
          var courierName = ord.driver_name || (ord.delivery && ord.delivery.driver_name) || '';
          var vehicleMeta = ord.delivery && ord.delivery.driver_vehicle_type ? ' · ' + driverVehicle.label : '';
          var printRowHtmlDelivery =
            '<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; width:100%;">' +
              '<button type="button" class="x-btn-secondary" style="height:42px; font-size:13.5px; font-weight:700; border-radius:12px; justify-content:center; gap:6px;" onclick="printBMReceipt(\'' + esc(ord.id) + '\', \'customer\');">' +
                '🖨️ Cetak Struk' +
              '</button>' +
              '<button type="button" class="x-btn-secondary" style="height:42px; font-size:13.5px; font-weight:700; border-radius:12px; justify-content:center; gap:6px;" onclick="printBMReceipt(\'' + esc(ord.id) + '\', \'kitchen\');">' +
                'Tiket Dapur' +
              '</button>' +
            '</div>';
          topActions.innerHTML =
            '<div class="bm-delivery-progress-card" role="status" aria-live="polite">' +
              '<span class="bm-delivery-vehicle-icon" aria-hidden="true">' + driverVehicle.icon + '</span>' +
              '<span class="bm-delivery-progress-copy"><strong>Sedang diantar kurir</strong><small>' + esc(courierName || 'Driver') + esc(vehicleMeta) + '</small></span>' +
            '</div>' +
            printRowHtmlDelivery +
            '<button type="button" class="x-btn-secondary" style="width:100%; height:40px; font-size:13px; font-weight:700; color:#dc2626; border:1px solid #fecaca; background:#fff; border-radius:12px; justify-content:center;" onclick="openBMEmergencyCancelModal(\'' + esc(ord.id) + '\');">' +
              'Batalkan Pesanan (Darurat)' +
            '</button>';
        } else if (ord.status === 'completed' && ord.payment_method === 'cash' && ord.payment_status !== 'paid' && ordType === 'delivery') {
          topActions.style.display = 'flex';
          topActions.style.flexDirection = 'column';
          topActions.style.gap = '8px';
          var codAmt = Number(ord.grand_total || ord.subtotal || 0);
          topActions.innerHTML =
            '<div style="background:#fffbeb; border:1px solid #fde68a; border-radius:12px; padding:10px 12px; font-size:12px; font-weight:600; color:#b45309; text-align:center;">' +
              '💵 <strong>COD ' + formatMoney(codAmt) + '</strong> berada di tangan Kurir.<br><span style="font-size:11px; color:#92400e;">Setoran kas COD diserahterimakan dan dibukukan oleh Kasir via <strong>Aplikasi POS</strong>.</span>' +
            '</div>' +
            '<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; width:100%;">' +
              '<button type="button" class="x-btn-secondary" style="height:42px; font-size:13.5px; font-weight:700; border-radius:12px; justify-content:center; gap:6px;" onclick="printBMReceipt(\'' + esc(ord.id) + '\', \'customer\');">' +
                '🖨️ Cetak Struk' +
              '</button>' +
              '<button type="button" class="x-btn-secondary" style="height:42px; font-size:13.5px; font-weight:700; border-radius:12px; justify-content:center; gap:6px;" onclick="printBMReceipt(\'' + esc(ord.id) + '\', \'kitchen\');">' +
                'Tiket Dapur' +
              '</button>' +
            '</div>';
        } else if (ord.status === 'completed') {
          topActions.style.display = 'flex';
          topActions.style.flexDirection = 'column';
          topActions.style.gap = '8px';
          topActions.innerHTML =
            '<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; width:100%;">' +
              '<button type="button" class="x-btn-primary" style="height:44px; font-size:14px; font-weight:700; border-radius:12px; justify-content:center; gap:6px;" onclick="printBMReceipt(\'' + esc(ord.id) + '\', \'customer\');">' +
                '🖨️ Cetak Struk' +
              '</button>' +
              '<button type="button" class="x-btn-secondary" style="height:44px; font-size:13.5px; font-weight:700; border-radius:12px; justify-content:center; gap:6px;" onclick="printBMReceipt(\'' + esc(ord.id) + '\', \'kitchen\');">' +
              'Tiket Dapur' +
              '</button>' +
            '</div>';
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

  function bindOrderDetailSwipeGesture() {
    var detailView = $('bm-orders-detail-view');
    if (!detailView || detailView._hasSwipe) return;
    detailView._hasSwipe = true;

    var startX = 0;
    var startY = 0;
    var isSwiping = false;

    detailView.addEventListener('touchstart', function (e) {
      if (detailView.style.display === 'none' || !e.touches || e.touches.length !== 1) return;
      var touch = e.touches[0];
      var maxEdge = Math.max(48, window.innerWidth * 0.15);
      if (touch.clientX > maxEdge) return;
      startX = touch.clientX;
      startY = touch.clientY;
      isSwiping = false;
      detailView.style.transition = 'none';
    }, { passive: true });

    detailView.addEventListener('touchmove', function (e) {
      if (startX === 0 || !e.touches || e.touches.length !== 1) return;
      var touch = e.touches[0];
      var deltaX = touch.clientX - startX;
      var deltaY = touch.clientY - startY;

      if (!isSwiping) {
        if (deltaX > 8 && deltaX > Math.abs(deltaY) * 1.2) {
          isSwiping = true;
        } else if (Math.abs(deltaY) > 8) {
          startX = 0;
          return;
        }
      }

      if (isSwiping && deltaX > 0) {
        detailView.style.transform = 'translateX(' + Math.max(0, deltaX) + 'px)';
      }
    }, { passive: true });

    detailView.addEventListener('touchend', function (e) {
      if (!isSwiping) {
        startX = 0;
        return;
      }
      isSwiping = false;
      var touch = (e.changedTouches && e.changedTouches[0]);
      var endX = touch ? touch.clientX : startX;
      var deltaX = endX - startX;
      startX = 0;

      if (deltaX > Math.min(window.innerWidth * 0.35, 110)) {
        detailView.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
        detailView.style.transform = 'translateX(' + window.innerWidth + 'px)';
        setTimeout(function () {
          detailView.style.transform = '';
          detailView.style.transition = '';
          closeBMOrderDetail();
        }, 220);
      } else {
        detailView.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
        detailView.style.transform = 'translateX(0)';
        setTimeout(function () {
          detailView.style.transform = '';
          detailView.style.transition = '';
        }, 200);
      }
    }, { passive: true });
  }

  function closeBMOrderDetail(options) {
    options = options || {};
    _bmOrdersState.currentDetailOrderId = null;
    _bmOrdersState.currentDetailOrder = null;
    if (_bmOrdersState.detailCountdownTimer) {
      clearInterval(_bmOrdersState.detailCountdownTimer);
      _bmOrdersState.detailCountdownTimer = null;
    }
    var listView = $('bm-orders-list-view');
    var detailView = $('bm-orders-detail-view');
    if (detailView) {
      detailView.style.transform = '';
      detailView.style.transition = '';
      detailView.style.display = 'none';
    }
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

  window.openOrderOpsChat = function (orderId) {
    var ord = _bmOrdersState && _bmOrdersState.currentDetailOrder;
    var targetId = orderId || (ord && (ord.id || ord.order_id));
    if (!targetId) {
      if (window.XentraOpsChat && typeof window.XentraOpsChat.openInbox === 'function') {
        window.XentraOpsChat.openInbox();
      }
      return;
    }
    var num = ord ? (ord.daily_sequence ? ('#' + ord.daily_sequence) : (ord.order_number || targetId)) : targetId;
    var title = 'Pesanan ' + num;
    var sub = ord ? ((ord.customer_name || 'Pelanggan') + ' · ' + (ord.order_type || 'Pesanan').toUpperCase()) : 'Koordinasi Pesanan';
    if (window.XentraOpsChat && typeof window.XentraOpsChat.openThread === 'function') {
      window.XentraOpsChat.openThread({
        threadType: 'order',
        refId: String(targetId),
        title: title,
        subtitle: sub
      });
    }
  };

  window.renderBMOrdersFeed = renderBMOrdersFeed;
  window.renderBMOrdersTable = renderBMOrdersFeed;

})();
