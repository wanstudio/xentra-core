/**
 * XENTRA CORE — MERCHANT APP PROMOTIONS
 *
 * Branch Manager promotion activation and redemption operations.
 */
(function () {
  'use strict';

  var S = window.XentraShared;
  var API_BASE = S.API_BASE;
  var $ = S.$;
  var esc = S.esc;
  var formatMoney = S.formatMoney;
  var showToast = S.showToast;
  var adminFetch = S.adminFetch;
  var getAuthHeaders = S.getAuthHeaders;
  var getStoredUser = S.getStoredUser;

  var _bmPromoState = {
    promotions: [],
    redemptions: [],
    fetchSeq: 0
  };

  async function loadBMPromotions() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;

    var listContainer = $('bm-promo-list');
    var redemptionsTbody = $('bm-promo-redemptions-tbody');

    if (listContainer && (!_bmPromoState.promotions || !_bmPromoState.promotions.length)) {
      listContainer.innerHTML = '<div class="text-center py-6 text-muted">Memuat promosi...</div>';
    }
    if (redemptionsTbody && (!_bmPromoState.redemptions || !_bmPromoState.redemptions.length)) {
      redemptionsTbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-muted">Memuat riwayat penebusan...</td></tr>';
    }

    var currentSeq = ++_bmPromoState.fetchSeq;

    try {
      var pRes = await adminFetch(API_BASE + '/admin/marketing/promotions', { headers: getAuthHeaders() });
      var pData = await pRes.json();

      var rUrl = API_BASE + '/admin/marketing/redemptions' + (branchId ? ('?branch_id=' + encodeURIComponent(branchId)) : '');
      var rRes = await adminFetch(rUrl, { headers: getAuthHeaders() });
      var rData = await rRes.json();

      if (currentSeq !== _bmPromoState.fetchSeq) return;

      var promos = (pRes.ok && pData.success && Array.isArray(pData.promotions)) ? pData.promotions : [];
      var redemptions = (rRes.ok && rData.success && Array.isArray(rData.redemptions)) ? rData.redemptions : [];

      _bmPromoState.promotions = promos;
      _bmPromoState.redemptions = redemptions;

      updateBMPromoStats(promos, redemptions);
      renderBMPromotionsList(promos);
      renderBMRedemptionsTable(redemptions);

    } catch (err) {
      if (currentSeq !== _bmPromoState.fetchSeq) return;
      console.warn('[BM Promo Load Error]:', err);
      if (listContainer) listContainer.innerHTML = '<div class="text-center py-6 text-danger">Kesalahan jaringan saat memuat promosi.</div>';
      if (redemptionsTbody) redemptionsTbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-danger">Kesalahan jaringan.</td></tr>';
    }
  }
  window.loadBMPromotions = loadBMPromotions;

  function updateBMPromoStats(promos, redemptions) {
    var activeCount = (promos || []).filter(function (p) { return p.is_active === 1 || p.is_active === true; }).length;
    var totalRedemptions = (redemptions || []).length;
    var totalDiscount = (redemptions || []).reduce(function (acc, r) {
      return acc + (Number(r.benefit_amount || r.discount_amount || r.discount_applied) || 0);
    }, 0);

    if ($('bm-promo-stat-active')) $('bm-promo-stat-active').textContent = activeCount;
    if ($('bm-promo-stat-redemptions')) $('bm-promo-stat-redemptions').textContent = totalRedemptions;
    if ($('bm-promo-stat-discount-given')) $('bm-promo-stat-discount-given').textContent = formatMoney(totalDiscount);
  }

  function renderBMPromotionsList(promos) {
    var container = $('bm-promo-list');
    if (!container) return;

    if (!promos || !promos.length) {
      container.innerHTML = '<div class="text-center py-6 text-muted">Belum ada promosi aktif dari Brand untuk cabang ini.</div>';
      return;
    }

    var now = new Date().toISOString();

    container.innerHTML = promos.map(function (p) {
      // Branch-level activation state
      var isBranchActive = p.branch_is_active !== undefined ? (p.branch_is_active === 1 || p.branch_is_active === true) : (p.is_active === 1 || p.is_active === true);
      var isBrandActive = (p.is_active === 1 || p.is_active === true);

      // Operational Status derivation
      var statusBadge = '';
      var canToggle = true;

      if (!isBrandActive) {
        statusBadge = '<span class="x-badge" style="background:#f1f5f9;color:#64748b;font-size:11px;">NONAKTIF (BRAND)</span>';
        canToggle = false;
      } else if (p.end_at && p.end_at < now) {
        statusBadge = '<span class="x-badge" style="background:#fee2e2;color:#991b1b;font-size:11px;">KADALUARSA</span>';
        canToggle = false;
      } else if (p.start_at && p.start_at > now) {
        statusBadge = '<span class="x-badge" style="background:#fef3c7;color:#92400e;font-size:11px;">TERJADWAL</span>';
      } else if (isBranchActive) {
        statusBadge = '<span class="x-badge x-badge-success" style="font-size:11px;font-weight:700;">AKTIF DI CABANG</span>';
      } else {
        statusBadge = '<span class="x-badge" style="background:#f1f5f9;color:#475569;font-size:11px;">NONAKTIF (CABANG)</span>';
      }

      // Action button
      var actionBtnHtml = '';
      if (canToggle) {
        if (isBranchActive) {
          actionBtnHtml = '<button type="button" class="x-btn-secondary" onclick="toggleBMPromoActivation(\'' + esc(p.id) + '\', 0, this)" style="padding:5px 12px;font-size:12px;color:#dc2626;border-color:#fca5a5;">Nonaktifkan di Cabang</button>';
        } else {
          actionBtnHtml = '<button type="button" class="x-btn-primary" onclick="toggleBMPromoActivation(\'' + esc(p.id) + '\', 1, this)" style="padding:5px 12px;font-size:12px;">Aktifkan di Cabang</button>';
        }
      } else {
        actionBtnHtml = '<span style="font-size:11px;color:#94a3b8;font-style:italic;">Dikelola Pusat</span>';
      }

      // Rewards summary text
      var rewardText = '';
      if (Array.isArray(p.rewards) && p.rewards.length > 0) {
        var rw = p.rewards[0];
        rewardText = (rw.reward_type === 'freebie_product' ? 'Gratis: ' : '') + (rw.target_product_name || rw.target_product_id || 'Produk Promo');
      } else if (p.discount_type) {
        rewardText = p.discount_type === 'percentage' ? (p.discount_value + '%') : formatMoney(p.discount_value);
      } else {
        rewardText = 'Insentif Promo';
      }

      var promoCode = p.code || p.promo_code;

      return '<div class="x-card" style="padding:14px 16px; border:1px solid var(--border-color); border-radius:8px; background:#ffffff;">' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">' +
          '<div>' +
            '<strong style="font-size:15px; color:var(--text-main);">' + esc(p.name || p.title || 'Promosi') + '</strong>' +
            (promoCode ? ('<div style="font-size:12px; margin-top:3px;">Kode: <code style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-weight:700;">' + esc(promoCode) + '</code></div>') : '') +
          '</div>' +
          statusBadge +
        '</div>' +
        (p.description ? ('<p style="font-size:12px; color:var(--text-muted); margin:4px 0 8px;">' + esc(p.description) + '</p>') : '') +
        '<div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; border-top:1px dashed var(--border-color); padding-top:10px; margin-top:8px;">' +
          '<div>Benefit: <strong style="color:var(--accent-teal);">' + esc(rewardText) + '</strong></div>' +
          actionBtnHtml +
        '</div>' +
      '</div>';
    }).join('');
  }

  async function toggleBMPromoActivation(promoId, newStatus, btnEl) {
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = 'Memproses...';
    }

    try {
      var res = await adminFetch('/api/v1/admin/marketing/promotions/' + encodeURIComponent(promoId) + '/branch-activation', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: newStatus })
      });
      var json = await res.json();
      if (!res.ok || !json.success) throw new Error((json && json.error) || 'Gagal mengubah status aktivasi promo di cabang.');

      showToast(newStatus === 1 ? 'Promo berhasil diaktifkan untuk operasional cabang ini.' : 'Promo berhasil dinonaktifkan di cabang ini.');
      loadBMPromotions();
    } catch (err) {
      console.error('[BM Promo Toggle Error]:', err);
      showToast(err.message || 'Gagal mengubah status promosi.');
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.textContent = newStatus === 1 ? 'Aktifkan di Cabang' : 'Nonaktifkan di Cabang';
      }
    }
  }
  window.toggleBMPromoActivation = toggleBMPromoActivation;

  function renderBMRedemptionsTable(redemptions) {
    var tbody = $('bm-promo-redemptions-tbody');
    if (!tbody) return;

    if (!redemptions || !redemptions.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-muted">Belum ada penebusan promo di cabang ini.</td></tr>';
      return;
    }

    tbody.innerHTML = redemptions.slice(0, 10).map(function (r) {
      var time = (r.redeemed_at || r.created_at || '').substring(0, 16).replace('T', ' ') || '—';
      var discountVal = Number(r.benefit_amount || r.discount_amount || r.discount_applied) || 0;
      return '<tr>' +
        '<td><strong>' + esc(r.order_number || r.order_id) + '</strong></td>' +
        '<td><code>' + esc(r.promo_code || r.promotion_name || 'Promo') + '</code></td>' +
        '<td><strong style="color:var(--accent-teal);">' + formatMoney(discountVal) + '</strong></td>' +
        '<td style="font-size:12px; color:var(--text-muted);">' + time + '</td>' +
      '</tr>';
    }).join('');
  }

})();
