/**
 * XENTRA CORE — OWNER BRANCH CATALOG UI
 *
 * Owner Dashboard UI only. API/data transport is provided by
 * merchant-shared/js/catalog-client.js.

 * LEGACY QUARANTINE (2026-09-29):
 * Branch/Product content override UI and API are compatibility-only.
 * Do not extend name/description/image override behavior. The forward Menu
 * architecture uses Owner-owned structured Master Menu Composition.
 */
(function () {
  'use strict';

  var S = window.XentraShared;
  var CatalogClient = window.XentraCatalogClient;
  var $ = S.$;
  var esc = S.esc;
  var formatMoney = S.formatMoney;
  var showToast = S.showToast;

  var hooks = { getBranches: null };
  var currentManagingBranchId = null;
  var currentBranchCatalogData = null;
  var inlineFilter = 'all';

  function requestBranchTextInput(options) {
    options = options || {};
    return new Promise(function(resolve) {
      var wrap = document.createElement('div');
      wrap.innerHTML =
        '<div style="padding:4px 0;">' +
          '<label style="display:block;font-size:12px;font-weight:700;margin-bottom:7px;">' + esc(options.label || 'Nama') + '</label>' +
          '<input id="x-branch-text-input" class="x-input" type="text" value="' + esc(options.value || '') + '" autocomplete="off">' +
          '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">' +
            '<button type="button" class="x-btn-secondary" data-action="cancel">Batal</button>' +
            '<button type="button" class="x-btn-primary" data-action="save">Simpan</button>' +
          '</div>' +
        '</div>';
      var content = wrap.firstElementChild;
      var field = wrap.querySelector('#x-branch-text-input');
      var done = false;
      function finish(value) {
        if (done) return;
        done = true;
        if (window.XentraPresentation) window.XentraPresentation.close('branch-category-input');
        resolve(value);
      }
      wrap.querySelector('[data-action="cancel"]').addEventListener('click', function () { finish(null); });
      wrap.querySelector('[data-action="save"]').addEventListener('click', function () { finish(field.value); });
      if (window.XentraPresentation) {
        window.XentraPresentation.open({
          id: 'branch-category-input',
          type: 'bottom-sheet',
          title: options.title || 'Input',
          content: content,
          dismissible: true,
          onClose: function () { if (!done) { done = true; resolve(null); } }
        });
        setTimeout(function () { if (field) { field.focus(); field.select(); } }, 0);
      } else {
        finish(window.prompt(options.title || 'Input', options.value || ''));
      }
    });
  }

  function openBranchCatalogSheet(modalId, shellId) {
    var modal = $(modalId);
    if (!modal || !window.XentraPresentation) return false;
    var card = modal.querySelector('.x-modal-card');
    if (!card) return false;
    window.XentraPresentation.open({
      id: shellId,
      type: 'bottom-sheet',
      content: card,
      dismissible: true
    });
    return true;
  }

  async function confirmBranchCatalogAction(id, title, message, okLabel) {
    if (window.XentraPresentation && typeof window.XentraPresentation.confirm === 'function') {
      return await window.XentraPresentation.confirm({
        id: id,
        title: title,
        message: message,
        okLabel: okLabel || 'Lanjutkan',
        cancelLabel: 'Batal'
      });
    }
    return window.confirm(message);
  }



  // Compatibility entry point: Branch Catalog is a focused Page surface now.
  // The canonical route is branches/:id/menu, rendered by the Branch Detail shell.
  window.openBranchCatalogModal = function (branchId) {
    if (!branchId || typeof window.navigateTo !== 'function') return;
    window.navigateTo('branches/' + encodeURIComponent(branchId) + '/menu');
  };

  window.closeBranchCatalogModal = function () {
    if (typeof window.navigateTo === 'function') window.navigateTo('branches');
    currentManagingBranchId = null;
  };

  async function reloadBranchCatalogView() {
    if (!currentManagingBranchId) return;

    var adoptedContainer = $('branch-adopted-products-container');
    var availableContainer = $('branch-available-products-container');
    if (adoptedContainer) adoptedContainer.innerHTML = '<p class="text-muted" style="font-size:13px;">Memuat menu aktif cabang...</p>';
    if (availableContainer) availableContainer.innerHTML = '<p class="text-muted" style="font-size:13px;">Memuat produk rekomendasi Owner...</p>';

    try {
      var res = await CatalogClient.getBranchCatalog(currentManagingBranchId);
      var data = await res.json();
      if (!data.success) {
        showToast('❌ ' + (data.error || 'Gagal memuat katalog cabang.'));
        return;
      }

      currentBranchCatalogData = data;
      if ($('branch-active-count')) $('branch-active-count').textContent = (data.adopted_products || []).length;
      if ($('branch-available-count')) $('branch-available-count').textContent = (data.available_master_products || []).length;

      renderBranchAdoptedProducts(data.adopted_products || []);
      renderBranchAvailableMasterProducts(data.available_master_products || []);
    } catch (err) {
      console.error('[Branch Catalog Load Error]:', err);
      showToast('❌ Terjadi kesalahan jaringan saat memuat katalog cabang.');
    }
  }

  function renderBranchAdoptedProducts(adopted) {
    var container = $('branch-adopted-products-container');
    if (!container) return;

    var source = Array.isArray(adopted) ? adopted : [];
    if (!source.length) {
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">Belum ada menu yang diadopsi oleh cabang ini. Pilih Master Menu dari daftar Owner.</div>';
      return;
    }
    var filtered = source;
    
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

  function renderBranchAvailableMasterProducts(available) {
    var container = $('branch-available-products-container');
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
        openAdoptModal(btn.getAttribute('data-master-adopt'));
      });
    });
  }
  window.toggleBranchProductAvailability = async function (productId, nextAvail) {
    if (!currentManagingBranchId) return;
    try {
      var res = await CatalogClient.setBranchProductAvailability(currentManagingBranchId, productId, nextAvail);
      var data = await res.json();
      if (data.success) {
        showToast('Ketersediaan menu cabang diperbarui.');
        reloadBranchCatalogView();
      } else {
        showToast('❌ ' + (data.error || 'Gagal mengubah ketersediaan.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };

  window.removeBranchProduct = async function (productId, productName) {
    productName = productName || 'menu ini';
    if (!currentManagingBranchId) return;
    if (!await confirmBranchCatalogAction('remove-branch-product', 'Hapus dari Katalog Cabang', 'Hapus "' + productName + '" dari katalog cabang ini? Menu tidak akan lagi tampil di halaman pemesanan pelanggan cabang ini.', 'Hapus')) return;

    try {
      var res = await CatalogClient.removeBranchProduct(currentManagingBranchId, productId);
      var data = await res.json();
      if (data.success) {
        showToast('✅ Produk dihapus dari katalog cabang.');
        reloadBranchCatalogView();
      } else {
        showToast('❌ ' + (data.error || 'Gagal menghapus produk.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };

  /* =========================================================================
     MODUL 3.2: BRANCH PRODUCT OVERRIDE — text / price / category only
     PHOTO OVERRIDE IS LOCKED: Master Product Owner controls the image.
     ========================================================================= */
  var _overrideProductId = null;

  window.openBranchOverrideModal = function (productDataRaw) {
    var p;
    try { p = JSON.parse(productDataRaw.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")); } catch (e) { showToast('❌ Gagal membuka override.'); return; }
    _overrideProductId = p.product_id;
    _bpSelectedFile = null;

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
    var hasImg = p.image_url || p.image_override || p.master_image_url;
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
    $('override-img-status').textContent = p.image_override ? '🟡 OVERRIDE aktif' : '🟢 DEFAULT (ikut Master)';

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

    openBranchCatalogSheet('modal-branch-override', 'branch-product-override');
  };

  window.closeBranchOverrideModal = function () {
    if (window.XentraPresentation && window.XentraPresentation.isOpen('branch-product-override')) {
      window.XentraPresentation.close('branch-product-override');
    } else {
      var modal = $('modal-branch-override');
      if (modal) modal.style.display = 'none';
    }
    _overrideProductId = null;
    _bpSelectedFile = null;
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
        reloadBranchCatalogView();
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
    if (!await confirmBranchCatalogAction('clear-branch-product-override', 'Kembalikan ke Master', 'Kembalikan semua nilai ke Master? Nama, deskripsi, foto, harga, dan kategori dikembalikan ke pengaturan asal produk Master.', 'Kembalikan')) return;
    var res = await CatalogClient.updateBranchProductOverride(currentManagingBranchId, _overrideProductId, { name: null, description: null, image_url: null, price: null, branch_category_id: null, category_ids: [] });
    var data = await res.json();
    if (data.success) {
      showToast('✅ Semua nilai dikembalikan ke Master.');
      window.closeBranchOverrideModal();
      reloadBranchCatalogView();
    } else {
      showToast('❌ ' + (data.error || 'Gagal menghapus override.'));
    }
  };

  window.promptAddBranchCategory = async function () {
    if (!currentManagingBranchId) return;
    var name = await requestBranchTextInput({ title: 'Tambah Kategori Cabang', label: 'Nama Kategori' });
    if (!name || !name.trim()) return;

    try {
      var res = await CatalogClient.createBranchCategory(currentManagingBranchId, { name: name.trim() });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Kategori cabang berhasil dibuat!');
        reloadBranchCatalogView();
      } else {
        showToast('❌ ' + (data.error || 'Gagal membuat kategori cabang.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };

  // Adopt Product Modal Actions
  window.openAdoptModal = function (productId) {
    if (!currentBranchCatalogData) return;
    var p = currentBranchCatalogData.available_master_products.find(function (x) { return String(x.id) === String(productId); });
    if (!p) return;

    var resolvedBranchId = currentManagingBranchId ||
      (typeof getActiveBranchId === 'function' ? getActiveBranchId() : null) ||
      (typeof getEffectiveBranchId === 'function' ? getEffectiveBranchId() : null);
    if (resolvedBranchId) currentManagingBranchId = resolvedBranchId;

    var composition = p.menu_composition;
    if (!composition) {
      showToast('⚠️ Menu Master ini belum memiliki komposisi lengkap. Lengkapi Master Menu terlebih dahulu.');
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
    catSelect.innerHTML = '<option value="">Pilih Kategori Cabang</option>' + cats.map(function (cat) {
      return '<option value="' + esc(cat.id) + '">' + esc(cat.name) + '</option>';
    }).join('');
    catSelect.value = '';

    openBranchCatalogSheet('modal-adopt-product', 'branch-adopt-product');
  };

  window.closeAdoptModal = function () {
    if (window.XentraPresentation && window.XentraPresentation.isOpen('branch-adopt-product')) {
      window.XentraPresentation.close('branch-adopt-product');
    } else {
      window.closeAdoptModal();
    }
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
          window.closeAdoptModal();
          reloadBranchCatalogView();
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

  window.XentraOwnerBranchCatalog = {
    state: {
      get branchId() { return currentManagingBranchId; },
      set branchId(v) { currentManagingBranchId = v; },
      get catalogData() { return currentBranchCatalogData; },
      set catalogData(v) { currentBranchCatalogData = v; },
      get inlineFilter() { return inlineFilter; },
      set inlineFilter(v) { inlineFilter = v; }
    },
    getActiveBranchId: function () {
      return currentManagingBranchId ||
        (currentBranchCatalogData && currentBranchCatalogData.branch && currentBranchCatalogData.branch.id) ||
        null;
    },
    setHooks: function (h) {
      if (!h) return;
      Object.keys(h).forEach(function (k) { if (Object.prototype.hasOwnProperty.call(hooks, k)) hooks[k] = h[k]; });
    }
  };
})();
