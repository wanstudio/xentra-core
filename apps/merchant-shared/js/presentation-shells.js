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
    restoreEntry(entry);
    stack = stack.filter(function (item) { return item !== entry; });

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
      shell: shell
    };
    stack.push(entry);

    if (options.onOpen) options.onOpen(entry);
    return entry;
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && stack.length) {
      var entry = stack[stack.length - 1];
      if (!entry.dismissible && entry.dismissible !== undefined) return;
      close(entry.id);
    }
  });

  window.addEventListener('popstate', function () {
    if (stack.length) closeTop();
  });

  window.XentraPresentation = {
    open: open,
    close: close,
    closeTop: closeTop,
    isOpen: function (id) { return !!getEntry(id); },
    stackSize: function () { return stack.length; }
  };
})(window, document);
