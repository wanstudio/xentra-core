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
          badgeEl.textContent = 'Mandat #' + activeMandate.mandate_number;
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
        '<div id="card-item-' + esc(item.material_id) + '" class="purchasing-item-card ' + (isChecked ? 'is-checked' : 'is-unchecked') + '" style="border-radius:14px; padding:12px 14px; margin-bottom:8px; background:#ffffff; border:1.5px solid ' + (isChecked ? '#059669' : '#e2e8f0') + '; box-shadow:0 1px 3px rgba(0,0,0,0.03);">' +
          '<div class="purchasing-item-main" style="display:flex; align-items:center; gap:12px;">' +
            '<div class="purchasing-item-check-col">' +
              '<input type="checkbox" id="chk-' + esc(item.material_id) + '" class="purchasing-check-box" style="width:22px; height:22px; cursor:pointer; accent-color:#059669;" ' + (isChecked ? 'checked' : '') + ' onchange="togglePurchasingItemCheck(\'' + esc(item.material_id) + '\', this.checked)">' +
            '</div>' +
            '<div class="purchasing-item-info-col" style="flex:1; min-width:0;">' +
              '<div style="display:flex; justify-content:space-between; align-items:baseline;">' +
                '<label for="chk-' + esc(item.material_id) + '" style="font-size:14.5px; font-weight:800; color:#0f172a; cursor:pointer; margin:0;">' +
                  esc(item.material_name) +
                '</label>' +
                '<div class="purchasing-item-subtotal-val" style="font-size:14px; font-weight:800; color:' + (isChecked ? '#059669' : '#475569') + ';">' +
                  formatMoney(subtotal) +
                '</div>' +
              '</div>' +
              '<div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; flex-wrap:wrap; gap:6px;">' +
                '<div style="font-size:12px; color:#475569;">' +
                  'Beli: <strong style="color:#0f172a; font-size:13px;">' + item.buyQty + ' ' + esc(uomCode) + '</strong>' +
                  ' <span style="color:#94a3b8; font-size:11px;">(kuota terkunci)</span>' +
                '</div>' +
                '<button type="button" onclick="openPurchasingUpdatePriceModal(\'' + esc(item.material_id) + '\')" style="background:#f1f5f9; border:1px solid #cbd5e1; border-radius:8px; padding:3px 8px; font-size:11.5px; font-weight:700; color:#1e293b; cursor:pointer; display:flex; align-items:center; gap:4px;">' +
                  '<span>@ ' + formatMoney(item.actualUnitPrice) + '</span>' +
                  (item.has_price_update ? '<span class="x-badge" style="background:#dbeafe; color:#1e40af; font-size:9.5px; padding:1px 4px;">harga_update</span>' : '<span style="color:#64748b; font-size:11px;">✎</span>') +
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
    var priceIn = $('input-purchasing-modal-price');
    var modal = $('modal-purchasing-update-price');

    if (nameEl) nameEl.textContent = itm.material_name + ' (per ' + (itm.base_uom_code || itm.base_uom_name || 'unit') + ')';
    if (priceIn) {
      priceIn.value = itm.actualUnitPrice || '';
      setTimeout(function () { priceIn.focus(); priceIn.select(); }, 50);
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
    var priceIn = $('input-purchasing-modal-price');
    var newPrice = parseFloat(priceIn ? priceIn.value : 0);

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
     VIEW SWITCHER (PASAR, PO SUPPLIER, RIWAYAT, MANDAT, KALKULATOR)
     ========================================================================= */
  function switchPurchasingView(viewId) {
    var vTasks = $('purchasing-view-tasks');
    var vPo = $('purchasing-view-po');
    var vHistory = $('purchasing-view-history');
    var vMandates = $('purchasing-view-mandates');
    var vCalc = $('purchasing-view-calc');

    var btnTasks = $('btn-purchasing-nav-tasks');
    var btnPo = $('btn-purchasing-nav-po');
    var btnHistory = $('btn-purchasing-nav-history');
    var btnMandates = $('btn-purchasing-nav-mandates');
    var btnCalc = $('btn-purchasing-nav-calc');

    if (vTasks) vTasks.style.display = viewId === 'tasks' ? 'block' : 'none';
    if (vPo) vPo.style.display = viewId === 'po' ? 'block' : 'none';
    if (vHistory) vHistory.style.display = viewId === 'history' ? 'block' : 'none';
    if (vMandates) vMandates.style.display = viewId === 'mandates' ? 'block' : 'none';
    if (vCalc) vCalc.style.display = viewId === 'calc' ? 'block' : 'none';

    if (btnTasks) btnTasks.classList.toggle('active', viewId === 'tasks');
    if (btnPo) btnPo.classList.toggle('active', viewId === 'po');
    if (btnHistory) btnHistory.classList.toggle('active', viewId === 'history');
    if (btnMandates) btnMandates.classList.toggle('active', viewId === 'mandates');
    if (btnCalc) btnCalc.classList.toggle('active', viewId === 'calc');

    // Hide or show bottom settlement bar only on Tasks view
    var bottomBar = $('purchasing-bottom-bar');
    if (bottomBar) {
      bottomBar.style.display = viewId === 'tasks' ? 'flex' : 'none';
    }

    if (viewId === 'po') {
      loadPurchasingOrders();
    } else if (viewId === 'history') {
      loadPurchasingHistory();
    } else if (viewId === 'mandates') {
      loadPurchasingMandatesManager();
    }
  }
  window.switchPurchasingView = switchPurchasingView;

  // Manager Mandates view loader
  var _managerMandatesList = [];
  async function loadPurchasingMandatesManager() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var container = $('purchasing-mandates-manager-container');
    if (container) {
      container.innerHTML = '<div class="text-center py-6 text-muted">Memuat daftar mandat belanja...</div>';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/mandates', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success) {
        _managerMandatesList = data.mandates || [];
        renderPurchasingMandatesManager(_managerMandatesList);
      } else {
        if (container) {
          container.innerHTML = '<div class="text-center py-6 text-danger">Gagal memuat mandat: ' + esc(data.message || 'Terjadi kesalahan') + '</div>';
        }
      }
    } catch (err) {
      if (container) {
        container.innerHTML = '<div class="text-center py-6 text-danger">Gangguan jaringan saat memuat mandat.</div>';
      }
    }
  }
  window.loadPurchasingMandatesManager = loadPurchasingMandatesManager;

  function renderPurchasingMandatesManager(mandates) {
    var container = $('purchasing-mandates-manager-container');
    if (!container) return;

    if (!mandates || !mandates.length) {
      container.innerHTML = '<div class="text-center py-6 text-muted">' +
        '<div style="font-size:32px; margin-bottom:8px;">📋</div>' +
        '<strong>Belum ada mandat belanja</strong>' +
        '<p style="font-size:12px; margin:4px 0 0;">Mandat belanja dapat dirilis dari Rekomendasi Sistem di Dashboard atau tombol Rilis Mandat.</p>' +
      '</div>';
      return;
    }

    container.innerHTML = mandates.map(function (m) {
      var statusColor = m.status === 'RELEASED' ? '#b45309' : (m.status === 'COMPLETED' ? '#047857' : '#64748b');
      var statusBg = m.status === 'RELEASED' ? '#fef3c7' : (m.status === 'COMPLETED' ? '#d1fae5' : '#f1f5f9');

      var itemsHtml = (m.items || []).map(function (itm) {
        return '<div style="display:flex; justify-content:space-between; font-size:12px; padding:3px 0; border-bottom:1px dashed #e2e8f0;">' +
          '<span>• ' + esc(itm.material_name) + ' (' + itm.target_quantity + ' ' + esc(itm.base_uom_code || '') + ')</span>' +
          '<span>' + (itm.is_purchased ? '✓ Terbeli' : 'Belum') + '</span>' +
        '</div>';
      }).join('');

      var canEdit = m.status === 'RELEASED';
      var actions = '<div style="display:flex; gap:6px; margin-top:10px; flex-wrap:wrap;">';
      if (canEdit) {
        actions += '<button type="button" class="purchasing-filter-btn" onclick="promptEditMandateCash(\'' + m.id + '\', ' + (m.cash_advance || 0) + ')" style="padding:4px 8px; font-size:11.5px;">✏️ Ubah Kasbon</button>';
      }
      if (m.status !== 'ARCHIVED') {
        actions += '<button type="button" class="purchasing-filter-btn" onclick="archiveMandateApp(\'' + m.id + '\')" style="padding:4px 8px; font-size:11.5px;">📁 Arsipkan</button>';
      }
      actions += '<button type="button" class="purchasing-filter-btn" onclick="deleteMandateApp(\'' + m.id + '\')" style="padding:4px 8px; font-size:11.5px; color:#dc2626; border-color:#fca5a5;">🗑️ Hapus</button>';
      actions += '</div>';

      return '<div class="purchasing-item-card" style="padding:14px; flex-direction:column; align-items:stretch;">' +
        '<div style="display:flex; justify-content:space-between; align-items:start;">' +
          '<div>' +
            '<strong style="font-size:14px; color:#0f172a;">Mandat #' + esc(m.mandate_number) + '</strong>' +
            '<div style="font-size:11px; color:#64748b; margin-top:2px;">' + (m.notes ? esc(m.notes) : 'Mandat belanja cabang') + '</div>' +
          '</div>' +
          '<span class="x-badge" style="background:' + statusBg + '; color:' + statusColor + '; font-weight:700;">' + esc(m.status) + '</span>' +
        '</div>' +
        '<div style="display:flex; justify-content:space-between; margin-top:8px; font-size:12px; background:#f8fafc; padding:6px 10px; border-radius:6px;">' +
          '<span>Kasbon: <strong style="color:#059669;">' + formatMoney(m.cash_advance || 0) + '</strong></span>' +
          '<span>Total Target: <strong>' + formatMoney(m.total_planned_budget || 0) + '</strong></span>' +
        '</div>' +
        '<div style="margin-top:8px;">' + itemsHtml + '</div>' +
        actions +
      '</div>';
    }).join('');
  }

  async function promptEditMandateCash(mandateId, currentCash) {
    var val = prompt('Ubah jumlah uang kasbon (Rp):', currentCash);
    if (val === null) return;
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/mandates/' + encodeURIComponent(mandateId), {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ cash_advance: Number(val) || 0 })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('✓ Kasbon mandat belanja berhasil diubah.');
        loadPurchasingMandatesManager();
      } else {
        showToast('Gagal update: ' + (data.message || data.error || 'Terjadi kesalahan'));
      }
    } catch (err) {
      showToast('Gangguan jaringan saat mengubah kasbon.');
    }
  }
  window.promptEditMandateCash = promptEditMandateCash;

  async function archiveMandateApp(mandateId) {
    if (!confirm('Arsipkan mandat belanja ini?')) return;
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/mandates/' + encodeURIComponent(mandateId) + '/archive', {
        method: 'PATCH',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('📁 Mandat berhasil diarsipkan.');
        loadPurchasingMandatesManager();
      } else {
        showToast('Gagal arsip: ' + (data.message || data.error || 'Terjadi kesalahan'));
      }
    } catch (err) {
      showToast('Gangguan jaringan saat mengarsipkan mandat.');
    }
  }
  window.archiveMandateApp = archiveMandateApp;

  async function deleteMandateApp(mandateId) {
    if (!confirm('Hapus permanen mandat belanja ini?')) return;
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/mandates/' + encodeURIComponent(mandateId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('🗑️ Mandat belanja berhasil dihapus permanen.');
        loadPurchasingMandatesManager();
      } else {
        showToast('Gagal hapus: ' + (data.message || data.error || 'Terjadi kesalahan'));
      }
    } catch (err) {
      showToast('Gangguan jaringan saat menghapus mandat.');
    }
  }
  window.deleteMandateApp = deleteMandateApp;

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
        var remainingQty = Math.max(0, Number(line.ordered_purchase_quantity) - (Number(line.received_base_quantity || 0) / (Number(line.base_quantity_per_purchase_unit) || 1)));
        if (remainingQty <= 0) remainingQty = Number(line.ordered_purchase_quantity);

        return '<div class="purchasing-receive-line" data-pol-id="' + esc(line.purchase_order_line_id) + '" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:8px;">' +
          '<div style="display:flex; justify-content:space-between; align-items:center;">' +
            '<div style="font-size:13.5px; font-weight:700; color:#0f172a;">' + esc(line.material_name) + '</div>' +
            '<span class="x-badge" style="background:#ffffff; border:1px solid #cbd5e1; font-size:11px; color:#475569;">Pesan: ' + esc(line.ordered_purchase_quantity) + ' ' + esc(packDesc) + '</span>' +
          '</div>' +
          '<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">' +
            '<div>' +
              '<label style="font-size:11px; font-weight:700; color:#166534; display:block; margin-bottom:3px;">Layak Terima (' + esc(packDesc) + ')</label>' +
              '<input type="number" step="any" min="0" class="x-input input-receive-accepted" value="' + esc(remainingQty) + '" style="width:100%; height:38px; border-radius:8px; font-weight:700; color:#0f172a; text-align:center;">' +
            '</div>' +
            '<div>' +
              '<label style="font-size:11px; font-weight:700; color:#991b1b; display:block; margin-bottom:3px;">Ditolak/Rusak</label>' +
              '<input type="number" step="any" min="0" class="x-input input-receive-rejected" value="0" style="width:100%; height:38px; border-radius:8px; font-weight:700; color:#991b1b; text-align:center;">' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');

      body.innerHTML = linesHtml;
    }

    if (modal) modal.style.display = 'flex';
  }
  window.openPurchasingReceiveModal = openPurchasingReceiveModal;

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

    var lines = [];
    var lineEls = container.querySelectorAll('.purchasing-receive-line');
    lineEls.forEach(function (el) {
      var polId = el.getAttribute('data-pol-id');
      var accIn = el.querySelector('.input-receive-accepted');
      var rejIn = el.querySelector('.input-receive-rejected');
      var accepted = Number(accIn ? accIn.value : 0);
      var rejected = Number(rejIn ? rejIn.value : 0);
      lines.push({
        purchase_order_line_id: polId,
        accepted_purchase_quantity: accepted,
        rejected_purchase_quantity: rejected
      });
    });

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
        showToast('✓ Barang berhasil diterima! Stok bahan baku telah bertambah.');
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
        btn.textContent = '✓ Terima Barang';
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

})();

