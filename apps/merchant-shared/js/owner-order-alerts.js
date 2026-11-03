/**
 * XENTRA OWNER ORDER ALERTS & FLOATING NOTIFICATION
 * 
 * Rules:
 * 1. Sound: Exactly 1 time (window.XentraAudio.orderReceived({ single: true, maxRepeats: 1 }))
 * 2. Floating notification: Sleek top-floating heads-up banner with order code,
 *    customer / table, nominal total, direct navigation to Orders, and auto-dismiss.
 */
(function (window) {
  'use strict';

  var _pollInterval = 7000; // 7s background poll interval
  var _pollTimer = null;
  var _knownPendingOrderIds = null;
  var _activeBannerTimer = null;
  var _lastOwnerAlertTimestamp = 0;

  var ALERTED_ORDERS_STORAGE_KEY = 'xentra_owner_alerted_orders_v1';
  var _alertedOrderIds = (function () {
    try {
      var raw = sessionStorage.getItem(ALERTED_ORDERS_STORAGE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (_) {
      return new Set();
    }
  })();

  function persistAlertedOrderIds() {
    try {
      var arr = Array.from(_alertedOrderIds);
      if (arr.length > 200) {
        arr = arr.slice(-150);
        _alertedOrderIds = new Set(arr);
      }
      sessionStorage.setItem(ALERTED_ORDERS_STORAGE_KEY, JSON.stringify(arr));
    } catch (_) {}
  }

  var TOKEN_KEY = 'xentra_merchant_token';
  var USER_KEY = 'xentra_merchant_user';

  function getStoredToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function getStoredUser() {
    try {
      var raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function formatMoney(amount) {
    var num = Number(amount) || 0;
    return 'Rp ' + num.toLocaleString('id-ID');
  }

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Inject Floating Notification Styles
  function injectBannerStyles() {
    if (document.getElementById('x-owner-banner-styles')) return;
    var style = document.createElement('style');
    style.id = 'x-owner-banner-styles';
    style.textContent = [
      '@keyframes xOwnerBannerSlideDown {',
      '  0% { transform: translate(-50%, -120%); opacity: 0; }',
      '  100% { transform: translate(-50%, 0); opacity: 1; }',
      '}',
      '@keyframes xOwnerBannerSlideUp {',
      '  0% { transform: translate(-50%, 0); opacity: 1; }',
      '  100% { transform: translate(-50%, -120%); opacity: 0; }',
      '}',
      '@keyframes xOwnerBannerProgress {',
      '  0% { width: 100%; }',
      '  100% { width: 0%; }',
      '}',
      '.x-owner-floating-banner-container {',
      '  position: fixed !important;',
      '  top: 14px !important;',
      '  left: 50% !important;',
      '  transform: translate(-50%, 0) !important;',
      '  z-index: 999999 !important;',
      '  width: calc(100% - 24px) !important;',
      '  max-width: 440px !important;',
      '  background: #ffffff !important;',
      '  border: 1.5px solid #e2e8f0 !important;',
      '  border-radius: 16px !important;',
      '  box-shadow: 0 20px 40px -10px rgba(15, 23, 42, 0.28), 0 0 0 1px rgba(15, 23, 42, 0.05) !important;',
      '  overflow: hidden !important;',
      '  cursor: pointer !important;',
      '  animation: xOwnerBannerSlideDown 0.32s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;',
      '  font-family: -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif !important;',
      '  box-sizing: border-box !important;',
      '  user-select: none !important;',
      '}',
      '.x-owner-floating-banner-container.is-hiding {',
      '  animation: xOwnerBannerSlideUp 0.24s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;',
      '}',
      '.x-owner-banner-inner {',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  padding: 12px 14px !important;',
      '  gap: 12px !important;',
      '}',
      '.x-owner-banner-icon {',
      '  width: 42px !important;',
      '  height: 42px !important;',
      '  border-radius: 12px !important;',
      '  background: #dcfce7 !important;',
      '  color: #15803d !important;',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  justify-content: center !important;',
      '  font-size: 20px !important;',
      '  flex-shrink: 0 !important;',
      '  box-shadow: 0 2px 8px rgba(22, 163, 74, 0.2) !important;',
      '}',
      '.x-owner-banner-content {',
      '  flex: 1 1 auto !important;',
      '  min-width: 0 !important;',
      '}',
      '.x-owner-banner-title-row {',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  justify-content: space-between !important;',
      '  margin-bottom: 2px !important;',
      '}',
      '.x-owner-banner-title {',
      '  font-size: 13.5px !important;',
      '  font-weight: 800 !important;',
      '  color: #0f172a !important;',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  gap: 5px !important;',
      '}',
      '.x-owner-banner-time {',
      '  font-size: 11px !important;',
      '  font-weight: 600 !important;',
      '  color: #64748b !important;',
      '}',
      '.x-owner-banner-subtitle {',
      '  font-size: 12px !important;',
      '  color: #334155 !important;',
      '  font-weight: 600 !important;',
      '  white-space: nowrap !important;',
      '  overflow: hidden !important;',
      '  text-overflow: ellipsis !important;',
      '}',
      '.x-owner-banner-total {',
      '  font-size: 12.5px !important;',
      '  font-weight: 800 !important;',
      '  color: #16a34a !important;',
      '}',
      '.x-owner-banner-actions {',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  gap: 6px !important;',
      '  flex-shrink: 0 !important;',
      '}',
      '.x-owner-banner-btn-view {',
      '  padding: 7px 13px !important;',
      '  background: #0f172a !important;',
      '  color: #ffffff !important;',
      '  border-radius: 9px !important;',
      '  font-size: 12px !important;',
      '  font-weight: 800 !important;',
      '  border: none !important;',
      '  cursor: pointer !important;',
      '  transition: transform 0.1s ease !important;',
      '  white-space: nowrap !important;',
      '}',
      '.x-owner-banner-btn-view:active {',
      '  transform: scale(0.95) !important;',
      '}',
      '.x-owner-banner-btn-close {',
      '  width: 26px !important;',
      '  height: 26px !important;',
      '  border-radius: 50% !important;',
      '  background: #f1f5f9 !important;',
      '  color: #64748b !important;',
      '  border: none !important;',
      '  cursor: pointer !important;',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  justify-content: center !important;',
      '  font-size: 13px !important;',
      '}',
      '.x-owner-banner-progress-bar {',
      '  height: 3px !important;',
      '  background: #16a34a !important;',
      '  width: 100% !important;',
      '  animation: xOwnerBannerProgress 8s linear forwards !important;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function dismissOwnerFloatingNotification() {
    var banner = document.getElementById('x-owner-floating-banner');
    if (!banner) return;
    if (_activeBannerTimer) {
      clearTimeout(_activeBannerTimer);
      _activeBannerTimer = null;
    }
    banner.classList.add('is-hiding');
    setTimeout(function () {
      if (banner && banner.parentNode) {
        banner.parentNode.removeChild(banner);
      }
    }, 240);
  }

  function navigateToOwnerOrders() {
    dismissOwnerFloatingNotification();
    // 1. Mobile Owner App route switch (React Single App Shell uses hash routing)
    if (window.location.hash !== undefined) {
      window.location.hash = '#orders';
      try {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (_) {}
    }
    // 2. Desktop Merchant Dashboard route switch
    if (typeof window.navigateTo === 'function') {
      window.navigateTo('orders');
    }
    if (typeof window.showSection === 'function') {
      window.showSection('orders');
    }
  }

  function showOwnerFloatingNotification(order) {
    if (!order) return;
    injectBannerStyles();

    // Remove existing banner if already displayed
    var existing = document.getElementById('x-owner-floating-banner');
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
    if (_activeBannerTimer) {
      clearTimeout(_activeBannerTimer);
      _activeBannerTimer = null;
    }

    var orderNumber = order.order_number || order.code || (order.id ? ('#' + String(order.id).slice(-4)) : '#OD-000');
    var fulfillmentType = order.order_type || order.fulfillment_type || 'delivery';
    var typeBadge = (fulfillmentType === 'dine_in') ? '🍽️ Dine-in' : (fulfillmentType === 'pickup' ? '🛍️ Takeaway' : '🛵 Delivery');
    var totalAmount = order.grand_total || order.total_amount || order.subtotal || 0;
    var customer = order.customer_name || (order.table_number ? ('Meja ' + order.table_number) : 'Pelanggan');
    var branch = order.branch_name ? (' • ' + order.branch_name) : '';

    var banner = document.createElement('div');
    banner.id = 'x-owner-floating-banner';
    banner.className = 'x-owner-floating-banner-container';
    banner.setAttribute('role', 'alert');
    banner.onclick = function (e) {
      if (e.target.closest('.x-owner-banner-btn-close')) {
        e.stopPropagation();
        dismissOwnerFloatingNotification();
        return;
      }
      navigateToOwnerOrders();
    };

    banner.innerHTML = [
      '<div class="x-owner-banner-inner">',
      '  <div class="x-owner-banner-icon">🛍️</div>',
      '  <div class="x-owner-banner-content">',
      '    <div class="x-owner-banner-title-row">',
      '      <span class="x-owner-banner-title">🔔 Pesanan Baru Masuk!</span>',
      '      <span class="x-owner-banner-time">Baru saja</span>',
      '    </div>',
      '    <div class="x-owner-banner-subtitle">',
      '      <strong>' + esc(orderNumber) + '</strong> (' + typeBadge + ') • <span class="x-owner-banner-total">' + formatMoney(totalAmount) + '</span>',
      '    </div>',
      '    <div style="font-size:11.5px; color:#64748b; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">',
      '      ' + esc(customer) + esc(branch),
      '    </div>',
      '  </div>',
      '  <div class="x-owner-banner-actions">',
      '    <button type="button" class="x-owner-banner-btn-view" onclick="event.stopPropagation(); window.navigateToOwnerOrders ? window.navigateToOwnerOrders() : null;">Lihat</button>',
      '    <button type="button" class="x-owner-banner-btn-close" aria-label="Tutup" onclick="event.stopPropagation(); window.dismissOwnerFloatingNotification ? window.dismissOwnerFloatingNotification() : null;">✕</button>',
      '  </div>',
      '</div>',
      '<div class="x-owner-banner-progress-bar"></div>'
    ].join('\n');

    document.body.appendChild(banner);

    // Auto dismiss after 8 seconds
    _activeBannerTimer = setTimeout(function () {
      dismissOwnerFloatingNotification();
    }, 8000);

    // Browser system notification if permitted
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Pesanan Baru Masuk: ' + orderNumber, {
          body: customer + ' • ' + formatMoney(totalAmount) + branch,
          icon: '/owner/assets/icons/reicon_food-tray-filled.svg'
        });
      } catch (_) {}
    }
  }

  // Handle new pending order alert for Owner:
  // Rule: CUKUP BUNYI 1 KALI + FLOATING NOTIFICATION (STRICT ZERO REPEAT)
  function triggerOwnerNewOrderAlert(order) {
    if (!order) return;
    var orderIdStr = String(order.id || order.order_id || '');
    if (orderIdStr && _alertedOrderIds.has(orderIdStr)) {
      return;
    }

    var now = Date.now();
    var canPlaySound = (now - _lastOwnerAlertTimestamp) >= 5000;

    if (orderIdStr) {
      _alertedOrderIds.add(orderIdStr);
      persistAlertedOrderIds();
    }

    if (canPlaySound) {
      _lastOwnerAlertTimestamp = now;
      // 1. Bunyi 1 kali saja (single: true, maxRepeats: 1)
      if (window.XentraAudio && typeof window.XentraAudio.orderReceived === 'function') {
        window.XentraAudio.orderReceived({
          single: true,
          maxRepeats: 1,
          force: true,
          text: 'Ada pesanan baru masuk!'
        });
      }
    }

    // 2. Floating notification
    showOwnerFloatingNotification(order);
  }

  async function checkOwnerNewOrders() {
    var token = getStoredToken();
    if (!token) return;

    var user = getStoredUser();
    // Run if user is owner or brand_manager, or if running in owner surfaces
    var isOwnerSurface = (
      (user && (user.role === 'owner' || user.role === 'brand_manager')) ||
      window.location.pathname.includes('/owner') ||
      window.location.pathname.includes('/dashboard')
    );
    if (!isOwnerSurface) return;

    try {
      var res = await fetch('/api/v1/admin/orders?status=pending&limit=15', {
        headers: {
          'Authorization': 'Bearer ' + token,
          'Accept': 'application/json'
        },
        cache: 'no-store'
      });
      if (!res.ok) return;

      var data = await res.json();
      if (!data || !data.success || !Array.isArray(data.orders)) return;

      var currentPendingOrders = data.orders;

      // First run: seed known IDs without alerting preexisting orders
      if (_knownPendingOrderIds === null) {
        _knownPendingOrderIds = new Set();
        currentPendingOrders.forEach(function (ord) {
          var idStr = String(ord.id);
          _knownPendingOrderIds.add(idStr);
          _alertedOrderIds.add(idStr);
        });
        persistAlertedOrderIds();
        return;
      }

      // Detect genuinely new pending orders that have not been alerted yet
      var newlyAppeared = [];
      currentPendingOrders.forEach(function (ord) {
        var idStr = String(ord.id);
        if (!_knownPendingOrderIds.has(idStr) && !_alertedOrderIds.has(idStr)) {
          newlyAppeared.push(ord);
        }
        _knownPendingOrderIds.add(idStr);
      });

      if (newlyAppeared.length > 0) {
        // Trigger alert for the newest order (strictly 1 sound + floating banner)
        var latestOrder = newlyAppeared[0];
        triggerOwnerNewOrderAlert(latestOrder);
      }
    } catch (err) {
      // Graceful offline/network failure
    }
  }

  function startOwnerOrderMonitor() {
    if (_pollTimer) return;
    _knownPendingOrderIds = null; // will seed on first run
    checkOwnerNewOrders();
    _pollTimer = setInterval(checkOwnerNewOrders, _pollInterval);
  }

  function stopOwnerOrderMonitor() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  // Auto start on DOM ready if in owner context
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(startOwnerOrderMonitor, 1000);
    });
  } else {
    setTimeout(startOwnerOrderMonitor, 1000);
  }

  window.XentraOwnerOrderMonitor = {
    start: startOwnerOrderMonitor,
    stop: stopOwnerOrderMonitor,
    showFloatingNotification: showOwnerFloatingNotification,
    dismissFloatingNotification: dismissOwnerFloatingNotification,
    triggerAlert: triggerOwnerNewOrderAlert
  };
  window.navigateToOwnerOrders = navigateToOwnerOrders;
  window.dismissOwnerFloatingNotification = dismissOwnerFloatingNotification;
  window.showOwnerFloatingNotification = showOwnerFloatingNotification;

})(window);
