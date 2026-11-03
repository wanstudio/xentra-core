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
    isSorting: false,
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

    var isSubView = (view === 'categories' || view === 'detail');
    document.body.classList.toggle('is-bm-menu-subview', isSubView);
    var mobileNav = $('x-merchant-mobile-nav');
    if (mobileNav) {
      mobileNav.style.display = isSubView ? 'none' : '';
    }

    if (view === 'categories') renderBMMenuCategoriesBar();
    if (view === 'detail') renderBMMenuTable();
  }

  window.openBMMenuHome = function (options) {
    options = options || {};
    setBMMenuView('home');
    if (!options.fromNav && window.XentraNav) {
      if (window.XentraNav.hasOpen('menu-category-detail')) window.XentraNav.pop('menu-category-detail');
      if (window.XentraNav.hasOpen('menu-categories')) window.XentraNav.pop('menu-categories');
    }
  };

  window.openBMMenuCategories = function (options) {
    options = options || {};
    setBMMenuView('categories');
    if (!options.fromNav && window.XentraNav) {
      if (window.XentraNav.hasOpen('menu-category-detail')) {
        window.XentraNav.pop('menu-category-detail');
      } else {
        window.XentraNav.push(function () { window.openBMMenuHome({ fromNav: true }); }, 'menu-categories');
      }
    }
  };

  window.openBMMenuCategoryDetail = function (categoryId, options) {
    options = options || {};
    _bmMenuState.selectedCategoryId = categoryId;
    _bmMenuState.categoryFilter = categoryId;
    setBMMenuView('detail');

    if (!options.fromNav && window.XentraNav) {
      window.XentraNav.push(function () { window.openBMMenuCategories({ fromNav: true }); }, 'menu-category-detail');
    }

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
      homeBack.addEventListener('click', function () {
        if (_bmMenuState.isSorting) {
          window.toggleBMCategorySortMode(false, true);
          return;
        }
        window.openBMMenuHome();
      });
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

    /* Edit button di header detail kategori */
    var detailEditBtn = $('btn-bm-cat-detail-edit');
    if (detailEditBtn && !detailEditBtn.dataset.bound) {
      detailEditBtn.dataset.bound = '1';
      detailEditBtn.addEventListener('click', function () {
        var catId = _bmMenuState.selectedCategoryId;
        var cat = (_bmMenuState.categories || []).find(function (c) {
          return String(c.id) === String(catId);
        });
        if (cat && typeof window.openBCESubpageEdit === 'function') {
          window.openBCESubpageEdit(cat);
        }
      });
    }

    var dockSort = $('btn-bm-categories-sort');
    if (dockSort && !dockSort.dataset.bound) {
      dockSort.dataset.bound = '1';
      dockSort.addEventListener('click', function () { window.toggleBMCategorySortMode(); });
    }

    var dockAdd = $('btn-bm-categories-add');
    if (dockAdd && !dockAdd.dataset.bound) {
      dockAdd.dataset.bound = '1';
      dockAdd.addEventListener('click', function () { promptAddBMBranchCategory(); });
    }

    var dockSave = $('btn-bm-categories-save-order');
    if (dockSave && !dockSave.dataset.bound) {
      dockSave.dataset.bound = '1';
      dockSave.addEventListener('click', function () { window.saveBMCategorySortOrder(); });
    }

    var dockCancelSort = $('btn-bm-categories-cancel-sort');
    if (dockCancelSort && !dockCancelSort.dataset.bound) {
      dockCancelSort.dataset.bound = '1';
      dockCancelSort.addEventListener('click', function () { window.toggleBMCategorySortMode(false, true); });
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
        if (_bmMenuState.isSorting) return;
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
        var isBranchActive = menu.branch_is_available !== false && menu.branch_menu_is_available !== false;
        var isCommercialAvail = menu.is_available !== false && menu.availability !== false;
        return Object.assign({}, menu, {
          id: menuId,
          menu_id: menuId,
          menu_name: displayName,
          name: displayName,
          master_name: menu.title || menu.name || 'Menu',
          category_ids: categories.map(function (cat) { return String(cat.id); }),
          categories: categories,
          menu_composition: menu,
          is_available: isCommercialAvail,
          branch_is_available: isBranchActive,
          blocking_reason: menu.blocking_reason || null
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

    var statusFilter = _bmMenuState.categoryStatusFilter || 'active';
    var categories = (_bmMenuState.categories || []).filter(function (cat) {
      if (statusFilter === 'inactive') return cat.is_active === 0 || cat.is_active === false;
      return !(cat.is_active === 0 || cat.is_active === false);
    });
    categories.sort(function (a, b) {
      return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
    });

    // Synchronize tab UI buttons
    var activeTab = document.querySelector('[data-menu-category-status="active"]');
    var inactiveTab = document.querySelector('[data-menu-category-status="inactive"]');
    if (activeTab && inactiveTab) {
      activeTab.classList.toggle('is-active', statusFilter !== 'inactive');
      inactiveTab.classList.toggle('is-active', statusFilter === 'inactive');
    }

    if (!categories.length) {
      bar.classList.add('is-empty');
      bar.innerHTML = '<div class="x-menu-empty-state">' +
        (statusFilter === 'inactive'
          ? 'Belum ada kategori nonaktif.'
          : 'Belum ada kategori aktif. Tambahkan kategori untuk mulai mengelompokkan menu.') +
        '</div>';
      return;
    }

    bar.classList.remove('is-empty');

    var isSorting = Boolean(_bmMenuState.isSorting);

    // In sort mode, ONLY ACTIVE categories are sorted! Nonactive categories are never included.
    var effectiveStatus = isSorting ? 'active' : statusFilter;
    var categories = (_bmMenuState.categories || []).filter(function (cat) {
      var isActive = cat.is_active !== 0 && cat.is_active !== false;
      return effectiveStatus === 'inactive' ? !isActive : isActive;
    });

    if (!categories.length) {
      bar.classList.add('is-empty');
      bar.innerHTML = '<div class="x-menu-empty-state">' +
        (isSorting
          ? 'Belum ada kategori untuk diurutkan.'
          : (statusFilter === 'inactive'
              ? 'Belum ada kategori nonaktif.'
              : 'Belum ada kategori aktif. Tambahkan kategori untuk mulai mengelompokkan menu.')) +
        '</div>';
      return;
    }

    bar.classList.remove('is-empty');

    bar.innerHTML = categories.map(function (cat, idx) {
      var count = (_bmMenuState.products || []).filter(function (p) {
        var ids = Array.isArray(p.category_ids) ? p.category_ids.map(String) : [];
        return ids.indexOf(String(cat.id)) !== -1;
      }).length;

      var isActive = cat.is_active !== 0 && cat.is_active !== false;
      var toggleIconSrc = isActive
        ? '/merchant-app/assets/icons/green-toggle.svg'
        : '/merchant-app/assets/icons/red-toggle.svg';

      var actionContent = '';
      if (isSorting) {
        // Drag handle asset from Owner App (gravity-ui_equal.svg - Bodyas.svg)
        actionContent =
          '<div class="x-menu-category-drag-handle" data-drag-handle="1" aria-label="Geser untuk mengatur urutan" title="Geser untuk mengatur urutan">' +
            '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
              '<path d="M10.9688 8.9375C11.1304 8.9375 11.2854 8.8733 11.3996 8.75902C11.5139 8.64474 11.5781 8.48974 11.5781 8.32812C11.5781 8.16651 11.5139 8.01151 11.3996 7.89723C11.2854 7.78295 11.1304 7.71875 10.9688 7.71875H2.03125C1.86963 7.71875 1.71464 7.78295 1.60036 7.89723C1.48608 8.01151 1.42188 8.16651 1.42188 8.32812C1.42188 8.48974 1.48608 8.64474 1.60036 8.75902C1.71464 8.8733 1.86963 8.9375 2.03125 8.9375H10.9688ZM10.9688 5.28125C11.1304 5.28125 11.2854 5.21705 11.3996 5.10277C11.5139 4.98849 11.5781 4.83349 11.5781 4.67188C11.5781 4.51026 11.5139 4.35526 11.3996 4.24098C11.2854 4.1267 11.1304 4.0625 10.9688 4.0625H2.03125C1.86963 4.0625 1.71464 4.1267 1.60036 4.24098C1.48608 4.35526 1.42188 4.51026 1.42188 4.67188C1.42188 4.83349 1.48608 4.98849 1.60036 5.10277C1.71464 5.21705 1.86963 5.28125 2.03125 5.28125H10.9688Z" fill-rule="evenodd" clip-rule="evenodd" fill="#303030"/>' +
            '</svg>' +
          '</div>';
      } else {
        actionContent =
          '<button type="button" class="x-menu-category-toggle-btn" role="switch" aria-checked="' + (isActive ? 'true' : 'false') + '" aria-label="Ubah status ' + esc(cat.name) + '" data-toggle-cat-id="' + esc(cat.id) + '" data-current-active="' + (isActive ? 1 : 0) + '">' +
            '<img src="' + toggleIconSrc + '" alt="' + (isActive ? 'Aktif' : 'Nonaktif') + '" class="x-menu-category-toggle-img" width="45" height="31" draggable="false">' +
          '</button>' +
          '<svg class="x-menu-category-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#303030" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
      }

      return '<div class="x-menu-category-card x-menu-category-row' + (isSorting ? ' is-drag-sorting' : '') + '" data-category-id="' + esc(cat.id) + '" data-category-index="' + idx + '">' +
        '<div class="x-menu-category-card-main x-menu-category-main" role="button" tabindex="0">' +
          '<div class="x-menu-category-info x-menu-category-copy">' +
            '<strong class="x-menu-category-title">' + esc(cat.name) + '</strong>' +
            '<span class="x-menu-category-menu-count"><small>' + count + ' menu</small></span>' +
          '</div>' +
          '<div class="x-menu-category-actions-group x-menu-category-row-actions">' +
            actionContent +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    Array.prototype.forEach.call(bar.querySelectorAll('.x-menu-category-card'), function (row, idx) {
      var catId = row.getAttribute('data-category-id');
      var main = row.querySelector('.x-menu-category-card-main');

      if (isSorting) {
        bindCategoryDrag(row, catId, idx);
      } else {
        if (main) {
          main.addEventListener('click', function () { window.openBMMenuCategoryDetail(catId); });
          main.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              window.openBMMenuCategoryDetail(catId);
            }
          });
        }
        var toggleBtn = row.querySelector('[data-toggle-cat-id]');
        if (toggleBtn) {
          toggleBtn.addEventListener('click', function (event) {
            event.stopPropagation();
            var current = parseInt(this.getAttribute('data-current-active'), 10);
            window.toggleBMBranchCategoryStatus(catId, current, event);
          });
        }
      }
    });
  }

  // Pointer Drag & FLIP reorder engine (Owner App Parity: CategorySortPage.jsx)
  var _bmDragState = {
    activeId: null,
    session: null,
    isSettling: false
  };

  function triggerHaptic(ms) {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(ms || 8);
      }
    } catch (_) {}
  }

  function syncCategoriesFromDOM() {
    var bar = $('bm-menu-categories-bar');
    if (!bar) return;
    var domIds = Array.from(bar.querySelectorAll('.x-menu-category-card')).map(function (c) {
      return c.getAttribute('data-category-id');
    });
    var catMap = {};
    (_bmMenuState.categories || []).forEach(function (c) {
      catMap[String(c.id)] = c;
    });
    var activeSorted = domIds.map(function (id) { return catMap[id]; }).filter(Boolean);
    var inactives = (_bmMenuState.categories || []).filter(function (c) {
      return c.is_active === 0 || c.is_active === false;
    });
    _bmMenuState.categories = activeSorted.concat(inactives);
  }

  function checkCategorySortHasChanged() {
    var initial = _bmMenuState.initialSortOrder || [];
    var bar = $('bm-menu-categories-bar');
    if (!bar) return false;
    var currentActiveIds = Array.from(bar.querySelectorAll('.x-menu-category-card')).map(function (c) {
      return c.getAttribute('data-category-id');
    });
    if (!initial.length || initial.length !== currentActiveIds.length) return false;
    for (var i = 0; i < currentActiveIds.length; i++) {
      if (currentActiveIds[i] !== initial[i]) return true;
    }
    return false;
  }

  function updateCategorySaveButtonState() {
    var saveBtn = $('btn-bm-categories-save-order');
    if (!saveBtn) return;
    var hasChanged = checkCategorySortHasChanged();
    if (hasChanged) {
      saveBtn.classList.add('has-changed');
    } else {
      saveBtn.classList.remove('has-changed');
    }
  }

  function getBMScrollContainer(el) {
    var cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      var style = window.getComputedStyle(cur);
      var ov = style.overflowY;
      if (ov === 'auto' || ov === 'scroll' || ov === 'overlay') {
        return cur;
      }
      cur = cur.parentElement;
    }
    return window;
  }

  var _bmAutoScrollState = {
    rafId: null,
    speed: 0
  };

  function updateAutoScrollSpeed(clientY) {
    var topThreshold = 120;
    var bottomThreshold = window.innerHeight - 130;

    if (clientY < topThreshold) {
      var dist = topThreshold - clientY;
      _bmAutoScrollState.speed = -Math.min(16, Math.max(3, dist * 0.22));
    } else if (clientY > bottomThreshold) {
      var dist = clientY - bottomThreshold;
      _bmAutoScrollState.speed = Math.min(16, Math.max(3, dist * 0.22));
    } else {
      _bmAutoScrollState.speed = 0;
    }
  }

  function startAutoScroll(bar, cardEl) {
    if (_bmAutoScrollState.rafId) return;

    function step() {
      var session = _bmDragState.session;
      if (!session) {
        _bmAutoScrollState.rafId = null;
        _bmAutoScrollState.speed = 0;
        return;
      }

      var speed = _bmAutoScrollState.speed;
      if (speed !== 0) {
        var sc = session.scrollContainer;
        var actual = 0;
        if (sc === window) {
          var before = window.scrollY;
          window.scrollBy(0, speed);
          actual = window.scrollY - before;
        } else if (sc && typeof sc.scrollTop === 'number') {
          var before = sc.scrollTop;
          sc.scrollTop += speed;
          actual = sc.scrollTop - before;
        }

        if (actual !== 0) {
          session.anchorY -= actual;
          evaluateDragAt(session.lastClientY, bar, cardEl);
        }
      }

      _bmAutoScrollState.rafId = requestAnimationFrame(step);
    }

    _bmAutoScrollState.rafId = requestAnimationFrame(step);
  }

  function stopAutoScroll() {
    if (_bmAutoScrollState.rafId) {
      cancelAnimationFrame(_bmAutoScrollState.rafId);
      _bmAutoScrollState.rafId = null;
    }
    _bmAutoScrollState.speed = 0;
  }

  function evaluateDragAt(currentY, bar, cardEl) {
    var session = _bmDragState.session;
    if (!session || typeof currentY !== 'number') return;

    var dy = currentY - session.anchorY;
    var threshold = session.pitch * 0.52;
    var currentCards = bar.querySelectorAll('.x-menu-category-card');

    var maxSteps = 4;
    while (dy > threshold && session.currentIndex < currentCards.length - 1 && maxSteps > 0) {
      maxSteps--;
      var toIdx = session.currentIndex + 1;

      // 1. Capture tops of all cards before DOM move
      var prevTops = new Map();
      Array.prototype.forEach.call(bar.querySelectorAll('.x-menu-category-card'), function (c) {
        prevTops.set(c.getAttribute('data-category-id'), c.getBoundingClientRect().top);
      });

      // 2. Move cardEl in the DOM: insert after target sibling
      var targetSibling = cardEl.nextElementSibling;
      if (targetSibling) {
        bar.insertBefore(cardEl, targetSibling.nextElementSibling);
      }

      // 3. Sync memory array from DOM sequence
      syncCategoriesFromDOM();

      // 4. Update session anchor & index
      session.currentIndex = toIdx;
      session.anchorY += session.pitch;
      dy = currentY - session.anchorY;

      // 5. Haptic feedback
      triggerHaptic(6);

      // 6. Sibling FLIP transition
      Array.prototype.forEach.call(bar.querySelectorAll('.x-menu-category-card'), function (c) {
        var id = c.getAttribute('data-category-id');
        if (id === session.id) return;
        var prevTop = prevTops.get(id);
        if (typeof prevTop !== 'number') return;
        var newTop = c.getBoundingClientRect().top;
        var deltaY = prevTop - newTop;
        if (Math.abs(deltaY) > 1) {
          c.style.transition = 'none';
          c.style.transform = 'translate3d(0, ' + deltaY + 'px, 0)';
          void c.offsetHeight; // force reflow
          c.style.transition = 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)';
          c.style.transform = 'translate3d(0, 0, 0)';
        }
      });

      // 7. Update Save button
      updateCategorySaveButtonState();
      currentCards = bar.querySelectorAll('.x-menu-category-card');
    }

    while (dy < -threshold && session.currentIndex > 0 && maxSteps > 0) {
      maxSteps--;
      var toIdx = session.currentIndex - 1;

      // 1. Capture tops of all cards before DOM move
      var prevTops = new Map();
      Array.prototype.forEach.call(bar.querySelectorAll('.x-menu-category-card'), function (c) {
        prevTops.set(c.getAttribute('data-category-id'), c.getBoundingClientRect().top);
      });

      // 2. Move cardEl in the DOM: insert before previous sibling
      var targetSibling = cardEl.previousElementSibling;
      if (targetSibling) {
        bar.insertBefore(cardEl, targetSibling);
      }

      // 3. Sync memory array from DOM sequence
      syncCategoriesFromDOM();

      // 4. Update session anchor & index
      session.currentIndex = toIdx;
      session.anchorY -= session.pitch;
      dy = currentY - session.anchorY;

      // 5. Haptic feedback
      triggerHaptic(6);

      // 6. Sibling FLIP transition
      Array.prototype.forEach.call(bar.querySelectorAll('.x-menu-category-card'), function (c) {
        var id = c.getAttribute('data-category-id');
        if (id === session.id) return;
        var prevTop = prevTops.get(id);
        if (typeof prevTop !== 'number') return;
        var newTop = c.getBoundingClientRect().top;
        var deltaY = prevTop - newTop;
        if (Math.abs(deltaY) > 1) {
          c.style.transition = 'none';
          c.style.transform = 'translate3d(0, ' + deltaY + 'px, 0)';
          void c.offsetHeight; // force reflow
          c.style.transition = 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)';
          c.style.transform = 'translate3d(0, 0, 0)';
        }
      });

      // 7. Update Save button
      updateCategorySaveButtonState();
      currentCards = bar.querySelectorAll('.x-menu-category-card');
    }

    cardEl.style.transform = 'translate3d(0, ' + dy + 'px, 0) scale(1.025)';
  }

  function bindCategoryDrag(cardEl, catId) {
    function startDrag(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (!_bmMenuState.isSorting) return;
      if (_bmDragState.session || _bmDragState.isSettling) return;

      var isHandle = !!(e.target && e.target.closest && (e.target.closest('.x-menu-category-drag-handle') || e.target.closest('.x-menu-category-actions-group')));
      if (e.pointerType === 'touch' && !isHandle) {
        // Allow mobile vertical scroll gesture on the card body!
        return;
      }
      if (e.cancelable) e.preventDefault();

      var bar = $('bm-menu-categories-bar');
      if (!bar) return;

      // Clear any rogue active drag/settle classes across all cards
      Array.prototype.forEach.call(bar.querySelectorAll('.x-menu-category-card'), function (c) {
        c.classList.remove('is-dragging', 'is-settling');
        c.style.transition = '';
        c.style.transform = '';
        c.style.zIndex = '';
      });

      var allCards = Array.from(bar.querySelectorAll('.x-menu-category-card'));
      var currentIndex = allCards.indexOf(cardEl);
      if (currentIndex === -1) return;

      var clientY = e.clientY;
      var pointerId = e.pointerId;
      var rect = cardEl.getBoundingClientRect();
      var pitch = (rect.height || 73) + 12;
      var scrollContainer = getBMScrollContainer(cardEl);

      _bmDragState.session = {
        id: String(catId),
        el: cardEl,
        pointerId: pointerId,
        currentIndex: currentIndex,
        anchorY: clientY,
        lastClientY: clientY,
        pitch: pitch,
        scrollContainer: scrollContainer
      };
      _bmDragState.activeId = String(catId);
      _bmDragState.isSettling = false;

      cardEl.classList.add('is-dragging');
      cardEl.style.zIndex = '50';
      cardEl.style.willChange = 'transform';
      cardEl.style.transition = 'none';
      cardEl.style.transform = 'translate3d(0, 0, 0) scale(1.025)';
      triggerHaptic(10);

      if (pointerId !== undefined && typeof cardEl.setPointerCapture === 'function') {
        try { cardEl.setPointerCapture(pointerId); } catch (_) {}
      }

      function onPointerMove(moveEvent) {
        var session = _bmDragState.session;
        if (!session) return;
        if (moveEvent.pointerId !== undefined && session.pointerId !== undefined && moveEvent.pointerId !== session.pointerId) {
          return;
        }
        if (moveEvent.cancelable) moveEvent.preventDefault();
        var currentY = moveEvent.clientY;
        if (typeof currentY !== 'number') return;

        session.lastClientY = currentY;
        updateAutoScrollSpeed(currentY);
        if (_bmAutoScrollState.speed !== 0) {
          startAutoScroll(bar, cardEl);
        }

        evaluateDragAt(currentY, bar, cardEl);
      }

      function onPointerUp(upEvent) {
        var session = _bmDragState.session;
        if (!session) return;
        if (upEvent && upEvent.pointerId !== undefined && session.pointerId !== undefined && upEvent.pointerId !== session.pointerId) {
          return;
        }

        stopAutoScroll();

        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);

        if (upEvent && upEvent.pointerId !== undefined && typeof cardEl.releasePointerCapture === 'function') {
          try { cardEl.releasePointerCapture(upEvent.pointerId); } catch (_) {}
        }

        _bmDragState.session = null;
        _bmDragState.isSettling = true;

        cardEl.classList.remove('is-dragging');
        cardEl.classList.add('is-settling');
        cardEl.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 220ms ease';
        cardEl.style.transform = 'translate3d(0, 0, 0) scale(1)';

        setTimeout(function () {
          cardEl.classList.remove('is-settling');
          cardEl.style.transition = '';
          cardEl.style.transform = '';
          cardEl.style.willChange = '';
          cardEl.style.zIndex = '';
          _bmDragState.activeId = null;
          _bmDragState.isSettling = false;
          updateCategorySaveButtonState();
        }, 220);
      }

      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    }

    cardEl.addEventListener('pointerdown', startDrag);
  }

  var _lastSortToggleTime = 0;
  window.toggleBMCategorySortMode = function (forceState, isCancelling) {
    var now = Date.now();
    if (typeof forceState !== 'boolean' && (now - _lastSortToggleTime < 300)) {
      return;
    }
    _lastSortToggleTime = now;

    if (typeof forceState === 'boolean') {
      _bmMenuState.isSorting = forceState;
    } else {
      _bmMenuState.isSorting = !_bmMenuState.isSorting;
    }

    var banner = $('bm-menu-category-sort-banner');
    var tabs = document.querySelector('#bm-menu-categories-view .x-menu-category-tabs');
    var activeTabBtn = tabs ? tabs.querySelector('[data-menu-category-status="active"]') : null;
    var inactiveTabBtn = tabs ? tabs.querySelector('[data-menu-category-status="inactive"]') : null;
    var sortBtn = $('btn-bm-categories-sort');
    var addBtn = $('btn-bm-categories-add');
    var cancelSortBtn = $('btn-bm-categories-cancel-sort');
    var saveBtn = $('btn-bm-categories-save-order');

    if (_bmMenuState.isSorting) {
      _bmMenuState.categoryStatusFilter = 'active';
      if (activeTabBtn) activeTabBtn.classList.add('is-active');
      if (inactiveTabBtn) {
        inactiveTabBtn.classList.remove('is-active');
        inactiveTabBtn.disabled = true;
        inactiveTabBtn.classList.add('is-disabled');
      }

      var activeCats = (_bmMenuState.categories || []).filter(function (c) {
        return c.is_active !== 0 && c.is_active !== false;
      });
      _bmMenuState.initialSortOrder = activeCats.map(function (c) { return String(c.id); });

      if (banner) banner.style.display = 'flex';
      if (tabs) tabs.style.display = 'flex';
      if (sortBtn) sortBtn.style.display = 'none';
      if (addBtn) addBtn.style.display = 'none';
      if (cancelSortBtn) cancelSortBtn.style.display = 'flex';
      if (saveBtn) {
        saveBtn.style.display = 'flex';
        saveBtn.classList.remove('has-changed');
        saveBtn.textContent = 'Simpan';
      }
    } else {
      stopAutoScroll();
      if (_bmDragState.session) {
        _bmDragState.session = null;
        _bmDragState.isSettling = false;
        _bmDragState.activeId = null;
      }
      if (inactiveTabBtn) {
        inactiveTabBtn.disabled = false;
        inactiveTabBtn.classList.remove('is-disabled');
      }

      if (isCancelling && _bmMenuState.initialSortOrder) {
        var initialMap = {};
        _bmMenuState.initialSortOrder.forEach(function (id, idx) { initialMap[id] = idx; });
        _bmMenuState.categories.sort(function (a, b) {
          var idxA = initialMap[String(a.id)];
          var idxB = initialMap[String(b.id)];
          if (idxA !== undefined && idxB !== undefined) return idxA - idxB;
          return 0;
        });
      }

      if (banner) banner.style.display = 'none';
      if (tabs) tabs.style.display = 'flex';
      if (sortBtn) sortBtn.style.display = '';
      if (addBtn) addBtn.style.display = '';
      if (cancelSortBtn) cancelSortBtn.style.display = 'none';
      if (saveBtn) saveBtn.style.display = 'none';
    }

    renderBMMenuCategoriesBar();
    updateCategorySaveButtonState();
  };

  window.saveBMCategorySortOrder = async function () {
    var hasChanged = checkCategorySortHasChanged();
    if (!hasChanged) {
      showToast('ℹ️ Urutan kategori belum diubah');
      return;
    }

    var saveBtn = $('btn-bm-categories-save-order');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Menyimpan...';
    }

    var orderedIds = (_bmMenuState.categories || []).map(function (c) { return String(c.id); });
    await saveBMBranchCategoryOrder(orderedIds);

    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Simpan';
    }

    window.toggleBMCategorySortMode(false);
  };

  window.toggleBMBranchCategoryStatus = async function (catId, currentActive, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    var branchId = getBMTargetBranchId();
    var nextActive = (currentActive === 1 || currentActive === true) ? 0 : 1;

    // Optimistic UI update
    var cat = (_bmMenuState.categories || []).find(function (c) { return String(c.id) === String(catId); });
    if (cat) cat.is_active = nextActive;
    renderBMMenuCategoriesBar();

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/categories/' + encodeURIComponent(catId), {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: nextActive })
      });
      var data = await res.json();
      if (!data.success) {
        var fbRes = await adminFetch(API_BASE + '/admin/categories/' + encodeURIComponent(catId) + '/status', {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ is_active: nextActive })
        });
        var fbData = await fbRes.json();
        if (!fbData.success) {
          throw new Error(data.error || fbData.error || 'Gagal mengubah status kategori.');
        }
      }
      showToast(nextActive === 1 ? '✓ Kategori diaktifkan.' : '✓ Kategori dinonaktifkan.');
    } catch (err) {
      if (cat) cat.is_active = currentActive;
      renderBMMenuCategoriesBar();
      showToast('❌ ' + (err.message || 'Gagal mengubah status kategori.'));
    }
  };

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
    // Buka subpage penuh (Frame 324) untuk tambah kategori baru
    if (typeof window.openBCESubpageCreate === 'function') {
      window.openBCESubpageCreate();
    } else {
      // fallback ke modal lama jika subpage belum siap
      openBranchCategoryCreateModal();
    }
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
      var name = (p.menu_name || p.name || p.title || '').toLowerCase();
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
      var isBranchActive = p.branch_is_available !== false;
      var catBadges = (p.category_names && p.category_names.length)
        ? p.category_names.map(function (cn) {
            return '<span class="x-badge x-badge-info" style="font-size:10px; margin-right:4px;">' + esc(cn) + '</span>';
          }).join('')
        : (p.branch_category_name
          ? '<span class="x-badge x-badge-info" style="font-size:10px;">' + esc(p.branch_category_name) + '</span>'
          : '<span class="text-muted" style="font-size:11px;">Tanpa kategori</span>');

      var statusBadge = isAvail
        ? '<span class="x-badge x-badge-success">TERSEDIA</span>'
        : (!isBranchActive)
        ? '<span class="x-badge x-badge-danger">NONAKTIF</span>'
        : '<span class="x-badge x-badge-danger" style="background:#fef2f2; color:#991b1b; border:1px solid #fecaca;">HABIS</span>';

      var toggleBtn = '<label class="x-toggle x-menu-availability-toggle' + (isAvail ? ' x-toggle-on' : '') + '" title="' + (isAvail ? 'Tersedia' : 'Habis / Tidak Tersedia') + '">' +
        '<input type="checkbox" class="x-menu-availability-input" ' + (isAvail ? 'checked' : '') +
        ' aria-label="Ubah ketersediaan ' + esc(p.menu_name || p.name || p.title) + '">' +
        '<span class="x-toggle-slider"></span></label>';

      return '<tr class="x-merchant-data-row x-menu-row" data-menu-index="' + index + '">' +
        '<td data-label="Produk"><strong>' + esc(p.product_name || p.name) + '</strong></td>' +
        '<td data-label="Kategori">' + catBadges + '</td>' +
        '<td data-label="Harga"><strong>' + formatMoney(p.price) + '</strong></td>' +
        '<td data-label="Ketersediaan">' + statusBadge + '</td>' +
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
                openBMMenuDisplayNameEditor(product);
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

  async function openBMMenuDisplayNameEditor(product) {
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

    // Isi sheet memakai pola reusable .x-master-inline-*; tidak ada CSS inline
    // yang ditulis JavaScript.
    var wrap = document.createElement('div');
    wrap.className = 'x-master-inline-sheet-content';
    wrap.innerHTML =
      '<div class="x-master-inline-sheet">' +
        '<div class="x-master-inline-sheet-intro">' +
          '<strong>Nama Tampil Customer</strong>' +
          '<p>Master: ' + esc(masterName) + '</p>' +
        '</div>' +
        '<div class="x-master-inline-sheet-fields">' +
          '<div class="x-master-inline-field">' +
            '<label for="bm-display-name-input">Nama yang tampil ke customer</label>' +
            '<input id="bm-display-name-input" class="x-input" type="text" value="' + esc(currentOverride) + '" maxlength="100" autocomplete="off">' +
            '<small>Kosongkan untuk otomatis mengikuti nama Master. Nama ini hanya berlaku di resto Anda.</small>' +
          '</div>' +
        '</div>' +
        '<div class="x-master-inline-sheet-actions">' +
          '<button type="button" class="x-btn-secondary" data-action="cancel" style="display:none;">Batal</button>' +
          '<button type="button" class="x-btn-primary" data-action="save" style="width:100%; height:44px; justify-content:center;">Simpan</button>' +
        '</div>' +
      '</div>';
    var field = wrap.querySelector('#bm-display-name-input');

    window.XentraPresentation.open({
      id: 'merchant-menu-display-name',
      type: 'bottom-sheet',
      title: 'Nama Tampil Customer',
      content: wrap,
      dismissible: true
    });

    function closeSheet() {
      if (window.XentraPresentation && window.XentraPresentation.isOpen('merchant-menu-display-name')) {
        window.XentraPresentation.close('merchant-menu-display-name');
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

    var item = (_bmMenuState.products || []).find(function (p) { return p.menu_id === menuId; });
    if (nextVal === 1 && item && (item.is_available === false || item.blocking_reason === 'OUT_OF_STOCK')) {
      showToast('⚠️ Stok habis, tidak bisa di aktifkan');
      renderBMMenuTable();
      return;
    }

    if (item) {
      item.branch_is_available = nextVal === 1;
      if (nextVal === 0) item.is_available = false;
      renderBMMenuTable();
    }

    try {
      var res = await window.XentraCatalogClient.setBranchMenuAvailability(branchId, menuId, nextVal);
      var data = await res.json();
      if (res.ok && data.success) {
        if (nextVal === 1) {
          showToast('🟢 Menu berhasil diaktifkan.');
        } else {
          showToast('🔴 Menu dinonaktifkan.');
        }
        loadBMMenu();
      } else {
        showToast('Gagal mengubah status: ' + (data.error || 'Terjadi kesalahan'));
        loadBMMenu();
      }
    } catch (e) {
      showToast('Kesalahan jaringan.');
      loadBMMenu();
    }
  }
  window.toggleBMMenuAvailability = toggleBMMenuAvailability;

  window.removeBMBranchMenu = async function (menuId, menuName) {
    var branchId = getBMTargetBranchId();
    if (!branchId) return;

    if (!confirm('Hapus "' + (menuName || 'menu ini') + '" dari daftar menu? Menu tidak akan lagi tampil di halaman pemesanan pelanggan.')) return;

    try {
      var res = await window.XentraCatalogClient.removeBranchMenu(branchId, menuId);
      var data = await res.json();
      if (data.success) {
        showToast('✅ Menu berhasil dihapus.');
        loadBMMenu();
      } else {
        showToast('❌ ' + (data.error || 'Gagal menghapus menu.'));
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

    // Immediately resolve active branch category and set dynamic modal title
    var activeBranchCat = null;
    var currentCatId = _bmMenuState.selectedCategoryId || (_bmMenuState.categoryFilter !== 'all' ? _bmMenuState.categoryFilter : null);
    if (currentCatId && _bmMenuState.categories) {
      activeBranchCat = _bmMenuState.categories.find(function (c) { return String(c.id) === String(currentCatId); });
    }
    var detailTitleEl = $('bm-menu-category-detail-title');
    var currentCatName = (activeBranchCat && activeBranchCat.name) ||
                         (detailTitleEl && detailTitleEl.textContent && detailTitleEl.textContent.trim() !== 'Kategori' ? detailTitleEl.textContent.trim() : null);

    var modalTitleEl = $('bm-add-catalog-title');
    if (modalTitleEl) {
      modalTitleEl.textContent = currentCatName ? ('Tambah Menu ke ' + currentCatName) : 'Tambah Menu';
    }

    var targetCatInput = $('bm-add-catalog-target-category');
    if (targetCatInput && currentCatId) {
      targetCatInput.value = String(currentCatId);
    }

    updateBMAddCatalogFooter();

    var container = $('bm-add-catalog-list');
    if (container) {
      container.innerHTML = '<div style="padding:32px 16px; text-align:center; color:#64748b; font-size:13px;">' +
        '<div style="font-size:24px; margin-bottom:8px;">⏳</div>' +
        '<div>Memuat Master Menu...</div>' +
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
          return Object.assign({}, p, {
            id: p.menu_id || p.id,
            menu_id: p.menu_id || p.id,
            name: p.name || p.title || 'Menu',
            master_category_id: p.master_category_id || p.category_id || (p.category && p.category.id) || null,
            master_category_name: p.master_category_name || (p.category && p.category.name) || p.category_name || null,
            is_adopted: false
          });
        });

        var adopted = (data.adopted_menus || data.adopted_products || []).map(function (menu) {
          return Object.assign({}, menu, {
            id: menu.menu_id || menu.id,
            menu_id: menu.menu_id || menu.id,
            name: menu.display_name_override || menu.title || menu.name || 'Menu',
            master_category_id: menu.master_category_id || menu.category_id || (menu.category && menu.category.id) || null,
            master_category_name: menu.master_category_name || (menu.category && menu.category.name) || menu.category_name || null,
            is_adopted: true
          });
        });

        // Unadopted first, then adopted marked
        _bmMenuState.allCatalogProducts = unadopted.concat(adopted);

        // Auto-lock target branch category
        var branchCats = data.categories || (_bmMenuState && _bmMenuState.categories) || [];
        var activeCatId = _bmMenuState.selectedCategoryId || (_bmMenuState.categoryFilter !== 'all' ? _bmMenuState.categoryFilter : null);
        var activeCat = branchCats.find(function (c) { return String(c.id) === String(activeCatId); });
        
        if (!activeCat && branchCats.length > 0) {
          activeCat = branchCats[0];
          activeCatId = activeCat.id;
        }

        if (targetCatInput) {
          targetCatInput.value = activeCat ? activeCat.id : '';
        }

        // Update modal dynamic title: "Tambah Menu ke <nama kategori>"
        var resolvedName = (activeCat && activeCat.name) || currentCatName;
        if (modalTitleEl) {
          modalTitleEl.textContent = resolvedName ? ('Tambah Menu ke ' + resolvedName) : 'Tambah Menu';
        }

        // Populate Master Categories filter options and pills
        _bmMenuState.addCatalogMasterCategoryFilter = 'all';
        setupBMMasterCategoriesFilter(data.master_categories || []);

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

  function setupBMMasterCategoriesFilter(masterCatsFromApi) {
    var masterCatMap = new Map();
    var allProducts = _bmMenuState.allCatalogProducts || [];

    // First collect from API master_categories if available
    (masterCatsFromApi || []).forEach(function (mc) {
      if (mc && mc.id) {
        masterCatMap.set(String(mc.id), { id: String(mc.id), name: mc.name || mc.category_name || 'Kategori' });
      }
    });

    // Also inspect products for any master category metadata
    allProducts.forEach(function (p) {
      var catId = p.master_category_id || (p.category && p.category.id) || (p.master_category && p.master_category.id);
      var catName = p.master_category_name || (p.category && p.category.name) || (p.master_category && p.master_category.name) || p.category_name;
      if (catId && !masterCatMap.has(String(catId))) {
        masterCatMap.set(String(catId), { id: String(catId), name: catName || 'Kategori' });
      }
    });

    var masterCatList = Array.from(masterCatMap.values());

    // 1. Populate Dropdown
    var filterSelect = $('bm-add-catalog-master-category-filter');
    if (filterSelect) {
      var opts = ['<option value="all">Semua Kategori Pusat</option>'];
      masterCatList.forEach(function (c) {
        opts.push('<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>');
      });
      filterSelect.innerHTML = opts.join('');
      filterSelect.value = _bmMenuState.addCatalogMasterCategoryFilter || 'all';
    }
  }

  window.setBMMasterCategoryFilter = function (catId) {
    _bmMenuState.addCatalogMasterCategoryFilter = catId || 'all';
    var filterSelect = $('bm-add-catalog-master-category-filter');
    if (filterSelect) {
      filterSelect.value = _bmMenuState.addCatalogMasterCategoryFilter;
    }
    renderBMAddCatalogList();
  };

  window.onBMMasterCategoryFilterChange = function () {
    var filterSelect = $('bm-add-catalog-master-category-filter');
    var val = filterSelect ? filterSelect.value : 'all';
    window.setBMMasterCategoryFilter(val);
  };

  window.closeBMAddCatalogModal = function () {
    var modal = $('modal-bm-add-catalog');
    if (modal) modal.style.display = 'none';
  };

  window.toggleBMAddCatalogSelectAll = function (isChecked) {
    if (!_bmMenuState.selectedCatalogProductIds) _bmMenuState.selectedCatalogProductIds = new Set();
    var all = _bmMenuState.allCatalogProducts || [];
    var q = (_bmMenuState.addCatalogSearchQuery || '').toLowerCase();
    var catFilter = _bmMenuState.addCatalogMasterCategoryFilter || 'all';

    var filtered = all.filter(function (p) {
      if (catFilter !== 'all') {
        var pCatId = p.master_category_id || (p.category && p.category.id) || (p.master_category && p.master_category.id);
        if (String(pCatId) !== String(catFilter)) return false;
      }
      if (q) {
        var match = (p.name || p.title || '').toLowerCase().indexOf(q) !== -1 ||
                    (p.description || '').toLowerCase().indexOf(q) !== -1 ||
                    (p.master_category_name || (p.category && p.category.name) || '').toLowerCase().indexOf(q) !== -1;
        if (!match) return false;
      }
      return true;
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
      countEl.textContent = count + ' menu dipilih';
    }
    var submitBtn = $('btn-bm-submit-adopt-catalog');
    if (submitBtn) {
      submitBtn.disabled = count === 0;
      submitBtn.textContent = count > 0 ? ('Tambahkan (' + count + ') Menu') : 'Tambahkan Menu';
    }

    // Sync select-all checkbox state with currently filtered unadopted items
    var selectAllCb = $('bm-add-catalog-select-all');
    if (selectAllCb) {
      var all = _bmMenuState.allCatalogProducts || [];
      var q = (_bmMenuState.addCatalogSearchQuery || '').toLowerCase();
      var catFilter = _bmMenuState.addCatalogMasterCategoryFilter || 'all';

      var filteredUnadopted = all.filter(function (p) {
        if (p.is_adopted) return false;
        if (catFilter !== 'all') {
          var pCatId = p.master_category_id || (p.category && p.category.id) || (p.master_category && p.master_category.id);
          if (String(pCatId) !== String(catFilter)) return false;
        }
        if (q) {
          var match = (p.name || p.title || '').toLowerCase().indexOf(q) !== -1 ||
                      (p.description || '').toLowerCase().indexOf(q) !== -1 ||
                      (p.master_category_name || (p.category && p.category.name) || '').toLowerCase().indexOf(q) !== -1;
          if (!match) return false;
        }
        return true;
      });

      var selectedSet = _bmMenuState.selectedCatalogProductIds || new Set();
      if (filteredUnadopted.length > 0 && filteredUnadopted.every(function (p) { return selectedSet.has(String(p.id)); })) {
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
    var catFilter = _bmMenuState.addCatalogMasterCategoryFilter || 'all';

    var filtered = all.filter(function (p) {
      if (catFilter !== 'all') {
        var pCatId = p.master_category_id || (p.category && p.category.id) || (p.master_category && p.master_category.id);
        if (String(pCatId) !== String(catFilter)) return false;
      }
      if (q) {
        var match = (p.name || p.title || '').toLowerCase().indexOf(q) !== -1 ||
                    (p.description || '').toLowerCase().indexOf(q) !== -1 ||
                    (p.master_category_name || (p.category && p.category.name) || '').toLowerCase().indexOf(q) !== -1;
        if (!match) return false;
      }
      return true;
    });

    if (!filtered.length) {
      var emptyMsg = 'Belum ada Master Menu yang tersedia untuk kategori ini.';
      if (q) {
        emptyMsg = 'Tidak ada Master Menu yang sesuai dengan pencarian "' + esc(q) + '".';
      }
      container.innerHTML = '<div style="background:#f8fafc; border:1px dashed #cbd5e1; border-radius:8px; padding:28px; text-align:center; color:#64748b; font-size:13px;">' +
        emptyMsg +
      '</div>';
      updateBMAddCatalogFooter();
      return;
    }

    var selectedSet = _bmMenuState.selectedCatalogProductIds || new Set();

    container.innerHTML = filtered.map(function (p) {
      var pid = String(p.menu_id || p.id);
      var img = p.image_url || (p.components && p.components[0] && p.components[0].image_url) || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var modeBadge = '<span class="x-badge x-badge-info" style="font-size:11px;">' +
        (String(p.menu_type || '').toUpperCase() === 'PACKAGE' ? 'Menu Paket' : 'Menu Satuan') +
        '</span>';

      var masterCatName = p.master_category_name || (p.category && p.category.name) || (p.master_category && p.master_category.name);
      var masterCatBadge = masterCatName
        ? '<span class="x-badge" style="font-size:11px; background:#f1f5f9; color:#475569; border:1px solid #e2e8f0;">' + esc(masterCatName) + '</span>'
        : '';

      if (p.is_adopted) {
        return '<div class="x-catalog-picker-card is-adopted" id="catalog-pick-card-' + esc(pid) + '">' +
          '<div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0; width:100%;">' +
            '<img src="' + esc(img) + '" style="width:44px; height:44px; border-radius:6px; object-fit:cover; flex-shrink:0; border:1px solid #e2e8f0;" alt="">' +
            '<div style="min-width:0; flex:1;">' +
              '<div style="font-weight:700; font-size:13.5px; color:#334155; white-space:normal; word-break:break-word; overflow-wrap:break-word; line-height:1.35;">' + esc(p.name || p.title || 'Menu') + '</div>' +
              '<div style="display:flex; gap:6px; align-items:center; margin-top:3px; flex-wrap:wrap;">' +
                '<span style="font-size:12px; font-weight:700; color:#64748b;">' + formatMoney(p.price || p.master_price) + '</span>' +
                modeBadge +
                masterCatBadge +
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
        '<div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0; width:100%;">' +
          '<input type="checkbox" class="x-catalog-picker-checkbox" id="catalog-pick-cb-' + esc(pid) + '" ' + (isSelected ? 'checked' : '') + ' onclick="event.stopPropagation(); onBMSelectCatalogProduct(\'' + esc(pid) + '\', this.checked)">' +
          '<img src="' + esc(img) + '" style="width:44px; height:44px; border-radius:6px; object-fit:cover; flex-shrink:0; border:1px solid #e2e8f0;" alt="">' +
          '<div style="min-width:0; flex:1;">' +
            '<div style="font-weight:700; font-size:13.5px; color:#0f172a; white-space:normal; word-break:break-word; overflow-wrap:break-word; line-height:1.35;">' + esc(p.name) + '</div>' +
            '<div style="display:flex; gap:6px; align-items:center; margin-top:3px; flex-wrap:wrap;">' +
              '<span style="font-size:12px; font-weight:700; color:var(--text-main);">' + formatMoney(p.price) + '</span>' +
              modeBadge +
              masterCatBadge +
            '</div>' +
          '</div>' +
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
      showToast('⚠️ Pilih minimal 1 Master Menu untuk diadopsi.');
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
      showToast('✅ Berhasil menambahkan ' + successCount + ' menu!');
      closeBMAddCatalogModal();
      if (typeof loadBMMenu === 'function') await loadBMMenu();
    } else {
      showToast('❌ ' + (lastError || 'Gagal menambahkan menu terpilih.'));
    }
  };


  // The shared branch-catalog module refreshes the BM menu after mutations.
  var Catalog = window.XentraMerchantBranchCatalog;
  if (Catalog) {
    Catalog.setHooks({ refreshBMMenu: function () { loadBMMenu(); } });
    Catalog.setBmMenuState(_bmMenuState);
  }
})();
