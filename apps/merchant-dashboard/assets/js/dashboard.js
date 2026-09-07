/**
 * XENTRA CORE — MERCHANT & OWNER DASHBOARD JAVASCRIPT
 * Real-time SPA for Brand Theme, Product CRUD, Delivery Formula, & Live Orders
 */

(function () {
  'use strict';

  var API_BASE = '/api/v1';
  var TOKEN_KEY = 'xentra_merchant_token';
  var USER_KEY = 'xentra_merchant_user';

  function getAuthHeaders(extraHeaders) {
    var headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    var token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    return headers;
  }

  var state = {
    brand: null,
    categories: [],
    products: [],
    branches: [],
    orders: [],
    activeCategoryFilter: 'all'
  };

  // DOM Helpers
  function $(id) {
    return document.getElementById(id);
  }

  function formatMoney(amount) {
    return 'Rp' + Number(amount || 0).toLocaleString('id-ID');
  }

  // HTML-safe string escaping (prevents XSS in rendered product names, etc.)
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message, type) {
    var container = $('x-toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'x-toast';
    toast.innerHTML = '<span>⚡</span> <span>' + message + '</span>';
    container.appendChild(toast);

    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 3500);
  }

  /* =========================================================================
     TAB NAVIGATION & ROUTING
     ========================================================================= */
  function switchTab(tabId) {
    document.querySelectorAll('.x-nav-item').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    document.querySelectorAll('.x-tab-content').forEach(function (tab) {
      tab.classList.toggle('active', tab.id === 'tab-' + tabId);
    });

    var titles = {
      overview: { title: 'Ringkasan Resto', sub: 'Statistik penjualan dan status operasional' },
      brand: { title: 'Brand & Tampilan', sub: 'Kustomisasi logo, warna tema, dan identitas visual' },
      catalog: { title: 'Katalog Menu', sub: 'Kelola daftar menu makanan, harga, dan ketersediaan stok' },
      branches: { title: 'Cabang & Ongkir', sub: 'Atur lokasi outlet, radius, dan formula ongkir spasial' },
      orders: { title: 'Pesanan Masuk', sub: 'Antrean pesanan realtime dan update status dapur' },
      payments: { title: 'Integrasi Pembayaran', sub: 'Kredensial direct payment Midtrans & Tunai' }
    };

    if (titles[tabId]) {
      $('dash-page-title').textContent = titles[tabId].title;
      $('dash-page-subtitle').textContent = titles[tabId].sub;
    }

    if (tabId === 'catalog') {
      if (isBranchManager()) loadInlineBranchCatalog();
      else loadCatalog();
    }
    if (tabId === 'branches') loadBranches();
    if (tabId === 'orders') loadOrders();
    if (tabId === 'overview') loadOverview();
  }
  window.switchTab = switchTab;

  /* =========================================================================
     MODUL 1: BRAND & THEME COLOR CONTROLLER
     ========================================================================= */
  async function loadBrandSettings() {
    try {
      var res = await fetch(API_BASE + '/admin/brand', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data && data.brand) {
        state.brand = data.brand;
        applyBrandToUI(data.brand);
      }
    } catch (e) {
      console.warn('[Dashboard Brand Load Warn]:', e);
    }
  }

  function applyBrandToUI(brand) {
    if (!brand) return;

    $('brand-name').value = brand.name || 'Bangjo Resto';
    $('brand-tagline').value = brand.tagline || 'Official Online Food Ordering';
    $('brand-logo').value = brand.logo_url || '/assets/pwa/icon-192.png';
    $('brand-color').value = brand.primary_color || '#b6ff00';
    $('brand-color-hex').value = brand.primary_color || '#b6ff00';
    $('brand-domain').value = brand.custom_domain || 'app.mybangjo.com';

    $('dash-brand-title').textContent = brand.name || 'Bangjo Resto';
    $('dash-sidebar-logo').src = brand.logo_url || '/assets/pwa/icon-192.png';

    if ($('auth-brand-name')) $('auth-brand-name').textContent = brand.name || 'Bangjo Resto';
    if ($('auth-logo')) $('auth-logo').src = brand.logo_url || '/assets/pwa/icon-192.png';

    renderBannersList(brand.banners);
    updateLiveMockupPreview(brand.name, brand.logo_url, brand.primary_color);
  }

  function updateLiveMockupPreview(name, logo, color) {
    color = color || $('brand-color').value || '#b6ff00';
    logo = logo || $('brand-logo').value || '/assets/pwa/icon-192.png';
    name = name || $('brand-name').value || 'Bangjo Resto';

    $('mock-title').textContent = name;
    $('mock-logo').src = logo;

    document.documentElement.style.setProperty('--primary-color', color);

    var mockPill = $('mock-cat-1');
    if (mockPill) mockPill.style.backgroundColor = color;

    var mockAddBtn = $('mock-btn-tambah');
    if (mockAddBtn) mockAddBtn.style.backgroundColor = color;

    var mockCartBtn = $('mock-cart-btn');
    if (mockCartBtn) mockCartBtn.style.backgroundColor = color;
  }

  function initBrandListeners() {
    var colorPicker = $('brand-color');
    var colorHex = $('brand-color-hex');
    var logoInput = $('brand-logo');
    var nameInput = $('brand-name');

    colorPicker.addEventListener('input', function () {
      colorHex.value = colorPicker.value;
      updateLiveMockupPreview(nameInput.value, logoInput.value, colorPicker.value);
    });

    colorHex.addEventListener('input', function () {
      if (/^#[0-9A-Fa-f]{6}$/.test(colorHex.value)) {
        colorPicker.value = colorHex.value;
        updateLiveMockupPreview(nameInput.value, logoInput.value, colorHex.value);
      }
    });

    logoInput.addEventListener('input', function () {
      updateLiveMockupPreview(nameInput.value, logoInput.value, colorPicker.value);
    });

    nameInput.addEventListener('input', function () {
      updateLiveMockupPreview(nameInput.value, logoInput.value, colorPicker.value);
    });

    // Swatches
    document.querySelectorAll('.x-swatch').forEach(function (swatch) {
      swatch.addEventListener('click', function () {
        var c = swatch.dataset.color;
        colorPicker.value = c;
        colorHex.value = c;
        updateLiveMockupPreview(nameInput.value, logoInput.value, c);
      });
    });

    $('btn-use-bangjo-logo').addEventListener('click', function () {
      logoInput.value = '/assets/pwa/icon-192.png';
      updateLiveMockupPreview(nameInput.value, logoInput.value, colorPicker.value);
    });

    $('form-brand-settings').addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = $('btn-save-brand');
      btn.disabled = true;
      btn.textContent = 'Menyimpan...';

      var payload = {
        name: $('brand-name').value,
        tagline: $('brand-tagline').value,
        logo_url: $('brand-logo').value,
        primary_color: $('brand-color').value,
        custom_domain: $('brand-domain').value
      };

      try {
        var res = await fetch(API_BASE + '/admin/brand', {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (data.success) {
          showToast('✅ Brand dan tema berhasil disimpan!');
          applyBrandToUI(data.brand);
        } else {
          showToast('❌ Gagal menyimpan: ' + data.error);
        }
      } catch (err) {
        showToast('❌ Terjadi kesalahan jaringan.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Simpan Pengaturan Brand';
      }
    });

    // Form Add Banner Carousel
    var formAddBanner = $('form-add-banner');
    if (formAddBanner) {
      formAddBanner.addEventListener('submit', async function (e) {
        e.preventDefault();
        var urlInput = $('input-banner-url');
        var titleInput = $('input-banner-title');
        var url = urlInput.value.trim();
        var title = titleInput.value.trim();

        if (!url) return;

        try {
          var res = await fetch(API_BASE + '/admin/banners', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ image_url: url, title: title })
          });
          var data = await res.json();
          if (data.success) {
            showToast('✅ Banner carousel berhasil ditambahkan!');
            urlInput.value = '';
            titleInput.value = '';
            renderBannersList(data.banners);
          } else {
            showToast('❌ ' + data.error);
          }
        } catch (err) {
          showToast('❌ Terjadi kesalahan jaringan saat menambah banner.');
        }
      });
    }
  }

  function renderBannersList(banners) {
    var container = $('dash-banners-list');
    if (!container) return;
    banners = banners || state.brand?.banners || [];
    if (!Array.isArray(banners)) banners = [];

    if (banners.length === 0) {
      container.innerHTML = '<div style="grid-column:1/-1; color:#94a3b8; font-size:13px; text-align:center; padding:20px 0;">Belum ada banner promo. Tambahkan di atas (Maks. 5 slide).</div>';
      return;
    }

    container.innerHTML = banners.map(function (b, idx) {
      return [
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 2px 6px rgba(0,0,0,0.04);">',
          '<div style="width:100%; aspect-ratio:350/180; background:#e2e8f0; overflow:hidden;">',
            '<img src="' + esc(b.image_url) + '" alt="' + esc(b.title || 'Banner') + '" style="width:100%; height:100%; object-fit:cover; display:block;">',
          '</div>',
          '<div style="padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:8px;">',
            '<div style="min-width:0;">',
              '<strong style="font-size:12px; color:#1e293b; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Slide ' + (idx + 1) + ': ' + esc(b.title || 'Promo Banner') + '</strong>',
            '</div>',
            '<button type="button" class="x-btn-delete-banner" data-id="' + esc(b.id) + '" style="background:#fee2e2; color:#ef4444; border:none; border-radius:6px; padding:4px 10px; font-size:11px; font-weight:700; cursor:pointer;">Hapus</button>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');

    container.querySelectorAll('.x-btn-delete-banner').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-id');
        if (!confirm('Hapus slide banner ini?')) return;
        try {
          var res = await fetch(API_BASE + '/admin/banners/' + encodeURIComponent(id), {
            method: 'DELETE',
            headers: getAuthHeaders()
          });
          var data = await res.json();
          if (data.success) {
            showToast('✅ Banner berhasil dihapus.');
            renderBannersList(data.banners);
          } else {
            showToast('❌ ' + data.error);
          }
        } catch (err) {
          showToast('❌ Gagal menghapus banner.');
        }
      });
    });
  }

  /* =========================================================================
     MODUL 2: KATALOG & PRODUK CONTROLLER
     ========================================================================= */
  async function loadCatalog() {
    try {
      var authHeaders = getAuthHeaders();
      var [catRes, prodRes] = await Promise.all([
        fetch(API_BASE + '/admin/categories', { headers: authHeaders }),
        fetch(API_BASE + '/admin/products', { headers: authHeaders })
      ]);

      var catData = await catRes.json();
      var prodData = await prodRes.json();

      if (catData.success) state.categories = catData.categories || [];
      if (prodData.success) state.products = prodData.products || [];

      renderCategoryTabs();
      renderProductsTable();
      populateCategorySelect();
    } catch (err) {
      console.error('[Catalog Load Error]:', err);
    }
  }

  function renderCategoryTabs() {
    var container = $('catalog-category-tabs');
    if (!container) return;

    var html = '<button type="button" class="x-cat-filter-btn ' + (state.activeCategoryFilter === 'all' ? 'active' : '') + '" data-cat="all">Semua Kategori (' + state.products.length + ')</button>';

    state.categories.forEach(function (cat) {
      var count = state.products.filter(function (p) { return String(p.category_id) === String(cat.id); }).length;
      var active = String(state.activeCategoryFilter) === String(cat.id) ? 'active' : '';
      html += '<button type="button" class="x-cat-filter-btn ' + active + '" data-cat="' + cat.id + '">' + cat.name + ' (' + count + ')</button>';
    });

    container.innerHTML = html;

    container.querySelectorAll('.x-cat-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.activeCategoryFilter = btn.dataset.cat;
        renderCategoryTabs();
        renderProductsTable();
      });
    });
  }

  function renderProductsTable() {
    var tbody = $('products-table-body');
    if (!tbody) return;

    var filtered = state.products;
    if (state.activeCategoryFilter !== 'all') {
      filtered = state.products.filter(function (p) {
        return String(p.category_id) === String(state.activeCategoryFilter);
      });
    }

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Belum ada menu di kategori ini.</td></tr>';
      return;
    }

    var rows = filtered.map(function (prod) {
      var cat = state.categories.find(function (c) { return String(c.id) === String(prod.category_id); });
      var catName = cat ? cat.name : 'Umum';
      var img = prod.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isActive = prod.is_active !== 0;

      return [
        '<tr>',
          '<td><img src="' + img + '" alt="" class="x-table-thumb"></td>',
          '<td>',
            '<strong>' + prod.name + '</strong>',
            '<p class="text-muted" style="font-size:12px;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (prod.description || '') + '</p>',
          '</td>',
          '<td><span class="x-badge x-badge-info">' + catName + '</span></td>',
          '<td><strong>' + formatMoney(prod.price) + '</strong>' + (prod.regular_price > prod.price ? ' <del class="text-muted" style="font-size:11px;">' + formatMoney(prod.regular_price) + '</del>' : '') + '</td>',
          '<td>',
            '<button type="button" class="x-badge ' + (isActive ? 'x-badge-success' : 'x-badge-warning') + '" style="border:none;cursor:pointer;" onclick="toggleStock(\'' + prod.id + '\')">',
              (isActive ? '● Tersedia' : '○ Habis'),
            '</button>',
          '</td>',
          '<td class="text-right">',
            '<button type="button" class="x-btn-secondary" style="padding:6px 10px;font-size:12px;margin-right:6px;" onclick="openEditProduct(\'' + prod.id + '\')">Edit</button>',
            '<button type="button" class="x-btn-secondary" style="padding:6px 10px;font-size:12px;color:#ef4444;" onclick="deleteProduct(\'' + prod.id + '\')">Hapus</button>',
          '</td>',
        '</tr>'
      ].join('');
    });

    tbody.innerHTML = rows.join('');
  }

  function populateCategorySelect() {
    var select = $('prod-category');
    if (!select) return;
    select.innerHTML = state.categories.map(function (c) {
      return '<option value="' + c.id + '">' + c.name + '</option>';
    }).join('');
  }

  // Product Actions
  window.openAddProduct = function () {
    $('modal-product-title').textContent = 'Tambah Menu Baru';
    $('prod-id').value = '';
    $('prod-name').value = '';
    $('prod-price').value = '';
    $('prod-regular-price').value = '';
    $('prod-desc').value = '';
    $('prod-image').value = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400';
    $('modal-product').style.display = 'flex';
  };

  window.openEditProduct = function (id) {
    var prod = state.products.find(function (p) { return String(p.id) === String(id); });
    if (!prod) return;

    $('modal-product-title').textContent = 'Edit Menu: ' + prod.name;
    $('prod-id').value = prod.id;
    $('prod-name').value = prod.name;
    $('prod-category').value = prod.category_id;
    $('prod-price').value = prod.price;
    $('prod-regular-price').value = prod.regular_price || prod.price;
    $('prod-desc').value = prod.description || '';
    $('prod-image').value = prod.image || '';
    $('modal-product').style.display = 'flex';
  };

  window.closeProductModal = function () {
    $('modal-product').style.display = 'none';
  };

  window.toggleStock = async function (id) {
    try {
      var res = await fetch(API_BASE + '/admin/products/' + id + '/toggle', {
        method: 'PATCH',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Status ketersediaan menu diperbarui.');
        loadCatalog();
      }
    } catch (e) {
      showToast('Gagal mengubah status stok.');
    }
  };

  window.deleteProduct = async function (id) {
    if (!confirm('Apakah Anda yakin ingin menghapus menu ini?')) return;
    try {
      var res = await fetch(API_BASE + '/admin/products/' + id, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Menu berhasil dihapus.');
        loadCatalog();
      }
    } catch (e) {
      showToast('Gagal menghapus menu.');
    }
  };

  function initCatalogListeners() {
    $('btn-add-product').addEventListener('click', window.openAddProduct);

    $('btn-add-category').addEventListener('click', async function () {
      var name = prompt('Masukkan nama kategori baru:');
      if (!name || !name.trim()) return;

      try {
        var res = await fetch(API_BASE + '/admin/categories', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ name: name.trim() })
        });
        var data = await res.json();
        if (data.success) {
          showToast('✅ Kategori baru berhasil ditambahkan!');
          loadCatalog();
        }
      } catch (e) {
        showToast('Gagal menambah kategori.');
      }
    });

    $('form-product').addEventListener('submit', async function (e) {
      e.preventDefault();
      var id = $('prod-id').value;
      var payload = {
        name: $('prod-name').value,
        category_id: $('prod-category').value,
        price: Number($('prod-price').value),
        regular_price: Number($('prod-regular-price').value || $('prod-price').value),
        description: $('prod-desc').value,
        image: $('prod-image').value
      };

      var url = id ? (API_BASE + '/admin/products/' + id) : (API_BASE + '/admin/products');
      var method = id ? 'PUT' : 'POST';

      try {
        var res = await fetch(url, {
          method: method,
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (data.success) {
          showToast('✅ Menu berhasil disimpan!');
          window.closeProductModal();
          loadCatalog();
        }
      } catch (err) {
        showToast('Gagal menyimpan menu.');
      }
    });
  }

  /* =========================================================================
     MODUL 3: CABANG & PENGATURAN ONGKIR CONTROLLER
     ========================================================================= */
  /* =========================================================================
     MODUL 3: CABANG & PENGATURAN ONGKIR CONTROLLER
     ========================================================================= */
  async function loadBranches() {
    try {
      var res = await fetch(API_BASE + '/admin/branches', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data.success && data.branches) {
        state.branches = data.branches;
        renderBranchesGrid();
      }
    } catch (e) {
      console.warn('[Branches Load Warn]:', e);
    }
  }

  function renderBranchesGrid() {
    var container = $('branches-list-container');
    if (!container) return;

    if (!state.branches.length) {
      container.innerHTML = '<div class="text-muted text-center py-6">Tidak ada cabang terdaftar.</div>';
      return;
    }

    var html = state.branches.map(function (b) {
      var isGloballyActive = b.is_active === 1 || b.is_active === true;
      var isOpen = b.is_open_override === 1 || b.is_open_override === true || b.is_open_override == null;

      var activationBadge = isGloballyActive
        ? '<span class="x-badge x-badge-success">● Aktif</span>'
        : '<span class="x-badge x-badge-muted">● Nonaktif</span>';

      var openBadge = isOpen
        ? '<span class="x-badge x-badge-info" style="font-size:11px;">Buka Operasional</span>'
        : '<span class="x-badge x-badge-warning" style="font-size:11px;">Tutup Operasional</span>';

      var toggleBtn = isGloballyActive
        ? '<button type="button" class="x-btn-secondary x-btn-danger-outline" style="font-size:12px;font-weight:700;" onclick="toggleBranchActivation(\'' + b.id + '\', true)">Nonaktifkan Cabang</button>'
        : '<button type="button" class="x-btn-secondary x-btn-success-outline" style="font-size:12px;font-weight:700;" onclick="toggleBranchActivation(\'' + b.id + '\', false)">Aktifkan Cabang</button>';

      return [
        '<div class="x-branch-card' + (isGloballyActive ? '' : ' style="opacity:0.85;background:#f8fafc;"') + '">',
          '<div class="x-branch-card-header">',
            '<div>',
              '<h4 style="display:inline-block;margin-right:8px;">' + b.name + '</h4>',
              openBadge,
            '</div>',
            '<div>' + activationBadge + '</div>',
          '</div>',
          '<p class="text-muted" style="font-size:13px;">📍 ' + b.address_text + '</p>',
          '<div class="x-branch-detail-row"><span>Status Global:</span><span style="font-weight:700;' + (isGloballyActive ? 'color:#15803d;' : 'color:#64748b;') + '">' + (isGloballyActive ? 'Aktif (Tampil di Pelanggan)' : 'Nonaktif (Disembunyikan)') + '</span></div>',
          '<div class="x-branch-detail-row"><span>📱 WhatsApp Cabang:</span><span style="font-weight:600;color:var(--x-primary);">' + (b.phone || '<span style="color:#ef4444;">(Wajib diisi)</span>') + '</span></div>',
          '<div class="x-branch-detail-row"><span>Koordinat GPS:</span><span>' + b.latitude + ', ' + b.longitude + '</span></div>',
          '<div class="x-branch-detail-row"><span>Gratis Ongkir:</span><span style="color:#10b981;">' + (b.free_delivery_km || 0) + ' KM Pertama Gratis</span></div>',
          '<div class="x-branch-detail-row"><span>Tarif per KM:</span><span>' + formatMoney(b.price_per_km || 3000) + ' / km</span></div>',
          '<div class="x-branch-detail-row"><span>Radius Maksimal:</span><span>' + (b.max_radius_km || 12) + ' KM</span></div>',
          '<div class="x-branch-detail-row"><span>Promo Diskon Ongkir:</span><span>Diskon ' + formatMoney(b.promo_delivery_discount || 10000) + ' (Min. ' + formatMoney(b.promo_min_order || 50000) + ')</span></div>',
          '<div style="margin-top:12px;display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap;border-top:1px solid #f1f5f9;padding-top:10px;">',
            '<div>' + toggleBtn + '</div>',
            '<div style="display:flex;gap:6px;flex-wrap:wrap;">',
              '<button type="button" class="x-btn-secondary" style="font-size:12px;background:#f0fdf4;border-color:#bbf7d0;color:#15803d;font-weight:700;" onclick="openBranchCatalogModal(\'' + b.id + '\')">📋 Kelola Katalog Cabang</button>',
              '<button type="button" class="x-btn-secondary" style="font-size:12px;" onclick="editBranchPhone(\'' + b.id + '\')">📱 No. WA</button>',
              '<button type="button" class="x-btn-secondary" style="font-size:12px;" onclick="editBranchSettings(\'' + b.id + '\')">⚙️ Ongkir</button>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    });

    container.innerHTML = html.join('');
  }

  /* =========================================================================
     MODUL 3.1: BRANCH CATALOG MANAGER (ADOPTION & LOCAL PRICING)
     ========================================================================= */
  var currentManagingBranchId = null;
  var currentBranchCatalogData = null;

  window.openBranchCatalogModal = async function (branchId) {
    currentManagingBranchId = branchId;
    var modal = $('modal-branch-catalog');
    if (!modal) return;
    modal.style.display = 'flex';

    var title = $('modal-branch-catalog-title');
    var b = state.branches.find(function (x) { return x.id === branchId; });
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
      var res = await fetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/catalog', {
        headers: getAuthHeaders()
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

      return [
        '<div class="x-product-card-simple">',
          '<img src="' + img + '" class="x-product-card-thumb" alt="' + esc(p.name) + '">',
          '<div class="x-product-card-content">',
            '<h5>' + esc(p.name) + '</h5>',
            '<div style="display:flex;gap:4px;flex-wrap:wrap;margin:4px 0;">',
              '<span class="x-badge x-badge-info" style="font-size:10px;">' + esc(catName) + '</span>',
              modeBadge,
            '</div>',
            '<div class="x-product-card-price">Jual: ' + formatMoney(p.price) + ' <small class="text-muted" style="font-weight:normal;">(Owner: ' + formatMoney(p.master_price) + ')</small></div>',
            '<div class="x-product-card-actions">',
              '<button type="button" class="x-badge ' + (isAvailable ? 'x-badge-success' : 'x-badge-warning') + '" style="border:none;cursor:pointer;font-size:11px;" onclick="toggleBranchProductAvailability(\'' + p.product_id + '\', ' + (isAvailable ? 0 : 1) + ')">',
                (isAvailable ? '● Tersedia' : '○ Habis'),
              '</button>',
              '<button type="button" class="x-btn-secondary" style="padding:4px 8px;font-size:11px;color:#ef4444;" onclick="removeBranchProduct(\'' + p.product_id + '\', \'' + esc(p.name) + '\')">Hapus dari Cabang</button>',
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
      var res = await fetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/products/' + productId, {
        method: 'PATCH',
        headers: getAuthHeaders(),
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
      var res = await fetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/products/' + productId, {
        method: 'DELETE',
        headers: getAuthHeaders()
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

  window.promptAddBranchCategory = async function () {
    if (!currentManagingBranchId) return;
    var name = prompt('Nama Kategori Baru untuk Cabang ini:');
    if (!name || !name.trim()) return;

    try {
      var res = await fetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/categories', {
        method: 'POST',
        headers: getAuthHeaders(),
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
      if (!currentManagingBranchId) return;

      var btn = $('btn-save-adopt');
      btn.disabled = true;
      btn.textContent = 'Menyimpan...';

      var prodId = $('adopt-product-id').value;
      var catId = $('adopt-branch-category').value;
      var priceVal = Number($('adopt-price').value);

      try {
        var res = await fetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/adopt', {
          method: 'POST',
          headers: getAuthHeaders(),
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
          // Refresh the correct panel depending on role
          if (isBranchManager()) {
            loadInlineBranchCatalog();
          } else {
            reloadBranchCatalogView();
          }
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


  window.toggleBranchActivation = async function (id, currentlyActive) {
    var nextActive = currentlyActive ? 0 : 1;
    var actionName = currentlyActive ? 'menonaktifkan' : 'mengaktifkan';
    if (!confirm('Apakah Anda yakin ingin ' + actionName + ' cabang ini secara global?')) return;

    try {
      var res = await fetch(API_BASE + '/admin/branches/' + id, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: nextActive })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast(nextActive ? '✅ Cabang berhasil diaktifkan secara global!' : '⏸️ Cabang berhasil dinonaktifkan.');
        loadBranches();
      } else {
        alert((data && (data.message || data.error)) || 'Gagal mengubah status aktivasi cabang.');
      }
    } catch (err) {
      alert('Terjadi kesalahan saat mengubah status cabang: ' + err.message);
    }
  };

  window.editBranchPhone = function (id) {
    var b = state.branches.find(function (x) { return x.id === id; }) || state.branches[0];
    var newPhone = prompt('Nomor WhatsApp Resmi Cabang (Wajib, format 08xxx atau 62xxx):', b.phone || '');
    if (newPhone === null) return;
    newPhone = newPhone.trim();
    if (!newPhone) {
      alert('❌ Nomor WhatsApp Cabang wajib diisi dan tidak boleh kosong!');
      return;
    }

    fetch(API_BASE + '/admin/branches/' + id, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ phone: newPhone })
    }).then(function (res) {
      if (!res.ok) throw new Error('Gagal memperbarui nomor WhatsApp cabang.');
      return res.json();
    }).then(function () {
      showToast('✅ Nomor WhatsApp cabang berhasil disimpan!');
      loadBranches();
    }).catch(function (err) {
      alert(err.message);
    });
  };

  window.editBranchSettings = function (id) {
    var b = state.branches.find(function (x) { return x.id === id; }) || state.branches[0];
    var newFreeKm = prompt('Berapa KM pertama yang gratis ongkir?', b.free_delivery_km || 0);
    if (newFreeKm === null) return;
    var newPriceKm = prompt('Tarif ongkir per KM berikutnya (Rp):', b.price_per_km || 3000);
    if (newPriceKm === null) return;

    fetch(API_BASE + '/admin/branches/' + id, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        free_delivery_km: Number(newFreeKm),
        price_per_km: Number(newPriceKm)
      })
    }).then(function () {
      showToast('✅ Formula ongkir cabang diperbarui!');
      loadBranches();
    });
  };

  /* =========================================================================
     MODUL 4: PESANAN REALTIME CONTROLLER
     ========================================================================= */
  async function loadOrders() {
    var tbody = $('orders-table-body');
    if (!tbody) return;

    try {
      var res = await fetch(API_BASE + '/admin/orders', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data.success && data.orders) {
        state.orders = data.orders;
        renderOrdersTable();
      }
    } catch (e) {
      console.warn('[Orders Load Error]:', e);
    }
  }

  function renderOrdersTable() {
    var tbody = $('orders-table-body');
    if (!tbody) return;

    if (!state.orders.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-muted">Belum ada pesanan masuk hari ini.</td></tr>';
      return;
    }

    var rows = state.orders.map(function (ord) {
      var statusBadges = {
        pending: 'x-badge-warning',
        confirmed: 'x-badge-info',
        preparing: 'x-badge-info',
        ready: 'x-badge-success',
        completed: 'x-badge-success',
        cancelled: 'x-badge-danger'
      };

      return [
        '<tr>',
          '<td><strong>#' + (ord.order_number || ord.id.substring(0, 8)) + '</strong></td>',
          '<td>' + (new Date(ord.created_at || Date.now()).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })) + '</td>',
          '<td><strong>' + ord.customer_name + '</strong><br><small class="text-muted">' + ord.customer_phone + '</small></td>',
          '<td><span class="x-badge x-badge-info">' + (ord.order_type || 'delivery').toUpperCase() + '</span></td>',
          '<td><strong>' + formatMoney(ord.grand_total) + '</strong></td>',
          '<td><span class="x-badge x-badge-warning">' + (ord.payment_method || 'Tunai').toUpperCase() + '</span></td>',
          '<td><span class="x-badge ' + (statusBadges[ord.status] || 'x-badge-info') + '">' + ord.status.toUpperCase() + '</span></td>',
          '<td class="text-right">',
            '<button type="button" class="x-btn-secondary" style="padding:6px 10px;font-size:12px;" onclick="advanceOrderStatus(\'' + ord.id + '\', \'' + ord.status + '\')">Ubah Status ➔</button>',
          '</td>',
        '</tr>'
      ].join('');
    });

    tbody.innerHTML = rows.join('');
  }

  window.advanceOrderStatus = async function (orderId, currentStatus) {
    var authHeaders = getAuthHeaders();

    // R5 CHECK-1: acceptance ('pending' → 'confirmed') is EXCLUSIVELY Branch
    // ACCEPT via /orders/:id/branch-acceptance — never the generic status
    // PATCH. The branch acceptance endpoint is server-authoritative, audited,
    // and idempotent.
    if (currentStatus === 'pending') {
      try {
        var acceptRes = await fetch(API_BASE + '/orders/' + orderId + '/branch-acceptance', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ decision: 'accept', note: 'Diterima dari Merchant Dashboard' })
        });
        var acceptData = await acceptRes.json();
        if (acceptData && acceptData.success) {
          showToast('Pesanan DITERIMA: ' + (acceptData.new_status || 'confirmed').toUpperCase());
          loadOrders();
        } else {
          showToast((acceptData && acceptData.error) || 'Gagal menerima pesanan.');
        }
      } catch (e) {
        showToast('Gagal menerima pesanan.');
      }
      return;
    }

    var nextMap = {
      confirmed: 'preparing',
      preparing: 'ready',
      ready: 'out_for_delivery',
      out_for_delivery: 'completed'
    };

    var nextStatus = nextMap[currentStatus] || 'completed';
    try {
      var res = await fetch(API_BASE + '/kitchen/orders/' + orderId + '/status', {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: nextStatus, note: 'Status diupdate dari Merchant Dashboard' })
      });
      var data = await res.json();
      if (data && data.success) {
        showToast('Pesanan diubah ke status: ' + nextStatus.toUpperCase());
        loadOrders();
      }
    } catch (e) {
      showToast('Gagal update status pesanan.');
    }
  };

  /* =========================================================================
     MODUL 5: RINGKASAN & OVERVIEW
     ========================================================================= */
  async function loadOverview() {
    try {
      var res = await fetch(API_BASE + '/admin/analytics/summary', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data.success && data.summary) {
        $('stat-omzet').textContent = formatMoney(data.summary.total_omzet);
        $('stat-orders').textContent = data.summary.total_orders;
        $('stat-products').textContent = data.summary.active_products || state.products.length || 5;
      }
    } catch (e) {
      console.warn('[Overview Load Error]:', e);
    }
  }

  /* =========================================================================
     MODUL 0: MERCHANT AUTH & SESSION GUARD
     ========================================================================= */
  function getStoredUser() {
    try {
      var u = localStorage.getItem(USER_KEY);
      return u ? JSON.parse(u) : null;
    } catch (_) { return null; }
  }

  function isBranchManager() {
    var user = getStoredUser();
    return user && user.role === 'branch_manager';
  }

  /**
   * Hides/shows UI panels depending on the logged-in user's role.
   * - branch_manager → shows inline Branch Catalog panel, hides Owner CRUD panel
   *                     hides sidebar items that are owner-only (Brand, Cabang, Payment)
   * - owner / brand_manager → shows Owner CRUD panel, hides branch panel
   */
  function applyRoleBasedUI() {
    var user = getStoredUser();
    if (!user) return;

    var role = user.role;
    var isBM = role === 'branch_manager';

    // Catalog tab panels
    var ownerPanel = $('panel-owner-catalog');
    var branchPanel = $('panel-branch-catalog');
    if (ownerPanel) ownerPanel.style.display = isBM ? 'none' : '';
    if (branchPanel) branchPanel.style.display = isBM ? '' : 'none';

    // Hide owner-only nav items for branch_manager
    document.querySelectorAll('.x-nav-item').forEach(function (btn) {
      var tab = btn.dataset.tab;
      if (isBM && (tab === 'brand' || tab === 'branches' || tab === 'payments')) {
        btn.style.display = 'none';
      }
    });

    // Set branch_id for inline catalog if branch_manager
    if (isBM && user.branch_id) {
      currentManagingBranchId = user.branch_id;
    }
  }

  function checkAuth() {
    var token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      if (typeof checkAppRoute === 'function') {
        checkAppRoute();
      } else if (!window.location.pathname.includes('login')) {
        window.location.href = '/dashboard/login';
      }
      return false;
    }

    var user = getStoredUser();
    if (user) {
      if ($('dash-user-name')) $('dash-user-name').textContent = user.full_name || user.username || 'Pemilik Toko';
      if ($('dash-user-avatar')) $('dash-user-avatar').textContent = (user.full_name || user.username || 'A').charAt(0).toUpperCase();
      if ($('dash-user-role')) $('dash-user-role').textContent = (user.role || 'Owner').toUpperCase();
    }
    return true;
  }

  function initAuthListeners() {
    var btnLogout = $('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', function () {
        if (!confirm('Apakah Anda ingin keluar dari Dashboard?')) return;
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        if (typeof checkAppRoute === 'function') {
          checkAppRoute();
        } else {
          window.location.href = '/dashboard/login';
        }
      });
    }
  }

  /* =========================================================================
     MODUL 3.2: BRANCH CATALOG INLINE PANEL
     (Used when role = branch_manager — renders directly in tab-catalog)
     ========================================================================= */

  var branchCatalogFilter = 'all'; // active branch category filter ('all' or catId)

  async function loadInlineBranchCatalog() {
    if (!currentManagingBranchId) return;

    var adoptedEl = $('branch-inline-adopted-container');
    var availableEl = $('branch-inline-available-container');
    var catsEl = $('branch-inline-categories-bar');
    if (adoptedEl) adoptedEl.innerHTML = '<p class="text-muted" style="font-size:13px;">Memuat menu aktif cabang...</p>';
    if (availableEl) availableEl.innerHTML = '<p class="text-muted" style="font-size:13px;">Memuat rekomendasi Owner...</p>';
    if (catsEl) catsEl.innerHTML = '<span class="text-muted" style="font-size:13px;">Memuat kategori...</span>';

    try {
      var res = await fetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/catalog', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!data.success) {
        showToast('\u274C ' + (data.error || 'Gagal memuat katalog cabang.'));
        return;
      }

      currentBranchCatalogData = data;

      var categories = data.categories || [];
      var adopted = data.adopted_products || [];
      var available = data.available_master_products || [];

      // Update subtitle
      var subtitle = $('branch-catalog-subtitle');
      if (subtitle && data.branch) subtitle.textContent = 'Cabang: ' + data.branch.name;

      // Update counts
      if ($('branch-inline-cat-count')) $('branch-inline-cat-count').textContent = categories.length;
      if ($('branch-inline-active-count')) $('branch-inline-active-count').textContent = adopted.length;
      if ($('branch-inline-available-count')) $('branch-inline-available-count').textContent = available.length;

      renderInlineCategoriesBar(categories);
      renderInlineAdoptedProducts(adopted, branchCatalogFilter);
      renderInlineAvailableProducts(available);
    } catch (err) {
      console.error('[Inline Branch Catalog Error]:', err);
      showToast('\u274C Kesalahan jaringan saat memuat katalog cabang.');
    }
  }

  var _dragSrcCatId = null; // ID of the category being dragged
  var _dragSrcEl = null;   // DOM element being dragged

  function renderInlineCategoriesBar(categories) {
    var bar = $('branch-inline-categories-bar');
    if (!bar) return;

    bar.innerHTML = ''; // clear

    // "Semua" chip — not draggable
    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'x-cat-filter-btn' + (branchCatalogFilter === 'all' ? ' active' : '');
    allBtn.style.borderRadius = '20px';
    allBtn.textContent = 'Semua';
    allBtn.addEventListener('click', function () { setBranchCatalogFilter('all'); });
    bar.appendChild(allBtn);

    if (!categories.length) {
      var hint = document.createElement('span');
      hint.className = 'text-muted';
      hint.style.fontSize = '12px';
      hint.textContent = 'Belum ada kategori. Klik "+ Tambah Kategori" untuk membuat.';
      bar.appendChild(hint);
      return;
    }

    categories.forEach(function (cat) {
      var isActive = branchCatalogFilter === cat.id;

      // Outer chip wrapper — this is the draggable unit
      var chip = document.createElement('span');
      chip.dataset.catId = cat.id;
      chip.draggable = true;
      chip.style.cssText = [
        'display:inline-flex;align-items:center;gap:0;border-radius:20px;overflow:hidden;cursor:grab;',
        'border:1px solid ' + (isActive ? 'var(--x-primary,#b6ff00)' : '#e2e8f0') + ';',
        'background:' + (isActive ? '#f0ffe0' : '#f8fafc') + ';',
        'transition:box-shadow 0.15s,opacity 0.15s;'
      ].join('');

      // Drag handle indicator
      var handle = document.createElement('span');
      handle.title = 'Geser untuk ubah urutan';
      handle.style.cssText = 'padding:5px 4px 5px 10px;font-size:13px;color:#94a3b8;cursor:grab;user-select:none;';
      handle.textContent = '⠿';
      chip.appendChild(handle);

      // Category name / filter button
      var nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.style.cssText = 'border:none;background:none;padding:5px 8px 5px 4px;font-size:12px;font-weight:' + (isActive ? '700' : '500') + ';cursor:pointer;color:#1e293b;';
      nameBtn.textContent = cat.name;
      nameBtn.addEventListener('click', function () { setBranchCatalogFilter(cat.id); });
      chip.appendChild(nameBtn);

      // Edit button
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.title = 'Ubah nama';
      editBtn.style.cssText = 'border:none;background:none;padding:5px 5px;font-size:12px;cursor:pointer;color:#64748b;';
      editBtn.textContent = '✏️';
      editBtn.addEventListener('click', function (e) { e.stopPropagation(); editBranchCategory(cat.id, cat.name); });
      chip.appendChild(editBtn);

      // Delete button
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.title = 'Hapus kategori';
      delBtn.style.cssText = 'border:none;background:none;padding:5px 8px 5px 4px;font-size:12px;cursor:pointer;color:#ef4444;';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', function (e) { e.stopPropagation(); deleteBranchCategory(cat.id, cat.name); });
      chip.appendChild(delBtn);

      // ── HTML5 Drag Events ──────────────────────────────────────
      chip.addEventListener('dragstart', function (e) {
        _dragSrcCatId = cat.id;
        _dragSrcEl = chip;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', cat.id);
        setTimeout(function () { chip.style.opacity = '0.45'; }, 0);
      });

      chip.addEventListener('dragend', function () {
        chip.style.opacity = '1';
        chip.style.boxShadow = '';
        // Remove all dragover highlights
        bar.querySelectorAll('[data-cat-id]').forEach(function (el) {
          el.style.boxShadow = '';
        });
      });

      chip.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (chip !== _dragSrcEl) {
          chip.style.boxShadow = '0 0 0 2px var(--x-primary,#b6ff00)';
        }
      });

      chip.addEventListener('dragleave', function () {
        chip.style.boxShadow = '';
      });

      chip.addEventListener('drop', function (e) {
        e.preventDefault();
        chip.style.boxShadow = '';
        if (!_dragSrcCatId || _dragSrcCatId === cat.id) return;

        // Reorder chips in DOM
        var chips = Array.from(bar.querySelectorAll('[data-cat-id]'));
        var srcIdx = chips.findIndex(function (el) { return el.dataset.catId === _dragSrcCatId; });
        var dstIdx = chips.findIndex(function (el) { return el.dataset.catId === cat.id; });

        if (srcIdx === -1 || dstIdx === -1) return;

        // Move src before or after dst
        if (srcIdx < dstIdx) {
          bar.insertBefore(_dragSrcEl, chip.nextSibling);
        } else {
          bar.insertBefore(_dragSrcEl, chip);
        }

        // Build new order from DOM
        var newOrder = Array.from(bar.querySelectorAll('[data-cat-id]')).map(function (el) {
          return el.dataset.catId;
        });

        // Persist to server
        saveBranchCategoryOrder(newOrder);
      });
      // ──────────────────────────────────────────────────────────

      bar.appendChild(chip);
    });
  }

  async function saveBranchCategoryOrder(orderedIds) {
    try {
      var res = await fetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/categories/reorder', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ order: orderedIds })
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Urutan kategori disimpan — tampilan pelanggan diperbarui.');
        // Update local data so filter still works after re-render
        if (currentBranchCatalogData && currentBranchCatalogData.categories) {
          var catMap = {};
          currentBranchCatalogData.categories.forEach(function (c) { catMap[c.id] = c; });
          currentBranchCatalogData.categories = orderedIds
            .map(function (id) { return catMap[id]; })
            .filter(Boolean);
          if ($('branch-inline-cat-count')) {
            $('branch-inline-cat-count').textContent = currentBranchCatalogData.categories.length;
          }
        }
      } else {
        showToast('❌ ' + (data.error || 'Gagal menyimpan urutan kategori.'));
        loadInlineBranchCatalog(); // reload to restore correct order
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan saat menyimpan urutan.');
      loadInlineBranchCatalog();
    }
  }


  window.setBranchCatalogFilter = function (catId) {
    branchCatalogFilter = catId;
    if (!currentBranchCatalogData) return;

    var categories = currentBranchCatalogData.categories || [];
    var adopted = currentBranchCatalogData.adopted_products || [];

    // Update filter label
    var label = $('branch-inline-filter-label');
    if (label) {
      if (catId === 'all') {
        label.textContent = 'Semua kategori';
      } else {
        var cat = categories.find(function (c) { return c.id === catId; });
        label.textContent = 'Filter: ' + (cat ? cat.name : catId);
      }
    }

    renderInlineCategoriesBar(categories);
    renderInlineAdoptedProducts(adopted, catId);
  };

  window.editBranchCategory = async function (catId, currentName) {
    var newName = prompt('Ubah nama kategori:', currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName) return;

    try {
      var res = await fetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/categories/' + catId, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: newName.trim() })
      });
      var data = await res.json();
      if (data.success) {
        showToast('\u2705 Kategori berhasil diubah!');
        loadInlineBranchCatalog();
      } else {
        showToast('\u274C ' + (data.error || 'Gagal mengubah nama kategori.'));
      }
    } catch (err) {
      showToast('\u274C Kesalahan jaringan.');
    }
  };

  window.deleteBranchCategory = async function (catId, catName) {
    if (!confirm('Hapus kategori "' + catName + '"? Produk di kategori ini tidak akan dihapus, hanya dipindah ke tanpa kategori.')) return;

    try {
      var res = await fetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/categories/' + catId, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('\u2705 Kategori dihapus.');
        if (branchCatalogFilter === catId) branchCatalogFilter = 'all';
        loadInlineBranchCatalog();
      } else {
        showToast('\u274C ' + (data.error || 'Gagal menghapus kategori.'));
      }
    } catch (err) {
      showToast('\u274C Kesalahan jaringan.');
    }
  };


  function renderInlineAdoptedProducts(adopted, filterCatId) {
    var container = $('branch-inline-adopted-container');
    if (!container) return;

    // Apply category filter if not 'all'
    var filtered = adopted;
    if (filterCatId && filterCatId !== 'all') {
      filtered = adopted.filter(function (p) {
        return String(p.branch_category_id) === String(filterCatId);
      });
    }

    if (!filtered.length) {
      var msg = filterCatId && filterCatId !== 'all'
        ? 'Belum ada menu di kategori ini. Adopsi produk dari Owner dan pilih kategori ini saat mengadopsi.'
        : 'Belum ada menu yang diadopsi. Pilih dari daftar rekomendasi Owner di bawah!';
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">' + msg + '</div>';
      return;
    }

    container.innerHTML = filtered.map(function (p) {
      var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isAvailable = p.is_available === 1 || p.is_available === true;
      var catName = p.branch_category_name || 'Tanpa Kategori';
      var modeBadge = p.pricing_mode === 'range'
        ? '<span class="x-badge x-badge-range">Range (' + formatMoney(p.min_price) + ' - ' + formatMoney(p.max_price) + ')</span>'
        : '<span class="x-badge x-badge-lock">Harga Terkunci</span>';

      return [
        '<div class="x-product-card-simple">',
          '<img src="' + img + '" class="x-product-card-thumb" alt="' + esc(p.name) + '">',
          '<div class="x-product-card-content">',
            '<h5>' + esc(p.name) + '</h5>',
            '<div style="display:flex;gap:4px;flex-wrap:wrap;margin:4px 0;">',
              '<span class="x-badge x-badge-info" style="font-size:10px;">' + esc(catName) + '</span>',
              modeBadge,
            '</div>',
            '<div class="x-product-card-price">Jual: ' + formatMoney(p.price) + ' <small class="text-muted" style="font-weight:normal;">(Owner: ' + formatMoney(p.master_price) + ')</small></div>',
            '<div class="x-product-card-actions">',
              '<button type="button" class="x-badge ' + (isAvailable ? 'x-badge-success' : 'x-badge-warning') + '" style="border:none;cursor:pointer;font-size:11px;" onclick="toggleBranchProductAvailability(\'' + p.product_id + '\', ' + (isAvailable ? 0 : 1) + ')">',
                (isAvailable ? '● Tersedia' : '○ Habis'),
              '</button>',
              '<button type="button" class="x-btn-secondary" style="padding:4px 8px;font-size:11px;color:#ef4444;" onclick="removeBranchProduct(\'' + p.product_id + '\', \'' + esc(p.name) + '\')">' + 'Hapus dari Cabang</button>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }


  function renderInlineAvailableProducts(available) {
    var container = $('branch-inline-available-container');
    if (!container) return;

    if (!available.length) {
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">Semua produk dari katalog Owner telah diadopsi. Cabang ini sudah lengkap!</div>';
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
              '<button type="button" class="x-btn-primary" style="padding:6px 12px;font-size:12px;" onclick="openAdoptModal(\'' + p.id + '\')">\uFF0B Adopsi ke Cabang</button>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  // Override removeBranchProduct and toggleBranchProductAvailability to also refresh inline panel
  var _origToggleBranchAvail = window.toggleBranchProductAvailability;
  window.toggleBranchProductAvailability = async function (productId, nextAvail) {
    if (!currentManagingBranchId) return;
    try {
      var res = await fetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/products/' + productId, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_available: nextAvail })
      });
      var data = await res.json();
      if (data.success) {
        showToast('Ketersediaan menu cabang diperbarui.');
        if (isBranchManager()) loadInlineBranchCatalog();
        else reloadBranchCatalogView();
      } else {
        showToast('\u274C ' + (data.error || 'Gagal mengubah ketersediaan.'));
      }
    } catch (err) {
      showToast('\u274C Kesalahan jaringan.');
    }
  };

  var _origRemoveBranchProduct = window.removeBranchProduct;
  window.removeBranchProduct = async function (productId, productName) {
    if (!currentManagingBranchId) return;
    if (!confirm('Hapus "' + productName + '" dari katalog cabang ini? Menu tidak akan lagi tampil di halaman pemesanan pelanggan.')) return;

    try {
      var res = await fetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/products/' + productId, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('\u2705 Produk dihapus dari katalog cabang.');
        if (isBranchManager()) loadInlineBranchCatalog();
        else reloadBranchCatalogView();
      } else {
        showToast('\u274C ' + (data.error || 'Gagal menghapus produk.'));
      }
    } catch (err) {
      showToast('\u274C Kesalahan jaringan.');
    }
  };

  // Override adopt form submit to reload inline panel for branch_manager
  var _origFormAdoptSubmit = null;
  (function rewireAdoptSubmit() {
    var formAdoptInline = $('form-adopt-product');
    if (!formAdoptInline) return;
    // We'll patch the success callback — store original handler then re-listen
    // (already set above; we monkey-patch via reload override in openAdoptModal closure)
  })();

  window.__xentraInitDashboard = function () {
    checkAuth();
    applyRoleBasedUI();
    loadBrandSettings();
    if (isBranchManager()) {
      loadInlineBranchCatalog();
    } else {
      loadCatalog();
    }
    loadOverview();
  };

  /* =========================================================================
     INITIALIZATION ON DOM READY
     ========================================================================= */
  document.addEventListener('DOMContentLoaded', function () {
    // Navigation listeners
    document.querySelectorAll('.x-nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTab(btn.dataset.tab);
      });
    });

    initAuthListeners();
    initBrandListeners();
    initCatalogListeners();

    if ($('btn-refresh-orders')) {
      $('btn-refresh-orders').addEventListener('click', loadOrders);
    }

    // Inline branch category button
    var btnAddBranchCatInline = $('btn-add-branch-category-inline');
    if (btnAddBranchCatInline) {
      btnAddBranchCatInline.addEventListener('click', async function () {
        if (!currentManagingBranchId) return;
        var name = prompt('Nama Kategori Baru untuk Cabang ini:');
        if (!name || !name.trim()) return;
        try {
          var res = await fetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/categories', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ name: name.trim() })
          });
          var data = await res.json();
          if (data.success) {
            showToast('\u2705 Kategori cabang berhasil dibuat!');
            loadInlineBranchCatalog();
          } else {
            showToast('\u274C ' + (data.error || 'Gagal membuat kategori.'));
          }
        } catch (err) {
          showToast('\u274C Kesalahan jaringan.');
        }
      });
    }

    // Apply role-based UI before data load
    var isAuth = checkAuth();
    applyRoleBasedUI();

    // Initial data fetch if authenticated
    loadBrandSettings();
    if (isAuth) {
      if (isBranchManager()) {
        loadInlineBranchCatalog();
      } else {
        loadCatalog();
      }
      loadOverview();
    }
  });

})();
