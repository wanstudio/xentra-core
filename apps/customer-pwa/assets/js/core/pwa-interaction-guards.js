(function () {
  'use strict';

  // Xentra PWAs intentionally behave like installed applications:
  // prevent the browser context menu (including right-click on desktop).
  //
  // Pengecualian eksplisit: surface kerja yang memang memakai menu konteks browser
  // (mis. Owner Dashboard di desktop) menandai dirinya dengan
  // `<html data-allow-context-menu>`. Guard tetap berlaku untuk surface lain,
  // jadi perilaku aplikasi PWA tidak berubah.
  if (document.documentElement.hasAttribute('data-allow-context-menu')) {
    return;
  }

  document.addEventListener('contextmenu', function (event) {
    event.preventDefault();
  }, false);
})();
