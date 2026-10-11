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
        var iconUrl = iconData.merchant_pwa_icon_url || iconData.pos_pwa_icon_url || iconData.url || (previewEl ? previewEl.src : '');
        showToast('✅ Icon PWA berhasil diperbarui.');
        if (previewEl && iconUrl) { previewEl.src = iconUrl; previewEl.style.display = 'block'; }
        if (hiddenEl && iconUrl) hiddenEl.value = iconUrl;
        if (removeBtn) removeBtn.style.display = 'inline-block';
        if (typeof window.loadSettingsProfile === 'function') {
          window.loadSettingsProfile();
        }
      } else {
        showToast('❌ ' + (iconData.error || 'Gagal menyimpan icon.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan saat mengunggah icon PWA.');
    } finally {
      if (pickBtn) { pickBtn.disabled = false; pickBtn.textContent = '📁 Unggah'; }
    }
  }

  async function loadBrandSettings() {
    try {
      var res = await adminFetch(API_BASE + '/admin/brand', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data && data.brand) {
        if (!window.state) window.state = {};
        window.state.brand = data.brand;
        applyBrandToUI(data.brand);
      }
    } catch (e) {
      console.warn('[Dashboard Brand Load Warn]:', e);
    }
  }

  function applyBrandToUI(brand) {
    if (!brand) return;

    if ($('brand-name')) $('brand-name').value = brand.name || 'Bangjo Resto';
    if ($('brand-tagline')) $('brand-tagline').value = brand.tagline || 'Official Online Food Ordering';
    var logoUrl = brand.logo_url || '/assets/pwa/icon-192.png';
    if ($('brand-logo')) $('brand-logo').value = logoUrl;
    if ($('brand-logo-preview')) {
      $('brand-logo-preview').src = logoUrl;
      $('brand-logo-preview').style.display = 'block';
    }
    if ($('brand-logo-empty')) $('brand-logo-empty').style.display = 'none';
    if ($('btn-brand-logo-remove')) $('btn-brand-logo-remove').style.display = (logoUrl && logoUrl !== '/assets/pwa/icon-192.png') ? 'inline-block' : 'none';

    if ($('brand-color')) $('brand-color').value = brand.primary_color || '#b6ff00';
    if ($('brand-color-hex')) $('brand-color-hex').value = brand.primary_color || '#b6ff00';
    if ($('brand-domain')) $('brand-domain').value = brand.custom_domain || 'app.mybangjo.com';

    if ($('dash-brand-title')) $('dash-brand-title').textContent = brand.name || 'Bangjo Resto';
    if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = logoUrl;
    if ($('topbar-brand-name')) $('topbar-brand-name').textContent = brand.name || 'Bangjo Resto';
    var user = getStoredUser();
    if (user && user.role === 'branch_manager' && $('topbar-brand-badge')) {
      $('topbar-brand-badge').style.display = 'none';
    }

    if ($('set-profile-name')) $('set-profile-name').value = brand.name || '';
    if ($('set-profile-tagline')) $('set-profile-tagline').value = brand.tagline || '';
    if ($('set-profile-logo')) $('set-profile-logo').value = logoUrl;
    if ($('set-profile-logo-preview')) {
      $('set-profile-logo-preview').src = logoUrl;
      $('set-profile-logo-preview').style.display = 'block';
    }
    if ($('set-profile-logo-empty')) $('set-profile-logo-empty').style.display = 'none';
    if ($('btn-set-profile-logo-remove')) $('btn-set-profile-logo-remove').style.display = (logoUrl && logoUrl !== '/assets/pwa/icon-192.png') ? 'inline-block' : 'none';
    if ($('btn-set-profile-logo-pick')) $('btn-set-profile-logo-pick').textContent = (logoUrl && logoUrl !== '/assets/pwa/icon-192.png') ? '📁 Ganti Logo' : '📁 Unggah Logo';
    if ($('set-profile-color')) $('set-profile-color').value = brand.primary_color || '#b6ff00';
    if ($('set-profile-color-hex')) $('set-profile-color-hex').value = brand.primary_color || '#b6ff00';
    if ($('set-profile-domain')) $('set-profile-domain').textContent = brand.custom_domain || window.location.host || '-';

    // Installed PWA Identity Override — populate launcher icon previews
    var merchantIconUrl = brand.merchant_pwa_icon_url || null;
    var posIconUrl = brand.pos_pwa_icon_url || null;
    var defaultMerchantIcon = '/merchant-app/assets/icons/icon-192.png';
    var defaultPosIcon = '/assets/pwa/icon-192.png';

    if ($('brand-tab-merchant-icon')) $('brand-tab-merchant-icon').value = merchantIconUrl || '';
    if ($('brand-tab-merchant-icon-preview')) {
      $('brand-tab-merchant-icon-preview').src = merchantIconUrl || defaultMerchantIcon;
      $('brand-tab-merchant-icon-preview').style.display = 'block';
    }
    if ($('brand-tab-merchant-icon-empty')) $('brand-tab-merchant-icon-empty').style.display = 'none';
    if ($('btn-brand-tab-merchant-icon-remove')) $('btn-brand-tab-merchant-icon-remove').style.display = merchantIconUrl ? 'inline-block' : 'none';

    if ($('brand-tab-pos-icon')) $('brand-tab-pos-icon').value = posIconUrl || '';
    if ($('brand-tab-pos-icon-preview')) {
      $('brand-tab-pos-icon-preview').src = posIconUrl || defaultPosIcon;
      $('brand-tab-pos-icon-preview').style.display = 'block';
    }
    if ($('brand-tab-pos-icon-empty')) $('brand-tab-pos-icon-empty').style.display = 'none';
    if ($('btn-brand-tab-pos-icon-remove')) $('btn-brand-tab-pos-icon-remove').style.display = posIconUrl ? 'inline-block' : 'none';

    if ($('set-profile-merchant-icon')) $('set-profile-merchant-icon').value = merchantIconUrl || '';
    if ($('set-profile-merchant-icon-preview')) {
      $('set-profile-merchant-icon-preview').src = merchantIconUrl || defaultMerchantIcon;
      $('set-profile-merchant-icon-preview').style.display = 'block';
    }
    if ($('set-profile-merchant-icon-empty')) $('set-profile-merchant-icon-empty').style.display = 'none';
    if ($('btn-set-profile-merchant-icon-remove')) $('btn-set-profile-merchant-icon-remove').style.display = merchantIconUrl ? 'inline-block' : 'none';

    if ($('set-profile-pos-icon')) $('set-profile-pos-icon').value = posIconUrl || '';
    if ($('set-profile-pos-icon-preview')) {
      $('set-profile-pos-icon-preview').src = posIconUrl || defaultPosIcon;
      $('set-profile-pos-icon-preview').style.display = 'block';
    }
    if ($('set-profile-pos-icon-empty')) $('set-profile-pos-icon-empty').style.display = 'none';
    if ($('btn-set-profile-pos-icon-remove')) $('btn-set-profile-pos-icon-remove').style.display = posIconUrl ? 'inline-block' : 'none';

    // PWA custom name overrides
    var merchantPwaName = brand.merchant_pwa_name || '';
    var posPwaName = brand.pos_pwa_name || '';
    if ($('brand-tab-merchant-pwa-name')) $('brand-tab-merchant-pwa-name').value = merchantPwaName;
    if ($('brand-tab-pos-pwa-name')) $('brand-tab-pos-pwa-name').value = posPwaName;
    if ($('set-profile-merchant-pwa-name')) $('set-profile-merchant-pwa-name').value = merchantPwaName;
    if ($('set-profile-pos-pwa-name')) $('set-profile-pos-pwa-name').value = posPwaName;

    if ($('auth-brand-name')) $('auth-brand-name').textContent = brand.name || 'Bangjo Resto';
    if ($('auth-logo')) $('auth-logo').src = logoUrl;

    // Installed App Identity (PWA Launcher Icon Overrides)
    var merchantIcon = brand.merchant_pwa_icon_url || '';
    if ($('brand-tab-merchant-icon')) $('brand-tab-merchant-icon').value = merchantIcon;
    var defaultMerchantAppIcon = '/merchant-app/assets/icons/icon-192.png';
    var effectiveMerchantIcon = merchantIcon || logoUrl || defaultMerchantAppIcon;
    if ($('brand-tab-merchant-icon-preview')) $('brand-tab-merchant-icon-preview').src = effectiveMerchantIcon;
    var hasCustomMerchant = Boolean(merchantIcon);
    if ($('btn-brand-tab-merchant-icon-remove')) $('btn-brand-tab-merchant-icon-remove').style.display = hasCustomMerchant ? 'inline-block' : 'none';
    if ($('btn-brand-tab-merchant-icon-pick')) $('btn-brand-tab-merchant-icon-pick').textContent = hasCustomMerchant ? '📁 Ganti Icon' : '📁 Unggah Icon';

    var posIcon = brand.pos_pwa_icon_url || '';
    if ($('brand-tab-pos-icon')) $('brand-tab-pos-icon').value = posIcon;
    var defaultPosAppIcon = '/pos/assets/icons/icon-192.png';
    var effectivePosIcon = posIcon || logoUrl || defaultPosAppIcon;
    if ($('brand-tab-pos-icon-preview')) $('brand-tab-pos-icon-preview').src = effectivePosIcon;
    var hasCustomPos = Boolean(posIcon);
    if ($('btn-brand-tab-pos-icon-remove')) $('btn-brand-tab-pos-icon-remove').style.display = hasCustomPos ? 'inline-block' : 'none';
    if ($('btn-brand-tab-pos-icon-pick')) $('btn-brand-tab-pos-icon-pick').textContent = hasCustomPos ? '📁 Ganti Icon' : '📁 Unggah Icon';

    renderBannersList(brand.banners);
    updateLiveMockupPreview(brand.name, logoUrl, brand.primary_color);
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
        loadBrandSettings();
        if (typeof window.loadSettingsProfile === 'function') {
          window.loadSettingsProfile();
        }
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

    if (colorPicker && colorHex && nameInput && logoInput) {
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
    }

    // Swatches
    document.querySelectorAll('.x-swatch').forEach(function (swatch) {
      swatch.addEventListener('click', function () {
        var c = swatch.dataset.color;
        if (colorPicker) colorPicker.value = c;
        if (colorHex) colorHex.value = c;
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
            updateLiveMockupPreview(nameInput ? nameInput.value : '', defaultLogo, colorPicker ? colorPicker.value : '');
            loadBrandSettings();
            if (typeof window.loadSettingsProfile === 'function') {
              window.loadSettingsProfile();
            }
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
          merchant_pwa_icon_url: $('brand-tab-merchant-icon') ? $('brand-tab-merchant-icon').value.trim() : null,
          pos_pwa_icon_url: $('brand-tab-pos-icon') ? $('brand-tab-pos-icon').value.trim() : null,
          merchant_pwa_name: $('brand-tab-merchant-pwa-name') ? $('brand-tab-merchant-pwa-name').value.trim() : undefined,
          pos_pwa_name: $('brand-tab-pos-pwa-name') ? $('brand-tab-pos-pwa-name').value.trim() : undefined,
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
            applyBrandToUI(data.brand);
            if (typeof window.loadSettingsProfile === 'function') {
              window.loadSettingsProfile();
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

    // Brand Tab PWA Launcher Icon Listeners
    var btnPickBrandTabMerchant = $('btn-brand-tab-merchant-icon-pick');
    var fileInputBrandTabMerchant = $('input-brand-tab-merchant-icon-file');
    var btnRemoveBrandTabMerchant = $('btn-brand-tab-merchant-icon-remove');

    if (btnPickBrandTabMerchant && fileInputBrandTabMerchant) {
      btnPickBrandTabMerchant.addEventListener('click', function () { fileInputBrandTabMerchant.click(); });
      fileInputBrandTabMerchant.addEventListener('change', async function () {
        var file = fileInputBrandTabMerchant.files && fileInputBrandTabMerchant.files[0];
        if (!file) return;

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format file tidak didukung. Gunakan JPG, PNG, atau WebP.');
          fileInputBrandTabMerchant.value = '';
          return;
        }
        if (file.size > 10 * 1024 * 1024) {
          showToast('❌ Ukuran file melebihi batas 10 MB.');
          fileInputBrandTabMerchant.value = '';
          return;
        }

        (function (f) {
          var r = new FileReader();
          r.onload = function (ev) {
            if ($('brand-tab-merchant-icon-preview')) { $('brand-tab-merchant-icon-preview').src = ev.target.result; $('brand-tab-merchant-icon-preview').style.display = 'block'; }
            if ($('set-profile-merchant-icon-preview')) { $('set-profile-merchant-icon-preview').src = ev.target.result; $('set-profile-merchant-icon-preview').style.display = 'block'; }
          };
          r.readAsDataURL(f);
        })(file);

        if (!XentraCropEditor || typeof XentraCropEditor.open !== 'function') {
          doUploadPwaLauncherIcon(file, '/admin/brand/merchant-icon',
            $('brand-tab-merchant-icon-preview'), $('brand-tab-merchant-icon'),
            btnRemoveBrandTabMerchant, btnPickBrandTabMerchant);
          fileInputBrandTabMerchant.value = '';
          return;
        }

        XentraCropEditor.open({
          source: file,
          assetType: 'logo',
          aspectRatio: 1.0,
          title: 'Potong Icon Merchant/Owner PWA (1:1)',
          onConfirm: async function (cropSpec, previewDataUrl) {
            try {
              if ($('brand-tab-merchant-icon-preview') && previewDataUrl) { $('brand-tab-merchant-icon-preview').src = previewDataUrl; }
              if ($('set-profile-merchant-icon-preview') && previewDataUrl) { $('set-profile-merchant-icon-preview').src = previewDataUrl; }
              await doUploadPwaLauncherIcon(file, '/admin/brand/merchant-icon',
                $('brand-tab-merchant-icon-preview'), $('brand-tab-merchant-icon'),
                btnRemoveBrandTabMerchant, btnPickBrandTabMerchant, cropSpec);
              loadBrandSettings();
            } finally {
              fileInputBrandTabMerchant.value = '';
            }
          },
          onCancel: function () {
            fileInputBrandTabMerchant.value = '';
          }
        });
      });
    }

    if (btnRemoveBrandTabMerchant) {
      btnRemoveBrandTabMerchant.addEventListener('click', async function () {
        if (!await confirmFeatureAction('remove-merchant-pwa-icon', 'Hapus Icon Merchant/Owner PWA', 'Hapus icon kustom Merchant/Owner PWA dan kembali ke default?', 'Hapus')) return;
        try {
          var res = await adminFetch(API_BASE + '/admin/brand/merchant-icon', {
            method: 'DELETE',
            headers: getAuthHeaders()
          });
          var data = await res.json();
          if (res.ok && data.success) {
            showToast('✅ Icon kustom Merchant/Owner PWA dihapus.');
            loadBrandSettings();
            if (typeof window.loadSettingsProfile === 'function') window.loadSettingsProfile();
          } else {
            showToast('❌ Gagal menghapus icon Merchant PWA.');
          }
        } catch (err) {
          showToast('❌ Kesalahan jaringan.');
        }
      });
    }

    var btnPickBrandTabPos = $('btn-brand-tab-pos-icon-pick');
    var fileInputBrandTabPos = $('input-brand-tab-pos-icon-file');
    var btnRemoveBrandTabPos = $('btn-brand-tab-pos-icon-remove');

    if (btnPickBrandTabPos && fileInputBrandTabPos) {
      btnPickBrandTabPos.addEventListener('click', function () { fileInputBrandTabPos.click(); });
      fileInputBrandTabPos.addEventListener('change', async function () {
        var file = fileInputBrandTabPos.files && fileInputBrandTabPos.files[0];
        if (!file) return;

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format file tidak didukung. Gunakan JPG, PNG, atau WebP.');
          fileInputBrandTabPos.value = '';
          return;
        }
        if (file.size > 10 * 1024 * 1024) {
          showToast('❌ Ukuran file melebihi batas 10 MB.');
          fileInputBrandTabPos.value = '';
          return;
        }

        (function (f) {
          var r = new FileReader();
          r.onload = function (ev) {
            if ($('brand-tab-pos-icon-preview')) { $('brand-tab-pos-icon-preview').src = ev.target.result; $('brand-tab-pos-icon-preview').style.display = 'block'; }
            if ($('set-profile-pos-icon-preview')) { $('set-profile-pos-icon-preview').src = ev.target.result; $('set-profile-pos-icon-preview').style.display = 'block'; }
          };
          r.readAsDataURL(f);
        })(file);

        if (!XentraCropEditor || typeof XentraCropEditor.open !== 'function') {
          doUploadPwaLauncherIcon(file, '/admin/brand/pos-icon',
            $('brand-tab-pos-icon-preview'), $('brand-tab-pos-icon'),
            btnRemoveBrandTabPos, btnPickBrandTabPos);
          fileInputBrandTabPos.value = '';
          return;
        }

        XentraCropEditor.open({
          source: file,
          assetType: 'logo',
          aspectRatio: 1.0,
          title: 'Potong Icon POS PWA (1:1)',
          onConfirm: async function (cropSpec, previewDataUrl) {
            try {
              if ($('brand-tab-pos-icon-preview') && previewDataUrl) { $('brand-tab-pos-icon-preview').src = previewDataUrl; }
              if ($('set-profile-pos-icon-preview') && previewDataUrl) { $('set-profile-pos-icon-preview').src = previewDataUrl; }
              await doUploadPwaLauncherIcon(file, '/admin/brand/pos-icon',
                $('brand-tab-pos-icon-preview'), $('brand-tab-pos-icon'),
                btnRemoveBrandTabPos, btnPickBrandTabPos, cropSpec);
              loadBrandSettings();
            } finally {
              fileInputBrandTabPos.value = '';
            }
          },
          onCancel: function () {
            fileInputBrandTabPos.value = '';
          }
        });
      });
    }

    if (btnRemoveBrandTabPos) {
      btnRemoveBrandTabPos.addEventListener('click', async function () {
        if (!await confirmFeatureAction('remove-pos-pwa-icon', 'Hapus Icon POS PWA', 'Hapus icon kustom POS PWA dan kembali ke default?', 'Hapus')) return;
        try {
          var res = await adminFetch(API_BASE + '/admin/brand/pos-icon', {
            method: 'DELETE',
            headers: getAuthHeaders()
          });
          var data = await res.json();
          if (res.ok && data.success) {
            showToast('✅ Icon kustom POS PWA dihapus.');
            loadBrandSettings();
            if (typeof window.loadSettingsProfile === 'function') window.loadSettingsProfile();
          } else {
            showToast('❌ Gagal menghapus icon POS PWA.');
          }
        } catch (err) {
          showToast('❌ Kesalahan jaringan.');
        }
      });
    }

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
