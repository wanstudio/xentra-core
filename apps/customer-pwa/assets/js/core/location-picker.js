/**
 * Xentra Customer Location Picker & Favorite Address UX Component
 *
 * Implements authoritative flows matching UI references:
 * - Pilih Lokasi sheet (Cari alamat, Lokasimu saat ini, Pilih lewat peta, Alamat favorit)
 * - Empty & List Favorite Address states with Ubah / Hapus popover
 * - Flow A: Live Search (Nominatim via /api/v1/location/search)
 * - Flow B: Current GPS Geolocation + Reverse Geocoding
 * - Flow C: Map Picker with Fixed Center Pin & Dynamic Move Reverse Geocoding
 * - Flow D: Detail Alamat Form (Wajib Label, Optional Patokan, "Simpan sebagai favorit" checkbox)
 * - Ubah & Hapus Favorite Address management
 * - Strict LIFO Navigation Stack compliance via window.XentraNav
 * - Active Destination vs Favorite Address clean separation
 */
(function () {
  'use strict';

  if (window.XentraLocationPicker) return;

  var API = window.Xentra && window.Xentra.API;
  var Store = window.Xentra && window.Xentra.Store;
  var UI = window.Xentra && window.Xentra.UI;
  var XNav = window.XentraNav;

  var DEFAULT_LAT = -5.3971; // Bandar Lampung / Pringsewu default area
  var DEFAULT_LNG = 105.2668;
  var MAPBOX_TOKEN = (window.XentraConfig && window.XentraConfig.mapboxToken) ||
    'pk.eyJ1IjoiaWtod2FucyIsImEiOiJjbXQ5c2cwMzYwOW15MnpxdXdpeWU3am45In0.YcX49DH0uXP70aBxVDC-TA';

  // Dynamic Mapbox GL JS & CSS Loader
  function loadMapboxGL() {
    return new Promise(function (resolve, reject) {
      if (window.mapboxgl && typeof window.mapboxgl.Map === 'function') {
        resolve();
        return;
      }
      var css = document.getElementById('xentra-mapbox-css');
      if (!css) {
        css = document.createElement('link');
        css.id = 'xentra-mapbox-css';
        css.rel = 'stylesheet';
        css.href = 'https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.css';
        document.head.appendChild(css);
      }
      var script = document.getElementById('xentra-mapbox-js');
      if (script) {
        if (script.dataset.loaded === '1' || (window.mapboxgl && typeof window.mapboxgl.Map === 'function')) {
          resolve();
          return;
        }
        script.addEventListener('load', function () { resolve(); });
        script.addEventListener('error', function () { reject(new Error('Mapbox JS gagal dimuat')); });
        return;
      }
      script = document.createElement('script');
      script.id = 'xentra-mapbox-js';
      script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.js';
      script.onload = function () {
        script.dataset.loaded = '1';
        resolve();
      };
      script.onerror = function () {
        reject(new Error('Library Mapbox GL tidak dapat dimuat'));
      };
      document.head.appendChild(script);
    });
  }

  // Active overlay tracker for LIFO cleanup
  var activeOverlays = [];

  function createOverlay(contentHtml, customClass) {
    var overlay = document.createElement('div');
    overlay.className = 'x-loc-overlay ' + (customClass || '');
    overlay.innerHTML = '<div class="x-loc-sheet"><div class="x-loc-sheet-handle"></div>' + contentHtml + '</div>';
    document.body.appendChild(overlay);

    void overlay.offsetHeight; // force reflow

    window.requestAnimationFrame(function () {
      overlay.classList.add('open');
    });

    var isClosed = false;
    function close() {
      if (isClosed) return;
      isClosed = true;
      overlay.classList.remove('open');
      setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        var idx = activeOverlays.indexOf(close);
        if (idx !== -1) activeOverlays.splice(idx, 1);
      }, 380);
    }

    activeOverlays.push(close);
    if (XNav && typeof XNav.pushClose === 'function') {
      XNav.pushClose(close);
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        if (XNav && typeof XNav.close === 'function') {
          XNav.close();
        } else {
          close();
        }
      }
    });

    return { overlay: overlay, close: close };
  }

  function closeAllOverlays() {
    while (activeOverlays.length > 0) {
      var c = activeOverlays.pop();
      try { c(); } catch (_) {}
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  1. MAIN "PILIH LOKASI" SHEET (HOME ENTRY)
  // ══════════════════════════════════════════════════════════════
  function openMainLocationSheet(options) {
    options = options || {};
    var onDestinationSelected = options.onSelect || null;

    var sheetHtml =
      '<h3 class="x-loc-sheet-title">Alamat favorit</h3>' +
      '<div class="x-loc-fav-section">' +
        '<div id="x-loc-fav-container"><div style="padding:16px;text-align:center;font-size:12px;color:#94a3b8;">Memuat alamat favorit…</div></div>' +
        '<button type="button" class="x-loc-btn-add-fav" id="x-btn-add-fav">' +
          '<span class="x-loc-btn-add-fav-icon">' +
            '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#00A637"/><path d="M12 7v10M7 12h10" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/></svg>' +
          '</span>' +
          'Tambah alamat' +
        '</button>' +
      '</div>';

    var sh = createOverlay(sheetHtml);
    var el = sh.overlay;

    // Load Favorite Addresses from /api/v1/addresses
    loadFavoriteAddresses(el, function (selectedFav) {
      if (!selectedFav) return;
      // Selecting a favorite sets it as Active Destination
      applyActiveDestination({
        latitude: selectedFav.latitude,
        longitude: selectedFav.longitude,
        address: selectedFav.address,
        label: selectedFav.label,
        detail: selectedFav.detail,
        source: 'favorite',
        is_explicit: true,
        favorite_id: selectedFav.id
      });
      sh.close();
      if (typeof onDestinationSelected === 'function') onDestinationSelected();
    });

    // Action: + Tambah Alamat
    var btnAddFav = el.querySelector('#x-btn-add-fav');
    if (btnAddFav) {
      btnAddFav.onclick = function () {
        // Starts Flow D: Map selection → Detail alamat with checkbox pre-checked
        openMapPickerFlow({
          isAddingFavorite: true,
          onSelect: onDestinationSelected
        });
      };
    }
  }

  // ══════════════════════════════════════════════════════════════
  var GUEST_FAV_KEY = 'xentra_v2_guest_favorites';

  function getGuestFavorites() {
    try {
      var raw = localStorage.getItem(GUEST_FAV_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  function saveGuestFavorites(list) {
    try {
      localStorage.setItem(GUEST_FAV_KEY, JSON.stringify(list || []));
    } catch (_) {}
  }

  //  FAVORITE ADDRESSES DATA & RENDERING
  // ══════════════════════════════════════════════════════════════
  function loadFavoriteAddresses(containerEl, onSelectFav) {
    var favContainer = containerEl.querySelector('#x-loc-fav-container');
    if (!favContainer) return;

    var session = Store && Store.getState().customerSession;
    if (!session || !session.token) {
      // Unauthenticated customer: load saved local favorites if available, else show clean Empty State
      var localFavs = getGuestFavorites();
      if (Array.isArray(localFavs) && localFavs.length > 0) {
        renderFavoriteList(favContainer, localFavs, onSelectFav, containerEl);
      } else {
        renderEmptyFavoriteState(favContainer);
      }
      return;
    }

    if (!API) {
      var localFavsFallback = getGuestFavorites();
      if (Array.isArray(localFavsFallback) && localFavsFallback.length > 0) {
        renderFavoriteList(favContainer, localFavsFallback, onSelectFav, containerEl);
      } else {
        renderEmptyFavoriteState(favContainer);
      }
      return;
    }

    API.get('/addresses')
      .then(function (res) {
        if (res && res.success && Array.isArray(res.addresses) && res.addresses.length > 0) {
          renderFavoriteList(favContainer, res.addresses, onSelectFav, containerEl);
        } else {
          var localFavsFallback = getGuestFavorites();
          if (Array.isArray(localFavsFallback) && localFavsFallback.length > 0) {
            renderFavoriteList(favContainer, localFavsFallback, onSelectFav, containerEl);
          } else {
            renderEmptyFavoriteState(favContainer);
          }
        }
      })
      .catch(function () {
        var localFavsFallback = getGuestFavorites();
        if (Array.isArray(localFavsFallback) && localFavsFallback.length > 0) {
          renderFavoriteList(favContainer, localFavsFallback, onSelectFav, containerEl);
        } else {
          renderEmptyFavoriteState(favContainer);
        }
      });
  }

  function renderEmptyFavoriteState(container) {
    container.innerHTML =
      '<div class="x-loc-fav-empty-card">' +
      '  <div class="x-loc-fav-empty-icon">' +
      '    <img src="/assets/icons/thumb.png" alt="" onerror="this.onerror=null;this.src=\'/assets/icons/address-favorite-empty.png\';">' +
      '  </div>' +
      '  <div class="x-loc-fav-empty-copy">' +
      '    <div class="x-loc-fav-empty-title">Punya alamat yang sering dipakai?</div>' +
      '    <div class="x-loc-fav-empty-desc">Disimpan, yuk! Biar gak ribet ngetik manual tiap kali kamu order di Bangjo.</div>' +
      '  </div>' +
      '</div>';
  }

  function renderFavoriteList(container, addresses, onSelectFav, rootEl) {
    var html = '<div class="x-loc-fav-list">';
    addresses.forEach(function (addr) {
      html +=
        '<div class="x-loc-fav-card" data-fav-id="' + UI.escape(addr.id) + '">' +
        '  <div class="x-loc-fav-card-top">' +
        '    <div class="x-loc-fav-card-label">' + UI.escape(addr.label || 'Rumah') + '</div>' +
        '    <button type="button" class="x-loc-fav-card-more" data-action="more" aria-label="Menu" data-id="' + UI.escape(addr.id) + '">' +
        '      <img src="/assets/icons/option.svg" alt="" class="x-loc-fav-more-icon">' +
        '    </button>' +
        '  </div>' +
        '  <div class="x-loc-fav-card-addr">' + UI.escape(addr.address) + '</div>' +
        (addr.detail ? '<div class="x-loc-fav-card-patokan">' + UI.escape(addr.detail) + '</div>' : '') +
        '</div>';
    });
    html += '</div>';
    container.innerHTML = html;

    // Card click → set active destination
    container.querySelectorAll('.x-loc-fav-card').forEach(function (card) {
      card.onclick = function (e) {
        if (e.target.closest('.x-loc-fav-card-more') || e.target.closest('.x-loc-popover-menu')) return;
        var addrId = card.getAttribute('data-fav-id');
        var found = addresses.find(function (a) { return String(a.id) === String(addrId); });
        if (found && typeof onSelectFav === 'function') {
          onSelectFav(found);
        }
      };
    });

    // 3-dots "•••" click → Ubah / Hapus popover menu
    container.querySelectorAll('.x-loc-fav-card-more').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        var addrId = btn.getAttribute('data-id');
        var found = addresses.find(function (a) { return String(a.id) === String(addrId); });
        if (!found) return;

        showFavoriteActionsMenu(btn, found, function () {
          // Refresh list on change/delete
          loadFavoriteAddresses(rootEl, onSelectFav);
        });
      };
    });
  }

  function showFavoriteActionsMenu(buttonEl, addressItem, onUpdated) {
    // Remove existing popovers
    document.querySelectorAll('.x-loc-popover-menu').forEach(function (p) { p.remove(); });

    var popover = document.createElement('div');
    popover.className = 'x-loc-popover-menu';
    popover.innerHTML =
      '<button type="button" class="x-loc-popover-item" id="x-pop-edit">' +
      '  <svg class="x-loc-popover-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>' +
      '  <span>Ubah</span>' +
      '</button>' +
      '<button type="button" class="x-loc-popover-item is-danger" id="x-pop-delete">' +
      '  <svg class="x-loc-popover-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>' +
      '  <span>Hapus</span>' +
      '</button>';

    var card = buttonEl.closest('.x-loc-fav-card');
    if (card) card.appendChild(popover);

    function dismiss(e) {
      if (!popover.contains(e.target) && e.target !== buttonEl) {
        popover.remove();
        document.removeEventListener('click', dismiss);
      }
    }
    setTimeout(function () { document.addEventListener('click', dismiss); }, 50);

    // Ubah Action
    popover.querySelector('#x-pop-edit').onclick = function (e) {
      e.stopPropagation();
      popover.remove();
      openAddressDetailSheet({
        address: addressItem.address,
        latitude: addressItem.latitude,
        longitude: addressItem.longitude,
        label: addressItem.label,
        detail: addressItem.detail,
        isFavorite: true,
        existingId: addressItem.id,
        onSaved: onUpdated
      });
    };

    // Hapus Action (Requires Confirmation Dialog)
    popover.querySelector('#x-pop-delete').onclick = function (e) {
      e.stopPropagation();
      popover.remove();
      showDeleteConfirmationDialog(addressItem, onUpdated);
    };
  }

  function showDeleteConfirmationDialog(addressItem, onDeleted) {
    var dialogHtml =
      '<div class="x-loc-confirm-modal">' +
      '  <div class="x-loc-confirm-illustration">' +
      '    <img src="/assets/icons/delete_konfirmasi_address.png" alt="Hapus Alamat">' +
      '  </div>' +
      '  <div class="x-loc-confirm-title">Hapus Alamat Favorit?</div>' +
      '  <div class="x-loc-confirm-desc">Alamat <b>' + UI.escape(addressItem.label) + '</b> akan dihapus dari daftar alamat favoritmu.</div>' +
      '  <div class="x-loc-confirm-actions">' +
      '    <button type="button" class="x-loc-confirm-btn-cancel" id="x-del-cancel">Batal</button>' +
      '    <button type="button" class="x-loc-confirm-btn-delete" id="x-del-confirm">Ya, Hapus</button>' +
      '  </div>' +
      '</div>';

    var modalOverlay = document.createElement('div');
    modalOverlay.className = 'x-loc-overlay open';
    modalOverlay.style.alignItems = 'center';
    modalOverlay.style.justifyContent = 'center';
    modalOverlay.innerHTML = dialogHtml;
    document.body.appendChild(modalOverlay);

    function closeModal() {
      if (modalOverlay.parentNode) modalOverlay.parentNode.removeChild(modalOverlay);
    }

    modalOverlay.querySelector('#x-del-cancel').onclick = closeModal;

    var delBtn = modalOverlay.querySelector('#x-del-confirm');
    delBtn.onclick = function () {
      delBtn.disabled = true;
      delBtn.textContent = 'Menghapus…';

      // Check if address is a guest local favorite
      var session = Store && Store.getState().customerSession;
      if (!session || !session.token || String(addressItem.id).indexOf('guest_') === 0) {
        var currentGuestFavs = getGuestFavorites();
        var filtered = currentGuestFavs.filter(function (f) { return String(f.id) !== String(addressItem.id); });
        saveGuestFavorites(filtered);
        closeModal();
        if (UI && UI.toast) UI.toast('Alamat favorit berhasil dihapus');
        if (typeof onDeleted === 'function') onDeleted();
        return;
      }

      API.delete('/addresses/' + addressItem.id)
        .then(function (res) {
          closeModal();
          if (res && res.success) {
            if (UI && UI.toast) UI.toast('Alamat favorit berhasil dihapus');
            if (typeof onDeleted === 'function') onDeleted();
          } else {
            if (UI && UI.toast) UI.toast((res && res.error) || 'Gagal menghapus alamat');
          }
        })
        .catch(function (err) {
          closeModal();
          if (UI && UI.toast) UI.toast((err && err.message) || 'Terjadi kesalahan saat menghapus alamat');
        });
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  FLOW A: SEARCH ADDRESS
  // ══════════════════════════════════════════════════════════════
  function openSearchFlow(options) {
    options = options || {};
    var searchHtml =
      '<h3 class="x-loc-sheet-title">Cari alamat</h3>' +
      '<div class="x-loc-search-box">' +
      '  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="8.75" cy="8.75" r="5.75"/><path d="m13.23 13.23 3.54 3.54"/></svg>' +
      '  <input type="text" id="x-loc-search-input" class="x-loc-search-input" placeholder="Tulis alamat atau nama tempat…" autofocus>' +
      '</div>' +
      '<div class="x-loc-search-results" id="x-loc-search-results">' +
      '  <div style="padding:24px 16px;text-align:center;font-size:12.5px;color:#94a3b8;">Ketik minimal 3 huruf untuk mencari alamat…</div>' +
      '</div>';

    var sh = createOverlay(searchHtml);
    var input = sh.overlay.querySelector('#x-loc-search-input');
    var resultsBox = sh.overlay.querySelector('#x-loc-search-results');

    setTimeout(function () { if (input) input.focus(); }, 300);

    var searchTimer = null;
    var searchSeq = 0;
    input.addEventListener('input', function () {
      var q = input.value.trim();
      clearTimeout(searchTimer);
      var currentSeq = ++searchSeq;
      if (q.length < 3) {
        resultsBox.innerHTML = '<div style="padding:24px 16px;text-align:center;font-size:12.5px;color:#94a3b8;">Ketik minimal 3 huruf untuk mencari alamat…</div>';
        return;
      }

      resultsBox.innerHTML = '<div style="padding:20px;text-align:center;font-size:13px;color:#64748b;"><span class="x-loc-spinner"></span> Mencari alamat…</div>';

      searchTimer = setTimeout(function () {
        API.get('/location/search?q=' + encodeURIComponent(q))
          .then(function (res) {
            if (currentSeq !== searchSeq) return; // Stale async reply superseded
            var list = (res && res.results) || [];
            if (!list.length) {
              resultsBox.innerHTML = '<div style="padding:24px 16px;text-align:center;font-size:12.5px;color:#94a3b8;">Tidak ada hasil ditemukan untuk "' + UI.escape(q) + '"</div>';
              return;
            }

            var html = '';
            list.forEach(function (it, idx) {
              var name = it.display_name ? it.display_name.split(',')[0] : (it.address || 'Alamat');
              var desc = it.display_name || it.address || '';
              html +=
                '<button type="button" class="x-loc-search-item" data-idx="' + idx + '">' +
                '  <div class="x-loc-search-item-icon">' +
                '    <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="6.5" stroke="#FA3E3E" stroke-width="5"/></svg>' +
                '  </div>' +
                '  <div class="x-loc-search-item-info">' +
                '    <div class="x-loc-search-item-name">' + UI.escape(name) + '</div>' +
                '    <div class="x-loc-search-item-desc">' + UI.escape(desc) + '</div>' +
                '  </div>' +
                '</button>';
            });
            resultsBox.innerHTML = html;

            resultsBox.querySelectorAll('.x-loc-search-item').forEach(function (btn) {
              btn.onclick = function () {
                var selected = list[Number(btn.getAttribute('data-idx'))];
                if (!selected) return;
                sh.close();

                // Open Address Detail / Confirmation
                openAddressDetailSheet({
                  address: selected.display_name || selected.address,
                  latitude: Number(selected.latitude || selected.lat),
                  longitude: Number(selected.longitude || selected.lon),
                  label: (selected.display_name ? selected.display_name.split(',')[0] : 'Lokasi Terpilih').slice(0, 30),
                  detail: '',
                  source: 'search',
                  onSelect: options.onSelect
                });
              };
            });
          })
          .catch(function () {
            if (currentSeq !== searchSeq) return;
            resultsBox.innerHTML = '<div style="padding:24px 16px;text-align:center;font-size:12.5px;color:#ef4444;">Gagal memuat alamat. Periksa koneksi internet Anda.</div>';
          });
      }, 350);
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  FLOW B: GPS LOCATION
  // ══════════════════════════════════════════════════════════════
  function triggerGpsFlow(parentEl, options) {
    options = options || {};
    var gpsDesc = parentEl.querySelector('#x-act-gps-desc');
    if (gpsDesc) gpsDesc.textContent = 'Mengakses sensor GPS…';

    if (!navigator.geolocation) {
      if (UI && UI.toast) UI.toast('Fitur GPS tidak didukung di browser ini.');
      if (gpsDesc) gpsDesc.textContent = 'GPS tidak didukung';
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        if (gpsDesc) gpsDesc.textContent = 'Mendapatkan nama jalan…';
        var lat = pos.coords.latitude;
        var lng = pos.coords.longitude;

        API.get('/delivery/reverse-geocode?lat=' + lat + '&lng=' + lng)
          .then(function (res) {
            if (gpsDesc) gpsDesc.textContent = 'Deteksi otomatis via GPS perangkat';
            var addrText = (res && res.address && (res.address.formatted_address || res.address.display_name)) ||
              (res && res.address_text) || 'Lokasi Saya Saat Ini';

            // Open Detail / Confirmation (GPS MUST NOT auto-create favorite)
            openAddressDetailSheet({
              address: addrText,
              latitude: lat,
              longitude: lng,
              label: 'Lokasi Sekarang',
              detail: '',
              source: 'gps',
              isFavorite: false,
              onSelect: options.onSelect
            });
          })
          .catch(function () {
            if (gpsDesc) gpsDesc.textContent = 'Deteksi otomatis via GPS perangkat';
            openAddressDetailSheet({
              address: 'Koordinat: ' + lat.toFixed(5) + ', ' + lng.toFixed(5),
              latitude: lat,
              longitude: lng,
              label: 'Lokasi Sekarang',
              detail: '',
              source: 'gps',
              isFavorite: false,
              onSelect: options.onSelect
            });
          });
      },
      function (err) {
        if (gpsDesc) gpsDesc.textContent = 'Akses lokasi ditolak';
        var msg = 'Gagal mengakses GPS: ';
        if (err.code === 1) msg += 'Izin lokasi tidak diberikan.';
        else if (err.code === 2) msg += 'Posisi tidak ditemukan.';
        else msg += 'Waktu permintaan habis.';
        if (UI && UI.toast) UI.toast(msg);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }

  // ══════════════════════════════════════════════════════════════
  //  FLOW C: MAP PICKER WITH FIXED CENTER PIN
  // ══════════════════════════════════════════════════════════════
  function openMapPickerFlow(options) {
    options = options || {};
    var isAddingFav = options.isAddingFavorite === true;

    // Get starting coordinates from active destination or default
    var initialCoords = { lat: DEFAULT_LAT, lng: DEFAULT_LNG };
    try {
      var dest = Store && Store.getActiveDestination && Store.getActiveDestination();
      if (dest && dest.latitude != null && dest.longitude != null) {
        initialCoords.lat = Number(dest.latitude);
        initialCoords.lng = Number(dest.longitude);
      }
    } catch (_) {}

    var mapOverlay = document.createElement('div');
    mapOverlay.className = 'x-map-picker-view';
    mapOverlay.innerHTML =
      // Floating Header (Search Bar + Dropdown autocomplete - Reference Image 1 & 2)
      '<div class="x-map-top-bar">' +
      '  <div class="x-map-search-wrapper">' +
      '    <div class="x-map-search-input-box">' +
      '      <div class="x-map-search-icon-left">' +
      '        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="6.5" stroke="#FA3E3E" stroke-width="6"/></svg>' +
      '      </div>' +
      '      <input type="text" id="x-map-search-input" class="x-map-search-input-field" placeholder="Cari alamat" autocomplete="off">' +
      '      <button type="button" id="x-map-search-clear" class="x-map-search-clear-btn" aria-label="Hapus teks">' +
      '        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '      </button>' +
      '      <div class="x-map-search-icon-right">' +
      '        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="8.75" cy="8.75" r="5.75"/><path d="m13.23 13.23 3.54 3.54"/></svg>' +
      '      </div>' +
      '    </div>' +
      '    <div class="x-map-search-dropdown" id="x-map-search-dropdown"></div>' +
      '  </div>' +
      '</div>' +

      // Floating Zoom Controls (+ / -) in Top Right (Reference Image 1)
      '<div class="x-map-zoom-controls">' +
      '  <button type="button" class="x-map-zoom-btn" id="x-map-zoom-in" aria-label="Perbesar">+</button>' +
      '  <button type="button" class="x-map-zoom-btn" id="x-map-zoom-out" aria-label="Perkecil">−</button>' +
      '</div>' +

      // Map Viewport with Center Pin & Place Badge (Reference Image 1)
      '<div class="x-map-viewport" id="x-map-viewport">' +
      '  <div class="x-map-tiles-canvas" id="x-map-canvas"></div>' +
      '  <div class="x-map-center-pin-wrap">' +
      '    <div class="x-map-pin-icon-body"><div class="x-map-pin-dot"></div></div>' +
      '    <div class="x-map-pin-badge" id="x-map-pin-badge">Memuat…</div>' +
      '    <div class="x-map-pin-pulse"></div>' +
      '  </div>' +
      '</div>' +

      // Floating Back button on bottom left above card (Reference Image 1)
      '<button type="button" class="x-map-fab-back" id="x-map-back" aria-label="Kembali">' +
      '  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round"><path d="M12 4l-6 6 6 6"/></svg>' +
      '</button>' +

      // Floating GPS re-center button on bottom right above card (Reference Image 1)
      '<button type="button" class="x-map-fab-gps" id="x-map-gps-fab" aria-label="Lokasi Saya">' +
      '  <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="#111" stroke-width="2"><circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3" fill="#111"/><path d="M10 1v3M10 16v3M1 10h3M16 10h3"/></svg>' +
      '</button>' +

      // Bottom Confirmation Card (Reference Image 1 & 2)
      '<div class="x-map-bottom-card">' +
      '  <div class="x-loc-sheet-handle" style="margin-bottom:10px;"></div>' +
      '  <div class="x-map-bottom-head">' +
      '    <div class="x-map-bottom-title">Pilih lokasi</div>' +
      '    <button type="button" class="x-btn-ubah-lime" id="x-btn-ubah-map">Ubah</button>' +
      '  </div>' +
      '  <div class="x-loc-selected-row">' +
      '    <div class="x-loc-red-dot">' +
      '      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="6.5" stroke="#FA3E3E" stroke-width="7"/></svg>' +
      '    </div>' +
      '    <div class="x-loc-selected-info">' +
      '      <div class="x-loc-selected-title" id="x-map-loc-title">Memuat lokasi…</div>' +
      '      <div class="x-loc-selected-addr" id="x-map-loc-addr">Mengambil nama jalan titik terpilih…</div>' +
      '    </div>' +
      '  </div>' +
      '  <button type="button" class="x-btn-konfirmasi-main is-enabled" id="x-btn-map-konfirmasi">Konfirmasi</button>' +
      '</div>';

    document.body.appendChild(mapOverlay);
    void mapOverlay.offsetHeight;
    mapOverlay.classList.add('open');

    var currentPinCoords = { lat: initialCoords.lat, lng: initialCoords.lng };
    var currentResolvedAddress = { title: 'Lokasi Terpilih', address: '' };

    function closeMap() {
      mapOverlay.classList.remove('open');
      setTimeout(function () { if (mapOverlay.parentNode) mapOverlay.parentNode.removeChild(mapOverlay); }, 300);
    }

    if (XNav && typeof XNav.pushClose === 'function') {
      XNav.pushClose(closeMap);
    }

    mapOverlay.querySelector('#x-map-back').onclick = function () {
      if (XNav && typeof XNav.close === 'function') XNav.close();
      else closeMap();
    };

    // Helper to authoritatively set selected location (POI or search result)
    function setSelectedLocation(title, address, coords) {
      if (!title) return;
      currentResolvedAddress = {
        title: title,
        address: address || title
      };
      if (coords && coords.lat && coords.lng) {
        currentPinCoords = { lat: Number(coords.lat), lng: Number(coords.lng) };
      }

      var titleEl = mapOverlay.querySelector('#x-map-loc-title');
      var addrEl = mapOverlay.querySelector('#x-map-loc-addr');
      var badgeEl = mapOverlay.querySelector('#x-map-pin-badge');

      if (titleEl) titleEl.textContent = currentResolvedAddress.title;
      if (addrEl) addrEl.textContent = currentResolvedAddress.address;
      if (badgeEl) badgeEl.textContent = currentResolvedAddress.title;
    }

    // Initialize Interactive Canvas Map View (Pan & Pinch via OSM tiles)
    var mapController = initInteractiveMapCanvas(
      mapOverlay.querySelector('#x-map-viewport'),
      mapOverlay.querySelector('#x-map-canvas'),
      initialCoords,
      function onCenterMoved(newCoords, wasProgrammatic) {
        currentPinCoords = newCoords;
        // If movement was caused by clicking a POI or selecting a search result,
        // do not trigger reverse geocoding as the user has already explicitly picked this location!
        if (wasProgrammatic) return;

        updateLocationDetailsFromCoords(newCoords, mapOverlay, function (resolved) {
          currentResolvedAddress = resolved;
        });
      },
      function onPoiSelected(poi) {
        if (!poi) return;
        var pTitle = poi.name;
        var pAddr = poi.address || poi.full_address || poi.place_formatted || poi.name;
        setSelectedLocation(pTitle, pAddr, { lat: poi.lat, lng: poi.lng });
      }
    );

    // Initial reverse geocode
    updateLocationDetailsFromCoords(initialCoords, mapOverlay, function (resolved) {
      currentResolvedAddress = resolved;
    });

    // Zoom Buttons
    var zoomInBtn = mapOverlay.querySelector('#x-map-zoom-in');
    var zoomOutBtn = mapOverlay.querySelector('#x-map-zoom-out');
    if (zoomInBtn && mapController) {
      zoomInBtn.onclick = function (e) {
        e.stopPropagation();
        mapController.zoomIn();
      };
    }
    if (zoomOutBtn && mapController) {
      zoomOutBtn.onclick = function (e) {
        e.stopPropagation();
        mapController.zoomOut();
      };
    }

    // ── Floating Live Autocomplete Search (Reference Image 2) ──
    var searchInput = mapOverlay.querySelector('#x-map-search-input');
    var searchClear = mapOverlay.querySelector('#x-map-search-clear');
    var searchDropdown = mapOverlay.querySelector('#x-map-search-dropdown');
    var mapSearchTimer = null;
    var mapSearchSeq = 0;

    function hideDropdown() {
      if (searchDropdown) {
        searchDropdown.classList.remove('is-open');
        searchDropdown.innerHTML = '';
      }
    }

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        var query = searchInput.value.trim();
        if (searchClear) {
          if (query.length > 0) searchClear.classList.add('is-visible');
          else searchClear.classList.remove('is-visible');
        }

        clearTimeout(mapSearchTimer);
        var currentSeq = ++mapSearchSeq;

        if (query.length < 3) {
          hideDropdown();
          return;
        }

        searchDropdown.innerHTML = '<div style="padding:14px 16px;font-size:12.5px;color:#64748b;text-align:center;"><span class="x-loc-spinner"></span> Mencari tempat terdekat…</div>';
        searchDropdown.classList.add('is-open');

        mapSearchTimer = setTimeout(function () {
          var pLng = currentPinCoords.lng;
          var pLat = currentPinCoords.lat;

          // Prefer client-side Mapbox Search Box API (from xentra-mvp) for instant sub-second local results
          if (MAPBOX_TOKEN) {
            var sessionToken = 'sess_' + Math.random().toString(36).slice(2, 10);
            var mboxUrl = 'https://api.mapbox.com/search/searchbox/v1/suggest?q=' + encodeURIComponent(query) +
              '&proximity=' + encodeURIComponent(pLng) + ',' + encodeURIComponent(pLat) +
              '&country=id&limit=8&access_token=' + MAPBOX_TOKEN +
              '&session_token=' + sessionToken;

            fetch(mboxUrl)
              .then(function (res) { return res.json(); })
              .then(function (data) {
                if (currentSeq !== mapSearchSeq) return;
                var suggestions = (data && Array.isArray(data.suggestions)) ? data.suggestions : [];
                if (!suggestions.length) {
                  searchDropdown.innerHTML = '<div style="padding:16px;font-size:12.5px;color:#94a3b8;text-align:center;">Tidak ada hasil ditemukan</div>';
                  return;
                }

                var html = '';
                suggestions.forEach(function (s, idx) {
                  var sTitle = s.name || s.address || 'Lokasi';
                  var sAddr = s.full_address || s.place_formatted || s.address || '';
                  html +=
                    '<button type="button" class="x-map-search-dropdown-item" data-idx="' + idx + '">' +
                    '  <div class="x-map-search-dropdown-icon">' +
                    '    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FA3E3E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
                    '  </div>' +
                    '  <div class="x-map-search-dropdown-info">' +
                    '    <div class="x-map-search-dropdown-title">' + UI.escape(sTitle) + '</div>' +
                    '    <div class="x-map-search-dropdown-addr">' + UI.escape(sAddr) + '</div>' +
                    '  </div>' +
                    '</button>';
                });
                searchDropdown.innerHTML = html;

                searchDropdown.querySelectorAll('.x-map-search-dropdown-item').forEach(function (btn) {
                  btn.onclick = function (e) {
                    e.stopPropagation();
                    var item = suggestions[Number(btn.getAttribute('data-idx'))];
                    if (!item) return;

                    var retrUrl = 'https://api.mapbox.com/search/searchbox/v1/retrieve/' +
                      encodeURIComponent(item.mapbox_id) + '?access_token=' + MAPBOX_TOKEN +
                      '&session_token=' + sessionToken;

                    fetch(retrUrl)
                      .then(function (r) { return r.json(); })
                      .then(function (rData) {
                        var feat = rData && rData.features && rData.features[0];
                        if (feat && feat.geometry && Array.isArray(feat.geometry.coordinates)) {
                          var newLng = feat.geometry.coordinates[0];
                          var newLat = feat.geometry.coordinates[1];
                          var sTitle = item.name || (feat.properties && feat.properties.name) || 'Lokasi';
                          var sAddr = (feat.properties && (feat.properties.full_address || feat.properties.place_formatted)) || item.full_address || sTitle;

                          currentPinCoords = { lat: newLat, lng: newLng };
                          setSelectedLocation(sTitle, sAddr, currentPinCoords);
                          if (mapController && typeof mapController.panTo === 'function') {
                            mapController.panTo(currentPinCoords);
                          }
                        }
                      })
                      .catch(function () {});

                    searchInput.value = item.name || '';
                    hideDropdown();
                  };
                });
              })
              .catch(function () {
                fallbackSearchApi(query, currentPinCoords);
              });
            return;
          }

          fallbackSearchApi(query, currentPinCoords);
        }, 300);

        function fallbackSearchApi(q, coords) {
          var searchUrl = '/location/search?q=' + encodeURIComponent(q) +
            '&lat=' + encodeURIComponent(coords.lat) +
            '&lng=' + encodeURIComponent(coords.lng);

          API.get(searchUrl)
            .then(function (res) {
              if (currentSeq !== mapSearchSeq) return;
              var results = (res && res.results) || [];
              if (!results.length) {
                searchDropdown.innerHTML = '<div style="padding:16px;font-size:12.5px;color:#94a3b8;text-align:center;">Tidak ada hasil ditemukan</div>';
                return;
              }

              var html = '';
              results.forEach(function (item, idx) {
                var itemTitle = item.title || (item.display_name ? item.display_name.split(',')[0] : 'Lokasi');
                var itemAddr = item.address || item.display_name || '';
                html +=
                  '<button type="button" class="x-map-search-dropdown-item" data-idx="' + idx + '">' +
                  '  <div class="x-map-search-dropdown-icon">' +
                  '    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FA3E3E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
                  '  </div>' +
                  '  <div class="x-map-search-dropdown-info">' +
                  '    <div class="x-map-search-dropdown-title">' + UI.escape(itemTitle) + '</div>' +
                  '    <div class="x-map-search-dropdown-addr">' + UI.escape(itemAddr) + '</div>' +
                  '  </div>' +
                  '</button>';
              });
              searchDropdown.innerHTML = html;

              searchDropdown.querySelectorAll('.x-map-search-dropdown-item').forEach(function (btn) {
                btn.onclick = function (e) {
                  e.stopPropagation();
                  var selected = results[Number(btn.getAttribute('data-idx'))];
                  if (!selected) return;

                  var newLat = Number(selected.latitude || selected.lat);
                  var newLng = Number(selected.longitude || selected.lon);

                  if (!isNaN(newLat) && !isNaN(newLng)) {
                    currentPinCoords = { lat: newLat, lng: newLng };
                    var selTitle = selected.title || itemTitle;
                    var selAddr = selected.address || selected.display_name || selTitle;
                    setSelectedLocation(selTitle, selAddr, currentPinCoords);
                    if (mapController && typeof mapController.panTo === 'function') {
                      mapController.panTo(currentPinCoords);
                    }
                  }

                  searchInput.value = selected.title || itemTitle;
                  hideDropdown();
                };
              });
            })
            .catch(function () {
              if (currentSeq !== mapSearchSeq) return;
              searchDropdown.innerHTML = '<div style="padding:16px;font-size:12.5px;color:#ef4444;text-align:center;">Gagal memuat alamat</div>';
            });
        }
      });
    }

    if (searchClear) {
      searchClear.onclick = function (e) {
        e.stopPropagation();
        searchInput.value = '';
        searchClear.classList.remove('is-visible');
        hideDropdown();
        searchInput.focus();
      };
    }

    // Dismiss dropdown when clicking on map viewport
    var viewportEl = mapOverlay.querySelector('#x-map-viewport');
    if (viewportEl) {
      viewportEl.addEventListener('click', function () {
        hideDropdown();
      });
    }

    // Re-center on GPS
    mapOverlay.querySelector('#x-map-gps-fab').onclick = function () {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function (pos) {
          currentPinCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          if (mapController && typeof mapController.panTo === 'function') {
            mapController.panTo(currentPinCoords);
          }
          updateLocationDetailsFromCoords(currentPinCoords, mapOverlay, function (resolved) {
            currentResolvedAddress = resolved;
          });
        });
      }
    };

    // "Ubah" button focuses search input
    mapOverlay.querySelector('#x-btn-ubah-map').onclick = function () {
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    };

    // "Konfirmasi" button
    var confirmBtn = mapOverlay.querySelector('#x-btn-map-konfirmasi');
    confirmBtn.onclick = function () {
      // If + Tambah Alamat flow, always go to Detail Alamat form with Favorite checkbox checked
      if (isAddingFav) {
        openAddressDetailSheet({
          address: currentResolvedAddress.address || currentResolvedAddress.title,
          latitude: currentPinCoords.lat,
          longitude: currentPinCoords.lng,
          label: currentResolvedAddress.title,
          detail: '',
          isFavorite: true,
          onSelect: function () {
            closeMap();
            if (typeof options.onSelect === 'function') options.onSelect();
          }
        });
      } else {
        // Direct selection from Map: open Detail Alamat sheet with checkbox unchecked by default
        openAddressDetailSheet({
          address: currentResolvedAddress.address || currentResolvedAddress.title,
          latitude: currentPinCoords.lat,
          longitude: currentPinCoords.lng,
          label: currentResolvedAddress.title,
          detail: '',
          isFavorite: false,
          onSelect: function () {
            closeMap();
            if (typeof options.onSelect === 'function') options.onSelect();
          }
        });
      }
    };
  }

  // Reverse geocodes coordinates with debouncing and updates the bottom card info + pin badge
  var revGeocodeTimer = null;
  var revGeocodeSeq = 0;
  function updateLocationDetailsFromCoords(coords, containerEl, onResolved) {
    var titleEl = containerEl.querySelector('#x-map-loc-title');
    var addrEl = containerEl.querySelector('#x-map-loc-addr');
    var badgeEl = containerEl.querySelector('#x-map-pin-badge');

    if (titleEl) titleEl.textContent = 'Mencari alamat…';
    if (addrEl) addrEl.textContent = 'Menentukan nama jalan dan lokasi…';
    if (badgeEl) badgeEl.textContent = 'Mencari…';

    clearTimeout(revGeocodeTimer);
    var currentSeq = ++revGeocodeSeq;
    revGeocodeTimer = setTimeout(function () {
      API.get('/delivery/reverse-geocode?lat=' + coords.lat + '&lng=' + coords.lng)
        .then(function (res) {
          if (currentSeq !== revGeocodeSeq) return; // Discard superseded reply
          var full = (res && res.address && (res.address.formatted_address || res.address.display_name)) ||
            (res && res.address_text) || '';
          
          var title = 'Lokasi Terpilih';
          var addr = 'Sekitar titik peta terpilih';

          if (full && !/^titik koordinat/i.test(full)) {
            var parts = full.split(',');
            title = (parts[0] || 'Lokasi Terpilih').trim();
            addr = parts.slice(1).join(',').trim() || full;
          } else if (res && res.address && res.address.road) {
            title = res.address.road;
            addr = res.address.display_name || res.address.road;
          }

          if (titleEl) titleEl.textContent = title;
          if (addrEl) addrEl.textContent = addr;
          if (badgeEl) badgeEl.textContent = title;
          if (typeof onResolved === 'function') onResolved({ title: title, address: addr || full });
        })
        .catch(function () {
          if (currentSeq !== revGeocodeSeq) return;
          var fallback = 'Area sekitar titik peta terpilih';
          if (titleEl) titleEl.textContent = 'Lokasi Terpilih';
          if (addrEl) addrEl.textContent = fallback;
          if (badgeEl) badgeEl.textContent = 'Lokasi Terpilih';
          if (typeof onResolved === 'function') onResolved({ title: 'Lokasi Terpilih', address: fallback });
        });
    }, 400);
  }

  // POI Cache across movements matching xentra-mvp
  var XENTRA_POI_CACHE = new Map();

  function initInteractiveMapCanvas(viewportEl, canvasContainer, centerCoords, onCenterChanged, onPoiClick) {
    var zoom = 17.2;
    var currentLat = centerCoords.lat;
    var currentLng = centerCoords.lng;
    var renderedPoiMarkers = new Map();
    var mapInst = null;
    var debounceTimer = null;

    // Fallback Canvas Renderer (in case Mapbox fails to load)
    var fallbackCtrl = null;

    function renderPoiToMap(poi) {
      if (!mapInst || !poi || !poi.lat || !poi.lng || !poi.name) return;
      var key = poi.name + '_' + Number(poi.lat).toFixed(5) + '_' + Number(poi.lng).toFixed(5);
      if (renderedPoiMarkers.has(key)) return;

      var nameLower = (poi.name || '').toLowerCase();
      var cats = Array.isArray(poi.category) ? poi.category.join(' ').toLowerCase() : '';
      var maki = (poi.maki || '').toLowerCase();

      // 1. Food / Resto / Warung / Mie / Nasi / Ayam (Orange Fork & Spoon)
      var isFood = false;
      if (/pecel|lele|ayam|mie|bakmi|bakso|nasi|soto|bebek|sate|warung|rm\.|rm\b|rumah makan|diner|restaurant|makan|seafood|padang|martabak|burger|pizza|d'master|fried chicken|lesehan|dapur|kitchen|steak|gulai|sop|bubur|pempek|along|bang jo|semar|juju|roni|geprek/i.test(nameLower) ||
          /restaurant|fast_food|fast-food|indonesian restaurant|diner|eatery/i.test(cats) ||
          /restaurant|fast-food|diner/i.test(maki)) {
        isFood = true;
      }

      // 2. Cafe / Kopi / Boba / Minuman (Purple Coffee Cup)
      var isCafe = false;
      if (!isFood) {
        if (/cafe|café|coffee|kopi|boba|bar\b|lounge|espresso|kedai kopi|angkringan|tea house|sel-sel/i.test(nameLower) ||
            /^(cafe|coffee_shop|bar)$/i.test(maki) ||
            (/\b(coffee|cafe|café|boba|tea shop|espresso)\b/i.test(cats))) {
          isCafe = true;
        }
      }

      // 3. Medical / Klinik / Dokter (Red Plus)
      var isMedical = false;
      if (!isFood && !isCafe) {
        if (/health|doctor|clinic|hospital|pharmacy|apotek|med/i.test(cats) ||
            /doctor|hospital|pharmacy/i.test(maki) ||
            /klinik|dokter|dr\.|dr\b|apotek|puskesmas|rumah sakit|rs\b/i.test(nameLower)) {
          isMedical = true;
        }
      }

      // 4. Shop / Toko / Swalayan / Jasa (Blue Shopping Bag)
      var isShop = false;
      if (!isFood && !isCafe && !isMedical) {
        if (/shop|shopping|store|toko|market|mart|grocery|bakery|cake|interior|tech|studio|bank|atm/i.test(cats) ||
            /shop|grocery|bakery|bank/i.test(maki) ||
            /toko|mart|swalayan|bakery|cake|interior|tech|studio|bank|atm|bri\b|bca\b|mandiri\b/i.test(nameLower)) {
          isShop = true;
        }
      }

      var badgeBg = 'linear-gradient(135deg, #ff7a18 0%, #ff5200 100%)';
      var textColor = '#c2410c';
      var iconSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="#ffffff"><path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/></svg>';

      if (isFood) {
        badgeBg = 'linear-gradient(135deg, #ff7a18 0%, #ff5200 100%)';
        textColor = '#c2410c';
        iconSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="#ffffff"><path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/></svg>';
      } else if (isCafe) {
        badgeBg = 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)';
        textColor = '#7e22ce';
        iconSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8zM6 1v3M10 1v3M14 1v3"/></svg>';
      } else if (isMedical) {
        badgeBg = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
        textColor = '#b91c1c';
        iconSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="#ffffff"><path d="M19 10.5h-5.5V5h-3v5.5H5v3h5.5V19h3v-5.5H19z"/></svg>';
      } else if (isShop) {
        badgeBg = 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)';
        textColor = '#1d4ed8';
        iconSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/></svg>';
      } else {
        badgeBg = 'linear-gradient(135deg, #64748b 0%, #475569 100%)';
        textColor = '#334155';
        iconSvg = '<svg width="11" height="11" viewBox="0 0 24 24" fill="#ffffff"><circle cx="12" cy="12" r="6"/></svg>';
      }

      var el = document.createElement('div');
      el.className = 'x-map-poi-badge';
      el.style.display = 'flex';
      el.style.flexDirection = 'column';
      el.style.alignItems = 'center';
      el.style.cursor = 'pointer';
      el.style.zIndex = '5';
      el.style.userSelect = 'none';

      el.innerHTML =
        '<div style="width:26px;height:26px;border-radius:50%;background:' + badgeBg + ';border:2px solid #ffffff;box-shadow:0 3px 10px rgba(0,0,0,0.22);display:flex;align-items:center;justify-content:center;transition:transform 0.15s ease;">' +
          iconSvg +
        '</div>' +
        '<div style="margin-top:3px;padding:3px 7px;background:#ffffff;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.16);border:1px solid rgba(0,0,0,0.06);font-family:\'Plus Jakarta Sans\',sans-serif;font-size:11px;font-weight:700;color:' + textColor + ';white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;pointer-events:none;line-height:1.2;">' +
          UI.escape(poi.name) +
        '</div>';

      el.addEventListener('mouseenter', function () {
        var iconDiv = el.querySelector('div');
        if (iconDiv) iconDiv.style.transform = 'scale(1.18)';
      });
      el.addEventListener('mouseleave', function () {
        var iconDiv = el.querySelector('div');
        if (iconDiv) iconDiv.style.transform = 'scale(1)';
      });

      el.addEventListener('click', function (e) {
        e.stopPropagation();
        isProgrammaticMove = true;
        if (typeof onPoiClick === 'function') {
          onPoiClick(poi);
        }
        mapInst.flyTo({
          center: [poi.lng, poi.lat],
          zoom: 17.5,
          essential: true
        });
      });

      var marker = new window.mapboxgl.Marker({
        element: el,
        anchor: 'bottom'
      }).setLngLat([poi.lng, poi.lat]).addTo(mapInst);

      renderedPoiMarkers.set(key, marker);
    }

    function syncAllCachedPois() {
      if (!mapInst) return;
      XENTRA_POI_CACHE.forEach(function (poi) {
        renderPoiToMap(poi);
      });
    }

    // Fetches nearby POIs from Mapbox Searchbox Category API
    function fetchMapboxPois(cLat, cLng) {
      if (!MAPBOX_TOKEN) return;
      var url = 'https://api.mapbox.com/search/searchbox/v1/category/food_and_drink?proximity=' +
        encodeURIComponent(cLng) + ',' + encodeURIComponent(cLat) +
        '&limit=15&access_token=' + MAPBOX_TOKEN;

      fetch(url)
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && Array.isArray(data.features)) {
            data.features.forEach(function (f) {
              if (f.geometry && Array.isArray(f.geometry.coordinates) && f.properties && f.properties.name) {
                var p = {
                  name: f.properties.name,
                  address: f.properties.full_address || f.properties.place_formatted || f.properties.name,
                  lng: f.geometry.coordinates[0],
                  lat: f.geometry.coordinates[1],
                  category: f.properties.poi_category || ['food']
                };
                var k = p.name + '_' + Number(p.lat).toFixed(5) + '_' + Number(p.lng).toFixed(5);
                XENTRA_POI_CACHE.set(k, p);
                renderPoiToMap(p);
              }
            });
          }
        })
        .catch(function () {});
    }

    var isProgrammaticMove = false;

    // Attempt to initialize official Mapbox GL JS (xentra-mvp engine)
    loadMapboxGL()
      .then(function () {
        window.mapboxgl.accessToken = MAPBOX_TOKEN;
        mapInst = new window.mapboxgl.Map({
          container: canvasContainer,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [currentLng, currentLat],
          zoom: zoom,
          attributionControl: false
        });

        mapInst.on('load', function () {
          syncAllCachedPois();
          fetchMapboxPois(currentLat, currentLng);
        });

        // User manually touches or drags map -> reset programmatic flag
        mapInst.on('dragstart', function () {
          isProgrammaticMove = false;
        });
        mapInst.on('touchstart', function () {
          isProgrammaticMove = false;
        });
        mapInst.on('wheel', function () {
          isProgrammaticMove = false;
        });

        mapInst.on('move', function () {
          var center = mapInst.getCenter();
          currentLat = center.lat;
          currentLng = center.lng;
        });

        mapInst.on('moveend', function () {
          var center = mapInst.getCenter();
          currentLat = center.lat;
          currentLng = center.lng;
          syncAllCachedPois();

          var wasProgrammatic = isProgrammaticMove;
          isProgrammaticMove = false;

          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(function () {
            fetchMapboxPois(currentLat, currentLng);
            if (typeof onCenterChanged === 'function') {
              onCenterChanged({ lat: currentLat, lng: currentLng }, wasProgrammatic);
            }
          }, 250);
        });

        setTimeout(function () { if (mapInst) mapInst.resize(); }, 150);
      })
      .catch(function (err) {
        console.warn('[MapPicker] Mapbox GL failed, falling back to lightweight canvas tiles:', err.message);
        fallbackCtrl = initFallbackCanvas(viewportEl, canvasContainer, centerCoords, onCenterChanged);
      });

    return {
      panTo: function (coords) {
        currentLat = coords.lat;
        currentLng = coords.lng;
        isProgrammaticMove = true;
        if (mapInst) {
          mapInst.flyTo({
            center: [coords.lng, coords.lat],
            zoom: 17.5,
            essential: true
          });
        } else if (fallbackCtrl) {
          fallbackCtrl.panTo(coords);
        }
      },
      zoomIn: function () {
        if (mapInst) {
          mapInst.zoomIn();
        } else if (fallbackCtrl) {
          fallbackCtrl.zoomIn();
        }
      },
      zoomOut: function () {
        if (mapInst) {
          mapInst.zoomOut();
        } else if (fallbackCtrl) {
          fallbackCtrl.zoomOut();
        }
      },
      destroy: function () {
        clearTimeout(debounceTimer);
        renderedPoiMarkers.forEach(function (m) { m.remove(); });
        renderedPoiMarkers.clear();
        if (mapInst) {
          mapInst.remove();
          mapInst = null;
        }
      }
    };
  }

  // Graceful Fallback Canvas Tile Engine (OSM)
  function initFallbackCanvas(viewportEl, canvasContainer, centerCoords, onCenterChanged) {
    var zoom = 16;
    var currentLat = centerCoords.lat;
    var currentLng = centerCoords.lng;

    function latLngToPoint(lat, lng, z) {
      var n = Math.pow(2, z);
      var rad = lat * Math.PI / 180;
      var x = ((lng + 180) / 360) * n * 256;
      var y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n * 256;
      return { x: x, y: y };
    }

    function pointToLatLng(x, y, z) {
      var n = Math.pow(2, z);
      var lng = (x / (n * 256)) * 360 - 180;
      var latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / (n * 256))));
      var lat = latRad * 180 / Math.PI;
      return { lat: lat, lng: lng };
    }

    var centerPt = latLngToPoint(currentLat, currentLng, zoom);
    var isDragging = false;
    var startX = 0, startY = 0;
    var startPtX = centerPt.x, startPtY = centerPt.y;

    function renderTiles() {
      var rect = viewportEl.getBoundingClientRect();
      var w = rect.width || window.innerWidth;
      var h = rect.height || window.innerHeight;
      var halfW = w / 2;
      var halfH = h / 2;
      var minTileX = Math.floor((centerPt.x - halfW) / 256);
      var maxTileX = Math.floor((centerPt.x + halfW) / 256);
      var minTileY = Math.floor((centerPt.y - halfH) / 256);
      var maxTileY = Math.floor((centerPt.y + halfH) / 256);

      canvasContainer.innerHTML = '';
      for (var tx = minTileX; tx <= maxTileX; tx++) {
        for (var ty = minTileY; ty <= maxTileY; ty++) {
          var img = document.createElement('img');
          img.src = 'https://tile.openstreetmap.org/' + zoom + '/' + tx + '/' + ty + '.png';
          img.alt = '';
          img.style.position = 'absolute';
          img.style.width = '256px';
          img.style.height = '256px';
          img.style.left = (tx * 256 - centerPt.x + halfW) + 'px';
          img.style.top = (ty * 256 - centerPt.y + halfH) + 'px';
          img.style.pointerEvents = 'none';
          img.style.userSelect = 'none';
          canvasContainer.appendChild(img);
        }
      }
    }

    renderTiles();

    function onPointerDown(e) {
      isDragging = true;
      startX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      startY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
      startPtX = centerPt.x;
      startPtY = centerPt.y;
    }

    function onPointerMove(e) {
      if (!isDragging) return;
      var curX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      var curY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
      centerPt.x = startPtX - (curX - startX);
      centerPt.y = startPtY - (curY - startY);
      renderTiles();
    }

    function onPointerUp() {
      if (!isDragging) return;
      isDragging = false;
      var newCoords = pointToLatLng(centerPt.x, centerPt.y, zoom);
      currentLat = newCoords.lat;
      currentLng = newCoords.lng;
      if (typeof onCenterChanged === 'function') {
        onCenterChanged(newCoords);
      }
    }

    viewportEl.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    viewportEl.addEventListener('touchstart', onPointerDown, { passive: true });
    window.addEventListener('touchmove', onPointerMove, { passive: true });
    window.addEventListener('touchend', onPointerUp, { passive: true });

    return {
      panTo: function (coords) {
        currentLat = coords.lat;
        currentLng = coords.lng;
        centerPt = latLngToPoint(currentLat, currentLng, zoom);
        renderTiles();
      },
      zoomIn: function () {
        if (zoom < 18) {
          zoom++;
          centerPt = latLngToPoint(currentLat, currentLng, zoom);
          renderTiles();
        }
      },
      zoomOut: function () {
        if (zoom > 12) {
          zoom--;
          centerPt = latLngToPoint(currentLat, currentLng, zoom);
          renderTiles();
        }
      }
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  FLOW D: DETAIL ALAMAT SHEET (Reference Image 3)
  // ══════════════════════════════════════════════════════════════
  function openAddressDetailSheet(params) {
    params = params || {};
    var addressText = params.address || 'Alamat Terpilih';
    var lat = params.latitude;
    var lng = params.longitude;
    var existingLabel = params.label || '';
    var existingDetail = params.detail || '';
    var isFavorite = params.isFavorite === true;
    var existingId = params.existingId || null;

    var parts = addressText.split(',');
    var titlePreview = parts[0] || 'Alamat Terpilih';
    var addressPreview = parts.slice(1).join(',').trim() || addressText;

    var detailHtml =
      '<h3 class="x-loc-sheet-title">Detail alamat</h3>' +

      // Selected Location Preview Row with "Ubah" button (Reference Image 3)
      '<div class="x-loc-selected-row">' +
      '  <div class="x-loc-red-dot">' +
      '    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="6.5" stroke="#FA3E3E" stroke-width="7"/></svg>' +
      '  </div>' +
      '  <div class="x-loc-selected-info">' +
      '    <div class="x-loc-selected-title">' + UI.escape(titlePreview) + '</div>' +
      '    <div class="x-loc-selected-addr">' + UI.escape(addressPreview) + '</div>' +
      '  </div>' +
      '  <button type="button" class="x-btn-ubah-lime" id="x-btn-detail-ubah">Ubah</button>' +
      '</div>' +

      '<hr style="border:0;border-top:1px solid #f1f5f9;margin:14px 0 16px;">' +

      // Form 1: Nama alamat (wajib)
      '<div class="x-loc-form-group">' +
      '  <div class="x-loc-form-label">Nama alamat <span class="wajib">(wajib)</span></div>' +
      '  <input type="text" id="x-input-fav-name" class="x-loc-form-input" placeholder="Rumah Pak Probo" value="' + UI.escape(existingLabel) + '">' +
      '</div>' +

      // Form 2: Detail lokasi/patokan (optional)
      '<div class="x-loc-form-group">' +
      '  <div class="x-loc-form-label">Detail lokasi/patokan <span class="optional">(optional)</span></div>' +
      '  <input type="text" id="x-input-fav-detail" class="x-loc-form-input" placeholder="depan vihara" value="' + UI.escape(existingDetail) + '">' +
      '</div>' +

      // Custom Checkbox: "Simpan sebagai favorit" (Reference Image 3)
      '<label class="x-loc-checkbox-label" id="x-label-fav-check">' +
      '  <div class="x-loc-custom-check ' + (isFavorite ? 'is-checked' : '') + '" id="x-box-fav-check">' +
      '    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 6 4.5 9 10 3"/></svg>' +
      '  </div>' +
      '  <span>Simpan sebagai favorit</span>' +
      '</label>' +

      // Konfirmasi Button: lime green when enabled, disabled gray when required field is empty
      '<button type="button" class="x-btn-konfirmasi-main ' + (existingLabel.trim() ? 'is-enabled' : 'is-disabled') + '" id="x-btn-detail-konfirmasi" ' + (existingLabel.trim() ? '' : 'disabled') + '>Konfirmasi</button>';

    var sh = createOverlay(detailHtml);
    var el = sh.overlay;

    var nameInput = el.querySelector('#x-input-fav-name');
    var detailInput = el.querySelector('#x-input-fav-detail');
    var checkWrapper = el.querySelector('#x-label-fav-check');
    var checkBox = el.querySelector('#x-box-fav-check');
    var konfirmasiBtn = el.querySelector('#x-btn-detail-konfirmasi');
    var ubahBtn = el.querySelector('#x-btn-detail-ubah');

    var favChecked = isFavorite;

    // Toggle Favorite Checkbox
    checkWrapper.onclick = function (e) {
      e.preventDefault();
      favChecked = !favChecked;
      checkBox.classList.toggle('is-checked', favChecked);
    };

    // Live validation: Nama alamat (WAJIB) enables button
    nameInput.addEventListener('input', function () {
      var isValid = Boolean(nameInput.value.trim());
      konfirmasiBtn.disabled = !isValid;
      konfirmasiBtn.classList.toggle('is-enabled', isValid);
      konfirmasiBtn.classList.toggle('is-disabled', !isValid);
    });

    // Ubah button opens Map Picker to re-select
    ubahBtn.onclick = function () {
      sh.close();
      openMapPickerFlow({
        isAddingFavorite: favChecked,
        onSelect: params.onSelect
      });
    };

    // Submit Konfirmasi
    konfirmasiBtn.onclick = function () {
      var finalLabel = nameInput.value.trim();
      var finalDetail = detailInput.value.trim();

      if (!finalLabel) {
        if (UI && UI.toast) UI.toast('Nama alamat wajib diisi');
        return;
      }

      konfirmasiBtn.disabled = true;
      konfirmasiBtn.textContent = 'Memproses…';

      function resetButton() {
        konfirmasiBtn.disabled = false;
        konfirmasiBtn.textContent = 'Konfirmasi';
        konfirmasiBtn.classList.add('is-enabled');
        konfirmasiBtn.classList.remove('is-disabled');
      }

      // Safety timeout so button is NEVER permanently stuck
      var timeoutId = setTimeout(function () {
        if (konfirmasiBtn && konfirmasiBtn.disabled && konfirmasiBtn.textContent === 'Memproses…') {
          resetButton();
        }
      }, 10000);

      // Branch 1: If Checked, Save to Favorite Address
      if (favChecked) {
        saveFavoriteAddress({
          id: existingId,
          label: finalLabel,
          address: addressText,
          detail: finalDetail,
          latitude: lat,
          longitude: lng
        }, function (err, savedRecord) {
          clearTimeout(timeoutId);
          if (err) {
            resetButton();
            if (UI && UI.toast) UI.toast(err.message || 'Gagal menyimpan alamat favorit');
            return;
          }

          // Set as Active Destination
          applyActiveDestination({
            latitude: lat,
            longitude: lng,
            address: addressText,
            label: finalLabel,
            detail: finalDetail,
            source: 'favorite',
            is_explicit: true,
            favorite_id: savedRecord ? savedRecord.id : null
          });

          if (UI && UI.toast) UI.toast('Alamat favorit berhasil disimpan');
          closeAllOverlays();
          if (typeof params.onSaved === 'function') params.onSaved();
          if (typeof params.onSelect === 'function') params.onSelect();
        });
      } else {
        // Branch 2: Not checked → DO NOT create favorite address, use location as Active Destination
        clearTimeout(timeoutId);
        applyActiveDestination({
          latitude: lat,
          longitude: lng,
          address: addressText,
          label: finalLabel,
          detail: finalDetail,
          source: params.source || 'map',
          is_explicit: true
        });

        closeAllOverlays();
        if (typeof params.onSelect === 'function') params.onSelect();
      }
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  PERSISTENCE & STATE BRIDGES
  // ══════════════════════════════════════════════════════════════
  function saveFavoriteAddress(data, callback) {
    var session = Store && Store.getState().customerSession;
    if (!session || !session.token) {
      // Guest customer: persist directly to localStorage guest favorites
      try {
        var localList = getGuestFavorites();
        var recordId = data.id || ('guest_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
        var existingIdx = localList.findIndex(function (item) { return String(item.id) === String(recordId); });
        var savedRecord = {
          id: recordId,
          label: data.label,
          address: data.address,
          detail: data.detail || '',
          latitude: data.latitude,
          longitude: data.longitude,
          is_primary: false,
          created_at: new Date().toISOString()
        };

        if (existingIdx !== -1) {
          localList[existingIdx] = savedRecord;
        } else {
          localList.unshift(savedRecord);
        }

        saveGuestFavorites(localList);
        callback(null, savedRecord);
      } catch (err) {
        callback(err || new Error('Gagal menyimpan di perangkat'));
      }
      return;
    }

    var payload = {
      label: data.label,
      address: data.address,
      detail: data.detail,
      latitude: data.latitude,
      longitude: data.longitude,
      is_primary: false
    };

    var req = data.id && String(data.id).indexOf('guest_') !== 0 ?
      API.put('/addresses/' + data.id, payload) :
      API.post('/addresses', payload);

    req
      .then(function (res) {
        if (res && res.success && res.address) {
          callback(null, res.address);
        } else {
          callback(new Error((res && res.error) || 'Gagal menyimpan alamat'));
        }
      })
      .catch(function (err) {
        callback(err || new Error('Koneksi bermasalah'));
      });
  }

  function applyActiveDestination(dest) {
    if (!Store) return;
    if (typeof Store.setActiveDestination === 'function') {
      Store.setActiveDestination(dest);
    } else if (typeof Store.setLocation === 'function') {
      Store.setLocation({
        formatted_address: dest.address,
        address: dest.address,
        latitude: dest.latitude,
        longitude: dest.longitude,
        label: dest.label,
        detail: dest.detail,
        source: dest.source,
        is_explicit: dest.is_explicit
      });
    }

    // Refresh Home Location Bar UI
    updateHomeLocationBar();
  }

  function updateHomeLocationBar() {
    var bar = document.getElementById('x-home-loc-bar');
    var heroPill = document.getElementById('x-hero-loc-pill');
    var heroPillText = document.getElementById('x-hero-loc-text');

    var dest = null;
    try {
      dest = (Store && Store.getActiveDestination && Store.getActiveDestination()) ||
        (Store && Store.getState().activeDestination) ||
        (Store && Store.getState().location);
    } catch (_) {}

    var titleEl = bar ? bar.querySelector('.x-locbar-title') : null;
    var tagEl = bar ? bar.querySelector('.x-locbar-source-tag') : null;
    var addrEl = bar ? bar.querySelector('.x-locbar-address') : null;

    if (!dest || (!dest.address && !dest.formatted_address)) {
      if (titleEl) titleEl.textContent = 'Pilih lokasi pengiriman';
      if (tagEl) tagEl.style.display = 'none';
      if (addrEl) addrEl.textContent = 'Ketuk untuk memilih alamat atau koordinat';
      if (heroPillText) heroPillText.textContent = 'Lokasimu';
      return;
    }

    var addr = dest.address || dest.formatted_address;
    var label = dest.label || (addr ? addr.split(',')[0].trim() : 'Lokasi Terpilih');
    var source = dest.source || 'manual';

    if (titleEl) titleEl.textContent = label;
    if (tagEl) {
      tagEl.style.display = 'inline-block';
      tagEl.textContent = source === 'favorite' ? 'Favorit' : (source === 'gps' ? 'GPS' : (source === 'map' ? 'Peta' : 'Cari'));
    }
    if (addrEl) addrEl.textContent = addr;

    if (heroPillText) {
      heroPillText.textContent = label || 'Lokasimu';
      heroPillText.setAttribute('title', addr || label);
    }
  }

  // ── Public API ──
  window.XentraLocationPicker = {
    open: openMainLocationSheet,
    openSearch: openSearchFlow,
    openMap: openMapPickerFlow,
    openDetail: openAddressDetailSheet,
    updateBar: updateHomeLocationBar
  };

  // Auto-init bar update when store changes
  if (Store && typeof Store.subscribe === 'function') {
    Store.subscribe(function () {
      updateHomeLocationBar();
    });
  }

  // Global robust click delegation for opening location picker
  document.addEventListener('click', function (e) {
    var pill = e.target && e.target.closest('#x-hero-loc-pill, [data-action="open-location-picker"]');
    if (pill) {
      e.preventDefault();
      e.stopPropagation();
      openMainLocationSheet({
        onSelect: function () {
          if (window.XentraHome && typeof window.XentraHome.refresh === 'function') {
            window.XentraHome.refresh();
          }
        }
      });
    }
  }, true);
})();

