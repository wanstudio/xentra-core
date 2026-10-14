/**
 * XENTRA OWNER DASHBOARD — CATALOG MASTER REFERENCE MODULE
 * Handles Categories, Flavors, Titles, Items list, Complements, Levels,
 * Master Category Editor & Image Crop, and Master Reference Quick-Add.
 */
(function (window, document) {
  'use strict';

  var S = window.XentraShared || {};
  var $ = S.$ || function (id) { return document.getElementById(id); };
  var esc = S.esc || function (t) { return t || ''; };
  var formatMoney = S.formatMoney || function (v) { return 'Rp ' + Number(v || 0).toLocaleString('id-ID'); };
  var showToast = S.showToast || function (m) { alert(m); };
  var API_BASE = S.API_BASE || '/api/v1';

  function adminFetch(url, options) {
    if (typeof window.adminFetch === 'function') return window.adminFetch(url, options);
    return fetch(url, options);
  }

  function getAuthHeaders(extraHeaders) {
    var headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    var token = localStorage.getItem(S.TOKEN_KEY || 'xentra_merchant_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
  }

  function navigateTo(route, options) {
    if (typeof window.navigateTo === 'function') return window.navigateTo(route, options);
    window.location.hash = '#' + route;
  }

  function goBackFromItemEditor() {
    if (typeof window.goBackFromItemEditor === 'function') return window.goBackFromItemEditor();
    if (typeof window.goBackFromChildPage === 'function') return window.goBackFromChildPage();
    if (window.history.length > 1) window.history.back();
  }

  function populateProductCategorySelect() {
    if (typeof window.populateProductCategorySelect === 'function') window.populateProductCategorySelect();
  }

  function renderProductCategoryFilterChips() {
    if (typeof window.renderProductCategoryFilterChips === 'function') window.renderProductCategoryFilterChips();
  }

  function renderMasterProductsTable() {
    if (typeof window.renderMasterProductsTable === 'function') window.renderMasterProductsTable();
  }

  function loadMasterProducts() {
    if (typeof window.loadMasterProducts === 'function') return window.loadMasterProducts();
    return Promise.resolve();
  }

  function openEditProduct(id) {
    if (typeof window.openEditProduct === 'function') return window.openEditProduct(id);
  }

  function closeMasterCategoryModal() {
    var modal = $('modal-master-category');
    if (modal) modal.style.display = 'none';
  }
  window.closeMasterCategoryModal = closeMasterCategoryModal;

  var state = window.state || { products: [], categories: [], branches: [] };
  window.state = state;

  var _ownerMasterMenuState = window._ownerMasterMenuState || { menus: [] };
  window._ownerMasterMenuState = _ownerMasterMenuState;

  var _masterReferenceTab = 'category';
  // Prevent stale/overlapping catalog-reference requests from overwriting newer data.
  var _masterReferenceLoadSeq = 0;

  var _masterMenuComponents = window._masterMenuComponents || {
    title: [],
    flavor: [],
    complement: [],
    level: []
  };
  window._masterMenuComponents = _masterMenuComponents;

  function showCategoryEditorSection() {
    var page = $('master-categories-page');
    var catEditor = $('category-editor-view');
    var productList = $('product-list-view');
    var productDetail = $('product-detail-view');
    if (page) page.style.display = 'none';
    if (catEditor) catEditor.style.display = 'block';
    if (productList) productList.style.display = 'none';
    if (productDetail) productDetail.style.display = 'none';
  }

  function showMasterCategoriesPage() {
    var page = $('master-categories-page');
    var catEditor = $('category-editor-view');
    var productList = $('product-list-view');
    var productDetail = $('product-detail-view');
    var productEditor = $('product-editor-view');
    if (page) page.style.display = 'block';
    if (catEditor) catEditor.style.display = 'none';
    if (productList) productList.style.display = 'none';
    if (productDetail) productDetail.style.display = 'none';
    if (productEditor) productEditor.style.display = 'none';
  }

  function setMasterReferenceTab(type) {
    var allowed = ['category', 'title', 'flavor', 'item'];
    _masterReferenceTab = allowed.indexOf(type) !== -1 ? type : 'category';

    var panels = {
      category: $('master-reference-category-panel'),
      flavor: $('master-reference-flavor-panel'),
      complement: $('master-reference-complement-panel'),
      title: $('master-reference-title-panel'),
      item: $('master-reference-item-panel'),
    };
    Object.keys(panels).forEach(function(key) {
      if (panels[key]) panels[key].hidden = _masterReferenceTab !== key;
    });

    var tabs = $('master-reference-tabs');
    if (tabs) {
      tabs.querySelectorAll('[data-master-reference-tab]').forEach(function(btn) {
        var active = btn.getAttribute('data-master-reference-tab') === _masterReferenceTab;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }

    if (_masterReferenceTab === 'item') {
      renderMasterItemsList();
      if (!(state.products || []).length) loadMasterProducts().then(renderMasterItemsList);
    } else {
      renderMasterReferenceList(_masterReferenceTab);
    }
  }

  async function loadMasterCategoriesPage() {
    var listEls = {
      category: $('master-categories-page-list'),
      flavor: $('master-flavors-page-list'),
      complement: $('master-complements-page-list'),
      title: $('master-titles-page-list'),
    };
    var requestSeq = ++_masterReferenceLoadSeq;

    Object.keys(listEls).forEach(function(type) {
      if (listEls[type]) {
        listEls[type].innerHTML = '<div class="x-empty-state text-center py-6 text-muted">Memuat ' + (MASTER_REFERENCE_META[type] ? MASTER_REFERENCE_META[type].label.replace('Nama ', '').toLowerCase() : 'data') + '...</div>';
      }
    });

    var headers = getAuthHeaders();
    var menusPromise = adminFetch(API_BASE + '/admin/menus', { headers: headers })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.success) {
          _ownerMasterMenuState.menus = data.menus || [];
        }
      })
      .catch(function(err) {
        console.warn('[Master Category Menus Load Warn]:', err);
      });

    var categoryPromise = adminFetch(API_BASE + '/admin/categories', { headers: headers })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (requestSeq !== _masterReferenceLoadSeq) return;
        if (!data.success) throw new Error(data.error || 'Gagal memuat kategori.');
        state.categories = data.categories || [];
        renderMasterCategoriesPage();
      })
      .catch(function(err) {
        if (requestSeq !== _masterReferenceLoadSeq) return;
        console.error('[Master Category Load Error]:', err);
        if (listEls.category) listEls.category.innerHTML = '<div class="x-empty-state text-center py-8 text-muted">Gagal memuat kategori. Coba lagi.</div>';
      });

    var titlePromise = adminFetch(API_BASE + '/admin/menu-titles', { headers: headers })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (requestSeq !== _masterReferenceLoadSeq) return;
        if (!data.success) throw new Error(data.error || 'Gagal memuat judul.');
        _masterMenuComponents.title = data.titles || [];
        renderMasterReferenceList('title');
      })
      .catch(function(err) {
        if (requestSeq !== _masterReferenceLoadSeq) return;
        console.error('[Master Judul Load Error]:', err);
        if (listEls.title) listEls.title.innerHTML = '<div class="x-empty-state text-center py-8 text-muted">Gagal memuat judul. Coba lagi.</div>';
      });

    var componentPromises = ['flavor', 'complement', 'level'].map(function(type) {
      var loadPromise = type === 'level'
        ? adminFetch(API_BASE + '/admin/menu/components/level/ensure-defaults', {
            method: 'POST',
            headers: headers
          }).then(function(res) {
            return res.json().then(function(data) {
              if (!res.ok || !data.success) throw new Error(data.error || 'Gagal menyiapkan Level.');
              return data;
            });
          })
        : Promise.resolve(null);

      return loadPromise
        .then(function() {
          return adminFetch(API_BASE + '/admin/menu/components/' + type, { headers: headers })
            .then(function(res) { return res.json(); });
        })
        .then(function(data) {
          if (requestSeq !== _masterReferenceLoadSeq) return;
          if (!data.success) throw new Error(data.error || 'Gagal memuat ' + type + '.');
          _masterMenuComponents[type] = data.components || [];
          renderMasterReferenceList(type);
          if (type === 'flavor') renderMasterFlavorsPage();
        })
        .catch(function(err) {
          if (requestSeq !== _masterReferenceLoadSeq) return;
          console.error('[Master ' + type + ' Load Error]:', err);
          if (listEls[type]) listEls[type].innerHTML = '<div class="x-empty-state text-center py-8 text-muted">Gagal memuat data. Coba lagi.</div>';
        });
    });

    await Promise.allSettled([menusPromise, categoryPromise, titlePromise].concat(componentPromises));

    if (requestSeq === _masterReferenceLoadSeq) {
      populateProductCategorySelect();
      renderMasterReferenceList(_masterReferenceTab);
      renderMasterMenuSelectors();
      renderMasterMenuCustomerPreview();
      setMasterReferenceTab(_masterReferenceTab);
    }
  }
  function referenceStatusBadge(active) {
    return '<span class="x-master-reference-status ' + (active ? 'is-active' : 'is-inactive') + '">' +
      (active ? 'Aktif' : 'Nonaktif') + '</span>';
  }

  function referenceRows(type) {
    if (type === 'category') return state.categories || [];
    if (type === 'item') return state.products || [];
    return _masterMenuComponents[type] || [];
  }

  function referenceTypeLabel(type) {
    if (type === 'title') return 'Judul';
    if (type === 'item') return 'Item';
    return type === 'category' ? 'Kategori' : type === 'flavor' ? 'Rasa' : type === 'complement' ? 'Kelengkapan' : 'Level';
  }

  // ── Tab Item: unit internal + pengelolaan stok berbasis SKU ────────────────
  // Item memakai satu komponen kartu yang sama dengan tab lain (x-master-reference-card).
  // SKU adalah identitas stok: checkbox "Kelola stok (pakai SKU)" membuka input SKU,
  // dan mematikannya = mengosongkan SKU — operasi yang dijaga server
  // (PRODUCT_SKU_REMOVAL_BLOCKED_STOCK: stok harus nol dulu di semua cabang).

  function renderMasterItemsList() {
    var list = $('master-items-page-list');
    if (!list) return;

    var rows = state.products || [];
    if (!rows.length) {
      list.innerHTML = '<div class="x-empty-state text-center py-6 text-muted">Belum ada item.</div>';
      return;
    }

    list.innerHTML = rows.map(function(item) {
      var sku = item.sku == null ? '' : String(item.sku).trim();
      var hasSku = !!sku;
      var isActive = item.is_active !== 0 && item.is_active !== null;
      var id = esc(String(item.id));
      var img = item.image_url || item.image || '';
      var costPrice = Number(item.cost_price || 0);

      var iconOrPhotoHtml = img
        ? '<div class="x-master-reference-icon" aria-hidden="true" style="background:#f1f5f9;"><img src="' + esc(img) + '" alt="' + esc(item.name) + '" loading="lazy"></div>'
        : '<div class="x-master-reference-icon x-master-reference-icon-category" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 7h16"></path><path d="M4 12h16"></path><path d="M4 17h10"></path></svg></div>';

      return [
        '<div class="x-master-reference-card x-master-item-card-clickable" tabindex="0" role="button" aria-label="Buka editor item ' + esc(item.name) + '" onclick="if (!event.target.closest(\'.x-toggle, .x-action-menu-trigger, .x-action-menu\')) { openEditProduct(\'' + id + '\'); }" onkeydown="if ((event.key === \'Enter\' || event.key === \' \') && !event.target.closest(\'.x-toggle, .x-action-menu-trigger, .x-action-menu\')) { event.preventDefault(); openEditProduct(\'' + id + '\'); }">',
            '<div class="x-master-reference-card-main">',
              iconOrPhotoHtml,
              '<div class="x-master-reference-copy">',
                '<strong>' + esc(item.name) + '</strong>',
                '<span>' + (hasSku ? esc(sku) : 'non-SKU') + '</span>',
                '<span style="font-size:12px;font-weight:600;color:#0f172a;">' + formatMoney(costPrice) + '</span>',
              '</div>',
            '</div>',
            '<div class="x-master-reference-card-right" style="display:flex;align-items:center;gap:10px;">',
              '<label class="x-toggle' + (isActive ? ' x-toggle-on' : '') + '" title="' + (isActive ? 'Item aktif (klik untuk nonaktifkan)' : 'Item nonaktif (klik untuk aktifkan)') + '" style="margin:0;">',
                '<input type="checkbox" ' + (isActive ? 'checked' : '') + ' onchange="toggleMasterItemActive(\'' + id + '\', this)" aria-label="Status item ' + esc(item.name) + '">',
                '<span class="x-toggle-slider"></span>',
              '</label>',
              '<button type="button" class="x-action-menu-trigger" aria-label="Aksi item ' + esc(item.name) + '" data-master-reference-action="item" data-reference-id="' + id + '">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>' +
              '</button>',
            '</div>',
          '</div>'
      ].join('');
    }).join('');
  }

  // Toggle kartu Item = aktif/nonaktif item (bukan pengelolaan stok). Dipakai untuk
  // menghentikan sementara item yang tidak boleh dijual, dan bisa dinyalakan kembali.
  window.toggleMasterItemActive = async function(productId, inputEl) {
    var nextActive = inputEl && inputEl.checked ? 1 : 0;
    try {
      var res = await adminFetch(API_BASE + '/admin/composed/products/' + encodeURIComponent(productId) + '/status', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: nextActive })
      });
      var data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || data.error || 'Gagal mengubah status item.');

      var rows = state.products || [];
      var index = rows.findIndex(function (item) { return String(item.id) === String(productId); });
      if (index >= 0) { rows[index] = Object.assign({}, rows[index], { is_active: nextActive }); state.products = rows; }

      renderMasterItemsList();
      showToast('✅ Item ' + (nextActive ? 'diaktifkan' : 'dinonaktifkan') + '.');
    } catch (err) {
      renderMasterItemsList();
      showToast('❌ ' + err.message);
    }
  };

  function referenceIconClass(type) {
    return (type === 'category' || type === 'title')
      ? 'x-master-reference-icon-category'
      : type === 'flavor'
        ? 'x-master-reference-icon-flavor'
        : type === 'complement'
          ? 'x-master-reference-icon-complement'
          : 'x-master-reference-icon-level';
  }

  function referenceIconSvg(type) {
    if (type === 'title') return '<path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h9"></path>';
    if (type === 'category') return '<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect>';
    if (type === 'flavor') return '<path d="M5 12h14"></path><path d="M12 5v14"></path><circle cx="12" cy="12" r="9"></circle>';
    if (type === 'complement') return '<path d="M4 7h16"></path><path d="M6 7v12"></path><path d="M18 7v12"></path><path d="M3 19h18"></path><path d="M9 7V4h6v3"></path>';
    return '<path d="M7 4h10"></path><path d="M7 20h10"></path><path d="M9 4v16"></path><path d="M15 4v16"></path><path d="M7 8h8"></path><path d="M7 16h8"></path>';
  }

  function renderMasterReferenceList(type) {
    var listMap = {
      category: 'master-categories-page-list',
      flavor: 'master-flavors-page-list',
      complement: 'master-complements-page-list',
      title: 'master-titles-page-list',
      level: 'master-levels-page-list'
    };
    var list = $(listMap[type]);
    if (!list) return;

    var rows = referenceRows(type);
    if (!rows.length) {
      list.innerHTML = '<div class="x-empty-state text-center py-8 text-muted">Belum ada ' + referenceTypeLabel(type).toLowerCase() + '. Tambahkan data pertama.</div>';
      return;
    }

    list.innerHTML = rows.map(function(row) {
      var description = '';
      if (type === 'category') {
        var catMenus = (_ownerMasterMenuState.menus || []).filter(function(m) {
          return String(m.category_id || (m.category && m.category.id) || '') === String(row.id);
        });
        if (catMenus.length) {
          var menuTitles = catMenus.map(function(m) { return ownerMasterMenuTitle(m); });
          description = '<span class="x-master-category-menu-list" title="' + esc(menuTitles.join(', ')) + '">' + esc(menuTitles.join(', ')) + '</span>';
        } else {
          description = '<span class="x-master-category-menu-list text-muted">Belum ada menu</span>';
        }
      } else if (type === 'title') {
        description = 'Judul Menu di Customer PWA · wajib dipilih tiap Menu';
      } else if (type === 'flavor') {
        description = 'Dipakai sebagai pilihan Rasa pada Item';
      } else if (type === 'complement') {
        description = 'Detail Customer · bisa dipilih lebih dari satu';
      } else {
        description = 'Indikator Customer · satu per Produk Master';
      }

      var rightControls = '';
      var isRowActive = row.is_active !== 0 && row.is_active !== null;
      var typeNoun = referenceTypeLabel(type);
      var toggleSwitch = '' +
        '<label class="x-toggle' + (isRowActive ? ' x-toggle-on' : '') + '" title="' + (isRowActive ? typeNoun + ' Aktif (klik untuk nonaktifkan)' : typeNoun + ' Nonaktif (klik untuk aktifkan)') + '" style="margin:0;">' +
          '<input type="checkbox" ' + (isRowActive ? 'checked' : '') + ' onchange="toggleMasterReferenceStatus(\'' + esc(String(type)) + '\', \'' + esc(String(row.id)) + '\', this)" aria-label="Status ' + typeNoun + ' ' + esc(row.name) + '">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      var actionMenuBtn = '' +
        '<button type="button" class="x-action-menu-trigger" aria-label="Aksi ' + typeNoun.toLowerCase() + '" data-master-reference-action="' + esc(String(type)) + '" data-reference-id="' + esc(String(row.id)) + '">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>' +
        '</button>';

      rightControls = toggleSwitch + actionMenuBtn;

      var iconHtml = '';
      if (type === 'category' && (row.image_url || row.image)) {
        var catImg = row.image_url || row.image;
        iconHtml = '<div class="x-master-reference-icon" aria-hidden="true" style="background:#f1f5f9;"><img src="' + esc(catImg) + '" alt="' + esc(row.name) + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;"></div>';
      } else {
        iconHtml = '<div class="x-master-reference-icon ' + referenceIconClass(type) + '" aria-hidden="true">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">' + referenceIconSvg(type) + '</svg>' +
        '</div>';
      }

      var cardClickableAttr = '';
      var cardExtraClass = '';
      if (type === 'category') {
        cardExtraClass = ' x-master-item-card-clickable';
        cardClickableAttr = ' tabindex="0" role="button" aria-label="Buka editor kategori ' + esc(row.name) + '" onclick="if (!event.target.closest(\'.x-toggle, .x-action-menu-trigger, .x-action-menu\')) { openEditCategory(\'' + esc(String(row.id)) + '\'); }" onkeydown="if ((event.key === \'Enter\' || event.key === \' \') && !event.target.closest(\'.x-toggle, .x-action-menu-trigger, .x-action-menu\')) { event.preventDefault(); openEditCategory(\'' + esc(String(row.id)) + '\'); }"';
      }

      return [
        '<div class="x-master-reference-card' + cardExtraClass + '"' + cardClickableAttr + '>',
          '<div class="x-master-reference-card-main">',
            iconHtml,
            '<div class="x-master-reference-copy">',
              '<strong>' + esc(row.name) + '</strong>' + (isRowActive ? '' : ' ' + referenceStatusBadge(false)),
              (type === 'category' ? description : '<span>' + esc(description) + '</span>'),
            '</div>',
          '</div>',
          '<div class="x-master-reference-card-right" style="display:flex;align-items:center;gap:10px;">',
            rightControls,
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function renderMasterCategoriesPage() {
    renderMasterReferenceList('category');
  }

  function renderMasterFlavorsPage() {
    renderMasterReferenceList('flavor');
  }
  function openEditMasterReference(type, id) {
    var meta = MASTER_REFERENCE_META[type];
    var content = $('master-reference-editor');
    if (!meta || !content || !window.XentraPresentation) return;

    var row = referenceRows(type).find(function(item) { return String(item.id) === String(id); });
    if (!row) return;

    $('master-reference-quick-add-type').value = type;
    $('master-reference-quick-add-id').value = String(id);
    $('master-reference-quick-add-title').textContent = 'Ubah ' + referenceTypeLabel(type);
    $('master-reference-quick-add-label').textContent = meta.label;
    $('master-reference-quick-add-name').value = row.name || '';
    $('master-reference-quick-add-name').placeholder = meta.placeholder;
    window.XentraPresentation.open({
      id: 'master-reference-quick-add',
      type: 'bottom-sheet',
      content: content,
      onOpen: function () {
        setTimeout(function() {
          var input = $('master-reference-quick-add-name');
          if (input) {
            input.focus();
            input.select();
          }
        }, 0);
      }
    });
  }
  window.openEditMasterReference = openEditMasterReference;

  // ── Category Editor (Page View) ──────────────────────────────────────────
  var _categoryImageFile = null;
  var _categoryCropSpec = null;
  var _categoryImageRemoved = false;
  var _categoryEditorLoadSeq = 0;

  function setCategoryImagePreview(src, hasImage) {
    var previewImg = $('cat-image-preview');
    var emptyBox = $('cat-image-empty');
    var btnRemove = $('btn-cat-image-remove');
    var btnPick = $('btn-cat-image-pick');
    if (!previewImg || !emptyBox) return;
    if (hasImage && src) {
      previewImg.src = src;
      previewImg.style.display = 'block';
      emptyBox.style.display = 'none';
      if (btnRemove) btnRemove.style.display = 'inline-block';
      if (btnPick) btnPick.textContent = '📁 Ganti Foto';
    } else {
      previewImg.removeAttribute('src');
      previewImg.style.display = 'none';
      emptyBox.style.display = 'flex';
      if (btnRemove) btnRemove.style.display = 'none';
      if (btnPick) btnPick.textContent = '📁 Pilih Foto';
    }
  }

  function resetCategoryEditorForAdd() {
    $('category-editor-breadcrumb').textContent = 'Tambah Kategori';
    if ($('category-editor-mobile-title')) $('category-editor-mobile-title').textContent = 'Tambah Kategori';
    if ($('category-editor-mobile-subtitle')) $('category-editor-mobile-subtitle').textContent = 'Pengelompokan utama menu komersial di storefront.';
    $('cat-id').value = '';
    $('cat-name').value = '';
    $('cat-desc').value = '';
    $('cat-image-removed').value = '0';
    _categoryImageFile = null;
    _categoryCropSpec = null;
    _categoryImageRemoved = false;
    var fileInput = $('cat-image-file');
    if (fileInput) fileInput.value = '';
    setCategoryImagePreview('', false);

    var menusContainer = $('cat-menus-container');
    if (menusContainer) {
      menusContainer.innerHTML = '<div class="text-muted" style="font-size:13px;padding:8px 0;">Kategori baru belum memiliki menu. Menu dapat ditambahkan melalui Menu Master setelah kategori disimpan.</div>';
    }
  }

  function populateCategoryEditorForm(category) {
    var catName = category.name || '';
    $('category-editor-breadcrumb').textContent = 'Edit Kategori: ' + catName;
    if ($('category-editor-mobile-title')) $('category-editor-mobile-title').textContent = 'Edit Kategori';
    if ($('category-editor-mobile-subtitle')) $('category-editor-mobile-subtitle').textContent = 'Perbarui Foto, Nama Kategori, Menu, dan Catatan.';
    $('cat-id').value = String(category.id || '');
    $('cat-name').value = catName;
    $('cat-desc').value = category.description || '';
    $('cat-image-removed').value = '0';
    _categoryImageFile = null;
    _categoryCropSpec = null;
    _categoryImageRemoved = false;
    var fileInput = $('cat-image-file');
    if (fileInput) fileInput.value = '';
    var existingImage = category.image_url || category.image || '';
    setCategoryImagePreview(existingImage, existingImage !== '');

    renderCategoryMenusList(category.id);
  }

  function renderCategoryMenusList(categoryId) {
    var container = $('cat-menus-container');
    if (!container) return;

    var menus = (_ownerMasterMenuState.menus || []).filter(function(m) {
      return String(m.category_id || (m.category && m.category.id) || '') === String(categoryId);
    });

    if (!menus.length) {
      container.innerHTML = '<div class="text-muted" style="font-size:13px;padding:8px 0;">Belum ada menu dalam kategori ini.</div>';
      return;
    }

    container.innerHTML = menus.map(function(m, idx) {
      var menuTitle = ownerMasterMenuTitle(m);
      var menuId = esc(String(m.id));
      return [
        '<div class="x-cat-menu-card">',
          '<div class="x-cat-menu-card-info">',
            '<span class="x-cat-menu-card-label">Menu ' + (idx + 1) + '</span>',
            '<span class="x-cat-menu-card-name" title="' + esc(menuTitle) + '">' + esc(menuTitle) + '</span>',
          '</div>',
          '<button type="button" class="x-cat-menu-card-delete" aria-label="Hapus ' + esc(menuTitle) + ' dari kategori" onclick="deleteMenuFromCategory(\'' + menuId + '\', \'' + esc(menuTitle).replace(/'/g, "\\'") + '\', \'' + esc(String(categoryId)) + '\')">',
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>',
          '</button>',
        '</div>'
      ].join('');
    }).join('');
  }

  window.deleteMenuFromCategory = async function(menuId, menuTitle, categoryId) {
    var confirmed = false;
    var message = 'Hapus "' + menuTitle + '" dari daftar menu? Tindakan ini tidak dapat dibatalkan.';
    if (window.XentraPresentation && typeof window.XentraPresentation.confirm === 'function') {
      confirmed = await window.XentraPresentation.confirm({
        id: 'delete-cat-menu',
        title: 'Hapus Menu dari Kategori',
        message: message,
        okLabel: 'Hapus',
        cancelLabel: 'Batal'
      });
    } else {
      confirmed = window.confirm(message);
    }
    if (!confirmed) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/menus/' + encodeURIComponent(menuId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Gagal menghapus menu.');

      showToast('✅ Menu "' + menuTitle + '" berhasil dihapus.');

      var menusRes = await adminFetch(API_BASE + '/admin/menus', { headers: getAuthHeaders() });
      var menusData = await menusRes.json();
      if (menusData.success) {
        _ownerMasterMenuState.menus = menusData.menus || [];
      }
      renderCategoryMenusList(categoryId);
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal menghapus menu.'));
    }
  };

  async function loadCategoryEditorPage(categoryId) {
    var requestSeq = ++_categoryEditorLoadSeq;
    showCategoryEditorSection();

    if (!categoryId) {
      resetCategoryEditorForAdd();
      return;
    }

    var existing = (state.categories || []).find(function(c) { return String(c.id) === String(categoryId); });
    if (existing) {
      populateCategoryEditorForm(existing);
    } else {
      resetCategoryEditorForAdd();
    }

    try {
      var headers = getAuthHeaders();
      var [catRes, menusRes] = await Promise.all([
        adminFetch(API_BASE + '/admin/categories', { headers: headers }),
        adminFetch(API_BASE + '/admin/menus', { headers: headers })
      ]);
      var catData = await catRes.json();
      var menusData = await menusRes.json();

      if (requestSeq !== _categoryEditorLoadSeq) return;

      if (menusData.success) {
        _ownerMasterMenuState.menus = menusData.menus || [];
      }
      if (catData.success) {
        state.categories = catData.categories || [];
        var found = (state.categories || []).find(function(c) { return String(c.id) === String(categoryId); });
        if (found) {
          populateCategoryEditorForm(found);
        }
      }
    } catch (err) {
      console.warn('[Category Editor Fetch Warn]:', err);
    }
  }

  function openNewCategory() {
    navigateTo('catalog/categories/new');
  }
  window.openNewCategory = openNewCategory;

  function openEditCategory(id) {
    if (!id) return;
    navigateTo('catalog/categories/' + encodeURIComponent(id) + '/edit');
  }
  window.openEditCategory = openEditCategory;

  async function deleteMasterReference(type, id) {
    var meta = MASTER_REFERENCE_META[type];
    if (!meta) return;

    var row = referenceRows(type).find(function(item) { return String(item.id) === String(id); });
    if (!row) return;

    var noun = referenceTypeLabel(type).toLowerCase();
    var actionLabel = 'Hapus Permanen';
    var actionMessage = (type === 'item')
      ? 'Hapus permanen Item "' + row.name + '"?\n\nTindakan ini TIDAK dapat dibatalkan. Jika item ini masih digunakan sebagai komponen di Menu komersial, penghapusan akan dicegah.'
      : ('Hapus permanen ' + noun + ' "' + row.name + '"? ' +
        'Tindakan ini TIDAK dapat dibatalkan. ' +
        noun.charAt(0).toUpperCase() + noun.slice(1) + ' yang masih dipakai Produk atau Menu akan ditolak — matikan toggle untuk menonaktifkannya.');
    if (window.XentraPresentation && !await window.XentraPresentation.confirm({
      id: 'delete-master-reference',
      title: actionLabel + ' ' + referenceTypeLabel(type),
      message: actionMessage,
      okLabel: actionLabel,
      cancelLabel: 'Batal'
    })) return;

    try {
      var endpoint = meta.deleteEndpoint ? meta.deleteEndpoint(String(id)) : (API_BASE + '/admin/' + type + 's/' + encodeURIComponent(id));
      var res = await adminFetch(endpoint, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (!res.ok || !data.success) {
        var code = data.error || '';
        if (code === 'PRODUCT_IN_USE_BY_MENU') {
          if (window.XentraPresentation && window.XentraPresentation.confirm) {
            await window.XentraPresentation.confirm({
              id: 'item-in-use-warning',
              title: '⚠️ Item Masih Digunakan',
              message: data.message || 'Item ini masih dipakai oleh Menu, jadi tidak dapat dihapus.',
              okLabel: 'Mengerti',
              cancelLabel: ''
            });
            return;
          }
          throw new Error(data.message || 'Item ini masih dipakai oleh Menu, jadi tidak dihapus. Ubah komposisi Menu atau matikan toggle untuk menonaktifkannya.');
        }
        if (code === 'TITLE_IN_USE_BY_MENUS') {
          var used = (data.details && data.details.used_by_menu_count) || (data.message || '').match(/\d+/);
          throw new Error('Judul ini masih dipakai ' + (used || 'beberapa') + ' Menu, jadi tidak dihapus. Matikan toggle untuk menonaktifkannya.');
        }
        if (code === 'PRODUCT_MENU_USAGE_BLOCKED') {
          throw new Error('Data ini masih dipakai Produk atau Menu, jadi tidak dihapus. Matikan toggle untuk menonaktifkannya.');
        }
        throw new Error(data.message || data.error || ('Gagal menghapus ' + noun + '.'));
      }

      if (type === 'category') {
        state.categories = (state.categories || []).filter(function(item) { return String(item.id) !== String(id); });
        populateProductCategorySelect();
        renderProductCategoryFilterChips();
        renderMasterProductsTable();
      } else if (type === 'item') {
        state.products = (state.products || []).filter(function(item) { return String(item.id) !== String(id); });
        renderMasterItemsList();
        renderMasterProductsTable();
      } else {
        _masterMenuComponents[type] = (_masterMenuComponents[type] || []).filter(function(item) { return String(item.id) !== String(id); });
        renderMasterMenuSelectors();
      }

      if (type !== 'item') renderMasterReferenceList(type);
      renderMasterMenuCustomerPreview();
      showToast(data.message || (referenceTypeLabel(type) + ' berhasil dihapus.'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
  window.deleteMasterReference = deleteMasterReference;

  async function toggleMasterReferenceStatus(type, id, inputEl) {
    if (!id || !type) return;
    var noun = referenceTypeLabel(type);
    var prevChecked = inputEl ? !inputEl.checked : null;
    try {
      if (inputEl) inputEl.disabled = true;
      var isTitle = type === 'title';
      var endpoint = type === 'category'
        ? API_BASE + '/admin/categories/' + encodeURIComponent(id) + '/toggle'
        : isTitle
          ? API_BASE + '/admin/menu-titles/' + encodeURIComponent(id)
          : API_BASE + '/admin/menu/components/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '/toggle';

      var res = await adminFetch(endpoint, isTitle ? {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: inputEl && inputEl.checked ? 1 : 0 })
      } : {
        method: 'PATCH',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal mengubah status ' + noun.toLowerCase() + '.');
      }

      if (type === 'category') {
        var updatedCategory = data.category;
        if (updatedCategory) {
          var categoryRows = state.categories || [];
          var idx = categoryRows.findIndex(function(c) { return String(c.id) === String(id); });
          if (idx >= 0) categoryRows[idx] = updatedCategory;
          state.categories = categoryRows;
        } else {
          var cat = (state.categories || []).find(function(c) { return String(c.id) === String(id); });
          if (cat) cat.is_active = inputEl.checked ? 1 : 0;
        }
        populateProductCategorySelect();
        renderProductCategoryFilterChips();
        renderMasterProductsTable();
      } else {
        var comp = (_masterMenuComponents[type] || []).find(function(c) { return String(c.id) === String(id); });
        if (comp) {
          comp.is_active = (data.component && typeof data.component.is_active !== 'undefined')
            ? data.component.is_active
            : (inputEl.checked ? 1 : 0);
        }
        renderMasterMenuSelectors();
      }

      renderMasterReferenceList(type);
      renderMasterMenuCustomerPreview();
      var activeText = inputEl.checked ? 'diaktifkan' : 'dinonaktifkan';
      showToast(data.message || (noun + ' berhasil ' + activeText + '.'), 'success');
    } catch (err) {
      if (inputEl && prevChecked !== null) {
        inputEl.checked = prevChecked;
        var parentLabel = inputEl.closest ? inputEl.closest('.x-toggle') : null;
        if (parentLabel) parentLabel.classList.toggle('x-toggle-on', prevChecked);
      }
      showToast(err.message, 'error');
    } finally {
      if (inputEl) inputEl.disabled = false;
    }
  }
  window.toggleMasterReferenceStatus = toggleMasterReferenceStatus;
  window.toggleCategoryStatus = function(id, inputEl) { return toggleMasterReferenceStatus('category', id, inputEl); };

  // ─────────────────────────────────────────────────────────────────────────
  // 2. MASTER REFERENCE QUICK-ADD (Product Assembly)
  // ─────────────────────────────────────────────────────────────────────────

  var MASTER_REFERENCE_META = {
    item: {
      title: 'Tambah Item',
      label: 'Nama Item',
      placeholder: 'Contoh: Ayam Goreng Potong',
      description: 'Unit fisik internal & stok',
      endpoint: function () { return API_BASE + '/admin/products'; },
      deleteEndpoint: function (id) { return API_BASE + '/admin/products/' + encodeURIComponent(id); },
      payload: function (name) { return { name: name }; }
    },
    category: {
      title: 'Tambah Kategori',
      label: 'Nama Kategori',
      placeholder: 'Contoh: Makanan Berat',
      description: 'Pengelompokan Item / Judul Menu',
      endpoint: function () { return API_BASE + '/admin/categories'; },
      deleteEndpoint: function (id) { return API_BASE + '/admin/categories/' + encodeURIComponent(id); },
      archiveEndpoint: function (id) { return API_BASE + '/admin/categories/' + encodeURIComponent(id) + '/archive'; },
      payload: function (name) { return { name: name }; }
    },
    title: {
      title: 'Tambah Judul',
      label: 'Nama Judul',
      placeholder: 'Contoh: Ayam Geprek',
      description: 'Judul Menu di Customer PWA; wajib dipilih tiap Menu',
      endpoint: function () { return API_BASE + '/admin/menu-titles'; },
      deleteEndpoint: function (id) { return API_BASE + '/admin/menu-titles/' + encodeURIComponent(id); },
      payload: function (name) { return { name: name }; }
    },
    flavor: {
      title: 'Tambah Rasa',
      label: 'Nama Rasa',
      placeholder: 'Contoh: Sambal Ijo',
      description: 'Pilihan Rasa untuk Subtitle Customer',
      endpoint: function () { return API_BASE + '/admin/menu/components/flavor'; },
      deleteEndpoint: function (id) { return API_BASE + '/admin/menu/components/flavor/' + encodeURIComponent(id); },
      payload: function (name) { return { name: name }; }
    },
    complement: {
      title: 'Tambah Kelengkapan',
      label: 'Nama Kelengkapan',
      placeholder: 'Contoh: Nasi',
      description: 'Detail Customer; dapat dipilih lebih dari satu pada Item',
      endpoint: function () { return API_BASE + '/admin/menu/components/complement'; },
      deleteEndpoint: function (id) { return API_BASE + '/admin/menu/components/complement/' + encodeURIComponent(id); },
      payload: function (name) { return { name: name }; }
    },
    level: {
      title: 'Tambah Level',
      label: 'Nama Level',
      placeholder: 'Contoh: 1 — Tidak Pedas',
      description: 'Indikator Customer; satu Level dipilih pada Item',
      endpoint: function () { return API_BASE + '/admin/menu/components/level'; },
      deleteEndpoint: function (id) { return API_BASE + '/admin/menu/components/level/' + encodeURIComponent(id); },
      payload: function (name) { return { name: name }; }
    }
  };

  function openMasterReferenceQuickAdd(type) {
    var meta = MASTER_REFERENCE_META[type];
    var content = $('master-reference-editor');
    if (!meta || !content || !window.XentraPresentation) return;

    $('master-reference-quick-add-type').value = type;
    $('master-reference-quick-add-id').value = '';
    $('master-reference-quick-add-title').textContent = meta.title;
    $('master-reference-quick-add-label').textContent = meta.label;
    $('master-reference-quick-add-name').value = '';
    $('master-reference-quick-add-name').placeholder = meta.placeholder;

    window.XentraPresentation.open({
      id: 'master-reference-quick-add',
      type: 'bottom-sheet',
      content: content,
      onOpen: function () {
        setTimeout(function () {
          var input = $('master-reference-quick-add-name');
          if (input) input.focus();
        }, 0);
      }
    });
  }
  window.openMasterReferenceQuickAdd = openMasterReferenceQuickAdd;

  function closeMasterReferenceQuickAdd() {
    if (window.XentraPresentation) {
      window.XentraPresentation.close('master-reference-quick-add');
    }
    var form = $('form-master-reference-quick-add');
    if (form) form.reset();
  }
  window.closeMasterReferenceQuickAdd = closeMasterReferenceQuickAdd;

  async function saveMasterReferenceQuickAdd() {
    var type = $('master-reference-quick-add-type').value;
    var referenceId = String($('master-reference-quick-add-id').value || '').trim();
    var nameInput = $('master-reference-quick-add-name');
    var meta = MASTER_REFERENCE_META[type];
    var name = nameInput ? String(nameInput.value || '').trim() : '';

    if (!meta || !name) return;

    var saveBtn = $('btn-save-master-reference-quick-add');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = referenceId ? 'Menyimpan...' : 'Menambahkan...';
    }

    try {
      var endpoint = referenceId
        ? meta.endpoint() + '/' + encodeURIComponent(referenceId)
        : meta.endpoint();

      var res = await adminFetch(endpoint, {
        method: referenceId ? 'PUT' : 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(meta.payload(name))
      });
      var data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menyimpan data master.');
      }

      var row = type === 'category' ? data.category : (type === 'title' ? data.title : data.component);
      if (!row) throw new Error('Server tidak mengembalikan hasil simpan.');

      var rows = referenceRows(type);
      var rowIndex = rows.findIndex(function(item) { return String(item.id) === String(row.id); });
      if (rowIndex >= 0) rows[rowIndex] = row;
      else rows.push(row);

      if (type === 'category') {
        populateProductCategorySelect();
        if (!referenceId) {
          var categorySelect = $('prod-category');
          if (categorySelect) categorySelect.value = row.id;
          var cmCategorySelect = $('cm-category');
          if (cmCategorySelect) {
            var opt = document.createElement('option');
            opt.value = row.id;
            opt.textContent = row.name;
            cmCategorySelect.appendChild(opt);
            cmCategorySelect.value = row.id;
            cmCategorySelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        renderProductCategoryFilterChips();
        renderMasterProductsTable();
      } else {
        if (!referenceId && type === 'complement') {
          var newComplementId = String(row.id);
          if (_masterMenuSelected.complement_ids.indexOf(newComplementId) === -1) {
            _masterMenuSelected.complement_ids.push(newComplementId);
          }
        }

        renderMasterMenuSelectors();

        if (!referenceId && type === 'flavor') {
          _masterMenuSelected.flavor_id = String(row.id);
          var flavorSelect = $('prod-flavor');
          if (flavorSelect) flavorSelect.value = String(row.id);
        }
      }

      closeMasterReferenceQuickAdd();
      renderMasterReferenceList(type);
      renderMasterMenuCustomerPreview();
      showToast('✅ ' + (referenceId ? referenceTypeLabel(type) + ' diperbarui.' : referenceTypeLabel(type) + ' ditambahkan.'));
    } catch (err) {
      showToast('❌ ' + err.message);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Simpan';
      }
    }
  }


  var _productOptionsDraft = [];

  var _masterMenuComponentType = 'flavor';
  var _masterMenuSelected = {
    flavor_id: '',
    complement_ids: [],
    level_id: ''
  };

  function masterMenuComponentTypeLabel(type) {
    return type === 'flavor' ? 'Rasa' : (type === 'complement' ? 'Kelengkapan' : 'Level');
  }

  async function loadMasterMenuComponents() {
    var headers = getAuthHeaders();
    var results = await Promise.all(['flavor', 'complement', 'level'].map(function(type) {
      var prepare = type === 'level'
        ? adminFetch(API_BASE + '/admin/menu/components/level/ensure-defaults', {
            method: 'POST',
            headers: headers
          }).then(function(res) {
            return res.json().then(function(data) {
              if (!res.ok || !data.success) throw new Error(data.error || 'Gagal menyiapkan Level.');
              return data;
            });
          })
        : Promise.resolve(null);

      return prepare
        .then(function() {
          return adminFetch(API_BASE + '/admin/menu/components/' + type, { headers: headers })
            .then(function(res) { return res.json(); });
        })
        .then(function(data) {
          if (!data.success) throw new Error(data.error || 'Gagal memuat ' + masterMenuComponentTypeLabel(type) + '.');
          return { type: type, rows: data.components || [] };
        })
        .catch(function(err) {
          console.warn('[Master Menu Components] gagal memuat ' + masterMenuComponentTypeLabel(type) + ':', err.message);
          return null;
        });
    }));

    results.forEach(function(result) {
      if (result) _masterMenuComponents[result.type] = result.rows;
    });

    renderMasterMenuSelectors();
    renderMasterMenuComponentManager();
    renderMasterMenuCustomerPreview();
    return results;
  }

  function renderMasterMenuCustomerPreview() {
    var titleEl = $('master-preview-title');
    var subtitleEl = $('master-preview-subtitle');
    var detailEl = $('master-preview-detail');
    var indicatorEl = $('master-preview-indicator');
    var priceEl = $('master-preview-price');
    var imageEl = $('master-preview-image');
    var emptyImageEl = $('master-preview-image-empty');
    if (!titleEl || !subtitleEl || !detailEl || !indicatorEl || !priceEl) return;

    var nameInput = $('prod-name');
    var productName = nameInput ? String(nameInput.value || '').trim() : '';
    var flavorSelect = $('prod-flavor');
    var levelSelect = $('prod-level');

    // Product Name is the Customer card title. Category remains grouping metadata.
    titleEl.textContent = productName || 'Masukkan Nama Produk';
    subtitleEl.textContent = '';
    detailEl.textContent = '';
    indicatorEl.textContent = '';

    var flavorId = flavorSelect ? String(flavorSelect.value || '') : String(_masterMenuSelected.flavor_id || '');
    var flavor = _masterMenuComponents.flavor.find(function(row) { return String(row.id) === flavorId; });
    if (flavor) subtitleEl.textContent = flavor.name;

    var selectedComplementIds = _masterMenuSelected.complement_ids || [];
    var complementNames = selectedComplementIds.map(function(id) {
      var row = _masterMenuComponents.complement.find(function(item) { return String(item.id) === String(id); });
      return row ? row.name : null;
    }).filter(Boolean);
    detailEl.textContent = complementNames.join(' · ');

    var levelId = levelSelect ? String(levelSelect.value || '') : String(_masterMenuSelected.level_id || '');
    var level = _masterMenuComponents.level.find(function(row) { return String(row.id) === levelId; });
    if (level) {
      var levelPosition = Number(level.sort_order);
      if (!Number.isFinite(levelPosition) || levelPosition < 1) levelPosition = 1;
      levelPosition = Math.min(4, levelPosition);
      var indicatorHtml = '<span class="x-master-customer-preview-spice-label">Pedas</span>' +
        '<span class="x-master-customer-preview-spice-dots" aria-label="Level Pedas ' + levelPosition + ' dari 4">';
      for (var i = 1; i <= 4; i += 1) {
        indicatorHtml += '<span class="x-master-customer-preview-spice-dot' + (i <= levelPosition ? ' is-filled' : '') + '" aria-hidden="true"></span>';
      }
      indicatorHtml += '</span>';
      indicatorEl.innerHTML = indicatorHtml;
    }

    var price = Number(($('prod-price') && $('prod-price').value) || 0);
    priceEl.textContent = formatMoney(price);

    var previewInput = $('prod-image-preview');
    var src = previewInput && previewInput.style.display !== 'none' ? previewInput.getAttribute('src') : '';
    if (imageEl && emptyImageEl) {
      if (src) {
        imageEl.src = src;
        imageEl.alt = productName || 'Foto Menu';
        imageEl.style.display = 'block';
        emptyImageEl.style.display = 'none';
      } else {
        imageEl.removeAttribute('src');
        imageEl.alt = '';
        imageEl.style.display = 'none';
        emptyImageEl.style.display = 'inline-flex';
      }
    }
  }

  function renderMasterLevelSelector(containerId, rows, selectedId) {
    var box = $(containerId);
    if (!box) return;

    var selected = selectedId == null ? '' : String(selectedId);
    var activeRows = (rows || []).filter(function(row) {
      return row && (row.is_active !== false && Number(row.is_active) !== 0 || String(row.id) === selected);
    });

    if (!activeRows.length) {
      box.innerHTML = '<span class="x-master-spice-level-label">Level Pedas</span><span class="x-master-spice-level-empty">Belum ada level</span>';
      return;
    }

    var selectedIndex = -1;
    activeRows.some(function(row, index) {
      if (String(row.id) === selected) {
        selectedIndex = index;
        return true;
      }
      return false;
    });

    var html = '<span class="x-master-spice-level-label">Level Pedas</span><span class="x-master-spice-level-segments" role="presentation">';
    activeRows.forEach(function(row, index) {
      var isFilled = selectedIndex >= 0 && index <= selectedIndex;
      html += '<button type="button" class="x-master-spice-level-segment' +
        (isFilled ? ' is-filled' : '') +
        '" data-master-level-id="' + esc(row.id) + '"' +
        ' aria-label="' + esc(row.name) + '"' +
        ' aria-pressed="' + (String(row.id) === selected ? 'true' : 'false') + '"' +
        ' title="' + esc(row.name) + '">' +
        '<span aria-hidden="true"></span>' +
      '</button>';
    });
    html += '</span>';

    box.innerHTML = html;

    box.querySelectorAll('[data-master-level-id]').forEach(function(button) {
      button.addEventListener('click', function() {
        var id = String(button.getAttribute('data-master-level-id') || '');
        if (typeof box._xentraLevelSelect === 'function') box._xentraLevelSelect(id);
      });
    });
  }

  function renderMasterChoiceGrid(containerId, rows, selectedId, options) {
    var box = $(containerId);
    if (!box) return;

    options = options || {};
    var allowEmpty = !!options.allowEmpty;
    var emptyLabel = options.emptyLabel || 'Tidak ada';
    var addLabel = options.addLabel || 'Tambah';
    var addAction = options.addAction || null;
    var selected = selectedId == null ? '' : String(selectedId);

    var activeRows = (rows || []).filter(function(row) {
      return row && (row.is_active !== false && Number(row.is_active) !== 0 || String(row.id) === selected);
    });

    var html = '';

    if (allowEmpty) {
      html += '<button type="button" class="x-master-choice-chip x-master-choice-empty-chip' +
        (selected === '' ? ' is-selected' : '') +
        '" data-master-choice-empty="1" aria-pressed="' + (selected === '' ? 'true' : 'false') + '">' +
        esc(emptyLabel) + '</button>';
    }

    activeRows.forEach(function(row) {
      var id = String(row.id);
      var isSelected = id === selected;
      var suffix = (row.is_active === false || Number(row.is_active) === 0) ? ' (Nonaktif)' : '';
      html += '<button type="button" class="x-master-choice-chip' +
        (options.variant ? ' ' + options.variant : '') +
        (isSelected ? ' is-selected' : '') +
        '" data-master-choice-id="' + esc(id) + '"' +
        ' aria-pressed="' + (isSelected ? 'true' : 'false') + '"' +
        ' title="' + esc(row.name + suffix) + '">' +
        esc(row.name + suffix) +
      '</button>';
    });

    if (addAction) {
      html += '<button type="button" class="x-master-choice-chip x-master-choice-add" data-master-choice-add="1" aria-label="' +
        esc(addLabel) + '">' +
        '<span aria-hidden="true">+</span><span>' + esc(addLabel) + '</span>' +
      '</button>';
    }

    box.innerHTML = html;

    box.querySelectorAll('[data-master-choice-id]').forEach(function(button) {
      button.addEventListener('click', function() {
        var id = String(button.getAttribute('data-master-choice-id') || '');
        if (typeof options.onSelect === 'function') options.onSelect(id);
      });
    });

    box.querySelectorAll('[data-master-choice-empty]').forEach(function(button) {
      button.addEventListener('click', function() {
        if (typeof options.onSelect === 'function') options.onSelect('');
      });
    });

    box.querySelectorAll('[data-master-choice-add]').forEach(function(button) {
      button.addEventListener('click', function() {
        if (typeof addAction === 'function') addAction();
      });
    });
  }

  function renderMasterMenuSelectors() {
    var categorySelect = $('prod-category');
    if (categorySelect) {
      var categoryRows = state.categories || [];
      var categoryId = String(categorySelect.value || '');
      if (!categoryId && _masterMenuSelected.category_id) categoryId = String(_masterMenuSelected.category_id);

      var categoryHtml = '<option value="">Pilih Kategori</option>';
      categoryRows.forEach(function(row) {
        var selected = categoryId === String(row.id);
        if (!row.is_active && !selected) return;
        var suffix = row.is_active ? '' : ' (Nonaktif)';
        categoryHtml += '<option value="' + esc(row.id) + '"' +
          (selected ? ' selected' : '') +
          (row.is_active ? '' : ' data-inactive="1"') + '>' +
          esc(row.name + suffix) + '</option>';
      });
      categorySelect.innerHTML = categoryHtml;
      categorySelect.value = categoryId;
      _masterMenuSelected.category_id = categorySelect.value || '';
    }

    var flavorSelect = $('prod-flavor');
    if (flavorSelect) {
      var flavorHtml = '<option value="">Tidak ada Rasa</option>';
      _masterMenuComponents.flavor.forEach(function(row) {
        var selected = String(_masterMenuSelected.flavor_id || '') === String(row.id);
        if (!row.is_active && !selected) return;
        var suffix = row.is_active ? '' : ' (Nonaktif)';
        flavorHtml += '<option value="' + esc(row.id) + '"' +
          (selected ? ' selected' : '') +
          (row.is_active ? '' : ' data-inactive="1"') + '>' +
          esc(row.name + suffix) + '</option>';
      });
      flavorSelect.innerHTML = flavorHtml;
      flavorSelect.value = _masterMenuSelected.flavor_id || '';
    }

    var levelSelect = $('prod-level');
    if (levelSelect) {
      levelSelect.value = _masterMenuSelected.level_id || '';
    }

    var levelBox = $('prod-level-chips');
    if (levelBox) {
      levelBox._xentraLevelSelect = function(id) {
        if (levelSelect) levelSelect.value = id;
        _masterMenuSelected.level_id = id;
        renderMasterMenuSelectors();
        renderMasterMenuCustomerPreview();
      };
    }

    renderMasterLevelSelector('prod-level-chips', _masterMenuComponents.level,
      String(_masterMenuSelected.level_id || ''));

    var complementBox = $('prod-complements-editor');
    var empty = $('prod-complements-empty');
    if (complementBox) {
      var rows = _masterMenuComponents.complement || [];
      if (!rows.length) {
        // Empty Master Kelengkapan is still an actionable state: show + Add,
        // never a dead-end "belum ada data" message.
        complementBox.innerHTML =
          '<button type="button" class="x-master-choice-chip x-master-choice-add" data-master-choice-add="1" aria-label="Tambah Kelengkapan">' +
            '<span aria-hidden="true">+</span><span>Tambah</span>' +
          '</button>';
        if (empty) {
          empty.hidden = true;
          empty.setAttribute('aria-hidden', 'true');
          empty.style.display = 'none';
        }
      } else {
        if (empty) {
          empty.hidden = true;
          empty.setAttribute('aria-hidden', 'true');
          empty.style.display = 'none';
        }
        var selectedIds = _masterMenuSelected.complement_ids || [];
        complementBox.innerHTML = rows.filter(function(row) {
          return row.is_active || selectedIds.indexOf(String(row.id)) !== -1;
        }).map(function(row) {
          var id = String(row.id);
          var isSelected = selectedIds.indexOf(id) !== -1;
          var suffix = row.is_active ? '' : ' (Nonaktif)';
          return '<button type="button" class="x-master-choice-chip x-master-complement-chip' +
            (isSelected ? ' is-selected' : '') +
            '" data-master-complement-id="' + esc(id) + '"' +
            ' aria-pressed="' + (isSelected ? 'true' : 'false') + '"' +
            ' title="' + esc(row.name + suffix) + '">' +
            esc(row.name + suffix) +
          '</button>';
        }).join('') +
        '<button type="button" class="x-master-choice-chip x-master-choice-add" data-master-choice-add="1" aria-label="Tambah Kelengkapan">' +
          '<span aria-hidden="true">+</span><span>Tambah</span>' +
        '</button>';

        complementBox.querySelectorAll('[data-master-complement-id]').forEach(function(button) {
          button.addEventListener('click', function() {
            var id = String(button.getAttribute('data-master-complement-id') || '');
            var next = (_masterMenuSelected.complement_ids || []).filter(function(existing) {
              return existing !== id;
            });
            if (next.length === (_masterMenuSelected.complement_ids || []).length) next.push(id);
            _masterMenuSelected.complement_ids = next;
            renderMasterMenuSelectors();
            renderMasterMenuCustomerPreview();
          });
        });
      }

    }

    renderMasterMenuCustomerPreview();
  }

  function normalizeLegacyMenuText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/&/g, ' dan ')
      .replace(/[+\\/|,_-]+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function findLegacyMenuMatch(text, rows, excludedIds) {
    var source = normalizeLegacyMenuText(text);
    if (!source) return null;
    var excluded = excludedIds || {};
    return (rows || [])
      .filter(function(row) {
        if (!row || !row.name || excluded[String(row.id)]) return false;
        if (row.is_active === 0) return false;
        var name = normalizeLegacyMenuText(row.name);
        if (!name || name.length < 3) return false;
        return source.indexOf(name) !== -1;
      })
      .sort(function(a, b) {
        var aLen = normalizeLegacyMenuText(a.name).length;
        var bLen = normalizeLegacyMenuText(b.name).length;
        if (bLen !== aLen) return bLen - aLen;
        return String(a.name).localeCompare(String(b.name), 'id');
      })[0] || null;
  }

  function renderMasterMenuComponentManager() {
    var box = $('master-menu-component-list');
    if (!box) return;
    var rows = _masterMenuComponents[_masterMenuComponentType] || [];
    if (!rows.length) {
      box.innerHTML = '<div class="text-muted" style="padding:16px;text-align:center;">Belum ada Master ' + masterMenuComponentTypeLabel(_masterMenuComponentType) + '.</div>';
      return;
    }
    box.innerHTML = rows.map(function(row) {
      var active = row.is_active !== 0;
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid #eef2f7;padding:10px 2px;">' +
        '<div style="min-width:0;"><strong style="font-size:13px;">' + esc(row.name) + '</strong><div class="text-muted" style="font-size:10px;">' + esc(row.slug) + '</div></div>' +
        '<div style="display:flex;gap:6px;flex:0 0 auto;">' +
          '<button type="button" class="x-btn-secondary" data-master-edit="' + esc(row.id) + '" style="font-size:11px;padding:5px 8px;">Edit</button>' +
          '<button type="button" class="x-btn-secondary" data-master-toggle="' + esc(row.id) + '" style="font-size:11px;padding:5px 8px;">' + (active ? 'Nonaktifkan' : 'Aktifkan') + '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    box.querySelectorAll('[data-master-edit]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var id = btn.getAttribute('data-master-edit');
        var current = rows.find(function(row) { return String(row.id) === String(id); });
        if (!current) return;
        var name = await requestTextInputSheet({ title: 'Edit ' + masterMenuComponentTypeLabel(_masterMenuComponentType), label: 'Nama', value: current.name });
        if (name === null) return;
        name = String(name).trim();
        if (!name) return;
        try {
          var res = await adminFetch(API_BASE + '/admin/menu/components/' + _masterMenuComponentType + '/' + encodeURIComponent(id), {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ name: name })
          });
          var data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || 'Gagal mengubah data.');
          showToast('✅ Master ' + masterMenuComponentTypeLabel(_masterMenuComponentType) + ' diperbarui.');
          await loadMasterMenuComponents();
        } catch (err) {
          showToast('❌ ' + err.message);
        }
      });
    });

    box.querySelectorAll('[data-master-toggle]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var id = btn.getAttribute('data-master-toggle');
        try {
          var res = await adminFetch(API_BASE + '/admin/menu/components/' + _masterMenuComponentType + '/' + encodeURIComponent(id) + '/toggle', {
            method: 'PATCH',
            headers: getAuthHeaders()
          });
          var data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || 'Gagal mengubah status.');
          showToast('✅ Status Master ' + masterMenuComponentTypeLabel(_masterMenuComponentType) + ' diperbarui.');
          await loadMasterMenuComponents();
        } catch (err) {
          showToast('❌ ' + err.message);
        }
      });
    });
  }

  function openMasterMenuComponentManager(type) {
    if (type) _masterMenuComponentType = type;
    var modal = $('modal-master-menu-components');
    if (!modal) return;

    var titleEl = modal.querySelector('.x-modal-header h3');
    var subtitleEl = modal.querySelector('.x-modal-header p');
    var labels = {
      flavor: { title: 'Master Rasa', sub: 'Pilihan rasa yang tersedia untuk Item' },
      complement: { title: 'Master Kelengkapan', sub: 'Pilihan kelengkapan yang tersedia untuk Item' },
      level: { title: 'Master Level', sub: 'Pilihan level yang tersedia untuk Item' }
    };
    var meta = labels[_masterMenuComponentType] || { title: 'Master Menu', sub: 'Data pilihan yang dipakai untuk menyusun Produk Master' };
    if (titleEl) titleEl.textContent = meta.title;
    if (subtitleEl) subtitleEl.textContent = meta.sub;

    openExistingCardInPresentation('modal-master-menu-components', 'master-menu-component-manager', 'bottom-sheet');
    renderMasterMenuComponentManager();
  }

  function closeMasterMenuComponentManager() {
    if (window.XentraPresentation && window.XentraPresentation.isOpen('master-menu-component-manager')) {
      window.XentraPresentation.close('master-menu-component-manager');
    } else {
      var modal = $('modal-master-menu-components');
      if (modal) modal.style.display = 'none';
    }
  }

  async function addMasterMenuComponent() {
    var name = await requestTextInputSheet({ title: 'Tambah Master ' + masterMenuComponentTypeLabel(_masterMenuComponentType), label: 'Nama' });
    if (name === null) return;
    name = String(name).trim();
    if (!name) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/menu/components/' + _masterMenuComponentType, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: name })
      });
      var data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Gagal menambah data.');
      showToast('✅ Master ' + masterMenuComponentTypeLabel(_masterMenuComponentType) + ' ditambahkan.');
      await loadMasterMenuComponents();
      _masterMenuSelected = {
        flavor_id: _masterMenuSelected.flavor_id,
        complement_ids: _masterMenuSelected.complement_ids.slice(),
        level_id: _masterMenuSelected.level_id
      };
      if (_masterMenuComponentType === 'flavor') _masterMenuSelected.flavor_id = data.component.id;
      if (_masterMenuComponentType === 'level') _masterMenuSelected.level_id = data.component.id;
      if (_masterMenuComponentType === 'complement' && _masterMenuSelected.complement_ids.indexOf(String(data.component.id)) === -1) {
        _masterMenuSelected.complement_ids.push(String(data.component.id));
      }
      renderMasterMenuSelectors();
    } catch (err) {
      showToast('❌ ' + err.message);
    }
  }


  function initMasterReferenceListeners() {
    var btnAddComplementPage = $('btn-add-master-complement-page');
    if (btnAddComplementPage && !btnAddComplementPage.dataset.bound) {
      btnAddComplementPage.dataset.bound = 'true';
      btnAddComplementPage.addEventListener('click', function() {
        openMasterReferenceQuickAdd('complement');
      });
    }

    var btnAddCategoryFromProduct = $('btn-add-master-category-from-product');
    if (btnAddCategoryFromProduct) btnAddCategoryFromProduct.addEventListener('click', function () {
      openMasterReferenceQuickAdd('category');
    });

    var btnAddFlavorFromProduct = $('btn-add-master-flavor-from-product');
    if (btnAddFlavorFromProduct) btnAddFlavorFromProduct.addEventListener('click', function () {
      openMasterReferenceQuickAdd('flavor');
    });

    // Product Master only exposes Add for reference values. Delegate the
    // complement + action so the empty-state fallback and rerendered button
    // always invoke the same create-only flow.
    var complementEditor = $('prod-complements-editor');
    if (complementEditor && !complementEditor.dataset.addBound) {
      complementEditor.dataset.addBound = 'true';
      complementEditor.addEventListener('click', function (event) {
        var addButton = event.target.closest('[data-master-choice-add]');
        if (!addButton) return;
        event.preventDefault();
        openMasterReferenceQuickAdd('complement');
      });
    }

    var closeQuickAdd = $('btn-close-master-reference-quick-add');
    if (closeQuickAdd) closeQuickAdd.addEventListener('click', closeMasterReferenceQuickAdd);

    var cancelQuickAdd = $('btn-cancel-master-reference-quick-add');
    if (cancelQuickAdd) cancelQuickAdd.addEventListener('click', closeMasterReferenceQuickAdd);

    var quickAddForm = $('form-master-reference-quick-add');
    if (quickAddForm) quickAddForm.addEventListener('submit', function (event) {
      event.preventDefault();
      saveMasterReferenceQuickAdd();
    });
    var btnAddCategoryPage = $('btn-add-master-category-page');

    var btnCloseCategoryModal = $('btn-close-master-category');
    if (btnCloseCategoryModal) btnCloseCategoryModal.addEventListener('click', closeMasterCategoryModal);

    var btnCancelCategoryModal = $('btn-cancel-master-category');
    if (btnCancelCategoryModal) btnCancelCategoryModal.addEventListener('click', closeMasterCategoryModal);

    var formMasterCategory = $('form-master-category');
    if (formMasterCategory) formMasterCategory.addEventListener('submit', async function(event) {
      event.preventDefault();

      var id = String($('master-cat-id').value || '').trim();
      var name = String($('master-cat-name').value || '').trim();
      if (!name) return;

      var saveBtn = $('btn-save-master-category');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Menyimpan...';
      }

      try {
        var res = await adminFetch(
          id ? API_BASE + '/admin/categories/' + encodeURIComponent(id) : API_BASE + '/admin/categories',
          {
            method: id ? 'PUT' : 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ name: name })
          }
        );
        var data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Gagal menyimpan kategori.');

        var saved = data.category;
        if (saved) {
          var idx = state.categories.findIndex(function(row) { return String(row.id) === String(saved.id); });
          if (idx >= 0) state.categories[idx] = saved;
          else state.categories.push(saved);
        }

        closeMasterCategoryModal();
        renderMasterCategoriesPage();
        populateProductCategorySelect();
        renderProductCategoryFilterChips();
        renderMasterProductsTable();
        renderMasterMenuCustomerPreview();
        showToast(id ? '✅ Kategori diperbarui.' : '✅ Kategori ditambahkan.');
      } catch (err) {
        showToast('❌ ' + err.message);
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Simpan';
        }
      }
    });

    // ── Category Editor Form & Image Listeners ──
    var btnPickCatImage = $('btn-cat-image-pick');
    var btnRemoveCatImage = $('btn-cat-image-remove');
    var fileInputCatImage = $('cat-image-file');

    if (btnPickCatImage && !btnPickCatImage.dataset.bound) {
      btnPickCatImage.dataset.bound = 'true';
      btnPickCatImage.addEventListener('click', function () {
        if (fileInputCatImage) fileInputCatImage.click();
      });
    }

    if (fileInputCatImage && !fileInputCatImage.dataset.bound) {
      fileInputCatImage.dataset.bound = 'true';
      fileInputCatImage.addEventListener('change', function () {
        var file = fileInputCatImage.files && fileInputCatImage.files[0];
        if (!file) return;

        var allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.');
          fileInputCatImage.value = '';
          return;
        }
        if (file.size > 20 * 1024 * 1024) {
          showToast('❌ Ukuran gambar melebihi batas maksimal 20MB.');
          fileInputCatImage.value = '';
          return;
        }

        _categoryImageFile = file;

        if (XentraCropEditor && typeof XentraCropEditor.open === 'function') {
          XentraCropEditor.open({
            source: file,
            assetType: 'category',
            aspectRatio: 1.0,
            title: 'Potong & Posisikan Foto Kategori (1:1)',
            onConfirm: function (cropSpec, previewDataUrl) {
              _categoryCropSpec = cropSpec;
              _categoryImageRemoved = false;
              if ($('cat-image-removed')) $('cat-image-removed').value = '0';
              setCategoryImagePreview(previewDataUrl || URL.createObjectURL(file), true);
              showToast('✓ Foto kategori disesuaikan.');
            },
            onCancel: function () {
              _categoryImageFile = null;
              _categoryCropSpec = null;
              if (fileInputCatImage) fileInputCatImage.value = '';
            }
          });
        } else {
          _categoryCropSpec = null;
          _categoryImageRemoved = false;
          if ($('cat-image-removed')) $('cat-image-removed').value = '0';
          setCategoryImagePreview(URL.createObjectURL(file), true);
        }
      });
    }

    if (btnRemoveCatImage && !btnRemoveCatImage.dataset.bound) {
      btnRemoveCatImage.dataset.bound = 'true';
      btnRemoveCatImage.addEventListener('click', function () {
        _categoryImageFile = null;
        _categoryCropSpec = null;
        _categoryImageRemoved = true;
        if ($('cat-image-removed')) $('cat-image-removed').value = '1';
        if (fileInputCatImage) fileInputCatImage.value = '';
        setCategoryImagePreview('', false);
      });
    }

    var formCategory = $('form-category');
    if (formCategory && !formCategory.dataset.bound) {
      formCategory.dataset.bound = 'true';
      formCategory.addEventListener('submit', async function (event) {
        event.preventDefault();

        var id = String($('cat-id').value || '').trim();
        var name = String($('cat-name').value || '').trim();
        var description = String($('cat-desc').value || '').trim();

        if (!name) {
          showToast('❌ Nama kategori wajib diisi.');
          return;
        }

        var saveBtn = $('btn-save-category-editor');
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.textContent = 'Menyimpan...';
        }

        try {
          var payload = {
            name: name,
            description: description
          };

          var endpoint = id ? (API_BASE + '/admin/categories/' + encodeURIComponent(id)) : (API_BASE + '/admin/categories');
          var method = id ? 'PUT' : 'POST';

          var res = await adminFetch(endpoint, {
            method: method,
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
          });
          var data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || 'Gagal menyimpan kategori.');

          var savedId = (data.category && data.category.id) || id;
          if (!savedId) {
            showToast('❌ Kategori tersimpan tetapi ID Kategori tidak valid.');
            return;
          }

          if (_categoryImageRemoved && id) {
            var removeRes = await adminFetch(API_BASE + '/admin/media/entity/categories/' + encodeURIComponent(savedId) + '/image', {
              method: 'DELETE',
              headers: getAuthHeaders()
            });
            var removeData = {};
            try { removeData = await removeRes.json(); } catch (_) {}
            if (!removeRes.ok || !removeData.success) {
              console.warn('[Category Media Delete Warn]:', removeData.error);
            }
          }

          if (_categoryImageFile) {
            var base64 = await new Promise(function (resolve, reject) {
              var reader = new FileReader();
              reader.onload = function () { resolve(reader.result); };
              reader.onerror = reject;
              reader.readAsDataURL(_categoryImageFile);
            });

            var mediaPayload = {
              image_base64: base64,
              mime_type: _categoryImageFile.type,
              original_filename: _categoryImageFile.name || null
            };
            if (_categoryCropSpec) mediaPayload.crop_spec = _categoryCropSpec;

            var mediaRes = await adminFetch(API_BASE + '/admin/media/entity/categories/' + encodeURIComponent(savedId) + '/image', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify(mediaPayload)
            });
            var mediaData = {};
            try { mediaData = await mediaRes.json(); } catch (_) {}
            if (!mediaRes.ok || !mediaData.success) {
              showToast('⚠️ Kategori disimpan, namun upload foto gagal: ' + (mediaData.error || 'kesalahan media.'));
            }
          }

          showToast(id ? '✅ Kategori berhasil diperbarui.' : '✅ Kategori baru berhasil ditambahkan.');
          _categoryImageFile = null;
          _categoryCropSpec = null;
          _categoryImageRemoved = false;

          navigateTo('catalog/categories', { history: 'replace' });
        } catch (err) {
          showToast('❌ ' + (err.message || 'Gagal menyimpan kategori.'));
        } finally {
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Simpan Kategori';
          }
        }
      });
    }


  }

  window.showCategoryEditorSection = showCategoryEditorSection;
  window.showMasterCategoriesPage = showMasterCategoriesPage;
  window.setMasterReferenceTab = setMasterReferenceTab;
  window.loadMasterCategoriesPage = loadMasterCategoriesPage;
  window.renderMasterReferenceList = renderMasterReferenceList;
  window.renderMasterItemsList = renderMasterItemsList;
  window.renderMasterCategoriesPage = renderMasterCategoriesPage;
  window.renderMasterFlavorsPage = renderMasterFlavorsPage;
  window.referenceRows = referenceRows;
  window.referenceTypeLabel = referenceTypeLabel;
  window.openEditMasterReference = openEditMasterReference;
  window.deleteMasterReference = deleteMasterReference;
  window.toggleMasterReferenceStatus = toggleMasterReferenceStatus;
  window.toggleCategoryStatus = toggleCategoryStatus;
  window.openMasterReferenceQuickAdd = openMasterReferenceQuickAdd;
  window.closeMasterReferenceQuickAdd = closeMasterReferenceQuickAdd;
  window.loadMasterMenuComponents = loadMasterMenuComponents;
  window.renderMasterMenuCustomerPreview = renderMasterMenuCustomerPreview;
  window.renderMasterMenuSelectors = renderMasterMenuSelectors;
  window.openMasterMenuComponentManager = openMasterMenuComponentManager;
  window.closeMasterMenuComponentManager = closeMasterMenuComponentManager;
  window.loadCategoryEditorPage = loadCategoryEditorPage;
  window.openNewCategory = openNewCategory;
  window.openEditCategory = openEditCategory;
  window.initMasterReferenceListeners = initMasterReferenceListeners;

  window.XentraCatalogReference = {
    openMasterReferenceQuickAdd: openMasterReferenceQuickAdd,
    closeMasterReferenceQuickAdd: closeMasterReferenceQuickAdd,
    showCategoryEditorSection: showCategoryEditorSection,
    showMasterCategoriesPage: showMasterCategoriesPage,
    setMasterReferenceTab: setMasterReferenceTab,
    loadMasterCategoriesPage: loadMasterCategoriesPage,
    renderMasterReferenceList: renderMasterReferenceList,
    renderMasterItemsList: renderMasterItemsList,
    renderMasterCategoriesPage: renderMasterCategoriesPage,
    renderMasterFlavorsPage: renderMasterFlavorsPage,
    referenceRows: referenceRows,
    loadCategoryEditorPage: loadCategoryEditorPage,
    initMasterReferenceListeners: initMasterReferenceListeners
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMasterReferenceListeners);
  } else {
    initMasterReferenceListeners();
  }

})(window, document);
