(function () {
  'use strict';

  // Xentra PWAs intentionally behave like installed applications:
  // prevent the browser context menu (including right-click on desktop).
  document.addEventListener('contextmenu', function (event) {
    event.preventDefault();
  }, false);
})();
