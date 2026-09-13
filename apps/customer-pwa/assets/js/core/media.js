/**
 * Xentra Customer PWA — XentraMedia (M6)
 *
 * Canonical media delivery helper for the Customer PWA.
 * The PWA is a DELIVERY CONSUMER of the Xentra Media System.
 * It NEVER processes originals itself.
 *
 * Responsibilities:
 *   - Select the smallest derivative sufficient for the rendered display size
 *   - Generate responsive srcset for product cards, category tabs, banners
 *   - Preserve square presentation for product/category images
 *   - Preserve ~1.94:1 aspect ratio for banner images
 *   - Fall back gracefully to legacy image_url when no canonical media exists
 *   - Prevent layout shifts by always providing width/height
 *   - Apply lazy loading where safe (not above-the-fold)
 *
 * Derivative variant names (square):
 *   thumb = 320, sm = 640, md = 1024, lg = 1600, xl = 2048
 *
 * Derivative variant names (banner):
 *   sm = 640×330, md = 1200×619, lg = 1920×990
 */
(function () {
  'use strict';

  // ── Display size targets ────────────────────────────────────────────────
  // Product card image: 105px rendered on a ~390px viewport = ~105px CSS px
  // Category image: 92px rendered = ~92px CSS px
  // Banner: full-width up to 480px container (max PWA width)
  // Detail/modal: 200px height, full width

  var PRODUCT_CARD_PX = 105;   // CSS px rendered on device
  var CATEGORY_PX = 92;        // CSS px
  var BANNER_MIN_WIDTH = 640;  // always use at least 640 variant for banners

  /**
   * Select the smallest derivative variant that meets the minimum pixel requirement.
   * devicePixelRatio-aware: multiplies CSS px by DPR (capped at 2x).
   *
   * @param {Array<{url, width, height, name}>} variants - sorted ascending by width
   * @param {number} minCssPx - minimum CSS pixel width needed
   * @param {string} assetType - 'square' or 'banner'
   * @returns {{url: string, width: number, height: number}|null}
   */
  function selectVariant(variants, minCssPx, assetType) {
    if (!Array.isArray(variants) || variants.length === 0) return null;

    // Limit DPR to 2x to avoid downloading 4K assets on ordinary HiDPI screens
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var physicalPx = Math.ceil(minCssPx * dpr);

    // Sort ascending by width (defensive)
    var sorted = variants.slice().sort(function (a, b) { return a.width - b.width; });

    // For banners: never go below 640px (sm variant)
    if (assetType === 'banner') {
      var bannerMin = Math.max(physicalPx, BANNER_MIN_WIDTH);
      var bannerCandidate = sorted.find(function (v) { return v.width >= bannerMin; });
      return bannerCandidate || sorted[sorted.length - 1];
    }

    // For square variants: smallest that is >= physicalPx
    var candidate = sorted.find(function (v) { return v.width >= physicalPx; });
    return candidate || sorted[sorted.length - 1];
  }

  /**
   * Build an img srcset string from an array of variants.
   * Format: "url1 320w, url2 640w, ..."
   * Only square variants are included (banner srcset not needed — single viewport width).
   *
   * @param {Array<{url, width}>} variants
   * @returns {string}
   */
  function buildSrcset(variants) {
    if (!Array.isArray(variants) || variants.length === 0) return '';
    return variants
      .slice()
      .sort(function (a, b) { return a.width - b.width; })
      .map(function (v) { return v.url + ' ' + v.width + 'w'; })
      .join(', ');
  }

  /**
   * Resolve the best image URL for a product card.
   * Prefers canonical derivative, falls back to legacy image_url.
   *
   * @param {Object} product - product data from API
   * @returns {string} - delivery URL for product card (never original)
   */
  function resolveProductImg(product) {
    if (!product) return '';

    // Prefer canonical derivative
    if (Array.isArray(product.srcset_variants) && product.srcset_variants.length > 0) {
      var v = selectVariant(product.srcset_variants, PRODUCT_CARD_PX, 'square');
      if (v) return v.url;
    }

    // Canonical preview_url (single best derivative from server)
    if (product.preview_url) return product.preview_url;

    // Legacy fallback (preserved per M6 spec)
    return product.image_url || product.image || '';
  }

  /**
   * Build a complete <img> element HTML string for a product card.
   * Includes srcset, sizes, lazy loading, and fixed dimensions to prevent layout shift.
   *
   * @param {Object} product
   * @param {Object} opts
   * @param {string} opts.className - CSS class for the img
   * @param {boolean} opts.lazy - whether to lazy-load (default: true)
   * @returns {string} - HTML string for the img element
   */
  function buildProductImg(product, opts) {
    opts = opts || {};
    var lazy = opts.lazy !== false;
    var className = opts.className || 'x-product-image';

    var primarySrc = resolveProductImg(product);
    if (!primarySrc) return '';

    var srcset = '';
    var sizes = '';
    if (Array.isArray(product.srcset_variants) && product.srcset_variants.length > 1) {
      srcset = buildSrcset(product.srcset_variants);
      // Product card is always 105px wide, so sizes is simple
      sizes = '105px';
    }

    var alt = escapeHtml(product.name || '');
    var loadingAttr = lazy ? ' loading="lazy"' : '';
    var decoding = ' decoding="async"';
    // Fixed dimensions prevent layout shift (CLS); matches CSS: 105×105
    var dims = ' width="105" height="105"';

    var srcsetAttr = srcset ? (' srcset="' + srcset + '"') : '';
    var sizesAttr = sizes ? (' sizes="' + sizes + '"') : '';

    // onerror: on any image load failure, hide the element gracefully
    var onerr = ' onerror="this.style.display=\'none\'"';

    return '<img class="' + className + '" src="' + escapeHtml(primarySrc) + '"' +
      srcsetAttr + sizesAttr + dims + loadingAttr + decoding + onerr +
      ' alt="' + alt + '">';
  }

  /**
   * Resolve the best image URL for a category tab.
   *
   * @param {Object} category
   * @returns {string}
   */
  function resolveCategoryImg(category) {
    if (!category) return '';

    if (Array.isArray(category.srcset_variants) && category.srcset_variants.length > 0) {
      var v = selectVariant(category.srcset_variants, CATEGORY_PX, 'square');
      if (v) return v.url;
    }

    if (category.preview_url) return category.preview_url;

    return category.image_url || category.image || category.icon_url || '';
  }

  /**
   * Resolve the best image URL for a banner slide.
   * Banners use the banner derivative matrix (~1.94:1 aspect ratio).
   * Never falls back to a square product variant.
   *
   * @param {Object} banner - banner entry from /brand/info
   * @returns {string}
   */
  function resolveBannerImg(banner) {
    if (!banner) return '';

    // Prefer canonical banner derivative
    if (Array.isArray(banner.srcset_variants) && banner.srcset_variants.length > 0) {
      var v = selectVariant(banner.srcset_variants, BANNER_MIN_WIDTH, 'banner');
      if (v) return v.url;
    }

    if (banner.preview_url) return banner.preview_url;

    // Legacy fallback
    return banner.image_url || '';
  }

  /**
   * Build <img> HTML for a banner slide.
   * First slide gets loading="eager" (above the fold); subsequent get lazy.
   *
   * @param {Object} banner
   * @param {boolean} isFirstSlide - true for the first banner (eager load)
   * @returns {string}
   */
  function buildBannerImg(banner, isFirstSlide) {
    var src = resolveBannerImg(banner);
    if (!src) return '';

    var alt = escapeHtml(banner.title || 'Promo');
    var loadingAttr = isFirstSlide ? ' loading="eager"' : ' loading="lazy"';
    var decoding = isFirstSlide ? '' : ' decoding="async"';

    // Banner srcset: use srcset_variants if available
    var srcsetAttr = '';
    if (Array.isArray(banner.srcset_variants) && banner.srcset_variants.length > 1) {
      var srcset = buildSrcset(banner.srcset_variants);
      // Banners are full-width up to 480px (PWA max-width), then 100vw
      srcsetAttr = ' srcset="' + srcset + '" sizes="(max-width: 480px) 100vw, 480px"';
    }

    // aspect-ratio inline style prevents layout shift before load
    // Banner ratio: ~640/330 ≈ 1.94:1
    var style = ' style="aspect-ratio: 640/330; width: 100%; height: auto; border-radius: 20px; display: block;"';

    return '<img src="' + escapeHtml(src) + '"' + srcsetAttr + loadingAttr + decoding + style + ' alt="' + alt + '">';
  }

  // ── Minimal HTML escape ─────────────────────────────────────────────────
  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Export ──────────────────────────────────────────────────────────────
  window.Xentra = window.Xentra || {};
  window.Xentra.Media = {
    resolveProductImg: resolveProductImg,
    resolveCategoryImg: resolveCategoryImg,
    resolveBannerImg: resolveBannerImg,
    buildProductImg: buildProductImg,
    buildBannerImg: buildBannerImg,
    buildSrcset: buildSrcset,
    selectVariant: selectVariant
  };
})();
