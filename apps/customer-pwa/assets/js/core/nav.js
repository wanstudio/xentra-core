/**
 * Xentra Navigation Stack
 * Pure and clean stack matching production xentra-mvp.
 */
(function () {
  'use strict';
  if (window.XentraNav) return;

  var navStack = [];
  var isHandlingPopstate = false;

  window.XentraNav = {
    pushClose: function (fn) {
      navStack.push(fn);
      try {
        if (window.history && typeof window.history.pushState === 'function') {
          window.history.pushState({ xentra_overlay: navStack.length }, '');
        }
      } catch (_) {}
    },
    close: function () {
      if (navStack.length) {
        var fn = navStack.pop();
        if (typeof fn === 'function') {
          try { fn(); } catch (e) { console.warn(e); }
        }
        // If closed manually via button or backdrop (not via back gesture),
        // unwind one history state so history stays in sync
        if (!isHandlingPopstate) {
          try {
            if (window.history && typeof window.history.back === 'function') {
              window.history.back();
            }
          } catch (_) {}
        }
        return true;
      }
      return false;
    },
    hasOpen: function () {
      return navStack.length > 0;
    },
    isHandlingPopstate: function () {
      return isHandlingPopstate;
    }
  };

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('popstate', function (e) {
      if (window.XentraNav.hasOpen()) {
        isHandlingPopstate = true;
        try {
          window.XentraNav.close();
        } finally {
          isHandlingPopstate = false;
        }
      }
    });
  }
})();
