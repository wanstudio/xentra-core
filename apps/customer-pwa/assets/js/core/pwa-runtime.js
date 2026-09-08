/**
 * Xentra PWA Runtime — single source of truth for the browser PWA install
 * lifecycle and runtime context.
 *
 * Two facts that must NEVER be conflated:
 *   1. display_mode  — runtime fact: is THIS page running as the installed PWA?
 *   2. install_state — promotion fact: has the user completed a VERIFIED install
 *                      in this browser profile? ('none'|'accepted'|'installed')
 *
 * LOCKED CONTRACT (install requirement verification):
 *   - A user merely ACCEPTING the install prompt is NOT installed. `accepted`
 *     only means "the prompt was accepted"; installation is NOT guaranteed and
 *     must not be reported as satisfied.
 *   - install_requirement_satisfied is ONLY true after a VERIFIED install:
 *       a) the browser fired the `appinstalled` event, or
 *       b) the current page runs standalone (display-mode: standalone), or
 *       c) iOS navigator.standalone === true.
 *     A permanent `xentra_pwa_verified` marker is written on every verified
 *     install so the requirement survives reloads and other browser tabs.
 *   - The legacy `xentra_pwa_installed` key (written on prompt acceptance by an
 *     older build) is INTENTIONALLY IGNORED — acceptance never satisfies.
 *
 * The server consumes the same context as promotion CONTEXT at order time —
 * never as a credential (see PrePaymentVerificationGate).
 */
(function () {
  'use strict';

  var VERIFIED_MARKER_KEY = 'xentra_pwa_verified';

  // Transient, in-memory ONLY: tracks that the user accepted the install prompt
  // in THIS page session. It never satisfies the requirement and is not
  // persisted — verified installation is proven by appinstalled/standalone.
  var acceptedPrompt = false;

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

  /** Has a VERIFIED install been recorded for this browser profile? */
  function hasVerifiedInstall() {
    try {
      return localStorage.getItem(VERIFIED_MARKER_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  /**
   * Records a VERIFIED install (appinstalled / standalone). The ONLY writer of
   * the permanent marker. Never called for prompt acceptance.
   */
  function recordVerifiedInstall() {
    try { localStorage.setItem(VERIFIED_MARKER_KEY, '1'); } catch (_) {}
  }

  function getPwaRuntimeContext() {
    var standalone = getStandalone();
    var verified = standalone || hasVerifiedInstall();

    return {
      display_mode: standalone ? 'standalone' : 'browser',
      install_state: verified ? 'installed' : (acceptedPrompt ? 'accepted' : 'none'),
      install_requirement_satisfied: verified
    };
  }

  function isStandalone() {
    return getStandalone();
  }

  function getInstallState() {
    return getPwaRuntimeContext().install_state;
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
   *
   * A resolved `accepted: true` only records the transient 'accepted' state.
   * It does NOT write the verified marker: actual installation is confirmed
   * solely by the appinstalled event / standalone detection.
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
      // Accepted only means the user accepted the prompt — NOT installed.
      // install_requirement_satisfied stays false until appinstalled fires or
      // standalone is detected (both write the verified marker).
      acceptedPrompt = accepted;
      return { prompted: true, outcome: choice ? choice.outcome : null, accepted: accepted };
    }).catch(function () {
      return { prompted: true, outcome: 'dismissed', accepted: false };
    });
  }

  // appinstalled is the authoritative browser/OS "installation completed"
  // signal when the event is available. Single handler: persist the VERIFIED
  // marker and broadcast one consistent event for every consumer (UI refresh,
  // banner hide). Standalone detection at load also persists the marker so the
  // requirement survives reloads into a plain browser tab.
  if (typeof window !== 'undefined') {
    window.addEventListener('appinstalled', function () {
      recordVerifiedInstall();
      if (window.Xentra && window.Xentra.Store && window.Xentra.Store.dispatch) {
        window.Xentra.Store.dispatch('PWA_INSTALLED', getPwaRuntimeContext());
      }
      try {
        document.dispatchEvent(new CustomEvent('xentra:pwa-installed', { detail: getPwaRuntimeContext() }));
      } catch (_) {}
    });

    if (getStandalone()) {
      recordVerifiedInstall();
    }
  }

  window.Xentra = window.Xentra || {};
  window.Xentra.PwaRuntime = {
    getPwaRuntimeContext: getPwaRuntimeContext,
    markVerifiedInstall: recordVerifiedInstall,
    isStandalone: isStandalone,
    getInstallState: getInstallState,
    getDeferredInstallPrompt: getDeferredInstallPrompt,
    promptInstall: promptInstall
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      getPwaRuntimeContext: getPwaRuntimeContext,
      markVerifiedInstall: recordVerifiedInstall,
      isStandalone: isStandalone,
      getInstallState: getInstallState,
      getDeferredInstallPrompt: getDeferredInstallPrompt,
      promptInstall: promptInstall
    };
  }
})();