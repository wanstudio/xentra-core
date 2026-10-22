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

      this.setupRoutingBridge();
    },

    setupRoutingBridge: function () {
      function checkRoute(hash) {
        var h = (hash || window.location.hash || '').replace(/^#\/?/, '');
        var isModernRoute = (h === 'overview' || h === '' || h.startsWith('business') || h.startsWith('catalog'));
        return isModernRoute;
      }
      window.isOwnerModernRoute = checkRoute;
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
