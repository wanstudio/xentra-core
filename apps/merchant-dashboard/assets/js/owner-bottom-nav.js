(function () {
  'use strict';

  /*
   * Owner Bottom Navigation
   * -----------------------
   * Application-shell controller only.
   * Routing remains owned by dashboard.js / navigateTo().
   */

  var MODULE_MAP = {
    'overview': 'beranda',
    'stock': 'bisnis',
    'business': 'bisnis',
    'catalog': 'bisnis',
    'catalog/products': 'bisnis',
    'catalog/categories': 'bisnis',
    'catalog/menus': 'bisnis',
    'branches': 'bisnis',
    'customers': 'bisnis',
    'marketing': 'bisnis',
    'marketing/promotions': 'bisnis',
    'marketing/banners': 'bisnis',
    'marketing/discounts': 'bisnis',
    'orders': 'pesanan',
    'finance': 'keuangan',
    'finance/overview': 'keuangan',
    'finance/transactions': 'keuangan',
    'finance/payouts': 'keuangan',
    'finance/payment-methods': 'keuangan',
    'more': 'lainnya',
    'lainnya': 'lainnya',
    'team': 'lainnya',
    'settings': 'lainnya',
    'reports': 'lainnya',
    'settings/business/profile': 'lainnya',
    'settings/security': 'lainnya'
  };

  function resolveModule(route) {
    if (MODULE_MAP[route]) return MODULE_MAP[route];

    if (route.indexOf('catalog/') === 0 ||
        route.indexOf('branches/') === 0 ||
        route.indexOf('marketing/') === 0 ||
        route.indexOf('customers/') === 0) return 'bisnis';

    if (route.indexOf('finance/') === 0) return 'keuangan';
    if (route.indexOf('orders/') === 0) return 'pesanan';

    if (route.indexOf('team/') === 0 ||
        route.indexOf('settings/') === 0 ||
        route.indexOf('reports/') === 0) return 'lainnya';

    return 'beranda';
  }

  function syncOwnerBottomNavActive(route) {
    var module = resolveModule(route || 'overview');
    var nav = document.getElementById('x-owner-bottom-nav');
    if (!nav) return;

    nav.querySelectorAll('.x-owner-nav-item[data-tab-module]').forEach(function (btn) {
      var active = btn.dataset.tabModule === module;
      btn.classList.toggle('active', active);
      if (active) {
        btn.setAttribute('aria-current', 'page');
      } else {
        btn.removeAttribute('aria-current');
      }
    });
  }

  function initOwnerBottomNav() {
    var nav = document.getElementById('x-owner-bottom-nav');
    if (!nav || nav.dataset.initialized === 'true') return;

    nav.dataset.initialized = 'true';

    nav.querySelectorAll('.x-owner-nav-item[data-route]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (typeof window.navigateTo === 'function') {
          window.navigateTo(btn.dataset.route);
        }
      });
    });
  }

  window.initOwnerBottomNav = initOwnerBottomNav;
  window.syncOwnerBottomNavActive = syncOwnerBottomNavActive;
  window.ownerBottomNavResolveModule = resolveModule;
})();
