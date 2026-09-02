/**
 * Xentra PWA Runtime Context Detector
 * Automatically inspects display-mode media query to detect installed standalone app state.
 */
(function () {
  'use strict';

  function getPwaRuntimeContext() {
    var standalone = false;
    try {
      if (typeof window !== 'undefined' && window.matchMedia) {
        standalone = window.matchMedia('(display-mode: standalone)').matches;
      }
      // iOS Safari standalone fallback
      if (!standalone && typeof navigator !== 'undefined' && ('standalone' in navigator) && navigator.standalone) {
        standalone = true;
      }
    } catch (_) {}

    return {
      display_mode: standalone ? 'standalone' : 'browser'
    };
  }

  // Listen to browser appinstalled event to refresh context / UI state
  if (typeof window !== 'undefined') {
    window.addEventListener('appinstalled', function () {
      if (window.Xentra && window.Xentra.Store && window.Xentra.Store.dispatch) {
        window.Xentra.Store.dispatch('PWA_INSTALLED', getPwaRuntimeContext());
      }
    });
  }

  window.Xentra = window.Xentra || {};
  window.Xentra.PwaRuntime = {
    getPwaRuntimeContext: getPwaRuntimeContext
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getPwaRuntimeContext: getPwaRuntimeContext };
  }
})();
