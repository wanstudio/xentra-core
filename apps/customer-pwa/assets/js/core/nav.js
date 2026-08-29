/**
 * Xentra Navigation Stack
 * Manages overlay/sheet history for browser back-button integration.
 * Identical behavior to production: Back button closes one sheet layer at a time.
 */
(function () {
  'use strict';
  if (window.XentraNav) return;

  var stack = [];
  var ignoreNextPop = false;

  function push(entry) {
    stack.push(entry);
    history.pushState({ xentraNav: true, depth: stack.length }, '');
  }

  function popAndClose() {
    if (!stack.length) return;
    var entry = stack.pop();
    if (entry.type === 'fn') {
      try { entry.fn(); } catch (e) { console.error('[XentraNav]', e); }
    } else if (entry.type === 'node' && entry.node && entry.node.parentNode) {
      if (typeof entry.node.__xentraClose === 'function') {
        try { entry.node.__xentraClose(); } catch (e) { entry.node.remove(); }
      } else {
        entry.node.remove();
      }
    }
  }

  window.XentraNav = {
    pushClose: function (fn) {
      push({ type: 'fn', fn: fn });
    },
    close: function () {
      if (!stack.length) return;
      history.back();
    },
    hasOpen: function () {
      return stack.length > 0;
    }
  };

  window.addEventListener('popstate', function () {
    if (ignoreNextPop) { ignoreNextPop = false; return; }
    if (!stack.length) return;
    popAndClose();
  });

  // Auto-track overlay additions/removals
  var OVERLAY_SELECTOR = '.x-overlay,.xentra-dynamic-overlay,.x-del-overlay,.x-note-overlay';

  var observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      if (m.addedNodes) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.parentNode !== document.body) return;
          if (!node.matches || !node.matches(OVERLAY_SELECTOR)) return;
          stack.push({ type: 'node', node: node });
          history.pushState({ xentraNav: true, depth: stack.length }, '');
        });
      }

      if (m.removedNodes) {
        m.removedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          var idx = -1;
          for (var i = stack.length - 1; i >= 0; i--) {
            if (stack[i].type === 'node' && stack[i].node === node) { idx = i; break; }
          }
          if (idx === -1) return;
          stack.splice(idx, 1);
          ignoreNextPop = true;
          history.back();
        });
      }
    });
  });

  observer.observe(document.body, { childList: true });
})();
