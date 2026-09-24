/**
 * XENTRA CORE — OWNER BRANCH CATALOG UI
 *
 * Owner Dashboard UI only. API/data transport is provided by
 * merchant-shared/js/catalog-client.js.
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

  window.openBranchCatalogModal = async function (branchId) {
    currentManagingBranchId = branchId;
    var modal = $('modal-branch-catalog');
    if (!modal) return;
    modal.style.display = 'flex';

    var title = $('modal-branch-catalog-title');
    var b = hooks.getBranches().find(function (x) { return x.id === branchId; });
    if (title && b) title.textContent = 'Kelola Katalog Cabang: ' + b.name;

    await reloadBranchCatalogView();
  };

  window.closeBranchCatalogModal = function () {
    var modal = $('modal-branch-catalog');
    if (modal) modal.style.display = 'none';
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

    if (!adopted.length) {
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">Belum ada menu yang diadopsi oleh cabang ini. Pilih produk dari daftar rekomendasi Owner di bawah!</div>';
      return;
    }

    container.innerHTML = adopted.map(function (p) {
      var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isAvailable = p.is_available === 1 || p.is_available === true;
      var catName = p.branch_category_name || 'Menu Utama';
      var modeBadge = p.pricing_mode === 'range'
        ? '<span class="x-badge x-badge-range">Range (' + formatMoney(p.min_price) + ' - ' + formatMoney(p.max_price) + ')</span>'
        : '<span class="x-badge x-badge-lock">Harga Terkunci</span>';

      // Override status badges — one per supported field
      var nameSrc     = p.name_override        ? '<span class="x-badge" style="background:#fef9c3;color:#854d0e;font-size:9px;">OVERRIDE</span>' : '<span class="x-badge" style="background:#f0fdf4;color:#166534;font-size:9px;">DEFAULT</span>';
      var descSrc     = p.description_override ? '<span class="x-badge" style="background:#fef9c3;color:#854d0e;font-size:9px;">OVERRIDE</span>' : '<span class="x-badge" style="background:#f0fdf4;color:#166534;font-size:9px;">DEFAULT</span>';
      var imgSrc      = p.image_override       ? '<span class="x-badge" style="background:#fef9c3;color:#854d0e;font-size:9px;">OVERRIDE</span>' : '<span class="x-badge" style="background:#f0fdf4;color:#166534;font-size:9px;">DEFAULT</span>';

      var productDataJson = esc(JSON.stringify({
        product_id: p.product_id,
        name: p.name, name_override: p.name_override, master_name: p.master_name,
        description: p.description, description_override: p.description_override, master_description: p.master_description,
        image_url: p.image_url, image_override: p.image_override, master_image_url: p.master_image_url,
        price: p.price, master_price: p.master_price, pricing_mode: p.pricing_mode,
        min_price: p.min_price, max_price: p.max_price,
        branch_category_id: p.branch_category_id,
        category_ids: p.category_ids || (p.branch_category_id ? [p.branch_category_id] : []),
        categories: p.categories || []
      }));

      var availabilityToggle = '' +
        '<label class="x-toggle' + (isAvailable ? ' x-toggle-on' : '') + '" title="' + (isAvailable ? 'Menu tersedia' : 'Menu habis') + '">' +
          '<input type="checkbox" ' + (isAvailable ? 'checked' : '') + ' onchange="toggleBranchProductAvailability(\'' + p.product_id + '\', this.checked ? 1 : 0)" aria-label="Ubah ketersediaan menu cabang">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      return [
        '<div class="x-product-card-simple">',
          '<img src="' + esc(img) + '" class="x-product-card-thumb" alt="' + esc(p.name) + '">',
          '<div class="x-product-card-content">',
            '<h5>' + esc(p.name) + '</h5>',
            '<div style="display:flex;gap:4px;flex-wrap:wrap;margin:4px 0;">',
              '<span class="x-badge x-badge-info" style="font-size:10px;">' + esc(catName) + '</span>',
              modeBadge,
            '</div>',
            '<div class="x-product-card-price">Jual: ' + formatMoney(p.price) + ' <small class="text-muted" style="font-weight:normal;">(Owner: ' + formatMoney(p.master_price) + ')</small></div>',
            '<div style="font-size:11px;color:#64748b;margin:4px 0;display:flex;gap:8px;flex-wrap:wrap;">',
              '<span>Nama: ' + nameSrc + '</span>',
              '<span>Deskripsi: ' + descSrc + '</span>',
              '<span>Gambar: ' + imgSrc + '</span>',
            '</div>',
            '<div class="x-product-card-actions">',
              '<div>' + availabilityToggle + '</div>',
              '<div class="x-item-actions">',
                '<button type="button" class="x-action-menu-trigger" aria-label="Aksi menu cabang ' + esc(p.name) + '" onclick="XentraActionMenu.open(this, [' +
                  '{ label: \'Edit Menu Cabang\', icon: \'✏️\', onClick: function() { openBranchOverrideModal(\'' + productDataJson + '\'); } },' +
                  '{ divider: true },' +
                  '{ label: \'Hapus dari Cabang\', icon: \'🗑️\', destructive: true, onClick: function() { removeBranchProduct(\'' + p.product_id + '\', \'' + esc(p.name) + '\'); } }' +
                '])">',
                  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
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

    if (!available.length) {
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">Semua produk dari katalog Owner telah diadopsi oleh cabang ini.</div>';
      return;
    }

    container.innerHTML = available.map(function (p) {
      var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isRange = p.pricing_mode === 'range';
      var modeBadge = isRange
        ? '<span class="x-badge x-badge-range">Range (' + formatMoney(p.min_price) + ' - ' + formatMoney(p.max_price) + ')</span>'
        : '<span class="x-badge x-badge-lock">Harga Terkunci</span>';

      return [
        '<div class="x-product-card-simple" style="background:#f8fafc;">',
          '<img src="' + img + '" class="x-product-card-thumb" alt="' + esc(p.name) + '">',
          '<div class="x-product-card-content">',
            '<h5>' + esc(p.name) + '</h5>',
            '<div style="margin:4px 0;">' + modeBadge + '</div>',
            '<div class="x-product-card-price">Harga Dasar Owner: ' + formatMoney(p.price) + '</div>',
            '<div class="x-product-card-actions">',
              '<button type="button" class="x-btn-primary" style="padding:6px 12px;font-size:12px;" onclick="openAdoptModal(\'' + p.id + '\')">＋ Adopsi ke Cabang</button>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
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
    if (!currentManagingBranchId) return;
    if (!confirm('Hapus "' + productName + '" dari katalog cabang ini? Menu tidak akan lagi tampil di halaman pemesanan pelanggan cabang ini.')) return;

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
     MODUL 3.2: BRANCH PRODUCT OVERRIDE — name / description / image_url
     Master Product Default + Branch Optional Override
     ========================================================================= */
  var _overrideProductId = null;
  var _bpSelectedFile = null; // staged photo File to upload on save
  var _bpCropSpec = null;

  (function initBranchProductPhoto() {
    var fileInput = $('override-img-file');
    if (!fileInput) return;
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) { _bpSelectedFile = null; _bpCropSpec = null; return; }

      var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (allowed.indexOf(file.type) === -1) {
        showToast('❌ Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.');
        fileInput.value = '';
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        showToast('❌ Ukuran gambar melebihi batas maksimal 20MB.');
        fileInput.value = '';
        return;
      }

      _bpSelectedFile = file;

      XentraCropEditor.open({
        source: file,
        assetType: 'product',
        aspectRatio: 1.0,
        title: 'Potong & Posisikan Foto Cabang (1:1)',
        onConfirm: function (cropSpec, previewDataUrl) {
          _bpCropSpec = cropSpec;
          var previewImg = $('override-img-preview');
          var previewMono = $('override-img-preview-mono');
          if (previewImg) {
            previewImg.src = previewDataUrl || URL.createObjectURL(file);
            previewImg.style.display = 'block';
          }
          if (previewMono) previewMono.style.display = 'none';
          $('override-img-status').textContent = '🟡 OVERRIDE baru (potongan disesuaikan)';
          showToast('✓ Potongan foto menu cabang disesuaikan.');
        },
        onCancel: function () {
          var reader = new FileReader();
          reader.onload = function (e) {
            var previewImg = $('override-img-preview');
            var previewMono = $('override-img-preview-mono');
            if (!previewImg) return;
            previewImg.src = e.target.result;
            previewImg.style.display = 'block';
            if (previewMono) previewMono.style.display = 'none';
            $('override-img-status').textContent = '🟡 OVERRIDE baru (belum disimpan)';
          };
          reader.readAsDataURL(file);
        }
      });
    });
  })();

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

    modal.style.display = 'flex';
  };

  window.closeBranchOverrideModal = function () {
    var modal = $('modal-branch-override');
    if (modal) modal.style.display = 'none';
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
      // 1. Staged photo (if any) — upload first, server returns the override URL.
      if (_bpSelectedFile) {
        var base64 = await new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () { resolve(reader.result); };
          reader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
          reader.readAsDataURL(_bpSelectedFile);
        });

        var branchImgPayload = { image_base64: base64, mime_type: _bpSelectedFile.type };
        if (_bpCropSpec) {
          branchImgPayload.crop_spec = _bpCropSpec;
        }

        var imgRes = await CatalogClient.uploadBranchProductImage(currentManagingBranchId, _overrideProductId, branchImgPayload);
        var imgData = {};
        try {
          imgData = await imgRes.json();
        } catch (_) {
          imgData = { success: false, error: 'Respon server tidak valid saat mengunggah gambar.' };
        }
        if (!imgRes.ok || !imgData.success) {
          showToast('❌ ' + (imgData.error || imgData.message || 'Gagal mengunggah gambar.'));
          return;
        }
      }

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
    if (!confirm('Kembalikan semua nilai ke Master? Nama, deskripsi, foto, harga, dan kategori dikembalikan ke pengaturan asal produk Master.')) return;
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
    var name = prompt('Nama Kategori Baru untuk Cabang ini:');
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
    if (resolvedBranchId) {
      currentManagingBranchId = resolvedBranchId;
    }

    $('adopt-product-id').value = p.id;
    $('adopt-product-name').value = p.name;
    $('adopt-pricing-mode').value = p.pricing_mode || 'lock';
    $('adopt-min-price').value = p.min_price || p.price;
    $('adopt-max-price').value = p.max_price || p.price;

    var isRange = p.pricing_mode === 'range';
    var priceInput = $('adopt-price');
    var priceHint = $('adopt-price-hint');

    if (isRange) {
      priceInput.readOnly = false;
      priceInput.value = p.price;
      priceInput.min = p.min_price;
      priceInput.max = p.max_price;
      priceHint.innerHTML = '💡 <strong>Range Harga Fleksibel:</strong> Cabang diizinkan menentukan harga antara <strong>' + formatMoney(p.min_price) + '</strong> s/d <strong>' + formatMoney(p.max_price) + '</strong>.';
    } else {
      priceInput.readOnly = true;
      priceInput.value = p.price;
      priceHint.innerHTML = '🔒 <strong>Harga Terkunci:</strong> Ditetapkan paten oleh Pemilik Resto (Owner) sebesar <strong>' + formatMoney(p.price) + '</strong>.';
    }

    // Populate branch categories
    var catSelect = $('adopt-branch-category');
    var cats = currentBranchCatalogData.categories || [];
    var catOptions = cats.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
    });
    catOptions.unshift('<option value="">(Otomatis sesuaikan kategori produk)</option>');
    catSelect.innerHTML = catOptions.join('');

    $('modal-adopt-product').style.display = 'flex';
  };

  window.closeAdoptModal = function () {
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
      var priceVal = Number($('adopt-price').value);

      try {
        var res = await CatalogClient.adoptProduct(currentManagingBranchId, {
            product_id: prodId,
            branch_category_id: catId || undefined,
            price: priceVal
          });
        var data = await res.json();
        if (data.success) {
          showToast('✅ Menu berhasil diadopsi ke cabang!');
          window.closeAdoptModal();
          // Refresh the correct panel depending on role/view
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
