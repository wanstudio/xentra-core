/**
 * Xentra Core SPA Router & View Switcher
 * Provides instant 0ms view transitions between Menu, Checkout, and Order Status
 * with full browser history (Back button / swipe) support.
 */
(function () {
  'use strict';

  // Seeded from the URL: on a direct page load (refresh, deep link, PWA cold
  // start) nothing calls navigate()/hashchange, so leaving this at the default
  // made every subscriber that guards on the current view — checkout's store
  // subscription in particular — silently inert until the next reload.
  var currentView = getViewFromUrl();
  var listeners = [];

  function getViewFromUrl() {
    var hash = window.location.hash || '';
    if (hash.startsWith('#checkout') || window.location.pathname.startsWith('/checkout')) {
      return 'checkout';
    }
    if (hash.startsWith('#order-received') || window.location.pathname.startsWith('/order-received')) {
      return 'order-received';
    }
    if (hash.startsWith('#affiliate') || window.location.pathname.startsWith('/affiliate')) {
      return 'affiliate';
    }
    if (hash.startsWith('#history') || window.location.pathname.startsWith('/history')) {
      return 'history';
    }
    if (hash.startsWith('#profile') || window.location.pathname.startsWith('/profile')) {
      return 'profile';
    }
  if (hash.startsWith('#account-settings') || window.location.pathname.startsWith('/pengaturan-akun')) {
    return 'account-settings';
  }
  if (hash.startsWith('#collections') || window.location.pathname.startsWith('/collections')) {
    return 'collections';
  }
    return 'home';
  }

  function getOrderIdFromUrl() {
    var hash = window.location.hash || '';
    var matchHash = hash.match(/#order-received[\/=]([a-zA-Z0-9_-]+)/);
    if (matchHash && matchHash[1]) return matchHash[1];

    var matchPath = window.location.pathname.match(/\/order-received\/([a-zA-Z0-9_-]+)/);
    if (matchPath && matchPath[1]) return matchPath[1];

    var params = new URLSearchParams(window.location.search);
    return params.get('order_id') || params.get('id') || null;
  }

  function getItemIdFromUrl() {
    var hash = window.location.hash || '';
    var matchHash = hash.match(/#checkout[\/=]item[\/=]([a-zA-Z0-9_-]+)/) || hash.match(/#checkout\?item=([a-zA-Z0-9_-]+)/);
    if (matchHash && matchHash[1]) return matchHash[1];

    var params = new URLSearchParams(window.location.search);
    return params.get('item_id') || params.get('item') || null;
  }

  // R1 CART/CHECKOUT BOUNDARY: a checkout is always single-branch. The branch
  // param scopes the checkout to ONE branch's cart lines (#checkout/branch/<id>
  // or ?branch_id=). '__unassigned__' is the legacy provenance sentinel (lines
  // added without branch context); null means no scope filter (legacy flows).
  function getBranchIdFromUrl() {
    var hash = window.location.hash || '';
    var matchHash = hash.match(/#checkout[\/=]branch[\/=]([a-zA-Z0-9_-]+)/) || hash.match(/#checkout\?branch(?:_id)?=([a-zA-Z0-9_-]+)/);
    if (matchHash && matchHash[1]) return matchHash[1];

    var params = new URLSearchParams(window.location.search);
    return params.get('branch_id') || params.get('branch') || null;
  }

  var _lastNavigatedHash = null;

  function navigate(view, params) {
    if (view === 'checkout') {
      var branchId = (params && params.branchId) || '';
      var itemId = (params && params.itemId) || '';
      _lastNavigatedHash = branchId
        ? '#checkout/branch/' + branchId
        : (itemId ? '#checkout/item/' + itemId : '#checkout');
      window.location.hash = _lastNavigatedHash;
    } else if (view === 'order-received') {
      var orderId = (params && params.orderId) || '';
      _lastNavigatedHash = '#order-received/' + orderId;
      window.location.hash = _lastNavigatedHash;
    } else if (view === 'affiliate') {
      _lastNavigatedHash = '#affiliate';
      window.location.hash = '#affiliate';
    } else if (view === 'history') {
      _lastNavigatedHash = '#history';
      window.location.hash = '#history';
    } else if (view === 'profile') {
      _lastNavigatedHash = '#profile';
      window.location.hash = '#profile';
    } else if (view === 'account-settings') {
      _lastNavigatedHash = '#account-settings';
      window.location.hash = '#account-settings';
    } else if (view === 'collections') {
      _lastNavigatedHash = '#collections';
      window.location.hash = '#collections';
    } else {
      // Navigating to Home
      if (window.location.pathname.startsWith('/checkout') ||
          window.location.pathname.startsWith('/order-received') ||
          window.location.pathname.startsWith('/affiliate') ||
          window.location.pathname.startsWith('/history') ||
          window.location.pathname.startsWith('/profile') ||
          window.location.pathname.startsWith('/collections')) {
        window.location.href = '/';
        return;
      }
      _lastNavigatedHash = '';
      if (window.location.hash) {
        window.location.hash = '';
      }
    }

    currentView = view;
    emit(view, params);
  }

  function goBack() {
    if (window.location.pathname.startsWith('/checkout') ||
        window.location.pathname.startsWith('/order-received') ||
        window.location.pathname.startsWith('/affiliate') ||
        window.location.pathname.startsWith('/history') ||
        window.location.pathname.startsWith('/profile') ||
        window.location.pathname.startsWith('/collections')) {
      window.location.href = '/';
      return;
    }
    if (window.location.hash) {
      window.location.hash = '';
      return;
    }
    window.location.href = '/';
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (l) { return l !== fn; });
    };
  }

  function emit(view, params) {
    listeners.forEach(function (fn) {
      try { fn(view, params); } catch (e) { console.error('[Router]', e); }
    });
  }

  // Handle URL hash changes & browser back button
  window.addEventListener('hashchange', function () {
    var currentHash = window.location.hash || '';
    if (_lastNavigatedHash !== null && currentHash === _lastNavigatedHash) {
      _lastNavigatedHash = null;
      return;
    }
    _lastNavigatedHash = null;
    var v = getViewFromUrl();
    var orderId = getOrderIdFromUrl();
    var itemId = getItemIdFromUrl();
    var branchId = getBranchIdFromUrl();
    currentView = v;
    emit(v, { orderId: orderId, itemId: itemId, branchId: branchId });
  });

  window.addEventListener('popstate', function () {
    // If an overlay was popped/handled by XentraNav, prevent switching route view
    if (window.XentraNav && typeof window.XentraNav.isHandlingPopstate === 'function' && window.XentraNav.isHandlingPopstate()) {
      return;
    }
    var v = getViewFromUrl();
    var orderId = getOrderIdFromUrl();
    var itemId = getItemIdFromUrl();
    var branchId = getBranchIdFromUrl();
    currentView = v;
    emit(v, { orderId: orderId, itemId: itemId, branchId: branchId });
  });

  // Capture affiliate referral code on page load / entry
  try {
    var urlParams = new URLSearchParams(window.location.search);
    var affRef = urlParams.get('ref') || urlParams.get('aff');
    var affMenu = urlParams.get('menu') || urlParams.get('menu_id');
    if (affRef) {
      affRef = affRef.trim();
      localStorage.setItem('xentra_affiliate_ref', affRef);
      if (affMenu) {
        sessionStorage.setItem('xentra_affiliate_menu', affMenu.trim());
      }
      var visitorSessionId = localStorage.getItem('xentra_visitor_session_id');
      if (!visitorSessionId) {
        visitorSessionId = 'vis_' + Math.random().toString(36).substring(2, 12) + '_' + Date.now();
        localStorage.setItem('xentra_visitor_session_id', visitorSessionId);
      }
      fetch('/api/v1/customer/affiliate/attribute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': visitorSessionId
        },
        body: JSON.stringify({
          referral_code: affRef,
          session_id: visitorSessionId,
          menu_id: affMenu || null,
          source: 'link'
        })
      }).catch(function () {});
    }
  } catch (_) {}

  // Export
  window.Xentra = window.Xentra || {};
  window.Xentra.Router = {
    getCurrentView: function () { return currentView; },
    getViewFromUrl: getViewFromUrl,
    getOrderIdFromUrl: getOrderIdFromUrl,
    getItemIdFromUrl: getItemIdFromUrl,
    getBranchIdFromUrl: getBranchIdFromUrl,
    navigate: navigate,
    goBack: goBack,
    subscribe: subscribe
  };
})();
