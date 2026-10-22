/**
 * Mybangjo Owner Mobile App Controller
 * Dedicated mobile runtime for Mobile Web, PWA, and Android APK WebView.
 */
(function (window) {
  'use strict';

  var OwnerApp = {
    isApk: function () {
      return !!(window.XentraOwnerBridge || window.Android || navigator.userAgent.includes('MybangjoOwner'));
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

      this.setupCleanShell();
    },

    setupCleanShell: function () {
      var cleanMount = document.getElementById('xentra-owner-app-clean-mount');
      if (!cleanMount) {
        cleanMount = document.createElement('div');
        cleanMount.id = 'xentra-owner-app-clean-mount';
        cleanMount.style.display = 'none';
        document.body.appendChild(cleanMount);
      }

      var mountTimer = null;
      function handleRouting() {
        if (mountTimer) {
          clearInterval(mountTimer);
          mountTimer = null;
        }

        var hash = (window.location.hash || '').replace(/^#\/?/, '');
        var isModernRoute =
          hash.startsWith('catalog') ||
          hash.startsWith('business') ||
          hash === 'overview' ||
          hash === '';

        var dashMain = document.querySelector('.x-dash-main');
        var dashTopBar = document.querySelector('.x-dash-topbar, .x-owner-mobile-topbar');
        var bottomNav = document.getElementById('x-owner-bottom-nav');

        if (isModernRoute) {
          // Immediately hide legacy UI shell so old layout never shows
          if (dashMain) dashMain.style.display = 'none';
          if (dashTopBar) dashTopBar.style.display = 'none';
          if (bottomNav) bottomNav.style.display = 'none';

          var tryMount = function () {
            if (typeof window.mountOwnerAppShell === 'function') {
              cleanMount.style.display = 'block';
              window.mountOwnerAppShell(cleanMount, {
                initialRoute: hash || 'overview',
                onNavigate: function (r) {
                  window.location.hash = '#' + r;
                }
              });
              return true;
            }
            return false;
          };

          if (!tryMount()) {
            var attempts = 0;
            mountTimer = setInterval(function () {
              attempts++;
              if (tryMount() || attempts > 100) {
                clearInterval(mountTimer);
                mountTimer = null;
              }
            }, 50);
          }
        } else {
          // When returning to legacy routes (orders, reports, more)
          cleanMount.style.display = 'none';
          if (dashMain) dashMain.style.display = '';
          if (dashTopBar) dashTopBar.style.display = '';
          if (bottomNav) bottomNav.style.display = '';
          if (typeof window.unmountOwnerAppShell === 'function') {
            window.unmountOwnerAppShell(cleanMount);
          }
        }
      }

      window.addEventListener('hashchange', handleRouting);
      handleRouting();
    }
  };

  window.OwnerApp = OwnerApp;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      OwnerApp.init();
    });
  } else {
    OwnerApp.init();
  }
})(window);
