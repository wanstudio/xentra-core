/**
 * XENTRA OWNER DASHBOARD — CATALOG MODULE
 * Standalone modular controller for Master Products, Master Categories, Items, and Branch Menus.
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

  function goBackFromChildPage() {
    if (typeof window.goBackFromChildPage === 'function') return window.goBackFromChildPage();
    if (window.history.length > 1) window.history.back();
  }

  function getEffectiveBranchId() {
    if (typeof window.getEffectiveBranchId === 'function') return window.getEffectiveBranchId();
    var b = window._branchContextState;
    return (b && b.selected !== 'all') ? b.selected : '';
  }

  var state = window.state || { products: [], categories: [], branches: [] };
  window.state = state;

  var _branchContextState = window._branchContextState || { selected: 'all', branches: [] };
  window._branchContextState = _branchContextState;

  function bindLiveSearch(inputOrId, onChange, options) {
    if (window.XentraLiveSearch && typeof window.XentraLiveSearch.bind === 'function') {
      var el = typeof inputOrId === 'string' ? $(inputOrId) : inputOrId;
      return window.XentraLiveSearch.bind(el, onChange, options);
    }
    if (typeof window.bindLiveSearch === 'function') {
      return window.bindLiveSearch(inputOrId, onChange, options);
    }
    var target = typeof inputOrId === 'string' ? $(inputOrId) : inputOrId;
    if (!target || typeof onChange !== 'function') return function () {};
    var onInput = function () {
      onChange({ query: String(target.value || '').trim().toLowerCase(), raw: target.value || '', empty: !String(target.value || '').trim() });
    };
    target.addEventListener('input', onInput);
    return function () { target.removeEventListener('input', onInput); };
  }

  async function confirmFeatureAction(id, title, message, okLabel) {
    if (window.XentraUI && window.XentraUI.Modal && typeof window.XentraUI.Modal.confirm === 'function') {
      return window.XentraUI.Modal.confirm({ title: title, message: message, confirmText: okLabel });
    }
    if (window.XentraPresentation && typeof window.XentraPresentation.confirm === 'function') {
      return window.XentraPresentation.confirm({ id: id, title: title, message: message, okLabel: okLabel });
    }
    if (typeof window.confirmFeatureAction === 'function') {
      return window.confirmFeatureAction(id, title, message, okLabel);
    }
    return window.confirm(message);
  }
  /* =========================================================================
     PHASE 1: CATALOG CONTROLLERS (PRODUCTS, CATEGORIES, MENUS)
     ========================================================================= */

  // State extensions for Phase 1
  var _catalogState = {
    searchQuery: '',
    categoryFilter: 'all',
    activeDetailProductId: null
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 1. MASTER PRODUCTS CONTROLLER
  // ─────────────────────────────────────────────────────────────────────────

  function showProductListSection() {
    var listView = $('product-list-view');
    var detailView = $('product-detail-view');
    var editorView = $('product-editor-view');
    if (listView) listView.style.display = 'block';
    if (detailView) detailView.style.display = 'none';
    if (editorView) editorView.style.display = 'none';
  }

  function showProductDetailSection() {
    var listView = $('product-list-view');
    var detailView = $('product-detail-view');
    var editorView = $('product-editor-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';
    if (editorView) editorView.style.display = 'none';
  }

  function showProductEditorSection() {
    var listView = $('product-list-view');
    var detailView = $('product-detail-view');
    var editorView = $('product-editor-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'none';
    if (editorView) editorView.style.display = 'block';
  }

  async function loadMasterProducts() {
    try {
      var authHeaders = getAuthHeaders();
      var prodRes = await adminFetch(API_BASE + '/admin/composed/products?active_only=0', { headers: authHeaders });
      var prodData = await prodRes.json();

      if (prodData.success) state.products = prodData.products || [];

      renderMasterProductsTable();
    } catch (err) {
      console.error('[Master Products Load Error]:', err);
    }
  }

  // Alias for backward compatibility
  var loadCatalog = loadMasterProducts;

  function renderProductCategoryFilterChips() {
    var container = $('catalog-products-category-chips');
    if (!container) return;

    var html = '<button type="button" class="x-cat-filter-btn ' + (_catalogState.categoryFilter === 'all' ? 'active' : '') + '" data-cat="all">Semua Kategori (' + state.products.length + ')</button>';

    state.categories.forEach(function (cat) {
      var count = state.products.filter(function (p) { return String(p.category_id) === String(cat.id); }).length;
      var active = String(_catalogState.categoryFilter) === String(cat.id) ? 'active' : '';
      html += '<button type="button" class="x-cat-filter-btn ' + active + '" data-cat="' + cat.id + '">' + esc(cat.name) + ' (' + count + ')</button>';
    });

    container.innerHTML = html;

    container.querySelectorAll('.x-cat-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _catalogState.categoryFilter = btn.dataset.cat;
        var select = $('prod-filter-category');
        if (select) select.value = _catalogState.categoryFilter;
        renderProductCategoryFilterChips();
        renderMasterProductsTable();
      });
    });
  }

  // Menu dropdown filter kategori dibangun dari opsi select aslinya, sehingga nilainya
  // hanya punya satu sumber. Dipanggil setiap kali opsinya diisi ulang.
  function renderProductCategoryFilterMenu() {
    var select = $('prod-filter-category');
    var menu = $('prod-filter-category-menu');
    if (!select || !menu) return;
    var current = String(select.value || 'all');
    var html = '';
    Array.prototype.forEach.call(select.options, function (option) {
      var isCurrent = String(option.value) === current;
      html += '<button type="button" class="x-occ-dropdown-item' + (isCurrent ? ' active' : '') +
        '" role="option" data-value="' + esc(option.value) + '" aria-selected="' + (isCurrent ? 'true' : 'false') +
        '" onclick="pickProductCategoryFilter(this)">' +
        '<span>' + esc(option.textContent) + '</span>' +
        '<svg class="x-occ-check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>' +
        '</button>';
      if (isCurrent) {
        var label = $('prod-filter-category-label');
        if (label) label.textContent = option.textContent;
      }
    });
    menu.innerHTML = html;
  }

  function closeProductCategoryFilter() {
    var dropdown = $('prod-filter-category-dropdown');
    if (dropdown) dropdown.classList.remove('open');
    var trigger = $('btn-prod-filter-category');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  window.toggleProductCategoryFilter = function () {
    var dropdown = $('prod-filter-category-dropdown');
    if (!dropdown) return;
    var open = dropdown.classList.toggle('open');
    var trigger = $('btn-prod-filter-category');
    if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  window.pickProductCategoryFilter = function (item) {
    if (!item) return;
    var select = $('prod-filter-category');
    closeProductCategoryFilter();
    if (!select) return;
    select.value = item.dataset.value;
    renderProductCategoryFilterMenu();
    // Perilaku select aslinya tetap dijalankan, termasuk pendengar onchange-nya.
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  document.addEventListener('click', function (e) {
    var dropdown = $('prod-filter-category-dropdown');
    if (dropdown && !dropdown.contains(e.target)) closeProductCategoryFilter();
  });

  window.renderProductCategoryFilterMenu = renderProductCategoryFilterMenu;

  function populateProductCategorySelect() {
    var select = $('prod-filter-category');
    if (select) {
      var opts = '<option value="all">Semua Kategori</option>';
      state.categories.forEach(function (cat) {
        opts += '<option value="' + cat.id + '">' + esc(cat.name) + '</option>';
      });
      select.innerHTML = opts;
      select.value = _catalogState.categoryFilter;
        renderProductCategoryFilterMenu();
    }

    var formSelect = $('prod-category');
    if (formSelect) {
      formSelect.innerHTML = state.categories.map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
      }).join('');
    }
  }

  function getFilteredMasterProducts() {
    return state.products.filter(function (p) {
      if (!_catalogState.searchQuery) return true;
      var q = _catalogState.searchQuery.toLowerCase();
      return String(p.name || '').toLowerCase().indexOf(q) !== -1 ||
        String(p.description || '').toLowerCase().indexOf(q) !== -1 ||
        String(p.sku || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderMasterProductsTable() {
    var tbody = $('master-products-table-body');
    if (!tbody) return;

    var filtered = getFilteredMasterProducts();

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-muted">Belum ada Product yang cocok dengan pencarian.</td></tr>';
      return;
    }

    var rows = filtered.map(function (prod) {
      var img = prod.image || prod.image_url || '';
      var isActive = prod.is_active !== 0;
      var toggleSwitch = '' +
        '<label class="x-toggle' + (isActive ? ' x-toggle-on' : '') + '" title="' + (isActive ? 'Product aktif' : 'Product nonaktif') + '">' +
          '<input type="checkbox" ' + (isActive ? 'checked' : '') + ' onchange="toggleStock(\'' + esc(prod.id) + '\', this.checked ? 1 : 0)" aria-label="Status Product ' + esc(prod.name) + '">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      return [
        '<tr>',
          '<td>' + (img ? '<img src="' + esc(img) + '" alt="" class="x-table-thumb">' : '<div class="x-table-thumb" aria-hidden="true">🍲</div>') + '</td>',
          '<td>',
            '<a href="#catalog/products/' + encodeURIComponent(prod.id) + '" style="font-weight:700;color:var(--text-main);text-decoration:none;display:inline-block;">' + esc(prod.name) + '</a>',
            '<p class="text-muted" style="font-size:12px;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:2px 0 0;">' + esc(prod.description || '') + '</p>',
          '</td>',
          '<td><code style="font-size:11px;">' + esc(prod.sku || 'Belum ada SKU') + '</code></td>',
          '<td>' + toggleSwitch + '</td>',
          '<td class="text-right" style="white-space:nowrap;">',
            '<div class="x-item-actions">',
              '<button type="button" class="x-action-menu-trigger" aria-label="Aksi Product ' + esc(prod.name) + '" onclick="XentraActionMenu.open(this, [' +
                '{ label: \'Lihat Detail\', icon: \'🔍\', onClick: function() { navigateTo(\'catalog/products/' + encodeURIComponent(prod.id) + '\'); } },' +
                '{ label: \'+ Buat Menu Satuan\', icon: \'🍽️\', onClick: function() { window.createMenuFromProduct(\'' + esc(prod.id) + '\'); } },' +
                '{ label: \'Edit Product\', icon: \'✏️\', onClick: function() { openEditProduct(\'' + esc(prod.id) + '\'); } },' +
                '{ divider: true },' +
                '{ label: \'Arsipkan Product\', icon: \'🗑️\', destructive: true, onClick: function() { deleteProduct(\'' + esc(prod.id) + '\'); } }' +
              '])">',
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
              '</button>',
            '</div>',
          '</td>',
        '</tr>'
      ].join('');
    });

    tbody.innerHTML = rows.join('');
    var legacyBody = $('products-table-body');
    if (legacyBody) legacyBody.innerHTML = rows.join('');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRODUCT DETAIL VIEW (Showing Branch Adoption Status)
  // ─────────────────────────────────────────────────────────────────────────

  async function loadProductDetailView(productId) {
    _catalogState.activeDetailProductId = productId;
    var tbody = $('prod-detail-branches-tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4">Memuat status cabang...</td></tr>';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/products/' + productId, { headers: getAuthHeaders() });
      var data = await res.json();
      if (!data.success || !data.product) {
        showToast('❌ ' + (data.error || 'Produk tidak ditemukan.'));
        navigateTo('catalog/products');
        return;
      }

      var prod = data.product;
      var branchAdoptions = data.branch_adoptions || [];

      // Product detail is intentionally atomic. Do not render legacy
      // Product price/category as customer/commercial identity.
      if ($('prod-detail-breadcrumb')) $('prod-detail-breadcrumb').textContent = prod.name;
      if ($('product-detail-mobile-title')) $('product-detail-mobile-title').textContent = 'Detail Product · ' + (prod.name || 'Product');
      if ($('prod-detail-name')) $('prod-detail-name').textContent = prod.name || 'Product';
      if ($('prod-detail-desc')) $('prod-detail-desc').textContent = prod.description || 'Tidak ada deskripsi.';
      if ($('prod-detail-sku')) $('prod-detail-sku').textContent = prod.sku || 'Belum ada SKU';

      var img = prod.image || prod.image_url || '';
      if ($('prod-detail-img')) {
        if (img) {
          $('prod-detail-img').src = img;
          $('prod-detail-img').style.display = 'block';
        } else {
          $('prod-detail-img').removeAttribute('src');
          $('prod-detail-img').style.display = 'none';
        }
      }

      var statusBadge = $('prod-detail-status-badge');
      if (statusBadge) {
        var isActive = prod.is_active !== 0;
        statusBadge.className = 'x-badge ' + (isActive ? 'x-badge-success' : 'x-badge-warning');
        statusBadge.textContent = isActive ? 'Aktif' : 'Nonaktif';
      }

      // Render branch adoptions table
      renderProductDetailBranchesTable(branchAdoptions, prod);
    } catch (err) {
      console.error('[Product Detail Error]:', err);
      showToast('❌ Kesalahan jaringan saat memuat detail produk.');
    }
  }

  function renderProductDetailBranchesTable(adoptions, prod) {
    var tbody = $('prod-detail-branches-tbody');
    if (!tbody) return;

    if (!adoptions || !adoptions.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">Belum ada cabang terdaftar pada brand ini.</td></tr>';
      return;
    }

    var rows = adoptions.map(function (b) {
      var isAdopted = b.is_adopted === 1 || b.is_adopted === true;
      var isAvailable = b.branch_is_available === 1 || b.branch_is_available === true;
      var adoptedBadge = isAdopted
        ? '<span class="x-badge x-badge-success">Diadopsi</span>'
        : '<span class="x-badge" style="background:#f1f5f9;color:#64748b;">Belum Diadopsi</span>';

      var priceDisplay = isAdopted ? formatMoney(b.branch_price != null ? b.branch_price : prod.price) : '—';
      var stockDisplay = isAdopted ? (b.branch_stock != null ? b.branch_stock : '100') : '—';
      var availDisplay = isAdopted
        ? (isAvailable ? '<span class="x-badge x-badge-success">● Tersedia</span>' : '<span class="x-badge x-badge-warning">○ Habis</span>')
        : '—';

      var actionBtn = isAdopted
        ? '<button type="button" class="x-btn-secondary" style="font-size:12px;padding:4px 8px;" onclick="openBranchMenuFromDetail(\'' + b.branch_id + '\')">Lihat Menu Cabang</button>'
        : '<button type="button" class="x-btn-primary" style="font-size:12px;padding:4px 8px;" onclick="adoptProductDirectly(\'' + b.branch_id + '\', \'' + prod.id + '\')">+ Adopsi ke Cabang</button>';

      return [
        '<tr>',
          '<td><strong>' + esc(b.branch_name) + '</strong><br><small class="text-muted">' + esc(b.branch_address || '') + '</small></td>',
          '<td>' + adoptedBadge + '</td>',
          '<td>' + priceDisplay + '</td>',
          '<td>' + stockDisplay + '</td>',
          '<td>' + availDisplay + '</td>',
          '<td class="text-right">' + actionBtn + '</td>',
        '</tr>'
      ].join('');
    });

    tbody.innerHTML = rows.join('');
  }

  window.openBranchMenuFromDetail = function (branchId) {
    var sel = $('dash-branch-context');
    if (sel) {
      sel.value = branchId;
      _branchContextState.selected = branchId;
    }
    navigateTo('catalog/menus');
  };

  window.adoptProductDirectly = async function (branchId, prodId) {
    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + branchId + '/adopt', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ product_id: prodId })
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Produk berhasil diadopsi ke cabang!');
        if (_catalogState.activeDetailProductId) {
          loadProductDetailView(_catalogState.activeDetailProductId);
        }
      } else {
        showToast('❌ ' + (data.message || data.error || 'Gagal mengadopsi produk.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 2. MASTER REFERENCE MANAGEMENT PAGE (CATEGORY + FLAVOR)
  // ─────────────────────────────────────────────────────────────────────────

  var _masterReferenceTab = 'category';
  // Prevent stale/overlapping catalog-reference requests from overwriting newer data.
  var _masterReferenceLoadSeq = 0;

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

  var _masterMenuComponents = {
    flavor: [],
    complement: [],
    level: []
  };
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

  // Product Image State — explicitly scoped to the Product Editor.
  // The file stays in memory only until the Product save pipeline uploads it.
  var _productImageFile = null;
  var _productCropSpec = null;
  var _productImageRemoved = false;

  // Product Actions
  function setProductImagePreview(src, hasImage) {
    var previewImg = $('prod-image-preview');
    var emptyBox = $('prod-image-empty');
    var btnRemove = $('btn-prod-image-remove');
    var btnPick = $('btn-prod-image-pick');
    if (!previewImg || !emptyBox) return;
    if (hasImage && src) {
      previewImg.src = src;
      previewImg.style.display = 'block';
      emptyBox.style.display = 'none';
      if (btnRemove) btnRemove.style.display = 'inline-block';
      if (btnPick) btnPick.textContent = '\ud83d\udcc1 Ganti Foto';
    } else {
      previewImg.removeAttribute('src');
      previewImg.style.display = 'none';
      emptyBox.style.display = 'flex';
      if (btnRemove) btnRemove.style.display = 'none';
      if (btnPick) btnPick.textContent = '\ud83d\udcc1 Pilih Foto';
    }
    renderMasterMenuCustomerPreview();
  }

  var _productEditorLoadSeq = 0;
  var _productEditorActiveState = 1;

  function updateProductStockManageUI(hasStockManagement) {
    var toggle = $('prod-manage-stock-toggle');
    var container = $('prod-sku-container');
    var skuInput = $('prod-sku');
    var note = $('prod-stock-note');
    if (toggle) toggle.checked = !!hasStockManagement;
    if (container) container.style.display = hasStockManagement ? 'block' : 'none';
    if (skuInput) {
      skuInput.required = !!hasStockManagement;
      if (!hasStockManagement) skuInput.value = '';
    }
    if (note) {
      note.textContent = hasStockManagement
        ? 'data item ini digunakan sebagai acuan inventaris di tiap cabang'
        : 'item non-stock tetap bisa di pakai untuk membuat menu';
    }
  }

  function updateProductInventoryTypeUI(type) {
    var isDirect = String(type).toUpperCase() === 'DIRECT';
    var radioCooked = $('prod-type-cooked');
    var radioDirect = $('prod-type-direct');
    if (radioCooked) radioCooked.checked = !isDirect;
    if (radioDirect) radioDirect.checked = isDirect;

    var lblCooked = $('label-prod-type-cooked');
    var lblDirect = $('label-prod-type-direct');
    if (lblCooked) {
      lblCooked.style.borderColor = !isDirect ? 'var(--primary-color, #10b981)' : '#cbd5e1';
      lblCooked.style.background = !isDirect ? '#f8fafc' : '#ffffff';
    }
    if (lblDirect) {
      lblDirect.style.borderColor = isDirect ? 'var(--primary-color, #10b981)' : '#cbd5e1';
      lblDirect.style.background = isDirect ? '#f8fafc' : '#ffffff';
    }

    var costGroup = $('group-prod-cost-price');
    if (costGroup) {
      costGroup.style.display = isDirect ? 'block' : 'none';
    }

    var recipeCostGroup = $('group-prod-recipe-cost-info');
    if (recipeCostGroup) {
      recipeCostGroup.style.display = isDirect ? 'none' : 'block';
    }

    var stockNote = $('prod-stock-note');
    if (stockNote) {
      if (isDirect) {
        stockNote.textContent = 'Barang dagang siap jual dipantau stok fisiknya dan otomatis masuk Ceklist Belanja saat menipis.';
      } else {
        stockNote.textContent = 'Item olahan dikurangi otomatis lewat formula resep di tab Resep Makanan.';
      }
    }
  }

  function resetProductEditorForAdd() {
    $('product-editor-title').textContent = 'Tambah Item';
    $('prod-editor-breadcrumb').textContent = 'Tambah Item';
    $('prod-editor-subtitle').textContent = 'Item satuan yang dipakai dan dihitung dalam stok — seperti ayam, ikan, bumbu, dan lainnya.';
    if ($('product-editor-mobile-title')) $('product-editor-mobile-title').textContent = 'Tambah Item';
    if ($('product-editor-mobile-subtitle')) $('product-editor-mobile-subtitle').textContent = 'Item satuan yang dipakai dan dihitung dalam stok — seperti ayam, ikan, bumbu, dan lainnya.';
    $('prod-id').value = '';
    $('prod-name').value = '';
    $('prod-sku').value = '';
    $('prod-desc').value = '';
    if ($('prod-cost-price')) {
      if (window.XentraCurrencyInput) window.XentraCurrencyInput.setValue($('prod-cost-price'), '');
      else $('prod-cost-price').value = '';
    }
    if ($('prod-recipe-status-text')) $('prod-recipe-status-text').textContent = 'Belum Ada Resep Masakan';
    if ($('prod-recipe-subtext')) $('prod-recipe-subtext').textContent = 'Formula bahan dapat ditambahkan setelah item disimpan di tab Resep Makanan';
    if ($('prod-recipe-cost-display')) $('prod-recipe-cost-display').textContent = 'Rp0';
    if ($('prod-recipe-components-preview')) {
      $('prod-recipe-components-preview').innerHTML = '';
      $('prod-recipe-components-preview').style.display = 'none';
    }
    updateProductInventoryTypeUI('COOKED');
    updateProductStockManageUI(false);
    _productEditorActiveState = 1;
    _productImageFile = null;
    _productCropSpec = null;
    _productImageRemoved = false;
    var fileInput = $('prod-image-file');
    if (fileInput) fileInput.value = '';
    setProductImagePreview('', false);
  }

  function populateProductEditorForm(prod) {
    $('product-editor-title').textContent = 'Edit Item: ' + prod.name;
    $('prod-editor-breadcrumb').textContent = prod.name;
    $('prod-editor-subtitle').textContent = 'Perbarui data item. Menu tetap dikelola di workspace Master Menu.';
    if ($('product-editor-mobile-title')) $('product-editor-mobile-title').textContent = 'Edit Item';
    if ($('product-editor-mobile-subtitle')) $('product-editor-mobile-subtitle').textContent = 'Perbarui item tanpa mengubah identitas komersial Menu.';
    $('prod-id').value = prod.id;
    $('prod-name').value = prod.name || '';
    updateProductInventoryTypeUI(prod.inventory_type || 'COOKED');
    var hasSku = prod.sku != null && String(prod.sku).trim() !== '';
    $('prod-sku').value = hasSku ? String(prod.sku).trim() : '';
    updateProductStockManageUI(hasSku);
    $('prod-desc').value = prod.description || '';
    if ($('prod-cost-price')) {
      var costVal = prod.cost_price != null ? prod.cost_price : '';
      if (window.XentraCurrencyInput) window.XentraCurrencyInput.setValue($('prod-cost-price'), costVal);
      else $('prod-cost-price').value = costVal;
    }

    var recipe = prod.recipe;
    var previewEl = $('prod-recipe-components-preview');
    if (recipe && recipe.cost_per_unit > 0) {
      if ($('prod-recipe-status-text')) $('prod-recipe-status-text').textContent = recipe.name || 'Resep Terdaftar';
      if ($('prod-recipe-subtext')) $('prod-recipe-subtext').textContent = 'Formula bahan baku otomatis (' + (recipe.yield_quantity || 1) + ' ' + (recipe.yield_uom_name || 'porsi') + ')';
      if ($('prod-recipe-cost-display')) $('prod-recipe-cost-display').textContent = formatMoney(recipe.cost_per_unit);
      if (previewEl && Array.isArray(recipe.components) && recipe.components.length > 0) {
        var compList = recipe.components.slice(0, 4).map(function(c) {
          return '<span>• ' + esc(c.material_name) + ' (' + c.planned_quantity + ' ' + esc(c.uom_name) + ')</span>';
        }).join('<br>');
        if (recipe.components.length > 4) {
          compList += '<br><span style="color:#94a3b8;font-size:11px;">+ ' + (recipe.components.length - 4) + ' bahan lainnya...</span>';
        }
        previewEl.innerHTML = compList;
        previewEl.style.display = 'block';
      } else if (previewEl) {
        previewEl.innerHTML = '';
        previewEl.style.display = 'none';
      }
    } else {
      if ($('prod-recipe-status-text')) $('prod-recipe-status-text').textContent = 'Resep Belum Dibuat / Belum Ada';
      if ($('prod-recipe-subtext')) $('prod-recipe-subtext').textContent = 'Atur komposisi bahan di tab Resep Makanan untuk menghitung HPP otomatis';
      if ($('prod-recipe-cost-display')) $('prod-recipe-cost-display').textContent = formatMoney(prod.cost_price || 0);
      if (previewEl) {
        previewEl.innerHTML = '';
        previewEl.style.display = 'none';
      }
    }

    _productEditorActiveState = (prod.is_active !== undefined && prod.is_active !== null) ? (prod.is_active !== 0 ? 1 : 0) : 1;
    _productImageFile = null;
    _productCropSpec = null;
    _productImageRemoved = false;
    var fileInput = $('prod-image-file');
    if (fileInput) fileInput.value = '';
    var existingImage = prod.image_url || prod.image || '';
    setProductImagePreview(existingImage, existingImage !== '');
  }

  async function loadProductEditorPage(productId) {
    var requestSeq = ++_productEditorLoadSeq;
    showProductEditorSection();

    if (!productId) {
      resetProductEditorForAdd();
      return;
    }

    try {
      // Contract Product (locked) hanya menyediakan LIST canonical:
      // GET /admin/composed/products. Tidak ada GET by-id di contract composed,
      // jadi Product diambil dari list lalu dipilih berdasarkan id — bukan
      // memakai endpoint legacy /admin/products/:id.
      var res = await adminFetch(API_BASE + '/admin/composed/products?active_only=0', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (requestSeq !== _productEditorLoadSeq) return;

      var products = (data && Array.isArray(data.products)) ? data.products : [];
      var product = null;
      for (var i = 0; i < products.length; i += 1) {
        if (String(products[i].id) === String(productId)) { product = products[i]; break; }
      }

      if (!data || !data.success || !product) {
        showToast('❌ ' + ((data && data.error) || 'Product tidak ditemukan.'));
        navigateTo('catalog/products');
        return;
      }

      populateProductEditorForm(product);
    } catch (err) {
      if (requestSeq !== _productEditorLoadSeq) return;
      console.error('[Product Editor Load Error]:', err);
      showToast('❌ Gagal memuat Product Editor.');
    }
  }

  window.openAddProduct = function () {
    navigateTo('catalog/products/new');
  };

  window.openEditProduct = function (id) {
    if (!id) return;
    navigateTo('catalog/products/' + encodeURIComponent(id) + '/edit');
  };

  window.closeProductModal = function () {
    _productEditorLoadSeq++;
    if (window.goBackFromItemEditor) {
      window.goBackFromItemEditor();
      return;
    }
    navigateTo('catalog/products', { history: 'replace' });
  };

  window.toggleStock = async function (id, nextActive) {
    try {
      var desiredActive = nextActive === undefined ? true : (nextActive !== 0);
      var res = await adminFetch(API_BASE + '/admin/composed/products/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: desiredActive })
      });
      var data = await res.json();
      if (!res.ok || !data.success) {
        showToast('❌ ' + (data.error || data.message || 'Gagal mengubah status Product.'));
        return;
      }
      showToast('Status Product diperbarui.');
      loadMasterProducts();
      if (_catalogState.activeDetailProductId) {
        loadProductDetailView(_catalogState.activeDetailProductId);
      }
    } catch (e) {
      showToast('Gagal mengubah status Product.');
    }
  };

  window.deleteProduct = async function (id) {
    if (window.XentraPresentation && !await window.XentraPresentation.confirm({
      id: 'archive-master-product',
      title: 'Arsipkan Product Master',
      message: 'Product akan dinonaktifkan dan tetap mempertahankan identitasnya untuk Menu, histori, dan inventory.',
      okLabel: 'Arsipkan',
      cancelLabel: 'Batal'
    })) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/composed/products/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: false })
      });
      var data = await res.json();
      if (!res.ok || !data.success) {
        showToast('❌ ' + (data.error || data.message || 'Gagal mengarsipkan Product.'));
        return;
      }
      showToast('Product Master diarsipkan.');
      if (_catalogState.activeDetailProductId === id) {
        navigateTo('catalog/products');
      } else {
        loadMasterProducts();
      }
    } catch (e) {
      showToast('Gagal mengarsipkan Product.');
    }
  };

async function loadMenusView() {
    var selectedBranchId = _branchContextState.selected;

    var allView = $('menus-all-branches-view');
    var singleView = $('menus-single-branch-view');
    var headerActions = $('menus-header-actions');
    var badge = $('menus-context-badge');
    var subtitle = $('menus-context-subtitle');

    if (selectedBranchId === 'all' || !selectedBranchId) {
      // Show All Branches Overview View
      if (allView) allView.style.display = 'block';
      if (singleView) singleView.style.display = 'none';
      if (headerActions) headerActions.style.display = 'none';
      if (badge) {
        badge.textContent = 'All Branches';
        badge.className = 'x-badge x-badge-info';
      }
      if (subtitle) {
        subtitle.textContent = 'Pilih cabang pada Branch Context selector untuk mengelola menu jual spesifik per cabang.';
      }

      await loadMenusAllBranchesTable();
    } else {
      // Show Single Branch Menu View
      if (allView) allView.style.display = 'none';
      if (singleView) singleView.style.display = 'block';
      if (headerActions) headerActions.style.display = 'flex';

      var b = state.branches.find(function (x) { return String(x.id) === String(selectedBranchId); });
      var branchName = b ? b.name : selectedBranchId;
      if (badge) {
        badge.textContent = 'Cabang: ' + branchName;
        badge.className = 'x-badge x-badge-success';
      }
      if (subtitle) {
        subtitle.textContent = 'Mengatur menu jual, harga override, dan kategori cabang untuk ' + branchName;
      }

      XentraOwnerBranchCatalog.state.branchId = selectedBranchId;
      await loadSingleBranchMenuView(selectedBranchId);
    }
  }

  async function loadMenusAllBranchesTable() {
    var tbody = $('menus-branches-table-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6">Memuat daftar cabang...</td></tr>';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/branches', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data.success && data.branches) {
        state.branches = data.branches;
        populateBranchSelector(data.branches);
      }

      var branches = state.branches || [];
      if (!branches.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Belum ada cabang terdaftar. Buat cabang di menu Branches terlebih dahulu.</td></tr>';
        return;
      }

      // Fetch adoption summary for each branch
      var summaries = await Promise.all(branches.map(async function (b) {
        try {
          var cRes = await adminFetch(API_BASE + '/admin/branches/' + b.id + '/menu', { headers: getAuthHeaders() });
          var cData = await cRes.json();
          var adoptedList = cData.adopted_menus || cData.adopted_products || [];
          return {
            branch: b,
            adoptedCount: adoptedList.length,
            categoryCount: (cData.categories || []).length
          };
        } catch (_) {
          return { branch: b, adoptedCount: 0, categoryCount: 0 };
        }
      }));

      var rows = summaries.map(function (s) {
        var b = s.branch;
        var isOpen = b.is_open_override === 1 || b.is_open_override === true;
        var statusBadge = isOpen
          ? '<span class="x-badge x-badge-success">● Buka</span>'
          : '<span class="x-badge x-badge-warning">○ Tutup</span>';

        return [
          '<tr>',
            '<td><strong>' + esc(b.name) + '</strong></td>',
            '<td><small class="text-muted">' + esc(b.address_text || '-') + '</small></td>',
            '<td>' + statusBadge + '</td>',
            '<td><span class="x-badge x-badge-info">' + s.adoptedCount + ' Menu Aktif</span></td>',
            '<td><span class="x-badge">' + s.categoryCount + ' Kategori</span></td>',
            '<td class="text-right">',
              '<button type="button" class="x-btn-primary" style="padding:6px 12px;font-size:12px;" onclick="switchToBranchMenu(\'' + b.id + '\')">Kelola Menu Cabang ➔</button>',
            '</td>',
          '</tr>'
        ].join('');
      });

      tbody.innerHTML = rows.join('');
    } catch (err) {
      console.error('[Menus All Branches Load Error]:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Gagal memuat daftar cabang.</td></tr>';
    }
  }

  window.switchToBranchMenu = function (branchId) {
    var sel = $('dash-branch-context');
    if (sel) {
      sel.value = branchId;
      _branchContextState.selected = branchId;
    }
    loadMenusView();
  };

  async function loadSingleBranchMenuView(branchId) {
    XentraOwnerBranchCatalog.state.branchId = branchId;

    var adoptedEl = $('menus-branch-adopted-container');
    var availableEl = $('menus-branch-available-container');
    var catsEl = $('menus-branch-categories-bar');
    if (adoptedEl) adoptedEl.innerHTML = '<p class="text-muted" style="font-size:13px;">Memuat menu aktif cabang...</p>';
    if (availableEl) availableEl.innerHTML = '<p class="text-muted" style="font-size:13px;">Memuat rekomendasi Owner...</p>';
    if (catsEl) catsEl.innerHTML = '<span class="text-muted" style="font-size:13px;">Memuat kategori...</span>';

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + branchId + '/menu', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!data.success) {
        showToast('❌ ' + (data.error || 'Gagal memuat katalog menu cabang.'));
        return;
      }

      XentraOwnerBranchCatalog.state.catalogData = data;

      var categories = data.categories || [];
      var adopted = data.adopted_menus || data.adopted_products || [];
      var available = data.available_master_menus || data.available_master_products || [];

      if ($('menus-branch-cat-count')) $('menus-branch-cat-count').textContent = categories.length;
      if ($('menus-branch-active-count')) $('menus-branch-active-count').textContent = adopted.length;
      if ($('menus-branch-available-count')) $('menus-branch-available-count').textContent = available.length;

      renderMenusBranchCategoriesBar(categories);
      renderMenusBranchAdoptedProducts(adopted, XentraOwnerBranchCatalog.state.inlineFilter);
      renderMenusBranchAvailableProducts(available);
    } catch (err) {
      console.error('[Single Branch Menu Load Error]:', err);
      showToast('❌ Kesalahan jaringan saat memuat menu cabang.');
    }
  }

  function renderMenusBranchCategoriesBar(categories) {
    var bar = $('menus-branch-categories-bar');
    if (!bar) return;

    bar.innerHTML = '';

    // "Semua" filter button
    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'x-cat-filter-btn' + (XentraOwnerBranchCatalog.state.inlineFilter === 'all' ? ' active' : '');
    allBtn.style.borderRadius = '20px';
    allBtn.textContent = 'Semua';
    allBtn.addEventListener('click', function () {
      XentraOwnerBranchCatalog.state.inlineFilter = 'all';
      if ($('menus-branch-filter-label')) $('menus-branch-filter-label').textContent = 'Menampilkan semua kategori';
      renderMenusBranchCategoriesBar(categories);
      renderMenusBranchAdoptedProducts(XentraOwnerBranchCatalog.state.catalogData.adopted_products || [], 'all');
    });
    bar.appendChild(allBtn);

    if (!categories.length) {
      var hint = document.createElement('span');
      hint.className = 'text-muted';
      hint.style.fontSize = '12px';
      hint.textContent = 'Belum ada kategori cabang. Klik "+ Tambah Kategori Cabang" untuk membuat.';
      bar.appendChild(hint);
      return;
    }

    categories.forEach(function (cat) {
      var isActive = XentraOwnerBranchCatalog.state.inlineFilter === cat.id;

      var chip = document.createElement('span');
      chip.dataset.catId = cat.id;
      chip.style.cssText = [
        'display:inline-flex;align-items:center;gap:0;border-radius:20px;overflow:hidden;',
        'border:1px solid ' + (isActive ? 'var(--x-primary,#10b981)' : '#e2e8f0') + ';',
        'background:' + (isActive ? '#f0fdf4' : '#f8fafc') + ';',
        'transition:box-shadow 0.15s,opacity 0.15s;'
      ].join('');

      // Category name filter button
      var nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.style.cssText = 'border:none;background:none;padding:6px 10px 6px 12px;font-size:13px;font-weight:' + (isActive ? '700' : '500') + ';cursor:pointer;color:#1e293b;';
      nameBtn.textContent = cat.name;
      nameBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        XentraOwnerBranchCatalog.state.inlineFilter = cat.id;
        if ($('menus-branch-filter-label')) $('menus-branch-filter-label').textContent = 'Filter: ' + cat.name;
        renderMenusBranchCategoriesBar(categories);
        renderMenusBranchAdoptedProducts(XentraOwnerBranchCatalog.state.catalogData.adopted_products || [], cat.id);
      });
      chip.appendChild(nameBtn);

      // Edit category button
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.title = 'Ubah nama & gambar kategori';
      editBtn.style.cssText = 'border:none;background:none;padding:5px 6px;font-size:12px;cursor:pointer;color:#64748b;';
      editBtn.textContent = '✏️';
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openBranchCategoryEditModal(cat);
      });
      chip.appendChild(editBtn);

      // Delete category button
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.title = 'Hapus kategori';
      delBtn.style.cssText = 'border:none;background:none;padding:6px 10px 6px 4px;font-size:12px;cursor:pointer;color:#ef4444;opacity:0.8;';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteBranchCategory(cat.id, cat.name);
      });
      chip.appendChild(delBtn);

      bar.appendChild(chip);
    });
  }

  function renderMenusBranchAdoptedProducts(adopted, filterCatId) {
    var container = $('menus-branch-adopted-container');
    if (!container) return;

    var filtered = adopted;
    if (filterCatId && filterCatId !== 'all') {
      filtered = adopted.filter(function (p) {
        if (p.category_ids && Array.isArray(p.category_ids)) {
          return p.category_ids.map(String).indexOf(String(filterCatId)) !== -1;
        }
        return String(p.branch_category_id) === String(filterCatId);
      });
    }

    if (!filtered.length) {
      var msg = filterCatId && filterCatId !== 'all'
        ? 'Belum ada menu di kategori ini. Adopsi produk dari Master dan pilih kategori ini.'
        : 'Belum ada menu yang diadopsi oleh cabang ini. Pilih dari daftar rekomendasi Master di bawah!';
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">' + msg + '</div>';
      return;
    }

    // FORWARD MENU: card may show Master Menu Composition as read-only; no Branch content overrides.
    container.innerHTML = filtered.map(function (p) {
      var menuId = p.menu_id || p.id;
      var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isAvailable = p.is_available === 1 || p.is_available === true;
      var catName = (p.category_names && p.category_names.length)
        ? p.category_names.join(', ')
        : (p.branch_category_name || 'Tanpa Kategori');
      var modeBadge = p.pricing_mode === 'range'
        ? '<span class="x-badge x-badge-range">Range (' + formatMoney(p.min_price) + ' - ' + formatMoney(p.max_price) + ')</span>'
        : '<span class="x-badge x-badge-lock">Harga Terkunci</span>';

      var availabilityToggle = '' +
        '<label class="x-toggle' + (isAvailable ? ' x-toggle-on' : '') + '" title="' + (isAvailable ? 'Menu tersedia' : 'Menu habis') + '">' +
          '<input type="checkbox" ' + (isAvailable ? 'checked' : '') + ' onchange="toggleBranchMenuAvailability(\'' + esc(menuId) + '\', this.checked ? 1 : 0)" aria-label="Ubah ketersediaan menu cabang">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      return [
        '<div class="x-product-card-simple">',
          '<img src="' + esc(img) + '" class="x-product-card-thumb" alt="' + esc(p.name || p.title) + '">',
          '<div class="x-product-card-content">',
            '<h5>' + esc(p.name || p.title) + '</h5>',
            '<div style="display:flex;gap:4px;flex-wrap:wrap;margin:4px 0;">',
              '<span class="x-badge x-badge-info" style="font-size:10px;">' + esc(catName) + '</span>',
              modeBadge,
            '</div>',
            '<div class="x-product-card-price">Jual: ' + formatMoney(p.price) + ' <small class="text-muted" style="font-weight:normal;">(Owner: ' + formatMoney(p.master_price || p.selling_price || p.price) + ')</small></div>',
            '<div class="x-product-card-actions">',
              '<div>' + availabilityToggle + '</div>',
              '<div class="x-item-actions">',
                '<button type="button" class="x-action-menu-trigger" aria-label="Aksi menu cabang ' + esc(p.name || p.title) + '" onclick="XentraActionMenu.open(this, [' +
                  '{ label: \'Hapus dari Cabang\', icon: \'🗑️\', destructive: true, onClick: function() { removeBranchMenu(\'' + esc(menuId) + '\', \'' + esc(p.name || p.title) + '\'); } }' +
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

  function renderMenusBranchAvailableProducts(available) {
    var container = $('menus-branch-available-container');
    if (!container) return;
    available = available || [];
    XentraOwnerBranchCatalog.state.availableMenus = available;

    var searchEl = $('menus-branch-available-search');
    if (searchEl && !searchEl.dataset.bound) {
      searchEl.dataset.bound = '1';
      searchEl.addEventListener('input', function () {
        renderMenusBranchAvailableProducts(XentraOwnerBranchCatalog.state.availableMenus || []);
      });
    }

    if (!available.length) {
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">Semua Master Menu telah diadopsi oleh cabang ini.</div>';
      return;
    }

    var query = String((searchEl && searchEl.value) || '').trim().toLowerCase();
    var filtered = !query ? available : available.filter(function (p) {
      return [p.name, p.title, p.title_name, p.category_name, p.rasa_name, p.sku]
        .filter(Boolean).join(' ').toLowerCase().indexOf(query) !== -1;
    });

    if (!filtered.length) {
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">Tidak ada menu yang cocok dengan "' + esc(query) + '".</div>';
      return;
    }

    container.innerHTML = filtered.map(function (p) {
      var menuId = p.menu_id || p.id;
      var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isRange = p.pricing_mode === 'range';
      var modeBadge = isRange
        ? '<span class="x-badge x-badge-range">Range (' + formatMoney(p.min_price) + ' - ' + formatMoney(p.max_price) + ')</span>'
        : '<span class="x-badge x-badge-lock">Harga Terkunci</span>';

      return [
        '<div class="x-product-card-simple" style="background:#f8fafc;">',
          '<img src="' + img + '" class="x-product-card-thumb" alt="' + esc(p.name || p.title) + '">',
          '<div class="x-product-card-content">',
            '<h5>' + esc(p.name || p.title) + '</h5>',
            '<div style="margin:4px 0;">' + modeBadge + '</div>',
            '<div class="x-product-card-price">Harga Dasar Master: ' + formatMoney(p.selling_price || p.price) + '</div>',
            '<div class="x-product-card-actions">',
              '<button type="button" class="x-btn-primary" style="padding:6px 12px;font-size:12px;" onclick="openAdoptModal(\'' + esc(menuId) + '\')">＋ Adopsi ke Cabang</button>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function initCatalogListeners() {
    var masterReferenceActionHandler = function (event) {
      var trigger = event.target.closest ? event.target.closest('[data-master-reference-action]') : null;
      if (!trigger) return;

      var type = trigger.getAttribute('data-master-reference-action');
      var id = trigger.getAttribute('data-reference-id');
      if (!type || !id || !XentraActionMenu) return;

      event.preventDefault();
      event.stopPropagation();

      XentraActionMenu.open(trigger, [
        {
          label: 'Edit',
          icon: '✏️',
          onClick: function () {
            if (type === 'category') {
              openEditCategory(id);
            } else if (type === 'item') {
              openEditProduct(id);
            } else {
              openEditMasterReference(type, id);
            }
          }
        },
        {
          label: 'Hapus',
          icon: '🗑️',
          destructive: true,
          onClick: function () { deleteMasterReference(type, id); }
        }
      ]);
    };

    ['master-categories-page-list', 'master-flavors-page-list', 'master-complements-page-list', 'master-levels-page-list', 'master-titles-page-list', 'master-items-page-list'].forEach(function (listId) {
      var list = $(listId);
      if (list && !list.dataset.actionMenuBound) {
        list.dataset.actionMenuBound = 'true';
        list.addEventListener('click', masterReferenceActionHandler);
      }
    });

    var referenceTabs = $('master-reference-tabs');
    if (referenceTabs && !referenceTabs.dataset.bound) {
      referenceTabs.dataset.bound = 'true';
      referenceTabs.querySelectorAll('[data-master-reference-tab]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          setMasterReferenceTab(btn.getAttribute('data-master-reference-tab'));
        });
      });
    }

    var btnAddCategoryPage = $('btn-add-master-category-page');
    if (btnAddCategoryPage && !btnAddCategoryPage.dataset.bound) {
      btnAddCategoryPage.dataset.bound = 'true';
      btnAddCategoryPage.addEventListener('click', function() {
        openNewCategory();
      });
    }

    var btnAddFlavorPage = $('btn-add-master-flavor-page');
    if (btnAddFlavorPage && !btnAddFlavorPage.dataset.bound) {
      btnAddFlavorPage.dataset.bound = 'true';
      btnAddFlavorPage.addEventListener('click', function() {
        openMasterReferenceQuickAdd('flavor');
      });
    }

    var btnAddTitlePage = $('btn-add-master-title-page');
    if (btnAddTitlePage && !btnAddTitlePage.dataset.bound) {
      btnAddTitlePage.dataset.bound = 'true';
      btnAddTitlePage.addEventListener('click', function() {
        openMasterReferenceQuickAdd('title');
      });
    }

    // Tab Item menambah item lewat alur tambah-item yang sudah ada (Produk Master),
    // bukan alur master reference — item bukan master teks bebas.
    var btnAddItemPage = $('btn-add-master-item-page');
    if (btnAddItemPage && !btnAddItemPage.dataset.bound) {
      btnAddItemPage.dataset.bound = 'true';
      btnAddItemPage.addEventListener('click', function() {
        if (typeof window.openAddProduct === 'function') window.openAddProduct();
      });
    }

    // Tombol kembali di editor item (header mobile + breadcrumb "Kembali ke Daftar
    // Produk") diarahkan ke Master Category tab Item, bukan history stack.
    var itemEditorView = $('product-editor-view');
    if (itemEditorView) {
      itemEditorView.querySelectorAll('button').forEach(function (btn) {
        var isBackControl = btn.classList.contains('x-title-back-btn') ||
          /Kembali ke Daftar Produk/.test(btn.textContent || '');
        if (!isBackControl || btn.dataset.itemBackBound) return;
        btn.dataset.itemBackBound = 'true';
        if (!btn.classList.contains('x-title-back-btn')) btn.textContent = '← Kembali ke Item';
        // Buang handler inline lama (history stack) supaya tidak jalan dua kali.
        btn.removeAttribute('onclick');
        btn.addEventListener('click', function (event) {
          event.preventDefault();
          if (typeof window.goBackFromItemEditor === 'function') window.goBackFromItemEditor();
        });
      });
    }

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


    var btnBackFromProductEditor = $('btn-back-from-product-editor');
    if (btnBackFromProductEditor && !btnBackFromProductEditor.dataset.bound) {
      btnBackFromProductEditor.dataset.bound = 'true';
      btnBackFromProductEditor.addEventListener('click', function () {
        goBackFromItemEditor();
      });
    }

    var btnCancelProductEditor = $('btn-cancel-product-editor');
    if (btnCancelProductEditor && !btnCancelProductEditor.dataset.bound) {
      btnCancelProductEditor.dataset.bound = 'true';
      btnCancelProductEditor.addEventListener('click', function () {
        goBackFromItemEditor();
      });
    }

    var radioCooked = $('prod-type-cooked');
    if (radioCooked && !radioCooked.dataset.bound) {
      radioCooked.dataset.bound = 'true';
      radioCooked.addEventListener('change', function () {
        updateProductInventoryTypeUI('COOKED');
      });
    }

    var radioDirect = $('prod-type-direct');
    if (radioDirect && !radioDirect.dataset.bound) {
      radioDirect.dataset.bound = 'true';
      radioDirect.addEventListener('change', function () {
        updateProductInventoryTypeUI('DIRECT');
        var stockToggle = $('prod-manage-stock-toggle');
        if (stockToggle && !stockToggle.checked) {
          stockToggle.checked = true;
          updateProductStockManageUI(true);
        }
      });
    }

    // Master Products Add buttons
    var btnAddProd = $('btn-add-product');
    if (btnAddProd) btnAddProd.addEventListener('click', window.openAddProduct);
    var btnAddProdMain = $('btn-add-product-main');
    if (btnAddProdMain) btnAddProdMain.addEventListener('click', window.openAddProduct);

    // Search and filter controls for Master Products
    // Filter client-side: dataset produk sudah ada di memori, jadi tanpa debounce.
    bindLiveSearch('prod-search-input', function (state) {
      _catalogState.searchQuery = state.query;
      renderMasterProductsTable();
    }, { debounce: 0 });

    var catFilterSelect = $('prod-filter-category');
    if (catFilterSelect) {
      catFilterSelect.addEventListener('change', function () {
        _catalogState.categoryFilter = catFilterSelect.value;
        renderProductCategoryFilterChips();
        renderMasterProductsTable();
      });
    }

    // Back to products from detail view
    var btnBack = $('btn-back-to-products');
    if (btnBack) {
      btnBack.addEventListener('click', function () {
        goBackFromChildPage();
      });
    }

    var btnCreateMenuFromDetail = $('btn-create-menu-from-detail');
    if (btnCreateMenuFromDetail) {
      btnCreateMenuFromDetail.addEventListener('click', function () {
        if (_catalogState.activeDetailProductId) {
          window.createMenuFromProduct(_catalogState.activeDetailProductId);
        }
      });
    }

    var btnEditFromDetail = $('btn-edit-from-detail');
    if (btnEditFromDetail) {
      btnEditFromDetail.addEventListener('click', function () {
        if (_catalogState.activeDetailProductId) {
          navigateTo('catalog/products/' + encodeURIComponent(_catalogState.activeDetailProductId) + '/edit');
        }
      });
    }


  

    // Menus View Buttons
    var btnSwitchAll = $('btn-menus-switch-all');
    if (btnSwitchAll) {
      btnSwitchAll.addEventListener('click', function () {
        var sel = $('dash-branch-context');
        if (sel) {
          sel.value = 'all';
          _branchContextState.selected = 'all';
        }
        loadMenusView();
      });
    }

    var btnMenusAddBranchCat = $('btn-menus-add-branch-category');
    if (btnMenusAddBranchCat) {
      btnMenusAddBranchCat.addEventListener('click', async function () {
        if (!XentraOwnerBranchCatalog.state.branchId) {
          showToast('❌ Pilih cabang terlebih dahulu.');
          return;
        }
        var name = await requestTextInputSheet({ title: 'Tambah Kategori Cabang', label: 'Nama Kategori' });
        if (!name || !name.trim()) return;

        try {
          var res = await adminFetch(API_BASE + '/admin/branches/' + XentraOwnerBranchCatalog.state.branchId + '/categories', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ name: name.trim() })
          });
          var data = await res.json();
          if (data.success) {
            showToast('✅ Kategori cabang berhasil dibuat!');
            loadMenusView();
          } else {
            showToast('❌ ' + (data.error || 'Gagal membuat kategori.'));
          }
        } catch (err) {
          showToast('❌ Kesalahan jaringan.');
        }
      });
    }

    // Master Product Image Picker
    var btnPick = $('btn-prod-image-pick');
    var prodFileInput = $('prod-image-file');
    var btnRemoveProd = $('btn-prod-image-remove');
    if (btnPick && prodFileInput) {
      btnPick.addEventListener('click', function () { prodFileInput.click(); });
      prodFileInput.addEventListener('change', function () {
        var file = prodFileInput.files && prodFileInput.files[0];
        if (!file) { _productImageFile = null; _productCropSpec = null; return; }
        _productImageRemoved = false;
        _productCropSpec = null;

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.');
          prodFileInput.value = '';
          return;
        }
        if (file.size > 20 * 1024 * 1024) {
          showToast('❌ Ukuran gambar melebihi batas maksimal 20MB.');
          prodFileInput.value = '';
          return;
        }

        _productImageFile = file;

        // Open reusable Crop Editor (M2)
        XentraCropEditor.open({
          source: file,
          assetType: 'product',
          aspectRatio: 1.0,
          title: 'Potong & Posisikan Foto Product (1:1)',
          onConfirm: function (cropSpec, previewDataUrl) {
            _productCropSpec = cropSpec;
            setProductImagePreview(previewDataUrl || URL.createObjectURL(file), true);
            showToast('✓ Potongan foto Product disesuaikan.');
          },
          onCancel: function () {
            _productImageFile = null;
            _productCropSpec = null;
            if (prodFileInput) prodFileInput.value = '';
          }
        });
      });
    }

    if (btnRemoveProd) {
      btnRemoveProd.addEventListener('click', function () {
        _productImageFile = null;
        _productCropSpec = null;
        _productImageRemoved = true;
        if (prodFileInput) prodFileInput.value = '';
        setProductImagePreview('', false);
      });
    }

    var stockManageToggle = $('prod-manage-stock-toggle');
    if (stockManageToggle && !stockManageToggle.dataset.bound) {
      stockManageToggle.dataset.bound = 'true';
      stockManageToggle.addEventListener('change', function () {
        updateProductStockManageUI(stockManageToggle.checked);
        if (stockManageToggle.checked) {
          var skuInput = $('prod-sku');
          if (skuInput) skuInput.focus();
        }
      });
    }

    // Item name is a first-class Master Item identity and the
    // authoritative Customer card title. Kategori is only the grouping/reference.
    // Form Master Item Submit
    // Canonical Product Editor submit: Product owns only atomic identity
    // Canonical Item Editor submit: Item owns only atomic identity,
    // SKU/media, internal description, and lifecycle. Menu owns customer
    // taxonomy, selling price, and commercial presentation.
    var formProduct = $('form-product');
    if (formProduct) {
      formProduct.addEventListener('submit', async function (e) {
        e.preventDefault();

        var id = $('prod-id').value;
        var manageStock = $('prod-manage-stock-toggle') ? $('prod-manage-stock-toggle').checked : false;
        var rawSku = String($('prod-sku').value || '').trim();
        if (manageStock && !rawSku) {
          showToast('❌ SKU wajib diisi jika kelola stok diaktifkan.');
          var skuEl = $('prod-sku');
          if (skuEl) skuEl.focus();
          return;
        }
        var sku = manageStock ? rawSku : null;
        var invType = ($('prod-type-direct') && $('prod-type-direct').checked) ? 'DIRECT' : 'COOKED';
        var costPrice = null;
        if (invType === 'DIRECT' && $('prod-cost-price')) {
          var rawCost = window.XentraCurrencyInput ? window.XentraCurrencyInput.getValue($('prod-cost-price')) : $('prod-cost-price').value.replace(/\D/g, '');
          costPrice = rawCost !== '' && !isNaN(Number(rawCost)) ? Number(rawCost) : null;
        }
        var payload = {
          name: $('prod-name').value.trim(),
          sku: sku || null,
          cost_price: costPrice,
          inventory_type: invType,
          description: $('prod-desc').value,
          is_active: id ? _productEditorActiveState : 1
        };

        if (!payload.name) {
          showToast('❌ Nama Item wajib diisi.');
          return;
        }

        var url = id
          ? (API_BASE + '/admin/composed/products/' + encodeURIComponent(id))
          : (API_BASE + '/admin/composed/products');
        var method = id ? 'PUT' : 'POST';

        try {
          var res = await adminFetch(url, {
            method: method,
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
          });
          var data = await res.json();
          if (!res.ok || !data.success) {
            var errCode = data.error || data.message || '';
            var errMsg = 'Gagal menyimpan Item.';
            if (errCode === 'PRODUCT_SKU_REMOVAL_BLOCKED_STOCK') {
              errMsg = 'Item ini masih memiliki stok di cabang. Nolkan stok terlebih dahulu sebelum mematikan pengelolaan stok (SKU).';
            } else if (errCode === 'PRODUCT_SKU_ALREADY_EXISTS') {
              errMsg = 'SKU sudah digunakan oleh Item lain.';
            } else if (errCode) {
              errMsg = errCode;
            }
            showToast('❌ ' + errMsg);
            return;
          }

          var savedId = (data.product && data.product.id) || id;
          if (!savedId) {
            showToast('❌ Item tersimpan tetapi ID Item tidak kembali dari server.');
            return;
          }

          if (_productImageRemoved) {
            var removeRes = await adminFetch(API_BASE + '/admin/media/entity/products/' + encodeURIComponent(savedId) + '/image', {
              method: 'DELETE',
              headers: getAuthHeaders()
            });
            var removeData = {};
            try {
              removeData = await removeRes.json();
            } catch (_) {
              removeData = { success: false, error: 'Gagal membaca respons penghapusan foto (HTTP ' + removeRes.status + ').' };
            }
            if (!removeRes.ok || !removeData.success) {
              showToast('❌ ' + (removeData.error || removeData.message || 'Gagal menghapus foto Product.'));
              return;
            }
          }

          if (_productImageFile && !_productImageRemoved) {
            var base64 = await new Promise(function (resolve, reject) {
              var imgReader = new FileReader();
              imgReader.onload = function () { resolve(imgReader.result); };
              imgReader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
              imgReader.readAsDataURL(_productImageFile);
            });

            var imagePayload = {
              image_base64: base64,
              mime_type: _productImageFile.type,
              original_filename: _productImageFile.name || null
            };
            if (_productCropSpec) imagePayload.crop_spec = _productCropSpec;

            var imageRes = await adminFetch(API_BASE + '/admin/media/entity/products/' + encodeURIComponent(savedId) + '/image', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify(imagePayload)
            });
            var imageData = {};
            try {
              imageData = await imageRes.json();
            } catch (_) {
              imageData = { success: false, error: 'Upload foto Product gagal (HTTP ' + imageRes.status + ').' };
            }
            if (!imageRes.ok || !imageData.success) {
              showToast('❌ ' + (imageData.error || imageData.message || 'Gagal mengunggah foto Item.'));
              return;
            }
          }

          showToast('✅ Item berhasil disimpan.');
          await loadMasterProducts();
          navigateTo('catalog/categories', { history: 'replace' });
        } catch (err) {
          showToast('❌ ' + ((err && err.message) || 'Gagal menyimpan Item.'));
        }
      });
    }
  }

  window.loadMasterProducts = loadMasterProducts;
  window.loadCatalog = loadCatalog;
  window.loadProductDetailView = loadProductDetailView;
  window.loadMasterCategoriesPage = loadMasterCategoriesPage;
  window.loadCategoryEditorPage = loadCategoryEditorPage;
  window.loadProductEditorPage = loadProductEditorPage;
  window.loadMenusView = loadMenusView;
  window.loadSingleBranchMenuView = loadSingleBranchMenuView;
  window.initCatalogListeners = initCatalogListeners;
  window.showProductListSection = showProductListSection;
  window.showProductDetailSection = showProductDetailSection;
  window.showProductEditorSection = showProductEditorSection;

  window.XentraCatalogModule = {
    loadMasterProducts: loadMasterProducts,
    loadCatalog: loadCatalog,
    loadProductDetailView: loadProductDetailView,
    loadMasterCategoriesPage: loadMasterCategoriesPage,
    loadCategoryEditorPage: loadCategoryEditorPage,
    loadProductEditorPage: loadProductEditorPage,
    loadMenusView: loadMenusView,
    loadSingleBranchMenuView: loadSingleBranchMenuView,
    initCatalogListeners: initCatalogListeners
  };

})(window, document);
