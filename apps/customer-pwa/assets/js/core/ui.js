/**
 * Xentra Core UI Utilities
 * Shared helpers: money formatting, HTML escaping, toast notifications
 */
(function () {
  'use strict';

  /**
   * Format number as Indonesian Rupiah with deterministic dot separator.
   * money(25000)  → "Rp25.000"
   * money(0)      → "Rp0"
   */
  function money(val) {
    var n = Math.floor(Number(val) || 0);
    var str = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (n < 0 ? '-Rp' : 'Rp') + str;
  }

  /**
   * Format number with Indonesian dot thousands separator.
   * formatNumber(50000)   → "50.000"
   * formatNumber(1500000) → "1.500.000"
   */
  function formatNumber(val) {
    var n = Math.floor(Number(val) || 0);
    var str = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (n < 0 ? '-' : '') + str;
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
      '<div class="x-complement-card" data-card-id="' + product.id + '" style="flex:0 0 142px !important;width:142px !important;min-width:142px !important;max-width:142px !important;flex-shrink:0 !important;box-sizing:border-box !important;">' +
      '  <div class="x-complement-img-wrap" style="width:100%;height:122px;aspect-ratio:1/1;border-radius:14px;overflow:hidden;background:#f3f4f6;flex-shrink:0;position:relative;pointer-events:none;-webkit-user-drag:none;user-select:none;">' +
      (img
        ? '<img src="' + escape(img) + '" alt="' + escape(product.name || '') + '" draggable="false" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:14px;pointer-events:none;-webkit-user-drag:none;" onerror="this.parentElement.innerHTML=\'<div class=\\\'x-complement-img-placeholder\\\'></div>\'">'
        : '<div class="x-complement-img-placeholder" style="width:100%;height:100%;background:#f3f4f6;border-radius:14px;"></div>'
      ) +
      '  </div>' +
      '  <div class="x-complement-name">' + escape(product.name || '') + '</div>' +
      '  <div class="x-complement-bottom">' +
      '    <div class="x-complement-price">' + money(price) + '</div>' +
      '    <button type="button" class="x-upsell-add-btn" data-add-upsell="' + product.id + '" aria-label="Tambah ' + escape(product.name || '') + '">' +
      '      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;display:block;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>' +
      '    </button>' +
      '  </div>' +
      '</div>'
    );
  }

  // ── Export ──
  window.Xentra = window.Xentra || {};
  window.Xentra.UI = {
    money: money,
    formatNumber: formatNumber,
    formatRupiah: money,
    escape: escape,
    toast: toast,
    debounce: debounce,
    upsellCard: upsellCard,
    applyTheme: applyTheme,
    getContrastColor: getContrastColor
  };

  /**
   * Parse hex string (#RGB, #RRGGBB) to RGB object
   */
  function parseHex(hex) {
    if (!hex || typeof hex !== 'string') return null;
    var clean = hex.trim().replace(/^#/, '');
    if (clean.length === 3) {
      clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    }
    if (clean.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(clean)) return null;
    return {
      r: parseInt(clean.substring(0, 2), 16),
      g: parseInt(clean.substring(2, 4), 16),
      b: parseInt(clean.substring(4, 6), 16)
    };
  }

  /**
   * Determine optimal high-contrast text color (black or white) based on relative luminance (WCAG)
   */
  function getContrastColor(hex) {
    var rgb = parseHex(hex);
    if (!rgb) return '#111111';
    var lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    return lum > 0.6 ? '#111111' : '#ffffff';
  }

  /**
   * Adjust brightness: amount between -1.0 (darker) and 1.0 (lighter)
   */
  function adjustLightness(hex, amount) {
    var rgb = parseHex(hex);
    if (!rgb) return hex;
    var r = rgb.r, g = rgb.g, b = rgb.b;
    if (amount > 0) {
      r = Math.round(r + (255 - r) * amount);
      g = Math.round(g + (255 - g) * amount);
      b = Math.round(b + (255 - b) * amount);
    } else {
      var factor = 1 + amount;
      r = Math.round(r * factor);
      g = Math.round(g * factor);
      b = Math.round(b * factor);
    }
    function pad(v) { var s = Math.max(0, Math.min(255, v)).toString(16); return s.length === 1 ? '0' + s : s; }
    return '#' + pad(r) + pad(g) + pad(b);
  }

  /**
   * Apply brand primary theme dynamically across CSS root design tokens
   */
  function applyTheme(hexColor) {
    if (!hexColor || typeof hexColor !== 'string') return;
    var hex = hexColor.trim();
    var rgb = parseHex(hex);
    if (!rgb) return;

    var darkHex = adjustLightness(hex, -0.15);
    var bgHex = adjustLightness(hex, 0.90);
    var textHex = getContrastColor(hex);
    var shadowRgba = 'rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', 0.3)';

    var root = document.documentElement;
    root.style.setProperty('--x-primary', hex);
    root.style.setProperty('--x-primary-dark', darkHex);
    root.style.setProperty('--x-primary-bg', bgHex);
    root.style.setProperty('--x-primary-text', textHex);
    root.style.setProperty('--x-primary-shadow', shadowRgba);

    // Aliases for full backward and cross-component compatibility
    root.style.setProperty('--x-lime', hex);
    root.style.setProperty('--x-lime-dark', darkHex);
    root.style.setProperty('--x-lime-bg', bgHex);
    root.style.setProperty('--primary-color', hex);
    root.style.setProperty('--primary-text', textHex);
    root.style.setProperty('--primary-foreground', textHex);
    root.style.setProperty('--x-primary-foreground', textHex);

    // Dynamic contrast for elements placed directly inside the primary-colored hero header
    var heroText = textHex === '#ffffff' ? '#ffffff' : '#0f172a';
    var heroTextSub = textHex === '#ffffff' ? '#e2e8f0' : '#1e293b';
    root.style.setProperty('--x-hero-text', heroText);
    root.style.setProperty('--x-hero-text-sub', heroTextSub);

    // Update <meta name="theme-color">
    var metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', hex);
  }
})();
