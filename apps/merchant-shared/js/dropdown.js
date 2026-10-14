/**
 * XENTRA — SHARED DROPDOWN ENHANCER (Mobile & Desktop)
 *
 * Search/filter dropdown memakai markup & gaya `.x-occ-dropdown`
 * (menu rounded + checkmark kanan).
 *
 * Modul ini mengubah <select> menjadi dropdown kustom yang SAMA
 * tanpa mengubah logic halaman:
 *   - <select> asli tetap ada di DOM sebagai sumber nilai (value + onchange),
 *     hanya disembunyikan secara visual;
 *   - memilih opsi menulis ke select asli lalu mengirim event `change`, jadi
 *     seluruh handler/simpan yang sudah ada tetap jalan;
 *   - perubahan opsi/disabled pada select asli ikut tersinkron;
 *   - bekerja secara seragam di mobile maupun desktop.
 */
(function (window, document) {
  'use strict';

  var SOURCE_CLASS = 'x-owner-select-source';
  var HOST_CLASS = 'x-owner-select-dropdown';
  var enhanced = []; // { select, host, observer }
  var observer = null;

  function isExcluded(select) {
    if (!select || select.tagName !== 'SELECT') return true;
    if (select.multiple) return true;
    if (select.classList.contains(SOURCE_CLASS)) return true; // sudah dikonversi
    if (select.closest('.x-occ-dropdown, .x-branch-dropdown, .x-floating-dropdown')) return true; // sudah punya dropdown kustom
    if (select.closest('[hidden], [aria-hidden="true"]')) return true;
    if (select.dataset && select.dataset.noEnhance === '1') return true;

    // Cek apakah elemen itu sendiri atau wrapper terdekatnya sengaja disembunyikan (misal: topbar hidden select)
    var el = select;
    while (el && el !== document.body) {
      if (el.hasAttribute && el.hasAttribute('hidden')) return true;
      var inline = (el.getAttribute && el.getAttribute('style')) || '';
      if (/display:\s*none|opacity:\s*0|pointer-events:\s*none/.test(inline)) return true;
      el = el.parentElement;
    }
    return false;
  }

  function chevronSvg() {
    return '<svg class="x-occ-chevron-icon" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>';
  }

  function checkSvg() {
    return '<svg class="x-occ-check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  }

  function selectedText(select) {
    var opt = select.options[select.selectedIndex];
    if (!opt) return '';
    return (opt.textContent || '').trim();
  }

  function buildItems(record) {
    var select = record.select;
    var html = '';
    Array.prototype.forEach.call(select.options, function (option) {
      var isCurrent = String(option.value) === String(select.value) && select.selectedIndex >= 0
        && select.options[select.selectedIndex] === option;
      var isDisabled = Boolean(option.disabled) || option.getAttribute('data-inactive') === '1';
      var extraClasses = (isCurrent ? ' active' : '') + (isDisabled ? ' is-disabled' : '');
      html += '<button type="button" class="x-occ-dropdown-item' + extraClasses + '"' +
        ' role="option" data-value="' + escapeAttr(option.value) + '"' +
        (isDisabled ? ' disabled aria-disabled="true"' : '') +
        ' aria-selected="' + (isCurrent ? 'true' : 'false') + '">' +
        '<span>' + escapeHtml(option.textContent || '') + '</span>' + checkSvg() +
        '</button>';
    });
    record.menu.innerHTML = html;
    Array.prototype.forEach.call(record.menu.querySelectorAll('.x-occ-dropdown-item'), function (item) {
      item.onclick = function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (item.disabled || item.getAttribute('aria-disabled') === 'true') return;
        pick(record, item.dataset.value);
      };
    });
  }

  function syncLabel(record) {
    var text = selectedText(record.select);
    record.label.textContent = text;
    record.label.title = text;
  }

  function syncDisabled(record) {
    var disabled = Boolean(record.select.disabled);
    record.trigger.disabled = disabled;
    record.host.classList.toggle('is-disabled', disabled);
  }

  function close(record) {
    record.host.classList.remove('open');
    record.trigger.setAttribute('aria-expanded', 'false');
  }

  function closeAll() {
    enhanced.forEach(close);
  }

  function toggle(record) {
    var willOpen = !record.host.classList.contains('open');
    closeAll();
    if (!willOpen) return;
    if (typeof record.sync === 'function') record.sync();
    record.host.classList.add('open');
    record.trigger.setAttribute('aria-expanded', 'true');
  }

  /** Tulis pilihan ke select asli lalu teruskan event change ke handler halaman. */
  function pick(record, value) {
    var select = record.select;
    select.value = value;
    syncLabel(record);
    buildItems(record);
    close(record);
    try {
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    } catch (e) {
      if (typeof select.onchange === 'function') select.onchange();
    }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function enhance(select) {
    if (isExcluded(select)) return null;

    var host = document.createElement('span');
    host.className = 'x-occ-dropdown ' + HOST_CLASS;
    if (select.style && select.style.width) host.style.width = select.style.width;
    if (select.style && select.style.minWidth) host.style.minWidth = select.style.minWidth;
    if (select.style && select.style.maxWidth) host.style.maxWidth = select.style.maxWidth;

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'x-occ-dropdown-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    var label = (select.getAttribute('aria-label') || select.getAttribute('name') || '').trim();
    trigger.setAttribute('aria-label', label || 'Pilih opsi');
    trigger.innerHTML = '<span class="x-occ-dropdown-label"></span>' + chevronSvg();

    var menu = document.createElement('div');
    menu.className = 'x-occ-dropdown-menu';
    menu.setAttribute('role', 'listbox');

    host.appendChild(trigger);
    host.appendChild(menu);
    select.parentNode.insertBefore(host, select);
    select.classList.add(SOURCE_CLASS);

    var previousTabIndex = select.getAttribute('tabindex');
    select.setAttribute('tabindex', '-1');
    select.setAttribute('aria-hidden', 'true');

    var record = {
      select: select,
      host: host,
      trigger: trigger,
      menu: menu,
      label: trigger.querySelector('.x-occ-dropdown-label'),
      previousTabIndex: previousTabIndex
    };
    trigger.onclick = function (event) {
      event.preventDefault();
      if (trigger.disabled) return;
      toggle(record);
    };

    var sync = function () { syncLabel(record); buildItems(record); syncDisabled(record); };
    record.sync = sync;
    sync();

    select.addEventListener('change', sync);
    select.addEventListener('input', sync);
    if (select.form) {
      select.form.addEventListener('reset', function () {
        setTimeout(sync, 0);
      });
    }

    if (typeof window.MutationObserver === 'function') {
      record.observer = new window.MutationObserver(sync);
      record.observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    }

    enhanced.push(record);
    return record;
  }

  function enhanceAll(root) {
    var scope = root || document;
    if (!scope.querySelectorAll) return;
    Array.prototype.forEach.call(scope.querySelectorAll('select'), enhance);
  }

  function revertAll() {
    enhanced.forEach(function (record) {
      if (record.observer) record.observer.disconnect();
      if (record.sync) {
        record.select.removeEventListener('change', record.sync);
        record.select.removeEventListener('input', record.sync);
      }
      record.host.parentNode && record.host.parentNode.removeChild(record.host);
      record.select.classList.remove(SOURCE_CLASS);
      record.select.removeAttribute('aria-hidden');
      if (record.previousTabIndex === null || record.previousTabIndex === undefined) {
        record.select.removeAttribute('tabindex');
      } else {
        record.select.setAttribute('tabindex', record.previousTabIndex);
      }
    });
    enhanced = [];
  }

  function refresh() {
    enhanced.forEach(function (record) { if (record.sync) record.sync(); });
    enhanceAll(document);
  }

  document.addEventListener('click', function (event) {
    if (!enhanced.length) return;
    var inside = enhanced.some(function (record) { return record.host.contains(event.target); });
    if (!inside) closeAll();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeAll();
  });

  var bootstrapped = false;
  function bootstrap() {
    if (bootstrapped) return;
    bootstrapped = true;

    if (typeof window.MutationObserver === 'function') {
      observer = new window.MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          Array.prototype.forEach.call(mutation.addedNodes || [], function (node) {
            if (!node || node.nodeType !== 1) return;
            if (node.tagName === 'SELECT') enhance(node);
            enhanceAll(node);
          });
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    window.addEventListener('resize', refresh);
  }

  function init() {
    bootstrap();
    refresh();
  }

  window.XentraDropdown = {
    SOURCE_CLASS: SOURCE_CLASS,
    enhance: enhance,
    enhanceAll: enhanceAll,
    revertAll: revertAll,
    refresh: refresh,
    createFloatingDropdown: enhance,
    size: function () { return enhanced.length; }
  };
  window.createFloatingDropdown = function (select, options) {
    return enhance(select);
  };

  init();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  }
})(window, document);
