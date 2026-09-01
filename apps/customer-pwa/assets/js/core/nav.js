/**
 * Xentra Navigation Stack
 * Pure and clean stack matching production xentra-mvp.
 */
(function () {
  'use strict';
  if (window.XentraNav) return;

  var navStack = [];

  window.XentraNav = {
    pushClose: function (fn) {
      navStack.push(fn);
    },
    close: function () {
      if (navStack.length) {
        var fn = navStack.pop();
        if (typeof fn === 'function') {
          try { fn(); } catch (e) { console.warn(e); }
        }
        return true;
      }
      return false;
    },
    hasOpen: function () {
      return navStack.length > 0;
    }
  };

  window.addEventListener('popstate', function () {
    if (window.XentraNav.hasOpen()) {
      window.XentraNav.close();
    }
  });
})();
