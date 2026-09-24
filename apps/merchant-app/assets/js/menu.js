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
    addCatalogSearchQuery: '',
    fetchSeq: 0
  };


  async function loadBMMenu() {
    var branchId = getBMTargetBranchId();
    if (!branchId) return;

    XentraMerchantBranchCatalog.state.branchId = branchId;

    var tbody = $('bm-menu-tbody');
    if (tbody && (!_bmMenuState.products || !_bmMenuState.products.length)) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Memuat daftar menu cabang...</td></tr>';
    }

    var currentSeq = ++_bmMenuState.fetchSeq;

    try {
      var [prodRes, catRes] = await Promise.all([
        adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/products', {
          headers: getAuthHeaders()
        }),
        adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/catalog', {
          headers: getAuthHeaders()
        })
      ]);

      var prodData = await prodRes.json();
      var catData = await catRes.json();

      if (currentSeq !== _bmMenuState.fetchSeq) return;

      if (catRes.ok && catData.success) {
        XentraMerchantBranchCatalog.state.catalogData = catData;
        _bmMenuState.categories = catData.categories || [];
        _bmMenuState.availableProducts = catData.available_master_products || [];
        renderBMMenuCategoriesBar();
      }

      if (prodRes.ok && prodData.success && Array.isArray(prodData.assignments)) {
        var catalogAdoptedMap = {};
        if (catData && catData.success && Array.isArray(catData.adopted_products)) {
          catData.adopted_products.forEach(function (ap) {
            catalogAdoptedMap[ap.product_id] = ap;
          });
        }

        _bmMenuState.products = prodData.assignments.map(function (p) {
          var ap = catalogAdoptedMap[p.product_id] || {};
          return Object.assign({}, ap, p, {
            branch_category_id: ap.branch_category_id || null,
            branch_category_name: ap.branch_category_name || null,
            category_ids: ap.category_ids || (ap.branch_category_id ? [ap.branch_category_id] : []),
            categories: ap.categories || [],
            pricing_mode: ap.pricing_mode || 'lock',
            master_price: ap.master_price || p.price,
            min_price: ap.min_price || null,
            max_price: ap.max_price || null,
            name_override: ap.name_override || null,
            description_override: ap.description_override || null,
            image_override: ap.image_override || null
          });
        });

        updateBMMenuStats(_bmMenuState.products);
        renderBMMenuTable();
      } else {
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-danger">Gagal memuat menu: ' + esc(prodData.error || 'Terjadi kesalahan') + '</td></tr>';
        }
      }
    } catch (err) {
      if (currentSeq !== _bmMenuState.fetchSeq) return;
      console.warn('[BM Menu Load Error]:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat menu cabang.</td></tr>';
      }
    }
  }
  window.loadBMMenu = loadBMMenu;

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
    renderBMMenuTable();
  }
  window.onBMMenuFilterChange = onBMMenuFilterChange;

  function setBMMenuCategoryFilter(catId) {
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

    bar.innerHTML = '';

    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'x-cat-filter-btn' + (_bmMenuState.categoryFilter === 'all' ? ' active' : '');
    allBtn.style.borderRadius = '20px';
    allBtn.textContent = 'Semua';
    allBtn.addEventListener('click', function () { setBMMenuCategoryFilter('all'); });
    bar.appendChild(allBtn);

    var categories = _bmMenuState.categories || [];
    if (!categories.length) {
      var hint = document.createElement('span');
      hint.className = 'text-muted';
      hint.style.fontSize = '12px';
      hint.textContent = 'Belum ada kategori cabang. Klik "+ Kategori Cabang" untuk membuat.';
      bar.appendChild(hint);
      return;
    }

    categories.forEach(function (cat) {
      var isActive = String(_bmMenuState.categoryFilter) === String(cat.id);

      var chip = document.createElement('span');
      chip.dataset.catId = cat.id;
      chip.draggable = true;
      chip.style.cssText = [
        'display:inline-flex;align-items:center;gap:0;border-radius:20px;overflow:hidden;',
        'border:1px solid ' + (isActive ? 'var(--x-primary,#10b981)' : '#e2e8f0') + ';',
        'background:' + (isActive ? '#f0fdf4' : '#f8fafc') + ';',
        'transition:box-shadow 0.15s,opacity 0.15s;',
        'cursor:grab;'
      ].join('');

      var handle = document.createElement('span');
      handle.title = 'Tahan & geser untuk ubah urutan';
      handle.style.cssText = 'padding:5px 4px 5px 10px;font-size:13px;color:#94a3b8;cursor:grab;user-select:none;';
      handle.textContent = '⠿';
      chip.appendChild(handle);

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

      var nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.draggable = false;
      nameBtn.style.cssText = 'border:none;background:none;padding:6px 8px 6px 2px;font-size:13px;font-weight:' + (isActive ? '700' : '500') + ';cursor:pointer;color:#1e293b;';
      nameBtn.textContent = cat.name;
      nameBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        setBMMenuCategoryFilter(cat.id);
      });
      chip.appendChild(nameBtn);

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.draggable = false;
      editBtn.title = 'Ubah nama & gambar kategori';
      editBtn.style.cssText = 'border:none;background:none;padding:5px 5px;font-size:12px;cursor:pointer;color:#64748b;';
      editBtn.textContent = '✏️';
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openBranchCategoryEditModal(cat);
      });
      chip.appendChild(editBtn);

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.draggable = false;
      delBtn.title = 'Hapus kategori cabang';
      delBtn.style.cssText = 'border:none;background:none;padding:6px 10px 6px 4px;font-size:12px;cursor:pointer;color:#ef4444;opacity:0.8;';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteBMBranchCategory(cat.id, cat.name);
      });
      chip.appendChild(delBtn);

      // Drag and drop ordering
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

        var newOrder = Array.from(bar.querySelectorAll('[data-cat-id]')).map(function (el) {
          return el.dataset.catId;
        });

        saveBMBranchCategoryOrder(newOrder);
      });

      bar.appendChild(chip);
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

    var filtered = (_bmMenuState.products || []).filter(function (p) {
      var name = (p.product_name || p.name || '').toLowerCase();
      var matchesSearch = !_bmMenuState.searchQuery || name.indexOf(_bmMenuState.searchQuery) !== -1;
      if (!matchesSearch) return false;

      var isAvail = (p.is_available === 1 || p.is_available === true);
      if (_bmMenuState.statusFilter === 'available' && !isAvail) return false;
      if (_bmMenuState.statusFilter === 'unavailable' && isAvail) return false;

      if (_bmMenuState.categoryFilter && _bmMenuState.categoryFilter !== 'all') {
        var pCatIds = Array.isArray(p.category_ids) && p.category_ids.length > 0
          ? p.category_ids.map(String)
          : (p.branch_category_id ? [String(p.branch_category_id)] : []);
        if (pCatIds.indexOf(String(_bmMenuState.categoryFilter)) === -1) return false;
      }

      return true;
    });

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Tidak ada produk yang sesuai dengan kriteria filter.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (p) {
      var isAvail = (p.is_available === 1 || p.is_available === true);
      var isMasterActive = (p.is_master_active === 1 || p.is_master_active === true || p.is_master_active === undefined);

      var branchStatusBadge = isAvail
        ? '<span class="x-badge x-badge-success" style="font-size:11px;">TERSEDIA</span>'
        : '<span class="x-badge x-badge-danger" style="font-size:11px;">HABIS (OFF)</span>';

      var masterStatusBadge = isMasterActive
        ? '<span class="x-badge" style="font-size:10px; background:#f1f5f9; color:#475569;">AKTIF (BRAND)</span>'
        : '<span class="x-badge x-badge-danger" style="font-size:10px;">NONAKTIF (BRAND)</span>';

      var toggleBtn = '<label class="x-toggle' + (isAvail ? ' x-toggle-on' : '') + '" title="' + (isAvail ? 'Menu tersedia' : 'Menu habis') + '">' +
        '<input type="checkbox" ' + (isAvail ? 'checked' : '') + ' onchange="toggleBMProductAvailability(\'' + esc(p.product_id) + '\', this.checked ? 1 : 0)" aria-label="Ubah ketersediaan menu cabang">' +
        '<span class="x-toggle-slider"></span>' +
      '</label>';

      var catBadges = (p.category_names && p.category_names.length)
        ? p.category_names.map(function (cn) { return '<span class="x-badge x-badge-info" style="font-size:10px; margin-right:4px;">' + esc(cn) + '</span>'; }).join('')
        : (p.branch_category_name ? '<span class="x-badge x-badge-info" style="font-size:10px;">' + esc(p.branch_category_name) + '</span>' : '<span class="text-muted" style="font-size:11px;">—</span>');

      var productDataJson = esc(JSON.stringify({
        product_id: p.product_id,
        name: p.product_name || p.name,
        price: p.price,
        master_price: p.master_price || p.price,
        pricing_mode: p.pricing_mode || 'lock',
        min_price: p.min_price,
        max_price: p.max_price,
        branch_category_id: p.branch_category_id,
        category_ids: p.category_ids || (p.branch_category_id ? [p.branch_category_id] : []),
        categories: p.categories || []
      }));

      return '<tr>' +
        '<td><strong>' + esc(p.product_name || p.name) + '</strong></td>' +
        '<td>' + catBadges + '</td>' +
        '<td>' + formatMoney(p.price) + '</td>' +
        '<td><strong>' + esc(p.stock != null ? p.stock : '—') + '</strong></td>' +
        '<td>' + branchStatusBadge + '</td>' +
        '<td>' + masterStatusBadge + '</td>' +
        '<td style="text-align:right; white-space:nowrap;">' +
          '<div style="display:inline-flex; align-items:center; gap:8px;">' +
            toggleBtn +
            '<button type="button" class="x-action-menu-trigger" aria-label="Aksi menu ' + esc(p.product_name || p.name) + '" onclick="XentraActionMenu.open(this, [' +
              '{ label: \'Edit Menu / Kategori Cabang\', icon: \'✏️\', onClick: function() { openBranchOverrideModal(\'' + productDataJson + '\'); } },' +
              '{ divider: true },' +
              '{ label: \'Hapus dari Cabang\', icon: \'🗑️\', destructive: true, onClick: function() { removeBMBranchProduct(\'' + esc(p.product_id) + '\', \'' + esc(p.product_name || p.name) + '\'); } }' +
            '])">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  async function toggleBMProductAvailability(productId, nextVal) {
    var branchId = getBMTargetBranchId();
    if (!branchId) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/products/' + encodeURIComponent(productId), {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_available: nextVal })
      });
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
  window.toggleBMProductAvailability = toggleBMProductAvailability;

  window.removeBMBranchProduct = async function (productId, productName) {
    var branchId = getBMTargetBranchId();
    if (!branchId) return;

    if (!confirm('Hapus "' + productName + '" dari katalog cabang ini? Menu tidak akan lagi tampil di halaman pemesanan pelanggan.')) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/products/' + encodeURIComponent(productId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Produk berhasil dihapus dari cabang.');
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
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/catalog', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success) {
        XentraMerchantBranchCatalog.state.catalogData = data;
        _bmMenuState.availableProducts = data.available_master_products || [];

        // Distinguish between already adopted and available master products
        var unadopted = (data.available_master_products || []).map(function (p) {
          return Object.assign({}, p, { is_adopted: false });
        });

        var adopted = (data.adopted_products || []).map(function (ap) {
          return {
            id: ap.product_id,
            name: ap.name,
            price: ap.price,
            master_price: ap.master_price,
            image_url: ap.image_url,
            pricing_mode: ap.pricing_mode,
            min_price: ap.min_price,
            max_price: ap.max_price,
            description: ap.description,
            is_adopted: true
          };
        });

        // Unadopted first, then adopted marked
        _bmMenuState.allCatalogProducts = unadopted.concat(adopted);

        // Populate branch categories target dropdown
        var catSelect = $('bm-add-catalog-target-category');
        if (catSelect) {
          var branchCats = data.categories || (_bmMenuState && _bmMenuState.categories) || [];
          var opts = ['<option value="">Otomatis / Menu Utama</option>'];
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
        var adoptPayload = { product_id: pid };
        if (targetCatId) {
          adoptPayload.branch_category_id = targetCatId;
          adoptPayload.category_ids = [targetCatId];
        }

        var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/adopt', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(adoptPayload)
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
      showToast('❌ ' + (lastError || 'Gagal mengadopsi produk terpilih.'));
    }
  };


  // The shared branch-catalog module refreshes the BM menu after mutations.
  var Catalog = window.XentraMerchantBranchCatalog;
  if (Catalog) {
    Catalog.setHooks({ refreshBMMenu: function () { loadBMMenu(); } });
    Catalog.setBmMenuState(_bmMenuState);
  }
})();
