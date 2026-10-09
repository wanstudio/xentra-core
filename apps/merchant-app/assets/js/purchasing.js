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
    activeEditItemId: null
  };

  async function loadPurchasingChecklist() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var container = $('purchasing-checklist-container');
    if (container) {
      container.innerHTML = '<div class="text-center py-6 text-muted">Memuat catatan belanja pasar...</div>';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/checklist', {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (res.ok && data.success) {
        var rawItems = data.items || [];
        // Map items with interactive state
        _purchasingState.items = rawItems.map(function (item) {
          var initialChecked = item.is_low;
          var initialQty = item.is_low ? (item.suggested_qty || 1) : 1;
          var initialPrice = item.last_unit_cost || 0;
          return {
            ...item,
            checked: initialChecked,
            buyQty: initialQty,
            actualUnitPrice: initialPrice
          };
        });

        // Set estimated budget label
        var estBudgetEl = $('label-purchasing-est-budget');
        if (estBudgetEl) {
          estBudgetEl.textContent = formatMoney(data.total_estimated_budget || 0);
        }

        var lowCount = rawItems.filter(function (i) { return i.is_low; }).length;
        var badgeEl = $('badge-purchasing-low-count');
        if (badgeEl) {
          badgeEl.textContent = lowCount + ' bahan menipis';
          badgeEl.className = lowCount > 0 ? 'x-badge x-badge-warning' : 'x-badge x-badge-success';
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
    _purchasingState.filterMode = mode;
    var btnLow = $('btn-purchasing-filter-low');
    var btnAll = $('btn-purchasing-filter-all');
    if (btnLow) btnLow.classList.toggle('active', mode === 'low');
    if (btnAll) btnAll.classList.toggle('active', mode === 'all');
    renderPurchasingList();
  }
  window.filterPurchasingList = filterPurchasingList;

  function renderPurchasingList() {
    var container = $('purchasing-checklist-container');
    if (!container) return;

    var filtered = _purchasingState.items.filter(function (item) {
      if (_purchasingState.filterMode === 'low') {
        return item.is_low;
      }
      return true;
    });

    var countEl = $('purchasing-item-count');
    if (countEl) countEl.textContent = filtered.length;

    if (!filtered.length) {
      container.innerHTML =
        '<div style="text-align:center; padding:40px 20px; background:#f8fafc; border-radius:12px; border:1px dashed #cbd5e1;">' +
          '<div style="font-size:36px; margin-bottom:8px;">🥬</div>' +
          '<div style="font-size:15px; font-weight:700; color:#334155;">Semua Bahan Masih Aman</div>' +
          '<div style="font-size:12px; color:#64748b; margin-top:4px;">Tidak ada bahan yang berada di bawah batas minimum stok.</div>' +
          '<button type="button" class="x-btn-secondary" onclick="filterPurchasingList(\'all\')" style="margin-top:12px; font-size:12px; padding:6px 14px;">Lihat Semua Bahan</button>' +
        '</div>';
      return;
    }

    var html = '';
    filtered.forEach(function (item) {
      var isChecked = item.checked;
      var subtotal = Math.round(item.buyQty * item.actualUnitPrice);
      var uomCode = item.base_uom_code || item.base_uom_name || 'Unit';

      html +=
        '<div class="x-card-panel" style="padding:14px 16px; border-radius:12px; border:1px solid ' + (isChecked ? '#86efac' : '#e2e8f0') + '; background:' + (isChecked ? '#ffffff' : '#f8fafc') + '; box-shadow:0 2px 4px rgba(0,0,0,0.02); transition:all 0.15s ease;">' +
          '<div style="display:flex; align-items:flex-start; gap:12px;">' +
            // Checkbox
            '<div style="padding-top:2px;">' +
              '<input type="checkbox" id="chk-' + esc(item.material_id) + '" ' + (isChecked ? 'checked' : '') + ' onchange="togglePurchasingItemCheck(\'' + esc(item.material_id) + '\', this.checked)" style="width:20px; height:20px; cursor:pointer; accent-color:#16a34a;">' +
            '</div>' +

            // Content body
            '<div style="flex:1;">' +
              '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">' +
                '<div>' +
                  '<label for="chk-' + esc(item.material_id) + '" style="font-size:15px; font-weight:800; color:' + (isChecked ? '#1e293b' : '#64748b') + '; cursor:pointer; display:block; margin-bottom:2px;">' +
                    esc(item.material_name) +
                  '</label>' +
                  '<div style="font-size:11px; color:var(--text-muted);">' +
                    'Stok saat ini: <strong>' + Number(item.current_stock).toFixed(1) + ' ' + esc(uomCode) + '</strong> ' +
                    (item.is_low ? '<span style="color:#dc2626; font-weight:700;">(Menipis, Min: ' + item.minimum_quantity + ')</span>' : '') +
                  '</div>' +
                '</div>' +
                '<div style="text-align:right;">' +
                  '<div style="font-size:14px; font-weight:800; color:' + (isChecked ? '#166534' : '#94a3b8') + ';">' +
                    formatMoney(subtotal) +
                  '</div>' +
                  '<small style="font-size:10px; color:var(--text-muted);">Subtotal</small>' +
                '</div>' +
              '</div>' +

              // Input row (Berapa banyak & Berapa harga per unit)
              '<div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; background:' + (isChecked ? '#f0fdf4' : '#f1f5f9') + '; padding:10px 12px; border-radius:8px;">' +
                // Qty Belanja
                '<div style="flex:1; min-width:120px;">' +
                  '<label style="display:block; font-size:11px; font-weight:700; color:#334155; margin-bottom:3px;">' +
                    'Beli Berapa (' + esc(uomCode) + ')' +
                  '</label>' +
                  '<div style="display:flex; align-items:center; gap:4px;">' +
                    '<button type="button" class="x-btn-secondary" onclick="stepPurchasingQty(\'' + esc(item.material_id) + '\', -1)" style="padding:4px 8px; font-size:12px; font-weight:800;">-</button>' +
                    '<input type="number" min="0.1" step="any" value="' + item.buyQty + '" oninput="updatePurchasingItemQty(\'' + esc(item.material_id) + '\', this.value)" class="x-input" style="flex:1; padding:5px 8px; font-size:13px; font-weight:700; text-align:center; background:#ffffff;">' +
                    '<button type="button" class="x-btn-secondary" onclick="stepPurchasingQty(\'' + esc(item.material_id) + '\', 1)" style="padding:4px 8px; font-size:12px; font-weight:800;">+</button>' +
                  '</div>' +
                '</div>' +

                // Harga Pasar Riil per Unit
                '<div style="flex:1; min-width:140px;">' +
                  '<label style="display:block; font-size:11px; font-weight:700; color:#334155; margin-bottom:3px;">' +
                    'Harga Pasar / ' + esc(uomCode) + ' (Rp)' +
                  '</label>' +
                  '<input type="number" min="0" step="500" value="' + item.actualUnitPrice + '" oninput="updatePurchasingItemPrice(\'' + esc(item.material_id) + '\', this.value)" class="x-input" style="width:100%; padding:5px 8px; font-size:13px; font-weight:700; background:#ffffff;">' +
                '</div>' +
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

  function updatePurchasingItemQty(materialId, val) {
    var num = parseFloat(val);
    var itm = _purchasingState.items.find(function (i) { return i.material_id === materialId; });
    if (itm && !isNaN(num) && num >= 0) {
      itm.buyQty = num;
      renderPurchasingList();
      recalculatePurchasingSummary();
    }
  }
  window.updatePurchasingItemQty = updatePurchasingItemQty;

  function stepPurchasingQty(materialId, delta) {
    var itm = _purchasingState.items.find(function (i) { return i.material_id === materialId; });
    if (itm) {
      var next = Math.max(0.5, (itm.buyQty || 0) + delta);
      itm.buyQty = Math.round(next * 10) / 10;
      renderPurchasingList();
      recalculatePurchasingSummary();
    }
  }
  window.stepPurchasingQty = stepPurchasingQty;

  function updatePurchasingItemPrice(materialId, val) {
    var num = parseFloat(val);
    var itm = _purchasingState.items.find(function (i) { return i.material_id === materialId; });
    if (itm && !isNaN(num) && num >= 0) {
      itm.actualUnitPrice = num;
      renderPurchasingList();
      recalculatePurchasingSummary();
    }
  }
  window.updatePurchasingItemPrice = updatePurchasingItemPrice;

  function recalculatePurchasingSummary() {
    var cashAdvanceInput = $('input-purchasing-cash-advance');
    var cashAdvance = cashAdvanceInput ? (parseFloat(cashAdvanceInput.value) || 0) : 0;
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
    var confirmMsg = 'Selesaikan catatan belanja ini?\n\n' +
      '• Jumlah Barang: ' + checkedItems.length + ' macam\n' +
      '• Total Belanja: ' + formatMoney(totalReal) + '\n' +
      '• Uang Kasbon: ' + formatMoney(cashAdvance) + '\n' +
      '• Sisa Kembalian: ' + (changeDue >= 0 ? formatMoney(changeDue) : 'Kurang ' + formatMoney(Math.abs(changeDue))) + '\n\n' +
      'Stok bahan baku di gudang cabang akan otomatis bertambah.';

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
          cash_advance: cashAdvance,
          items: lines,
          notes: 'Belanja Pasar'
        })
      });
      var data = await res.json();

      if (res.ok && data.success) {
        showToast('🛒 Belanja berhasil dicatat! Stok bahan baku telah ditambahkan.');
        // Reset input kasbon
        var cashInput = $('input-purchasing-cash-advance');
        if (cashInput) cashInput.value = '';
        _purchasingState.cashAdvance = 0;
        // Reload checklist
        loadPurchasingChecklist();
      } else {
        showToast('Gagal mencatat belanja: ' + (data.message || data.error || 'Terjadi kesalahan'));
      }
    } catch (err) {
      console.error('[Purchasing] Settle error:', err);
      showToast('Kesalahan jaringan saat menyimpan belanja.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>✓</span> Selesai & Masukkan Stok';
      }
    }
  }
  window.submitPurchasingSettle = submitPurchasingSettle;

})();
