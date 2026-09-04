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

    // Installed-confirmation marker written when a native install prompt was
    // accepted (or an appinstalled event fired) in this browser profile. It is
    // a UI/session signal only: the server never treats it as proof of install.
    var installAccepted = false;
    try {
      installAccepted = localStorage.getItem('xentra_pwa_installed') === '1';
    } catch (_) {}

    // Two DISTINCT facts, never conflated:
    // 1. display_mode        - runtime fact: is this page running as the installed PWA?
    // 2. install_state       - promotion fact: has the user accepted/completed the
    //                          install action in this browser profile? ('none' | 'accepted')
    // install_requirement_satisfied is a derived convenience for promotion
    // eligibility: running standalone implies install happened, and the accepted
    // marker satisfies it even while the same browser tab is still display_mode
    // 'browser'. Only UI/discovery consumes the derived value; order-time server
    // validation reads display_mode (see PrePaymentVerificationGate).
    return {
      display_mode: standalone ? 'standalone' : 'browser',
      install_state: installAccepted ? 'accepted' : 'none',
      install_requirement_satisfied: standalone || installAccepted
    };
  }

  /** Records an accepted PWA install in this browser profile (UI signal only). */
  function markInstalled() {
    try { localStorage.setItem('xentra_pwa_installed', '1'); } catch (_) {}
  }

  // Listen to browser appinstalled event to refresh context / UI state
  if (typeof window !== 'undefined') {
    window.addEventListener('appinstalled', function () {
      markInstalled();
      if (window.Xentra && window.Xentra.Store && window.Xentra.Store.dispatch) {
        window.Xentra.Store.dispatch('PWA_INSTALLED', getPwaRuntimeContext());
      }
    });
  }

  window.Xentra = window.Xentra || {};
  window.Xentra.PwaRuntime = {
    getPwaRuntimeContext: getPwaRuntimeContext,
    markInstalled: markInstalled
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getPwaRuntimeContext: getPwaRuntimeContext, markInstalled: markInstalled };
  }
})();
