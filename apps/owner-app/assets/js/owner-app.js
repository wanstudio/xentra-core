/**
 * Mybangjo Owner Mobile App Controller
 * Dedicated mobile runtime for Mobile Web, PWA, and Android APK WebView.
 */
(function (window) {
  'use strict';

  var TOKEN_KEY = 'xentra_merchant_token';
  var USER_KEY = 'xentra_merchant_user';

  // ── 1. Global Fetch Interceptor for Owner Mobile Runtime ──
  // Guarantees all admin/data calls automatically carry Authorization headers
  // and catches 401 unauthorized to prevent silent empty database states.
  (function installOwnerFetchInterceptor() {
    if (window._ownerFetchInterceptorInstalled) return;
    window._ownerFetchInterceptorInstalled = true;

    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
      init = init || {};
      var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      var isAdminOrData = url.includes('/api/v1/admin/') || url.includes('/admin/');

      if (isAdminOrData) {
        var token = localStorage.getItem(TOKEN_KEY);
        if (token) {
          if (!init.headers) {
            init.headers = { 'Authorization': 'Bearer ' + token };
          } else if (typeof Headers !== 'undefined' && init.headers instanceof Headers) {
            if (!init.headers.has('Authorization')) {
              init.headers.set('Authorization', 'Bearer ' + token);
            }
          } else if (typeof init.headers === 'object') {
            if (!init.headers['Authorization'] && !init.headers['authorization']) {
              init.headers['Authorization'] = 'Bearer ' + token;
            }
          }
        }
      }

      return originalFetch.apply(this, [input, init]).then(function (res) {
        if (isAdminOrData && res.status === 401) {
          console.warn('[OwnerApp] 401 Unauthorized detected on:', url);
          try {
            window.dispatchEvent(new CustomEvent('xentra:session-expired', {
              detail: { url: url, status: 401 }
            }));
          } catch (_) {}
        }
        return res;
      });
    };
  })();

  var OwnerApp = {
    isApk: function () {
      return !!(window.XentraOwnerBridge || window.Android || navigator.userAgent.includes('MybangjoOwner'));
    },

    getStoredToken: function () {
      var token = localStorage.getItem(TOKEN_KEY);
      // Resilience: Recover from native APK bridge SharedPreferences if WebView localStorage was cleared
      if (!token && window.XentraOwnerBridge && typeof window.XentraOwnerBridge.getSavedToken === 'function') {
        try {
          var nativeToken = window.XentraOwnerBridge.getSavedToken();
          if (nativeToken) {
            localStorage.setItem(TOKEN_KEY, nativeToken);
            token = nativeToken;
          }
        } catch (_) {}
      }
      return token;
    },

    checkAuthAndInit: function () {
      var self = this;
      var token = this.getStoredToken();

      // If no token exists at all, navigate cleanly to unified login
      if (!token) {
        console.warn('[OwnerApp] No active session found. Redirecting to login...');
        window.location.replace('/login?target=owner');
        return;
      }

      // Check authoritative account status with server
      fetch('/api/v1/auth/merchant/me', {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(function (res) {
        if (res.status === 401) {
          console.warn('[OwnerApp] Session expired or invalid on startup.');
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          if (window.XentraOwnerBridge && typeof window.XentraOwnerBridge.clearAuth === 'function') {
            try { window.XentraOwnerBridge.clearAuth(); } catch (_) {}
          }
          window.location.replace('/login?target=owner&error=SESSION_EXPIRED');
          return;
        }
        if (res.ok) {
          res.json().then(function (data) {
            if (data && data.user) {
              localStorage.setItem(USER_KEY, JSON.stringify(data.user));
              // Sync token to native background monitor
              if (window.XentraOwnerBridge && typeof window.XentraOwnerBridge.syncAuth === 'function') {
                try {
                  window.XentraOwnerBridge.syncAuth(token, data.user.branch_id || '');
                } catch (_) {}
              }
            }
          }).catch(function () {});
        }
      }).catch(function (err) {
        // Network offline or transient error: permit offline cached render
        console.warn('[OwnerApp] Startup auth check network warning:', err.message);
      });

      this.init();
    },

    init: function () {
      document.body.classList.add('x-owner-mobile-app');
      console.log('[OwnerApp] Initialized mobile app environment. APK mode:', this.isApk());

      // If running inside Android APK, configure native bridge and ensure white status + nav bars
      if (window.XentraOwnerBridge && typeof window.XentraOwnerBridge.setNavigationBarColor === 'function') {
        window.XentraOwnerBridge.setNavigationBarColor('#ffffff', true);
      } else if (window.XentraNative && typeof window.XentraNative.setNavigationBarColor === 'function') {
        window.XentraNative.setNavigationBarColor('#ffffff', true);
      }
      if (window.XentraOwnerBridge && typeof window.XentraOwnerBridge.setStatusBarColor === 'function') {
        window.XentraOwnerBridge.setStatusBarColor('#ffffff', true);
      }

      if (window.XentraOwnerBridge && typeof window.XentraOwnerBridge.onAppReady === 'function') {
        window.XentraOwnerBridge.onAppReady();
      }

      // Sync auth context with native Android layer if present
      var token = localStorage.getItem(TOKEN_KEY);
      var user = null;
      try { user = JSON.parse(localStorage.getItem(USER_KEY)); } catch (_) {}
      if (token && window.XentraOwnerBridge && typeof window.XentraOwnerBridge.syncAuth === 'function') {
        try { window.XentraOwnerBridge.syncAuth(token, (user && user.branch_id) || ''); } catch (_) {}
      }

      var mountTarget = document.getElementById('xentra-owner-app-mount') || document.getElementById('xentra-owner-app-root');
      if (mountTarget && typeof window.mountOwnerAppShell === 'function') {
        window.mountOwnerAppShell(mountTarget);
      }

      if (window.Xentra && typeof window.Xentra.hideSplash === 'function') {
        window.Xentra.hideSplash();
      }

      this.setupRoutingBridge();
      this.setupSessionExpiredListener();

      if (window.XentraOwnerOrderMonitor && typeof window.XentraOwnerOrderMonitor.start === 'function') {
        window.XentraOwnerOrderMonitor.start();
      }

      var self = this;
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(function () {
          self.preloadCoreIcons();
        });
      } else {
        setTimeout(function () {
          self.preloadCoreIcons();
        }, 300);
      }
    },

    setupSessionExpiredListener: function () {
      window.addEventListener('xentra:session-expired', function () {
        console.warn('[OwnerApp] Caught xentra:session-expired. Preparing re-auth...');
        // Let React shell modal display first; if not mounted within 2s, redirect to login
        setTimeout(function () {
          if (!document.getElementById('xentra-session-expired-modal')) {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USER_KEY);
            window.location.replace('/login?target=owner&error=SESSION_EXPIRED');
          }
        }, 1500);
      });
    },

    preloadCoreIcons: function () {
      if (this._iconsPreloaded) return;
      this._iconsPreloaded = true;
      var icons = [
        '/owner/assets/icons/ci_arrow-left-sm.svg',
        '/owner/assets/icons/akar-icons_chevron-right-small.svg',
        '/owner/assets/icons/bxs_category.svg',
        '/owner/assets/icons/mdi_food-drumstick.svg',
        '/owner/assets/icons/ion_fast-food.svg',
        '/owner/assets/icons/green-toggle.svg',
        '/owner/assets/icons/red-toggle.svg',
        '/owner/assets/icons/reicon_food-tray-filled.svg',
        '/owner/assets/icons/bxs_bowl-hot.svg',
        '/owner/assets/icons/lucide-extended_cooking-pot-filled.svg',
        '/owner/assets/icons/si_inventory-fill.svg',
        '/owner/assets/icons/dashicons_store.svg',
        '/owner/assets/icons/basil_box-solid.svg',
        '/owner/assets/icons/streamline-plump_graph-bar-increase-solid.svg',
        '/owner/assets/icons/basil_bullhorn-solid.svg',
        '/owner/assets/icons/fluent_people-team-add-20-filled.svg',
        '/owner/assets/icons/bi_palette-fill.svg',
        '/owner/assets/icons/fa7-solid_home.svg',
        '/owner/assets/icons/ic_round-business-center-new.svg',
        '/owner/assets/icons/fluent_task-list-rectangle-28-filled.svg',
        '/owner/assets/icons/reicon_wallet-money-filled.svg',
        '/owner/assets/icons/reicon_menu-board-filled.svg',
        '/owner/assets/icons/mage_information-circle-fill.svg',
        '/owner/assets/icons/gravity-ui_equal.svg'
      ];
      this._iconCache = icons.map(function (src) {
        var img = new Image();
        img.decoding = 'async';
        img.src = src;
        return img;
      });
    },

    setupRoutingBridge: function () {
      function checkRoute(hash) {
        var h = (hash || window.location.hash || '').replace(/^#\/?/, '');
        var isModernRoute = (
          h === 'overview' || h === '' ||
          h.startsWith('business') || h.startsWith('catalog') ||
          h.startsWith('materials') || h.startsWith('marketing/affiliate') ||
          h === 'affiliate' || h === 'orders' || h === 'finance' ||
          h.startsWith('branches') ||
          h === 'more' || h === 'account'
        );
        return isModernRoute;
      }
      window.isOwnerModernRoute = checkRoute;
    }
  };

  window.OwnerApp = OwnerApp;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      OwnerApp.checkAuthAndInit();
    });
  } else {
    OwnerApp.checkAuthAndInit();
  }
})(window);
