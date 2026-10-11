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

  function isBranchManager() {
    if (window.XentraShared && typeof window.XentraShared.isBranchManager === 'function') {
      return window.XentraShared.isBranchManager();
    }
    var user = (window.XentraShared && window.XentraShared.getStoredUser) ? window.XentraShared.getStoredUser() : null;
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
  }
  window.switchMarketingSection = switchMarketingSection;

  function loadMarketingCurrentSubtab() {
    switchMarketingSection(_activeMarketingSubtab, false);
  }
  window.loadMarketingCurrentSubtab = loadMarketingCurrentSubtab;


  /* =========================================================================
     MARKETING — STOREFRONT BANNER MANAGEMENT
     Real dashboard implementation for Banner Content + Assignment/Placement.
     Legacy brands.banners remains a fallback until a Branch uses the new system.
     ========================================================================= */

  var _marketingBannersState = {
    rows: [],
    branches: [],
    promotions: [],
    products: [],
    categories: [],
    branchFilter: ''
  };

  var _marketingBannerEditor = {
    mode: 'create',
    bannerId: null,
    mediaId: null,
    mediaFile: null,
    mediaReady: false,
    cropSpec: null,
    detail: null
  };

  // Re-entrancy guard: blocks concurrent save/publish requests (double click).
  var _marketingBannerSaving = false;

  var _marketingBannerAssignmentEditor = {
    bannerId: null,
    assignmentId: null,
    mode: 'create'
  };

  function getMarketingBannerRowKey(row, index) {
    return String(row.banner_id || row.id || '') + '::' + String(
      row.assignment && row.assignment.id ? row.assignment.id : 'unassigned'
    ) + '::' + String(index || 0);
  }

  function findMarketingBannerRow(key) {
    for (var i = 0; i < _marketingBannersState.rows.length; i++) {
      if (getMarketingBannerRowKey(_marketingBannersState.rows[i], i) === key) {
        return _marketingBannersState.rows[i];
      }
    }
    return null;
  }

  function getMarketingBannerUser() {
    return typeof getStoredUser === 'function' ? (getStoredUser() || {}) : {};
  }

  function isMarketingBannerOwner() {
    var user = getMarketingBannerUser();
    return user.role === 'owner' || user.role === 'brand_manager';
  }

  function isMarketingBannerBranchManager() {
    return getMarketingBannerUser().role === 'branch_manager';
  }

  function bannerDateTimeParts(date, timeZone) {
    try {
      var parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timeZone || 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(new Date(date));

      var out = {};
      parts.forEach(function (part) {
        if (part.type !== 'literal') out[part.type] = part.value;
      });

      return out;
    } catch (_) {
      return null;
    }
  }

  function formatMarketingBannerSchedule(assignment) {
    if (!assignment) return 'Belum ditempatkan';

    var tz = assignment.branch_timezone || assignment.timezone || 'Asia/Jakarta';
    if (!assignment.starts_at && !assignment.ends_at) {
      return 'Tanpa jadwal';
    }

    function one(value) {
      if (!value) return '';
      var p = bannerDateTimeParts(value, tz);
      if (!p) return 'Tanggal tidak valid';
      return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute;
    }

    var start = assignment.starts_at ? one(assignment.starts_at) : '';
    var end = assignment.ends_at ? one(assignment.ends_at) : '';

    if (start && end) return start + ' → ' + end;
    if (start) return 'Mulai ' + start;
    return 'Berakhir ' + end;
  }

  function formatMarketingBannerScheduleWithTz(assignment) {
    var base = formatMarketingBannerSchedule(assignment);
    if (!assignment) return base;
    if (!assignment.starts_at && !assignment.ends_at) return base;
    return base + ' · ' + (assignment.branch_timezone || assignment.timezone || 'Asia/Jakarta');
  }

  function bannerStatusBadge(status) {
    var meta = {
      'DRAFT': { label: 'Draft', cls: 'is-draft' },
      'PUBLISHED': { label: 'Published', cls: 'is-published' },
      'SCHEDULED': { label: 'Terjadwal', cls: 'is-scheduled' },
      'ACTIVE': { label: 'Aktif', cls: 'is-active' },
      'PAUSED': { label: 'Dijeda', cls: 'is-paused' },
      'ENDED': { label: 'Berakhir', cls: 'is-ended' }
    }[String(status || '').toUpperCase()] || { label: status || '—', cls: '' };

    return '<span class="x-marketing-banner-status ' + meta.cls + '">' + esc(meta.label) + '</span>';
  }

  function renderMarketingBannerPreview(row) {
    var src = row && row.media ? row.media.preview_url : null;
    var title = row && row.title ? row.title : 'Banner';

    if (src) {
      return '<div class="x-marketing-banner-preview">' +
        '<img src="' + esc(src) + '" alt="' + esc(title) + '" loading="lazy">' +
      '</div>';
    }

    return '<div class="x-marketing-banner-preview x-marketing-banner-preview-empty">' +
      '<span>🖼️</span>' +
    '</div>';
  }

  function renderMarketingBannerRows() {
    var tbody = $('mkt-banners-table-body');
    if (!tbody) return;

    var rows = _marketingBannersState.rows || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8">' +
        '<div style="font-size:36px;margin-bottom:8px;">🖼️</div>' +
        '<div style="font-weight:700;color:var(--text-main);margin-bottom:4px;">Belum ada Banner</div>' +
        '<p class="text-muted" style="font-size:12px;margin:0 0 14px;">Buat Banner Content pertama, lalu Publish dan tempatkan ke cabang yang diinginkan.</p>' +
        '<button type="button" class="x-btn-primary" onclick="openMarketingBannerCreate()">Tambah Banner</button>' +
      '</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(function (row, index) {
      var key = getMarketingBannerRowKey(row, index);
      var assignment = row.assignment;
      var publicationStatus = String(row.publication_status || 'DRAFT').toUpperCase();
      var effectiveStatus = assignment
        ? String(assignment.effective_status || (publicationStatus === 'PUBLISHED' ? 'ACTIVE' : 'DRAFT')).toUpperCase()
        : publicationStatus;

      var isAssignmentLocked = Boolean(assignment && assignment.governance_locked && isMarketingBannerBranchManager());
      var canToggle = Boolean(assignment) && !isAssignmentLocked;
      var checked = Boolean(assignment && assignment.active);
      var toggleDisabled = canToggle ? '' : ' disabled';

      var branchText = assignment
        ? (assignment.branch_name || assignment.branch_id || 'Cabang')
        : 'Belum ditempatkan';

      var publicationText = publicationStatus === 'PUBLISHED'
        ? (row.has_draft_changes ? 'Published · Ada Draft' : 'Published')
        : 'Draft';

      var visibilityText = !assignment
        ? '—'
        : isAssignmentLocked
          ? 'Dikunci'
          : assignment.effective_status === 'SCHEDULED'
            ? 'Menunggu jadwal'
            : assignment.effective_status === 'ENDED'
              ? 'Jadwal selesai'
              : checked ? 'Play' : 'Pause';

      return '<tr>' +
        '<td data-label="Banner">' +
          '<div class="x-marketing-banner-primary">' +
            renderMarketingBannerPreview(row) +
            '<div class="x-marketing-banner-name">' +
              '<strong>' + esc(row.title || 'Tanpa judul') + '</strong>' +
              bannerStatusBadge(effectiveStatus) +
              (row.has_draft_changes ? '<span class="x-marketing-banner-draft-hint">Ada perubahan Draft</span>' : '') +
            '</div>' +
          '</div>' +
        '</td>' +
        '<td data-label="Placement"><span class="x-marketing-banner-secondary">Homepage Banner</span></td>' +
        '<td data-label="Cabang / Scope"><span class="x-marketing-banner-secondary">' + esc(branchText) + '</span></td>' +
        '<td data-label="Publikasi"><span class="x-marketing-banner-secondary">' + esc(publicationText) + '</span></td>' +
        '<td data-label="Jadwal"><span class="x-marketing-banner-secondary">' + esc(formatMarketingBannerSchedule(assignment)) + '</span></td>' +
        '<td data-label="Visibility">' +
          '<div class="x-marketing-banner-visibility">' +
            (assignment ? (
              '<label class="x-toggle x-toggle-compact" title="' + esc(visibilityText) + '">' +
                '<input type="checkbox" ' + (checked ? 'checked' : '') + toggleDisabled + ' data-banner-toggle-key="' + esc(key) + '" aria-label="' + esc(visibilityText) + '">' +
                '<span class="x-toggle-slider"></span>' +
              '</label>'
            ) : '<span class="x-marketing-banner-no-assignment">—</span>') +
          '</div>' +
        '</td>' +
        '<td class="text-right" data-label="Aksi" style="white-space:nowrap;">' +
          '<div class="x-item-actions">' +
            '<button type="button" class="x-action-menu-trigger" aria-label="Aksi banner ' + esc(row.title || 'Banner') + '" data-banner-action-key="' + esc(key) + '">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('[data-banner-toggle-key]').forEach(function (input) {
      input.addEventListener('change', function () {
        var key = input.getAttribute('data-banner-toggle-key');
        var row = findMarketingBannerRow(key);
        if (!row || !row.assignment) return;
        toggleMarketingBannerAssignment(row.assignment.id, input.checked);
      });
    });

    tbody.querySelectorAll('[data-banner-action-key]').forEach(function (trigger) {
      trigger.addEventListener('click', function () {
        var key = trigger.getAttribute('data-banner-action-key');
        openMarketingBannerActionMenu(trigger, key);
      });
    });
  }

  async function loadMarketingBanners() {
    var tbody = $('mkt-banners-table-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-muted">Memuat Banner...</td></tr>';
    }

    try {
      var query = _marketingBannersState.branchFilter
        ? '?branch_id=' + encodeURIComponent(_marketingBannersState.branchFilter)
        : '';

      var res = await adminFetch(API_BASE + '/admin/marketing/banners' + query, {
        headers: getAuthHeaders()
      });

      var json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal memuat Banner.');
      }

      _marketingBannersState.rows = Array.isArray(json.banners) ? json.banners : [];
      _marketingBannersState.branches = Array.isArray(json.branches) ? json.branches : [];

      populateMarketingBannerBranchFilter();
      renderMarketingBannerRows();

      var legacyNotice = $('mkt-banners-legacy-notice');
      if (legacyNotice) {
        if (json.legacy && json.legacy.fallback_active && Number(json.legacy.count || 0) > 0) {
          legacyNotice.style.display = '';
          legacyNotice.innerHTML =
            '<strong>Legacy banner fallback masih aktif.</strong> ' +
            esc(String(json.legacy.count)) +
            ' banner lama tetap dipertahankan untuk cabang yang belum memakai Assignment baru.';
        } else {
          legacyNotice.style.display = 'none';
          legacyNotice.textContent = '';
        }
      }
    } catch (err) {
      console.error('[Banner] load error:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8">' +
          '<div style="font-weight:700;color:#dc2626;margin-bottom:4px;">Gagal memuat Banner</div>' +
          '<div class="text-muted" style="font-size:12px;">' + esc(err.message || 'Terjadi kesalahan.') + '</div>' +
        '</td></tr>';
      }
    }
  }
  window.loadMarketingBanners = loadMarketingBanners;

  function populateMarketingBannerBranchFilter() {
    var select = $('mkt-banners-branch-filter');
    if (!select) return;

    var user = getMarketingBannerUser();
    var current = _marketingBannersState.branchFilter || '';

    var options = ['<option value="">Semua Cabang</option>'];
    (_marketingBannersState.branches || []).forEach(function (branch) {
      options.push('<option value="' + esc(branch.id) + '">' + esc(branch.name || branch.id) + '</option>');
    });

    select.innerHTML = options.join('');
    if (current) select.value = current;

    if (user.role === 'branch_manager') {
      var ownBranch = user.branch_id || user.branchId || '';
      if (ownBranch) {
        select.value = ownBranch;
        select.disabled = true;
        _marketingBannersState.branchFilter = ownBranch;
      } else {
        select.disabled = true;
      }
    } else {
      select.disabled = false;
    }
  }

  function openMarketingBannerActionMenu(trigger, key) {
    var row = findMarketingBannerRow(key);
    if (!row) return;

    var assignment = row.assignment;
    var publicationStatus = String(row.publication_status || 'DRAFT').toUpperCase();
    var user = getMarketingBannerUser();
    var actions = [
      { label: 'Lihat Preview', icon: '👁️', onClick: function () { openMarketingBannerPreview(key); } }
    ];

    if (user.role !== 'branch_manager') {
      actions.push({
        label: 'Edit Content',
        icon: '✏️',
        onClick: function () { openMarketingBannerEditor(row.banner_id || row.id); }
      });
    }

    if (assignment) {
      if (!(user.role === 'branch_manager' && assignment.governance_locked)) {
        actions.push({
          label: 'Atur Penempatan / Jadwal',
          icon: '🗓️',
          onClick: function () { openMarketingBannerAssignmentEditor(row, false); }
        });
      }

      if (user.role === 'owner' || user.role === 'brand_manager') {
        actions.push({
          label: assignment.governance_locked ? 'Buka Kunci Manager' : 'Kunci untuk Branch Manager',
          icon: assignment.governance_locked ? '🔓' : '🔒',
          onClick: function () { toggleMarketingBannerGovernance(assignment.id, !assignment.governance_locked); }
        });
      }

      if (assignment.effective_status === 'ENDED' &&
          !(user.role === 'branch_manager' && assignment.governance_locked)) {
        actions.push({
          label: 'Gunakan Lagi',
          icon: '↻',
          onClick: function () { openMarketingBannerAssignmentEditor(row, true); }
        });
      }

      if (publicationStatus === 'PUBLISHED' && user.role !== 'branch_manager') {
        actions.push({ divider: true });
        actions.push({
          label: 'Tambah Penempatan Cabang',
          icon: '＋',
          onClick: function () { openMarketingBannerAssignmentEditor({ banner_id: row.banner_id || row.id }, false); }
        });
      }

      if (!(user.role === 'branch_manager' && assignment.governance_locked)) {
        actions.push({
          divider: true
        });
        actions.push({
          label: 'Hapus Penempatan',
          icon: '🗑️',
          destructive: true,
          onClick: function () { removeMarketingBannerAssignment(assignment.id); }
        });
      }
    } else {
      actions.push({
        label: 'Tempatkan ke Cabang',
        icon: '📍',
        onClick: function () { openMarketingBannerAssignmentEditor(row, false); }
      });
    }

    if (publicationStatus === 'DRAFT' && user.role !== 'branch_manager') {
      actions.push({
        label: 'Publish',
        icon: '🚀',
        onClick: function () { publishMarketingBanner(row.banner_id || row.id); }
      });
      actions.push({
        label: 'Hapus Draft',
        icon: '🗑️',
        destructive: true,
        onClick: function () { deleteMarketingBanner(row.banner_id || row.id); }
      });
    }

    if (publicationStatus === 'PUBLISHED' &&
        row.has_draft_changes &&
        user.role !== 'branch_manager') {
      actions.push({
        label: 'Buang Draft Perubahan',
        icon: '↩️',
        destructive: true,
        onClick: function () { discardMarketingBannerDraft(row.banner_id || row.id); }
      });
    }

    window.XentraActionMenu.open(trigger, actions);
  }

  function mountMarketingBannerEditorPage() {
    var backdrop = $('modal-marketing-banner');
    var page = $('marketing-banner-editor-view');
    if (!backdrop || !page) return;
    var card = backdrop.querySelector('.x-modal-card');
    if (!card) return;
    page.appendChild(card);
    ensureOwnerFeatureMobileHeader(
      page,
      $('modal-marketing-banner-title') ? $('modal-marketing-banner-title').textContent : 'Editor Banner',
      'Atur konten, penempatan, jadwal, dan publikasi banner.',
      'Kembali ke Marketing'
    );
    card.classList.add('x-feature-page-surface');
    card.style.maxWidth = 'none';
    card.style.width = '100%';
    card.style.maxHeight = 'none';
    card.style.height = 'auto';
    card.style.borderRadius = '14px';
    backdrop.style.display = 'none';
  }

  function openMarketingBannerCreate() {
    _marketingBannerEditor = {
      mode: 'create',
      bannerId: null,
      mediaId: null,
      mediaFile: null,
      cropSpec: null,
      detail: null
    };

    setMarketingBannerEditorFields(null);
    populateMarketingBannerTargets(null);
    renderMarketingBannerEditorBranches(null);
    if ($('mkt-banner-schedule-enabled')) $('mkt-banner-schedule-enabled').checked = false;
    if ($('mkt-banner-schedule-fields')) $('mkt-banner-schedule-fields').style.display = 'none';
    if ($('mkt-banner-starts-at')) $('mkt-banner-starts-at').value = '';
    if ($('mkt-banner-ends-at')) $('mkt-banner-ends-at').value = '';
    if ($('mkt-banner-active')) $('mkt-banner-active').checked = true;
    if ($('mkt-banner-governance-lock')) $('mkt-banner-governance-lock').checked = false;
    setMarketingBannerEditorMode('create');

    var modal = $('modal-marketing-banner');
    navigateTo('marketing/banners/new');
    mountMarketingBannerEditorPage();
  }
  window.openMarketingBannerCreate = openMarketingBannerCreate;

  async function openMarketingBannerEditor(bannerId) {
    try {
      var res = await adminFetch(API_BASE + '/admin/marketing/banners/' + encodeURIComponent(bannerId), {
        headers: getAuthHeaders()
      });
      var json = await res.json();
      if (!res.ok || !json.success || !json.banner) {
        throw new Error(json.error || 'Banner tidak ditemukan.');
      }

      _marketingBannerEditor = {
        mode: 'edit',
        bannerId: bannerId,
        mediaId: json.banner.draft_revision
          ? json.banner.draft_revision.media_id
          : (json.banner.published_revision ? json.banner.published_revision.media_id : null),
        mediaFile: null,
        cropSpec: null,
        detail: json.banner
      };

      setMarketingBannerEditorFields(json.banner);
      populateMarketingBannerTargets(json.banner);
      setMarketingBannerEditorMode('edit');

      var modal = $('modal-marketing-banner');
      navigateTo('marketing/banners/' + encodeURIComponent(bannerId) + '/edit');
    mountMarketingBannerEditorPage();
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal membuka Banner.'));
    }
  }
  window.openMarketingBannerEditor = openMarketingBannerEditor;

  function setMarketingBannerEditorMode(mode) {
    var title = $('modal-marketing-banner-title');
    var subtitle = $('modal-marketing-banner-subtitle');
    var placement = $('mkt-banner-create-placement');
    var saveBtn = $('mkt-banner-save-draft');
    var editorPreviewBtn = $('mkt-banner-preview-from-editor');
    if (editorPreviewBtn && !editorPreviewBtn.dataset.bound) {
      editorPreviewBtn.dataset.bound = '1';
      editorPreviewBtn.addEventListener('click', previewMarketingBannerEditor);
    }

    var publishBtn = $('mkt-banner-publish-action');
    var stateEl = $('mkt-banner-editor-state');

    if (mode === 'create') {
      if (title) title.textContent = 'Tambah Banner';
      if (subtitle) subtitle.textContent = 'Buat content draft lalu pilih penempatan dan publikasi.';
      if (placement) placement.style.display = '';
      if (saveBtn) saveBtn.textContent = 'Simpan Draft';
      if (publishBtn) publishBtn.textContent = ($('mkt-banner-schedule-enabled') && $('mkt-banner-schedule-enabled').checked) ? 'Publikasikan & Jadwalkan' : 'Publish Sekarang';
      if (stateEl) stateEl.textContent = 'Mode baru · Content + penempatan opsional';
    } else {
      var detail = _marketingBannerEditor.detail && _marketingBannerEditor.detail.draft_revision
        ? 'Ada Draft revision yang belum dipublish.'
        : 'Mengedit content yang sudah tersimpan. Publish tetap eksplisit.';

      if (title) title.textContent = 'Edit Banner Content';
      if (subtitle) subtitle.textContent = detail;
      if (placement) placement.style.display = 'none';
      if (saveBtn) saveBtn.textContent = 'Simpan Draft Update';
      if (publishBtn) publishBtn.textContent = 'Publish Update';
      if (stateEl) stateEl.textContent = detail;
    }
  }

  function setMarketingBannerEditorFields(detail) {
    var titleEl = $('mkt-banner-title-field');
    var altEl = $('mkt-banner-alt-field');
    var ctaEl = $('mkt-banner-cta-type');
    var bannerIdEl = $('mkt-banner-id');

    if (bannerIdEl) bannerIdEl.value = detail ? (detail.id || '') : '';
    if (titleEl) titleEl.value = detail
      ? ((detail.draft_revision && detail.draft_revision.title) || (detail.published_revision && detail.published_revision.title) || '')
      : '';
    if (altEl) altEl.value = detail
      ? ((detail.draft_revision && detail.draft_revision.alt_text) || (detail.published_revision && detail.published_revision.alt_text) || '')
      : '';

    var revision = detail
      ? (detail.draft_revision || detail.published_revision || null)
      : null;

    if (ctaEl) ctaEl.value = revision ? (revision.cta_type || 'NONE') : 'NONE';

    // State isolation: never carry a previously selected File into this session.
    var fileEl = $('mkt-banner-file');
    if (fileEl) fileEl.value = '';

    setMarketingBannerEditorPreview(
      detail && detail.media && detail.media.preview_url
        ? detail.media.preview_url
        : null
    );

    updateMarketingBannerCtaFields();
  }

  function setMarketingBannerEditorPreview(src) {
    var img = $('mkt-banner-preview');
    var empty = $('mkt-banner-preview-empty');
    var clear = $('mkt-banner-clear');

    if (img && src) {
      img.src = src;
      img.style.display = 'block';
      if (empty) empty.style.display = 'none';
      if (clear) clear.style.display = _marketingBannerEditor.mediaFile ? 'inline-flex' : 'none';
    } else {
      if (img) {
        img.src = '';
        img.style.display = 'none';
      }
      if (empty) empty.style.display = 'flex';
      if (clear) clear.style.display = _marketingBannerEditor.mediaFile ? 'inline-flex' : 'none';
    }
  }

  function clearMarketingBannerMedia() {
    _marketingBannerEditor.mediaFile = null;
    _marketingBannerEditor.mediaReady = false;
    _marketingBannerEditor.mediaId = _marketingBannerEditor.detail
      ? (_marketingBannerEditor.detail.draft_revision
        ? _marketingBannerEditor.detail.draft_revision.media_id
        : (_marketingBannerEditor.detail.published_revision
          ? _marketingBannerEditor.detail.published_revision.media_id
          : null))
      : null;
    _marketingBannerEditor.cropSpec = null;
    var file = $('mkt-banner-file');
    if (file) file.value = '';
    setMarketingBannerEditorPreview(
      _marketingBannerEditor.detail && _marketingBannerEditor.detail.media
        ? _marketingBannerEditor.detail.media.preview_url
        : null
    );
  }

  function closeMarketingBannerModal() {
    var backdrop = $('modal-marketing-banner');
    var page = $('marketing-banner-editor-view');
    var card = backdrop && backdrop.querySelector('.x-modal-card');
    if (!card && page) card = page.querySelector('.x-modal-card');
    if (card && backdrop) {
      backdrop.appendChild(card);
      card.classList.remove('x-feature-page-surface');
      card.style.maxWidth = '760px';
      card.style.width = '100%';
      card.style.maxHeight = '92vh';
      card.style.height = 'auto';
      card.style.borderRadius = '14px';
      backdrop.style.display = 'none';
    }
    if (page) page.style.display = 'none';
    navigateTo('marketing/banners');
  }
  window.closeMarketingBannerModal = closeMarketingBannerModal;

  function readMarketingBannerFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
      reader.readAsDataURL(file);
    });
  }

  async function processMarketingBannerMedia(file, cropSpec) {
    var base64 = await readMarketingBannerFileAsDataUrl(file);

    var uploadRes = await adminFetch(API_BASE + '/admin/media/upload', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        image_base64: base64,
        mime_type: file.type,
        original_filename: file.name,
        asset_type: 'banner',
        enforce_aspect_ratio: false
      })
    });

    var uploadJson = await uploadRes.json();
    if (!uploadRes.ok || !uploadJson.success || !uploadJson.asset) {
      throw new Error(uploadJson.error || 'Upload media Banner gagal.');
    }

    var mediaId = uploadJson.asset.media_id || uploadJson.asset.id;
    if (!mediaId) throw new Error('Media ID tidak dikembalikan server.');

    if (cropSpec) {
      var cropRes = await adminFetch(API_BASE + '/admin/media/' + encodeURIComponent(mediaId) + '/crop', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ crop_spec: cropSpec })
      });
      var cropJson = await cropRes.json();
      if (!cropRes.ok || !cropJson.success) {
        throw new Error(cropJson.error || 'Crop specification Banner gagal disimpan.');
      }
    }

    var processRes = await adminFetch(API_BASE + '/admin/media/' + encodeURIComponent(mediaId) + '/process', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ crop_spec: cropSpec || null })
    });
    var processJson = await processRes.json();
    if (!processRes.ok || !processJson.success || !processJson.asset) {
      throw new Error(processJson.error || 'Media Banner gagal diproses.');
    }

    return processJson.asset;
  }

  function onMarketingBannerFileSelected(file) {
    if (!file) return;

    var allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.indexOf(file.type) === -1) {
      showToast('❌ Format Banner harus JPG, PNG, atau WebP.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      showToast('❌ Ukuran Banner melebihi batas 20 MB.');
      return;
    }

    _marketingBannerEditor.mediaFile = file;
    _marketingBannerEditor.cropSpec = null;
    _marketingBannerEditor.mediaReady = false;

    XentraCropEditor.open({
      source: file,
      assetType: 'banner',
      aspectRatio: 350 / 180,
      title: 'Sesuaikan Banner (~1.94:1)',
      onConfirm: function (cropSpec, previewDataUrl) {
        _marketingBannerEditor.cropSpec = cropSpec;
        setMarketingBannerEditorPreview(previewDataUrl || URL.createObjectURL(file));
        showToast('✓ Framing Banner disimpan untuk pemrosesan server.');
      },
      onCancel: function () {
        _marketingBannerEditor.mediaFile = null;
        _marketingBannerEditor.mediaReady = false;
        _marketingBannerEditor.cropSpec = null;
        var fileInput = $('mkt-banner-file');
        if (fileInput) fileInput.value = '';
        setMarketingBannerEditorPreview(
          _marketingBannerEditor.detail && _marketingBannerEditor.detail.media
            ? _marketingBannerEditor.detail.media.preview_url
            : null
        );
      }
    });
  }

  function renderMarketingBannerEditorBranches(selectedIds) {
    var container = $('mkt-banner-branch-list');
    var allToggle = $('mkt-banner-all-branches');
    var countEl = $('mkt-banner-branch-selection-count');
    if (!container) return;

    var selected = new Set(Array.isArray(selectedIds) ? selectedIds.map(String) : []);
    var user = getMarketingBannerUser();
    var ownBranch = String(user.branch_id || user.branchId || '');

    var html = [];
    (_marketingBannersState.branches || []).forEach(function (branch) {
      if (user.role === 'branch_manager' && ownBranch && String(branch.id) !== ownBranch) return;

      html.push(
        '<label class="x-marketing-banner-branch-check">' +
          '<input type="checkbox" value="' + esc(branch.id) + '" data-banner-create-branch>' +
          '<span>' + esc(branch.name || branch.id) + '</span>' +
          '<small>' + esc(branch.timezone || 'Asia/Jakarta') + '</small>' +
        '</label>'
      );
    });

    container.innerHTML = html.length
      ? html.join('')
      : '<div class="text-muted" style="font-size:12px;padding:10px 0;">Tidak ada cabang yang tersedia dalam scope akun ini.</div>';

    container.querySelectorAll('[data-banner-create-branch]').forEach(function (input) {
      input.checked = selected.has(String(input.value));
      input.addEventListener('change', refreshMarketingBannerBranchSelection);
    });

    if (allToggle) {
      allToggle.checked = false;
      allToggle.indeterminate = false;
      allToggle.onchange = function () {
        var checkboxes = container.querySelectorAll('[data-banner-create-branch]');
        checkboxes.forEach(function (input) {
          input.checked = allToggle.checked;
        });
        refreshMarketingBannerBranchSelection();
      };
    }

    refreshMarketingBannerBranchSelection();
  }

  function refreshMarketingBannerBranchSelection() {
    var container = $('mkt-banner-branch-list');
    var countEl = $('mkt-banner-branch-selection-count');
    var allToggle = $('mkt-banner-all-branches');
    if (!container) return;

    var inputs = Array.prototype.slice.call(container.querySelectorAll('[data-banner-create-branch]'));
    var checked = inputs.filter(function (input) { return input.checked; }).length;

    if (countEl) countEl.textContent = checked + ' cabang dipilih';
    if (allToggle) {
      allToggle.checked = inputs.length > 0 && checked === inputs.length;
      allToggle.indeterminate = checked > 0 && checked < inputs.length;
    }
  }

  function getSelectedMarketingBannerBranchIds() {
    var container = $('mkt-banner-branch-list');
    if (!container) return [];
    return Array.prototype.slice.call(container.querySelectorAll('[data-banner-create-branch]:checked')).map(function (input) {
      return String(input.value);
    });
  }

  async function populateMarketingBannerTargets(detail) {
    var revision = detail
      ? (detail.draft_revision || detail.published_revision || null)
      : null;

    try {
      var results = await Promise.all([
        adminFetch(API_BASE + '/admin/marketing/promotions', { headers: getAuthHeaders() }),
        adminFetch(API_BASE + '/admin/products', { headers: getAuthHeaders() }),
        adminFetch(API_BASE + '/admin/categories', { headers: getAuthHeaders() })
      ]);

      var promoJson = await results[0].json();
      var productJson = await results[1].json();
      var categoryJson = await results[2].json();

      _marketingBannersState.promotions = promoJson && Array.isArray(promoJson.promotions) ? promoJson.promotions : [];
      _marketingBannersState.products = productJson && Array.isArray(productJson.products) ? productJson.products : [];
      _marketingBannersState.categories = categoryJson && Array.isArray(categoryJson.categories) ? categoryJson.categories : [];

      var promoSelect = $('mkt-banner-cta-promotion');
      var productSelect = $('mkt-banner-cta-product');
      var categorySelect = $('mkt-banner-cta-category');

      if (promoSelect) {
        promoSelect.innerHTML = '<option value="">Pilih Promotion</option>' +
          _marketingBannersState.promotions.map(function (item) {
            return '<option value="' + esc(item.id) + '">' + esc(item.name || item.code || item.id) + '</option>';
          }).join('');
        promoSelect.value = revision && revision.cta_type === 'PROMOTION' ? (revision.promotion_id || '') : '';
      }

      if (productSelect) {
        productSelect.innerHTML = '<option value="">Pilih Product</option>' +
          _marketingBannersState.products.map(function (item) {
            return '<option value="' + esc(item.id) + '">' + esc(item.name || item.id) + '</option>';
          }).join('');
        productSelect.value = revision && revision.cta_type === 'PRODUCT' ? (revision.cta_target_id || '') : '';
      }

      if (categorySelect) {
        categorySelect.innerHTML = '<option value="">Pilih Category</option>' +
          _marketingBannersState.categories.map(function (item) {
            return '<option value="' + esc(item.id) + '">' + esc(item.name || item.id) + '</option>';
          }).join('');
        categorySelect.value = revision && revision.cta_type === 'CATEGORY' ? (revision.cta_target_id || '') : '';
      }

      var urlInput = $('mkt-banner-cta-url');
      if (urlInput) {
        urlInput.value = revision && revision.cta_type === 'URL' ? (revision.cta_url || '') : '';
      }

      updateMarketingBannerCtaFields();
    } catch (err) {
      console.error('[Banner] target load error:', err);
      showToast('⚠️ Target CTA gagal dimuat. Banner tanpa CTA tetap dapat disimpan.');
    }
  }

  function updateMarketingBannerCtaFields() {
    var typeEl = $('mkt-banner-cta-type');
    var type = typeEl ? String(typeEl.value || 'NONE').toUpperCase() : 'NONE';

    var map = {
      PROMOTION: 'mkt-banner-cta-promotion-wrap',
      PRODUCT: 'mkt-banner-cta-product-wrap',
      CATEGORY: 'mkt-banner-cta-category-wrap',
      URL: 'mkt-banner-cta-url-wrap'
    };

    Object.keys(map).forEach(function (key) {
      var wrap = $(map[key]);
      if (wrap) wrap.style.display = key === type ? '' : 'none';
    });
  }

  function buildMarketingBannerContentPayload(mediaId) {
    var typeEl = $('mkt-banner-cta-type');
    var ctaType = typeEl ? String(typeEl.value || 'NONE').toUpperCase() : 'NONE';

    var payload = {
      media_id: mediaId,
      title: $('mkt-banner-title-field') ? $('mkt-banner-title-field').value.trim() : '',
      alt_text: $('mkt-banner-alt-field') ? $('mkt-banner-alt-field').value.trim() : '',
      cta_type: ctaType,
      cta_target_id: null,
      cta_url: null,
      promotion_id: null
    };

    if (ctaType === 'PROMOTION') {
      payload.promotion_id = $('mkt-banner-cta-promotion') ? $('mkt-banner-cta-promotion').value : null;
    } else if (ctaType === 'PRODUCT') {
      payload.cta_target_id = $('mkt-banner-cta-product') ? $('mkt-banner-cta-product').value : null;
    } else if (ctaType === 'CATEGORY') {
      payload.cta_target_id = $('mkt-banner-cta-category') ? $('mkt-banner-cta-category').value : null;
    } else if (ctaType === 'URL') {
      payload.cta_url = $('mkt-banner-cta-url') ? $('mkt-banner-cta-url').value.trim() : null;
    }

    return payload;
  }

  function getMarketingBannerPlacementPayload() {
    var selectedBranches = getSelectedMarketingBannerBranchIds();
    var scheduleEnabled = $('mkt-banner-schedule-enabled') ? $('mkt-banner-schedule-enabled').checked : false;

    return {
      branch_ids: selectedBranches,
      position: Number($('mkt-banner-position') && $('mkt-banner-position').value || 1),
      active: $('mkt-banner-active') ? $('mkt-banner-active').checked : true,
      starts_at_local: scheduleEnabled && $('mkt-banner-starts-at') ? $('mkt-banner-starts-at').value : '',
      ends_at_local: scheduleEnabled && $('mkt-banner-ends-at') ? $('mkt-banner-ends-at').value : '',
      governance_locked: $('mkt-banner-governance-lock') ? $('mkt-banner-governance-lock').checked : false
    };
  }

  async function saveMarketingBannerDraft(shouldPublish) {
    if (_marketingBannerSaving) return;
    var submitBtn = $('mkt-banner-save-draft');
    var publishBtn = $('mkt-banner-publish-action');

    _marketingBannerSaving = true;
    if (submitBtn) submitBtn.disabled = true;
    if (publishBtn) publishBtn.disabled = true;

    try {
      var mediaId = _marketingBannerEditor.mediaId;

      // Reuse the READY asset from a previous successful processing attempt
      // instead of re-uploading the same File (prevents orphaned READY assets
      // when a retry happens after a downstream failure).
      if (_marketingBannerEditor.mediaFile && !_marketingBannerEditor.mediaReady) {
        var asset = await processMarketingBannerMedia(
          _marketingBannerEditor.mediaFile,
          _marketingBannerEditor.cropSpec
        );
        mediaId = asset.media_id || asset.id;
        _marketingBannerEditor.mediaId = mediaId;
        _marketingBannerEditor.mediaReady = true;
      }

      if (!mediaId) {
        throw new Error('Media Banner wajib dipilih.');
      }

      var payload = buildMarketingBannerContentPayload(mediaId);
      var banner;

      if (_marketingBannerEditor.mode === 'create') {
        if (!_marketingBannerEditor.bannerId) {
          var createRes = await adminFetch(API_BASE + '/admin/marketing/banners', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
          });
          var createJson = await createRes.json();
          if (!createRes.ok || !createJson.success) {
            throw new Error(createJson.error || 'Gagal membuat Banner.');
          }
          banner = createJson.banner;
          _marketingBannerEditor.bannerId = banner.id;
        } else {
          // Retry after a failed placement: the Banner content already exists,
          // so update its draft instead of creating a duplicate banner.
          var retryRes = await adminFetch(
            API_BASE + '/admin/marketing/banners/' + encodeURIComponent(_marketingBannerEditor.bannerId) + '/draft',
            {
              method: 'PATCH',
              headers: getAuthHeaders(),
              body: JSON.stringify(payload)
            }
          );
          var retryJson = await retryRes.json();
          if (!retryRes.ok || !retryJson.success) {
            throw new Error(retryJson.error || 'Gagal menyimpan Draft Banner.');
          }
          banner = retryJson.banner;
        }

        var placementPayload = getMarketingBannerPlacementPayload();
        if (!placementPayload.branch_ids.length &&
            (placementPayload.starts_at_local || placementPayload.ends_at_local)) {
          throw new Error('Jadwal tayang membutuhkan minimal satu cabang target.');
        }

        if (placementPayload.branch_ids.length) {
          var assignRes = await adminFetch(
            API_BASE + '/admin/marketing/banners/' + encodeURIComponent(_marketingBannerEditor.bannerId) + '/assignments/bulk',
            {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify(placementPayload)
            }
          );
          var assignJson = await assignRes.json();
          if (!assignRes.ok || !assignJson.success) {
            throw new Error(assignJson.error || 'Banner dibuat, tetapi penempatan gagal.');
          }
        }
      } else {
        var updateRes = await adminFetch(
          API_BASE + '/admin/marketing/banners/' + encodeURIComponent(_marketingBannerEditor.bannerId) + '/draft',
          {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
          }
        );
        var updateJson = await updateRes.json();
        if (!updateRes.ok || !updateJson.success) {
          throw new Error(updateJson.error || 'Gagal menyimpan Draft Banner.');
        }
        banner = updateJson.banner;
      }

      if (shouldPublish) {
        var publishRes = await adminFetch(
          API_BASE + '/admin/marketing/banners/' + encodeURIComponent(_marketingBannerEditor.bannerId) + '/publish',
          {
            method: 'POST',
            headers: getAuthHeaders(),
            body: '{}'
          }
        );
        var publishJson = await publishRes.json();
        if (!publishRes.ok || !publishJson.success) {
          if (publishRes.status === 409 && publishJson.conflict) {
            throw new Error('Publish ditolak: position pada Branch memiliki visibility window yang bentrok. Atur penempatan/jadwal terlebih dahulu.');
          }
          throw new Error(publishJson.error || 'Gagal Publish Banner.');
        }
      }

      closeMarketingBannerModal();
      await loadMarketingBanners();
      showToast(shouldPublish ? '✅ Banner berhasil dipublish.' : '✅ Draft Banner tersimpan.');
    } catch (err) {
      console.error('[Banner] save error:', err);
      showToast('❌ ' + (err.message || 'Gagal menyimpan Banner.'));
    } finally {
      _marketingBannerSaving = false;
      if (submitBtn) submitBtn.disabled = false;
      if (publishBtn) publishBtn.disabled = false;
    }
  }

  function submitMarketingBannerForm(event) {
    if (event) event.preventDefault();
    saveMarketingBannerDraft(false);
  }

  async function publishMarketingBanner(bannerId) {
    try {
      var res = await adminFetch(API_BASE + '/admin/marketing/banners/' + encodeURIComponent(bannerId) + '/publish', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: '{}'
      });
      var json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal Publish Banner.');
      }
      await loadMarketingBanners();
      showToast('✅ Banner berhasil dipublish.');
    } catch (err) {
      showToast('❌ ' + (err.message || 'Publish gagal.'));
    }
  }
  window.publishMarketingBanner = publishMarketingBanner;

  async function discardMarketingBannerDraft(bannerId) {
    if (!await confirmFeatureAction('discard-banner-draft', 'Buang Draft Banner', 'Buang Draft perubahan ini? Versi Banner yang sedang Published akan tetap digunakan.', 'Buang Draft')) return;

    try {
      var res = await adminFetch(
        API_BASE + '/admin/marketing/banners/' + encodeURIComponent(bannerId) + '/discard-draft',
        {
          method: 'POST',
          headers: getAuthHeaders(),
          body: '{}'
        }
      );

      var json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal membuang Draft perubahan.');
      }

      await loadMarketingBanners();
      showToast('✅ Draft perubahan dibuang. Versi Published tetap aktif.');
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal membuang Draft perubahan.'));
    }
  }
  window.discardMarketingBannerDraft = discardMarketingBannerDraft;

  async function deleteMarketingBanner(bannerId) {
    if (!await confirmFeatureAction('delete-banner-draft', 'Hapus Draft Banner', 'Hapus Draft Banner ini? Banner yang sudah pernah dipublish tidak dapat dihapus dari menu ini.', 'Hapus')) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/marketing/banners/' + encodeURIComponent(bannerId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal menghapus Draft.');
      }
      await loadMarketingBanners();
      showToast('✅ Draft Banner dihapus.');
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal menghapus Draft.'));
    }
  }
  window.deleteMarketingBanner = deleteMarketingBanner;

  function previewMarketingBannerEditor() {
    var modal = $('modal-marketing-banner-preview');
    var stage = $('mkt-banner-preview-stage');
    var meta = $('mkt-banner-preview-meta');

    if (!modal || !stage) return;

    var title = $('mkt-banner-title-field') ? $('mkt-banner-title-field').value.trim() : 'Banner';
    var alt = $('mkt-banner-alt-field') ? $('mkt-banner-alt-field').value.trim() : title;
    // An empty img.src resolves to the document URL when read back, so only
    // trust src while the preview image is actually visible.
    var previewImg = $('mkt-banner-preview');
    var src = previewImg && previewImg.style.display !== 'none' ? previewImg.src : '';
    var ctaType = $('mkt-banner-cta-type') ? $('mkt-banner-cta-type').value : 'NONE';
    var scheduleEnabled = $('mkt-banner-schedule-enabled') ? $('mkt-banner-schedule-enabled').checked : false;
    var startsAt = scheduleEnabled && $('mkt-banner-starts-at') ? $('mkt-banner-starts-at').value : '';
    var endsAt = scheduleEnabled && $('mkt-banner-ends-at') ? $('mkt-banner-ends-at').value : '';
    var selectedBranches = getSelectedMarketingBannerBranchIds();

    $('modal-banner-preview-title').textContent = title || 'Preview Banner';
    $('modal-banner-preview-subtitle').textContent = 'Review / Preview · Belum dipublish';

    var img = src
      ? '<img src="' + esc(src) + '" alt="' + esc(alt || title || 'Banner') + '">'
      : '<div class="x-marketing-banner-preview-stage-empty">Belum ada media preview.</div>';

    stage.innerHTML =
      img +
      '<div class="x-marketing-banner-preview-stage-caption">' +
        '<strong>' + esc(title || 'Tanpa judul') + '</strong>' +
        '<span>' + esc(ctaType || 'NONE') + '</span>' +
      '</div>';

    var branchNames = [];
    (_marketingBannersState.branches || []).forEach(function (branch) {
      if (selectedBranches.indexOf(String(branch.id)) >= 0) {
        branchNames.push(branch.name || branch.id);
      }
    });

    meta.innerHTML = [
      '<div><span>Mode</span><strong>Draft / Review</strong></div>',
      '<div><span>CTA</span><strong>' + esc(ctaType || 'NONE') + '</strong></div>',
      '<div><span>Cabang</span><strong>' + esc(branchNames.length ? branchNames.join(', ') : 'Belum ditempatkan') + '</strong></div>',
      '<div><span>Schedule</span><strong>' + esc(scheduleEnabled ? ((startsAt || 'Mulai belum diisi') + (endsAt ? ' → ' + endsAt : '')) : 'Tanpa jadwal') + '</strong></div>'
    ].join('');

    modal.style.display = 'flex';
  }
  window.previewMarketingBannerEditor = previewMarketingBannerEditor;

  function openMarketingBannerPreview(key) {
    var row = findMarketingBannerRow(key);
    if (!row) return;

    var modal = $('modal-marketing-banner-preview');
    var stage = $('mkt-banner-preview-stage');
    var meta = $('mkt-banner-preview-meta');
    var title = $('modal-banner-preview-title');
    var subtitle = $('modal-banner-preview-subtitle');

    if (title) title.textContent = row.title || 'Preview Banner';

    var assignment = row.assignment;
    if (subtitle) {
      subtitle.textContent = assignment
        ? (assignment.branch_name || 'Customer Storefront') + ' · Homepage Banner'
        : 'Customer Storefront · Content belum ditempatkan';
    }

    if (stage) {
      var src = row.media && row.media.preview_url;
      var revision = row.draft_revision || row.published_revision || null;
      var img = src
        ? '<img src="' + esc(src) + '" alt="' + esc(row.alt_text || row.title || 'Banner') + '">'
        : '<div class="x-marketing-banner-preview-stage-empty">Belum ada media preview.</div>';

      stage.innerHTML =
        img +
        '<div class="x-marketing-banner-preview-stage-caption">' +
          '<strong>' + esc(row.title || 'Tanpa judul') + '</strong>' +
          '<span>' + esc((revision && revision.cta_type) || 'NONE') + '</span>' +
        '</div>';
    }

    if (meta) {
      var revision2 = row.draft_revision || row.published_revision || null;
      var lines = [
        '<div><span>Publikasi</span><strong>' + esc(String(row.publication_status || 'DRAFT')) + '</strong></div>',
        '<div><span>Placement</span><strong>Homepage Banner</strong></div>',
        '<div><span>Cabang</span><strong>' + esc(assignment ? assignment.branch_name : 'Belum ditempatkan') + '</strong></div>',
        '<div><span>Position</span><strong>' + esc(assignment ? String(assignment.position) : '—') + '</strong></div>',
        '<div><span>Jadwal</span><strong>' + esc(formatMarketingBannerScheduleWithTz(assignment)) + '</strong></div>',
        '<div><span>Visibility</span><strong>' + esc(assignment ? String(assignment.effective_status || '—') : '—') + '</strong></div>',
        '<div><span>CTA</span><strong>' + esc(revision2 ? (revision2.cta_type || 'NONE') : 'NONE') + '</strong></div>'
      ];

      if (revision2 && revision2.promotion_id) {
        lines.push('<div><span>Promotion</span><strong>' + esc(revision2.promotion_id) + '</strong></div>');
      }

      meta.innerHTML = lines.join('');
    }

    openExistingCardInPresentation('modal-marketing-banner-preview', 'marketing-banner-preview', 'dialog');
  }
  window.openMarketingBannerPreview = openMarketingBannerPreview;

  function closeMarketingBannerPreview() {
    if (window.XentraPresentation && window.XentraPresentation.isOpen('marketing-banner-preview')) {
      window.XentraPresentation.close('marketing-banner-preview');
    } else {
      var modal = $('modal-marketing-banner-preview');
      if (modal) modal.style.display = 'none';
    }
  }
  window.closeMarketingBannerPreview = closeMarketingBannerPreview;

  function branchLocalInputFromUtc(iso, timeZone) {
    if (!iso) return '';
    var p = bannerDateTimeParts(iso, timeZone || 'Asia/Jakarta');
    if (!p) return '';
    return p.year + '-' +
      String(p.month).padStart(2, '0') + '-' +
      String(p.day).padStart(2, '0') + 'T' +
      String(p.hour).padStart(2, '0') + ':' +
      String(p.minute).padStart(2, '0');
  }

  function populateMarketingBannerAssignmentBranchSelect(selectedBranchId, disabled) {
    var select = $('mkt-assignment-branch');
    if (!select) return;

    var user = getMarketingBannerUser();
    var ownBranch = String(user.branch_id || user.branchId || '');
    var options = [];

    (_marketingBannersState.branches || []).forEach(function (branch) {
      if (user.role === 'branch_manager' && ownBranch && String(branch.id) !== ownBranch) return;
      options.push('<option value="' + esc(branch.id) + '">' + esc(branch.name || branch.id) + '</option>');
    });

    select.innerHTML = options.length ? options.join('') : '<option value="">Tidak ada cabang</option>';
    if (selectedBranchId) select.value = String(selectedBranchId);

    select.disabled = Boolean(disabled);

    updateMarketingBannerAssignmentTimezone();
  }

  function updateMarketingBannerAssignmentTimezone() {
    var select = $('mkt-assignment-branch');
    var note = $('mkt-assignment-timezone');
    if (!select || !note) return;

    var selected = (_marketingBannersState.branches || []).find(function (branch) {
      return String(branch.id) === String(select.value);
    });

    note.textContent = selected
      ? 'Timezone Branch: ' + (selected.timezone || 'Asia/Jakarta') + '. Input jadwal menggunakan waktu lokal Branch.'
      : '';
  }

  function setAssignmentLocalFields(assignment) {
    var tz = assignment
      ? (assignment.branch_timezone || assignment.timezone || 'Asia/Jakarta')
      : 'Asia/Jakarta';

    var enabled = Boolean(assignment && (assignment.starts_at || assignment.ends_at));

    var scheduleToggle = $('mkt-assignment-schedule-enabled');
    var fields = $('mkt-assignment-schedule-fields');
    var start = $('mkt-assignment-starts-at');
    var end = $('mkt-assignment-ends-at');

    if (scheduleToggle) scheduleToggle.checked = enabled;
    if (fields) fields.style.display = enabled ? '' : 'none';
    if (start) start.value = enabled ? branchLocalInputFromUtc(assignment.starts_at, tz) : '';
    if (end) end.value = enabled ? branchLocalInputFromUtc(assignment.ends_at, tz) : '';
  }

  function openMarketingBannerAssignmentEditor(row, reuse) {
    var bannerId = row.banner_id || row.id;
    var assignment = row.assignment || null;

    _marketingBannerAssignmentEditor = {
      bannerId: bannerId,
      assignmentId: assignment && assignment.id ? assignment.id : null,
      mode: assignment && assignment.id ? 'edit' : 'create'
    };

    var title = $('modal-banner-assignment-title');
    var subtitle = $('modal-banner-assignment-subtitle');
    var saveBtn = $('btn-save-banner-assignment');
    var activeEl = $('mkt-assignment-active');
    var positionEl = $('mkt-assignment-position');
    var lockEl = $('mkt-assignment-governance-lock');
    var lockWrap = $('mkt-assignment-governance-wrap');

    if (title) title.textContent = reuse ? 'Gunakan Lagi Banner' : (assignment ? 'Atur Penempatan Banner' : 'Tempatkan Banner ke Cabang');
    if (subtitle) subtitle.textContent = assignment
      ? 'Branch, position, Active, dan jadwal. Record ENDED tetap dapat digunakan kembali.'
      : 'Pilih Branch target dan aturan visibility.';
    if (saveBtn) saveBtn.textContent = assignment ? 'Simpan Perubahan' : 'Simpan Penempatan';

    populateMarketingBannerAssignmentBranchSelect(
      assignment ? assignment.branch_id : '',
      Boolean(assignment)
    );

    if (positionEl) positionEl.value = assignment ? Number(assignment.position || 1) : 1;
    if (activeEl) activeEl.checked = assignment ? Boolean(assignment.active) : true;

    if (reuse && assignment) {
      var tz = assignment.branch_timezone || assignment.timezone || 'Asia/Jakarta';
      if ($('mkt-assignment-schedule-enabled')) $('mkt-assignment-schedule-enabled').checked = true;
      if ($('mkt-assignment-schedule-fields')) $('mkt-assignment-schedule-fields').style.display = '';
      if ($('mkt-assignment-starts-at')) $('mkt-assignment-starts-at').value = '';
      if ($('mkt-assignment-ends-at')) $('mkt-assignment-ends-at').value = '';
      if ($('mkt-assignment-timezone')) $('mkt-assignment-timezone').textContent = 'Timezone Branch: ' + tz + '. Masukkan jadwal baru untuk memakai Banner kembali.';
    } else {
      setAssignmentLocalFields(assignment);
    }

    if (lockEl) {
      lockEl.checked = assignment ? Boolean(assignment.governance_locked) : false;
    }

    var user = getMarketingBannerUser();
    if (lockWrap) {
      lockWrap.style.display = (user.role === 'owner' || user.role === 'brand_manager') ? 'inline-flex' : 'none';
      if (user.role === 'branch_manager') {
        lockEl.checked = false;
        lockEl.disabled = true;
      } else if (lockEl) {
        lockEl.disabled = false;
      }
    }

    openExistingCardInPresentation('modal-marketing-banner-assignment', 'marketing-banner-assignment', 'bottom-sheet');
  }
  window.openMarketingBannerAssignmentEditor = openMarketingBannerAssignmentEditor;

  function closeMarketingBannerAssignmentModal() {
    if (window.XentraPresentation && window.XentraPresentation.isOpen('marketing-banner-assignment')) {
      window.XentraPresentation.close('marketing-banner-assignment');
    } else {
      var modal = $('modal-marketing-banner-assignment');
      if (modal) modal.style.display = 'none';
    }
  }
  window.closeMarketingBannerAssignmentModal = closeMarketingBannerAssignmentModal;

  async function saveMarketingBannerAssignment(event) {
    if (event) event.preventDefault();

    var editor = _marketingBannerAssignmentEditor;
    var branchId = $('mkt-assignment-branch') ? $('mkt-assignment-branch').value : '';
    var position = $('mkt-assignment-position') ? Number($('mkt-assignment-position').value || 1) : 1;
    var scheduleEnabled = $('mkt-assignment-schedule-enabled') ? $('mkt-assignment-schedule-enabled').checked : false;
    var active = $('mkt-assignment-active') ? $('mkt-assignment-active').checked : true;

    if (!branchId) {
      showToast('❌ Branch wajib dipilih.');
      return;
    }

    var payload = {
      branch_id: branchId,
      placement: 'HOME_BANNER_CAROUSEL',
      position: position,
      active: active,
      starts_at_local: scheduleEnabled && $('mkt-assignment-starts-at') ? $('mkt-assignment-starts-at').value : '',
      ends_at_local: scheduleEnabled && $('mkt-assignment-ends-at') ? $('mkt-assignment-ends-at').value : '',
      governance_locked: $('mkt-assignment-governance-lock') ? $('mkt-assignment-governance-lock').checked : false
    };

    var btn = $('btn-save-banner-assignment');
    if (btn) btn.disabled = true;

    try {
      var url;
      var method;

      if (editor.mode === 'create') {
        url = API_BASE + '/admin/marketing/banners/' + encodeURIComponent(editor.bannerId) + '/assignments';
        method = 'POST';
      } else {
        url = API_BASE + '/admin/marketing/banners/' + encodeURIComponent(editor.bannerId) + '/assignments/' + encodeURIComponent(editor.assignmentId);
        method = 'PATCH';
        delete payload.branch_id;
        delete payload.placement;
      }

      var res = await adminFetch(url, {
        method: method,
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal menyimpan Assignment.');
      }

      closeMarketingBannerAssignmentModal();
      await loadMarketingBanners();
      showToast('✅ Penempatan Banner berhasil diperbarui.');
    } catch (err) {
      var suffix = err && err.message ? err.message : 'Gagal menyimpan Assignment.';
      showToast('❌ ' + suffix);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function toggleMarketingBannerAssignment(assignmentId, active) {
    var row = _marketingBannersState.rows.find(function (item) {
      return item.assignment && String(item.assignment.id) === String(assignmentId);
    });

    if (!row || !row.assignment) return;

    if (isMarketingBannerBranchManager() && row.assignment.governance_locked) {
      showToast('⚠️ Assignment ini dikunci Owner.');
      await loadMarketingBanners();
      return;
    }

    try {
      var res = await adminFetch(
        API_BASE + '/admin/marketing/banners/' + encodeURIComponent(row.banner_id || row.id) + '/assignments/' + encodeURIComponent(assignmentId),
        {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ active: Boolean(active) })
        }
      );

      var json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal mengubah visibility Banner.');
      }

      await loadMarketingBanners();
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal mengubah visibility Banner.'));
      await loadMarketingBanners();
    }
  }

  async function toggleMarketingBannerGovernance(assignmentId, locked) {
    var row = _marketingBannersState.rows.find(function (item) {
      return item.assignment && String(item.assignment.id) === String(assignmentId);
    });

    if (!row) return;

    try {
      var res = await adminFetch(
        API_BASE + '/admin/marketing/banners/' + encodeURIComponent(row.banner_id || row.id) + '/assignments/' + encodeURIComponent(assignmentId),
        {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ governance_locked: Boolean(locked) })
        }
      );
      var json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal mengubah governance lock.');
      }

      await loadMarketingBanners();
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal mengubah lock Banner.'));
    }
  }

  async function removeMarketingBannerAssignment(assignmentId) {
    var row = _marketingBannersState.rows.find(function (item) {
      return item.assignment && String(item.assignment.id) === String(assignmentId);
    });
    if (!row) return;

    if (!await confirmFeatureAction('remove-banner-assignment', 'Hapus Penempatan Banner', 'Hapus penempatan Banner dari cabang ini? Content Banner tetap tersimpan.', 'Hapus')) return;

    try {
      var res = await adminFetch(
        API_BASE + '/admin/marketing/banners/' + encodeURIComponent(row.banner_id || row.id) + '/assignments/' + encodeURIComponent(assignmentId),
        {
          method: 'DELETE',
          headers: getAuthHeaders()
        }
      );
      var json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal menghapus Assignment.');
      }

      await loadMarketingBanners();
      showToast('✅ Penempatan Banner dihapus.');
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal menghapus Assignment.'));
    }
  }
  window.removeMarketingBannerAssignment = removeMarketingBannerAssignment;

  function wireMarketingBannerUi() {
    var createBtn = $('btn-mkt-create-banner');
    if (createBtn && !createBtn.dataset.bound) {
      createBtn.dataset.bound = '1';
      createBtn.addEventListener('click', openMarketingBannerCreate);
    }

    var filter = $('mkt-banners-branch-filter');
    if (filter && !filter.dataset.bound) {
      filter.dataset.bound = '1';
      filter.addEventListener('change', function () {
        _marketingBannersState.branchFilter = filter.value || '';
        loadMarketingBanners();
      });
    }

    var filePick = $('mkt-banner-pick');
    var fileInput = $('mkt-banner-file');
    if (filePick && fileInput && !filePick.dataset.bound) {
      filePick.dataset.bound = '1';
      filePick.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) {
          onMarketingBannerFileSelected(fileInput.files[0]);
        }
      });
    }

    var clear = $('mkt-banner-clear');
    if (clear && !clear.dataset.bound) {
      clear.dataset.bound = '1';
      clear.addEventListener('click', clearMarketingBannerMedia);
    }

    var ctaType = $('mkt-banner-cta-type');
    if (ctaType && !ctaType.dataset.bound) {
      ctaType.dataset.bound = '1';
      ctaType.addEventListener('change', updateMarketingBannerCtaFields);
    }

    var schedule = $('mkt-banner-schedule-enabled');
    var scheduleFields = $('mkt-banner-schedule-fields');
    if (schedule && !schedule.dataset.bound) {
      schedule.dataset.bound = '1';
      schedule.addEventListener('change', function () {
        if (scheduleFields) scheduleFields.style.display = schedule.checked ? '' : 'none';
        var publishAction = $('mkt-banner-publish-action');
        if (publishAction && _marketingBannerEditor.mode === 'create') {
          publishAction.textContent = schedule.checked ? 'Publikasikan & Jadwalkan' : 'Publish Sekarang';
        }
      });
    }

    var assignmentBranch = $('mkt-assignment-branch');
    if (assignmentBranch && !assignmentBranch.dataset.bound) {
      assignmentBranch.dataset.bound = '1';
      assignmentBranch.addEventListener('change', updateMarketingBannerAssignmentTimezone);
    }

    var assignmentSchedule = $('mkt-assignment-schedule-enabled');
    var assignmentScheduleFields = $('mkt-assignment-schedule-fields');
    if (assignmentSchedule && !assignmentSchedule.dataset.bound) {
      assignmentSchedule.dataset.bound = '1';
      assignmentSchedule.addEventListener('change', function () {
        if (assignmentScheduleFields) assignmentScheduleFields.style.display = assignmentSchedule.checked ? '' : 'none';
      });
    }

    var form = $('form-marketing-banner');
    if (form && !form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', submitMarketingBannerForm);
    }

    var publishBtn = $('mkt-banner-publish-action');
    if (publishBtn && !publishBtn.dataset.bound) {
      publishBtn.dataset.bound = '1';
      publishBtn.addEventListener('click', function () { saveMarketingBannerDraft(true); });
    }

    var assignmentForm = $('form-marketing-banner-assignment');
    if (assignmentForm && !assignmentForm.dataset.bound) {
      assignmentForm.dataset.bound = '1';
      assignmentForm.addEventListener('submit', saveMarketingBannerAssignment);
    }

    if ($('mkt-banner-governance-wrap')) {
      var user = getMarketingBannerUser();
      $('mkt-banner-governance-wrap').style.display = (user.role === 'owner' || user.role === 'brand_manager') ? 'inline-flex' : 'none';
    }
  }

  function initializeMarketingBanners() {
    wireMarketingBannerUi();
    loadMarketingBanners();
  }

  window.renderMarketingBannersSkeleton = initializeMarketingBanners;
  window.initializeMarketingBanners = initializeMarketingBanners;

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

  function mountPromotionEditorPage() {
    var backdrop = $('modal-mkt-promotion');
    var page = $('marketing-promotion-editor-view');
    if (!backdrop || !page) return;
    var card = backdrop.querySelector('.x-modal-card');
    if (!card) return;
    page.appendChild(card);
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
  }

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
    var backdrop = $('modal-mkt-promotion');
    var page = $('marketing-promotion-editor-view');
    var card = backdrop && backdrop.querySelector('.x-modal-card');
    if (!card && page) card = page.querySelector('.x-modal-card');
    if (card && backdrop) {
      backdrop.appendChild(card);
      card.classList.remove('x-feature-page-surface');
      card.style.maxWidth = '760px';
      card.style.width = '100%';
      card.style.maxHeight = '92vh';
      card.style.height = 'auto';
      card.style.borderRadius = '14px';
      backdrop.style.display = 'none';
    }
    if (page) page.style.display = 'none';
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
  window.XentraMarketingModule = {
    switchMarketingSection: switchMarketingSection,
    loadMarketingCurrentSubtab: loadMarketingCurrentSubtab,
    loadMarketingBanners: loadMarketingBanners,
    loadMarketingOverview: loadMarketingOverview,
    loadMarketingPromotions: loadMarketingPromotions
  };

})(window, document);
