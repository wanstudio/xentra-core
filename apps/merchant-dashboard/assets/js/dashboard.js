/**
 * XENTRA CORE — MERCHANT & OWNER DASHBOARD JAVASCRIPT
 * Real-time SPA for Brand Theme, Product CRUD, Delivery Formula, & Live Orders
 */

(function () {
  'use strict';

  var API_BASE = '/api/v1';

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

    if (tabId === 'catalog') loadCatalog();
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
      var res = await fetch(API_BASE + '/admin/brand');
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
    $('brand-domain').value = brand.custom_domain || 'dev.mybangjo.com';

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
          headers: { 'Content-Type': 'application/json' },
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
            headers: { 'Content-Type': 'application/json' },
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
            method: 'DELETE'
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
      var [catRes, prodRes] = await Promise.all([
        fetch(API_BASE + '/admin/categories'),
        fetch(API_BASE + '/admin/products')
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
          '<td>',
            '<strong>' + formatMoney(prod.price) + '</strong>',
            (prod.regular_price > prod.price ? '<br><s class="text-muted" style="font-size:11px;">' + formatMoney(prod.regular_price) + '</s>' : ''),
          '</td>',
          '<td>',
            '<button type="button" class="x-badge ' + (isActive ? 'x-badge-success' : 'x-badge-danger') + '" onclick="toggleStock(\'' + prod.id + '\')">',
              (isActive ? '● Tersedia' : '✕ Habis'),
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
      var res = await fetch(API_BASE + '/admin/products/' + id + '/toggle', { method: 'PATCH' });
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
      var res = await fetch(API_BASE + '/admin/products/' + id, { method: 'DELETE' });
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
          headers: { 'Content-Type': 'application/json' },
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
          headers: { 'Content-Type': 'application/json' },
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
  async function loadBranches() {
    try {
      var res = await fetch(API_BASE + '/admin/branches');
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
      state.branches = [
        {
          id: 'branch_bangjo_barat',
          name: 'Bangjo Surabaya Barat',
          address_text: 'Jl. Mayjen Sungkono No. 88, Surabaya Barat',
          latitude: -7.2912,
          longitude: 112.7154,
          phone: '081234567890',
          is_active: 1,
          free_delivery_km: 2.0,
          price_per_km: 3000.0,
          max_radius_km: 12.0,
          promo_min_order: 50000.0,
          promo_delivery_discount: 10000.0
        }
      ];
    }

    var html = state.branches.map(function (b) {
      return [
        '<div class="x-branch-card">',
          '<div class="x-branch-card-header">',
            '<h4>' + b.name + '</h4>',
            '<span class="x-badge ' + (b.is_active ? 'x-badge-success' : 'x-badge-danger') + '">' + (b.is_active ? '● Buka' : '✕ Tutup') + '</span>',
          '</div>',
          '<p class="text-muted" style="font-size:13px;">📍 ' + b.address_text + '</p>',
          '<div class="x-branch-detail-row"><span>📱 WhatsApp Cabang:</span><span style="font-weight:600;color:var(--x-primary);">' + (b.phone || '<span style="color:#ef4444;">(Wajib diisi)</span>') + '</span></div>',
          '<div class="x-branch-detail-row"><span>Koordinat GPS:</span><span>' + b.latitude + ', ' + b.longitude + '</span></div>',
          '<div class="x-branch-detail-row"><span>Gratis Ongkir:</span><span style="color:#10b981;">' + (b.free_delivery_km || 0) + ' KM Pertama Gratis</span></div>',
          '<div class="x-branch-detail-row"><span>Tarif per KM:</span><span>' + formatMoney(b.price_per_km || 3000) + ' / km</span></div>',
          '<div class="x-branch-detail-row"><span>Radius Maksimal:</span><span>' + (b.max_radius_km || 12) + ' KM</span></div>',
          '<div class="x-branch-detail-row"><span>Promo Diskon Ongkir:</span><span>Diskon ' + formatMoney(b.promo_delivery_discount || 10000) + ' (Min. ' + formatMoney(b.promo_min_order || 50000) + ')</span></div>',
          '<div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">',
            '<button type="button" class="x-btn-secondary" style="font-size:12px;" onclick="editBranchPhone(\'' + b.id + '\')">📱 Ubah No. WA</button>',
            '<button type="button" class="x-btn-secondary" style="font-size:12px;" onclick="editBranchSettings(\'' + b.id + '\')">⚙️ Atur Ongkir</button>',
          '</div>',
        '</div>'
      ].join('');
    });

    container.innerHTML = html.join('');
  }

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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
      var res = await fetch(API_BASE + '/admin/orders');
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
    var nextMap = {
      pending: 'confirmed',
      confirmed: 'preparing',
      preparing: 'ready',
      ready: 'delivered',
      delivered: 'completed'
    };

    var nextStatus = nextMap[currentStatus] || 'completed';
    try {
      var res = await fetch(API_BASE + '/kitchen/orders/' + orderId + '/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, note: 'Status diupdate dari Merchant Dashboard' })
      });
      var data = await res.json();
      if (data.success) {
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
      var res = await fetch(API_BASE + '/admin/analytics/summary');
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
  var TOKEN_KEY = 'xentra_merchant_token';
  var USER_KEY = 'xentra_merchant_user';

  function getStoredUser() {
    try {
      var u = localStorage.getItem(USER_KEY);
      return u ? JSON.parse(u) : null;
    } catch (_) { return null; }
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

  window.__xentraInitDashboard = function () {
    checkAuth();
    loadBrandSettings();
    loadCatalog();
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

    // Check Auth session
    var isAuth = checkAuth();

    // Initial data fetch if authenticated
    loadBrandSettings();
    if (isAuth) {
      loadCatalog();
      loadOverview();
    }
  });

})();
