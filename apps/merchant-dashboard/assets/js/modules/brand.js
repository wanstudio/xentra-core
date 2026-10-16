/**
 * XENTRA OWNER DASHBOARD — BRAND & THEME MODULE
 * Standalone modular controller for Brand identity, Logo upload, PWA launcher icon overrides,
 * Primary theme colors, Mockup previews, and Storefront Banner carousel.
 */
(function (window, document) {
  'use strict';

  var S = window.XentraShared || {};
  var $ = S.$ || function (id) { return document.getElementById(id); };
  var esc = S.esc || function (t) { return t || ''; };
  var API_BASE = S.API_BASE || '/api/v1';
  var XentraCropEditor = window.XentraCropEditor;
  var XentraActionMenu = window.XentraActionMenu;

  function adminFetch(url, options) {
    if (typeof window.adminFetch === 'function') return window.adminFetch(url, options);
    return fetch(url, options);
  }

  function getAuthHeaders(extraHeaders) {
    if (typeof window.getAuthHeaders === 'function') return window.getAuthHeaders(extraHeaders);
    var headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    var token = localStorage.getItem(S.TOKEN_KEY || 'xentra_merchant_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
  }

  function showToast(msg, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
    }
  }

  function confirmFeatureAction(id, title, msg, btnText) {
    if (typeof window.confirmFeatureAction === 'function') {
      return window.confirmFeatureAction(id, title, msg, btnText);
    }
    return Promise.resolve(confirm(msg || 'Apakah Anda yakin?'));
  }

  function getStoredUser() {
    if (window.XentraAuthModule && typeof window.XentraAuthModule.getStoredUser === 'function') {
      return window.XentraAuthModule.getStoredUser();
    }
    if (S.getStoredUser) return S.getStoredUser();
    return null;
  }

  /* =========================================================================
     MODUL 1: BRAND & THEME COLOR CONTROLLER
     ========================================================================= */

  function shouldPreserveInputValue(inputEl, forceReset) {
    if (!inputEl) return false;
    if (forceReset) return false;
    if (document.activeElement === inputEl) return true;
    if (inputEl.dataset && inputEl.dataset.dirty === 'true') return true;
    return false;
  }

  function markInputDirty(el) {
    if (el) el.dataset.dirty = 'true';
  }

  function clearAllInputsDirty() {
    document.querySelectorAll('[data-dirty="true"]').forEach(function (el) {
      delete el.dataset.dirty;
    });
  }

  window.shouldPreserveInputValue = shouldPreserveInputValue;
  window.markInputDirty = markInputDirty;
  window.clearAllBrandInputsDirty = clearAllInputsDirty;

  // ── Installed PWA Identity Override — shared upload helper ─────────────────
  async function doUploadPwaLauncherIcon(file, endpoint, previewEl, hiddenEl, removeBtn, pickBtn, cropSpec) {
    if (pickBtn) { pickBtn.disabled = true; pickBtn.textContent = 'Mengunggah...'; }
    // Optimistic preview
    try {
      var previewDataUrl = await new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(new Error('Gagal membaca file.')); };
        reader.readAsDataURL(file);
      });
      if (previewEl) { previewEl.src = previewDataUrl; previewEl.style.display = 'block'; }
    } catch (_) {}

    try {
      var base64 = await new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
        reader.readAsDataURL(file);
      });

      var iconRes = await adminFetch(API_BASE + endpoint, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ image_base64: base64, mime_type: file.type, original_filename: file.name || null, crop_spec: cropSpec || null })
      });
      var iconData = await iconRes.json();
      if (iconRes.ok && iconData.success) {
        var iconUrl = iconData.owner_pwa_icon_url || iconData.merchant_pwa_icon_url || iconData.pos_pwa_icon_url || iconData.customer_pwa_icon_url || iconData.driver_pwa_icon_url || iconData.preview_url || iconData.url || (previewEl ? previewEl.src : '');
        showToast('✅ Icon PWA berhasil diperbarui.');

        var match = endpoint.match(/\/admin\/brand\/(owner|merchant|pos|customer|driver)-icon/);
        var rKey = match ? match[1] : null;

        if (rKey) {
          // Synchronize icon preview & hidden values across both Brand Tab and Settings Modal
          if ($('brand-tab-' + rKey + '-icon-preview')) { $('brand-tab-' + rKey + '-icon-preview').src = iconUrl; $('brand-tab-' + rKey + '-icon-preview').style.display = 'block'; }
          if ($('brand-tab-' + rKey + '-icon')) $('brand-tab-' + rKey + '-icon').value = iconUrl;
          if ($('btn-brand-tab-' + rKey + '-icon-remove')) $('btn-brand-tab-' + rKey + '-icon-remove').style.display = 'inline-block';
          if ($('btn-brand-tab-' + rKey + '-icon-pick')) $('btn-brand-tab-' + rKey + '-icon-pick').textContent = '📁 Ganti Icon';

          if ($('set-profile-' + rKey + '-icon-preview')) { $('set-profile-' + rKey + '-icon-preview').src = iconUrl; $('set-profile-' + rKey + '-icon-preview').style.display = 'block'; }
          if ($('set-profile-' + rKey + '-icon')) $('set-profile-' + rKey + '-icon').value = iconUrl;
          if ($('set-profile-' + rKey + '-icon-empty')) $('set-profile-' + rKey + '-icon-empty').style.display = 'none';
          if ($('btn-set-profile-' + rKey + '-icon-remove')) $('btn-set-profile-' + rKey + '-icon-remove').style.display = 'inline-block';
          if ($('btn-set-profile-' + rKey + '-icon-pick')) $('btn-set-profile-' + rKey + '-icon-pick').textContent = '📁 Ganti';

          if (window.state && window.state.brand) {
            window.state.brand[rKey + '_pwa_icon_url'] = iconUrl;
          }
        } else {
          if (previewEl && iconUrl) { previewEl.src = iconUrl; previewEl.style.display = 'block'; }
          if (hiddenEl && iconUrl) hiddenEl.value = iconUrl;
          if (removeBtn) removeBtn.style.display = 'inline-block';
        }
        // NOTE: We deliberately do NOT call loadBrandSettings() or loadSettingsProfile() here.
        // Doing so would re-fetch the database record and wipe out any un-saved text
        // that the user has already typed in form input fields!
      } else {
        showToast('❌ ' + (iconData.error || 'Gagal menyimpan icon.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan saat mengunggah icon PWA.');
    } finally {
      if (pickBtn) { pickBtn.disabled = false; pickBtn.textContent = '📁 Ganti Icon'; }
    }
  }

  async function loadBrandSettings(options) {
    try {
      var res = await adminFetch(API_BASE + '/admin/brand', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data && data.brand) {
        if (!window.state) window.state = {};
        window.state.brand = data.brand;
        applyBrandToUI(data.brand, options);
      }
    } catch (e) {
      console.warn('[Dashboard Brand Load Warn]:', e);
    }
  }

  function applyBrandToUI(brand, options) {
    if (!brand) return;
    var opts = options || {};
    var onlyMedia = Boolean(opts.onlyMedia);
    var forceReset = Boolean(opts.forceReset);

    if (!onlyMedia) {
      var brandNameEl = $('brand-name');
      if (brandNameEl && !shouldPreserveInputValue(brandNameEl, forceReset)) brandNameEl.value = brand.name || 'Bangjo Resto';

      var brandTaglineEl = $('brand-tagline');
      if (brandTaglineEl && !shouldPreserveInputValue(brandTaglineEl, forceReset)) brandTaglineEl.value = brand.tagline || 'Official Online Food Ordering';

      var brandColorEl = $('brand-color');
      if (brandColorEl && !shouldPreserveInputValue(brandColorEl, forceReset)) brandColorEl.value = brand.primary_color || '#b6ff00';

      var brandColorHexEl = $('brand-color-hex');
      if (brandColorHexEl && !shouldPreserveInputValue(brandColorHexEl, forceReset)) brandColorHexEl.value = brand.primary_color || '#b6ff00';

      var brandDomainEl = $('brand-domain');
      if (brandDomainEl && !shouldPreserveInputValue(brandDomainEl, forceReset)) brandDomainEl.value = brand.custom_domain || 'app.mybangjo.com';

      var setProfileNameEl = $('set-profile-name');
      if (setProfileNameEl && !shouldPreserveInputValue(setProfileNameEl, forceReset)) setProfileNameEl.value = brand.name || '';

      var setProfileTaglineEl = $('set-profile-tagline');
      if (setProfileTaglineEl && !shouldPreserveInputValue(setProfileTaglineEl, forceReset)) setProfileTaglineEl.value = brand.tagline || '';

      var setProfileColorEl = $('set-profile-color');
      if (setProfileColorEl && !shouldPreserveInputValue(setProfileColorEl, forceReset)) setProfileColorEl.value = brand.primary_color || '#b6ff00';

      var setProfileColorHexEl = $('set-profile-color-hex');
      if (setProfileColorHexEl && !shouldPreserveInputValue(setProfileColorHexEl, forceReset)) setProfileColorHexEl.value = brand.primary_color || '#b6ff00';

      if ($('set-profile-domain')) $('set-profile-domain').textContent = brand.custom_domain || window.location.host || '-';
    }

    var logoUrl = brand.logo_url || '/assets/pwa/icon-192.png';
    if ($('brand-logo')) $('brand-logo').value = logoUrl;
    if ($('brand-logo-preview')) {
      $('brand-logo-preview').src = logoUrl;
      $('brand-logo-preview').style.display = 'block';
    }
    if ($('brand-logo-empty')) $('brand-logo-empty').style.display = 'none';
    if ($('btn-brand-logo-remove')) $('btn-brand-logo-remove').style.display = (logoUrl && logoUrl !== '/assets/pwa/icon-192.png') ? 'inline-block' : 'none';

    if ($('dash-brand-title')) $('dash-brand-title').textContent = brand.name || 'Bangjo Resto';
    if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = logoUrl;
    if ($('topbar-brand-name')) $('topbar-brand-name').textContent = brand.name || 'Bangjo Resto';
    var user = getStoredUser();
    if (user && user.role === 'branch_manager' && $('topbar-brand-badge')) {
      $('topbar-brand-badge').style.display = 'none';
    }

    if ($('set-profile-logo')) $('set-profile-logo').value = logoUrl;
    if ($('set-profile-logo-preview')) {
      $('set-profile-logo-preview').src = logoUrl;
      $('set-profile-logo-preview').style.display = 'block';
    }
    if ($('set-profile-logo-empty')) $('set-profile-logo-empty').style.display = 'none';
    if ($('btn-set-profile-logo-remove')) $('btn-set-profile-logo-remove').style.display = (logoUrl && logoUrl !== '/assets/pwa/icon-192.png') ? 'inline-block' : 'none';
    if ($('btn-set-profile-logo-pick')) $('btn-set-profile-logo-pick').textContent = (logoUrl && logoUrl !== '/assets/pwa/icon-192.png') ? '📁 Ganti Logo' : '📁 Unggah Logo';

    if ($('auth-brand-name')) $('auth-brand-name').textContent = brand.name || 'Bangjo Resto';
    if ($('auth-logo')) $('auth-logo').src = logoUrl;

    // Installed PWA Identity Override — populate launcher icon previews and names for all 5 roles
    var pwaRoles = [
      { key: 'owner', nameKey: 'owner_pwa_name', iconKey: 'owner_pwa_icon_url', defaultIcon: '/assets/pwa/icon-192.png' },
      { key: 'merchant', nameKey: 'merchant_pwa_name', iconKey: 'merchant_pwa_icon_url', defaultIcon: '/merchant-app/assets/icons/icon-192.png' },
      { key: 'pos', nameKey: 'pos_pwa_name', iconKey: 'pos_pwa_icon_url', defaultIcon: '/pos/assets/icons/icon-192.png' },
      { key: 'customer', nameKey: 'customer_pwa_name', iconKey: 'customer_pwa_icon_url', defaultIcon: '/assets/pwa/icon-192.png' },
      { key: 'driver', nameKey: 'driver_pwa_name', iconKey: 'driver_pwa_icon_url', defaultIcon: '/driver-app/assets/icons/icon-192.png' }
    ];

    pwaRoles.forEach(function (r) {
      var iconUrl = brand[r.iconKey] || null;
      var pwaName = brand[r.nameKey] || '';
      var effectiveIcon = iconUrl || logoUrl || r.defaultIcon;
      var hasCustom = Boolean(iconUrl);

      // Brand tab
      var tabPwaNameEl = $('brand-tab-' + r.key + '-pwa-name');
      if (!onlyMedia && tabPwaNameEl && !shouldPreserveInputValue(tabPwaNameEl, forceReset)) {
        tabPwaNameEl.value = pwaName;
      }
      if ($('brand-tab-' + r.key + '-icon')) $('brand-tab-' + r.key + '-icon').value = iconUrl || '';
      if ($('brand-tab-' + r.key + '-icon-preview')) {
        $('brand-tab-' + r.key + '-icon-preview').src = effectiveIcon;
        $('brand-tab-' + r.key + '-icon-preview').style.display = 'block';
      }
      if ($('btn-brand-tab-' + r.key + '-icon-remove')) $('btn-brand-tab-' + r.key + '-icon-remove').style.display = hasCustom ? 'inline-block' : 'none';
      if ($('btn-brand-tab-' + r.key + '-icon-pick')) $('btn-brand-tab-' + r.key + '-icon-pick').textContent = hasCustom ? '📁 Ganti Icon' : '📁 Unggah Icon';

      // Settings modal
      var setPwaNameEl = $('set-profile-' + r.key + '-pwa-name');
      if (!onlyMedia && setPwaNameEl && !shouldPreserveInputValue(setPwaNameEl, forceReset)) {
        setPwaNameEl.value = pwaName;
      }
      if ($('set-profile-' + r.key + '-icon')) $('set-profile-' + r.key + '-icon').value = iconUrl || '';
      if ($('set-profile-' + r.key + '-icon-preview')) {
        $('set-profile-' + r.key + '-icon-preview').src = effectiveIcon;
        $('set-profile-' + r.key + '-icon-preview').style.display = 'block';
      }
      if ($('set-profile-' + r.key + '-icon-empty')) $('set-profile-' + r.key + '-icon-empty').style.display = 'none';
      if ($('btn-set-profile-' + r.key + '-icon-remove')) $('btn-set-profile-' + r.key + '-icon-remove').style.display = hasCustom ? 'inline-block' : 'none';
      if ($('btn-set-profile-' + r.key + '-icon-pick')) $('btn-set-profile-' + r.key + '-icon-pick').textContent = hasCustom ? '📁 Ganti' : '📁 Unggah';
    });

    renderBannersList(brand.banners);
    var activeBrandName = ($('brand-name') && $('brand-name').value) || brand.name || 'Bangjo Resto';
    var activeColor = ($('brand-color') && $('brand-color').value) || brand.primary_color || '#b6ff00';
    updateLiveMockupPreview(activeBrandName, logoUrl, activeColor);
  }

  function updateLiveMockupPreview(name, logo, color) {
    color = color || ($('brand-color') ? $('brand-color').value : '#b6ff00') || '#b6ff00';
    logo = logo || ($('brand-logo') ? $('brand-logo').value : '/assets/pwa/icon-192.png') || '/assets/pwa/icon-192.png';
    name = name || ($('brand-name') ? $('brand-name').value : 'Bangjo Resto') || 'Bangjo Resto';

    if ($('mock-title')) $('mock-title').textContent = name;
    if ($('mock-logo')) $('mock-logo').src = logo;

    document.documentElement.style.setProperty('--primary-color', color);

    var mockPill = $('mock-cat-1');
    if (mockPill) mockPill.style.backgroundColor = color;

    var mockAddBtn = $('mock-btn-tambah');
    if (mockAddBtn) mockAddBtn.style.backgroundColor = color;

    var mockCartBtn = $('mock-cart-btn');
    if (mockCartBtn) mockCartBtn.style.backgroundColor = color;
  }

  async function doUploadBrandLogo(file, cropSpec, previewDataUrl, triggerBtn) {
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = 'Mengunggah...';
    }

    // Optimistic preview immediately so user sees immediate feedback
    if (previewDataUrl) {
      if ($('brand-logo-preview')) {
        $('brand-logo-preview').src = previewDataUrl;
        $('brand-logo-preview').style.display = 'block';
      }
      if ($('brand-logo-empty')) $('brand-logo-empty').style.display = 'none';
      if ($('set-profile-logo-preview')) {
        $('set-profile-logo-preview').src = previewDataUrl;
        $('set-profile-logo-preview').style.display = 'block';
      }
      if ($('set-profile-logo-empty')) $('set-profile-logo-empty').style.display = 'none';
      if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = previewDataUrl;
      var _nameInput = $('brand-name');
      var _colorPicker = $('brand-color');
      if (_nameInput && _colorPicker) {
        updateLiveMockupPreview(_nameInput.value, previewDataUrl, _colorPicker.value);
      }
    }

    try {
      var base64 = await new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
        reader.readAsDataURL(file);
      });

      var payload = { image_base64: base64, mime_type: file.type };
      if (cropSpec) payload.crop_spec = cropSpec;

      var res = await adminFetch(API_BASE + '/admin/brand/logo', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var data = await res.json();

      if (res.ok && data.success) {
        showToast('✅ Logo brand berhasil diunggah.');
        var logoUrl = data.logo_url;
        var _logoInput = $('brand-logo');
        if (_logoInput) _logoInput.value = logoUrl;
        if ($('brand-logo-preview')) {
          $('brand-logo-preview').src = logoUrl;
          $('brand-logo-preview').style.display = 'block';
        }
        if ($('brand-logo-empty')) $('brand-logo-empty').style.display = 'none';
        if ($('btn-brand-logo-remove')) $('btn-brand-logo-remove').style.display = 'inline-block';
        if ($('btn-brand-logo-pick')) $('btn-brand-logo-pick').textContent = '📁 Ganti Logo';

        if ($('set-profile-logo')) $('set-profile-logo').value = logoUrl;
        if ($('set-profile-logo-preview')) {
          $('set-profile-logo-preview').src = logoUrl;
          $('set-profile-logo-preview').style.display = 'block';
        }
        if ($('set-profile-logo-empty')) $('set-profile-logo-empty').style.display = 'none';
        if ($('btn-set-profile-logo-remove')) $('btn-set-profile-logo-remove').style.display = 'inline-block';
        if ($('btn-set-profile-logo-pick')) $('btn-set-profile-logo-pick').textContent = '📁 Ganti Logo';

        if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = logoUrl;
        var _nameInput2 = $('brand-name');
        var _colorPicker2 = $('brand-color');
        if (_nameInput2 && _colorPicker2) {
          updateLiveMockupPreview(_nameInput2.value, logoUrl, _colorPicker2.value);
        }
        if (window.state && window.state.brand) {
          window.state.brand.logo_url = logoUrl;
        }
        // Do NOT call loadBrandSettings() or loadSettingsProfile() here.
        // That would re-fetch the database record and wipe out any un-saved text typed in form inputs!
      } else {
        showToast('❌ ' + (data.error || 'Gagal mengunggah logo brand.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan saat mengunggah logo.');
    } finally {
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = '📁 Ganti Logo';
      }
    }
  }

  function initBrandListeners() {
    var colorPicker = $('brand-color');
    var colorHex = $('brand-color-hex');
    var logoInput = $('brand-logo');
    var nameInput = $('brand-name');

    var taglineInput = $('brand-tagline');
    var domainInput = $('brand-domain');

    if (colorPicker && colorHex) {
      colorPicker.addEventListener('input', function () {
        markInputDirty(colorPicker);
        colorHex.value = colorPicker.value;
        markInputDirty(colorHex);
        var setCol = $('set-profile-color');
        if (setCol && document.activeElement !== setCol) { setCol.value = colorPicker.value; markInputDirty(setCol); }
        var setColHex = $('set-profile-color-hex');
        if (setColHex && document.activeElement !== setColHex) { setColHex.value = colorPicker.value; markInputDirty(setColHex); }
        updateLiveMockupPreview(nameInput ? nameInput.value : '', logoInput ? logoInput.value : '', colorPicker.value);
      });

      colorHex.addEventListener('input', function () {
        markInputDirty(colorHex);
        if (/^#[0-9A-Fa-f]{6}$/.test(colorHex.value)) {
          colorPicker.value = colorHex.value;
          markInputDirty(colorPicker);
          var setCol = $('set-profile-color');
          if (setCol && document.activeElement !== setCol) { setCol.value = colorHex.value; markInputDirty(setCol); }
          var setColHex = $('set-profile-color-hex');
          if (setColHex && document.activeElement !== setColHex) { setColHex.value = colorHex.value; markInputDirty(setColHex); }
          updateLiveMockupPreview(nameInput ? nameInput.value : '', logoInput ? logoInput.value : '', colorHex.value);
        }
      });
    }

    if (logoInput) {
      logoInput.addEventListener('input', function () {
        markInputDirty(logoInput);
        updateLiveMockupPreview(nameInput ? nameInput.value : '', logoInput.value, colorPicker ? colorPicker.value : '');
      });
    }

    if (nameInput) {
      nameInput.addEventListener('input', function () {
        markInputDirty(nameInput);
        var setProfileName = $('set-profile-name');
        if (setProfileName && document.activeElement !== setProfileName) {
          setProfileName.value = nameInput.value;
          markInputDirty(setProfileName);
        }
        updateLiveMockupPreview(nameInput.value, logoInput ? logoInput.value : '', colorPicker ? colorPicker.value : '');
      });
    }

    if (taglineInput) {
      taglineInput.addEventListener('input', function () {
        markInputDirty(taglineInput);
        var setTagline = $('set-profile-tagline');
        if (setTagline && document.activeElement !== setTagline) {
          setTagline.value = taglineInput.value;
          markInputDirty(setTagline);
        }
      });
    }

    if (domainInput) {
      domainInput.addEventListener('input', function () {
        markInputDirty(domainInput);
      });
    }

    // Swatches
    document.querySelectorAll('.x-swatch').forEach(function (swatch) {
      swatch.addEventListener('click', function () {
        var c = swatch.dataset.color;
        if (colorPicker) { colorPicker.value = c; markInputDirty(colorPicker); }
        if (colorHex) { colorHex.value = c; markInputDirty(colorHex); }
        var setCol = $('set-profile-color');
        if (setCol) { setCol.value = c; markInputDirty(setCol); }
        var setColHex = $('set-profile-color-hex');
        if (setColHex) { setColHex.value = c; markInputDirty(setColHex); }
        if (nameInput && logoInput) {
          updateLiveMockupPreview(nameInput.value, logoInput.value, c);
        }
      });
    });

    // Brand Logo File Picker & Upload
    var btnPickLogo = $('btn-brand-logo-pick');
    var fileInputLogo = $('input-brand-logo-file');
    var btnRemoveLogo = $('btn-brand-logo-remove');

    if (btnPickLogo && fileInputLogo) {
      btnPickLogo.addEventListener('click', function () {
        fileInputLogo.click();
      });

      fileInputLogo.addEventListener('change', async function () {
        var file = fileInputLogo.files && fileInputLogo.files[0];
        if (!file) return;

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format file tidak didukung. Gunakan JPG, PNG, atau WebP.');
          fileInputLogo.value = '';
          return;
        }

        if (file.size > 10 * 1024 * 1024) {
          showToast('❌ Ukuran file melebihi batas 10 MB.');
          fileInputLogo.value = '';
          return;
        }

        // Immediate optimistic preview before crop editor opens
        (function (f) {
          var r = new FileReader();
          r.onload = function (ev) {
            if ($('brand-logo-preview')) { $('brand-logo-preview').src = ev.target.result; $('brand-logo-preview').style.display = 'block'; }
            if ($('brand-logo-empty')) $('brand-logo-empty').style.display = 'none';
            if ($('set-profile-logo-preview')) { $('set-profile-logo-preview').src = ev.target.result; $('set-profile-logo-preview').style.display = 'block'; }
            if ($('set-profile-logo-empty')) $('set-profile-logo-empty').style.display = 'none';
            if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = ev.target.result;
          };
          r.readAsDataURL(f);
        })(file);

        if (!XentraCropEditor || typeof XentraCropEditor.open !== 'function') {
          (function (f) {
            var r = new FileReader();
            r.onload = function (ev) { doUploadBrandLogo(f, null, ev.target.result, btnPickLogo); };
            r.readAsDataURL(f);
          })(file);
          fileInputLogo.value = '';
          return;
        }

        XentraCropEditor.open({
          source: file,
          assetType: 'logo',
          aspectRatio: 1.0,
          title: 'Potong & Posisikan Logo Brand (1:1)',
          onConfirm: async function (cropSpec, previewDataUrl) {
            try {
              await doUploadBrandLogo(file, cropSpec, previewDataUrl, btnPickLogo);
            } finally {
              fileInputLogo.value = '';
            }
          },
          onCancel: function () {
            fileInputLogo.value = '';
          }
        });
      });
    }

    if (btnRemoveLogo) {
      btnRemoveLogo.addEventListener('click', async function () {
        if (!await confirmFeatureAction('remove-brand-logo', 'Hapus Logo Brand', 'Hapus logo brand kustom dan kembali ke default?', 'Hapus')) return;
        try {
          var res = await adminFetch(API_BASE + '/admin/brand/logo', {
            method: 'DELETE',
            headers: getAuthHeaders()
          });
          var data = await res.json();
          if (res.ok && data.success) {
            showToast('✅ Logo brand kustom dihapus.');
            var defaultLogo = '/assets/pwa/icon-192.png';
            if (logoInput) logoInput.value = defaultLogo;
            if ($('brand-logo-preview')) {
              $('brand-logo-preview').src = defaultLogo;
              $('brand-logo-preview').style.display = 'block';
            }
            btnRemoveLogo.style.display = 'none';
            if (btnPickLogo) btnPickLogo.textContent = '📁 Unggah Logo';
            if ($('set-profile-logo')) $('set-profile-logo').value = defaultLogo;
            if ($('set-profile-logo-preview')) $('set-profile-logo-preview').src = defaultLogo;
            if ($('btn-set-profile-logo-remove')) $('btn-set-profile-logo-remove').style.display = 'none';
            if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = defaultLogo;
            if (window.state && window.state.brand) {
              window.state.brand.logo_url = defaultLogo;
            }
            // Do NOT call loadBrandSettings() or loadSettingsProfile() here.
            // That would re-fetch the database record and wipe out any un-saved text typed in form inputs!
          } else {
            showToast('❌ Gagal menghapus logo.');
          }
        } catch (err) {
          showToast('❌ Kesalahan jaringan.');
        }
      });
    }

    var btnUseBangjo = $('btn-use-bangjo-logo');
    if (btnUseBangjo) {
      btnUseBangjo.addEventListener('click', function () {
        var defaultLogo = '/assets/pwa/icon-192.png';
        if (logoInput) logoInput.value = defaultLogo;
        if ($('brand-logo-preview')) {
          $('brand-logo-preview').src = defaultLogo;
          $('brand-logo-preview').style.display = 'block';
        }
        if ($('brand-logo-empty')) $('brand-logo-empty').style.display = 'none';
        if (btnRemoveLogo) btnRemoveLogo.style.display = 'none';
        if (btnPickLogo) btnPickLogo.textContent = '📁 Unggah Logo';

        if ($('set-profile-logo')) $('set-profile-logo').value = defaultLogo;
        if ($('set-profile-logo-preview')) {
          $('set-profile-logo-preview').src = defaultLogo;
          $('set-profile-logo-preview').style.display = 'block';
        }
        if ($('btn-set-profile-logo-remove')) $('btn-set-profile-logo-remove').style.display = 'none';
        if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = defaultLogo;

        if (nameInput && logoInput && colorPicker) {
          updateLiveMockupPreview(nameInput.value, defaultLogo, colorPicker.value);
        }
      });
    }

    var formBrand = $('form-brand-settings');
    if (formBrand) {
      formBrand.addEventListener('submit', async function (e) {
        e.preventDefault();
        var btn = $('btn-save-brand');
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Menyimpan...';
        }

        var rawColor = ($('brand-color-hex') && $('brand-color-hex').value.trim()) || ($('brand-color') && $('brand-color').value) || '#b6ff00';
        if (!rawColor.startsWith('#')) rawColor = '#' + rawColor;
        if (/^#[0-9a-fA-F]{3}$/.test(rawColor)) {
          rawColor = '#' + rawColor[1] + rawColor[1] + rawColor[2] + rawColor[2] + rawColor[3] + rawColor[3];
        }
        if (!/^#[0-9a-fA-F]{6}$/.test(rawColor)) {
          showToast('❌ Format warna HEX tidak valid. Gunakan format #RRGGBB (contoh: #FF5500).');
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Simpan Pengaturan Brand';
          }
          return;
        }
        rawColor = rawColor.toUpperCase();

        var payload = {
          name: $('brand-name') ? $('brand-name').value : '',
          tagline: $('brand-tagline') ? $('brand-tagline').value : '',
          logo_url: $('brand-logo') ? $('brand-logo').value : '',
          owner_pwa_icon_url: $('brand-tab-owner-icon') ? $('brand-tab-owner-icon').value.trim() : null,
          merchant_pwa_icon_url: $('brand-tab-merchant-icon') ? $('brand-tab-merchant-icon').value.trim() : null,
          pos_pwa_icon_url: $('brand-tab-pos-icon') ? $('brand-tab-pos-icon').value.trim() : null,
          customer_pwa_icon_url: $('brand-tab-customer-icon') ? $('brand-tab-customer-icon').value.trim() : null,
          driver_pwa_icon_url: $('brand-tab-driver-icon') ? $('brand-tab-driver-icon').value.trim() : null,
          owner_pwa_name: $('brand-tab-owner-pwa-name') ? $('brand-tab-owner-pwa-name').value.trim() : undefined,
          merchant_pwa_name: $('brand-tab-merchant-pwa-name') ? $('brand-tab-merchant-pwa-name').value.trim() : undefined,
          pos_pwa_name: $('brand-tab-pos-pwa-name') ? $('brand-tab-pos-pwa-name').value.trim() : undefined,
          customer_pwa_name: $('brand-tab-customer-pwa-name') ? $('brand-tab-customer-pwa-name').value.trim() : undefined,
          driver_pwa_name: $('brand-tab-driver-pwa-name') ? $('brand-tab-driver-pwa-name').value.trim() : undefined,
          primary_color: rawColor,
          custom_domain: $('brand-domain') ? $('brand-domain').value : ''
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
            clearAllInputsDirty();
            applyBrandToUI(data.brand, { forceReset: true });
            if (typeof window.loadSettingsProfile === 'function') {
              window.loadSettingsProfile({ forceReset: true });
            }
          } else {
            showToast('❌ Gagal menyimpan: ' + data.error);
          }
        } catch (err) {
          showToast('❌ Terjadi kesalahan jaringan.');
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Simpan Pengaturan Brand';
          }
        }
      });
    }

    // Brand Tab PWA Launcher Icon Listeners for Owner, Merchant, POS Kasir, Belanja, Driver
    var pwaRoleConfig = [
      { key: 'owner', label: 'Owner PWA', endpoint: '/admin/brand/owner-icon', defaultIcon: '/assets/pwa/icon-192.png', iconKey: 'owner_pwa_icon_url' },
      { key: 'merchant', label: 'Merchant PWA', endpoint: '/admin/brand/merchant-icon', defaultIcon: '/merchant-app/assets/icons/icon-192.png', iconKey: 'merchant_pwa_icon_url' },
      { key: 'pos', label: 'POS Kasir PWA', endpoint: '/admin/brand/pos-icon', defaultIcon: '/pos/assets/icons/icon-192.png', iconKey: 'pos_pwa_icon_url' },
      { key: 'customer', label: 'Belanja PWA', endpoint: '/admin/brand/customer-icon', defaultIcon: '/assets/pwa/icon-192.png', iconKey: 'customer_pwa_icon_url' },
      { key: 'driver', label: 'Driver PWA', endpoint: '/admin/brand/driver-icon', defaultIcon: '/driver-app/assets/icons/icon-192.png', iconKey: 'driver_pwa_icon_url' }
    ];

    pwaRoleConfig.forEach(function (roleCfg) {
      var rKey = roleCfg.key;
      var rLabel = roleCfg.label;
      var btnPick = $('btn-brand-tab-' + rKey + '-icon-pick');
      var fileInput = $('input-brand-tab-' + rKey + '-icon-file');
      var btnRemove = $('btn-brand-tab-' + rKey + '-icon-remove');
      var pwaNameInput = $('brand-tab-' + rKey + '-pwa-name');

      if (pwaNameInput) {
        pwaNameInput.addEventListener('input', function () {
          markInputDirty(pwaNameInput);
          var setInput = $('set-profile-' + rKey + '-pwa-name');
          if (setInput && document.activeElement !== setInput) {
            setInput.value = pwaNameInput.value;
            markInputDirty(setInput);
          }
        });
      }

      if (btnPick && fileInput) {
        btnPick.addEventListener('click', function () { fileInput.click(); });
        fileInput.addEventListener('change', async function () {
          var file = fileInput.files && fileInput.files[0];
          if (!file) return;

          var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
          if (allowed.indexOf(file.type) === -1) {
            showToast('❌ Format file tidak didukung. Gunakan JPG, PNG, atau WebP.');
            fileInput.value = '';
            return;
          }
          if (file.size > 10 * 1024 * 1024) {
            showToast('❌ Ukuran file melebihi batas 10 MB.');
            fileInput.value = '';
            return;
          }

          (function (f) {
            var r = new FileReader();
            r.onload = function (ev) {
              if ($('brand-tab-' + rKey + '-icon-preview')) { $('brand-tab-' + rKey + '-icon-preview').src = ev.target.result; $('brand-tab-' + rKey + '-icon-preview').style.display = 'block'; }
              if ($('set-profile-' + rKey + '-icon-preview')) { $('set-profile-' + rKey + '-icon-preview').src = ev.target.result; $('set-profile-' + rKey + '-icon-preview').style.display = 'block'; }
            };
            r.readAsDataURL(f);
          })(file);

          if (!XentraCropEditor || typeof XentraCropEditor.open !== 'function') {
            doUploadPwaLauncherIcon(file, roleCfg.endpoint,
              $('brand-tab-' + rKey + '-icon-preview'), $('brand-tab-' + rKey + '-icon'),
              btnRemove, btnPick);
            fileInput.value = '';
            return;
          }

          XentraCropEditor.open({
            source: file,
            assetType: 'logo',
            aspectRatio: 1.0,
            title: 'Potong Icon ' + rLabel + ' (1:1)',
            onConfirm: async function (cropSpec, previewDataUrl) {
              try {
                if ($('brand-tab-' + rKey + '-icon-preview') && previewDataUrl) { $('brand-tab-' + rKey + '-icon-preview').src = previewDataUrl; }
                if ($('set-profile-' + rKey + '-icon-preview') && previewDataUrl) { $('set-profile-' + rKey + '-icon-preview').src = previewDataUrl; }
                await doUploadPwaLauncherIcon(file, roleCfg.endpoint,
                  $('brand-tab-' + rKey + '-icon-preview'), $('brand-tab-' + rKey + '-icon'),
                  btnRemove, btnPick, cropSpec);
              } finally {
                fileInput.value = '';
              }
            },
            onCancel: function () {
              fileInput.value = '';
            }
          });
        });
      }

      if (btnRemove) {
        btnRemove.addEventListener('click', async function () {
          if (!await confirmFeatureAction('remove-' + rKey + '-pwa-icon', 'Hapus Icon ' + rLabel, 'Hapus icon kustom ' + rLabel + ' dan kembali ke default?', 'Hapus')) return;
          try {
            var res = await adminFetch(API_BASE + roleCfg.endpoint, {
              method: 'DELETE',
              headers: getAuthHeaders()
            });
            var data = await res.json();
            if (res.ok && data.success) {
              showToast('✅ Icon kustom ' + rLabel + ' dihapus.');
              var defaultIcon = roleCfg.defaultIcon;
              if ($('brand-tab-' + rKey + '-icon')) $('brand-tab-' + rKey + '-icon').value = '';
              if ($('brand-tab-' + rKey + '-icon-preview')) $('brand-tab-' + rKey + '-icon-preview').src = defaultIcon;
              btnRemove.style.display = 'none';
              if (btnPick) btnPick.textContent = '📁 Unggah Icon';

              if ($('set-profile-' + rKey + '-icon')) $('set-profile-' + rKey + '-icon').value = '';
              if ($('set-profile-' + rKey + '-icon-preview')) $('set-profile-' + rKey + '-icon-preview').src = defaultIcon;
              if ($('btn-set-profile-' + rKey + '-icon-remove')) $('btn-set-profile-' + rKey + '-icon-remove').style.display = 'none';
              if ($('btn-set-profile-' + rKey + '-icon-pick')) $('btn-set-profile-' + rKey + '-icon-pick').textContent = '📁 Unggah';

              if (window.state && window.state.brand) {
                window.state.brand[roleCfg.iconKey] = null;
              }
            } else {
              showToast('❌ Gagal menghapus icon ' + rLabel + '.');
            }
          } catch (err) {
            showToast('❌ Kesalahan jaringan.');
          }
        });
      }
    });

    // Form Add Banner Carousel (File Upload flow)
    var _bannerUploadFile = null;
    var _bannerCropSpec = null;
    var btnBannerPick = $('btn-banner-pick');
    var fileInputBanner = $('input-banner-file');
    var btnBannerClear = $('btn-banner-clear');
    var bannerPreviewImg = $('banner-upload-preview');
    var bannerEmptyBox = $('banner-upload-empty');

    if (btnBannerPick && fileInputBanner) {
      btnBannerPick.addEventListener('click', function () {
        fileInputBanner.click();
      });

      fileInputBanner.addEventListener('change', function () {
        var file = fileInputBanner.files && fileInputBanner.files[0];
        if (!file) {
          _bannerUploadFile = null;
          _bannerCropSpec = null;
          return;
        }

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format file banner tidak didukung. Gunakan JPG, PNG, atau WebP.');
          fileInputBanner.value = '';
          return;
        }

        if (file.size > 20 * 1024 * 1024) {
          showToast('❌ Ukuran file banner melebihi batas 20 MB.');
          fileInputBanner.value = '';
          return;
        }

        _bannerUploadFile = file;

        XentraCropEditor.open({
          source: file,
          assetType: 'banner',
          aspectRatio: 350 / 180,
          title: 'Sesuaikan Posisi Banner (~1.94:1)',
          onConfirm: function (cropSpec, previewDataUrl) {
            _bannerCropSpec = cropSpec;
            if (bannerPreviewImg) {
              bannerPreviewImg.src = previewDataUrl || URL.createObjectURL(file);
              bannerPreviewImg.style.display = 'block';
            }
            if (bannerEmptyBox) bannerEmptyBox.style.display = 'none';
            if (btnBannerClear) btnBannerClear.style.display = 'inline-block';
            if (btnBannerPick) btnBannerPick.textContent = '📁 Ganti File';
            showToast('✓ Potongan banner disesuaikan.');
          },
          onCancel: function () {
            _bannerUploadFile = null;
            _bannerCropSpec = null;
            if (fileInputBanner) fileInputBanner.value = '';
          }
        });
      });
    }

    if (btnBannerClear) {
      btnBannerClear.addEventListener('click', function () {
        _bannerUploadFile = null;
        _bannerCropSpec = null;
        if (fileInputBanner) fileInputBanner.value = '';
        if (bannerPreviewImg) {
          bannerPreviewImg.src = '';
          bannerPreviewImg.style.display = 'none';
        }
        if (bannerEmptyBox) bannerEmptyBox.style.display = 'flex';
        btnBannerClear.style.display = 'none';
        if (btnBannerPick) btnBannerPick.textContent = '📁 Pilih File Banner';
      });
    }

    var formAddBanner = $('form-add-banner');
    if (formAddBanner) {
      formAddBanner.addEventListener('submit', async function (e) {
        e.preventDefault();
        var titleInput = $('input-banner-title');
        var title = titleInput ? titleInput.value.trim() : '';

        if (!_bannerUploadFile) {
          showToast('❌ Silakan pilih file gambar banner terlebih dahulu.');
          return;
        }

        var submitBtn = $('btn-submit-banner');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Mengunggah...'; }

        try {
          var base64 = await new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.onerror = function () { reject(new Error('Gagal membaca file gambar banner.')); };
            reader.readAsDataURL(_bannerUploadFile);
          });

          var bannerPayload = {
            image_base64: base64,
            mime_type: _bannerUploadFile.type,
            title: title
          };
          if (_bannerCropSpec) {
            bannerPayload.crop_spec = _bannerCropSpec;
          }

          var res = await adminFetch(API_BASE + '/admin/banners', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(bannerPayload)
          });
          var data = await res.json();
          if (res.ok && data.success) {
            showToast('✅ Banner carousel berhasil ditambahkan!');
            if (titleInput) titleInput.value = '';
            if (btnBannerClear) btnBannerClear.click();
            renderBannersList(data.banners);
          } else {
            showToast('❌ ' + (data.error || 'Gagal menambahkan banner.'));
          }
        } catch (err) {
          showToast('❌ Terjadi kesalahan jaringan saat menambah banner.');
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '＋ Tambah Banner'; }
        }
      });
    }
  }

  function renderBannersList(banners) {
    var container = $('dash-banners-list');
    if (!container) return;
    var currentBrand = (window.state && window.state.brand) ? window.state.brand : {};
    banners = banners || currentBrand.banners || [];
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
            '<div class="x-item-actions">',
              '<button type="button" class="x-action-menu-trigger" aria-label="Aksi banner ' + esc(b.title || ('Slide ' + (idx + 1))) + '" onclick="XentraActionMenu.open(this, [' +
                '{ label: \'Hapus Banner\', icon: \'🗑️\', destructive: true, onClick: function() { deleteBannerSlide(\'' + esc(b.id) + '\'); } }' +
              '])">',
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
              '</button>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  async function deleteBannerSlide(id) {
    if (!await confirmFeatureAction('delete-banner-slide', 'Hapus Slide Banner', 'Hapus slide banner ini?', 'Hapus')) return;
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
  }

  var moduleApi = {
    loadBrandSettings: loadBrandSettings,
    applyBrandToUI: applyBrandToUI,
    updateLiveMockupPreview: updateLiveMockupPreview,
    doUploadBrandLogo: doUploadBrandLogo,
    doUploadPwaLauncherIcon: doUploadPwaLauncherIcon,
    initBrandListeners: initBrandListeners,
    renderBannersList: renderBannersList,
    deleteBannerSlide: deleteBannerSlide
  };

  window.XentraBrandModule = moduleApi;
  window.loadBrandSettings = loadBrandSettings;
  window.applyBrandToUI = applyBrandToUI;
  window.updateLiveMockupPreview = updateLiveMockupPreview;
  window.doUploadBrandLogo = doUploadBrandLogo;
  window.doUploadPwaLauncherIcon = doUploadPwaLauncherIcon;
  window.initBrandListeners = initBrandListeners;
  window.renderBannersList = renderBannersList;
  window.deleteBannerSlide = deleteBannerSlide;

})(window, document);
