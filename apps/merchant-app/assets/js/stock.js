/**
 * XENTRA CORE — MERCHANT APP STOCK & AVAILABILITY
 *
 * Fast Operational Availability & Daily Portion Counter for Branch Operations.
 * Simple 1-tap availability toggle & direct portion step adjustments (GoBiz / Moka style).
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
    fetchSeq: 0,
    activeAdjustItem: null
  };

  async function loadBMStock() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var container = $('bm-stock-quick-container');
    var tbody = $('bm-stock-tbody');
    if (container && (!_bmStockState.inventory || !_bmStockState.inventory.length)) {
      container.innerHTML = '<div class="text-center py-6 text-muted">Memuat ketersediaan stok cabang...</div>';
    }
    if (tbody && (!_bmStockState.inventory || !_bmStockState.inventory.length)) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-muted">Memuat inventaris cabang...</td></tr>';
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
        renderBMStockView();
      } else {
        var errText = esc(data.error || 'Terjadi kesalahan');
        if (container) {
          container.innerHTML = '<div class="text-center py-6 text-danger">Gagal memuat ketersediaan: ' + errText + '</div>';
        }
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-danger">Gagal memuat inventaris: ' + errText + '</td></tr>';
        }
      }
    } catch (err) {
      if (currentSeq !== _bmStockState.fetchSeq) return;
      console.warn('[BM Stock Load Error]:', err);
      if (container) {
        container.innerHTML = '<div class="text-center py-6 text-danger">Kesalahan jaringan saat memuat inventaris.</div>';
      }
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat inventaris.</td></tr>';
      }
    }
  }
  window.loadBMStock = loadBMStock;

  function getStockStatus(it) {
    if (it.is_available === 0 || it.is_available === false) return 'out';
    if (it.stock === null || it.stock === undefined || it.stock === '') return 'untracked';
    var s = Number(it.stock);
    var th = Number(it.low_stock_threshold || 5);
    if (s <= 0) return 'out';
    if (s <= th) return 'low';
    return 'safe';
  }

  function updateBMStockStats(items) {
    var total = (items || []).length;
    var untracked = (items || []).filter(function (it) { return getStockStatus(it) === 'untracked'; }).length;
    var outOfStock = (items || []).filter(function (it) { return getStockStatus(it) === 'out'; }).length;
    var lowStock = (items || []).filter(function (it) { return getStockStatus(it) === 'low'; }).length;
    var safeStock = (items || []).filter(function (it) { return getStockStatus(it) === 'safe'; }).length;

    var trackedAvailable = safeStock + lowStock;

    if ($('bm-stock-stat-total')) $('bm-stock-stat-total').textContent = total;
    if ($('bm-stock-stat-tracked')) $('bm-stock-stat-tracked').textContent = trackedAvailable;
    if ($('bm-stock-stat-safe')) $('bm-stock-stat-safe').textContent = safeStock;
    if ($('bm-stock-stat-low')) $('bm-stock-stat-low').textContent = lowStock;
    if ($('bm-stock-stat-out')) $('bm-stock-stat-out').textContent = outOfStock;
    if ($('bm-stock-stat-untracked')) $('bm-stock-stat-untracked').textContent = untracked;
  }

  function onBMStockFilterChange() {
    var searchEl = $('bm-stock-search');
    var filterEl = $('bm-stock-filter-status');
    if (searchEl) _bmStockState.searchQuery = searchEl.value.trim().toLowerCase();
    if (filterEl) _bmStockState.statusFilter = filterEl.value;
    renderBMStockView();
  }
  window.onBMStockFilterChange = onBMStockFilterChange;

  function renderBMStockView() {
    renderBMStockQuickCards();
    renderBMStockTable();
  }

  function getFilteredItems() {
    return (_bmStockState.inventory || []).filter(function (it) {
      var name = (it.product_name || '').toLowerCase();
      var matchesSearch = !_bmStockState.searchQuery || name.indexOf(_bmStockState.searchQuery) !== -1;
      if (!matchesSearch) return false;
      var status = getStockStatus(it);
      return _bmStockState.statusFilter === 'all' || _bmStockState.statusFilter === status;
    });
  }

  /* Render Modern Mobile & Desktop Quick Stock Cards */
  function renderBMStockQuickCards() {
    var container = $('bm-stock-quick-container');
    if (!container) return;

    var filtered = getFilteredItems();
    if (!filtered.length) {
      container.innerHTML = '<div class="text-center py-6 text-muted">Tidak ada item yang sesuai dengan filter pencarian.</div>';
      return;
    }

    container.innerHTML = filtered.map(function (it) {
      var status = getStockStatus(it);
      var isUntracked = status === 'untracked';
      var isOut = status === 'out';
      var isAvail = !isOut;
      var s = isUntracked ? null : Number(it.stock);
      var th = Number(it.low_stock_threshold || 5);

      var badgeClass = status === 'untracked' ? 'x-badge-muted'
        : status === 'out' ? 'x-badge-danger'
        : status === 'low' ? 'x-badge-warning'
        : 'x-badge-success';

      var statusText = status === 'untracked' ? 'Selalu Tersedia (Tanpa Batas)'
        : status === 'out' ? 'HABIS'
        : status === 'low' ? 'SISA ' + s + ' PORSI (MENIPIS)'
        : 'SISA ' + s + ' PORSI';

      var portionDisplayHtml = isUntracked
        ? '<span class="x-stock-portion-display" title="Klik untuk tetapkan porsi" onclick="openBMStockAdjustmentModal(\'' + esc(it.product_id) + '\')">∞</span' +
          '><span class="x-stock-portion-unit">Porsi</span>'
        : '<span class="x-stock-portion-display" title="Klik untuk edit porsi" onclick="openBMStockAdjustmentModal(\'' + esc(it.product_id) + '\')">' + s + '</span>' +
          '<span class="x-stock-portion-unit">Porsi</span>';

      return '<div class="x-stock-item-card" data-product-id="' + esc(it.product_id) + '">' +
        '<div class="x-stock-item-main">' +
          '<div class="x-stock-item-title-row">' +
            '<span class="x-stock-item-name">' + esc(it.product_name) + '</span>' +
            '<span class="x-badge ' + badgeClass + '" style="font-size:11px;">' + statusText + '</span>' +
          '</div>' +
          '<div class="x-stock-item-meta">' +
            (it.sku ? '<span>SKU: ' + esc(it.sku) + '</span> • ' : '') +
            '<span>Batas Minimum: ' + (isUntracked ? '—' : th) + ' porsi</span>' +
          '</div>' +
        '</div>' +
        '<div class="x-stock-item-controls">' +
          '<div class="x-stock-portion-counter" title="Atur sisa porsi harian">' +
            '<button type="button" class="x-stock-step-btn" ' + (isUntracked || s <= 0 ? 'disabled' : '') + ' onclick="quickAdjustBMStockStep(\'' + esc(it.product_id) + '\', -1)" aria-label="Kurang 1 porsi">-</button>' +
            '<div style="text-align:center;">' + portionDisplayHtml + '</div>' +
            '<button type="button" class="x-stock-step-btn" onclick="quickAdjustBMStockStep(\'' + esc(it.product_id) + '\', 1)" aria-label="Tambah 1 porsi">+</button>' +
          '</div>' +
          '<button type="button" class="x-btn-secondary" style="font-size:12px; padding:6px 12px; white-space:nowrap;" onclick="openBMStockAdjustmentModal(\'' + esc(it.product_id) + '\')">' +
            'Atur' +
          '</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* Keep table markup coherent for screen readers or desktop fallback */
  function renderBMStockTable() {
    var tbody = $('bm-stock-tbody');
    if (!tbody) return;

    var filtered = getFilteredItems();
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-muted">Tidak ada item yang sesuai.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (it) {
      var status = getStockStatus(it);
      var isUntracked = status === 'untracked';
      var s = isUntracked ? null : Number(it.stock);
      var th = Number(it.low_stock_threshold || 5);
      var statusLabel = status === 'untracked' ? 'BELUM DILACAK'
        : status === 'out' ? 'HABIS'
        : status === 'low' ? 'MENIPIS'
        : 'AMAN';
      var badgeClass = status === 'untracked' ? 'x-badge-muted'
        : status === 'out' ? 'x-badge-danger'
        : status === 'low' ? 'x-badge-warning'
        : 'x-badge-success';
      var stockLabel = isUntracked ? '—' : String(s);
      var thresholdLabel = isUntracked ? 'Belum dilacak' : String(th);
      var actionLabel = isUntracked ? 'Catat Stok' : 'Sesuaikan';
      return '<tr class="x-merchant-data-row x-stock-row">' +
        '<td data-label="Produk"><strong>' + esc(it.product_name) + '</strong></td>' +
        '<td data-label="Stok"><strong style="font-size:16px;">' + stockLabel + '</strong></td>' +
        '<td data-label="Batas Minimum"><span class="text-muted">' + esc(thresholdLabel) + '</span></td>' +
        '<td data-label="Status"><span class="x-badge ' + badgeClass + '">' + statusLabel + '</span></td>' +
        '<td data-label="Aksi" style="text-align:right;"><button type="button" class="x-btn-secondary x-stock-adjust-btn" onclick="openBMStockAdjustmentModal(\'' + esc(it.product_id) + '\')">' + actionLabel + '</button></td>' +
      '</tr>';
    }).join('');
  }

  /* Quick Step Button (+1 / -1) with Optimistic UI & Idempotency */
  async function quickAdjustBMStockStep(productId, delta) {
    var item = (_bmStockState.inventory || []).find(function (it) { return it.product_id === productId; });
    if (!item) return;

    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var cur = (item.stock == null || item.stock === '') ? 0 : Number(item.stock);
    if (delta < 0 && cur <= 0) return; // Prevent negative stock

    var nextVal = Math.max(0, cur + delta);
    var actDelta = nextVal - cur;
    if (actDelta === 0) return;

    // Optimistic local update
    item.stock = nextVal;
    renderBMStockView();

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/inventory/' + encodeURIComponent(productId), {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          movement_type: 'audit_adjustment',
          quantity: actDelta,
          notes: 'Penyesuaian cepat tombol porsi (' + (actDelta > 0 ? '+' : '') + actDelta + ')'
        })
      });
      var data = await res.json();
      if (!res.ok || !data.success) {
        showToast('Gagal update porsi: ' + (data.message || data.error || 'Terjadi kesalahan'));
        loadBMStock();
      }
    } catch (err) {
      showToast('Gagal terhubung ke server.');
      loadBMStock();
    }
  }
  window.quickAdjustBMStockStep = quickAdjustBMStockStep;

  function openBMStockAdjustmentModal(productId) {
    var item = (_bmStockState.inventory || []).find(function (it) { return it.product_id === productId; });
    if (!item) return;

    _bmStockState.activeAdjustItem = item;
    var modal = $('modal-bm-stock-adjust');
    if (!modal) return;

    var curStock = (item.stock == null || item.stock === '') ? 0 : Number(item.stock);

    if ($('bm-adjust-product-id')) $('bm-adjust-product-id').value = item.product_id;
    if ($('bm-adjust-product-name')) $('bm-adjust-product-name').textContent = item.product_name;
    if ($('bm-adjust-current-stock')) $('bm-adjust-current-stock').textContent = (item.stock == null ? 'Belum dilacak (0)' : item.stock + ' porsi');
    if ($('bm-adjust-target-qty')) $('bm-adjust-target-qty').value = curStock;

    var selectType = $('bm-adjust-movement-type');
    if (selectType) selectType.value = 'audit_adjustment';

    var notesInput = $('bm-adjust-notes');
    if (notesInput) notesInput.value = '';

    modal.style.display = 'flex';
  }
  window.openBMStockAdjustmentModal = openBMStockAdjustmentModal;

  function closeBMStockAdjustModal() {
    var modal = $('modal-bm-stock-adjust');
    if (modal) modal.style.display = 'none';
    _bmStockState.activeAdjustItem = null;
  }
  window.closeBMStockAdjustModal = closeBMStockAdjustModal;

  function setBMAdjustTargetQuick(val) {
    var targetInput = $('bm-adjust-target-qty');
    if (targetInput) targetInput.value = val;
  }
  window.setBMAdjustTargetQuick = setBMAdjustTargetQuick;

  function addBMAdjustDelta(delta) {
    var targetInput = $('bm-adjust-target-qty');
    if (!targetInput) return;
    var cur = Number(targetInput.value) || 0;
    targetInput.value = Math.max(0, cur + delta);
  }
  window.addBMAdjustDelta = addBMAdjustDelta;

  function onBMAdjustTypeChange() {
    // Keep compatible for callers
  }
  window.onBMAdjustTypeChange = onBMAdjustTypeChange;

  async function submitBMStockAdjustment(e) {
    if (e) e.preventDefault();
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var item = _bmStockState.activeAdjustItem;
    var productId = $('bm-adjust-product-id') ? $('bm-adjust-product-id').value : '';
    if (!productId && item) productId = item.product_id;

    var targetInput = $('bm-adjust-target-qty');
    var targetQty = targetInput ? Number(targetInput.value) : NaN;

    if (!productId || isNaN(targetQty) || targetQty < 0) {
      showToast('Masukkan target jumlah porsi yang valid (≥ 0).');
      return;
    }

    var curStock = (item && item.stock != null) ? Number(item.stock) : 0;
    var deltaQty = targetQty - curStock;

    var movementType = $('bm-adjust-movement-type') ? $('bm-adjust-movement-type').value : 'audit_adjustment';
    var notes = $('bm-adjust-notes') ? $('bm-adjust-notes').value.trim() : '';

    if (deltaQty === 0) {
      showToast('Jumlah porsi tidak berubah.');
      closeBMStockAdjustModal();
      return;
    }

    if (movementType === 'waste_spoilage' && deltaQty > 0) {
      showToast('Tipe barang rusak/basi (waste) hanya menerima pengurangan stok.');
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
          quantity: deltaQty,
          notes: notes || ('Set sisa porsi menjadi ' + targetQty + ' (delta: ' + (deltaQty > 0 ? '+' : '') + deltaQty + ')')
        })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Sisa porsi berhasil diperbarui menjadi ' + targetQty + '!');
        closeBMStockAdjustModal();
        loadBMStock();
      } else {
        showToast('Gagal memperbarui porsi: ' + (data.message || data.error || 'Terjadi kesalahan'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }
  window.submitBMStockAdjustment = submitBMStockAdjustment;

})();
