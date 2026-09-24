/**
 * XENTRA — MERCHANT SHARED ACTION MENU
 *
 * Generic overflow action-menu primitive shared by merchant surfaces.
 */
(function () {
  'use strict';
  var esc = window.XentraShared.esc;
  var XentraActionMenu = (function () {
    var _activePopover = null;
    var _backdrop = null;
    var _previousActiveElement = null;

    function getBackdrop() {
      if (!_backdrop) {
        _backdrop = document.createElement('div');
        _backdrop.className = 'x-action-popover-backdrop';
        _backdrop.addEventListener('click', closeAll);
        document.body.appendChild(_backdrop);
      }
      return _backdrop;
    }

    function closeAll() {
      if (_activePopover) {
        if (_activePopover._trigger) {
          _activePopover._trigger.setAttribute('aria-expanded', 'false');
        }
        _activePopover.classList.remove('x-popover-open');
        var popToClean = _activePopover;
        setTimeout(function () {
          if (popToClean && popToClean.parentNode) {
            popToClean.parentNode.removeChild(popToClean);
          }
        }, 150);
        _activePopover = null;
      }
      var b = getBackdrop();
      b.classList.remove('x-popover-open');

      if (_previousActiveElement && typeof _previousActiveElement.focus === 'function') {
        try { _previousActiveElement.focus(); } catch (_) {}
        _previousActiveElement = null;
      }
    }

    function open(triggerEl, items) {
      if (!triggerEl || !items || !items.length) return;
      if (_activePopover && _activePopover._trigger === triggerEl) {
        closeAll();
        return;
      }
      closeAll();

      _previousActiveElement = triggerEl;
      triggerEl.setAttribute('aria-expanded', 'true');

      var popover = document.createElement('div');
      popover.className = 'x-action-popover-menu';
      popover.setAttribute('role', 'menu');
      popover.setAttribute('tabindex', '-1');
      popover._trigger = triggerEl;

      var buttons = [];

      items.forEach(function (item) {
        if (!item) return;
        if (item.divider) {
          var hr = document.createElement('div');
          hr.className = 'x-action-menu-divider';
          hr.setAttribute('role', 'separator');
          popover.appendChild(hr);
          return;
        }

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('role', 'menuitem');
        btn.className = 'x-action-menu-item' + (item.destructive ? ' is-destructive' : '');
        var iconHtml = item.icon ? '<span class="x-action-menu-item-icon">' + item.icon + '</span>' : '';
        btn.innerHTML = iconHtml + '<span>' + esc(item.label) + '</span>';

        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          closeAll();
          if (typeof item.onClick === 'function') {
            item.onClick();
          }
        });

        popover.appendChild(btn);
        buttons.push(btn);
      });

      // Keyboard navigation within popover
      popover.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          closeAll();
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          var idx = buttons.indexOf(document.activeElement);
          if (e.key === 'ArrowDown') {
            var nextIdx = idx < buttons.length - 1 ? idx + 1 : 0;
            if (buttons[nextIdx]) buttons[nextIdx].focus();
          } else {
            var prevIdx = idx > 0 ? idx - 1 : buttons.length - 1;
            if (buttons[prevIdx]) buttons[prevIdx].focus();
          }
        }
      });

      document.body.appendChild(popover);
      _activePopover = popover;
      getBackdrop().classList.add('x-popover-open');

      // Smart positioning: flip horizontally / vertically if near edge
      var rect = triggerEl.getBoundingClientRect();
      var menuW = popover.offsetWidth || 200;
      var menuH = popover.offsetHeight || (items.length * 40);

      var left = rect.right - menuW;
      if (left < 10) left = 10;
      if (left + menuW > window.innerWidth - 10) {
        left = window.innerWidth - menuW - 10;
      }

      var top = rect.bottom + 6;
      if (top + menuH > window.innerHeight - 10) {
        top = Math.max(10, rect.top - menuH - 6);
        popover.style.transformOrigin = 'bottom right';
      } else {
        popover.style.transformOrigin = 'top right';
      }

      popover.style.left = Math.round(left) + 'px';
      popover.style.top  = Math.round(top)  + 'px';

      requestAnimationFrame(function () {
        popover.classList.add('x-popover-open');
        if (buttons[0]) buttons[0].focus();
      });
    }

    // Global listeners
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _activePopover) closeAll();
    });
    window.addEventListener('scroll', closeAll, true);
    window.addEventListener('resize', closeAll);

    return { open: open, closeAll: closeAll };
  })();
  window.XentraActionMenu = XentraActionMenu;
})();
