/**
 * XENTRA — PRESENTATION SHELLS
 *
 * Reusable presentation containers only.
 * Feature logic must stay outside this module.
 */
(function (window, document) {
  'use strict';

  var stack = [];
  var root = null;

  function ensureRoot() {
    if (root && document.body.contains(root)) return root;
    root = document.createElement('div');
    root.id = 'x-presentation-root';
    root.setAttribute('aria-live', 'polite');
    document.body.appendChild(root);
    return root;
  }

  function getEntry(id) {
    return stack.find(function (entry) { return entry.id === id; }) || null;
  }

  function restoreEntry(entry) {
    if (!entry || !entry.content || !entry.anchor) return;
    entry.content.hidden = true;
    entry.anchor.parentNode.insertBefore(entry.content, entry.anchor.nextSibling);
  }

  function close(id) {
    var entry = getEntry(id);
    if (!entry) return false;

    if (entry.shell && entry.shell.parentNode) {
      entry.shell.parentNode.removeChild(entry.shell);
    }
    if (entry.content) {
      entry.content.classList.remove('x-presentation-close-relocated');
    }
    restoreEntry(entry);
    stack = stack.filter(function (item) { return item !== entry; });

    if (typeof entry.onClose === 'function') entry.onClose(entry);

    var top = stack[stack.length - 1];
    if (top && top.shell) {
      top.shell.removeAttribute('aria-hidden');
    } else if (root) {
      root.removeAttribute('data-open');
    }

    return true;
  }

  function closeTop() {
    if (!stack.length) return false;
    return close(stack[stack.length - 1].id);
  }

  /*
   * Bottom sheet: affordance tutup tinggal di casing, di atas surface.
   *
   * Tombol tutup milik konten (.x-modal-close — kontrak bersama modal) tetap ada
   * di markup fitur dan tetap memegang handler-nya. Shell hanya menyembunyikan
   * yang di konten, menaruh tombol kembar di casing dengan animasi yang sama,
   * lalu meneruskan klik ke tombol aslinya. Pemanggilan dan animasi dari feature
   * context tidak berubah.
   */
  function attachFloatingClose(shell, surface, content, id) {
    var original = content.querySelector('.x-modal-close');
    if (!original) return null;

    content.classList.add('x-presentation-close-relocated');

    var bar = document.createElement('div');
    bar.className = 'x-presentation-sheet-bar';

    var proxy = document.createElement('button');
    proxy.type = 'button';
    proxy.className = 'x-presentation-sheet-close';
    proxy.setAttribute('aria-label', original.getAttribute('aria-label') || 'Tutup');
    proxy.innerHTML = original.innerHTML || '&#10005;';
    proxy.addEventListener('click', function () {
      original.click();
      if (getEntry(id)) close(id);
    });

    bar.appendChild(proxy);
    shell.insertBefore(bar, surface);
    return proxy;
  }

  function open(options) {
    options = options || {};
    var content = options.content;
    var type = options.type || 'modal';
    var id = options.id || ('presentation-' + Date.now());

    if (!content) return null;

    var existing = getEntry(id);
    if (existing) close(id);

    var presentationRoot = ensureRoot();
    var anchor = document.createElement('span');
    anchor.hidden = true;
    anchor.setAttribute('data-presentation-anchor', id);

    if (content.parentNode) {
      content.parentNode.insertBefore(anchor, content);
    } else {
      presentationRoot.appendChild(anchor);
    }

    content.hidden = false;

    var shell = document.createElement('section');
    shell.className = 'x-presentation-shell x-presentation-' + type;
    shell.setAttribute('role', type === 'dialog' ? 'alertdialog' : 'dialog');
    shell.setAttribute('aria-modal', 'true');
    shell.setAttribute('data-presentation-id', id);

    var backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'x-presentation-backdrop';
    backdrop.setAttribute('aria-label', 'Tutup');
    backdrop.addEventListener('click', function () {
      if (options.dismissible !== false) close(id);
    });

    var surface = document.createElement('div');
    surface.className = 'x-presentation-surface';
    if (options.className) surface.classList.add(options.className);

    surface.appendChild(content);
    shell.appendChild(backdrop);
    shell.appendChild(surface);

    // Bottom sheet: tombol tutup dipindah ke casing supaya tampil DI ATAS sheet,
    // bukan di dalam surface — kalau di dalam, ia ikut terpotong overflow konten.
    // Elemen aslinya tetap ada dan tetap berfungsi; klik diteruskan ke sana.
    if (type === 'bottom-sheet' && options.dismissible !== false) {
      attachFloatingClose(shell, surface, content, id);
    }

    presentationRoot.appendChild(shell);
    presentationRoot.setAttribute('data-open', 'true');

    stack.forEach(function (entry) {
      if (entry.shell) entry.shell.setAttribute('aria-hidden', 'true');
    });

    var entry = {
      id: id,
      type: type,
      content: content,
      anchor: anchor,
      shell: shell,
      dismissible: options.dismissible,
      onClose: options.onClose
    };
    stack.push(entry);

    if (options.onOpen) options.onOpen(entry);
    return entry;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function confirm(options) {
    options = options || {};
    return new Promise(function (resolve) {
      var content = document.createElement('div');
      content.className = 'x-presentation-confirm-content';
      content.innerHTML =
        '<div class="x-presentation-confirm-header">' +
          '<h3>' + escapeHtml(options.title || 'Konfirmasi') + '</h3>' +
          '<p>' + escapeHtml(options.message || 'Apakah Anda yakin?') + '</p>' +
        '</div>' +
        '<div class="x-presentation-confirm-actions">' +
          '<button type="button" class="x-btn-secondary" data-confirm-cancel>' + escapeHtml(options.cancelLabel || 'Batal') + '</button>' +
          '<button type="button" class="x-btn-primary" data-confirm-ok>' + escapeHtml(options.okLabel || 'Lanjutkan') + '</button>' +
        '</div>';

      open({
        id: options.id || ('confirm-' + Date.now()),
        type: 'dialog',
        content: content,
        dismissible: false,
        onOpen: function () {
          function finish(value) {
            closeTop();
            resolve(value);
          }
          content.querySelector('[data-confirm-cancel]').addEventListener('click', function () { finish(false); });
          content.querySelector('[data-confirm-ok]').addEventListener('click', function () { finish(true); });
        }
      });
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && stack.length) {
      var entry = stack[stack.length - 1];
      if (!entry.dismissible && entry.dismissible !== undefined) return;
      close(entry.id);
    }
  });

  window.XentraPresentation = {
    open: open,
    confirm: confirm,
    close: close,
    closeTop: closeTop,
    isOpen: function (id) { return !!getEntry(id); },
    stackSize: function () { return stack.length; }
  };
})(window, document);
