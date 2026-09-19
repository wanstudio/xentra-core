/**
 * Xentra Navigation Stack
 * Pure and clean stack matching production xentra-mvp.
 */
(function () {
  'use strict';
  if (window.XentraNav) return;

  var navStack = [];
  var isHandlingPopstate = false;
  var suppressNextPopstate = 0;

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
        // unwind one history state so history stays in sync, and suppress
        // the resulting popstate event so it does not pop another overlay.
        if (!isHandlingPopstate) {
          suppressNextPopstate++;
          try {
            if (window.history && typeof window.history.back === 'function') {
              window.history.back();
            }
          } catch (_) {
            suppressNextPopstate = Math.max(0, suppressNextPopstate - 1);
          }
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
      if (suppressNextPopstate > 0) {
        suppressNextPopstate--;
        return;
      }
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
