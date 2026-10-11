/**
 * XENTRA OWNER DASHBOARD — SETTINGS & INTEGRATIONS MODULE
 * Standalone modular controller for Business Profile, Locations, Orders, Payments, Fulfillment, POS, and Security.
 */
(function (window, document) {
  'use strict';

  var S = window.XentraShared || {};
  var $ = S.$ || function (id) { return document.getElementById(id); };
  var esc = S.esc || function (t) { return t || ''; };
  var formatMoney = S.formatMoney || function (v) { return 'Rp ' + Number(v || 0).toLocaleString('id-ID'); };
  var showToast = S.showToast || function (m) { alert(m); };
  var API_BASE = S.API_BASE || '/api/v1';

  function adminFetch(url, options) {
    if (typeof window.adminFetch === 'function') return window.adminFetch(url, options);
    return fetch(url, options);
  }

  function getAuthHeaders(extraHeaders) {
    var headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    var token = localStorage.getItem(S.TOKEN_KEY || 'xentra_merchant_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
  }

  function navigateTo(route) {
    if (typeof window.navigateTo === 'function') return window.navigateTo(route);
    window.location.hash = '#' + route;
  }
    /* =========================================================================
       PHASE 7: SETTINGS & INTEGRATIONS CONTROLLER
       ========================================================================= */
    var _activeSettingsSection = 'business/profile';

    function switchSettingsSection(sectionName, updateHash) {
      var validSections = [
        'business', 'business/profile', 'business/info', 'business/legal',
        'locations',
        'commerce', 'commerce/orders', 'commerce/payments', 'commerce/fulfillment',
        'channels', 'channels/website', 'channels/customer-app', 'channels/pos', 'channels/kiosk',
        'integrations',
        'notifications',
        'security',
        'data-refresh'
      ];

      var sec = sectionName;
      if (sec === 'business') sec = 'business/profile';
      if (sec === 'commerce') sec = 'commerce/orders';
      if (sec === 'channels') sec = 'channels/website';

      if (validSections.indexOf(sec) === -1) {
        sec = 'business/profile';
      }

      _activeSettingsSection = sec;

      // Update sidebar nav button active state
      document.querySelectorAll('.settings-nav-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.settingsSection === sec);
        if (btn.dataset.settingsSection === sec) {
          btn.style.background = '#f1f5f9';
          btn.style.color = 'var(--primary, #059669)';
        } else {
          btn.style.background = 'transparent';
          btn.style.color = '#334155';
        }
      });

      // Show the selected panel
      var panelId = 'settings-panel-' + sec.replace(/\//g, '-');
      document.querySelectorAll('.settings-panel').forEach(function (panel) {
        panel.style.display = panel.id === panelId ? 'block' : 'none';
      });

      if (updateHash !== false) {
        navigateTo('settings/' + sec);
      }

      loadSettingsCurrentSubtab();
    }
    window.switchSettingsSection = switchSettingsSection;

    function loadSettingsCurrentSubtab() {
      var sec = _activeSettingsSection;
      if (sec === 'business/profile') loadSettingsProfile();
      else if (sec === 'business/info') loadSettingsBusinessInfo();
      else if (sec === 'locations') loadSettingsLocations();
      else if (sec === 'commerce/orders') loadSettingsCommerceOrders();
      else if (sec === 'commerce/payments') loadSettingsPayments();
      else if (sec === 'commerce/fulfillment') loadSettingsFulfillment();
      else if (sec === 'channels/website') loadSettingsWebsite();
      else if (sec === 'channels/customer-app') loadSettingsCustomerApp();
      else if (sec === 'channels/pos') loadSettingsPos();
      else if (sec === 'integrations') loadSettingsIntegrations();
      else if (sec === 'security') loadSettingsSecurity();
    }
    window.loadSettingsCurrentSubtab = loadSettingsCurrentSubtab;

    // 1. Business Profile
    async function loadSettingsProfile() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/business/profile', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.profile) return;

        var p = json.profile;
        if ($('set-profile-name')) $('set-profile-name').value = p.name || '';
        if ($('set-profile-tagline')) $('set-profile-tagline').value = p.tagline || '';
        var logoUrl = p.logo_url || '/assets/pwa/icon-192.png';
        if ($('set-profile-logo')) $('set-profile-logo').value = logoUrl;
        if ($('set-profile-logo-preview')) {
          $('set-profile-logo-preview').src = logoUrl;
          $('set-profile-logo-preview').style.display = 'block';
        }
        if ($('set-profile-logo-empty')) $('set-profile-logo-empty').style.display = 'none';
        var hasCustomLogo = Boolean(logoUrl && logoUrl !== '/assets/pwa/icon-192.png');
        if ($('btn-set-profile-logo-remove')) $('btn-set-profile-logo-remove').style.display = hasCustomLogo ? 'inline-block' : 'none';
        if ($('btn-set-profile-logo-pick')) $('btn-set-profile-logo-pick').textContent = hasCustomLogo ? '📁 Ganti Logo' : '📁 Unggah Logo';

        if ($('set-profile-color')) $('set-profile-color').value = p.primary_color || '#b6ff00';
        if ($('set-profile-color-hex')) $('set-profile-color-hex').value = p.primary_color || '#b6ff00';
        if ($('set-profile-domain')) $('set-profile-domain').textContent = p.custom_domain || window.location.host || '-';

        // Installed PWA Identity Override
        var merchantIconUrl = p.merchant_pwa_icon_url || null;
        var posIconUrl = p.pos_pwa_icon_url || null;
        var defaultMerchantIcon = '/merchant-app/assets/icons/icon-192.png';
        var defaultPosIcon = '/assets/pwa/icon-192.png';

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

        // Sync brand tab previews too
        if ($('brand-tab-merchant-icon')) $('brand-tab-merchant-icon').value = merchantIconUrl || '';
        if ($('brand-tab-merchant-icon-preview')) $('brand-tab-merchant-icon-preview').src = merchantIconUrl || defaultMerchantIcon;
        if ($('btn-brand-tab-merchant-icon-remove')) $('btn-brand-tab-merchant-icon-remove').style.display = merchantIconUrl ? 'inline-block' : 'none';
        if ($('brand-tab-pos-icon')) $('brand-tab-pos-icon').value = posIconUrl || '';
        if ($('brand-tab-pos-icon-preview')) $('brand-tab-pos-icon-preview').src = posIconUrl || defaultPosIcon;
        if ($('btn-brand-tab-pos-icon-remove')) $('btn-brand-tab-pos-icon-remove').style.display = posIconUrl ? 'inline-block' : 'none';

        // Sync PWA custom name inputs across Settings and Brand tabs
        var merchantPwaName = p.merchant_pwa_name || '';
        var posPwaName = p.pos_pwa_name || '';
        if ($('set-profile-merchant-pwa-name')) $('set-profile-merchant-pwa-name').value = merchantPwaName;
        if ($('set-profile-pos-pwa-name')) $('set-profile-pos-pwa-name').value = posPwaName;
        if ($('brand-tab-merchant-pwa-name')) $('brand-tab-merchant-pwa-name').value = merchantPwaName;
        if ($('brand-tab-pos-pwa-name')) $('brand-tab-pos-pwa-name').value = posPwaName;
      } catch (err) {
        console.warn('[Load Settings Profile Warn]:', err);
      }
    }
    window.loadSettingsProfile = loadSettingsProfile;

    // Hook settings profile listeners (logo upload & color pickers)
    function initSettingsProfileListeners() {
      var btnPick = $('btn-set-profile-logo-pick');
      var fileInput = $('input-set-profile-logo-file');
      var btnRemove = $('btn-set-profile-logo-remove');

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

          // Immediate optimistic preview before crop editor opens
          (function (f) {
            var r = new FileReader();
            r.onload = function (ev) {
              if ($('set-profile-logo-preview')) { $('set-profile-logo-preview').src = ev.target.result; $('set-profile-logo-preview').style.display = 'block'; }
              if ($('set-profile-logo-empty')) $('set-profile-logo-empty').style.display = 'none';
              if ($('brand-logo-preview')) { $('brand-logo-preview').src = ev.target.result; $('brand-logo-preview').style.display = 'block'; }
              if ($('brand-logo-empty')) $('brand-logo-empty').style.display = 'none';
              if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = ev.target.result;
            };
            r.readAsDataURL(f);
          })(file);

          if (!XentraCropEditor || typeof XentraCropEditor.open !== 'function') {
            (function (f) {
              var r = new FileReader();
              r.onload = function (ev) { doUploadBrandLogo(f, null, ev.target.result, btnPick); };
              r.readAsDataURL(f);
            })(file);
            fileInput.value = '';
            return;
          }

          XentraCropEditor.open({
            source: file,
            assetType: 'logo',
            aspectRatio: 1.0,
            title: 'Potong & Posisikan Logo Brand (1:1)',
            onConfirm: async function (cropSpec, previewDataUrl) {
              try {
                await doUploadBrandLogo(file, cropSpec, previewDataUrl, btnPick);
              } finally {
                fileInput.value = '';
              }
            },
            onCancel: function () {
              // Batal = discard this new file. The persisted logo remains unchanged.
              fileInput.value = '';
            }
          });
        });
      }

      if (btnRemove) {
        btnRemove.addEventListener('click', async function () {
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
              if ($('set-profile-logo')) $('set-profile-logo').value = defaultLogo;
              if ($('set-profile-logo-preview')) $('set-profile-logo-preview').src = defaultLogo;
              btnRemove.style.display = 'none';
              if (btnPick) btnPick.textContent = '📁 Unggah Logo';

              if ($('brand-logo')) $('brand-logo').value = defaultLogo;
              if ($('brand-logo-preview')) $('brand-logo-preview').src = defaultLogo;
              if ($('btn-brand-logo-remove')) $('btn-brand-logo-remove').style.display = 'none';
              if ($('btn-brand-logo-pick')) $('btn-brand-logo-pick').textContent = '📁 Unggah Logo';
              if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = defaultLogo;

              loadBrandSettings();
              loadSettingsProfile();
            } else {
              showToast('❌ Gagal menghapus logo.');
            }
          } catch (err) {
            showToast('❌ Kesalahan jaringan.');
          }
        });
      }

      // Synchronize color picker and hex input in Settings Profile
      var setColor = $('set-profile-color');
      var setColorHex = $('set-profile-color-hex');
      if (setColor && setColorHex) {
        setColor.addEventListener('input', function () {
          setColorHex.value = setColor.value;
        });
        setColorHex.addEventListener('input', function () {
          if (/^#[0-9A-Fa-f]{6}$/.test(setColorHex.value)) {
            setColor.value = setColorHex.value;
          }
        });
      }

      // Settings Panel — Merchant Icon Upload
      var spMerchantPickBtn = $('btn-set-profile-merchant-icon-pick');
      var spMerchantFileInput = $('input-set-profile-merchant-icon-file');
      var spMerchantRemoveBtn = $('btn-set-profile-merchant-icon-remove');
      if (spMerchantPickBtn && spMerchantFileInput) {
        spMerchantPickBtn.addEventListener('click', function () { spMerchantFileInput.click(); });
      }
      if (spMerchantFileInput) {
        spMerchantFileInput.addEventListener('change', async function () {
          var file = spMerchantFileInput.files && spMerchantFileInput.files[0];
          if (!file) return;
          await doUploadPwaLauncherIcon(file, '/admin/brand/merchant-icon',
            $('set-profile-merchant-icon-preview'), $('set-profile-merchant-icon'),
            spMerchantRemoveBtn, $('btn-set-profile-merchant-icon-pick'));
          spMerchantFileInput.value = '';
        });
      }
      if (spMerchantRemoveBtn) {
        spMerchantRemoveBtn.addEventListener('click', async function () {
          if (!await confirmFeatureAction('remove-merchant-pwa-override', 'Hapus Override Icon', 'Hapus override icon Merchant PWA?', 'Hapus')) return;
          try {
            var res = await adminFetch(API_BASE + '/admin/brand/merchant-icon', { method: 'DELETE', headers: getAuthHeaders() });
            var data = await res.json();
            if (res.ok && data.success) {
              showToast('✅ Icon Merchant PWA dihapus.');
              var defaultMerchantIcon = '/merchant-app/assets/icons/icon-192.png';
              if ($('set-profile-merchant-icon')) $('set-profile-merchant-icon').value = '';
              if ($('set-profile-merchant-icon-preview')) $('set-profile-merchant-icon-preview').src = defaultMerchantIcon;
              spMerchantRemoveBtn.style.display = 'none';
              if ($('brand-tab-merchant-icon')) $('brand-tab-merchant-icon').value = '';
              if ($('brand-tab-merchant-icon-preview')) $('brand-tab-merchant-icon-preview').src = defaultMerchantIcon;
              if ($('btn-brand-tab-merchant-icon-remove')) $('btn-brand-tab-merchant-icon-remove').style.display = 'none';
            } else { showToast('❌ Gagal menghapus icon.'); }
          } catch (err) { showToast('❌ Kesalahan jaringan.'); }
        });
      }

      // Settings Panel — POS Icon Upload
      var spPosPickBtn = $('btn-set-profile-pos-icon-pick');
      var spPosFileInput = $('input-set-profile-pos-icon-file');
      var spPosRemoveBtn = $('btn-set-profile-pos-icon-remove');
      if (spPosPickBtn && spPosFileInput) {
        spPosPickBtn.addEventListener('click', function () { spPosFileInput.click(); });
      }
      if (spPosFileInput) {
        spPosFileInput.addEventListener('change', async function () {
          var file = spPosFileInput.files && spPosFileInput.files[0];
          if (!file) return;
          await doUploadPwaLauncherIcon(file, '/admin/brand/pos-icon',
            $('set-profile-pos-icon-preview'), $('set-profile-pos-icon'),
            spPosRemoveBtn, $('btn-set-profile-pos-icon-pick'));
          spPosFileInput.value = '';
        });
      }
      if (spPosRemoveBtn) {
        spPosRemoveBtn.addEventListener('click', async function () {
          if (!await confirmFeatureAction('remove-pos-pwa-override', 'Hapus Override Icon', 'Hapus override icon POS PWA?', 'Hapus')) return;
          try {
            var res = await adminFetch(API_BASE + '/admin/brand/pos-icon', { method: 'DELETE', headers: getAuthHeaders() });
            var data = await res.json();
            if (res.ok && data.success) {
              showToast('✅ Icon POS PWA dihapus.');
              var defaultPosIcon = '/assets/pwa/icon-192.png';
              if ($('set-profile-pos-icon')) $('set-profile-pos-icon').value = '';
              if ($('set-profile-pos-icon-preview')) $('set-profile-pos-icon-preview').src = defaultPosIcon;
              spPosRemoveBtn.style.display = 'none';
              if ($('brand-tab-pos-icon')) $('brand-tab-pos-icon').value = '';
              if ($('brand-tab-pos-icon-preview')) $('brand-tab-pos-icon-preview').src = defaultPosIcon;
              if ($('btn-brand-tab-pos-icon-remove')) $('btn-brand-tab-pos-icon-remove').style.display = 'none';
            } else { showToast('❌ Gagal menghapus icon.'); }
          } catch (err) { showToast('❌ Kesalahan jaringan.'); }
        });
      }
    }


    async function saveSettingsProfile(e) {
      if (e) e.preventDefault();
      var btn = $('btn-save-settings-profile');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Menyimpan...';
      }
      try {
        var rawHex = ($('set-profile-color-hex') && $('set-profile-color-hex').value.trim()) || ($('set-profile-color') && $('set-profile-color').value) || '#b6ff00';
        if (!rawHex.startsWith('#')) rawHex = '#' + rawHex;
        if (/^#[0-9a-fA-F]{3}$/.test(rawHex)) {
          rawHex = '#' + rawHex[1] + rawHex[1] + rawHex[2] + rawHex[2] + rawHex[3] + rawHex[3];
        }
        if (!/^#[0-9a-fA-F]{6}$/.test(rawHex)) {
          showToast('❌ Format warna HEX tidak valid. Gunakan format #RRGGBB (contoh: #FF5500).');
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Simpan Profil';
          }
          return;
        }
        rawHex = rawHex.toUpperCase();

        var merchantPwaVal = ($('set-profile-merchant-icon') && $('set-profile-merchant-icon').value.trim()) || null;
        var posPwaVal = ($('set-profile-pos-icon') && $('set-profile-pos-icon').value.trim()) || null;

        var payload = {
          name: $('set-profile-name').value.trim(),
          tagline: $('set-profile-tagline').value.trim(),
          logo_url: $('set-profile-logo').value.trim(),
          primary_color: rawHex,
          merchant_pwa_icon_url: merchantPwaVal,
          pos_pwa_icon_url: posPwaVal,
          merchant_pwa_name: $('set-profile-merchant-pwa-name') ? $('set-profile-merchant-pwa-name').value.trim() : undefined,
          pos_pwa_name: $('set-profile-pos-pwa-name') ? $('set-profile-pos-pwa-name').value.trim() : undefined
        };

        var res = await adminFetch(API_BASE + '/admin/settings/business/profile', {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var json = await res.json();
        if (json.success) {
          showToast('✅ Profil brand berhasil disimpan.');
          if (json.profile) {
            applyBrandToUI(json.profile);
          }
          loadBrandSettings();
          loadSettingsProfile();
        } else {
          showToast('❌ Gagal: ' + (json.error || 'Terjadi kesalahan.'));
        }
      } catch (err) {
        showToast('❌ Kesalahan jaringan saat menyimpan profil.');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Simpan Profil';
        }
      }
    }
    window.saveSettingsProfile = saveSettingsProfile;

    // 2. Business Info
    async function loadSettingsBusinessInfo() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/business/info', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.info) return;

        var info = json.info;
        if ($('set-info-org-name')) $('set-info-org-name').textContent = info.organization_name || '—';
        if ($('set-info-phone')) $('set-info-phone').textContent = info.contact_phone || info.contact_whatsapp || '—';
        if ($('set-info-address')) $('set-info-address').textContent = info.primary_address || '—';
      } catch (err) {
        console.warn('[Load Business Info Warn]:', err);
      }
    }
    window.loadSettingsBusinessInfo = loadSettingsBusinessInfo;

    // 3. Locations Defaults
    async function loadSettingsLocations() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/locations/defaults', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.defaults) return;

        var defs = json.defaults;
        if ($('set-locations-count')) $('set-locations-count').textContent = defs.branches_count || 0;

        var tbody = $('tbody-set-locations-branches');
        if (tbody) {
          var branches = defs.branches || [];
          if (branches.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Belum ada cabang terdaftar.</td></tr>';
          } else {
            tbody.innerHTML = branches.map(function (b) {
              return '<tr>' +
                '<td><strong>' + esc(b.name) + '</strong></td>' +
                '<td>' + (b.is_active ? '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:700;">Aktif</span>' : '<span class="x-badge" style="background:#f1f5f9;color:#64748b;">Non-aktif</span>') + '</td>' +
                '<td>' + b.max_radius_km + ' km</td>' +
                '<td>' + formatMoney(b.price_per_km) + ' / km</td>' +
                '<td><a href="#branches/' + encodeURIComponent(b.id) + '" style="font-size:12px;font-weight:600;color:var(--primary);text-decoration:none;">Lihat Override Cabang ↗</a></td>' +
              '</tr>';
            }).join('');
          }
        }
      } catch (err) {
        console.warn('[Load Settings Locations Warn]:', err);
      }
    }
    window.loadSettingsLocations = loadSettingsLocations;

    // 4. Commerce Orders
    async function loadSettingsCommerceOrders() {
      try {
        await adminFetch(API_BASE + '/admin/settings/commerce/orders', { headers: getAuthHeaders() });
      } catch (_) {}
    }
    window.loadSettingsCommerceOrders = loadSettingsCommerceOrders;

    // 5. Commerce Payments — Tabbed Provider Interface
    var _activePaymentTab = 'midtrans';

    function switchPaymentTab(tab) {
      _activePaymentTab = tab;
      var midtransBtn = $('payment-tab-midtrans');
      var dokuBtn = $('payment-tab-doku');
      var midtransContent = $('payment-tab-content-midtrans');
      var dokuContent = $('payment-tab-content-doku');

      if (midtransBtn) {
        midtransBtn.style.borderBottomColor = tab === 'midtrans' ? '#0f172a' : 'transparent';
        midtransBtn.style.color = tab === 'midtrans' ? '#0f172a' : '#94a3b8';
        midtransBtn.style.background = tab === 'midtrans' ? '#f8fafc' : 'transparent';
      }
      if (dokuBtn) {
        dokuBtn.style.borderBottomColor = tab === 'doku' ? '#0f172a' : 'transparent';
        dokuBtn.style.color = tab === 'doku' ? '#0f172a' : '#94a3b8';
        dokuBtn.style.background = tab === 'doku' ? '#f8fafc' : 'transparent';
      }
      if (midtransContent) midtransContent.style.display = tab === 'midtrans' ? 'block' : 'none';
      if (dokuContent) dokuContent.style.display = tab === 'doku' ? 'block' : 'none';
    }
    window.switchPaymentTab = switchPaymentTab;

    var _paymentTabInitialised = false;

    async function loadSettingsPayments() {
      try {
        var branchId = getEffectiveBranchId();
        var query = branchId && branchId !== 'all' ? '?branch_id=' + encodeURIComponent(branchId) : '';
        var res = await adminFetch(API_BASE + '/admin/settings/commerce/payments' + query, { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.payment_settings) return;

        var ps = json.payment_settings;
        var scopeBadge = $('set-payment-scope-badge');
        if (scopeBadge) {
          scopeBadge.textContent = ps.has_branch_override ? 'Branch Override Aktif' : 'Brand Default';
          scopeBadge.style.background = ps.has_branch_override ? '#fef3c7' : '#f1f5f9';
          scopeBadge.style.color = ps.has_branch_override ? '#92400e' : '#475569';
        }

        var scopeSel = $('set-payment-scope-select');
        if (scopeSel) {
          scopeSel.innerHTML = '<option value="brand">Seluruh Brand (Default)</option>';
          (state.branches || []).forEach(function (b) {
            var opt = document.createElement('option');
            opt.value = b.id;
            opt.textContent = 'Cabang: ' + b.name;
            scopeSel.appendChild(opt);
          });
          scopeSel.value = (branchId && branchId !== 'all') ? branchId : 'brand';
        }

        var activeProvider = ps.active_provider || '';

        // Tab gateway tidak menampilkan status aktif/nonaktif: pengaturan ini fokus
        // pada penyimpanan kredensial. Aktif/nonaktifnya ada di Finance → Payment Methods.

        // Setiap environment memuat bagiannya SENDIRI — Midtrans hanya menyentuh field
        // Midtrans, DOKU hanya field DOKU. Tidak ada lingkungan yang mengosongkan input
        // milik lingkungan lain.
        gatewayEnvs.midtrans.load(ps);
        gatewayEnvs.doku.load(ps);

        // Tab yang ditampilkan hanya ditentukan sekali, saat halaman pertama dibuka.
        // Memuat ulang setelah menyimpan tidak boleh memindahkan tab yang sedang dilihat.
        if (!_paymentTabInitialised) {
          _paymentTabInitialised = true;
          if (activeProvider) {
            switchPaymentTab(activeProvider);
          }
        }
      } catch (err) {
        console.warn('[Load Settings Payments Warn]:', err);
      }
    }
    window.loadSettingsPayments = loadSettingsPayments;

    function onPaymentScopeChange() {
      loadSettingsPayments();
    }
    window.onPaymentScopeChange = onPaymentScopeChange;

    /**
     * Environment satu provider payment gateway.
     *
     * Tiap provider berdiri sendiri: field yang dibacanya, payload yang dikirimnya,
     * endpoint yang ditujunya, dan cara memuat nilainya. Tidak ada field, jalur kode,
     * maupun endpoint yang dibagi antar provider — menyimpan DOKU tidak membaca,
     * menulis, memuat ulang, atau mengosongkan apa pun milik Midtrans, termasuk yang
     * sedang diketik di tab lain.
     *
     * `provider` sengaja tidak dikirim: menyimpan kredensial bukan tindakan
     * mengaktifkan gateway. Yang mengaktifkan hanya toggle di Finance → Payment Methods.
     */
    function createGatewayEnv(spec) {
      var env = {
        key: spec.key,
        label: spec.label,

        // Hanya field milik provider ini yang dibaca dari DOM.
        buildPayload: function () {
          var payload = {};
          Object.keys(spec.fields).forEach(function (field) {
            var el = $(spec.fields[field]);
            payload[field] = el ? el.value.trim() : '';
          });
          payload[spec.productionKey] = Boolean($(spec.productionField) && $(spec.productionField).checked);
          return payload;
        },

        async save(e) {
          if (e) e.preventDefault();
          var scopeSel = $('set-payment-scope-select');
          var scopeVal = scopeSel ? scopeSel.value : 'brand';
          var payload = this.buildPayload();
          payload.branch_id = scopeVal && scopeVal !== 'brand' ? scopeVal : null;

          try {
            var res = await adminFetch(
              API_BASE + '/admin/settings/commerce/payments/' + spec.key + '/credentials',
              { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(payload) }
            );
            var json = await res.json();
            if (json.success) {
              showToast(json.message || ('Kredensial ' + spec.label + ' berhasil disimpan.'));
              // Hanya environment ini yang disegarkan. Tab lain tidak tersentuh.
              await env.reload();
            } else {
              showToast('Gagal menyimpan kredensial ' + spec.label + ': ' + (json.error || 'Terjadi kesalahan.'));
            }
          } catch (err) {
            showToast('Kesalahan jaringan saat menyimpan kredensial ' + spec.label + '.');
          }
        },

        // Hanya elemen milik provider ini yang disentuh.
        //
        // Kolom yang BUKAN rahasia diisi dengan nilai tersimpan, supaya yang pernah
        // disimpan terlihat di form. Kolom rahasia memang tidak pernah dikirim server,
        // jadi selain dikosongkan, placeholder-nya diberi tanda "sudah tersimpan" —
        // kalau tidak, form tampak kosong dan tamu mengira simpanannya hilang.
        load: function (ps) {
          if (!ps) return;
          Object.keys(spec.fields).forEach(function (field) {
            var el = $(spec.fields[field]);
            if (!el) return;

            if (Object.prototype.hasOwnProperty.call(spec.populated, field)) {
              var value = ps[spec.populated[field]];
              el.value = value || '';
              return;
            }

            el.value = '';
            if (!Object.prototype.hasOwnProperty.call(el, 'xOriginalPlaceholder')) {
              el.xOriginalPlaceholder = el.placeholder || '';
            }
            var configuredFlag = spec.configured[field];
            var isStored = configuredFlag ? Boolean(ps[configuredFlag]) : false;
            el.placeholder = isStored
              ? 'Tersimpan — isi hanya jika ingin mengganti'
              : el.xOriginalPlaceholder;
          });

          var prodEl = $(spec.productionField);
          if (prodEl) prodEl.checked = Boolean(ps[spec.productionKey]);
        },

        reload: async function () {
          try {
            var res = await adminFetch(API_BASE + '/admin/settings/commerce/payments', { headers: getAuthHeaders() });
            var json = await res.json();
            if (json && json.success && json.payment_settings) env.load(json.payment_settings);
          } catch (_) { /* biarkan nilai yang tampil apa adanya */ }
        }
      };
      return env;
    }

    var gatewayEnvs = {
      midtrans: createGatewayEnv({
        key: 'midtrans',
        label: 'Midtrans',
        // field payload → id elemen
        fields: {
          server_key: 'set-payment-server-key',
          client_key: 'set-payment-client-key',
          merchant_id: 'set-payment-merchant-id'
        },
        // field payload → field respons GET yang mengisinya. Server Key tidak ada di
        // sini karena rahasia; Client Key dan Merchant ID publishable, jadi ditampilkan.
        populated: { client_key: 'client_key', merchant_id: 'merchant_id' },
        // field rahasia → flag "sudah tersimpan" dari respons GET.
        configured: { server_key: 'server_key_configured' },
        productionField: 'set-payment-is-production',
        productionKey: 'is_production'
      }),
      doku: createGatewayEnv({
        key: 'doku',
        label: 'DOKU',
        fields: {
          doku_client_id: 'set-payment-doku-client-id',
          doku_secret_key: 'set-payment-doku-secret-key',
          doku_callback_url: 'set-payment-doku-callback-url'
        },
        populated: { doku_client_id: 'doku_client_id', doku_callback_url: 'doku_callback_url' },
        // Hanya secret key yang rahasia; Client ID dan Callback URL ditampilkan.
        configured: { doku_secret_key: 'doku_secret_key_configured' },
        productionField: 'set-payment-doku-is-production',
        productionKey: 'doku_is_production'
      })
    };

    // Dua pintu masuk terpisah, masing-masing milik environment-nya sendiri.
    function saveSettingsPaymentsMidtrans(e) { return gatewayEnvs.midtrans.save(e); }
    function saveSettingsPaymentsDoku(e) { return gatewayEnvs.doku.save(e); }
    window.saveSettingsPaymentsMidtrans = saveSettingsPaymentsMidtrans;
    window.saveSettingsPaymentsDoku = saveSettingsPaymentsDoku;

    // Saling-kunci antar gateway tidak lagi diatur di sini: aturannya ada di
    // Finance → Payment Methods, dan ditegakkan server (satu gateway online aktif).

    // 6. Commerce Fulfillment
    async function loadSettingsFulfillment() {
      try {
        var branchId = getEffectiveBranchId();
        var query = branchId && branchId !== 'all' ? '?branch_id=' + encodeURIComponent(branchId) : '';
        var res = await adminFetch(API_BASE + '/admin/settings/commerce/fulfillment' + query, { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.fulfillment) return;

        var f = json.fulfillment;
        var sel = $('set-ful-branch-select');
        if (sel) {
          sel.innerHTML = '';
          (state.branches || []).forEach(function (b) {
            var opt = document.createElement('option');
            opt.value = b.id;
            opt.textContent = b.name;
            sel.appendChild(opt);
          });
          if (f.branch_id) sel.value = f.branch_id;
        }

        var badge = $('set-ful-branch-badge');
        if (badge) badge.textContent = f.branch_name || 'Cabang Terpilih';

        if ($('set-ful-delivery-active')) $('set-ful-delivery-active').checked = Boolean(f.is_delivery_active);
        if ($('set-ful-pickup-active')) $('set-ful-pickup-active').checked = Boolean(f.is_pickup_active);
        if ($('set-ful-max-radius')) $('set-ful-max-radius').value = f.max_radius_km || 10;
        if ($('set-ful-free-km')) $('set-ful-free-km').value = f.free_delivery_km || 3;
        if ($('set-ful-price-km')) $('set-ful-price-km').value = f.price_per_km || 2500;
      } catch (err) {
        console.warn('[Load Fulfillment Warn]:', err);
      }
    }
    window.loadSettingsFulfillment = loadSettingsFulfillment;

    function onFulfillmentBranchChange() {
      var sel = $('set-ful-branch-select');
      var val = sel ? sel.value : null;
      if (!val) return;
      adminFetch(API_BASE + '/admin/settings/commerce/fulfillment?branch_id=' + encodeURIComponent(val), { headers: getAuthHeaders() })
        .then(function (res) { return res.json(); })
        .then(function (json) {
          if (json.success && json.fulfillment) {
            var f = json.fulfillment;
            var badge = $('set-ful-branch-badge');
            if (badge) badge.textContent = f.branch_name || 'Cabang Terpilih';
            if ($('set-ful-delivery-active')) $('set-ful-delivery-active').checked = Boolean(f.is_delivery_active);
            if ($('set-ful-pickup-active')) $('set-ful-pickup-active').checked = Boolean(f.is_pickup_active);
            if ($('set-ful-max-radius')) $('set-ful-max-radius').value = f.max_radius_km || 10;
            if ($('set-ful-free-km')) $('set-ful-free-km').value = f.free_delivery_km || 3;
            if ($('set-ful-price-km')) $('set-ful-price-km').value = f.price_per_km || 2500;
          }
        });
    }
    window.onFulfillmentBranchChange = onFulfillmentBranchChange;

    async function saveSettingsFulfillment(e) {
      if (e) e.preventDefault();
      try {
        var sel = $('set-ful-branch-select');
        var branchId = sel ? sel.value : null;
        if (!branchId) {
          showToast('Pilih cabang terlebih dahulu.');
          return;
        }

        var payload = {
          branch_id: branchId,
          is_delivery_active: $('set-ful-delivery-active').checked,
          is_pickup_active: $('set-ful-pickup-active').checked,
          max_radius_km: parseFloat($('set-ful-max-radius').value) || 10.0,
          free_delivery_km: parseFloat($('set-ful-free-km').value) || 3.0,
          price_per_km: parseFloat($('set-ful-price-km').value) || 2500.0
        };

        var res = await adminFetch(API_BASE + '/admin/settings/commerce/fulfillment', {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var json = await res.json();
        if (json.success) {
          showToast('Pengaturan pemenuhan cabang berhasil disimpan.');
        } else {
          showToast('Gagal: ' + (json.error || 'Terjadi kesalahan.'));
        }
      } catch (err) {
        showToast('Kesalahan jaringan saat menyimpan pemenuhan.');
      }
    }
    window.saveSettingsFulfillment = saveSettingsFulfillment;

    // 7. Channels: Website, PWA, POS
    async function loadSettingsWebsite() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/channels/website', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.channel) return;
        if ($('set-ch-website-url')) $('set-ch-website-url').textContent = json.channel.url;
        if ($('set-ch-website-link')) $('set-ch-website-link').href = json.channel.url;
      } catch (_) {}
    }
    window.loadSettingsWebsite = loadSettingsWebsite;

    async function loadSettingsCustomerApp() {
      try {
        await adminFetch(API_BASE + '/admin/settings/channels/customer-app', { headers: getAuthHeaders() });
      } catch (_) {}
    }
    window.loadSettingsCustomerApp = loadSettingsCustomerApp;

    async function loadSettingsPos() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/channels/pos', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.channel) return;

        var ch = json.channel;
        if ($('set-pos-shifts-badge')) $('set-pos-shifts-badge').textContent = (ch.active_shifts_count || 0) + ' Shift Aktif';

        var listEl = $('set-pos-shifts-list');
        if (listEl) {
          var shifts = ch.open_shifts || [];
          if (shifts.length === 0) {
            listEl.innerHTML = '<div class="text-muted" style="padding:8px 0;">Tidak ada shift kasir yang sedang aktif saat ini. Shift dimulai saat kasir membuka float kasir di terminal POS.</div>';
          } else {
            listEl.innerHTML = shifts.map(function (s) {
              return '<div style="padding:10px 14px;background:#f8fafc;border-radius:var(--radius-sm);border:1px solid #e2e8f0;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">' +
                '<div><strong>' + esc(s.branch_name) + '</strong> &nbsp;|&nbsp; Kasir: <code>' + esc(s.cashier_id) + '</code></div>' +
                '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:700;">Shift Terbuka</span>' +
              '</div>';
            }).join('');
          }
        }
      } catch (err) {
        console.warn('[Load POS Channel Warn]:', err);
      }
    }
    window.loadSettingsPos = loadSettingsPos;

    // 8. Integrations
    async function loadSettingsIntegrations() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/integrations', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.integrations) return;

        var cont = $('set-integrations-list');
        if (!cont) return;

        cont.innerHTML = json.integrations.map(function (i) {
          var badge = '';
          if (i.status === 'connected') {
            badge = '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:700;">Terhubung</span>';
          } else if (i.status === 'on_hold') {
            badge = '<span class="x-badge" style="background:#f1f5f9;color:#64748b;font-weight:700;">HOLD</span>';
          } else {
            badge = '<span class="x-badge" style="background:#fef3c7;color:#92400e;font-weight:700;">Belum Terhubung</span>';
          }

          var actionBtn = i.is_configurable
            ? '<button type="button" class="x-btn-secondary" style="font-size:12px;padding:6px 12px;" onclick="switchSettingsSection(\'commerce/payments\', true)">Konfigurasi ⚙️</button>'
            : '<span style="font-size:12px;color:#94a3b8;">Sistem Bawaan</span>';

          return '<div style="padding:16px;background:#ffffff;border:1px solid var(--border-color);border-radius:var(--radius-md);display:flex;justify-content:space-between;align-items:center;">' +
            '<div style="max-width:70%;">' +
              '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">' +
                '<strong style="font-size:14px;color:#1e293b;">' + esc(i.name) + '</strong>' +
                badge +
              '</div>' +
              '<div style="font-size:12px;color:#64748b;">' + esc(i.description) + '</div>' +
            '</div>' +
            '<div>' + actionBtn + '</div>' +
          '</div>';
        }).join('');
      } catch (err) {
        console.warn('[Load Integrations Warn]:', err);
      }
    }
    window.loadSettingsIntegrations = loadSettingsIntegrations;

    // 9. Security
    async function loadSettingsSecurity() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/security', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.security) return;

        var sec = json.security;
        var u = sec.current_user || {};
        if ($('set-sec-user')) $('set-sec-user').textContent = u.username || 'User Session';
        if ($('set-sec-role')) $('set-sec-role').textContent = 'Role: ' + (u.role || '—') + (u.branch_id ? ' (Cabang: ' + u.branch_id + ')' : ' (Global)');

        var tbody = $('tbody-set-audit-logs');
        if (tbody) {
          var logs = sec.recent_audit_logs || [];
          if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Belum ada aktivitas keamanan tercatat.</td></tr>';
          } else {
            tbody.innerHTML = logs.map(function (l) {
              var timeStr = l.created_at ? esc(l.created_at.substring(0, 19).replace('T', ' ')) : '—';
              var resBadge = l.result === 'SUCCESS' || l.result === 'success'
                ? '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:700;">SUKSES</span>'
                : '<span class="x-badge" style="background:#fef2f2;color:#b91c1c;font-weight:700;">' + esc(l.result || 'INFO') + '</span>';
              return '<tr>' +
                '<td style="font-size:12px;color:#64748b;">' + timeStr + '</td>' +
                '<td><code>' + esc(l.actor_id || 'system') + '</code> (' + esc(l.actor_role || '-') + ')</td>' +
                '<td><strong>' + esc(l.action) + '</strong></td>' +
                '<td>' + esc(l.target_user_id || '—') + '</td>' +
                '<td>' + resBadge + '</td>' +
              '</tr>';
            }).join('');
          }
        }
      } catch (err) {
        console.warn('[Load Security Warn]:', err);
      }
    }
    window.loadSettingsSecurity = loadSettingsSecurity;
  window.XentraSettingsModule = {
    switchSettingsSection: switchSettingsSection,
    loadSettingsCurrentSubtab: loadSettingsCurrentSubtab,
    loadSettingsProfile: loadSettingsProfile,
    initSettingsProfileListeners: initSettingsProfileListeners,
    loadSettingsBusinessInfo: loadSettingsBusinessInfo,
    loadSettingsLocations: loadSettingsLocations,
    loadSettingsCommerceOrders: loadSettingsCommerceOrders,
    loadSettingsPayments: loadSettingsPayments,
    loadSettingsFulfillment: loadSettingsFulfillment,
    loadSettingsWebsite: loadSettingsWebsite,
    loadSettingsCustomerApp: loadSettingsCustomerApp,
    loadSettingsPos: loadSettingsPos,
    loadSettingsIntegrations: loadSettingsIntegrations,
    loadSettingsSecurity: loadSettingsSecurity
  };

})(window, document);
