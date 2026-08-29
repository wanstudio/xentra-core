/**
 * Xentra Core UI Utilities
 * Shared helpers: money formatting, HTML escaping, toast notifications
 */
(function () {
  'use strict';

  /**
   * Format number as Indonesian Rupiah.
   * money(25000)  → "Rp25.000"
   * money(0)      → "Rp0"
   */
  function money(val) {
    var n = Number(val) || 0;
    return 'Rp' + n.toLocaleString('id-ID');
  }

  /**
   * Escape HTML special characters to prevent XSS.
   */
  function escape(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  /**
   * Show a toast notification (auto-dismiss).
   * toast('Item ditambahkan!', 2000)
   */
  function toast(message, duration) {
    duration = duration || 2000;

    var existing = document.getElementById('x-toast');
    if (existing) existing.remove();

    var el = document.createElement('div');
    el.id = 'x-toast';
    el.textContent = message;
    el.style.cssText = [
      'position:fixed',
      'bottom:100px',
      'left:50%',
      'transform:translateX(-50%) translateY(20px)',
      'background:#222',
      'color:#fff',
      'padding:10px 20px',
      'border-radius:22px',
      'font-size:13px',
      'font-weight:600',
      'z-index:99999',
      'opacity:0',
      'transition:opacity .3s, transform .3s',
      'pointer-events:none',
      'white-space:nowrap'
    ].join(';');

    document.body.appendChild(el);

    requestAnimationFrame(function () {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });

    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(20px)';
      setTimeout(function () { el.remove(); }, 300);
    }, duration);
  }

  /**
   * Debounce a function call.
   */
  function debounce(fn, delay) {
    var timer;
    return function () {
      var args = arguments;
      var ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, delay);
    };
  }

  // ── Export ──
  window.Xentra = window.Xentra || {};
  window.Xentra.UI = {
    money: money,
    escape: escape,
    toast: toast,
    debounce: debounce
  };
})();
