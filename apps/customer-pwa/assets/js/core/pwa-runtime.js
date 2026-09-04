/**
 * Xentra PWA Runtime — single source of truth for the browser PWA install
 * lifecycle and runtime context.
 *
 * Distinguishes two facts that must never be conflated:
 *   1. display_mode  — runtime fact: is THIS page running as the installed PWA?
 *   2. install_state — promotion fact: has the user accepted/completed the
 *                      install action in this browser profile? ('none'|'accepted')
 *
 * install_requirement_satisfied is a derived convenience for promotion
 * eligibility (running standalone implies install happened; the accepted marker
 * satisfies it even while the same browser tab is still display_mode
 * 'browser'). The server consumes the same context as promotion CONTEXT at
 * order time — never as a credential (see PrePaymentVerificationGate).
 */
(function () {
  'use strict';

  function getStandalone() {
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
    return standalone;
  }

  function hasInstallMarker() {
    try {
      return localStorage.getItem('xentra_pwa_installed') === '1';
    } catch (_) {
      return false;
    }
  }

  function getPwaRuntimeContext() {
    var standalone = getStandalone();
    var installAccepted = hasInstallMarker();

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

  function isStandalone() {
    return getStandalone();
  }

  function getInstallState() {
    return hasInstallMarker() ? 'accepted' : 'none';
  }

  /**
   * The single stored beforeinstallprompt event (captured early in <head> on
   * every page). It is cleared once a native prompt has been shown.
   */
  function getDeferredInstallPrompt() {
    return (typeof window !== 'undefined' && window.__xentra_deferred_prompt) || null;
  }

  function clearDeferredInstallPrompt() {
    try { window.__xentra_deferred_prompt = null; } catch (_) {}
  }

  /**
   * Shows the native install prompt when the browser offers one.
   * Resolves { prompted, outcome, accepted }. When the platform does not
   * provide a native prompt (iOS Safari, unsupported browser) it resolves
   * { prompted: false } and the caller must show install guidance instead —
   * never pretend the install happened.
   */
  function promptInstall() {
    var promptEvent = getDeferredInstallPrompt();
    if (!promptEvent || typeof promptEvent.prompt !== 'function') {
      return Promise.resolve({ prompted: false, outcome: null, accepted: false });
    }

    var userChoice;
    try {
      userChoice = promptEvent.prompt();
    } catch (_) {
      clearDeferredInstallPrompt();
      return Promise.resolve({ prompted: false, outcome: null, accepted: false });
    }

    clearDeferredInstallPrompt();

    var choicePromise = (userChoice && typeof userChoice.then === 'function')
      ? userChoice
      : (promptEvent.userChoice && typeof promptEvent.userChoice.then === 'function')
        ? promptEvent.userChoice
        : Promise.resolve({ outcome: null });

    return choicePromise.then(function (choice) {
      var accepted = !!(choice && choice.outcome === 'accepted');
      // Accepted only means the user accepted the prompt. Actual installation
      // is confirmed by the appinstalled event / standalone detection, but the
      // accepted marker already satisfies the promotion requirement in this
      // same browser tab (locked UX decision).
      if (accepted) markInstalled();
      return { prompted: true, outcome: choice ? choice.outcome : null, accepted: accepted };
    }).catch(function () {
      return { prompted: true, outcome: 'dismissed', accepted: false };
    });
  }

  // appinstalled is the authoritative browser/OS "installation completed"
  // signal when the event is available. Single handler: persist the marker and
  // broadcast one consistent event for every consumer (UI refresh, banner hide).
  if (typeof window !== 'undefined') {
    window.addEventListener('appinstalled', function () {
      markInstalled();
      if (window.Xentra && window.Xentra.Store && window.Xentra.Store.dispatch) {
        window.Xentra.Store.dispatch('PWA_INSTALLED', getPwaRuntimeContext());
      }
      try {
        document.dispatchEvent(new CustomEvent('xentra:pwa-installed', { detail: getPwaRuntimeContext() }));
      } catch (_) {}
    });
  }

  window.Xentra = window.Xentra || {};
  window.Xentra.PwaRuntime = {
    getPwaRuntimeContext: getPwaRuntimeContext,
    markInstalled: markInstalled,
    isStandalone: isStandalone,
    getInstallState: getInstallState,
    getDeferredInstallPrompt: getDeferredInstallPrompt,
    promptInstall: promptInstall
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      getPwaRuntimeContext: getPwaRuntimeContext,
      markInstalled: markInstalled,
      isStandalone: isStandalone,
      getInstallState: getInstallState,
      promptInstall: promptInstall
    };
  }
})();
