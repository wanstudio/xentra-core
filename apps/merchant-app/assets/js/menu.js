/**
 * XENTRA CORE — MERCHANT APP MENU
 *
 * Branch Manager menu/catalog operations: branch product availability,
 * category management, catalog adoption and menu presentation state.
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
  var XentraMerchantBranchCatalog = window.XentraMerchantBranchCatalog;

  var _bmMenuState = {
    products: [],
    categories: [],
    availableProducts: [],
    searchQuery: '',
    statusFilter: 'all',
    categoryFilter: 'all',
    menuView: 'home',
    selectedCategoryId: null,
    categoryStatusFilter: 'active',
    addCatalogSearchQuery: '',
    fetchSeq: 0
  };



  function setBMMenuView(view) {
    _bmMenuState.menuView = view;
    var views = {
      home: $('bm-menu-home-view'),
      categories: $('bm-menu-categories-view'),
      detail: $('bm-menu-category-detail-view')
    };
    Object.keys(views).forEach(function (key) {
      var el = views[key];
      if (!el) return;
      var active = key === view;
      el.hidden = !active;
      el.classList.toggle('is-active', active);
    });
    if (view === 'categories') renderBMMenuCategoriesBar();
    if (view === 'detail') renderBMMenuTable();
  }

  window.openBMMenuHome = function () {
    setBMMenuView('home');
  };

  window.openBMMenuCategories = function () {
    setBMMenuView('categories');
  };

  window.openBMMenuCategoryDetail = function (categoryId) {
    _bmMenuState.selectedCategoryId = categoryId;
    _bmMenuState.categoryFilter = categoryId;
    setBMMenuView('detail');

    var cat = (_bmMenuState.categories || []).find(function (c) {
      return String(c.id) === String(categoryId);
    });
    if ($('bm-menu-category-detail-title')) {
      $('bm-menu-category-detail-title').textContent = cat ? cat.name : 'Kategori';
    }
    if ($('bm-menu-category-detail-subtitle')) {
      var count = (_bmMenuState.products || []).filter(function (p) {
        var ids = Array.isArray(p.category_ids) ? p.category_ids.map(String) : [];
        return ids.indexOf(String(categoryId)) !== -1;
      }).length;
      $('bm-menu-category-detail-subtitle').textContent = count + ' menu dalam kategori ini.';
    }
    renderBMMenuTable();
  };

  function bindBMMenuHierarchy() {
    var homeBtn = $('btn-bm-menu-open-categories');
    if (homeBtn && !homeBtn.dataset.bound) {
      homeBtn.dataset.bound = '1';
      homeBtn.addEventListener('click', function () { window.openBMMenuCategories(); });
    }

    var homeBack = $('btn-bm-menu-categories-back');
    if (homeBack && !homeBack.dataset.bound) {
      homeBack.dataset.bound = '1';
      homeBack.addEventListener('click', function () { window.openBMMenuHome(); });
    }

    var detailBack = $('btn-bm-menu-category-detail-back');
    if (detailBack && !detailBack.dataset.bound) {
      detailBack.dataset.bound = '1';
      detailBack.addEventListener('click', function () { window.openBMMenuCategories(); });
    }

    var addCategory = $('btn-bm-menu-add-category');
    if (addCategory && !addCategory.dataset.bound) {
      addCategory.dataset.bound = '1';
      addCategory.addEventListener('click', function () { promptAddBMBranchCategory(); });
    }

    var addCatalog = $('btn-bm-menu-add-catalog');
    if (addCatalog && !addCatalog.dataset.bound) {
      addCatalog.dataset.bound = '1';
      addCatalog.addEventListener('click', function () { openBMAddCatalogModal(); });
    }

    var detailAdd = $('btn-bm-menu-category-add');
    if (detailAdd && !detailAdd.dataset.bound) {
      detailAdd.dataset.bound = '1';
      detailAdd.addEventListener('click', function () { openBMAddCatalogModal(); });
    }

    Array.prototype.forEach.call(document.querySelectorAll('[data-menu-category-status]'), function (tab) {
      if (tab.dataset.bound) return;
      tab.dataset.bound = '1';
      tab.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('[data-menu-category-status]'), function (x) {
          x.classList.toggle('is-active', x === tab);
        });
        _bmMenuState.categoryStatusFilter = tab.getAttribute('data-menu-category-status') || 'active';
        renderBMMenuCategoriesBar();
      });
    });

    var search = $('bm-menu-search');
    if (search && !search.dataset.bound) {
      search.dataset.bound = '1';
      search.addEventListener('input', onBMMenuFilterChange);
    }

    var status = $('bm-menu-filter-status');
    if (status && !status.dataset.bound) {
      status.dataset.bound = '1';
      status.addEventListener('change', onBMMenuFilterChange);
    }

    // The visible filter dropdown writes into the hidden native select above, which stays the
    // single source of the filter value. Follows docs/decisions/xentra-dropdown-style-guide-v1.md.
    var dd = $('bm-menu-filter-dropdown');
    var ddTrigger = $('btn-bm-menu-filter-trigger');
    var ddMenu = $('bm-menu-filter-menu');
    var ddLabel = $('bm-menu-filter-current-label');

    if (dd && ddTrigger && !ddTrigger.dataset.bound) {
      ddTrigger.dataset.bound = '1';
      ddTrigger.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = dd.classList.toggle('open');
        ddTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });

      if (ddMenu) {
        Array.prototype.forEach.call(ddMenu.querySelectorAll('.x-occ-dropdown-item'), function (item) {
          item.addEventListener('click', function (e) {
            e.stopPropagation();
            Array.prototype.forEach.call(ddMenu.querySelectorAll('.x-occ-dropdown-item'), function (el) {
              var isSelected = el === item;
              el.classList.toggle('active', isSelected);
              el.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            });
            if (ddLabel) {
              var labelSpan = item.querySelector('span');
              ddLabel.textContent = labelSpan ? labelSpan.textContent : (item.getAttribute('data-value') || '');
            }
            dd.classList.remove('open');
            ddTrigger.setAttribute('aria-expanded', 'false');

            if (status) status.value = item.getAttribute('data-value') || 'all';
            onBMMenuFilterChange();
          });
        });
      }

      document.addEventListener('click', function (e) {
        if (!dd.contains(e.target)) {
          dd.classList.remove('open');
          ddTrigger.setAttribute('aria-expanded', 'false');
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindBMMenuHierarchy);
  } else {
    bindBMMenuHierarchy();
  }

  async function loadBMMenu() {
    var branchId = getBMTargetBranchId();
    if (!branchId) return;

    XentraMerchantBranchCatalog.state.branchId = branchId;

    var tbody = $('bm-menu-tbody');
    if (tbody && (!_bmMenuState.products || !_bmMenuState.products.length)) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-muted">Memuat daftar menu cabang...</td></tr>';
    }

    var currentSeq = ++_bmMenuState.fetchSeq;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/menu', {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (currentSeq !== _bmMenuState.fetchSeq) return;

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal memuat menu cabang.');
      }

      XentraMerchantBranchCatalog.state.catalogData = data;
      _bmMenuState.categories = data.categories || [];
      _bmMenuState.availableProducts = data.available_master_menus || data.available_master_products || [];

      // The canonical Branch Menu endpoint already contains the complete
      // structured Master composition. Do not merge with the legacy
      // /admin/branches/:id/products assignment response.
      _bmMenuState.products = (data.adopted_menus || data.adopted_products || []).map(function (menu) {
        var categories = Array.isArray(menu.categories) ? menu.categories : [];
        var menuId = menu.menu_id || menu.id;
        var displayName = menu.display_name_override || menu.title || menu.name || 'Menu';
        return Object.assign({}, menu, {
          id: menuId,
          menu_id: menuId,
          menu_name: displayName,
          name: displayName,
          master_name: menu.title || menu.name || 'Menu',
          category_ids: categories.map(function (cat) { return String(cat.id); }),
          categories: categories,
          menu_composition: menu,
          is_available: menu.is_available !== false && menu.availability !== false
        });
      });

      if (_bmMenuState.selectedCategoryId && !_bmMenuState.categories.some(function (cat) {
        return String(cat.id) === String(_bmMenuState.selectedCategoryId);
      })) {
        _bmMenuState.selectedCategoryId = null;
      }

      updateBMMenuStats(_bmMenuState.products);
      bindBMMenuHierarchy();
      if (_bmMenuState.menuView === 'categories') renderBMMenuCategoriesBar();
      if (_bmMenuState.menuView === 'detail') renderBMMenuTable();
    } catch (err) {
      if (currentSeq !== _bmMenuState.fetchSeq) return;
      console.warn('[BM Menu Load Error]:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-danger">' + esc(err.message || 'Kesalahan jaringan saat memuat menu cabang.') + '</td></tr>';
      }
    }
  }
  window.loadBMMenu = loadBMMenu;
  window.renderBMMenuCategoriesBar = renderBMMenuCategoriesBar;
  window._bmMenuState = _bmMenuState;

  function updateBMMenuStats(products) {
    var total = (products || []).length;
    var avail = (products || []).filter(function (p) { return p.is_available === 1 || p.is_available === true; }).length;
    var unavail = total - avail;

    if ($('bm-menu-stat-total')) $('bm-menu-stat-total').textContent = total;
    if ($('bm-menu-stat-available')) $('bm-menu-stat-available').textContent = avail;
    if ($('bm-menu-stat-unavailable')) $('bm-menu-stat-unavailable').textContent = unavail;
  }

  function onBMMenuFilterChange() {
    var searchEl = $('bm-menu-search');
    var filterEl = $('bm-menu-filter-status');
    if (searchEl) _bmMenuState.searchQuery = searchEl.value.trim().toLowerCase();
    if (filterEl) _bmMenuState.statusFilter = filterEl.value;
    if (_bmMenuState.menuView === 'detail') renderBMMenuTable();
  }
  window.onBMMenuFilterChange = onBMMenuFilterChange;

  function setBMMenuCategoryFilter(catId) {
    if (catId !== 'all') {
      window.openBMMenuCategoryDetail(catId);
      return;
    }
    _bmMenuState.categoryFilter = catId;
    var label = $('bm-menu-cat-filter-label');
    if (label) {
      if (catId === 'all') {
        label.textContent = 'Semua kategori';
      } else {
        var cat = (_bmMenuState.categories || []).find(function (c) { return String(c.id) === String(catId); });
        label.textContent = 'Filter: ' + (cat ? cat.name : catId);
      }
    }
    renderBMMenuCategoriesBar();
    renderBMMenuTable();
  }
  window.setBMMenuCategoryFilter = setBMMenuCategoryFilter;

  function renderBMMenuCategoriesBar() {
    var bar = $('bm-menu-categories-bar');
    if (!bar) return;

    var categories = (_bmMenuState.categories || []).filter(function (cat) {
      if (_bmMenuState.categoryStatusFilter === 'inactive') return cat.is_active === 0 || cat.is_active === false;
      return !(cat.is_active === 0 || cat.is_active === false);
    });

    if (!categories.length) {
      bar.classList.add('is-empty');
      bar.innerHTML = '<div class="x-menu-empty-state">' +
        (_bmMenuState.categoryStatusFilter === 'inactive'
          ? 'Belum ada kategori nonaktif.'
          : 'Belum ada kategori aktif. Tambahkan kategori untuk mulai mengelompokkan menu.') +
        '</div>';
      return;
    }

    bar.classList.remove('is-empty');

    bar.innerHTML = categories.map(function (cat) {
      var count = (_bmMenuState.products || []).filter(function (p) {
        var ids = Array.isArray(p.category_ids) ? p.category_ids.map(String) : [];
        return ids.indexOf(String(cat.id)) !== -1;
      }).length;

      return '<div class="x-menu-category-row" data-category-id="' + esc(cat.id) + '">' +
        '<div class="x-menu-category-main" role="button" tabindex="0">' +
          '<span class="x-menu-category-copy">' +
            '<strong>' + esc(cat.name) + '</strong>' +
            '<small>' + count + ' menu</small>' +
          '</span>' +
          '<span class="x-menu-category-row-actions">' +
            '<button type="button" class="x-menu-category-edit" aria-label="Ubah ' + esc(cat.name) + '" title="Ubah kategori">' +
              '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>' +
            '</button>' +
            '<svg class="x-menu-hub-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>' +
          '</span>' +
        '</div>' +
      '</div>';
    }).join('');

    Array.prototype.forEach.call(bar.querySelectorAll('.x-menu-category-row'), function (row) {
      var catId = row.getAttribute('data-category-id');
      var cat = (_bmMenuState.categories || []).find(function (c) { return String(c.id) === String(catId); });
      var main = row.querySelector('.x-menu-category-main');
      if (main) {
        main.addEventListener('click', function () { window.openBMMenuCategoryDetail(catId); });
        main.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            window.openBMMenuCategoryDetail(catId);
          }
        });
      }
      var edit = row.querySelector('.x-menu-category-edit');
      if (edit && cat) {
        edit.addEventListener('click', function (event) {
          event.stopPropagation();
          openBranchCategoryEditModal(cat);
        });
      }
    });
  }

  async function saveBMBranchCategoryOrder(orderedIds) {
    var branchId = getBMTargetBranchId();
    if (!branchId) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/categories/reorder', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ order: orderedIds })
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Urutan kategori cabang disimpan.');
        if (_bmMenuState.categories) {
          var catMap = {};
          _bmMenuState.categories.forEach(function (c) { catMap[c.id] = c; });
          _bmMenuState.categories = orderedIds.map(function (id) { return catMap[id]; }).filter(Boolean);
        }
      } else {
        showToast('❌ ' + (data.error || 'Gagal menyimpan urutan kategori.'));
        loadBMMenu();
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan saat menyimpan urutan.');
      loadBMMenu();
    }
  }

  window.promptAddBMBranchCategory = function () {
    var branchId = getBMTargetBranchId();
    if (!branchId) {
      showToast('❌ Cabang tidak valid atau belum dipilih.');
      return;
    }
    XentraMerchantBranchCatalog.state.branchId = branchId;
    openBranchCategoryCreateModal();
  };

  window.deleteBMBranchCategory = async function (catId, catName) {
    if (!confirm('Hapus kategori "' + catName + '"? Produk di kategori ini tidak akan dihapus, hanya dipindah ke tanpa kategori.')) return;

    var branchId = getBMTargetBranchId();
    if (!branchId) return;
    XentraMerchantBranchCatalog.state.branchId = branchId;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/categories/' + encodeURIComponent(catId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Kategori cabang berhasil dihapus.');
        if (String(_bmMenuState.categoryFilter) === String(catId)) _bmMenuState.categoryFilter = 'all';
        loadBMMenu();
      } else {
        showToast('❌ ' + (data.error || 'Gagal menghapus kategori.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };

  function renderBMMenuTable() {
    var tbody = $('bm-menu-tbody');
    if (!tbody) return;

    var selectedCategoryId = _bmMenuState.selectedCategoryId;
    var filtered = (_bmMenuState.products || []).filter(function (p) {
      var name = (p.product_name || p.name || '').toLowerCase();
      if (_bmMenuState.searchQuery && name.indexOf(_bmMenuState.searchQuery) === -1) return false;

      var isAvail = (p.is_available === 1 || p.is_available === true);
      if (_bmMenuState.statusFilter === 'available' && !isAvail) return false;
      if (_bmMenuState.statusFilter === 'unavailable' && isAvail) return false;

      if (selectedCategoryId) {
        var pCatIds = Array.isArray(p.category_ids) && p.category_ids.length > 0
          ? p.category_ids.map(String)
          : (p.branch_category_id ? [String(p.branch_category_id)] : []);
        if (pCatIds.indexOf(String(selectedCategoryId)) === -1) return false;
      }
      return true;
    });

    if ($('bm-menu-stat-total')) $('bm-menu-stat-total').textContent = filtered.length;

    var detailPanel = document.querySelector('.x-menu-detail-list-panel');
    if (!filtered.length) {
      if (detailPanel) detailPanel.classList.add('is-empty');
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-muted"><div class="x-menu-empty-state">Belum ada menu dalam kategori ini.</div></td></tr>';
      return;
    }

    if (detailPanel) detailPanel.classList.remove('is-empty');

    tbody.innerHTML = filtered.map(function (p, index) {
      var isAvail = (p.is_available === 1 || p.is_available === true);
      var catBadges = (p.category_names && p.category_names.length)
        ? p.category_names.map(function (cn) {
            return '<span class="x-badge x-badge-info" style="font-size:10px; margin-right:4px;">' + esc(cn) + '</span>';
          }).join('')
        : (p.branch_category_name
          ? '<span class="x-badge x-badge-info" style="font-size:10px;">' + esc(p.branch_category_name) + '</span>'
          : '<span class="text-muted" style="font-size:11px;">Tanpa kategori</span>');

      var toggleBtn = '<label class="x-toggle x-menu-availability-toggle' + (isAvail ? ' x-toggle-on' : '') + '" title="' + (isAvail ? 'Tersedia' : 'Tidak tersedia') + '">' +
        '<input type="checkbox" class="x-menu-availability-input" ' + (isAvail ? 'checked' : '') +
        ' aria-label="Ubah ketersediaan ' + esc(p.product_name || p.name) + '">' +
        '<span class="x-toggle-slider"></span></label>';

      return '<tr class="x-merchant-data-row x-menu-row" data-menu-index="' + index + '">' +
        '<td data-label="Produk"><strong>' + esc(p.product_name || p.name) + '</strong></td>' +
        '<td data-label="Kategori">' + catBadges + '</td>' +
        '<td data-label="Harga"><strong>' + formatMoney(p.price) + '</strong></td>' +
        '<td data-label="Ketersediaan"><span class="x-badge ' + (isAvail ? 'x-badge-success' : 'x-badge-danger') + '">' +
          (isAvail ? 'TERSEDIA' : 'TIDAK TERSEDIA') + '</span></td>' +
        '<td data-label="Aksi" style="text-align:right;"><div class="x-menu-row-actions">' +
          toggleBtn +
          '<button type="button" class="x-action-menu-trigger x-menu-action-trigger" aria-label="Aksi menu ' +
            esc(p.product_name || p.name) + '" aria-expanded="false">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">' +
              '<circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle>' +
            '</svg>' +
          '</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');

    Array.prototype.forEach.call(tbody.querySelectorAll('.x-menu-row'), function (row) {
      var index = Number(row.getAttribute('data-menu-index'));
      var product = filtered[index];
      if (!product) return;

      var availabilityInput = row.querySelector('.x-menu-availability-input');
      if (availabilityInput) {
        availabilityInput.addEventListener('change', function () {
          toggleBMMenuAvailability(product.menu_id, this.checked ? 1 : 0);
        });
      }

      var actionTrigger = row.querySelector('.x-menu-action-trigger');
      if (actionTrigger) {
        actionTrigger.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();

          XentraActionMenu.open(actionTrigger, [
            {
              label: 'Ubah Nama Tampil',
              icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h7"/></svg>',
              onClick: function () {
                openBMProductDisplayNameEditor(product);
              }
            },
            {
              label: 'Hapus dari Cabang',
              icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
              destructive: true,
              onClick: function () {
                removeBMBranchMenu(product.menu_id, product.menu_name || product.name || 'Menu');
              }
            }
          ]);;
        });
      }
    });
  }

  async function openBMProductDisplayNameEditor(product) {
    var branchId = getBMTargetBranchId();
    if (!branchId || !product || !product.menu_id) return;

    var currentOverride = product.display_name_override != null
      ? String(product.display_name_override)
      : '';
    var masterName = product.master_name
      ? String(product.master_name)
      : String(product.title || product.name || 'Menu');
    var currentDisplay = product.title || masterName;

    if (!window.XentraPresentation || typeof window.XentraPresentation.open !== 'function') {
      showToast('❌ Presentation shell tidak tersedia.');
      return;
    }

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div style="padding:4px 0;">' +
        '<div style="font-size:12px;color:#64748b;margin-bottom:6px;">Nama Master</div>' +
        '<div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:14px;">' + esc(masterName) + '</div>' +
        '<label for="bm-display-name-input" style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:7px;">Nama yang tampil ke customer</label>' +
        '<input id="bm-display-name-input" class="x-input" type="text" value="' + esc(currentOverride) + '" maxlength="100" autocomplete="off">' +
        '<div style="font-size:11px;color:#64748b;margin-top:7px;">Kosongkan untuk otomatis mengikuti nama Master.</div>' +
        '<div style="font-size:11px;color:#94a3b8;margin-top:4px;">Saat override diisi, nama ini menggantikan judul Customer untuk cabang ini saja.</div>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">' +
          '<button type="button" class="x-btn-secondary" data-action="cancel">Batal</button>' +
          '<button type="button" class="x-btn-primary" data-action="save">Simpan</button>' +
        '</div>' +
      '</div>';
    var content = wrap.firstElementChild;
    var field = wrap.querySelector('#bm-display-name-input');

    window.XentraPresentation.open({
      id: 'merchant-product-display-name',
      type: 'bottom-sheet',
      title: 'Nama Tampil Customer',
      content: content,
      dismissible: true
    });

    function closeSheet() {
      if (window.XentraPresentation && window.XentraPresentation.isOpen('merchant-product-display-name')) {
        window.XentraPresentation.close('merchant-product-display-name');
      }
    }

    wrap.querySelector('[data-action="cancel"]').addEventListener('click', closeSheet);
    wrap.querySelector('[data-action="save"]').addEventListener('click', async function () {
      var saveBtn = wrap.querySelector('[data-action="save"]');
      var value = field.value.trim();
      saveBtn.disabled = true;
      saveBtn.textContent = 'Menyimpan...';

      try {
        var res = await window.XentraCatalogClient.updateBranchMenuDisplayName(branchId, product.menu_id, value || null);
        var data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || data.message || 'Gagal menyimpan nama tampil.');
        }
        closeSheet();
        showToast(value ? '✅ Nama customer cabang diperbarui.' : '✅ Nama dikembalikan ke Master.');
        await loadBMMenu();
      } catch (err) {
        showToast('❌ ' + ((err && err.message) || 'Gagal menyimpan nama tampil.'));
        saveBtn.disabled = false;
        saveBtn.textContent = 'Simpan';
      }
    });

    setTimeout(function () {
      if (field) {
        field.focus();
        field.select();
      }
    }, 0);

    return { currentDisplay: currentDisplay };
  }

  async function toggleBMMenuAvailability(menuId, nextVal) {
    var branchId = getBMTargetBranchId();
    if (!branchId) return;

    try {
      var res = await window.XentraCatalogClient.setBranchMenuAvailability(branchId, menuId, nextVal);
      var data = await res.json();
      if (res.ok && data.success) {
        showToast(nextVal === 1 ? 'Produk berhasil ditandai Tersedia.' : 'Produk ditandai Habis.');
        loadBMMenu();
      } else {
        showToast('Gagal mengubah ketersediaan: ' + (data.error || 'Terjadi kesalahan'));
        loadBMMenu();
      }
    } catch (e) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.toggleBMMenuAvailability = toggleBMMenuAvailability;

  window.removeBMBranchMenu = async function (menuId, menuName) {
    var branchId = getBMTargetBranchId();
    if (!branchId) return;

    if (!confirm('Hapus "' + productName + '" dari katalog cabang ini? Menu tidak akan lagi tampil di halaman pemesanan pelanggan.')) return;

    try {
      var res = await window.XentraCatalogClient.removeBranchMenu(branchId, menuId);
      var data = await res.json();
      if (data.success) {
        showToast('✅ Menu berhasil dihapus dari cabang.');
        loadBMMenu();
      } else {
        showToast('❌ ' + (data.error || 'Gagal menghapus produk.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };

  /* Modal Pick Available Master Products to Adopt (BM Phase 4B) */
  window.openBMAddCatalogModal = async function () {
    var modal = $('modal-bm-add-catalog');
    if (!modal) return;

    _bmMenuState.addCatalogSearchQuery = '';
    _bmMenuState.selectedCatalogProductIds = new Set();
    var searchInput = $('bm-add-catalog-search');
    if (searchInput) searchInput.value = '';

    updateBMAddCatalogFooter();

    var container = $('bm-add-catalog-list');
    if (container) {
      container.innerHTML = '<div style="padding:32px 16px; text-align:center; color:#64748b; font-size:13px;">' +
        '<div style="font-size:24px; margin-bottom:8px;">⏳</div>' +
        '<div>Memuat katalog produk master...</div>' +
      '</div>';
    }
    modal.style.display = 'flex';

    var branchId = getBMTargetBranchId();
    if (!branchId) {
      if (container) container.innerHTML = '<div style="padding:24px; text-align:center; color:#dc2626; font-size:13px;">Cabang tidak teridentifikasi. Pastikan Anda telah memilih atau ditugaskan ke cabang.</div>';
      return;
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/menu', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success) {
        XentraMerchantBranchCatalog.state.catalogData = data;
        _bmMenuState.availableProducts = data.available_master_menus || data.available_master_products || [];

        // Distinguish between already adopted and available master products
        var unadopted = (data.available_master_menus || data.available_master_products || []).map(function (p) {
          return Object.assign({}, p, { is_adopted: false });
        });

        var adopted = (data.adopted_menus || data.adopted_products || []).map(function (menu) {
          return Object.assign({}, menu, {
            id: menu.menu_id || menu.id,
            menu_id: menu.menu_id || menu.id,
            name: menu.display_name_override || menu.title || menu.name || 'Menu',
            is_adopted: true
          });
        });

        // Unadopted first, then adopted marked
        _bmMenuState.allCatalogProducts = unadopted.concat(adopted);

        // Populate branch categories target dropdown
        var catSelect = $('bm-add-catalog-target-category');
        if (catSelect) {
          var branchCats = data.categories || (_bmMenuState && _bmMenuState.categories) || [];
          var opts = ['<option value="">Pilih Kategori Cabang</option>'];
          branchCats.forEach(function (c) {
            opts.push('<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>');
          });
          catSelect.innerHTML = opts.join('');
        }

        renderBMAddCatalogList();
      } else {
        if (container) {
          container.innerHTML = '<div style="padding:24px; text-align:center; color:#dc2626; font-size:13px;">Gagal memuat katalog: ' + esc(data.error || 'Terjadi kesalahan') + '</div>';
        }
      }
    } catch (err) {
      console.warn('[BM Add Catalog Load Error]:', err);
      if (container) {
        container.innerHTML = '<div style="padding:24px; text-align:center; color:#dc2626; font-size:13px;">Kesalahan jaringan saat memuat katalog master.</div>';
      }
    }
  };

  window.closeBMAddCatalogModal = function () {
    var modal = $('modal-bm-add-catalog');
    if (modal) modal.style.display = 'none';
  };

  window.toggleBMAddCatalogSelectAll = function (isChecked) {
    if (!_bmMenuState.selectedCatalogProductIds) _bmMenuState.selectedCatalogProductIds = new Set();
    var all = _bmMenuState.allCatalogProducts || [];
    var q = (_bmMenuState.addCatalogSearchQuery || '').toLowerCase();
    var filtered = all.filter(function (p) {
      if (!q) return true;
      return (p.name || '').toLowerCase().indexOf(q) !== -1 || (p.description || '').toLowerCase().indexOf(q) !== -1;
    });

    filtered.forEach(function (p) {
      if (p.is_adopted) return;
      var pid = String(p.id);
      if (isChecked) {
        _bmMenuState.selectedCatalogProductIds.add(pid);
      } else {
        _bmMenuState.selectedCatalogProductIds.delete(pid);
      }
      var card = $('catalog-pick-card-' + pid);
      if (card) {
        if (isChecked) card.classList.add('is-selected');
        else card.classList.remove('is-selected');
      }
      var cb = $('catalog-pick-cb-' + pid);
      if (cb) cb.checked = isChecked;
    });

    updateBMAddCatalogFooter();
  };

  window.onBMAddCatalogFilterChange = function () {
    var searchInput = $('bm-add-catalog-search');
    if (searchInput) _bmMenuState.addCatalogSearchQuery = searchInput.value.trim().toLowerCase();
    renderBMAddCatalogList();
  };

  window.onBMSelectCatalogProduct = function (productId, isChecked) {
    if (!_bmMenuState.selectedCatalogProductIds) _bmMenuState.selectedCatalogProductIds = new Set();
    var pid = String(productId);
    if (isChecked) {
      _bmMenuState.selectedCatalogProductIds.add(pid);
    } else {
      _bmMenuState.selectedCatalogProductIds.delete(pid);
    }
    var card = $('catalog-pick-card-' + pid);
    if (card) {
      if (isChecked) card.classList.add('is-selected');
      else card.classList.remove('is-selected');
    }
    updateBMAddCatalogFooter();
  };

  window.toggleBMSelectCatalogProduct = function (productId) {
    var pid = String(productId);
    var checkbox = $('catalog-pick-cb-' + pid);
    if (!checkbox || checkbox.disabled) return;
    checkbox.checked = !checkbox.checked;
    window.onBMSelectCatalogProduct(pid, checkbox.checked);
  };

  function updateBMAddCatalogFooter() {
    var count = (_bmMenuState.selectedCatalogProductIds && _bmMenuState.selectedCatalogProductIds.size) || 0;
    var countEl = $('bm-add-catalog-count');
    if (countEl) {
      countEl.textContent = count + ' produk dipilih';
    }
    var submitBtn = $('btn-bm-submit-adopt-catalog');
    if (submitBtn) {
      submitBtn.disabled = count === 0;
      submitBtn.textContent = count > 0 ? ('Tambahkan (' + count + ') Menu') : 'Tambahkan Menu';
    }

    // Sync select-all checkbox state
    var selectAllCb = $('bm-add-catalog-select-all');
    if (selectAllCb) {
      var all = _bmMenuState.allCatalogProducts || [];
      var unadopted = all.filter(function (p) { return !p.is_adopted; });
      if (unadopted.length > 0 && count >= unadopted.length) {
        selectAllCb.checked = true;
      } else {
        selectAllCb.checked = false;
      }
    }
  }

  function renderBMAddCatalogList() {
    var container = $('bm-add-catalog-list');
    if (!container) return;

    var all = _bmMenuState.allCatalogProducts || [];
    var q = (_bmMenuState.addCatalogSearchQuery || '').toLowerCase();
    var filtered = all.filter(function (p) {
      if (!q) return true;
      return (p.name || '').toLowerCase().indexOf(q) !== -1 || (p.description || '').toLowerCase().indexOf(q) !== -1;
    });

    if (!filtered.length) {
      container.innerHTML = '<div style="background:#f8fafc; border:1px dashed #cbd5e1; border-radius:8px; padding:28px; text-align:center; color:#64748b; font-size:13px;">' +
        (q ? 'Tidak ada produk master yang sesuai dengan pencarian "' + esc(q) + '".' : 'Belum ada produk master yang tersedia untuk brand ini.') +
      '</div>';
      updateBMAddCatalogFooter();
      return;
    }

    var selectedSet = _bmMenuState.selectedCatalogProductIds || new Set();

    container.innerHTML = filtered.map(function (p) {
      var pid = String(p.id);
      var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isRange = p.pricing_mode === 'range';
      var modeBadge = isRange
        ? '<span class="x-badge x-badge-range" style="font-size:11px;">Range (' + formatMoney(p.min_price) + ' - ' + formatMoney(p.max_price) + ')</span>'
        : '<span class="x-badge x-badge-lock" style="font-size:11px;">Harga Terkunci</span>';

      if (p.is_adopted) {
        return '<div class="x-catalog-picker-card is-adopted" id="catalog-pick-card-' + esc(pid) + '">' +
          '<div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">' +
            '<img src="' + esc(img) + '" style="width:44px; height:44px; border-radius:6px; object-fit:cover; flex-shrink:0; border:1px solid #e2e8f0;" alt="">' +
            '<div style="min-width:0; flex:1;">' +
              '<div style="font-weight:700; font-size:13.5px; color:#334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(p.name) + '</div>' +
              '<div style="display:flex; gap:6px; align-items:center; margin-top:2px; flex-wrap:wrap;">' +
                '<span style="font-size:12px; font-weight:700; color:#64748b;">' + formatMoney(p.price || p.master_price) + '</span>' +
                modeBadge +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">' +
            '<span class="x-badge x-badge-success" style="font-size:11px; padding:4px 10px;">✓ Sudah Diadopsi</span>' +
          '</div>' +
        '</div>';
      }

      var isSelected = selectedSet.has(pid);
      return '<div class="x-catalog-picker-card' + (isSelected ? ' is-selected' : '') + '" id="catalog-pick-card-' + esc(pid) + '" onclick="toggleBMSelectCatalogProduct(\'' + esc(pid) + '\')">' +
        '<div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">' +
          '<input type="checkbox" class="x-catalog-picker-checkbox" id="catalog-pick-cb-' + esc(pid) + '" ' + (isSelected ? 'checked' : '') + ' onclick="event.stopPropagation(); onBMSelectCatalogProduct(\'' + esc(pid) + '\', this.checked)">' +
          '<img src="' + esc(img) + '" style="width:44px; height:44px; border-radius:6px; object-fit:cover; flex-shrink:0; border:1px solid #e2e8f0;" alt="">' +
          '<div style="min-width:0; flex:1;">' +
            '<div style="font-weight:700; font-size:13.5px; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(p.name) + '</div>' +
            '<div style="display:flex; gap:6px; align-items:center; margin-top:2px; flex-wrap:wrap;">' +
              '<span style="font-size:12px; font-weight:700; color:var(--text-main);">' + formatMoney(p.price) + '</span>' +
              modeBadge +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">' +
          '<span style="font-size:12px; font-weight:600; color:' + (isSelected ? '#2563eb' : '#64748b') + ';">' + (isSelected ? '✓ Terpilih' : 'Pilih') + '</span>' +
        '</div>' +
      '</div>';
    }).join('');

    updateBMAddCatalogFooter();
  }

  window.submitBMAdoptCatalogBatch = async function () {
    var branchId = getBMTargetBranchId();
    if (!branchId) {
      showToast('❌ Cabang tidak valid atau belum dipilih.');
      return;
    }

    var selectedSet = _bmMenuState.selectedCatalogProductIds;
    if (!selectedSet || selectedSet.size === 0) {
      showToast('⚠️ Pilih minimal 1 produk master untuk diadopsi.');
      return;
    }

    var targetCatSelect = $('bm-add-catalog-target-category');
    var targetCatId = targetCatSelect ? targetCatSelect.value : '';
    if (!targetCatId) {
      showToast('⚠️ Pilih Kategori Cabang terlebih dahulu.');
      return;
    }

    var btn = $('btn-bm-submit-adopt-catalog');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Menambahkan...';
    }

    var pids = Array.from(selectedSet);
    var successCount = 0;
    var errorCount = 0;
    var lastError = '';

    for (var i = 0; i < pids.length; i++) {
      var pid = pids[i];
      try {
        var res = await window.XentraCatalogClient.adoptMenu(branchId, pid, {
          branch_category_ids: [targetCatId]
        });
        var data = await res.json();
        if (res.ok && data.success) {
          successCount++;
        } else {
          errorCount++;
          lastError = data.message || data.error || 'Gagal mengadopsi';
        }
      } catch (e) {
        errorCount++;
        lastError = 'Kesalahan jaringan';
      }
    }

    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Tambahkan Menu';
    }

    if (successCount > 0) {
      showToast('✅ Berhasil menambahkan ' + successCount + ' menu ke cabang!');
      closeBMAddCatalogModal();
      if (typeof loadBMMenu === 'function') await loadBMMenu();
    } else {
      showToast('❌ ' + (lastError || 'Gagal mengadopsi menu terpilih.'));
    }
  };


  // The shared branch-catalog module refreshes the BM menu after mutations.
  var Catalog = window.XentraMerchantBranchCatalog;
  if (Catalog) {
    Catalog.setHooks({ refreshBMMenu: function () { loadBMMenu(); } });
    Catalog.setBmMenuState(_bmMenuState);
  }
})();
