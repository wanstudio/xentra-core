/**
 * XENTRA CORE — MERCHANT APP STOCK
 *
 * Branch Manager inventory monitoring and stock adjustments.
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
  var getBMTargetBranchId = window.getBMTargetBranchId;

  var _bmStockState = {
    inventory: [],
    searchQuery: '',
    statusFilter: 'all',
    fetchSeq: 0
  };

  async function loadBMStock() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var tbody = $('bm-stock-tbody');
    if (tbody && (!_bmStockState.inventory || !_bmStockState.inventory.length)) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Memuat inventaris cabang...</td></tr>';
    }

    var currentSeq = ++_bmStockState.fetchSeq;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/inventory', {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (currentSeq !== _bmStockState.fetchSeq) return;

      if (res.ok && data.success && Array.isArray(data.inventory)) {
        _bmStockState.inventory = data.inventory;
        updateBMStockStats(data.inventory);
        renderBMStockTable();
      } else {
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Gagal memuat inventaris: ' + esc(data.error || 'Terjadi kesalahan') + '</td></tr>';
        }
      }
    } catch (err) {
      if (currentSeq !== _bmStockState.fetchSeq) return;
      console.warn('[BM Stock Load Error]:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat inventaris.</td></tr>';
      }
    }
  }
  window.loadBMStock = loadBMStock;

  function updateBMStockStats(items) {
    var total = (items || []).length;
    var outOfStock = (items || []).filter(function (it) { return Number(it.stock) <= 0; }).length;
    var lowStock = (items || []).filter(function (it) {
      var s = Number(it.stock);
      var th = Number(it.low_stock_threshold || 5);
      return s > 0 && s <= th;
    }).length;
    var safeStock = total - outOfStock - lowStock;

    if ($('bm-stock-stat-total')) $('bm-stock-stat-total').textContent = total;
    if ($('bm-stock-stat-safe')) $('bm-stock-stat-safe').textContent = safeStock;
    if ($('bm-stock-stat-low')) $('bm-stock-stat-low').textContent = lowStock;
    if ($('bm-stock-stat-out')) $('bm-stock-stat-out').textContent = outOfStock;
  }

  function onBMStockFilterChange() {
    var searchEl = $('bm-stock-search');
    var filterEl = $('bm-stock-filter-status');
    if (searchEl) _bmStockState.searchQuery = searchEl.value.trim().toLowerCase();
    if (filterEl) _bmStockState.statusFilter = filterEl.value;
    renderBMStockTable();
  }
  window.onBMStockFilterChange = onBMStockFilterChange;

  function renderBMStockTable() {
    var tbody = $('bm-stock-tbody');
    if (!tbody) return;

    var filtered = (_bmStockState.inventory || []).filter(function (it) {
      var name = (it.product_name || '').toLowerCase();
      var matchesSearch = !_bmStockState.searchQuery || name.indexOf(_bmStockState.searchQuery) !== -1;
      if (!matchesSearch) return false;

      var s = Number(it.stock);
      var th = Number(it.low_stock_threshold || 5);
      if (_bmStockState.statusFilter === 'out') return s <= 0;
      if (_bmStockState.statusFilter === 'low') return s > 0 && s <= th;
      if (_bmStockState.statusFilter === 'safe') return s > th;
      return true;
    });

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Tidak ada item inventaris yang sesuai kriteria filter.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (it) {
      var s = Number(it.stock);
      var th = Number(it.low_stock_threshold || 5);

      var badge = '';
      if (s <= 0) {
        badge = '<span class="x-badge x-badge-danger" style="font-size:11px;">HABIS (0)</span>';
      } else if (s <= th) {
        badge = '<span class="x-badge x-badge-warning" style="font-size:11px;">MENIPIS (&le; ' + th + ')</span>';
      } else {
        badge = '<span class="x-badge x-badge-success" style="font-size:11px;">AMAN</span>';
      }

      return '<tr>' +
        '<td><strong>' + esc(it.product_name) + '</strong></td>' +
        '<td>' + formatMoney(it.price) + '</td>' +
        '<td><strong style="font-size:14px;">' + s + '</strong></td>' +
        '<td><span class="text-muted">' + th + '</span></td>' +
        '<td>' + badge + '</td>' +
        '<td style="text-align:right;">' +
          '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 10px;" onclick="openBMStockAdjustmentModal(\'' + esc(it.product_id) + '\')">Sesuaikan Stok</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  function openBMStockAdjustmentModal(productId) {
    var item = (_bmStockState.inventory || []).find(function (it) { return it.product_id === productId; });
    if (!item) return;

    var modal = $('modal-bm-stock-adjust');
    if (!modal) return;

    if ($('bm-adjust-product-id')) $('bm-adjust-product-id').value = item.product_id;
    if ($('bm-adjust-product-name')) $('bm-adjust-product-name').textContent = item.product_name;
    if ($('bm-adjust-current-stock')) $('bm-adjust-current-stock').textContent = item.stock;

    var selectType = $('bm-adjust-movement-type');
    if (selectType) selectType.value = 'audit_adjustment';

    var qtyInput = $('bm-adjust-quantity');
    if (qtyInput) qtyInput.value = '';

    var notesInput = $('bm-adjust-notes');
    if (notesInput) notesInput.value = '';

    onBMAdjustTypeChange();
    modal.style.display = 'flex';
  }
  window.openBMStockAdjustmentModal = openBMStockAdjustmentModal;

  function closeBMStockAdjustModal() {
    var modal = $('modal-bm-stock-adjust');
    if (modal) modal.style.display = 'none';
  }
  window.closeBMStockAdjustModal = closeBMStockAdjustModal;

  function onBMAdjustTypeChange() {
    var selectType = $('bm-adjust-movement-type');
    var hint = $('bm-adjust-qty-hint');
    var qtyInput = $('bm-adjust-quantity');
    if (!selectType || !hint) return;

    if (selectType.value === 'waste_spoilage') {
      hint.textContent = 'Barang rusak/basi harus bernilai pengurangan negatif (misal: -3).';
      hint.style.color = '#dc2626';
      if (qtyInput && Number(qtyInput.value) > 0) {
        qtyInput.value = '-' + qtyInput.value;
      }
    } else {
      hint.textContent = 'Gunakan angka positif untuk menambah, negatif untuk mengurangi.';
      hint.style.color = 'var(--text-muted)';
    }
  }
  window.onBMAdjustTypeChange = onBMAdjustTypeChange;

  async function submitBMStockAdjustment(e) {
    if (e) e.preventDefault();
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var productId = $('bm-adjust-product-id') ? $('bm-adjust-product-id').value : '';
    var movementType = $('bm-adjust-movement-type') ? $('bm-adjust-movement-type').value : '';
    var qty = $('bm-adjust-quantity') ? Number($('bm-adjust-quantity').value) : NaN;
    var notes = $('bm-adjust-notes') ? $('bm-adjust-notes').value.trim() : '';

    if (!productId || isNaN(qty) || qty === 0) {
      showToast('Masukkan jumlah penyesuaian yang valid (bukan 0).');
      return;
    }

    if (movementType === 'waste_spoilage' && qty > 0) {
      showToast('Barang rusak (waste_spoilage) hanya menerima pengurangan stok (angka negatif).');
      return;
    }

    var submitBtn = $('btn-bm-submit-adjust');
    if (submitBtn) submitBtn.disabled = true;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/inventory/' + encodeURIComponent(productId), {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          movement_type: movementType,
          quantity: qty,
          notes: notes
        })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Stok operasional berhasil diperbarui!');
        closeBMStockAdjustModal();
        loadBMStock();
      } else {
        showToast('Gagal menyesuaikan stok: ' + (data.message || data.error || 'Terjadi kesalahan'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }
  window.submitBMStockAdjustment = submitBMStockAdjustment;

})();
