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
    recipes: [],
    searchQuery: '',
    statusFilter: 'all',
    fetchSeq: 0,
    activeAdjustItem: null,
    activePrepareItem: null
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
      var [invRes, recRes] = await Promise.all([
        adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/inventory', {
          headers: getAuthHeaders()
        }),
        adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/inventory/recipes', {
          headers: getAuthHeaders()
        }).catch(function () { return { ok: false }; })
      ]);
      var data = await invRes.json();
      var recData = recRes.ok ? await recRes.json() : null;

      if (currentSeq !== _bmStockState.fetchSeq) return;

      if (recData && recData.success && Array.isArray(recData.recipes)) {
        _bmStockState.recipes = recData.recipes;
      } else {
        _bmStockState.recipes = [];
      }

      if (invRes.ok && data.success && Array.isArray(data.inventory)) {
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
    if (it.fulfillment_type === 'BY_ORDER' || it.stock === null || it.stock === undefined || it.stock === '') return 'untracked';
    var s = Number(it.stock);
    var th = Number(it.low_stock_threshold || 5);
    if (s <= 0) return 'out';
    if (s <= th) return 'low';
    return 'safe';
  }

  function updateBMStockStats(items) {
    var total = (items || []).length;
    var byOrder = (items || []).filter(function (it) { return it.fulfillment_type === 'BY_ORDER'; }).length;
    var untracked = (items || []).filter(function (it) { return getStockStatus(it) === 'untracked' && it.fulfillment_type !== 'BY_ORDER'; }).length;
    var outOfStock = (items || []).filter(function (it) { return getStockStatus(it) === 'out'; }).length;
    var lowStock = (items || []).filter(function (it) { return getStockStatus(it) === 'low'; }).length;
    var safeStock = (items || []).filter(function (it) { return getStockStatus(it) === 'safe'; }).length;

    var trackedAvailable = safeStock + lowStock;

    if ($('bm-stock-stat-total')) $('bm-stock-stat-total').textContent = total;
    if ($('bm-stock-stat-tracked')) $('bm-stock-stat-tracked').textContent = trackedAvailable;
    if ($('bm-stock-stat-safe')) $('bm-stock-stat-safe').textContent = safeStock;
    if ($('bm-stock-stat-low')) $('bm-stock-stat-low').textContent = lowStock;
    if ($('bm-stock-stat-out')) $('bm-stock-stat-out').textContent = outOfStock;
    if ($('bm-stock-stat-untracked')) $('bm-stock-stat-untracked').textContent = byOrder > 0 ? (byOrder + ' By Order') : untracked;
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
      var isByOrder = it.fulfillment_type === 'BY_ORDER';
      var status = getStockStatus(it);
      var isUntracked = status === 'untracked';
      var isOut = status === 'out';
      var isAvail = !isOut;
      var s = isUntracked ? null : Number(it.stock);
      var th = Number(it.low_stock_threshold || 5);

      var badgeClass = isOut ? 'x-badge-danger'
        : isByOrder ? 'x-badge-info'
        : status === 'untracked' ? 'x-badge-muted'
        : status === 'low' ? 'x-badge-warning'
        : 'x-badge-success';

      var statusText = isOut ? 'HABIS'
        : isByOrder ? 'BY ORDER'
        : status === 'untracked' ? 'TIDAK DIBATASI'
        : status === 'low' ? 'SISA ' + s + ' PORSI (MENIPIS)'
        : 'SISA ' + s + ' PORSI';

      var portionDisplayHtml = isByOrder
        ? '<span class="x-stock-portion-display" style="font-size:16px; color:#0284c7;">∞</span>' +
          '<span class="x-stock-portion-unit" style="font-size:10px; color:#0284c7;">By Order</span>'
        : isUntracked
        ? '<span class="x-stock-portion-display">∞</span>' +
          '<span class="x-stock-portion-unit">Porsi</span>'
        : '<span class="x-stock-portion-display">' + s + '</span>' +
          '<span class="x-stock-portion-unit">Porsi</span>';

      var recipe = (_bmStockState.recipes || []).find(function (r) { return r.output_product_id === it.product_id; });
      var prepareBtnHtml = (recipe && !isByOrder)
        ? '<button type="button" class="x-btn-secondary" style="font-size:12px; padding:6px 10px; white-space:nowrap; background:#f0fdf4; border-color:#86efac; color:#15803d; font-weight:700;" onclick="event.stopPropagation(); openBMStockPrepareModal(\'' + esc(it.product_id) + '\')">🍳 Masak</button>'
        : '';

      var metaRow1Items = [];
      if (it.sku) {
        metaRow1Items.push('<span>SKU: ' + esc(it.sku) + '</span>');
      }
      if (isByOrder) {
        metaRow1Items.push('<span style="color:#0284c7; font-weight:600;">Dibuat saat dipesan</span>');
      } else {
        metaRow1Items.push('<span>Batas Menipis: ' + (isUntracked ? '—' : (th + ' porsi')) + '</span>');
      }

      var metaRow2 = recipe
        ? '<div class="x-stock-item-meta-recipe"><span>📋</span><span>Resep: ' + esc(recipe.recipe_name) + '</span></div>'
        : '';

      return '<div class="x-stock-item-card" data-product-id="' + esc(it.product_id) + '" style="cursor:pointer;" onclick="openBMStockDetailModal(\'' + esc(it.product_id) + '\')">' +
        '<div class="x-stock-item-main">' +
          '<div class="x-stock-item-title-row">' +
            '<span class="x-stock-item-name">' + esc(it.product_name) + '</span>' +
            '<span class="x-badge ' + badgeClass + '" style="font-size:11px;">' + statusText + '</span>' +
          '</div>' +
          '<div class="x-stock-item-meta">' +
            '<div class="x-stock-item-meta-row">' + metaRow1Items.join(' <span style="color:#cbd5e1;">•</span> ') + '</div>' +
            metaRow2 +
          '</div>' +
        '</div>' +
        '<div class="x-stock-item-controls">' +
          (isByOrder
            ? '<span style="font-size:12px; font-weight:600; color:var(--text-muted); padding:6px 10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px;">Dibuat saat dipesan</span>'
            : (prepareBtnHtml +
               '<div style="text-align:center; padding:4px 8px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; min-width:60px;">' +
                 portionDisplayHtml +
               '</div>')) +
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
      var isByOrder = it.fulfillment_type === 'BY_ORDER';
      var status = getStockStatus(it);
      var isUntracked = status === 'untracked';
      var isOut = status === 'out';
      var isAvail = !isOut;
      var s = isUntracked ? null : Number(it.stock);
      var th = Number(it.low_stock_threshold || 5);
      var statusLabel = isOut ? 'HABIS'
        : isByOrder ? 'BY ORDER'
        : status === 'untracked' ? 'BELUM DILACAK'
        : status === 'low' ? 'MENIPIS'
        : 'AMAN';
      var badgeClass = isOut ? 'x-badge-danger'
        : isByOrder ? 'x-badge-info'
        : status === 'untracked' ? 'x-badge-muted'
        : status === 'low' ? 'x-badge-warning'
        : 'x-badge-success';
      var stockLabel = isByOrder ? '∞' : (isUntracked ? '—' : String(s));
      var thresholdLabel = isByOrder ? 'By Order' : (isUntracked ? 'Belum dilacak' : String(th));
      var actionLabel = isUntracked ? 'Mulai Lacak' : 'Sesuaikan';
      var actionBtn = isByOrder
        ? '<span class="text-muted" style="font-size:12px;">By Order</span>'
        : '<button type="button" class="x-btn-secondary x-stock-adjust-btn" onclick="openBMStockAdjustmentModal(\'' + esc(it.product_id) + '\')">' + actionLabel + '</button>';
      return '<tr class="x-merchant-data-row x-stock-row">' +
        '<td data-label="Produk"><strong>' + esc(it.product_name) + '</strong></td>' +
        '<td data-label="Stok"><strong style="font-size:16px;">' + stockLabel + '</strong></td>' +
        '<td data-label="Batas Minimum"><span class="text-muted">' + esc(thresholdLabel) + '</span></td>' +
        '<td data-label="Status"><span class="x-badge ' + badgeClass + '">' + statusLabel + '</span></td>' +
        '<td data-label="Aksi" style="text-align:right;">' + actionBtn + '</td>' +
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

  async function toggleBMStockItemAvailability(productId, nextVal) {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    // Optimistic UI update
    var item = (_bmStockState.inventory || []).find(function (it) { return it.product_id === productId; });
    if (item) {
      item.is_available = nextVal;
      renderBMStockView();
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/products/' + encodeURIComponent(productId), {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_available: nextVal })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast(nextVal === 1 ? 'Menu berhasil diaktifkan (Tersedia).' : 'Menu berhasil dinonaktifkan.');
      } else {
        showToast('Gagal mengubah status: ' + (data.error || 'Terjadi kesalahan'));
        loadBMStock();
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
      loadBMStock();
    }
  }
  window.toggleBMStockItemAvailability = toggleBMStockItemAvailability;

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
    if ($('bm-adjust-low-threshold')) $('bm-adjust-low-threshold').value = (item.low_stock_threshold != null ? item.low_stock_threshold : 5);

    var selectType = $('bm-adjust-movement-type');
    if (selectType) selectType.value = 'audit_adjustment';

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
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
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

    var thresholdInput = $('bm-adjust-low-threshold');
    var lowStockThreshold = thresholdInput ? Number(thresholdInput.value) : NaN;
    var prevThreshold = (item && item.low_stock_threshold != null) ? Number(item.low_stock_threshold) : 5;
    var thresholdChanged = !isNaN(lowStockThreshold) && lowStockThreshold >= 0 && lowStockThreshold !== prevThreshold;

    if (deltaQty === 0 && !thresholdChanged) {
      showToast('Jumlah porsi dan batas warning tidak berubah.');
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
      var payload = {
        movement_type: movementType,
        quantity: deltaQty,
        notes: notes || ('Set sisa porsi menjadi ' + targetQty + (deltaQty !== 0 ? ' (delta: ' + (deltaQty > 0 ? '+' : '') + deltaQty + ')' : ''))
      };
      if (!isNaN(lowStockThreshold) && lowStockThreshold >= 0) {
        payload.low_stock_threshold = lowStockThreshold;
      }

      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/inventory/' + encodeURIComponent(productId), {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Sisa porsi dan batas warning berhasil diperbarui!');
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

  /* Cooking / Preparation Batch Modal Handlers */
  function openBMStockPrepareModal(productId) {
    var item = (_bmStockState.inventory || []).find(function (it) { return it.product_id === productId; });
    var recipe = (_bmStockState.recipes || []).find(function (r) { return r.output_product_id === productId; });
    if (!item || !recipe) {
      showToast('Resep masakan untuk menu ini belum terdaftar.');
      return;
    }

    _bmStockState.activePrepareItem = item;
    var modal = $('modal-bm-stock-prepare');
    if (!modal) return;

    var yieldQty = Math.max(1, Number(recipe.planned_yield_quantity) || 10);

    if ($('bm-prepare-product-id')) $('bm-prepare-product-id').value = item.product_id;
    if ($('bm-prepare-product-name')) $('bm-prepare-product-name').textContent = item.product_name;
    if ($('bm-prepare-recipe-name')) $('bm-prepare-recipe-name').textContent = recipe.recipe_name + ' (Yield: ' + yieldQty + ' ' + (recipe.yield_uom_name || 'porsi') + ')';
    if ($('bm-prepare-portions')) {
      $('bm-prepare-portions').value = yieldQty;
      $('bm-prepare-portions').min = 1;
    }
    if ($('bm-prepare-notes')) $('bm-prepare-notes').value = '';

    renderBMPrepareBatchButtons(yieldQty);
    updateBMPrepareMaterialsPreview();
    modal.style.display = 'flex';
  }
  window.openBMStockPrepareModal = openBMStockPrepareModal;

  function renderBMPrepareBatchButtons(yieldQty) {
    var container = $('bm-prepare-batch-buttons');
    if (!container) return;

    var multipliers = [1, 2, 3, 5];
    var html = multipliers.map(function (m) {
      var qty = yieldQty * m;
      return '<button type="button" class="x-btn-secondary btn-batch-quick" data-qty="' + qty + '" style="font-size:11px; font-weight:700; padding:6px 12px; border-radius:8px; border:1px solid #cbd5e1; background:#fff; cursor:pointer;" onclick="setBMPreparePortions(' + qty + ')">' +
        qty + ' Porsi <span style="font-size:10px; font-weight:500; color:#64748b;">(' + m + ' Batch)</span>' +
      '</button>';
    }).join('');

    container.innerHTML = html;
  }
  window.renderBMPrepareBatchButtons = renderBMPrepareBatchButtons;

  function closeBMStockPrepareModal() {
    var modal = $('modal-bm-stock-prepare');
    if (modal) modal.style.display = 'none';
    _bmStockState.activePrepareItem = null;
  }
  window.closeBMStockPrepareModal = closeBMStockPrepareModal;

  function setBMPreparePortions(val) {
    var input = $('bm-prepare-portions');
    if (input) {
      input.value = val;
      updateBMPrepareMaterialsPreview();
    }
  }
  window.setBMPreparePortions = setBMPreparePortions;

  function updateBMPrepareMaterialsPreview() {
    var item = _bmStockState.activePrepareItem;
    if (!item) return;
    var recipe = (_bmStockState.recipes || []).find(function (r) { return r.output_product_id === item.product_id; });
    if (!recipe || !Array.isArray(recipe.components)) return;

    var portionsInput = $('bm-prepare-portions');
    var portions = portionsInput ? Math.max(1, Number(portionsInput.value) || 1) : 1;
    var yieldQty = Number(recipe.planned_yield_quantity) || 1;
    var factor = portions / yieldQty;

    // Highlight active batch button if current input matches a batch multiplier
    var batchBtns = document.querySelectorAll('.btn-batch-quick');
    batchBtns.forEach(function (btn) {
      var btnQty = Number(btn.getAttribute('data-qty'));
      if (btnQty === portions) {
        btn.style.background = '#16a34a';
        btn.style.color = '#ffffff';
        btn.style.borderColor = '#16a34a';
        var subSpan = btn.querySelector('span');
        if (subSpan) subSpan.style.color = '#dcfce7';
      } else {
        btn.style.background = '#ffffff';
        btn.style.color = 'var(--text-main, #0f172a)';
        btn.style.borderColor = '#cbd5e1';
        var subSpan = btn.querySelector('span');
        if (subSpan) subSpan.style.color = '#64748b';
      }
    });

    var container = $('bm-prepare-components-list');
    var warningEl = $('bm-prepare-warning');
    var submitBtn = $('btn-bm-submit-prepare');
    var hasShortage = false;

    if (!container) return;

    container.innerHTML = recipe.components.map(function (comp) {
      var needed = Number(comp.planned_quantity) * factor;
      var avail = Number(comp.branch_material_stock || 0);
      var isShort = avail < needed;
      if (isShort) hasShortage = true;

      var neededFormatted = needed % 1 === 0 ? needed : needed.toFixed(2);
      var availFormatted = avail % 1 === 0 ? avail : avail.toFixed(2);

      return '<div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; border-bottom:1px dashed #e2e8f0;">' +
        '<div>' +
          '<strong>' + esc(comp.material_name) + '</strong>' +
          '<div style="font-size:11px; color:' + (isShort ? '#b91c1c' : 'var(--text-muted)') + ';">' +
            'Dibutuhkan: ' + neededFormatted + ' ' + esc(comp.planned_uom_name || '') +
            ' • Ada: ' + availFormatted + ' ' + esc(comp.planned_uom_name || '') +
          '</div>' +
        '</div>' +
        '<div>' +
          (isShort
            ? '<span class="x-badge x-badge-danger" style="font-size:10px;">KURANG</span>'
            : '<span class="x-badge x-badge-success" style="font-size:10px;">CUKUP</span>') +
        '</div>' +
      '</div>';
    }).join('');

    if (warningEl) warningEl.style.display = hasShortage ? 'block' : 'none';
    if (submitBtn) {
      submitBtn.disabled = hasShortage;
      submitBtn.style.opacity = hasShortage ? '0.5' : '1';
      submitBtn.style.cursor = hasShortage ? 'not-allowed' : 'pointer';
    }
  }
  window.updateBMPrepareMaterialsPreview = updateBMPrepareMaterialsPreview;

  async function submitBMStockPrepare(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var item = _bmStockState.activePrepareItem;
    var productId = $('bm-prepare-product-id') ? $('bm-prepare-product-id').value : '';
    if (!productId && item) productId = item.product_id;

    var portionsInput = $('bm-prepare-portions');
    var portions = portionsInput ? Number(portionsInput.value) : NaN;
    var notes = $('bm-prepare-notes') ? $('bm-prepare-notes').value.trim() : '';

    if (!productId || isNaN(portions) || portions <= 0) {
      showToast('Masukkan jumlah porsi masak yang valid (> 0).');
      return;
    }

    var submitBtn = $('btn-bm-submit-prepare');
    if (submitBtn) submitBtn.disabled = true;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/inventory/prepare', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          product_id: productId,
          portions: portions,
          notes: notes
        })
      });
      var data = await res.json();

      if (res.ok && data.success) {
        showToast('🍳 Berhasil! ' + portions + ' porsi siap jual ditambahkan dan bahan baku telah dipotong.');
        closeBMStockPrepareModal();
        loadBMStock();
      } else {
        showToast('Gagal mencatat masak: ' + (data.message || data.error || 'Terjadi kesalahan'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }
  async function notifyOwnerMaterialShortage() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var item = _bmStockState.activePrepareItem;
    var recipe = item ? (_bmStockState.recipes || []).find(function (r) { return r.output_product_id === item.product_id; }) : null;
    if (!item || !recipe || !Array.isArray(recipe.components)) {
      showToast('Data resep tidak ditemukan.');
      return;
    }

    var portionsInput = $('bm-prepare-portions');
    var portions = portionsInput ? Math.max(1, Number(portionsInput.value) || 1) : 1;
    var yieldQty = Number(recipe.planned_yield_quantity) || 1;
    var factor = portions / yieldQty;

    var shortMaterials = [];
    recipe.components.forEach(function (comp) {
      var needed = Number(comp.planned_quantity) * factor;
      var avail = Number(comp.branch_material_stock || 0);
      if (avail < needed) {
        shortMaterials.push({
          material_id: comp.material_id,
          material_name: comp.material_name,
          needed_quantity: Math.round(needed * 100) / 100,
          available_quantity: Math.round(avail * 100) / 100,
          uom_name: comp.planned_uom_name || comp.planned_uom_code || ''
        });
      }
    });

    if (shortMaterials.length === 0) {
      showToast('Semua bahan cukup, tidak ada kekurangan bahan.');
      return;
    }

    var btn = $('btn-notify-owner-shortage');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Mengirim peringatan...';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/inventory/notify-shortage', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          product_id: item.product_id,
          product_name: item.product_name,
          portions: portions,
          short_materials: shortMaterials
        })
      });
      var data = await res.json();

      if (res.ok && data.success) {
        showToast('✅ Berhasil mengirim peringatan ke Owner! Bahan telah dicatat ke rekomendasi belanja.');
        if (btn) {
          btn.textContent = '✅ Peringatan Terkirim ke Owner';
          btn.style.background = '#f0fdf4';
          btn.style.color = '#166534';
          btn.style.borderColor = '#bbf7d0';
        }
      } else {
        showToast('Gagal mengirim peringatan: ' + (data.message || data.error || 'Server error'));
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🔔 Kirim Peringatan ke Owner & Masukkan ke Rekomendasi Belanja';
        }
      }
    } catch (err) {
      showToast('Kesalahan jaringan saat mengirim peringatan.');
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🔔 Kirim Peringatan ke Owner & Masukkan ke Rekomendasi Belanja';
      }
    }
  }
  /* =========================================================================
     BOTTOM SHEET: DETAIL KOMPOSISI BAHAN DAPUR & STOK FISIK
     ========================================================================= */
  function openBMStockDetailModal(productId) {
    var item = (_bmStockState.inventory || []).find(function (it) { return it.product_id === productId; });
    if (!item) return;

    var recipe = (_bmStockState.recipes || []).find(function (r) { return r.output_product_id === productId; });
    var modal = $('modal-bm-stock-detail');
    var contentEl = $('bm-stock-detail-content');
    var titleEl = $('bm-stock-detail-title');
    var subtitleEl = $('bm-stock-detail-subtitle');
    var footerEl = $('bm-stock-detail-footer');

    if (!modal || !contentEl) return;

    if (titleEl) titleEl.textContent = item.product_name || 'Detail Stok Menu';
    var isByOrder = item.fulfillment_type === 'BY_ORDER';
    var isUntracked = !isByOrder && (item.stock === null || item.stock === undefined || item.stock === '');
    var currentPortions = isByOrder ? 'By Order' : (isUntracked ? 'Tanpa Batas Porsi' : (Number(item.stock) + ' Porsi'));

    if (subtitleEl) {
      subtitleEl.textContent = isByOrder
        ? 'Dibuat saat dipesan'
        : ('Sisa: ' + currentPortions);
    }

    // Build Overview Banner
    var overviewHtml = '<div style="margin-bottom:14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px; display:flex; justify-content:space-between; align-items:center;">' +
      '<div>' +
        '<div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Sisa Porsi</div>' +
        '<div style="font-size:16px; font-weight:800; color:var(--text-main); margin-top:2px;">' + esc(currentPortions) + '</div>' +
      '</div>' +
      '<div style="text-align:right;">' +
        '<div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Tipe Menu</div>' +
        '<div style="font-size:13px; font-weight:700; color:#0284c7; margin-top:2px;">' + (isByOrder ? 'Dibuat Saat Dipesan' : 'Dimasak Porsi') + '</div>' +
      '</div>' +
    '</div>';

    // Build Recipe Components List
    var recipeHtml = '';
    if (recipe && Array.isArray(recipe.components) && recipe.components.length > 0) {
      var yieldQty = Number(recipe.planned_yield_quantity || 1);
      recipeHtml += '<div style="margin-bottom:12px;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">' +
          '<span style="font-size:12.5px; font-weight:800; color:var(--text-main);">Komposisi Bahan</span>' +
          '<span style="font-size:11px; color:#15803d; font-weight:700; background:#f0fdf4; padding:2px 8px; border-radius:6px; border:1px solid #bbf7d0;">' + esc(recipe.recipe_name || 'Resep') + '</span>' +
        '</div>' +
        '<div style="display:flex; flex-direction:column; gap:8px;">';

      var anyShort = false;
      recipe.components.forEach(function (c) {
        var stock = Number(c.branch_material_stock_base != null ? c.branch_material_stock_base : (c.branch_material_stock || 0));
        var plannedPerPortion = Number(c.planned_quantity || 0) / yieldQty;
        var uomName = c.planned_uom_name || c.planned_uom_code || c.base_uom_code || '';
        var isLow = stock <= 0;
        if (isLow) anyShort = true;

        var stockColor = isLow ? '#dc2626' : (stock <= (plannedPerPortion * 3) ? '#d97706' : '#15803d');
        var stockBg = isLow ? '#fef2f2' : (stock <= (plannedPerPortion * 3) ? '#fffbeb' : '#f0fdf4');
        var stockBorder = isLow ? '#fecaca' : (stock <= (plannedPerPortion * 3) ? '#fde68a' : '#bbf7d0');

        recipeHtml += '<div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:#ffffff; border:1px solid #e2e8f0; border-radius:10px;">' +
          '<div style="min-width:0; flex:1;">' +
            '<div style="font-size:13.5px; font-weight:700; color:#0f172a;">' + esc(c.material_name) + '</div>' +
            '<div style="font-size:11.5px; color:#64748b; margin-top:2px;">Takaran: ' + Number(plannedPerPortion.toFixed(2)) + ' ' + esc(uomName) + ' / porsi</div>' +
          '</div>' +
          '<div style="text-align:right; flex-shrink:0; margin-left:12px;">' +
            '<div style="display:inline-block; padding:4px 8px; border-radius:6px; font-size:12px; font-weight:800; background:' + stockBg + '; color:' + stockColor + '; border:1px solid ' + stockBorder + ';">' +
              'Sisa ' + Number(stock.toFixed(2)) + ' ' + esc(uomName) +
            '</div>' +
          '</div>' +
        '</div>';
      });

      recipeHtml += '</div></div>';

      if (anyShort) {
        recipeHtml += '<div style="margin-top:8px; padding:8px 12px; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; font-size:12px; color:#991b1b; font-weight:600;">' +
          '⚠️ Sebagian bahan baku habis atau menipis' +
        '</div>';
      }
    } else {
      recipeHtml += '<div style="background:#f8fafc; border:1px dashed #cbd5e1; border-radius:10px; padding:20px 16px; text-align:center; color:#64748b; font-size:12.5px;">' +
        'Belum ada data resep bahan baku' +
      '</div>';
    }

    contentEl.innerHTML = overviewHtml + recipeHtml;

    // Render footer buttons
    var cookBtn = (recipe && !isByOrder)
      ? '<button type="button" class="x-btn-primary" style="font-size:13px; padding:9px 18px; font-weight:700; background:#16a34a; border-color:#16a34a;" onclick="closeBMStockDetailModal(); openBMStockPrepareModal(\'' + esc(productId) + '\');">🍳 Masak Porsi Baru</button>'
      : '';
    var adjustBtn = (!isByOrder)
      ? '<button type="button" class="x-btn-secondary" style="font-size:13px; padding:9px 15px; font-weight:600;" onclick="closeBMStockDetailModal(); openBMStockAdjustmentModal(\'' + esc(productId) + '\');">Koreksi Stok</button>'
      : '';

    if (footerEl) {
      footerEl.innerHTML = adjustBtn + cookBtn + '<button type="button" class="x-btn-secondary" onclick="closeBMStockDetailModal()" style="font-size:13px; padding:9px 18px; font-weight:600;">Tutup</button>';
    }

    modal.style.display = 'flex';
  }

  function closeBMStockDetailModal() {
    var modal = $('modal-bm-stock-detail');
    if (modal) modal.style.display = 'none';
  }
  window.openBMStockDetailModal = openBMStockDetailModal;
  window.closeBMStockDetailModal = closeBMStockDetailModal;

  window.submitBMStockPrepare = submitBMStockPrepare;
  window.notifyOwnerMaterialShortage = notifyOwnerMaterialShortage;

})();


