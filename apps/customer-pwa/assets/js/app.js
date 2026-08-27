(function () {
  'use strict';

  const Store = window.Xentra.Store;
  const UI = window.Xentra.UI;

  // DOM Elements
  const brandTitleEl = document.getElementById('x-brand-name');
  const currentAddressEl = document.getElementById('x-current-address');
  const branchBadgeBarEl = document.getElementById('x-branch-badge-bar');
  const activeBranchNameEl = document.getElementById('x-active-branch-name');
  const categoryNavEl = document.getElementById('x-category-nav');
  const menuListEl = document.getElementById('x-menu-list');
  const cartDockEl = document.getElementById('x-cart-dock');
  const cartDockQtyEl = document.getElementById('x-cart-dock-qty');
  const cartDockItemsLabelEl = document.getElementById('x-cart-dock-items-label');
  const cartDockTotalEl = document.getElementById('x-cart-dock-total');
  const btnGoCheckoutEl = document.getElementById('x-btn-go-checkout');
  const btnSelectLocationEl = document.getElementById('x-btn-select-location');
  const btnOpenCartSheetEl = document.getElementById('x-btn-open-cart-sheet');
  const overlayContainerEl = document.getElementById('x-overlay-container');

  let catalogData = [];
  let activeCategoryId = null;

  // 1. Initialize App
  async function init() {
    // 1. Fetch Brand Info
    try {
      const res = await fetch('/api/v1/brand/info');
      const data = await res.json();
      if (data.success && data.brand) {
        Store.setBrand(data.brand);
        brandTitleEl.textContent = data.brand.name;
        if (data.brand.primary_color) {
          document.documentElement.style.setProperty('--x-primary', data.brand.primary_color);
        }
      }
    } catch (_) {}

    // 2. Default Location Setup if none saved
    const state = Store.getState();
    if (!state.location) {
      Store.setLocation({
        address: 'Jl. Mayjen Sungkono No. 89, Surabaya',
        latitude: -7.291230,
        longitude: 112.716750
      });
    }

    // 3. Match Nearest Branch
    await refreshBranchMatch();

    // 4. Fetch Catalog Menu
    await fetchCatalog();

    // 5. Subscribe to Store Updates
    Store.subscribe(renderState);
    renderState(Store.getState());
  }

  // 2. Branch Matching
  async function refreshBranchMatch() {
    const { location } = Store.getState();
    if (!location) return;

    currentAddressEl.textContent = location.address;

    try {
      const res = await fetch('/api/v1/delivery/match-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: location.latitude,
          longitude: location.longitude,
          subtotal: Store.getCartSubtotal()
        })
      });
      const data = await res.json();

      if (data.success && data.eligible) {
        Store.setMatchedBranch(data);
        branchBadgeBarEl.style.display = 'flex';
        activeBranchNameEl.textContent = `Dilayani oleh ${data.branch.name} (${data.delivery.distance_km} km)`;
      } else {
        Store.setMatchedBranch(null);
        branchBadgeBarEl.style.display = 'flex';
        activeBranchNameEl.textContent = data.reason || 'Di luar jangkauan cabang kami';
      }
    } catch (err) {
      console.error('[App] Match branch error:', err);
    }
  }

  // 3. Fetch Catalog Menu
  async function fetchCatalog() {
    try {
      const res = await fetch('/api/v1/catalog/menu');
      const data = await res.json();
      if (data.success) {
        catalogData = data.categories || [];
        renderCategoryNav();
        renderMenu();
      }
    } catch (err) {
      console.error('[App] Fetch catalog error:', err);
    }
  }

  // 4. Render Categories Nav
  function renderCategoryNav() {
    categoryNavEl.innerHTML = '';
    if (catalogData.length === 0) return;

    if (!activeCategoryId && catalogData[0]) {
      activeCategoryId = catalogData[0].id;
    }

    catalogData.forEach((cat) => {
      const btn = document.createElement('button');
      btn.className = `x-cat-tab ${cat.id === activeCategoryId ? 'active' : ''}`;
      btn.textContent = cat.name;
      btn.onclick = () => {
        activeCategoryId = cat.id;
        renderCategoryNav();
        const section = document.getElementById(`cat-sec-${cat.id}`);
        if (section) {
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      };
      categoryNavEl.appendChild(btn);
    });
  }

  // 5. Render Menu Items
  function renderMenu() {
    menuListEl.innerHTML = '';
    const { cart, notes } = Store.getState();

    catalogData.forEach((cat) => {
      const secTitle = document.createElement('h2');
      secTitle.className = 'x-cat-section-title';
      secTitle.id = `cat-sec-${cat.id}`;
      secTitle.textContent = cat.name;
      menuListEl.appendChild(secTitle);

      (cat.products || []).forEach((product) => {
        const itemInCart = cart.items.find((i) => String(i.id) === String(product.id));
        const qty = itemInCart ? itemInCart.quantity : 0;
        const note = (itemInCart && itemInCart.note) || notes[product.id] || '';

        const card = document.createElement('article');
        card.className = 'x-product-card';

        const oldPriceHtml =
          product.regular_price && Number(product.regular_price) > Number(product.price)
            ? `<span class="x-old-price">${UI.money(product.regular_price)}</span>`
            : '';

        let controlsHtml = '';
        if (qty > 0) {
          controlsHtml = `
            <div class="x-qty-stepper">
              <button class="x-btn-step" data-minus="${product.id}">−</button>
              <span class="x-qty-val">${qty}</span>
              <button class="x-btn-step" data-plus="${product.id}">＋</button>
            </div>
            <button class="x-btn-note ${note ? 'has-note' : ''}" data-note="${product.id}">
              ${note ? '✏️ ' + UI.escape(note) : '＋ Catatan'}
            </button>
          `;
        } else {
          controlsHtml = `<button class="x-btn-add" data-add="${product.id}">Tambah</button>`;
        }

        card.innerHTML = `
          <div class="x-product-info">
            <h3 class="x-product-name">${UI.escape(product.name)}</h3>
            <p class="x-product-desc">${UI.escape(product.description || '')}</p>
            <div class="x-price-group">
              ${oldPriceHtml}
              <span class="x-price">${UI.money(product.price)}</span>
            </div>
          </div>
          <div class="x-product-right">
            ${product.image_url ? `<img class="x-product-img" src="${UI.escape(product.image_url)}" alt="${UI.escape(product.name)}">` : '<div class="x-product-img"></div>'}
            ${controlsHtml}
          </div>
        `;

        menuListEl.appendChild(card);
      });
    });

    bindMenuEvents();
  }

  // 6. Bind Product Buttons
  function bindMenuEvents() {
    document.querySelectorAll('[data-add]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.add;
        const prod = findProduct(id);
        if (prod) Store.addItem(prod, 1);
      };
    });

    document.querySelectorAll('[data-plus]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.plus;
        const item = Store.getState().cart.items.find((i) => String(i.id) === String(id));
        if (item) Store.setQty(id, item.quantity + 1);
      };
    });

    document.querySelectorAll('[data-minus]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.minus;
        const item = Store.getState().cart.items.find((i) => String(i.id) === String(id));
        if (item) Store.setQty(id, item.quantity - 1);
      };
    });

    document.querySelectorAll('[data-note]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.note;
        openNoteSheet(id);
      };
    });
  }

  function findProduct(id) {
    for (const cat of catalogData) {
      const found = (cat.products || []).find((p) => String(p.id) === String(id));
      if (found) return found;
    }
    return null;
  }

  // 7. Render State Updates
  function renderState(state) {
    const count = Store.getCartCount();
    const subtotal = Store.getCartSubtotal();

    if (count > 0) {
      cartDockEl.classList.add('visible');
      cartDockQtyEl.textContent = count;
      cartDockItemsLabelEl.textContent = `${count} Item`;
      cartDockTotalEl.textContent = UI.money(subtotal);
    } else {
      cartDockEl.classList.remove('visible');
    }

    renderMenu();
  }

  // 8. Note Bottom Sheet
  function openNoteSheet(productId) {
    const prod = findProduct(productId);
    if (!prod) return;

    const item = Store.getState().cart.items.find((i) => String(i.id) === String(productId));
    const currentNote = item ? item.note || '' : '';

    const overlay = document.createElement('div');
    overlay.className = 'x-overlay';
    overlay.innerHTML = `
      <div class="x-sheet">
        <div class="x-sheet-handle"></div>
        <div class="x-sheet-header">
          <div class="x-sheet-title">Catatan: ${UI.escape(prod.name)}</div>
          <button class="x-sheet-close" id="x-note-close">✕</button>
        </div>
        <div class="x-sheet-body">
          <textarea id="x-note-input" rows="4" style="width:100%; border:1px solid #e5e7eb; border-radius:12px; padding:12px; font-size:14px;" placeholder="Contoh: Jangan terlalu pedas, kuah dipisah...">${UI.escape(currentNote)}</textarea>
        </div>
        <div class="x-sheet-footer">
          <button class="x-btn-primary" id="x-btn-save-note">Simpan Catatan</button>
        </div>
      </div>
    `;

    overlayContainerEl.appendChild(overlay);

    overlay.querySelector('#x-note-close').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    overlay.querySelector('#x-btn-save-note').onclick = () => {
      const val = overlay.querySelector('#x-note-input').value.trim();
      Store.setNote(productId, val);
      overlay.remove();
    };
  }

  // 9. Location Picker Overlay
  btnSelectLocationEl.onclick = () => {
    openLocationPicker();
  };

  function openLocationPicker() {
    const { location } = Store.getState();
    const lat = location ? location.latitude : -7.291230;
    const lng = location ? location.longitude : 112.716750;

    const overlay = document.createElement('div');
    overlay.className = 'x-overlay';
    overlay.innerHTML = `
      <div class="x-sheet" style="height: 85vh;">
        <div class="x-sheet-handle"></div>
        <div class="x-sheet-header">
          <div class="x-sheet-title">Pilih Lokasi Pengantaran</div>
          <button class="x-sheet-close" id="x-loc-close">✕</button>
        </div>
        <div class="x-sheet-body" style="display:flex; flex-direction:column; padding:0;">
          <div style="padding: 12px 20px;">
            <input type="text" id="x-loc-search" placeholder="Ketik nama jalan / gedung..." style="width:100%; padding:10px 14px; border:1px solid #e5e7eb; border-radius:12px; font-size:13px;">
            <div id="x-loc-suggestions" style="max-height:150px; overflow-y:auto; font-size:12px;"></div>
          </div>
          <div id="x-leaflet-map" style="flex:1; width:100%; min-height: 250px;"></div>
        </div>
        <div class="x-sheet-footer">
          <div id="x-loc-selected-text" style="font-size:12px; font-weight:600; margin-bottom:8px;">${UI.escape(location ? location.address : '')}</div>
          <button class="x-btn-primary" id="x-btn-confirm-loc">Gunakan Lokasi Ini</button>
        </div>
      </div>
    `;

    overlayContainerEl.appendChild(overlay);

    overlay.querySelector('#x-loc-close').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    let currentMarkerLat = lat;
    let currentMarkerLng = lng;
    let currentAddressName = location ? location.address : 'Lokasi Terpilih';

    setTimeout(() => {
      const map = L.map('x-leaflet-map').setView([lat, lng], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);

      const marker = L.marker([lat, lng], { draggable: true }).addTo(map);

      marker.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        currentMarkerLat = pos.lat;
        currentMarkerLng = pos.lng;
        currentAddressName = `Koordinat: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
        overlay.querySelector('#x-loc-selected-text').textContent = currentAddressName;
      });

      // Search input handler
      const searchInput = overlay.querySelector('#x-loc-search');
      const sugContainer = overlay.querySelector('#x-loc-suggestions');

      let debounceTimer = null;
      searchInput.oninput = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          const q = searchInput.value.trim();
          if (q.length < 3) return;
          const res = await fetch(`/api/v1/location/search?q=${encodeURIComponent(q)}`);
          const d = await res.json();
          sugContainer.innerHTML = '';
          (d.results || []).forEach((item) => {
            const row = document.createElement('div');
            row.style.padding = '8px 12px';
            row.style.borderBottom = '1px solid #eee';
            row.style.cursor = 'pointer';
            row.textContent = item.display_name;
            row.onclick = () => {
              currentMarkerLat = item.latitude;
              currentMarkerLng = item.longitude;
              currentAddressName = item.display_name;
              overlay.querySelector('#x-loc-selected-text').textContent = item.display_name;
              marker.setLatLng([item.latitude, item.longitude]);
              map.setView([item.latitude, item.longitude], 16);
              sugContainer.innerHTML = '';
            };
            sugContainer.appendChild(row);
          });
        }, 400);
      };
    }, 100);

    overlay.querySelector('#x-btn-confirm-loc').onclick = async () => {
      Store.setLocation({
        address: currentAddressName,
        latitude: currentMarkerLat,
        longitude: currentMarkerLng
      });
      overlay.remove();
      await refreshBranchMatch();
    };
  }

  // 10. Checkout Page Modal Flow
  btnGoCheckoutEl.onclick = () => {
    openCheckoutModal();
  };

  function openCheckoutModal() {
    const { cart, location, matchedBranch } = Store.getState();
    const count = Store.getCartCount();
    const subtotal = Store.getCartSubtotal();

    if (count === 0) return;

    if (!matchedBranch || !matchedBranch.eligible) {
      alert('Maaf, alamat pengantaran saat ini di luar jangkauan cabang aktif kami. Silakan pilih lokasi lain.');
      return;
    }

    const deliveryFee = matchedBranch.delivery.final_delivery_fee;
    const discountAmount = matchedBranch.delivery.discount_amount;
    const grandTotal = subtotal + deliveryFee;

    const overlay = document.createElement('div');
    overlay.className = 'x-overlay';
    overlay.innerHTML = `
      <div class="x-sheet" style="height: 92vh;">
        <div class="x-sheet-handle"></div>
        <div class="x-sheet-header">
          <div class="x-sheet-title">Checkout Pesanan</div>
          <button class="x-sheet-close" id="x-checkout-close">✕</button>
        </div>
        <div class="x-sheet-body">
          <!-- Customer Info -->
          <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:14px; padding:14px; margin-bottom:14px;">
            <div style="font-size:12px; font-weight:700; color:#374151; margin-bottom:8px;">DATA PEMESAN</div>
            <input type="text" id="x-input-name" placeholder="Nama Lengkap" value="Ikhwan" style="width:100%; padding:10px; border:1px solid #d1d5db; border-radius:8px; margin-bottom:8px; font-size:13px;">
            <input type="tel" id="x-input-phone" placeholder="Nomor WhatsApp (08xxx)" value="081234567890" style="width:100%; padding:10px; border:1px solid #d1d5db; border-radius:8px; font-size:13px;">
          </div>

          <!-- Delivery Info -->
          <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:14px; padding:14px; margin-bottom:14px;">
            <div style="font-size:12px; font-weight:700; color:#374151; margin-bottom:4px;">PENGANTARAN (${matchedBranch.delivery.distance_km} KM)</div>
            <div style="font-size:13px; font-weight:700; margin-bottom:2px;">${UI.escape(matchedBranch.branch.name)}</div>
            <div style="font-size:12px; color:#6b7280;">Diantar ke: ${UI.escape(location.address)}</div>
          </div>

          <!-- Items List -->
          <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:14px; padding:14px; margin-bottom:14px;">
            <div style="font-size:12px; font-weight:700; color:#374151; margin-bottom:8px;">RINGKASAN PESANAN</div>
            ${cart.items.map((i) => `
              <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px;">
                <span>${i.quantity}x ${UI.escape(i.name)} ${i.note ? `<span style="font-size:11px; color:#16a34a;">(${UI.escape(i.note)})</span>` : ''}</span>
                <span style="font-weight:700;">${UI.money(i.price * i.quantity)}</span>
              </div>
            `).join('')}
          </div>

          <!-- Payment Summary -->
          <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:14px; padding:14px; margin-bottom:14px;">
            <div style="font-size:12px; font-weight:700; color:#374151; margin-bottom:8px;">RINGKASAN PEMBAYARAN</div>
            <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
              <span>Subtotal Makanan</span>
              <span>${UI.money(subtotal)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
              <span>Ongkir (${matchedBranch.delivery.distance_km} km)</span>
              <span>${UI.money(matchedBranch.delivery.base_delivery_fee)}</span>
            </div>
            ${discountAmount > 0 ? `
              <div style="display:flex; justify-content:space-between; font-size:13px; color:#16a34a; font-weight:700; margin-bottom:4px;">
                <span>Diskon Ongkir</span>
                <span>-${UI.money(discountAmount)}</span>
              </div>
            ` : ''}
            <div style="display:flex; justify-content:space-between; font-size:15px; font-weight:800; border-top:1px dashed #d1d5db; padding-top:8px; margin-top:8px;">
              <span>Total Pembayaran</span>
              <span style="color:#000;">${UI.money(grandTotal)}</span>
            </div>
          </div>
        </div>
        <div class="x-sheet-footer">
          <button class="x-btn-primary" id="x-btn-submit-order">
            Bayar Sekarang (${UI.money(grandTotal)})
          </button>
        </div>
      </div>
    `;

    overlayContainerEl.appendChild(overlay);

    overlay.querySelector('#x-checkout-close').onclick = () => overlay.remove();

    overlay.querySelector('#x-btn-submit-order').onclick = async () => {
      const name = overlay.querySelector('#x-input-name').value.trim();
      const phone = overlay.querySelector('#x-input-phone').value.trim();

      if (!phone) {
        alert('Silakan masukkan nomor WhatsApp Anda.');
        return;
      }

      const submitBtn = overlay.querySelector('#x-btn-submit-order');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Memproses Pesanan...';

      try {
        const payload = {
          branch_id: matchedBranch.branch.id,
          customer: { name, phone },
          order_type: 'delivery',
          schedule_type: 'asap',
          delivery: {
            address: location.address,
            latitude: location.latitude,
            longitude: location.longitude
          },
          items: cart.items
        };

        const res = await fetch('/api/v1/checkout/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (data.success && data.snap_token) {
          overlay.remove();
          Store.clearCart();

          // Invoke Midtrans Snap Popup
          if (window.snap && typeof window.snap.pay === 'function') {
            window.snap.pay(data.snap_token, {
              onSuccess: function (result) {
                alert(`Pembayaran Berhasil! Pesanan Anda (${data.order_number}) sedang disiapkan.`);
                window.location.reload();
              },
              onPending: function (result) {
                alert(`Menunggu Pembayaran. Kode pesanan Anda: ${data.order_number}`);
                window.location.reload();
              },
              onError: function (result) {
                alert('Pembayaran gagal atau dibatalkan.');
              },
              onClose: function () {
                alert(`Pesanan ${data.order_number} berhasil dibuat.`);
                window.location.reload();
              }
            });
          } else {
            alert(`Pesanan ${data.order_number} Berhasil Dibuat!\nTotal: ${UI.money(data.grand_total)}`);
            window.location.reload();
          }
        } else {
          alert(data.error || 'Gagal membuat pesanan. Silakan coba lagi.');
          submitBtn.disabled = false;
          submitBtn.textContent = `Bayar Sekarang (${UI.money(grandTotal)})`;
        }
      } catch (err) {
        console.error('[Checkout] Submit error:', err);
        alert('Terjadi kesalahan koneksi server.');
        submitBtn.disabled = false;
        submitBtn.textContent = `Bayar Sekarang (${UI.money(grandTotal)})`;
      }
    };
  }

  // Run on DOM ready
  document.addEventListener('DOMContentLoaded', init);
})();
