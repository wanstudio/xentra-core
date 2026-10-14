/**
 * XENTRA CORE — STANDARDIZED MODAL & BOTTOM SHEET ENGINE
 * Handles Desktop Center Modals and Mobile Bottom Sheets declaratively.
 * Unified API across Owner Dashboard, Merchant App, and POS surfaces.
 */
(function (window, document) {
  'use strict';

  var activeModalStack = [];

  function openModal(options) {
    if (!options) return;
    var backdropId = typeof options === 'string' ? options : (options.backdropId || options.id);
    var backdrop = document.getElementById(backdropId);

    // If no existing DOM backdrop and dynamic content is provided, delegate to presentation shell
    if (!backdrop && typeof options === 'object' && options.content && window.XentraPresentation) {
      return window.XentraPresentation.open(options);
    }

    if (!backdrop) return;

    backdrop.style.display = 'flex';
    requestAnimationFrame(function () {
      backdrop.classList.add('open');
    });

    if (!backdrop.dataset.sheetBound) {
      backdrop.dataset.sheetBound = 'true';
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) {
          closeModal(backdropId);
        }
      });
    }

    if (activeModalStack.indexOf(backdropId) === -1) {
      activeModalStack.push(backdropId);
    }

    if (window.XentraNav && typeof window.XentraNav.push === 'function') {
      window.XentraNav.push(function () { closeModal(backdropId); }, backdropId);
    }

    if (typeof options === 'object' && typeof options.onOpen === 'function') {
      options.onOpen(backdrop);
    }
  }

  function closeModal(target, onClose) {
    var backdropId = typeof target === 'string' ? target : (target && (target.backdropId || target.id));
    if (typeof target === 'object' && target && typeof target.onClose === 'function') {
      onClose = target.onClose;
    }

    // Coordinate with Universal Navigation Stack if closed via UI
    if (window.XentraNav && window.XentraNav.hasOpen(backdropId) && !window.XentraNav.isHandlingPopstate()) {
      window.XentraNav.pop(backdropId);
      return;
    }

    // Check if open in XentraPresentation
    if (window.XentraPresentation && typeof window.XentraPresentation.isOpen === 'function' && window.XentraPresentation.isOpen(backdropId)) {
      window.XentraPresentation.close(backdropId);
      if (typeof onClose === 'function') onClose();
      return;
    }

    var backdrop = document.getElementById(backdropId);
    if (!backdrop) return;

    backdrop.classList.remove('open');
    activeModalStack = activeModalStack.filter(function (id) { return id !== backdropId; });

    setTimeout(function () {
      backdrop.style.display = 'none';
      if (typeof onClose === 'function') onClose();
    }, 200);
  }

  // Global Dialog Confirmation Sheet
  function confirmDialog(options) {
    options = options || {};

    if (window.XentraPresentation && typeof window.XentraPresentation.confirm === 'function') {
      return window.XentraPresentation.confirm(options);
    }

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

  // Keyboard Escape listener
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && activeModalStack.length > 0) {
      var topId = activeModalStack[activeModalStack.length - 1];
      closeModal(topId);
    }
  });

  window.XentraUI = window.XentraUI || {};
  window.XentraUI.Modal = {
    open: openModal,
    close: closeModal,
    confirm: confirmDialog
  };

  // Ergonomic alias
  window.XentraModal = window.XentraUI.Modal;

})(window, document);
