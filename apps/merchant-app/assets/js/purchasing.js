/**
 * XENTRA CORE — MERCHANT APP PURCHASING / BELANJA PASAR
 *
 * Clean, human-oriented mobile shopping checklist for restaurant staff (Petugas Belanja).
 * Flow:
 * 1. Low stock raw materials -> suggested checklist with last moving average unit cost.
 * 2. Real cash advance tracking (kasbon) -> dynamic change due calculator.
 * 3. Real market price adjustment -> instant subtotal computation.
 * 4. Atomic stock receipt & moving average cost update upon completion.
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

  var _purchasingState = {
    items: [],
    filterMode: 'low', // 'low' or 'all'
    cashAdvance: 0,
    activeEditItem: null,
    activeMandateId: null
  };

  async function loadPurchasingChecklist() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var container = $('purchasing-checklist-container');
    if (container) {
      container.innerHTML = '<div class="text-center py-6 text-muted">Memuat daftar belanja pasar...</div>';
    }

    try {
      // 1. Cek apakah ada mandat belanja resmi yang dirilis oleh Branch Manager
      var mandateRes = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/mandates?status=RELEASED', {
        headers: getAuthHeaders()
      });
      var mandateData = await mandateRes.json();
      var activeMandate = (mandateData.success && mandateData.mandates && mandateData.mandates.length > 0)
        ? mandateData.mandates[0]
        : null;

      if (activeMandate && activeMandate.items && activeMandate.items.length > 0) {
        _purchasingState.activeMandateId = activeMandate.id;
        _purchasingState.cashAdvance = Number(activeMandate.cash_advance || 0);
        var cashAdvanceInput = $('input-purchasing-cash-advance');
        if (cashAdvanceInput) {
          cashAdvanceInput.value = _purchasingState.cashAdvance;
          cashAdvanceInput.readOnly = true; // Staf melihat uang modal dari manager
        }

        _purchasingState.items = activeMandate.items.map(function (itm) {
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
            buyQty: itm.target_quantity, // Fixed kuota dari manager!
            estimated_price: itm.estimated_unit_price,
            actualUnitPrice: itm.actual_unit_price || itm.estimated_unit_price,
            has_price_update: Boolean(itm.actual_unit_price && itm.actual_unit_price !== itm.estimated_unit_price),
            checked: false
          };
        });

        var estBudgetEl = $('label-purchasing-est-budget');
        if (estBudgetEl) estBudgetEl.textContent = formatMoney(activeMandate.total_planned_budget || 0);

        var badgeEl = $('badge-purchasing-low-count');
        if (badgeEl) {
          badgeEl.textContent = '#' + activeMandate.mandate_number;
          badgeEl.className = 'x-badge x-badge-primary';
        }

        renderPurchasingList();
        recalculatePurchasingSummary();
        return;
      }

      // 2. Fallback jika belum ada mandat khusus: ambil checklist bahan menipis dari sistem
      _purchasingState.activeMandateId = null;
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/checklist', {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (res.ok && data.success) {
        var rawItems = data.items || [];
        _purchasingState.items = rawItems.map(function (item) {
          var initialChecked = false;
          var initialQty = item.is_low ? (item.suggested_qty || 1) : 1;
          var initialPrice = item.last_unit_cost || 0;
          return {
            ...item,
            checked: initialChecked,
            buyQty: initialQty,
            estimated_price: initialPrice,
            actualUnitPrice: initialPrice,
            has_price_update: false
          };
        });

        var estBudgetEl2 = $('label-purchasing-est-budget');
        if (estBudgetEl2) {
          estBudgetEl2.textContent = formatMoney(data.total_estimated_budget || 0);
        }

        var lowCount = rawItems.filter(function (i) { return i.is_low; }).length;
        var badgeEl2 = $('badge-purchasing-low-count');
        if (badgeEl2) {
          badgeEl2.textContent = lowCount + ' bahan menipis';
          badgeEl2.className = lowCount > 0 ? 'x-badge x-badge-warning' : 'x-badge x-badge-success';
        }

        renderPurchasingList();
        recalculatePurchasingSummary();
      } else {
        if (container) {
          container.innerHTML = '<div class="text-center py-6 text-danger">Gagal memuat catatan: ' + esc(data.message || 'Terjadi kesalahan') + '</div>';
        }
      }
    } catch (err) {
      console.error('[Purchasing] Fetch error:', err);
      if (container) {
        container.innerHTML = '<div class="text-center py-6 text-danger">Kesalahan jaringan saat memuat catatan belanja.</div>';
      }
    }
  }
  window.loadPurchasingChecklist = loadPurchasingChecklist;

  function filterPurchasingList(mode) {
    // Kept for backward compatibility if called, but now renders all items
    renderPurchasingList();
  }
  window.filterPurchasingList = filterPurchasingList;

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

  function renderPurchasingList() {
    var container = $('purchasing-checklist-container');
    if (!container) return;

    var items = _purchasingState.items || [];
    var countEl = $('purchasing-item-count');
    if (countEl) countEl.textContent = items.length;

    var titleEl = $('purchasing-list-title');
    if (titleEl) {
      titleEl.textContent = 'Daftar Belanja';
    }

    if (!items.length) {
      container.innerHTML =
        '<div style="text-align:center; padding:40px 20px; background:#f8fafc; border-radius:12px; border:1px dashed #cbd5e1;">' +
          '<div style="font-size:36px; margin-bottom:8px;">🥬</div>' +
          '<div style="font-size:15px; font-weight:700; color:#334155;">Belum Ada Tugas Belanja</div>' +
          '<div style="font-size:12px; color:#64748b; margin-top:4px;">Daftar belanja belum dibuat atau semua bahan masih tercukupi.</div>' +
        '</div>';
      return;
    }

    var html = '';
    items.forEach(function (item) {
      var isChecked = item.checked;
      var subtotal = Math.round(item.buyQty * item.actualUnitPrice);
      var uomCode = item.base_uom_code || item.base_uom_name || 'Unit';

      var priceHtml = '';
      if (item.has_price_update) {
        priceHtml =
          '<span style="color:#0f172a; font-weight:700;">@ ' + formatMoney(item.actualUnitPrice) + '</span>' +
          '<s class="purchasing-price-strikethrough">' + formatMoney(item.estimated_price) + '</s>' +
          '<span class="purchasing-price-badge">harga update</span>';
      } else {
        priceHtml = '<span style="color:#64748b; font-size:12px;">(@ ' + formatMoney(item.actualUnitPrice) + ')</span>';
      }

      html +=
        '<div id="card-item-' + esc(item.material_id) + '" class="purchasing-item-card ' + (isChecked ? 'is-checked' : 'is-unchecked') + '" onclick="onPurchasingCardClick(event, \'' + esc(item.material_id) + '\')">' +
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
                '<span class="purchasing-item-name">' +
                  esc(item.material_name) +
                '</span>' +
                '<div class="purchasing-item-subtotal-val">' +
                  formatMoney(subtotal) +
                '</div>' +
              '</div>' +
              '<div class="purchasing-item-meta-row">' +
                '<div class="purchasing-item-meta-qty">' +
                  '<span>Beli:</span>&nbsp;<strong class="purchasing-item-qty-val">' + item.buyQty + ' ' + esc(uomCode) + '</strong>&nbsp;' +
                  priceHtml +
                '</div>' +
                '<button type="button" class="purchasing-btn-price-update" onclick="event.stopPropagation(); openPurchasingUpdatePriceModal(\'' + esc(item.material_id) + '\')">' +
                  '<img src="/assets/icons/write.svg" alt="" class="purchasing-btn-price-icon" aria-hidden="true"> <span>Harga Baru</span>' +
                '</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    });

    container.innerHTML = html;
  }

  function togglePurchasingItemCheck(materialId, isChecked) {
    var itm = _purchasingState.items.find(function (i) { return i.material_id === materialId; });
    if (itm) {
      itm.checked = isChecked;
      renderPurchasingList();
      recalculatePurchasingSummary();
    }
  }
  window.togglePurchasingItemCheck = togglePurchasingItemCheck;

  function openPurchasingUpdatePriceModal(materialId) {
    var itm = _purchasingState.items.find(function (i) { return i.material_id === materialId; });
    if (!itm) return;
    _purchasingState.activeEditItem = itm;

    var nameEl = $('purchasing-update-price-item-name');
    var uomEl = $('purchasing-update-price-item-uom');
    var oldPriceEl = $('purchasing-update-price-old-price');
    var priceIn = $('input-purchasing-modal-price');
    var modal = $('modal-purchasing-update-price');

    var uomText = itm.base_uom_code || itm.base_uom_name || 'unit';
    if (nameEl) nameEl.textContent = itm.material_name;
    if (uomEl) uomEl.textContent = 'per ' + uomText;
    if (oldPriceEl) oldPriceEl.textContent = formatMoney(itm.estimated_price || itm.actualUnitPrice || 0) + ' / ' + uomText;
    if (priceIn) {
      var initialNum = itm.actualUnitPrice || 0;
      priceIn.value = initialNum > 0 ? formatNumberWithDots(initialNum) : '';
      setTimeout(function () { priceIn.focus(); priceIn.select(); }, 60);
    }
    if (modal) {
      modal.style.display = 'flex';
      modal.style.opacity = '1';
      modal.style.visibility = 'visible';
    }
  }
  window.openPurchasingUpdatePriceModal = openPurchasingUpdatePriceModal;

  function closePurchasingUpdatePriceModal() {
    var modal = $('modal-purchasing-update-price');
    if (modal) {
      modal.style.display = 'none';
    }
    _purchasingState.activeEditItem = null;
  }
  window.closePurchasingUpdatePriceModal = closePurchasingUpdatePriceModal;

  function formatNumberWithDots(val) {
    var n = Math.floor(Number(val) || 0);
    if (n <= 0) return '';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function setupCurrencyInputAutoDot(inputEl, onValueChange) {
    if (!inputEl) return;

    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace' && inputEl.selectionStart === inputEl.selectionEnd) {
        var pos = inputEl.selectionStart;
        var val = inputEl.value;
        if (pos > 1 && val.charAt(pos - 1) === '.') {
          e.preventDefault();
          var newVal = val.slice(0, pos - 2) + val.slice(pos);
          inputEl.value = newVal;
          inputEl.setSelectionRange(pos - 2, pos - 2);
          inputEl.dispatchEvent(new Event('input'));
        }
      }
    });

    inputEl.addEventListener('input', function () {
      var rawVal = inputEl.value || '';
      var rawCursor = typeof inputEl.selectionEnd === 'number' ? inputEl.selectionEnd : rawVal.length;
      var digitsBeforeCursor = rawVal.slice(0, rawCursor).replace(/\D/g, '').length;

      var digits = rawVal.replace(/\D/g, '');
      if (!digits) {
        inputEl.value = '';
        if (typeof onValueChange === 'function') onValueChange(0);
        return;
      }

      var num = parseInt(digits, 10);
      if (isNaN(num) || num <= 0) {
        inputEl.value = '';
        if (typeof onValueChange === 'function') onValueChange(0);
        return;
      }

      var formatted = formatNumberWithDots(num);
      inputEl.value = formatted;

      // Restore cursor position smoothly
      if (typeof inputEl.setSelectionRange === 'function') {
        var targetCursor = 0;
        if (digitsBeforeCursor === 0) {
          targetCursor = 0;
        } else {
          var count = 0;
          for (var idx = 0; idx < formatted.length; idx++) {
            if (/\d/.test(formatted.charAt(idx))) {
              count++;
            }
            if (count === digitsBeforeCursor) {
              targetCursor = idx + 1;
              break;
            }
          }
          if (targetCursor === 0) targetCursor = formatted.length;
        }
        inputEl.setSelectionRange(targetCursor, targetCursor);
      }

      if (typeof onValueChange === 'function') onValueChange(num);
    });
  }

  function confirmPurchasingPriceUpdate() {
    if (!_purchasingState.activeEditItem) return;
    var priceIn = $('input-purchasing-modal-price');
    var rawDigits = priceIn ? String(priceIn.value || '').replace(/\D/g, '') : '';
    var newPrice = parseFloat(rawDigits || 0);

    if (isNaN(newPrice) || newPrice < 0) {
      showToast('⚠️ Masukkan nominal harga yang valid.');
      return;
    }

    _purchasingState.activeEditItem.actualUnitPrice = newPrice;
    _purchasingState.activeEditItem.has_price_update = true;
    closePurchasingUpdatePriceModal();
    renderPurchasingList();
    recalculatePurchasingSummary();
    showToast('✓ Harga pasar diperbarui.');
  }
  window.confirmPurchasingPriceUpdate = confirmPurchasingPriceUpdate;

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
      if (changeDue >= 0) {
        changeDueEl.textContent = formatMoney(changeDue);
        changeDueEl.style.color = '#16a34a';
      } else {
        changeDueEl.textContent = 'Kurang ' + formatMoney(Math.abs(changeDue));
        changeDueEl.style.color = '#dc2626';
      }
    }

    var submitBtn = $('btn-purchasing-submit-settle');
    if (submitBtn) {
      var hasChecked = _purchasingState.items.some(function (i) { return i.checked; });
      submitBtn.disabled = !hasChecked || totalReal <= 0;
      submitBtn.style.opacity = (!hasChecked || totalReal <= 0) ? '0.5' : '1';
    }
  }
  window.recalculatePurchasingSummary = recalculatePurchasingSummary;

  var _pendingSettlePayload = null;

  function submitPurchasingSettle() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var checkedItems = _purchasingState.items.filter(function (i) { return i.checked && i.buyQty > 0; });
    if (!checkedItems.length) {
      if (typeof showToast === 'function') showToast('⚠️ Pilih minimal satu barang yang dibeli.');
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
    if (changeLabel) changeLabel.textContent = changeDue >= 0 ? 'Sisa Kembalian:' : 'Uang Kurang:';
    if (changeEl) {
      changeEl.textContent = changeDue >= 0 ? formatMoney(changeDue) : '- ' + formatMoney(Math.abs(changeDue));
      changeEl.style.color = changeDue >= 0 ? '#059669' : '#dc2626';
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
        return (
          '<div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; border:1px solid #f1f5f9; padding:7px 10px; border-radius:8px; font-size:12px;">' +
            '<div>' +
              '<strong style="color:#0f172a;">' + esc(itm.name) + '</strong>' +
              '<div style="font-size:11px; color:#64748b;">' + formatNominal(itm.buyQty) + ' ' + esc(itm.uom || '') + ' @ ' + formatMoney(itm.actualUnitPrice) + '</div>' +
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
      confirmBtn.innerHTML = '<span>⏳</span> Menyimpan ke Stok...';
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Menyimpan ke Stok...';
    }

    var payload = _pendingSettlePayload;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(payload.branchId) + '/purchasing/settle', {
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
        if (typeof showToast === 'function') {
          showToast('🛒 Belanja berhasil dicatat! Stok bahan baku telah ditambahkan.');
        }
        var cashInput = $('input-purchasing-cash-advance');
        if (cashInput) cashInput.value = '';
        _purchasingState.cashAdvance = 0;
        loadPurchasingChecklist();
      } else {
        if (typeof showToast === 'function') {
          showToast('Gagal mencatat belanja: ' + (data.message || data.error || 'Terjadi kesalahan'));
        }
      }
    } catch (err) {
      if (typeof showToast === 'function') {
        showToast('Gangguan jaringan saat menyelesaikan belanja.');
      }
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
     VIEW SWITCHER (PASAR, PO SUPPLIER, RIWAYAT, KALKULATOR)
     ========================================================================= */
  var _currentPurchasingView = 'tasks';

  function refreshPurchasingActiveView() {
    if (_currentPurchasingView === 'po') {
      loadPurchasingOrders();
    } else if (_currentPurchasingView === 'history') {
      loadPurchasingHistory();
    } else if (_currentPurchasingView === 'calc') {
      if (typeof resetPurchasingCalc === 'function') resetPurchasingCalc();
    } else {
      loadPurchasingChecklist();
    }
  }
  window.refreshPurchasingActiveView = refreshPurchasingActiveView;

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

    var belanjaSec = $('tab-bm-belanja');
    if (belanjaSec) {
      belanjaSec.classList.toggle('is-calc-view', viewId === 'calc');
    }

    // Update dynamic topbar title to match active menu
    var titles = {
      tasks: 'Belanja',
      po: 'PO Supplier',
      history: 'Riwayat',
      calc: 'Kalkulator'
    };
    var titleEl = $('purchasing-topbar-title');
    if (titleEl) {
      titleEl.textContent = titles[viewId] || 'Belanja';
    }

    // Hide or show bottom settlement bar only on Tasks view (Belanja Pasar)
    // PO Supplier, Riwayat, and Kalkulator do not involve cash advance settlement!
    var bottomBar = $('purchasing-bottom-bar');
    if (bottomBar) {
      if (viewId === 'tasks') {
        bottomBar.classList.remove('is-hidden');
        bottomBar.style.setProperty('display', 'flex', 'important');
      } else {
        bottomBar.classList.add('is-hidden');
        bottomBar.style.setProperty('display', 'none', 'important');
      }
    }

    if (viewId === 'po') {
      loadPurchasingOrders();
    } else if (viewId === 'history') {
      loadPurchasingHistory();
    }
  }
  window.switchPurchasingView = switchPurchasingView;

  /* =========================================================================
     PO SUPPLIER & GOODS RECEIPT (PENERIMAAN BARANG CABANG)
     ========================================================================= */
  var _activePoOrders = [];
  var _activeReceivePo = null;

  async function loadPurchasingOrders() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var container = $('purchasing-orders-container');
    if (container) {
      container.innerHTML = '<div class="text-center py-6 text-muted">Memuat daftar pesanan supplier...</div>';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/orders', {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (res.ok && data.success) {
        _activePoOrders = data.orders || [];
        renderPurchasingOrdersList();
      } else {
        if (container) container.innerHTML = '<div class="text-center py-6 text-muted">Gagal memuat pesanan: ' + esc(data.error || 'Unknown error') + '</div>';
      }
    } catch (e) {
      if (container) container.innerHTML = '<div class="text-center py-6 text-muted">Gagal terhubung ke server.</div>';
    }
  }
  window.loadPurchasingOrders = loadPurchasingOrders;

  function renderPurchasingOrdersList() {
    var container = $('purchasing-orders-container');
    if (!container) return;

    if (!_activePoOrders.length) {
      container.innerHTML = '<div class="text-center py-8 text-muted" style="background:#ffffff; border:1px dashed #cbd5e1; border-radius:14px; padding:24px 16px;">' +
        '<div style="font-size:32px; margin-bottom:8px;">📦</div>' +
        '<div style="font-size:14px; font-weight:700; color:#1e293b;">Belum Ada Pesanan PO Aktif</div>' +
        '<p style="font-size:12px; color:#64748b; margin:4px 0 0;">Semua barang yang dipesan ke supplier sudah selesai diterima atau belum ada PO baru dari Owner.</p>' +
      '</div>';
      return;
    }

    var html = _activePoOrders.map(function (po) {
      var linesCount = (po.lines || []).length;
      var statusBadge = po.status === 'ORDERED'
        ? '<span class="x-badge" style="background:#dbeafe; color:#1e40af; border:none; font-weight:700;">Sedang Dikirim</span>'
        : (po.status === 'PARTIALLY_RECEIVED'
          ? '<span class="x-badge" style="background:#fef3c7; color:#92400e; border:none; font-weight:700;">Diterima Sebagian</span>'
          : '<span class="x-badge" style="background:#f1f5f9; color:#475569; border:none; font-weight:700;">Disetujui</span>');

      var linesSummary = (po.lines || []).map(function (line) {
        var qty = line.ordered_purchase_quantity;
        var packName = line.supplier_pack_name || (line.base_uom_name || 'unit');
        return '<div style="font-size:12.5px; color:#334155; display:flex; justify-content:space-between; padding:3px 0;">' +
          '<span>' + esc(line.material_name) + '</span>' +
          '<strong>' + esc(qty) + ' ' + esc(packName) + '</strong>' +
        '</div>';
      }).join('');

      return '<div class="purchasing-item-card" style="display:flex; flex-direction:column; gap:10px; padding:14px; border-radius:14px; border:1px solid #e2e8f0; background:#ffffff;">' +
        '<div style="display:flex; justify-content:space-between; align-items:start;">' +
          '<div>' +
            '<div style="font-size:11px; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:0.04em;">' + esc(po.po_number || ('PO #' + po.id.slice(-6))) + '</div>' +
            '<div style="font-size:15px; font-weight:800; color:#0f172a; margin-top:2px;">' + esc(po.supplier_name) + '</div>' +
          '</div>' +
          statusBadge +
        '</div>' +
        '<div style="background:#f8fafc; border-radius:10px; padding:8px 10px; border:1px solid #f1f5f9;">' +
          linesSummary +
        '</div>' +
        '<div style="display:flex; justify-content:space-between; align-items:center; border-top:1px dashed #e2e8f0; padding-top:10px;">' +
          '<div style="font-size:12px; color:#64748b;">Total: <strong style="color:#0f172a; font-size:13.5px;">' + formatMoney(po.total_amount) + '</strong></div>' +
          '<button type="button" class="x-btn-primary" onclick="openPurchasingReceiveModal(\'' + esc(po.id) + '\')" style="padding:8px 14px; font-size:12.5px; font-weight:700; border-radius:10px; background:#059669; border-color:#059669;">' +
            '📦 Terima Barang' +
          '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    container.innerHTML = html;
  }

  function openPurchasingReceiveModal(poId) {
    var po = _activePoOrders.find(function (o) { return o.id === poId; });
    if (!po) return;
    _activeReceivePo = po;

    var modal = $('modal-purchasing-receive');
    var codeEl = $('purchasing-receive-code');
    var supplierEl = $('purchasing-receive-supplier');
    var body = $('purchasing-receive-body');

    if (codeEl) {
      codeEl.textContent = po.po_number || ('PO #' + po.id.slice(-6));
    }
    if (supplierEl) {
      supplierEl.textContent = po.supplier_name;
    }

    if (body) {
      var linesHtml = (po.lines || []).map(function (line, idx) {
        var packDesc = line.supplier_pack_name || (line.base_uom_name || 'unit');
        var orderedQty = Number(line.ordered_purchase_quantity) || 0;
        var remainingQty = Math.max(0, orderedQty - (Number(line.received_base_quantity || 0) / (Number(line.base_quantity_per_purchase_unit) || 1)));
        if (remainingQty <= 0) remainingQty = orderedQty;

        // Cek apakah satuan timbangan (weighable/fractional) yang berhak atas toleransi timbangan wajar +10%
        var uomStr = ((line.base_uom_code || '') + ' ' + (line.base_uom_name || '') + ' ' + (line.supplier_pack_name || '')).toLowerCase();
        var isWeighable = line.allows_fraction === 1 ||
                          /^(kg|kilogram|g|gram|gr|l|liter|ml|ons)$/i.test(String(line.base_uom_code || line.base_uom_name || '').trim()) ||
                          /\b(kg|kilogram|gram|liter)\b/i.test(uomStr);
        var maxAllowedQty = isWeighable ? Math.round(orderedQty * 1.10 * 100) / 100 : orderedQty;
        var toleransiDesc = isWeighable
          ? 'Maksimal toleransi wajar +10% (hingga ' + maxAllowedQty + ' ' + esc(packDesc) + ')'
          : '0% (kemasan segel pasti)';

        return '<div class="purchasing-receive-line" data-pol-id="' + esc(line.purchase_order_line_id) + '" data-ordered-qty="' + orderedQty + '" data-max-qty="' + maxAllowedQty + '" data-is-weighable="' + (isWeighable ? '1' : '0') + '" data-pack-desc="' + esc(packDesc) + '">' +
          '<!-- 1. Item -->' +
          '<div class="purchasing-receive-line-name" style="font-size:14.5px; font-weight:800; color:#0f172a; margin-bottom:4px;">' + esc(line.material_name) + '</div>' +
          '<!-- 2. Dipesan -->' +
          '<div style="font-size:12px; font-weight:600; color:#475569; margin-bottom:3px;">Dipesan: <strong style="color:#0f172a;">' + esc(orderedQty) + ' ' + esc(packDesc) + '</strong></div>' +
          '<!-- 3. Toleransi -->' +
          '<div style="font-size:12px; font-weight:600; color:#64748b; margin-bottom:12px;">Toleransi: <span style="font-weight:700; color:' + (isWeighable ? '#15803d' : '#64748b') + ';">' + toleransiDesc + '</span></div>' +
          '<!-- 4. 2 Kolom: Layak Terima & Ditolak/Rusak -->' +
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
          '<!-- 5. Kondisi: -->' +
          '<div class="purchasing-receive-status-hint">' +
            '<span style="font-weight:700; color:#475569;">Kondisi:</span>' +
            '<span class="receive-status-pill">✓ Lengkap & Baik</span>' +
          '</div>' +
        '</div>';
      }).join('');

      body.innerHTML = linesHtml;
    }

    if (modal) modal.style.display = 'flex';
    var notesEl = $('input-purchasing-receive-notes');
    if (notesEl) {
      notesEl.value = '';
      notesEl.placeholder = 'Tuliskan keterangan jika ada selisih timbangan, kemasan rusak, atau cacat...';
    }
    updatePurchasingReceiveModalCta();
  }
  window.openPurchasingReceiveModal = openPurchasingReceiveModal;

  function updatePurchasingReceiveModalCta() {
    var btn = $('btn-submit-purchasing-receive');
    var container = $('purchasing-receive-body');
    if (!btn || !container) return;

    var lineEls = container.querySelectorAll('.purchasing-receive-line');
    var totalAccepted = 0;
    var totalRejected = 0;
    var totalOrdered = 0;
    var hasOverReceived = false;
    var surplusQty = 0;

    lineEls.forEach(function (el) {
      var ord = Number(el.getAttribute('data-ordered-qty')) || 0;
      var accIn = el.querySelector('.input-receive-accepted');
      var rejIn = el.querySelector('.input-receive-rejected');
      var acc = Number(accIn ? accIn.value : 0) || 0;
      var rej = Number(rejIn ? rejIn.value : 0) || 0;
      totalOrdered += ord;
      totalAccepted += acc;
      totalRejected += rej;
      if (acc > ord) {
        hasOverReceived = true;
        surplusQty += (acc - ord);
      }
    });

    if (totalAccepted === 0 && totalRejected > 0) {
      btn.textContent = '✕ Tolak Semua Barang';
      btn.style.background = '#dc2626';
      btn.style.borderColor = '#dc2626';
      btn.setAttribute('data-cta-mode', 'reject_all');
    } else if (hasOverReceived) {
      var diffFormatted = surplusQty % 1 === 0 ? surplusQty : surplusQty.toFixed(2).replace(/\.?0+$/, '');
      btn.textContent = '✓ Terima (Berlebih +' + diffFormatted + ')';
      btn.style.background = '#0284c7';
      btn.style.borderColor = '#0284c7';
      btn.setAttribute('data-cta-mode', 'over_received');
    } else if (totalRejected > 0) {
      btn.textContent = '⚠️ Terima Sebagian';
      btn.style.background = '#d97706';
      btn.style.borderColor = '#d97706';
      btn.setAttribute('data-cta-mode', 'partial');
    } else {
      btn.textContent = '✓ Terima Barang';
      btn.style.background = '#059669';
      btn.style.borderColor = '#059669';
      btn.setAttribute('data-cta-mode', 'accept_all');
    }
  }
  window.updatePurchasingReceiveModalCta = updatePurchasingReceiveModalCta;

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
        if (isWeighable && typeof showToast === 'function') {
          showToast('⚠️ Batas toleransi timbangan basah maksimal +10% (' + maxAllowedQty + ' ' + packDesc + ')');
        } else if (!isWeighable && typeof showToast === 'function') {
          showToast('⚠️ Barang kemasan pasti tidak dapat melebihi pesanan (' + orderedQty + ' ' + packDesc + ')');
        }
      }

      if (accepted > orderedQty) {
        // Kasus over-received
        rejected = 0;
        if (rejectedInput) rejectedInput.value = 0;
      } else {
        // Pola hitung normal: Ditolak/Rusak = Dipesan - Layak Diterima
        rejected = Math.max(0, orderedQty - accepted);
        if (rejectedInput) rejectedInput.value = rejected;
      }
    } else if (changedField === 'rejected') {
      if (rejected < 0) { rejected = 0; if (rejectedInput) rejectedInput.value = 0; }
      if (rejected > orderedQty) {
        rejected = orderedQty;
        if (rejectedInput) rejectedInput.value = orderedQty;
      }
      // Pola hitung: Layak Diterima = Dipesan - Ditolak/Rusak
      accepted = Math.max(0, orderedQty - rejected);
      if (acceptedInput) acceptedInput.value = accepted;
    }

    // Update status hint
    if (statusPill) {
      if (accepted > orderedQty) {
        var surplus = (accepted - orderedQty);
        var surplusStr = surplus % 1 === 0 ? surplus : surplus.toFixed(2).replace(/\.?0+$/, '');
        statusPill.textContent = '📦 Diterima Berlebih: +' + surplusStr + ' ' + packDesc + ' (Toleransi Timbangan)';
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

    // Auto-update placeholder catatan bila ada barang rusak / berlebih
    var notesEl = $('input-purchasing-receive-notes');
    if (notesEl && !notesEl.value) {
      if (accepted > orderedQty) {
        var diff = (accepted - orderedQty);
        var diffStr = diff % 1 === 0 ? diff : diff.toFixed(2).replace(/\.?0+$/, '');
        notesEl.placeholder = 'Catatan: Diterima berlebih +' + diffStr + ' ' + packDesc + ' (tulis keterangan timbangan basah/kelebihan supir)';
      } else if (rejected > 0) {
        notesEl.placeholder = 'Catatan: ' + rejected + ' barang ditolak (tulis alasan cacat/segel rusak untuk retur supplier)';
      }
    }

    // Update CTA button dynamically based on entire order's accepted/rejected totals
    updatePurchasingReceiveModalCta();
  }
  window.onPurchasingReceiveQtyChange = onPurchasingReceiveQtyChange;

  function closePurchasingReceiveModal() {
    var modal = $('modal-purchasing-receive');
    if (modal) modal.style.display = 'none';
    _activeReceivePo = null;
  }
  window.closePurchasingReceiveModal = closePurchasingReceiveModal;
  var _pendingReceiveData = null;

  function closePurchasingReceiveConfirmModal() {
    var modal = $('modal-purchasing-receive-confirm');
    if (modal) modal.style.display = 'none';
  }
  window.closePurchasingReceiveConfirmModal = closePurchasingReceiveConfirmModal;

  function submitPurchasingReceive() {
    if (!_activeReceivePo) return;
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
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
      var nameEl = el.querySelector('.purchasing-receive-line-name');
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
        accepted_purchase_quantity: accepted,
        rejected_purchase_quantity: rejected,
        rejection_reason: rejected > 0 ? (notes || 'Barang ditolak saat penerimaan') : null
      });

      var statusText = '';
      if (accepted > ord) {
        var diff = (accepted - ord);
        var diffStr = diff % 1 === 0 ? diff : diff.toFixed(2).replace(/\.?0+$/, '');
        statusText = '<span style="color:#0284c7; font-weight:700;">' + accepted + ' ' + esc(packDesc) + ' (+' + diffStr + ' Lebih)</span>';
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

    // Validasi penolakan total: wajib isi alasan
    if (totalAccepted === 0 && totalRejected > 0 && !notes) {
      if (typeof showToast === 'function') {
        showToast('⚠️ Catatan fisik wajib diisi jika seluruh barang ditolak (tulis alasan cacat/retur).');
      } else {
        alert('Catatan fisik wajib diisi jika seluruh barang ditolak (tulis alasan cacat/retur).');
      }
      if (notesEl) {
        notesEl.focus();
        notesEl.style.borderColor = '#dc2626';
        setTimeout(function () { notesEl.style.borderColor = ''; }, 3000);
      }
      return;
    }

    // Validasi barang berlebih: wajib isi alasan
    if (hasOverReceived && !notes) {
      if (typeof showToast === 'function') {
        showToast('⚠️ Catatan wajib diisi jika ada barang diterima berlebih (tulis alasan timbangan/kelebihan supir).');
      } else {
        alert('Catatan wajib diisi jika ada barang diterima berlebih (tulis alasan timbangan/kelebihan supir).');
      }
      if (notesEl) {
        notesEl.focus();
        notesEl.style.borderColor = '#0284c7';
        setTimeout(function () { notesEl.style.borderColor = ''; }, 3000);
      }
      return;
    }

    // Siapkan data pending untuk dialog konfirmasi
    _pendingReceiveData = {
      branchId: branchId,
      poId: _activeReceivePo.id,
      lines: lines,
      totalAccepted: totalAccepted,
      totalRejected: totalRejected,
      hasOverReceived: hasOverReceived
    };

    // Tampilkan modal konfirmasi dengan data ringkasan
    var confirmModal = $('modal-purchasing-receive-confirm');
    var iconEl = $('purchasing-confirm-icon');
    var titleEl = $('purchasing-confirm-title');
    var subtitleEl = $('purchasing-confirm-subtitle');
    var listEl = $('purchasing-confirm-summary-list');
    var notesBoxEl = $('purchasing-confirm-notes-preview');
    var notesTextEl = $('purchasing-confirm-notes-text');
    var execBtn = $('btn-execute-purchasing-receive');

    if (subtitleEl) {
      subtitleEl.textContent = (_activeReceivePo.po_number || ('PO #' + _activeReceivePo.id.slice(-6))) + ' dari ' + _activeReceivePo.supplier_name;
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
        execBtn.style.borderColor = '#dc2626';
      } else if (hasOverReceived) {
        if (iconEl) iconEl.textContent = '📦';
        if (titleEl) titleEl.textContent = 'Konfirmasi Penerimaan Berlebih';
        execBtn.textContent = '✓ Ya, Terima Berlebih';
        execBtn.style.background = '#0284c7';
        execBtn.style.borderColor = '#0284c7';
      } else if (totalRejected > 0) {
        if (iconEl) iconEl.textContent = '⚠️';
        if (titleEl) titleEl.textContent = 'Konfirmasi Penerimaan Sebagian';
        execBtn.textContent = '⚠️ Ya, Terima Sebagian';
        execBtn.style.background = '#d97706';
        execBtn.style.borderColor = '#d97706';
      } else {
        if (iconEl) iconEl.textContent = '✓';
        if (titleEl) titleEl.textContent = 'Konfirmasi Penerimaan Barang';
        execBtn.textContent = '✓ Ya, Terima Barang';
        execBtn.style.background = '#059669';
        execBtn.style.borderColor = '#059669';
      }
    }

    if (confirmModal) confirmModal.style.display = 'flex';
  }
  window.submitPurchasingReceive = submitPurchasingReceive;

  async function executePurchasingReceiveSubmit() {
    if (!_pendingReceiveData) return;
    var dataPayload = _pendingReceiveData;

    var execBtn = $('btn-execute-purchasing-receive');
    if (execBtn) {
      execBtn.disabled = true;
      execBtn.textContent = 'Menyimpan ke Stok...';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(dataPayload.branchId) + '/purchasing/orders/' + encodeURIComponent(dataPayload.poId) + '/receive', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ lines: dataPayload.lines })
      });
      var data = await res.json();

      if (res.ok && data.success) {
        if (dataPayload.totalAccepted === 0 && dataPayload.totalRejected > 0) {
          showToast('✓ Penolakan barang dicatat. Seluruh barang diretur ke supplier.');
        } else if (dataPayload.hasOverReceived) {
          showToast('✓ Penerimaan barang berlebih berhasil dicatat. Saldo stok telah diperbarui!');
        } else if (dataPayload.totalRejected > 0) {
          showToast('✓ Penerimaan sebagian berhasil dicatat. Stok bertambah sesuai barang layak.');
        } else {
          showToast('✓ Seluruh barang berhasil diterima! Stok bahan baku telah bertambah.');
        }
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
     PURCHASING HISTORY
     ========================================================================= */
  var _purchasingHistorySessions = [];
  var _activeHistoryDateFilter = 'today';
  var _activeHistorySearchQuery = '';
  var _customHistoryDateFrom = '';
  var _customHistoryDateTo = '';
  var _hasUserManuallyChangedHistoryFilter = false;

  async function loadPurchasingHistory(startDate, endDate) {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var container = $('purchasing-history-container');
    if (container && !_purchasingHistorySessions.length) {
      container.innerHTML = '<div class="text-center py-6 text-muted">Memuat riwayat belanja...</div>';
    }

    try {
      var url = API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/history';
      var params = [];
      if (startDate) params.push('start_date=' + encodeURIComponent(startDate));
      if (endDate) params.push('end_date=' + encodeURIComponent(endDate));
      if (params.length) url += '?' + params.join('&');

      var res = await adminFetch(url, {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (res.ok && data.success) {
        _purchasingHistorySessions = data.sessions || [];

        // Jika user belum manual memilih filter, otomatis tentukan tanggal berdasarkan transaksi terakhir yang masuk
        if (!_hasUserManuallyChangedHistoryFilter) {
          var todayWIB = formatLocalDateWIB(new Date());
          var yesterdayWIB = formatLocalDateWIB(new Date(Date.now() - 86400000));

          if (_purchasingHistorySessions.length > 0) {
            // Urutan dari server DESC (paling baru ada di indeks 0)
            var latestTimestamp = _purchasingHistorySessions[0].timestamp;
            var latestDateWIB = formatLocalDateWIB(latestTimestamp);

            if (latestDateWIB === todayWIB) {
              _activeHistoryDateFilter = 'today';
              _customHistoryDateFrom = todayWIB;
              _customHistoryDateTo = todayWIB;
            } else if (latestDateWIB === yesterdayWIB) {
              _activeHistoryDateFilter = 'yesterday';
              _customHistoryDateFrom = yesterdayWIB;
              _customHistoryDateTo = yesterdayWIB;
            } else {
              _activeHistoryDateFilter = 'custom';
              _customHistoryDateFrom = latestDateWIB;
              _customHistoryDateTo = latestDateWIB;
            }
          } else {
            // Belum ada riwayat belanja, default ke Hari Ini
            _activeHistoryDateFilter = 'today';
            _customHistoryDateFrom = todayWIB;
            _customHistoryDateTo = todayWIB;
          }

          // Sinkronkan chip filter aktif
          var chipsContainer = $('purchasing-history-filter-chips');
          if (chipsContainer) {
            var allChips = chipsContainer.querySelectorAll('.purchasing-history-chip');
            allChips.forEach(function (c) {
              c.classList.toggle('active', c.getAttribute('data-filter') === _activeHistoryDateFilter);
            });
          }

          // Sinkronkan input tanggal
          var fromIn = $('purchasing-history-date-from');
          var toIn = $('purchasing-history-date-to');
          if (fromIn) fromIn.value = _customHistoryDateFrom;
          if (toIn) toIn.value = _customHistoryDateTo;
        }

        renderPurchasingHistoryList();
      } else {
        if (container) {
          container.innerHTML = '<div class="text-center py-6 text-danger">Gagal memuat riwayat: ' + esc(data.message || 'Terjadi kesalahan') + '</div>';
        }
      }
    } catch (err) {
      console.error('[Purchasing] History fetch error:', err);
      if (container) {
        container.innerHTML = '<div class="text-center py-6 text-danger">Kesalahan jaringan saat memuat riwayat.</div>';
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

  function formatLocalDateWIB(d) {
    if (!d) return '';
    if (typeof d === 'string') d = new Date(d);
    if (!(d instanceof Date) || isNaN(d)) return '';
    try {
      // Standar ISO YYYY-MM-DD dalam zona waktu WIB (Asia/Jakarta, UTC+7)
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    } catch (_) {
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    }
  }
  window.formatLocalDateWIB = formatLocalDateWIB;

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
    _hasUserManuallyChangedHistoryFilter = true;
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
    _hasUserManuallyChangedHistoryFilter = true;
    var fromIn = $('purchasing-history-date-from');
    var toIn = $('purchasing-history-date-to');
    var from = fromIn ? fromIn.value : '';
    var to = toIn ? toIn.value : '';

    if (!from && !to) {
      if (typeof showToast === 'function') showToast('⚠️ Pilih tanggal awal atau akhir terlebih dahulu');
      return;
    }

    _customHistoryDateFrom = from;
    _customHistoryDateTo = to;
    _activeHistoryDateFilter = 'custom';

    // Deselect all quick chips because custom date range is used
    var container = $('purchasing-history-filter-chips');
    if (container) {
      var chips = container.querySelectorAll('.purchasing-history-chip');
      chips.forEach(function (c) {
        c.classList.remove('active');
      });
    }

    // Ambil data dari server untuk rentang tanggal kustom tanpa batas
    loadPurchasingHistory(from, to);
  }
  window.searchPurchasingHistoryCustomRange = searchPurchasingHistoryCustomRange;

  function renderPurchasingHistoryList() {
    var container = $('purchasing-history-container');
    if (!container) return;

    // Pastikan event listener search bound
    var sInput = $('purchasing-history-search');
    if (sInput && !sInput._searchBound) {
      sInput._searchBound = true;
      sInput.addEventListener('input', function () { onPurchasingHistorySearch(this.value); });
      sInput.addEventListener('keyup', function () { onPurchasingHistorySearch(this.value); });
      sInput.addEventListener('search', function () { onPurchasingHistorySearch(this.value); });
    }

    // Set initial date inputs jika masih kosong
    var now = new Date();
    var todayLocal = formatLocalDateWIB(now);
    var fromIn = $('purchasing-history-date-from');
    var toIn = $('purchasing-history-date-to');
    if (fromIn && !fromIn.value) fromIn.value = _customHistoryDateFrom || todayLocal;
    if (toIn && !toIn.value) toIn.value = _customHistoryDateTo || todayLocal;

    if (!_purchasingHistorySessions || !_purchasingHistorySessions.length) {
      container.innerHTML =
        '<div style="text-align:center; padding:40px 20px; background:#fff; border-radius:16px; border:1px dashed #cbd5e1;">' +
          '<div style="font-size:36px; margin-bottom:8px;">🛒</div>' +
          '<div style="font-size:15px; font-weight:700; color:#334155;">Belum Ada Riwayat Belanja</div>' +
          '<div style="font-size:12px; color:#64748b; margin-top:4px;">Belanjaan yang diselesaikan akan otomatis tercatat di sini.</div>' +
        '</div>';
      return;
    }

    // Apply Filter
    var filtered = _purchasingHistorySessions.filter(function (sess) {
      var d = new Date(sess.timestamp);
      var sessLocal = formatLocalDateWIB(d);

      var dateStr = '';
      try {
        dateStr = d.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      } catch (_) {
        dateStr = sess.timestamp;
      }

      // Date filter
      if (_customHistoryDateFrom && sessLocal < _customHistoryDateFrom) return false;
      if (_customHistoryDateTo && sessLocal > _customHistoryDateTo) return false;

      // Search Query
      if (_activeHistorySearchQuery) {
        var query = _activeHistorySearchQuery;
        var matchSessionId = (sess.posting_id || '').toLowerCase().includes(query);
        var matchActor = (sess.actor_name || '').toLowerCase().includes(query);
        var matchDate = dateStr.toLowerCase().includes(query);
        var matchItems = (sess.items || []).some(function (itm) {
          return (itm.material_name || '').toLowerCase().includes(query) ||
                 (itm.uom || '').toLowerCase().includes(query) ||
                 String(itm.unit_price).includes(query) ||
                 String(itm.total_price).includes(query);
        });
        if (!matchSessionId && !matchActor && !matchDate && !matchItems) return false;
      }

      return true;
    });

    if (!filtered.length) {
      var filterDesc = 'Periode Ini';
      if (_activeHistoryDateFilter === 'today') filterDesc = 'Hari Ini';
      else if (_activeHistoryDateFilter === 'yesterday') filterDesc = 'Kemarin';
      else if (_activeHistoryDateFilter === '7days') filterDesc = '7 Hari Terakhir';
      else if (_activeHistoryDateFilter === '30days') filterDesc = '30 Hari Terakhir';
      else if (_activeHistoryDateFilter === 'custom') {
        if (_customHistoryDateFrom && _customHistoryDateTo) {
          filterDesc = _customHistoryDateFrom + ' s/d ' + _customHistoryDateTo;
        } else {
          filterDesc = 'Rentang Tanggal Ini';
        }
      }
      container.innerHTML =
        '<div style="text-align:center; padding:32px 20px; background:#fff; border-radius:16px; border:1px dashed #cbd5e1;">' +
          '<div style="font-size:28px; margin-bottom:6px;">🔍</div>' +
          '<div style="font-size:14.5px; font-weight:700; color:#334155;">Tidak Ada Hasil untuk ' + esc(filterDesc) + '</div>' +
          '<div style="font-size:12px; color:#64748b; margin-top:4px;">Coba ubah tanggal atau kata kunci pencarian.</div>' +
          '<button type="button" class="x-btn-secondary" onclick="clearPurchasingHistorySearch(); setPurchasingHistoryFilter(\'today\');" style="margin-top:12px; font-size:12px; padding:6px 14px; border-radius:8px;">Reset ke Hari Ini</button>' +
        '</div>';
      return;
    }

    var html = '';
    filtered.forEach(function (sess) {
      var dateStr = '';
      try {
        var d = new Date(sess.timestamp);
        dateStr = d.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      } catch (_) {
        dateStr = sess.timestamp;
      }

      // Saring item di dalam card jika user mencari kata kunci nama bahan tertentu
      var displayItems = sess.items;
      var isItemFiltered = false;
      if (_activeHistorySearchQuery) {
        var q = _activeHistorySearchQuery;
        var matchedItems = sess.items.filter(function (itm) {
          return (itm.material_name || '').toLowerCase().includes(q) ||
                 (itm.uom || '').toLowerCase().includes(q);
        });
        if (matchedItems.length > 0) {
          displayItems = matchedItems;
          isItemFiltered = (matchedItems.length < sess.items.length);
        }
      }

      var matchFilterBadge = isItemFiltered
        ? '<div style="font-size:11px; font-weight:700; color:#0369a1; background:#f0f9ff; padding:2px 8px; border-radius:6px; border:1px solid #bae6fd; display:inline-block; margin-top:4px;">Cocok: ' + displayItems.length + ' dari ' + sess.items.length + ' item</div>'
        : '';

      html +=
        '<div class="purchasing-history-card">' +
          '<div class="purchasing-history-head">' +
            '<div>' +
              '<div class="purchasing-history-date">' + highlightMatch(dateStr, _activeHistorySearchQuery) + '</div>' +
              '<div class="purchasing-history-actor">Petugas: ' + highlightMatch(sess.actor_name, _activeHistorySearchQuery) + (sess.posting_id ? ' • <span style="font-weight:700; color:#0284c7;">' + highlightMatch(sess.posting_id, _activeHistorySearchQuery) + '</span>' : '') + '</div>' +
              matchFilterBadge +
            '</div>' +
            '<div class="purchasing-history-total">' + formatMoney(sess.total_spend) + '</div>' +
          '</div>' +
          '<div class="purchasing-history-items-list">';

      displayItems.forEach(function (itm) {
        var qtyFormatted = itm.quantity % 1 === 0 ? itm.quantity : Number(itm.quantity).toFixed(1);
        html +=
          '<div class="purchasing-history-item-row">' +
            '<div style="flex:1; min-width:0;">' +
              '<div style="font-size:13.5px; font-weight:700; color:#0f172a;">' + highlightMatch(itm.material_name, _activeHistorySearchQuery) + '</div>' +
              '<div style="font-size:11.5px; color:#64748b;">' + qtyFormatted + ' ' + highlightMatch(itm.uom, _activeHistorySearchQuery) + ' @ ' + formatMoney(itm.unit_price) + '</div>' +
            '</div>' +
            '<div style="font-size:13px; font-weight:800; color:#334155;">' + formatMoney(itm.total_price) + '</div>' +
          '</div>';
      });

      html += '</div></div>';
    });

    container.innerHTML = html;
  }
  window.renderPurchasingHistoryList = renderPurchasingHistoryList;

  /* =========================================================================
     QUICK MARKET CALCULATOR
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
      // Safe sanitized arithmetic evaluation without arbitrary code execution
      var sanitized = _calcFormula.replace(/[^0-9+\-*/.]/g, '');
      if (!sanitized) return;
      var fn = new Function('return (' + sanitized + ')');
      var res = fn();
      if (!isNaN(res) && isFinite(res)) {
        _calcLastResult = Math.round(res * 100) / 100;
        _calcFormula = String(_calcLastResult);
      }
    } catch (_) {
      // Ignore evaluation syntax error
    }
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
    var raw = String(cashIn.value || '').replace(/[^0-9]/g, '');
    return parseInt(raw, 10) || 0;
  }

  function formatNominal(num) {
    return Number(num || 0).toLocaleString('id-ID');
  }

  function onPurchasingCalcCashInput(val) {
    var num = parseInt(String(val || '').replace(/[^0-9]/g, ''), 10) || 0;
    var cashIn = $('input-purchasing-calc-cash');
    if (cashIn) {
      cashIn.value = num > 0 ? formatNominal(num) : '';
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
      cashIn.value = amount > 0 ? formatNominal(amount) : '';
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
  window.calculatePurchasingCalcChange = calculatePurchasingCalcChange;

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
  window.loadBrandLogoForPurchasing = loadBrandLogoForPurchasing;

  function initPurchasingInputs() {
    var cashAdvInput = $('input-purchasing-cash-advance');
    if (cashAdvInput) {
      setupCurrencyInputAutoDot(cashAdvInput, function () {
        recalculatePurchasingSummary();
      });
    }

    var modalPriceInput = $('input-purchasing-modal-price');
    if (modalPriceInput) {
      setupCurrencyInputAutoDot(modalPriceInput);
    }

    loadBrandLogoForPurchasing();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPurchasingInputs);
  } else {
    initPurchasingInputs();
  }

})();

