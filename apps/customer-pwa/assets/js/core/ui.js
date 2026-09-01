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
    var isLong = (message || '').length > 18;
    duration = duration || (isLong ? 2800 : 2000);

    var existing = document.getElementById('x-toast');
    if (existing) existing.remove();

    var el = document.createElement('div');
    el.id = 'x-toast';
    el.textContent = message;
    el.style.cssText = [
      'position:fixed',
      'top:50%',
      'left:50%',
      'transform:translate(-50%, -50%) scale(0.92)',
      'background:#ff3366',
      'color:#ffffff',
      'padding:14px 22px',
      'border-radius:20px',
      'border:1.5px solid rgba(255, 255, 255, 0.45)',
      'box-shadow:0 12px 32px rgba(255, 51, 102, 0.32), 0 4px 12px rgba(0, 0, 0, 0.06)',
      'font-family:\'Plus Jakarta Sans\', -apple-system, BlinkMacSystemFont, sans-serif',
      'font-size:14px',
      'font-weight:600',
      'letter-spacing:-0.01em',
      'text-align:center',
      'z-index:999999',
      'opacity:0',
      'transition:opacity .35s cubic-bezier(0.16, 1, 0.3, 1), transform .35s cubic-bezier(0.16, 1, 0.3, 1)',
      'pointer-events:none',
      'max-width:300px',
      'width:auto',
      'line-height:1.45',
      'backdrop-filter:blur(8px)',
      '-webkit-backdrop-filter:blur(8px)'
    ].join(';');

    document.body.appendChild(el);

    requestAnimationFrame(function () {
      el.style.opacity = '1';
      el.style.transform = 'translate(-50%, -50%) scale(1)';
    });

    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translate(-50%, -50%) scale(0.92)';
      setTimeout(function () { if (el.parentNode) el.remove(); }, 350);
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

  /**
   * Render reusable Upsell Product Card HTML.
   */
  function upsellCard(product) {
    if (!product || !product.id) return '';
    var img = product.image_url || product.image || '';
    var price = Number(product.price || 0);
    return (
      '<div class="x-complement-card" data-card-id="' + product.id + '">' +
      '  <div class="x-complement-img-wrap">' +
      (img
        ? '<img src="' + escape(img) + '" alt="' + escape(product.name || '') + '" onerror="this.parentElement.innerHTML=\'<div class=\\\'x-complement-img-placeholder\\\'></div>\'">'
        : '<div class="x-complement-img-placeholder"></div>'
      ) +
      '  </div>' +
      '  <div class="x-complement-name">' + escape(product.name || '') + '</div>' +
      '  <div class="x-complement-bottom">' +
      '    <div class="x-complement-price">' + money(price) + '</div>' +
      '    <button type="button" class="x-upsell-add-btn" data-add-upsell="' + product.id + '" aria-label="Tambah ' + escape(product.name || '') + '">' +
      '      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111827" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;display:block;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>' +
      '    </button>' +
      '  </div>' +
      '</div>'
    );
  }

  // ── Export ──
  window.Xentra = window.Xentra || {};
  window.Xentra.UI = {
    money: money,
    escape: escape,
    toast: toast,
    debounce: debounce,
    upsellCard: upsellCard
  };
})();
