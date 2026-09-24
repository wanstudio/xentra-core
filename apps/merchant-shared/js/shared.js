/**
 * XENTRA CORE — MERCHANT SHARED JAVASCRIPT
 *
 * Shared infrastructure used by merchant-dashboard (and future owner-dashboard,
 * merchant-app) surfaces. Must be loaded BEFORE the surface-specific JS file.
 *
 * Exposes to window:
 *   window.XentraShared      — auth/session helpers, DOM utils, formatters
 *   window.XentraActionMenu  — reusable overflow action menu controller
 *   window.XentraCropEditor  — reusable image crop / zoom editor controller
 *
 * Compatibility contract:
 *   - dashboard.js re-aliases these globals at the top of its IIFE so its
 *     internal calls remain unchanged. Do not rename the exported symbols.
 *   - Functions never assume a specific surface; no routing, no role checks,
 *     no domain business logic belongs here.
 */

(function () {
  'use strict';

  /* =========================================================================
     CONSTANTS
     ========================================================================= */
  var API_BASE  = '/api/v1';
  var TOKEN_KEY = 'xentra_merchant_token';
  var USER_KEY  = 'xentra_merchant_user';

  /* =========================================================================
     AUTH / SESSION HELPERS
     ========================================================================= */

  /** Returns Authorization + Content-Type headers for admin API calls. */
  function getAuthHeaders(extraHeaders) {
    var headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    var token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    return headers;
  }

  /** Removes stored token and user from localStorage. */
  function clearStoredSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  /**
   * Redirects to the unified login entry point (/login).
   * Calls checkAppRoute() if available (SPA router), otherwise hard redirects.
   */
  function redirectToLogin() {
    if (typeof window.checkAppRoute === 'function') {
      window.checkAppRoute();
    } else if (!window.location.pathname.includes('login')) {
      window.location.href = '/login';
    }
  }

  /**
   * Landing surface resolved by the server for the current role
   * (see resolveLanding in server/routes/api.js). Cached from
   * /auth/merchant/me so every surface can enforce it without guessing a role
   * from the URL.
   */
  var _landing = null;

  function setLanding(l) { _landing = l || null; }
  function getLanding() { return _landing; }

  /**
   * Surface guard: a page whose path is not the landing resolved for the
   * current role must not render. Returns true when it redirected.
   * Unauthenticated pages are untouched — boot calls this after validation.
   */
  function enforceSurface(surfacePaths) {
    if (!_landing) return false;
    var paths = Array.isArray(surfacePaths) ? surfacePaths : [surfacePaths];
    // No redirect when the server resolved THIS surface for the current role.
    // The surface's canonical path is always in its own accepted set, so the
    // guard can never bounce a page back to itself.
    if (paths.indexOf(_landing) !== -1) return false;
    window.location.replace(_landing + window.location.hash);
    return true;
  }

  /**
   * Wraps fetch() for all admin API calls.
   * A 401 means the server session is gone; clears the stale local token
   * so the dashboard never keeps rendering empty UI with an expired session.
   */
  function adminFetch(url, options) {
    return fetch(url, options).then(function (res) {
      if (res.status === 401) {
        clearStoredSession();
        redirectToLogin();
        var err = new Error('SESSION_EXPIRED');
        err.status = 401;
        throw err;
      }
      return res;
    });
  }

  /**
   * Returns the stored user object from localStorage, or null.
   * Safe — returns null on JSON parse error.
   */
  function getStoredUser() {
    try {
      var u = localStorage.getItem(USER_KEY);
      return u ? JSON.parse(u) : null;
    } catch (_) { return null; }
  }

  /* =========================================================================
     DOM / FORMAT HELPERS
     ========================================================================= */

  /** Shorthand for document.getElementById. */
  function $(id) {
    return document.getElementById(id);
  }

  /** Formats a number as Indonesian Rupiah: "Rp123.456" */
  function formatMoney(amount) {
    return 'Rp' + Number(amount || 0).toLocaleString('id-ID');
  }

  /**
   * HTML-safe string escaping — prevents XSS in rendered content.
   * Returns '' for null/undefined.
   */
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* =========================================================================
     TOAST NOTIFICATION
     Requires: <div id="x-toast-container" class="x-toast-container"></div>
     CSS:      merchant-shared/css/shared.css (.x-toast-container, .x-toast)
     ========================================================================= */

  /**
   * Shows a transient toast notification.
   * @param {string} message - Toast text (HTML-escaped internally).
   * @param {string} [type]  - Reserved for future type variants (unused).
   */
  function showToast(message, type) {
    var container = $('x-toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'x-toast';
    toast.innerHTML = '<span>⚡</span> <span>' + esc(message) + '</span>';
    container.appendChild(toast);

    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 3500);
  }

  /* =========================================================================
     ACTION MENU / POPOVER  (XentraActionMenu)
     Reusable overflow "⋯" action menu with smart positioning,
     keyboard navigation, and backdrop dismiss.
     CSS: merchant-shared/css/shared.css (.x-action-popover-menu etc.)
     ========================================================================= */


  /* =========================================================================
     IMAGE CROP EDITOR  (XentraCropEditor)
     Reusable modal-based image crop / pan / zoom editor (Media System M2).
     CSS: merchant-shared/css/shared.css (.x-crop-* classes)
     NOTE: Client-side preview canvas is for UI feedback only — canonical
     processed pixels are produced by the server Media System M3 pipeline.
     ========================================================================= */


  /* =========================================================================
     ROLE / SESSION GUARD HELPERS (shared by every merchant surface)
     ========================================================================= */

  /** True when the stored user's role is branch_manager. */
  function isBranchManager() {
    var user = getStoredUser();
    return !!(user && user.role === 'branch_manager');
  }

  /**
   * Boot guard: requires a stored token, otherwise sends the user to login.
   * When a user is stored it also fills the shell user chip (dash-user-*).
   * Returns false when there is no session.
   */
  function checkAuth() {
    var token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      redirectToLogin();
      return false;
    }

    var user = getStoredUser();
    if (user) {
      if ($('dash-user-name')) $('dash-user-name').textContent = user.full_name || user.username || 'Pemilik Toko';
      if ($('dash-user-avatar')) $('dash-user-avatar').textContent = (user.full_name || user.username || 'A').charAt(0).toUpperCase();
      if ($('dash-user-role')) $('dash-user-role').textContent = (user.role || 'Owner').toUpperCase();
    }
    return true;
  }

  /**
   * Exchanges a single-use handoff ticket (from xentra.cloud) for a session.
   * The ticket is scrubbed from the URL immediately: session tokens are NEVER
   * exposed in the URL.
   * Returns true when a session was established.
   */
  async function handleHandoffExchange() {
    var urlParams = new URLSearchParams(window.location.search);
    var handoffTicket = urlParams.get('handoff');
    if (!handoffTicket) return false;

    urlParams.delete('handoff');
    var cleanQuery = urlParams.toString();
    var cleanUrl = window.location.pathname + (cleanQuery ? '?' + cleanQuery : '') + window.location.hash;
    window.history.replaceState({}, document.title, cleanUrl);

    try {
      var res = await fetch(API_BASE + '/auth/handoff/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: handoffTicket })
      });
      var data = await res.json();
      if (res.ok && data && data.success && data.token) {
        localStorage.setItem(TOKEN_KEY, data.token);
        if (data.user) {
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        }
        return true;
      }
      console.warn('[Handoff exchange failed]:', data && (data.error || data.message));
      clearStoredSession();
      redirectToLogin();
      return false;
    } catch (err) {
      console.error('[Handoff exchange network error]:', err);
      clearStoredSession();
      redirectToLogin();
      return false;
    }
  }

  /**
   * Server-side session validation at boot: a locally stored token that is not
   * valid on the server must force a real login instead of rendering an empty
   * dashboard. Network errors keep the session (unreachable server ≠ expired).
   */
  async function validateServerSession() {
    var token = localStorage.getItem(TOKEN_KEY);
    if (!token) return false;
    try {
      var res = await adminFetch(API_BASE + '/auth/merchant/me', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data && data.success) {
        if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        if (data.landing) setLanding(data.landing);
        return true;
      }
      clearStoredSession();
      redirectToLogin();
      return false;
    } catch (e) {
      return e && e.message === 'SESSION_EXPIRED' ? false : true;
    }
  }

  /* =========================================================================
     EXPORTS
     ========================================================================= */
  window.XentraShared = {
    API_BASE:           API_BASE,
    TOKEN_KEY:          TOKEN_KEY,
    USER_KEY:           USER_KEY,
    getAuthHeaders:     getAuthHeaders,
    clearStoredSession: clearStoredSession,
    redirectToLogin:    redirectToLogin,
    adminFetch:         adminFetch,
    getStoredUser:      getStoredUser,
    isBranchManager:    isBranchManager,
    checkAuth:          checkAuth,
    handleHandoffExchange: handleHandoffExchange,
    validateServerSession: validateServerSession,
    setLanding:         setLanding,
    getLanding:         getLanding,
    enforceSurface:     enforceSurface,
    $:                  $,
    formatMoney:        formatMoney,
    esc:                esc,
    showToast:          showToast
  };

  window.XentraCropEditor = XentraCropEditor;

})();
