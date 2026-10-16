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

      // If running inside Android APK, configure native bridge
      if (window.XentraOwnerBridge && typeof window.XentraOwnerBridge.onAppReady === 'function') {
        window.XentraOwnerBridge.onAppReady();
      }
    }
  };

  window.OwnerApp = OwnerApp;
  document.addEventListener('DOMContentLoaded', function () {
    OwnerApp.init();
  });
})(window);
