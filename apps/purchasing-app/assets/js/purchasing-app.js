/**
 * XENTRA PURCHASING APP — DEDICATED CONTROLLER
 * Pure standalone shopping controller for restaurant purchasing staff.
 * Route: m.<clientdomain>/belanja
 */
(function () {
  'use strict';

  var API_BASE = '';
  var _currentPurchasingView = 'tasks';

  function $(id) {
    return document.getElementById(id);
  }

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatMoney(amount) {
    var num = Math.round(Number(amount) || 0);
    return 'Rp ' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function formatNumberWithDots(val) {
    var num = Math.round(Number(val) || 0);
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function formatNominal(val) {
    var num = Number(val) || 0;
    if (Number.isInteger(num)) return num.toString();
    return num.toFixed(2).replace(/\.?0+$/, '');
  }

  function showToast(msg) {
    var toast = $('purchasing-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'purchasing-toast';
      toast.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#0f172a; color:#fff; padding:10px 18px; border-radius:12px; font-weight:700; font-size:13px; z-index:9999; box-shadow:0 10px 25px rgba(0,0,0,0.3); transition:all 0.25s ease; max-width:90%; text-align:center;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.display = 'block';
    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () { toast.style.display = 'none'; }, 250);
    }, 2800);
  }

  var TOKEN_KEY = 'xentra_merchant_token';
  var USER_KEY  = 'xentra_merchant_user';

  function getStoredToken() {
    return localStorage.getItem(TOKEN_KEY) ||
           sessionStorage.getItem(TOKEN_KEY) ||
           localStorage.getItem('token') ||
           sessionStorage.getItem('token') ||
           localStorage.getItem('xentra_token') ||
           '';
  }

  function getStoredUser() {
    try {
      var raw = localStorage.getItem(USER_KEY) ||
                sessionStorage.getItem(USER_KEY) ||
                localStorage.getItem('user') ||
                sessionStorage.getItem('user');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function getAuthHeaders() {
    var token = getStoredToken();
    var headers = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    var user = getStoredUser();
    if (user && (user.brand_id || user.brandId)) {
      headers['X-Brand-Id'] = user.brand_id || user.brandId;
    }
    return headers;
  }

  function formatLocalDateWIB(date) {
    var d = date ? new Date(date) : new Date();
    try {
      var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(d);
      var y = parts.find(function(p){ return p.type === 'year'; }).value;
      var m = parts.find(function(p){ return p.type === 'month'; }).value;
      var day = parts.find(function(p){ return p.type === 'day'; }).value;
      return y + '-' + m + '-' + day;
    } catch (_) {
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    }
  }

  // State Management
  var _purchasingState = {
    items: [],
    allItems: [],
    cashAdvance: 0,
    dailyPettyCashLimit: 500000,
    activeMandateId: null,
    activeEditItem: null,
    pollInterval: null
  };

  function showPurchasingBottomBar() {
    var bar = $('purchasing-bottom-bar');
    if (bar && _currentPurchasingView === 'tasks') {
      bar.classList.remove('is-hidden');
      bar.style.display = 'flex';
    }
  }

  function hidePurchasingBottomBar() {
    var bar = $('purchasing-bottom-bar');
    if (bar) {
      bar.classList.add('is-hidden');
      bar.style.display = 'none';
    }
  }

  function getPurchasingBranchId() {
    var user = getStoredUser();
    var fromUser = user ? (user.branch_id || user.branchId || (user.branch && user.branch.id)) : null;
    var fromStorage = null;
    try {
      fromStorage = localStorage.getItem('xentra_branch_id') ||
                    localStorage.getItem('xentra_active_branch_id') ||
                    localStorage.getItem('selected_branch_id') ||
                    sessionStorage.getItem('xentra_branch_id');
    } catch (_) {}
    return fromUser || fromStorage || null;
  }
  window.getPurchasingBranchId = getPurchasingBranchId;

  /* =========================================================================
     1. CHECKLIST LOADER & RENDERER (TASKS VIEW)
     ========================================================================= */
  async function loadPurchasingChecklist() {
    var branchId = getPurchasingBranchId();
    if (!branchId) {
      try {
        var meRes = await fetch('/api/auth/merchant/me', { headers: getAuthHeaders() });
        var meData = await meRes.json();
        if (meData && meData.user && meData.user.branch_id) {
          branchId = meData.user.branch_id;
        }
      } catch (_) {}
    }
    if (!branchId) return;

    var container = $('purchasing-checklist-container');
    if (container) {
      container.innerHTML = '<div style="text-align:center; padding:32px 0; color:#64748b; font-weight:600;">Memuat daftar belanja pasar...</div>';
    }

    try {
      // 1. Cek Mandat Belanja Resmi dari Manager jika ada yang aktif
      var activeMandate = null;
      try {
        var mandateRes = await fetch('/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/mandates?status=RELEASED', {
          headers: getAuthHeaders()
        });
        var mandateData = await mandateRes.json();
        activeMandate = (mandateData.success && mandateData.mandates && mandateData.mandates.length > 0)
          ? mandateData.mandates[0]
          : null;
      } catch (_) {}

      var pendingItems = (activeMandate && activeMandate.items)
        ? activeMandate.items.filter(function (itm) { return !itm.is_purchased; })
        : [];

      if (activeMandate && pendingItems.length > 0) {
        _purchasingState.activeMandateId = activeMandate.id;
        _purchasingState.cashAdvance = Number(activeMandate.cash_advance || 0);

        var cashAdvanceInput = $('input-purchasing-cash-advance');
        if (cashAdvanceInput) {
          cashAdvanceInput.value = _purchasingState.cashAdvance > 0 ? formatNumberWithDots(_purchasingState.cashAdvance) : '';
          cashAdvanceInput.readOnly = true;
        }

        _purchasingState.items = pendingItems.map(function (itm) {
          var initialPrice = itm.actual_unit_price || itm.estimated_unit_price || itm.last_moving_avg_cost || 0;
          return {
            material_id: itm.material_id,
            material_name: itm.material_name,
            material_code: itm.material_code,
            base_uom_name: itm.base_uom_name,
            base_uom_code: itm.base_uom_code,
            current_stock: 0,
            minimum_quantity: 0,
            is_low: true,
            suggested_qty: itm.target_quantity,
            buyQty: itm.target_quantity,
            estimated_price: itm.estimated_unit_price || itm.last_moving_avg_cost || 0,
            actualUnitPrice: initialPrice,
            has_price_update: Boolean(itm.actual_unit_price && itm.actual_unit_price !== itm.estimated_unit_price),
            checked: true
          };
        });

        var totalPlanned = 0;
        _purchasingState.items.forEach(function (i) {
          totalPlanned += Math.round(i.buyQty * i.actualUnitPrice);
        });

        var estBudgetEl = $('label-purchasing-est-budget');
        if (estBudgetEl) estBudgetEl.textContent = formatMoney(activeMandate.total_planned_budget > 0 ? activeMandate.total_planned_budget : totalPlanned);

        renderPurchasingList();
        recalculatePurchasingSummary();
        return;
      }

      // 2. Jika belum ada mandat, muat real-time checklist stok menipis
      _purchasingState.activeMandateId = null;
      var chkRes = await fetch('/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/checklist', {
        headers: getAuthHeaders()
      });
      var chkData = await chkRes.json();

      if (chkRes.ok && chkData.success && chkData.items) {
        _purchasingState.dailyPettyCashLimit = (chkData.daily_petty_cash_limit != null) ? Number(chkData.daily_petty_cash_limit) : 500000;
        _purchasingState.allItems = chkData.items || [];
        populateMaterialsDatalist(_purchasingState.allItems);
        startPettyCashPolling(branchId);

        var rawItems = chkData.items || [];
        var lowItems = rawItems.filter(function (itm) { return itm.is_low; });

        _purchasingState.items = lowItems.map(function (itm) {
          var initialQty = (itm.suggested_qty && itm.suggested_qty > 0) ? itm.suggested_qty : 1;
          var initialPrice = itm.last_unit_cost || 0;
          return {
            material_id: itm.material_id,
            material_name: itm.material_name,
            material_code: itm.material_code,
            base_uom_name: itm.base_uom_name,
            base_uom_code: itm.base_uom_code,
            current_stock: itm.current_stock || 0,
            minimum_quantity: itm.minimum_quantity || 0,
            is_low: Boolean(itm.is_low),
            suggested_qty: initialQty,
            buyQty: initialQty,
            estimated_price: initialPrice,
            actualUnitPrice: initialPrice,
            has_price_update: false,
            checked: false
          };
        });

        _purchasingState.cashAdvance = 0;
        var cashAdvanceInput2 = $('input-purchasing-cash-advance');
        if (cashAdvanceInput2) {
          cashAdvanceInput2.value = '';
          cashAdvanceInput2.readOnly = false;
        }

        var estBudgetEl2 = $('label-purchasing-est-budget');
        if (estBudgetEl2) {
          estBudgetEl2.textContent = formatMoney(chkData.total_estimated_budget || 0);
        }

        renderPurchasingList();
        recalculatePurchasingSummary();
        return;
      }

      _purchasingState.activeMandateId = null;
      _purchasingState.items = [];
      _purchasingState.cashAdvance = 0;
      renderPurchasingList();
      recalculatePurchasingSummary();
    } catch (err) {
      console.error('[Purchasing] Fetch error:', err);
      if (container) {
        container.innerHTML = '<div style="text-align:center; padding:32px 0; color:#ef4444; font-weight:700;">Gangguan jaringan saat memuat catatan belanja.</div>';
      }
    }
  }

  function renderPurchasingList() {
    var container = $('purchasing-checklist-container');
    if (!container) return;

    var items = _purchasingState.items || [];
    var isMandate = Boolean(_purchasingState.activeMandateId);

    var countEl = $('purchasing-item-count');
    if (countEl) countEl.textContent = items.length;

    var titleEl = $('purchasing-list-title');
    if (titleEl) titleEl.textContent = isMandate ? 'Tugas Mandat Belanja' : 'Daftar Belanja Pasar';

    if (!items.length) {
      hidePurchasingBottomBar();
      container.innerHTML =
        '<div style="text-align:center; padding:44px 20px; background:#f8fafc; border-radius:16px; border:1px dashed #cbd5e1; margin-top:4px;">' +
          '<div style="font-size:42px; margin-bottom:12px;">✨</div>' +
          '<div style="font-size:15.5px; font-weight:800; color:#0f172a;">Semua Stok Bahan Baku Aman</div>' +
          '<div style="font-size:12.5px; color:#64748b; margin-top:6px; max-width:320px; margin-left:auto; margin-right:auto; line-height:1.5;">' +
            'Tidak ada bahan yang berada di bawah batas minimum saat ini.' +
          '</div>' +
          '<div style="margin-top:16px;">' +
            '<button type="button" class="x-btn-secondary" onclick="openPurchasingAddCustomItemModal()" style="font-size:12.5px; font-weight:700; padding:9px 18px; border-radius:10px; background:#fff; border:1px solid #cbd5e1; color:#0f172a; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">' +
              '<span style="color:#2563eb;">➕</span> Tambah Belanjaan Lain' +
            '</button>' +
          '</div>' +
        '</div>';
      return;
    }

    showPurchasingBottomBar();

    var html = '';
    items.forEach(function (item) {
      var isChecked = item.checked;
      var subtotal = Math.round(item.buyQty * item.actualUnitPrice);
      var uomCode = item.base_uom_code || item.base_uom_name || 'Unit';

      var priceHtml = '';
      if (item.has_price_update) {
        priceHtml =
          '<span style="color:#0f172a; font-weight:800;">@ ' + formatMoney(item.actualUnitPrice) + '</span>' +
          '<s class="purchasing-price-strikethrough">' + formatMoney(item.estimated_price) + '</s>' +
          '<span class="purchasing-price-badge">harga baru</span>';
      } else {
        priceHtml = '<span style="color:#64748b; font-size:12px;">(@ ' + formatMoney(item.actualUnitPrice) + ')</span>';
      }

      html +=
        '<div id="card-item-' + esc(item.material_id) + '" class="purchasing-item-card ' + (isChecked ? 'is-checked' : 'is-unchecked') + '" onclick="window.onPurchasingCardClick(event, \'' + esc(item.material_id) + '\')">' +
          '<div class="purchasing-item-main">' +
            '<div class="purchasing-item-check-col">' +
              '<div class="purchasing-custom-check" aria-hidden="true">' +
                '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
                  '<polyline points="2 6 4.5 9 10 3"></polyline>' +
                '</svg>' +
              '</div>' +
            '</div>' +
            '<div class="purchasing-item-info-col">' +
              '<div class="purchasing-item-header">' +
                '<span class="purchasing-item-name">' + esc(item.material_name) + '</span>' +
                '<div class="purchasing-item-subtotal-val">' + formatMoney(subtotal) + '</div>' +
              '</div>' +
              '<div class="purchasing-item-meta-row">' +
                '<div class="purchasing-item-meta-qty">' +
                  '<span>Beli:</span>&nbsp;<strong class="purchasing-item-qty-val">' + formatNominal(item.buyQty) + ' ' + esc(uomCode) + '</strong>&nbsp;' +
                  priceHtml +
                '</div>' +
                '<button type="button" class="purchasing-btn-price-update" onclick="event.stopPropagation(); window.openPurchasingUpdatePriceModal(\'' + esc(item.material_id) + '\')">' +
                  '<span>✏️</span> <span>Harga Baru</span>' +
                '</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    });

    container.innerHTML = html;
  }

  function onPurchasingCardClick(event, materialId) {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON' || event.target.closest('button')) {
      return;
    }
    var itm = _purchasingState.items.find(function (i) { return i.material_id === materialId; });
    if (itm) {
      itm.checked = !itm.checked;
      renderPurchasingList();
      recalculatePurchasingSummary();
    }
  }
  window.onPurchasingCardClick = onPurchasingCardClick;

  function onPurchasingCashAdvanceInput(inputEl) {
    if (!inputEl) return;
    var rawDigits = String(inputEl.value || '').replace(/\D/g, '');
    var num = parseInt(rawDigits, 10) || 0;
    _purchasingState.cashAdvance = num;
    inputEl.value = num > 0 ? formatNumberWithDots(num) : '';
    recalculatePurchasingSummary();
  }
  window.onPurchasingCashAdvanceInput = onPurchasingCashAdvanceInput;

  function recalculatePurchasingSummary() {
    var cashAdvanceInput = $('input-purchasing-cash-advance');
    var rawCashDigits = cashAdvanceInput ? String(cashAdvanceInput.value || '').replace(/\D/g, '') : '';
    var cashAdvance = parseFloat(rawCashDigits || 0);
    _purchasingState.cashAdvance = cashAdvance;

    var totalReal = 0;
    _purchasingState.items.forEach(function (itm) {
      if (itm.checked) {
        totalReal += Math.round(itm.buyQty * itm.actualUnitPrice);
      }
    });

    var changeDue = cashAdvance - totalReal;

    var totalRealEl = $('label-purchasing-total-real');
    if (totalRealEl) totalRealEl.textContent = formatMoney(totalReal);

    var changeDueEl = $('label-purchasing-change-due');
    if (changeDueEl) {
      if (cashAdvance > 0) {
        if (changeDue >= 0) {
          changeDueEl.textContent = formatMoney(changeDue);
          changeDueEl.style.color = '#059669';
        } else {
          changeDueEl.textContent = 'Kurang ' + formatMoney(Math.abs(changeDue));
          changeDueEl.style.color = '#dc2626';
        }
      } else {
        changeDueEl.textContent = 'Rp 0';
        changeDueEl.style.color = '#64748b';
      }
    }

    var submitBtn = $('btn-purchasing-submit-settle');
    if (submitBtn) {
      var hasChecked = _purchasingState.items.some(function (i) { return i.checked && i.buyQty > 0; });
      submitBtn.disabled = !hasChecked;
      submitBtn.style.opacity = !hasChecked ? '0.5' : '1';
    }
  }

  /* =========================================================================
     2. MODAL UPDATE HARGA PASAR & JUMLAH BELI
     ========================================================================= */
  function openPurchasingUpdatePriceModal(materialId) {
    var itm = _purchasingState.items.find(function (i) { return i.material_id === materialId; });
    if (!itm) return;
    _purchasingState.activeEditItem = itm;

    var nameEl = $('purchasing-update-price-item-name');
    var uomEl = $('purchasing-update-price-item-uom');
    var oldPriceEl = $('purchasing-update-price-old-price');
    var qtyIn = $('input-purchasing-modal-qty');
    var uomSuffix = $('purchasing-update-price-modal-uom-suffix');
    var priceIn = $('input-purchasing-modal-price');
    var modal = $('modal-purchasing-update-price');

    var uomText = itm.base_uom_code || itm.base_uom_name || 'unit';
    if (nameEl) nameEl.textContent = itm.material_name;
    if (uomEl) uomEl.textContent = 'per ' + uomText;
    if (oldPriceEl) oldPriceEl.textContent = formatMoney(itm.estimated_price || itm.actualUnitPrice || 0) + ' / ' + uomText;
    if (uomSuffix) uomSuffix.textContent = uomText;
    if (qtyIn) qtyIn.value = itm.buyQty;
    if (priceIn) {
      var initialNum = itm.actualUnitPrice || 0;
      priceIn.value = initialNum > 0 ? formatNumberWithDots(initialNum) : '';
      setTimeout(function () { priceIn.focus(); priceIn.select(); }, 60);
    }
    if (modal) modal.style.display = 'flex';
  }
  window.openPurchasingUpdatePriceModal = openPurchasingUpdatePriceModal;

  function closePurchasingUpdatePriceModal() {
    var modal = $('modal-purchasing-update-price');
    if (modal) modal.style.display = 'none';
    _purchasingState.activeEditItem = null;
  }
  window.closePurchasingUpdatePriceModal = closePurchasingUpdatePriceModal;

  function confirmPurchasingPriceUpdate() {
    if (!_purchasingState.activeEditItem) return;
    var itm = _purchasingState.activeEditItem;
    var qtyIn = $('input-purchasing-modal-qty');
    var priceIn = $('input-purchasing-modal-price');

    var newQty = qtyIn ? parseFloat(qtyIn.value) : itm.buyQty;
    if (isNaN(newQty) || newQty <= 0) {
      showToast('⚠️ Masukkan jumlah (qty) yang valid (harus lebih dari 0).');
      return;
    }

    var rawDigits = priceIn ? String(priceIn.value || '').replace(/\D/g, '') : '';
    var newPrice = parseFloat(rawDigits || 0);

    if (isNaN(newPrice) || newPrice <= 0) {
      showToast('⚠️ Masukkan nominal harga pasar yang valid (harus lebih dari Rp 0).');
      return;
    }

    itm.buyQty = newQty;
    itm.actualUnitPrice = newPrice;
    itm.has_price_update = true;
    closePurchasingUpdatePriceModal();
    renderPurchasingList();
    recalculatePurchasingSummary();
    showToast('✓ Data barang belanja diperbarui.');
  }
  window.confirmPurchasingPriceUpdate = confirmPurchasingPriceUpdate;

  function startPettyCashPolling(branchId) {
    if (_purchasingState.pollInterval) clearInterval(_purchasingState.pollInterval);
    _purchasingState.pollInterval = setInterval(async function () {
      if (!branchId || document.visibilityState === 'hidden') return;
      try {
        var res = await fetch('/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/checklist', {
          headers: getAuthHeaders()
        });
        var data = await res.json();
        if (res.ok && data.success && data.daily_petty_cash_limit != null) {
          var newLimit = Number(data.daily_petty_cash_limit);
          var prevLimit = Number(_purchasingState.dailyPettyCashLimit || 500000);
          if (newLimit !== prevLimit) {
            _purchasingState.dailyPettyCashLimit = newLimit;
            recalculatePurchasingSummary();
          }
        }
      } catch (_) {}
    }, 10000);
  }

  function populateMaterialsDatalist(allItems) {
    var datalist = $('datalist-purchasing-materials');
    if (!datalist || !allItems) return;
    datalist.innerHTML = allItems.map(function (itm) {
      return '<option value="' + esc(itm.material_name) + '">';
    }).join('');
  }

  function openPurchasingAddCustomItemModal() {
    var modal = $('modal-purchasing-add-custom-item');
    if (!modal) return;
    var nameIn = $('input-purchasing-add-name');
    var qtyIn = $('input-purchasing-add-qty');
    var uomIn = $('input-purchasing-add-uom');
    var priceIn = $('input-purchasing-add-price');
    if (nameIn) nameIn.value = '';
    if (qtyIn) qtyIn.value = '1';
    if (uomIn) uomIn.value = 'Pcs';
    if (priceIn) priceIn.value = '';
    modal.style.display = 'flex';
    setTimeout(function () { if (nameIn) nameIn.focus(); }, 60);
  }
  window.openPurchasingAddCustomItemModal = openPurchasingAddCustomItemModal;

  function closePurchasingAddCustomItemModal() {
    var modal = $('modal-purchasing-add-custom-item');
    if (modal) modal.style.display = 'none';
  }
  window.closePurchasingAddCustomItemModal = closePurchasingAddCustomItemModal;

  function confirmPurchasingAddCustomItem() {
    var nameIn = $('input-purchasing-add-name');
    var qtyIn = $('input-purchasing-add-qty');
    var uomIn = $('input-purchasing-add-uom');
    var priceIn = $('input-purchasing-add-price');

    var name = nameIn ? nameIn.value.trim() : '';
    var qty = qtyIn ? parseFloat(qtyIn.value || 0) : 0;
    var uom = uomIn ? uomIn.value.trim() || 'Pcs' : 'Pcs';
    var rawPriceDigits = priceIn ? String(priceIn.value || '').replace(/\D/g, '') : '';
    var price = parseFloat(rawPriceDigits || 0);

    if (!name) {
      showToast('⚠️ Masukkan nama barang belanjaan.');
      return;
    }
    if (qty <= 0) {
      showToast('⚠️ Kuantitas harus lebih dari 0.');
      return;
    }
    if (price < 0) {
      showToast('⚠️ Harga satuan tidak boleh negatif.');
      return;
    }

    var matched = (_purchasingState.allItems || []).find(function (m) {
      return m.material_name && m.material_name.toLowerCase() === name.toLowerCase();
    });

    var matId = matched ? matched.material_id : ('mat_adhoc_' + Date.now());
    var matCode = matched ? matched.material_code : 'ADHOC';

    _purchasingState.items.push({
      material_id: matId,
      material_name: name,
      material_code: matCode,
      base_uom_name: uom,
      base_uom_code: uom,
      current_stock: matched ? (matched.current_stock || 0) : 0,
      minimum_quantity: 0,
      is_low: false,
      is_adhoc: !matched,
      suggested_qty: qty,
      buyQty: qty,
      estimated_price: price,
      actualUnitPrice: price,
      has_price_update: false,
      checked: true
    });

    closePurchasingAddCustomItemModal();
    renderPurchasingList();
    recalculatePurchasingSummary();
    showToast('✓ Belanjaan lain ditambahkan: ' + name);
  }
  window.confirmPurchasingAddCustomItem = confirmPurchasingAddCustomItem;

  /* =========================================================================
     3. SETTLEMENT BELANJA PASAR
     ========================================================================= */
  var _pendingSettlePayload = null;

  function submitPurchasingSettle() {
    var branchId = getPurchasingBranchId();
    if (!branchId) return;

    var checkedItems = _purchasingState.items.filter(function (i) { return i.checked && i.buyQty > 0; });
    if (!checkedItems.length) {
      showToast('⚠️ Pilih minimal satu barang yang dibeli.');
      return;
    }

    // Validasi agar tidak ada item dengan harga Rp 0
    var zeroPriceItem = checkedItems.find(function (itm) { return !itm.actualUnitPrice || itm.actualUnitPrice <= 0; });
    if (zeroPriceItem) {
      showToast('⚠️ Masukkan harga pasar untuk "' + zeroPriceItem.material_name + '".');
      openPurchasingUpdatePriceModal(zeroPriceItem.material_id);
      return;
    }

    var cashAdvance = _purchasingState.cashAdvance;
    var totalReal = 0;
    var lines = checkedItems.map(function (itm) {
      var lineTot = Math.round(itm.buyQty * itm.actualUnitPrice);
      totalReal += lineTot;
      return {
        material_id: itm.material_id,
        quantity: itm.buyQty,
        unit_price: itm.actualUnitPrice
      };
    });

    if (totalReal <= 0) {
      showToast('⚠️ Total nilai belanja harus lebih dari Rp 0.');
      return;
    }

    var changeDue = cashAdvance - totalReal;
    var totalItemsCount = _purchasingState.items.length;
    var unboughtCount = totalItemsCount - checkedItems.length;

    _pendingSettlePayload = {
      branchId: branchId,
      mandate_id: _purchasingState.activeMandateId,
      cash_advance: cashAdvance,
      items: lines,
      notes: 'Belanja Pasar'
    };

    var modal = $('modal-purchasing-settle-confirm');
    if (!modal) {
      executePurchasingSettle();
      return;
    }

    var totalEl = $('settle-confirm-total-real');
    var cashEl = $('settle-confirm-cash-advance');
    var changeLabel = $('settle-confirm-change-label');
    var changeEl = $('settle-confirm-change-due');
    var sumEl = $('settle-confirm-items-summary');
    var listEl = $('settle-confirm-items-list');

    if (totalEl) totalEl.textContent = formatMoney(totalReal);
    if (cashEl) cashEl.textContent = formatMoney(cashAdvance);
    if (changeLabel) {
      if (cashAdvance > 0) {
        changeLabel.textContent = changeDue >= 0 ? 'Sisa Kembalian:' : 'Uang Kurang:';
        changeLabel.style.color = changeDue >= 0 ? '#166534' : '#b91c1c';
      } else {
        changeLabel.textContent = 'Status Kasbon:';
        changeLabel.style.color = '#475569';
      }
    }
    if (changeEl) {
      if (cashAdvance > 0) {
        changeEl.textContent = changeDue >= 0 ? formatMoney(changeDue) : '- ' + formatMoney(Math.abs(changeDue));
        changeEl.style.color = changeDue >= 0 ? '#059669' : '#dc2626';
      } else {
        changeEl.textContent = 'Tanpa Kasbon';
        changeEl.style.color = '#64748b';
      }
    }

    if (sumEl) {
      var sumHtml = '<strong>• Terbeli: ' + checkedItems.length + ' item</strong>';
      if (unboughtCount > 0) {
        sumHtml += '<br><span style="color:#b45309;">• Belum Terbeli: ' + unboughtCount + ' item (tetap butuh belanja)</span>';
      }
      sumEl.innerHTML = sumHtml;
    }

    if (listEl) {
      listEl.innerHTML = checkedItems.map(function (itm) {
        var subTot = Math.round(itm.buyQty * itm.actualUnitPrice);
        var itmName = itm.material_name || itm.name || 'Bahan Baku';
        var itmUom = itm.base_uom_name || itm.base_uom_code || itm.uom || 'Unit';
        return (
          '<div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; border:1px solid #f1f5f9; padding:7px 10px; border-radius:8px; font-size:12px;">' +
            '<div>' +
              '<strong style="color:#0f172a;">' + esc(itmName) + '</strong>' +
              '<div style="font-size:11px; color:#64748b;">' + formatNominal(itm.buyQty) + ' ' + esc(itmUom) + ' @ ' + formatMoney(itm.actualUnitPrice) + '</div>' +
            '</div>' +
            '<strong style="color:#0f172a; font-size:12px;">' + formatMoney(subTot) + '</strong>' +
          '</div>'
        );
      }).join('');
    }

    modal.style.display = 'flex';
  }
  window.submitPurchasingSettle = submitPurchasingSettle;

  function closePurchasingSettleConfirmModal() {
    var modal = $('modal-purchasing-settle-confirm');
    if (modal) modal.style.display = 'none';
    _pendingSettlePayload = null;
  }
  window.closePurchasingSettleConfirmModal = closePurchasingSettleConfirmModal;

  async function executePurchasingSettle() {
    if (!_pendingSettlePayload) return;

    var confirmBtn = $('btn-purchasing-confirm-settle-ok');
    var submitBtn = $('btn-purchasing-submit-settle');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span>⏳</span> Menyimpan...';
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Menyimpan...';
    }

    var payload = _pendingSettlePayload;

    try {
      var res = await fetch('/admin/branches/' + encodeURIComponent(payload.branchId) + '/purchasing/settle', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          mandate_id: payload.mandate_id,
          cash_advance: payload.cash_advance,
          items: payload.items,
          notes: payload.notes || 'Belanja Pasar'
        })
      });
      var data = await res.json();

      if (res.ok && data.success) {
        closePurchasingSettleConfirmModal();
        showToast('🛒 Belanja berhasil dicatat! Stok bahan baku telah ditambahkan.');
        var cashInput = $('input-purchasing-cash-advance');
        if (cashInput) cashInput.value = '';
        _purchasingState.cashAdvance = 0;
        await loadPurchasingChecklist();
        if (typeof loadPurchasingHistory === 'function') {
          loadPurchasingHistory();
        }
      } else {
        showToast('Gagal mencatat belanja: ' + (data.message || data.error || 'Terjadi kesalahan'));
      }
    } catch (err) {
      showToast('Gangguan jaringan saat menyelesaikan belanja.');
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<span>✓</span> Ya, Selesai Belanja';
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '✓ Selesai Belanja';
      }
    }
  }
  window.executePurchasingSettle = executePurchasingSettle;

  /* =========================================================================
     4. PO SUPPLIER & PENERIMAAN BARANG (GOODS RECEIPT)
     ========================================================================= */
  var _activePoOrders = [];
  var _activeReceivePo = null;
  var _pendingReceiveData = null;

  async function loadPurchasingOrders() {
    var branchId = getPurchasingBranchId();
    if (!branchId) return;

    var container = $('purchasing-orders-container');
    if (container) {
      container.innerHTML = '<div style="text-align:center; padding:32px 0; color:#64748b; font-weight:600;">Memuat daftar pesanan supplier...</div>';
    }

    try {
      var res = await fetch('/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/orders', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success) {
        _activePoOrders = data.orders || [];
        renderPurchasingOrders(_activePoOrders);
      } else {
        if (container) {
          container.innerHTML = '<div style="text-align:center; padding:32px 0; color:#ef4444;">Gagal memuat pesanan: ' + esc(data.message || 'Terjadi kesalahan') + '</div>';
        }
      }
    } catch (err) {
      if (container) {
        container.innerHTML = '<div style="text-align:center; padding:32px 0; color:#ef4444;">Gangguan jaringan saat memuat pesanan supplier.</div>';
      }
    }
  }
  window.loadPurchasingOrders = loadPurchasingOrders;

  function renderPurchasingOrders(orders) {
    var container = $('purchasing-orders-container');
    if (!container) return;

    if (!orders || !orders.length) {
      container.innerHTML =
        '<div style="text-align:center; padding:40px 20px; background:#fff; border-radius:14px; border:1px dashed #cbd5e1;">' +
          '<div style="font-size:36px; margin-bottom:8px;">📦</div>' +
          '<div style="font-size:15px; font-weight:800; color:#334155;">Tidak Ada PO Supplier Aktif</div>' +
          '<div style="font-size:12px; color:#64748b; margin-top:4px;">Semua pesanan supplier cabang telah diterima atau belum ada pesanan baru dari Manager.</div>' +
        '</div>';
      return;
    }

    container.innerHTML = orders.map(function (po) {
      var statusBadge = po.status === 'RECEIVED'
        ? '<span class="x-badge x-badge-success">DITERIMA</span>'
        : (po.status === 'PARTIALLY_RECEIVED'
          ? '<span class="x-badge x-badge-warning">SEBAGIAN</span>'
          : '<span class="x-badge x-badge-primary">' + esc(po.status) + '</span>');

      var canReceive = po.status === 'ISSUED' || po.status === 'SENT' || po.status === 'PARTIALLY_RECEIVED' || po.status === 'ORDERED';
      var lines = po.lines || po.items || [];

      var linesSummary = lines.map(function (line) {
        var qty = line.ordered_purchase_quantity || line.quantity_ordered || 0;
        var packName = line.supplier_pack_name || line.base_uom_name || line.base_uom_code || 'unit';
        return '<div style="font-size:12.5px; color:#334155; display:flex; justify-content:space-between; padding:3px 0;">' +
          '<span>' + esc(line.material_name) + '</span>' +
          '<strong>' + esc(qty) + ' ' + esc(packName) + '</strong>' +
        '</div>';
      }).join('');

      return (
        '<div class="purchasing-item-card" style="display:flex; flex-direction:column; gap:10px; padding:14px; border-radius:14px; border:1px solid #e2e8f0; background:#ffffff;">' +
          '<div style="display:flex; justify-content:space-between; align-items:flex-start;">' +
            '<div>' +
              '<div style="font-size:11px; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:0.04em;">PO #' + esc(po.po_number || po.order_number || String(po.id).slice(-6)) + '</div>' +
              '<div style="font-size:15px; font-weight:800; color:#0f172a; margin-top:2px;">' + esc(po.supplier_name || 'Supplier Resmi') + '</div>' +
            '</div>' +
            statusBadge +
          '</div>' +
          '<div style="background:#f8fafc; border-radius:10px; padding:8px 10px; border:1px solid #f1f5f9;">' +
            linesSummary +
          '</div>' +
          '<div style="display:flex; justify-content:space-between; align-items:center; border-top:1px dashed #e2e8f0; padding-top:10px;">' +
            '<div style="font-size:12px; color:#64748b;">Total: <strong style="color:#0f172a; font-size:13.5px;">' + formatMoney(po.total_amount || po.total_cost || 0) + '</strong></div>' +
            (canReceive ?
              '<button type="button" class="x-btn-primary" onclick="window.openPurchasingReceiveModal(\'' + esc(po.id) + '\')" style="padding:8px 14px; font-size:12.5px; font-weight:700; border-radius:10px; background:#059669; border-color:#059669;">' +
                '📦 Terima Barang' +
              '</button>' : '') +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function openPurchasingReceiveModal(poId) {
    var po = _activePoOrders.find(function (p) { return p.id === poId; });
    if (!po) return;
    _activeReceivePo = po;

    var modal = $('modal-purchasing-receive');
    var codeEl = $('purchasing-receive-code');
    var supplierEl = $('purchasing-receive-supplier');
    var body = $('purchasing-receive-body');

    if (codeEl) codeEl.textContent = 'PO #' + (po.po_number || po.order_number || String(po.id).slice(-6));
    if (supplierEl) supplierEl.textContent = po.supplier_name || 'Supplier Resmi';

    var rawLines = po.lines || po.items || [];
    if (body) {
      body.innerHTML = rawLines.map(function (line, idx) {
        var packDesc = line.supplier_pack_name || line.base_uom_name || line.base_uom_code || 'unit';
        var orderedQty = Number(line.ordered_purchase_quantity || line.quantity_ordered) || 0;
        var receivedQty = Number(line.received_base_quantity || line.quantity_received) || 0;
        var remainingQty = Math.max(0, orderedQty - receivedQty);
        if (remainingQty <= 0) remainingQty = orderedQty;

        var uomStr = ((line.base_uom_code || '') + ' ' + (line.base_uom_name || '') + ' ' + (line.supplier_pack_name || '')).toLowerCase();
        var isWeighable = line.allows_fraction === 1 ||
                          /^(kg|kilogram|g|gram|gr|l|liter|ml|ons)$/i.test(String(line.base_uom_code || line.base_uom_name || '').trim()) ||
                          /\b(kg|kilogram|gram|liter)\b/i.test(uomStr);
        var maxAllowedQty = isWeighable ? Math.round(orderedQty * 1.10 * 100) / 100 : orderedQty;
        var toleransiDesc = isWeighable
          ? 'Maksimal toleransi wajar +10% (hingga ' + maxAllowedQty + ' ' + esc(packDesc) + ')'
          : '0% (kemasan segel pasti)';

        var lineId = line.purchase_order_line_id || line.id || ('pol_' + idx);

        return (
          '<div class="purchasing-receive-line" data-pol-id="' + esc(lineId) + '" data-ordered-qty="' + orderedQty + '" data-max-qty="' + maxAllowedQty + '" data-is-weighable="' + (isWeighable ? '1' : '0') + '" data-pack-desc="' + esc(packDesc) + '">' +
            '<div style="font-size:14px; font-weight:800; color:#0f172a; margin-bottom:2px;">' + esc(line.material_name) + '</div>' +
            '<div style="font-size:12px; font-weight:600; color:#475569; margin-bottom:2px;">Dipesan: <strong style="color:#0f172a;">' + esc(orderedQty) + ' ' + esc(packDesc) + '</strong></div>' +
            '<div style="font-size:11.5px; font-weight:600; color:#64748b; margin-bottom:10px;">Toleransi: <span style="font-weight:700; color:' + (isWeighable ? '#15803d' : '#64748b') + ';">' + toleransiDesc + '</span></div>' +
            '<div class="purchasing-receive-grid">' +
              '<div class="purchasing-receive-field">' +
                '<label class="purchasing-receive-label label-accepted">Layak Terima</label>' +
                '<input type="number" inputmode="decimal" step="any" min="0" max="' + maxAllowedQty + '" class="x-input input-receive-accepted purchasing-receive-input" value="' + esc(remainingQty) + '" oninput="onPurchasingReceiveQtyChange(this, \'accepted\')">' +
              '</div>' +
              '<div class="purchasing-receive-field">' +
                '<label class="purchasing-receive-label label-rejected">Ditolak / Rusak</label>' +
                '<input type="number" inputmode="decimal" step="any" min="0" max="' + orderedQty + '" class="x-input input-receive-rejected purchasing-receive-input input-rejected" value="0" oninput="onPurchasingReceiveQtyChange(this, \'rejected\')">' +
              '</div>' +
            '</div>' +
            '<div class="purchasing-receive-status-hint">' +
              '<span style="font-weight:700; color:#475569;">Kondisi:</span>' +
              '<span class="receive-status-pill">✓ Lengkap & Baik</span>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    }

    if (modal) modal.style.display = 'flex';
    var notesEl = $('input-purchasing-receive-notes');
    if (notesEl) {
      notesEl.value = '';
      notesEl.placeholder = 'Contoh: 1 kemasan bocor di jalan, sisanya diterima baik.';
    }
    updatePurchasingReceiveModalCta();
  }
  window.openPurchasingReceiveModal = openPurchasingReceiveModal;

  function closePurchasingReceiveModal() {
    var modal = $('modal-purchasing-receive');
    if (modal) modal.style.display = 'none';
    _activeReceivePo = null;
  }
  window.closePurchasingReceiveModal = closePurchasingReceiveModal;

  function onPurchasingReceiveQtyChange(inputEl, changedField) {
    var lineCard = inputEl.closest('.purchasing-receive-line');
    if (!lineCard) return;

    var orderedQty = Number(lineCard.getAttribute('data-ordered-qty')) || 0;
    var maxAllowedQty = Number(lineCard.getAttribute('data-max-qty')) || orderedQty;
    var isWeighable = lineCard.getAttribute('data-is-weighable') === '1';
    var packDesc = lineCard.getAttribute('data-pack-desc') || 'unit';

    var acceptedInput = lineCard.querySelector('.input-receive-accepted');
    var rejectedInput = lineCard.querySelector('.input-receive-rejected');
    var statusPill = lineCard.querySelector('.receive-status-pill');

    var accepted = parseFloat(acceptedInput ? acceptedInput.value : 0) || 0;
    var rejected = parseFloat(rejectedInput ? rejectedInput.value : 0) || 0;

    if (changedField === 'accepted') {
      if (accepted < 0) { accepted = 0; if (acceptedInput) acceptedInput.value = 0; }
      if (accepted > maxAllowedQty) {
        accepted = maxAllowedQty;
        if (acceptedInput) acceptedInput.value = maxAllowedQty;
        showToast('⚠️ Batas toleransi timbangan basah maksimal ' + maxAllowedQty + ' ' + packDesc);
      }
      if (accepted > orderedQty) {
        rejected = 0;
        if (rejectedInput) rejectedInput.value = 0;
      } else {
        rejected = Math.max(0, orderedQty - accepted);
        if (rejectedInput) rejectedInput.value = rejected;
      }
    } else if (changedField === 'rejected') {
      if (rejected < 0) { rejected = 0; if (rejectedInput) rejectedInput.value = 0; }
      if (rejected > orderedQty) {
        rejected = orderedQty;
        if (rejectedInput) rejectedInput.value = orderedQty;
      }
      accepted = Math.max(0, orderedQty - rejected);
      if (acceptedInput) acceptedInput.value = accepted;
    }

    if (statusPill) {
      if (accepted > orderedQty) {
        var surplus = (accepted - orderedQty);
        var surplusStr = surplus % 1 === 0 ? surplus : surplus.toFixed(2).replace(/\.?0+$/, '');
        statusPill.textContent = '📦 Diterima Berlebih: +' + surplusStr + ' ' + packDesc;
        statusPill.style.color = '#0284c7';
      } else if (rejected > 0 && accepted > 0) {
        statusPill.textContent = '⚠️ ' + accepted + ' Layak, ' + rejected + ' Rusak/Retur';
        statusPill.style.color = '#b45309';
      } else if (rejected === orderedQty) {
        statusPill.textContent = '❌ Seluruh Barang Ditolak (' + rejected + ')';
        statusPill.style.color = '#dc2626';
      } else if (accepted === orderedQty && rejected === 0) {
        statusPill.textContent = '✓ Lengkap & Baik';
        statusPill.style.color = '#059669';
      } else {
        var shortage = Math.max(0, orderedQty - (accepted + rejected));
        statusPill.textContent = '⚠️ Kurang Kirim: ' + shortage;
        statusPill.style.color = '#b45309';
      }
    }

    updatePurchasingReceiveModalCta();
  }
  window.onPurchasingReceiveQtyChange = onPurchasingReceiveQtyChange;

  function updatePurchasingReceiveModalCta() {
    var btn = $('btn-submit-purchasing-receive');
    var container = $('purchasing-receive-body');
    if (!btn || !container) return;

    var lineEls = container.querySelectorAll('.purchasing-receive-line');
    var totalAccepted = 0;
    var totalRejected = 0;
    var hasOverReceived = false;

    lineEls.forEach(function (el) {
      var ord = Number(el.getAttribute('data-ordered-qty')) || 0;
      var accIn = el.querySelector('.input-receive-accepted');
      var rejIn = el.querySelector('.input-receive-rejected');
      var acc = Number(accIn ? accIn.value : 0) || 0;
      var rej = Number(rejIn ? rejIn.value : 0) || 0;
      totalAccepted += acc;
      totalRejected += rej;
      if (acc > ord) hasOverReceived = true;
    });

    if (totalAccepted === 0 && totalRejected > 0) {
      btn.textContent = '✕ Tolak Semua Barang';
      btn.style.background = '#dc2626';
      btn.style.borderColor = '#dc2626';
    } else if (hasOverReceived) {
      btn.textContent = '✓ Terima (Ada Berlebih)';
      btn.style.background = '#0284c7';
      btn.style.borderColor = '#0284c7';
    } else if (totalRejected > 0) {
      btn.textContent = '⚠️ Terima Sebagian';
      btn.style.background = '#d97706';
      btn.style.borderColor = '#d97706';
    } else {
      btn.textContent = '✓ Terima Barang';
      btn.style.background = '#059669';
      btn.style.borderColor = '#059669';
    }
  }

  function submitPurchasingReceive() {
    if (!_activeReceivePo) return;
    var branchId = getPurchasingBranchId();
    if (!branchId) return;

    var container = $('purchasing-receive-body');
    if (!container) return;

    var notesEl = $('input-purchasing-receive-notes');
    var notes = notesEl ? notesEl.value.trim() : '';

    var totalAccepted = 0;
    var totalRejected = 0;
    var hasOverReceived = false;
    var lines = [];
    var summaryItems = [];
    var lineEls = container.querySelectorAll('.purchasing-receive-line');

    lineEls.forEach(function (el) {
      var polId = el.getAttribute('data-pol-id');
      var ord = Number(el.getAttribute('data-ordered-qty')) || 0;
      var nameEl = el.querySelector('div');
      var name = nameEl ? nameEl.textContent : 'Bahan';
      var packDesc = el.getAttribute('data-pack-desc') || 'unit';
      var accIn = el.querySelector('.input-receive-accepted');
      var rejIn = el.querySelector('.input-receive-rejected');
      var accepted = Number(accIn ? accIn.value : 0);
      var rejected = Number(rejIn ? rejIn.value : 0);
      totalAccepted += accepted;
      totalRejected += rejected;
      if (accepted > ord) hasOverReceived = true;

      lines.push({
        purchase_order_line_id: polId,
        purchase_order_item_id: polId,
        accepted_purchase_quantity: accepted,
        quantity_received: accepted,
        rejected_purchase_quantity: rejected,
        quantity_rejected: rejected,
        rejection_reason: rejected > 0 ? (notes || 'Barang ditolak saat penerimaan') : null
      });

      var statusText = '';
      if (accepted > ord) {
        var diff = (accepted - ord);
        var diffStr = diff % 1 === 0 ? diff : diff.toFixed(2).replace(/\.?0+$/, '');
        statusText = '<span style="color:#0284c7; font-weight:700;">' + accepted + ' ' + esc(packDesc) + ' (+' + diffStr + ')</span>';
      } else if (accepted > 0 && rejected > 0) {
        statusText = '<span style="color:#b45309; font-weight:700;">' + accepted + ' Layak, ' + rejected + ' Rusak</span>';
      } else if (rejected === ord) {
        statusText = '<span style="color:#dc2626; font-weight:700;">Ditolak Semua (' + rejected + ' ' + esc(packDesc) + ')</span>';
      } else {
        statusText = '<span style="color:#059669; font-weight:700;">' + accepted + ' ' + esc(packDesc) + ' Baik</span>';
      }

      summaryItems.push(
        '<div class="purchasing-confirm-summary-item">' +
          '<div style="font-weight:700; color:#0f172a;">' + esc(name) + '</div>' +
          '<div>' + statusText + '</div>' +
        '</div>'
      );
    });

    if (totalAccepted === 0 && totalRejected > 0 && !notes) {
      showToast('⚠️ Catatan fisik wajib diisi jika seluruh barang ditolak.');
      if (notesEl) notesEl.focus();
      return;
    }

    _pendingReceiveData = {
      branchId: branchId,
      poId: _activeReceivePo.id,
      lines: lines,
      totalAccepted: totalAccepted,
      totalRejected: totalRejected,
      hasOverReceived: hasOverReceived,
      notes: notes
    };

    var confirmModal = $('modal-purchasing-receive-confirm');
    var iconEl = $('purchasing-confirm-icon');
    var titleEl = $('purchasing-confirm-title');
    var subtitleEl = $('purchasing-confirm-subtitle');
    var listEl = $('purchasing-confirm-summary-list');
    var notesBoxEl = $('purchasing-confirm-notes-preview');
    var notesTextEl = $('purchasing-confirm-notes-text');
    var execBtn = $('btn-execute-purchasing-receive');

    if (subtitleEl) {
      subtitleEl.textContent = 'PO #' + (_activeReceivePo.po_number || _activeReceivePo.order_number || String(_activeReceivePo.id).slice(-6)) + ' • ' + (_activeReceivePo.supplier_name || 'Supplier');
    }

    if (listEl) {
      listEl.innerHTML = summaryItems.join('');
    }

    if (notesBoxEl && notesTextEl) {
      if (notes) {
        notesTextEl.textContent = notes;
        notesBoxEl.style.display = 'block';
      } else {
        notesBoxEl.style.display = 'none';
      }
    }

    if (execBtn) {
      execBtn.disabled = false;
      if (totalAccepted === 0 && totalRejected > 0) {
        if (iconEl) iconEl.textContent = '❌';
        if (titleEl) titleEl.textContent = 'Konfirmasi Penolakan Barang';
        execBtn.textContent = '✕ Ya, Tolak Barang';
        execBtn.style.background = '#dc2626';
      } else if (hasOverReceived) {
        if (iconEl) iconEl.textContent = '📦';
        if (titleEl) titleEl.textContent = 'Konfirmasi Penerimaan Berlebih';
        execBtn.textContent = '✓ Ya, Terima Berlebih';
        execBtn.style.background = '#0284c7';
      } else if (totalRejected > 0) {
        if (iconEl) iconEl.textContent = '⚠️';
        if (titleEl) titleEl.textContent = 'Konfirmasi Penerimaan Sebagian';
        execBtn.textContent = '⚠️ Ya, Terima Sebagian';
        execBtn.style.background = '#d97706';
      } else {
        if (iconEl) iconEl.textContent = '✓';
        if (titleEl) titleEl.textContent = 'Konfirmasi Penerimaan Barang';
        execBtn.textContent = '✓ Ya, Simpan Keputusan';
        execBtn.style.background = '#059669';
      }
    }

    if (confirmModal) confirmModal.style.display = 'flex';
  }
  window.submitPurchasingReceive = submitPurchasingReceive;

  function closePurchasingReceiveConfirmModal() {
    var modal = $('modal-purchasing-receive-confirm');
    if (modal) modal.style.display = 'none';
  }
  window.closePurchasingReceiveConfirmModal = closePurchasingReceiveConfirmModal;

  async function executePurchasingReceiveSubmit() {
    if (!_pendingReceiveData) return;
    var dataPayload = _pendingReceiveData;

    var execBtn = $('btn-execute-purchasing-receive');
    if (execBtn) {
      execBtn.disabled = true;
      execBtn.textContent = 'Menyimpan ke Stok...';
    }

    try {
      var res = await fetch('/admin/branches/' + encodeURIComponent(dataPayload.branchId) + '/purchasing/orders/' + encodeURIComponent(dataPayload.poId) + '/receive', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          lines: dataPayload.lines,
          items: dataPayload.lines,
          notes: dataPayload.notes
        })
      });
      var data = await res.json();

      if (res.ok && data.success) {
        showToast('✓ Penerimaan barang berhasil dicatat! Mutasi stok telah diposting.');
        closePurchasingReceiveConfirmModal();
        closePurchasingReceiveModal();
        loadPurchasingOrders();
        _pendingReceiveData = null;
      } else {
        showToast('⚠️ Gagal konfirmasi: ' + (data.message || data.error || 'Periksa input barang'));
        if (execBtn) {
          execBtn.disabled = false;
          execBtn.textContent = 'Coba Lagi';
        }
      }
    } catch (e) {
      showToast('⚠️ Gangguan jaringan saat konfirmasi penerimaan.');
      if (execBtn) {
        execBtn.disabled = false;
        execBtn.textContent = 'Coba Lagi';
      }
    }
  }
  window.executePurchasingReceiveSubmit = executePurchasingReceiveSubmit;

  /* =========================================================================
     5. RIWAYAT BELANJA (HISTORY VIEW)
     ========================================================================= */
  var _purchasingHistorySessions = [];
  var _activeHistoryDateFilter = 'today';
  var _activeHistorySearchQuery = '';
  var _customHistoryDateFrom = '';
  var _customHistoryDateTo = '';

  async function loadPurchasingHistory(startDate, endDate) {
    var branchId = getPurchasingBranchId();
    if (!branchId) return;

    var container = $('purchasing-history-container');
    if (container && !_purchasingHistorySessions.length) {
      container.innerHTML = '<div style="text-align:center; padding:32px 0; color:#64748b; font-weight:600;">Memuat riwayat belanja...</div>';
    }

    var qs = '';
    if (startDate && endDate) {
      qs = '?start_date=' + encodeURIComponent(startDate) + '&end_date=' + encodeURIComponent(endDate);
    }

    try {
      var res = await fetch('/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/history' + qs, {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success) {
        _purchasingHistorySessions = data.sessions || [];
        renderPurchasingHistoryList();
      } else {
        if (container) {
          container.innerHTML = '<div style="text-align:center; padding:32px 0; color:#ef4444;">Gagal memuat riwayat: ' + esc(data.message || 'Terjadi kesalahan') + '</div>';
        }
      }
    } catch (err) {
      if (container) {
        container.innerHTML = '<div style="text-align:center; padding:32px 0; color:#ef4444;">Gangguan jaringan saat memuat riwayat.</div>';
      }
    }
  }
  window.loadPurchasingHistory = loadPurchasingHistory;

  function highlightMatch(text, query) {
    if (!query || !text) return esc(text || '');
    var escapedText = esc(text);
    var q = esc(query);
    var safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var regex = new RegExp('(' + safeQ + ')', 'gi');
    return escapedText.replace(regex, '<mark style="background:#fef08a; color:#854d0e; padding:1px 3px; border-radius:4px; font-weight:800;">$1</mark>');
  }

  function onPurchasingHistorySearch(val) {
    _activeHistorySearchQuery = (val || '').trim().toLowerCase();
    var clearBtn = $('btn-clear-history-search');
    if (clearBtn) clearBtn.style.display = _activeHistorySearchQuery ? 'block' : 'none';
    renderPurchasingHistoryList();
  }
  window.onPurchasingHistorySearch = onPurchasingHistorySearch;

  function clearPurchasingHistorySearch() {
    var input = $('purchasing-history-search');
    if (input) {
      input.value = '';
      input.focus();
    }
    onPurchasingHistorySearch('');
  }
  window.clearPurchasingHistorySearch = clearPurchasingHistorySearch;

  function setPurchasingHistoryFilter(filterKey, btnEl) {
    _activeHistoryDateFilter = filterKey;
    var container = $('purchasing-history-filter-chips');
    if (container) {
      var chips = container.querySelectorAll('.purchasing-history-chip');
      chips.forEach(function (c) {
        c.classList.toggle('active', c.getAttribute('data-filter') === filterKey);
      });
    }

    var now = new Date();
    var todayLocal = formatLocalDateWIB(now);
    var yesterdayLocal = formatLocalDateWIB(new Date(Date.now() - 86400000));
    var d7 = new Date();
    d7.setDate(d7.getDate() - 6);
    var d7Local = formatLocalDateWIB(d7);
    var d30 = new Date();
    d30.setDate(d30.getDate() - 29);
    var d30Local = formatLocalDateWIB(d30);

    var fromIn = $('purchasing-history-date-from');
    var toIn = $('purchasing-history-date-to');

    var targetFrom = todayLocal;
    var targetTo = todayLocal;

    if (filterKey === 'today') {
      targetFrom = todayLocal;
      targetTo = todayLocal;
    } else if (filterKey === 'yesterday') {
      targetFrom = yesterdayLocal;
      targetTo = yesterdayLocal;
    } else if (filterKey === '7days') {
      targetFrom = d7Local;
      targetTo = todayLocal;
    } else if (filterKey === '30days') {
      targetFrom = d30Local;
      targetTo = todayLocal;
    }

    if (fromIn) fromIn.value = targetFrom;
    if (toIn) toIn.value = targetTo;
    _customHistoryDateFrom = targetFrom;
    _customHistoryDateTo = targetTo;

    loadPurchasingHistory(targetFrom, targetTo);
  }
  window.setPurchasingHistoryFilter = setPurchasingHistoryFilter;

  function searchPurchasingHistoryCustomRange() {
    var fromIn = $('purchasing-history-date-from');
    var toIn = $('purchasing-history-date-to');
    var from = fromIn ? fromIn.value : '';
    var to = toIn ? toIn.value : '';

    if (!from && !to) {
      showToast('⚠️ Pilih tanggal awal atau akhir terlebih dahulu');
      return;
    }

    _customHistoryDateFrom = from;
    _customHistoryDateTo = to;
    _activeHistoryDateFilter = 'custom';

    var container = $('purchasing-history-filter-chips');
    if (container) {
      var chips = container.querySelectorAll('.purchasing-history-chip');
      chips.forEach(function (c) { c.classList.remove('active'); });
    }

    loadPurchasingHistory(from, to);
  }
  window.searchPurchasingHistoryCustomRange = searchPurchasingHistoryCustomRange;

  function renderPurchasingHistoryList() {
    var container = $('purchasing-history-container');
    if (!container) return;

    if (!_purchasingHistorySessions || !_purchasingHistorySessions.length) {
      container.innerHTML =
        '<div style="text-align:center; padding:40px 20px; background:#fff; border-radius:14px; border:1px dashed #cbd5e1;">' +
          '<div style="font-size:36px; margin-bottom:8px;">🧾</div>' +
          '<div style="font-size:15px; font-weight:800; color:#334155;">Belum Ada Riwayat Belanja</div>' +
          '<div style="font-size:12px; color:#64748b; margin-top:4px;">Nota belanja yang selesai akan tercatat otomatis di sini.</div>' +
        '</div>';
      return;
    }

    var filtered = _purchasingHistorySessions.filter(function (sess) {
      if (!_activeHistorySearchQuery) return true;
      var q = _activeHistorySearchQuery;
      var code = (sess.settlement_code || sess.posting_id || '').toLowerCase();
      var actor = (sess.actor_name || '').toLowerCase();
      var matchItem = (sess.items || []).some(function (itm) {
        return (itm.material_name || '').toLowerCase().includes(q) || (itm.uom || '').toLowerCase().includes(q);
      });
      return code.includes(q) || actor.includes(q) || matchItem;
    });

    if (!filtered.length) {
      container.innerHTML =
        '<div style="text-align:center; padding:32px 20px; background:#fff; border-radius:14px; border:1px dashed #cbd5e1;">' +
          '<div style="font-size:28px; margin-bottom:6px;">🔍</div>' +
          '<div style="font-size:14px; font-weight:800; color:#334155;">Tidak Ada Hasil Pencarian</div>' +
          '<div style="font-size:12px; color:#64748b; margin-top:4px;">Coba gunakan kata kunci lain.</div>' +
        '</div>';
      return;
    }

    container.innerHTML = filtered.map(function (sess) {
      var dateStr = '';
      try {
        var d = new Date(sess.timestamp);
        dateStr = d.toLocaleDateString('id-ID', {
          timeZone: 'Asia/Jakarta',
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch (_) {
        dateStr = sess.timestamp;
      }

      var displayItems = sess.items || [];
      if (_activeHistorySearchQuery) {
        var q = _activeHistorySearchQuery;
        var matched = displayItems.filter(function (itm) {
          return (itm.material_name || '').toLowerCase().includes(q) || (itm.uom || '').toLowerCase().includes(q);
        });
        if (matched.length > 0) displayItems = matched;
      }

      var itemsHtml = displayItems.map(function (itm) {
        var subTot = Math.round((itm.quantity || 0) * (itm.unit_price || 0));
        var qtyFormatted = itm.quantity % 1 === 0 ? itm.quantity : Number(itm.quantity).toFixed(1);
        return (
          '<div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:8px 10px; border-radius:8px; font-size:12px;">' +
            '<div>' +
              '<strong style="color:#0f172a;">' + highlightMatch(itm.material_name, _activeHistorySearchQuery) + '</strong>' +
              '<div style="font-size:11px; color:#64748b;">' + qtyFormatted + ' ' + highlightMatch(itm.uom || itm.base_uom_code || '', _activeHistorySearchQuery) + ' @ ' + formatMoney(itm.unit_price) + '</div>' +
            '</div>' +
            '<strong style="color:#0f172a;">' + formatMoney(subTot) + '</strong>' +
          '</div>'
        );
      }).join('');

      return (
        '<div class="purchasing-history-card">' +
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:1px solid #f1f5f9; padding-bottom:10px;">' +
            '<div>' +
              '<strong style="font-size:13.5px; color:#0f172a;">' + highlightMatch(sess.settlement_code || sess.posting_id || 'STL-BELANJA', _activeHistorySearchQuery) + '</strong>' +
              '<div style="font-size:11px; color:#64748b; margin-top:2px;">' + dateStr + ' • ' + highlightMatch(sess.actor_name || 'Petugas', _activeHistorySearchQuery) + '</div>' +
            '</div>' +
            '<strong style="font-size:15px; color:#059669;">' + formatMoney(sess.total_spend || 0) + '</strong>' +
          '</div>' +
          '<div style="display:flex; flex-direction:column; gap:6px; margin-top:10px;">' +
            itemsHtml +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  /* =========================================================================
     6. KALKULATOR KASIR PASAR (POS KEYPAD & QUICK CASH)
     ========================================================================= */
  var _calcFormula = '';
  var _calcLastResult = 0;

  function pressPurchasingCalc(char) {
    if (_calcFormula === '0' && !isNaN(char)) {
      _calcFormula = char;
    } else {
      _calcFormula += char;
    }
    updatePurchasingCalcDisplay();
  }
  window.pressPurchasingCalc = pressPurchasingCalc;

  function backspacePurchasingCalc() {
    if (_calcFormula.length > 0) {
      _calcFormula = _calcFormula.slice(0, -1);
    }
    if (_calcFormula === '') {
      _calcFormula = '0';
    }
    updatePurchasingCalcDisplay();
  }
  window.backspacePurchasingCalc = backspacePurchasingCalc;

  function resetPurchasingCalc() {
    _calcFormula = '0';
    _calcLastResult = 0;
    updatePurchasingCalcDisplay();
    var cashIn = $('input-purchasing-calc-cash');
    if (cashIn) cashIn.value = '';
    highlightMatchingQuickCash(null);
    calculatePurchasingCalcChange();
  }
  window.resetPurchasingCalc = resetPurchasingCalc;

  function evaluatePurchasingCalc() {
    if (!_calcFormula) return;
    try {
      var sanitized = _calcFormula.replace(/[^0-9+\-*/.]/g, '');
      if (!sanitized) return;
      var fn = new Function('return (' + sanitized + ')');
      var res = fn();
      if (!isNaN(res) && isFinite(res)) {
        _calcLastResult = Math.round(res * 100) / 100;
        _calcFormula = String(_calcLastResult);
      }
    } catch (_) {}
    updatePurchasingCalcDisplay();
    calculatePurchasingCalcChange();
  }
  window.evaluatePurchasingCalc = evaluatePurchasingCalc;

  function updatePurchasingCalcDisplay() {
    var formulaEl = $('purchasing-calc-formula');
    var resultEl = $('purchasing-calc-result');
    if (formulaEl) formulaEl.textContent = _calcFormula || '0';
    if (resultEl) resultEl.textContent = formatMoney(_calcLastResult);
  }

  function getPurchasingCashInputValue() {
    var cashIn = $('input-purchasing-calc-cash');
    if (!cashIn) return 0;
    var raw = String(cashIn.value || '').replace(/\D/g, '');
    return parseInt(raw, 10) || 0;
  }

  function onPurchasingCalcCashInput(val) {
    var num = parseInt(String(val || '').replace(/\D/g, ''), 10) || 0;
    var cashIn = $('input-purchasing-calc-cash');
    if (cashIn) {
      cashIn.value = num > 0 ? formatNumberWithDots(num) : '';
    }
    highlightMatchingQuickCash(num);
    calculatePurchasingCalcChange();
  }
  window.onPurchasingCalcCashInput = onPurchasingCalcCashInput;

  function selectPurchasingQuickCash(val) {
    var cashIn = $('input-purchasing-calc-cash');
    var amount = 0;
    if (val === 'exact') {
      amount = _calcLastResult > 0 ? _calcLastResult : 0;
    } else {
      amount = parseInt(val, 10) || 0;
    }
    if (cashIn) {
      cashIn.value = amount > 0 ? formatNumberWithDots(amount) : '';
    }
    highlightMatchingQuickCash(val);
    calculatePurchasingCalcChange();
  }
  window.selectPurchasingQuickCash = selectPurchasingQuickCash;

  function highlightMatchingQuickCash(val) {
    var grid = $('purchasing-calc-quick-grid');
    if (!grid) return;
    var btns = grid.querySelectorAll('.purchasing-btn-quick-cash');
    btns.forEach(function (btn) {
      var btnVal = btn.getAttribute('data-cash-val');
      if (val === 'exact' && btnVal === 'exact') {
        btn.classList.add('active');
      } else if (String(btnVal) === String(val)) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function calculatePurchasingCalcChange() {
    var cash = getPurchasingCashInputValue();
    var change = cash - _calcLastResult;

    var changeEl = $('label-purchasing-calc-change');
    if (changeEl) {
      if (change >= 0) {
        changeEl.textContent = formatMoney(change);
        changeEl.style.color = '#059669';
      } else {
        changeEl.textContent = 'Kurang ' + formatMoney(Math.abs(change));
        changeEl.style.color = '#dc2626';
      }
    }
  }

  /* =========================================================================
     7. VIEW SWITCHER (TASKS, PO, HISTORY, CALC)
     ========================================================================= */
  function switchPurchasingView(viewId) {
    _currentPurchasingView = viewId;
    var vTasks = $('purchasing-view-tasks');
    var vPo = $('purchasing-view-po');
    var vHistory = $('purchasing-view-history');
    var vCalc = $('purchasing-view-calc');

    var btnTasks = $('btn-purchasing-nav-tasks');
    var btnPo = $('btn-purchasing-nav-po');
    var btnHistory = $('btn-purchasing-nav-history');
    var btnCalc = $('btn-purchasing-nav-calc');

    if (vTasks) vTasks.style.display = viewId === 'tasks' ? 'block' : 'none';
    if (vPo) vPo.style.display = viewId === 'po' ? 'block' : 'none';
    if (vHistory) vHistory.style.display = viewId === 'history' ? 'block' : 'none';
    if (vCalc) vCalc.style.display = viewId === 'calc' ? 'block' : 'none';

    if (btnTasks) btnTasks.classList.toggle('active', viewId === 'tasks');
    if (btnPo) btnPo.classList.toggle('active', viewId === 'po');
    if (btnHistory) btnHistory.classList.toggle('active', viewId === 'history');
    if (btnCalc) btnCalc.classList.toggle('active', viewId === 'calc');

    var content = document.querySelector('.purchasing-content');
    if (content) {
      content.classList.toggle('is-calc-view', viewId === 'calc');
    }

    var titles = {
      tasks: 'Belanja Pasar',
      po: 'PO Supplier',
      history: 'Riwayat Belanja',
      calc: 'Kalkulator Pasar'
    };
    var titleEl = $('purchasing-topbar-title');
    if (titleEl) titleEl.textContent = titles[viewId] || 'Belanja Pasar';

    if (viewId === 'tasks') {
      if (_purchasingState.items && _purchasingState.items.length > 0) {
        showPurchasingBottomBar();
      }
    } else {
      hidePurchasingBottomBar();
    }

    if (viewId === 'po') {
      loadPurchasingOrders();
    } else if (viewId === 'history') {
      loadPurchasingHistory(_customHistoryDateFrom, _customHistoryDateTo);
    }
  }
  window.switchPurchasingView = switchPurchasingView;

  function refreshPurchasingActiveView() {
    if (_currentPurchasingView === 'po') {
      loadPurchasingOrders();
    } else if (_currentPurchasingView === 'history') {
      loadPurchasingHistory(_customHistoryDateFrom, _customHistoryDateTo);
    } else if (_currentPurchasingView === 'calc') {
      resetPurchasingCalc();
    } else {
      loadPurchasingChecklist();
    }
  }
  window.refreshPurchasingActiveView = refreshPurchasingActiveView;

  function logoutPurchasing() {
    if (confirm('Keluar dari akun Belanja?')) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      sessionStorage.clear();
      window.location.replace('/login');
    }
  }
  window.logoutPurchasing = logoutPurchasing;

  async function loadBrandLogoForPurchasing() {
    try {
      var logoEl = $('purchasing-topbar-logo');
      if (!logoEl) return;
      var res = await fetch('/api/v1/brand/info');
      if (res.ok) {
        var data = await res.json();
        if (data && data.brand && data.brand.logo_url) {
          logoEl.src = data.brand.logo_url;
        }
      }
    } catch (_) {}
  }

  /* =========================================================================
     8. APP INITIALIZATION & AUTH GUARD
     ========================================================================= */
  async function initPurchasingApp() {
    var token = getStoredToken();
    if (!token) {
      window.location.replace('/login?redirect=' + encodeURIComponent(window.location.pathname));
      return;
    }

    var user = getStoredUser();
    // Selalu ambil profil terkini dari server untuk sinkronisasi nama cabang & brand ter-update
    try {
      var meRes = await fetch('/api/v1/auth/merchant/me', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (meRes.ok) {
        var meData = await meRes.json();
        if (meData && meData.user) {
          user = meData.user;
          localStorage.setItem(USER_KEY, JSON.stringify(user));
          localStorage.setItem('user', JSON.stringify(user));
        }
      } else if (!user) {
        throw new Error('Token expired');
      }
    } catch (_) {
      if (!user) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.replace('/login?redirect=' + encodeURIComponent(window.location.pathname));
        return;
      }
    }

    var allowedRoles = ['purchasing', 'branch_manager', 'manager', 'owner', 'brand_manager'];
    if (!allowedRoles.includes(user.role)) {
      alert('Akun Anda (' + user.role + ') tidak memiliki hak akses untuk aplikasi Belanja Pasar.');
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.replace('/login');
      return;
    }

    var branchEl = $('purchasing-topbar-branch');
    if (branchEl) {
      var brName = user.brand_name || '';
      var bName = user.branch_name || '';
      if (bName && brName && bName.toLowerCase().startsWith(brName.toLowerCase())) {
        // Jika branch_name sudah menyertakan nama brand (misal: "MyBangjo Pringsewu")
        branchEl.textContent = bName;
      } else if (bName && brName) {
        branchEl.textContent = brName + ' • ' + bName;
      } else {
        branchEl.textContent = bName || brName || 'MyBangjo Pringsewu';
      }
    }

    loadBrandLogoForPurchasing();

    var fromIn = $('purchasing-history-date-from');
    var toIn = $('purchasing-history-date-to');
    var todayStr = formatLocalDateWIB(new Date());
    if (fromIn) fromIn.value = todayStr;
    if (toIn) toIn.value = todayStr;
    _customHistoryDateFrom = todayStr;
    _customHistoryDateTo = todayStr;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/belanja/sw.js', { scope: '/belanja/' })
        .then(function () { console.log('[Purchasing PWA] SW registered'); })
        .catch(function (err) { console.warn('[Purchasing PWA] SW failed:', err); });
    }

    switchPurchasingView('tasks');
    loadPurchasingChecklist();
  }

  // Real-time synchronization listeners
  window.addEventListener('xentra:inventory:updated', function () {
    if (_currentPurchasingView === 'tasks') {
      loadPurchasingChecklist();
    }
  });

  window.addEventListener('focus', function () {
    if (_currentPurchasingView === 'tasks') {
      loadPurchasingChecklist();
    }
  });

  document.addEventListener('DOMContentLoaded', initPurchasingApp);
})();

