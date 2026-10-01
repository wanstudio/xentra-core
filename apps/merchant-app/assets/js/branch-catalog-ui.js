/**
 * XENTRA CORE — MERCHANT APP BRANCH CATALOG UI
 *
 * Branch Manager UI only. API/data transport is provided by
 * merchant-shared/js/catalog-client.js.

 * Branch content override compatibility remains for legacy fields. The narrow
 * Customer display-name override is now canonical and is edited from the Merchant
 * Menu action surface via the dedicated display-name endpoint. Description/image
 * override behavior remains legacy compatibility only.
 */
(function () {
  'use strict';

  var S = window.XentraShared;
  var CatalogClient = window.XentraCatalogClient;
  var $ = S.$;
  var esc = S.esc;
  var formatMoney = S.formatMoney;
  var showToast = S.showToast;
  var getStoredUser = S.getStoredUser;

  var hooks = { refreshBMMenu: null };
  var currentManagingBranchId = null;
  var currentBranchCatalogData = null;
  var bmMenuState = null;
  var branchCatalogFilter = 'all';

  function isBranchManager() {
    var user = getStoredUser();
    return !!(user && user.role === 'branch_manager');
  }





  /* =========================================================================
     MODUL 3.2: BRANCH PRODUCT OVERRIDE — text / price / category only
     PHOTO OVERRIDE IS LOCKED: Master Product Owner controls the image.
     ========================================================================= */
  var _overrideProductId = null;

  window.openBranchOverrideModal = function (productDataRaw) {
    var p;
    try { p = JSON.parse(productDataRaw.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")); } catch (e) { showToast('❌ Gagal membuka override.'); return; }
    _overrideProductId = p.product_id;

    var modal = $('modal-branch-override');
    if (!modal) { showToast('❌ Modal override tidak ditemukan di HTML.'); return; }

    // Product heading
    $('override-product-heading').textContent = 'Edit Menu: ' + (p.master_name || p.name || p.product_id);

    // Name row
    $('override-name-input').value     = p.name_override != null ? p.name_override : '';
    $('override-name-master').textContent = p.master_name || '(tidak ada)';
    $('override-name-status').textContent  = p.name_override ? '🟡 OVERRIDE aktif' : '🟢 DEFAULT (ikut Master)';

    // Description row
    $('override-desc-input').value     = p.description_override != null ? p.description_override : '';
    $('override-desc-master').textContent = p.master_description || '(tidak ada)';
    $('override-desc-status').textContent  = p.description_override ? '🟡 OVERRIDE aktif' : '🟢 DEFAULT (ikut Master)';

    // Photo row — live override URL preview'd from the catalog payload
    var imgInput = $('override-img-file');
    if (imgInput) imgInput.value = '';
    var hasImg = p.image_url || p.master_image_url;
    var previewImg = $('override-img-preview');
    var previewMono = $('override-img-preview-mono');
    if (hasImg) {
      previewImg.src = p.image_url || p.master_image_url;
      previewImg.style.display = 'block';
      previewMono.style.display = 'none';
    } else {
      previewImg.style.display = 'none';
      previewMono.style.display = 'block';
      previewMono.textContent = (p.name || p.master_name || '?').trim().slice(0, 1).toUpperCase();
    }
    $('override-img-status').textContent = p.image_override ? '🟠 OVERRIDE legacy tersimpan (tidak digunakan)' : '🟢 DEFAULT (ikut Master)';

    // Price row — pricing policy drives editability (same UX as adopt modal)
    var isRange = String(p.pricing_mode).toLowerCase() === 'range';
    var priceInput = $('override-price-input');
    var priceHint = $('override-price-hint');
    if (isRange) {
      priceInput.readOnly = false;
      priceInput.value = p.price != null ? p.price : (p.master_price != null ? p.master_price : '');
      priceInput.min = p.min_price != null ? p.min_price : p.master_price;
      priceInput.max = p.max_price != null ? p.max_price : p.master_price;
      priceHint.innerHTML = '💡 <strong>Range Harga Fleksibel:</strong> Cabang diizinkan menentukan harga antara <strong>' + formatMoney(p.min_price) + '</strong> s/d <strong>' + formatMoney(p.max_price) + '</strong>.';
    } else {
      priceInput.readOnly = true;
      priceInput.value = p.price != null ? p.price : (p.master_price != null ? p.master_price : '');
      priceHint.innerHTML = '🔒 <strong>Harga Terkunci:</strong> Ditetapkan paten oleh Pemilik Resto (Owner) sebesar <strong>' + formatMoney(p.master_price) + '</strong>.';
    }

    // Category row — branch categories of the currently managed branch
    var cats = (currentBranchCatalogData && currentBranchCatalogData.categories) || (bmMenuState && bmMenuState.categories) || [];
    var catSelect = $('override-category-select');
    if (catSelect) {
      var catOptions = cats.map(function (c) {
        return '<option value="' + c.id + '"' + (String(p.branch_category_id) === String(c.id) ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      });
      catOptions.unshift('<option value="">Tanpa Kategori</option>');
      catSelect.innerHTML = catOptions.join('');
    }

    // M:N Category Checkbox List (Phase 3)
    var catListEl = $('override-categories-list');
    if (catListEl) {
      var activeCatIds = Array.isArray(p.category_ids) && p.category_ids.length > 0
        ? p.category_ids.map(String)
        : (p.branch_category_id ? [String(p.branch_category_id)] : []);
      if (!cats.length) {
        catListEl.innerHTML = '<span class="text-muted" style="font-size:12px; grid-column:1/-1; padding:12px 0;">Belum ada kategori cabang dibuat. Buat kategori terlebih dahulu di tab Kategori Cabang.</span>';
      } else {
        catListEl.innerHTML = cats.map(function (c) {
          var isChecked = activeCatIds.indexOf(String(c.id)) !== -1;
          return '<label class="x-category-chip-card' + (isChecked ? ' is-checked' : '') + '">' +
            '<input type="checkbox" class="override-cat-checkbox" value="' + esc(c.id) + '"' + (isChecked ? ' checked' : '') + ' onchange="this.closest(\'.x-category-chip-card\').classList.toggle(\'is-checked\', this.checked)" />' +
            '<span title="' + esc(c.name) + '">' + esc(c.name) + '</span>' +
          '</label>';
        }).join('');
      }
    }

    modal.style.display = 'flex';
  };

  window.closeBranchOverrideModal = function () {
    var modal = $('modal-branch-override');
    if (modal) modal.style.display = 'none';
    _overrideProductId = null;
  };

  window.saveBranchProductOverride = async function () {
    if (!currentManagingBranchId || !_overrideProductId) return;
    var btn = $('btn-save-override');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';

    // Empty string = user wants to clear the override (send null)
    var nameVal = $('override-name-input').value;
    var descVal = $('override-desc-input').value;

    var payload = {};
    payload.name        = nameVal.trim()  !== '' ? nameVal.trim()  : null;
    payload.description = descVal.trim()  !== '' ? descVal.trim()  : null;

    // price — lock mode is readonly (input disabled); range mode always sent so
    // the server re-validates against the locked PricingPolicyModel.
    var pricingMode = String($('override-price-input').readOnly ? 'lock' : 'range').toLowerCase();
    if (pricingMode === 'range') {
      payload.price = Number($('override-price-input').value);
    }

    // category — collect M:N checkboxes if present, otherwise fallback to select
    var catListEl = $('override-categories-list');
    if (catListEl && catListEl.querySelectorAll('.override-cat-checkbox').length > 0) {
      var checkedCbs = catListEl.querySelectorAll('.override-cat-checkbox:checked');
      var checkedIds = Array.from(checkedCbs).map(function (cb) { return cb.value; });
      payload.category_ids = checkedIds;
      payload.branch_category_id = checkedIds.length > 0 ? checkedIds[0] : null;
    } else {
      var catVal = $('override-category-select') ? $('override-category-select').value : '';
      payload.branch_category_id = catVal !== '' ? catVal : null;
      if (catVal !== '') payload.category_ids = [catVal];
    }

    try {
      // 2. Text + price + category overrides
      var res = await CatalogClient.updateBranchProductOverride(currentManagingBranchId, _overrideProductId, payload);
      var data = await res.json();
      if (data.success) {
        showToast('✅ Perubahan menu cabang berhasil disimpan!');
        window.closeBranchOverrideModal();
        if (isBranchManager()) {
          if (typeof hooks.refreshBMMenu === 'function') hooks.refreshBMMenu();
          if (typeof loadInlineBranchCatalog === 'function') loadInlineBranchCatalog();
        } else {
          loadInlineBranchCatalog();
        }
      } else {
        showToast('❌ ' + (data.message || data.error || 'Gagal menyimpan perubahan.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan saat menyimpan perubahan.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Simpan';
    }
  };

  window.clearBranchProductOverride = async function () {
    if (!currentManagingBranchId || !_overrideProductId) return;
    if (!confirm('Kembalikan nilai teks, harga, dan kategori ke Master? Foto Menu tetap mengikuti Master Product Owner.')) return;
    var res = await CatalogClient.updateBranchProductOverride(currentManagingBranchId, _overrideProductId, { name: null, description: null, price: null, branch_category_id: null, category_ids: [] });
    var data = await res.json();
    if (data.success) {
      showToast('✅ Semua nilai dikembalikan ke Master.');
      window.closeBranchOverrideModal();
      if (isBranchManager()) {
        if (typeof hooks.refreshBMMenu === 'function') hooks.refreshBMMenu();
        if (typeof loadInlineBranchCatalog === 'function') loadInlineBranchCatalog();
      } else {
        loadInlineBranchCatalog();
      }
    } else {
      showToast('❌ ' + (data.error || 'Gagal menghapus override.'));
    }
  };

  window.promptAddBranchCategory = async function () {
    if (!currentManagingBranchId) return;
    var name = prompt('Nama Kategori Baru untuk Cabang ini:');
    if (!name || !name.trim()) return;

    try {
      var res = await CatalogClient.createBranchCategory(currentManagingBranchId, { name: name.trim() });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Kategori cabang berhasil dibuat!');
        loadInlineBranchCatalog();
      } else {
        showToast('❌ ' + (data.error || 'Gagal membuat kategori cabang.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };

  // Adopt Product Modal Actions
  window.openMerchantAdoptModal = function (productId) {
    if (!currentBranchCatalogData) return;
    var p = currentBranchCatalogData.available_master_products.find(function (x) { return String(x.id) === String(productId); });
    if (!p) return;

    var resolvedBranchId = currentManagingBranchId ||
      (typeof getActiveBranchId === 'function' ? getActiveBranchId() : null) ||
      (typeof getEffectiveBranchId === 'function' ? getEffectiveBranchId() : null);
    if (resolvedBranchId) currentManagingBranchId = resolvedBranchId;

    var composition = p.menu_composition;
    if (!composition) {
      showToast('⚠️ Menu Master ini belum memiliki komposisi lengkap. Owner harus melengkapinya terlebih dahulu.');
      return;
    }

    $('adopt-product-id').value = p.id;
    $('adopt-product-name').value = p.name || p.id;

    if ($('adopt-menu-title')) $('adopt-menu-title').textContent = composition.title || '—';
    if ($('adopt-menu-subtitle')) $('adopt-menu-subtitle').textContent = composition.subtitle || 'Tanpa Rasa';
    if ($('adopt-menu-detail')) $('adopt-menu-detail').textContent = composition.detail && composition.detail.length ? composition.detail.join(', ') : 'Tanpa Kelengkapan';
    if ($('adopt-menu-indicator')) $('adopt-menu-indicator').textContent = composition.indicator || 'Tanpa Level';
    if ($('adopt-price-display')) $('adopt-price-display').value = formatMoney(composition.price);

    var catSelect = $('adopt-branch-category');
    var cats = currentBranchCatalogData.categories || [];
    var catOptions = cats.map(function (cat) {
      return '<option value="' + esc(cat.id) + '">' + esc(cat.name) + '</option>';
    });
    catSelect.innerHTML = '<option value="">Pilih Kategori Cabang</option>' + catOptions.join('');
    catSelect.value = '';

    $('modal-adopt-product').style.display = 'flex';
  };

  window.closeMerchantAdoptModal = function () {
    $('modal-adopt-product').style.display = 'none';
  };

  // Form Adopt Submit Listener
  var formAdopt = $('form-adopt-product');
  if (formAdopt) {
    formAdopt.addEventListener('submit', async function (e) {
      e.preventDefault();
      var targetBranchId = currentManagingBranchId ||
        (typeof getActiveBranchId === 'function' ? getActiveBranchId() : null) ||
        (typeof getEffectiveBranchId === 'function' ? getEffectiveBranchId() : null);
      if (!targetBranchId) {
        showToast('❌ Cabang tidak valid atau belum dipilih.');
        return;
      }
      currentManagingBranchId = targetBranchId;

      var btn = $('btn-save-adopt');
      btn.disabled = true;
      btn.textContent = 'Menyimpan...';

      var prodId = $('adopt-product-id').value;
      var catId = $('adopt-branch-category').value;
      if (!catId) {
        showToast('❌ Pilih minimal satu Kategori Cabang.');
        btn.disabled = false;
        btn.textContent = 'Simpan ke Katalog Cabang';
        return;
      }

      try {
        var res = await CatalogClient.adoptProduct(currentManagingBranchId, {
          product_id: prodId,
          category_ids: [catId]
        });
        var data = await res.json();
        if (data.success) {
          showToast('✅ Menu berhasil diadopsi ke cabang!');
          window.closeMerchantAdoptModal();
          if (isBranchManager()) {
            if (typeof hooks.refreshBMMenu === 'function') hooks.refreshBMMenu();
            if (typeof loadInlineBranchCatalog === 'function') loadInlineBranchCatalog();
          } else {
            loadInlineBranchCatalog();
          }
        } else {
          showToast('❌ ' + (data.message || data.error || 'Gagal mengadopsi produk.'));
        }
      } catch (err) {
        showToast('❌ Kesalahan jaringan.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Simpan ke Katalog Cabang';
      }
    });
  }

  /* ==========================================================================
     BRANCH CATALOG INLINE PANEL + BRANCH CATEGORY MODAL (shared with Branch Manager)
     ========================================================================== */

  /* =========================================================================
     MODUL 3.2: BRANCH CATALOG INLINE PANEL
     (Used when role = branch_manager — renders directly in tab-catalog)
     ========================================================================= */

  var branchCatalogFilter = 'all'; // active branch category filter ('all' or catId)

  function getActiveBranchId() {
    if (currentManagingBranchId) return currentManagingBranchId;
    if (currentBranchCatalogData && currentBranchCatalogData.branch && currentBranchCatalogData.branch.id) {
      return currentBranchCatalogData.branch.id;
    }
    if (_bceCurrentCat && _bceCurrentCat.branch_id) {
      return _bceCurrentCat.branch_id;
    }
    var user = getStoredUser();
    if (user && user.branch_id) return user.branch_id;
    return null;
  }

  async function loadInlineBranchCatalog() {
    var branchId = getActiveBranchId();
    if (!branchId) return;
    currentManagingBranchId = branchId;

    var adoptedEl = $('branch-inline-adopted-container');
    var availableEl = $('branch-inline-available-container');
    var catsEl = $('branch-inline-categories-bar');
    if (adoptedEl) adoptedEl.innerHTML = '<p class="text-muted" style="font-size:13px;">Memuat menu aktif cabang...</p>';
    if (availableEl) availableEl.innerHTML = '<p class="text-muted" style="font-size:13px;">Memuat rekomendasi Owner...</p>';
    if (catsEl) catsEl.innerHTML = '<span class="text-muted" style="font-size:13px;">Memuat kategori...</span>';

    try {
      var res = await CatalogClient.getBranchCatalog(currentManagingBranchId);
      var data = await res.json();
      if (!data.success) {
        showToast('\u274C ' + (data.error || 'Gagal memuat katalog cabang.'));
        return;
      }

      currentBranchCatalogData = data;

      var categories = data.categories || [];
      var adopted = data.adopted_products || [];
      var available = data.available_master_products || [];

      // Update subtitle
      var subtitle = $('branch-catalog-subtitle');
      if (subtitle && data.branch) subtitle.textContent = 'Cabang: ' + data.branch.name;

      // Update counts
      if ($('branch-inline-cat-count')) $('branch-inline-cat-count').textContent = categories.length;
      if ($('branch-inline-active-count')) $('branch-inline-active-count').textContent = adopted.length;
      if ($('branch-inline-available-count')) $('branch-inline-available-count').textContent = available.length;

      renderInlineCategoriesBar(categories);
      renderInlineAdoptedProducts(adopted, branchCatalogFilter);
      renderInlineAvailableProducts(available);
    } catch (err) {
      console.error('[Inline Branch Catalog Error]:', err);
      showToast('\u274C Kesalahan jaringan saat memuat katalog cabang.');
    }
  }

  var _dragSrcCatId = null; // ID of the category being dragged
  var _dragSrcEl = null;   // DOM element being dragged

  function renderInlineCategoriesBar(categories) {
    var bar = $('branch-inline-categories-bar');
    if (!bar) return;

    bar.innerHTML = ''; // clear

    // "Semua" chip — not draggable
    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'x-cat-filter-btn' + (branchCatalogFilter === 'all' ? ' active' : '');
    allBtn.style.borderRadius = '20px';
    allBtn.textContent = 'Semua';
    allBtn.addEventListener('click', function () { setBranchCatalogFilter('all'); });
    bar.appendChild(allBtn);

    if (!categories.length) {
      var hint = document.createElement('span');
      hint.className = 'text-muted';
      hint.style.fontSize = '12px';
      hint.textContent = 'Belum ada kategori. Klik "+ Tambah Kategori" untuk membuat.';
      bar.appendChild(hint);
      return;
    }

    categories.forEach(function (cat) {
      var isActive = branchCatalogFilter === cat.id;

      // Outer chip wrapper — represents the category item in the list
      var chip = document.createElement('span');
      chip.dataset.catId = cat.id;
      chip.draggable = true;
      chip.style.cssText = [
        'display:inline-flex;align-items:center;gap:0;border-radius:20px;overflow:hidden;',
        'border:1px solid ' + (isActive ? 'var(--x-primary,#b6ff00)' : '#e2e8f0') + ';',
        'background:' + (isActive ? '#f0ffe0' : '#f8fafc') + ';',
        'transition:box-shadow 0.15s,opacity 0.15s;',
        'cursor:grab;'
      ].join('');

      // Drag handle indicator
      var handle = document.createElement('span');
      handle.title = 'Tahan & geser untuk ubah urutan';
      handle.style.cssText = 'padding:5px 4px 5px 10px;font-size:13px;color:#94a3b8;cursor:grab;user-select:none;';
      handle.textContent = '⠿';
      chip.appendChild(handle);

      // Small square thumbnail so admins can see the persisted category image
      var thumbWrap = document.createElement('span');
      thumbWrap.style.cssText = 'width:22px;height:22px;border-radius:6px;overflow:hidden;background:#eef2f6;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:2px;';
      if (cat.image_url) {
        var thumbImg = document.createElement('img');
        thumbImg.src = cat.image_url;
        thumbImg.alt = '';
        thumbImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        thumbWrap.appendChild(thumbImg);
      } else {
        var thumbMono = document.createElement('span');
        thumbMono.style.cssText = 'font-size:10px;font-weight:700;color:#94a3b8;';
        thumbMono.textContent = (cat.name || '?').trim().slice(0, 1).toUpperCase();
        thumbWrap.appendChild(thumbMono);
      }
      chip.appendChild(thumbWrap);

      // Category name / filter button
      var nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.draggable = false;
      nameBtn.style.cssText = 'border:none;background:none;padding:6px 8px 6px 2px;font-size:13px;font-weight:' + (isActive ? '700' : '500') + ';cursor:pointer;color:#1e293b;';
      nameBtn.textContent = cat.name;
      nameBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        setBranchCatalogFilter(cat.id);
      });
      chip.appendChild(nameBtn);

      // Edit button
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.draggable = false;
      editBtn.title = 'Ubah nama & gambar';
      editBtn.style.cssText = 'border:none;background:none;padding:5px 5px;font-size:12px;cursor:pointer;color:#64748b;';
      editBtn.textContent = '✏️';
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openBranchCategoryEditModal(cat);
      });
      chip.appendChild(editBtn);

      // Delete button
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.draggable = false;
      delBtn.title = 'Hapus kategori';
      delBtn.style.cssText = 'border:none;background:none;padding:6px 10px 6px 4px;font-size:12px;cursor:pointer;color:#ef4444;opacity:0.8;';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteBranchCategory(cat.id, cat.name);
      });
      chip.appendChild(delBtn);

      // ── HTML5 Drag Events ──
      chip.addEventListener('dragstart', function (e) {
        _dragSrcCatId = cat.id;
        _dragSrcEl = chip;
        chip.style.cursor = 'grabbing';
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', cat.id);
        setTimeout(function () {
          chip.style.opacity = '0.4';
          chip.style.transform = 'scale(0.96)';
        }, 0);
      });

      chip.addEventListener('dragend', function () {
        chip.style.opacity = '1';
        chip.style.cursor = 'grab';
        chip.style.transform = '';
        bar.querySelectorAll('[data-cat-id]').forEach(function (el) {
          el.style.borderLeft = '';
          el.style.borderRight = '';
          el.style.boxShadow = '';
        });
      });

      chip.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (chip !== _dragSrcEl) {
          var rect = chip.getBoundingClientRect();
          var midX = rect.left + rect.width / 2;
          if (e.clientX < midX) {
            chip.style.borderLeft = '3px solid var(--x-primary,#10b981)';
            chip.style.borderRight = '';
          } else {
            chip.style.borderLeft = '';
            chip.style.borderRight = '3px solid var(--x-primary,#10b981)';
          }
        }
      });

      chip.addEventListener('dragleave', function () {
        chip.style.borderLeft = '';
        chip.style.borderRight = '';
      });

      chip.addEventListener('drop', function (e) {
        e.preventDefault();
        chip.style.borderLeft = '';
        chip.style.borderRight = '';
        if (!_dragSrcCatId || _dragSrcCatId === cat.id || !_dragSrcEl) return;

        var rect = chip.getBoundingClientRect();
        var midX = rect.left + rect.width / 2;
        var insertBefore = e.clientX < midX;

        if (insertBefore) {
          bar.insertBefore(_dragSrcEl, chip);
        } else {
          bar.insertBefore(_dragSrcEl, chip.nextSibling);
        }

        // Build new order from DOM
        var newOrder = Array.from(bar.querySelectorAll('[data-cat-id]')).map(function (el) {
          return el.dataset.catId;
        });

        // Persist to server
        saveBranchCategoryOrder(newOrder);
      });
      // ──────────────────────────────────────────────────────────

      bar.appendChild(chip);
    });
  }

  async function saveBranchCategoryOrder(orderedIds) {
    var branchId = getActiveBranchId();
    if (!branchId) {
      showToast('❌ Cabang tidak valid atau belum dipilih.');
      return;
    }
    currentManagingBranchId = branchId;

    try {
      var res = await CatalogClient.reorderBranchCategories(branchId, orderedIds);
      var data = await res.json();
      if (data.success) {
        showToast('✅ Urutan kategori disimpan — tampilan pelanggan diperbarui.');
        // Update local data so filter still works after re-render
        if (currentBranchCatalogData && currentBranchCatalogData.categories) {
          var catMap = {};
          currentBranchCatalogData.categories.forEach(function (c) { catMap[c.id] = c; });
          currentBranchCatalogData.categories = orderedIds
            .map(function (id) { return catMap[id]; })
            .filter(Boolean);
          if ($('branch-inline-cat-count')) {
            $('branch-inline-cat-count').textContent = currentBranchCatalogData.categories.length;
          }
        }
      } else {
        showToast('❌ ' + (data.error || 'Gagal menyimpan urutan kategori.'));
        loadInlineBranchCatalog(); // reload to restore correct order
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan saat menyimpan urutan.');
      loadInlineBranchCatalog();
    }
  }


  window.setBranchCatalogFilter = function (catId) {
    branchCatalogFilter = catId;
    if (!currentBranchCatalogData) return;

    var categories = currentBranchCatalogData.categories || [];
    var adopted = currentBranchCatalogData.adopted_products || [];

    // Update filter label
    var label = $('branch-inline-filter-label');
    if (label) {
      if (catId === 'all') {
        label.textContent = 'Semua kategori';
      } else {
        var cat = categories.find(function (c) { return c.id === catId; });
        label.textContent = 'Filter: ' + (cat ? cat.name : catId);
      }
    }

    renderInlineCategoriesBar(categories);
    renderInlineAdoptedProducts(adopted, catId);
  };

  // ── Branch Category Edit Modal (name + image) ──────────────────────────
  var _bceSelectedFile = null; // File object staged for upload on save
  var _bceCropSpec = null;
  var _bceCurrentCat = null;   // Active category being edited

  // Drives the Aktif/Nonaktif control inside the category modal. The selected value is kept in
  // the hidden #bce-is-active input so the submit handler has a single source to read.
  function updateBranchCategoryStatusUI(isActive) {
    var activeVal = Boolean(isActive);
    if ($('bce-is-active')) $('bce-is-active').value = activeVal ? '1' : '0';
    var btnActive = $('bce-btn-activate');
    var btnInactive = $('bce-btn-deactivate');
    if (btnActive) btnActive.disabled = activeVal;
    if (btnInactive) btnInactive.disabled = !activeVal;
  }

  window.openBranchCategoryCreateModal = function () {
    _bceSelectedFile = null;
    _bceCropSpec = null;
    _bceCurrentCat = null;
    if ($('bce-cat-id')) $('bce-cat-id').value = '';
    if ($('bce-name')) $('bce-name').value = '';
    if ($('bce-image-file')) $('bce-image-file').value = '';

    var titleEl = $('branch-category-modal-title');
    if (titleEl) titleEl.textContent = 'Tambah Kategori Cabang';
    var saveBtn = $('btn-save-branch-category-edit');
    if (saveBtn) saveBtn.textContent = 'Tambah Kategori';

    // A category being created has nothing to deactivate yet.
    var statusSection = $('bce-status-section');
    if (statusSection) statusSection.style.display = 'none';
    updateBranchCategoryStatusUI(true);

    var previewImg = $('bce-image-preview');
    var previewMono = $('bce-image-preview-mono');
    if (previewImg) previewImg.style.display = 'none';
    if (previewMono) {
      previewMono.style.display = 'block';
      previewMono.textContent = '+';
    }

    var modal = $('modal-branch-category-edit');
    if (modal) modal.style.display = 'flex';
  };

  window.openBranchCategoryEditModal = function (cat) {
    _bceSelectedFile = null;
    _bceCropSpec = null;
    _bceCurrentCat = cat || null;
    if ($('bce-cat-id')) $('bce-cat-id').value = cat ? cat.id : '';
    if ($('bce-name')) $('bce-name').value = (cat && cat.name) || '';
    if ($('bce-image-file')) $('bce-image-file').value = '';

    var titleEl = $('branch-category-modal-title');
    if (titleEl) titleEl.textContent = 'Ubah Kategori Cabang';
    var saveBtn = $('btn-save-branch-category-edit');
    if (saveBtn) saveBtn.textContent = 'Simpan';

    var statusSection = $('bce-status-section');
    if (statusSection) statusSection.style.display = 'flex';
    updateBranchCategoryStatusUI(!(cat && (cat.is_active === 0 || cat.is_active === false)));

    var previewImg = $('bce-image-preview');
    var previewMono = $('bce-image-preview-mono');
    if (cat && cat.image_url) {
      previewImg.src = cat.image_url;
      previewImg.style.display = 'block';
      previewMono.style.display = 'none';
    } else {
      previewImg.style.display = 'none';
      previewMono.style.display = 'block';
      previewMono.textContent = ((cat && cat.name) || '?').trim().slice(0, 1).toUpperCase();
    }

    var modal = $('modal-branch-category-edit');
    if (modal) modal.style.display = 'flex';
  };

  window.closeBranchCategoryEditModal = function () {
    var modal = $('modal-branch-category-edit');
    if (modal) modal.style.display = 'none';
    _bceSelectedFile = null;
    _bceCropSpec = null;
    _bceCurrentCat = null;
  };

  (function initBranchCategoryEditModal() {
    var btnActive = $('bce-btn-activate');
    if (btnActive) {
      btnActive.addEventListener('click', function (e) {
        e.preventDefault();
        updateBranchCategoryStatusUI(true);
      });
    }

    var btnInactive = $('bce-btn-deactivate');
    if (btnInactive) {
      btnInactive.addEventListener('click', function (e) {
        e.preventDefault();
        updateBranchCategoryStatusUI(false);
      });
    }

    var fileInput = $('bce-image-file');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) { _bceSelectedFile = null; _bceCropSpec = null; return; }

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.');
          fileInput.value = '';
          return;
        }
        if (file.size > 15 * 1024 * 1024) {
          showToast('❌ Ukuran gambar melebihi batas maksimal 15MB.');
          fileInput.value = '';
          return;
        }

        _bceSelectedFile = file;

        XentraCropEditor.open({
          source: file,
          assetType: 'category',
          aspectRatio: 1.0,
          title: 'Potong & Posisikan Gambar Kategori (1:1)',
          onConfirm: function (cropSpec, previewDataUrl) {
            _bceCropSpec = cropSpec;
            var previewImg = $('bce-image-preview');
            var previewMono = $('bce-image-preview-mono');
            if (previewImg) {
              previewImg.src = previewDataUrl || URL.createObjectURL(file);
              previewImg.style.display = 'block';
            }
            if (previewMono) previewMono.style.display = 'none';
            showToast('✓ Potongan gambar kategori disesuaikan.');
          },
          onCancel: function () {
            _bceSelectedFile = null;
            _bceCropSpec = null;
            if (fileInput) fileInput.value = '';
          }
        });
      });
    }

    var form = $('form-branch-category-edit');
    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();

        var catId = $('bce-cat-id').value;
        var newName = $('bce-name').value.trim();
        if (!newName) {
          showToast('❌ Nama kategori wajib diisi.');
          return;
        }

        var activeBranchId = getActiveBranchId();
        if (!activeBranchId) {
          showToast('❌ Cabang tidak valid atau belum dipilih.');
          return;
        }
        currentManagingBranchId = activeBranchId;

        var saveBtn = $('btn-save-branch-category-edit');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Menyimpan...'; }

        try {
          var targetCatId = catId;

          if (!catId) {
            // CREATE new branch category
            var createRes = await CatalogClient.createBranchCategory(activeBranchId, { name: newName });
            var createData = await createRes.json();
            if (!createRes.ok || !createData.success) {
              showToast('❌ ' + (createData.error || createData.message || 'Gagal membuat kategori cabang.'));
              return;
            }
            targetCatId = createData.category && createData.category.id;
          } else {
            // 1. Rename existing and/or change its active state
            var statusVal = $('bce-is-active') ? Number($('bce-is-active').value) : 1;
            var renameRes = await CatalogClient.updateBranchCategory(activeBranchId, catId, { name: newName, is_active: statusVal });
            var renameData = {};
            try {
              renameData = await renameRes.json();
            } catch (_) {
              renameData = { success: false, error: 'Respon server tidak valid saat mengubah nama kategori.' };
            }

            if (!renameRes.ok || !renameData.success) {
              showToast('❌ ' + (renameData.error || renameData.message || 'Gagal mengubah nama kategori.'));
              return;
            }
          }

          // 2. Image (only if a new file was staged) — uploaded as base64 to backend
          if (_bceSelectedFile && targetCatId) {
            var base64 = await new Promise(function (resolve, reject) {
              var reader = new FileReader();
              reader.onload = function () { resolve(reader.result); };
              reader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
              reader.readAsDataURL(_bceSelectedFile);
            });

            var catImgPayload = { image_base64: base64, mime_type: _bceSelectedFile.type };
            if (_bceCropSpec) {
              catImgPayload.crop_spec = _bceCropSpec;
            }

            var imageRes = await CatalogClient.uploadBranchCategoryImage(activeBranchId, targetCatId, catImgPayload);
            var imageData = {};
            try {
              imageData = await imageRes.json();
            } catch (_) {
              imageData = { success: false, error: 'Respon server tidak valid saat mengunggah gambar.' };
            }

            if (!imageRes.ok || !imageData.success) {
              showToast('❌ ' + (imageData.error || imageData.message || 'Gagal mengunggah gambar kategori.'));
              return;
            }
          }

          showToast(catId ? '✅ Kategori berhasil diperbarui!' : '✅ Kategori cabang berhasil dibuat!');
          closeBranchCategoryEditModal();

          // Reflect the change in the in-memory lists immediately, so the category bar and the
          // status filter respond on the spot instead of waiting for the background refresh.
          var statusNumber = $('bce-is-active') ? Number($('bce-is-active').value) : 1;
          if (catId) {
            if (currentBranchCatalogData && Array.isArray(currentBranchCatalogData.categories)) {
              var localCat = currentBranchCatalogData.categories.find(function (c) { return String(c.id) === String(catId); });
              if (localCat) { localCat.name = newName; localCat.is_active = statusNumber; }
            }
            var sharedState = window._bmMenuState;
            if (sharedState && Array.isArray(sharedState.categories)) {
              var sharedCat = sharedState.categories.find(function (c) { return String(c.id) === String(catId); });
              if (sharedCat) { sharedCat.name = newName; sharedCat.is_active = statusNumber; }
            }
            if (typeof window.renderBMMenuCategoriesBar === 'function') {
              window.renderBMMenuCategoriesBar();
            }
          }

          // Then refresh from the server in the background.
          if (typeof hooks.refreshBMMenu === 'function') {
            hooks.refreshBMMenu();
          } else if (typeof window.loadBMMenu === 'function') {
            window.loadBMMenu();
          }
          if (typeof loadInlineBranchCatalog === 'function') {
            loadInlineBranchCatalog();
          }
        } catch (err) {
          console.error('[Branch Category Save Error]:', err);
          showToast('❌ ' + (err.message || 'Kesalahan jaringan saat menyimpan kategori.'));
        } finally {
          if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = catId ? 'Simpan' : 'Tambah Kategori'; }
        }
      });
    }
  })();

  window.deleteBranchCategory = async function (catId, catName) {
    if (!confirm('Hapus kategori "' + catName + '"? Produk di kategori ini tidak akan dihapus, hanya dipindah ke tanpa kategori.')) return;

    var branchId = getActiveBranchId();
    if (!branchId) {
      showToast('❌ Cabang tidak valid atau belum dipilih.');
      return;
    }
    currentManagingBranchId = branchId;

    try {
      var res = await CatalogClient.deleteBranchCategory(branchId, catId);
      var data = await res.json();
      if (data.success) {
        showToast('✅ Kategori dihapus.');
        if (branchCatalogFilter === catId) branchCatalogFilter = 'all';
        if (typeof hooks.refreshBMMenu === 'function' && isBranchManager()) hooks.refreshBMMenu();
        loadInlineBranchCatalog();
      } else {
        showToast('❌ ' + (data.error || 'Gagal menghapus kategori.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };


  function renderInlineAdoptedProducts(adopted, filterCatId) {
    var container = $('branch-inline-adopted-container');
    if (!container) return;

    var source = Array.isArray(adopted) ? adopted : [];
    var filtered = source;
    if (filterCatId && filterCatId !== 'all') {
      filtered = source.filter(function (p) {
        var ids = Array.isArray(p.category_ids) ? p.category_ids.map(String) : [];
        return ids.indexOf(String(filterCatId)) !== -1;
      });
    }

    if (!filtered.length) {
      var msg = filterCatId && filterCatId !== 'all'
        ? 'Belum ada menu di kategori ini.'
        : 'Belum ada menu yang diadopsi. Pilih dari daftar Master Owner.';
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">' + msg + '</div>';
      return;
    }
    
    container.innerHTML = filtered.map(function (p) {
      var comp = p.menu_composition || {};
      var img = comp.image || p.image_url || p.master_image_url || '';
      var isAvailable = p.is_available === 1 || p.is_available === true;
      var categoryNames = (p.categories || []).map(function (c) { return c.name; }).filter(Boolean);
      var categoryHtml = categoryNames.length
        ? '<div style="display:flex;gap:4px;flex-wrap:wrap;margin:5px 0;">' + categoryNames.map(function (name) {
            return '<span class="x-badge x-badge-info" style="font-size:10px;">' + esc(name) + '</span>';
          }).join('') + '</div>'
        : '';

      var compositionHtml = comp
        ? '<div style="font-size:11px;line-height:1.5;color:#475569;margin:5px 0 7px;">' +
            '<div><strong>' + esc(comp.title || 'Komposisi belum lengkap') + '</strong></div>' +
            (comp.subtitle ? '<div>' + esc(comp.subtitle) + '</div>' : '') +
            (comp.detail && comp.detail.length ? '<div>' + esc(comp.detail.join(' · ')) + '</div>' : '') +
            (comp.indicator ? '<div style="font-weight:700;">' + esc(comp.indicator) + '</div>' : '') +
          '</div>'
        : '<div style="font-size:11px;color:#b45309;margin:5px 0 7px;">Komposisi Master belum tersedia.</div>';

      var price = comp.price != null ? Number(comp.price) : Number(p.master_price || p.price || 0);
            var availabilityToggle = '' +
        '<label class="x-toggle' + (isAvailable ? ' x-toggle-on' : '') + '" title="' + (isAvailable ? 'Menu tersedia' : 'Menu habis') + '">' +
          '<input type="checkbox" ' + (isAvailable ? 'checked' : '') + ' onchange="toggleBranchProductAvailability(\'' + p.product_id + '\', this.checked ? 1 : 0)" aria-label="Ubah ketersediaan menu cabang">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      return [
        '<div class="x-product-card-simple">',
          img ? '<img src="' + esc(img) + '" class="x-product-card-thumb" alt="' + esc(p.name || comp.title || 'Menu') + '">' : '',
          '<div class="x-product-card-content">',
            '<h5>' + esc(p.name || comp.title || 'Master Menu') + '</h5>',
            compositionHtml,
            categoryHtml,
            '<div class="x-product-card-price">Harga Owner: ' + formatMoney(price) + '</div>',
            '<div class="x-product-card-actions">',
              '<div>' + availabilityToggle + '</div>',
              '<div class="x-item-actions">',
                '<button type="button" class="x-action-menu-trigger" aria-label="Aksi menu cabang" onclick="XentraActionMenu.open(this, [' +
                  '{ label: \'Hapus dari Cabang\', icon: \'🗑️\', destructive: true, onClick: function() { removeBranchProduct(\'' + p.product_id + '\'); } }' +
                '])">',
                '</button>',
              '</div>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }


  function renderInlineAvailableProducts(available) {
    var container = $('branch-inline-available-container');
    if (!container) return;

    var source = Array.isArray(available) ? available : [];
    if (!source.length) {
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">Semua Master Menu sudah diadopsi atau belum tersedia.</div>';
      return;
    }

    container.innerHTML = source.map(function (p) {
      var comp = p.menu_composition || null;
      var ready = Boolean(comp && comp.title);
      var img = (comp && comp.image) || p.image_url || '';
      var detailHtml = comp
        ? '<div style="font-size:11px;line-height:1.5;color:#475569;margin:5px 0 7px;">' +
            '<div><strong>' + esc(comp.title || '') + '</strong></div>' +
            (comp.subtitle ? '<div>' + esc(comp.subtitle) + '</div>' : '') +
            (comp.detail && comp.detail.length ? '<div>' + esc(comp.detail.join(' · ')) + '</div>' : '') +
            (comp.indicator ? '<div style="font-weight:700;">' + esc(comp.indicator) + '</div>' : '') +
          '</div>'
        : '<div style="font-size:11px;color:#b45309;margin:5px 0 7px;">Komposisi Master belum lengkap.</div>';

      return [
        '<div class="x-product-card-simple" style="background:#f8fafc;">',
          img ? '<img src="' + esc(img) + '" class="x-product-card-thumb" alt="' + esc((comp && comp.title) || p.name || 'Master Menu') + '">' : '',
          '<div class="x-product-card-content">',
            '<h5>' + esc(p.name || 'Master Menu') + '</h5>',
            detailHtml,
            '<div class="x-product-card-price">Harga Owner: ' + formatMoney((comp && comp.price != null) ? comp.price : p.price) + '</div>',
            '<div class="x-product-card-actions">' +
              (ready
                ? '<button type="button" class="x-btn-primary" data-master-adopt="' + esc(p.id) + '" style="padding:6px 12px;font-size:12px;">＋ Adopsi ke Cabang</button>'
                : '<button type="button" class="x-btn-secondary" disabled style="padding:6px 12px;font-size:12px;opacity:.65;">Menunggu komposisi Owner</button>') +
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');

    container.querySelectorAll('[data-master-adopt]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openMerchantAdoptModal(btn.getAttribute('data-master-adopt'));
      });
    });
  }
  // Override removeBranchProduct and toggleBranchProductAvailability to also refresh inline panel
  var _origToggleBranchAvail = window.toggleBranchProductAvailability;
  window.toggleBranchProductAvailability = async function (productId, nextAvail) {
    if (!currentManagingBranchId) return;
    try {
      var res = await CatalogClient.setBranchProductAvailability(currentManagingBranchId, productId, nextAvail);
      var data = await res.json();
      if (data.success) {
        showToast('Ketersediaan menu cabang diperbarui.');
        if (isBranchManager()) loadInlineBranchCatalog();
        else loadInlineBranchCatalog();
      } else {
        showToast('\u274C ' + (data.error || 'Gagal mengubah ketersediaan.'));
      }
    } catch (err) {
      showToast('\u274C Kesalahan jaringan.');
    }
  };

  var _origRemoveBranchProduct = window.removeBranchProduct;
  window.removeBranchProduct = async function (productId, productName) {
    productName = productName || 'menu ini';
    if (!currentManagingBranchId) return;
    if (!confirm('Hapus "' + productName + '" dari katalog cabang ini? Menu tidak akan lagi tampil di halaman pemesanan pelanggan.')) return;

    try {
      var res = await CatalogClient.removeBranchProduct(currentManagingBranchId, productId);
      var data = await res.json();
      if (data.success) {
        showToast('\u2705 Produk dihapus dari katalog cabang.');
        if (isBranchManager()) loadInlineBranchCatalog();
        else loadInlineBranchCatalog();
      } else {
        showToast('\u274C ' + (data.error || 'Gagal menghapus produk.'));
      }
    } catch (err) {
      showToast('\u274C Kesalahan jaringan.');
    }
  };

  // Override adopt form submit to reload inline panel for branch_manager
  var _origFormAdoptSubmit = null;
  (function rewireAdoptSubmit() {
    var formAdoptInline = $('form-adopt-product');
    if (!formAdoptInline) return;
    // We'll patch the success callback — store original handler then re-listen
    // (already set above; we monkey-patch via reload override in openMerchantAdoptModal closure)
  })();

  window.XentraMerchantBranchCatalog = {
    state: {
      get branchId() { return currentManagingBranchId; },
      set branchId(v) { currentManagingBranchId = v; },
      get catalogData() { return currentBranchCatalogData; },
      set catalogData(v) { currentBranchCatalogData = v; },
      get inlineFilter() { return branchCatalogFilter; },
      set inlineFilter(v) { branchCatalogFilter = v; }
    },
    getActiveBranchId: getActiveBranchId,
    loadInlineBranchCatalog: loadInlineBranchCatalog,
    setHooks: function (h) {
      if (!h) return;
      Object.keys(h).forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(hooks, k)) hooks[k] = h[k];
      });
    },
    setBmMenuState: function (s) { bmMenuState = s; }
  };
})();
