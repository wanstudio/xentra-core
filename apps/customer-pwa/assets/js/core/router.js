/**
 * Xentra Core SPA Router & View Switcher
 * Provides instant 0ms view transitions between Menu, Checkout, and Order Status
 * with full browser history (Back button / swipe) support.
 */
(function () {
  'use strict';

  var currentView = 'home';
  var listeners = [];

  function getViewFromUrl() {
    var hash = window.location.hash || '';
    if (hash.startsWith('#checkout') || window.location.pathname.startsWith('/checkout')) {
      return 'checkout';
    }
    if (hash.startsWith('#order-received') || window.location.pathname.startsWith('/order-received')) {
      return 'order-received';
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

  function navigate(view, params) {
    if (view === 'checkout') {
      var itemId = (params && params.itemId) || '';
      window.location.hash = itemId ? '#checkout/item/' + itemId : '#checkout';
    } else if (view === 'order-received') {
      var orderId = (params && params.orderId) || '';
      window.location.hash = '#order-received/' + orderId;
    } else {
      // Navigating to Home
      if (window.location.pathname.startsWith('/checkout') || window.location.pathname.startsWith('/order-received')) {
        window.location.href = '/';
        return;
      }
      if (window.location.hash) {
        window.location.hash = '';
      }
    }

    currentView = view;
    emit(view, params);
  }

  function goBack() {
    if (window.location.pathname.startsWith('/checkout') || window.location.pathname.startsWith('/order-received')) {
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
    var v = getViewFromUrl();
    var orderId = getOrderIdFromUrl();
    var itemId = getItemIdFromUrl();
    currentView = v;
    emit(v, { orderId: orderId, itemId: itemId });
  });

  window.addEventListener('popstate', function () {
    var v = getViewFromUrl();
    var orderId = getOrderIdFromUrl();
    var itemId = getItemIdFromUrl();
    currentView = v;
    emit(v, { orderId: orderId, itemId: itemId });
  });

  // Export
  window.Xentra = window.Xentra || {};
  window.Xentra.Router = {
    getCurrentView: function () { return currentView; },
    getViewFromUrl: getViewFromUrl,
    getOrderIdFromUrl: getOrderIdFromUrl,
    getItemIdFromUrl: getItemIdFromUrl,
    navigate: navigate,
    goBack: goBack,
    subscribe: subscribe
  };
})();
