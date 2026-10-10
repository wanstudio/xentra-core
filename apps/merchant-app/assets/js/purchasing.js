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

  async function submitPurchasingSettle() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var checkedItems = _purchasingState.items.filter(function (i) { return i.checked && i.buyQty > 0; });
    if (!checkedItems.length) {
      showToast('Pilih minimal satu barang yang dibeli.');
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

    var confirmMsg = 'Selesaikan aktivitas belanja pasar ini?\n\n' +
      '• Terbeli: ' + checkedItems.length + ' item\n' +
      (unboughtCount > 0 ? '• Belum Terbeli: ' + unboughtCount + ' item (tetap berstatus butuh belanja)\n' : '') +
      '• Total Belanja: ' + formatMoney(totalReal) + '\n' +
      '• Uang Modal: ' + formatMoney(cashAdvance) + '\n' +
      '• Sisa Kembalian: ' + (changeDue >= 0 ? formatMoney(changeDue) : 'Kurang ' + formatMoney(Math.abs(changeDue))) + '\n\n' +
      'Stok barang yang terbeli akan langsung masuk ke persediaan cabang.';

    if (!confirm(confirmMsg)) return;

    var submitBtn = $('btn-purchasing-submit-settle');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Menyimpan ke Stok...';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/settle', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          mandate_id: _purchasingState.activeMandateId,
          cash_advance: cashAdvance,
          items: lines,
          notes: 'Belanja Pasar'
        })
      });
      var data = await res.json();

      if (res.ok && data.success) {
        showToast('🛒 Belanja berhasil dicatat! Stok bahan baku telah ditambahkan.');
        var cashInput = $('input-purchasing-cash-advance');
        if (cashInput) cashInput.value = '';
        _purchasingState.cashAdvance = 0;
        loadPurchasingChecklist();
      } else {
        showToast('Gagal mencatat belanja: ' + (data.message || data.error || 'Terjadi kesalahan'));
      }
    } catch (err) {
      showToast('Gangguan jaringan saat menyelesaikan belanja.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '✓ Selesai Belanja';
      }
    }
  }
  window.submitPurchasingSettle = submitPurchasingSettle;

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

    // Hide or show bottom settlement bar only on Tasks view
    var bottomBar = $('purchasing-bottom-bar');
    if (bottomBar) {
      bottomBar.style.display = viewId === 'tasks' ? 'flex' : 'none';
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
            '<div style="font-size:11px; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:0.04em;">PO #' + esc(po.id.slice(-6)) + '</div>' +
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
    var subtitle = $('purchasing-receive-subtitle');
    var body = $('purchasing-receive-body');

    if (subtitle) {
      subtitle.textContent = 'PO #' + po.id.slice(-6) + ' dari ' + po.supplier_name;
    }

    if (body) {
      var linesHtml = (po.lines || []).map(function (line, idx) {
        var packDesc = line.supplier_pack_name || (line.base_uom_name || 'unit');
        var orderedQty = Number(line.ordered_purchase_quantity) || 0;
        var remainingQty = Math.max(0, orderedQty - (Number(line.received_base_quantity || 0) / (Number(line.base_quantity_per_purchase_unit) || 1)));
        if (remainingQty <= 0) remainingQty = orderedQty;

        return '<div class="purchasing-receive-line" data-pol-id="' + esc(line.purchase_order_line_id) + '" data-ordered-qty="' + orderedQty + '">' +
          '<div class="purchasing-receive-line-head">' +
            '<div class="purchasing-receive-line-name">' + esc(line.material_name) + '</div>' +
            '<span class="x-badge purchasing-receive-line-badge">Dipesan: ' + esc(orderedQty) + ' ' + esc(packDesc) + '</span>' +
          '</div>' +
          '<div class="purchasing-receive-grid">' +
            '<div class="purchasing-receive-field">' +
              '<label class="purchasing-receive-label label-accepted">Layak Terima</label>' +
              '<input type="number" step="any" min="0" max="' + orderedQty + '" class="x-input input-receive-accepted purchasing-receive-input" value="' + esc(remainingQty) + '" oninput="onPurchasingReceiveQtyChange(this, \'accepted\')">' +
            '</div>' +
            '<div class="purchasing-receive-field">' +
              '<label class="purchasing-receive-label label-rejected">Ditolak / Rusak</label>' +
              '<input type="number" step="any" min="0" max="' + orderedQty + '" class="x-input input-receive-rejected purchasing-receive-input input-rejected" value="0" oninput="onPurchasingReceiveQtyChange(this, \'rejected\')">' +
            '</div>' +
          '</div>' +
          '<div class="purchasing-receive-status-hint">' +
            '<span>Status fisik:</span>' +
            '<span class="receive-status-pill">✓ Lengkap & Baik (' + orderedQty + ' ' + esc(packDesc) + ')</span>' +
          '</div>' +
        '</div>';
      }).join('');

      body.innerHTML = linesHtml;
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

  function updatePurchasingReceiveModalCta() {
    var btn = $('btn-submit-purchasing-receive');
    var container = $('purchasing-receive-body');
    if (!btn || !container) return;

    var lineEls = container.querySelectorAll('.purchasing-receive-line');
    var totalAccepted = 0;
    var totalRejected = 0;
    var totalOrdered = 0;

    lineEls.forEach(function (el) {
      var ord = Number(el.getAttribute('data-ordered-qty')) || 0;
      var accIn = el.querySelector('.input-receive-accepted');
      var rejIn = el.querySelector('.input-receive-rejected');
      totalOrdered += ord;
      totalAccepted += Number(accIn ? accIn.value : 0) || 0;
      totalRejected += Number(rejIn ? rejIn.value : 0) || 0;
    });

    if (totalAccepted === 0 && totalRejected > 0) {
      btn.textContent = '✕ Tolak Semua Barang';
      btn.style.background = '#dc2626';
      btn.style.borderColor = '#dc2626';
      btn.setAttribute('data-cta-mode', 'reject_all');
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
    var acceptedInput = lineCard.querySelector('.input-receive-accepted');
    var rejectedInput = lineCard.querySelector('.input-receive-rejected');
    var statusPill = lineCard.querySelector('.receive-status-pill');

    var accepted = parseFloat(acceptedInput ? acceptedInput.value : 0) || 0;
    var rejected = parseFloat(rejectedInput ? rejectedInput.value : 0) || 0;

    if (changedField === 'accepted') {
      if (accepted < 0) { accepted = 0; if (acceptedInput) acceptedInput.value = 0; }
      if (accepted > orderedQty) {
        accepted = orderedQty;
        if (acceptedInput) acceptedInput.value = orderedQty;
      }
      // Pola hitung: Ditolak/Rusak = Dipesan - Layak Diterima
      rejected = Math.max(0, orderedQty - accepted);
      if (rejectedInput) rejectedInput.value = rejected;
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
      if (rejected > 0 && accepted > 0) {
        statusPill.textContent = '⚠️ ' + accepted + ' Layak, ' + rejected + ' Rusak/Retur';
        statusPill.style.color = '#b45309';
      } else if (rejected === orderedQty) {
        statusPill.textContent = '❌ Seluruh Barang Ditolak (' + rejected + ')';
        statusPill.style.color = '#dc2626';
      } else if (accepted === orderedQty && rejected === 0) {
        statusPill.textContent = '✓ Lengkap & Baik (' + accepted + ')';
        statusPill.style.color = '#059669';
      } else {
        var shortage = Math.max(0, orderedQty - (accepted + rejected));
        statusPill.textContent = '⚠️ Kurang Kirim: ' + shortage;
        statusPill.style.color = '#b45309';
      }
    }

    // Auto-update placeholder catatan bila ada barang rusak
    var notesEl = $('input-purchasing-receive-notes');
    if (notesEl && rejected > 0 && !notesEl.value) {
      notesEl.placeholder = 'Catatan: ' + rejected + ' barang ditolak (tulis alasan cacat/segel rusak untuk retur supplier)';
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

  async function submitPurchasingReceive() {
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
    var lines = [];
    var lineEls = container.querySelectorAll('.purchasing-receive-line');
    lineEls.forEach(function (el) {
      var polId = el.getAttribute('data-pol-id');
      var accIn = el.querySelector('.input-receive-accepted');
      var rejIn = el.querySelector('.input-receive-rejected');
      var accepted = Number(accIn ? accIn.value : 0);
      var rejected = Number(rejIn ? rejIn.value : 0);
      totalAccepted += accepted;
      totalRejected += rejected;
      lines.push({
        purchase_order_line_id: polId,
        accepted_purchase_quantity: accepted,
        rejected_purchase_quantity: rejected,
        rejection_reason: rejected > 0 ? (notes || 'Barang ditolak saat penerimaan') : null
      });
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

    var btn = $('btn-submit-purchasing-receive');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Menyimpan...';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/orders/' + encodeURIComponent(_activeReceivePo.id) + '/receive', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ lines: lines })
      });
      var data = await res.json();

      if (res.ok && data.success) {
        if (totalAccepted === 0 && totalRejected > 0) {
          showToast('✓ Penolakan barang dicatat. Seluruh barang diretur ke supplier.');
        } else if (totalRejected > 0) {
          showToast('✓ Penerimaan sebagian berhasil dicatat. Stok bertambah sesuai barang layak.');
        } else {
          showToast('✓ Seluruh barang berhasil diterima! Stok bahan baku telah bertambah.');
        }
        closePurchasingReceiveModal();
        loadPurchasingOrders();
      } else {
        showToast('⚠️ Gagal konfirmasi: ' + (data.message || data.error || 'Periksa input barang'));
      }
    } catch (e) {
      showToast('⚠️ Gangguan jaringan saat konfirmasi penerimaan.');
    } finally {
      if (btn) {
        btn.disabled = false;
        updatePurchasingReceiveModalCta();
      }
    }
  }
  window.submitPurchasingReceive = submitPurchasingReceive;

  /* =========================================================================
     PURCHASING HISTORY (7 HARI TERAKHIR)
     ========================================================================= */
  async function loadPurchasingHistory() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var container = $('purchasing-history-container');
    if (container) {
      container.innerHTML = '<div class="text-center py-6 text-muted">Memuat riwayat belanja seminggu terakhir...</div>';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/history', {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (res.ok && data.success) {
        var sessions = data.sessions || [];
        if (!sessions.length) {
          if (container) {
            container.innerHTML =
              '<div style="text-align:center; padding:40px 20px; background:#fff; border-radius:16px; border:1px dashed #cbd5e1;">' +
                '<div style="font-size:36px; margin-bottom:8px;">🛒</div>' +
                '<div style="font-size:15px; font-weight:700; color:#334155;">Belum Ada Riwayat Belanja</div>' +
                '<div style="font-size:12px; color:#64748b; margin-top:4px;">Belanjaan yang dicatat dalam 7 hari terakhir akan muncul di sini.</div>' +
              '</div>';
          }
          return;
        }

        var html = '';
        sessions.forEach(function (sess) {
          var dateStr = '';
          try {
            var d = new Date(sess.timestamp);
            dateStr = d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
          } catch (_) {
            dateStr = sess.timestamp;
          }

          html +=
            '<div class="purchasing-history-card">' +
              '<div class="purchasing-history-head">' +
                '<div>' +
                  '<div class="purchasing-history-date">' + esc(dateStr) + '</div>' +
                  '<div class="purchasing-history-actor">Petugas: ' + esc(sess.actor_name) + '</div>' +
                '</div>' +
                '<div class="purchasing-history-total">' + formatMoney(sess.total_spend) + '</div>' +
              '</div>' +
              '<div class="purchasing-history-items-list">';

          sess.items.forEach(function (itm) {
            html +=
              '<div class="purchasing-history-item-row">' +
                '<div style="flex:1; min-width:0;">' +
                  '<div style="font-size:13.5px; font-weight:700; color:#0f172a;">' + esc(itm.material_name) + '</div>' +
                  '<div style="font-size:11.5px; color:#64748b;">' + Number(itm.quantity).toFixed(1) + ' ' + esc(itm.uom) + ' @ ' + formatMoney(itm.unit_price) + '</div>' +
                '</div>' +
                '<div style="font-size:13px; font-weight:800; color:#334155;">' + formatMoney(itm.total_price) + '</div>' +
              '</div>';
          });

          html += '</div></div>';
        });

        if (container) container.innerHTML = html;
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

