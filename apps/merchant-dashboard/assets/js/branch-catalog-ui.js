/**
 * XENTRA CORE — OWNER BRANCH CATALOG UI
 *
 * Owner-only catalog management UI. Data/transport operations are delegated to
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

  function getActiveBranchId() {
    if (currentManagingBranchId) return currentManagingBranchId;
    if (currentBranchCatalogData && currentBranchCatalogData.branch && currentBranchCatalogData.branch.id) {
      return currentBranchCatalogData.branch.id;
    }
    return null;
  }

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
      var res = await CatalogClient.request( '/admin/branches/' + currentManagingBranchId + '/catalog', {
              });
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
      var res = await CatalogClient.request( '/admin/branches/' + currentManagingBranchId + '/products/' + productId, {
        method: 'PATCH',
                body: JSON.stringify({ is_available: nextAvail })
      });
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
      var res = await CatalogClient.request( '/admin/branches/' + currentManagingBranchId + '/products/' + productId, {
        method: 'DELETE',
              });
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
                body: JSON.stringify({ name: name.trim() })
      });
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
        var res = await CatalogClient.request( '/admin/branches/' + currentManagingBranchId + '/adopt', {
          method: 'POST',
                    body: JSON.stringify({
            product_id: prodId,
            branch_category_id: catId || undefined,
            price: priceVal
          })
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
  window.XentraOwnerBranchCatalog = {
    state: {
      get branchId() { return currentManagingBranchId; },
      set branchId(v) { currentManagingBranchId = v; },
      get catalogData() { return currentBranchCatalogData; },
      set catalogData(v) { currentBranchCatalogData = v; }
    },
    getActiveBranchId: getActiveBranchId,
    setHooks: function (h) {
      if (!h) return;
      Object.keys(h).forEach(function (k) { if (Object.prototype.hasOwnProperty.call(hooks, k)) hooks[k] = h[k]; });
    }
  };
})();
