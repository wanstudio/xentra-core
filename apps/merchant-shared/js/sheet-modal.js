/**
 * XENTRA CORE — STANDARDIZED MODAL & BOTTOM SHEET ENGINE
 * Handles Desktop Center Modals and Mobile Bottom Sheets declaratively.
 */
(function (window, document) {
  'use strict';

  function openModal(options) {
    options = options || {};
    var backdrop = document.getElementById(options.backdropId);
    if (!backdrop) return;

    backdrop.style.display = 'flex';
    requestAnimationFrame(function () {
      backdrop.classList.add('open');
    });

    if (options.onOpen) options.onOpen(backdrop);
  }

  function closeModal(backdropId, onClose) {
    var backdrop = document.getElementById(backdropId);
    if (!backdrop) return;

    backdrop.classList.remove('open');
    setTimeout(function () {
      backdrop.style.display = 'none';
      if (onClose) onClose();
    }, 200);
  }

  // Global Dialog Confirmation Sheet
  function confirmDialog(options) {
    options = options || {};
    return new Promise(function (resolve) {
      var backdrop = document.createElement('div');
      backdrop.className = 'x-modal-backdrop';
      backdrop.innerHTML = [
        '<div class="x-modal-container" style="max-width:400px;">',
          '<div class="x-modal-handle"></div>',
          '<div class="x-modal-header">',
            '<div>',
              '<h3 class="x-modal-title">' + (options.title || 'Konfirmasi') + '</h3>',
              (options.message ? '<p class="x-modal-subtitle" style="margin-top:6px;font-size:13px;color:#475569;">' + options.message + '</p>' : ''),
            '</div>',
          '</div>',
          '<div class="x-modal-footer">',
            '<button type="button" class="x-btn-secondary" data-action="cancel">' + (options.cancelLabel || 'Batal') + '</button>',
            '<button type="button" class="' + (options.isDanger ? 'x-btn-danger' : 'x-btn-primary') + '" data-action="confirm">' + (options.confirmLabel || 'Lanjutkan') + '</button>',
          '</div>',
        '</div>'
      ].join('');

      document.body.appendChild(backdrop);
      backdrop.style.display = 'flex';
      requestAnimationFrame(function () {
        backdrop.classList.add('open');
      });

      function cleanup(res) {
        backdrop.classList.remove('open');
        setTimeout(function () {
          if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
          resolve(res);
        }, 200);
      }

      backdrop.querySelector('[data-action="cancel"]').addEventListener('click', function () { cleanup(false); });
      backdrop.querySelector('[data-action="confirm"]').addEventListener('click', function () { cleanup(true); });
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) cleanup(false);
      });
    });
  }

  window.XentraUI = window.XentraUI || {};
  window.XentraUI.Modal = {
    open: openModal,
    close: closeModal,
    confirm: confirmDialog
  };

})(window, document);
