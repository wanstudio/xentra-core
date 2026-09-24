/**
 * XENTRA CORE — MERCHANT APP OPERATIONAL HOURS
 *
 * Branch Manager operational status panel.
 */
(function () {
  'use strict';

  var S = window.XentraShared;
  var API_BASE = S.API_BASE;
  var $ = S.$;
  var adminFetch = S.adminFetch;
  var getAuthHeaders = S.getAuthHeaders;
  var getStoredUser = S.getStoredUser;

  async function loadBMJamOperasional() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success && data.branch) {
        var b = data.branch;
        var isOpen = b.is_open_override === 1 || b.is_open_override === true;
        var isDeliveryActive = b.is_delivery_active !== 0 && b.is_delivery_active !== false;

        var statusText = $('bm-jam-status-text');
        var toggleOpenBtn = $('btn-bm-jam-toggle-open');
        if (statusText) {
          statusText.innerHTML = isOpen
            ? '<span class="x-badge x-badge-success" style="font-size:11px;">BUKA (Operational Active)</span>'
            : '<span class="x-badge x-badge-danger" style="font-size:11px;">TUTUP SEMENTARA</span>';
        }
        if (toggleOpenBtn) {
          toggleOpenBtn.textContent = isOpen ? 'Tutup Toko' : 'Buka Toko';
          toggleOpenBtn.className = isOpen ? 'x-btn-secondary' : 'x-btn-primary';
        }

        var deliveryText = $('bm-jam-delivery-text');
        var toggleDeliveryBtn = $('btn-bm-jam-toggle-delivery');
        if (deliveryText) {
          deliveryText.innerHTML = isDeliveryActive
            ? '<span class="x-badge x-badge-success" style="font-size:11px;">AKTIF (Menerima Pesanan Online)</span>'
            : '<span class="x-badge x-badge-warning" style="font-size:11px;">DIJEDA (Online Orders Paused)</span>';
        }
        if (toggleDeliveryBtn) {
          toggleDeliveryBtn.textContent = isDeliveryActive ? 'Jeda Pesanan Online' : 'Aktifkan Layanan Online';
          toggleDeliveryBtn.className = isDeliveryActive ? 'x-btn-secondary' : 'x-btn-primary';
        }
      }
    } catch (err) {
      console.warn('[BM Jam Operasional Load Error]:', err);
    }
  }
  window.loadBMJamOperasional = loadBMJamOperasional;

})();
