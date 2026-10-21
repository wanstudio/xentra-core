/**
 * XENTRA OWNER DASHBOARD — MASTER MENU MODULE
 * Standalone modular controller for Master Menus (Single, Package, Ala Carte), Price Policies, and Recipes.
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
     OWNER MASTER MENU — CANONICAL COMMERCIAL MENU WORKSPACE
     Product remains an atomic stock/composition unit. This controller talks
     directly to /admin/menus/* and never uses the legacy customer catalog route.
     ========================================================================= */

  var _ownerMasterMenuState = window._ownerMasterMenuState || {
    menus: [],
    products: [],
    categories: [],
    titles: [],
    rasas: [],
    levels: [],
    search: '',
    typeFilter: 'all',
    editingId: null,
    editingType: 'SINGLE',
    createType: 'SINGLE',
    packageComponents: [],
    menuItems: []
  };
  window._ownerMasterMenuState = _ownerMasterMenuState;

  function upsertOwnerMasterMenuDependency(type, row, options) {
    options = options || {};
    if (!row || !row.id) return false;

    var listMap = {
      product: 'products',
      category: 'categories',
      title: 'titles',
      rasa: 'rasas'
    };
    var listName = listMap[type];
    if (!listName || !Array.isArray(_ownerMasterMenuState[listName])) return false;

    var list = _ownerMasterMenuState[listName];
    var index = list.findIndex(function(item) { return String(item.id) === String(row.id); });
    if (index >= 0) list[index] = Object.assign({}, list[index], row);
    else list.push(row);

    renderOwnerMasterMenuEditorForm();

    var selectId = options.selectId;
    var select = selectId ? $(selectId) : null;
    if (select) select.value = String(row.id);

    renderOwnerMasterMenuPreview();
    return true;
  }

  function addOwnerMasterMenuPackageProduct(product) {
    if (!product || !product.id) return false;
    var productId = String(product.id);
    var exists = (_ownerMasterMenuState.packageComponents || []).some(function(item) {
      return String(item.product_id || '') === productId;
    });
    if (exists) return false;

    var products = _ownerMasterMenuState.products || [];
    var index = products.findIndex(function(item) { return String(item.id) === productId; });
    if (index >= 0) products[index] = Object.assign({}, products[index], product);
    else products.push(product);

    _ownerMasterMenuState.packageComponents.push({ product_id: productId, quantity: 1 });
    renderOwnerMasterMenuPackageComponents();
    renderOwnerMasterMenuPreview();
    return true;
  }

  function ownerMasterMenuStatusLabel(status) {
    var value = String(status || '').toUpperCase();
    if (value === 'ACTIVE') return 'Aktif';
    if (value === 'ARCHIVED') return 'Arsip';
    return 'Draft';
  }

  function ownerMasterMenuTitle(menu) {
    if (!menu) return 'Menu';
    return menu.title_name || menu.package_name || menu.sub_category_name || 'Menu';
  }
  window.ownerMasterMenuTitle = ownerMasterMenuTitle;

  function ownerMasterMenuRasaLabel(name, title) {
    var value = String(name || '').trim();
    if (!value || value.toLowerCase() === 'original') return '';
    if (title && String(title).toLowerCase().includes(value.toLowerCase())) {
      return '';
    }
    return value;
  }

  function showOwnerMasterMenuList() {
    var list = $('master-menu-list-view');
    var editor = $('master-menu-editor-view');
    if (list) list.style.display = 'block';
    if (editor) editor.style.display = 'none';

    var mount = $('modern-menu-editor-mount');
    if (mount && typeof window.unmountMenuEditor === 'function') {
      window.unmountMenuEditor(mount);
      mount.style.display = 'none';
    }
  }

  function showOwnerMasterMenuEditor(menuId) {
    var list = $('master-menu-list-view');
    var editor = $('master-menu-editor-view');
    if (list) list.style.display = 'none';
    if (editor) editor.style.display = 'block';

    var mount = $('modern-menu-editor-mount');
    var legacyForm = $('form-master-menu');
    var legacyHeader = editor ? editor.querySelector('.x-product-editor-header') : null;
    var legacyBreadcrumb = editor ? editor.querySelector('.x-product-editor-breadcrumb-row') : null;

    if (mount && typeof window.mountMenuEditor === 'function') {
      mount.style.display = 'block';
      if (legacyForm) legacyForm.style.display = 'none';
      if (legacyHeader) legacyHeader.style.display = 'none';
      if (legacyBreadcrumb) legacyBreadcrumb.style.display = 'none';

      window.mountMenuEditor(mount, {
        menuId: menuId || null,
        apiBase: API_BASE || '/api/v1',
        token: localStorage.getItem('xentra_merchant_token'),
        onSaveSuccess: function() {
          showToast('✅ Menu berhasil disimpan.');
          if (typeof goBackFromChildPage === 'function') {
            goBackFromChildPage();
          } else {
            window.location.hash = '#catalog/master-menus';
          }
          if (typeof window.loadOwnerMasterMenusList === 'function') window.loadOwnerMasterMenusList();
        },
        onCancel: function() {
          if (typeof goBackFromChildPage === 'function') {
            goBackFromChildPage();
          } else {
            window.location.hash = '#catalog/master-menus';
          }
        }
      });
      return;
    }

    if (mount) mount.style.display = 'none';
    if (legacyForm) legacyForm.style.display = 'block';
    if (legacyHeader) legacyHeader.style.display = '';
    if (legacyBreadcrumb) legacyBreadcrumb.style.display = '';

    if (window.XentraDropdown && typeof window.XentraDropdown.refresh === 'function') {
      window.XentraDropdown.refresh();
    }
  }

  function ownerMasterMenuResetEditor(type) {
    var nextType = type === 'PACKAGE' ? 'PACKAGE' : 'SINGLE';
    _ownerMasterMenuState.editingId = null;
    _ownerMasterMenuState.editingType = nextType;
    _ownerMasterMenuState.createType = nextType;
    _ownerMasterMenuState.packageComponents = [];
    _ownerMasterMenuState.menuItems = [];

    $('master-menu-id').value = '';
    $('master-menu-type').value = nextType;
    $('cm-product').value = '';
    $('cm-package-name').value = '';
    var titleInput = $('cm-title-input');
    if (titleInput) titleInput.value = '';
    var charCount = $('cm-title-char-count');
    if (charCount) charCount.textContent = '0';
    var descInput = $('cm-description-input');
    if (descInput) descInput.value = '';
    _ownerMasterMenuState.descriptionCustomEdited = false;
    var priceMin = $('cm-price-min');
    if (priceMin) setOwnerMasterMenuMoney('cm-price-min', '');
    var priceMax = $('cm-price-max');
    if (priceMax) setOwnerMasterMenuMoney('cm-price-max', '');
    if (typeof switchPricePolicyMode === 'function') switchPricePolicyMode('FIXED');
    setOwnerMasterMenuMoney('cm-price', '');
    setOwnerMasterMenuMoney('cm-cost', '');
    $('cm-status').value = 'DRAFT';
    var activeToggle = $('cm-toggle-active');
    if (activeToggle) activeToggle.checked = true;
    $('cm-category').value = '';
    $('cm-rasa').value = '';

    var title = nextType === 'PACKAGE' ? 'Tambah Menu Paket' : 'Tambah Menu Satuan';
    $('master-menu-editor-title').textContent = title;
    $('master-menu-editor-breadcrumb').textContent = 'Tambah Menu';
    $('master-menu-editor-mobile-title').textContent = 'Tambah Menu';
    $('master-menu-editor-mobile-subtitle').textContent = nextType === 'PACKAGE'
      ? 'Susun nama paket, Product penyusun, taxonomy, dan harga Menu.'
      : 'Pilih Item penyusun, Judul, Rasa, Kategori, dan harga Menu.';

    var headerDel = $('btn-delete-master-menu-header');
    if (headerDel) headerDel.style.display = 'none';
    var actionDel = $('btn-delete-master-menu-action');
    if (actionDel) actionDel.style.display = 'none';
    var cancelBtn = $('btn-cancel-master-menu');
    if (cancelBtn) cancelBtn.style.width = '100%';

    resetOwnerMasterMenuImageState('');
    renderOwnerMasterMenuEditorForm();
  }

  function setOwnerMasterMenuMoney(id, value) {
    var el = $(id);
    if (!el) return;
    if (window.XentraCurrencyInput) window.XentraCurrencyInput.setValue(el, value == null ? '' : value);
    else el.value = value == null ? '' : value;
  }

  function getOwnerMasterMenuMoney(id) {
    var el = $(id);
    if (!el) return NaN;
    var raw = String(el.value || '').replace(/\D/g, '');
    if (!raw) return NaN;
    return window.XentraCurrencyInput ? Number(window.XentraCurrencyInput.getValue(el)) : Number(raw);
  }

  function ownerMasterMenuFindProduct(id) {
    return _ownerMasterMenuState.products.find(function(p) {
      return String(p.id) === String(id);
    }) || null;
  }

  function ownerMasterMenuPopulateSelect(selectId, rows, valueKey, labelFn, emptyLabel) {
    var select = $(selectId);
    if (!select) return;
    var html = '';
    if (emptyLabel !== undefined) {
      html += '<option value="">' + esc(emptyLabel) + '</option>';
    }
    (rows || []).forEach(function(row) {
      var id = String(row[valueKey || 'id'] || '');
      if (!id) return;
      var label = typeof labelFn === 'function' ? labelFn(row) : String(row.name || id);
      var inactive = row.is_active === 0 || row.is_active === false;
      html += '<option value="' + esc(id) + '"' +
        (inactive ? ' data-inactive="1" disabled' : '') + '>' +
        esc(label + (inactive ? ' (Nonaktif)' : '')) + '</option>';
    });
    select.innerHTML = html;
  }

  function renderOwnerMasterMenuTitles() {
    var select = $('cm-title');
    if (!select) return;
    var current = String(select.value || '');
    var rows = _ownerMasterMenuState.titles || [];
    var html = '<option value="">Pilih Judul Menu</option>';
    rows.forEach(function(row) {
      var inactive = row.is_active === 0 || row.is_active === false;
      html += '<option value="' + esc(row.id) + '"' +
        (inactive ? ' data-inactive="1" disabled' : '') + '>' +
        esc(row.name + (inactive ? ' (Nonaktif)' : '')) + '</option>';
    });
    select.innerHTML = html;
    if (current && rows.some(function(row) { return String(row.id) === current; })) {
      select.value = current;
    }
    if (window.XentraDropdown && typeof window.XentraDropdown.refresh === 'function') {
      window.XentraDropdown.refresh();
    }
  }

  function renderOwnerMasterMenuEditorForm() {
    var type = String(($('master-menu-type') && $('master-menu-type').value) || _ownerMasterMenuState.editingType || 'SINGLE').toUpperCase();
    _ownerMasterMenuState.editingType = type === 'PACKAGE' ? 'PACKAGE' : 'SINGLE';

    var single = $('master-menu-single-fields');
    var pkg = $('master-menu-package-fields');
    if (single) single.style.display = 'none';
    if (pkg) pkg.style.display = 'none';

    ownerMasterMenuPopulateSelect('cm-category', _ownerMasterMenuState.categories, 'id', function(row) { return row.name; }, 'Pilih Kategori');
    renderOwnerMasterMenuTitles();
    ownerMasterMenuPopulateSelect('cm-rasa', _ownerMasterMenuState.rasas, 'id', function(row) {
      return row.name;
    }, '-');

    renderOwnerMasterMenuItems();
    renderOwnerMasterMenuPackageComponents();
    renderOwnerMasterMenuPreview();
    if (window.XentraDropdown && typeof window.XentraDropdown.refresh === 'function') {
      window.XentraDropdown.refresh();
    }
  }

  var _pickItemSelectedProductId = null;
  var _pickItemActiveCategory = 'all';

  var _pickItemReplacingIndex = -1;

  function openPickItemSheet(replaceIndex) {
    _pickItemReplacingIndex = (typeof replaceIndex === 'number' && replaceIndex >= 0) ? replaceIndex : -1;
    _pickItemSelectedProductId = null;
    _pickItemActiveCategory = 'all';
    var searchInput = $('pick-item-search');
    if (searchInput) searchInput.value = '';

    renderPickItemCategories();
    renderPickItemList('', 'all');

    document.body.classList.add('x-sheet-open');
    var overlay = $('sheet-pick-item-overlay');
    var sheet = $('sheet-pick-item');
    var extClose = $('sheet-pick-item-ext-close');

    if (overlay) {
      overlay.style.display = 'block';
      setTimeout(function () { overlay.classList.add('open'); }, 10);
    }
    if (sheet) {
      sheet.style.display = 'flex';
      setTimeout(function () {
        sheet.classList.add('open');
        if (extClose) {
          if (window.innerWidth >= 769) {
            extClose.classList.remove('open');
          } else {
            var sheetH = sheet.offsetHeight || 380;
            extClose.style.bottom = (sheetH + 12) + 'px';
            extClose.classList.add('open');
          }
        }
      }, 20);
    }
  }

  function closePickItemSheet() {
    document.body.classList.remove('x-sheet-open');
    var extClose = $('sheet-pick-item-ext-close');
    var overlay = $('sheet-pick-item-overlay');
    var sheet = $('sheet-pick-item');

    if (extClose) extClose.classList.remove('open');
    if (overlay) {
      overlay.classList.remove('open');
      setTimeout(function () { overlay.style.display = 'none'; }, 260);
    }
    if (sheet) {
      sheet.classList.remove('open');
      setTimeout(function () { sheet.style.display = 'none'; }, 280);
    }
  }

  function renderPickItemCategories() {
    var pillContainer = $('pick-item-cat-pills');
    if (!pillContainer) return;

    var cats = _ownerMasterMenuState.categories || [];
    var html = '<button type="button" class="x-pick-item-pill' + (_pickItemActiveCategory === 'all' ? ' active' : '') + '" data-cat-id="all" onclick="filterPickItemCategory(\'all\')" style="padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;border:none;background:' + (_pickItemActiveCategory === 'all' ? '#0F172A' : '#F1F5F9') + ';color:' + (_pickItemActiveCategory === 'all' ? '#FFFFFF' : '#475569') + ';cursor:pointer;white-space:nowrap;">Semua</button>';

    cats.forEach(function(cat) {
      var isActive = String(cat.id) === String(_pickItemActiveCategory);
      html += '<button type="button" class="x-pick-item-pill' + (isActive ? ' active' : '') + '" data-cat-id="' + esc(cat.id) + '" onclick="filterPickItemCategory(\'' + esc(cat.id) + '\')" style="padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;border:none;background:' + (isActive ? '#0F172A' : '#F1F5F9') + ';color:' + (isActive ? '#FFFFFF' : '#475569') + ';cursor:pointer;white-space:nowrap;">' + esc(cat.name) + '</button>';
    });

    pillContainer.innerHTML = html;
  }

  function filterPickItemCategory(catId) {
    _pickItemActiveCategory = String(catId);
    renderPickItemCategories();
    var searchInput = $('pick-item-search');
    var query = searchInput ? searchInput.value : '';
    renderPickItemList(query, _pickItemActiveCategory);
  }

  function renderPickItemList(query, catId) {
    var listContainer = $('pick-item-list-container');
    if (!listContainer) return;

    var q = String(query || '').trim().toLowerCase();
    var products = (_ownerMasterMenuState.products || []).filter(function(p) {
      var active = p.is_active !== 0 && p.is_active !== false;
      if (!active) return false;
      if (q && !(p.name || '').toLowerCase().includes(q)) return false;
      if (catId && catId !== 'all' && String(p.category_id || '') !== String(catId)) return false;
      return true;
    });

    if (!products.length) {
      listContainer.innerHTML = '<div style="text-align:center;padding:32px 16px;color:#94A3B8;font-size:13px;">Tidak ada item ditemukan</div>';
      return;
    }

    listContainer.innerHTML = products.map(function(p) {
      var isChecked = String(p.id) === String(_pickItemSelectedProductId);
      var cost = Number(p.cost_price || 0);
      var img = p.image_url || p.image || '';
      var imgHtml = img
        ? '<img src="' + esc(img) + '" alt="' + esc(p.name) + '" style="width:40px;height:40px;border-radius:8px;object-fit:cover;">'
        : '<div style="width:40px;height:40px;border-radius:8px;background:#F1F5F9;display:flex;align-items:center;justify-content:center;font-size:18px;">🍽️</div>';

      return '<label class="x-pick-item-card" style="display:flex;align-items:center;justify-content:space-between;padding:12px;border:1px solid ' + (isChecked ? '#0F172A' : '#E2E8F0') + ';border-radius:12px;cursor:pointer;background:' + (isChecked ? '#F8FAFC' : '#FFFFFF') + ';transition:all 0.15s ease;">' +
        '<div style="display:flex;align-items:center;gap:12px;">' +
          imgHtml +
          '<div>' +
            '<div style="font-size:14px;font-weight:600;color:#0F172A;">' + esc(p.name) + '</div>' +
            '<div style="font-size:12px;color:#64748B;">Modal: ' + formatMoney(cost) + '</div>' +
          '</div>' +
        '</div>' +
        '<input type="radio" name="pick_item_radio" value="' + esc(p.id) + '" ' + (isChecked ? 'checked' : '') + ' onchange="selectPickItemRadio(\'' + esc(p.id) + '\')" style="width:18px;height:18px;accent-color:#0F172A;cursor:pointer;">' +
      '</label>';
    }).join('');
  }

  function selectPickItemRadio(productId) {
    _pickItemSelectedProductId = String(productId);
    var searchInput = $('pick-item-search');
    var query = searchInput ? searchInput.value : '';
    renderPickItemList(query, _pickItemActiveCategory);
  }

  function confirmPickedItem() {
    if (!_pickItemSelectedProductId) {
      showToast('⚠️ Silakan pilih minimal 1 item.');
      return;
    }

    var selectedProd = ownerMasterMenuFindProduct(_pickItemSelectedProductId);
    if (!selectedProd) {
      showToast('⚠️ Item tidak valid.');
      return;
    }

    // Cek apakah item sudah ada di daftar pada indeks lain
    var exists = (_ownerMasterMenuState.menuItems || []).some(function(item, idx) {
      if (_pickItemReplacingIndex >= 0 && idx === _pickItemReplacingIndex) return false;
      return String(item.product_id) === String(_pickItemSelectedProductId);
    });

    if (exists) {
      showToast('⚠️ Item ini sudah ada di dalam daftar menu.');
      closePickItemSheet();
      return;
    }

    // Mode ganti item pada baris yang dipilih
    if (_pickItemReplacingIndex >= 0 && _ownerMasterMenuState.menuItems[_pickItemReplacingIndex]) {
      _ownerMasterMenuState.menuItems[_pickItemReplacingIndex].product_id = String(_pickItemSelectedProductId);
      if (_ownerMasterMenuState.packageComponents && _ownerMasterMenuState.packageComponents[_pickItemReplacingIndex]) {
        _ownerMasterMenuState.packageComponents[_pickItemReplacingIndex].product_id = String(_pickItemSelectedProductId);
      }
      _pickItemReplacingIndex = -1;
    } else {
      // Jika ada baris kosong pertama (product_id == ''), ganti baris itu
      var emptyIndex = (_ownerMasterMenuState.menuItems || []).findIndex(function(item) {
        return !item.product_id;
      });

      if (emptyIndex >= 0) {
        _ownerMasterMenuState.menuItems[emptyIndex].product_id = String(_pickItemSelectedProductId);
        _ownerMasterMenuState.menuItems[emptyIndex].quantity = 1;
      } else {
        _ownerMasterMenuState.menuItems.push({
          product_id: String(_pickItemSelectedProductId),
          quantity: 1
        });
      }
    }

    _ownerMasterMenuState.packageComponents = _ownerMasterMenuState.menuItems.slice();

    closePickItemSheet();
    renderOwnerMasterMenuItems();
    renderOwnerMasterMenuPreview();
  }

  window.openPickItemSheet = openPickItemSheet;
  window.closePickItemSheet = closePickItemSheet;
  window.filterPickItemCategory = filterPickItemCategory;
  window.selectPickItemRadio = selectPickItemRadio;
  window.confirmPickedItem = confirmPickedItem;

  function renderOwnerMasterMenuItems() {
    var box = $('cm-items-container');
    if (!box) return;
    var rows = _ownerMasterMenuState.menuItems || [];
    if (!rows.length) {
      box.innerHTML = '';
      return;
    }

    box.innerHTML = rows.map(function(item, index) {
      var options = '<option value="">Pilih Item</option>';
      var selectedProduct = null;
      _ownerMasterMenuState.products.forEach(function(product) {
        var inactive = product.is_active === 0 || product.is_active === false;
        var isSelected = String(item.product_id) === String(product.id);
        if (isSelected) selectedProduct = product;
        var label = product.name + (inactive ? ' (Nonaktif)' : '');
        options += '<option value="' + esc(product.id) + '"' +
          (isSelected ? ' selected' : '') +
          (inactive ? ' data-inactive="1" disabled' : '') + '>' +
          esc(label) + '</option>';
      });

      if (!selectedProduct && (item.name || item.options_config)) {
        selectedProduct = {
          id: item.product_id,
          name: item.name || 'Item',
          options_config: item.options_config
        };
      } else if (selectedProduct && item.options_config && !selectedProduct.options_config) {
        selectedProduct.options_config = item.options_config;
      }

      var displayText = selectedProduct ? selectedProduct.name : 'Pilih Item';
      var qty = Math.max(1, parseInt(item.quantity, 10) || 1);

      var variantDisplayHtml = '';
      if (selectedProduct && selectedProduct.options_config) {
        var optConfig = null;
        if (typeof selectedProduct.options_config === 'object') optConfig = selectedProduct.options_config;
        else {
          try { optConfig = JSON.parse(selectedProduct.options_config); } catch (_) {}
        }
        if (optConfig && Array.isArray(optConfig.variants)) {
          var activeVars = optConfig.variants.filter(function(v) { return !!v.active; });
          if (activeVars.length > 0) {
            var modeLabel = (optConfig.mode === 'MERCHANT') ? 'Kamu mengatur' : 'Pelanggan memilih';
            var varBlocks = activeVars.map(function(v) {
              var isPedas = (v.name === 'Pedas' || v.type === 'level');
              var isSuhu = (v.name === 'Suhu (Panas/Dingin)' || v.type === 'radio');

              if (isPedas) {
                var selectedLvl = Number(v.level) || 4;
                var chipColors = [
                  { bg: '#FEE2E2', border: '#FECACA' },
                  { bg: '#FCA5A5', border: '#F87171' },
                  { bg: '#F87171', border: '#EF4444' },
                  { bg: '#EF4444', border: '#DC2626' },
                  { bg: '#FFFFFF', border: '#CBD5E1' }
                ];
                var chipsHtml = [1, 2, 3, 4, 5].map(function(lvl) {
                  var isFilled = (lvl <= selectedLvl);
                  var style = isFilled
                    ? 'background:' + chipColors[lvl - 1].bg + ';border:1px solid ' + chipColors[lvl - 1].border + ';'
                    : 'background:#FFFFFF;border:1px solid #CBD5E1;';
                  return '<div style="width:32px;height:32px;border-radius:8px;flex:none;' + style + '"></div>';
                }).join('');

                return '<div class="x-cm-item-variant-block" style="border-top:1px solid #F1F5F9;padding-top:14px;width:100%;display:flex;flex-direction:column;gap:10px;">' +
                  '<div style="font-size:13px;font-weight:700;color:#0F172A;text-align:left;width:100%;">' + esc(modeLabel) + ': Pedas</div>' +
                  '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;">' +
                    '<div style="display:flex;gap:6px;align-items:center;">' +
                      chipsHtml +
                    '</div>' +
                    '<button type="button" class="x-btn-secondary x-composed-menu-component-remove" data-cm-item-remove="' + index + '" aria-label="Hapus Item" title="Hapus Item" style="width:36px;height:36px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:10px;border:1px solid #FECACA;background:#FFFFFF;color:#EF4444;cursor:pointer;flex-shrink:0;">' +
                      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
                        '<polyline points="3 6 5 6 21 6"></polyline>' +
                        '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>' +
                        '<line x1="10" y1="11" x2="10" y2="17"></line>' +
                        '<line x1="14" y1="11" x2="14" y2="17"></line>' +
                      '</svg>' +
                    '</button>' +
                  '</div>' +
                  '<button type="button" class="x-btn-edit-item-variant" data-product-id="' + esc(selectedProduct.id) + '" style="width:100%;height:38px;border-radius:10px;border:1px solid #E2E8F0;background:#F1F5F9;font-size:13px;font-weight:700;color:#0F172A;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:background 0.15s ease;">' +
                    '<span>Atur item</span>' +
                  '</button>' +
                '</div>';
              } else {
                var choices = Array.isArray(v.choices) && v.choices.length > 0 ? v.choices : (isSuhu ? ['Panas', 'Dingin'] : ['Manis', 'Tawar']);
                var choicesHtml = choices.map(function(c, cIdx) {
                  return '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;">' +
                    '<span style="font-size:13px;font-weight:700;color:#0F172A;">' + esc(c) + '</span>' +
                    '<span style="width:16px;height:16px;border-radius:50%;border:1.5px solid #94A3B8;display:inline-block;box-sizing:border-box;"></span>' +
                  '</div>';
                }).join('');

                return '<div class="x-cm-item-variant-block" style="border-top:1px solid #F1F5F9;padding-top:14px;width:100%;display:flex;flex-direction:column;gap:8px;">' +
                  '<div style="font-size:13px;font-weight:700;color:#0F172A;text-align:left;width:100%;">' + esc(modeLabel) + ': ' + esc(v.name) + '</div>' +
                  '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;width:100%;">' +
                    '<div style="width:170px;background:#FFFFFF;border:1px solid #CBD5E1;border-radius:10px;padding:8px 12px;display:flex;flex-direction:column;gap:4px;box-sizing:border-box;">' +
                      choicesHtml +
                    '</div>' +
                    '<button type="button" class="x-btn-secondary x-composed-menu-component-remove" data-cm-item-remove="' + index + '" aria-label="Hapus Item" title="Hapus Item" style="width:36px;height:36px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:10px;border:1px solid #FECACA;background:#FFFFFF;color:#EF4444;cursor:pointer;flex-shrink:0;">' +
                      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
                        '<polyline points="3 6 5 6 21 6"></polyline>' +
                        '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>' +
                        '<line x1="10" y1="11" x2="10" y2="17"></line>' +
                        '<line x1="14" y1="11" x2="14" y2="17"></line>' +
                      '</svg>' +
                    '</button>' +
                  '</div>' +
                  '<div style="font-size:11.5px;color:#64748B;line-height:1.4;margin-top:2px;text-align:left;width:100%;">pilihan akan muncul pada saat checkout</div>' +
                  '<button type="button" class="x-btn-edit-item-variant" data-product-id="' + esc(selectedProduct.id) + '" style="width:100%;height:38px;border-radius:10px;border:1px solid #E2E8F0;background:#F1F5F9;font-size:13px;font-weight:700;color:#0F172A;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:background 0.15s ease;">' +
                    '<span>Atur item</span>' +
                  '</button>' +
                '</div>';
              }
            }).join('');

            variantDisplayHtml = varBlocks;
          }
        }
      }

      return '<div class="x-composed-menu-component-row" data-cm-item-index="' + index + '" style="background:#FFFFFF;border:1px solid #CBD5E1;border-radius:16px;padding:14px 14px;display:flex;flex-direction:column;gap:12px;width:100%;box-sizing:border-box;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;">' +
          '<div style="flex:1;min-width:0;cursor:pointer;text-align:left;" onclick="openPickItemSheet(' + index + ')" title="Klik untuk ganti item">' +
            '<div style="font-size:14px;font-weight:700;color:#0F172A;line-height:1.3;text-align:left;word-break:break-word;">' +
              esc(displayText) +
            '</div>' +
            '<div style="font-size:12px;color:#0284C7;font-weight:600;margin-top:3px;display:inline-flex;align-items:center;gap:3px;text-align:left;">' +
              '<span>Ganti item</span>' +
              '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"></path></svg>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-shrink:0;">' +
            '<div style="display:inline-flex;align-items:center;border:1px solid #CBD5E1;border-radius:10px;background:#FFFFFF;height:36px;padding:0;">' +
              '<button type="button" class="x-stepper-btn-minus" data-cm-stepper-minus="' + index + '" aria-label="Kurangi Jumlah" title="Kurangi Jumlah" style="width:26px;height:34px;border:none;background:transparent;color:#0F172A;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>' +
              '</button>' +
              '<input type="number" class="x-input" min="1" step="1" inputmode="numeric" value="' + esc(qty) + '" data-cm-item-qty style="width:26px;height:34px;border:none;background:transparent;text-align:center;padding:0;font-size:14px;font-weight:700;color:#0F172A;border-radius:0;">' +
              '<button type="button" class="x-stepper-btn-plus" data-cm-stepper-plus="' + index + '" aria-label="Tambah Jumlah" title="Tambah Jumlah" style="width:26px;height:34px;border:none;background:transparent;color:#0F172A;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>' +
              '</button>' +
            '</div>' +
            '<button type="button" class="x-btn-secondary x-composed-menu-component-remove" data-cm-item-remove="' + index + '" aria-label="Hapus Item" title="Hapus Item" style="width:36px;height:36px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:10px;border:1px solid #FECACA;color:#EF4444;background:#FFFFFF;cursor:pointer;flex-shrink:0;">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
                '<polyline points="3 6 5 6 21 6"></polyline>' +
                '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>' +
                '<line x1="10" y1="11" x2="10" y2="17"></line>' +
                '<line x1="14" y1="11" x2="14" y2="17"></line>' +
              '</svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
        variantDisplayHtml +
        '<div class="x-cm-combobox" style="display:none;">' +
          '<input type="text" class="x-input x-cm-combobox-input" data-cm-item-input="' + index + '" value="' + esc(displayText) + '">' +
          '<div class="x-cm-combobox-menu" data-cm-item-menu="' + index + '"></div>' +
          '<select class="x-input" data-cm-item-product tabindex="-1" aria-hidden="true">' + options + '</select>' +
        '</div>' +
      '</div>';
    }).join('');

    function syncOwnerMasterMenuItemsFromDom() {
      var box = $('cm-items-container');
      if (!box) return;
      var rows = box.querySelectorAll('[data-cm-item-index]');
      if (!rows || !rows.length) return;
      var synced = [];
      rows.forEach(function(row) {
        var sel = row.querySelector('[data-cm-item-product]');
        var txt = row.querySelector('.x-cm-combobox-input');
        var qtyInput = row.querySelector('[data-cm-item-qty]');
        var prodId = (sel && sel.value) ? String(sel.value).trim() : '';
        if (!prodId && txt && txt.value.trim()) {
          var query = txt.value.trim().toLowerCase();
          var matched = _ownerMasterMenuState.products.find(function(p) {
            var active = p.is_active !== 0 && p.is_active !== false;
            return active && (p.name || '').trim().toLowerCase() === query;
          }) || _ownerMasterMenuState.products.find(function(p) {
            var active = p.is_active !== 0 && p.is_active !== false;
            return active && (p.name || '').toLowerCase().includes(query);
          });
          if (matched) prodId = String(matched.id);
        }
        var qty = qtyInput ? (parseInt(qtyInput.value, 10) || 1) : 1;
        synced.push({ product_id: prodId, quantity: qty });
      });
      if (synced.length > 0) {
        _ownerMasterMenuState.menuItems = synced;
        _ownerMasterMenuState.packageComponents = synced.slice();
      }
    }

    // Stepper minus & plus listeners
    box.querySelectorAll('[data-cm-stepper-minus]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var index = Number(btn.dataset.cmStepperMinus);
        if (_ownerMasterMenuState.menuItems[index]) {
          var curQty = Math.max(1, parseInt(_ownerMasterMenuState.menuItems[index].quantity, 10) || 1);
          if (curQty > 1) {
            _ownerMasterMenuState.menuItems[index].quantity = curQty - 1;
            if (_ownerMasterMenuState.packageComponents[index]) {
              _ownerMasterMenuState.packageComponents[index].quantity = curQty - 1;
            }
            renderOwnerMasterMenuItems();
            renderOwnerMasterMenuPreview();
          } else {
            // curQty <= 1: decrementing automatically removes item from menu (same as customer cart)
            _ownerMasterMenuState.menuItems.splice(index, 1);
            if (_ownerMasterMenuState.packageComponents[index]) {
              _ownerMasterMenuState.packageComponents.splice(index, 1);
            }
            renderOwnerMasterMenuItems();
            renderOwnerMasterMenuPreview();
          }
        }
      });
    });

    box.querySelectorAll('[data-cm-stepper-plus]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var index = Number(btn.dataset.cmStepperPlus);
        if (_ownerMasterMenuState.menuItems[index]) {
          var curQty = Math.max(1, parseInt(_ownerMasterMenuState.menuItems[index].quantity, 10) || 1);
          _ownerMasterMenuState.menuItems[index].quantity = curQty + 1;
          if (_ownerMasterMenuState.packageComponents[index]) {
            _ownerMasterMenuState.packageComponents[index].quantity = curQty + 1;
          }
          renderOwnerMasterMenuItems();
          renderOwnerMasterMenuPreview();
        }
      });
    });

    box.querySelectorAll('[data-cm-item-qty]').forEach(function(input) {
      input.addEventListener('change', function() {
        var row = input.closest('[data-cm-item-index]');
        var index = row ? Number(row.dataset.cmItemIndex) : -1;
        if (index >= 0) {
          var val = Math.max(1, parseInt(input.value, 10) || 1);
          if (_ownerMasterMenuState.menuItems[index]) {
            _ownerMasterMenuState.menuItems[index].quantity = val;
          }
          if (_ownerMasterMenuState.packageComponents[index]) {
            _ownerMasterMenuState.packageComponents[index].quantity = val;
          }
          input.value = val;
          renderOwnerMasterMenuPreview();
        }
      });
    });

    box.querySelectorAll('[data-cm-item-remove]').forEach(function(button) {
      button.addEventListener('click', function() {
        syncOwnerMasterMenuItemsFromDom();
        var index = Number(button.dataset.cmItemRemove);
        _ownerMasterMenuState.menuItems.splice(index, 1);
        _ownerMasterMenuState.packageComponents.splice(index, 1);
        renderOwnerMasterMenuItems();
        renderOwnerMasterMenuPreview();
      });
    });

    box.querySelectorAll('.x-btn-edit-item-variant').forEach(function(button) {
      button.addEventListener('click', function(e) {
        e.stopPropagation();
        var prodId = button.dataset.productId;
        if (prodId) {
          if (typeof window.openEditProduct === 'function') {
            window.openEditProduct(prodId);
          } else if (typeof window.editProduct === 'function') {
            window.editProduct(prodId);
          }
        }
      });
    });

    // Auto-compose description jika belum diedit manual oleh user
    var descInput = $('cm-description-input');
    if (descInput) {
      if (!descInput._hasListener) {
        descInput._hasListener = true;
        descInput.addEventListener('input', function() {
          _ownerMasterMenuState.descriptionCustomEdited = !!descInput.value.trim();
          renderOwnerMasterMenuPreview();
        });
      }
      if (!_ownerMasterMenuState.descriptionCustomEdited) {
        var autoParts = [];
        (_ownerMasterMenuState.menuItems || []).forEach(function(it) {
          var prod = ownerMasterMenuFindProduct(it.product_id);
          if (!prod) return;
          var q = Math.max(1, parseInt(it.quantity, 10) || 1);
          autoParts.push((q > 1 ? q + ' ' : '') + prod.name);
        });
        descInput.value = autoParts.join(' + ');
      }
    }

    if (window.XentraDropdown && typeof window.XentraDropdown.refresh === 'function') {
      window.XentraDropdown.refresh();
    }
  }

  function addOwnerMasterMenuItem() {
    openPickItemSheet();
  }

  function renderOwnerMasterMenuPackageComponents() {
    var box = $('cm-package-components');
    if (!box) return;
    var rows = _ownerMasterMenuState.packageComponents || [];
    if (!rows.length) {
      box.innerHTML = '<div class="x-empty-state text-muted">Belum ada Product. Tambahkan minimal dua unit.</div>';
      return;
    }

    box.innerHTML = rows.map(function(item, index) {
      var options = '<option value="">Pilih Product</option>';
      _ownerMasterMenuState.products.forEach(function(product) {
        var inactive = product.is_active === 0 || product.is_active === false;
        options += '<option value="' + esc(product.id) + '"' +
          (String(item.product_id) === String(product.id) ? ' selected' : '') +
          (inactive ? ' data-inactive="1" disabled' : '') + '>' +
          esc(product.name + (inactive ? ' (Nonaktif)' : '')) + '</option>';
      });
      return '<div class="x-composed-menu-component-row" data-cm-component-index="' + index + '">' +
        '<div class="x-composed-menu-component-product">' +
          '<label>Product ' + (index + 1) + '</label>' +
          '<select class="x-input" data-cm-product>' + options + '</select>' +
        '</div>' +
        '<div class="x-composed-menu-component-qty">' +
          '<label>Qty</label>' +
          '<input type="number" class="x-input" min="1" step="1" inputmode="numeric" value="' + esc(item.quantity || 1) + '" data-cm-qty>' +
        '</div>' +
        '<button type="button" class="x-btn-secondary x-composed-menu-component-remove" data-cm-remove="' + index + '" aria-label="Hapus Product dari paket">Hapus</button>' +
      '</div>';
    }).join('');

    box.querySelectorAll('[data-cm-product]').forEach(function(select) {
      select.addEventListener('change', function() {
        var row = select.closest('[data-cm-component-index]');
        var index = row ? Number(row.dataset.cmComponentIndex) : -1;
        if (index >= 0) _ownerMasterMenuState.packageComponents[index].product_id = select.value;
        renderOwnerMasterMenuPreview();
      });
    });
    box.querySelectorAll('[data-cm-qty]').forEach(function(input) {
      input.addEventListener('input', function() {
        var row = input.closest('[data-cm-component-index]');
        var index = row ? Number(row.dataset.cmComponentIndex) : -1;
        if (index >= 0) _ownerMasterMenuState.packageComponents[index].quantity = input.value;
        renderOwnerMasterMenuPreview();
      });
    });
    box.querySelectorAll('[data-cm-remove]').forEach(function(button) {
      button.addEventListener('click', function() {
        var index = Number(button.dataset.cmRemove);
        _ownerMasterMenuState.packageComponents.splice(index, 1);
        renderOwnerMasterMenuPackageComponents();
      });
    });
    if (window.XentraDropdown && typeof window.XentraDropdown.refresh === 'function') {
      window.XentraDropdown.refresh();
    }
  }

  function addOwnerMasterMenuPackageComponent() {
    _ownerMasterMenuState.packageComponents.push({ product_id: '', quantity: 1 });
    renderOwnerMasterMenuPackageComponents();
  }

  function ownerMasterMenuSelectedTitle() {
    var id = String(($('cm-title') && $('cm-title').value) || '');
    return _ownerMasterMenuState.titles.find(function(row) {
      return String(row.id) === id;
    }) || null;
  }

  function ownerMasterMenuSelectedRasa() {
    var id = String(($('cm-rasa') && $('cm-rasa').value) || '');
    return _ownerMasterMenuState.rasas.find(function(row) {
      return String(row.id) === id;
    }) || null;
  }

  function ownerMasterMenuSelectedLevel() {
    var toggle = $('cm-spice-toggle');
    if (toggle && toggle.checked) {
      var levelVal = Number(($('cm-spice-level-val') && $('cm-spice-level-val').value) || 1);
      return {
        name: 'Pedas',
        sort_order: Math.max(1, Math.min(4, levelVal))
      };
    }
    return null;
  }

  function setOwnerMasterMenuSpiceLevel(pos) {
    var val = Math.max(1, Math.min(4, Number(pos) || 1));
    var valInput = $('cm-spice-level-val');
    if (valInput) valInput.value = String(val);
    var dots = document.querySelectorAll('#cm-spice-dots-row .x-spice-dot-btn');
    dots.forEach(function(dot) {
      var p = Number(dot.dataset.spicePos);
      var active = p <= val;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-checked', p === val ? 'true' : 'false');
    });
    renderOwnerMasterMenuPreview();
  }

  // Menu Presentation Media state — scoped to the Master Menu editor.
  // The Menu owns its customer-facing photo (docs/decisions/xentra-menu-presentation-media-v1.md).
  // The file stays in memory until the Menu save pipeline uploads it.
  var _masterMenuImageFile = null;
  var _masterMenuCropSpec = null;
  var _masterMenuImageRemoved = false;
  var _masterMenuImagePreviewSrc = '';

  function setOwnerMasterMenuImagePreview(src, hasImage) {
    var previewImg = $('cm-image-preview');
    var emptyBox = $('cm-image-empty');
    var btnRemove = $('btn-cm-image-remove');
    var btnPick = $('btn-cm-image-pick');
    if (!previewImg || !emptyBox) return;
    if (hasImage && src) {
      previewImg.src = src;
      previewImg.style.display = 'block';
      emptyBox.style.display = 'none';
      if (btnRemove) btnRemove.style.display = 'inline-flex';
      if (btnPick) btnPick.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg> <span>Ganti foto</span>';
    } else {
      previewImg.removeAttribute('src');
      previewImg.style.display = 'none';
      emptyBox.style.display = 'flex';
      if (btnRemove) btnRemove.style.display = 'none';
      if (btnPick) btnPick.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg> <span>Pilih foto</span>';
    }
  }

  function resetOwnerMasterMenuImageState(existingSrc) {
    _masterMenuImageFile = null;
    _masterMenuCropSpec = null;
    _masterMenuImageRemoved = false;
    _masterMenuImagePreviewSrc = existingSrc || '';
    var fileInput = $('cm-image-file');
    if (fileInput) fileInput.value = '';
    var removedFlag = $('cm-image-removed');
    if (removedFlag) removedFlag.value = '0';
    setOwnerMasterMenuImagePreview(_masterMenuImagePreviewSrc, !!_masterMenuImagePreviewSrc);
  }

  function renderOwnerMasterMenuPreview() {
    var titleEl = $('cm-preview-title');
    var subtitleEl = $('cm-preview-subtitle');
    var detailEl = $('cm-preview-detail');
    var indicatorEl = $('cm-preview-indicator');
    var priceEl = $('cm-preview-price');
    var imageEl = $('cm-preview-image');
    var emptyEl = $('cm-preview-image-empty');
    if (!titleEl || !subtitleEl || !detailEl || !priceEl) return;

    var titleObj = ownerMasterMenuSelectedTitle();
    var rasa = ownerMasterMenuSelectedRasa();
    var levelName = '';
    var levelPosition = 0;
    var selectedLevel = ownerMasterMenuSelectedLevel();
    if (selectedLevel) {
      levelName = String(selectedLevel.name || '');
      levelPosition = Number(selectedLevel.sort_order);
      if (!Number.isFinite(levelPosition) || levelPosition < 1) levelPosition = 1;
      levelPosition = Math.min(4, Math.floor(levelPosition));
    }
    var detail = '';
    var image = '';
    var title = '';

    var titleInputVal = String(($('cm-title-input') && $('cm-title-input').value) || '').trim();
    if (titleInputVal) {
      title = titleInputVal;
    } else if (titleObj) {
      title = titleObj.name;
    } else {
      title = String(($('cm-package-name') && $('cm-package-name').value) || '').trim() || 'Judul Menu';
    }

    var rasaLabel = rasa ? ownerMasterMenuRasaLabel(rasa.name, title) : '';

    var items = (_ownerMasterMenuState.menuItems && _ownerMasterMenuState.menuItems.length)
      ? _ownerMasterMenuState.menuItems
      : (_ownerMasterMenuState.packageComponents || []);

    if (items.length > 0) {
      detail = items.map(function(item) {
        var product = ownerMasterMenuFindProduct(item.product_id);
        if (!product) return null;
        var qty = Number(item.quantity || 1);
        return product.name + (qty > 1 ? ' × ' + qty : '');
      }).filter(Boolean).join(' · ');
    } else {
      var singleProd = ownerMasterMenuFindProduct($('cm-product') && $('cm-product').value);
      if (singleProd) detail = 'Item: ' + singleProd.name;
    }

    image = _masterMenuImagePreviewSrc || '';

    titleEl.textContent = title;
    subtitleEl.textContent = rasaLabel;
    detailEl.textContent = detail;
    priceEl.textContent = formatMoney(getOwnerMasterMenuMoney('cm-price') || 0);

    var previewItemsListEl = $('cm-preview-items-list');
    var descInputVal = String(($('cm-description-input') && $('cm-description-input').value) || '').trim();
    var plainItemNames = [];
    if (items.length > 0) {
      items.forEach(function(item) {
        var prod = ownerMasterMenuFindProduct(item.product_id);
        if (!prod) return;
        var q = Math.max(1, parseInt(item.quantity, 10) || 1);
        plainItemNames.push((q > 1 ? q + ' ' : '') + prod.name);
      });
    }
    if (previewItemsListEl) {
      if (_ownerMasterMenuState.descriptionCustomEdited && descInputVal) {
        previewItemsListEl.textContent = descInputVal;
      } else if (plainItemNames.length > 0) {
        previewItemsListEl.textContent = plainItemNames.join(' + ');
      } else if (descInputVal) {
        previewItemsListEl.textContent = descInputVal;
      } else {
        previewItemsListEl.textContent = 'list item dalam menu';
      }
    }

    if (imageEl && emptyEl) {
      if (image) {
        imageEl.src = image;
        imageEl.alt = title;
        imageEl.style.display = 'block';
        emptyEl.style.display = 'none';
      } else {
        imageEl.removeAttribute('src');
        imageEl.alt = '';
        imageEl.style.display = 'none';
        emptyEl.style.display = 'inline-flex';
      }
    }

    // Hitung akumulasi modal menu otomatis dari items: (item 1 + item 2 + ...)
    var totalCost = 0;
    var formulaParts = [];
    var hppRowsHtml = '';
    var previewItemsArr = [];

    if (items.length > 0) {
      items.forEach(function(item, idx) {
        var product = ownerMasterMenuFindProduct(item.product_id);
        if (!product) return;
        var qty = Math.max(1, parseInt(item.quantity, 10) || 1);
        var itemCost = Number(product.cost_price || (product.recipe && product.recipe.cost_per_unit) || 0);
        var subTotal = itemCost * qty;
        totalCost += subTotal;

        var partText = esc(product.name) + ' (' + formatMoney(itemCost) + (qty > 1 ? ' × ' + qty : '') + ')';
        formulaParts.push(partText);
        previewItemsArr.push(esc(product.name) + (qty > 1 ? ' (' + qty + ')' : ''));

        var recipeBadge = (product.recipe && product.recipe.name)
          ? '<div style="font-size:11px;color:#16A34A;font-weight:600;margin-top:2px;">Resep: ' + esc(product.recipe.name) + ' (' + formatMoney(product.recipe.cost_per_unit) + '/porsi)</div>'
          : '';

        hppRowsHtml += '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:4px 0;border-bottom:1px dashed #E2E8F0;font-size:13px;">' +
          '<div>' +
            '<span style="color:#0F172A;font-weight:600;">' + esc(product.name) + (qty > 1 ? ' <span style="color:#64748B;">(' + qty + 'x)</span>' : '') + '</span>' +
            recipeBadge +
          '</div>' +
          '<span style="color:#0F172A;font-weight:700;">' + formatMoney(subTotal) + '</span>' +
        '</div>';
      });
    }

    setOwnerMasterMenuMoney('cm-cost', totalCost);
    var costDisplayEl = $('cm-cost-display');
    var costFormulaEl = $('cm-cost-formula');
    if (costDisplayEl) costDisplayEl.textContent = formatMoney(totalCost);
    if (costFormulaEl) {
      if (formulaParts.length > 0) {
        costFormulaEl.innerHTML = formulaParts.join(' + ') + ' = <strong>' + formatMoney(totalCost) + '</strong>';
      } else {
        costFormulaEl.textContent = 'Belum ada item dipilih';
      }
    }

    var hppListEl = $('cm-hpp-items-list');
    var hppTotalEl = $('cm-hpp-total-display');
    if (hppListEl) {
      if (hppRowsHtml) {
        hppListEl.innerHTML = hppRowsHtml;
      } else {
        hppListEl.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#94A3B8;"><span>item 1</span><span>Rp0</span></div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#94A3B8;"><span>item 2</span><span>Rp0</span></div>' +
          '<div style="font-size:12px;color:#CBD5E1;margin-top:-2px;">dst.</div>';
      }
    }
    if (hppTotalEl) {
      hppTotalEl.textContent = formatMoney(totalCost);
    }

    // Sinkronisasi status visual tombol Simpan (aktif hijau saat valid, abu-abu saat belum)
    var btnSaveActive = $('btn-save-master-menu-active');
    if (btnSaveActive) {
      var isTitleValid = !!(titleObj || ($('cm-title-input') && $('cm-title-input').value.trim()));
      var isCatValid = !!($('cm-category') && $('cm-category').value);
      var isPriceValid = (getOwnerMasterMenuMoney('cm-price') > 0) || (getOwnerMasterMenuMoney('cm-price-min') > 0 && getOwnerMasterMenuMoney('cm-price-max') > 0);
      var isFormReady = isTitleValid && isCatValid && isPriceValid;
      if (isFormReady) {
        btnSaveActive.style.background = '#00A637';
        btnSaveActive.style.color = '#FFFFFF';
        btnSaveActive.style.boxShadow = '0 2px 8px rgba(0, 166, 55, 0.25)';
      } else {
        btnSaveActive.style.background = '#E2E8F0';
        btnSaveActive.style.color = '#94A3B8';
        btnSaveActive.style.boxShadow = 'none';
      }
    }

    var previewItemsEl = $('cm-preview-items-list');
    if (previewItemsEl) {
      var descVal = ($('cm-description-input') && $('cm-description-input').value.trim()) || '';
      if (descVal) {
        previewItemsEl.textContent = descVal;
      } else {
        previewItemsEl.textContent = previewItemsArr.length > 0 ? previewItemsArr.join(' + ') : 'list item dalam menu';
      }
    }

    if (indicatorEl) {
      if (levelPosition > 0) {
        var indicatorHtml = '<span class="x-master-customer-preview-spice-label">Pedas</span>' +
          '<span class="x-master-customer-preview-spice-dots" aria-label="Level Pedas ' + levelPosition + ' dari 4">';
        for (var levelIndex = 1; levelIndex <= 4; levelIndex += 1) {
          indicatorHtml += '<span class="x-master-customer-preview-spice-dot' + (levelIndex <= levelPosition ? ' is-filled' : '') + '" aria-hidden="true"></span>';
        }
        indicatorHtml += '</span>';
        indicatorEl.innerHTML = indicatorHtml;
      } else {
        indicatorEl.innerHTML = '';
      }
    }
  }

  async function loadOwnerMasterMenuReferences() {
    var headers = getAuthHeaders();
    var results = await Promise.all([
      adminFetch(API_BASE + '/admin/composed/products?active_only=1', { headers: headers }).then(function(res){ return res.json(); }),
      adminFetch(API_BASE + '/admin/categories', { headers: headers }).then(function(res){ return res.json(); }),
      adminFetch(API_BASE + '/admin/rasas', { headers: headers }).then(function(res){ return res.json(); }),
      adminFetch(API_BASE + '/admin/menu-titles', { headers: headers }).then(function(res){ return res.json(); }).catch(function(){ return { success: true, titles: [] }; })
    ]);

    var productData = results[0] || {};
    var categoryData = results[1] || {};
    var rasaData = results[2] || {};
    var titleData = results[3] || {};

    if (!productData.success) throw new Error(productData.error || 'Produk Master gagal dimuat.');
    if (!categoryData.success) throw new Error(categoryData.error || 'Kategori gagal dimuat.');
    if (!rasaData.success) throw new Error(rasaData.error || 'Rasa gagal dimuat.');

    _ownerMasterMenuState.products = productData.products || [];
    _ownerMasterMenuState.categories = categoryData.categories || [];
    _ownerMasterMenuState.rasas = rasaData.rasas || [];
    _ownerMasterMenuState.titles = titleData.titles || [];
  }

  async function loadOwnerMasterMenus() {
    try {
      var res = await adminFetch(API_BASE + '/admin/menus', { headers: getAuthHeaders() });
      var data = await res.json();
      if (!data.success) throw new Error(data.error || 'Menu Master gagal dimuat.');
      _ownerMasterMenuState.menus = data.menus || [];
      renderOwnerMasterMenuList();
    } catch (err) {
      console.error('[Owner Master Menu Load Error]:', err);
      var box = $('master-menu-list');
      if (box) box.innerHTML = '<div class="x-empty-state text-muted">Gagal memuat Menu Master.</div>';
    }
  }

  var _ownerMasterMenuStatusFilter = 'ACTIVE';

  function filterMasterMenusByStatus(status) {
    _ownerMasterMenuStatusFilter = status;
    var pillAct = $('pill-menu-active');
    var pillInact = $('pill-menu-inactive');
    if (pillAct && pillInact) {
      if (status === 'ACTIVE') {
        pillAct.classList.add('active');
        pillInact.classList.remove('active');
      } else {
        pillAct.classList.remove('active');
        pillInact.classList.add('active');
      }
    }
    renderOwnerMasterMenuList();
  }
  window.filterMasterMenusByStatus = filterMasterMenusByStatus;

  function renderOwnerMasterMenuList() {
    var box = $('master-menu-list');
    if (!box) return;
    var query = String(_ownerMasterMenuState.search || '').trim().toLowerCase();
    var filter = String(_ownerMasterMenuState.typeFilter || 'all').toUpperCase();

    var menus = (_ownerMasterMenuState.menus || []).filter(function(menu) {
      if (_ownerMasterMenuStatusFilter) {
        var isAct = String(menu.status || 'DRAFT').toUpperCase() === 'ACTIVE';
        if (_ownerMasterMenuStatusFilter === 'ACTIVE' && !isAct) return false;
        if (_ownerMasterMenuStatusFilter === 'INACTIVE' && isAct) return false;
      }
      var hay = [
        ownerMasterMenuTitle(menu),
        menu.description || '',
        menu.category_name || '',
        menu.rasa_name || ''
      ].join(' ').toLowerCase();
      return (!query || hay.indexOf(query) !== -1) &&
        (filter === 'ALL' || String(menu.menu_type).toUpperCase() === filter);
    });

    if (!menus.length) {
      box.innerHTML = '<div class="x-empty-state text-center py-6 text-muted">Belum ada Menu Master' + (_ownerMasterMenuStatusFilter === 'INACTIVE' ? ' nonaktif' : '') + '.</div>';
      return;
    }

    box.innerHTML = menus.map(function(menu) {
      var type = String(menu.menu_type || '').toUpperCase();
      var title = ownerMasterMenuTitle(menu);
      var rasa = ownerMasterMenuRasaLabel(menu.rasa_name, title);
      var status = String(menu.status || 'DRAFT').toUpperCase();
      var typeLabel = type === 'PACKAGE' ? 'Paket' : 'Satuan';
      var statusClass = status === 'ACTIVE' ? 'x-badge-success' : (status === 'ARCHIVED' ? 'x-badge-warning' : 'x-badge-info');
      var taxonomy = [menu.category_name, menu.sub_category_name].filter(Boolean).join(' › ');
      // Thumbnail foto Menu (bukan foto Product), supaya Owner langsung melihat mana yang belum ada foto.
      var thumb = menu.image_url || menu.image || '';
      var thumbHtml = thumb
        ? '<img class="x-master-menu-card-thumb" src="' + esc(thumb) + '" alt="' + esc(title) + '" loading="lazy" decoding="async">'
        : '<span class="x-master-menu-card-thumb x-master-menu-card-thumb-empty" aria-hidden="true"></span>';
      var isActive = status === 'ACTIVE';
      var itemsList = menu.description || (menu.components || []).map(function(c) {
        var pName = c.product_name;
        if (!pName) {
          var p = ownerMasterMenuFindProduct(c.product_id);
          pName = p ? p.name : '';
        }
        if (!pName) return '';
        var q = Number(c.quantity || 1);
        return pName + (q > 1 ? ' × ' + q : '');
      }).filter(Boolean).join(' + ');

      return '<article class="x-master-menu-card" tabindex="0" role="button" aria-label="Buka editor menu ' + esc(title) + '" onclick="if (!event.target.closest(\'.x-toggle, .x-action-menu-trigger, .x-action-menu\')) { openEditOwnerMasterMenu(\'' + esc(menu.id) + '\'); }" onkeydown="if ((event.key === \'Enter\' || event.key === \' \') && !event.target.closest(\'.x-toggle, .x-action-menu-trigger, .x-action-menu\')) { event.preventDefault(); openEditOwnerMasterMenu(\'' + esc(menu.id) + '\'); }">' +
        '<div class="x-master-menu-card-left">' +
          thumbHtml +
          '<div class="x-master-menu-card-content">' +
            '<h4 class="x-master-menu-card-title">' + esc(title) + '</h4>' +
            (rasa ? '<div class="x-master-menu-card-rasa">' + esc(rasa) + '</div>' : '') +
            (itemsList ? '<div class="x-master-menu-card-items" title="' + esc(itemsList) + '">' + esc(itemsList) + '</div>' : '') +
            '<div class="x-master-menu-card-price">' + formatMoney(menu.selling_price) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="x-master-menu-card-right" style="display:flex;align-items:center;gap:10px;">' +
          '<label class="x-toggle' + (isActive ? ' x-toggle-on' : '') + '" title="' + (isActive ? 'Menu aktif (klik untuk nonaktifkan/arsipkan)' : 'Menu nonaktif (klik untuk aktifkan)') + '" style="margin:0;">' +
            '<input type="checkbox" ' + (isActive ? 'checked' : '') + ' onchange="toggleOwnerMasterMenuStatus(\'' + esc(menu.id) + '\', this)" aria-label="Status menu ' + esc(title) + '">' +
            '<span class="x-toggle-slider"></span>' +
          '</label>' +
          '<div class="x-hub-arrow" style="color:#c7c7cc;display:flex;align-items:center;margin-left:4px;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg></div>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  async function loadOwnerMasterMenuEditor(menuId) {
    showOwnerMasterMenuEditor(menuId);

    if (!menuId) {
      ownerMasterMenuResetEditor(_ownerMasterMenuState.createType);
      try {
        await loadOwnerMasterMenuReferences();
        if (_ownerMasterMenuState.preselectedProductId) {
          var preId = String(_ownerMasterMenuState.preselectedProductId);
          _ownerMasterMenuState.menuItems = [{ product_id: preId, quantity: 1 }];
          _ownerMasterMenuState.packageComponents = [{ product_id: preId, quantity: 1 }];
          if ($('cm-product')) $('cm-product').value = preId;
          _ownerMasterMenuState.preselectedProductId = null;
        } else {
          _ownerMasterMenuState.menuItems = [];
          _ownerMasterMenuState.packageComponents = [];
        }
        renderOwnerMasterMenuEditorForm();
      } catch (err) {
        console.error('[Owner Master Menu References Error]:', err);
        showToast('⚠️ Referensi Menu Master belum tersedia.');
      }
      return;
    }

    try {
      await loadOwnerMasterMenuReferences();
      var res = await adminFetch(API_BASE + '/admin/menus/' + encodeURIComponent(menuId), { headers: getAuthHeaders() });
      var data = await res.json();
      if (!data.success || !data.menu) throw new Error(data.error || 'Menu tidak ditemukan.');

      var menu = data.menu;
      var type = String(menu.menu_type || 'SINGLE').toUpperCase() === 'PACKAGE' ? 'PACKAGE' : 'SINGLE';
      _ownerMasterMenuState.editingId = menu.id;
      _ownerMasterMenuState.editingType = type;
      _ownerMasterMenuState.createType = type;
      _ownerMasterMenuState.menuItems = (menu.components || []).map(function(item) {
        return {
          product_id: String(item.product_id),
          quantity: Number(item.quantity),
          name: item.product_name,
          options_config: item.options_config
        };
      });
      _ownerMasterMenuState.packageComponents = (menu.components || []).map(function(item) {
        return {
          product_id: String(item.product_id),
          quantity: Number(item.quantity),
          name: item.product_name,
          options_config: item.options_config
        };
      });

      $('master-menu-id').value = String(menu.id);
      $('master-menu-type').value = type;
      if ($('cm-product')) $('cm-product').value = menu.components && menu.components[0] ? String(menu.components[0].product_id) : '';
      if ($('cm-package-name')) $('cm-package-name').value = menu.package_name || '';
      if ($('cm-category')) $('cm-category').value = menu.category_id ? String(menu.category_id) : '';
      if ($('cm-title')) $('cm-title').value = menu.title_id ? String(menu.title_id) : '';
      if ($('cm-rasa')) $('cm-rasa').value = menu.rasa_id ? String(menu.rasa_id) : '';
      setOwnerMasterMenuMoney('cm-price', menu.selling_price != null ? menu.selling_price : '');
      setOwnerMasterMenuMoney('cm-cost', menu.cost_price != null ? menu.cost_price : '');
      if ($('cm-status')) $('cm-status').value = String(menu.status || 'DRAFT').toUpperCase();

      var spiceToggle = $('cm-spice-toggle');
      var spiceWrapper = $('cm-spice-scale-wrapper');
      var spiceEnabled = Number(menu.spice_enabled) === 1 || Boolean(menu.spice_level) || (menu.level && menu.level.value > 0);
      var spiceLevel = menu.spice_level ? Number(menu.spice_level) : (menu.level && menu.level.value ? Number(menu.level.value) : 1);
      if (spiceToggle) {
        spiceToggle.checked = spiceEnabled;
        if (spiceWrapper) spiceWrapper.style.display = spiceEnabled ? 'inline-flex' : 'none';
        if (spiceEnabled) setOwnerMasterMenuSpiceLevel(spiceLevel);
      }

      var menuTitle = ownerMasterMenuTitle(menu);
      $('master-menu-editor-title').textContent = 'Edit Menu';
      $('master-menu-editor-breadcrumb').textContent = menuTitle;
      $('master-menu-editor-mobile-title').textContent = 'Menu: ' + (menuTitle || 'Edit Menu');
      $('master-menu-editor-mobile-subtitle').textContent = 'Perbarui Judul, Kategori, Komposisi Item, Harga, dan Status.';

      var headerDel = $('btn-delete-master-menu-header');
      if (headerDel) {
        headerDel.style.display = 'inline-flex';
        headerDel.onclick = function(e) {
          if (e) e.preventDefault();
          deleteOwnerMasterMenu(menu.id, menuTitle);
        };
      }
      var actionDel = $('btn-delete-master-menu-action');
      if (actionDel) {
        actionDel.style.display = 'inline-flex';
        actionDel.onclick = function(e) {
          if (e) e.preventDefault();
          deleteOwnerMasterMenu(menu.id, menuTitle);
        };
      }
      var cancelBtn = $('btn-cancel-master-menu');
      if (cancelBtn) cancelBtn.style.width = '50%';

      var categoryVal = menu.category_id || (menu.category && menu.category.id) || '';
      var titleVal = menu.title_id || (menu.title_ref && menu.title_ref.id) || '';
      var rasaVal = menu.rasa_id || (menu.rasa && menu.rasa.id) || '';
      var priceVal = menu.selling_price != null ? menu.selling_price : (menu.price != null ? menu.price : '');
      var costVal = menu.cost_price != null ? menu.cost_price : '';

      renderOwnerMasterMenuEditorForm();
      if ($('cm-category')) $('cm-category').value = String(categoryVal);
      if ($('cm-title')) $('cm-title').value = String(titleVal);
      var titleInputEl = $('cm-title-input');
      var titleName = menu.title_name || (menu.title_ref && menu.title_ref.name) || menu.package_name || '';
      if (titleInputEl) {
        titleInputEl.value = titleName;
        var countEl = $('cm-title-char-count');
        if (countEl) countEl.textContent = titleName.length;
      }
      var descInputEl = $('cm-description-input');
      if (descInputEl) {
        descInputEl.value = menu.description || '';
        _ownerMasterMenuState.descriptionCustomEdited = false;
      }
      if ($('cm-rasa')) $('cm-rasa').value = String(rasaVal);
      setOwnerMasterMenuMoney('cm-price', priceVal);
      setOwnerMasterMenuMoney('cm-cost', costVal);
      var statusUpper = String(menu.status || 'DRAFT').toUpperCase();
      if ($('cm-status')) $('cm-status').value = statusUpper;
      var activeToggle = $('cm-toggle-active');
      if (activeToggle) activeToggle.checked = statusUpper === 'ACTIVE';

      resetOwnerMasterMenuImageState(menu.image_url || menu.preview_url || menu.image || '');
      renderOwnerMasterMenuItems();
      renderOwnerMasterMenuPackageComponents();
      renderOwnerMasterMenuPreview();
    } catch (err) {
      console.error('[Owner Master Menu Editor Load Error]:', err);
      showToast('❌ ' + (err.message || 'Gagal memuat Menu Master.'));
      navigateTo('catalog/master-menus');
    }
  }

  async function saveOwnerMasterMenu(statusOverride) {
    var menuId = String(($('master-menu-id') && $('master-menu-id').value) || '');
    var activeToggle = $('cm-toggle-active');
    var isToggleActive = activeToggle ? activeToggle.checked : true;
    var status = statusOverride || (isToggleActive ? 'ACTIVE' : 'DRAFT');
    var price = getOwnerMasterMenuMoney('cm-price');
    var priceMin = getOwnerMasterMenuMoney('cm-price-min');
    var priceMax = getOwnerMasterMenuMoney('cm-price-max');
    if ((!Number.isFinite(price) || price <= 0) && (priceMin > 0 || priceMax > 0)) {
      price = priceMin > 0 ? priceMin : priceMax;
    }
    if (!Number.isFinite(price) || price < 0) {
      showToast('❌ Harga Menu tidak valid.');
      return;
    }
    var cost = getOwnerMasterMenuMoney('cm-cost');
    if (!Number.isFinite(cost)) cost = 0;
    if (!Number.isFinite(cost) || cost < 0) {
      showToast('❌ Modal Menu tidak valid.');
      return;
    }

    var categoryId = String(($('cm-category') && $('cm-category').value) || '') || null;
    var titleId = null;
    var titleInputText = String(($('cm-title-input') && $('cm-title-input').value) || '').trim();
    var rasaEl = $('cm-rasa');
    var isRasaVisible = rasaEl && rasaEl.offsetParent !== null && !rasaEl.closest('[style*="display:none"], [style*="display: none"]');
    var rasaId = isRasaVisible ? (String(rasaEl.value || '').trim() || null) : null;

    var spiceToggle = $('cm-spice-toggle');
    var spiceEnabled = spiceToggle ? spiceToggle.checked : false;
    var spiceLevel = spiceEnabled ? Number(($('cm-spice-level-val') && $('cm-spice-level-val').value) || 1) : null;

    if (!categoryId) {
      showToast('❌ Kategori wajib dipilih.');
      return;
    }

    if (!titleInputText) {
      showToast('❌ Judul Menu wajib diisi.');
      return;
    }

    // Always resolve titleId from titleInputText so that editing menu name works reliably
    var existingT = (_ownerMasterMenuState.titles || []).find(function(t) {
      return (t.name || '').trim().toLowerCase() === titleInputText.toLowerCase();
    });
    if (existingT) {
      titleId = String(existingT.id);
    } else {
      try {
        var tRes = await adminFetch(API_BASE + '/admin/menu-titles', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ name: titleInputText })
        });
        var tData = await tRes.json();
        if (tData.success && tData.title) {
          titleId = String(tData.title.id);
          _ownerMasterMenuState.titles.push(tData.title);
        }
      } catch (e) {
        console.warn('[Auto Title Error]:', e);
      }
    }

    if (!titleId) {
      // Backend auto-resolves title if omitted but title_name is passed
      titleId = null;
    }

    // Read items primarily from state, falling back to DOM or package components
    var itemsList = [];
    if (_ownerMasterMenuState.menuItems && _ownerMasterMenuState.menuItems.length > 0) {
      itemsList = _ownerMasterMenuState.menuItems;
    } else {
      var itemsBox = $('cm-items-container');
      if (itemsBox) {
        var domRows = itemsBox.querySelectorAll('[data-cm-item-index]');
        if (domRows && domRows.length > 0) {
          domRows.forEach(function(row) {
            var sel = row.querySelector('[data-cm-item-product]');
            var txt = row.querySelector('.x-cm-combobox-input');
            var qtyInput = row.querySelector('[data-cm-item-qty]');
            var prodId = (sel && sel.value) ? String(sel.value).trim() : '';
            if (!prodId && txt && txt.value.trim()) {
              var query = txt.value.trim().toLowerCase();
              var matched = _ownerMasterMenuState.products.find(function(p) {
                var active = p.is_active !== 0 && p.is_active !== false;
                return active && (p.name || '').trim().toLowerCase() === query;
              }) || _ownerMasterMenuState.products.find(function(p) {
                var active = p.is_active !== 0 && p.is_active !== false;
                return active && (p.name || '').toLowerCase().includes(query);
              });
              if (matched) prodId = String(matched.id);
            }
            var qty = qtyInput ? (parseInt(qtyInput.value, 10) || 1) : 1;
            if (prodId) {
              itemsList.push({ product_id: prodId, quantity: qty });
            }
          });
        }
      }
    }

    if (!itemsList.length) {
      itemsList = _ownerMasterMenuState.packageComponents || [];
    }
    if (!itemsList.length && $('cm-product') && $('cm-product').value) {
      itemsList = [{ product_id: $('cm-product').value, quantity: 1 }];
    }

    var seen = {};
    var validItems = [];
    for (var i = 0; i < itemsList.length; i++) {
      var item = itemsList[i];
      var pId = String(item.product_id || '').trim();
      var qty = Number(item.quantity);
      if (!pId) continue;
      if (!Number.isSafeInteger(qty) || qty <= 0) {
        showToast('❌ Qty Item harus bilangan bulat positif.');
        return;
      }
      if (seen[pId]) {
        showToast('❌ Satu Item tidak boleh muncul dua kali dalam Menu.');
        return;
      }
      seen[pId] = true;
      validItems.push({ product_id: pId, quantity: qty });
    }

    if (validItems.length === 0) {
      showToast('❌ Minimal 1 Item harus dipilih untuk Menu.');
      return;
    }

    try {
      var endpoint = menuId ? API_BASE + '/admin/menus/' + encodeURIComponent(menuId) : API_BASE + '/admin/menus';
      var method = menuId ? 'PUT' : 'POST';

      var payload = {
        category_id: categoryId,
        categoryId: categoryId,
        title_id: titleId,
        titleId: titleId,
        title_name: titleInputText,
        titleName: titleInputText,
        package_name: titleInputText,
        packageName: titleInputText,
        rasa_id: rasaId,
        rasaId: rasaId,
        description: ($('cm-description-input') && $('cm-description-input').value.trim()) || null,
        spice_enabled: spiceEnabled,
        spiceEnabled: spiceEnabled,
        spice_level: spiceLevel,
        spiceLevel: spiceLevel,
        selling_price: price,
        sellingPrice: price,
        price: price,
        min_price: priceMin || price,
        max_price: priceMax || price,
        cost_price: cost,
        costPrice: cost,
        cost: cost,
        items: validItems,
        status: status,
        is_active: status === 'ACTIVE',
        isActive: status === 'ACTIVE'
      };

      var res = await adminFetch(endpoint, {
        method: method,
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Gagal menyimpan Menu Master.');

      // Foto Menu diproses SETELAH Menu tersimpan, memakai canonical Media Engine
      // (docs/decisions/xentra-menu-presentation-media-v1.md).
      var savedMenuId = (data.menu && data.menu.id) || menuId;
      if (!savedMenuId) {
        showToast('❌ Menu tersimpan tetapi ID Menu tidak kembali dari server.');
        return;
      }

      if (_masterMenuImageRemoved) {
        var removeRes = await adminFetch(API_BASE + '/admin/media/entity/menus/' + encodeURIComponent(savedMenuId) + '/image', {
          method: 'DELETE',
          headers: getAuthHeaders()
        });
        var removeData = {};
        try {
          removeData = await removeRes.json();
        } catch (_) {
          removeData = { success: false, error: 'Gagal membaca respons penghapusan foto Menu (HTTP ' + removeRes.status + ').' };
        }
        if (!removeRes.ok || !removeData.success) {
          showToast('❌ ' + (removeData.error || removeData.message || 'Gagal menghapus foto Menu.'));
          return;
        }
      }

      if (_masterMenuImageFile && !_masterMenuImageRemoved) {
        var menuImageBase64 = await new Promise(function(resolve, reject) {
          var menuImgReader = new FileReader();
          menuImgReader.onload = function() { resolve(menuImgReader.result); };
          menuImgReader.onerror = function() { reject(new Error('Gagal membaca file gambar.')); };
          menuImgReader.readAsDataURL(_masterMenuImageFile);
        });

        var menuImagePayload = {
          image_base64: menuImageBase64,
          mime_type: _masterMenuImageFile.type,
          original_filename: _masterMenuImageFile.name || null
        };
        if (_masterMenuCropSpec) menuImagePayload.crop_spec = _masterMenuCropSpec;

        var menuImageRes = await adminFetch(API_BASE + '/admin/media/entity/menus/' + encodeURIComponent(savedMenuId) + '/image', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(menuImagePayload)
        });
        var menuImageData = {};
        try {
          menuImageData = await menuImageRes.json();
        } catch (_) {
          menuImageData = { success: false, error: 'Upload foto Menu gagal (HTTP ' + menuImageRes.status + ').' };
        }
        if (!menuImageRes.ok || !menuImageData.success) {
          showToast('❌ ' + (menuImageData.error || menuImageData.message || 'Menu tersimpan, tetapi foto Menu gagal diunggah.'));
          return;
        }
      }

      showToast(status === 'ACTIVE' ? '✅ Menu Master aktif.' : '✅ Menu Master tersimpan sebagai draft.');
      await loadOwnerMasterMenus();
      navigateTo('catalog/master-menus', { history: 'replace' });
    } catch (err) {
      console.error('[Owner Master Menu Save Error]:', err);
      showToast('❌ ' + (err.message || 'Gagal menyimpan Menu Master.'));
    }
  }

  async function setOwnerMasterMenuStatus(id, status) {
    try {
      var res = await adminFetch(API_BASE + '/admin/menus/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: status })
      });
      var data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Gagal mengubah status Menu Master.');
      showToast('✅ Status Menu Master diperbarui.');
      loadOwnerMasterMenus();
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal mengubah status Menu Master.'));
    }
  }

  function openNewOwnerMasterMenu(type) {
    _ownerMasterMenuState.createType = type === 'PACKAGE' ? 'PACKAGE' : 'SINGLE';
    navigateTo('catalog/master-menus/new');
  }

  function openMenuTypeSheet() {
    document.body.classList.add('x-sheet-open');
    var overlay = $('sheet-menu-type-overlay');
    var sheet = $('sheet-menu-type');
    var extClose = $('sheet-menu-type-ext-close');

    if (overlay) {
      overlay.style.display = 'block';
      setTimeout(function () { overlay.classList.add('open'); }, 10);
    }
    if (sheet) {
      sheet.style.display = 'block';
      setTimeout(function () {
        sheet.classList.add('open');
        if (extClose) {
          var sheetH = sheet.offsetHeight || 280;
          extClose.style.bottom = (sheetH + 12) + 'px';
          extClose.classList.add('open');
        }
      }, 10);
    }
  }

  function closeMenuTypeSheet() {
    document.body.classList.remove('x-sheet-open');
    var extClose = $('sheet-menu-type-ext-close');
    var overlay = $('sheet-menu-type-overlay');
    var sheet = $('sheet-menu-type');

    if (extClose) extClose.classList.remove('open');
    if (overlay) {
      overlay.classList.remove('open');
      setTimeout(function () { overlay.style.display = 'none'; }, 260);
    }
    if (sheet) {
      sheet.classList.remove('open');
      setTimeout(function () { sheet.style.display = 'none'; }, 280);
    }
  }

  function selectMenuTypeAndProceed(type) {
    closeMenuTypeSheet();
    openNewOwnerMasterMenu(type);
  }

  window.openMenuTypeSheet = openMenuTypeSheet;
  window.closeMenuTypeSheet = closeMenuTypeSheet;
  window.selectMenuTypeAndProceed = selectMenuTypeAndProceed;

  window.XentraOwnerMasterMenu = {
    upsertDependency: upsertOwnerMasterMenuDependency,
    addPackageProduct: addOwnerMasterMenuPackageProduct
  };

  window.createMenuFromProduct = function(productId) {
    if (!productId) return;
    _ownerMasterMenuState.preselectedProductId = productId;
    _ownerMasterMenuState.createType = 'SINGLE';
    navigateTo('catalog/master-menus/new');
  };
  window.openAddMasterMenuSingle = function() {
    openNewOwnerMasterMenu('SINGLE');
  };
  window.openAddMasterMenuPackage = function() {
    openNewOwnerMasterMenu('PACKAGE');
  };
  async function toggleOwnerMasterMenuStatus(id, inputEl) {
    var nextActive = inputEl && inputEl.checked;
    var nextStatus = nextActive ? 'ACTIVE' : 'ARCHIVED';
    try {
      var res = await adminFetch(API_BASE + '/admin/menus/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: nextStatus })
      });
      var data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Gagal mengubah status Menu Master.');
      showToast('✅ Menu ' + (nextActive ? 'diaktifkan' : 'dinonaktifkan / diarsipkan') + '.');
      loadOwnerMasterMenus();
    } catch (err) {
      if (inputEl) inputEl.checked = !nextActive;
      showToast('❌ ' + (err.message || 'Gagal mengubah status Menu Master.'));
    }
  }

  async function deleteOwnerMasterMenu(id, menuName) {
    var title = menuName || 'Menu';
    var actionLabel = 'Hapus permanen';
    var actionMessage = 'Hapus permanen menu "' + title + '"? Tindakan ini TIDAK dapat dibatalkan.';
    var confirmed = false;
    if (window.XentraPresentation && typeof window.XentraPresentation.confirm === 'function') {
      confirmed = await window.XentraPresentation.confirm({
        id: 'delete-master-menu',
        title: actionLabel + ' Menu',
        message: actionMessage,
        okLabel: actionLabel,
        cancelLabel: 'Batal'
      });
    } else {
      confirmed = await confirmFeatureAction('delete-master-menu', actionLabel + ' Menu', actionMessage, actionLabel);
    }
    if (!confirmed) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/menus/' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Gagal menghapus Menu Master.');
      showToast('✅ Menu "' + title + '" berhasil dihapus permanen.');
      if ($('master-menu-editor-view') && $('master-menu-editor-view').style.display !== 'none') {
        if (typeof goBackFromChildPage === 'function') {
          goBackFromChildPage();
        } else {
          navigateTo('catalog/master-menus');
        }
      } else {
        loadOwnerMasterMenus();
      }
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal menghapus Menu Master.'));
    }
  }

  window.toggleOwnerMasterMenuStatus = toggleOwnerMasterMenuStatus;
  window.deleteOwnerMasterMenu = deleteOwnerMasterMenu;
  window.setOwnerMasterMenuStatus = setOwnerMasterMenuStatus;
  window.openEditOwnerMasterMenu = function(id) {
    if (id) navigateTo('catalog/master-menus/' + encodeURIComponent(id) + '/edit');
  };

  function initOwnerMasterMenuUI() {
    var addSingle = $('btn-add-master-menu-single');
    var addPackage = $('btn-add-master-menu-package');
    var search = $('master-menu-search');
    var typeFilter = $('master-menu-type-filter');
    var category = $('cm-category');
    var product = $('cm-product');
    var rasa = $('cm-rasa');
    var packageName = $('cm-package-name');
    var price = $('cm-price');
    var form = $('form-master-menu');
    var saveDraft = $('btn-save-master-menu-draft');
    var addComponent = $('btn-cm-add-component');

    // Foto Menu — pick → shared crop editor (1:1) → canonical entity media pipeline.
    // Menu owns its customer-facing photo, independent from Product photos.
    var menuImagePick = $('btn-cm-image-pick');
    var menuImageFile = $('cm-image-file');
    var menuImageRemove = $('btn-cm-image-remove');
    if (menuImagePick && menuImageFile) {
      menuImagePick.addEventListener('click', function() { menuImageFile.click(); });
      menuImageFile.addEventListener('change', function() {
        var file = menuImageFile.files && menuImageFile.files[0];
        if (!file) { _masterMenuImageFile = null; _masterMenuCropSpec = null; return; }
        _masterMenuImageRemoved = false;
        _masterMenuCropSpec = null;

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.');
          menuImageFile.value = '';
          return;
        }
        if (file.size > 20 * 1024 * 1024) {
          showToast('❌ Ukuran gambar melebihi batas maksimal 20MB.');
          menuImageFile.value = '';
          return;
        }

        _masterMenuImageFile = file;

        XentraCropEditor.open({
          source: file,
          assetType: 'menu',
          aspectRatio: 1.0,
          title: 'Potong & Posisikan Foto Menu (1:1)',
          onConfirm: function (cropSpec, previewDataUrl) {
            _masterMenuCropSpec = cropSpec;
            _masterMenuImagePreviewSrc = previewDataUrl || URL.createObjectURL(file);
            setOwnerMasterMenuImagePreview(_masterMenuImagePreviewSrc, true);
            renderOwnerMasterMenuPreview();
            showToast('✓ Potongan foto Menu disesuaikan.');
          },
          onCancel: function () {
            _masterMenuImageFile = null;
            _masterMenuCropSpec = null;
            if (menuImageFile) menuImageFile.value = '';
          }
        });
      });
    }

    if (menuImageRemove) {
      menuImageRemove.addEventListener('click', function() {
        _masterMenuImageFile = null;
        _masterMenuCropSpec = null;
        _masterMenuImageRemoved = true;
        _masterMenuImagePreviewSrc = '';
        if (menuImageFile) menuImageFile.value = '';
        var removedFlag = $('cm-image-removed');
        if (removedFlag) removedFlag.value = '1';
        setOwnerMasterMenuImagePreview('', false);
        renderOwnerMasterMenuPreview();
      });
    }

    var addMenu = $('btn-add-master-menu');
    if (addMenu) addMenu.addEventListener('click', function() { openNewOwnerMasterMenu('SINGLE'); });
    if (addSingle) addSingle.addEventListener('click', function() { openNewOwnerMasterMenu('SINGLE'); });
    if (addPackage) addPackage.addEventListener('click', function() { openNewOwnerMasterMenu('PACKAGE'); });

    var quickAddCategory = $('btn-quick-add-category');
    if (quickAddCategory) {
      quickAddCategory.addEventListener('click', function() {
        var inline = window.XentraOwnerMasterMenuInline;
        if (inline && typeof inline.createCategory === 'function') {
          inline.createCategory().catch(function(err) {
            showToast('❌ ' + (err.message || 'Gagal membuat Kategori.'));
          });
        } else if (window.XentraCatalogReference && typeof window.XentraCatalogReference.openMasterReferenceQuickAdd === 'function') {
          window.XentraCatalogReference.openMasterReferenceQuickAdd('category');
        } else if (typeof window.openMasterReferenceQuickAdd === 'function') {
          window.openMasterReferenceQuickAdd('category');
        }
      });
    }

    var quickAddTitle = $('btn-quick-add-title');
    if (quickAddTitle) {
      quickAddTitle.addEventListener('click', function() {
        openMasterReferenceQuickAdd('title');
      });
    }

    var quickAddRasa = $('btn-quick-add-rasa');
    if (quickAddRasa) {
      quickAddRasa.addEventListener('click', function() {
        var inline = window.XentraOwnerMasterMenuInline;
        if (inline && typeof inline.createRasa === 'function') {
          inline.createRasa().catch(function(err) { showToast('❌ ' + (err.message || 'Gagal membuat Rasa.')); });
        } else {
          openMasterReferenceQuickAdd('flavor');
        }
      });
    }

    var addItemBtn = $('btn-cm-add-item');
    if (addItemBtn) addItemBtn.addEventListener('click', addOwnerMasterMenuItem);

    var spiceToggle = $('cm-spice-toggle');
    var spiceWrapper = $('cm-spice-scale-wrapper');
    if (spiceToggle) {
      spiceToggle.addEventListener('change', function() {
        var isChecked = spiceToggle.checked;
        if (spiceWrapper) spiceWrapper.style.display = isChecked ? 'inline-flex' : 'none';
        if (isChecked) {
          var curVal = Number(($('cm-spice-level-val') && $('cm-spice-level-val').value) || 1);
          setOwnerMasterMenuSpiceLevel(curVal || 1);
        } else {
          var valInput = $('cm-spice-level-val');
          if (valInput) valInput.value = '';
          renderOwnerMasterMenuPreview();
        }
      });
    }

    var spiceDots = document.querySelectorAll('#cm-spice-dots-row .x-spice-dot-btn');
    spiceDots.forEach(function(dot) {
      dot.addEventListener('click', function() {
        setOwnerMasterMenuSpiceLevel(dot.dataset.spicePos);
      });
    });

    if (search) search.addEventListener('input', function() {
      _ownerMasterMenuState.search = search.value || '';
      renderOwnerMasterMenuList();
    });

    if (typeFilter) typeFilter.querySelectorAll('[data-menu-filter]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        _ownerMasterMenuState.typeFilter = btn.dataset.menuFilter || 'all';
        typeFilter.querySelectorAll('[data-menu-filter]').forEach(function(other) {
          var active = other === btn;
          other.classList.toggle('active', active);
          other.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        renderOwnerMasterMenuList();
      });
    });

    var titleSelect = $('cm-title');
    var costInput = $('cm-cost');

    if (category) category.addEventListener('change', function() {
      renderOwnerMasterMenuPreview();
    });

    var titleInput = $('cm-title-input');
    if (titleInput) {
      titleInput.addEventListener('input', function() {
        var val = titleInput.value || '';
        var countEl = $('cm-title-char-count');
        if (countEl) countEl.textContent = val.length;

        var previewTitleEl = $('cm-preview-title');
        if (previewTitleEl) previewTitleEl.textContent = val.trim() || 'Judul Menu';

        // Auto-match or sync hidden #cm-title select
        if (titleSelect) {
          var matchedTitle = (_ownerMasterMenuState.titles || []).find(function(t) {
            return (t.name || '').trim().toLowerCase() === val.trim().toLowerCase();
          });
          if (matchedTitle) {
            titleSelect.value = String(matchedTitle.id);
          } else {
            // Check if matching option already exists
            var existingOpt = Array.from(titleSelect.options).find(function(opt) {
              return (opt.textContent || '').trim().toLowerCase() === val.trim().toLowerCase();
            });
            if (existingOpt) {
              titleSelect.value = existingOpt.value;
            } else if (val.trim()) {
              var newOpt = document.createElement('option');
              newOpt.value = 'custom:' + val.trim();
              newOpt.textContent = val.trim();
              titleSelect.appendChild(newOpt);
              titleSelect.value = newOpt.value;
            }
          }
        }
        renderOwnerMasterMenuPreview();
      });
    }

    var pickSearchInput = $('pick-item-search');
    if (pickSearchInput) {
      pickSearchInput.addEventListener('input', function() {
        renderPickItemList(pickSearchInput.value, _pickItemActiveCategory);
      });
    }

    var priceMinInput = $('cm-price-min');
    var priceMaxInput = $('cm-price-max');
    [priceMinInput, priceMaxInput].forEach(function(el) {
      if (!el) return;
      el.addEventListener('input', function() {
        var minVal = getOwnerMasterMenuMoney('cm-price-min') || 0;
        var maxVal = getOwnerMasterMenuMoney('cm-price-max') || 0;
        var previewPriceEl = $('cm-preview-price');
        if (previewPriceEl) {
          if (minVal > 0 && maxVal > 0) {
            previewPriceEl.textContent = formatMoney(minVal) + ' - ' + formatMoney(maxVal);
          } else if (minVal > 0) {
            previewPriceEl.textContent = formatMoney(minVal);
          } else if (maxVal > 0) {
            previewPriceEl.textContent = formatMoney(maxVal);
          } else {
            previewPriceEl.textContent = 'Rp0';
          }
        }
        renderOwnerMasterMenuPreview();
      });
    });

    [category, product, titleSelect, rasa, packageName, price, costInput].forEach(function(el) {
      if (!el) return;
      el.addEventListener('input', renderOwnerMasterMenuPreview);
      el.addEventListener('change', renderOwnerMasterMenuPreview);
    });

    var activeToggle = $('cm-toggle-active');
    if (activeToggle) {
      activeToggle.addEventListener('change', function() {
        if ($('cm-status')) $('cm-status').value = activeToggle.checked ? 'ACTIVE' : 'DRAFT';
        var wrap = $('cm-toggle-active-wrap');
        if (wrap) wrap.classList.toggle('x-toggle-on', activeToggle.checked);
      });
    }

    if (addComponent) addComponent.addEventListener('click', addOwnerMasterMenuPackageComponent);
    if (form) form.addEventListener('submit', function(e) {
      e.preventDefault();
      saveOwnerMasterMenu('ACTIVE');
    });
    if (saveDraft) saveDraft.addEventListener('click', function() {
      saveOwnerMasterMenu('DRAFT');
    });

    var cancel = $('btn-cancel-master-menu');
    var desktopBack = $('btn-master-menu-editor-desktop-back');
    if (cancel) cancel.addEventListener('click', function() { navigateTo('catalog/master-menus'); });
    if (desktopBack) desktopBack.addEventListener('click', function() { goBackFromChildPage(); });

    var headerDel = $('btn-delete-master-menu-header');
    if (headerDel && !headerDel.dataset.bound) {
      headerDel.dataset.bound = 'true';
      headerDel.addEventListener('click', function(e) {
        e.preventDefault();
        var id = $('master-menu-id') ? $('master-menu-id').value : '';
        var title = $('cm-title-input') ? $('cm-title-input').value : '';
        if (id) deleteOwnerMasterMenu(id, title);
      });
    }
    var actionDel = $('btn-delete-master-menu-action');
    if (actionDel && !actionDel.dataset.bound) {
      actionDel.dataset.bound = 'true';
      actionDel.addEventListener('click', function(e) {
        e.preventDefault();
        var id = $('master-menu-id') ? $('master-menu-id').value : '';
        var title = $('cm-title-input') ? $('cm-title-input').value : '';
        if (id) deleteOwnerMasterMenu(id, title);
      });
    }
  }

  function switchPricePolicyMode(mode) {
    var fixedContainer = $('price-mode-fixed-container');
    var rangeContainer = $('price-mode-range-container');
    var tabFixed = $('tab-price-fixed');
    var tabRange = $('tab-price-range');

    if (mode === 'RANGE') {
      if (fixedContainer) fixedContainer.style.display = 'none';
      if (rangeContainer) rangeContainer.style.display = 'block';
      if (tabFixed) {
        tabFixed.style.color = '#94A3B8';
        tabFixed.style.borderBottom = '2px solid transparent';
      }
      if (tabRange) {
        tabRange.style.color = '#0F172A';
        tabRange.style.borderBottom = '2px solid #0F172A';
      }
    } else {
      if (fixedContainer) fixedContainer.style.display = 'block';
      if (rangeContainer) rangeContainer.style.display = 'none';
      if (tabFixed) {
        tabFixed.style.color = '#0F172A';
        tabFixed.style.borderBottom = '2px solid #0F172A';
      }
      if (tabRange) {
        tabRange.style.color = '#94A3B8';
        tabRange.style.borderBottom = '2px solid transparent';
      }
    }
  }
  window.switchPricePolicyMode = switchPricePolicyMode;
  window.showOwnerMasterMenuList = showOwnerMasterMenuList;
  window.showOwnerMasterMenuEditor = showOwnerMasterMenuEditor;
  window.loadOwnerMasterMenus = loadOwnerMasterMenus;
  window.loadOwnerMasterMenuEditor = loadOwnerMasterMenuEditor;
  window.loadOwnerMasterMenuReferences = loadOwnerMasterMenuReferences;
  window.openNewOwnerMasterMenu = openNewOwnerMasterMenu;
  window.openMenuTypeSheet = openMenuTypeSheet;
  window.closeMenuTypeSheet = closeMenuTypeSheet;
  window.selectMenuTypeAndProceed = selectMenuTypeAndProceed;
  window.renderOwnerMasterMenuList = renderOwnerMasterMenuList;
  window.renderOwnerMasterMenuPreview = renderOwnerMasterMenuPreview;
  window.ownerMasterMenuResetEditor = ownerMasterMenuResetEditor;
  window.openPickItemSheet = openPickItemSheet;
  window.closePickItemSheet = closePickItemSheet;
  window.renderPickItemCategories = renderPickItemCategories;
  window.filterPickItemCategory = filterPickItemCategory;
  window.selectPickItemRadio = selectPickItemRadio;
  window.confirmPickedItem = confirmPickedItem;
  window.renderOwnerMasterMenuItems = renderOwnerMasterMenuItems;
  window.addOwnerMasterMenuItem = addOwnerMasterMenuItem;
  window.renderOwnerMasterMenuPackageComponents = renderOwnerMasterMenuPackageComponents;
  window.addOwnerMasterMenuPackageComponent = addOwnerMasterMenuPackageComponent;
  window.setOwnerMasterMenuSpiceLevel = setOwnerMasterMenuSpiceLevel;
  window.saveOwnerMasterMenu = saveOwnerMasterMenu;
  window.initOwnerMasterMenuUI = initOwnerMasterMenuUI;

  window.XentraMasterMenuModule = {
    showOwnerMasterMenuList: showOwnerMasterMenuList,
    showOwnerMasterMenuEditor: showOwnerMasterMenuEditor,
    loadOwnerMasterMenus: loadOwnerMasterMenus,
    loadOwnerMasterMenuEditor: loadOwnerMasterMenuEditor,
    loadOwnerMasterMenuReferences: loadOwnerMasterMenuReferences,
    initOwnerMasterMenuUI: initOwnerMasterMenuUI,
    switchPricePolicyMode: switchPricePolicyMode,
    openNewOwnerMasterMenu: openNewOwnerMasterMenu,
    openMenuTypeSheet: openMenuTypeSheet,
    closeMenuTypeSheet: closeMenuTypeSheet,
    selectMenuTypeAndProceed: selectMenuTypeAndProceed,
    renderOwnerMasterMenuList: renderOwnerMasterMenuList,
    renderOwnerMasterMenuPreview: renderOwnerMasterMenuPreview
  };

})(window, document);
