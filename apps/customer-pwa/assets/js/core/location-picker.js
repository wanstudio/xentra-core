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
      '<h3 class="x-loc-sheet-title">Pilih lokasi</h3>' +

      // Top Search Input Box (matching reference image)
      '<div class="x-loc-search-box-main" id="x-act-search">' +
        '<div class="x-loc-search-box-dot">' +
          '<svg width="22" height="22" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="6.5" stroke="#FA3E3E" stroke-width="6.5"/></svg>' +
        '</div>' +
        '<div class="x-loc-search-box-ph">Cari alamat</div>' +
        '<div class="x-loc-search-box-mag">' +
          '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13.23 13.23 16.77 16.77M15 8.75A6.25 6.25 0 1 1 2.5 8.75a6.25 6.25 0 0 1 12.5 0Z" stroke="#9ca3af" stroke-width="2" stroke-linecap="round"/></svg>' +
        '</div>' +
      '</div>' +

      // 2 Action Pill Buttons: "Lokasimu saat ini" and "Pilih lewat peta" side by side
      '<div class="x-loc-quick-pills">' +
        '<button type="button" class="x-loc-pill-btn" id="x-act-gps">' +
          '<span class="x-loc-pill-icon">' +
            '<img src="/assets/icons/target.svg" alt="" width="18" height="18">' +
          '</span>' +
          '<span class="x-loc-pill-text">Lokasimu saat ini</span>' +
        '</button>' +
        '<button type="button" class="x-loc-pill-btn" id="x-act-map">' +
          '<span class="x-loc-pill-icon">' +
            '<img src="/assets/icons/mini_map.svg" alt="" width="18" height="18">' +
          '</span>' +
          '<span class="x-loc-pill-text">Pilih lewat peta</span>' +
        '</button>' +
      '</div>' +

      // Divider separating top actions and favorite addresses
      '<div class="x-loc-divider"></div>' +

      // Alamat Favorit Section
      '<div class="x-loc-fav-section">' +
        '<div class="x-loc-fav-header">Alamat favorit</div>' +
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

    // Action 1: Search
    var actSearch = el.querySelector('#x-act-search');
    if (actSearch) {
      actSearch.onclick = function () {
        openSearchFlow({ onSelect: onDestinationSelected });
      };
    }

    // Action 2: GPS
    var actGps = el.querySelector('#x-act-gps');
    if (actGps) {
      actGps.onclick = function () {
        triggerGpsFlow(el, { onSelect: onDestinationSelected });
      };
    }

    // Action 3: Map Picker
    var actMap = el.querySelector('#x-act-map');
    if (actMap) {
      actMap.onclick = function () {
        openMapPickerFlow({ onSelect: onDestinationSelected });
      };
    }

    // Action 4: + Tambah Alamat
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
  //  FAVORITE ADDRESSES DATA & RENDERING
  // ══════════════════════════════════════════════════════════════
  function loadFavoriteAddresses(containerEl, onSelectFav) {
    var favContainer = containerEl.querySelector('#x-loc-fav-container');
    if (!favContainer) return;

    var session = Store && Store.getState().customerSession;
    if (!session || !session.token) {
      // Unauthenticated customer: show the clean Empty State from Reference 1
      renderEmptyFavoriteState(favContainer);
      return;
    }

    if (!API) {
      renderEmptyFavoriteState(favContainer);
      return;
    }

    API.get('/addresses')
      .then(function (res) {
        if (res && res.success && Array.isArray(res.addresses) && res.addresses.length > 0) {
          renderFavoriteList(favContainer, res.addresses, onSelectFav, containerEl);
        } else {
          renderEmptyFavoriteState(favContainer);
        }
      })
      .catch(function () {
        renderEmptyFavoriteState(favContainer);
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
        '    <button type="button" class="x-loc-fav-card-more" data-action="more" aria-label="Menu" data-id="' + UI.escape(addr.id) + '">•••</button>' +
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
      '<button type="button" class="x-loc-popover-item" id="x-pop-edit">✏ Ubah</button>' +
      '<button type="button" class="x-loc-popover-item is-danger" id="x-pop-delete">🗑 Hapus</button>';

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
      // Floating Header (Back + Search preview)
      '<div class="x-map-top-bar">' +
      '  <button type="button" class="x-map-fab-back" id="x-map-back" aria-label="Kembali">' +
      '    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round"><path d="M12 4l-6 6 6 6"/></svg>' +
      '  </button>' +
      '  <div class="x-map-floating-search" id="x-map-search-bar">' +
      '    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"><circle cx="8.75" cy="8.75" r="5.75"/><path d="m13.23 13.23 3.54 3.54"/></svg>' +
      '    <span>Cari alamat</span>' +
      '  </div>' +
      '</div>' +

      // Map Viewport with Center Pin (Reference Images 2 & 3)
      '<div class="x-map-viewport" id="x-map-viewport">' +
      '  <div class="x-map-tiles-canvas" id="x-map-canvas"></div>' +
      '  <div class="x-map-center-pin-wrap">' +
      '    <div class="x-map-pin-icon-body"><div class="x-map-pin-dot"></div></div>' +
      '    <div class="x-map-pin-pulse"></div>' +
      '  </div>' +
      '</div>' +

      // Floating GPS re-center button
      '<button type="button" class="x-map-fab-gps" id="x-map-gps-fab" aria-label="Lokasi Saya">' +
      '  <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="#111" stroke-width="2"><circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3" fill="#111"/><path d="M10 1v3M10 16v3M1 10h3M16 10h3"/></svg>' +
      '</button>' +

      // Bottom Confirmation Card (Reference Image 2)
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

    // Initialize Interactive Canvas Map View (Pan & Pinch via OSM tiles)
    initInteractiveMapCanvas(
      mapOverlay.querySelector('#x-map-viewport'),
      mapOverlay.querySelector('#x-map-canvas'),
      initialCoords,
      function onCenterMoved(newCoords) {
        currentPinCoords = newCoords;
        updateLocationDetailsFromCoords(newCoords, mapOverlay, function (resolved) {
          currentResolvedAddress = resolved;
        });
      }
    );

    // Initial reverse geocode
    updateLocationDetailsFromCoords(initialCoords, mapOverlay, function (resolved) {
      currentResolvedAddress = resolved;
    });

    // Top Search Bar click
    mapOverlay.querySelector('#x-map-search-bar').onclick = function () {
      openSearchFlow({
        onSelect: function () {
          closeMap();
          if (typeof options.onSelect === 'function') options.onSelect();
        }
      });
    };

    // Re-center on GPS
    mapOverlay.querySelector('#x-map-gps-fab').onclick = function () {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function (pos) {
          currentPinCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          updateLocationDetailsFromCoords(currentPinCoords, mapOverlay, function (resolved) {
            currentResolvedAddress = resolved;
          });
        });
      }
    };

    // "Ubah" button opens search flow
    mapOverlay.querySelector('#x-btn-ubah-map').onclick = function () {
      openSearchFlow({
        onSelect: function () {
          closeMap();
          if (typeof options.onSelect === 'function') options.onSelect();
        }
      });
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

  // Reverse geocodes coordinates with debouncing and updates the bottom card info
  var revGeocodeTimer = null;
  var revGeocodeSeq = 0;
  function updateLocationDetailsFromCoords(coords, containerEl, onResolved) {
    var titleEl = containerEl.querySelector('#x-map-loc-title');
    var addrEl = containerEl.querySelector('#x-map-loc-addr');
    if (titleEl) titleEl.textContent = 'Mencari alamat…';
    if (addrEl) addrEl.textContent = 'Menentukan nama jalan dan lokasi…';

    clearTimeout(revGeocodeTimer);
    var currentSeq = ++revGeocodeSeq;
    revGeocodeTimer = setTimeout(function () {
      API.get('/delivery/reverse-geocode?lat=' + coords.lat + '&lng=' + coords.lng)
        .then(function (res) {
          if (currentSeq !== revGeocodeSeq) return; // Discard superseded reply
          var full = (res && res.address && (res.address.formatted_address || res.address.display_name)) ||
            (res && res.address_text) || ('Titik Koordinat: ' + coords.lat.toFixed(4) + ', ' + coords.lng.toFixed(4));
          var parts = full.split(',');
          var title = (parts[0] || 'Lokasi Terpilih').trim();
          var addr = parts.slice(1).join(',').trim() || full;

          if (titleEl) titleEl.textContent = title;
          if (addrEl) addrEl.textContent = addr;
          if (typeof onResolved === 'function') onResolved({ title: title, address: full });
        })
        .catch(function () {
          if (currentSeq !== revGeocodeSeq) return;
          var fallback = 'Koordinat: ' + coords.lat.toFixed(4) + ', ' + coords.lng.toFixed(4);
          if (titleEl) titleEl.textContent = 'Titik Peta';
          if (addrEl) addrEl.textContent = fallback;
          if (typeof onResolved === 'function') onResolved({ title: 'Titik Peta', address: fallback });
        });
    }, 400);
  }

  // Pure lightweight canvas tile renderer for interactive map drag without external heavy libraries
  function initInteractiveMapCanvas(viewportEl, canvasContainer, centerCoords, onCenterChanged) {
    var zoom = 16;
    var currentLat = centerCoords.lat;
    var currentLng = centerCoords.lng;

    // Convert lat/lng to tile coordinates
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
      var dx = curX - startX;
      var dy = curY - startY;

      centerPt.x = startPtX - dx;
      centerPt.y = startPtY - dy;
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
      '  <input type="text" id="x-input-fav-name" class="x-loc-form-input" placeholder="Rumah / kantor / lainnya..." value="' + UI.escape(existingLabel) + '">' +
      '</div>' +

      // Form 2: Detail lokasi/patokan (optional)
      '<div class="x-loc-form-group">' +
      '  <div class="x-loc-form-label">Detail lokasi/patokan <span class="optional">(optional)</span></div>' +
      '  <input type="text" id="x-input-fav-detail" class="x-loc-form-input" placeholder="No Rumah / unit / lantai" value="' + UI.escape(existingDetail) + '">' +
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

    // Ubah button opens Search
    ubahBtn.onclick = function () {
      sh.close();
      openSearchFlow({
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
          if (err) {
            konfirmasiBtn.disabled = false;
            konfirmasiBtn.textContent = 'Konfirmasi';
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
      // Prompt user login/OTP if saving favorite requires authentication
      if (typeof window.openCustomerAuthSheet === 'function') {
        window.openCustomerAuthSheet(function () {
          saveFavoriteAddress(data, callback);
        });
      } else {
        callback(new Error('Silakan masuk / verifikasi nomor HP terlebih dahulu untuk menyimpan favorit.'));
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

    var req = data.id ? API.put('/addresses/' + data.id, payload) : API.post('/addresses', payload);

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
})();
