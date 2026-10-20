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

  var _ownerMasterMenuState = window._ownerMasterMenuState || { menus: [] };
  window._ownerMasterMenuState = _ownerMasterMenuState;

  function ownerMasterMenuTitle(menu) {
    if (!menu) return 'Menu';
    if (String(menu.menu_type).toUpperCase() === 'PACKAGE') {
      return menu.package_name || menu.sub_category_name || 'Paket';
    }
    return menu.title_name || menu.sub_category_name || 'Menu';
  }
  window.ownerMasterMenuTitle = ownerMasterMenuTitle;

  function requestTextInputSheet(options) {
    if (typeof window.requestTextInputSheet === 'function') {
      return window.requestTextInputSheet(options);
    }
    options = options || {};
    return Promise.resolve(window.prompt(options.title || 'Input', options.value || ''));
  }

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
    if (listView) listView.style.setProperty('display', 'block', 'important');
    if (detailView) detailView.style.setProperty('display', 'none', 'important');
    if (editorView) editorView.style.setProperty('display', 'none', 'important');
  }

  function showProductDetailSection() {
    var listView = $('product-list-view');
    var detailView = $('product-detail-view');
    var editorView = $('product-editor-view');
    if (listView) listView.style.setProperty('display', 'none', 'important');
    if (detailView) detailView.style.setProperty('display', 'block', 'important');
    if (editorView) editorView.style.setProperty('display', 'none', 'important');
  }

  function showProductEditorSection() {
    var listView = $('product-list-view');
    var detailView = $('product-detail-view');
    var editorView = $('product-editor-view');
    if (listView) listView.style.setProperty('display', 'none', 'important');
    if (detailView) detailView.style.setProperty('display', 'none', 'important');
    if (editorView) editorView.style.setProperty('display', 'block', 'important');
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

  var _ownerMasterProductStatusFilter = 'ACTIVE';

  function filterMasterProductsByStatus(status) {
    _ownerMasterProductStatusFilter = status;
    var pillAct = $('pill-prod-active');
    var pillInact = $('pill-prod-inactive');
    if (pillAct && pillInact) {
      if (status === 'ACTIVE') {
        pillAct.classList.add('active');
        pillInact.classList.remove('active');
      } else {
        pillAct.classList.remove('active');
        pillInact.classList.add('active');
      }
    }
    renderMasterProductsTable();
  }
  window.filterMasterProductsByStatus = filterMasterProductsByStatus;

  function getFilteredMasterProducts() {
    return state.products.filter(function (p) {
      if (_ownerMasterProductStatusFilter) {
        var isAct = p.is_active !== 0;
        if (_ownerMasterProductStatusFilter === 'ACTIVE' && !isAct) return false;
        if (_ownerMasterProductStatusFilter === 'INACTIVE' && isAct) return false;
      }
      if (!_catalogState.searchQuery) return true;
      var q = _catalogState.searchQuery.toLowerCase();
      return String(p.name || '').toLowerCase().indexOf(q) !== -1 ||
        String(p.description || '').toLowerCase().indexOf(q) !== -1 ||
        String(p.sku || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderMasterProductsTable() {
    var tbody = $('master-products-table-body');
    var cardsBox = $('master-products-cards-container');
    var filtered = getFilteredMasterProducts();

    if (cardsBox) {
      if (!filtered.length) {
        cardsBox.innerHTML = '<div class="x-empty-state text-center py-6 text-muted">Belum ada Product' + (_ownerMasterProductStatusFilter === 'INACTIVE' ? ' nonaktif' : '') + '.</div>';
      } else {
        cardsBox.innerHTML = filtered.map(function(prod) {
          var isActive = prod.is_active !== 0;
          var toggleSwitch = '' +
            '<label class="x-toggle' + (isActive ? ' x-toggle-on' : '') + '" title="' + (isActive ? 'Product aktif' : 'Product nonaktif') + '" style="margin:0;">' +
              '<input type="checkbox" ' + (isActive ? 'checked' : '') + ' onchange="toggleStock(\'' + esc(prod.id) + '\', this.checked ? 1 : 0)" aria-label="Status Product ' + esc(prod.name) + '">' +
              '<span class="x-toggle-slider"></span>' +
            '</label>';

          var chevronIcon = '<div class="x-hub-arrow" style="color:#c7c7cc;display:flex;align-items:center;margin-left:4px;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg></div>';

          var isDirect = prod.inventory_type === 'DIRECT';
          var iconBg = isDirect ? '#EA4335' : '#4285F4';
          var iconSrc = isDirect ? '/merchant-dashboard/assets/icons/reicon_food-tray-filled.svg' : '/merchant-dashboard/assets/icons/lucide-extended_cooking-pot-filled.svg';
          var iconAlt = isDirect ? 'Siap Jual' : 'Pakai Resep';

          var skuText = prod.sku ? prod.sku : (prod.description || 'Belum ada SKU');
          var costText = formatMoney(prod.cost_price || 0);

          return [
            '<div class="x-hub-card" style="align-items:center; cursor:pointer;" onclick="if (!event.target.closest(\'.x-toggle, .x-action-menu-trigger, .x-action-menu\')) { openEditProduct(\'' + esc(prod.id) + '\'); }">',
              '<div class="x-hub-icon" style="width:42px;height:42px;border-radius:12px;background:' + iconBg + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">',
                '<img src="' + iconSrc + '" width="22" height="22" alt="' + iconAlt + '" style="display:block;">',
              '</div>',
              '<div class="x-hub-info" style="flex:1 1 auto;min-width:0;margin-left:12px;">',
                '<h3 style="font-size:14px;font-weight:700;color:#0f172a;margin:0 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(prod.name) + '</h3>',
                '<div style="font-size:11px;color:#94a3b8;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(skuText) + '</div>',
                '<div style="font-size:12px;font-weight:700;color:#0f172a;">' + costText + '</div>',
              '</div>',
              '<div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">',
                toggleSwitch,
                chevronIcon,
              '</div>',
            '</div>'
          ].join('');
        }).join('');
      }
    }

    if (!tbody) return;

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

  // ── Master Reference Facade (extracted to catalog-reference.js) ──
  function showMasterCategoriesPage() {
    if (window.XentraCatalogReference && typeof window.XentraCatalogReference.showMasterCategoriesPage === 'function') {
      return window.XentraCatalogReference.showMasterCategoriesPage();
    }
  }
  function showCategoryEditorSection() {
    if (window.XentraCatalogReference && typeof window.XentraCatalogReference.showCategoryEditorSection === 'function') {
      return window.XentraCatalogReference.showCategoryEditorSection();
    }
  }
  function setMasterReferenceTab(type) {
    if (window.XentraCatalogReference && typeof window.XentraCatalogReference.setMasterReferenceTab === 'function') {
      return window.XentraCatalogReference.setMasterReferenceTab(type);
    }
  }
  function loadMasterCategoriesPage() {
    if (window.XentraCatalogReference && typeof window.XentraCatalogReference.loadMasterCategoriesPage === 'function') {
      return window.XentraCatalogReference.loadMasterCategoriesPage();
    }
    return Promise.resolve();
  }
  function loadCategoryEditorPage(id) {
    if (window.XentraCatalogReference && typeof window.XentraCatalogReference.loadCategoryEditorPage === 'function') {
      return window.XentraCatalogReference.loadCategoryEditorPage(id);
    }
    return Promise.resolve();
  }
  function renderMasterReferenceList(type) {
    if (window.XentraCatalogReference && typeof window.XentraCatalogReference.renderMasterReferenceList === 'function') {
      return window.XentraCatalogReference.renderMasterReferenceList(type);
    }
  }
  function renderMasterItemsList() {
    if (window.XentraCatalogReference && typeof window.XentraCatalogReference.renderMasterItemsList === 'function') {
      return window.XentraCatalogReference.renderMasterItemsList();
    }
  }
  function renderMasterCategoriesPage() {
    if (window.XentraCatalogReference && typeof window.XentraCatalogReference.renderMasterCategoriesPage === 'function') {
      return window.XentraCatalogReference.renderMasterCategoriesPage();
    }
  }
  function renderMasterFlavorsPage() {
    if (window.XentraCatalogReference && typeof window.XentraCatalogReference.renderMasterFlavorsPage === 'function') {
      return window.XentraCatalogReference.renderMasterFlavorsPage();
    }
  }
  function referenceRows(type) {
    if (window.XentraCatalogReference && typeof window.XentraCatalogReference.referenceRows === 'function') {
      return window.XentraCatalogReference.referenceRows(type);
    }
    return [];
  }
  function openMasterReferenceQuickAdd(type) {
    if (window.XentraCatalogReference && typeof window.XentraCatalogReference.openMasterReferenceQuickAdd === 'function') {
      return window.XentraCatalogReference.openMasterReferenceQuickAdd(type);
    }
  }
  function renderMasterMenuCustomerPreview() {
    if (window.XentraCatalogReference && typeof window.XentraCatalogReference.renderMasterMenuCustomerPreview === 'function') {
      return window.XentraCatalogReference.renderMasterMenuCustomerPreview();
    }
  }
  // Product Image State — explicitly scoped to the Product Editor.
  // The file stays in memory only until the Product save pipeline uploads it.
  var _productImageFile = null;
  var _productCropSpec = null;
  var _productImageRemoved = false;
  var _productOriginalImage = '';

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
      if (btnRemove) btnRemove.style.display = 'inline-flex';
      var pickText = $('btn-prod-image-pick-text');
      if (pickText) pickText.textContent = 'Ganti Foto';
      else if (btnPick) btnPick.textContent = '\ud83d\udcc1 Ganti Foto';
    } else {
      previewImg.removeAttribute('src');
      previewImg.style.display = 'none';
      emptyBox.style.display = 'flex';
      if (btnRemove) btnRemove.style.display = 'none';
      var pickText = $('btn-prod-image-pick-text');
      if (pickText) pickText.textContent = 'Pilih foto';
      else if (btnPick) btnPick.textContent = '\ud83d\udcc1 Pilih Foto';
    }
    renderMasterMenuCustomerPreview();
  }

  var _productEditorLoadSeq = 0;
  var _productEditorActiveState = 1;

  function generateSmartItemSku(name) {
    var raw = String(name || '').trim().toUpperCase();
    var words = raw.replace(/[^A-Z0-9\s]+/g, '').split(/\s+/).filter(Boolean);
    var prefix = '';
    if (words.length === 1) {
      prefix = words[0].slice(0, 6);
    } else if (words.length > 1) {
      prefix = words[0].slice(0, 4) + '-' + words[1].slice(0, 4);
    }
    if (!prefix) prefix = 'ITEM';
    var randDigits = Math.floor(1000 + Math.random() * 9000);
    return 'ITM-' + prefix + '-' + randDigits;
  }

  function updateProductEditorCtaState() {
    var isAdd = !$('prod-id') || !$('prod-id').value;
    var nameInput = $('prod-name');
    var nameVal = nameInput ? String(nameInput.value || '').trim() : '';
    var manageStock = $('prod-manage-stock-toggle') ? $('prod-manage-stock-toggle').checked : false;
    var skuInput = $('prod-sku');
    var skuVal = skuInput ? String(skuInput.value || '').trim() : '';

    var isDataFilled = nameVal.length > 0 && (!manageStock || skuVal.length > 0);

    // 1. Simpan CTA
    var btnSave = $('btn-save-product-editor');
    if (btnSave) {
      if (isDataFilled) {
        btnSave.disabled = false;
        btnSave.style.background = '#00A637';
        btnSave.style.color = '#FFFFFF';
        btnSave.style.cursor = 'pointer';
        btnSave.style.opacity = '1';
        btnSave.style.boxShadow = '0 2px 8px rgba(0, 166, 55, 0.25)';
      } else {
        btnSave.disabled = true;
        btnSave.style.background = '#E2E8F0';
        btnSave.style.color = '#94A3B8';
        btnSave.style.cursor = 'not-allowed';
        btnSave.style.opacity = '0.85';
        btnSave.style.boxShadow = 'none';
      }
    }

    // 2. Hapus CTA
    var btnDelete = $('btn-delete-item-editor');
    if (btnDelete) {
      if (isAdd) {
        btnDelete.disabled = true;
        btnDelete.style.background = '#F1F5F9';
        btnDelete.style.color = '#94A3B8';
        btnDelete.style.cursor = 'not-allowed';
        btnDelete.style.opacity = '0.45';
        btnDelete.style.pointerEvents = 'none';
      } else {
        btnDelete.disabled = false;
        btnDelete.style.background = '#FEE2E2';
        btnDelete.style.color = '#EF4444';
        btnDelete.style.cursor = 'pointer';
        btnDelete.style.opacity = '1';
        btnDelete.style.pointerEvents = 'auto';
      }
    }
  }

  function updateProductStockManageUI(hasStockManagement) {
    var toggle = $('prod-manage-stock-toggle');
    var container = $('prod-sku-container');
    var skuInput = $('prod-sku');
    var note = $('prod-stock-note');
    if (toggle) toggle.checked = !!hasStockManagement;
    if (container) container.style.display = hasStockManagement ? 'block' : 'none';
    if (skuInput) {
      skuInput.required = !!hasStockManagement;
      if (!hasStockManagement) {
        skuInput.value = '';
      } else if (!skuInput.value.trim()) {
        var nameInput = $('prod-name');
        skuInput.value = generateSmartItemSku(nameInput ? nameInput.value : '');
      }
    }
    if (note) {
      note.textContent = hasStockManagement
        ? 'data item ini digunakan sebagai acuan inventaris di tiap cabang'
        : 'item non-stock tetap bisa di pakai untuk membuat menu';
    }
    updateProductEditorCtaState();
  }

  function updateProductInventoryTypeUI(type) {
    var isDirect = String(type).toUpperCase() === 'DIRECT';
    var radioCooked = $('prod-type-cooked');
    var radioDirect = $('prod-type-direct');
    if (radioCooked) radioCooked.checked = !isDirect;
    if (radioDirect) radioDirect.checked = isDirect;

    var toggleCooked = $('toggle-prod-type-cooked');
    var toggleDirect = $('toggle-prod-type-direct');
    if (toggleCooked) toggleCooked.checked = !isDirect;
    if (toggleDirect) toggleDirect.checked = isDirect;

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

    var costCard = $('card-prod-cost-price');
    var costGroup = $('group-prod-cost-price');
    if (costCard) costCard.style.display = isDirect ? 'block' : 'none';
    if (costGroup) costGroup.style.display = isDirect ? 'block' : 'none';

    var recipeCard = $('card-prod-recipe-cost-info');
    var recipeGroup = $('group-prod-recipe-cost-info');
    if (recipeCard) recipeCard.style.display = isDirect ? 'none' : 'block';
    if (recipeGroup) recipeGroup.style.display = isDirect ? 'none' : 'block';

    var stockNote = $('prod-stock-note');
    if (stockNote) {
      if (isDirect) {
        stockNote.textContent = 'Barang dagang siap jual dipantau stok fisiknya dan otomatis masuk Ceklist Belanja saat menipis.';
      } else {
        stockNote.textContent = 'item non-stock tetap bisa di pakai untuk membuat menu';
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
    if ($('prod-recipe-status-text')) $('prod-recipe-status-text').textContent = 'Belum Ada Resep';
    if ($('prod-recipe-subtext')) $('prod-recipe-subtext').textContent = 'Formula bahan dapat ditambahkan setelah item disimpan di tab Resep Makanan';
    if ($('prod-recipe-cost-display')) $('prod-recipe-cost-display').textContent = 'Rp0';
    if ($('prod-recipe-components-preview')) {
      $('prod-recipe-components-preview').innerHTML = '<div style="color:#64748B;font-size:11px;">Belum ada resep terkait item ini</div>';
      $('prod-recipe-components-preview').style.display = 'block';
    }
    var linkContainer = $('container-link-goto-recipe');
    var linkGoto = $('link-goto-recipe');
    if (linkContainer) linkContainer.style.display = 'none';
    if (linkGoto) {
      linkGoto.style.display = 'none';
      delete linkGoto.dataset.recipeId;
    }
    updateProductInventoryTypeUI('COOKED');
    updateProductStockManageUI(false);
    _productEditorActiveState = 1;
    _productImageFile = null;
    _productCropSpec = null;
    _productImageRemoved = false;
    _productOriginalImage = '';
    var fileInput = $('prod-image-file');
    if (fileInput) fileInput.value = '';
    setProductImagePreview('', false);
    updateProductEditorCtaState();
  }

  function populateProductEditorForm(prod) {
    var itemTitle = 'Item: ' + (prod.name || '');
    $('product-editor-title').textContent = itemTitle;
    $('prod-editor-breadcrumb').textContent = prod.name;
    $('prod-editor-subtitle').textContent = 'Perbarui data item. Menu tetap dikelola di workspace Master Menu.';
    if ($('product-editor-mobile-title')) $('product-editor-mobile-title').textContent = itemTitle;
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
    var linkContainer = $('container-link-goto-recipe');
    var linkGoto = $('link-goto-recipe');

    if (recipe && (recipe.cost_per_unit > 0 || (recipe.components && recipe.components.length > 0))) {
      if ($('prod-recipe-status-text')) $('prod-recipe-status-text').textContent = recipe.name || 'Resep Terdaftar';
      if ($('prod-recipe-subtext')) $('prod-recipe-subtext').textContent = 'Formula bahan baku otomatis (' + (recipe.yield_quantity || 1) + ' ' + (recipe.yield_uom_name || 'porsi') + ')';
      if ($('prod-recipe-cost-display')) $('prod-recipe-cost-display').textContent = formatMoney(recipe.cost_per_unit || 0);
      if (previewEl && Array.isArray(recipe.components) && recipe.components.length > 0) {
        var compList = recipe.components.slice(0, 3).map(function(c) {
          return '<div style="margin-bottom:3px;">+ ' + esc(c.material_name) + ' (' + c.planned_quantity + ' ' + esc(c.uom_name) + ')</div>';
        }).join('');
        if (recipe.components.length > 3) {
          compList += '<div style="color:#64748B;font-size:11px;margin-top:2px;">+ dan bahan lainnya</div>';
        }
        previewEl.innerHTML = compList;
        previewEl.style.display = 'block';
      } else if (previewEl) {
        previewEl.innerHTML = '<div style="color:#64748B;font-size:11px;">Belum ada rincian bahan</div>';
        previewEl.style.display = 'block';
      }

      if (recipe.id) {
        if (linkContainer) linkContainer.style.display = 'block';
        if (linkGoto) {
          linkGoto.style.display = 'inline-flex';
          linkGoto.dataset.recipeId = recipe.id;
        }
      } else {
        if (linkContainer) linkContainer.style.display = 'none';
        if (linkGoto) {
          linkGoto.style.display = 'none';
          delete linkGoto.dataset.recipeId;
        }
      }
    } else {
      if ($('prod-recipe-status-text')) $('prod-recipe-status-text').textContent = 'Belum Ada Resep';
      if ($('prod-recipe-subtext')) $('prod-recipe-subtext').textContent = 'Atur komposisi bahan di tab Resep Makanan untuk menghitung HPP otomatis';
      if ($('prod-recipe-cost-display')) $('prod-recipe-cost-display').textContent = formatMoney(prod.cost_price || 0);
      if (previewEl) {
        previewEl.innerHTML = '<div style="color:#64748B;font-size:11px;">Belum ada resep terkait item ini</div>';
        previewEl.style.display = 'block';
      }
      if (linkContainer) linkContainer.style.display = 'none';
      if (linkGoto) {
        linkGoto.style.display = 'none';
        delete linkGoto.dataset.recipeId;
      }
    }

    _productEditorActiveState = (prod.is_active !== undefined && prod.is_active !== null) ? (prod.is_active !== 0 ? 1 : 0) : 1;
    _productImageFile = null;
    _productCropSpec = null;
    _productImageRemoved = false;
    var fileInput = $('prod-image-file');
    if (fileInput) fileInput.value = '';
    var existingImage = prod.image_url || prod.image || '';
    _productOriginalImage = existingImage;
    setProductImagePreview(existingImage, existingImage !== '');
    updateProductEditorCtaState();
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
      if ($('product-editor-view') && $('product-editor-view').style.display !== 'none') {
        goBackFromItemEditor();
      } else if (_catalogState.activeDetailProductId === id) {
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

    // Master reference listeners extracted to catalog-reference.js
    if (typeof window.initMasterReferenceListeners === 'function') {
      window.initMasterReferenceListeners();
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

    function selectProductInventoryType(type) {
      updateProductInventoryTypeUI(type);
      if (String(type).toUpperCase() === 'DIRECT') {
        var stockToggle = $('prod-manage-stock-toggle');
        if (stockToggle && !stockToggle.checked) {
          stockToggle.checked = true;
          updateProductStockManageUI(true);
        }
      }
    }

    var radioCooked = $('prod-type-cooked');
    if (radioCooked && !radioCooked.dataset.bound) {
      radioCooked.dataset.bound = 'true';
      radioCooked.addEventListener('change', function () {
        selectProductInventoryType('COOKED');
      });
    }

    var radioDirect = $('prod-type-direct');
    if (radioDirect && !radioDirect.dataset.bound) {
      radioDirect.dataset.bound = 'true';
      radioDirect.addEventListener('change', function () {
        selectProductInventoryType('DIRECT');
      });
    }

    var toggleCooked = $('toggle-prod-type-cooked');
    if (toggleCooked && !toggleCooked.dataset.bound) {
      toggleCooked.dataset.bound = 'true';
      toggleCooked.addEventListener('change', function () {
        selectProductInventoryType('COOKED');
      });
    }

    var rowCooked = $('row-prod-type-cooked');
    if (rowCooked && !rowCooked.dataset.bound) {
      rowCooked.dataset.bound = 'true';
      rowCooked.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('label.x-toggle')) return;
        selectProductInventoryType('COOKED');
      });
    }

    var toggleDirect = $('toggle-prod-type-direct');
    if (toggleDirect && !toggleDirect.dataset.bound) {
      toggleDirect.dataset.bound = 'true';
      toggleDirect.addEventListener('change', function () {
        selectProductInventoryType('DIRECT');
      });
    }

    var rowDirect = $('row-prod-type-direct');
    if (rowDirect && !rowDirect.dataset.bound) {
      rowDirect.dataset.bound = 'true';
      rowDirect.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('label.x-toggle')) return;
        selectProductInventoryType('DIRECT');
      });
    }

    var linkGotoRecipe = $('link-goto-recipe');
    if (linkGotoRecipe && !linkGotoRecipe.dataset.bound) {
      linkGotoRecipe.dataset.bound = 'true';
      linkGotoRecipe.addEventListener('click', function (e) {
        e.preventDefault();
        var recipeId = linkGotoRecipe.dataset.recipeId;
        var prodId = $('prod-id') ? $('prod-id').value : '';
        if (recipeId && typeof window.openEditRecipeForProduct === 'function') {
          window.openEditRecipeForProduct(prodId, recipeId);
        } else if (recipeId && typeof window.openEditRecipeModal === 'function') {
          window.openEditRecipeModal(recipeId);
        } else if (typeof window.switchOwnerBusinessTab === 'function') {
          window.switchOwnerBusinessTab('stock', 'recipes');
        } else if (typeof window.switchStockSubtab === 'function') {
          if (typeof window.switchTab === 'function') window.switchTab('stock');
          window.switchStockSubtab('recipes');
        }
      });
    }

    // Master Products Add buttons
    var btnAddProd = $('btn-add-product');
    if (btnAddProd) btnAddProd.addEventListener('click', window.openAddProduct);
    var btnAddProdMain = $('btn-add-product-main');
    if (btnAddProdMain) btnAddProdMain.addEventListener('click', window.openAddProduct);
    var btnAddProdRound = $('btn-add-item-round');
    if (btnAddProdRound) btnAddProdRound.addEventListener('click', window.openAddProduct);

    // Post-Save Item Prompt Modal actions (Frame 240.png)
    var btnSavedLater = $('btn-modal-saved-later');
    if (btnSavedLater && !btnSavedLater.dataset.bound) {
      btnSavedLater.dataset.bound = 'true';
      btnSavedLater.addEventListener('click', function () {
        hideItemSavedPromptModal();
        if (typeof window.goBackFromItemEditor === 'function') {
          window.goBackFromItemEditor();
        } else {
          navigateTo('catalog/categories', { history: 'replace' });
        }
      });
    }

    var btnSavedCreateMenu = $('btn-modal-saved-create-menu');
    if (btnSavedCreateMenu && !btnSavedCreateMenu.dataset.bound) {
      btnSavedCreateMenu.dataset.bound = 'true';
      btnSavedCreateMenu.addEventListener('click', function () {
        var idToUse = _pendingSavedProductId;
        hideItemSavedPromptModal();
        if (idToUse && typeof window.createMenuFromProduct === 'function') {
          window.createMenuFromProduct(idToUse);
        } else if (typeof window.goBackFromItemEditor === 'function') {
          window.goBackFromItemEditor();
        } else {
          navigateTo('catalog/categories', { history: 'replace' });
        }
      });
    }

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

    var prodNameInput = $('prod-name');
    if (prodNameInput && !prodNameInput.dataset.bound) {
      prodNameInput.dataset.bound = 'true';
      prodNameInput.addEventListener('input', function () {
        var stockToggle = $('prod-manage-stock-toggle');
        var skuInput = $('prod-sku');
        if (stockToggle && stockToggle.checked && skuInput && !skuInput.value.trim()) {
          skuInput.value = generateSmartItemSku(prodNameInput.value);
        }
        updateProductEditorCtaState();
      });
    }

    var prodSkuInput = $('prod-sku');
    if (prodSkuInput && !prodSkuInput.dataset.bound) {
      prodSkuInput.dataset.bound = 'true';
      prodSkuInput.addEventListener('input', function () {
        updateProductEditorCtaState();
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

    var btnGenSku = $('btn-generate-sku');
    if (btnGenSku && !btnGenSku.dataset.bound) {
      btnGenSku.dataset.bound = 'true';
      btnGenSku.addEventListener('click', function () {
        var skuInput = $('prod-sku');
        var nameInput = $('prod-name');
        if (skuInput) {
          skuInput.value = generateSmartItemSku(nameInput ? nameInput.value : '');
          skuInput.focus();
          if (typeof showToast === 'function') {
            showToast('✨ SKU otomatis dibuat: ' + skuInput.value);
          }
          updateProductEditorCtaState();
        }
      });
    }

    var btnDeleteItem = $('btn-delete-item-editor');
    if (btnDeleteItem && !btnDeleteItem.dataset.bound) {
      btnDeleteItem.dataset.bound = 'true';
      btnDeleteItem.addEventListener('click', function () {
        if (btnDeleteItem.disabled) return;
        var id = $('prod-id') ? $('prod-id').value : '';
        if (id && typeof window.deleteProduct === 'function') {
          window.deleteProduct(id);
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

        if ($('btn-save-product-editor') && $('btn-save-product-editor').disabled) {
          return;
        }

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
        var invType = (($('prod-type-direct') && $('prod-type-direct').checked) || ($('toggle-prod-type-direct') && $('toggle-prod-type-direct').checked)) ? 'DIRECT' : 'COOKED';
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
          showItemSavedPromptModal(savedId);
        } catch (err) {
          showToast('❌ ' + ((err && err.message) || 'Gagal menyimpan Item.'));
        }
      });
    }
  }

  var _pendingSavedProductId = null;

  function showItemSavedPromptModal(productId) {
    _pendingSavedProductId = productId;
    var modal = $('modal-item-saved-prompt');
    if (!modal) {
      if (typeof window.goBackFromItemEditor === 'function') {
        window.goBackFromItemEditor();
      } else {
        navigateTo('catalog/categories', { history: 'replace' });
      }
      return;
    }
    modal.classList.add('open');
    modal.style.setProperty('display', 'flex', 'important');
  }

  function hideItemSavedPromptModal() {
    var modal = $('modal-item-saved-prompt');
    if (modal) {
      modal.classList.remove('open');
      modal.style.setProperty('display', 'none', 'important');
    }
  }

  window.showItemSavedPromptModal = showItemSavedPromptModal;
  window.hideItemSavedPromptModal = hideItemSavedPromptModal;

  window.loadMasterProducts = loadMasterProducts;
  window.loadCatalog = loadCatalog;
  window.loadProductDetailView = loadProductDetailView;
  window.loadMasterCategoriesPage = (window.XentraCatalogReference && window.XentraCatalogReference.loadMasterCategoriesPage) || loadMasterCategoriesPage;
  window.loadCategoryEditorPage = (window.XentraCatalogReference && window.XentraCatalogReference.loadCategoryEditorPage) || loadCategoryEditorPage;
  window.loadProductEditorPage = loadProductEditorPage;
  window.loadMenusView = loadMenusView;
  window.loadSingleBranchMenuView = loadSingleBranchMenuView;
  window.initCatalogListeners = initCatalogListeners;
  window.showProductListSection = showProductListSection;
  window.showProductDetailSection = showProductDetailSection;
  window.showProductEditorSection = showProductEditorSection;
  window.showMasterCategoriesPage = (window.XentraCatalogReference && window.XentraCatalogReference.showMasterCategoriesPage) || showMasterCategoriesPage;
  window.showCategoryEditorSection = (window.XentraCatalogReference && window.XentraCatalogReference.showCategoryEditorSection) || showCategoryEditorSection;
  window.setMasterReferenceTab = (window.XentraCatalogReference && window.XentraCatalogReference.setMasterReferenceTab) || setMasterReferenceTab;
  window.renderMasterReferenceList = (window.XentraCatalogReference && window.XentraCatalogReference.renderMasterReferenceList) || renderMasterReferenceList;
  window.renderMasterItemsList = (window.XentraCatalogReference && window.XentraCatalogReference.renderMasterItemsList) || renderMasterItemsList;
  window.renderMasterCategoriesPage = (window.XentraCatalogReference && window.XentraCatalogReference.renderMasterCategoriesPage) || renderMasterCategoriesPage;
  window.renderMasterFlavorsPage = (window.XentraCatalogReference && window.XentraCatalogReference.renderMasterFlavorsPage) || renderMasterFlavorsPage;
  window.referenceRows = (window.XentraCatalogReference && window.XentraCatalogReference.referenceRows) || referenceRows;
  window.openMasterReferenceQuickAdd = (window.XentraCatalogReference && window.XentraCatalogReference.openMasterReferenceQuickAdd) || openMasterReferenceQuickAdd;
  window.renderMasterMenuCustomerPreview = (window.XentraCatalogReference && window.XentraCatalogReference.renderMasterMenuCustomerPreview) || renderMasterMenuCustomerPreview;

  window.XentraCatalogModule = {
    loadMasterProducts: loadMasterProducts,
    loadCatalog: loadCatalog,
    loadProductDetailView: loadProductDetailView,
    loadMasterCategoriesPage: window.loadMasterCategoriesPage,
    loadCategoryEditorPage: window.loadCategoryEditorPage,
    loadProductEditorPage: loadProductEditorPage,
    loadMenusView: loadMenusView,
    loadSingleBranchMenuView: loadSingleBranchMenuView,
    initCatalogListeners: initCatalogListeners,
    showProductListSection: showProductListSection,
    showProductDetailSection: showProductDetailSection,
    showProductEditorSection: showProductEditorSection,
    showMasterCategoriesPage: window.showMasterCategoriesPage,
    showCategoryEditorSection: window.showCategoryEditorSection,
    setMasterReferenceTab: window.setMasterReferenceTab,
    renderMasterReferenceList: window.renderMasterReferenceList,
    renderMasterItemsList: window.renderMasterItemsList,
    renderMasterCategoriesPage: window.renderMasterCategoriesPage,
    renderMasterFlavorsPage: window.renderMasterFlavorsPage,
    referenceRows: window.referenceRows,
    openMasterReferenceQuickAdd: window.openMasterReferenceQuickAdd,
    renderMasterMenuCustomerPreview: window.renderMasterMenuCustomerPreview
  };

})(window, document);
