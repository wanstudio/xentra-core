/**
 * Xentra Home Page Controller
 * Orchestrates: Hero clock, carousel, category tabs, product grid, cart dock.
 * Pixel-perfect replication of production app.mybangjo.com home page.
 */
(function () {
  'use strict';
  if (window.__XENTRA_HOME_V2) return;
  window.__XENTRA_HOME_V2 = true;

  var API = window.Xentra.API;
  var Store = window.Xentra.Store;
  var UI = window.Xentra.UI;

  // ── State ──
  var categories = [];
  var products = [];
  var activeCategory = null;

  var DEFAULT_CATALOG = {
    categories: [
      { id: 34, name: 'Rekom', slug: 'rekom', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/unnamed-7-2.png', products: [
        { id: 272, category_id: 34, name: 'Paket Spesial Semar', price: 35000, regular_price: 38000, description: 'Nasi + Ayam Tulang Lunak Goreng + Telor Ceplok + Tempe Goreng + Es Teh Manis + Kremesan + Sambal Terasi + Lalapan', image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png' },
        { id: 285, category_id: 34, name: 'Paket Spesial Petruk', price: 35000, regular_price: 37000, description: 'Ayam Tulang Lunak Goreng + Telor Ceplok + Tempe Goreng + Es Teh Manis + Kremesan + Sambal Terasi + Lalapan', image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-04_05_15-PM-300x300.png' },
        { id: 345, category_id: 34, name: 'Mie Gurih', price: 15000, regular_price: 17000, description: 'Mie + daging + pangsit rebus + kerupuk pangsit + sawi + tahu + kuah', image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png' }
      ]},
      { id: 20, name: 'Paket Ayam', slug: 'paket-ayam', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/New-Project.png', products: [
        { id: 272, category_id: 20, name: 'Paket Spesial Semar', price: 35000, regular_price: 38000, description: 'Nasi + Ayam Tulang Lunak Goreng + Telor Ceplok + Tempe Goreng + Es Teh Manis', image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png' },
        { id: 285, category_id: 20, name: 'Paket Spesial Petruk', price: 35000, regular_price: 37000, description: 'Ayam Tulang Lunak Goreng + Telor Ceplok + Tempe Goreng + Es Teh Manis', image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-04_05_15-PM-300x300.png' },
        { id: 286, category_id: 20, name: 'Ayam Tulang Lunak Bakar', price: 28000, regular_price: 32000, description: 'Ayam bakar rempah lumuran bumbu khas Bangjo empuk sampai ke tulang.', image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png' }
      ]},
      { id: 26, name: 'Mie Bangjo', slug: 'mie-bangjo', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-11_28_14-AM.png', products: [
        { id: 345, category_id: 26, name: 'Mie Gurih', price: 15000, regular_price: 17000, description: 'Mie + daging + pangsit rebus + kerupuk pangsit + sawi + tahu + kuah', image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png' },
        { id: 287, category_id: 26, name: 'Mie Godog Jawa Asli', price: 22000, regular_price: 25000, description: 'Mie godog kuah gurih kaldu kental ayam kampung dengan telor dan sayur segar.', image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png' }
      ]},
      { id: 22, name: 'Minuman', slug: 'minuman', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png', products: [
        { id: 288, category_id: 22, name: 'Es Kopi Susu Bangjo', price: 15000, regular_price: 18000, description: 'Kopi susu gula aren racikan istimewa barista Bangjo dingin segar.', image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png' },
        { id: 401, category_id: 22, name: 'Es Teh Manis', price: 5000, regular_price: 5000, description: 'Teh melati wangi diseduh segar dingin menyegarkan', image_url: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400' },
        { id: 402, category_id: 22, name: 'Es Jeruk Segar', price: 8000, regular_price: 10000, description: 'Jeruk peras murni segar', image_url: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=400' }
      ]}
    ]
  };

  var ICONS = {
    minus: '/assets/icons/minus.svg',
    plus: '/assets/icons/plus.svg',
    cart: '/assets/icons/cart.svg',
    file: '/assets/icons/file.svg',
    write: '/assets/icons/write.svg',
    trash: '/assets/icons/trash.svg',
    bike: '/assets/icons/bike.svg',
    right: '/assets/icons/right1.svg',
    diskon: '/assets/icons/diskon.svg',
    coupon: '/assets/icons/coupon.svg'
  };

  // ── DOM cache ──
  var $ = function (id) { return document.getElementById(id); };

  // ======================================================================
  //  HERO CLOCK
  // ======================================================================
  var DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  var MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  function updateClock() {
    var now = new Date();
    var timeEl = $('x-hero-time');
    var dateEl = $('x-hero-date');
    if (timeEl) {
      timeEl.textContent = String(now.getHours()).padStart(2, '0') + '.' +
        String(now.getMinutes()).padStart(2, '0');
    }
    if (dateEl) {
      dateEl.textContent = DAYS[now.getDay()] + ', ' +
        now.getDate() + ' ' + MONTHS[now.getMonth()] + ' ' + now.getFullYear();
    }
  }

  // ======================================================================
  //  CAROUSEL BANNER
  // ======================================================================
  function initCarousel() {
    var track = $('x-carousel-track');
    var dots = $('x-carousel-dots');
    var container = track ? track.closest('.x-carousel-container') : null;
    if (!track || !dots) return;

    var slides = track.querySelectorAll('.x-carousel-slide');
    if (slides.length <= 1) {
      dots.style.display = 'none';
      return;
    }

    function scrollToSlide(idx) {
      var slide = slides[idx];
      if (!slide || !track) return;
      // Scroll HANYA horizontal track container lokal, jangan pernah ganggu window / vertical scroll pengguna!
      var targetLeft = slide.offsetLeft - (track.clientWidth - slide.clientWidth) / 2;
      track.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: 'smooth'
      });
    }

    // Create dot buttons
    dots.innerHTML = '';
    for (var i = 0; i < slides.length; i++) {
      var dot = document.createElement('button');
      dot.className = 'x-carousel-dot' + (i === 0 ? ' active' : '');
      dot.setAttribute('data-slide', String(i));
      dot.onclick = (function (idx) {
        return function () {
          scrollToSlide(idx);
        };
      })(i);
      dots.appendChild(dot);
    }

    // Observe scroll for active dot
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var idx = Array.from(slides).indexOf(entry.target);
          if (idx >= 0) {
            autoIdx = idx;
            dots.querySelectorAll('.x-carousel-dot').forEach(function (d, j) {
              d.classList.toggle('active', j === idx);
            });
          }
        }
      });
    }, { root: track, threshold: 0.6 });

    slides.forEach(function (s) { observer.observe(s); });

    // Auto-play state & viewport observer
    var autoIdx = 0;
    var isCarouselInViewport = true;
    var isUserInteracting = false;

    // Hanya aktif jika carousel sedang terlihat di layar (tidak mengganggu user yang scroll ke bawah)
    if ('IntersectionObserver' in window && container) {
      var vpObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          isCarouselInViewport = e.isIntersecting;
        });
      }, { threshold: 0.2 });
      vpObserver.observe(container);
    }

    // Pause autoplay saat user menyentuh/berinteraksi dengan carousel
    track.addEventListener('touchstart', function () { isUserInteracting = true; }, { passive: true });
    track.addEventListener('touchend', function () {
      setTimeout(function () { isUserInteracting = false; }, 3000);
    }, { passive: true });
    track.addEventListener('pointerenter', function () { isUserInteracting = true; });
    track.addEventListener('pointerleave', function () { isUserInteracting = false; });

    setInterval(function () {
      // ATURAN MUTLAK: Jangan slide jika carousel di luar layar atau user sedang aktif berinteraksi
      if (!isCarouselInViewport || isUserInteracting) return;

      autoIdx = (autoIdx + 1) % slides.length;
      scrollToSlide(autoIdx);
    }, 5000);
  }

  // ======================================================================
  //  CATEGORIES
  // ======================================================================
  function renderCategories() {
    var track = $('x-cat-track');
    if (!track) return;
    track.innerHTML = '';

    if (!categories.length) {
      track.innerHTML = '<div class="x-empty">Kategori kosong.</div>';
      return;
    }

    if (!activeCategory && categories[0]) {
      // Pick 'Rekom' category first, fallback to first
      var rekom = categories.find(function (c) {
        return String(c.name).trim().toLowerCase() === 'rekom';
      });
      activeCategory = (rekom || categories[0]).id;
    }

    categories.forEach(function (cat) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'x-cat' + (String(cat.id) === String(activeCategory) ? ' active' : '');
      btn.setAttribute('data-cat-id', String(cat.id));

      var imgHtml = cat.image
        ? '<img src="' + UI.escape(cat.image) + '" alt="' + UI.escape(cat.name) + '" loading="lazy">'
        : '';

      btn.innerHTML =
        '<span class="x-cat-image">' + imgHtml + '</span>' +
        '<span class="x-cat-name">' + UI.escape(cat.name) + '</span>' +
        '<span class="x-cat-line"></span>';

      btn.onclick = function () {
        activeCategory = cat.id;
        track.querySelectorAll('.x-cat').forEach(function (el) { el.classList.remove('active'); });
        btn.classList.add('active');
        var targetLeft = btn.offsetLeft - (track.clientWidth - btn.clientWidth) / 2;
        track.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
        loadProducts(activeCategory);
      };

      track.appendChild(btn);
    });
  }

  // ======================================================================
  //  PRODUCTS
  // ======================================================================
  function loadProducts(categoryId) {
    var container = $('x-products');
    if (!container) return;

    var found = categories.find(function (c) { return String(c.id) === String(categoryId); });
    if (found && Array.isArray(found.products) && found.products.length > 0) {
      products = found.products;
      renderProducts();
      return;
    }

    container.innerHTML = '<div class="x-loading">Memuat menu...</div>';

    API.get('/products?category=' + encodeURIComponent(categoryId))
      .then(function (data) {
        if (data.success && Array.isArray(data.items) && data.items.length > 0) {
          products = data.items;
          if (found) found.products = products;
        } else {
          var backupCat = DEFAULT_CATALOG.categories.find(function (c) { return String(c.id) === String(categoryId); });
          products = (backupCat && backupCat.products) || DEFAULT_CATALOG.categories[0].products;
        }
        renderProducts();
      })
      .catch(function () {
        var backupCat = DEFAULT_CATALOG.categories.find(function (c) { return String(c.id) === String(categoryId); });
        products = (backupCat && backupCat.products) || DEFAULT_CATALOG.categories[0].products;
        renderProducts();
      });
  }

  function renderProducts() {
    var container = $('x-products');
    if (!container) return;
    container.innerHTML = '';

    if (!products.length) {
      container.innerHTML = '<div class="x-empty">Tidak ada menu di kategori ini.</div>';
      return;
    }

    var state = Store.getState();

    products.forEach(function (product) {
      var item = Store.findCartItem(product.id);
      var qty = item ? item.quantity : 0;
      var note = (item && item.note) || state.notes[product.id] || '';

      var price = Number(product.price || 0);
      var regPrice = Number(product.regular_price || price);
      var image = product.image_url || product.image || '';
      var desc = product.description || '';

      var card = document.createElement('article');
      card.className = 'x-product';
      card.setAttribute('data-product-card', String(product.id));

      var oldPriceHtml = regPrice > price
        ? '<div class="x-old-price">' + UI.money(regPrice) + '</div>'
        : '';

      var controls = '';
      if (qty > 0) {
        var noteIcon = note ? ICONS.write : ICONS.file;
        controls =
          '<div class="x-quantity">' +
          '  <button type="button" data-minus="' + product.id + '"><img src="' + ICONS.minus + '" alt="minus"></button>' +
          '  <span class="x-quantity-value">' + qty + '</span>' +
          '  <button type="button" data-plus="' + product.id + '"><img src="' + ICONS.plus + '" alt="plus"></button>' +
          '</div>' +
          '<button type="button" class="x-note-button ' + (note ? 'has-note' : '') + '" data-note="' + product.id + '">' +
          '  <img src="' + noteIcon + '" alt="Catatan" class="x-note-icon">' +
          '  Catatan' +
          '</button>';
      } else {
        controls = '<button type="button" class="x-add" data-add="' + product.id + '">Tambah</button>';
      }

      card.innerHTML =
        '<div class="x-product-info">' +
        '  <div class="x-product-name">' + UI.escape(product.name) + '</div>' +
        '  <div class="x-product-description">' + UI.escape(desc) + '</div>' +
        '  <div class="x-price">' + oldPriceHtml +
        '    <div class="x-current-price">' + UI.money(price) + '</div>' +
        '  </div>' +
        '</div>' +
        '<div class="x-product-right">' +
        (image ? '<img class="x-product-image" src="' + UI.escape(image) + '" alt="' + UI.escape(product.name) + '" loading="lazy">' : '') +
        controls +
        '</div>';

      container.appendChild(card);
    });

    bindProductEvents();
  }

  // Scroll presisi berbasis card: hanya scroll jika bagian bawah card tertutup/terpotong oleh cart bar
  function ensureCardVisible(productId) {
    setTimeout(function () {
      var cardEl = document.querySelector('[data-product-card="' + productId + '"]');
      if (!cardEl) return;

      var dock = $('x-cart-dock');
      var dockTop = window.innerHeight;
      if (dock) {
        var dockRect = dock.getBoundingClientRect();
        if (dockRect.top > 0 && dockRect.top < window.innerHeight) {
          dockTop = dockRect.top;
        } else {
          dockTop = window.innerHeight - 84;
        }
      }

      var cardRect = cardEl.getBoundingClientRect();
      var margin = 16;
      var requiredBottom = cardRect.bottom + margin;

      if (requiredBottom > dockTop) {
        var scrollAmount = requiredBottom - dockTop;
        window.scrollBy({
          top: scrollAmount,
          behavior: 'smooth'
        });
      }
    }, 60);
  }

  function bindProductEvents() {
    document.querySelectorAll('[data-add]').forEach(function (btn) {
      btn.onclick = function () {
        var pid = btn.dataset.add;
        var p = products.find(function (x) { return String(x.id) === String(pid); });
        if (p) {
          Store.addItem(p, 1);
          renderProducts();
          renderCartDock();
          ensureCardVisible(pid);
        }
      };
    });

    document.querySelectorAll('[data-plus]').forEach(function (btn) {
      btn.onclick = function () {
        var pid = btn.dataset.plus;
        var item = Store.findCartItem(pid);
        if (item) {
          Store.setQty(pid, item.quantity + 1);
          renderProducts();
          renderCartDock();
          ensureCardVisible(pid);
        }
      };
    });

    document.querySelectorAll('[data-minus]').forEach(function (btn) {
      btn.onclick = function () {
        var pid = btn.dataset.minus;
        var item = Store.findCartItem(pid);
        if (item) {
          Store.setQty(pid, item.quantity - 1);
          renderProducts();
          renderCartDock();
        }
      };
    });

    document.querySelectorAll('[data-note]').forEach(function (btn) {
      btn.onclick = function () {
        openNoteSheet(btn.dataset.note);
      };
    });
  }

  // ======================================================================
  //  NOTE SHEET
  // ======================================================================
  function openNoteSheet(productId) {
    var product = products.find(function (p) { return String(p.id) === String(productId); });
    if (!product) return;

    var item = Store.findCartItem(productId);
    var currentNote = item ? (item.note || '') : '';

    var overlay = document.createElement('div');
    overlay.className = 'x-note-overlay';
    overlay.innerHTML =
      '<div class="x-note-sheet">' +
      '  <div class="x-note-handle"></div>' +
      '  <div class="x-note-header"><h3>Catatan: ' + UI.escape(product.name) + '</h3></div>' +
      '  <textarea id="x-note-input" placeholder="Contoh: Jangan terlalu pedas, kuah dipisah...">' + UI.escape(currentNote) + '</textarea>' +
      '  <div class="x-note-footer">' +
      '    <span id="x-note-counter">' + currentNote.length + '/150</span>' +
      '    <button type="button" id="x-note-save">Simpan</button>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(overlay);

    var sheet = overlay.querySelector('.x-note-sheet');
    var input = overlay.querySelector('#x-note-input');
    var counter = overlay.querySelector('#x-note-counter');

    function updateViewport() {
      if (!overlay.parentNode || !sheet) return;
      var vv = window.visualViewport;
      if (!vv) {
        sheet.style.setProperty('--x-note-keyboard', '0px');
        sheet.style.setProperty('--x-note-visible-height', '75dvh');
        return;
      }
      var keyboardHeight = Math.max(0, window.innerHeight - (vv.offsetTop + vv.height));
      sheet.style.setProperty('--x-note-keyboard', keyboardHeight + 'px');
      sheet.style.setProperty('--x-note-visible-height', vv.height + 'px');
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateViewport);
      window.visualViewport.addEventListener('scroll', updateViewport);
    }

    // Force layout reflow before slide-up
    void overlay.offsetHeight;

    // Animate in
    requestAnimationFrame(function () {
      overlay.classList.add('open');
      setTimeout(function () {
        if (input) input.focus();
        updateViewport();
      }, 350);
    });

    input.addEventListener('input', function () {
      if (input.value.length > 150) input.value = input.value.slice(0, 150);
      counter.textContent = input.value.length + '/150';
    });

    var isClosing = false;
    function closeNote() {
      if (isClosing) return;
      isClosing = true;
      if (input) input.blur();
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateViewport);
        window.visualViewport.removeEventListener('scroll', updateViewport);
      }
      overlay.classList.remove('open');
      setTimeout(function () {
        if (overlay.parentNode) overlay.remove();
      }, 380);
    }

    if (window.XentraNav && typeof window.XentraNav.pushClose === 'function') {
      window.XentraNav.pushClose(closeNote);
    }

    // Close on backdrop tap
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        if (window.XentraNav && typeof window.XentraNav.close === 'function') {
          window.XentraNav.close();
        } else {
          closeNote();
        }
      }
    });

    // Save
    overlay.querySelector('#x-note-save').onclick = function () {
      Store.setNote(productId, input.value.trim());
      if (window.XentraNav && typeof window.XentraNav.close === 'function') {
        window.XentraNav.close();
      } else {
        closeNote();
      }
      renderProducts();
    };

    overlay.__xentraClose = closeNote;
  }

  // ======================================================================
  //  CART DOCK
  // ======================================================================
  function renderCartDock() {
    var count = Store.getCartCount();
    var total = Store.getCartSubtotal();
    var dock = $('x-cart-dock');
    if (!dock) return;

    if (count <= 0) {
      dock.classList.remove('visible');
      return;
    }

    dock.classList.add('visible');

    var countEl = $('x-cart-count');
    var totalEl = $('x-cart-total');
    var badgeEl = $('x-cart-badge');

    if (countEl) countEl.textContent = count + ' Item';
    if (totalEl) totalEl.textContent = UI.money(total).replace('Rp', '');
    if (badgeEl) {
      badgeEl.textContent = count;
      badgeEl.style.display = count > 0 ? 'flex' : 'none';
    }

    if ($('x-promo-icon-img')) {
      $('x-promo-icon-img').src = ICONS.coupon;
    }

    // Promo bar
    var promoState = Store.getState().promo;
    var promoEl = $('x-promo');
    if (promoEl) {
      if (promoState.enabled && promoState.target > 0) {
        promoEl.style.display = '';
        var fill = $('x-progress-fill');
        var text = $('x-promo-text');
        if (fill) fill.style.width = Math.min(100, total / promoState.target * 100) + '%';
        if (text) {
          text.innerHTML = total < promoState.target
            ? 'Tambah <strong>' + UI.money(promoState.target - total) + '</strong> lagi biar diskon <strong>' + UI.money(promoState.discount) + '</strong>!'
            : '🎉 Selamat, kamu berhasil dapatkan diskon!';
        }
      } else {
        promoEl.style.display = 'none';
      }
    }
  }

  // ======================================================================
  //  CART SHEET (Bottom Sheet with item list)
  // ======================================================================
  function openCartSheet() {
    var backdrop = $('x-backdrop');
    var sheet = $('x-sheet');
    if (backdrop) backdrop.classList.add('open');
    if (sheet) sheet.classList.add('open');
    renderCartSheetItems();
  }

  function closeSheet() {
    var backdrop = $('x-backdrop');
    var sheet = $('x-sheet');
    if (backdrop) backdrop.classList.remove('open');
    if (sheet) sheet.classList.remove('open');
  }

  function renderCartSheetItems() {
    var container = $('x-sheet-items');
    if (!container) return;
    container.innerHTML = '';

    var state = Store.getState();
    var items = state.cart.items || [];

    if (!items.length) {
      container.innerHTML = '<div class="x-empty">Keranjang kosong.</div>';
      return;
    }

    items.forEach(function (item) {
      var note = state.notes[item.id] || item.note || '';
      var lineTotal = Number(item.price || 0) * Number(item.quantity || 0);

      var row = document.createElement('div');
      row.className = 'x-sheet-item';

      var image = item.image_url || item.image || '';
      var noteHtml = note
        ? '<div class="x-sheet-item-note" data-edit-note="' + item.id + '"><img src="' + ICONS.write + '" alt="Edit catatan"><span>: ' + UI.escape(note) + '</span></div>'
        : '';

      row.innerHTML =
        '<div class="x-sheet-item-main">' +
        (image
          ? '<img class="x-sheet-item-image" src="' + UI.escape(image) + '" alt="' + UI.escape(item.name) + '">'
          : '<div class="x-sheet-item-image"></div>') +
        '  <div class="x-sheet-item-body">' +
        '    <div class="x-sheet-item-name">' + UI.escape(item.name) + '</div>' +
        noteHtml +
        '    <div class="x-sheet-item-qty-price">' + item.quantity + ' × ' + UI.money(item.price) + '</div>' +
        '  </div>' +
        '  <button type="button" class="x-sheet-item-delete" data-delete="' + item.id + '" aria-label="Hapus ' + UI.escape(item.name) + '">' +
        '    <img src="' + ICONS.trash + '" alt="Hapus">' +
        '  </button>' +
        '</div>' +
        '<div class="x-sheet-item-footer" data-checkout-single-item="' + item.id + '" role="button" aria-label="Beli ' + UI.escape(item.name) + ' sekarang">' +
        '  <div class="x-sheet-item-footer-left">' +
        '    <img class="x-bike-icon" src="' + ICONS.bike + '" alt="">' +
        '    <span>' + item.quantity + ' item</span>' +
        '  </div>' +
        '  <div class="x-sheet-item-footer-right">' +
        '    <strong>' + UI.money(lineTotal).replace('Rp', '') + '</strong>' +
        '    <img class="x-arrow-icon" src="' + ICONS.right + '" alt=">">' +
        '  </div>' +
        '</div>';

      container.appendChild(row);
    });

    // Render summary
    renderCartSummary();

    // Bind delete buttons
    container.querySelectorAll('[data-delete]').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        Store.removeItem(btn.dataset.delete);
        renderProducts();
        renderCartDock();
        renderCartSheetItems();
        if (Store.getCartCount() <= 0) closeSheet();
      };
    });

    // Bind note edit
    container.querySelectorAll('[data-edit-note]').forEach(function (el) {
      el.onclick = function (e) {
        e.stopPropagation();
        closeSheet();
        setTimeout(function () { openNoteSheet(el.dataset.editNote); }, 400);
      };
    });

    // Bind single-item checkout clicks on the footer (icon motor -> arrow)
    container.querySelectorAll('[data-checkout-single-item]').forEach(function (footerEl) {
      footerEl.onclick = function () {
        var pid = footerEl.dataset.checkoutSingleItem;
        closeSheet();
        if (window.Xentra && window.Xentra.Router) {
          window.Xentra.Router.navigate('checkout', { itemId: pid });
        } else {
          window.location.href = '/checkout/?item=' + encodeURIComponent(pid);
        }
      };
    });
  }

  function renderCartSummary() {
    var summaryEl = $('x-sheet-summary');
    if (!summaryEl) return;

    var subtotal = Store.getCartSubtotal();
    var count = Store.getCartCount();
    var promoState = Store.getState().promo;
    var discount = 0;

    if (promoState.enabled && promoState.target > 0 && promoState.discount > 0 && subtotal >= promoState.target) {
      discount = Math.min(promoState.discount, subtotal);
    }

    var grandTotal = subtotal - discount;

    summaryEl.innerHTML =
      '<div class="x-sheet-summary-card">' +
      '  <div class="x-sheet-summary-row"><span class="label">Subtotal (' + count + ' item)</span><span class="value">' + UI.money(subtotal) + '</span></div>' +
      (discount > 0
        ? '<div class="x-sheet-summary-row discount"><span class="label">Diskon Ongkir</span><span class="value">−' + UI.money(discount) + '</span></div>'
        : '') +
      '  <div class="x-sheet-summary-divider"></div>' +
      '  <div class="x-sheet-summary-total"><span class="label">Total</span><span class="value">' + UI.money(grandTotal) + '</span></div>' +
      '</div>';
  }

  // ======================================================================
  //  INITIALIZATION
  // ======================================================================
  function init() {
    // Clock
    updateClock();
    setInterval(updateClock, 1000);

    // Carousel
    initCarousel();

    function applyCatalog(data) {
      if (!data || !Array.isArray(data.categories) || !data.categories.length) return;
      categories = data.categories;
      
      var rekom = categories.find(function (c) {
        return String(c.name).trim().toLowerCase() === 'rekom';
      });
      var initialCat = rekom || categories[0];
      activeCategory = initialCat.id;
      products = (initialCat.products && initialCat.products.length > 0) ? initialCat.products : [];

      renderCategories();
      
      if (products.length > 0) {
        renderProducts();
      } else {
        loadProducts(activeCategory);
      }
    }

    // 1. Render catalog immediately on page boot (Zero white screen / Zero loading delay)
    try {
      var rawCached = localStorage.getItem('xentra_catalog_cache');
      if (rawCached) {
        var parsed = JSON.parse(rawCached);
        applyCatalog(parsed);
      } else {
        applyCatalog(DEFAULT_CATALOG);
      }
    } catch (_) {
      applyCatalog(DEFAULT_CATALOG);
    }

    // 2. Fetch fresh catalog from API in background
    API.get('/catalog/menu')
      .then(function (data) {
        if (data && data.success && data.categories && data.categories.length > 0) {
          try { localStorage.setItem('xentra_catalog_cache', JSON.stringify(data)); } catch (_) {}
          applyCatalog(data);
        } else if (!categories.length) {
          applyCatalog(DEFAULT_CATALOG);
        }
      })
      .catch(function (err) {
        console.warn('[Home] Load catalog network warn:', err);
        if (!categories.length) {
          applyCatalog(DEFAULT_CATALOG);
        }
      });

    // Render initial cart state
    renderCartDock();

    // Cart button → open sheet
    var cartBtn = $('x-cart-button');
    if (cartBtn) cartBtn.onclick = openCartSheet;

    // Backdrop → close sheet
    var backdrop = $('x-backdrop');
    if (backdrop) backdrop.onclick = closeSheet;

    // Checkout button in sheet
    var sheetCheckout = $('x-sheet-checkout');
    if (sheetCheckout) {
      sheetCheckout.onclick = function () {
        closeSheet();
        if (window.Xentra && window.Xentra.Router) {
          window.Xentra.Router.navigate('checkout');
        } else {
          window.location.href = '/checkout/';
        }
      };
    }

    // Subscribe to store changes (2-Way Realtime Reactive Sync)
    Store.subscribe(function () {
      renderProducts();
      renderCartDock();
      if ($('x-sheet') && $('x-sheet').classList.contains('open')) {
        renderCartSheetItems();
      }
    });
  }

  // Run when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for external use
  window.XentraHome = {
    selectCategory: function (catId) {
      activeCategory = Number(catId);
      renderCategories();
      loadProducts(activeCategory);
    },
    refresh: function () {
      renderProducts();
      renderCartDock();
      if ($('x-sheet') && $('x-sheet').classList.contains('open')) {
        renderCartSheetItems();
      }
    }
  };
})();
