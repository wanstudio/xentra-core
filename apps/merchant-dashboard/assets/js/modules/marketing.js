/**
 * XENTRA OWNER DASHBOARD — MARKETING, BANNERS & PROMOTIONS MODULE
 * Standalone modular controller for Storefront Banners, Promos, Discounts, and Campaigns.
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

  function getEffectiveBranchId() {
    if (typeof window.getEffectiveBranchId === 'function') return window.getEffectiveBranchId();
    var b = window._branchContextState;
    return (b && b.selected !== 'all') ? b.selected : '';
  }

  function getStoredUser() {
    if (window.XentraShared && typeof window.XentraShared.getStoredUser === 'function') {
      return window.XentraShared.getStoredUser() || {};
    }
    if (window.XentraAuthModule && typeof window.XentraAuthModule.getStoredUser === 'function') {
      return window.XentraAuthModule.getStoredUser() || {};
    }
    return {};
  }
  window.getStoredUser = getStoredUser;

  function goBackFromChildPage() {
    if (typeof window.goBackFromChildPage === 'function') return window.goBackFromChildPage();
    if (window.history.length > 1) window.history.back();
  }

  function isBranchManager() {
    if (window.XentraShared && typeof window.XentraShared.isBranchManager === 'function') {
      return window.XentraShared.isBranchManager();
    }
    var user = getStoredUser();
    return !!(user && user.role === 'branch_manager');
  }

  async function confirmFeatureAction(id, title, message, okLabel) {
    if (window.XentraUI && window.XentraUI.Modal && typeof window.XentraUI.Modal.confirm === 'function') {
      return window.XentraUI.Modal.confirm({ title: title, message: message, confirmText: okLabel });
    }
    if (window.XentraPresentation && typeof window.XentraPresentation.confirm === 'function') {
      return window.XentraPresentation.confirm({ id: id, title: title, message: message, okLabel: okLabel });
    }
    if (typeof window.confirmFeatureAction === 'function') {
      return window.confirmFeatureAction(id, title, message, okLabel);
    }
    return window.confirm(message);
  }

  function openExistingCardInPresentation(modalId, cardId, mode) {
    if (window.openExistingCardInPresentation) {
      return window.openExistingCardInPresentation(modalId, cardId, mode);
    }
    var el = $(modalId);
    if (el) el.style.display = 'block';
  }
  var _activeMarketingSubtab = 'promotions';

  function switchMarketingSection(subtab, updateHash) {
    if (!subtab) subtab = 'overview';
    _activeMarketingSubtab = subtab;

    if (updateHash !== false) {
      navigateTo('marketing/' + subtab);
      return;
    }

    // Toggle subnav tabs active class
    document.querySelectorAll('#marketing-subnav-tabs .x-subnav-tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.subtab === subtab);
    });

    // Toggle subviews
    var views = {
      'overview': 'marketing-view-overview',
      'promotions': 'marketing-view-promotions',
      'discounts': 'marketing-view-discounts',
      'banners': 'marketing-view-banners',
      'affiliate': 'marketing-view-affiliate',
      'campaigns': 'marketing-view-campaigns',
      'loyalty': 'marketing-view-loyalty'
    };

    Object.keys(views).forEach(function (key) {
      var el = $(views[key]);
      if (el) el.style.display = (key === subtab) ? '' : 'none';
    });

    // Load data for subtab
    if (subtab === 'overview') loadMarketingOverview();
    else if (subtab === 'promotions') loadMarketingPromotions();
    else if (subtab === 'banners') renderMarketingBannersSkeleton();
    else if (subtab === 'affiliate') loadMarketingAffiliate();
  }
  window.switchMarketingSection = switchMarketingSection;

  function loadMarketingCurrentSubtab() {
    switchMarketingSection(_activeMarketingSubtab, false);
  }
  window.loadMarketingCurrentSubtab = loadMarketingCurrentSubtab;


  /* =========================================================================
     MARKETING — STOREFRONT BANNER DELEGATION
     Banner domain extracted to assets/js/modules/marketing-banners.js
     ========================================================================= */
  function renderMarketingBannersSkeleton() {
    if (window.XentraMarketingBanners && typeof window.XentraMarketingBanners.initializeMarketingBanners === 'function') {
      window.XentraMarketingBanners.initializeMarketingBanners();
    } else if (typeof window.initializeMarketingBanners === 'function') {
      window.initializeMarketingBanners();
    } else if (typeof window.renderMarketingBannersSkeleton === 'function' && window.renderMarketingBannersSkeleton !== renderMarketingBannersSkeleton) {
      window.renderMarketingBannersSkeleton();
    }
  }
  function loadMarketingBanners() {
    if (window.XentraMarketingBanners && typeof window.XentraMarketingBanners.loadMarketingBanners === 'function') {
      return window.XentraMarketingBanners.loadMarketingBanners();
    }
  }
  if (!window.loadMarketingBanners) {
    window.loadMarketingBanners = loadMarketingBanners;
  }

  async function loadMarketingOverview() {
    try {
      var branchId = getEffectiveBranchId();
      var query = branchId && branchId !== 'all' ? '?branch_id=' + encodeURIComponent(branchId) : '';
      var res = await adminFetch('/api/v1/admin/marketing/overview' + query, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var json = await res.json();
      if (!json.success || !json.data) return;

      var cm = json.data.customer_metrics || {};
      var pm = json.data.promotion_metrics || {};

      var totalCustEl = $('mkt-total-customers');
      var retCustEl = $('mkt-returning-customers');
      var repRateSubEl = $('mkt-repeat-rate-sub');
      var activePromoEl = $('mkt-active-promotions');
      var totalPromoSubEl = $('mkt-total-promotions-sub');
      var totalRedEl = $('mkt-total-redemptions');
      var benefitSubEl = $('mkt-benefit-sub');

      if (totalCustEl) totalCustEl.textContent = cm.total_customers || 0;
      if (retCustEl) retCustEl.textContent = cm.returning_customers || 0;
      if (repRateSubEl) repRateSubEl.textContent = 'Repeat rate: ' + (cm.repeat_purchase_rate_pct || 0) + '%';
      if (activePromoEl) activePromoEl.textContent = pm.active_promotions || 0;
      if (totalPromoSubEl) totalPromoSubEl.textContent = (pm.total_promotions || 0) + ' program terdaftar';
      if (totalRedEl) totalRedEl.textContent = pm.total_redemptions || 0;
      if (benefitSubEl) benefitSubEl.textContent = 'Total manfaat: ' + formatMoney(pm.total_benefit_amount || 0);

      var tbody = $('tbody-mkt-recent-redemptions');
      if (tbody) {
        var recs = json.data.recent_redemptions || [];
        if (recs.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Belum ada klaim promosi yang tercatat.</td></tr>';
        } else {
          var rows = recs.map(function (r) {
            var timeText = r.redeemed_at ? esc(r.redeemed_at.substring(0, 19).replace('T', ' ')) : '—';
            return '<tr>' +
              '<td><strong>' + esc(r.promotion_name || 'Program Promosi') + '</strong></td>' +
              '<td><a href="#orders/' + encodeURIComponent(r.order_id) + '" style="font-weight:600;color:var(--primary);text-decoration:none;">#' + esc(r.order_id) + '</a></td>' +
              '<td>' + esc(r.branch_name || 'Cabang Utama') + '</td>' +
              '<td><code style="font-size:12px;background:#f8fafc;padding:2px 6px;border-radius:4px;">' + esc(r.customer_phone || '—') + '</code></td>' +
              '<td><span style="color:#059669;font-weight:700;">' + formatMoney(r.benefit_amount || 0) + '</span></td>' +
              '<td style="font-size:12px;color:#64748b;">' + timeText + '</td>' +
            '</tr>';
          });
          tbody.innerHTML = rows.join('');
        }
      }
    } catch (err) {
      console.error('[Load Marketing Overview Error]:', err);
      showToast('Gagal memuat ringkasan marketing.');
    }
  }
  window.loadMarketingOverview = loadMarketingOverview;

  var _marketingPromotionsState = {
    promotions: [],
    masterMenus: [],
    branches: [],
    menusLoadStatus: 'idle', // 'idle' | 'loading' | 'success' | 'error'
    menusLoadError: null
  };

  async function loadMarketingPromotions() {
    try {
      var tbody = $('tbody-mkt-promotions');
      if (!tbody) return;

      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Memuat daftar promosi...</td></tr>';

      var res = await adminFetch('/api/v1/admin/marketing/promotions', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var json = await res.json();
      if (!json.success || !json.promotions) return;

      var promos = json.promotions || [];
      _marketingPromotionsState.promotions = promos;

      var user = getStoredUser();
      var isOwner = user && user.role === 'owner';

      if (promos.length === 0) {
        var createFirstBtn = isOwner ? '<button type="button" class="x-btn-primary" onclick="openCreatePromotionModal()" style="font-size:12px;padding:6px 14px;">Buat Promo Pertama</button>' : '';
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8">' +
          '<div style="font-size:36px;margin-bottom:8px;">🎁</div>' +
          '<div style="font-weight:700;color:var(--text-main);margin-bottom:4px;">Belum Ada Program Promosi</div>' +
          '<p class="text-muted" style="font-size:12px;margin:0 0 12px;">' + (isOwner ? 'Mulai buat promosi pertama seperti Insentif Instalasi PWA untuk mendorong retensi pelanggan.' : 'Belum ada program promosi.') + '</p>' +
          createFirstBtn +
          '</td></tr>';
        return;
      }

      var nowIso = new Date().toISOString();
      var rows = promos.map(function (p) {
        var statusBadge = '';
        if (p.is_active !== 1 && p.is_active !== true) {
          statusBadge = '<span class="x-badge" style="background:#f1f5f9;color:#64748b;font-weight:600;">Nonaktif</span>';
        } else if (p.start_at && p.start_at > nowIso) {
          statusBadge = '<span class="x-badge" style="background:#fef3c7;color:#b45309;font-weight:700;">Terjadwal</span>';
        } else if (p.end_at && p.end_at < nowIso) {
          statusBadge = '<span class="x-badge" style="background:#fee2e2;color:#b91c1c;font-weight:700;">Berakhir</span>';
        } else {
          statusBadge = '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:700;">Aktif</span>';
        }

        // Format Reward summary
        var rewardSummary = '—';
        if (Array.isArray(p.rewards) && p.rewards.length > 0) {
          var r0 = p.rewards[0];
          if (r0.reward_type === 'freebie_product') {
            rewardSummary = '<span style="font-weight:600;color:#0369a1;">🎁 ' + esc(r0.target_menu_title || r0.target_menu_id || r0.target_product_name || r0.target_product_id || 'Menu Gratis') + '</span>';
          } else {
            rewardSummary = esc(r0.reward_type);
          }
        }

        // Format Branch Scopes summary
        var scopeSummary = '<span class="x-badge" style="background:#f1f5f9;color:#475569;font-size:11px;">Semua Cabang</span>';
        if (Array.isArray(p.scopes) && p.scopes.length > 0) {
          var activeScopes = p.scopes.filter(function (s) { return s.is_active === 1; });
          scopeSummary = '<span class="x-badge" style="background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:600;">' +
            activeScopes.length + ' Cabang Aktif</span>';
        }

        // Capability display
        var capLabel = esc(p.capability_type || 'general');
        if (p.capability_type === 'install_incentive') capLabel = '📱 Insentif PWA';
        else if (p.capability_type === 'first_order') capLabel = '🥇 First Order';

        var isPromoActive = p.is_active === 1 || p.is_active === true;
        var toggleSwitch = '' +
          '<div style="display:inline-flex;align-items:center;gap:8px;">' +
            '<label class="x-toggle x-toggle-compact' + (isPromoActive ? ' x-toggle-on' : '') + '" title="' + (isPromoActive ? 'Promosi aktif' : 'Promosi nonaktif') + '">' +
              '<input type="checkbox" ' + (isPromoActive ? 'checked' : '') + ' onchange="toggleMarketingPromotionActive(\'' + esc(p.id) + '\', this.checked ? 1 : 0)" aria-label="Status aktif promosi ' + esc(p.name) + '">' +
              '<span class="x-toggle-slider"></span>' +
            '</label>' +
            statusBadge +
          '</div>';

        return '<tr>' +
          '<td><strong>' + esc(p.name) + '</strong>' + (p.code ? ' <code style="font-size:11px;background:#f1f5f9;padding:2px 4px;border-radius:4px;">' + esc(p.code) + '</code>' : '') + '</td>' +
          '<td><span class="x-badge" style="background:#f0f9ff;color:#0369a1;font-size:11px;">' + capLabel + '</span><br><code style="font-size:10px;color:#64748b;">' + esc(p.stacking_policy) + '</code></td>' +
          '<td>' + rewardSummary + '</td>' +
          '<td>' + scopeSummary + '</td>' +
          '<td><strong>' + (p.redemptions_count || 0) + '</strong> klaim</td>' +
          '<td>' + toggleSwitch + '</td>' +
          '<td class="text-right" style="white-space:nowrap;">' +
            '<div class="x-item-actions">' +
              '<button type="button" class="x-action-menu-trigger" aria-label="Aksi promosi ' + esc(p.name) + '" onclick="XentraActionMenu.open(this, [' +
                (isOwner ? '{ label: \'Edit Promosi\', icon: \'✏️\', onClick: function() { openEditPromotionModal(\'' + esc(p.id) + '\'); } },' : '') +
                '{ label: \'' + (isPromoActive ? 'Nonaktifkan' : 'Aktifkan') + '\', icon: \'' + (isPromoActive ? '⏸️' : '▶️') + '\', onClick: function() { toggleMarketingPromotionActive(\'' + esc(p.id) + '\', ' + (isPromoActive ? 0 : 1) + '); } }' +
                (isOwner ? ', { divider: true }, { label: \'Hapus Promosi\', icon: \'🗑️\', destructive: true, onClick: function() { deleteMarketingPromotion(\'' + esc(p.id) + '\'); } }' : '') +
              '])">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>' +
              '</button>' +
            '</div>' +
          '</td>' +
        '</tr>';
      });

      tbody.innerHTML = rows.join('');
    } catch (err) {
      console.error('[Load Marketing Promotions Error]:', err);
      showToast('Gagal memuat daftar promosi.');
    }
  }
  window.loadMarketingPromotions = loadMarketingPromotions;

  async function ensureMarketingDependenciesLoaded(forceReload) {
    var selectEl = $('mkt-promo-target-menu');
    var retryContainer = $('mkt-promo-target-menu-retry-container');

    if (!forceReload && _marketingPromotionsState.masterMenus.length > 0 && _marketingPromotionsState.branches.length > 0) {
      return;
    }

    if (forceReload || !_marketingPromotionsState.masterMenus.length) {
      _marketingPromotionsState.menusLoadStatus = 'loading';
      _marketingPromotionsState.menusLoadError = null;
      if (selectEl) {
        selectEl.disabled = true;
        selectEl.innerHTML = '<option value="">Memuat Menu Master...</option>';
      }
      if (retryContainer) retryContainer.style.display = 'none';

      try {
        var mRes = await adminFetch(API_BASE + '/admin/menus?status=ACTIVE', { headers: getAuthHeaders() });
        if (!mRes.ok) {
          throw new Error('Gagal memuat Menu Master (HTTP ' + mRes.status + ')');
        }
        var mData = await mRes.json();
        if (!mData || !mData.success) {
          throw new Error((mData && mData.error) || 'Gagal memuat Menu Master dari server.');
        }
        _marketingPromotionsState.masterMenus = Array.isArray(mData.menus) ? mData.menus : [];
        _marketingPromotionsState.menusLoadStatus = 'success';
      } catch (err) {
        console.error('[Marketing Menus Load Error]:', err);
        _marketingPromotionsState.menusLoadStatus = 'error';
        _marketingPromotionsState.menusLoadError = err.message || 'Gagal memuat Menu Master';
      }
    }

    if (forceReload || !_marketingPromotionsState.branches.length) {
      try {
        var bRes = await adminFetch(API_BASE + '/admin/branches', { headers: getAuthHeaders() });
        if (bRes.ok) {
          var bData = await bRes.json();
          _marketingPromotionsState.branches = (bData && (bData.branches || bData.data)) || [];
        }
      } catch (e) {
        console.warn('[Marketing Branches Load Warn]:', e);
      }
    }
  }

  function promotionMenuLabel(menu) {
    if (!menu) return 'Menu Promo';
    var name = menu.package_name || '';
    if (!name) {
      var parts = [];
      if (menu.sub_category_name) parts.push(menu.sub_category_name);
      if (menu.rasa_name && String(menu.rasa_name).trim().toLowerCase() !== 'original') {
        parts.push(menu.rasa_name);
      }
      name = parts.join(' — ') || ('Menu ' + menu.id);
    }
    var typeLabel = String(menu.menu_type || '').toUpperCase() === 'PACKAGE' ? 'Paket' : 'Satuan';
    var price = menu.selling_price !== undefined && menu.selling_price !== null
      ? ' (' + formatMoney(menu.selling_price) + ')'
      : '';
    return name + ' · ' + typeLabel + price;
  }

  function renderPromoMenuOptions(selectedMenuId) {
    var selectEl = $('mkt-promo-target-menu');
    var retryContainer = $('mkt-promo-target-menu-retry-container');
    if (!selectEl) return;

    if (_marketingPromotionsState.menusLoadStatus === 'error') {
      selectEl.disabled = true;
      selectEl.innerHTML = '<option value="">Gagal memuat Menu Master</option>';
      if (retryContainer) retryContainer.style.display = 'block';
      return;
    }

    if (retryContainer) retryContainer.style.display = 'none';

    if (_marketingPromotionsState.menusLoadStatus === 'loading') {
      selectEl.disabled = true;
      selectEl.innerHTML = '<option value="">Memuat Menu Master...</option>';
      return;
    }

    var menus = _marketingPromotionsState.masterMenus || [];
    if (!menus.length) {
      selectEl.disabled = true;
      selectEl.innerHTML = '<option value="">Belum ada Menu Master aktif</option>';
      return;
    }

    selectEl.disabled = false;
    var html = '<option value="">-- Pilih Menu Hadiah --</option>';
    var foundSavedMenu = false;

    menus.forEach(function (menu) {
      var isSel = selectedMenuId !== null && selectedMenuId !== undefined &&
        String(menu.id) === String(selectedMenuId);
      if (isSel) foundSavedMenu = true;
      html += '<option value="' + esc(menu.id) + '"' + (isSel ? ' selected' : '') + '>' +
        esc(promotionMenuLabel(menu)) + '</option>';
    });

    if (selectedMenuId && !foundSavedMenu) {
      html = '<option value="' + esc(selectedMenuId) + '" selected disabled style="color:#ef4444;">⚠️ Menu reward tersimpan tidak lagi aktif/tersedia (ID: ' + esc(selectedMenuId) + ')</option>' + html;
    }

    selectEl.innerHTML = html;
  }

  async function retryLoadPromoMenus() {
    await ensureMarketingDependenciesLoaded(true);
    var targetInput = $('mkt-promo-target-menu');
    var currentVal = targetInput ? targetInput.value : null;
    renderPromoMenuOptions(currentVal);
    onPromotionProductSelected();
  }
  window.retryLoadPromoMenus = retryLoadPromoMenus;

  function renderPromoBranchCheckboxes(selectedBranchIds) {
    var container = $('mkt-promo-branches-list');
    if (!container) return;

    var branches = _marketingPromotionsState.branches || [];
    if (!branches.length) {
      container.innerHTML = '<span class="text-muted" style="font-size:12px;">Tidak ada cabang ditemukan.</span>';
      return;
    }

    var selSet = {};
    (selectedBranchIds || []).forEach(function (id) { selSet[String(id)] = true; });

    var html = '';
    branches.forEach(function (b) {
      var checked = (selectedBranchIds === null || selectedBranchIds === undefined || selSet[String(b.id)]) ? ' checked' : '';
      html += '<label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;background:#f8fafc;padding:6px 10px;border-radius:6px;border:1px solid #e2e8f0;">' +
        '<input type="checkbox" name="mkt-promo-branch" value="' + esc(b.id) + '"' + checked + '> ' +
        '<span>' + esc(b.name) + '</span>' +
      '</label>';
    });
    container.innerHTML = html;
  }

  function togglePromoSelectAllBranches(checked) {
    var boxes = document.querySelectorAll('input[name="mkt-promo-branch"]');
    boxes.forEach(function (box) { box.checked = Boolean(checked); });
  }
  window.togglePromoSelectAllBranches = togglePromoSelectAllBranches;

  function onPromotionCapabilityChange() {
    var cap = $('mkt-promo-capability').value;
    var nameEl = $('mkt-promo-name');
    var codeEl = $('mkt-promo-code');
    var presBox = $('mkt-promo-presentation-box');
    if (presBox) {
      presBox.style.display = cap === 'install_incentive' ? 'block' : 'none';
    }
    if (cap === 'install_incentive' && (!nameEl.value || nameEl.value.indexOf('Hadiah') !== -1)) {
      if (!nameEl.value) nameEl.value = 'Hadiah Instalasi Aplikasi PWA';
      if (!codeEl.value) codeEl.value = 'PWABANGJO';
    }
  }
  window.onPromotionCapabilityChange = onPromotionCapabilityChange;

  function onPromotionBenefitTypeUiChange(type) {
    var rewardTypeInput = $('mkt-promo-reward-type');
    if (rewardTypeInput) rewardTypeInput.value = type || 'freebie_product';
    var freebieBox = $('mkt-promo-benefit-freebie-box');
    if (freebieBox) {
      freebieBox.style.display = (type === 'freebie_product') ? 'block' : 'none';
    }
  }
  window.onPromotionBenefitTypeUiChange = onPromotionBenefitTypeUiChange;

  function onPromotionProductSelected() {
    var selectEl = $('mkt-promo-target-menu');
    var normalPriceEl = $('mkt-promo-product-normal-price');
    var summaryLabel = document.querySelector('label[for="mkt-promo-target-menu"]');
    if (!selectEl || !normalPriceEl) return;

    var menuId = selectEl.value;
    if (!menuId) {
      normalPriceEl.textContent = '-';
      return;
    }

    var menus = _marketingPromotionsState.masterMenus || [];
    var menu = menus.find(function (item) { return String(item.id) === String(menuId); });
    if (menu && menu.selling_price !== undefined && menu.selling_price !== null) {
      normalPriceEl.textContent = formatMoney(menu.selling_price);
    } else {
      normalPriceEl.textContent = '-';
    }
    if (summaryLabel) summaryLabel.innerHTML = 'Menu yang Diberikan <span style="color:#ef4444;">*</span>';
  }
  window.onPromotionProductSelected = onPromotionProductSelected;

  function updatePromotionPresentationPreview() {
    var titleInput = $('mkt-promo-banner-title');
    var subtitleInput = $('mkt-promo-banner-subtitle');
    var ctaInput = $('mkt-promo-cta-text');
    var iconUrlInput = $('mkt-promo-icon-url');

    var title = (titleInput && titleInput.value.trim()) || 'Install sekarang & dapatkan promo spesial';
    var subtitle = (subtitleInput && subtitleInput.value.trim()) || 'syarat & ketentuan berlaku';
    var ctaText = (ctaInput && ctaInput.value.trim()) || 'Install';
    var iconUrl = (iconUrlInput && iconUrlInput.value.trim()) || '/assets/pwa/icon-192.png';

    var liveTitle = $('mkt-promo-live-title');
    var liveSubtitle = $('mkt-promo-live-subtitle');
    var liveCtaBtn = $('mkt-promo-live-cta-btn');
    var liveIcon = $('mkt-promo-live-icon');
    var previewIcon = $('mkt-promo-icon-preview');

    if (liveTitle) liveTitle.textContent = title;
    if (liveSubtitle) liveSubtitle.textContent = subtitle;
    if (liveCtaBtn) liveCtaBtn.textContent = ctaText;
    if (liveIcon) liveIcon.src = iconUrl;
    if (previewIcon) previewIcon.src = iconUrl;
  }
  window.updatePromotionPresentationPreview = updatePromotionPresentationPreview;

  function resetPromotionIconToDefault() {
    var mediaIdInput = $('mkt-promo-media-id');
    var iconUrlInput = $('mkt-promo-icon-url');
    var statusEl = $('mkt-promo-icon-status');

    if (mediaIdInput) mediaIdInput.value = '';
    if (iconUrlInput) iconUrlInput.value = '/assets/pwa/icon-192.png';
    if (statusEl) {
      statusEl.textContent = 'Menggunakan icon default sistem (/assets/pwa/icon-192.png).';
      statusEl.style.color = 'var(--text-muted)';
    }
    updatePromotionPresentationPreview();
  }
  window.resetPromotionIconToDefault = resetPromotionIconToDefault;

  async function onPromotionIconFileSelected(file) {
    if (!file) return;

    var fileInput = $('mkt-promo-icon-file');
    var statusEl = $('mkt-promo-icon-status');
    var mediaIdInput = $('mkt-promo-media-id');
    var iconUrlInput = $('mkt-promo-icon-url');

    var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.indexOf(file.type) === -1) {
      showToast('❌ Format icon tidak didukung. Gunakan JPG, PNG, atau WebP.');
      if (fileInput) fileInput.value = '';
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showToast('Ukuran file maksimal 10 MB.');
      if (fileInput) fileInput.value = '';
      return;
    }

    if (!XentraCropEditor || typeof XentraCropEditor.open !== 'function') {
      showToast('❌ Editor crop tidak tersedia. Upload dibatalkan; gambar tidak diproses tanpa Crop Editor.');
      if (fileInput) fileInput.value = '';
      return;
    }

    XentraCropEditor.open({
      source: file,
      assetType: 'promotion',
      aspectRatio: 1.0,
      title: 'Potong & Posisikan Icon Promo (1:1)',
      onConfirm: async function (cropSpec, previewDataUrl) {
        try {
          await uploadPromotionIconCanonical(file, cropSpec, fileInput, statusEl, mediaIdInput, iconUrlInput, previewDataUrl);
        } catch (_) {}
      },
      onCancel: function () {
        // Batal = discard the newly selected icon; persisted promotion media remains unchanged.
        if (fileInput) fileInput.value = '';
      }
    });
  }

  async function uploadPromotionIconCanonical(file, cropSpec, fileInput, statusEl, mediaIdInput, iconUrlInput, previewDataUrl) {
    try {
      if (statusEl) {
        statusEl.textContent = 'Memproses icon melalui Media System...';
        statusEl.style.color = '#3b82f6';
      }

      var base64 = await new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      var uploadRes = await adminFetch(API_BASE + '/admin/media/upload', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          image_base64: base64,
          mime_type: file.type,
          original_filename: file.name || null,
          asset_type: 'promotion',
          enforce_aspect_ratio: false
        })
      });

      var uploadJson = await uploadRes.json();
      if (!uploadRes.ok || !uploadJson.success || !uploadJson.asset) {
        throw new Error(uploadJson.error || 'Upload media icon gagal.');
      }

      var mediaId = uploadJson.asset.media_id || uploadJson.asset.id;
      if (!mediaId) throw new Error('Media ID tidak dikembalikan server.');

      var procRes = await adminFetch(API_BASE + '/admin/media/' + encodeURIComponent(mediaId) + '/process', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ crop_spec: cropSpec || null })
      });

      var procJson = await procRes.json();
      if (!procRes.ok || !procJson.success || !procJson.asset) {
        throw new Error(procJson.error || 'Proses media icon gagal.');
      }

      var processedAsset = procJson.asset;
      var preview = (processedAsset.variants || []).slice().sort(function (a, b) { return a.width - b.width; }).find(function (v) { return v.width >= 320; }) || (processedAsset.variants || [])[0];
      var iconUrl = preview && preview.url ? preview.url : processedAsset.url;

      if (mediaIdInput) mediaIdInput.value = processedAsset.media_id || processedAsset.id || mediaId;
      if (iconUrlInput) iconUrlInput.value = iconUrl;

      if (statusEl) {
        statusEl.textContent = '✓ Icon diproses otomatis: crop 1:1 + optimasi.';
        statusEl.style.color = '#16a34a';
      }
      updatePromotionPresentationPreview();
      showToast('Icon promosi berhasil diproses melalui Media System.');
    } catch (err) {
      console.error('[Promotion Icon Upload Error]:', err);
      if (statusEl) {
        statusEl.textContent = 'Gagal mengunggah icon: ' + err.message;
        statusEl.style.color = '#ef4444';
      }
      showToast(err.message || 'Gagal memproses file icon.');
      throw err;
    } finally {
      if (fileInput) fileInput.value = '';
    }
  }

  window.onPromotionIconFileSelected = onPromotionIconFileSelected;

  function formatDateTimeLocal(isoStr) {
    if (!isoStr) return '';
    try {
      var d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    } catch (e) {
      return '';
    }
  }

  function ensureOwnerFeatureMobileHeader(page, title, subtitle, backLabel) {
    if (!page) return null;

    var header = page.querySelector('[data-owner-feature-mobile-header]');
    if (!header) {
      header = document.createElement('div');
      header.className = 'x-owner-child-mobile-header';
      header.setAttribute('data-owner-feature-mobile-header', 'true');
      header.innerHTML =
        '<h3 class="x-owner-mobile-page-title">' +
          '<button type="button" class="x-title-back-btn x-owner-mobile-page-back" data-owner-feature-mobile-back aria-label="Kembali">' +
            '<svg class="x-owner-page-back-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>' +
          '</button>' +
          '<span data-owner-feature-mobile-title></span>' +
        '</h3>' +
        '<p class="x-owner-mobile-page-sub" data-owner-feature-mobile-subtitle></p>';

      page.insertBefore(header, page.firstChild);

      var back = header.querySelector('[data-owner-feature-mobile-back]');
      if (back) {
        back.addEventListener('click', function () { goBackFromChildPage(); });
      }
    }

    var titleEl = header.querySelector('[data-owner-feature-mobile-title]');
    var subtitleEl = header.querySelector('[data-owner-feature-mobile-subtitle]');
    var backEl = header.querySelector('[data-owner-feature-mobile-back]');
    if (titleEl) titleEl.textContent = title || '';
    if (subtitleEl) subtitleEl.textContent = subtitle || '';
    if (backEl) backEl.setAttribute('aria-label', backLabel || 'Kembali');

    return header;
  }
  window.ensureOwnerFeatureMobileHeader = ensureOwnerFeatureMobileHeader;

  function mountPromotionEditorPage() {
    var backdrop = $('modal-mkt-promotion');
    var page = $('marketing-promotion-editor-view');
    if (!backdrop || !page) return;
    var card = backdrop.querySelector('.x-modal-card');
    if (!card) {
      card = page.querySelector('.x-modal-card');
    }
    if (!card) return;
    if (card.parentNode !== page) {
      page.appendChild(card);
    }
    ensureOwnerFeatureMobileHeader(
      page,
      $('modal-mkt-promo-title') ? $('modal-mkt-promo-title').textContent : 'Editor Promosi',
      'Atur program promosi, benefit pelanggan, dan tampilan promo.',
      'Kembali ke Marketing'
    );
    card.classList.add('x-feature-page-surface');
    card.style.maxWidth = 'none';
    card.style.width = '100%';
    card.style.maxHeight = 'none';
    card.style.height = 'auto';
    card.style.borderRadius = '14px';
    backdrop.style.display = 'none';
    page.style.display = 'block';
  }
  window.mountPromotionEditorPage = mountPromotionEditorPage;

  function unmountPromotionEditorPage() {
    var backdrop = $('modal-mkt-promotion');
    var page = $('marketing-promotion-editor-view');
    var card = backdrop && backdrop.querySelector('.x-modal-card');
    if (!card && page) card = page.querySelector('.x-modal-card');
    if (card && backdrop) {
      if (card.parentNode !== backdrop) {
        backdrop.appendChild(card);
      }
      card.classList.remove('x-feature-page-surface');
      card.style.maxWidth = '760px';
      card.style.width = '100%';
      card.style.maxHeight = '92vh';
      card.style.height = 'auto';
      card.style.borderRadius = '14px';
      backdrop.style.display = 'none';
    }
    if (page) page.style.display = 'none';
  }
  window.unmountPromotionEditorPage = unmountPromotionEditorPage;

  async function openCreatePromotionModal() {
    var user = getStoredUser();
    if (!user || user.role !== 'owner') {
      showToast('Akses ditolak: Hanya Owner yang berwenang membuat program promosi.');
      return;
    }

    var modal = $('modal-mkt-promotion');
    if (!modal) return;

    $('modal-mkt-promo-title').textContent = 'Buat Program Promosi Baru';
    $('mkt-promo-id').value = '';
    $('mkt-promo-name').value = '';
    $('mkt-promo-code').value = '';
    $('mkt-promo-capability').value = 'install_incentive';
    $('mkt-promo-stacking').value = 'exclusive';
    $('mkt-promo-limit-per-user').value = '1';
    $('mkt-promo-limit-total').value = '';
    $('mkt-promo-status').value = '1';
    if ($('mkt-promo-start-at')) $('mkt-promo-start-at').value = '';
    if ($('mkt-promo-end-at')) $('mkt-promo-end-at').value = '';
    $('mkt-promo-reward-type').value = 'freebie_product';
    if ($('mkt-promo-branches-all')) $('mkt-promo-branches-all').checked = true;

    // Reset Presentation inputs
    if ($('mkt-promo-banner-title')) $('mkt-promo-banner-title').value = '';
    if ($('mkt-promo-banner-subtitle')) $('mkt-promo-banner-subtitle').value = '';
    if ($('mkt-promo-cta-text')) $('mkt-promo-cta-text').value = 'Install';
    if ($('mkt-promo-media-id')) $('mkt-promo-media-id').value = '';
    if ($('mkt-promo-icon-url')) $('mkt-promo-icon-url').value = '/assets/pwa/icon-192.png';
    if ($('mkt-promo-icon-status')) {
      $('mkt-promo-icon-status').textContent = 'JPG, PNG, WebP · Maks. 10 MB · Rasio 1:1';
      $('mkt-promo-icon-status').style.color = '#64748b';
    }

    navigateTo('marketing/promotions/new');
    mountPromotionEditorPage();

    await ensureMarketingDependenciesLoaded();
    renderPromoMenuOptions(null);
    onPromotionProductSelected();
    renderPromoBranchCheckboxes(null); // default all selected
    onPromotionCapabilityChange();
    updatePromotionPresentationPreview();
  }
  window.openCreatePromotionModal = openCreatePromotionModal;

  async function openEditPromotionModal(promoId) {
    var user = getStoredUser();
    if (!user || user.role !== 'owner') {
      showToast('Akses ditolak: Hanya Owner yang berwenang mengubah program promosi.');
      return;
    }

    var modal = $('modal-mkt-promotion');
    if (!modal) return;

    var promo = (_marketingPromotionsState.promotions || []).find(function (p) { return p.id === promoId; });
    if (!promo) {
      showToast('Data promosi tidak ditemukan.');
      return;
    }

    $('modal-mkt-promo-title').textContent = 'Edit Program Promosi';
    $('mkt-promo-id').value = promo.id;
    $('mkt-promo-name').value = promo.name || '';
    $('mkt-promo-code').value = promo.code || '';
    $('mkt-promo-capability').value = promo.capability_type || 'install_incentive';
    $('mkt-promo-stacking').value = promo.stacking_policy || 'exclusive';
    $('mkt-promo-limit-per-user').value = promo.max_redemptions_per_customer || 1;
    $('mkt-promo-limit-total').value = promo.max_redemptions_total || '';
    $('mkt-promo-status').value = promo.is_active === 1 ? '1' : '0';
    if ($('mkt-promo-start-at')) $('mkt-promo-start-at').value = formatDateTimeLocal(promo.start_at);
    if ($('mkt-promo-end-at')) $('mkt-promo-end-at').value = formatDateTimeLocal(promo.end_at);

    var targetMenuId = null;
    var legacyTargetProductId = null;
    var presPayload = {};
    if (Array.isArray(promo.rewards) && promo.rewards.length > 0) {
      var primaryReward = promo.rewards[0];
      targetMenuId = primaryReward.target_menu_id || primaryReward.menu_id || null;
      legacyTargetProductId = primaryReward.target_product_id || null;
      $('mkt-promo-reward-type').value = primaryReward.reward_type || 'freebie_product';
      if (primaryReward.presentation) {
        presPayload = primaryReward.presentation;
      } else if (primaryReward.presentation_payload) {
        try {
          presPayload = typeof primaryReward.presentation_payload === 'string'
            ? JSON.parse(primaryReward.presentation_payload)
            : primaryReward.presentation_payload;
        } catch (_) {}
      }
    }

    // Populate Presentation fields
    if ($('mkt-promo-banner-title')) $('mkt-promo-banner-title').value = presPayload.banner_title || '';
    if ($('mkt-promo-banner-subtitle')) $('mkt-promo-banner-subtitle').value = presPayload.banner_subtitle || '';
    if ($('mkt-promo-cta-text')) $('mkt-promo-cta-text').value = presPayload.cta_text || 'Install';
    if ($('mkt-promo-media-id')) $('mkt-promo-media-id').value = presPayload.media_id || '';
    if ($('mkt-promo-icon-url')) $('mkt-promo-icon-url').value = presPayload.icon_url || '/assets/pwa/icon-192.png';
    if ($('mkt-promo-icon-status')) {
      if (presPayload.media_id) {
        $('mkt-promo-icon-status').textContent = '✓ Menggunakan media kustom (ID: ' + presPayload.media_id + ')';
        $('mkt-promo-icon-status').style.color = '#16a34a';
      } else {
        $('mkt-promo-icon-status').textContent = 'Format: PNG, JPG, WebP. Maks 10MB (Rasio 1:1).';
        $('mkt-promo-icon-status').style.color = '#64748b';
      }
    }

    var selectedBranchIds = [];
    if (Array.isArray(promo.scopes) && promo.scopes.length > 0) {
      selectedBranchIds = promo.scopes.map(function (s) { return s.branch_id; });
    }

    navigateTo('marketing/promotions/' + encodeURIComponent(promoId) + '/edit');
    mountPromotionEditorPage();

    await ensureMarketingDependenciesLoaded();
    renderPromoMenuOptions(targetMenuId);
    onPromotionProductSelected();
    if (!targetMenuId && legacyTargetProductId) {
      showToast('Promo lama masih memakai target Product. Pilih Menu hadiah canonical sebelum menyimpan perubahan.');
    }
    renderPromoBranchCheckboxes(selectedBranchIds.length ? selectedBranchIds : null);
    onPromotionCapabilityChange();
    updatePromotionPresentationPreview();
  }
  window.openEditPromotionModal = openEditPromotionModal;

  function closePromotionModal() {
    unmountPromotionEditorPage();
    navigateTo('marketing/promotions');
  }
  window.closePromotionModal = closePromotionModal;

  async function submitPromotionForm(e) {
    if (e && e.preventDefault) e.preventDefault();

    var submitBtn = $('btn-mkt-submit-promo');
    var promoId = $('mkt-promo-id').value;
    var name = $('mkt-promo-name').value.trim();
    var code = $('mkt-promo-code').value.trim();
    var capability = $('mkt-promo-capability').value;
    var stacking = $('mkt-promo-stacking').value;
    var limitPerUser = parseInt($('mkt-promo-limit-per-user').value, 10) || 1;
    var limitTotal = parseInt($('mkt-promo-limit-total').value, 10) || null;
    var isActive = $('mkt-promo-status').value === '1' ? 1 : 0;
    var startAtVal = $('mkt-promo-start-at') ? $('mkt-promo-start-at').value : '';
    var endAtVal = $('mkt-promo-end-at') ? $('mkt-promo-end-at').value : '';
    var rewardType = $('mkt-promo-reward-type').value;
    var targetMenuId = $('mkt-promo-target-menu').value;

    if (!name) {
      showToast('Nama promosi wajib diisi.');
      return;
    }
    if (!targetMenuId) {
      showToast('Pilih Menu hadiah dari Menu Master.');
      return;
    }

    if (capability === 'install_incentive') {
      var checkBannerTitle = $('mkt-promo-banner-title') ? $('mkt-promo-banner-title').value.trim() : '';
      if (!checkBannerTitle) {
        showToast('Headline banner wajib diisi.');
        return;
      }
    }

    if (startAtVal && endAtVal) {
      var sTime = new Date(startAtVal).getTime();
      var eTime = new Date(endAtVal).getTime();
      if (eTime < sTime) {
        showToast('Tanggal berakhir promosi tidak boleh lebih awal dari tanggal mulai.');
        return;
      }
    }

    var branchBoxes = document.querySelectorAll('input[name="mkt-promo-branch"]:checked');
    var branchIds = Array.from(branchBoxes).map(function (b) { return b.value; });

    var rules = [];
    if (capability === 'install_incentive') {
      rules.push({
        rule_type: 'eligibility',
        rule_payload: {
          requires_pwa_installed: true,
          target_audience: 'anonymous_or_registered',
          first_order_only: true
        }
      });
    } else if (capability === 'first_order') {
      rules.push({
        rule_type: 'eligibility',
        rule_payload: {
          first_order_only: true
        }
      });
    }

    // Build presentation payload
    var bannerTitle = $('mkt-promo-banner-title') ? $('mkt-promo-banner-title').value.trim() : '';
    var bannerSubtitle = $('mkt-promo-banner-subtitle') ? $('mkt-promo-banner-subtitle').value.trim() : '';
    var ctaText = $('mkt-promo-cta-text') ? $('mkt-promo-cta-text').value.trim() : '';
    var mediaId = $('mkt-promo-media-id') ? $('mkt-promo-media-id').value.trim() : '';
    var iconUrl = $('mkt-promo-icon-url') ? $('mkt-promo-icon-url').value.trim() : '';

    var presentationPayload = {
      banner_title: bannerTitle || 'Install sekarang & dapatkan promo spesial',
      banner_subtitle: bannerSubtitle || 'syarat & ketentuan berlaku',
      cta_text: ctaText || 'Install',
      reward_title: 'Selamat! Hadiah spesial untuk pesanan pertamamu!',
      reward_badge_text: '✓ Bonus PWA Aktif (Rp0)',
      media_id: mediaId || null,
      icon_url: iconUrl || '/assets/pwa/icon-192.png'
    };

    var rewards = [{
      reward_type: rewardType,
      target_menu_id: targetMenuId,
      amount_in_cents: 0,
      presentation_payload: presentationPayload
    }];

    var payload = {
      name: name,
      code: code || null,
      capability_type: capability,
      stacking_policy: stacking,
      priority_weight: capability === 'install_incentive' ? 100 : 50,
      max_redemptions_total: limitTotal,
      max_redemptions_per_customer: limitPerUser,
      start_at: startAtVal ? new Date(startAtVal).toISOString() : null,
      end_at: endAtVal ? new Date(endAtVal).toISOString() : null,
      is_active: isActive,
      rules: rules,
      rewards: rewards,
      branch_ids: branchIds
    };

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Menyimpan...';
    }

    try {
      var url = promoId ? ('/api/v1/admin/marketing/promotions/' + encodeURIComponent(promoId)) : '/api/v1/admin/marketing/promotions';
      var method = promoId ? 'PUT' : 'POST';

      var res = await adminFetch(url, {
        method: method,
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error((json && json.error) || 'Gagal menyimpan promosi.');
      }

      showToast(promoId ? 'Promosi berhasil diperbarui.' : 'Program promosi baru berhasil dibuat.');
      closePromotionModal();
      loadMarketingPromotions();
    } catch (err) {
      console.error('[Submit Promotion Error]:', err);
      showToast(err.message || 'Gagal menyimpan promosi.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Simpan Program Promosi';
      }
    }
  }
  window.submitPromotionForm = submitPromotionForm;

  async function toggleMarketingPromotionActive(promoId, newStatus) {
    try {
      var res = await adminFetch('/api/v1/admin/marketing/promotions/' + encodeURIComponent(promoId), {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: newStatus })
      });
      var json = await res.json();
      if (!res.ok || !json.success) throw new Error((json && json.error) || 'Gagal memperbarui status promosi.');

      showToast(newStatus === 1 ? 'Promosi diaktifkan.' : 'Promosi dinonaktifkan.');
      loadMarketingPromotions();
    } catch (err) {
      console.error('[Toggle Marketing Promotion Error]:', err);
      showToast(err.message || 'Gagal mengubah status promosi.');
    }
  }
  window.toggleMarketingPromotionActive = toggleMarketingPromotionActive;

  async function deleteMarketingPromotion(promoId) {
    var user = getStoredUser();
    if (!user || user.role !== 'owner') {
      showToast('Akses ditolak: Hanya Owner yang berwenang menghapus program promosi.');
      return;
    }

    if (!await confirmFeatureAction('delete-promotion', 'Hapus Program Promosi', 'Apakah Anda yakin ingin menghapus program promosi ini? Tindakan ini tidak dapat dibatalkan.', 'Hapus')) return;

    try {
      var res = await adminFetch('/api/v1/admin/marketing/promotions/' + encodeURIComponent(promoId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var json = await res.json();
      if (!res.ok || !json.success) throw new Error((json && json.error) || 'Gagal menghapus promosi.');

      showToast('Promosi berhasil dihapus.');
      loadMarketingPromotions();
    } catch (err) {
      console.error('[Delete Marketing Promotion Error]:', err);
      showToast(err.message || 'Gagal menghapus promosi.');
    }
  }
  window.deleteMarketingPromotion = deleteMarketingPromotion;

  /* =========================================================================
     MARKETING — AFFILIATE & B2C REFERRAL MANAGEMENT
     ========================================================================= */
  async function loadMarketingAffiliate() {
    try {
      var res = await adminFetch(API_BASE + '/admin/affiliate/program', {
        headers: getAuthHeaders()
      });
      var json = await res.json();
      if (res.ok && json.success && json.program) {
        var p = json.program;
        if ($('mkt-aff-status')) $('mkt-aff-status').value = p.is_active ? '1' : '0';
        if ($('mkt-aff-rate')) $('mkt-aff-rate').value = p.commission_rate != null ? p.commission_rate : 5;
        if ($('mkt-aff-min-payout')) $('mkt-aff-min-payout').value = p.min_payout_amount != null ? p.min_payout_amount : 50000;
        if ($('mkt-aff-cookie-days')) $('mkt-aff-cookie-days').value = p.cookie_days != null ? p.cookie_days : 14;
      }
    } catch (err) {
      console.error('[Load Affiliate Program Error]:', err);
    }
    loadMarketingAffiliateMembers();
    loadMarketingAffiliatePayouts();
  }
  window.loadMarketingAffiliate = loadMarketingAffiliate;

  async function saveMarketingAffiliateProgram() {
    var btn = $('btn-save-affiliate-program');
    if (btn) btn.disabled = true;

    try {
      var statusVal = $('mkt-aff-status') ? $('mkt-aff-status').value === '1' : true;
      var rateVal = $('mkt-aff-rate') ? Number($('mkt-aff-rate').value) : 5;
      var minPayoutVal = $('mkt-aff-min-payout') ? Number($('mkt-aff-min-payout').value) : 50000;
      var cookieDaysVal = $('mkt-aff-cookie-days') ? Number($('mkt-aff-cookie-days').value) : 14;

      var res = await adminFetch(API_BASE + '/admin/affiliate/program', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          is_active: statusVal,
          commission_rate: rateVal,
          min_payout_amount: minPayoutVal,
          cookie_days: cookieDaysVal
        })
      });
      var json = await res.json();
      if (!res.ok || !json.success) throw new Error((json && json.error) || 'Gagal menyimpan konfigurasi affiliate.');

      showToast('Konfigurasi program affiliate berhasil disimpan!');
    } catch (err) {
      console.error('[Save Affiliate Program Error]:', err);
      showToast(err.message || 'Gagal menyimpan konfigurasi.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  window.saveMarketingAffiliateProgram = saveMarketingAffiliateProgram;

  async function loadMarketingAffiliatePayouts() {
    var tbody = $('tbody-mkt-aff-payouts');
    if (!tbody) return;

    var filter = $('mkt-aff-payout-filter') ? $('mkt-aff-payout-filter').value : '';
    var url = API_BASE + '/admin/affiliate/payouts' + (filter ? '?status=' + encodeURIComponent(filter) : '');

    try {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Memuat data pencairan komisi...</td></tr>';
      var res = await adminFetch(url, { headers: getAuthHeaders() });
      var json = await res.json();

      var payouts = (json && json.payouts) || [];
      if (payouts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Tidak ada permintaan pencairan dana yang sesuai filter.</td></tr>';
        return;
      }

      var rows = payouts.map(function (p) {
        var statusBadge = '';
        if (p.status === 'PAID') {
          statusBadge = '<span class="x-badge x-badge-success" style="background:#dcfce7;color:#15803d;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">Sudah Ditransfer</span>';
        } else if (p.status === 'REJECTED') {
          statusBadge = '<span class="x-badge x-badge-danger" style="background:#fee2e2;color:#b91c1c;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">Ditolak</span>';
        } else {
          statusBadge = '<span class="x-badge x-badge-warning" style="background:#fef3c7;color:#b45309;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">Menunggu Transfer</span>';
        }

        var customerInfo = '<strong>' + esc(p.customer_name || 'Pelanggan') + '</strong><br><small class="text-muted">' + esc(p.customer_phone || '-') + '</small>';
        var bankInfo = '<strong>' + esc(p.bank_name || '-') + '</strong> · ' + esc(p.bank_account_number || '-') + '<br><small class="text-muted">a.n. ' + esc(p.bank_account_holder || '-') + '</small>';
        var dateFormatted = p.created_at ? new Date(p.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

        var infoNotes = '';
        if (p.status === 'PAID') {
          infoNotes = '<span style="font-size:11.5px;color:#15803d;">Ref: ' + esc(p.transfer_reference || '-') + '</span>';
        } else if (p.status === 'REJECTED') {
          infoNotes = '<span style="font-size:11.5px;color:#b91c1c;">Alasan: ' + esc(p.rejection_reason || '-') + '</span>';
        } else {
          infoNotes = '<span style="font-size:11.5px;color:#64748b;">' + esc(p.notes || '-') + '</span>';
        }

        var actions = '—';
        if (p.status === 'REQUESTED') {
          actions =
            '<div style="display:flex;gap:6px;justify-content:flex-end;">' +
            '  <button type="button" class="x-btn-xs" style="background:#16a34a;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer;" onclick="approveMarketingAffiliatePayout(\'' + esc(p.id) + '\')">Tandai Transfer</button>' +
            '  <button type="button" class="x-btn-xs" style="background:#ef4444;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer;" onclick="rejectMarketingAffiliatePayout(\'' + esc(p.id) + '\')">Tolak</button>' +
            '</div>';
        }

        return (
          '<tr>' +
          '  <td>' + customerInfo + '</td>' +
          '  <td>' + bankInfo + '</td>' +
          '  <td><strong style="color:var(--text-main);font-size:13.5px;">' + formatMoney(p.amount) + '</strong></td>' +
          '  <td><span style="font-size:12px;color:var(--text-muted);">' + dateFormatted + '</span></td>' +
          '  <td>' + statusBadge + '</td>' +
          '  <td>' + infoNotes + '</td>' +
          '  <td class="text-right">' + actions + '</td>' +
          '</tr>'
        );
      }).join('');

      tbody.innerHTML = rows;
    } catch (err) {
      console.error('[Load Affiliate Payouts Error]:', err);
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-danger">Gagal memuat data pencairan komisi: ' + esc(err.message) + '</td></tr>';
    }
  }
  window.loadMarketingAffiliatePayouts = loadMarketingAffiliatePayouts;

  async function approveMarketingAffiliatePayout(payoutId) {
    var refNo = prompt('Masukkan Nomor Referensi Transfer / Resi Bank (Opsional):', 'TRF-' + Date.now().toString().slice(-6));
    if (refNo === null) return; // User cancelled prompt

    try {
      var res = await adminFetch(API_BASE + '/admin/affiliate/payouts/' + encodeURIComponent(payoutId), {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          action: 'APPROVE',
          transfer_reference: refNo.trim() || undefined
        })
      });
      var json = await res.json();
      if (!res.ok || !json.success) throw new Error((json && json.error) || 'Gagal menyetujui pencairan.');

      showToast('Status pencairan berhasil ditandai SUDAH DITRANSFER.');
      loadMarketingAffiliatePayouts();
    } catch (err) {
      console.error('[Approve Payout Error]:', err);
      showToast(err.message || 'Gagal memproses persetujuan pencairan.');
    }
  }
  window.approveMarketingAffiliatePayout = approveMarketingAffiliatePayout;

  async function rejectMarketingAffiliatePayout(payoutId) {
    var reason = prompt('Masukkan alasan penolakan pencairan (dana akan dikembalikan ke saldo mitra):', 'Data nomor rekening tidak valid');
    if (reason === null) return; // User cancelled prompt
    if (!reason.trim()) {
      showToast('Alasan penolakan wajib diisi.');
      return;
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/affiliate/payouts/' + encodeURIComponent(payoutId), {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          action: 'REJECT',
          rejection_reason: reason.trim()
        })
      });
      var json = await res.json();
      if (!res.ok || !json.success) throw new Error((json && json.error) || 'Gagal menolak pencairan.');

      showToast('Pencairan komisi berhasil DITOLAK. Saldo telah dikembalikan ke mitra.');
      loadMarketingAffiliatePayouts();
    } catch (err) {
      console.error('[Reject Payout Error]:', err);
      showToast(err.message || 'Gagal memproses penolakan pencairan.');
    }
  }
  window.rejectMarketingAffiliatePayout = rejectMarketingAffiliatePayout;

  async function loadMarketingAffiliateMembers() {
    var tbody = $('tbody-mkt-aff-members');
    if (!tbody) return;

    var filter = $('mkt-aff-member-filter') ? $('mkt-aff-member-filter').value : '';
    var url = API_BASE + '/admin/affiliate/members' + (filter ? '?status=' + encodeURIComponent(filter) : '');

    try {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Memuat data mitra affiliate...</td></tr>';
      var res = await adminFetch(url, { headers: getAuthHeaders() });
      var json = await res.json();

      var members = (json && json.members) || [];
      if (members.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Tidak ada data pendaftaran mitra yang sesuai filter.</td></tr>';
        return;
      }

      var rows = members.map(function (m) {
        var statusBadge = '';
        if (m.status === 'ACTIVE') {
          statusBadge = '<span class="x-badge bg-green">Aktif</span>';
        } else if (m.status === 'REJECTED') {
          statusBadge = '<span class="x-badge bg-red" title="' + (m.rejection_reason || '') + '">Ditolak</span>';
        } else {
          statusBadge = '<span class="x-badge bg-amber">Menunggu Review</span>';
        }

        var dateStr = m.created_at ? new Date(m.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

        var actions = '';
        if (m.status === 'PENDING') {
          actions =
            '<div style="display:flex;gap:6px;justify-content:flex-end;">' +
            '  <button type="button" class="x-btn-primary" onclick="approveMarketingAffiliateMember(\'' + m.id + '\')" style="padding:4px 10px;font-size:11.5px;background:#16a34a;">Setujui</button>' +
            '  <button type="button" class="x-btn-secondary" onclick="rejectMarketingAffiliateMember(\'' + m.id + '\')" style="padding:4px 10px;font-size:11.5px;color:#ef4444;border-color:#fca5a5;">Tolak</button>' +
            '</div>';
        } else if (m.status === 'ACTIVE') {
          actions =
            '<div style="display:flex;gap:6px;justify-content:flex-end;">' +
            '  <button type="button" class="x-btn-secondary" onclick="rejectMarketingAffiliateMember(\'' + m.id + '\')" style="padding:4px 10px;font-size:11.5px;color:#64748b;">Tangguhkan</button>' +
            '</div>';
        } else if (m.status === 'REJECTED') {
          actions =
            '<div style="display:flex;gap:6px;justify-content:flex-end;">' +
            '  <button type="button" class="x-btn-primary" onclick="approveMarketingAffiliateMember(\'' + m.id + '\')" style="padding:4px 10px;font-size:11.5px;background:#16a34a;">Setujui Ulang</button>' +
            '</div>';
        }

        var custName = m.customer_name || 'Pelanggan';
        var custPhone = m.customer_phone || '-';
        var bankInfo = (m.bank_name || '-') + ' ' + (m.bank_account_number || '-') + '<div style="font-size:11px;color:var(--text-muted);">a.n. ' + (m.bank_account_holder || '-') + '</div>';
        var socialInfo = m.social_media ? ('<b>' + m.social_media + '</b>') : '-';
        if (m.notes) socialInfo += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">"' + m.notes + '"</div>';

        return '<tr>' +
          '<td><strong>' + custName + '</strong><div style="font-size:11px;color:var(--text-muted);">' + custPhone + '</div></td>' +
          '<td>' + socialInfo + '</td>' +
          '<td>' + bankInfo + '</td>' +
          '<td><span style="font-family:monospace;font-weight:700;color:#0284c7;">' + (m.referral_code || '-') + '</span></td>' +
          '<td>' + dateStr + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td class="text-right">' + actions + '</td>' +
        '</tr>';
      }).join('');

      tbody.innerHTML = rows;
    } catch (err) {
      console.error('[Load Affiliate Members Error]:', err);
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Gagal memuat data mitra.</td></tr>';
    }
  }
  window.loadMarketingAffiliateMembers = loadMarketingAffiliateMembers;

  async function approveMarketingAffiliateMember(id) {
    if (!confirm('Setujui calon mitra affiliate ini? Mereka akan mendapatkan link referral aktif dan dapat mulai mengumpulkan komisi.')) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/affiliate/members/' + id + '/approve', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var json = await res.json();
      if (!res.ok || !json.success) throw new Error((json && json.error) || 'Gagal menyetujui mitra.');

      showToast('Mitra affiliate berhasil DISETUJUI!');
      loadMarketingAffiliateMembers();
    } catch (err) {
      console.error('[Approve Member Error]:', err);
      showToast(err.message || 'Gagal menyetujui pendaftaran mitra.');
    }
  }
  window.approveMarketingAffiliateMember = approveMarketingAffiliateMember;

  async function rejectMarketingAffiliateMember(id) {
    var reason = prompt('Masukkan alasan penolakan / penangguhan pendaftaran kemitraan:');
    if (reason === null) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/affiliate/members/' + id + '/reject', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ rejection_reason: reason.trim() || 'Pengajuan belum memenuhi syarat' })
      });
      var json = await res.json();
      if (!res.ok || !json.success) throw new Error((json && json.error) || 'Gagal menolak mitra.');

      showToast('Pendaftaran mitra berhasil ditolak / ditangguhkan.');
      loadMarketingAffiliateMembers();
    } catch (err) {
      console.error('[Reject Member Error]:', err);
      showToast(err.message || 'Gagal memproses penolakan.');
    }
  }
  window.rejectMarketingAffiliateMember = rejectMarketingAffiliateMember;

  window.XentraMarketingModule = {
    switchMarketingSection: switchMarketingSection,
    loadMarketingCurrentSubtab: loadMarketingCurrentSubtab,
    loadMarketingBanners: loadMarketingBanners,
    loadMarketingOverview: loadMarketingOverview,
    loadMarketingPromotions: loadMarketingPromotions,
    loadMarketingAffiliate: loadMarketingAffiliate,
    saveMarketingAffiliateProgram: saveMarketingAffiliateProgram,
    loadMarketingAffiliatePayouts: loadMarketingAffiliatePayouts,
    loadMarketingAffiliateMembers: loadMarketingAffiliateMembers,
    approveMarketingAffiliateMember: approveMarketingAffiliateMember,
    rejectMarketingAffiliateMember: rejectMarketingAffiliateMember,
    mountPromotionEditorPage: mountPromotionEditorPage,
    unmountPromotionEditorPage: unmountPromotionEditorPage
  };

})(window, document);
