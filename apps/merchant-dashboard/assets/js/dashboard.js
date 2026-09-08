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

  function clearStoredSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function redirectToLogin() {
    if (typeof checkAppRoute === 'function') {
      checkAppRoute();
    } else if (!window.location.pathname.includes('login')) {
      window.location.href = '/dashboard/login';
    }
  }

  // Every admin call goes through this wrapper. A 401 means the session is gone
  // on the server (e.g. Passenger restart wiped the in-memory TokenSessionStore),
  // so the stale local token must never keep the dashboard rendering empty UI.
  function adminFetch(url, options) {
    return fetch(url, options).then(function (res) {
      if (res.status === 401) {
        clearStoredSession();
        redirectToLogin();
        var err = new Error('SESSION_EXPIRED');
        err.status = 401;
        throw err;
      }
      return res;
    });
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
      var res = await adminFetch(API_BASE + '/admin/brand', { headers: getAuthHeaders() });
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
        var res = await adminFetch(API_BASE + '/admin/brand', {
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
          var res = await adminFetch(API_BASE + '/admin/banners', {
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
          var res = await adminFetch(API_BASE + '/admin/banners/' + encodeURIComponent(id), {
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
        adminFetch(API_BASE + '/admin/categories', { headers: authHeaders }),
        adminFetch(API_BASE + '/admin/products', { headers: authHeaders })
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

  // File object staged for menu photo upload on save (null when none chosen).
  var _productImageFile = null;

  // Show the staged/current menu photo preview; fall back to the "Belum ada foto"
  // placeholder when there is no image.
  function setProductImagePreview(src, hasImage) {
    var previewImg = $('prod-image-preview');
    var emptyBox = $('prod-image-empty');
    if (!previewImg || !emptyBox) return;
    if (hasImage && src) {
      previewImg.src = src;
      previewImg.style.display = 'block';
      emptyBox.style.display = 'none';
    } else {
      previewImg.removeAttribute('src');
      previewImg.style.display = 'none';
      emptyBox.style.display = 'flex';
    }
  }

  // Product Actions
  window.openAddProduct = function () {
    $('modal-product-title').textContent = 'Tambah Menu Baru';
    $('prod-id').value = '';
    $('prod-name').value = '';
    $('prod-price').value = '';
    $('prod-regular-price').value = '';
    $('prod-desc').value = '';
    _productImageFile = null;
    var fileInput = $('prod-image-file');
    if (fileInput) fileInput.value = '';
    setProductImagePreview('', false);
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
    _productImageFile = null;
    var fileInput = $('prod-image-file');
    if (fileInput) fileInput.value = '';
    var existingImage = prod.image || prod.image_url || '';
    setProductImagePreview(existingImage, existingImage !== '');
    $('modal-product').style.display = 'flex';
  };

  window.closeProductModal = function () {
    $('modal-product').style.display = 'none';
    _productImageFile = null;
  };

  window.toggleStock = async function (id) {
    try {
      var res = await adminFetch(API_BASE + '/admin/products/' + id + '/toggle', {
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
      var res = await adminFetch(API_BASE + '/admin/products/' + id, {
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
        var res = await adminFetch(API_BASE + '/admin/categories', {
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

    var btnPick = $('btn-prod-image-pick');
    var prodFileInput = $('prod-image-file');
    if (btnPick && prodFileInput) {
      btnPick.addEventListener('click', function () { prodFileInput.click(); });
      prodFileInput.addEventListener('change', function () {
        var file = prodFileInput.files && prodFileInput.files[0];
        if (!file) { _productImageFile = null; return; }

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.');
          prodFileInput.value = '';
          return;
        }
        if (file.size > 3 * 1024 * 1024) {
          showToast('❌ Ukuran gambar melebihi batas maksimal 3MB.');
          prodFileInput.value = '';
          return;
        }

        _productImageFile = file;

        // Local preview only — the persisted URL comes back from the backend
        // after upload; this is just so the admin sees what they picked.
        var reader = new FileReader();
        reader.onload = function (e) {
          setProductImagePreview(e.target.result, true);
        };
        reader.readAsDataURL(file);
      });
    }

    $('form-product').addEventListener('submit', async function (e) {
      e.preventDefault();
      var id = $('prod-id').value;
      var payload = {
        name: $('prod-name').value,
        category_id: $('prod-category').value,
        price: Number($('prod-price').value),
        regular_price: Number($('prod-regular-price').value || $('prod-price').value),
        description: $('prod-desc').value
      };

      var url = id ? (API_BASE + '/admin/products/' + id) : (API_BASE + '/admin/products');
      var method = id ? 'PUT' : 'POST';

      try {
        var res = await adminFetch(url, {
          method: method,
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (!data.success) {
          showToast('❌ ' + (data.error || data.message || 'Gagal menyimpan menu.'));
          return;
        }

        // Photo: uploaded only when the admin staged a new file on save.
        var savedId = (data.product && data.product.id) || id;
        if (_productImageFile && savedId) {
          var base64 = await new Promise(function (resolve, reject) {
            var imgReader = new FileReader();
            imgReader.onload = function () { resolve(imgReader.result); };
            imgReader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
            imgReader.readAsDataURL(_productImageFile);
          });

          var imageRes = await adminFetch(API_BASE + '/admin/products/' + savedId + '/image', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ image_base64: base64, mime_type: _productImageFile.type })
          });
          var imageData = {};
          try {
            imageData = await imageRes.json();
          } catch (_) {
            var rawBody = '';
            try { rawBody = await imageRes.text(); } catch (_) {}
            var detail = rawBody.length > 160 ? (rawBody.slice(0, 160) + '…') : rawBody;
            imageData = { success: false, error: 'Upload foto gagal (HTTP ' + imageRes.status + '). ' + (detail ? detail + ' ' : '') + 'Pastikan server sudah di-restart, lalu coba lagi.' };
          }
          if (!imageRes.ok || !imageData.success) {
            showToast('❌ ' + (imageData.error || imageData.message || 'Gagal mengunggah foto menu.'));
            return;
          }
        }

        showToast('✅ Menu berhasil disimpan!');
        window.closeProductModal();
        loadCatalog();
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
      var res = await adminFetch(API_BASE + '/admin/branches', { headers: getAuthHeaders() });
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

      var openBadge = isOpen
        ? '<span class="x-badge x-badge-info" style="font-size:11px;">Buka Operasional</span>'
        : '<span class="x-badge x-badge-warning" style="font-size:11px;">Tutup Operasional</span>';

      var toggleSwitch = '' +
        '<label class="x-toggle' + (isGloballyActive ? ' x-toggle-on' : '') + '">' +
          '<input type="checkbox" ' + (isGloballyActive ? 'checked' : '') + ' onchange="toggleBranchActivation(\'' + b.id + '\', this.checked)" aria-label="Aktifkan atau nonaktifkan cabang">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      return [
        '<div class="x-branch-card' + (isGloballyActive ? '' : ' style="opacity:0.85;background:#f8fafc;"') + '">',
          '<div class="x-branch-card-header">',
            '<div>',
              '<h4 style="display:inline-block;margin-right:8px;">' + b.name + '</h4>',
              openBadge,
            '</div>',
            '<div>' + toggleSwitch + '</div>',
          '</div>',
          '<p class="text-muted" style="font-size:13px;">📍 ' + (b.address_text || '') + '</p>',
          '<div class="x-branch-detail-row"><span>📱 WhatsApp Cabang:</span><span style="font-weight:600;color:var(--x-primary);">' + (b.phone || b.whatsapp_number || '<span style="color:#ef4444;">(Wajib diisi)</span>') + '</span></div>',
          '<div class="x-branch-detail-row"><span>Koordinat GPS:</span><span>' + (b.latitude || 0) + ', ' + (b.longitude || 0) + '</span></div>',
          '<div class="x-branch-detail-row"><span>Gratis Ongkir:</span><span style="color:#10b981;">' + (b.free_delivery_km || 0) + ' KM Pertama Gratis</span></div>',
          '<div class="x-branch-detail-row"><span>Tarif per KM:</span><span>' + formatMoney(b.price_per_km || 3000) + ' / km</span></div>',
          '<div class="x-branch-detail-row"><span>Radius Maksimal:</span><span>' + (b.max_radius_km || 12) + ' KM</span></div>',
          '<div class="x-branch-detail-row"><span>Promo Diskon Ongkir:</span><span>Diskon ' + formatMoney(b.promo_delivery_discount || 10000) + ' (Min. ' + formatMoney(b.promo_min_order || 50000) + ')</span></div>',
          '<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-top:1px solid #f1f5f9;padding-top:10px;">',
            '<button type="button" class="x-btn-secondary" style="font-size:12px;font-weight:700;" onclick="openBranchModal(\'' + b.id + '\')">✏️ Edit</button>',
            '<button type="button" class="x-btn-secondary" style="font-size:12px;background:#f0fdf4;border-color:#bbf7d0;color:#15803d;font-weight:700;" onclick="openBranchCatalogModal(\'' + b.id + '\')">📋 Kelola Katalog Cabang</button>',
            '<button type="button" class="x-btn-secondary" style="font-size:12px;color:#ef4444;border-color:#fecaca;margin-left:auto;" onclick="deleteBranch(\'' + b.id + '\')">🗑 Hapus</button>',
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
      var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/catalog', {
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

      // Override status badges — one per supported field
      var nameSrc     = p.name_override        ? '<span class="x-badge" style="background:#fef9c3;color:#854d0e;font-size:9px;">OVERRIDE</span>' : '<span class="x-badge" style="background:#f0fdf4;color:#166534;font-size:9px;">DEFAULT</span>';
      var descSrc     = p.description_override ? '<span class="x-badge" style="background:#fef9c3;color:#854d0e;font-size:9px;">OVERRIDE</span>' : '<span class="x-badge" style="background:#f0fdf4;color:#166534;font-size:9px;">DEFAULT</span>';
      var imgSrc      = p.image_override       ? '<span class="x-badge" style="background:#fef9c3;color:#854d0e;font-size:9px;">OVERRIDE</span>' : '<span class="x-badge" style="background:#f0fdf4;color:#166534;font-size:9px;">DEFAULT</span>';

      var productDataJson = esc(JSON.stringify({
        product_id: p.product_id,
        name: p.name, name_override: p.name_override, master_name: p.master_name,
        description: p.description, description_override: p.description_override, master_description: p.master_description,
        image_url: p.image_url, image_override: p.image_override, master_image_url: p.master_image_url
      }));

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
              '<button type="button" class="x-badge ' + (isAvailable ? 'x-badge-success' : 'x-badge-warning') + '" style="border:none;cursor:pointer;font-size:11px;" onclick="toggleBranchProductAvailability(\'' + p.product_id + '\', ' + (isAvailable ? 0 : 1) + ')">',
                (isAvailable ? '● Tersedia' : '○ Habis'),
              '</button>',
              '<button type="button" class="x-btn-secondary" style="padding:4px 8px;font-size:11px;color:#0369a1;" onclick="openBranchOverrideModal(\'' + productDataJson + '\')">✏ Override</button>',
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
      var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/products/' + productId, {
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
      var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/products/' + productId, {
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

  /* =========================================================================
     MODUL 3.2: BRANCH PRODUCT OVERRIDE — name / description / image_url
     Master Product Default + Branch Optional Override
     ========================================================================= */
  var _overrideProductId = null;

  window.openBranchOverrideModal = function (productDataRaw) {
    var p;
    try { p = JSON.parse(productDataRaw.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")); } catch (e) { showToast('❌ Gagal membuka override.'); return; }
    _overrideProductId = p.product_id;

    var modal = $('modal-branch-override');
    if (!modal) { showToast('❌ Modal override tidak ditemukan di HTML.'); return; }

    // Product heading
    $('override-product-heading').textContent = 'Override Produk: ' + (p.master_name || p.name || p.product_id);

    // Name row
    $('override-name-input').value     = p.name_override != null ? p.name_override : '';
    $('override-name-master').textContent = p.master_name || '(tidak ada)';
    $('override-name-status').textContent  = p.name_override ? '🟡 OVERRIDE aktif' : '🟢 DEFAULT (ikut Master)';

    // Description row
    $('override-desc-input').value     = p.description_override != null ? p.description_override : '';
    $('override-desc-master').textContent = p.master_description || '(tidak ada)';
    $('override-desc-status').textContent  = p.description_override ? '🟡 OVERRIDE aktif' : '🟢 DEFAULT (ikut Master)';

    // Image row
    $('override-img-input').value      = p.image_override != null ? p.image_override : '';
    $('override-img-master').textContent = p.master_image_url || '(tidak ada)';
    $('override-img-status').textContent  = p.image_override ? '🟡 OVERRIDE aktif' : '🟢 DEFAULT (ikut Master)';

    modal.style.display = 'flex';
  };

  window.closeBranchOverrideModal = function () {
    var modal = $('modal-branch-override');
    if (modal) modal.style.display = 'none';
    _overrideProductId = null;
  };

  window.saveBranchProductOverride = async function () {
    if (!currentManagingBranchId || !_overrideProductId) return;
    var btn = $('btn-save-override');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';

    // Empty string = user wants to clear the override (send null)
    var nameVal = $('override-name-input').value;
    var descVal = $('override-desc-input').value;
    var imgVal  = $('override-img-input').value;

    var payload = {};
    payload.name        = nameVal.trim()  !== '' ? nameVal.trim()  : null;
    payload.description = descVal.trim()  !== '' ? descVal.trim()  : null;
    payload.image_url   = imgVal.trim()   !== '' ? imgVal.trim()   : null;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/products/' + _overrideProductId + '/override', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Override produk berhasil disimpan!');
        window.closeBranchOverrideModal();
        reloadBranchCatalogView();
      } else {
        showToast('❌ ' + (data.message || data.error || 'Gagal menyimpan override.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan saat menyimpan override.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Simpan Override';
    }
  };

  window.clearBranchProductOverride = async function () {
    if (!currentManagingBranchId || !_overrideProductId) return;
    if (!confirm('Hapus semua override untuk produk ini? Semua field akan kembali mengikuti nilai Master.')) return;
    var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/products/' + _overrideProductId + '/override', {
      method: 'PATCH', headers: getAuthHeaders(),
      body: JSON.stringify({ name: null, description: null, image_url: null })
    });
    var data = await res.json();
    if (data.success) {
      showToast('✅ Semua override dikembalikan ke Master.');
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
      var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/categories', {
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
        var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/adopt', {
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


  window.toggleBranchActivation = async function (id, isChecked) {
    var nextActive = isChecked ? 1 : 0;
    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + id, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: nextActive })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast(nextActive ? '✅ Cabang telah aktif.' : '⛔ Cabang telah nonaktif.');
        loadBranches();
      } else {
        alert((data && (data.message || data.error)) || 'Gagal mengubah status cabang.');
        loadBranches();
      }
    } catch (err) {
      if (err.status === 401) return;
      alert('Terjadi kesalahan saat mengubah status cabang: ' + err.message);
      loadBranches();
    }
  };

  window.openBranchModal = function (branchId) {
    var b = branchId ? (state.branches.find(function (x) { return x.id === branchId; }) || null) : null;
    $('branch-id').value = b ? b.id : '';
    $('branch-name').value = b ? (b.name || '') : '';
    $('branch-address').value = b ? (b.address_text || '') : '';
    $('branch-phone').value = b ? (b.phone || b.whatsapp_number || '') : '';
    $('branch-latitude').value = b ? Number(b.latitude || 0) : '';
    $('branch-longitude').value = b ? Number(b.longitude || 0) : '';
    $('branch-free-km').value = b ? (b.free_delivery_km != null ? b.free_delivery_km : 0) : 0;
    $('branch-price-km').value = b ? (b.price_per_km != null ? b.price_per_km : 3000) : 3000;
    $('branch-radius').value = b ? (b.max_radius_km != null ? b.max_radius_km : 10) : 10;
    $('branch-promo-minorder').value = b ? (b.promo_min_order != null ? b.promo_min_order : 50000) : 50000;
    $('branch-promo-discount').value = b ? (b.promo_delivery_discount != null ? b.promo_delivery_discount : 0) : 0;
    $('branch-open-override').checked = b ? !(b.is_open_override === 0 || b.is_open_override === false) : true;
    $('modal-branch-title').textContent = b ? ('Edit Cabang: ' + (b.name || '')) : 'Tambah Cabang';
    var modal = $('modal-branch');
    if (!modal) return;
    modal.style.display = 'flex';
    setTimeout(function () { $('branch-name').focus(); }, 80);
  };

  window.closeBranchModal = function () {
    var modal = $('modal-branch');
    if (!modal) return;
    modal.style.display = 'none';
    $('form-branch').reset();
  };

  window.deleteBranch = async function (branchId) {
    var b = state.branches.find(function (x) { return x.id === branchId; }) || {};
    if (!confirm('Yakin ingin menghapus cabang "' + (b.name || branchId) + '"? Tindakan ini tidak dapat dibatalkan.')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!res.ok || !data.success) {
        alert((data && (data.message || data.error)) || 'Gagal menghapus cabang.');
        return;
      }
      showToast('✅ Cabang berhasil dihapus.');
      loadBranches();
    } catch (err) {
      if (err.status === 401) return;
      alert('Terjadi kesalahan saat menghapus cabang: ' + err.message);
    }
  };

  var formBranchEl = $('form-branch');
  if (formBranchEl) {
    formBranchEl.addEventListener('submit', async function (e) {
      e.preventDefault();
      var id = $('branch-id').value;
      var payload = {
        name: $('branch-name').value.trim(),
        address_text: $('branch-address').value.trim(),
        phone: $('branch-phone').value.trim(),
        whatsapp_number: $('branch-phone').value.trim(),
        latitude: $('branch-latitude').value !== '' ? Number($('branch-latitude').value) : 0,
        longitude: $('branch-longitude').value !== '' ? Number($('branch-longitude').value) : 0,
        free_delivery_km: $('branch-free-km').value !== '' ? Number($('branch-free-km').value) : 0,
        price_per_km: $('branch-price-km').value !== '' ? Number($('branch-price-km').value) : 3000,
        max_radius_km: $('branch-radius').value !== '' ? Number($('branch-radius').value) : 10,
        promo_min_order: $('branch-promo-minorder').value !== '' ? Number($('branch-promo-minorder').value) : 50000,
        promo_delivery_discount: $('branch-promo-discount').value !== '' ? Number($('branch-promo-discount').value) : 0,
        is_open_override: $('branch-open-override').checked ? 1 : 0
      };

      var btn = this.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

      try {
        var url = id ? (API_BASE + '/admin/branches/' + encodeURIComponent(id)) : (API_BASE + '/admin/branches');
        var method = id ? 'PUT' : 'POST';
        var res = await adminFetch(url, {
          method: method,
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (!res.ok || !data.success) {
          alert((data && (data.message || data.error)) || 'Gagal menyimpan cabang.');
          return;
        }
        showToast(id ? '✅ Perubahan cabang disimpan.' : '✅ Cabang baru berhasil ditambahkan.');
        closeBranchModal();
        loadBranches();
      } catch (err) {
        if (err.status === 401) return;
        alert('Terjadi kesalahan saat menyimpan cabang: ' + err.message);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Simpan Cabang'; }
      }
    });
  }

  /* =========================================================================
     MODUL 4: PESANAN REALTIME CONTROLLER
     ========================================================================= */
  async function loadOrders() {
    var tbody = $('orders-table-body');
    if (!tbody) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/orders', { headers: getAuthHeaders() });
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
        var acceptRes = await adminFetch(API_BASE + '/orders/' + orderId + '/branch-acceptance', {
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
      var res = await adminFetch(API_BASE + '/kitchen/orders/' + orderId + '/status', {
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
      var res = await adminFetch(API_BASE + '/admin/analytics/summary', { headers: getAuthHeaders() });
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

  // Server-side session validation at boot: a token that exists locally but is
  // not valid on the server (401 INVALID_OR_EXPIRED_TOKEN) must force a real
  // login instead of letting the dashboard render an empty/fake state.
  async function validateServerSession() {
    var token = localStorage.getItem(TOKEN_KEY);
    if (!token) return false;
    try {
      var res = await adminFetch(API_BASE + '/auth/merchant/me', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data && data.success) {
        if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        return true;
      }
      clearStoredSession();
      redirectToLogin();
      return false;
    } catch (e) {
      // adminFetch already cleared + redirected on 401; keep the session on
      // network-level errors (server unreachable is not an expired session).
      return e && e.message === 'SESSION_EXPIRED' ? false : true;
    }
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
    return null;
  }

  async function loadInlineBranchCatalog() {
    var branchId = getActiveBranchId();
    if (!branchId) return;
    currentManagingBranchId = branchId;

    var adoptedEl = $('branch-inline-adopted-container');
    var availableEl = $('branch-inline-available-container');
    var catsEl = $('branch-inline-categories-bar');
    if (adoptedEl) adoptedEl.innerHTML = '<p class="text-muted" style="font-size:13px;">Memuat menu aktif cabang...</p>';
    if (availableEl) availableEl.innerHTML = '<p class="text-muted" style="font-size:13px;">Memuat rekomendasi Owner...</p>';
    if (catsEl) catsEl.innerHTML = '<span class="text-muted" style="font-size:13px;">Memuat kategori...</span>';

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/catalog', {
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

      // Outer chip wrapper — represents the category item in the list
      var chip = document.createElement('span');
      chip.dataset.catId = cat.id;
      chip.draggable = true;
      chip.style.cssText = [
        'display:inline-flex;align-items:center;gap:0;border-radius:20px;overflow:hidden;',
        'border:1px solid ' + (isActive ? 'var(--x-primary,#b6ff00)' : '#e2e8f0') + ';',
        'background:' + (isActive ? '#f0ffe0' : '#f8fafc') + ';',
        'transition:box-shadow 0.15s,opacity 0.15s;',
        'cursor:grab;'
      ].join('');

      // Drag handle indicator
      var handle = document.createElement('span');
      handle.title = 'Tahan & geser untuk ubah urutan';
      handle.style.cssText = 'padding:5px 4px 5px 10px;font-size:13px;color:#94a3b8;cursor:grab;user-select:none;';
      handle.textContent = '⠿';
      chip.appendChild(handle);

      // Small square thumbnail so admins can see the persisted category image
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

      // Category name / filter button
      var nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.draggable = false;
      nameBtn.style.cssText = 'border:none;background:none;padding:6px 8px 6px 2px;font-size:13px;font-weight:' + (isActive ? '700' : '500') + ';cursor:pointer;color:#1e293b;';
      nameBtn.textContent = cat.name;
      nameBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        setBranchCatalogFilter(cat.id);
      });
      chip.appendChild(nameBtn);

      // Edit button
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.draggable = false;
      editBtn.title = 'Ubah nama & gambar';
      editBtn.style.cssText = 'border:none;background:none;padding:5px 5px;font-size:12px;cursor:pointer;color:#64748b;';
      editBtn.textContent = '✏️';
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openBranchCategoryEditModal(cat);
      });
      chip.appendChild(editBtn);

      // Delete button
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.draggable = false;
      delBtn.title = 'Hapus kategori';
      delBtn.style.cssText = 'border:none;background:none;padding:6px 10px 6px 4px;font-size:12px;cursor:pointer;color:#ef4444;opacity:0.8;';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteBranchCategory(cat.id, cat.name);
      });
      chip.appendChild(delBtn);

      // ── HTML5 Drag Events ──
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
    var branchId = getActiveBranchId();
    if (!branchId) {
      showToast('❌ Cabang tidak valid atau belum dipilih.');
      return;
    }
    currentManagingBranchId = branchId;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + branchId + '/categories/reorder', {
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

  // ── Branch Category Edit Modal (name + image) ──────────────────────────
  var _bceSelectedFile = null; // File object staged for upload on save
  var _bceCurrentCat = null;   // Active category being edited

  window.openBranchCategoryEditModal = function (cat) {
    _bceSelectedFile = null;
    _bceCurrentCat = cat || null;
    $('bce-cat-id').value = cat ? cat.id : '';
    $('bce-name').value = (cat && cat.name) || '';
    $('bce-image-file').value = '';

    var previewImg = $('bce-image-preview');
    var previewMono = $('bce-image-preview-mono');
    if (cat && cat.image_url) {
      previewImg.src = cat.image_url;
      previewImg.style.display = 'block';
      previewMono.style.display = 'none';
    } else {
      previewImg.style.display = 'none';
      previewMono.style.display = 'block';
      previewMono.textContent = ((cat && cat.name) || '?').trim().slice(0, 1).toUpperCase();
    }

    var modal = $('modal-branch-category-edit');
    if (modal) modal.style.display = 'flex';
  };

  window.closeBranchCategoryEditModal = function () {
    var modal = $('modal-branch-category-edit');
    if (modal) modal.style.display = 'none';
    _bceSelectedFile = null;
    _bceCurrentCat = null;
  };

  (function initBranchCategoryEditModal() {
    var fileInput = $('bce-image-file');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) { _bceSelectedFile = null; return; }

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.');
          fileInput.value = '';
          return;
        }
        if (file.size > 3 * 1024 * 1024) {
          showToast('❌ Ukuran gambar melebihi batas maksimal 3MB.');
          fileInput.value = '';
          return;
        }

        _bceSelectedFile = file;

        // Local preview only — the actual persisted image comes back from the
        // backend after upload; this is just so the admin sees what they picked.
        var reader = new FileReader();
        reader.onload = function (e) {
          var previewImg = $('bce-image-preview');
          var previewMono = $('bce-image-preview-mono');
          previewImg.src = e.target.result;
          previewImg.style.display = 'block';
          previewMono.style.display = 'none';
        };
        reader.readAsDataURL(file);
      });
    }

    var form = $('form-branch-category-edit');
    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();

        var catId = $('bce-cat-id').value;
        var newName = $('bce-name').value.trim();
        if (!newName) {
          showToast('❌ Nama kategori wajib diisi.');
          return;
        }

        var activeBranchId = getActiveBranchId();
        if (!activeBranchId) {
          showToast('❌ Cabang tidak valid atau belum dipilih.');
          return;
        }
        currentManagingBranchId = activeBranchId;

        var saveBtn = $('btn-save-branch-category-edit');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Menyimpan...'; }

        try {
          // 1. Rename (always sent — keeps behavior simple/predictable)
          var renameRes = await adminFetch(API_BASE + '/admin/branches/' + activeBranchId + '/categories/' + catId, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ name: newName })
          });
          var renameData = {};
          try {
            renameData = await renameRes.json();
          } catch (_) {
            renameData = { success: false, error: 'Respon server tidak valid saat mengubah nama kategori.' };
          }

          if (!renameRes.ok || !renameData.success) {
            showToast('❌ ' + (renameData.error || renameData.message || 'Gagal mengubah nama kategori.'));
            return;
          }

          // 2. Image (only if a new file was staged) — uploaded as base64 to backend
          if (_bceSelectedFile) {
            var base64 = await new Promise(function (resolve, reject) {
              var reader = new FileReader();
              reader.onload = function () { resolve(reader.result); };
              reader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
              reader.readAsDataURL(_bceSelectedFile);
            });

            var imageRes = await adminFetch(API_BASE + '/admin/branches/' + activeBranchId + '/categories/' + catId + '/image', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify({ image_base64: base64, mime_type: _bceSelectedFile.type })
            });
            var imageData = {};
            try {
              imageData = await imageRes.json();
            } catch (_) {
              imageData = { success: false, error: 'Respon server tidak valid saat mengunggah gambar.' };
            }

            if (!imageRes.ok || !imageData.success) {
              showToast('❌ ' + (imageData.error || imageData.message || 'Gagal mengunggah gambar kategori.'));
              return;
            }
          }

          showToast('✅ Kategori berhasil diperbarui!');
          closeBranchCategoryEditModal();
          if (typeof loadInlineBranchCatalog === 'function') {
            loadInlineBranchCatalog();
          }
        } catch (err) {
          console.error('[Branch Category Edit Error]:', err);
          showToast('❌ ' + (err.message || 'Kesalahan jaringan saat menyimpan kategori.'));
        } finally {
          if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Simpan'; }
        }
      });
    }
  })();

  window.deleteBranchCategory = async function (catId, catName) {
    if (!confirm('Hapus kategori "' + catName + '"? Produk di kategori ini tidak akan dihapus, hanya dipindah ke tanpa kategori.')) return;

    var branchId = getActiveBranchId();
    if (!branchId) {
      showToast('❌ Cabang tidak valid atau belum dipilih.');
      return;
    }
    currentManagingBranchId = branchId;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + branchId + '/categories/' + catId, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Kategori dihapus.');
        if (branchCatalogFilter === catId) branchCatalogFilter = 'all';
        loadInlineBranchCatalog();
      } else {
        showToast('❌ ' + (data.error || 'Gagal menghapus kategori.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
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
      var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/products/' + productId, {
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
      var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/products/' + productId, {
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
    validateServerSession();
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
          var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/categories', {
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
    validateServerSession();

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
