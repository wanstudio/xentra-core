/**
 * XENTRA CORE — MERCHANT APP REPORTS
 *
 * Branch Manager daily operational sales report.
 */
(function () {
  'use strict';

  var S = window.XentraShared;
  var API_BASE = S.API_BASE;
  var $ = S.$;
  var esc = S.esc;
  var formatMoney = S.formatMoney;
  var adminFetch = S.adminFetch;
  var getAuthHeaders = S.getAuthHeaders;
  var getStoredUser = S.getStoredUser;

  async function loadBMReports() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/orders?status=all', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success && Array.isArray(data.orders)) {
        var orders = data.orders;
        var todayStr = new Date().toISOString().substring(0, 10);

        var todayOrders = orders.filter(function (o) {
          return (o.created_at || '').substring(0, 10) === todayStr;
        });

        var completedOrders = todayOrders.filter(function (o) {
          return o.status === 'completed';
        });

        var netSales = completedOrders.reduce(function (acc, o) {
          return acc + (Number(o.grand_total) || 0);
        }, 0);

        var aov = completedOrders.length > 0 ? Math.round(netSales / completedOrders.length) : 0;

        if ($('bm-report-stat-sales')) $('bm-report-stat-sales').textContent = formatMoney(netSales);
        if ($('bm-report-stat-total-orders')) $('bm-report-stat-total-orders').textContent = todayOrders.length;
        if ($('bm-report-stat-completed-orders')) $('bm-report-stat-completed-orders').textContent = completedOrders.length + ' pesanan selesai';
        if ($('bm-report-stat-aov')) $('bm-report-stat-aov').textContent = formatMoney(aov);

        // Breakdown by channel (completed today)
        var deliveryOrders = completedOrders.filter(function (o) { return o.order_type === 'delivery'; });
        var pickupOrders = completedOrders.filter(function (o) { return o.order_type === 'pickup'; });
        var dineInOrders = completedOrders.filter(function (o) { return o.order_type === 'dine_in'; });

        var deliverySales = deliveryOrders.reduce(function (acc, o) { return acc + (Number(o.grand_total) || 0); }, 0);
        var pickupSales = pickupOrders.reduce(function (acc, o) { return acc + (Number(o.grand_total) || 0); }, 0);
        var dineInSales = dineInOrders.reduce(function (acc, o) { return acc + (Number(o.grand_total) || 0); }, 0);

        if ($('bm-report-channel-delivery')) $('bm-report-channel-delivery').textContent = deliveryOrders.length;
        if ($('bm-report-channel-delivery-sales')) $('bm-report-channel-delivery-sales').textContent = formatMoney(deliverySales);

        if ($('bm-report-channel-pickup')) $('bm-report-channel-pickup').textContent = pickupOrders.length;
        if ($('bm-report-channel-pickup-sales')) $('bm-report-channel-pickup-sales').textContent = formatMoney(pickupSales);

        if ($('bm-report-channel-dinein')) $('bm-report-channel-dinein').textContent = dineInOrders.length;
        if ($('bm-report-channel-dinein-sales')) $('bm-report-channel-dinein-sales').textContent = formatMoney(dineInSales);

        // Recent completed table
        var tbody = $('bm-report-completed-tbody');
        if (tbody) {
          if (!completedOrders.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">Belum ada pesanan selesai hari ini.</td></tr>';
          } else {
            tbody.innerHTML = completedOrders.slice(0, 5).map(function (o) {
              var typeBadge = (o.order_type === 'delivery')
                ? '<span class="x-badge x-badge-info">DELIVERY</span>'
                : (o.order_type === 'dine_in' ? '<span class="x-badge" style="background:#ede9fe;color:#6d28d9;">DINE IN</span>' : '<span class="x-badge x-badge-warning">PICKUP</span>');
              return '<tr>' +
                '<td><strong>' + esc(o.order_number || o.id) + '</strong></td>' +
                '<td>' + esc(o.customer_name || 'Pelanggan') + '</td>' +
                '<td>' + typeBadge + '</td>' +
                '<td><strong style="color:var(--accent-teal);">' + formatMoney(o.grand_total) + '</strong></td>' +
              '</tr>';
            }).join('');
          }
        }
      }
    } catch (err) {
      console.warn('[BM Reports Load Error]:', err);
    }
  }
  window.loadBMReports = loadBMReports;

})();
