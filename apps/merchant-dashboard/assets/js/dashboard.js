/**
 * XENTRA CORE — MERCHANT & OWNER DASHBOARD JAVASCRIPT
 * Real-time SPA for Brand Theme, Product CRUD, Delivery Formula, & Live Orders
 */

(function () {
  'use strict';

  var API_BASE = '/api/v1';
  var TOKEN_KEY = 'xentra_merchant_token';
  var USER_KEY = 'xentra_merchant_user';

  function getAuthHeaders(extraHeaders) {
    var headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    var token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    return headers;
  }

  function clearStoredSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function redirectToLogin() {
    if (typeof checkAppRoute === 'function') {
      checkAppRoute();
    } else if (!window.location.pathname.includes('login')) {
      window.location.href = '/dashboard/login';
    }
  }

  // Every admin call goes through this wrapper. A 401 means the session is gone
  // on the server (e.g. Passenger restart wiped the in-memory TokenSessionStore),
  // so the stale local token must never keep the dashboard rendering empty UI.
  function adminFetch(url, options) {
    return fetch(url, options).then(function (res) {
      if (res.status === 401) {
        clearStoredSession();
        redirectToLogin();
        var err = new Error('SESSION_EXPIRED');
        err.status = 401;
        throw err;
      }
      return res;
    });
  }

  var state = {
    brand: null,
    categories: [],
    products: [],
    branches: [],
    orders: [],
    activeCategoryFilter: 'all'
  };

  // DOM Helpers
  function $(id) {
    return document.getElementById(id);
  }

  function formatMoney(amount) {
    return 'Rp' + Number(amount || 0).toLocaleString('id-ID');
  }

  // HTML-safe string escaping (prevents XSS in rendered product names, etc.)
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message, type) {
    var container = $('x-toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'x-toast';
    toast.innerHTML = '<span>⚡</span> <span>' + message + '</span>';
    container.appendChild(toast);

    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 3500);
  }

  /* =========================================================================
     MOBILE-FIRST ACTION UX SYSTEM — REUSABLE GROUPED ACTION MENU CONTROLLER
     ========================================================================= */
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
      popover.style.top = Math.round(top) + 'px';

      requestAnimationFrame(function () {
        popover.classList.add('x-popover-open');
        if (buttons[0]) buttons[0].focus();
      });
    }

    // Global listeners
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _activePopover) {
        closeAll();
      }
    });
    window.addEventListener('scroll', closeAll, true);
    window.addEventListener('resize', closeAll);

    return {
      open: open,
      closeAll: closeAll
    };
  })();
  window.XentraActionMenu = XentraActionMenu;

  window.toggleStockChecked = function (id, checked) {
    window.toggleStock(id);
  };

  /* =========================================================================
     MEDIA SYSTEM M2 — REUSABLE CROP / IMAGE EDITOR CONTROLLER
     ========================================================================= */
  var XentraCropEditor = (function () {
    var _modal = null;
    var _viewport = null;
    var _canvasWrapper = null;
    var _img = null;
    var _framingBox = null;
    var _zoomSlider = null;
    var _zoomValue = null;
    var _dimInfo = null;
    var _ratioInfo = null;
    var _titleEl = null;

    var _activeConfig = null;
    var _onConfirmCallback = null;
    var _onCancelCallback = null;

    // State
    var _sourceImg = null;
    var _naturalWidth = 0;
    var _naturalHeight = 0;
    var _targetRatio = 1.0; // w / h
    var _zoom = 1.0;
    var _panX = 0; // translation in pixels inside viewport
    var _panY = 0;
    var _frameWidth = 0;
    var _frameHeight = 0;
    var _baseScale = 1.0; // scale factor to fit framing box initially

    // Drag tracking
    var _isDragging = false;
    var _dragStartX = 0;
    var _dragStartY = 0;
    var _dragStartPanX = 0;
    var _dragStartPanY = 0;

    function initElements() {
      _modal = $('modal-crop-editor');
      _viewport = $('crop-viewport');
      _canvasWrapper = $('crop-canvas-wrapper');
      _img = $('crop-target-image');
      _framingBox = $('crop-framing-box');
      _zoomSlider = $('crop-zoom-slider');
      _zoomValue = $('crop-zoom-value');
      _dimInfo = $('crop-dimensions-info');
      _ratioInfo = $('crop-ratio-info');
      _titleEl = $('crop-editor-title');

      if (!_modal) return;

      // Button handlers
      var btnClose = $('btn-crop-close');
      if (btnClose) btnClose.onclick = cancel;
      var btnCancel = $('btn-crop-cancel');
      if (btnCancel) btnCancel.onclick = cancel;
      var btnConfirm = $('btn-crop-confirm');
      if (btnConfirm) btnConfirm.onclick = confirm;

      var btnReset = $('btn-crop-reset');
      if (btnReset) btnReset.onclick = reset;

      var btnZoomIn = $('btn-crop-zoom-in');
      if (btnZoomIn) {
        btnZoomIn.onclick = function () {
          setZoom(Math.min(3.0, _zoom + 0.1));
        };
      }
      var btnZoomOut = $('btn-crop-zoom-out');
      if (btnZoomOut) {
        btnZoomOut.onclick = function () {
          setZoom(Math.max(1.0, _zoom - 0.1));
        };
      }

      if (_zoomSlider) {
        _zoomSlider.oninput = function () {
          setZoom(parseFloat(_zoomSlider.value));
        };
      }

      // Pointer/touch interaction on viewport
      if (_viewport) {
        _viewport.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerUp);

        // Wheel zoom
        _viewport.addEventListener('wheel', function (e) {
          e.preventDefault();
          var delta = e.deltaY < 0 ? 0.1 : -0.1;
          setZoom(Math.min(3.0, Math.max(1.0, _zoom + delta)));
        }, { passive: false });

        // Keyboard accessibility
        _viewport.addEventListener('keydown', function (e) {
          var step = 10;
          if (e.key === 'ArrowLeft') { _panX += step; updateTransform(); e.preventDefault(); }
          else if (e.key === 'ArrowRight') { _panX -= step; updateTransform(); e.preventDefault(); }
          else if (e.key === 'ArrowUp') { _panY += step; updateTransform(); e.preventDefault(); }
          else if (e.key === 'ArrowDown') { _panY -= step; updateTransform(); e.preventDefault(); }
          else if (e.key === '+' || e.key === '=') { setZoom(Math.min(3.0, _zoom + 0.1)); e.preventDefault(); }
          else if (e.key === '-' || e.key === '_') { setZoom(Math.max(1.0, _zoom - 0.1)); e.preventDefault(); }
          else if (e.key === 'Escape') { cancel(); e.preventDefault(); }
        });
      }
    }

    function handlePointerDown(e) {
      if (!_modal || _modal.style.display === 'none') return;
      _isDragging = true;
      _dragStartX = e.clientX;
      _dragStartY = e.clientY;
      _dragStartPanX = _panX;
      _dragStartPanY = _panY;
      if (_viewport) _viewport.focus();
    }

    function handlePointerMove(e) {
      if (!_isDragging) return;
      var dx = e.clientX - _dragStartX;
      var dy = e.clientY - _dragStartY;
      _panX = _dragStartPanX + dx;
      _panY = _dragStartPanY + dy;
      clampPan();
      updateTransform();
    }

    function handlePointerUp() {
      if (_isDragging) {
        _isDragging = false;
      }
    }

    function setZoom(val) {
      _zoom = Math.min(3.0, Math.max(1.0, val));
      if (_zoomSlider) _zoomSlider.value = _zoom;
      if (_zoomValue) _zoomValue.textContent = Math.round(_zoom * 100) + '%';
      clampPan();
      updateTransform();
    }

    function clampPan() {
      if (!_naturalWidth || !_naturalHeight || !_frameWidth || !_frameHeight) return;
      var currentScale = _baseScale * _zoom;
      var renderedW = _naturalWidth * currentScale;
      var renderedH = _naturalHeight * currentScale;

      // Max pan offset allowed so crop frame stays completely filled by image
      var maxPanX = Math.max(0, (renderedW - _frameWidth) / 2);
      var maxPanY = Math.max(0, (renderedH - _frameHeight) / 2);

      _panX = Math.min(maxPanX, Math.max(-maxPanX, _panX));
      _panY = Math.min(maxPanY, Math.max(-maxPanY, _panY));
    }

    function updateTransform() {
      if (!_canvasWrapper || !_img) return;
      var currentScale = _baseScale * _zoom;
      _canvasWrapper.style.transform = 'translate(' + _panX + 'px, ' + _panY + 'px) scale(' + currentScale + ')';
    }

    function calculateFrameLayout() {
      if (!_viewport || !_naturalWidth || !_naturalHeight) return;
      var vpWidth = _viewport.clientWidth || 320;
      var vpHeight = _viewport.clientHeight || 240;

      // Padding around crop frame inside viewport
      var pad = 24;
      var availW = Math.max(100, vpWidth - pad);
      var availH = Math.max(100, vpHeight - pad);

      // Frame aspect ratio = _targetRatio
      if (availW / availH > _targetRatio) {
        _frameHeight = availH;
        _frameWidth = Math.round(_frameHeight * _targetRatio);
      } else {
        _frameWidth = availW;
        _frameHeight = Math.round(_frameWidth / _targetRatio);
      }

      if (_framingBox) {
        _framingBox.style.width = _frameWidth + 'px';
        _framingBox.style.height = _frameHeight + 'px';
        _framingBox.style.left = Math.round((vpWidth - _frameWidth) / 2) + 'px';
        _framingBox.style.top = Math.round((vpHeight - _frameHeight) / 2) + 'px';
      }

      // Base scale must cover the framing box completely ("cover" mode)
      var scaleX = _frameWidth / _naturalWidth;
      var scaleY = _frameHeight / _naturalHeight;
      _baseScale = Math.max(scaleX, scaleY);

      _img.style.width = _naturalWidth + 'px';
      _img.style.height = _naturalHeight + 'px';

      clampPan();
      updateTransform();
    }

    function reset() {
      _zoom = 1.0;
      _panX = 0;
      _panY = 0;
      if (_zoomSlider) _zoomSlider.value = 1.0;
      if (_zoomValue) _zoomValue.textContent = '100%';
      clampPan();
      updateTransform();
    }

    /**
     * Open the crop editor with configuration.
     * @param {Object} options
     * @param {string|File|Blob} options.source - Image URL or File/Blob object
     * @param {string} options.assetType - 'product' | 'category' | 'logo' | 'avatar' | 'banner' | 'general'
     * @param {number} [options.aspectRatio] - Target aspect ratio (default derived from assetType: square or ~1.94:1)
     * @param {string} [options.title] - Modal title override
     * @param {Function} [options.onConfirm] - Callback(cropSpec, dataUrl)
     * @param {Function} [options.onCancel] - Callback()
     */
    function open(options) {
      initElements();
      _activeConfig = options || {};
      _onConfirmCallback = _activeConfig.onConfirm || null;
      _onCancelCallback = _activeConfig.onCancel || null;

      var assetType = (_activeConfig.assetType || 'general').toLowerCase();
      var ratioMap = {
        logo: 1.0,
        product: 1.0,
        category: 1.0,
        avatar: 1.0,
        banner: 350 / 180, // ~1.944
        general: 1.0
      };

      _targetRatio = typeof _activeConfig.aspectRatio === 'number' && _activeConfig.aspectRatio > 0
        ? _activeConfig.aspectRatio
        : (ratioMap[assetType] || 1.0);

      if (_titleEl) {
        _titleEl.textContent = _activeConfig.title || (assetType === 'banner' ? 'Sesuaikan Banner Promo (~1.94:1)' : 'Sesuaikan Potongan Foto (1:1)');
      }
      if (_ratioInfo) {
        _ratioInfo.textContent = 'Rasio Target: ' + (assetType === 'banner' ? '±1.94:1 (Banner)' : '1:1 (Persegi)');
      }

      var src = _activeConfig.source;
      if (!src) {
        showToast('❌ Tidak ada sumber gambar untuk diedit.');
        return;
      }

      var imageSrc = '';
      if (typeof src === 'string') {
        imageSrc = src;
        loadImage(imageSrc);
      } else if (src instanceof Blob || src instanceof File) {
        var reader = new FileReader();
        reader.onload = function (ev) {
          loadImage(ev.target.result);
        };
        reader.readAsDataURL(src);
      }
    }

    function loadImage(srcUrl) {
      _sourceImg = new Image();
      _sourceImg.onload = function () {
        _naturalWidth = _sourceImg.naturalWidth || _sourceImg.width;
        _naturalHeight = _sourceImg.naturalHeight || _sourceImg.height;

        if (_dimInfo) {
          _dimInfo.textContent = 'Sumber: ' + _naturalWidth + ' × ' + _naturalHeight + ' px';
        }

        if (_img) {
          _img.src = srcUrl;
        }

        if (_modal) {
          _modal.style.display = 'flex';
        }

        // Compute initial sizing
        setTimeout(function () {
          calculateFrameLayout();
          reset();
        }, 50);
      };
      _sourceImg.onerror = function () {
        showToast('❌ Gagal memuat gambar ke editor crop.');
      };
      _sourceImg.src = srcUrl;
    }

    /**
     * Compute source-image pixel crop coordinates (serializable CropSpec intent).
     */
    function computeCropSpec() {
      var currentScale = _baseScale * _zoom;

      // Visible crop box in source image space:
      // Center of framing box maps to center of image plus pan offset
      var cropSourceW = _frameWidth / currentScale;
      var cropSourceH = _frameHeight / currentScale;

      var centerSourceX = (_naturalWidth / 2) - (_panX / currentScale);
      var centerSourceY = (_naturalHeight / 2) - (_panY / currentScale);

      var x = Math.round(centerSourceX - (cropSourceW / 2));
      var y = Math.round(centerSourceY - (cropSourceH / 2));
      var w = Math.round(cropSourceW);
      var h = Math.round(cropSourceH);

      // Clamp inside source image bounds
      x = Math.max(0, Math.min(_naturalWidth - w, x));
      y = Math.max(0, Math.min(_naturalHeight - h, y));
      w = Math.min(w, _naturalWidth - x);
      h = Math.min(h, _naturalHeight - y);

      return {
        x: x,
        y: y,
        width: w,
        height: h,
        source_width: _naturalWidth,
        source_height: _naturalHeight,
        aspect_ratio: Number((w / h).toFixed(4)),
        zoom: Number(_zoom.toFixed(2)),
        asset_type: (_activeConfig && _activeConfig.assetType) || 'general'
      };
    }

    /**
     * Render client-side interactive preview dataURL.
     * NOTE: This is purely for interactive UI feedback, NOT canonical M3 processed pixels.
     */
    function generatePreviewCanvas(spec) {
      try {
        var canvas = document.createElement('canvas');
        var maxPreviewDim = 400;
        var previewW = maxPreviewDim;
        var previewH = Math.round(previewW / (spec.aspect_ratio || 1.0));
        if (previewH > maxPreviewDim) {
          previewH = maxPreviewDim;
          previewW = Math.round(previewH * (spec.aspect_ratio || 1.0));
        }

        canvas.width = previewW;
        canvas.height = previewH;
        var ctx = canvas.getContext('2d');
        if (ctx && _sourceImg) {
          ctx.drawImage(
            _sourceImg,
            spec.x, spec.y, spec.width, spec.height,
            0, 0, previewW, previewH
          );
          return canvas.toDataURL('image/jpeg', 0.85);
        }
      } catch (_) {}
      return null;
    }

    function confirm() {
      var spec = computeCropSpec();
      var previewUrl = generatePreviewCanvas(spec);

      if (_modal) _modal.style.display = 'none';

      if (typeof _onConfirmCallback === 'function') {
        _onConfirmCallback(spec, previewUrl);
      }
    }

    function cancel() {
      if (_modal) _modal.style.display = 'none';
      if (typeof _onCancelCallback === 'function') {
        _onCancelCallback();
      }
    }

    // Responsive window resize
    window.addEventListener('resize', function () {
      if (_modal && _modal.style.display !== 'none') {
        calculateFrameLayout();
      }
    });

    return {
      init: initElements,
      open: open,
      cancel: cancel,
      confirm: confirm,
      reset: reset,
      setZoom: setZoom,
      computeCropSpec: computeCropSpec
    };
  })();

  window.XentraCropEditor = XentraCropEditor;

  /* =========================================================================
     CONTEXT DETECTION — PLATFORM DASHBOARD vs CLIENT OWNER DASHBOARD
     - Platform Dashboard: xentra.cloud/dashboard or ?context=platform
     - Client Owner Dashboard: <client-domain>/dashboard or ?context=client
     ========================================================================= */

  function isPlatformContext() {
    var host = (window.location.hostname || '').toLowerCase();
    var urlParams = new URLSearchParams(window.location.search);
    var contextParam = (urlParams.get('context') || '').toLowerCase();
    if (contextParam === 'platform') return true;
    if (contextParam === 'client') return false;
    return host === 'xentra.cloud';
  }

  /* =========================================================================
     ROUTING — HASH-BASED URL ROUTER
     URL is the source of truth for active navigation state.
     Pattern: /dashboard#<route>   e.g. #overview, #organizations
     ========================================================================= */

  // Client Owner Dashboard routes
  var CLIENT_ROUTE_META = {
    'overview':           { title: 'Overview',    sub: 'Ringkasan bisnis dan aktivitas terkini', tab: 'overview' },
    'orders':             { title: 'Orders',       sub: 'Antrean pesanan realtime dan status dapur', tab: 'orders' },
    'catalog':            { title: 'Catalog',      sub: 'Kelola produk, kategori, dan menu per cabang', tab: 'catalog-products' },
    'catalog/products':   { title: 'Products',     sub: 'Kelola daftar produk master brand', tab: 'catalog-products' },
    'catalog/categories': { title: 'Categories',   sub: 'Atur kategori produk master', tab: 'catalog-categories' },
    'catalog/menus':      { title: 'Menus',        sub: 'Atur menu jual per cabang', tab: 'catalog-menus' },
    'branches':           { title: 'Branches',     sub: 'Atur lokasi cabang, radius, dan formula ongkir', tab: 'branches' },
    'customers':          { title: 'Customers',    sub: 'Data pelanggan dan riwayat pembelian', tab: 'customers' },
    'customers/:id':      { title: 'Customer Detail', sub: 'Profil pelanggan, riwayat pesanan, dan loyalitas', tab: 'customers' },
    'reports':            { title: 'Reports',      sub: 'Laporan penjualan dan analitik bisnis', tab: 'reports' },
    'reports/sales':      { title: 'Sales Report', sub: 'Laporan rincian penjualan dan performa channel', tab: 'reports' },
    'reports/orders':     { title: 'Orders Report', sub: 'Laporan analitik volume dan status pesanan', tab: 'reports' },
    'reports/products':   { title: 'Products Report', sub: 'Laporan performa produk dan kontribusi menu', tab: 'reports' },
    'reports/customers':  { title: 'Customers Report', sub: 'Laporan analitik pelanggan dan retensi', tab: 'reports' },
    'reports/branches':   { title: 'Branches Report', sub: 'Laporan perbandingan kinerja antar cabang', tab: 'reports' },
    'reports/operations': { title: 'Operations Report', sub: 'Laporan operasional dan pergerakan stok', tab: 'reports' },
    'team':               { title: 'Team',         sub: 'Kelola akun staf, role, dan hak akses', tab: 'tim' },
    'team/members':       { title: 'Team Members', sub: 'Daftar staf dan akun operator', tab: 'tim' },
    'team/roles':         { title: 'Team Roles',   sub: 'Struktur role dan hak akses Xentra RBAC', tab: 'tim' },
    'team/permissions':   { title: 'Team Permissions', sub: 'Matriks wewenang dan batasan akses sistem', tab: 'tim' },
    'finance':                     { title: 'Finance',         sub: 'Laporan keuangan terverifikasi dan riwayat pelunasan', tab: 'finance' },
    'finance/overview':            { title: 'Finance Overview', sub: 'Ringkasan penjualan kotor, pelunasan, dan status settlement', tab: 'finance' },
    'finance/transactions':        { title: 'Transactions',    sub: 'Riwayat transaksi pembayaran pesanan (Order Payments)', tab: 'finance' },
    'finance/payouts':             { title: 'Payouts',         sub: 'Pencairan dana settlement gateway ke rekening merchant', tab: 'finance' },
    'finance/reconciliation':      { title: 'Reconciliation',  sub: 'Status rekonsiliasi dan verifikasi gateway pembayaran', tab: 'finance' },
    'finance/payment-methods':     { title: 'Payment Methods', sub: 'Metode pembayaran terverifikasi untuk checkout dan kasir', tab: 'finance' },
    'marketing':                   { title: 'Marketing',        sub: 'Program promosi, insentif konversi, dan performa retensi', tab: 'marketing' },
    'marketing/overview':          { title: 'Marketing Overview', sub: 'Metrik retensi pelanggan dan performa promosi aktif', tab: 'marketing' },
    'marketing/promotions':        { title: 'Promotions',       sub: 'Daftar program promosi dan aturan insentif brand', tab: 'marketing' },
    'marketing/discounts':         { title: 'Discounts',        sub: 'Aturan diskon harga dan kupon potongan pesanan', tab: 'marketing' },
    'marketing/banners':          { title: 'Banners',          sub: 'Kelola banner storefront, penempatan, jadwal, dan visibilitas pelanggan', tab: 'marketing' },
    'marketing/campaigns':         { title: 'Campaigns',        sub: 'Kampanye broadcast dan pesan pemasaran multi-channel', tab: 'marketing' },
    'marketing/loyalty':           { title: 'Loyalty',          sub: 'Program poin pelanggan setia dan reward belanja', tab: 'marketing' },
    'settings':                    { title: 'Settings',          sub: 'Konfigurasi brand, cabang, pemenuhan, dan integrasi sistem', tab: 'settings' },
    'settings/business':           { title: 'Business Settings', sub: 'Identitas brand, profil perusahaan, dan legalitas', tab: 'settings' },
    'settings/business/profile':   { title: 'Brand Profile',     sub: 'Identitas visual, nama toko, logo, dan tema brand', tab: 'settings' },
    'settings/business/info':      { title: 'Business Info',     sub: 'Informasi badan usaha, organisasi, dan kontak operasional', tab: 'settings' },
    'settings/business/legal':     { title: 'Legal & Tax',       sub: 'Status konfigurasi pajak restoran (PB1/PPN) dan legalitas', tab: 'settings' },
    'settings/locations':          { title: 'Branch Defaults',   sub: 'Nilai acuan default pengiriman dan formula ongkir cabang', tab: 'settings' },
    'settings/commerce':           { title: 'Commerce Settings', sub: 'Kebijakan pesanan, payment gateway, dan pemenuhan layanan', tab: 'settings' },
    'settings/commerce/orders':    { title: 'Order Settings',    sub: 'Aturan validasi pesanan, batas kedaluwarsa, dan reservasi', tab: 'settings' },
    'settings/commerce/payments':  { title: 'Payment Settings',  sub: 'Kredensial payment gateway Midtrans dan direct payment', tab: 'settings' },
    'settings/commerce/fulfillment': { title: 'Fulfillment',     sub: 'Pengaturan radius delivery, pickup, dan tarif antar cabang', tab: 'settings' },
    'settings/channels':           { title: 'Channels',          sub: 'Status kanal penjualan: Website, PWA, POS, dan Kiosk', tab: 'settings' },
    'settings/channels/website':   { title: 'Channel Website',   sub: 'Status toko online web ordering resmi merchant', tab: 'settings' },
    'settings/channels/customer-app': { title: 'Customer App',   sub: 'Status Progressive Web App (PWA) aplikasi pelanggan', tab: 'settings' },
    'settings/channels/pos':       { title: 'Channel POS',       sub: 'Status kasir Point of Sale native dan shift aktif', tab: 'settings' },
    'settings/channels/kiosk':     { title: 'Channel Kiosk',     sub: 'Status terminal pemesanan mandiri self-service kiosk', tab: 'settings' },
    'settings/integrations':       { title: 'Integrations',      sub: 'Modul integrasi payment gateway, POS, dan Xentra ecosystem', tab: 'settings' },
    'settings/notifications':      { title: 'Notifications',     sub: 'Preferensi notifikasi multi-channel WhatsApp, Email & Push', tab: 'settings' },
    'settings/security':           { title: 'Security & RBAC',   sub: 'Model otorisasi, sesi pengguna, dan jejak audit keamanan', tab: 'settings' },
    // Legacy routes (internal tabs that still exist from old dashboard)
    'brand':              { title: 'Brand & Tampilan', sub: 'Kustomisasi logo, warna tema, dan identitas visual', tab: 'brand' },
    'payments':           { title: 'Integrasi Pembayaran', sub: 'Kredensial direct payment Midtrans & Tunai', tab: 'payments' }
  };

  // Platform Dashboard routes (xentra.cloud)
  var PLATFORM_ROUTE_META = {
    'overview':           { title: 'Platform Overview',      sub: 'Global ecosystem overview & platform telemetry',        tab: 'platform-overview' },
    'organizations':      { title: 'Organizations',          sub: 'Enterprise organizations & business group structures',  tab: 'platform-organizations' },
    'brands':             { title: 'Brands',                 sub: 'Registered merchant brands & multi-tenant fleet',        tab: 'platform-brands' },
    'domains':            { title: 'Domains',                sub: 'Custom domains mapping, SSL/TLS & ingress routing',      tab: 'platform-domains' },
    'provisioning':       { title: 'Provisioning',           sub: 'Automated tenant orchestration & cluster provisioning', tab: 'platform-provisioning' },
    'users-access':       { title: 'Users & Access',         sub: 'Platform operator RBAC & centralized IAM credentials',  tab: 'platform-users' },
    'billing':            { title: 'Subscriptions / Billing', sub: 'SaaS recurring subscriptions, invoices & billing plans', tab: 'platform-billing' },
    'audit-logs':         { title: 'Audit Logs',             sub: 'Platform security audit trail & operator access logs',  tab: 'platform-audit-logs' },
    'integrations':       { title: 'Integrations',           sub: 'Global ecosystem webhooks & upstream cloud services',   tab: 'platform-integrations' },
    'settings':           { title: 'Platform Settings',      sub: 'Global core engine configuration & system parameters',  tab: 'platform-settings' }
  };

  // Branch Manager Operational Center routes (BM-1)
  var BM_ROUTE_META = {
    "hari-ini":         { title: "Hari Ini",         sub: "Ringkasan operasional harian cabang dan kendali layanan", tab: "hari-ini" },
    "pesanan":          { title: "Pesanan",          sub: "Antrean pesanan dan branch acceptance operasional",       tab: "bm-pesanan" },
    "meja":             { title: "Meja",             sub: "Status operasional meja dan dine-in cabang",              tab: "bm-meja" },
    "menu":             { title: "Menu",             sub: "Ketersediaan produk dan operasional menu cabang",         tab: "bm-menu" },
    "promo":            { title: "Promo",            sub: "Promosi dan diskon operasional aktif cabang",             tab: "bm-promo" },
    "stok":             { title: "Stok",             sub: "Pemantauan stok dan peringatan inventaris cabang",        tab: "bm-stok" },
    "staff":            { title: "Staff",            sub: "Daftar staf operasional dan kasir cabang",                tab: "bm-staff" },
    "reports":          { title: "Laporan",          sub: "Laporan penjualan dan operasional harian cabang",         tab: "bm-reports" },
    "jam-operasional":  { title: "Jam Operasional",  sub: "Jam operasional dan pengecualian libur cabang",           tab: "bm-jam-operasional" }
  };

  // Active route metadata dictionary according to context
  function getActiveRouteMeta() {
    if (isPlatformContext()) return PLATFORM_ROUTE_META;
    if (isBranchManager()) return BM_ROUTE_META;
    return CLIENT_ROUTE_META;
  }

  // Parse the active route from the current URL hash
  function getCurrentRoute() {
    var hash = window.location.hash.replace(/^#\/?/, '').trim();
    var meta = getActiveRouteMeta();

    if (!hash) return isBranchManager() ? 'hari-ini' : 'overview';

    if (!isPlatformContext()) {
      if (hash === 'catalog') return 'catalog/products';
      // Handle dynamic route: catalog/products/:id
      if (hash.indexOf('catalog/products/') === 0) {
        return hash;
      }
      // Handle dynamic route: branches/:id and branches/:id/:subtab
      if (hash.indexOf('branches/') === 0) {
        return hash;
      }
      // Handle dynamic route: orders/:id
      if (hash.indexOf('orders/') === 0) {
        return hash;
      }
      // Handle dynamic route: reports/:type
      if (hash.indexOf('reports/') === 0) {
        return hash;
      }
      // Handle dynamic route: customers/:id
      if (hash.indexOf('customers/') === 0) {
        return hash;
      }
      // Handle dynamic route: team/:subtab
      if (hash.indexOf('team/') === 0) {
        return hash;
      }
      // Handle dynamic route: finance/:subtab
      if (hash.indexOf('finance/') === 0) {
        return hash;
      }
      // Handle dynamic route: marketing/:subtab
      if (hash.indexOf('marketing/') === 0) {
        return hash;
      }
      // Handle dynamic route: settings/:subtab
      if (hash.indexOf('settings/') === 0) {
        return hash;
      }
    }

    // Validate the route exists, default to 'overview' (or 'hari-ini' for branch manager)
    var defaultRoute = isBranchManager() ? 'hari-ini' : 'overview';
    return meta[hash.toLowerCase()] ? hash.toLowerCase() : defaultRoute;
  }

  function closeMobileSidebar() {
    var sidebar = $('x-dash-sidebar');
    var overlay = $('x-sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
  }
  window.closeMobileSidebar = closeMobileSidebar;

  // Navigate to a route: update URL hash, then apply the route
  function navigateTo(route) {
    if (!route) return;
    closeMobileSidebar();
    var legacyMap = {
      'overview': 'overview',
      'orders': 'orders',
      'catalog': 'catalog/products',
      'catalog-products': 'catalog/products',
      'catalog-categories': 'catalog/categories',
      'catalog-menus': 'catalog/menus',
      'branches': 'branches',
      'tim': 'team',
      'team': 'team',
      'customers': 'customers',
      'reports': 'reports',
      'finance': 'finance/overview',
      'marketing': 'marketing/promotions',
      'settings': 'settings',
      'brand': 'brand',
      'payments': 'payments'
    };
    var canonicalRoute = legacyMap[route] || route;
    if (window.location.hash === '#' + canonicalRoute) {
      applyRoute(canonicalRoute);
    } else {
      window.location.hash = canonicalRoute;
      applyRoute(canonicalRoute);
    }
  }
  window.navigateTo = navigateTo;

  // Render Branch Manager Navigation in Sidebar (BM-1)
  function renderBranchManagerNavigation() {
    var nav = $("x-dash-nav");
    if (!nav) return;

    nav.innerHTML =
      "<div class=\"x-nav-group-label\">HARI INI</div>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"hari-ini\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"10\"></circle><polyline points=\"12 6 12 12 16 14\"></polyline></svg>" +
        "<span>Hari Ini</span>" +
      "</button>" +

      "<div class=\"x-nav-group-label\" style=\"margin-top: 10px;\">OPERASIONAL</div>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"pesanan\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z\"></path><line x1=\"3\" y1=\"6\" x2=\"21\" y2=\"6\"></line><path d=\"M16 10a4 4 0 0 1-8 0\"></path></svg>" +
        "<span>Pesanan</span>" +
      "</button>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"meja\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M4 18v3\"></path><path d=\"M20 18v3\"></path><path d=\"M4 11h16\"></path><path d=\"M4 11V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5\"></path></svg>" +
        "<span>Meja</span>" +
      "</button>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"menu\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M18 8h1a4 4 0 0 1 0 8h-1\"></path><path d=\"M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z\"></path><line x1=\"6\" y1=\"1\" x2=\"6\" y2=\"4\"></line><line x1=\"10\" y1=\"1\" x2=\"10\" y2=\"4\"></line><line x1=\"14\" y1=\"1\" x2=\"14\" y2=\"4\"></line></svg>" +
        "<span>Menu</span>" +
      "</button>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"promo\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><polygon points=\"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2\"></polygon></svg>" +
        "<span>Promo</span>" +
      "</button>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"stok\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z\"></path><polyline points=\"3.27 6.96 12 12.01 20.73 6.96\"></polyline><line x1=\"12\" y1=\"22.08\" x2=\"12\" y2=\"12\"></line></svg>" +
        "<span>Stok</span>" +
      "</button>" +

      "<div class=\"x-nav-group-label\" style=\"margin-top: 10px;\">TIM</div>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"staff\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2\"></path><circle cx=\"9\" cy=\"7\" r=\"4\"></circle><path d=\"M23 21v-2a4 4 0 0 0-3-3.87\"></path><path d=\"M16 3.13a4 4 0 0 1 0 7.75\"></path></svg>" +
        "<span>Staff</span>" +
      "</button>" +

      "<div class=\"x-nav-group-label\" style=\"margin-top: 10px;\">LAPORAN</div>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"reports\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><line x1=\"18\" y1=\"20\" x2=\"18\" y2=\"10\"></line><line x1=\"12\" y1=\"20\" x2=\"12\" y2=\"4\"></line><line x1=\"6\" y1=\"20\" x2=\"6\" y2=\"14\"></line></svg>" +
        "<span>Penjualan Hari Ini</span>" +
      "</button>" +

      "<div class=\"x-nav-group-label\" style=\"margin-top: 10px;\">PENGATURAN</div>" +

      "<button type=\"button\" class=\"x-nav-item\" data-route=\"jam-operasional\">" +
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"10\"></circle><polyline points=\"12 6 12 12 16 14\"></polyline></svg>" +
        "<span>Jam Operasional</span>" +
      "</button>";

    nav.querySelectorAll(".x-nav-item[data-route]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        navigateTo(btn.dataset.route);
      });
    });
  }

  // Render Platform Navigation in Sidebar
  function renderPlatformNavigation() {
    var nav = $('x-dash-nav');
    if (!nav) return;

    nav.innerHTML = 
      '<button type="button" class="x-nav-item" data-route="overview">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>' +
        '<span>Overview</span>' +
      '</button>' +

      '<div style="height: 10px;"></div>' +

      '<button type="button" class="x-nav-item" data-route="organizations">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18"></path><path d="M5 21V7l8-4v18"></path><path d="M19 21V11l-6-3"></path><path d="M9 9h1"></path><path d="M9 13h1"></path><path d="M9 17h1"></path></svg>' +
        '<span>Organizations</span>' +
      '</button>' +
      '<button type="button" class="x-nav-item" data-route="brands">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>' +
        '<span>Brands</span>' +
      '</button>' +
      '<button type="button" class="x-nav-item" data-route="domains">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>' +
        '<span>Domains</span>' +
      '</button>' +
      '<button type="button" class="x-nav-item" data-route="provisioning">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path></svg>' +
        '<span>Provisioning</span>' +
      '</button>' +

      '<div style="height: 10px;"></div>' +

      '<button type="button" class="x-nav-item" data-route="users-access">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>' +
        '<span>Users & Access</span>' +
      '</button>' +

      '<div style="height: 10px;"></div>' +

      '<button type="button" class="x-nav-item" data-route="billing">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>' +
        '<span>Subscriptions / Billing</span>' +
      '</button>' +

      '<div class="x-nav-group-label" style="margin-top: 6px;">SYSTEM</div>' +

      '<button type="button" class="x-nav-item" data-route="audit-logs">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>' +
        '<span>Audit Logs</span>' +
      '</button>' +
      '<button type="button" class="x-nav-item" data-route="integrations">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>' +
        '<span>Integrations</span>' +
      '</button>' +

      '<div style="height: 10px;"></div>' +

      '<button type="button" class="x-nav-item" data-route="settings">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>' +
        '<span>Settings</span>' +
      '</button>';

    // Wire clicks on newly rendered nav items
    nav.querySelectorAll('.x-nav-item[data-route]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        navigateTo(btn.dataset.route);
      });
    });
  }

  // Apply the route: update nav active state, show correct section, load data
  function applyRoute(route) {
    var isPlatform = isPlatformContext();
    var metaDict = getActiveRouteMeta();

    if (!isPlatform && route === 'catalog') {
      navigateTo('catalog/products');
      return;
    }

    if (!isPlatform && route === 'marketing') {
      navigateTo('marketing/promotions');
      return;
    }

    if (isBranchManager() && (route === 'marketing' || route.indexOf('marketing/') === 0)) {
      navigateTo('promo');
      return;
    }

    var isProductDetail = !isPlatform && route.indexOf('catalog/products/') === 0;
    var productDetailId = isProductDetail ? route.split('catalog/products/')[1] : null;

    var isBranchDetail = !isPlatform && route.indexOf('branches/') === 0;
    var branchDetailParts = isBranchDetail ? route.split('/') : [];
    var branchDetailId = isBranchDetail ? branchDetailParts[1] : null;
    var branchDetailSubtab = isBranchDetail ? (branchDetailParts[2] || 'overview') : 'overview';

    var isOrderDetail = !isPlatform && route.indexOf('orders/') === 0;
    var orderDetailId = isOrderDetail ? route.split('orders/')[1] : null;

    var isCustomerDetail = !isPlatform && route.indexOf('customers/') === 0;
    var customerDetailId = isCustomerDetail ? route.split('customers/')[1] : null;

    var isTeamRoute = !isPlatform && (route === 'team' || route.indexOf('team/') === 0);
    var teamSubtab = isTeamRoute ? (route.indexOf('team/') === 0 ? route.split('team/')[1] : 'members') : 'members';

    var isReportsRoute = !isPlatform && (route === 'reports' || route.indexOf('reports/') === 0);
    var reportSubtype = isReportsRoute ? (route.indexOf('reports/') === 0 ? route.split('reports/')[1] : 'overview') : 'overview';

    var isFinanceRoute = !isPlatform && (route === 'finance' || route.indexOf('finance/') === 0);
    var financeSubtab = isFinanceRoute ? (route.indexOf('finance/') === 0 ? route.split('finance/')[1] : 'overview') : 'overview';

    var isMarketingRoute = !isPlatform && (route === 'marketing' || route.indexOf('marketing/') === 0);
    var marketingSubtab = isMarketingRoute ? (route.indexOf('marketing/') === 0 ? route.split('marketing/')[1] : 'promotions') : 'promotions';

    var isSettingsRoute = !isPlatform && (route === 'settings' || route.indexOf('settings/') === 0);
    var settingsSubtab = isSettingsRoute ? (route.indexOf('settings/') === 0 ? route.split('settings/')[1] : 'business/profile') : 'business/profile';

    var metaKey = isProductDetail ? 'catalog/products' : (isBranchDetail ? 'branches' : (isOrderDetail ? 'orders' : (isCustomerDetail ? 'customers/:id' : (isTeamRoute ? ('team/' + teamSubtab) : (isReportsRoute ? 'reports' : (isFinanceRoute ? ('finance/' + financeSubtab) : (isMarketingRoute ? ('marketing/' + marketingSubtab) : (isSettingsRoute ? ('settings/' + settingsSubtab) : route))))))));
    var meta = metaDict[metaKey] || metaDict[route] || metaDict['overview'];
    var tabId = meta.tab;
    var isCatalogChild = !isPlatform && route.indexOf('catalog/') === 0;

    // 1. Update all top-level nav items active state
    document.querySelectorAll('.x-nav-item[data-route]').forEach(function (btn) {
      var btnRoute = btn.dataset.route;
      var isActive;
      if (btnRoute === 'catalog') {
        // Catalog parent is active if we're on 'catalog' or any catalog sub-route
        isActive = route === 'catalog' || isCatalogChild;
      } else if (btnRoute === 'branches') {
        isActive = route === 'branches' || isBranchDetail;
      } else if (btnRoute === 'orders') {
        isActive = route === 'orders' || isOrderDetail;
      } else if (btnRoute === 'customers') {
        isActive = route === 'customers' || isCustomerDetail;
      } else if (btnRoute === 'team') {
        isActive = isTeamRoute;
      } else if (btnRoute === 'reports') {
        isActive = isReportsRoute;
      } else if (btnRoute === 'finance') {
        isActive = isFinanceRoute;
      } else if (btnRoute === 'marketing') {
        isActive = isMarketingRoute;
      } else if (btnRoute === 'settings') {
        isActive = isSettingsRoute;
      } else {
        isActive = btnRoute === route;
      }
      btn.classList.toggle('active', isActive);
    });

    // 2. Update catalog sub-nav items (client context only)
    if (!isPlatform) {
      document.querySelectorAll('.x-nav-sub-item[data-route]').forEach(function (btn) {
        var targetRoute = btn.dataset.route;
        var isActiveSub = targetRoute === route || (isProductDetail && targetRoute === 'catalog/products');
        btn.classList.toggle('active', isActiveSub);
      });

      // 3. Toggle catalog sub-nav open/closed
      var catalogSub = $('nav-catalog-sub');
      var catalogParent = $('nav-catalog-parent');
      var catalogOpen = route === 'catalog' || isCatalogChild;
      if (catalogSub) catalogSub.classList.toggle('open', catalogOpen);
      if (catalogParent) {
        catalogParent.setAttribute('aria-expanded', catalogOpen ? 'true' : 'false');
      }
    }

    // 4. Show correct content section
    document.querySelectorAll('.x-tab-content').forEach(function (section) {
      section.classList.toggle('active', section.id === 'tab-' + tabId);
    });

    // 5. Update topbar title
    var titleEl = $('dash-page-title');
    var subEl = $('dash-page-subtitle');
    if (titleEl) titleEl.textContent = isProductDetail ? 'Product Detail' : (isBranchDetail ? 'Branch Detail' : (isOrderDetail ? 'Order Detail' : (isCustomerDetail ? 'Customer Detail' : (isReportsRoute ? 'Reports' : meta.title))));
    if (subEl) subEl.textContent = isProductDetail ? 'Detail produk master dan status adopsi di cabang' : (isBranchDetail ? 'Detail informasi, operasional, menu, dan tim cabang' : (isOrderDetail ? 'Detail transaksi, rincian biaya, dan status pesanan' : (isCustomerDetail ? 'Profil pelanggan, riwayat pesanan, dan loyalitas' : (isReportsRoute ? 'Laporan penjualan, analitik bisnis, dan kinerja cabang' : meta.sub))));

    // 6. In Platform Context: UI shells only, do not invoke merchant business loaders
    if (isPlatform) {
      return;
    }

    // 7. In Client Context: Load merchant business data for the route
    if (tabId === 'orders' && !isOrderDetail) {
      startOrdersPolling();
    } else {
      stopOrdersPolling();
    }

    if (tabId === 'bm-pesanan') {
      startBMOrdersPolling();
      loadBMOrders();
    } else {
      stopBMOrdersPolling();
    }

    if (tabId === 'bm-meja') {
      loadBMTables();
    }

    if (tabId === 'bm-menu') {
      loadBMMenu();
    }

    if (tabId === 'bm-stok') {
      loadBMStock();
    }

    if (tabId === 'bm-promo') {
      loadBMPromotions();
    }

    if (tabId === 'hari-ini') {
      loadHariIni();
    }

    if (tabId === 'bm-staff') {
      loadBMStaff();
    }

    if (tabId === 'bm-jam-operasional') {
      loadBMJamOperasional();
    }

    if (tabId === 'bm-reports') {
      loadBMReports();
    }

    if (tabId === 'overview') loadOverview();
    if (tabId === 'reports') loadReports(reportSubtype);
    if (tabId === 'customers') {
      if (isCustomerDetail && customerDetailId) {
        loadCustomerDetailView(customerDetailId);
      } else {
        showCustomersListView();
        loadCustomers();
      }
    }
    if (tabId === 'orders') {
      if (isOrderDetail && orderDetailId) {
        loadOrderDetailView(orderDetailId);
      } else {
        showOrdersListView();
        loadOrders();
      }
    }
    if (tabId === 'branches') {
      if (isBranchDetail && branchDetailId) {
        loadBranchDetail(branchDetailId, branchDetailSubtab);
      } else {
        showBranchListView();
        loadBranches();
      }
    }
    if (tabId === 'tim') {
      switchTeamSection(teamSubtab, false);
      if (teamSubtab === 'invitations') {
        loadInvitations();
      } else {
        loadTim();
      }
    }
    if (tabId === 'finance') {
      switchFinanceSection(financeSubtab, false);
    }
    if (tabId === 'marketing') {
      switchMarketingSection(marketingSubtab, false);
    }
    if (tabId === 'settings') {
      switchSettingsSection(settingsSubtab, false);
    }

    // Catalog Routes
    if (isBranchManager()) {
      if (isCatalogChild) loadInlineBranchCatalog();
    } else {
      if (isProductDetail && productDetailId) {
        showProductDetailSection();
        loadProductDetailView(productDetailId);
      } else if (tabId === 'catalog-products') {
        showProductListSection();
        loadMasterProducts();
      } else if (tabId === 'catalog-categories') {
        loadMasterCategories();
      } else if (tabId === 'catalog-menus') {
        loadMenusView();
      }
    }
  }

  // Listen to hash changes (browser back/forward, direct URL)
  window.addEventListener('hashchange', function () {
    applyRoute(getCurrentRoute());
  });

  // switchTab kept for backward compat (called from quick-action buttons in HTML)
  function switchTab(tabId) {
    // Map old tab IDs to new routes
    var legacyMap = {
      'overview': 'overview', 'brand': 'brand', 'catalog': 'catalog/products',
      'branches': 'branches', 'tim': 'team', 'orders': 'orders',
      'payments': 'payments'
    };
    navigateTo(legacyMap[tabId] || tabId);
  }
  window.switchTab = switchTab;

  /* =========================================================================
     BRANCH CONTEXT SELECTOR
     Populates the topbar branch dropdown from loaded branch data.
     The selector maintains a UI/state contract so real data can connect later.
     ========================================================================= */

  // State for currently selected branch context
  var _branchContextState = {
    selected: 'all',   // 'all' or a branch id string
    branches: []       // loaded branch objects [{id, name}]
  };

  // Populate branch selector from branches list
  function populateBranchSelector(branches) {
    var sel = $('dash-branch-context');
    if (!sel) return;
    var allBranches = branches || [];
    var user = getStoredUser();

    // Role-scoped branch list filtering:
    // If brand_manager, only show branches matching user's brand_id
    var scopedBranches = allBranches;
    if (user && user.role === 'brand_manager' && user.brand_id) {
      scopedBranches = allBranches.filter(function (b) {
        return String(b.brand_id) === String(user.brand_id);
      });
    } else if (user && user.role === 'branch_manager' && user.branch_id) {
      scopedBranches = allBranches.filter(function (b) {
        return String(b.id) === String(user.branch_id);
      });
    }

    _branchContextState.branches = scopedBranches;

    // Rebuild options
    sel.innerHTML = '<option value="all">All Branches</option>';
    (_branchContextState.branches).forEach(function (b) {
      var opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.name;
      sel.appendChild(opt);
    });

    // Restore previous selection if still valid
    if (user && user.role === 'branch_manager' && user.branch_id) {
      _branchContextState.selected = user.branch_id;
      sel.value = user.branch_id;
      sel.disabled = true;

      // Update BM branch badge text if available
      var bmBadgeName = $('dash-bm-branch-name');
      if (bmBadgeName) {
        var foundB = (_branchContextState.branches).find(function (b) { return String(b.id) === String(user.branch_id); }) ||
                     allBranches.find(function (b) { return String(b.id) === String(user.branch_id); });
        if (foundB && foundB.name) {
          bmBadgeName.textContent = foundB.name;
        }
      }
    } else if (user && (user.role === 'cashier' || user.role === 'kitchen')) {
      sel.disabled = true;
    } else {
      var validIds = ['all'].concat((_branchContextState.branches).map(function (b) { return String(b.id); }));
      if (validIds.indexOf(_branchContextState.selected) === -1) {
        _branchContextState.selected = 'all';
      }
      sel.value = _branchContextState.selected;
      sel.disabled = false;
    }
  }

  function initBranchContextSelector() {
    var sel = $('dash-branch-context');
    if (!sel) return;
    sel.addEventListener('change', function () {
      _branchContextState.selected = sel.value;
      var curRoute = getCurrentRoute();
      if (curRoute === 'overview') {
        loadOverview();
      } else if (curRoute === 'reports' || curRoute.indexOf('reports/') === 0) {
        var subType = curRoute.indexOf('reports/') === 0 ? curRoute.split('reports/')[1] : 'overview';
        loadReports(subType);
      } else if (curRoute === 'catalog/menus') {
        loadMenusView();
      } else if (curRoute === 'orders') {
        loadOrders();
      } else if (curRoute === 'customers') {
        loadCustomers();
      } else if (curRoute === 'team' || curRoute.indexOf('team/') === 0) {
        loadTim();
      } else if (curRoute === 'finance' || curRoute.indexOf('finance/') === 0) {
        loadFinanceCurrentSubtab();
      } else if (curRoute === 'marketing' || curRoute.indexOf('marketing/') === 0) {
        loadMarketingCurrentSubtab();
      } else if (curRoute === 'settings' || curRoute.indexOf('settings/') === 0) {
        loadSettingsCurrentSubtab();
      } else if (isBranchManager() && (curRoute === 'catalog' || curRoute.indexOf('catalog/') === 0)) {
        loadInlineBranchCatalog();
      }
    });
  }

  /* =========================================================================
     MOBILE SIDEBAR — Hamburger / Overlay / Close
     ========================================================================= */

  function initMobileSidebar() {
    var sidebar = $('x-dash-sidebar');
    var overlay = $('x-sidebar-overlay');
    var btnOpen = $('btn-hamburger');
    var btnClose = $('btn-sidebar-close');

    function openSidebar() {
      if (sidebar) sidebar.classList.add('open');
      if (overlay) overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
      if (sidebar) sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('open');
      document.body.style.overflow = '';
    }

    if (btnOpen) btnOpen.addEventListener('click', openSidebar);
    if (btnClose) btnClose.addEventListener('click', closeMobileSidebar);
    if (overlay) overlay.addEventListener('click', closeMobileSidebar);

    // Event delegation: Close sidebar whenever any nav item or sub-item is clicked (mobile & tablet drawer)
    if (sidebar) {
      sidebar.addEventListener('click', function (e) {
        var navBtn = e.target.closest('.x-nav-item:not(.x-nav-parent)[data-route], .x-nav-sub-item');
        if (navBtn) {
          closeMobileSidebar();
        }
      });
    }
  }



  /* =========================================================================
     MODUL 1: BRAND & THEME COLOR CONTROLLER
     ========================================================================= */
  async function loadBrandSettings() {
    try {
      var res = await adminFetch(API_BASE + '/admin/brand', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data && data.brand) {
        state.brand = data.brand;
        applyBrandToUI(data.brand);
      }
    } catch (e) {
      console.warn('[Dashboard Brand Load Warn]:', e);
    }
  }

  function applyBrandToUI(brand) {
    if (!brand) return;

    $('brand-name').value = brand.name || 'Bangjo Resto';
    $('brand-tagline').value = brand.tagline || 'Official Online Food Ordering';
    var logoUrl = brand.logo_url || '/assets/pwa/icon-192.png';
    $('brand-logo').value = logoUrl;
    if ($('brand-logo-preview')) {
      $('brand-logo-preview').src = logoUrl;
      $('brand-logo-preview').style.display = 'block';
    }
    if ($('brand-logo-empty')) $('brand-logo-empty').style.display = 'none';
    if ($('btn-brand-logo-remove')) $('btn-brand-logo-remove').style.display = (logoUrl && logoUrl !== '/assets/pwa/icon-192.png') ? 'inline-block' : 'none';

    $('brand-color').value = brand.primary_color || '#b6ff00';
    $('brand-color-hex').value = brand.primary_color || '#b6ff00';
    $('brand-domain').value = brand.custom_domain || 'app.mybangjo.com';

    $('dash-brand-title').textContent = brand.name || 'Bangjo Resto';
    $('dash-sidebar-logo').src = logoUrl;
    if ($('topbar-brand-name')) $('topbar-brand-name').textContent = brand.name || 'Bangjo Resto';
    var user = getStoredUser();
    if (user && user.role === 'branch_manager' && $('topbar-brand-badge')) {
      $('topbar-brand-badge').style.display = 'none';
    }

    if ($('set-profile-name')) $('set-profile-name').value = brand.name || '';
    if ($('set-profile-tagline')) $('set-profile-tagline').value = brand.tagline || '';
    if ($('set-profile-logo')) $('set-profile-logo').value = logoUrl;
    if ($('set-profile-logo-preview')) {
      $('set-profile-logo-preview').src = logoUrl;
      $('set-profile-logo-preview').style.display = 'block';
    }
    if ($('set-profile-logo-empty')) $('set-profile-logo-empty').style.display = 'none';
    if ($('btn-set-profile-logo-remove')) $('btn-set-profile-logo-remove').style.display = (logoUrl && logoUrl !== '/assets/pwa/icon-192.png') ? 'inline-block' : 'none';
    if ($('btn-set-profile-logo-pick')) $('btn-set-profile-logo-pick').textContent = (logoUrl && logoUrl !== '/assets/pwa/icon-192.png') ? '📁 Ganti Logo' : '📁 Unggah Logo';
    if ($('set-profile-color')) $('set-profile-color').value = brand.primary_color || '#b6ff00';
    if ($('set-profile-color-hex')) $('set-profile-color-hex').value = brand.primary_color || '#b6ff00';
    if ($('set-profile-domain')) $('set-profile-domain').textContent = brand.custom_domain || window.location.host || '-';

    if ($('auth-brand-name')) $('auth-brand-name').textContent = brand.name || 'Bangjo Resto';
    if ($('auth-logo')) $('auth-logo').src = logoUrl;

    renderBannersList(brand.banners);
    updateLiveMockupPreview(brand.name, logoUrl, brand.primary_color);
  }

  function updateLiveMockupPreview(name, logo, color) {
    color = color || $('brand-color').value || '#b6ff00';
    logo = logo || $('brand-logo').value || '/assets/pwa/icon-192.png';
    name = name || $('brand-name').value || 'Bangjo Resto';

    $('mock-title').textContent = name;
    $('mock-logo').src = logo;

    document.documentElement.style.setProperty('--primary-color', color);

    var mockPill = $('mock-cat-1');
    if (mockPill) mockPill.style.backgroundColor = color;

    var mockAddBtn = $('mock-btn-tambah');
    if (mockAddBtn) mockAddBtn.style.backgroundColor = color;

    var mockCartBtn = $('mock-cart-btn');
    if (mockCartBtn) mockCartBtn.style.backgroundColor = color;
  }

  function initBrandListeners() {
    var colorPicker = $('brand-color');
    var colorHex = $('brand-color-hex');
    var logoInput = $('brand-logo');
    var nameInput = $('brand-name');

    if (colorPicker && colorHex && nameInput && logoInput) {
      colorPicker.addEventListener('input', function () {
        colorHex.value = colorPicker.value;
        updateLiveMockupPreview(nameInput.value, logoInput.value, colorPicker.value);
      });

      colorHex.addEventListener('input', function () {
        if (/^#[0-9A-Fa-f]{6}$/.test(colorHex.value)) {
          colorPicker.value = colorHex.value;
          updateLiveMockupPreview(nameInput.value, logoInput.value, colorHex.value);
        }
      });

      logoInput.addEventListener('input', function () {
        updateLiveMockupPreview(nameInput.value, logoInput.value, colorPicker.value);
      });

      nameInput.addEventListener('input', function () {
        updateLiveMockupPreview(nameInput.value, logoInput.value, colorPicker.value);
      });
    }

    // Swatches
    document.querySelectorAll('.x-swatch').forEach(function (swatch) {
      swatch.addEventListener('click', function () {
        var c = swatch.dataset.color;
        if (colorPicker) colorPicker.value = c;
        if (colorHex) colorHex.value = c;
        if (nameInput && logoInput) {
          updateLiveMockupPreview(nameInput.value, logoInput.value, c);
        }
      });
    });

    // Reusable Brand Logo Upload Flow (Media System M1/M2/M3)
    async function doUploadBrandLogo(file, cropSpec, previewDataUrl, triggerBtn) {
      if (triggerBtn) {
        triggerBtn.disabled = true;
        triggerBtn.textContent = 'Mengunggah...';
      }

      // Optimistic preview immediately so user sees immediate feedback
      if (previewDataUrl) {
        if ($('brand-logo-preview')) {
          $('brand-logo-preview').src = previewDataUrl;
          $('brand-logo-preview').style.display = 'block';
        }
        if ($('brand-logo-empty')) $('brand-logo-empty').style.display = 'none';
        if ($('set-profile-logo-preview')) {
          $('set-profile-logo-preview').src = previewDataUrl;
          $('set-profile-logo-preview').style.display = 'block';
        }
        if ($('set-profile-logo-empty')) $('set-profile-logo-empty').style.display = 'none';
        if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = previewDataUrl;
        if (nameInput && colorPicker) {
          updateLiveMockupPreview(nameInput.value, previewDataUrl, colorPicker.value);
        }
      }

      try {
        var base64 = await new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () { resolve(reader.result); };
          reader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
          reader.readAsDataURL(file);
        });

        var payload = { image_base64: base64, mime_type: file.type };
        if (cropSpec) payload.crop_spec = cropSpec;

        var res = await adminFetch(API_BASE + '/admin/brand/logo', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var data = await res.json();

        if (res.ok && data.success) {
          showToast('✅ Logo brand berhasil diunggah.');
          var logoUrl = data.logo_url;
          if (logoInput) logoInput.value = logoUrl;
          if ($('brand-logo-preview')) {
            $('brand-logo-preview').src = logoUrl;
            $('brand-logo-preview').style.display = 'block';
          }
          if ($('brand-logo-empty')) $('brand-logo-empty').style.display = 'none';
          if (btnRemoveLogo) btnRemoveLogo.style.display = 'inline-block';
          if ($('btn-brand-logo-pick')) $('btn-brand-logo-pick').textContent = '📁 Ganti Logo';

          if ($('set-profile-logo')) $('set-profile-logo').value = logoUrl;
          if ($('set-profile-logo-preview')) {
            $('set-profile-logo-preview').src = logoUrl;
            $('set-profile-logo-preview').style.display = 'block';
          }
          if ($('set-profile-logo-empty')) $('set-profile-logo-empty').style.display = 'none';
          if ($('btn-set-profile-logo-remove')) $('btn-set-profile-logo-remove').style.display = 'inline-block';
          if ($('btn-set-profile-logo-pick')) $('btn-set-profile-logo-pick').textContent = '📁 Ganti Logo';

          if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = logoUrl;
          if (nameInput && colorPicker) {
            updateLiveMockupPreview(nameInput.value, logoUrl, colorPicker.value);
          }
          loadBrandSettings();
          if (typeof window.loadSettingsProfile === 'function') {
            window.loadSettingsProfile();
          }
        } else {
          showToast('❌ ' + (data.error || 'Gagal mengunggah logo brand.'));
        }
      } catch (err) {
        showToast('❌ Kesalahan jaringan saat mengunggah logo.');
      } finally {
        if (triggerBtn) {
          triggerBtn.disabled = false;
          triggerBtn.textContent = '📁 Ganti Logo';
        }
      }
    }

    // Brand Logo File Picker & Upload
    var btnPickLogo = $('btn-brand-logo-pick');
    var fileInputLogo = $('input-brand-logo-file');
    var btnRemoveLogo = $('btn-brand-logo-remove');

    if (btnPickLogo && fileInputLogo) {
      btnPickLogo.addEventListener('click', function () {
        fileInputLogo.click();
      });

      fileInputLogo.addEventListener('change', async function () {
        var file = fileInputLogo.files && fileInputLogo.files[0];
        if (!file) return;

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format file tidak didukung. Gunakan JPG, PNG, atau WebP.');
          fileInputLogo.value = '';
          return;
        }

        if (file.size > 10 * 1024 * 1024) {
          showToast('❌ Ukuran file melebihi batas 10 MB.');
          fileInputLogo.value = '';
          return;
        }

        XentraCropEditor.open({
          source: file,
          assetType: 'logo',
          aspectRatio: 1.0,
          title: 'Potong & Posisikan Logo Brand (1:1)',
          onConfirm: async function (cropSpec, previewDataUrl) {
            try {
              await doUploadBrandLogo(file, cropSpec, previewDataUrl, btnPickLogo);
            } finally {
              fileInputLogo.value = '';
            }
          },
          onCancel: async function () {
            // If user cancels crop modal, allow direct upload of the original image
            try {
              var reader = new FileReader();
              reader.onload = function (ev) {
                doUploadBrandLogo(file, null, ev.target.result, btnPickLogo);
              };
              reader.readAsDataURL(file);
            } catch (_) {}
            fileInputLogo.value = '';
          }
        });
      });
    }

    if (btnRemoveLogo) {
      btnRemoveLogo.addEventListener('click', async function () {
        if (!confirm('Hapus logo brand kustom dan kembali ke default?')) return;
        try {
          var res = await adminFetch(API_BASE + '/admin/brand/logo', {
            method: 'DELETE',
            headers: getAuthHeaders()
          });
          var data = await res.json();
          if (res.ok && data.success) {
            showToast('✅ Logo brand kustom dihapus.');
            var defaultLogo = '/assets/pwa/icon-192.png';
            if (logoInput) logoInput.value = defaultLogo;
            if ($('brand-logo-preview')) {
              $('brand-logo-preview').src = defaultLogo;
              $('brand-logo-preview').style.display = 'block';
            }
            btnRemoveLogo.style.display = 'none';
            if (btnPickLogo) btnPickLogo.textContent = '📁 Unggah Logo';
            if ($('set-profile-logo')) $('set-profile-logo').value = defaultLogo;
            if ($('set-profile-logo-preview')) $('set-profile-logo-preview').src = defaultLogo;
            if ($('btn-set-profile-logo-remove')) $('btn-set-profile-logo-remove').style.display = 'none';
            if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = defaultLogo;
            updateLiveMockupPreview(nameInput.value, defaultLogo, colorPicker.value);
            loadBrandSettings();
            if (typeof window.loadSettingsProfile === 'function') {
              window.loadSettingsProfile();
            }
          } else {
            showToast('❌ Gagal menghapus logo.');
          }
        } catch (err) {
          showToast('❌ Kesalahan jaringan.');
        }
      });
    }

    var btnUseBangjo = $('btn-use-bangjo-logo');
    if (btnUseBangjo) {
      btnUseBangjo.addEventListener('click', function () {
        var defaultLogo = '/assets/pwa/icon-192.png';
        if (logoInput) logoInput.value = defaultLogo;
        if ($('brand-logo-preview')) {
          $('brand-logo-preview').src = defaultLogo;
          $('brand-logo-preview').style.display = 'block';
        }
        if ($('brand-logo-empty')) $('brand-logo-empty').style.display = 'none';
        if (btnRemoveLogo) btnRemoveLogo.style.display = 'none';
        if (btnPickLogo) btnPickLogo.textContent = '📁 Unggah Logo';

        if ($('set-profile-logo')) $('set-profile-logo').value = defaultLogo;
        if ($('set-profile-logo-preview')) {
          $('set-profile-logo-preview').src = defaultLogo;
          $('set-profile-logo-preview').style.display = 'block';
        }
        if ($('btn-set-profile-logo-remove')) $('btn-set-profile-logo-remove').style.display = 'none';
        if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = defaultLogo;

        if (nameInput && logoInput && colorPicker) {
          updateLiveMockupPreview(nameInput.value, defaultLogo, colorPicker.value);
        }
      });
    }

    var formBrand = $('form-brand-settings');
    if (formBrand) {
      formBrand.addEventListener('submit', async function (e) {
        e.preventDefault();
        var btn = $('btn-save-brand');
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Menyimpan...';
        }

      var rawColor = ($('brand-color-hex') && $('brand-color-hex').value.trim()) || ($('brand-color') && $('brand-color').value) || '#b6ff00';
      if (!rawColor.startsWith('#')) rawColor = '#' + rawColor;
      if (/^#[0-9a-fA-F]{3}$/.test(rawColor)) {
        rawColor = '#' + rawColor[1] + rawColor[1] + rawColor[2] + rawColor[2] + rawColor[3] + rawColor[3];
      }
      if (!/^#[0-9a-fA-F]{6}$/.test(rawColor)) {
        showToast('❌ Format warna HEX tidak valid. Gunakan format #RRGGBB (contoh: #FF5500).');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Simpan Pengaturan Brand';
        }
        return;
      }
      rawColor = rawColor.toUpperCase();

      var payload = {
        name: $('brand-name').value,
        tagline: $('brand-tagline').value,
        logo_url: $('brand-logo').value,
        primary_color: rawColor,
        custom_domain: $('brand-domain').value
      };

      try {
        var res = await adminFetch(API_BASE + '/admin/brand', {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (data.success) {
          showToast('✅ Brand dan tema berhasil disimpan!');
          applyBrandToUI(data.brand);
          if (typeof window.loadSettingsProfile === 'function') {
            window.loadSettingsProfile();
          }
        } else {
          showToast('❌ Gagal menyimpan: ' + data.error);
        }
      } catch (err) {
        showToast('❌ Terjadi kesalahan jaringan.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Simpan Pengaturan Brand';
      }
      });
    }

    // Form Add Banner Carousel (File Upload flow)
    var _bannerUploadFile = null;
    var _bannerCropSpec = null;
    var btnBannerPick = $('btn-banner-pick');
    var fileInputBanner = $('input-banner-file');
    var btnBannerClear = $('btn-banner-clear');
    var bannerPreviewImg = $('banner-upload-preview');
    var bannerEmptyBox = $('banner-upload-empty');

    if (btnBannerPick && fileInputBanner) {
      btnBannerPick.addEventListener('click', function () {
        fileInputBanner.click();
      });

      fileInputBanner.addEventListener('change', function () {
        var file = fileInputBanner.files && fileInputBanner.files[0];
        if (!file) {
          _bannerUploadFile = null;
          _bannerCropSpec = null;
          return;
        }

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format file banner tidak didukung. Gunakan JPG, PNG, atau WebP.');
          fileInputBanner.value = '';
          return;
        }

        if (file.size > 20 * 1024 * 1024) {
          showToast('❌ Ukuran file banner melebihi batas 20 MB.');
          fileInputBanner.value = '';
          return;
        }

        _bannerUploadFile = file;

        // Open reusable Crop Editor (M2) configured for Banner (~1.94:1)
        XentraCropEditor.open({
          source: file,
          assetType: 'banner',
          aspectRatio: 350 / 180,
          title: 'Sesuaikan Posisi Banner (~1.94:1)',
          onConfirm: function (cropSpec, previewDataUrl) {
            _bannerCropSpec = cropSpec;
            if (bannerPreviewImg) {
              bannerPreviewImg.src = previewDataUrl || URL.createObjectURL(file);
              bannerPreviewImg.style.display = 'block';
            }
            if (bannerEmptyBox) bannerEmptyBox.style.display = 'none';
            if (btnBannerClear) btnBannerClear.style.display = 'inline-block';
            if (btnBannerPick) btnBannerPick.textContent = '📁 Ganti File';
            showToast('✓ Potongan banner disesuaikan.');
          },
          onCancel: function () {
            var reader = new FileReader();
            reader.onload = function (ev) {
              if (bannerPreviewImg) {
                bannerPreviewImg.src = ev.target.result;
                bannerPreviewImg.style.display = 'block';
              }
              if (bannerEmptyBox) bannerEmptyBox.style.display = 'none';
              if (btnBannerClear) btnBannerClear.style.display = 'inline-block';
              if (btnBannerPick) btnBannerPick.textContent = '📁 Ganti File';
            };
            reader.readAsDataURL(file);
          }
        });
      });
    }

    if (btnBannerClear) {
      btnBannerClear.addEventListener('click', function () {
        _bannerUploadFile = null;
        _bannerCropSpec = null;
        if (fileInputBanner) fileInputBanner.value = '';
        if (bannerPreviewImg) {
          bannerPreviewImg.src = '';
          bannerPreviewImg.style.display = 'none';
        }
        if (bannerEmptyBox) bannerEmptyBox.style.display = 'flex';
        btnBannerClear.style.display = 'none';
        if (btnBannerPick) btnBannerPick.textContent = '📁 Pilih File Banner';
      });
    }

    var formAddBanner = $('form-add-banner');
    if (formAddBanner) {
      formAddBanner.addEventListener('submit', async function (e) {
        e.preventDefault();
        var titleInput = $('input-banner-title');
        var title = titleInput.value.trim();

        if (!_bannerUploadFile) {
          showToast('❌ Silakan pilih file gambar banner terlebih dahulu.');
          return;
        }

        var submitBtn = $('btn-submit-banner');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Mengunggah...'; }

        try {
          var base64 = await new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.onerror = function () { reject(new Error('Gagal membaca file gambar banner.')); };
            reader.readAsDataURL(_bannerUploadFile);
          });

          var bannerPayload = {
            image_base64: base64,
            mime_type: _bannerUploadFile.type,
            title: title
          };
          if (_bannerCropSpec) {
            bannerPayload.crop_spec = _bannerCropSpec;
          }

          var res = await adminFetch(API_BASE + '/admin/banners', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(bannerPayload)
          });
          var data = await res.json();
          if (res.ok && data.success) {
            showToast('✅ Banner carousel berhasil ditambahkan!');
            titleInput.value = '';
            if (btnBannerClear) btnBannerClear.click();
            renderBannersList(data.banners);
          } else {
            showToast('❌ ' + (data.error || 'Gagal menambahkan banner.'));
          }
        } catch (err) {
          showToast('❌ Terjadi kesalahan jaringan saat menambah banner.');
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '＋ Tambah Banner'; }
        }
      });
    }
  }

  function renderBannersList(banners) {
    var container = $('dash-banners-list');
    if (!container) return;
    banners = banners || state.brand?.banners || [];
    if (!Array.isArray(banners)) banners = [];

    if (banners.length === 0) {
      container.innerHTML = '<div style="grid-column:1/-1; color:#94a3b8; font-size:13px; text-align:center; padding:20px 0;">Belum ada banner promo. Tambahkan di atas (Maks. 5 slide).</div>';
      return;
    }

    container.innerHTML = banners.map(function (b, idx) {
      return [
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 2px 6px rgba(0,0,0,0.04);">',
          '<div style="width:100%; aspect-ratio:350/180; background:#e2e8f0; overflow:hidden;">',
            '<img src="' + esc(b.image_url) + '" alt="' + esc(b.title || 'Banner') + '" style="width:100%; height:100%; object-fit:cover; display:block;">',
          '</div>',
          '<div style="padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:8px;">',
            '<div style="min-width:0;">',
              '<strong style="font-size:12px; color:#1e293b; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Slide ' + (idx + 1) + ': ' + esc(b.title || 'Promo Banner') + '</strong>',
            '</div>',
            '<div class="x-item-actions">',
              '<button type="button" class="x-action-menu-trigger" aria-label="Aksi banner ' + esc(b.title || ('Slide ' + (idx + 1))) + '" onclick="XentraActionMenu.open(this, [' +
                '{ label: \'Hapus Banner\', icon: \'🗑️\', destructive: true, onClick: function() { deleteBannerSlide(\'' + esc(b.id) + '\'); } }' +
              '])">',
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
              '</button>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  window.deleteBannerSlide = async function (id) {
    if (!confirm('Hapus slide banner ini?')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/banners/' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Banner berhasil dihapus.');
        renderBannersList(data.banners);
      } else {
        showToast('❌ ' + data.error);
      }
    } catch (err) {
      showToast('❌ Gagal menghapus banner.');
    }
  };

  /* =========================================================================
     PHASE 1: CATALOG CONTROLLERS (PRODUCTS, CATEGORIES, MENUS)
     ========================================================================= */

  // State extensions for Phase 1
  var _catalogState = {
    searchQuery: '',
    categoryFilter: 'all',
    activeDetailProductId: null
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 1. MASTER PRODUCTS CONTROLLER
  // ─────────────────────────────────────────────────────────────────────────

  function showProductListSection() {
    var listView = $('product-list-view');
    var detailView = $('product-detail-view');
    if (listView) listView.style.display = 'block';
    if (detailView) detailView.style.display = 'none';
  }

  function showProductDetailSection() {
    var listView = $('product-list-view');
    var detailView = $('product-detail-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';
  }

  async function loadMasterProducts() {
    try {
      var authHeaders = getAuthHeaders();
      var [catRes, prodRes] = await Promise.all([
        adminFetch(API_BASE + '/admin/categories', { headers: authHeaders }),
        adminFetch(API_BASE + '/admin/products', { headers: authHeaders })
      ]);

      var catData = await catRes.json();
      var prodData = await prodRes.json();

      if (catData.success) state.categories = catData.categories || [];
      if (prodData.success) state.products = prodData.products || [];

      renderProductCategoryFilterChips();
      populateProductCategorySelect();
      renderMasterProductsTable();
    } catch (err) {
      console.error('[Master Products Load Error]:', err);
    }
  }

  // Alias for backward compatibility
  var loadCatalog = loadMasterProducts;

  function renderProductCategoryFilterChips() {
    var container = $('catalog-products-category-chips');
    if (!container) return;

    var html = '<button type="button" class="x-cat-filter-btn ' + (_catalogState.categoryFilter === 'all' ? 'active' : '') + '" data-cat="all">Semua Kategori (' + state.products.length + ')</button>';

    state.categories.forEach(function (cat) {
      var count = state.products.filter(function (p) { return String(p.category_id) === String(cat.id); }).length;
      var active = String(_catalogState.categoryFilter) === String(cat.id) ? 'active' : '';
      html += '<button type="button" class="x-cat-filter-btn ' + active + '" data-cat="' + cat.id + '">' + esc(cat.name) + ' (' + count + ')</button>';
    });

    container.innerHTML = html;

    container.querySelectorAll('.x-cat-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _catalogState.categoryFilter = btn.dataset.cat;
        var select = $('prod-filter-category');
        if (select) select.value = _catalogState.categoryFilter;
        renderProductCategoryFilterChips();
        renderMasterProductsTable();
      });
    });
  }

  function populateProductCategorySelect() {
    var select = $('prod-filter-category');
    if (select) {
      var opts = '<option value="all">Semua Kategori</option>';
      state.categories.forEach(function (cat) {
        opts += '<option value="' + cat.id + '">' + esc(cat.name) + '</option>';
      });
      select.innerHTML = opts;
      select.value = _catalogState.categoryFilter;
    }

    var formSelect = $('prod-category');
    if (formSelect) {
      formSelect.innerHTML = state.categories.map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
      }).join('');
    }
  }

  function getFilteredMasterProducts() {
    return state.products.filter(function (p) {
      var matchesSearch = true;
      if (_catalogState.searchQuery) {
        var q = _catalogState.searchQuery.toLowerCase();
        var nameMatch = (p.name || '').toLowerCase().indexOf(q) !== -1;
        var descMatch = (p.description || '').toLowerCase().indexOf(q) !== -1;
        matchesSearch = nameMatch || descMatch;
      }

      var matchesCat = true;
      if (_catalogState.categoryFilter !== 'all') {
        matchesCat = String(p.category_id) === String(_catalogState.categoryFilter);
      }

      return matchesSearch && matchesCat;
    });
  }

  function renderMasterProductsTable() {
    var tbody = $('master-products-table-body');
    if (!tbody) return;

    var filtered = getFilteredMasterProducts();

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Belum ada produk yang cocok dengan pencarian / filter.</td></tr>';
      return;
    }

    var rows = filtered.map(function (prod) {
      var cat = state.categories.find(function (c) { return String(c.id) === String(prod.category_id); });
      var catName = cat ? cat.name : 'Umum';
      var img = prod.image || prod.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isActive = prod.is_active !== 0;
      var isRange = prod.pricing_mode === 'range';
      var modeBadge = isRange
        ? '<span class="x-badge x-badge-range">Range (' + formatMoney(prod.min_price || prod.price) + ' - ' + formatMoney(prod.max_price || prod.price) + ')</span>'
        : '<span class="x-badge x-badge-lock">Lock</span>';

      var toggleSwitch = '' +
        '<label class="x-toggle' + (isActive ? ' x-toggle-on' : '') + '" title="' + (isActive ? 'Produk aktif' : 'Produk nonaktif') + '">' +
          '<input type="checkbox" ' + (isActive ? 'checked' : '') + ' onchange="toggleStock(\'' + prod.id + '\')" aria-label="Status aktif produk ' + esc(prod.name) + '">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      return [
        '<tr>',
          '<td><img src="' + esc(img) + '" alt="" class="x-table-thumb"></td>',
          '<td>',
            '<a href="#catalog/products/' + prod.id + '" style="font-weight:700;color:var(--text-main);text-decoration:none;display:inline-block;" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + esc(prod.name) + '</a>',
            '<p class="text-muted" style="font-size:12px;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:2px 0 0;">' + esc(prod.description || '') + '</p>',
          '</td>',
          '<td><span class="x-badge x-badge-info">' + esc(catName) + '</span></td>',
          '<td><strong>' + formatMoney(prod.price) + '</strong>' + (prod.regular_price > prod.price ? ' <del class="text-muted" style="font-size:11px;">' + formatMoney(prod.regular_price) + '</del>' : '') + '</td>',
          '<td>' + modeBadge + '</td>',
          '<td>' + toggleSwitch + '</td>',
          '<td class="text-right" style="white-space:nowrap;">',
            '<div class="x-item-actions">',
              '<button type="button" class="x-action-menu-trigger" aria-label="Aksi produk ' + esc(prod.name) + '" onclick="XentraActionMenu.open(this, [' +
                '{ label: \'Lihat Detail\', icon: \'🔍\', onClick: function() { navigateTo(\'catalog/products/' + prod.id + '\'); } },' +
                '{ label: \'Edit Produk\', icon: \'✏️\', onClick: function() { openEditProduct(\'' + prod.id + '\'); } },' +
                '{ divider: true },' +
                '{ label: \'Hapus Produk\', icon: \'🗑️\', destructive: true, onClick: function() { deleteProduct(\'' + prod.id + '\'); } }' +
              '])">',
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
              '</button>',
            '</div>',
          '</td>',
        '</tr>'
      ].join('');
    });

    tbody.innerHTML = rows.join('');

    // Also populate legacy products-table-body if present in DOM
    var legacyBody = $('products-table-body');
    if (legacyBody) {
      legacyBody.innerHTML = rows.join('');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRODUCT DETAIL VIEW (Showing Branch Adoption Status)
  // ─────────────────────────────────────────────────────────────────────────

  async function loadProductDetailView(productId) {
    _catalogState.activeDetailProductId = productId;
    var tbody = $('prod-detail-branches-tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4">Memuat status cabang...</td></tr>';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/products/' + productId, { headers: getAuthHeaders() });
      var data = await res.json();
      if (!data.success || !data.product) {
        showToast('❌ ' + (data.error || 'Produk tidak ditemukan.'));
        navigateTo('catalog/products');
        return;
      }

      var prod = data.product;
      var branchAdoptions = data.branch_adoptions || [];

      // Update Header & Breadcrumb
      if ($('prod-detail-breadcrumb')) $('prod-detail-breadcrumb').textContent = prod.name;
      if ($('prod-detail-name')) $('prod-detail-name').textContent = prod.name;
      if ($('prod-detail-desc')) $('prod-detail-desc').textContent = prod.description || 'Tidak ada deskripsi.';
      if ($('prod-detail-price')) $('prod-detail-price').textContent = formatMoney(prod.price);

      var img = prod.image || prod.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      if ($('prod-detail-img')) $('prod-detail-img').src = img;

      // Category badge
      var cat = state.categories.find(function (c) { return String(c.id) === String(prod.category_id); });
      if ($('prod-detail-category-badge')) {
        $('prod-detail-category-badge').textContent = cat ? cat.name : 'Umum';
      }

      // Pricing mode badge
      var modeBadge = $('prod-detail-pricing-mode-badge');
      if (modeBadge) {
        var isRange = prod.pricing_mode === 'range';
        modeBadge.className = 'x-badge ' + (isRange ? 'x-badge-range' : 'x-badge-lock');
        modeBadge.textContent = isRange ? 'Mode: Range' : 'Mode: Fixed (Lock)';
      }

      var rangeBox = $('prod-detail-range-box');
      if (rangeBox) {
        if (prod.pricing_mode === 'range') {
          rangeBox.style.display = 'block';
          if ($('prod-detail-range')) {
            $('prod-detail-range').textContent = formatMoney(prod.min_price || prod.price) + ' - ' + formatMoney(prod.max_price || prod.price);
          }
        } else {
          rangeBox.style.display = 'none';
        }
      }

      // Status badge
      var statusBadge = $('prod-detail-status-badge');
      if (statusBadge) {
        var isActive = prod.is_active !== 0;
        statusBadge.className = 'x-badge ' + (isActive ? 'x-badge-success' : 'x-badge-warning');
        statusBadge.textContent = isActive ? 'Master: Aktif' : 'Master: Nonaktif';
      }

      // Edit button handler
      var editBtn = $('btn-edit-from-detail');
      if (editBtn) {
        editBtn.onclick = function () { openEditProduct(prod.id); };
      }

      // Render branch adoptions table
      renderProductDetailBranchesTable(branchAdoptions, prod);
    } catch (err) {
      console.error('[Product Detail Error]:', err);
      showToast('❌ Kesalahan jaringan saat memuat detail produk.');
    }
  }

  function renderProductDetailBranchesTable(adoptions, prod) {
    var tbody = $('prod-detail-branches-tbody');
    if (!tbody) return;

    if (!adoptions || !adoptions.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">Belum ada cabang terdaftar pada brand ini.</td></tr>';
      return;
    }

    var rows = adoptions.map(function (b) {
      var isAdopted = b.is_adopted === 1 || b.is_adopted === true;
      var isAvailable = b.branch_is_available === 1 || b.branch_is_available === true;
      var adoptedBadge = isAdopted
        ? '<span class="x-badge x-badge-success">Diadopsi</span>'
        : '<span class="x-badge" style="background:#f1f5f9;color:#64748b;">Belum Diadopsi</span>';

      var priceDisplay = isAdopted ? formatMoney(b.branch_price != null ? b.branch_price : prod.price) : '—';
      var stockDisplay = isAdopted ? (b.branch_stock != null ? b.branch_stock : '100') : '—';
      var availDisplay = isAdopted
        ? (isAvailable ? '<span class="x-badge x-badge-success">● Tersedia</span>' : '<span class="x-badge x-badge-warning">○ Habis</span>')
        : '—';

      var actionBtn = isAdopted
        ? '<button type="button" class="x-btn-secondary" style="font-size:12px;padding:4px 8px;" onclick="openBranchMenuFromDetail(\'' + b.branch_id + '\')">Lihat Menu Cabang</button>'
        : '<button type="button" class="x-btn-primary" style="font-size:12px;padding:4px 8px;" onclick="adoptProductDirectly(\'' + b.branch_id + '\', \'' + prod.id + '\')">+ Adopsi ke Cabang</button>';

      return [
        '<tr>',
          '<td><strong>' + esc(b.branch_name) + '</strong><br><small class="text-muted">' + esc(b.branch_address || '') + '</small></td>',
          '<td>' + adoptedBadge + '</td>',
          '<td>' + priceDisplay + '</td>',
          '<td>' + stockDisplay + '</td>',
          '<td>' + availDisplay + '</td>',
          '<td class="text-right">' + actionBtn + '</td>',
        '</tr>'
      ].join('');
    });

    tbody.innerHTML = rows.join('');
  }

  window.openBranchMenuFromDetail = function (branchId) {
    var sel = $('dash-branch-context');
    if (sel) {
      sel.value = branchId;
      _branchContextState.selected = branchId;
    }
    navigateTo('catalog/menus');
  };

  window.adoptProductDirectly = async function (branchId, prodId) {
    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + branchId + '/adopt', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ product_id: prodId })
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Produk berhasil diadopsi ke cabang!');
        if (_catalogState.activeDetailProductId) {
          loadProductDetailView(_catalogState.activeDetailProductId);
        }
      } else {
        showToast('❌ ' + (data.message || data.error || 'Gagal mengadopsi produk.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 2. MASTER CATEGORIES CONTROLLER
  // ─────────────────────────────────────────────────────────────────────────

  async function loadMasterCategories() {
    var tbody = $('master-categories-table-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6">Memuat daftar kategori...</td></tr>';
    }

    try {
      var authHeaders = getAuthHeaders();
      var [catRes, prodRes] = await Promise.all([
        adminFetch(API_BASE + '/admin/categories', { headers: authHeaders }),
        adminFetch(API_BASE + '/admin/products', { headers: authHeaders })
      ]);

      var catData = await catRes.json();
      var prodData = await prodRes.json();

      if (catData.success) state.categories = catData.categories || [];
      if (prodData.success) state.products = prodData.products || [];

      renderMasterCategoriesTable();
    } catch (err) {
      console.error('[Master Categories Load Error]:', err);
      showToast('❌ Gagal memuat daftar kategori.');
    }
  }

  function renderMasterCategoriesTable() {
    var tbody = $('master-categories-table-body');
    if (!tbody) return;

    if (!state.categories.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-muted">Belum ada kategori master. Klik "+ Tambah Kategori Master" untuk membuat.</td></tr>';
      return;
    }

    var rows = state.categories.map(function (cat) {
      var productCount = state.products.filter(function (p) {
        return String(p.category_id) === String(cat.id);
      }).length;

      return [
        '<tr>',
          '<td><strong>' + esc(cat.name) + '</strong></td>',
          '<td><code style="font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px;">' + esc(cat.slug || '-') + '</code></td>',
          '<td><span class="x-badge x-badge-info">' + productCount + ' Produk</span></td>',
          '<td class="text-right" style="white-space:nowrap;">',
            '<div class="x-item-actions">',
              '<button type="button" class="x-action-menu-trigger" aria-label="Aksi kategori ' + esc(cat.name) + '" onclick="XentraActionMenu.open(this, [' +
                '{ label: \'Edit Kategori\', icon: \'✏️\', onClick: function() { openEditMasterCategory(\'' + cat.id + '\'); } },' +
                '{ divider: true },' +
                '{ label: \'Hapus Kategori\', icon: \'🗑️\', destructive: true, onClick: function() { deleteMasterCategory(\'' + cat.id + '\', \'' + esc(cat.name) + '\', ' + productCount + '); } }' +
              '])">',
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
              '</button>',
            '</div>',
          '</td>',
        '</tr>'
      ].join('');
    });

    tbody.innerHTML = rows.join('');
  }

  window.openAddMasterCategory = function () {
    $('modal-master-category-title').textContent = 'Tambah Kategori Master';
    $('master-cat-id').value = '';
    $('master-cat-name').value = '';
    $('modal-master-category').style.display = 'flex';
  };

  window.openEditMasterCategory = function (id) {
    var cat = state.categories.find(function (c) { return String(c.id) === String(id); });
    if (!cat) return;

    $('modal-master-category-title').textContent = 'Edit Kategori Master';
    $('master-cat-id').value = cat.id;
    $('master-cat-name').value = cat.name;
    $('modal-master-category').style.display = 'flex';
  };

  window.closeMasterCategoryModal = function () {
    $('modal-master-category').style.display = 'none';
  };

  window.deleteMasterCategory = async function (id, name, productCount) {
    if (productCount > 0) {
      alert('Kategori "' + name + '" tidak dapat dihapus karena masih digunakan oleh ' + productCount + ' produk. Pindahkan atau hapus produk terlebih dahulu.');
      return;
    }

    if (!confirm('Apakah Anda yakin ingin menghapus kategori master "' + name + '"?')) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/categories/' + id, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Kategori master berhasil dihapus.');
        loadMasterCategories();
      } else {
        showToast('❌ ' + (data.error || 'Gagal menghapus kategori.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 3. MENUS CONTROLLER (Branch Selling Assortment)
  // ─────────────────────────────────────────────────────────────────────────

  async function loadMenusView() {
    var selectedBranchId = _branchContextState.selected;

    var allView = $('menus-all-branches-view');
    var singleView = $('menus-single-branch-view');
    var headerActions = $('menus-header-actions');
    var badge = $('menus-context-badge');
    var subtitle = $('menus-context-subtitle');

    if (selectedBranchId === 'all' || !selectedBranchId) {
      // Show All Branches Overview View
      if (allView) allView.style.display = 'block';
      if (singleView) singleView.style.display = 'none';
      if (headerActions) headerActions.style.display = 'none';
      if (badge) {
        badge.textContent = 'All Branches';
        badge.className = 'x-badge x-badge-info';
      }
      if (subtitle) {
        subtitle.textContent = 'Pilih cabang pada Branch Context selector untuk mengelola menu jual spesifik per cabang.';
      }

      await loadMenusAllBranchesTable();
    } else {
      // Show Single Branch Menu View
      if (allView) allView.style.display = 'none';
      if (singleView) singleView.style.display = 'block';
      if (headerActions) headerActions.style.display = 'flex';

      var b = state.branches.find(function (x) { return String(x.id) === String(selectedBranchId); });
      var branchName = b ? b.name : selectedBranchId;
      if (badge) {
        badge.textContent = 'Cabang: ' + branchName;
        badge.className = 'x-badge x-badge-success';
      }
      if (subtitle) {
        subtitle.textContent = 'Mengatur menu jual, harga override, dan kategori cabang untuk ' + branchName;
      }

      currentManagingBranchId = selectedBranchId;
      await loadSingleBranchMenuView(selectedBranchId);
    }
  }

  async function loadMenusAllBranchesTable() {
    var tbody = $('menus-branches-table-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6">Memuat daftar cabang...</td></tr>';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/branches', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data.success && data.branches) {
        state.branches = data.branches;
        populateBranchSelector(data.branches);
      }

      var branches = state.branches || [];
      if (!branches.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Belum ada cabang terdaftar. Buat cabang di menu Branches terlebih dahulu.</td></tr>';
        return;
      }

      // Fetch adoption summary for each branch
      var summaries = await Promise.all(branches.map(async function (b) {
        try {
          var cRes = await adminFetch(API_BASE + '/admin/branches/' + b.id + '/catalog', { headers: getAuthHeaders() });
          var cData = await cRes.json();
          return {
            branch: b,
            adoptedCount: (cData.adopted_products || []).length,
            categoryCount: (cData.categories || []).length
          };
        } catch (_) {
          return { branch: b, adoptedCount: 0, categoryCount: 0 };
        }
      }));

      var rows = summaries.map(function (s) {
        var b = s.branch;
        var isOpen = b.is_open_override === 1 || b.is_open_override === true;
        var statusBadge = isOpen
          ? '<span class="x-badge x-badge-success">● Buka</span>'
          : '<span class="x-badge x-badge-warning">○ Tutup</span>';

        return [
          '<tr>',
            '<td><strong>' + esc(b.name) + '</strong></td>',
            '<td><small class="text-muted">' + esc(b.address_text || '-') + '</small></td>',
            '<td>' + statusBadge + '</td>',
            '<td><span class="x-badge x-badge-info">' + s.adoptedCount + ' Menu Aktif</span></td>',
            '<td><span class="x-badge">' + s.categoryCount + ' Kategori</span></td>',
            '<td class="text-right">',
              '<button type="button" class="x-btn-primary" style="padding:6px 12px;font-size:12px;" onclick="switchToBranchMenu(\'' + b.id + '\')">Kelola Menu Cabang ➔</button>',
            '</td>',
          '</tr>'
        ].join('');
      });

      tbody.innerHTML = rows.join('');
    } catch (err) {
      console.error('[Menus All Branches Load Error]:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Gagal memuat daftar cabang.</td></tr>';
    }
  }

  window.switchToBranchMenu = function (branchId) {
    var sel = $('dash-branch-context');
    if (sel) {
      sel.value = branchId;
      _branchContextState.selected = branchId;
    }
    loadMenusView();
  };

  async function loadSingleBranchMenuView(branchId) {
    currentManagingBranchId = branchId;

    var adoptedEl = $('menus-branch-adopted-container');
    var availableEl = $('menus-branch-available-container');
    var catsEl = $('menus-branch-categories-bar');
    if (adoptedEl) adoptedEl.innerHTML = '<p class="text-muted" style="font-size:13px;">Memuat menu aktif cabang...</p>';
    if (availableEl) availableEl.innerHTML = '<p class="text-muted" style="font-size:13px;">Memuat rekomendasi Owner...</p>';
    if (catsEl) catsEl.innerHTML = '<span class="text-muted" style="font-size:13px;">Memuat kategori...</span>';

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + branchId + '/catalog', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!data.success) {
        showToast('❌ ' + (data.error || 'Gagal memuat katalog menu cabang.'));
        return;
      }

      currentBranchCatalogData = data;

      var categories = data.categories || [];
      var adopted = data.adopted_products || [];
      var available = data.available_master_products || [];

      if ($('menus-branch-cat-count')) $('menus-branch-cat-count').textContent = categories.length;
      if ($('menus-branch-active-count')) $('menus-branch-active-count').textContent = adopted.length;
      if ($('menus-branch-available-count')) $('menus-branch-available-count').textContent = available.length;

      renderMenusBranchCategoriesBar(categories);
      renderMenusBranchAdoptedProducts(adopted, branchCatalogFilter);
      renderMenusBranchAvailableProducts(available);
    } catch (err) {
      console.error('[Single Branch Menu Load Error]:', err);
      showToast('❌ Kesalahan jaringan saat memuat menu cabang.');
    }
  }

  function renderMenusBranchCategoriesBar(categories) {
    var bar = $('menus-branch-categories-bar');
    if (!bar) return;

    bar.innerHTML = '';

    // "Semua" filter button
    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'x-cat-filter-btn' + (branchCatalogFilter === 'all' ? ' active' : '');
    allBtn.style.borderRadius = '20px';
    allBtn.textContent = 'Semua';
    allBtn.addEventListener('click', function () {
      branchCatalogFilter = 'all';
      if ($('menus-branch-filter-label')) $('menus-branch-filter-label').textContent = 'Menampilkan semua kategori';
      renderMenusBranchCategoriesBar(categories);
      renderMenusBranchAdoptedProducts(currentBranchCatalogData.adopted_products || [], 'all');
    });
    bar.appendChild(allBtn);

    if (!categories.length) {
      var hint = document.createElement('span');
      hint.className = 'text-muted';
      hint.style.fontSize = '12px';
      hint.textContent = 'Belum ada kategori cabang. Klik "+ Tambah Kategori Cabang" untuk membuat.';
      bar.appendChild(hint);
      return;
    }

    categories.forEach(function (cat) {
      var isActive = branchCatalogFilter === cat.id;

      var chip = document.createElement('span');
      chip.dataset.catId = cat.id;
      chip.style.cssText = [
        'display:inline-flex;align-items:center;gap:0;border-radius:20px;overflow:hidden;',
        'border:1px solid ' + (isActive ? 'var(--x-primary,#10b981)' : '#e2e8f0') + ';',
        'background:' + (isActive ? '#f0fdf4' : '#f8fafc') + ';',
        'transition:box-shadow 0.15s,opacity 0.15s;'
      ].join('');

      // Category name filter button
      var nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.style.cssText = 'border:none;background:none;padding:6px 10px 6px 12px;font-size:13px;font-weight:' + (isActive ? '700' : '500') + ';cursor:pointer;color:#1e293b;';
      nameBtn.textContent = cat.name;
      nameBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        branchCatalogFilter = cat.id;
        if ($('menus-branch-filter-label')) $('menus-branch-filter-label').textContent = 'Filter: ' + cat.name;
        renderMenusBranchCategoriesBar(categories);
        renderMenusBranchAdoptedProducts(currentBranchCatalogData.adopted_products || [], cat.id);
      });
      chip.appendChild(nameBtn);

      // Edit category button
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.title = 'Ubah nama & gambar kategori';
      editBtn.style.cssText = 'border:none;background:none;padding:5px 6px;font-size:12px;cursor:pointer;color:#64748b;';
      editBtn.textContent = '✏️';
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openBranchCategoryEditModal(cat);
      });
      chip.appendChild(editBtn);

      // Delete category button
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.title = 'Hapus kategori';
      delBtn.style.cssText = 'border:none;background:none;padding:6px 10px 6px 4px;font-size:12px;cursor:pointer;color:#ef4444;opacity:0.8;';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteBranchCategory(cat.id, cat.name);
      });
      chip.appendChild(delBtn);

      bar.appendChild(chip);
    });
  }

  function renderMenusBranchAdoptedProducts(adopted, filterCatId) {
    var container = $('menus-branch-adopted-container');
    if (!container) return;

    var filtered = adopted;
    if (filterCatId && filterCatId !== 'all') {
      filtered = adopted.filter(function (p) {
        if (p.category_ids && Array.isArray(p.category_ids)) {
          return p.category_ids.map(String).indexOf(String(filterCatId)) !== -1;
        }
        return String(p.branch_category_id) === String(filterCatId);
      });
    }

    if (!filtered.length) {
      var msg = filterCatId && filterCatId !== 'all'
        ? 'Belum ada menu di kategori ini. Adopsi produk dari Master dan pilih kategori ini.'
        : 'Belum ada menu yang diadopsi oleh cabang ini. Pilih dari daftar rekomendasi Master di bawah!';
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">' + msg + '</div>';
      return;
    }

    container.innerHTML = filtered.map(function (p) {
      var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isAvailable = p.is_available === 1 || p.is_available === true;
      var catName = (p.category_names && p.category_names.length)
        ? p.category_names.join(', ')
        : (p.branch_category_name || 'Tanpa Kategori');
      var modeBadge = p.pricing_mode === 'range'
        ? '<span class="x-badge x-badge-range">Range (' + formatMoney(p.min_price) + ' - ' + formatMoney(p.max_price) + ')</span>'
        : '<span class="x-badge x-badge-lock">Harga Terkunci</span>';

      var nameSrc = p.name_override ? '<span class="x-badge" style="background:#fef9c3;color:#854d0e;font-size:9px;">OVERRIDE</span>' : '<span class="x-badge" style="background:#f0fdf4;color:#166534;font-size:9px;">DEFAULT</span>';
      var descSrc = p.description_override ? '<span class="x-badge" style="background:#fef9c3;color:#854d0e;font-size:9px;">OVERRIDE</span>' : '<span class="x-badge" style="background:#f0fdf4;color:#166534;font-size:9px;">DEFAULT</span>';

      var productDataJson = esc(JSON.stringify({
        product_id: p.product_id,
        name: p.name, name_override: p.name_override, master_name: p.master_name,
        description: p.description, description_override: p.description_override, master_description: p.master_description,
        image_url: p.image_url, image_override: p.image_override, master_image_url: p.master_image_url,
        price: p.price, master_price: p.master_price, pricing_mode: p.pricing_mode,
        min_price: p.min_price, max_price: p.max_price,
        branch_category_id: p.branch_category_id,
        category_ids: p.category_ids || (p.branch_category_id ? [p.branch_category_id] : []),
        categories: p.categories || []
      }));

      var availabilityToggle = '' +
        '<label class="x-toggle' + (isAvailable ? ' x-toggle-on' : '') + '" title="' + (isAvailable ? 'Menu tersedia' : 'Menu habis') + '">' +
          '<input type="checkbox" ' + (isAvailable ? 'checked' : '') + ' onchange="toggleBranchProductAvailability(\'' + p.product_id + '\', this.checked ? 1 : 0)" aria-label="Ubah ketersediaan menu cabang">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      return [
        '<div class="x-product-card-simple">',
          '<img src="' + esc(img) + '" class="x-product-card-thumb" alt="' + esc(p.name) + '">',
          '<div class="x-product-card-content">',
            '<h5>' + esc(p.name) + '</h5>',
            '<div style="display:flex;gap:4px;flex-wrap:wrap;margin:4px 0;">',
              '<span class="x-badge x-badge-info" style="font-size:10px;">' + esc(catName) + '</span>',
              modeBadge,
            '</div>',
            '<div class="x-product-card-price">Jual: ' + formatMoney(p.price) + ' <small class="text-muted" style="font-weight:normal;">(Owner: ' + formatMoney(p.master_price) + ')</small></div>',
            '<div style="font-size:11px;color:#64748b;margin:4px 0;display:flex;gap:8px;flex-wrap:wrap;">',
              '<span>Nama: ' + nameSrc + '</span>',
              '<span>Deskripsi: ' + descSrc + '</span>',
            '</div>',
            '<div class="x-product-card-actions">',
              '<div>' + availabilityToggle + '</div>',
              '<div class="x-item-actions">',
                '<button type="button" class="x-action-menu-trigger" aria-label="Aksi menu cabang ' + esc(p.name) + '" onclick="XentraActionMenu.open(this, [' +
                  '{ label: \'Edit Menu Cabang\', icon: \'✏️\', onClick: function() { openBranchOverrideModal(\'' + productDataJson + '\'); } },' +
                  '{ divider: true },' +
                  '{ label: \'Hapus dari Cabang\', icon: \'🗑️\', destructive: true, onClick: function() { removeBranchProduct(\'' + p.product_id + '\', \'' + esc(p.name) + '\'); } }' +
                '])">',
                  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
                '</button>',
              '</div>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function renderMenusBranchAvailableProducts(available) {
    var container = $('menus-branch-available-container');
    if (!container) return;

    if (!available.length) {
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">Semua produk dari katalog Master telah diadopsi oleh cabang ini.</div>';
      return;
    }

    container.innerHTML = available.map(function (p) {
      var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isRange = p.pricing_mode === 'range';
      var modeBadge = isRange
        ? '<span class="x-badge x-badge-range">Range (' + formatMoney(p.min_price) + ' - ' + formatMoney(p.max_price) + ')</span>'
        : '<span class="x-badge x-badge-lock">Harga Terkunci</span>';

      return [
        '<div class="x-product-card-simple" style="background:#f8fafc;">',
          '<img src="' + img + '" class="x-product-card-thumb" alt="' + esc(p.name) + '">',
          '<div class="x-product-card-content">',
            '<h5>' + esc(p.name) + '</h5>',
            '<div style="margin:4px 0;">' + modeBadge + '</div>',
            '<div class="x-product-card-price">Harga Dasar Master: ' + formatMoney(p.price) + '</div>',
            '<div class="x-product-card-actions">',
              '<button type="button" class="x-btn-primary" style="padding:6px 12px;font-size:12px;" onclick="openAdoptModal(\'' + p.id + '\')">＋ Adopsi ke Cabang</button>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRODUCT MODAL & IMAGE PICKER LOGIC
  // ─────────────────────────────────────────────────────────────────────────

  // File object staged for menu photo upload on save (null when none chosen).
  var _productImageFile = null;
  var _productCropSpec = null;

  function setProductImagePreview(src, hasImage) {
    var previewImg = $('prod-image-preview');
    var emptyBox = $('prod-image-empty');
    var btnRemove = $('btn-prod-image-remove');
    var btnPick = $('btn-prod-image-pick');
    if (!previewImg || !emptyBox) return;
    if (hasImage && src) {
      previewImg.src = src;
      previewImg.style.display = 'block';
      emptyBox.style.display = 'none';
      if (btnRemove) btnRemove.style.display = 'inline-block';
      if (btnPick) btnPick.textContent = '📁 Ganti Foto';
    } else {
      previewImg.removeAttribute('src');
      previewImg.style.display = 'none';
      emptyBox.style.display = 'flex';
      if (btnRemove) btnRemove.style.display = 'none';
      if (btnPick) btnPick.textContent = '📁 Pilih Foto';
    }
  }

  // Product Actions
  window.openAddProduct = function () {
    $('modal-product-title').textContent = 'Tambah Produk Master Baru';
    $('prod-id').value = '';
    $('prod-name').value = '';
    $('prod-price').value = '';
    $('prod-regular-price').value = '';
    $('prod-pricing-mode').value = 'lock';
    $('prod-min-price').value = '';
    $('prod-max-price').value = '';
    toggleRangeFields();
    $('prod-desc').value = '';
    _productImageFile = null;
    var fileInput = $('prod-image-file');
    if (fileInput) fileInput.value = '';
    setProductImagePreview('', false);
    populateProductCategorySelect();
    $('modal-product').style.display = 'flex';
  };

  window.openEditProduct = function (id) {
    var prod = state.products.find(function (p) { return String(p.id) === String(id); });
    if (!prod) return;

    $('modal-product-title').textContent = 'Edit Produk: ' + prod.name;
    $('prod-id').value = prod.id;
    $('prod-name').value = prod.name;
    populateProductCategorySelect();
    $('prod-category').value = prod.category_id;
    $('prod-price').value = prod.price;
    $('prod-regular-price').value = prod.regular_price || prod.price;
    $('prod-pricing-mode').value = prod.pricing_mode || 'lock';
    $('prod-min-price').value = prod.min_price || '';
    $('prod-max-price').value = prod.max_price || '';
    toggleRangeFields();
    $('prod-desc').value = prod.description || '';
    _productImageFile = null;
    var fileInput = $('prod-image-file');
    if (fileInput) fileInput.value = '';
    var existingImage = prod.image || prod.image_url || '';
    setProductImagePreview(existingImage, existingImage !== '');
    $('modal-product').style.display = 'flex';
  };

  window.closeProductModal = function () {
    $('modal-product').style.display = 'none';
    _productImageFile = null;
  };

  function toggleRangeFields() {
    var ppm = $('prod-pricing-mode');
    var prf = $('prod-range-fields');
    if (!ppm || !prf) return;
    var isRange = ppm.value === 'range';
    prf.style.display = isRange ? 'flex' : 'none';
  }

  window.toggleStock = async function (id) {
    try {
      var res = await adminFetch(API_BASE + '/admin/products/' + id + '/toggle', {
        method: 'PATCH',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Status ketersediaan menu diperbarui.');
        loadMasterProducts();
        if (_catalogState.activeDetailProductId) {
          loadProductDetailView(_catalogState.activeDetailProductId);
        }
      }
    } catch (e) {
      showToast('Gagal mengubah status stok.');
    }
  };

  window.deleteProduct = async function (id) {
    if (!confirm('Apakah Anda yakin ingin menghapus produk master ini?')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/products/' + id, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Produk master berhasil dihapus.');
        if (_catalogState.activeDetailProductId === id) {
          navigateTo('catalog/products');
        } else {
          loadMasterProducts();
        }
      }
    } catch (e) {
      showToast('Gagal menghapus produk.');
    }
  };

  function initCatalogListeners() {
    var prodPricingMode = $('prod-pricing-mode');
    if (prodPricingMode) {
      prodPricingMode.addEventListener('change', toggleRangeFields);
    }

    // Master Products Add buttons
    var btnAddProd = $('btn-add-product');
    if (btnAddProd) btnAddProd.addEventListener('click', window.openAddProduct);
    var btnAddProdMain = $('btn-add-product-main');
    if (btnAddProdMain) btnAddProdMain.addEventListener('click', window.openAddProduct);

    // Search and filter controls for Master Products
    var searchInput = $('prod-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        _catalogState.searchQuery = searchInput.value.trim();
        renderMasterProductsTable();
      });
    }

    var catFilterSelect = $('prod-filter-category');
    if (catFilterSelect) {
      catFilterSelect.addEventListener('change', function () {
        _catalogState.categoryFilter = catFilterSelect.value;
        renderProductCategoryFilterChips();
        renderMasterProductsTable();
      });
    }

    // Back to products from detail view
    var btnBack = $('btn-back-to-products');
    if (btnBack) {
      btnBack.addEventListener('click', function () {
        navigateTo('catalog/products');
      });
    }

    // Master Categories buttons
    var btnAddMasterCat = $('btn-add-master-category');
    if (btnAddMasterCat) btnAddMasterCat.addEventListener('click', window.openAddMasterCategory);

    var formMasterCat = $('form-master-category');
    if (formMasterCat) {
      formMasterCat.addEventListener('submit', async function (e) {
        e.preventDefault();
        var catId = $('master-cat-id').value;
        var name = $('master-cat-name').value.trim();
        if (!name) return;

        var url = catId ? (API_BASE + '/admin/categories/' + catId) : (API_BASE + '/admin/categories');
        var method = catId ? 'PUT' : 'POST';

        try {
          var res = await adminFetch(url, {
            method: method,
            headers: getAuthHeaders(),
            body: JSON.stringify({ name: name })
          });
          var data = await res.json();
          if (data.success) {
            showToast('✅ Kategori master berhasil disimpan!');
            window.closeMasterCategoryModal();
            loadMasterCategories();
          } else {
            showToast('❌ ' + (data.error || 'Gagal menyimpan kategori master.'));
          }
        } catch (err) {
          showToast('❌ Kesalahan jaringan.');
        }
      });
    }

    // Menus View Buttons
    var btnSwitchAll = $('btn-menus-switch-all');
    if (btnSwitchAll) {
      btnSwitchAll.addEventListener('click', function () {
        var sel = $('dash-branch-context');
        if (sel) {
          sel.value = 'all';
          _branchContextState.selected = 'all';
        }
        loadMenusView();
      });
    }

    var btnMenusAddBranchCat = $('btn-menus-add-branch-category');
    if (btnMenusAddBranchCat) {
      btnMenusAddBranchCat.addEventListener('click', async function () {
        if (!currentManagingBranchId) {
          showToast('❌ Pilih cabang terlebih dahulu.');
          return;
        }
        var name = prompt('Nama Kategori Baru untuk Cabang ini:');
        if (!name || !name.trim()) return;

        try {
          var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/categories', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ name: name.trim() })
          });
          var data = await res.json();
          if (data.success) {
            showToast('✅ Kategori cabang berhasil dibuat!');
            loadMenusView();
          } else {
            showToast('❌ ' + (data.error || 'Gagal membuat kategori.'));
          }
        } catch (err) {
          showToast('❌ Kesalahan jaringan.');
        }
      });
    }

    // Master Product Image Picker
    var btnPick = $('btn-prod-image-pick');
    var prodFileInput = $('prod-image-file');
    var btnRemoveProd = $('btn-prod-image-remove');
    if (btnPick && prodFileInput) {
      btnPick.addEventListener('click', function () { prodFileInput.click(); });
      prodFileInput.addEventListener('change', function () {
        var file = prodFileInput.files && prodFileInput.files[0];
        if (!file) { _productImageFile = null; _productCropSpec = null; return; }

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.');
          prodFileInput.value = '';
          return;
        }
        if (file.size > 20 * 1024 * 1024) {
          showToast('❌ Ukuran gambar melebihi batas maksimal 20MB.');
          prodFileInput.value = '';
          return;
        }

        _productImageFile = file;

        // Open reusable Crop Editor (M2)
        XentraCropEditor.open({
          source: file,
          assetType: 'product',
          aspectRatio: 1.0,
          title: 'Potong & Posisikan Foto Menu (1:1)',
          onConfirm: function (cropSpec, previewDataUrl) {
            _productCropSpec = cropSpec;
            setProductImagePreview(previewDataUrl || URL.createObjectURL(file), true);
            showToast('✓ Potongan foto menu disesuaikan.');
          },
          onCancel: function () {
            // Keep original uncropped preview if user cancels editor
            var reader = new FileReader();
            reader.onload = function (e) {
              setProductImagePreview(e.target.result, true);
            };
            reader.readAsDataURL(file);
          }
        });
      });
    }

    if (btnRemoveProd) {
      btnRemoveProd.addEventListener('click', function () {
        _productImageFile = null;
        _productCropSpec = null;
        if (prodFileInput) prodFileInput.value = '';
        setProductImagePreview('', false);
      });
    }

    // Form Master Product Submit
    var formProduct = $('form-product');
    if (formProduct) {
      formProduct.addEventListener('submit', async function (e) {
        e.preventDefault();
        var id = $('prod-id').value;
        var pricingMode = $('prod-pricing-mode').value;
        var payload = {
          name: $('prod-name').value,
          category_id: $('prod-category').value,
          price: Number($('prod-price').value),
          regular_price: Number($('prod-regular-price').value || $('prod-price').value),
          pricing_mode: pricingMode,
          min_price: pricingMode === 'range' ? Number($('prod-min-price').value || $('prod-price').value) : null,
          max_price: pricingMode === 'range' ? Number($('prod-max-price').value || $('prod-price').value) : null,
          description: $('prod-desc').value
        };

        var url = id ? (API_BASE + '/admin/products/' + id) : (API_BASE + '/admin/products');
        var method = id ? 'PUT' : 'POST';

        try {
          var res = await adminFetch(url, {
            method: method,
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
          });
          var data = await res.json();
          if (!data.success) {
            showToast('❌ ' + (data.error || data.message || 'Gagal menyimpan menu.'));
            return;
          }

          var savedId = (data.product && data.product.id) || id;
          if (_productImageFile && savedId) {
            var base64 = await new Promise(function (resolve, reject) {
              var imgReader = new FileReader();
              imgReader.onload = function () { resolve(imgReader.result); };
              imgReader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
              imgReader.readAsDataURL(_productImageFile);
            });

            var imagePayload = { image_base64: base64, mime_type: _productImageFile.type };
            if (_productCropSpec) {
              imagePayload.crop_spec = _productCropSpec;
            }

            var imageRes = await adminFetch(API_BASE + '/admin/products/' + savedId + '/image', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify(imagePayload)
            });
            var imageData = {};
            try {
              imageData = await imageRes.json();
            } catch (_) {
              var rawBody = '';
              try { rawBody = await imageRes.text(); } catch (_) {}
              var detail = rawBody.length > 160 ? (rawBody.slice(0, 160) + '…') : rawBody;
              imageData = { success: false, error: 'Upload foto gagal (HTTP ' + imageRes.status + '). ' + (detail ? detail + ' ' : '') };
            }
            if (!imageRes.ok || !imageData.success) {
              showToast('❌ ' + (imageData.error || imageData.message || 'Gagal mengunggah foto menu.'));
              return;
            }
          }

          showToast('✅ Produk master berhasil disimpan!');
          window.closeProductModal();
          loadMasterProducts();
          if (_catalogState.activeDetailProductId) {
            loadProductDetailView(_catalogState.activeDetailProductId);
          }
        } catch (err) {
          showToast('Gagal menyimpan menu.');
        }
      });
    }
  }

  /* =========================================================================
     MODUL 3: CABANG & PENGATURAN ONGKIR CONTROLLER
     ========================================================================= */
  /* =========================================================================
     MODUL 3: CABANG & PENGATURAN ONGKIR CONTROLLER
     ========================================================================= */
  async function loadBranches() {
    try {
      var res = await adminFetch(API_BASE + '/admin/branches', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data.success && data.branches) {
        state.branches = data.branches;
        renderBranchesGrid();
      }
    } catch (e) {
      console.warn('[Branches Load Warn]:', e);
    }
  }

  function renderBranchesGrid() {
    var container = $('branches-list-container');
    if (!container) return;

    var q = (_branchSearchQuery || '').toLowerCase();
    var statusFilter = _branchStatusFilter || 'all';

    var filtered = state.branches.filter(function (b) {
      if (q) {
        var nameMatch = (b.name || '').toLowerCase().indexOf(q) !== -1;
        var addrMatch = (b.address_text || '').toLowerCase().indexOf(q) !== -1;
        if (!nameMatch && !addrMatch) return false;
      }
      if (statusFilter === 'active') {
        if (b.is_active !== 1 && b.is_active !== true) return false;
      } else if (statusFilter === 'inactive') {
        if (b.is_active === 1 || b.is_active === true) return false;
      } else if (statusFilter === 'open') {
        var isOpen = b.is_open_override === 1 || b.is_open_override === true || b.is_open_override == null;
        if (!isOpen) return false;
      } else if (statusFilter === 'closed') {
        var isOpen2 = b.is_open_override === 1 || b.is_open_override === true || b.is_open_override == null;
        if (isOpen2) return false;
      }
      return true;
    });

    if (!filtered.length) {
      container.innerHTML = '<div class="text-muted text-center py-6">Tidak ada cabang yang cocok dengan pencarian / filter.</div>';
      return;
    }

    var html = filtered.map(function (b) {
      var isGloballyActive = b.is_active === 1 || b.is_active === true;
      var isOpen = b.is_open_override === 1 || b.is_open_override === true || b.is_open_override == null;

      var openBadge = isOpen
        ? '<span class="x-badge x-badge-info" style="font-size:11px;">Buka Operasional</span>'
        : '<span class="x-badge x-badge-warning" style="font-size:11px;">Tutup Operasional</span>';

      var toggleSwitch = '' +
        '<label class="x-toggle' + (isGloballyActive ? ' x-toggle-on' : '') + '">' +
          '<input type="checkbox" ' + (isGloballyActive ? 'checked' : '') + ' onchange="toggleBranchActivation(\'' + b.id + '\', this.checked)" aria-label="Aktifkan atau nonaktifkan cabang">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      return [
        '<div class="x-branch-card' + (isGloballyActive ? '' : ' style="opacity:0.85;background:#f8fafc;"') + '">',
          '<div class="x-branch-card-header">',
            '<div>',
              '<h4 style="display:inline-block;margin-right:8px;"><a href="#branches/' + b.id + '" style="color:var(--text-main);text-decoration:none;" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + esc(b.name) + '</a></h4>',
              openBadge,
            '</div>',
            '<div>' + toggleSwitch + '</div>',
          '</div>',
          '<p class="text-muted" style="font-size:13px;">📍 ' + esc(b.address_text || '') + '</p>',
          '<div class="x-branch-detail-row"><span>📱 WhatsApp Cabang:</span><span style="font-weight:600;color:var(--x-primary);">' + (b.phone || b.whatsapp_number || '<span style="color:#ef4444;">(Wajib diisi)</span>') + '</span></div>',
          '<div class="x-branch-detail-row"><span>Koordinat GPS:</span><span>' + (b.latitude || 0) + ', ' + (b.longitude || 0) + '</span></div>',
          '<div class="x-branch-detail-row"><span>Gratis Ongkir:</span><span style="color:#10b981;">' + (b.free_delivery_km || 0) + ' KM Pertama Gratis</span></div>',
          '<div class="x-branch-detail-row"><span>Tarif per KM:</span><span>' + formatMoney(b.price_per_km || 3000) + ' / km</span></div>',
          '<div class="x-branch-detail-row"><span>Radius Maksimal:</span><span>' + (b.max_radius_km || 12) + ' KM</span></div>',
          '<div class="x-branch-detail-row"><span>Promo Diskon Ongkir:</span><span>Diskon ' + formatMoney(b.promo_delivery_discount || 10000) + ' (Min. ' + formatMoney(b.promo_min_order || 50000) + ')</span></div>',
          '<div class="x-branch-actions-row">',
            '<div class="x-branch-primary-actions">',
              '<button type="button" class="x-btn-secondary" style="font-size:12px;font-weight:700;color:#0284c7;" onclick="navigateTo(\'branches/' + b.id + '\')">Detail Cabang ➔</button>',
            '</div>',
            '<div class="x-item-actions">',
              '<button type="button" class="x-action-menu-trigger" aria-label="Aksi cabang ' + esc(b.name) + '" onclick="XentraActionMenu.open(this, [' +
                '{ label: \'Detail Cabang\', icon: \'🏢\', onClick: function() { navigateTo(\'branches/' + b.id + '\'); } },' +
                '{ label: \'Edit Profil Cabang\', icon: \'✏️\', onClick: function() { openBranchModal(\'' + b.id + '\'); } },' +
                '{ label: \'Kelola Menu Cabang\', icon: \'📋\', onClick: function() { openBranchCatalogModal(\'' + b.id + '\'); } },' +
                '{ divider: true },' +
                '{ label: \'' + (isGloballyActive ? 'Hapus Cabang' : 'Arsipkan / Hapus Cabang') + '\', icon: \'🗑️\', destructive: true, onClick: function() { deleteBranch(\'' + b.id + '\'); } }' +
              '])">',
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
              '</button>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    });

    container.innerHTML = html.join('');
  }

  /* =========================================================================
     BRANCH SEARCH & FILTER STATE
     ========================================================================= */
  var _branchSearchQuery = '';
  var _branchStatusFilter = 'all';

  function initBranchSearchAndFilter() {
    var searchInput = $('branch-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        _branchSearchQuery = searchInput.value.trim();
        renderBranchesGrid();
      });
    }

    var filterSelect = $('branch-filter-status');
    if (filterSelect) {
      filterSelect.addEventListener('change', function () {
        _branchStatusFilter = filterSelect.value;
        renderBranchesGrid();
      });
    }
  }

  /* =========================================================================
     BRANCH DETAIL VIEW CONTROLLER (Overview, Operations, Menu, Team, Reports)
     ========================================================================= */
  var _activeBranchDetailId = null;
  var _activeBranchDetailSubtab = 'overview';
  var _activeBranchDetailData = null;

  function showBranchListView() {
    var listView = $('branch-list-view');
    var detailView = $('branch-detail-view');
    if (listView) listView.style.display = 'block';
    if (detailView) detailView.style.display = 'none';
  }

  function showBranchDetailView() {
    var listView = $('branch-list-view');
    var detailView = $('branch-detail-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';
  }

  window.switchBranchDetailSubtab = function (subtab) {
    _activeBranchDetailSubtab = subtab || 'overview';

    // Update subnav buttons
    var subnav = $('branch-detail-subnav');
    if (subnav) {
      subnav.querySelectorAll('.x-cat-filter-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.subtab === _activeBranchDetailSubtab);
      });
    }

    // Toggle subtab panels
    document.querySelectorAll('.branch-subtab-content').forEach(function (p) {
      p.style.display = p.id === 'branch-subtab-' + _activeBranchDetailSubtab ? 'block' : 'none';
    });

    if (_activeBranchDetailId) {
      var targetHash = _activeBranchDetailSubtab === 'overview'
        ? ('branches/' + _activeBranchDetailId)
        : ('branches/' + _activeBranchDetailId + '/' + _activeBranchDetailSubtab);
      if (window.location.hash !== '#' + targetHash) {
        window.location.hash = targetHash;
      }
    }
  };

  async function loadBranchDetail(branchId, subtab) {
    _activeBranchDetailId = branchId;
    _activeBranchDetailSubtab = subtab || 'overview';
    showBranchDetailView();
    window.switchBranchDetailSubtab(_activeBranchDetailSubtab);

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!data.success || !data.branch) {
        showToast('❌ ' + (data.error || 'Cabang tidak ditemukan.'));
        navigateTo('branches');
        return;
      }

      var b = data.branch;
      _activeBranchDetailData = b;

      // Update header
      if ($('branch-detail-breadcrumb')) $('branch-detail-breadcrumb').textContent = b.name;
      if ($('branch-detail-title')) $('branch-detail-title').textContent = b.name;
      if ($('branch-detail-address')) $('branch-detail-address').textContent = '📍 ' + (b.address_text || '-');

      var isGloballyActive = b.is_active === 1 || b.is_active === true;
      var isOpen = b.is_open_override === 1 || b.is_open_override === true || b.is_open_override == null;

      var activeBadge = $('branch-detail-active-badge');
      if (activeBadge) {
        activeBadge.className = 'x-badge ' + (isGloballyActive ? 'x-badge-success' : 'x-badge-warning');
        activeBadge.textContent = isGloballyActive ? 'Aktif di Sistem' : 'Nonaktif';
      }

      var openBadge = $('branch-detail-open-badge');
      if (openBadge) {
        openBadge.className = 'x-badge ' + (isOpen ? 'x-badge-info' : 'x-badge-warning');
        openBadge.textContent = isOpen ? 'Buka Operasional' : 'Tutup Operasional';
      }

      var editBtn = $('btn-edit-branch-detail');
      if (editBtn) {
        editBtn.onclick = function () { openBranchModal(b.id); };
      }

      // Overview Tab Values
      if ($('branch-overview-op-status')) {
        $('branch-overview-op-status').innerHTML = isOpen
          ? '<span style="color:#0284c7;">● Buka</span>'
          : '<span style="color:#eab308;">○ Tutup</span>';
      }
      if ($('branch-overview-op-sub')) {
        $('branch-overview-op-sub').textContent = isGloballyActive ? 'Cabang aktif menerima pesanan' : 'Cabang dinonaktifkan secara global';
      }
      if ($('branch-overview-menu-count')) $('branch-overview-menu-count').textContent = (b.adopted_products_count || 0) + ' Menu';
      if ($('branch-overview-cat-count')) $('branch-overview-cat-count').textContent = (b.branch_categories_count || 0) + ' Kategori Cabang';
      if ($('branch-overview-staff-count')) $('branch-overview-staff-count').textContent = (b.staff_count || 0) + ' Anggota';
      if ($('branch-overview-orders-count')) $('branch-overview-orders-count').textContent = (b.total_orders || 0) + ' Order';
      if ($('branch-overview-active-orders')) $('branch-overview-active-orders').textContent = (b.active_orders || 0) + ' order aktif';

      if ($('branch-overview-id')) $('branch-overview-id').textContent = b.id;
      if ($('branch-overview-wa')) $('branch-overview-wa').textContent = b.phone || b.whatsapp_number || '-';
      if ($('branch-overview-coords')) $('branch-overview-coords').textContent = (b.latitude || 0) + ', ' + (b.longitude || 0);

      var deliv = b.is_delivery_active !== 0;
      var pick = b.is_pickup_active !== 0;
      var fulfillText = [];
      if (deliv) fulfillText.push('Delivery');
      if (pick) fulfillText.push('Pickup');
      if ($('branch-overview-fulfillment')) $('branch-overview-fulfillment').textContent = fulfillText.join(' & ') || 'None';
      if ($('branch-overview-radius')) $('branch-overview-radius').textContent = (b.max_radius_km || 10) + ' KM';
      if ($('branch-overview-rate')) $('branch-overview-rate').textContent = formatMoney(b.price_per_km || 3000) + ' / km';

      // Operations Tab form
      if ($('op-is-active')) $('op-is-active').checked = isGloballyActive;
      if ($('op-is-open-override')) $('op-is-open-override').checked = isOpen;
      if ($('op-is-delivery')) $('op-is-delivery').checked = deliv;
      if ($('op-is-pickup')) $('op-is-pickup').checked = pick;

      // Menu Tab Jump button
      var jumpBtn = $('btn-jump-to-menus');
      if (jumpBtn) {
        jumpBtn.onclick = function () {
          var sel = $('dash-branch-context');
          if (sel) {
            sel.value = b.id;
            _branchContextState.selected = b.id;
          }
          navigateTo('catalog/menus');
        };
      }

      // Load sub-content
      loadBranchMenuPreview(b.id);
      loadBranchTeamPreview(b.id);
    } catch (err) {
      console.error('[Load Branch Detail Error]:', err);
      showToast('❌ Gagal memuat detail cabang.');
    }
  }

  async function loadBranchMenuPreview(branchId) {
    var tbody = $('branch-menu-preview-tbody');
    if (!tbody) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/catalog', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      var adopted = (data && data.adopted_products) || [];
      if (!adopted.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Belum ada menu yang diadopsi oleh cabang ini.</td></tr>';
        return;
      }
      tbody.innerHTML = adopted.map(function (p) {
        var isAvail = p.is_available === 1 || p.is_available === true;
        var availBadge = isAvail
          ? '<span class="x-badge x-badge-success">● Tersedia</span>'
          : '<span class="x-badge x-badge-warning">○ Habis</span>';
        var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=60';
        return [
          '<tr>',
            '<td><div style="display:flex;align-items:center;gap:10px;"><img src="' + esc(img) + '" class="x-table-thumb"><div><strong>' + esc(p.name) + '</strong>' + (p.name !== p.master_name ? '<br><small class="text-muted">Master: ' + esc(p.master_name) + '</small>' : '') + '</div></div></td>',
            '<td><span class="x-badge x-badge-info">' + esc(p.category_name || 'Umum') + '</span></td>',
            '<td><strong>' + formatMoney(p.price) + '</strong></td>',
            '<td>' + (p.stock != null ? p.stock : '100') + '</td>',
            '<td>' + availBadge + '</td>',
          '</tr>'
        ].join('');
      }).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Menu cabang belum dapat dimuat.</td></tr>';
    }
  }

  async function loadBranchTeamPreview(branchId) {
    var tbody = $('branch-team-preview-tbody');
    if (!tbody) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/users?branch_id=' + encodeURIComponent(branchId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      var users = (data && data.users) || [];
      if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">Belum ada staf yang terdaftar di cabang ini.</td></tr>';
        return;
      }
      tbody.innerHTML = users.map(function (u) {
        var statusBadge = u.status === 'active'
          ? '<span class="x-badge x-badge-success">Aktif</span>'
          : '<span class="x-badge x-badge-warning">' + esc(u.status || '-') + '</span>';
        return [
          '<tr>',
            '<td><strong>' + esc(u.full_name || u.username) + '</strong></td>',
            '<td>' + esc(u.username) + '</td>',
            '<td><span class="x-badge x-badge-info">' + esc(u.role) + '</span></td>',
            '<td>' + statusBadge + '</td>',
          '</tr>'
        ].join('');
      }).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">Staf cabang belum dapat dimuat.</td></tr>';
    }
  }

  function initBranchOperationsForm() {
    var form = $('form-branch-operations');
    if (!form) return;
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!_activeBranchDetailId) return;

      var btn = $('btn-save-branch-operations');
      if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

      var payload = {
        is_active: $('op-is-active').checked ? 1 : 0,
        is_open_override: $('op-is-open-override').checked ? 1 : 0,
        is_delivery_active: $('op-is-delivery').checked ? 1 : 0,
        is_pickup_active: $('op-is-pickup').checked ? 1 : 0
      };

      try {
        var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(_activeBranchDetailId), {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (res.ok && data.success) {
          showToast('✅ Pengaturan operasional cabang berhasil disimpan.');
          loadBranchDetail(_activeBranchDetailId, 'operations');
          loadBranches();
        } else {
          showToast('❌ ' + ((data && (data.error || data.message)) || 'Gagal menyimpan operasional cabang.'));
        }
      } catch (err) {
        showToast('❌ Kesalahan jaringan.');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Simpan Perubahan Operasional'; }
      }
    });
  }

  /* =========================================================================
     MODUL 3.1: BRANCH CATALOG MANAGER (ADOPTION & LOCAL PRICING)
     ========================================================================= */
  var currentManagingBranchId = null;
  var currentBranchCatalogData = null;

  window.openBranchCatalogModal = async function (branchId) {
    currentManagingBranchId = branchId;
    var modal = $('modal-branch-catalog');
    if (!modal) return;
    modal.style.display = 'flex';

    var title = $('modal-branch-catalog-title');
    var b = state.branches.find(function (x) { return x.id === branchId; });
    if (title && b) title.textContent = 'Kelola Katalog Cabang: ' + b.name;

    await reloadBranchCatalogView();
  };

  window.closeBranchCatalogModal = function () {
    var modal = $('modal-branch-catalog');
    if (modal) modal.style.display = 'none';
    currentManagingBranchId = null;
  };

  async function reloadBranchCatalogView() {
    if (!currentManagingBranchId) return;

    var adoptedContainer = $('branch-adopted-products-container');
    var availableContainer = $('branch-available-products-container');
    if (adoptedContainer) adoptedContainer.innerHTML = '<p class="text-muted" style="font-size:13px;">Memuat menu aktif cabang...</p>';
    if (availableContainer) availableContainer.innerHTML = '<p class="text-muted" style="font-size:13px;">Memuat produk rekomendasi Owner...</p>';

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/catalog', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!data.success) {
        showToast('❌ ' + (data.error || 'Gagal memuat katalog cabang.'));
        return;
      }

      currentBranchCatalogData = data;
      if ($('branch-active-count')) $('branch-active-count').textContent = (data.adopted_products || []).length;
      if ($('branch-available-count')) $('branch-available-count').textContent = (data.available_master_products || []).length;

      renderBranchAdoptedProducts(data.adopted_products || []);
      renderBranchAvailableMasterProducts(data.available_master_products || []);
    } catch (err) {
      console.error('[Branch Catalog Load Error]:', err);
      showToast('❌ Terjadi kesalahan jaringan saat memuat katalog cabang.');
    }
  }

  function renderBranchAdoptedProducts(adopted) {
    var container = $('branch-adopted-products-container');
    if (!container) return;

    if (!adopted.length) {
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">Belum ada menu yang diadopsi oleh cabang ini. Pilih produk dari daftar rekomendasi Owner di bawah!</div>';
      return;
    }

    container.innerHTML = adopted.map(function (p) {
      var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isAvailable = p.is_available === 1 || p.is_available === true;
      var catName = p.branch_category_name || 'Menu Utama';
      var modeBadge = p.pricing_mode === 'range'
        ? '<span class="x-badge x-badge-range">Range (' + formatMoney(p.min_price) + ' - ' + formatMoney(p.max_price) + ')</span>'
        : '<span class="x-badge x-badge-lock">Harga Terkunci</span>';

      // Override status badges — one per supported field
      var nameSrc     = p.name_override        ? '<span class="x-badge" style="background:#fef9c3;color:#854d0e;font-size:9px;">OVERRIDE</span>' : '<span class="x-badge" style="background:#f0fdf4;color:#166534;font-size:9px;">DEFAULT</span>';
      var descSrc     = p.description_override ? '<span class="x-badge" style="background:#fef9c3;color:#854d0e;font-size:9px;">OVERRIDE</span>' : '<span class="x-badge" style="background:#f0fdf4;color:#166534;font-size:9px;">DEFAULT</span>';
      var imgSrc      = p.image_override       ? '<span class="x-badge" style="background:#fef9c3;color:#854d0e;font-size:9px;">OVERRIDE</span>' : '<span class="x-badge" style="background:#f0fdf4;color:#166534;font-size:9px;">DEFAULT</span>';

      var productDataJson = esc(JSON.stringify({
        product_id: p.product_id,
        name: p.name, name_override: p.name_override, master_name: p.master_name,
        description: p.description, description_override: p.description_override, master_description: p.master_description,
        image_url: p.image_url, image_override: p.image_override, master_image_url: p.master_image_url,
        price: p.price, master_price: p.master_price, pricing_mode: p.pricing_mode,
        min_price: p.min_price, max_price: p.max_price,
        branch_category_id: p.branch_category_id,
        category_ids: p.category_ids || (p.branch_category_id ? [p.branch_category_id] : []),
        categories: p.categories || []
      }));

      var availabilityToggle = '' +
        '<label class="x-toggle' + (isAvailable ? ' x-toggle-on' : '') + '" title="' + (isAvailable ? 'Menu tersedia' : 'Menu habis') + '">' +
          '<input type="checkbox" ' + (isAvailable ? 'checked' : '') + ' onchange="toggleBranchProductAvailability(\'' + p.product_id + '\', this.checked ? 1 : 0)" aria-label="Ubah ketersediaan menu cabang">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      return [
        '<div class="x-product-card-simple">',
          '<img src="' + esc(img) + '" class="x-product-card-thumb" alt="' + esc(p.name) + '">',
          '<div class="x-product-card-content">',
            '<h5>' + esc(p.name) + '</h5>',
            '<div style="display:flex;gap:4px;flex-wrap:wrap;margin:4px 0;">',
              '<span class="x-badge x-badge-info" style="font-size:10px;">' + esc(catName) + '</span>',
              modeBadge,
            '</div>',
            '<div class="x-product-card-price">Jual: ' + formatMoney(p.price) + ' <small class="text-muted" style="font-weight:normal;">(Owner: ' + formatMoney(p.master_price) + ')</small></div>',
            '<div style="font-size:11px;color:#64748b;margin:4px 0;display:flex;gap:8px;flex-wrap:wrap;">',
              '<span>Nama: ' + nameSrc + '</span>',
              '<span>Deskripsi: ' + descSrc + '</span>',
              '<span>Gambar: ' + imgSrc + '</span>',
            '</div>',
            '<div class="x-product-card-actions">',
              '<div>' + availabilityToggle + '</div>',
              '<div class="x-item-actions">',
                '<button type="button" class="x-action-menu-trigger" aria-label="Aksi menu cabang ' + esc(p.name) + '" onclick="XentraActionMenu.open(this, [' +
                  '{ label: \'Edit Menu Cabang\', icon: \'✏️\', onClick: function() { openBranchOverrideModal(\'' + productDataJson + '\'); } },' +
                  '{ divider: true },' +
                  '{ label: \'Hapus dari Cabang\', icon: \'🗑️\', destructive: true, onClick: function() { removeBranchProduct(\'' + p.product_id + '\', \'' + esc(p.name) + '\'); } }' +
                '])">',
                  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
                '</button>',
              '</div>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function renderBranchAvailableMasterProducts(available) {
    var container = $('branch-available-products-container');
    if (!container) return;

    if (!available.length) {
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">Semua produk dari katalog Owner telah diadopsi oleh cabang ini.</div>';
      return;
    }

    container.innerHTML = available.map(function (p) {
      var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isRange = p.pricing_mode === 'range';
      var modeBadge = isRange
        ? '<span class="x-badge x-badge-range">Range (' + formatMoney(p.min_price) + ' - ' + formatMoney(p.max_price) + ')</span>'
        : '<span class="x-badge x-badge-lock">Harga Terkunci</span>';

      return [
        '<div class="x-product-card-simple" style="background:#f8fafc;">',
          '<img src="' + img + '" class="x-product-card-thumb" alt="' + esc(p.name) + '">',
          '<div class="x-product-card-content">',
            '<h5>' + esc(p.name) + '</h5>',
            '<div style="margin:4px 0;">' + modeBadge + '</div>',
            '<div class="x-product-card-price">Harga Dasar Owner: ' + formatMoney(p.price) + '</div>',
            '<div class="x-product-card-actions">',
              '<button type="button" class="x-btn-primary" style="padding:6px 12px;font-size:12px;" onclick="openAdoptModal(\'' + p.id + '\')">＋ Adopsi ke Cabang</button>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  window.toggleBranchProductAvailability = async function (productId, nextAvail) {
    if (!currentManagingBranchId) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/products/' + productId, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_available: nextAvail })
      });
      var data = await res.json();
      if (data.success) {
        showToast('Ketersediaan menu cabang diperbarui.');
        reloadBranchCatalogView();
      } else {
        showToast('❌ ' + (data.error || 'Gagal mengubah ketersediaan.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };

  window.removeBranchProduct = async function (productId, productName) {
    if (!currentManagingBranchId) return;
    if (!confirm('Hapus "' + productName + '" dari katalog cabang ini? Menu tidak akan lagi tampil di halaman pemesanan pelanggan cabang ini.')) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/products/' + productId, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Produk dihapus dari katalog cabang.');
        reloadBranchCatalogView();
      } else {
        showToast('❌ ' + (data.error || 'Gagal menghapus produk.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };

  /* =========================================================================
     MODUL 3.2: BRANCH PRODUCT OVERRIDE — name / description / image_url
     Master Product Default + Branch Optional Override
     ========================================================================= */
  var _overrideProductId = null;
  var _bpSelectedFile = null; // staged photo File to upload on save
  var _bpCropSpec = null;

  (function initBranchProductPhoto() {
    var fileInput = $('override-img-file');
    if (!fileInput) return;
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) { _bpSelectedFile = null; _bpCropSpec = null; return; }

      var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (allowed.indexOf(file.type) === -1) {
        showToast('❌ Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.');
        fileInput.value = '';
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        showToast('❌ Ukuran gambar melebihi batas maksimal 20MB.');
        fileInput.value = '';
        return;
      }

      _bpSelectedFile = file;

      XentraCropEditor.open({
        source: file,
        assetType: 'product',
        aspectRatio: 1.0,
        title: 'Potong & Posisikan Foto Cabang (1:1)',
        onConfirm: function (cropSpec, previewDataUrl) {
          _bpCropSpec = cropSpec;
          var previewImg = $('override-img-preview');
          var previewMono = $('override-img-preview-mono');
          if (previewImg) {
            previewImg.src = previewDataUrl || URL.createObjectURL(file);
            previewImg.style.display = 'block';
          }
          if (previewMono) previewMono.style.display = 'none';
          $('override-img-status').textContent = '🟡 OVERRIDE baru (potongan disesuaikan)';
          showToast('✓ Potongan foto menu cabang disesuaikan.');
        },
        onCancel: function () {
          var reader = new FileReader();
          reader.onload = function (e) {
            var previewImg = $('override-img-preview');
            var previewMono = $('override-img-preview-mono');
            if (!previewImg) return;
            previewImg.src = e.target.result;
            previewImg.style.display = 'block';
            if (previewMono) previewMono.style.display = 'none';
            $('override-img-status').textContent = '🟡 OVERRIDE baru (belum disimpan)';
          };
          reader.readAsDataURL(file);
        }
      });
    });
  })();

  window.openBranchOverrideModal = function (productDataRaw) {
    var p;
    try { p = JSON.parse(productDataRaw.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")); } catch (e) { showToast('❌ Gagal membuka override.'); return; }
    _overrideProductId = p.product_id;
    _bpSelectedFile = null;

    var modal = $('modal-branch-override');
    if (!modal) { showToast('❌ Modal override tidak ditemukan di HTML.'); return; }

    // Product heading
    $('override-product-heading').textContent = 'Edit Menu: ' + (p.master_name || p.name || p.product_id);

    // Name row
    $('override-name-input').value     = p.name_override != null ? p.name_override : '';
    $('override-name-master').textContent = p.master_name || '(tidak ada)';
    $('override-name-status').textContent  = p.name_override ? '🟡 OVERRIDE aktif' : '🟢 DEFAULT (ikut Master)';

    // Description row
    $('override-desc-input').value     = p.description_override != null ? p.description_override : '';
    $('override-desc-master').textContent = p.master_description || '(tidak ada)';
    $('override-desc-status').textContent  = p.description_override ? '🟡 OVERRIDE aktif' : '🟢 DEFAULT (ikut Master)';

    // Photo row — live override URL preview'd from the catalog payload
    var imgInput = $('override-img-file');
    if (imgInput) imgInput.value = '';
    var hasImg = p.image_url || p.image_override || p.master_image_url;
    var previewImg = $('override-img-preview');
    var previewMono = $('override-img-preview-mono');
    if (hasImg) {
      previewImg.src = p.image_url || p.master_image_url;
      previewImg.style.display = 'block';
      previewMono.style.display = 'none';
    } else {
      previewImg.style.display = 'none';
      previewMono.style.display = 'block';
      previewMono.textContent = (p.name || p.master_name || '?').trim().slice(0, 1).toUpperCase();
    }
    $('override-img-status').textContent = p.image_override ? '🟡 OVERRIDE aktif' : '🟢 DEFAULT (ikut Master)';

    // Price row — pricing policy drives editability (same UX as adopt modal)
    var isRange = String(p.pricing_mode).toLowerCase() === 'range';
    var priceInput = $('override-price-input');
    var priceHint = $('override-price-hint');
    if (isRange) {
      priceInput.readOnly = false;
      priceInput.value = p.price != null ? p.price : (p.master_price != null ? p.master_price : '');
      priceInput.min = p.min_price != null ? p.min_price : p.master_price;
      priceInput.max = p.max_price != null ? p.max_price : p.master_price;
      priceHint.innerHTML = '💡 <strong>Range Harga Fleksibel:</strong> Cabang diizinkan menentukan harga antara <strong>' + formatMoney(p.min_price) + '</strong> s/d <strong>' + formatMoney(p.max_price) + '</strong>.';
    } else {
      priceInput.readOnly = true;
      priceInput.value = p.price != null ? p.price : (p.master_price != null ? p.master_price : '');
      priceHint.innerHTML = '🔒 <strong>Harga Terkunci:</strong> Ditetapkan paten oleh Pemilik Resto (Owner) sebesar <strong>' + formatMoney(p.master_price) + '</strong>.';
    }

    // Category row — branch categories of the currently managed branch
    var cats = (currentBranchCatalogData && currentBranchCatalogData.categories) || (_bmMenuState && _bmMenuState.categories) || [];
    var catSelect = $('override-category-select');
    if (catSelect) {
      var catOptions = cats.map(function (c) {
        return '<option value="' + c.id + '"' + (String(p.branch_category_id) === String(c.id) ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      });
      catOptions.unshift('<option value="">Tanpa Kategori</option>');
      catSelect.innerHTML = catOptions.join('');
    }

    // M:N Category Checkbox List (Phase 3)
    var catListEl = $('override-categories-list');
    if (catListEl) {
      var activeCatIds = Array.isArray(p.category_ids) && p.category_ids.length > 0
        ? p.category_ids.map(String)
        : (p.branch_category_id ? [String(p.branch_category_id)] : []);
      if (!cats.length) {
        catListEl.innerHTML = '<span class="text-muted" style="font-size:12px; grid-column:1/-1; padding:12px 0;">Belum ada kategori cabang dibuat. Buat kategori terlebih dahulu di tab Kategori Cabang.</span>';
      } else {
        catListEl.innerHTML = cats.map(function (c) {
          var isChecked = activeCatIds.indexOf(String(c.id)) !== -1;
          return '<label class="x-category-chip-card' + (isChecked ? ' is-checked' : '') + '">' +
            '<input type="checkbox" class="override-cat-checkbox" value="' + esc(c.id) + '"' + (isChecked ? ' checked' : '') + ' onchange="this.closest(\'.x-category-chip-card\').classList.toggle(\'is-checked\', this.checked)" />' +
            '<span title="' + esc(c.name) + '">' + esc(c.name) + '</span>' +
          '</label>';
        }).join('');
      }
    }

    modal.style.display = 'flex';
  };

  window.closeBranchOverrideModal = function () {
    var modal = $('modal-branch-override');
    if (modal) modal.style.display = 'none';
    _overrideProductId = null;
    _bpSelectedFile = null;
  };

  window.saveBranchProductOverride = async function () {
    if (!currentManagingBranchId || !_overrideProductId) return;
    var btn = $('btn-save-override');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';

    // Empty string = user wants to clear the override (send null)
    var nameVal = $('override-name-input').value;
    var descVal = $('override-desc-input').value;

    var payload = {};
    payload.name        = nameVal.trim()  !== '' ? nameVal.trim()  : null;
    payload.description = descVal.trim()  !== '' ? descVal.trim()  : null;

    // price — lock mode is readonly (input disabled); range mode always sent so
    // the server re-validates against the locked PricingPolicyModel.
    var pricingMode = String($('override-price-input').readOnly ? 'lock' : 'range').toLowerCase();
    if (pricingMode === 'range') {
      payload.price = Number($('override-price-input').value);
    }

    // category — collect M:N checkboxes if present, otherwise fallback to select
    var catListEl = $('override-categories-list');
    if (catListEl && catListEl.querySelectorAll('.override-cat-checkbox').length > 0) {
      var checkedCbs = catListEl.querySelectorAll('.override-cat-checkbox:checked');
      var checkedIds = Array.from(checkedCbs).map(function (cb) { return cb.value; });
      payload.category_ids = checkedIds;
      payload.branch_category_id = checkedIds.length > 0 ? checkedIds[0] : null;
    } else {
      var catVal = $('override-category-select') ? $('override-category-select').value : '';
      payload.branch_category_id = catVal !== '' ? catVal : null;
      if (catVal !== '') payload.category_ids = [catVal];
    }

    try {
      // 1. Staged photo (if any) — upload first, server returns the override URL.
      if (_bpSelectedFile) {
        var base64 = await new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () { resolve(reader.result); };
          reader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
          reader.readAsDataURL(_bpSelectedFile);
        });

        var branchImgPayload = { image_base64: base64, mime_type: _bpSelectedFile.type };
        if (_bpCropSpec) {
          branchImgPayload.crop_spec = _bpCropSpec;
        }

        var imgRes = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/products/' + _overrideProductId + '/image', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(branchImgPayload)
        });
        var imgData = {};
        try {
          imgData = await imgRes.json();
        } catch (_) {
          imgData = { success: false, error: 'Respon server tidak valid saat mengunggah gambar.' };
        }
        if (!imgRes.ok || !imgData.success) {
          showToast('❌ ' + (imgData.error || imgData.message || 'Gagal mengunggah gambar.'));
          return;
        }
      }

      // 2. Text + price + category overrides
      var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/products/' + _overrideProductId + '/override', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Perubahan menu cabang berhasil disimpan!');
        window.closeBranchOverrideModal();
        if (isBranchManager()) {
          if (typeof loadBMMenu === 'function') loadBMMenu();
          if (typeof loadInlineBranchCatalog === 'function') loadInlineBranchCatalog();
        } else {
          reloadBranchCatalogView();
        }
      } else {
        showToast('❌ ' + (data.message || data.error || 'Gagal menyimpan perubahan.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan saat menyimpan perubahan.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Simpan';
    }
  };

  window.clearBranchProductOverride = async function () {
    if (!currentManagingBranchId || !_overrideProductId) return;
    if (!confirm('Kembalikan semua nilai ke Master? Nama, deskripsi, foto, harga, dan kategori dikembalikan ke pengaturan asal produk Master.')) return;
    var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/products/' + _overrideProductId + '/override', {
      method: 'PATCH', headers: getAuthHeaders(),
      body: JSON.stringify({ name: null, description: null, image_url: null, price: null, branch_category_id: null, category_ids: [] })
    });
    var data = await res.json();
    if (data.success) {
      showToast('✅ Semua nilai dikembalikan ke Master.');
      window.closeBranchOverrideModal();
      if (isBranchManager()) {
        if (typeof loadBMMenu === 'function') loadBMMenu();
        if (typeof loadInlineBranchCatalog === 'function') loadInlineBranchCatalog();
      } else {
        reloadBranchCatalogView();
      }
    } else {
      showToast('❌ ' + (data.error || 'Gagal menghapus override.'));
    }
  };

  window.promptAddBranchCategory = async function () {
    if (!currentManagingBranchId) return;
    var name = prompt('Nama Kategori Baru untuk Cabang ini:');
    if (!name || !name.trim()) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/categories', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: name.trim() })
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Kategori cabang berhasil dibuat!');
        reloadBranchCatalogView();
      } else {
        showToast('❌ ' + (data.error || 'Gagal membuat kategori cabang.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };

  // Adopt Product Modal Actions
  window.openAdoptModal = function (productId) {
    if (!currentBranchCatalogData) return;
    var p = currentBranchCatalogData.available_master_products.find(function (x) { return String(x.id) === String(productId); });
    if (!p) return;

    var resolvedBranchId = currentManagingBranchId ||
      (typeof getActiveBranchId === 'function' ? getActiveBranchId() : null) ||
      (typeof getEffectiveBranchId === 'function' ? getEffectiveBranchId() : null);
    if (resolvedBranchId) {
      currentManagingBranchId = resolvedBranchId;
    }

    $('adopt-product-id').value = p.id;
    $('adopt-product-name').value = p.name;
    $('adopt-pricing-mode').value = p.pricing_mode || 'lock';
    $('adopt-min-price').value = p.min_price || p.price;
    $('adopt-max-price').value = p.max_price || p.price;

    var isRange = p.pricing_mode === 'range';
    var priceInput = $('adopt-price');
    var priceHint = $('adopt-price-hint');

    if (isRange) {
      priceInput.readOnly = false;
      priceInput.value = p.price;
      priceInput.min = p.min_price;
      priceInput.max = p.max_price;
      priceHint.innerHTML = '💡 <strong>Range Harga Fleksibel:</strong> Cabang diizinkan menentukan harga antara <strong>' + formatMoney(p.min_price) + '</strong> s/d <strong>' + formatMoney(p.max_price) + '</strong>.';
    } else {
      priceInput.readOnly = true;
      priceInput.value = p.price;
      priceHint.innerHTML = '🔒 <strong>Harga Terkunci:</strong> Ditetapkan paten oleh Pemilik Resto (Owner) sebesar <strong>' + formatMoney(p.price) + '</strong>.';
    }

    // Populate branch categories
    var catSelect = $('adopt-branch-category');
    var cats = currentBranchCatalogData.categories || [];
    var catOptions = cats.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
    });
    catOptions.unshift('<option value="">(Otomatis sesuaikan kategori produk)</option>');
    catSelect.innerHTML = catOptions.join('');

    $('modal-adopt-product').style.display = 'flex';
  };

  window.closeAdoptModal = function () {
    $('modal-adopt-product').style.display = 'none';
  };

  // Form Adopt Submit Listener
  var formAdopt = $('form-adopt-product');
  if (formAdopt) {
    formAdopt.addEventListener('submit', async function (e) {
      e.preventDefault();
      var targetBranchId = currentManagingBranchId ||
        (typeof getActiveBranchId === 'function' ? getActiveBranchId() : null) ||
        (typeof getEffectiveBranchId === 'function' ? getEffectiveBranchId() : null);
      if (!targetBranchId) {
        showToast('❌ Cabang tidak valid atau belum dipilih.');
        return;
      }
      currentManagingBranchId = targetBranchId;

      var btn = $('btn-save-adopt');
      btn.disabled = true;
      btn.textContent = 'Menyimpan...';

      var prodId = $('adopt-product-id').value;
      var catId = $('adopt-branch-category').value;
      var priceVal = Number($('adopt-price').value);

      try {
        var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/adopt', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            product_id: prodId,
            branch_category_id: catId || undefined,
            price: priceVal
          })
        });
        var data = await res.json();
        if (data.success) {
          showToast('✅ Menu berhasil diadopsi ke cabang!');
          window.closeAdoptModal();
          // Refresh the correct panel depending on role/view
          if (isBranchManager()) {
            if (typeof loadBMMenu === 'function') loadBMMenu();
            if (typeof loadInlineBranchCatalog === 'function') loadInlineBranchCatalog();
          } else {
            reloadBranchCatalogView();
          }
        } else {
          showToast('❌ ' + (data.message || data.error || 'Gagal mengadopsi produk.'));
        }
      } catch (err) {
        showToast('❌ Kesalahan jaringan.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Simpan ke Katalog Cabang';
      }
    });
  }


  window.toggleBranchActivation = async function (id, isChecked) {
    var nextActive = isChecked ? 1 : 0;
    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + id, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: nextActive })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast(nextActive ? '✅ Cabang telah aktif.' : '⛔ Cabang telah nonaktif.');
        loadBranches();
      } else {
        alert((data && (data.message || data.error)) || 'Gagal mengubah status cabang.');
        loadBranches();
      }
    } catch (err) {
      if (err.status === 401) return;
      alert('Terjadi kesalahan saat mengubah status cabang: ' + err.message);
      loadBranches();
    }
  };

  window.openBranchModal = function (branchId) {
    var b = branchId ? (state.branches.find(function (x) { return x.id === branchId; }) || null) : null;
    $('branch-id').value = b ? b.id : '';
    $('branch-name').value = b ? (b.name || '') : '';
    $('branch-address').value = b ? (b.address_text || '') : '';
    $('branch-phone').value = b ? (b.whatsapp_number || b.phone || '') : '';
    $('branch-latitude').value = b ? Number(b.latitude || 0) : '';
    $('branch-longitude').value = b ? Number(b.longitude || 0) : '';
    $('branch-free-km').value = b ? (b.free_delivery_km != null ? b.free_delivery_km : 0) : 0;
    $('branch-price-km').value = b ? (b.price_per_km != null ? b.price_per_km : 3000) : 3000;
    $('branch-radius').value = b ? (b.max_radius_km != null ? b.max_radius_km : 10) : 10;
    $('branch-promo-minorder').value = b ? (b.promo_min_order != null ? b.promo_min_order : 50000) : 50000;
    $('branch-promo-discount').value = b ? (b.promo_delivery_discount != null ? b.promo_delivery_discount : 0) : 0;
    $('branch-open-override').checked = b ? !(b.is_open_override === 0 || b.is_open_override === false) : true;
    $('modal-branch-title').textContent = b ? ('Edit Cabang: ' + (b.name || '')) : 'Tambah Cabang';
    var modal = $('modal-branch');
    if (!modal) return;
    modal.style.display = 'flex';
    setTimeout(function () { $('branch-name').focus(); }, 80);
  };

  window.closeBranchModal = function () {
    var modal = $('modal-branch');
    if (!modal) return;
    modal.style.display = 'none';
    $('form-branch').reset();
    $('branch-id').value = '';
  };

  window.deleteBranch = async function (branchId) {
    var b = state.branches.find(function (x) { return x.id === branchId; }) || {};
    var isActive = b.is_active === 1 || b.is_active === true;
    var confirmMsg = isActive
      ? 'Yakin ingin menghapus cabang "' + (b.name || branchId) + '"?\n\nCabang aktif hanya dapat dihapus jika tidak ada pesanan aktif yang sedang berjalan.'
      : 'Yakin ingin memproses cabang "' + (b.name || branchId) + '"?\n\n• Jika ada riwayat transaksi → cabang akan diarsipkan (data aman).\n• Jika tidak ada riwayat → cabang akan dihapus permanen.';
    if (!confirm(confirmMsg)) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!res.ok || !data.success) {
        alert((data && (data.error || data.message)) || 'Gagal memproses cabang.');
        return;
      }
      if (data.archived) {
        showToast('📦 Cabang berhasil diarsipkan. Riwayat transaksi tetap tersimpan.');
      } else {
        showToast('✅ Cabang berhasil dihapus permanen.');
      }
      loadBranches();
    } catch (err) {
      if (err.status === 401) return;
      alert('Terjadi kesalahan saat memproses cabang: ' + err.message);
    }
  };


  var formBranchEl = $('form-branch');
  if (formBranchEl) {
    formBranchEl.addEventListener('submit', async function (e) {
      e.preventDefault();
      var id = $('branch-id').value;
      var payload = {
        name: $('branch-name').value.trim(),
        address_text: $('branch-address').value.trim(),
        phone: $('branch-phone').value.trim(),
        whatsapp_number: $('branch-phone').value.trim(),
        latitude: $('branch-latitude').value !== '' ? Number($('branch-latitude').value) : 0,
        longitude: $('branch-longitude').value !== '' ? Number($('branch-longitude').value) : 0,
        free_delivery_km: $('branch-free-km').value !== '' ? Number($('branch-free-km').value) : 0,
        price_per_km: $('branch-price-km').value !== '' ? Number($('branch-price-km').value) : 3000,
        max_radius_km: $('branch-radius').value !== '' ? Number($('branch-radius').value) : 10,
        promo_min_order: $('branch-promo-minorder').value !== '' ? Number($('branch-promo-minorder').value) : 50000,
        promo_delivery_discount: $('branch-promo-discount').value !== '' ? Number($('branch-promo-discount').value) : 0,
        is_open_override: $('branch-open-override').checked ? 1 : 0
      };

      var btn = this.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

      try {
        var url = id ? (API_BASE + '/admin/branches/' + encodeURIComponent(id)) : (API_BASE + '/admin/branches');
        var method = id ? 'PUT' : 'POST';
        var res = await adminFetch(url, {
          method: method,
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (!res.ok || !data.success) {
          alert((data && (data.message || data.error)) || 'Gagal menyimpan cabang.');
          return;
        }
        showToast(id ? '✅ Perubahan cabang disimpan.' : '✅ Cabang baru berhasil ditambahkan.');
        closeBranchModal();
        loadBranches();
      } catch (err) {
        if (err.status === 401) return;
        alert('Terjadi kesalahan saat menyimpan cabang: ' + err.message);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Simpan Cabang'; }
      }
    });
  }

  /* =========================================================================
     MODUL 4: PESANAN CONTROLLER (ORDER LIST & ORDER DETAIL)
     ========================================================================= */
  var _ordersSearchQuery = '';
  var _ordersStatusFilter = 'all';
  var _ordersChannelFilter = 'all';
  var _ordersFulfillmentFilter = 'all';
  var _activeDetailOrderId = null;

  function showOrdersListView() {
    var listView = $('orders-list-view');
    var detailView = $('order-detail-view');
    if (listView) listView.style.display = 'block';
    if (detailView) detailView.style.display = 'none';
  }

  function showOrderDetailView() {
    var listView = $('orders-list-view');
    var detailView = $('order-detail-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';
  }

  var _ordersFetchSeq = 0;
  var _ordersPollTimer = null;

  function stopOrdersPolling() {
    if (_ordersPollTimer) {
      clearInterval(_ordersPollTimer);
      _ordersPollTimer = null;
    }
  }

  function startOrdersPolling() {
    stopOrdersPolling();
    _ordersPollTimer = setInterval(function () {
      if (document.visibilityState === 'hidden') return;
      loadOrders({ background: true });
    }, 10000);
  }

  // Expose to window for testing and lifecycle hooks
  window.startOrdersPolling = startOrdersPolling;
  window.stopOrdersPolling = stopOrdersPolling;

  async function loadOrders(opts) {
    var isBg = opts && opts.background;
    var tbody = $('orders-table-body');
    if (tbody && !isBg && (!state.orders || !state.orders.length)) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6">Memuat data pesanan...</td></tr>';
    }

    var currentSeq = ++_ordersFetchSeq;

    try {
      var queryParams = [];
      if (_branchContextState && _branchContextState.selected && _branchContextState.selected !== 'all') {
        queryParams.push('branch_id=' + encodeURIComponent(_branchContextState.selected));
      }
      if (_ordersStatusFilter && _ordersStatusFilter !== 'all') {
        queryParams.push('status=' + encodeURIComponent(_ordersStatusFilter));
      }
      if (_ordersChannelFilter && _ordersChannelFilter !== 'all') {
        queryParams.push('order_channel=' + encodeURIComponent(_ordersChannelFilter));
      }
      if (_ordersFulfillmentFilter && _ordersFulfillmentFilter !== 'all') {
        queryParams.push('fulfillment_type=' + encodeURIComponent(_ordersFulfillmentFilter));
      }
      if (_ordersSearchQuery) {
        queryParams.push('search=' + encodeURIComponent(_ordersSearchQuery));
      }

      var qs = queryParams.length ? ('?' + queryParams.join('&')) : '';
      var res = await adminFetch(API_BASE + '/admin/orders' + qs, { headers: getAuthHeaders() });
      var data = await res.json();

      // Discard response if a newer fetch was initiated in the meantime
      if (currentSeq !== _ordersFetchSeq) {
        return;
      }

      if (data.success && data.orders) {
        state.orders = data.orders;
        renderOrdersTable();
      }
    } catch (e) {
      if (currentSeq !== _ordersFetchSeq) return;
      console.warn('[Orders Load Error]:', e);
      if (tbody && !isBg && (!state.orders || !state.orders.length)) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6 text-danger">Gagal memuat daftar pesanan.</td></tr>';
      }
    }
  }

  function renderOrdersTable() {
    var tbody = $('orders-table-body');
    if (!tbody) return;

    if (!state.orders.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6 text-muted">Belum ada pesanan yang sesuai filter.</td></tr>';
      return;
    }

    var statusBadges = {
      pending: 'x-badge-warning',
      confirmed: 'x-badge-info',
      preparing: 'x-badge-info',
      ready: 'x-badge-success',
      out_for_delivery: 'x-badge-info',
      completed: 'x-badge-success',
      cancelled: 'x-badge-danger'
    };

    var rows = state.orders.map(function (ord) {
      var orderChannel = ord.order_channel || 'customer_app';
      var fulfillmentType = ord.fulfillment_type || ord.order_type || 'delivery';
      var timeStr = ord.created_at ? (new Date(ord.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })) : '-';
      var canAdvance = ord.status !== 'completed' && ord.status !== 'cancelled';

      return [
        '<tr>',
          '<td><a href="#orders/' + ord.id + '" style="font-weight:700;color:var(--text-main);text-decoration:none;" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">#' + esc(ord.order_number || ord.id.substring(0, 8)) + '</a></td>',
          '<td><small class="text-muted">' + timeStr + '</small></td>',
          '<td><strong>' + esc(ord.branch_name || ord.branch_id || '-') + '</strong></td>',
          '<td><strong>' + esc(ord.customer_name || 'Pelanggan') + '</strong><br><small class="text-muted">' + esc(ord.customer_phone || '-') + '</small></td>',
          '<td><span class="x-badge" style="background:#e0f2fe;color:#0369a1;font-size:11px;">' + esc(orderChannel) + '</span></td>',
          '<td><span class="x-badge" style="background:#fef3c7;color:#b45309;font-size:11px;">' + esc(fulfillmentType) + '</span></td>',
          '<td><strong>' + formatMoney(ord.grand_total) + '</strong></td>',
          '<td><span class="x-badge ' + (statusBadges[ord.status] || 'x-badge-info') + '">' + esc(ord.status.toUpperCase()) + '</span></td>',
          '<td class="text-right" style="white-space:nowrap;">',
            '<div class="x-item-actions" style="justify-content:flex-end;">',
              (canAdvance
                ? '<button type="button" class="x-btn-primary" style="padding:6px 12px;font-size:12px;" onclick="advanceOrderStatus(\'' + ord.id + '\', \'' + ord.status + '\', \'' + fulfillmentType + '\')">' + (ord.status === 'pending' ? 'Terima Pesanan' : 'Ubah Status ➔') + '</button>'
                : ''),
              '<button type="button" class="x-action-menu-trigger" aria-label="Menu aksi pesanan ' + esc(ord.order_number || ord.id) + '" onclick="XentraActionMenu.open(this, [' +
                '{ label: \'Lihat Rincian Pesanan\', icon: \'📄\', onClick: function() { navigateTo(\'orders/' + ord.id + '\'); } }' +
                (canAdvance ? ',{ divider: true }, { label: \'' + (ord.status === 'pending' ? 'Terima Pesanan' : 'Lanjut Status Pesanan ➔') + '\', icon: \'⚡\', onClick: function() { advanceOrderStatus(\'' + ord.id + '\', \'' + ord.status + '\', \'' + fulfillmentType + '\'); } }' : '') +
                (ord.status === 'pending' ? ',{ label: \'Tolak Pesanan\', icon: \'❌\', onClick: function() { rejectOrder(\'' + ord.id + '\'); } }' : '') +
              '])">',
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
              '</button>',
            '</div>',
          '</td>',
        '</tr>'
      ].join('');
    });

    tbody.innerHTML = rows.join('');
  }

  /* =========================================================================
     ORDER DETAIL VIEW CONTROLLER
     ========================================================================= */
  async function loadOrderDetailView(orderId) {
    _activeDetailOrderId = orderId;
    showOrderDetailView();

    var tbody = $('order-detail-items-tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4">Memuat rincian pesanan...</td></tr>';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/orders/' + encodeURIComponent(orderId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!data.success || !data.order) {
        showToast('❌ ' + (data.error || 'Pesanan tidak ditemukan.'));
        navigateTo('orders');
        return;
      }

      var ord = data.order;

      // Update Summary Header
      if ($('order-detail-breadcrumb')) $('order-detail-breadcrumb').textContent = '#' + (ord.order_number || ord.id);
      if ($('order-detail-number')) $('order-detail-number').textContent = '#' + (ord.order_number || ord.id);

      var statusBadges = {
        pending: 'x-badge-warning',
        confirmed: 'x-badge-info',
        preparing: 'x-badge-info',
        ready: 'x-badge-success',
        out_for_delivery: 'x-badge-info',
        completed: 'x-badge-success',
        cancelled: 'x-badge-danger'
      };

      var statusBadge = $('order-detail-status-badge');
      if (statusBadge) {
        statusBadge.className = 'x-badge ' + (statusBadges[ord.status] || 'x-badge-info');
        statusBadge.textContent = (ord.status || 'UNKNOWN').toUpperCase();
      }

      var channelBadge = $('order-detail-channel-badge');
      if (channelBadge) {
        channelBadge.textContent = 'Channel: ' + (ord.order_channel || 'customer_app');
      }

      var fulfillmentBadge = $('order-detail-fulfillment-badge');
      if (fulfillmentBadge) {
        fulfillmentBadge.textContent = 'Fulfillment: ' + (ord.fulfillment_type || ord.order_type || 'delivery');
      }

      if ($('order-detail-time')) {
        $('order-detail-time').textContent = 'Waktu Pemesanan: ' + (ord.created_at ? new Date(ord.created_at).toLocaleString('id-ID') : '-');
      }

      if ($('order-detail-branch')) $('order-detail-branch').textContent = ord.branch_name || ord.branch_id || '-';
      if ($('order-detail-customer')) $('order-detail-customer').textContent = ord.customer_name || 'Pelanggan';
      if ($('order-detail-phone')) $('order-detail-phone').textContent = ord.customer_phone || '-';

      var tableWrap = $('order-detail-table-wrap');
      if (tableWrap) {
        if (ord.table_number) {
          tableWrap.style.display = 'block';
          if ($('order-detail-table')) $('order-detail-table').textContent = 'Meja ' + ord.table_number;
        } else {
          tableWrap.style.display = 'none';
        }
      }

      if ($('order-detail-total')) $('order-detail-total').textContent = formatMoney(ord.grand_total);
      if ($('order-detail-payment-status')) {
        var pStat = ord.payment_status || (ord.status === 'completed' ? 'paid' : 'unpaid');
        $('order-detail-payment-status').textContent = 'Status Pembayaran: ' + pStat.toUpperCase();
        $('order-detail-payment-status').style.color = pStat === 'paid' ? '#10b981' : '#f59e0b';
      }

      // Shared Dine-In Session Box
      var sessionBox = $('order-detail-session-box');
      if (sessionBox) {
        if (ord.dining_session_id && ord.session_orders && ord.session_orders.length) {
          sessionBox.style.display = 'block';
          if ($('order-detail-session-id')) {
            $('order-detail-session-id').textContent = '(Session: ' + ord.dining_session_id.substring(0, 8) + ')';
          }
          var sessionList = $('order-detail-session-list');
          if (sessionList) {
            sessionList.innerHTML = ord.session_orders.map(function (so) {
              return '<div style="display:flex;justify-content:space-between;align-items:center;background:#ffffff;padding:6px 10px;border-radius:4px;border:1px solid #dcfce7;">' +
                '<span><a href="#orders/' + so.id + '" style="font-weight:700;color:#166534;text-decoration:none;">#' + (so.order_number || so.id) + '</a> (' + so.order_channel + ')</span>' +
                '<span><strong>' + formatMoney(so.grand_total) + '</strong> &bull; ' + (so.payment_status || 'unpaid').toUpperCase() + '</span>' +
              '</div>';
            }).join('');
          }
        } else {
          sessionBox.style.display = 'none';
        }
      }

      // Items Table
      var items = ord.items || [];
      if (tbody) {
        if (!items.length) {
          tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Tidak ada item dalam pesanan ini.</td></tr>';
        } else {
          tbody.innerHTML = items.map(function (it) {
            var sub = it.item_subtotal != null ? it.item_subtotal : (it.subtotal != null ? it.subtotal : (it.unit_price * it.quantity));
            return [
              '<tr>',
                '<td><strong>' + esc(it.product_name || it.product_id) + '</strong></td>',
                '<td>' + formatMoney(it.unit_price) + '</td>',
                '<td>' + it.quantity + '</td>',
                '<td><small class="text-muted">' + esc(it.note || '-') + '</small></td>',
                '<td class="text-right"><strong>' + formatMoney(sub) + '</strong></td>',
              '</tr>'
            ].join('');
          }).join('');
        }
      }

      // Financial Calculation
      if ($('order-calc-subtotal')) $('order-calc-subtotal').textContent = formatMoney(ord.subtotal || ord.grand_total);
      if ($('order-calc-delivery')) $('order-calc-delivery').textContent = formatMoney(ord.delivery_fee || 0);
      if ($('order-calc-discount')) $('order-calc-discount').textContent = formatMoney(ord.discount_amount || 0);
      if ($('order-calc-grandtotal')) $('order-calc-grandtotal').textContent = formatMoney(ord.grand_total);

      // Delivery & Note Info
      var dest = (ord.delivery && ord.delivery.destination_address) || (ord.table_number ? ('Dine-in di Meja ' + ord.table_number) : 'Pickup di Outlet');
      if ($('order-detail-dest')) $('order-detail-dest').textContent = dest;
      if ($('order-detail-paymethod')) $('order-detail-paymethod').textContent = (ord.payment_method || 'Tunai').toUpperCase();
      if ($('order-detail-notes')) $('order-detail-notes').textContent = ord.order_note || 'Tidak ada catatan tambahan.';

    } catch (err) {
      console.error('[Order Detail Load Error]:', err);
      showToast('❌ Kesalahan saat memuat detail pesanan.');
    }
  }

  function initOrdersFilterListeners() {
    var searchInput = $('orders-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        _ordersSearchQuery = searchInput.value.trim();
        loadOrders();
      });
    }

    var filterStatus = $('orders-filter-status');
    if (filterStatus) {
      filterStatus.addEventListener('change', function () {
        _ordersStatusFilter = filterStatus.value;
        loadOrders();
      });
    }

    var filterChannel = $('orders-filter-channel');
    if (filterChannel) {
      filterChannel.addEventListener('change', function () {
        _ordersChannelFilter = filterChannel.value;
        loadOrders();
      });
    }

    var filterFulfillment = $('orders-filter-fulfillment');
    if (filterFulfillment) {
      filterFulfillment.addEventListener('change', function () {
        _ordersFulfillmentFilter = filterFulfillment.value;
        loadOrders();
      });
    }
  }

  window.rejectOrder = async function (orderId) {
    var reason = window.prompt('Masukkan alasan penolakan pesanan:');
    if (reason === null) return; // User cancelled prompt
    reason = reason.trim();
    if (!reason) {
      showToast('❌ Alasan penolakan wajib diisi.');
      return;
    }

    var authHeaders = getAuthHeaders();
    try {
      var res = await adminFetch(API_BASE + '/orders/' + orderId + '/branch-acceptance', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ decision: 'reject', reason: reason, note: reason })
      });
      var data = await res.json();
      if (data && data.success) {
        showToast('Pesanan DITOLAK: ' + (data.new_status || 'rejected').toUpperCase());
        loadOrders();
      } else {
        showToast((data && data.error) || 'Gagal menolak pesanan.');
      }
    } catch (e) {
      showToast('Gagal menolak pesanan.');
    }
  };

  window.advanceOrderStatus = async function (orderId, currentStatus, fulfillmentType) {
    var authHeaders = getAuthHeaders();

    // R5 CHECK-1: acceptance ('pending' → 'confirmed') is EXCLUSIVELY Branch
    // ACCEPT via /orders/:id/branch-acceptance — never the generic status
    // PATCH. The branch acceptance endpoint is server-authoritative, audited,
    // and idempotent.
    if (currentStatus === 'pending') {
      try {
        var acceptRes = await adminFetch(API_BASE + '/orders/' + orderId + '/branch-acceptance', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ decision: 'accept', note: 'Diterima dari Merchant Dashboard' })
        });
        var acceptData = await acceptRes.json();
        if (acceptData && acceptData.success) {
          showToast('Pesanan DITERIMA: ' + (acceptData.new_status || 'confirmed').toUpperCase());
          loadOrders();
        } else {
          showToast((acceptData && acceptData.error) || 'Gagal menerima pesanan.');
        }
      } catch (e) {
        showToast('Gagal menerima pesanan.');
      }
      return;
    }

    // Fulfillment-type-aware progression:
    // Delivery: pending → confirmed → preparing → ready → out_for_delivery → completed
    // Pickup / Dine-in: pending → confirmed → preparing → ready → completed
    var isDelivery = (fulfillmentType === 'delivery');
    var nextMap = {
      confirmed: 'preparing',
      preparing: 'ready',
      ready: isDelivery ? 'out_for_delivery' : 'completed',
      out_for_delivery: 'completed'
    };

    var nextStatus = nextMap[currentStatus] || 'completed';
    try {
      var res = await adminFetch(API_BASE + '/kitchen/orders/' + orderId + '/status', {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: nextStatus, note: 'Status diupdate dari Merchant Dashboard' })
      });
      var data = await res.json();
      if (data && data.success) {
        showToast('Pesanan diubah ke status: ' + nextStatus.toUpperCase());
        loadOrders();
      } else {
        showToast((data && data.error) || 'Gagal update status pesanan.');
      }
    } catch (e) {
      showToast('Gagal update status pesanan.');
    }
  };

  /* =========================================================================
     MODUL 5: RINGKASAN & OVERVIEW (PHASE 4)
     ========================================================================= */
  var _overviewFilter = {
    startDate: '',
    endDate: ''
  };

  function getEffectiveBranchId() {
    return _branchContextState.selected !== 'all' ? _branchContextState.selected : '';
  }

  async function loadOverview() {
    try {
      var branchId = getEffectiveBranchId();
      var queryParams = [];
      if (branchId) queryParams.push('branch_id=' + encodeURIComponent(branchId));
      if (_overviewFilter.startDate) queryParams.push('start_date=' + encodeURIComponent(_overviewFilter.startDate));
      if (_overviewFilter.endDate) queryParams.push('end_date=' + encodeURIComponent(_overviewFilter.endDate));

      var url = API_BASE + '/admin/overview' + (queryParams.length > 0 ? '?' + queryParams.join('&') : '');
      var res = await adminFetch(url, { headers: getAuthHeaders() });
      var data = await res.json();

      // Update badge in overview filter
      var branchBadge = $('overview-branch-badge');
      if (branchBadge) {
        var branchName = 'Semua Cabang';
        if (branchId) {
          var found = (_branchContextState.branches || []).find(function (b) { return String(b.id) === String(branchId); });
          if (found) branchName = found.name;
        }
        branchBadge.textContent = branchName;
      }

      if (data.success && data.data) {
        renderOverviewData(data.data);
      } else {
        renderOverviewEmpty();
      }
    } catch (e) {
      console.warn('[Overview Load Error]:', e);
      renderOverviewEmpty();
    }
  }

  function renderOverviewData(overview) {
    var kpis = overview.kpis || {};
    var salesPerf = overview.sales_performance || {};
    var branchPerf = overview.branch_performance || [];
    var topProducts = overview.top_products || [];
    var needsAttention = overview.needs_attention || {};

    // 1. Primary KPIs
    if ($('stat-net-sales')) $('stat-net-sales').textContent = formatMoney(kpis.net_sales || 0);
    if ($('stat-orders-count')) $('stat-orders-count').textContent = kpis.orders || 0;
    if ($('stat-customers-count')) $('stat-customers-count').textContent = kpis.customers || 0;
    if ($('stat-aov')) $('stat-aov').textContent = formatMoney(kpis.aov || 0);

    // 2. Needs Attention Banner
    var attentionContainer = $('overview-needs-attention-container');
    if (attentionContainer) {
      if (needsAttention.low_stock_items && needsAttention.low_stock_items.length > 0) {
        var alertHtml = '<div class="x-alert-banner">' +
          '<span style="font-size:20px;">⚠️</span>' +
          '<div>' +
            '<strong>Peringatan Stok Menipis:</strong> Ada ' + needsAttention.low_stock_items.length + ' item produk yang stoknya menipis di bawah batas minimum.' +
            ' <a href="#reports/operations" style="font-weight:700;color:#92400e;text-decoration:underline;">Lihat Laporan Operasional &rarr;</a>' +
          '</div>' +
        '</div>';
        attentionContainer.innerHTML = alertHtml;
        attentionContainer.style.display = 'block';
      } else {
        attentionContainer.innerHTML = '';
        attentionContainer.style.display = 'none';
      }
    }

    // 3. Sales Performance Breakdown (by channel & fulfillment)
    var salesContainer = $('overview-sales-performance-container');
    if (salesContainer) {
      var channels = salesPerf.by_channel || [];
      var fulfillments = salesPerf.by_fulfillment || [];

      if (channels.length === 0 && fulfillments.length === 0) {
        salesContainer.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">📊</div>Belum ada transaksi penjualan pada periode ini.</div>';
      } else {
        var html = '<h5 style="font-size:12px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-bottom:8px;">Berdasarkan Channel</h5>';
        html += '<table class="x-data-table mb-4"><thead><tr><th>Channel</th><th>Pesanan</th><th>Omzet</th></tr></thead><tbody>';
        channels.forEach(function (c) {
          html += '<tr>' +
            '<td><span class="x-badge">' + escapeHtml(c.order_channel || 'customer_app') + '</span></td>' +
            '<td>' + (c.order_count || 0) + '</td>' +
            '<td><strong>' + formatMoney(c.total_revenue || 0) + '</strong></td>' +
          '</tr>';
        });
        html += '</tbody></table>';

        html += '<h5 style="font-size:12px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin:16px 0 8px;">Berdasarkan Pemenuhan (Fulfillment)</h5>';
        html += '<table class="x-data-table"><thead><tr><th>Tipe</th><th>Pesanan</th><th>Omzet</th></tr></thead><tbody>';
        fulfillments.forEach(function (f) {
          html += '<tr>' +
            '<td><span class="x-badge" style="background:#ecfdf5;color:#065f46;">' + escapeHtml(f.fulfillment_type || 'delivery') + '</span></td>' +
            '<td>' + (f.order_count || 0) + '</td>' +
            '<td><strong>' + formatMoney(f.total_revenue || 0) + '</strong></td>' +
          '</tr>';
        });
        html += '</tbody></table>';

        salesContainer.innerHTML = html;
      }
    }

    // 4. Top Products
    var topProdContainer = $('overview-top-products-container');
    if (topProdContainer) {
      if (!topProducts || topProducts.length === 0) {
        topProdContainer.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">🍔</div>Belum ada produk yang terjual pada periode ini.</div>';
      } else {
        var prodHtml = '<table class="x-data-table"><thead><tr><th>Produk</th><th>Kategori</th><th>Terjual</th><th>Total</th></tr></thead><tbody>';
        topProducts.forEach(function (p) {
          prodHtml += '<tr>' +
            '<td><strong>' + escapeHtml(p.product_name) + '</strong></td>' +
            '<td><span class="x-badge">' + escapeHtml(p.category_name || 'Uncategorized') + '</span></td>' +
            '<td>' + (p.total_units_sold || 0) + ' item</td>' +
            '<td><strong>' + formatMoney(p.total_gross_sales || 0) + '</strong></td>' +
          '</tr>';
        });
        prodHtml += '</tbody></table>';
        topProdContainer.innerHTML = prodHtml;
      }
    }

    // 5. Branch Performance Leaderboard
    var branchPanel = $('overview-branch-performance-panel');
    var branchContainer = $('overview-branch-performance-container');
    if (branchPanel && branchContainer) {
      if (isBranchManager()) {
        branchPanel.style.display = 'none';
      } else {
        branchPanel.style.display = 'block';
        if (!branchPerf || branchPerf.length === 0) {
          branchContainer.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">🏢</div>Belum ada data cabang atau transaksi.</div>';
        } else {
          var bHtml = '<table class="x-data-table"><thead><tr><th>Cabang</th><th>Total Pesanan</th><th>AOV</th><th>Total Omzet</th></tr></thead><tbody>';
          branchPerf.forEach(function (b) {
            bHtml += '<tr>' +
              '<td><strong>' + escapeHtml(b.branch_name) + '</strong></td>' +
              '<td>' + (b.total_orders || 0) + ' pesanan</td>' +
              '<td>' + formatMoney(b.average_order_value || 0) + '</td>' +
              '<td><strong style="color:#059669;">' + formatMoney(b.total_revenue || 0) + '</strong></td>' +
            '</tr>';
          });
          bHtml += '</tbody></table>';
          branchContainer.innerHTML = bHtml;
        }
      }
    }
  }

  function renderOverviewEmpty() {
    if ($('stat-net-sales')) $('stat-net-sales').textContent = 'Rp0';
    if ($('stat-orders-count')) $('stat-orders-count').textContent = '0';
    if ($('stat-customers-count')) $('stat-customers-count').textContent = '0';
    if ($('stat-aov')) $('stat-aov').textContent = 'Rp0';

    if ($('overview-sales-performance-container')) {
      $('overview-sales-performance-container').innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">📊</div>Data belum tersedia.</div>';
    }
    if ($('overview-top-products-container')) {
      $('overview-top-products-container').innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">🍔</div>Data belum tersedia.</div>';
    }
    if ($('overview-branch-performance-container')) {
      $('overview-branch-performance-container').innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">🏢</div>Data belum tersedia.</div>';
    }
  }

  function initOverviewControls() {
    var btnFilter = $('btn-overview-filter');
    var btnReset = $('btn-overview-reset');
    var inputStart = $('overview-start-date');
    var inputEnd = $('overview-end-date');

    if (btnFilter) {
      btnFilter.addEventListener('click', function () {
        _overviewFilter.startDate = inputStart ? inputStart.value : '';
        _overviewFilter.endDate = inputEnd ? inputEnd.value : '';
        loadOverview();
      });
    }

    if (btnReset) {
      btnReset.addEventListener('click', function () {
        if (inputStart) inputStart.value = '';
        if (inputEnd) inputEnd.value = '';
        _overviewFilter.startDate = '';
        _overviewFilter.endDate = '';
        loadOverview();
      });
    }
  }

  /* =========================================================================
     MODUL 6: REPORTS ENGINE (PHASE 4)
     ========================================================================= */
  var _activeReportType = 'overview';
  var _reportFilter = {
    startDate: '',
    endDate: ''
  };

  async function loadReports(reportType) {
    if (reportType) _activeReportType = reportType;

    // Update active subnav tab
    document.querySelectorAll('#reports-subnav .x-subnav-tab').forEach(function (tab) {
      var rt = tab.dataset.report;
      tab.classList.toggle('active', rt === _activeReportType);
    });

    // Update branch badge indicator
    var branchId = getEffectiveBranchId();
    var branchBadge = $('report-branch-badge');
    if (branchBadge) {
      var branchName = 'Semua Cabang';
      if (branchId) {
        var found = (_branchContextState.branches || []).find(function (b) { return String(b.id) === String(branchId); });
        if (found) branchName = found.name;
      }
      branchBadge.textContent = branchName;
    }

    // Role-based subnav visibility
    var branchesTab = document.querySelector('#reports-subnav .x-subnav-tab[data-report="branches"]');
    var customersTab = document.querySelector('#reports-subnav .x-subnav-tab[data-report="customers"]');
    if (isBranchManager()) {
      if (branchesTab) branchesTab.style.display = 'none';
      if (customersTab) customersTab.style.display = 'none';
      if (_activeReportType === 'branches' || _activeReportType === 'customers') {
        _activeReportType = 'overview';
      }
    } else {
      if (branchesTab) branchesTab.style.display = '';
      if (customersTab) customersTab.style.display = '';
    }

    var queryParams = [];
    if (branchId) queryParams.push('branch_id=' + encodeURIComponent(branchId));
    if (_reportFilter.startDate) queryParams.push('start_date=' + encodeURIComponent(_reportFilter.startDate));
    if (_reportFilter.endDate) queryParams.push('end_date=' + encodeURIComponent(_reportFilter.endDate));

    var summaryCards = $('report-summary-cards');
    var tableContainer = $('report-table-container');
    var titleEl = $('report-table-title');
    var subEl = $('report-table-subtitle');

    if (tableContainer) tableContainer.innerHTML = '<div class="x-empty-state">Memuat data laporan...</div>';

    try {
      var endpoint = _activeReportType === 'overview'
        ? '/admin/overview'
        : '/reports/' + encodeURIComponent(_activeReportType);

      var url = API_BASE + endpoint + (queryParams.length > 0 ? '?' + queryParams.join('&') : '');
      var res = await adminFetch(url, { headers: getAuthHeaders() });
      var json = await res.json();

      if (!json.success) {
        if (tableContainer) tableContainer.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">⚠️</div>' + escapeHtml(json.error || json.message || 'Gagal memuat laporan.') + '</div>';
        return;
      }

      renderReportPayload(_activeReportType, json.data);
    } catch (e) {
      console.warn('[Reports Load Error]:', e);
      if (tableContainer) tableContainer.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">⚠️</div>Terjadi kesalahan saat memuat laporan.</div>';
    }
  }

  function renderReportPayload(reportType, data) {
    var summaryCards = $('report-summary-cards');
    var tableContainer = $('report-table-container');
    var titleEl = $('report-table-title');
    var subEl = $('report-table-subtitle');

    if (!data) {
      if (tableContainer) tableContainer.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">📄</div>Tidak ada data untuk periode ini.</div>';
      return;
    }

    switch (reportType) {
      case 'overview':
        if (titleEl) titleEl.textContent = 'Ringkasan Laporan Bisnis';
        if (subEl) subEl.textContent = 'Indikator performa utama per cabang dan periode';
        renderOverviewReport(data, summaryCards, tableContainer);
        break;

      case 'sales':
      case 'orders':
        if (titleEl) titleEl.textContent = reportType === 'sales' ? 'Laporan Penjualan (Sales)' : 'Laporan Pesanan (Orders)';
        if (subEl) subEl.textContent = 'Rincian transaksi, pesanan per channel, dan per metode pemenuhan';
        renderSalesReport(data, summaryCards, tableContainer);
        break;

      case 'products':
        if (titleEl) titleEl.textContent = 'Laporan Produk & Menu';
        if (subEl) subEl.textContent = 'Performa penjualan menu dan kontribusi kategori';
        renderProductsReport(data, summaryCards, tableContainer);
        break;

      case 'customers':
        if (titleEl) titleEl.textContent = 'Laporan Pelanggan';
        if (subEl) subEl.textContent = 'Analitik basis pelanggan, frekuensi belanja, dan total transaksi';
        renderCustomersReport(data, summaryCards, tableContainer);
        break;

      case 'branches':
        if (titleEl) titleEl.textContent = 'Laporan Perbandingan Cabang';
        if (subEl) subEl.textContent = 'Komparasi omzet, pesanan, dan AOV antar seluruh cabang';
        renderBranchesReport(data, summaryCards, tableContainer);
        break;

      case 'operations':
        if (titleEl) titleEl.textContent = 'Laporan Operasional & Stok';
        if (subEl) subEl.textContent = 'Peringatan stok menipis dan pergerakan persediaan';
        renderOperationsReport(data, summaryCards, tableContainer);
        break;

      default:
        if (tableContainer) tableContainer.innerHTML = '<div class="x-empty-state">Laporan tidak dikenali.</div>';
    }
  }

  function renderOverviewReport(data, cardsEl, tableEl) {
    var kpis = data.kpis || {};
    if (cardsEl) {
      cardsEl.innerHTML =
        '<div class="x-metric-card"><div class="x-metric-icon bg-green">💰</div><div class="x-metric-info"><span class="x-metric-label">Net Sales</span><h3 class="x-metric-value">' + formatMoney(kpis.net_sales || 0) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-blue">📦</div><div class="x-metric-info"><span class="x-metric-label">Orders</span><h3 class="x-metric-value">' + (kpis.orders || 0) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-amber">👥</div><div class="x-metric-info"><span class="x-metric-label">Customers</span><h3 class="x-metric-value">' + (kpis.customers || 0) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-green">🎯</div><div class="x-metric-info"><span class="x-metric-label">AOV</span><h3 class="x-metric-value">' + formatMoney(kpis.aov || 0) + '</h3></div></div>';
    }

    var timeline = (data.sales_performance && data.sales_performance.timeline) || [];
    if (!timeline || timeline.length === 0) {
      if (tableEl) tableEl.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">📅</div>Belum ada riwayat penjualan pada filter ini.</div>';
      return;
    }

    var html = '<table class="x-data-table"><thead><tr><th>Tanggal</th><th>Jumlah Pesanan</th><th>Total Omzet</th></tr></thead><tbody>';
    timeline.forEach(function (row) {
      html += '<tr><td><strong>' + escapeHtml(row.date) + '</strong></td><td>' + (row.order_count || 0) + ' pesanan</td><td><strong>' + formatMoney(row.revenue || 0) + '</strong></td></tr>';
    });
    html += '</tbody></table>';
    if (tableEl) tableEl.innerHTML = html;
  }

  function renderSalesReport(data, cardsEl, tableEl) {
    var summary = data.summary || {};
    if (cardsEl) {
      cardsEl.innerHTML =
        '<div class="x-metric-card"><div class="x-metric-icon bg-green">💰</div><div class="x-metric-info"><span class="x-metric-label">Total Omzet</span><h3 class="x-metric-value">' + formatMoney(summary.gross_revenue || 0) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-blue">📦</div><div class="x-metric-info"><span class="x-metric-label">Total Pesanan</span><h3 class="x-metric-value">' + (summary.total_orders || 0) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-amber">🛵</div><div class="x-metric-info"><span class="x-metric-label">Total Ongkir</span><h3 class="x-metric-value">' + formatMoney(summary.total_delivery_fees || 0) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-green">🎯</div><div class="x-metric-info"><span class="x-metric-label">Rata-rata Nilai (AOV)</span><h3 class="x-metric-value">' + formatMoney(summary.average_order_value || 0) + '</h3></div></div>';
    }

    var byChannel = data.by_channel || [];
    var byFulfillment = data.by_fulfillment || [];

    if (byChannel.length === 0 && byFulfillment.length === 0) {
      if (tableEl) tableEl.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">📊</div>Belum ada transaksi penjualan tercatat.</div>';
      return;
    }

    var html = '<h4 style="font-size:14px;font-weight:700;margin-bottom:10px;">Penjualan per Channel</h4>';
    html += '<table class="x-data-table mb-4"><thead><tr><th>Channel</th><th>Pesanan</th><th>Omzet</th></tr></thead><tbody>';
    byChannel.forEach(function (c) {
      html += '<tr><td><span class="x-badge">' + escapeHtml(c.order_channel || 'customer_app') + '</span></td><td>' + (c.order_count || 0) + '</td><td><strong>' + formatMoney(c.total_revenue || 0) + '</strong></td></tr>';
    });
    html += '</tbody></table>';

    html += '<h4 style="font-size:14px;font-weight:700;margin:20px 0 10px;">Penjualan per Fulfillment Type</h4>';
    html += '<table class="x-data-table"><thead><tr><th>Fulfillment</th><th>Pesanan</th><th>Omzet</th></tr></thead><tbody>';
    byFulfillment.forEach(function (f) {
      html += '<tr><td><span class="x-badge" style="background:#ecfdf5;color:#065f46;">' + escapeHtml(f.fulfillment_type || 'delivery') + '</span></td><td>' + (f.order_count || 0) + '</td><td><strong>' + formatMoney(f.total_revenue || 0) + '</strong></td></tr>';
    });
    html += '</tbody></table>';

    if (tableEl) tableEl.innerHTML = html;
  }

  function renderProductsReport(data, cardsEl, tableEl) {
    var topProducts = data.top_products || [];
    var categories = data.category_contribution || [];

    if (cardsEl) {
      var totalUnits = topProducts.reduce(function (sum, p) { return sum + (p.total_units_sold || 0); }, 0);
      var totalSales = topProducts.reduce(function (sum, p) { return sum + (p.total_gross_sales || 0); }, 0);

      cardsEl.innerHTML =
        '<div class="x-metric-card"><div class="x-metric-icon bg-green">🍔</div><div class="x-metric-info"><span class="x-metric-label">Item Terjual</span><h3 class="x-metric-value">' + totalUnits + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-blue">💰</div><div class="x-metric-info"><span class="x-metric-label">Penjualan Produk</span><h3 class="x-metric-value">' + formatMoney(totalSales) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-amber">🏷️</div><div class="x-metric-info"><span class="x-metric-label">Kategori Aktif</span><h3 class="x-metric-value">' + categories.length + '</h3></div></div>';
    }

    if (topProducts.length === 0) {
      if (tableEl) tableEl.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">🍔</div>Belum ada data penjualan menu pada filter ini.</div>';
      return;
    }

    var html = '<table class="x-data-table"><thead><tr><th>Produk</th><th>Kategori</th><th>Total Terjual</th><th>Total Omzet</th></tr></thead><tbody>';
    topProducts.forEach(function (p) {
      html += '<tr><td><strong>' + escapeHtml(p.product_name) + '</strong></td><td><span class="x-badge">' + escapeHtml(p.category_name || 'Uncategorized') + '</span></td><td>' + (p.total_units_sold || 0) + ' item</td><td><strong>' + formatMoney(p.total_gross_sales || 0) + '</strong></td></tr>';
    });
    html += '</tbody></table>';

    if (tableEl) tableEl.innerHTML = html;
  }

  function renderCustomersReport(data, cardsEl, tableEl) {
    var summary = data.summary || {};
    var customers = data.top_customers || [];

    if (cardsEl) {
      cardsEl.innerHTML =
        '<div class="x-metric-card"><div class="x-metric-icon bg-blue">👥</div><div class="x-metric-info"><span class="x-metric-label">Pelanggan Unik</span><h3 class="x-metric-value">' + (summary.total_unique_customers || 0) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-green">📦</div><div class="x-metric-info"><span class="x-metric-label">Total Pesanan</span><h3 class="x-metric-value">' + (summary.total_orders || 0) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-amber">💰</div><div class="x-metric-info"><span class="x-metric-label">Rata-rata Belanja</span><h3 class="x-metric-value">' + formatMoney(summary.average_spend_per_customer || 0) + '</h3></div></div>';
    }

    if (customers.length === 0) {
      if (tableEl) tableEl.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">👥</div>Belum ada data pelanggan dengan riwayat transaksi.</div>';
      return;
    }

    var html = '<table class="x-data-table"><thead><tr><th>Nama Pelanggan</th><th>No. WhatsApp</th><th>Total Transaksi</th><th>Total Belanja</th><th>Pesanan Terakhir</th></tr></thead><tbody>';
    customers.forEach(function (c) {
      html += '<tr>' +
        '<td><strong>' + escapeHtml(c.customer_name || 'Pelanggan') + '</strong></td>' +
        '<td>' + escapeHtml(c.customer_phone || '-') + '</td>' +
        '<td>' + (c.total_orders || 0) + ' pesanan</td>' +
        '<td><strong style="color:#059669;">' + formatMoney(c.total_spent || 0) + '</strong></td>' +
        '<td><span class="text-muted">' + escapeHtml(c.last_order_date || '-') + '</span></td>' +
      '</tr>';
    });
    html += '</tbody></table>';

    if (tableEl) tableEl.innerHTML = html;
  }

  function renderBranchesReport(data, cardsEl, tableEl) {
    var branches = data.branches || [];

    if (cardsEl) {
      var totalRev = branches.reduce(function (sum, b) { return sum + (b.total_revenue || 0); }, 0);
      var totalOrd = branches.reduce(function (sum, b) { return sum + (b.total_orders || 0); }, 0);

      cardsEl.innerHTML =
        '<div class="x-metric-card"><div class="x-metric-icon bg-green">🏢</div><div class="x-metric-info"><span class="x-metric-label">Jumlah Cabang</span><h3 class="x-metric-value">' + branches.length + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-blue">💰</div><div class="x-metric-info"><span class="x-metric-label">Total Omzet Jaringan</span><h3 class="x-metric-value">' + formatMoney(totalRev) + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-amber">📦</div><div class="x-metric-info"><span class="x-metric-label">Total Pesanan Seluruh Cabang</span><h3 class="x-metric-value">' + totalOrd + '</h3></div></div>';
    }

    if (branches.length === 0) {
      if (tableEl) tableEl.innerHTML = '<div class="x-empty-state"><div class="x-empty-state-icon">🏢</div>Belum ada data cabang.</div>';
      return;
    }

    var html = '<table class="x-data-table"><thead><tr><th>Cabang</th><th>Total Pesanan</th><th>AOV</th><th>Total Omzet</th></tr></thead><tbody>';
    branches.forEach(function (b) {
      html += '<tr>' +
        '<td><strong>' + escapeHtml(b.branch_name) + '</strong></td>' +
        '<td>' + (b.total_orders || 0) + '</td>' +
        '<td>' + formatMoney(b.average_order_value || 0) + '</td>' +
        '<td><strong style="color:#059669;">' + formatMoney(b.total_revenue || 0) + '</strong></td>' +
      '</tr>';
    });
    html += '</tbody></table>';

    if (tableEl) tableEl.innerHTML = html;
  }

  function renderOperationsReport(data, cardsEl, tableEl) {
    var alerts = data.low_stock_alerts || [];
    var movements = data.movement_breakdown || [];

    if (cardsEl) {
      cardsEl.innerHTML =
        '<div class="x-metric-card"><div class="x-metric-icon bg-amber">⚠️</div><div class="x-metric-info"><span class="x-metric-label">Alert Stok Menipis</span><h3 class="x-metric-value">' + alerts.length + '</h3></div></div>' +
        '<div class="x-metric-card"><div class="x-metric-icon bg-blue">🔄</div><div class="x-metric-info"><span class="x-metric-label">Tipe Mutasi Stok</span><h3 class="x-metric-value">' + movements.length + '</h3></div></div>';
    }

    var html = '<h4 style="font-size:14px;font-weight:700;margin-bottom:10px;">Daftar Item Stok Menipis (Di Bawah Threshold)</h4>';
    if (alerts.length === 0) {
      html += '<p class="text-muted" style="font-size:13px;margin-bottom:20px;">✅ Seluruh item berada di atas batas minimum stok.</p>';
    } else {
      html += '<table class="x-data-table mb-4"><thead><tr><th>Cabang</th><th>Nama Produk</th><th>Sisa Stok</th><th>Batas Minimum</th></tr></thead><tbody>';
      alerts.forEach(function (a) {
        html += '<tr>' +
          '<td>' + escapeHtml(a.branch_name || '-') + '</td>' +
          '<td><strong>' + escapeHtml(a.product_name) + '</strong></td>' +
          '<td><span class="x-badge" style="background:#fee2e2;color:#991b1b;font-weight:700;">' + a.current_stock + ' unit</span></td>' +
          '<td>' + a.low_stock_threshold + ' unit</td>' +
        '</tr>';
      });
      html += '</tbody></table>';
    }

    if (movements.length > 0) {
      html += '<h4 style="font-size:14px;font-weight:700;margin:20px 0 10px;">Ringkasan Mutasi Persediaan</h4>';
      html += '<table class="x-data-table"><thead><tr><th>Tipe Mutasi</th><th>Jumlah Catatan</th><th>Total Kuantitas</th></tr></thead><tbody>';
      movements.forEach(function (m) {
        html += '<tr>' +
          '<td><span class="x-badge">' + escapeHtml(m.movement_type) + '</span></td>' +
          '<td>' + (m.record_count || 0) + ' transaksi</td>' +
          '<td>' + (m.total_quantity || 0) + '</td>' +
        '</tr>';
      });
      html += '</tbody></table>';
    }

    if (tableEl) tableEl.innerHTML = html;
  }

  function initReportsControls() {
    // Subnav click listener
    document.querySelectorAll('#reports-subnav .x-subnav-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var reportType = tab.dataset.report;
        navigateTo('reports/' + reportType);
      });
    });

    // Date filter controls
    var btnFilter = $('btn-report-filter');
    var btnReset = $('btn-report-reset');
    var inputStart = $('report-start-date');
    var inputEnd = $('report-end-date');

    if (btnFilter) {
      btnFilter.addEventListener('click', function () {
        _reportFilter.startDate = inputStart ? inputStart.value : '';
        _reportFilter.endDate = inputEnd ? inputEnd.value : '';
        loadReports();
      });
    }

    if (btnReset) {
      btnReset.addEventListener('click', function () {
        if (inputStart) inputStart.value = '';
        if (inputEnd) inputEnd.value = '';
        _reportFilter.startDate = '';
        _reportFilter.endDate = '';
        loadReports();
      });
    }
  }

  /* =========================================================================
     MODUL 0: MERCHANT AUTH & SESSION GUARD
     ========================================================================= */
  function getStoredUser() {
    try {
      var u = localStorage.getItem(USER_KEY);
      return u ? JSON.parse(u) : null;
    } catch (_) { return null; }
  }

  function isBranchManager() {
    var user = getStoredUser();
    return user && user.role === 'branch_manager';
  }

  /**
   * Hides/shows UI panels depending on the logged-in user's role.
   * - branch_manager → shows inline Branch Catalog panel, hides Owner CRUD panel
   *                     hides sidebar items that are owner-only (Brand, Cabang, Payment)
   * - owner / brand_manager → shows Owner CRUD panel, hides branch panel
   */
  function applyRoleBasedUI() {
    var user = getStoredUser();
    if (!user) return;

    var role = user.role;
    var isBM = role === 'branch_manager';

    // Catalog tab panels
    var ownerPanel = $('panel-owner-catalog');
    var branchPanel = $('panel-branch-catalog');
    if (ownerPanel) ownerPanel.style.display = isBM ? 'none' : '';
    if (branchPanel) branchPanel.style.display = isBM ? '' : 'none';

    // Role-based sidebar nav item visibility
    if (isBM) {
      renderBranchManagerNavigation();
    } else {
      var isStaff = role === 'cashier' || role === 'kitchen';
      document.querySelectorAll('.x-nav-item').forEach(function (btn) {
        var target = btn.dataset.route || btn.dataset.tab;
        if (isStaff && (target === 'team' || target === 'settings' || target === 'branches' || target === 'customers' || target === 'marketing' || target === 'finance')) {
          btn.style.display = 'none';
        }
      });
    }

    // Marketing campaign builder button is exclusive to Owner
    var btnCreatePromo = $('btn-mkt-create-promo');
    if (btnCreatePromo) {
      btnCreatePromo.style.display = (role === 'owner') ? 'inline-flex' : 'none';
    }

    // Role-Aware Portal Label in sidebar badge
    var portalBadge = document.querySelector('.x-dash-badge-pro');
    if (portalBadge) {
      if (role === 'owner') {
        portalBadge.textContent = 'Owner Portal';
      } else if (role === 'brand_manager') {
        portalBadge.textContent = 'Brand Portal';
      } else if (role === 'branch_manager') {
        portalBadge.textContent = 'Branch Portal';
      } else if (role === 'cashier') {
        portalBadge.textContent = 'Cashier Portal';
      } else {
        portalBadge.textContent = (role ? role.replace(/_/g, ' ') : 'Merchant') + ' Portal';
      }
    }

    // Topbar brand badge: hide for branch_manager (redundant with sidebar), show for owner/brand_manager
    var topbarBrandBadge = $('topbar-brand-badge');
    if (topbarBrandBadge) {
      topbarBrandBadge.style.display = isBM ? 'none' : 'flex';
    }

    // Global search affordance: hide non-functional affordance to avoid misleading placeholder
    var searchBtn = $('btn-global-search');
    if (searchBtn) {
      searchBtn.style.display = 'none';
    }

    // Set branch context visibility and locking
    var branchSelectorWrap = $('x-branch-selector');
    var bmBranchBadge = $('dash-bm-branch-badge');
    var branchSelector = $('dash-branch-context');

    if (isBM) {
      if (branchSelectorWrap) branchSelectorWrap.style.display = 'none';
      if (bmBranchBadge) bmBranchBadge.style.display = 'flex';
      if (user.branch_id) {
        currentManagingBranchId = user.branch_id;
        _branchContextState.selected = user.branch_id;
        if (branchSelector) {
          branchSelector.value = user.branch_id;
          branchSelector.disabled = true;
        }
      }
    } else if (role === 'cashier' || role === 'kitchen') {
      if (branchSelectorWrap) branchSelectorWrap.style.display = 'none';
      if (bmBranchBadge) bmBranchBadge.style.display = 'none';
      if (branchSelector) {
        branchSelector.disabled = true;
      }
    } else {
      // owner or brand_manager
      if (branchSelectorWrap) branchSelectorWrap.style.display = 'flex';
      if (bmBranchBadge) bmBranchBadge.style.display = 'none';
      if (branchSelector) {
        branchSelector.disabled = false;
      }
    }
  }

  function checkAuth() {
    var token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      if (typeof checkAppRoute === 'function') {
        checkAppRoute();
      } else if (!window.location.pathname.includes('login')) {
        window.location.href = '/dashboard/login';
      }
      return false;
    }

    var user = getStoredUser();
    if (user) {
      if ($('dash-user-name')) $('dash-user-name').textContent = user.full_name || user.username || 'Pemilik Toko';
      if ($('dash-user-avatar')) $('dash-user-avatar').textContent = (user.full_name || user.username || 'A').charAt(0).toUpperCase();
      if ($('dash-user-role')) $('dash-user-role').textContent = (user.role || 'Owner').toUpperCase();
    }
    return true;
  }

  // Check URL parameters for single-use handoff ticket from xentra.cloud.
  // Exchanges ticket via POST, stores returned session token, and immediately scrubs the ticket from URL.
  // CRITICAL SECURITY INVARIANT: Session tokens (xnt_auth_*) are NEVER exposed in the URL.
  async function handleHandoffExchange() {
    var urlParams = new URLSearchParams(window.location.search);
    var handoffTicket = urlParams.get('handoff');
    if (!handoffTicket) return false;

    // Immediately scrub ticket parameter from URL history to prevent URL leak or replay
    urlParams.delete('handoff');
    var cleanQuery = urlParams.toString();
    var cleanUrl = window.location.pathname + (cleanQuery ? '?' + cleanQuery : '') + window.location.hash;
    window.history.replaceState({}, document.title, cleanUrl);

    try {
      var res = await fetch(API_BASE + '/auth/handoff/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: handoffTicket })
      });
      var data = await res.json();
      if (res.ok && data && data.success && data.token) {
        localStorage.setItem(TOKEN_KEY, data.token);
        if (data.user) {
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        }
        return true;
      } else {
        console.warn('[Handoff exchange failed]:', data && (data.error || data.message));
        clearStoredSession();
        redirectToLogin();
        return false;
      }
    } catch (err) {
      console.error('[Handoff exchange network error]:', err);
      clearStoredSession();
      redirectToLogin();
      return false;
    }
  }

  // Server-side session validation at boot: a token that exists locally but is
  // not valid on the server (401 INVALID_OR_EXPIRED_TOKEN) must force a real
  // login instead of letting the dashboard render an empty/fake state.
  async function validateServerSession() {
    var token = localStorage.getItem(TOKEN_KEY);
    if (!token) return false;
    try {
      var res = await adminFetch(API_BASE + '/auth/merchant/me', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data && data.success) {
        if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        return true;
      }
      clearStoredSession();
      redirectToLogin();
      return false;
    } catch (e) {
      // adminFetch already cleared + redirected on 401; keep the session on
      // network-level errors (server unreachable is not an expired session).
      return e && e.message === 'SESSION_EXPIRED' ? false : true;
    }
  }

  function initAuthListeners() {
    var btnLogout = $('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', function () {
        if (!confirm('Apakah Anda ingin keluar dari Dashboard?')) return;
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        if (typeof checkAppRoute === 'function') {
          checkAppRoute();
        } else {
          window.location.href = '/dashboard/login';
        }
      });
    }
  }

  /* =========================================================================
     MODUL 3.2: BRANCH CATALOG INLINE PANEL
     (Used when role = branch_manager — renders directly in tab-catalog)
     ========================================================================= */

  var branchCatalogFilter = 'all'; // active branch category filter ('all' or catId)

  function getActiveBranchId() {
    if (currentManagingBranchId) return currentManagingBranchId;
    if (currentBranchCatalogData && currentBranchCatalogData.branch && currentBranchCatalogData.branch.id) {
      return currentBranchCatalogData.branch.id;
    }
    if (_bceCurrentCat && _bceCurrentCat.branch_id) {
      return _bceCurrentCat.branch_id;
    }
    var user = getStoredUser();
    if (user && user.branch_id) return user.branch_id;
    return null;
  }

  async function loadInlineBranchCatalog() {
    var branchId = getActiveBranchId();
    if (!branchId) return;
    currentManagingBranchId = branchId;

    var adoptedEl = $('branch-inline-adopted-container');
    var availableEl = $('branch-inline-available-container');
    var catsEl = $('branch-inline-categories-bar');
    if (adoptedEl) adoptedEl.innerHTML = '<p class="text-muted" style="font-size:13px;">Memuat menu aktif cabang...</p>';
    if (availableEl) availableEl.innerHTML = '<p class="text-muted" style="font-size:13px;">Memuat rekomendasi Owner...</p>';
    if (catsEl) catsEl.innerHTML = '<span class="text-muted" style="font-size:13px;">Memuat kategori...</span>';

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/catalog', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!data.success) {
        showToast('\u274C ' + (data.error || 'Gagal memuat katalog cabang.'));
        return;
      }

      currentBranchCatalogData = data;

      var categories = data.categories || [];
      var adopted = data.adopted_products || [];
      var available = data.available_master_products || [];

      // Update subtitle
      var subtitle = $('branch-catalog-subtitle');
      if (subtitle && data.branch) subtitle.textContent = 'Cabang: ' + data.branch.name;

      // Update counts
      if ($('branch-inline-cat-count')) $('branch-inline-cat-count').textContent = categories.length;
      if ($('branch-inline-active-count')) $('branch-inline-active-count').textContent = adopted.length;
      if ($('branch-inline-available-count')) $('branch-inline-available-count').textContent = available.length;

      renderInlineCategoriesBar(categories);
      renderInlineAdoptedProducts(adopted, branchCatalogFilter);
      renderInlineAvailableProducts(available);
    } catch (err) {
      console.error('[Inline Branch Catalog Error]:', err);
      showToast('\u274C Kesalahan jaringan saat memuat katalog cabang.');
    }
  }

  var _dragSrcCatId = null; // ID of the category being dragged
  var _dragSrcEl = null;   // DOM element being dragged

  function renderInlineCategoriesBar(categories) {
    var bar = $('branch-inline-categories-bar');
    if (!bar) return;

    bar.innerHTML = ''; // clear

    // "Semua" chip — not draggable
    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'x-cat-filter-btn' + (branchCatalogFilter === 'all' ? ' active' : '');
    allBtn.style.borderRadius = '20px';
    allBtn.textContent = 'Semua';
    allBtn.addEventListener('click', function () { setBranchCatalogFilter('all'); });
    bar.appendChild(allBtn);

    if (!categories.length) {
      var hint = document.createElement('span');
      hint.className = 'text-muted';
      hint.style.fontSize = '12px';
      hint.textContent = 'Belum ada kategori. Klik "+ Tambah Kategori" untuk membuat.';
      bar.appendChild(hint);
      return;
    }

    categories.forEach(function (cat) {
      var isActive = branchCatalogFilter === cat.id;

      // Outer chip wrapper — represents the category item in the list
      var chip = document.createElement('span');
      chip.dataset.catId = cat.id;
      chip.draggable = true;
      chip.style.cssText = [
        'display:inline-flex;align-items:center;gap:0;border-radius:20px;overflow:hidden;',
        'border:1px solid ' + (isActive ? 'var(--x-primary,#b6ff00)' : '#e2e8f0') + ';',
        'background:' + (isActive ? '#f0ffe0' : '#f8fafc') + ';',
        'transition:box-shadow 0.15s,opacity 0.15s;',
        'cursor:grab;'
      ].join('');

      // Drag handle indicator
      var handle = document.createElement('span');
      handle.title = 'Tahan & geser untuk ubah urutan';
      handle.style.cssText = 'padding:5px 4px 5px 10px;font-size:13px;color:#94a3b8;cursor:grab;user-select:none;';
      handle.textContent = '⠿';
      chip.appendChild(handle);

      // Small square thumbnail so admins can see the persisted category image
      var thumbWrap = document.createElement('span');
      thumbWrap.style.cssText = 'width:22px;height:22px;border-radius:6px;overflow:hidden;background:#eef2f6;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:2px;';
      if (cat.image_url) {
        var thumbImg = document.createElement('img');
        thumbImg.src = cat.image_url;
        thumbImg.alt = '';
        thumbImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        thumbWrap.appendChild(thumbImg);
      } else {
        var thumbMono = document.createElement('span');
        thumbMono.style.cssText = 'font-size:10px;font-weight:700;color:#94a3b8;';
        thumbMono.textContent = (cat.name || '?').trim().slice(0, 1).toUpperCase();
        thumbWrap.appendChild(thumbMono);
      }
      chip.appendChild(thumbWrap);

      // Category name / filter button
      var nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.draggable = false;
      nameBtn.style.cssText = 'border:none;background:none;padding:6px 8px 6px 2px;font-size:13px;font-weight:' + (isActive ? '700' : '500') + ';cursor:pointer;color:#1e293b;';
      nameBtn.textContent = cat.name;
      nameBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        setBranchCatalogFilter(cat.id);
      });
      chip.appendChild(nameBtn);

      // Edit button
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.draggable = false;
      editBtn.title = 'Ubah nama & gambar';
      editBtn.style.cssText = 'border:none;background:none;padding:5px 5px;font-size:12px;cursor:pointer;color:#64748b;';
      editBtn.textContent = '✏️';
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openBranchCategoryEditModal(cat);
      });
      chip.appendChild(editBtn);

      // Delete button
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.draggable = false;
      delBtn.title = 'Hapus kategori';
      delBtn.style.cssText = 'border:none;background:none;padding:6px 10px 6px 4px;font-size:12px;cursor:pointer;color:#ef4444;opacity:0.8;';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteBranchCategory(cat.id, cat.name);
      });
      chip.appendChild(delBtn);

      // ── HTML5 Drag Events ──
      chip.addEventListener('dragstart', function (e) {
        _dragSrcCatId = cat.id;
        _dragSrcEl = chip;
        chip.style.cursor = 'grabbing';
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', cat.id);
        setTimeout(function () {
          chip.style.opacity = '0.4';
          chip.style.transform = 'scale(0.96)';
        }, 0);
      });

      chip.addEventListener('dragend', function () {
        chip.style.opacity = '1';
        chip.style.cursor = 'grab';
        chip.style.transform = '';
        bar.querySelectorAll('[data-cat-id]').forEach(function (el) {
          el.style.borderLeft = '';
          el.style.borderRight = '';
          el.style.boxShadow = '';
        });
      });

      chip.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (chip !== _dragSrcEl) {
          var rect = chip.getBoundingClientRect();
          var midX = rect.left + rect.width / 2;
          if (e.clientX < midX) {
            chip.style.borderLeft = '3px solid var(--x-primary,#10b981)';
            chip.style.borderRight = '';
          } else {
            chip.style.borderLeft = '';
            chip.style.borderRight = '3px solid var(--x-primary,#10b981)';
          }
        }
      });

      chip.addEventListener('dragleave', function () {
        chip.style.borderLeft = '';
        chip.style.borderRight = '';
      });

      chip.addEventListener('drop', function (e) {
        e.preventDefault();
        chip.style.borderLeft = '';
        chip.style.borderRight = '';
        if (!_dragSrcCatId || _dragSrcCatId === cat.id || !_dragSrcEl) return;

        var rect = chip.getBoundingClientRect();
        var midX = rect.left + rect.width / 2;
        var insertBefore = e.clientX < midX;

        if (insertBefore) {
          bar.insertBefore(_dragSrcEl, chip);
        } else {
          bar.insertBefore(_dragSrcEl, chip.nextSibling);
        }

        // Build new order from DOM
        var newOrder = Array.from(bar.querySelectorAll('[data-cat-id]')).map(function (el) {
          return el.dataset.catId;
        });

        // Persist to server
        saveBranchCategoryOrder(newOrder);
      });
      // ──────────────────────────────────────────────────────────

      bar.appendChild(chip);
    });
  }

  async function saveBranchCategoryOrder(orderedIds) {
    var branchId = getActiveBranchId();
    if (!branchId) {
      showToast('❌ Cabang tidak valid atau belum dipilih.');
      return;
    }
    currentManagingBranchId = branchId;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + branchId + '/categories/reorder', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ order: orderedIds })
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Urutan kategori disimpan — tampilan pelanggan diperbarui.');
        // Update local data so filter still works after re-render
        if (currentBranchCatalogData && currentBranchCatalogData.categories) {
          var catMap = {};
          currentBranchCatalogData.categories.forEach(function (c) { catMap[c.id] = c; });
          currentBranchCatalogData.categories = orderedIds
            .map(function (id) { return catMap[id]; })
            .filter(Boolean);
          if ($('branch-inline-cat-count')) {
            $('branch-inline-cat-count').textContent = currentBranchCatalogData.categories.length;
          }
        }
      } else {
        showToast('❌ ' + (data.error || 'Gagal menyimpan urutan kategori.'));
        loadInlineBranchCatalog(); // reload to restore correct order
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan saat menyimpan urutan.');
      loadInlineBranchCatalog();
    }
  }


  window.setBranchCatalogFilter = function (catId) {
    branchCatalogFilter = catId;
    if (!currentBranchCatalogData) return;

    var categories = currentBranchCatalogData.categories || [];
    var adopted = currentBranchCatalogData.adopted_products || [];

    // Update filter label
    var label = $('branch-inline-filter-label');
    if (label) {
      if (catId === 'all') {
        label.textContent = 'Semua kategori';
      } else {
        var cat = categories.find(function (c) { return c.id === catId; });
        label.textContent = 'Filter: ' + (cat ? cat.name : catId);
      }
    }

    renderInlineCategoriesBar(categories);
    renderInlineAdoptedProducts(adopted, catId);
  };

  // ── Branch Category Edit Modal (name + image) ──────────────────────────
  var _bceSelectedFile = null; // File object staged for upload on save
  var _bceCropSpec = null;
  var _bceCurrentCat = null;   // Active category being edited

  window.openBranchCategoryCreateModal = function () {
    _bceSelectedFile = null;
    _bceCropSpec = null;
    _bceCurrentCat = null;
    if ($('bce-cat-id')) $('bce-cat-id').value = '';
    if ($('bce-name')) $('bce-name').value = '';
    if ($('bce-image-file')) $('bce-image-file').value = '';

    var titleEl = $('branch-category-modal-title');
    if (titleEl) titleEl.textContent = 'Tambah Kategori Cabang';
    var saveBtn = $('btn-save-branch-category-edit');
    if (saveBtn) saveBtn.textContent = 'Tambah Kategori';

    var previewImg = $('bce-image-preview');
    var previewMono = $('bce-image-preview-mono');
    if (previewImg) previewImg.style.display = 'none';
    if (previewMono) {
      previewMono.style.display = 'block';
      previewMono.textContent = '+';
    }

    var modal = $('modal-branch-category-edit');
    if (modal) modal.style.display = 'flex';
  };

  window.openBranchCategoryEditModal = function (cat) {
    _bceSelectedFile = null;
    _bceCropSpec = null;
    _bceCurrentCat = cat || null;
    if ($('bce-cat-id')) $('bce-cat-id').value = cat ? cat.id : '';
    if ($('bce-name')) $('bce-name').value = (cat && cat.name) || '';
    if ($('bce-image-file')) $('bce-image-file').value = '';

    var titleEl = $('branch-category-modal-title');
    if (titleEl) titleEl.textContent = 'Ubah Kategori Cabang';
    var saveBtn = $('btn-save-branch-category-edit');
    if (saveBtn) saveBtn.textContent = 'Simpan';

    var previewImg = $('bce-image-preview');
    var previewMono = $('bce-image-preview-mono');
    if (cat && cat.image_url) {
      previewImg.src = cat.image_url;
      previewImg.style.display = 'block';
      previewMono.style.display = 'none';
    } else {
      previewImg.style.display = 'none';
      previewMono.style.display = 'block';
      previewMono.textContent = ((cat && cat.name) || '?').trim().slice(0, 1).toUpperCase();
    }

    var modal = $('modal-branch-category-edit');
    if (modal) modal.style.display = 'flex';
  };

  window.closeBranchCategoryEditModal = function () {
    var modal = $('modal-branch-category-edit');
    if (modal) modal.style.display = 'none';
    _bceSelectedFile = null;
    _bceCropSpec = null;
    _bceCurrentCat = null;
  };

  (function initBranchCategoryEditModal() {
    var fileInput = $('bce-image-file');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) { _bceSelectedFile = null; _bceCropSpec = null; return; }

        var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.indexOf(file.type) === -1) {
          showToast('❌ Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.');
          fileInput.value = '';
          return;
        }
        if (file.size > 15 * 1024 * 1024) {
          showToast('❌ Ukuran gambar melebihi batas maksimal 15MB.');
          fileInput.value = '';
          return;
        }

        _bceSelectedFile = file;

        XentraCropEditor.open({
          source: file,
          assetType: 'category',
          aspectRatio: 1.0,
          title: 'Potong & Posisikan Gambar Kategori (1:1)',
          onConfirm: function (cropSpec, previewDataUrl) {
            _bceCropSpec = cropSpec;
            var previewImg = $('bce-image-preview');
            var previewMono = $('bce-image-preview-mono');
            if (previewImg) {
              previewImg.src = previewDataUrl || URL.createObjectURL(file);
              previewImg.style.display = 'block';
            }
            if (previewMono) previewMono.style.display = 'none';
            showToast('✓ Potongan gambar kategori disesuaikan.');
          },
          onCancel: function () {
            var reader = new FileReader();
            reader.onload = function (e) {
              var previewImg = $('bce-image-preview');
              var previewMono = $('bce-image-preview-mono');
              previewImg.src = e.target.result;
              previewImg.style.display = 'block';
              if (previewMono) previewMono.style.display = 'none';
            };
            reader.readAsDataURL(file);
          }
        });
      });
    }

    var form = $('form-branch-category-edit');
    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();

        var catId = $('bce-cat-id').value;
        var newName = $('bce-name').value.trim();
        if (!newName) {
          showToast('❌ Nama kategori wajib diisi.');
          return;
        }

        var activeBranchId = getActiveBranchId();
        if (!activeBranchId) {
          showToast('❌ Cabang tidak valid atau belum dipilih.');
          return;
        }
        currentManagingBranchId = activeBranchId;

        var saveBtn = $('btn-save-branch-category-edit');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Menyimpan...'; }

        try {
          var targetCatId = catId;

          if (!catId) {
            // CREATE new branch category
            var createRes = await adminFetch(API_BASE + '/admin/branches/' + activeBranchId + '/categories', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify({ name: newName })
            });
            var createData = await createRes.json();
            if (!createRes.ok || !createData.success) {
              showToast('❌ ' + (createData.error || createData.message || 'Gagal membuat kategori cabang.'));
              return;
            }
            targetCatId = createData.category && createData.category.id;
          } else {
            // 1. Rename existing
            var renameRes = await adminFetch(API_BASE + '/admin/branches/' + activeBranchId + '/categories/' + catId, {
              method: 'PATCH',
              headers: getAuthHeaders(),
              body: JSON.stringify({ name: newName })
            });
            var renameData = {};
            try {
              renameData = await renameRes.json();
            } catch (_) {
              renameData = { success: false, error: 'Respon server tidak valid saat mengubah nama kategori.' };
            }

            if (!renameRes.ok || !renameData.success) {
              showToast('❌ ' + (renameData.error || renameData.message || 'Gagal mengubah nama kategori.'));
              return;
            }
          }

          // 2. Image (only if a new file was staged) — uploaded as base64 to backend
          if (_bceSelectedFile && targetCatId) {
            var base64 = await new Promise(function (resolve, reject) {
              var reader = new FileReader();
              reader.onload = function () { resolve(reader.result); };
              reader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
              reader.readAsDataURL(_bceSelectedFile);
            });

            var catImgPayload = { image_base64: base64, mime_type: _bceSelectedFile.type };
            if (_bceCropSpec) {
              catImgPayload.crop_spec = _bceCropSpec;
            }

            var imageRes = await adminFetch(API_BASE + '/admin/branches/' + activeBranchId + '/categories/' + targetCatId + '/image', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify(catImgPayload)
            });
            var imageData = {};
            try {
              imageData = await imageRes.json();
            } catch (_) {
              imageData = { success: false, error: 'Respon server tidak valid saat mengunggah gambar.' };
            }

            if (!imageRes.ok || !imageData.success) {
              showToast('❌ ' + (imageData.error || imageData.message || 'Gagal mengunggah gambar kategori.'));
              return;
            }
          }

          showToast(catId ? '✅ Kategori berhasil diperbarui!' : '✅ Kategori cabang berhasil dibuat!');
          closeBranchCategoryEditModal();
          if (typeof loadBMMenu === 'function' && isBranchManager()) {
            loadBMMenu();
          }
          if (typeof loadInlineBranchCatalog === 'function') {
            loadInlineBranchCatalog();
          }
        } catch (err) {
          console.error('[Branch Category Save Error]:', err);
          showToast('❌ ' + (err.message || 'Kesalahan jaringan saat menyimpan kategori.'));
        } finally {
          if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = catId ? 'Simpan' : 'Tambah Kategori'; }
        }
      });
    }
  })();

  window.deleteBranchCategory = async function (catId, catName) {
    if (!confirm('Hapus kategori "' + catName + '"? Produk di kategori ini tidak akan dihapus, hanya dipindah ke tanpa kategori.')) return;

    var branchId = getActiveBranchId();
    if (!branchId) {
      showToast('❌ Cabang tidak valid atau belum dipilih.');
      return;
    }
    currentManagingBranchId = branchId;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + branchId + '/categories/' + catId, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Kategori dihapus.');
        if (branchCatalogFilter === catId) branchCatalogFilter = 'all';
        if (typeof loadBMMenu === 'function' && isBranchManager()) loadBMMenu();
        loadInlineBranchCatalog();
      } else {
        showToast('❌ ' + (data.error || 'Gagal menghapus kategori.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };


  function renderInlineAdoptedProducts(adopted, filterCatId) {
    var container = $('branch-inline-adopted-container');
    if (!container) return;

    // Apply category filter if not 'all'
    var filtered = adopted;
    if (filterCatId && filterCatId !== 'all') {
      filtered = adopted.filter(function (p) {
        if (p.category_ids && Array.isArray(p.category_ids)) {
          return p.category_ids.map(String).indexOf(String(filterCatId)) !== -1;
        }
        return String(p.branch_category_id) === String(filterCatId);
      });
    }

    if (!filtered.length) {
      var msg = filterCatId && filterCatId !== 'all'
        ? 'Belum ada menu di kategori ini. Adopsi produk dari Owner dan pilih kategori ini saat mengadopsi.'
        : 'Belum ada menu yang diadopsi. Pilih dari daftar rekomendasi Owner di bawah!';
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">' + msg + '</div>';
      return;
    }

    container.innerHTML = filtered.map(function (p) {
      var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isAvailable = p.is_available === 1 || p.is_available === true;
      var catName = (p.category_names && p.category_names.length)
        ? p.category_names.join(', ')
        : (p.branch_category_name || 'Tanpa Kategori');
      var modeBadge = p.pricing_mode === 'range'
        ? '<span class="x-badge x-badge-range">Range (' + formatMoney(p.min_price) + ' - ' + formatMoney(p.max_price) + ')</span>'
        : '<span class="x-badge x-badge-lock">Harga Terkunci</span>';

      var productDataJson = esc(JSON.stringify({
        product_id: p.product_id,
        name: p.name, name_override: p.name_override, master_name: p.master_name,
        description: p.description, description_override: p.description_override, master_description: p.master_description,
        image_url: p.image_url, image_override: p.image_override, master_image_url: p.master_image_url,
        price: p.price, master_price: p.master_price, pricing_mode: p.pricing_mode,
        min_price: p.min_price, max_price: p.max_price,
        branch_category_id: p.branch_category_id,
        category_ids: p.category_ids || (p.branch_category_id ? [p.branch_category_id] : []),
        categories: p.categories || []
      }));

      var availabilityToggle = '' +
        '<label class="x-toggle' + (isAvailable ? ' x-toggle-on' : '') + '" title="' + (isAvailable ? 'Menu tersedia' : 'Menu habis') + '">' +
          '<input type="checkbox" ' + (isAvailable ? 'checked' : '') + ' onchange="toggleBranchProductAvailability(\'' + p.product_id + '\', this.checked ? 1 : 0)" aria-label="Ubah ketersediaan menu cabang">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      return [
        '<div class="x-product-card-simple">',
          '<img src="' + img + '" class="x-product-card-thumb" alt="' + esc(p.name) + '">',
          '<div class="x-product-card-content">',
            '<h5>' + esc(p.name) + '</h5>',
            '<div style="display:flex;gap:4px;flex-wrap:wrap;margin:4px 0;">',
              '<span class="x-badge x-badge-info" style="font-size:10px;">' + esc(catName) + '</span>',
              modeBadge,
            '</div>',
            '<div class="x-product-card-price">Jual: ' + formatMoney(p.price) + ' <small class="text-muted" style="font-weight:normal;">(Owner: ' + formatMoney(p.master_price) + ')</small></div>',
            '<div class="x-product-card-actions">',
              '<div>' + availabilityToggle + '</div>',
              '<div class="x-item-actions">',
                '<button type="button" class="x-action-menu-trigger" aria-label="Aksi menu cabang ' + esc(p.name) + '" onclick="XentraActionMenu.open(this, [' +
                  '{ label: \'Edit Menu Cabang\', icon: \'✏️\', onClick: function() { openBranchOverrideModal(\'' + productDataJson + '\'); } },' +
                  '{ divider: true },' +
                  '{ label: \'Hapus dari Cabang\', icon: \'🗑️\', destructive: true, onClick: function() { removeBranchProduct(\'' + p.product_id + '\', \'' + esc(p.name) + '\'); } }' +
                '])">',
                  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
                '</button>',
              '</div>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }


  function renderInlineAvailableProducts(available) {
    var container = $('branch-inline-available-container');
    if (!container) return;

    if (!available.length) {
      container.innerHTML = '<div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:24px;text-align:center;color:#64748b;font-size:13px;">Semua produk dari katalog Owner telah diadopsi. Cabang ini sudah lengkap!</div>';
      return;
    }

    container.innerHTML = available.map(function (p) {
      var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isRange = p.pricing_mode === 'range';
      var modeBadge = isRange
        ? '<span class="x-badge x-badge-range">Range (' + formatMoney(p.min_price) + ' - ' + formatMoney(p.max_price) + ')</span>'
        : '<span class="x-badge x-badge-lock">Harga Terkunci</span>';

      return [
        '<div class="x-product-card-simple" style="background:#f8fafc;">',
          '<img src="' + img + '" class="x-product-card-thumb" alt="' + esc(p.name) + '">',
          '<div class="x-product-card-content">',
            '<h5>' + esc(p.name) + '</h5>',
            '<div style="margin:4px 0;">' + modeBadge + '</div>',
            '<div class="x-product-card-price">Harga Dasar Owner: ' + formatMoney(p.price) + '</div>',
            '<div class="x-product-card-actions">',
              '<button type="button" class="x-btn-primary" style="padding:6px 12px;font-size:12px;" onclick="openAdoptModal(\'' + p.id + '\')">\uFF0B Adopsi ke Cabang</button>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  // Override removeBranchProduct and toggleBranchProductAvailability to also refresh inline panel
  var _origToggleBranchAvail = window.toggleBranchProductAvailability;
  window.toggleBranchProductAvailability = async function (productId, nextAvail) {
    if (!currentManagingBranchId) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/products/' + productId, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_available: nextAvail })
      });
      var data = await res.json();
      if (data.success) {
        showToast('Ketersediaan menu cabang diperbarui.');
        if (isBranchManager()) loadInlineBranchCatalog();
        else reloadBranchCatalogView();
      } else {
        showToast('\u274C ' + (data.error || 'Gagal mengubah ketersediaan.'));
      }
    } catch (err) {
      showToast('\u274C Kesalahan jaringan.');
    }
  };

  var _origRemoveBranchProduct = window.removeBranchProduct;
  window.removeBranchProduct = async function (productId, productName) {
    if (!currentManagingBranchId) return;
    if (!confirm('Hapus "' + productName + '" dari katalog cabang ini? Menu tidak akan lagi tampil di halaman pemesanan pelanggan.')) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/products/' + productId, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('\u2705 Produk dihapus dari katalog cabang.');
        if (isBranchManager()) loadInlineBranchCatalog();
        else reloadBranchCatalogView();
      } else {
        showToast('\u274C ' + (data.error || 'Gagal menghapus produk.'));
      }
    } catch (err) {
      showToast('\u274C Kesalahan jaringan.');
    }
  };

  // Override adopt form submit to reload inline panel for branch_manager
  var _origFormAdoptSubmit = null;
  (function rewireAdoptSubmit() {
    var formAdoptInline = $('form-adopt-product');
    if (!formAdoptInline) return;
    // We'll patch the success callback — store original handler then re-listen
    // (already set above; we monkey-patch via reload override in openAdoptModal closure)
  })();

  /* =========================================================================
     MODUL: WORKFORCE / TIM MANAGEMENT
     ========================================================================= */
  var _timUsers = [];
  var _timBranches = [];
  var _timRoleFilter = 'all';
  var _timCurrentUserRole = (getStoredUser() || {}).role;

  function _canManageTim() {
    return ['owner', 'brand_manager', 'branch_manager'].indexOf(_timCurrentUserRole) !== -1;
  }

  function _timRoleLabel(role) {
    var labels = { owner: 'Owner', brand_manager: 'Brand Manager', branch_manager: 'Branch Manager', cashier: 'Kasir', kitchen: 'Dapur' };
    return labels[role] || role;
  }

  function _timRoleBadgeClass(role) {
    if (role === 'owner') return 'x-badge-info';
    if (role === 'brand_manager') return 'x-badge-success';
    if (role === 'branch_manager') return 'x-badge-warning';
    return 'x-badge-muted';
  }

  function _timStatusBadge(status) {
    return '';
  }

  function _timBranchName(branchId) {
    if (!branchId) return '<span class="text-muted">—</span>';
    var b = _timBranches.find(function (x) { return x.id === branchId; });
    return b ? esc(b.name) : esc(branchId);
  }

  async function loadTim() {
    if (!_canManageTim()) return;
    try {
      var url = API_BASE + '/admin/users?limit=200';
      if (_branchContextState.selected && _branchContextState.selected !== 'all') {
        url += '&branch_id=' + encodeURIComponent(_branchContextState.selected);
      }
      var res = await adminFetch(url, { headers: getAuthHeaders() });
      var data = await res.json();
      if (data.success) {
        _timUsers = data.users || [];
        renderTimTable();
      }
    } catch (e) {
      console.warn('[Tim Load Error]:', e);
    }
    // Also load branches for branch name display
    try {
      var bRes = await adminFetch(API_BASE + '/admin/branches', { headers: getAuthHeaders() });
      var bData = await bRes.json();
      if (bData.success) _timBranches = bData.branches || [];
    } catch (e) { /* ignore */ }
  }

  function renderTimTable() {
    var filtered = _timUsers;
    if (_timRoleFilter !== 'all') {
      filtered = _timUsers.filter(function (u) { return u.role === _timRoleFilter; });
    }

    var tbody = $('tim-table-body');
    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Tidak ada anggota tim ditemukan.</td></tr>';
      return;
    }

    var myId = (getStoredUser() || {}).id;
    var rows = filtered.map(function (u) {
      var isMe = u.id === myId;
      var isTargetOwner = u.role === 'owner';
      var isLastOwner = isTargetOwner && _timUsers.filter(function (x) { return x.role === 'owner'; }).length <= 1;
      var isActive = u.status === 'active';

      // STATUS COLUMN: ONLY the toggle switch. Centered horizontally and vertically.
      // Toggle ON = active, Toggle OFF = inactive.
      // Disabling self (isMe) or the sole owner (isLastOwner) is not allowed by RBAC, so render disabled toggle.
      var isToggleDisabled = isMe || isLastOwner;
      var toggleTitle = '';
      if (isMe) {
        toggleTitle = 'Akun Anda (tidak dapat dinonaktifkan)';
      } else if (isLastOwner) {
        toggleTitle = 'Owner Utama (tidak dapat dinonaktifkan)';
      } else {
        toggleTitle = isActive ? 'Akun Aktif (klik untuk nonaktifkan)' : 'Akun Nonaktif (klik untuk aktifkan)';
      }

      var statusToggle = '' +
        '<label class="x-toggle' + (isActive ? ' x-toggle-on' : '') + '" title="' + toggleTitle + '" style="margin:0 auto;display:inline-block;vertical-align:middle;">' +
          '<input type="checkbox" id="tim-toggle-' + u.id + '" ' + (isActive ? 'checked ' : '') + (isToggleDisabled ? 'disabled ' : '') +
            'onchange="toggleUserStatus(\'' + u.id + '\', \'' + esc(u.full_name) + '\', this)" aria-label="Ubah status akun ' + esc(u.full_name) + '">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      // ACTIONS COLUMN: Action menu or indicator text only
      var actions = '';
      if (isMe) {
        actions = '<span class="text-muted" style="font-size:11px;">Akun Anda</span>';
      } else {
        var menuItems = [
          "{ label: 'Edit Data & Peran', icon: '✏️', onClick: function() { openEditUser('" + u.id + "'); } }",
          "{ label: 'Reset Password', icon: '🔑', onClick: function() { resetUserPassword('" + u.id + "', '" + esc(u.full_name) + "'); } }"
        ];

        // Owner capability: Delete / Remove member (cannot delete last owner)
        if (_timCurrentUserRole === 'owner' && !isLastOwner) {
          menuItems.push("{ divider: true }");
          menuItems.push("{ label: 'Hapus Anggota', icon: '🗑️', destructive: true, onClick: function() { deleteUser('" + u.id + "', '" + esc(u.full_name) + "'); } }");
        }

        actions = [
          '<div class="x-item-actions" style="justify-content:flex-end;">',
            '<button type="button" class="x-action-menu-trigger" aria-label="Aksi anggota tim ' + esc(u.full_name) + '" onclick="XentraActionMenu.open(this, [' +
              menuItems.join(',') +
            '])">',
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
            '</button>',
          '</div>'
        ].join('');
      }

      return '<tr>' +
        '<td><strong>' + esc(u.full_name) + '</strong></td>' +
        '<td><code style="font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px;">' + esc(u.username) + '</code></td>' +
        '<td><span class="x-badge ' + _timRoleBadgeClass(u.role) + '">' + _timRoleLabel(u.role) + '</span></td>' +
        '<td>' + _timBranchName(u.branch_id) + '</td>' +
        '<td class="text-center" style="vertical-align:middle;text-align:center;">' + statusToggle + '</td>' +
        '<td class="text-right" style="white-space:nowrap;vertical-align:middle;">' + actions + '</td>' +
      '</tr>';
    });

    tbody.innerHTML = rows.join('');
  }

  function filterTimByRole(role) {
    _timRoleFilter = role;
    document.querySelectorAll('#tim-role-filters .x-cat-filter-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.role === role);
    });
    renderTimTable();
  }
  window.filterTimByRole = filterTimByRole;

  function openCreateUserModal() {
    $('modal-user-title').textContent = 'Tambah Anggota Tim';
    $('user-id').value = '';
    $('user-fullname').value = '';
    $('user-username').value = '';
    $('user-username').readOnly = false;
    $('user-password').value = '';
    $('user-password-group').style.display = '';
    $('user-password-hint').textContent = 'Wajib diisi saat membuat akun baru.';
    $('user-email').value = '';
    $('user-role').value = '';
    $('user-branch').value = '';

    // Populate role options based on actor role
    var roleSelect = $('user-role');
    roleSelect.innerHTML = '';
    if (_timCurrentUserRole === 'owner') {
      roleSelect.innerHTML = '<option value="brand_manager">Brand Manager</option><option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option>';
    } else if (_timCurrentUserRole === 'brand_manager') {
      roleSelect.innerHTML = '<option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option>';
    } else if (_timCurrentUserRole === 'branch_manager') {
      roleSelect.innerHTML = '<option value="cashier">Kasir</option>';
    }

    // Populate branch options
    var branchSelect = $('user-branch');
    branchSelect.innerHTML = '<option value="">— Tanpa Cabang —</option>';
    _timBranches.forEach(function (b) {
      branchSelect.innerHTML += '<option value="' + b.id + '">' + esc(b.name) + '</option>';
    });

    // branch_manager: lock to own branch
    if (_timCurrentUserRole === 'branch_manager') {
      var myBranch = (getStoredUser() || {}).branch_id;
      if (myBranch) {
        branchSelect.value = myBranch;
        branchSelect.disabled = true;
      }
    } else {
      branchSelect.disabled = false;
    }

    $('modal-user').style.display = 'flex';
  }
  window.openCreateUserModal = openCreateUserModal;

  function openEditUser(userId) {
    var user = _timUsers.find(function (u) { return u.id === userId; });
    if (!user) return;

    $('modal-user-title').textContent = 'Edit Anggota Tim';
    $('user-id').value = user.id;
    $('user-fullname').value = user.full_name || '';
    $('user-username').value = user.username || '';
    $('user-username').readOnly = true;
    $('user-password-group').style.display = 'none';
    $('user-email').value = user.email || '';

    // Populate role options (restricted by actor role)
    var roleSelect = $('user-role');
    roleSelect.innerHTML = '';
    if (_timCurrentUserRole === 'owner') {
      roleSelect.innerHTML = '<option value="brand_manager">Manager</option><option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option>';
    } else if (_timCurrentUserRole === 'brand_manager') {
      roleSelect.innerHTML = '<option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option>';
    } else if (_timCurrentUserRole === 'branch_manager') {
      roleSelect.innerHTML = '<option value="cashier">Kasir</option>';
    }
    roleSelect.value = user.role;

    // Branch options
    var branchSelect = $('user-branch');
    branchSelect.innerHTML = '<option value="">— Tanpa Cabang —</option>';
    _timBranches.forEach(function (b) {
      branchSelect.innerHTML += '<option value="' + b.id + '">' + esc(b.name) + '</option>';
    });
    branchSelect.value = user.branch_id || '';

    if (_timCurrentUserRole === 'branch_manager') {
      var myBranch = (getStoredUser() || {}).branch_id;
      if (myBranch) {
        branchSelect.value = myBranch;
        branchSelect.disabled = true;
      }
    } else {
      branchSelect.disabled = false;
    }

    $('modal-user').style.display = 'flex';
  }
  window.openEditUser = openEditUser;

  function closeUserModal() {
    $('modal-user').style.display = 'none';
  }
  window.closeUserModal = closeUserModal;

  async function submitUserForm(e) {
    e.preventDefault();
    var userId = $('user-id').value;
    var isEdit = !!userId;
    var payload = {
      full_name: $('user-fullname').value.trim(),
      role: $('user-role').value,
      branch_id: $('user-branch').value || undefined,
      email: $('user-email').value.trim() || undefined
    };

    if (!isEdit) {
      payload.username = $('user-username').value.trim();
      payload.password = $('user-password').value;
      if (!payload.username || payload.username.length < 3) {
        showToast('Username minimal 3 karakter.');
        return;
      }
      if (!payload.password || payload.password.length < 8) {
        showToast('Password minimal 8 karakter.');
        return;
      }
    }

    if (!payload.full_name) {
      showToast('Nama lengkap wajib diisi.');
      return;
    }

    try {
      var url = isEdit ? (API_BASE + '/admin/users/' + userId) : (API_BASE + '/admin/users');
      var method = isEdit ? 'PUT' : 'POST';
      var res = await adminFetch(url, {
        method: method,
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (data.success) {
        showToast(isEdit ? 'Profil anggota tim berhasil diperbarui.' : 'Anggota tim berhasil ditambahkan.');
        closeUserModal();
        loadTim();
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }

  async function toggleUserStatus(userId, name, inputElem) {
    var willActivate = inputElem ? inputElem.checked : false;
    var revert = function () {
      if (inputElem) {
        inputElem.checked = !willActivate;
        inputElem.disabled = false;
        var parentLabel = inputElem.closest('.x-toggle');
        if (parentLabel) {
          parentLabel.classList.toggle('x-toggle-on', !willActivate);
        }
      }
    };

    if (!willActivate) {
      var confirmed = confirm('Nonaktifkan akun "' + name + '"? Staf ini tidak akan bisa login sampai diaktifkan kembali.');
      if (!confirmed) {
        revert();
        return;
      }
    }

    if (inputElem) {
      inputElem.disabled = true;
    }

    try {
      var endpoint = willActivate ? '/enable' : '/disable';
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + endpoint, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Akun "' + name + '" berhasil ' + (willActivate ? 'diaktifkan.' : 'dinonaktifkan.'));
        loadTim();
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
        revert();
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
      revert();
    }
  }
  window.toggleUserStatus = toggleUserStatus;

  async function disableUser(userId, name) {
    if (!confirm('Nonaktifkan akun "' + name + '"? Staf ini tidak akan bisa login sampai diaktifkan kembali.')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + '/disable', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Akun "' + name + '" berhasil dinonaktifkan.');
        loadTim();
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.disableUser = disableUser;

  async function enableUser(userId, name) {
    try {
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + '/enable', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Akun "' + name + '" berhasil diaktifkan.');
        loadTim();
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.enableUser = enableUser;

  async function deleteUser(userId, name) {
    var confirmed = confirm(
      'Hapus anggota "' + name + '"?\n\n' +
      'Anggota akan kehilangan akses ke dashboard dan tim ini. Tindakan ini tidak dapat dibatalkan.'
    );
    if (!confirmed) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/users/' + userId, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Anggota "' + name + '" berhasil dihapus.');
        loadTim();
      } else {
        showToast('Gagal: ' + (data.error || data.message || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan saat menghapus anggota.');
    }
  }
  window.deleteUser = deleteUser;

  async function resetUserPassword(userId, name) {
    if (!confirm('Generate token reset password untuk "' + name + '"? Token hanya ditampilkan sekali.')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + '/reset-password', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success && data.reset_token) {
        $('reset-password-user-name').value = name;
        $('reset-password-token').value = data.reset_token;
        $('modal-reset-password').style.display = 'flex';
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.resetUserPassword = resetUserPassword;

  function closeResetPasswordModal() {
    $('modal-reset-password').style.display = 'none';
  }
  window.closeResetPasswordModal = closeResetPasswordModal;

  /* =========================================================================
     MODUL: TEAM SECTION SWITCHER (Members, Invitations, Roles, Permissions)
     ========================================================================= */

  function switchTeamSection(sectionName, updateHash) {
    var valid = ['members', 'invitations', 'roles', 'permissions'];
    var sec = valid.indexOf(sectionName) !== -1 ? sectionName : 'members';

    ['members', 'invitations', 'roles', 'permissions'].forEach(function (name) {
      var el = $('team-section-' + name);
      if (el) el.style.display = name === sec ? '' : 'none';
    });

    document.querySelectorAll('#team-subnav .x-subnav-tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.teamSection === sec);
    });

    if (sec === 'invitations') {
      loadInvitations();
    }

    if (updateHash !== false) {
      navigateTo('team/' + sec);
    }
  }
  window.switchTeamSection = switchTeamSection;

  /* =========================================================================
     MODUL: WORKFORCE INVITATIONS (Owner & Manager Operations)
     ========================================================================= */

  var _invitationsList = [];

  async function loadInvitations() {
    var tbody = $('invitations-table-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Memuat data undangan...</td></tr>';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/invitations', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data.success) {
        _invitationsList = data.invitations || [];
        renderInvitationsTable(_invitationsList);
      } else {
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">' + esc(data.error || 'Gagal memuat undangan.') + '</td></tr>';
        }
      }
    } catch (err) {
      console.error('[Load Invitations Error]:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat undangan.</td></tr>';
      }
    }
  }
  window.loadInvitations = loadInvitations;

  function renderInvitationsTable(invitations) {
    var tbody = $('invitations-table-body');
    if (!tbody) return;

    if (!invitations || invitations.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Belum ada undangan yang dibuat.</td></tr>';
      return;
    }

    var rows = invitations.map(function (inv) {
      var statusBadge = '';
      if (inv.status === 'pending') {
        statusBadge = '<span class="x-badge" style="background:#fef3c7;color:#92400e;font-weight:600;">Pending</span>';
      } else if (inv.status === 'accepted') {
        statusBadge = '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:600;">Accepted</span>';
      } else if (inv.status === 'revoked') {
        statusBadge = '<span class="x-badge" style="background:#fef2f2;color:#991b1b;font-weight:600;">Revoked</span>';
      } else if (inv.status === 'expired') {
        statusBadge = '<span class="x-badge" style="background:#f1f5f9;color:#64748b;font-weight:600;">Expired</span>';
      }

      var branchName = inv.branch_id ? _timBranchName(inv.branch_id) : '<span class="text-muted">Brand-wide</span>';
      var expiresFormatted = inv.expires_at ? new Date(inv.expires_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

      var actions = '—';
      if (inv.status === 'pending') {
        actions = '<div class="x-item-actions" style="justify-content:flex-end;gap:6px;">' +
          '<button type="button" class="x-btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="resendInvitation(\'' + inv.id + '\', \'' + esc(inv.email) + '\')">Kirim Ulang</button>' +
          '<button type="button" class="x-btn-secondary" style="padding:4px 8px;font-size:11px;color:#dc2626;" onclick="revokeInvitation(\'' + inv.id + '\', \'' + esc(inv.email) + '\')">Batalkan</button>' +
        '</div>';
      }

      return '<tr>' +
        '<td><strong>' + esc(inv.email) + '</strong></td>' +
        '<td><span class="x-badge ' + _timRoleBadgeClass(inv.role) + '">' + _timRoleLabel(inv.role) + '</span></td>' +
        '<td>' + branchName + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td>' + expiresFormatted + '</td>' +
        '<td class="text-right">' + actions + '</td>' +
      '</tr>';
    });

    tbody.innerHTML = rows.join('');
  }

  function openInviteUserModal() {
    $('invite-input-email').value = '';
    
    // Populate role options for invitation
    var roleSelect = $('invite-input-role');
    roleSelect.innerHTML = '';
    if (_timCurrentUserRole === 'owner') {
      roleSelect.innerHTML = '<option value="branch_manager">Branch Manager</option><option value="brand_manager">Brand Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option>';
    } else if (_timCurrentUserRole === 'brand_manager') {
      roleSelect.innerHTML = '<option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option>';
    } else if (_timCurrentUserRole === 'branch_manager') {
      roleSelect.innerHTML = '<option value="cashier">Kasir</option><option value="kitchen">Dapur</option>';
    }

    // Populate branches
    var branchSelect = $('invite-input-branch');
    branchSelect.innerHTML = '<option value="">— Pilih Cabang —</option>';
    _timBranches.forEach(function (b) {
      branchSelect.innerHTML += '<option value="' + b.id + '">' + esc(b.name) + '</option>';
    });

    if (_timCurrentUserRole === 'branch_manager') {
      var myBranch = (getStoredUser() || {}).branch_id;
      if (myBranch) {
        branchSelect.value = myBranch;
        branchSelect.disabled = true;
      }
    } else {
      branchSelect.disabled = false;
    }

    handleInviteRoleChange();
    $('modal-invite-user').style.display = 'flex';
  }
  window.openInviteUserModal = openInviteUserModal;

  function closeInviteUserModal() {
    $('modal-invite-user').style.display = 'none';
  }
  window.closeInviteUserModal = closeInviteUserModal;

  function handleInviteRoleChange() {
    var role = $('invite-input-role').value;
    var branchGroup = $('invite-branch-group');
    var branchSelect = $('invite-input-branch');
    var isBranchRequired = role === 'branch_manager' || role === 'cashier' || role === 'kitchen';
    
    if (role === 'brand_manager') {
      if (branchGroup) branchGroup.style.display = 'none';
      if (branchSelect) branchSelect.required = false;
    } else {
      if (branchGroup) branchGroup.style.display = 'block';
      if (branchSelect) branchSelect.required = isBranchRequired;
    }
  }
  window.handleInviteRoleChange = handleInviteRoleChange;

  async function submitInviteUserForm(e) {
    e.preventDefault();
    var email = $('invite-input-email').value.trim();
    var role = $('invite-input-role').value;
    var branchId = $('invite-input-branch').value || undefined;

    if (!email) {
      showToast('Alamat email wajib diisi.');
      return;
    }

    if ((role === 'branch_manager' || role === 'cashier' || role === 'kitchen') && !branchId) {
      showToast('Peran ' + role + ' wajib memilih cabang penugasan.');
      return;
    }

    var btnSend = $('btn-send-invitation');
    if (btnSend) {
      btnSend.disabled = true;
      btnSend.textContent = 'Mengirim...';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/invitations', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ email: email, role: role, branch_id: branchId })
      });
      var data = await res.json();

      if (data.success) {
        showToast('Undangan berhasil dikirim ke ' + email);
        closeInviteUserModal();
        switchTeamSection('invitations');
      } else {
        showToast('Gagal: ' + (data.message || data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan saat mengirim undangan.');
    } finally {
      if (btnSend) {
        btnSend.disabled = false;
        btnSend.textContent = 'Kirim Undangan';
      }
    }
  }
  window.submitInviteUserForm = submitInviteUserForm;

  async function resendInvitation(invId, email) {
    if (!confirm('Kirim ulang email undangan ke "' + email + '"? Token sebelumnya akan diperbarui.')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/invitations/' + invId + '/resend', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Undangan berhasil dikirim ulang ke ' + email);
        loadInvitations();
      } else {
        showToast('Gagal: ' + (data.message || data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.resendInvitation = resendInvitation;

  async function revokeInvitation(invId, email) {
    if (!confirm('Batalkan undangan untuk "' + email + '"? Tautan undangan tidak akan dapat digunakan lagi.')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/invitations/' + invId + '/revoke', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Undangan untuk ' + email + ' berhasil dibatalkan.');
        loadInvitations();
      } else {
        showToast('Gagal: ' + (data.message || data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.revokeInvitation = revokeInvitation;


  /* =========================================================================
     MODUL: CUSTOMERS & LOYALTY (Phase 5)
     ========================================================================= */

  var _customersList = [];
  var _activeCustomerSegment = 'all';

  async function loadCustomers() {
    var tbody = $('customers-table-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6 text-muted">Memuat data pelanggan...</td></tr>';
    }

    try {
      var queryParams = [];
      if (_branchContextState.selected && _branchContextState.selected !== 'all') {
        queryParams.push('branch_id=' + encodeURIComponent(_branchContextState.selected));
      }

      var searchInput = $('customers-search-input');
      var searchVal = searchInput ? searchInput.value.trim() : '';
      if (searchVal) {
        queryParams.push('search=' + encodeURIComponent(searchVal));
      }

      if (_activeCustomerSegment && _activeCustomerSegment !== 'all' && _activeCustomerSegment !== 'segments') {
        queryParams.push('segment=' + encodeURIComponent(_activeCustomerSegment));
      }

      var url = API_BASE + '/admin/customers' + (queryParams.length ? '?' + queryParams.join('&') : '');
      var res = await adminFetch(url, { headers: getAuthHeaders() });
      var data = await res.json();

      if (data.success) {
        _customersList = data.customers || [];
        renderCustomersTable(_customersList);
      } else {
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6 text-danger">' + esc(data.error || 'Gagal memuat data pelanggan.') + '</td></tr>';
        }
      }
    } catch (err) {
      console.error('[Load Customers Error]:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat data pelanggan.</td></tr>';
      }
    }
  }
  window.loadCustomers = loadCustomers;

  function renderCustomersTable(customers) {
    var tbody = $('customers-table-body');
    if (!tbody) return;

    if (!customers || customers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6 text-muted">Tidak ada pelanggan yang cocok dengan kriteria.</td></tr>';
      return;
    }

    var rows = customers.map(function (c) {
      var favBranchText = c.favorite_branch ? esc(c.favorite_branch.name) : '<span class="text-muted">—</span>';
      var lastOrderText = c.last_order ? esc(c.last_order) : '<span class="text-muted">—</span>';
      var segmentBadge = c.segment === 'returning'
        ? '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:600;">Returning</span>'
        : '<span class="x-badge" style="background:#eff6ff;color:#1d4ed8;font-weight:600;">New</span>';

      return '<tr>' +
        '<td><strong>' + esc(c.name || 'Pelanggan') + '</strong></td>' +
        '<td><code style="font-size:12px;background:#f8fafc;padding:2px 6px;border-radius:4px;">' + esc(c.phone) + '</code></td>' +
        '<td><strong>' + (c.order_count || 0) + '</strong> pesanan</td>' +
        '<td><strong>' + formatMoney(c.total_spend || 0) + '</strong></td>' +
        '<td>' + formatMoney(c.average_order_value || 0) + '</td>' +
        '<td>' + favBranchText + '</td>' +
        '<td>' + segmentBadge + '</td>' +
        '<td class="text-right" style="white-space:nowrap;">' +
          '<div class="x-item-actions" style="justify-content:flex-end;">' +
            '<button type="button" class="x-action-menu-trigger" aria-label="Aksi pelanggan ' + esc(c.name || c.phone) + '" onclick="XentraActionMenu.open(this, [' +
              '{ label: \'Lihat Profil Pelanggan\', icon: \'👤\', onClick: function() { navigateTo(\'customers/' + encodeURIComponent(c.phone || c.id) + '\'); } }' +
            '])">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    });

    tbody.innerHTML = rows.join('');
  }

  function filterCustomersBySegment(segment) {
    _activeCustomerSegment = segment;
    document.querySelectorAll('#customers-segment-tabs .x-subnav-tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.segment === segment);
    });

    var segmentsGuide = $('customers-segments-view');
    if (segmentsGuide) {
      segmentsGuide.style.display = segment === 'segments' ? '' : 'none';
    }

    loadCustomers();
  }
  window.filterCustomersBySegment = filterCustomersBySegment;

  function searchCustomers() {
    loadCustomers();
  }
  window.searchCustomers = searchCustomers;

  function showCustomersListView() {
    var listView = $('customers-list-view');
    var detailView = $('customers-detail-view');
    if (listView) listView.style.display = '';
    if (detailView) detailView.style.display = 'none';
  }
  window.showCustomersListView = function () {
    showCustomersListView();
    navigateTo('customers');
  };

  async function loadCustomerDetailView(customerId) {
    var listView = $('customers-list-view');
    var detailView = $('customers-detail-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = '';

    // Reset fields to loading state
    if ($('cdetail-name')) $('cdetail-name').textContent = 'Memuat Profil...';
    if ($('cdetail-subtitle')) $('cdetail-subtitle').textContent = 'Mengambil data transaksi Core...';
    if ($('cdetail-total-orders')) $('cdetail-total-orders').textContent = '-';
    if ($('cdetail-total-spend')) $('cdetail-total-spend').textContent = '-';
    if ($('cdetail-aov')) $('cdetail-aov').textContent = '-';
    if ($('cdetail-fav-branch')) $('cdetail-fav-branch').textContent = '-';

    try {
      var queryParams = [];
      if (_branchContextState.selected && _branchContextState.selected !== 'all') {
        queryParams.push('branch_id=' + encodeURIComponent(_branchContextState.selected));
      }
      var url = API_BASE + '/admin/customers/' + encodeURIComponent(customerId) + (queryParams.length ? '?' + queryParams.join('&') : '');
      var res = await adminFetch(url, { headers: getAuthHeaders() });
      var data = await res.json();

      if (!data.success || !data.customer) {
        showToast('Pelanggan tidak ditemukan.');
        showCustomersListView();
        return;
      }

      var c = data.customer;

      if ($('cdetail-name')) $('cdetail-name').textContent = c.name || 'Pelanggan';
      if ($('cdetail-subtitle')) $('cdetail-subtitle').textContent = 'Nomor Kontak: ' + (c.phone || '-');

      var badgeEl = $('cdetail-segment-badge');
      if (badgeEl) {
        if (c.segment === 'returning') {
          badgeEl.textContent = 'Returning Customer';
          badgeEl.style.background = '#ecfdf5';
          badgeEl.style.color = '#047857';
        } else {
          badgeEl.textContent = 'New Customer';
          badgeEl.style.background = '#eff6ff';
          badgeEl.style.color = '#1d4ed8';
        }
      }

      if ($('cdetail-total-orders')) $('cdetail-total-orders').textContent = String(c.total_orders || 0);
      if ($('cdetail-total-spend')) $('cdetail-total-spend').textContent = formatMoney(c.total_spend || 0);
      if ($('cdetail-aov')) $('cdetail-aov').textContent = formatMoney(c.average_order_value || 0);
      if ($('cdetail-fav-branch')) $('cdetail-fav-branch').textContent = c.favorite_branch ? c.favorite_branch.name : '—';

      // Render Top Products
      var prodCont = $('cdetail-top-products-container');
      if (prodCont) {
        if (!c.top_products || c.top_products.length === 0) {
          prodCont.innerHTML = '<div class="x-empty-state">Belum ada riwayat pesanan produk.</div>';
        } else {
          var pRows = c.top_products.map(function (p) {
            return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#f8fafc;border-radius:6px;margin-bottom:8px;border:1px solid #e2e8f0;">' +
              '<div>' +
                '<strong>' + esc(p.product_name) + '</strong>' +
                '<small style="display:block;color:#64748b;font-size:11px;">' + p.total_quantity + ' porsi dipesan</small>' +
              '</div>' +
              '<span style="font-weight:700;color:#0f172a;">' + formatMoney(p.total_sales || 0) + '</span>' +
            '</div>';
          });
          prodCont.innerHTML = pRows.join('');
        }
      }

      // Render Saved Addresses (Distinguishing Buyer vs Recipient context)
      var addrCont = $('cdetail-addresses-container');
      if (addrCont) {
        if (!c.addresses || c.addresses.length === 0) {
          addrCont.innerHTML = '<div class="x-empty-state">Tidak ada alamat pengiriman tersimpan.</div>';
        } else {
          var aRows = c.addresses.map(function (a) {
            var primaryBadge = a.is_primary ? ' <span class="x-badge x-badge-success" style="font-size:10px;">Utama</span>' : '';
            return '<div style="padding:10px 12px;background:#f8fafc;border-radius:6px;margin-bottom:8px;border:1px solid #e2e8f0;">' +
              '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
                '<strong>' + esc(a.label || 'Alamat') + primaryBadge + '</strong>' +
              '</div>' +
              '<div style="font-size:12px;color:#334155;">' + esc(a.address) + '</div>' +
              (a.detail ? '<div style="font-size:11px;color:#64748b;margin-top:2px;">Catatan: ' + esc(a.detail) + '</div>' : '') +
            '</div>';
          });
          addrCont.innerHTML = aRows.join('');
        }
      }

      // Render Order History
      var ordersTbody = $('cdetail-orders-table-body');
      if (ordersTbody) {
        if (!c.orders || c.orders.length === 0) {
          ordersTbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Belum ada riwayat transaksi.</td></tr>';
        } else {
          var ordRows = c.orders.map(function (o) {
            return '<tr>' +
              '<td><a href="#orders/' + encodeURIComponent(o.id) + '" style="font-weight:600;color:var(--primary);text-decoration:none;">#' + esc(o.order_number || o.id) + '</a></td>' +
              '<td style="font-size:12px;color:#64748b;">' + esc(o.created_at) + '</td>' +
              '<td>' + esc(o.branch_name || '—') + '</td>' +
              '<td><span class="x-badge" style="background:#e0f2fe;color:#0369a1;font-size:11px;">' + esc(o.order_channel || 'customer_app') + '</span></td>' +
              '<td><span class="x-badge" style="background:#fef3c7;color:#92400e;font-size:11px;">' + esc(o.fulfillment_type || 'delivery') + '</span></td>' +
              '<td><span class="x-badge ' + (o.status === 'completed' ? 'x-badge-success' : 'x-badge-info') + '">' + esc(o.status) + '</span></td>' +
              '<td><strong>' + formatMoney(o.grand_total || 0) + '</strong></td>' +
            '</tr>';
          });
          ordersTbody.innerHTML = ordRows.join('');
        }
      }

    } catch (err) {
      console.error('[Load Customer Detail Error]:', err);
      showToast('Gagal memuat detail pelanggan.');
    }
  }
  window.loadCustomerDetailView = loadCustomerDetailView;

  /* =========================================================================
     PHASE 6: CLIENT OWNER DASHBOARD — FINANCE & MARKETING FRONTEND LOGIC
     Authoritative Core data consumption with granular Branch Context scoping
     ========================================================================= */

  var _activeFinanceSubtab = 'overview';
  var _activeMarketingSubtab = 'promotions';

  function switchFinanceSection(subtab, updateHash) {
    if (!subtab) subtab = 'overview';
    _activeFinanceSubtab = subtab;

    if (updateHash !== false) {
      navigateTo('finance/' + subtab);
      return;
    }

    // Toggle subnav tabs active class
    document.querySelectorAll('#finance-subnav-tabs .x-subnav-tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.subtab === subtab);
    });

    // Toggle subviews
    var views = {
      'overview': 'finance-view-overview',
      'transactions': 'finance-view-transactions',
      'payouts': 'finance-view-payouts',
      'reconciliation': 'finance-view-reconciliation',
      'payment-methods': 'finance-view-payment-methods'
    };

    Object.keys(views).forEach(function (key) {
      var el = $(views[key]);
      if (el) el.style.display = (key === subtab) ? '' : 'none';
    });

    // Load data for subtab
    if (subtab === 'overview') loadFinanceOverview();
    else if (subtab === 'transactions') loadFinanceTransactions();
    else if (subtab === 'reconciliation') loadFinanceReconciliation();
    else if (subtab === 'payment-methods') loadFinancePaymentMethods();
  }
  window.switchFinanceSection = switchFinanceSection;

  function loadFinanceCurrentSubtab() {
    switchFinanceSection(_activeFinanceSubtab, false);
  }
  window.loadFinanceCurrentSubtab = loadFinanceCurrentSubtab;

  async function loadFinanceOverview() {
    try {
      var branchId = getEffectiveBranchId();
      var query = branchId && branchId !== 'all' ? '?branch_id=' + encodeURIComponent(branchId) : '';
      var res = await adminFetch('/api/v1/admin/finance/overview' + query, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var json = await res.json();
      if (!json.success || !json.data) return;

      var s = json.data.summary || {};
      var grossEl = $('fin-gross-sales');
      var settledEl = $('fin-total-settled');
      var pendingEl = $('fin-total-pending');
      var reconCountEl = $('fin-unreconciled-count');
      var reconSubEl = $('fin-unreconciled-sub');

      if (grossEl) grossEl.textContent = formatMoney(s.gross_sales || 0);
      if (settledEl) settledEl.textContent = formatMoney(s.total_settled || 0);
      if (pendingEl) pendingEl.textContent = formatMoney(s.total_pending || 0);
      if (reconCountEl) reconCountEl.textContent = s.unreconciled_count || 0;
      if (reconSubEl) {
        reconSubEl.textContent = s.unreconciled_amount > 0 
          ? formatMoney(s.unreconciled_amount) + ' menunggu verifikasi' 
          : 'Semua transaksi sinkron';
      }

      var tbody = $('tbody-fin-breakdown');
      if (tbody) {
        var breakdown = json.data.breakdown || [];
        if (breakdown.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">Belum ada rincian pelunasan pembayaran.</td></tr>';
        } else {
          var rows = breakdown.map(function (b) {
            var badgeColor = b.payment_status === 'settlement' 
              ? 'background:#ecfdf5;color:#047857;' 
              : 'background:#fffbeb;color:#b45309;';
            return '<tr>' +
              '<td><strong>' + esc(b.provider === 'cash' ? 'Tunai (Cash)' : 'Midtrans Online') + '</strong></td>' +
              '<td><span class="x-badge" style="' + badgeColor + 'font-weight:600;">' + esc(b.payment_status) + '</span></td>' +
              '<td>' + (b.transaction_count || 0) + ' transaksi</td>' +
              '<td><strong>' + formatMoney(b.total_amount || 0) + '</strong></td>' +
            '</tr>';
          });
          tbody.innerHTML = rows.join('');
        }
      }
    } catch (err) {
      console.error('[Load Finance Overview Error]:', err);
      showToast('Gagal memuat ringkasan keuangan.');
    }
  }
  window.loadFinanceOverview = loadFinanceOverview;

  async function loadFinanceTransactions() {
    try {
      var tbody = $('tbody-fin-transactions');
      if (!tbody) return;

      var branchId = getEffectiveBranchId();
      var methodEl = $('fin-filter-method');
      var statusEl = $('fin-filter-status');
      var params = [];

      if (branchId && branchId !== 'all') params.push('branch_id=' + encodeURIComponent(branchId));
      if (methodEl && methodEl.value) params.push('payment_method=' + encodeURIComponent(methodEl.value));
      if (statusEl && statusEl.value) params.push('payment_status=' + encodeURIComponent(statusEl.value));

      var query = params.length > 0 ? '?' + params.join('&') : '';
      var res = await adminFetch('/api/v1/admin/finance/transactions' + query, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var json = await res.json();
      if (!json.success) return;

      var txs = json.transactions || [];
      if (txs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Tidak ada transaksi keuangan yang ditemukan.</td></tr>';
        return;
      }

      var rows = txs.map(function (t) {
        var statusBadge = t.payment_status === 'settlement'
          ? '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:600;">Settlement</span>'
          : (t.payment_status === 'reconciliation_pending'
            ? '<span class="x-badge" style="background:#fef3c7;color:#92400e;font-weight:600;">Reconciliation Pending</span>'
            : (t.payment_status === 'pending'
              ? '<span class="x-badge" style="background:#eff6ff;color:#1d4ed8;font-weight:600;">Pending</span>'
              : '<span class="x-badge" style="background:#fee2e2;color:#991b1b;font-weight:600;">' + esc(t.payment_status) + '</span>'));

        var methodLabel = t.payment_method === 'cash' ? 'Tunai (Cash)' : 'Midtrans';
        var timeText = t.created_at ? esc(t.created_at.substring(0, 19).replace('T', ' ')) : '—';

        return '<tr>' +
          '<td><code style="font-size:12px;background:#f8fafc;padding:2px 6px;border-radius:4px;">' + esc(t.id || '—') + '</code></td>' +
          '<td style="font-size:12px;color:#64748b;">' + timeText + '</td>' +
          '<td><a href="#orders/' + encodeURIComponent(t.order_id) + '" style="font-weight:600;color:var(--primary);text-decoration:none;">#' + esc(t.order_number || t.order_id) + '</a></td>' +
          '<td>' + esc(t.branch_name || 'Cabang Utama') + '</td>' +
          '<td><strong>' + esc(methodLabel) + '</strong></td>' +
          '<td><strong>' + formatMoney(t.amount || 0) + '</strong></td>' +
          '<td>' + statusBadge + '</td>' +
        '</tr>';
      });

      tbody.innerHTML = rows.join('');
    } catch (err) {
      console.error('[Load Finance Transactions Error]:', err);
      showToast('Gagal memuat daftar transaksi keuangan.');
    }
  }
  window.loadFinanceTransactions = loadFinanceTransactions;

  async function loadFinanceReconciliation() {
    try {
      var tbody = $('tbody-fin-reconciliation');
      if (!tbody) return;

      var branchId = getEffectiveBranchId();
      var query = branchId && branchId !== 'all' ? '?branch_id=' + encodeURIComponent(branchId) : '';
      var res = await adminFetch('/api/v1/admin/finance/reconciliation' + query, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var json = await res.json();
      if (!json.success || !json.reconciliation) return;

      var recs = json.reconciliation.records || [];
      if (recs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6" style="color:#059669;font-weight:600;">✅ Semua transaksi telah direkonsiliasi dengan benar. Tidak ada transaksi tertunda.</td></tr>';
        return;
      }

      var rows = recs.map(function (r) {
        var timeText = r.created_at ? esc(r.created_at.substring(0, 19).replace('T', ' ')) : '—';
        return '<tr>' +
          '<td><a href="#orders/' + encodeURIComponent(r.order_id) + '" style="font-weight:600;color:var(--primary);text-decoration:none;">#' + esc(r.order_number || r.order_id) + '</a></td>' +
          '<td>' + esc(r.branch_name || 'Cabang Utama') + '</td>' +
          '<td>' + esc(r.provider) + '</td>' +
          '<td><strong>' + formatMoney(r.amount || 0) + '</strong></td>' +
          '<td style="font-size:12px;color:#64748b;">' + timeText + '</td>' +
          '<td><span class="x-badge" style="background:#fef3c7;color:#92400e;font-weight:600;">' + esc(r.payment_status) + '</span></td>' +
        '</tr>';
      });

      tbody.innerHTML = rows.join('');
    } catch (err) {
      console.error('[Load Finance Reconciliation Error]:', err);
      showToast('Gagal memuat status rekonsiliasi.');
    }
  }
  window.loadFinanceReconciliation = loadFinanceReconciliation;

  async function loadFinancePaymentMethods() {
    try {
      var cont = $('fin-payment-methods-list');
      if (!cont) return;

      var branchId = getEffectiveBranchId();
      var query = branchId && branchId !== 'all' ? '?branch_id=' + encodeURIComponent(branchId) : '';
      var res = await adminFetch('/api/v1/admin/finance/payment-methods' + query, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var json = await res.json();
      if (!json.success || !json.payment_methods) return;

      var cards = json.payment_methods.map(function (m) {
        var activeBadge = m.is_enabled
          ? '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:700;">Aktif</span>'
          : '<span class="x-badge" style="background:#f1f5f9;color:#64748b;font-weight:600;">Belum Dikonfigurasi</span>';

        var envText = m.environment ? '<div style="font-size:11px;color:#64748b;margin-top:4px;">Lingkungan: <strong>' + esc(m.environment) + '</strong>' + (m.has_branch_override ? ' (Override Cabang)' : ' (Brand Default)') + '</div>' : '';

        return '<div class="x-card" style="padding:18px;border:1px solid var(--border-color);border-radius:var(--radius-md);background:#ffffff;">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">' +
            '<h4 style="font-size:15px;font-weight:800;margin:0;color:var(--text-main);">' + esc(m.name) + '</h4>' +
            activeBadge +
          '</div>' +
          '<p style="font-size:12px;color:var(--text-muted);margin:0 0 10px 0;line-height:1.4;">' + esc(m.description) + '</p>' +
          envText +
        '</div>';
      });

      cont.innerHTML = cards.join('');
    } catch (err) {
      console.error('[Load Payment Methods Error]:', err);
      showToast('Gagal memuat daftar payment methods.');
    }
  }
  window.loadFinancePaymentMethods = loadFinancePaymentMethods;

  function switchMarketingSection(subtab, updateHash) {
    if (!subtab) subtab = 'overview';
    _activeMarketingSubtab = subtab;

    if (updateHash !== false) {
      navigateTo('marketing/' + subtab);
      return;
    }

    // Toggle subnav tabs active class
    document.querySelectorAll('#marketing-subnav-tabs .x-subnav-tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.subtab === subtab);
    });

    // Toggle subviews
    var views = {
      'overview': 'marketing-view-overview',
      'promotions': 'marketing-view-promotions',
      'discounts': 'marketing-view-discounts',
      'banners': 'marketing-view-banners',
      'campaigns': 'marketing-view-campaigns',
      'loyalty': 'marketing-view-loyalty'
    };

    Object.keys(views).forEach(function (key) {
      var el = $(views[key]);
      if (el) el.style.display = (key === subtab) ? '' : 'none';
    });

    // Load data for subtab
    if (subtab === 'overview') loadMarketingOverview();
    else if (subtab === 'promotions') loadMarketingPromotions();
    else if (subtab === 'banners') renderMarketingBannersSkeleton();
  }
  window.switchMarketingSection = switchMarketingSection;

  function loadMarketingCurrentSubtab() {
    switchMarketingSection(_activeMarketingSubtab, false);
  }
  window.loadMarketingCurrentSubtab = loadMarketingCurrentSubtab;


  /* =========================================================================
     MARKETING — STOREFRONT BANNER MANAGEMENT
     Real dashboard implementation for Banner Content + Assignment/Placement.
     Legacy brands.banners remains a fallback until a Branch uses the new system.
     ========================================================================= */

  var _marketingBannersState = {
    rows: [],
    branches: [],
    promotions: [],
    products: [],
    categories: [],
    branchFilter: ''
  };

  var _marketingBannerEditor = {
    mode: 'create',
    bannerId: null,
    mediaId: null,
    mediaFile: null,
    cropSpec: null,
    detail: null
  };

  var _marketingBannerAssignmentEditor = {
    bannerId: null,
    assignmentId: null,
    mode: 'create'
  };

  function getMarketingBannerRowKey(row, index) {
    return String(row.banner_id || row.id || '') + '::' + String(
      row.assignment && row.assignment.id ? row.assignment.id : 'unassigned'
    ) + '::' + String(index || 0);
  }

  function findMarketingBannerRow(key) {
    for (var i = 0; i < _marketingBannersState.rows.length; i++) {
      if (getMarketingBannerRowKey(_marketingBannersState.rows[i], i) === key) {
        return _marketingBannersState.rows[i];
      }
    }
    return null;
  }

  function getMarketingBannerUser() {
    return typeof getStoredUser === 'function' ? (getStoredUser() || {}) : {};
  }

  function isMarketingBannerOwner() {
    var user = getMarketingBannerUser();
    return user.role === 'owner' || user.role === 'brand_manager';
  }

  function isMarketingBannerBranchManager() {
    return getMarketingBannerUser().role === 'branch_manager';
  }

  function bannerDateTimeParts(date, timeZone) {
    try {
      var parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timeZone || 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(new Date(date));

      var out = {};
      parts.forEach(function (part) {
        if (part.type !== 'literal') out[part.type] = part.value;
      });

      return out;
    } catch (_) {
      return null;
    }
  }

  function formatMarketingBannerSchedule(assignment) {
    if (!assignment) return 'Belum ditempatkan';

    var tz = assignment.branch_timezone || assignment.timezone || 'Asia/Jakarta';
    if (!assignment.starts_at && !assignment.ends_at) {
      return 'Tanpa jadwal';
    }

    function one(value) {
      if (!value) return '';
      var p = bannerDateTimeParts(value, tz);
      if (!p) return 'Tanggal tidak valid';
      return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute;
    }

    var start = assignment.starts_at ? one(assignment.starts_at) : '';
    var end = assignment.ends_at ? one(assignment.ends_at) : '';

    if (start && end) return start + ' → ' + end;
    if (start) return 'Mulai ' + start;
    return 'Berakhir ' + end;
  }

  function formatMarketingBannerScheduleWithTz(assignment) {
    var base = formatMarketingBannerSchedule(assignment);
    if (!assignment) return base;
    if (!assignment.starts_at && !assignment.ends_at) return base;
    return base + ' · ' + (assignment.branch_timezone || assignment.timezone || 'Asia/Jakarta');
  }

  function bannerStatusBadge(status) {
    var meta = {
      'DRAFT': { label: 'Draft', cls: 'is-draft' },
      'PUBLISHED': { label: 'Published', cls: 'is-published' },
      'SCHEDULED': { label: 'Terjadwal', cls: 'is-scheduled' },
      'ACTIVE': { label: 'Aktif', cls: 'is-active' },
      'PAUSED': { label: 'Dijeda', cls: 'is-paused' },
      'ENDED': { label: 'Berakhir', cls: 'is-ended' }
    }[String(status || '').toUpperCase()] || { label: status || '—', cls: '' };

    return '<span class="x-marketing-banner-status ' + meta.cls + '">' + esc(meta.label) + '</span>';
  }

  function renderMarketingBannerPreview(row) {
    var src = row && row.media ? row.media.preview_url : null;
    var title = row && row.title ? row.title : 'Banner';

    if (src) {
      return '<div class="x-marketing-banner-preview">' +
        '<img src="' + esc(src) + '" alt="' + esc(title) + '" loading="lazy">' +
      '</div>';
    }

    return '<div class="x-marketing-banner-preview x-marketing-banner-preview-empty">' +
      '<span>🖼️</span>' +
    '</div>';
  }

  function renderMarketingBannerRows() {
    var tbody = $('mkt-banners-table-body');
    if (!tbody) return;

    var rows = _marketingBannersState.rows || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8">' +
        '<div style="font-size:36px;margin-bottom:8px;">🖼️</div>' +
        '<div style="font-weight:700;color:var(--text-main);margin-bottom:4px;">Belum ada Banner</div>' +
        '<p class="text-muted" style="font-size:12px;margin:0 0 14px;">Buat Banner Content pertama, lalu Publish dan tempatkan ke cabang yang diinginkan.</p>' +
        '<button type="button" class="x-btn-primary" onclick="openMarketingBannerCreate()">+ Tambah Banner</button>' +
      '</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(function (row, index) {
      var key = getMarketingBannerRowKey(row, index);
      var assignment = row.assignment;
      var publicationStatus = String(row.publication_status || 'DRAFT').toUpperCase();
      var effectiveStatus = assignment
        ? String(assignment.effective_status || (publicationStatus === 'PUBLISHED' ? 'ACTIVE' : 'DRAFT')).toUpperCase()
        : publicationStatus;

      var isAssignmentLocked = Boolean(assignment && assignment.governance_locked && isMarketingBannerBranchManager());
      var canToggle = Boolean(assignment) && !isAssignmentLocked;
      var checked = Boolean(assignment && assignment.active);
      var toggleDisabled = canToggle ? '' : ' disabled';

      var branchText = assignment
        ? (assignment.branch_name || assignment.branch_id || 'Cabang')
        : 'Belum ditempatkan';

      var publicationText = publicationStatus === 'PUBLISHED'
        ? (row.has_draft_changes ? 'Published · Ada Draft' : 'Published')
        : 'Draft';

      var visibilityText = !assignment
        ? '—'
        : isAssignmentLocked
          ? 'Dikunci'
          : assignment.effective_status === 'SCHEDULED'
            ? 'Menunggu jadwal'
            : assignment.effective_status === 'ENDED'
              ? 'Jadwal selesai'
              : checked ? 'Play' : 'Pause';

      return '<tr>' +
        '<td data-label="Banner">' +
          '<div class="x-marketing-banner-primary">' +
            renderMarketingBannerPreview(row) +
            '<div class="x-marketing-banner-name">' +
              '<strong>' + esc(row.title || 'Tanpa judul') + '</strong>' +
              bannerStatusBadge(effectiveStatus) +
              (row.has_draft_changes ? '<span class="x-marketing-banner-draft-hint">Ada perubahan Draft</span>' : '') +
            '</div>' +
          '</div>' +
        '</td>' +
        '<td data-label="Placement"><span class="x-marketing-banner-secondary">Homepage Banner</span></td>' +
        '<td data-label="Cabang / Scope"><span class="x-marketing-banner-secondary">' + esc(branchText) + '</span></td>' +
        '<td data-label="Publikasi"><span class="x-marketing-banner-secondary">' + esc(publicationText) + '</span></td>' +
        '<td data-label="Jadwal"><span class="x-marketing-banner-secondary">' + esc(formatMarketingBannerSchedule(assignment)) + '</span></td>' +
        '<td data-label="Visibility">' +
          '<div class="x-marketing-banner-visibility">' +
            (assignment ? (
              '<label class="x-toggle x-toggle-compact" title="' + esc(visibilityText) + '">' +
                '<input type="checkbox" ' + (checked ? 'checked' : '') + toggleDisabled + ' data-banner-toggle-key="' + esc(key) + '">' +
                '<span class="x-toggle-slider"></span>' +
              '</label>'
            ) : '<span class="x-marketing-banner-no-assignment">—</span>') +
            '<span class="x-marketing-banner-visibility-label">' + esc(visibilityText) + '</span>' +
          '</div>' +
        '</td>' +
        '<td data-label="Aksi">' +
          '<div class="x-item-actions">' +
            '<button type="button" class="x-action-menu-trigger" aria-label="Aksi banner ' + esc(row.title || 'Banner') + '" data-banner-action-key="' + esc(key) + '">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('[data-banner-toggle-key]').forEach(function (input) {
      input.addEventListener('change', function () {
        var key = input.getAttribute('data-banner-toggle-key');
        var row = findMarketingBannerRow(key);
        if (!row || !row.assignment) return;
        toggleMarketingBannerAssignment(row.assignment.id, input.checked);
      });
    });

    tbody.querySelectorAll('[data-banner-action-key]').forEach(function (trigger) {
      trigger.addEventListener('click', function () {
        var key = trigger.getAttribute('data-banner-action-key');
        openMarketingBannerActionMenu(trigger, key);
      });
    });
  }

  async function loadMarketingBanners() {
    var tbody = $('mkt-banners-table-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-muted">Memuat Banner...</td></tr>';
    }

    try {
      var query = _marketingBannersState.branchFilter
        ? '?branch_id=' + encodeURIComponent(_marketingBannersState.branchFilter)
        : '';

      var res = await adminFetch(API_BASE + '/admin/marketing/banners' + query, {
        headers: getAuthHeaders()
      });

      var json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal memuat Banner.');
      }

      _marketingBannersState.rows = Array.isArray(json.banners) ? json.banners : [];
      _marketingBannersState.branches = Array.isArray(json.branches) ? json.branches : [];

      populateMarketingBannerBranchFilter();
      renderMarketingBannerRows();

      var legacyNotice = $('mkt-banners-legacy-notice');
      if (legacyNotice) {
        if (json.legacy && json.legacy.fallback_active && Number(json.legacy.count || 0) > 0) {
          legacyNotice.style.display = '';
          legacyNotice.innerHTML =
            '<strong>Legacy banner fallback masih aktif.</strong> ' +
            esc(String(json.legacy.count)) +
            ' banner lama tetap dipertahankan untuk cabang yang belum memakai Assignment baru.';
        } else {
          legacyNotice.style.display = 'none';
          legacyNotice.textContent = '';
        }
      }
    } catch (err) {
      console.error('[Banner] load error:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8">' +
          '<div style="font-weight:700;color:#dc2626;margin-bottom:4px;">Gagal memuat Banner</div>' +
          '<div class="text-muted" style="font-size:12px;">' + esc(err.message || 'Terjadi kesalahan.') + '</div>' +
        '</td></tr>';
      }
    }
  }
  window.loadMarketingBanners = loadMarketingBanners;

  function populateMarketingBannerBranchFilter() {
    var select = $('mkt-banners-branch-filter');
    if (!select) return;

    var user = getMarketingBannerUser();
    var current = _marketingBannersState.branchFilter || '';

    var options = ['<option value="">Semua Cabang</option>'];
    (_marketingBannersState.branches || []).forEach(function (branch) {
      options.push('<option value="' + esc(branch.id) + '">' + esc(branch.name || branch.id) + '</option>');
    });

    select.innerHTML = options.join('');
    if (current) select.value = current;

    if (user.role === 'branch_manager') {
      var ownBranch = user.branch_id || user.branchId || '';
      if (ownBranch) {
        select.value = ownBranch;
        select.disabled = true;
        _marketingBannersState.branchFilter = ownBranch;
      } else {
        select.disabled = true;
      }
    } else {
      select.disabled = false;
    }
  }

  function openMarketingBannerActionMenu(trigger, key) {
    var row = findMarketingBannerRow(key);
    if (!row) return;

    var assignment = row.assignment;
    var publicationStatus = String(row.publication_status || 'DRAFT').toUpperCase();
    var user = getMarketingBannerUser();
    var actions = [
      { label: 'Lihat Preview', icon: '👁️', onClick: function () { openMarketingBannerPreview(key); } }
    ];

    if (user.role !== 'branch_manager') {
      actions.push({
        label: 'Edit Content',
        icon: '✏️',
        onClick: function () { openMarketingBannerEditor(row.banner_id || row.id); }
      });
    }

    if (assignment) {
      if (!(user.role === 'branch_manager' && assignment.governance_locked)) {
        actions.push({
          label: 'Atur Penempatan / Jadwal',
          icon: '🗓️',
          onClick: function () { openMarketingBannerAssignmentEditor(row, false); }
        });
      }

      if (user.role === 'owner' || user.role === 'brand_manager') {
        actions.push({
          label: assignment.governance_locked ? 'Buka Kunci Manager' : 'Kunci untuk Branch Manager',
          icon: assignment.governance_locked ? '🔓' : '🔒',
          onClick: function () { toggleMarketingBannerGovernance(assignment.id, !assignment.governance_locked); }
        });
      }

      if (assignment.effective_status === 'ENDED' &&
          !(user.role === 'branch_manager' && assignment.governance_locked)) {
        actions.push({
          label: 'Gunakan Lagi',
          icon: '↻',
          onClick: function () { openMarketingBannerAssignmentEditor(row, true); }
        });
      }

      if (publicationStatus === 'PUBLISHED' && user.role !== 'branch_manager') {
        actions.push({ divider: true });
        actions.push({
          label: 'Tambah Penempatan Cabang',
          icon: '＋',
          onClick: function () { openMarketingBannerAssignmentEditor({ banner_id: row.banner_id || row.id }, false); }
        });
      }

      if (!(user.role === 'branch_manager' && assignment.governance_locked)) {
        actions.push({
          divider: true
        });
        actions.push({
          label: 'Hapus Penempatan',
          icon: '🗑️',
          destructive: true,
          onClick: function () { removeMarketingBannerAssignment(assignment.id); }
        });
      }
    } else {
      actions.push({
        label: 'Tempatkan ke Cabang',
        icon: '📍',
        onClick: function () { openMarketingBannerAssignmentEditor(row, false); }
      });
    }

    if (publicationStatus === 'DRAFT' && user.role !== 'branch_manager') {
      actions.push({
        label: 'Publish',
        icon: '🚀',
        onClick: function () { publishMarketingBanner(row.banner_id || row.id); }
      });
      actions.push({
        label: 'Hapus Draft',
        icon: '🗑️',
        destructive: true,
        onClick: function () { deleteMarketingBanner(row.banner_id || row.id); }
      });
    }

    if (publicationStatus === 'PUBLISHED' &&
        row.has_draft_changes &&
        user.role !== 'branch_manager') {
      actions.push({
        label: 'Buang Draft Perubahan',
        icon: '↩️',
        destructive: true,
        onClick: function () { discardMarketingBannerDraft(row.banner_id || row.id); }
      });
    }

    window.XentraActionMenu.open(trigger, actions);
  }

  function openMarketingBannerCreate() {
    _marketingBannerEditor = {
      mode: 'create',
      bannerId: null,
      mediaId: null,
      mediaFile: null,
      cropSpec: null,
      detail: null
    };

    setMarketingBannerEditorFields(null);
    populateMarketingBannerTargets(null);
    renderMarketingBannerEditorBranches(null);
    if ($('mkt-banner-schedule-enabled')) $('mkt-banner-schedule-enabled').checked = false;
    if ($('mkt-banner-schedule-fields')) $('mkt-banner-schedule-fields').style.display = 'none';
    if ($('mkt-banner-starts-at')) $('mkt-banner-starts-at').value = '';
    if ($('mkt-banner-ends-at')) $('mkt-banner-ends-at').value = '';
    if ($('mkt-banner-active')) $('mkt-banner-active').checked = true;
    if ($('mkt-banner-governance-lock')) $('mkt-banner-governance-lock').checked = false;
    setMarketingBannerEditorMode('create');

    var modal = $('modal-marketing-banner');
    if (modal) modal.style.display = 'flex';
  }
  window.openMarketingBannerCreate = openMarketingBannerCreate;

  async function openMarketingBannerEditor(bannerId) {
    try {
      var res = await adminFetch(API_BASE + '/admin/marketing/banners/' + encodeURIComponent(bannerId), {
        headers: getAuthHeaders()
      });
      var json = await res.json();
      if (!res.ok || !json.success || !json.banner) {
        throw new Error(json.error || 'Banner tidak ditemukan.');
      }

      _marketingBannerEditor = {
        mode: 'edit',
        bannerId: bannerId,
        mediaId: json.banner.draft_revision
          ? json.banner.draft_revision.media_id
          : (json.banner.published_revision ? json.banner.published_revision.media_id : null),
        mediaFile: null,
        cropSpec: null,
        detail: json.banner
      };

      setMarketingBannerEditorFields(json.banner);
      populateMarketingBannerTargets(json.banner);
      setMarketingBannerEditorMode('edit');

      var modal = $('modal-marketing-banner');
      if (modal) modal.style.display = 'flex';
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal membuka Banner.'));
    }
  }
  window.openMarketingBannerEditor = openMarketingBannerEditor;

  function setMarketingBannerEditorMode(mode) {
    var title = $('modal-marketing-banner-title');
    var subtitle = $('modal-marketing-banner-subtitle');
    var placement = $('mkt-banner-create-placement');
    var saveBtn = $('mkt-banner-save-draft');
    var editorPreviewBtn = $('mkt-banner-preview-from-editor');
    if (editorPreviewBtn && !editorPreviewBtn.dataset.bound) {
      editorPreviewBtn.dataset.bound = '1';
      editorPreviewBtn.addEventListener('click', previewMarketingBannerEditor);
    }

    var publishBtn = $('mkt-banner-publish-action');
    var stateEl = $('mkt-banner-editor-state');

    if (mode === 'create') {
      if (title) title.textContent = 'Tambah Banner';
      if (subtitle) subtitle.textContent = 'Buat content draft lalu pilih penempatan dan publikasi.';
      if (placement) placement.style.display = '';
      if (saveBtn) saveBtn.textContent = 'Simpan Draft';
      if (publishBtn) publishBtn.textContent = ($('mkt-banner-schedule-enabled') && $('mkt-banner-schedule-enabled').checked) ? 'Publikasikan & Jadwalkan' : 'Publish Sekarang';
      if (stateEl) stateEl.textContent = 'Mode baru · Content + penempatan opsional';
    } else {
      var detail = _marketingBannerEditor.detail && _marketingBannerEditor.detail.draft_revision
        ? 'Ada Draft revision yang belum dipublish.'
        : 'Mengedit content yang sudah tersimpan. Publish tetap eksplisit.';

      if (title) title.textContent = 'Edit Banner Content';
      if (subtitle) subtitle.textContent = detail;
      if (placement) placement.style.display = 'none';
      if (saveBtn) saveBtn.textContent = 'Simpan Draft Update';
      if (publishBtn) publishBtn.textContent = 'Publish Update';
      if (stateEl) stateEl.textContent = detail;
    }
  }

  function setMarketingBannerEditorFields(detail) {
    var titleEl = $('mkt-banner-title-field');
    var altEl = $('mkt-banner-alt-field');
    var ctaEl = $('mkt-banner-cta-type');
    var bannerIdEl = $('mkt-banner-id');

    if (bannerIdEl) bannerIdEl.value = detail ? (detail.id || '') : '';
    if (titleEl) titleEl.value = detail
      ? ((detail.draft_revision && detail.draft_revision.title) || (detail.published_revision && detail.published_revision.title) || '')
      : '';
    if (altEl) altEl.value = detail
      ? ((detail.draft_revision && detail.draft_revision.alt_text) || (detail.published_revision && detail.published_revision.alt_text) || '')
      : '';

    var revision = detail
      ? (detail.draft_revision || detail.published_revision || null)
      : null;

    if (ctaEl) ctaEl.value = revision ? (revision.cta_type || 'NONE') : 'NONE';

    setMarketingBannerEditorPreview(
      detail && detail.media && detail.media.preview_url
        ? detail.media.preview_url
        : null
    );

    updateMarketingBannerCtaFields();
  }

  function setMarketingBannerEditorPreview(src) {
    var img = $('mkt-banner-preview');
    var empty = $('mkt-banner-preview-empty');
    var clear = $('mkt-banner-clear');

    if (img && src) {
      img.src = src;
      img.style.display = 'block';
      if (empty) empty.style.display = 'none';
      if (clear) clear.style.display = _marketingBannerEditor.mediaFile ? 'inline-flex' : 'none';
    } else {
      if (img) {
        img.src = '';
        img.style.display = 'none';
      }
      if (empty) empty.style.display = 'flex';
      if (clear) clear.style.display = _marketingBannerEditor.mediaFile ? 'inline-flex' : 'none';
    }
  }

  function clearMarketingBannerMedia() {
    _marketingBannerEditor.mediaFile = null;
    _marketingBannerEditor.mediaId = _marketingBannerEditor.detail
      ? (_marketingBannerEditor.detail.draft_revision
        ? _marketingBannerEditor.detail.draft_revision.media_id
        : (_marketingBannerEditor.detail.published_revision
          ? _marketingBannerEditor.detail.published_revision.media_id
          : null))
      : null;
    _marketingBannerEditor.cropSpec = null;
    var file = $('mkt-banner-file');
    if (file) file.value = '';
    setMarketingBannerEditorPreview(
      _marketingBannerEditor.detail && _marketingBannerEditor.detail.media
        ? _marketingBannerEditor.detail.media.preview_url
        : null
    );
  }

  function closeMarketingBannerModal() {
    var modal = $('modal-marketing-banner');
    if (modal) modal.style.display = 'none';
  }
  window.closeMarketingBannerModal = closeMarketingBannerModal;

  function readMarketingBannerFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
      reader.readAsDataURL(file);
    });
  }

  async function processMarketingBannerMedia(file, cropSpec) {
    var base64 = await readMarketingBannerFileAsDataUrl(file);

    var uploadRes = await adminFetch(API_BASE + '/admin/media/upload', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        image_base64: base64,
        mime_type: file.type,
        original_filename: file.name,
        asset_type: 'banner',
        enforce_aspect_ratio: false
      })
    });

    var uploadJson = await uploadRes.json();
    if (!uploadRes.ok || !uploadJson.success || !uploadJson.asset) {
      throw new Error(uploadJson.error || 'Upload media Banner gagal.');
    }

    var mediaId = uploadJson.asset.media_id || uploadJson.asset.id;
    if (!mediaId) throw new Error('Media ID tidak dikembalikan server.');

    if (cropSpec) {
      var cropRes = await adminFetch(API_BASE + '/admin/media/' + encodeURIComponent(mediaId) + '/crop', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ crop_spec: cropSpec })
      });
      var cropJson = await cropRes.json();
      if (!cropRes.ok || !cropJson.success) {
        throw new Error(cropJson.error || 'Crop specification Banner gagal disimpan.');
      }
    }

    var processRes = await adminFetch(API_BASE + '/admin/media/' + encodeURIComponent(mediaId) + '/process', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ crop_spec: cropSpec || null })
    });
    var processJson = await processRes.json();
    if (!processRes.ok || !processJson.success || !processJson.asset) {
      throw new Error(processJson.error || 'Media Banner gagal diproses.');
    }

    return processJson.asset;
  }

  function onMarketingBannerFileSelected(file) {
    if (!file) return;

    var allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.indexOf(file.type) === -1) {
      showToast('❌ Format Banner harus JPG, PNG, atau WebP.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      showToast('❌ Ukuran Banner melebihi batas 20 MB.');
      return;
    }

    _marketingBannerEditor.mediaFile = file;
    _marketingBannerEditor.cropSpec = null;

    XentraCropEditor.open({
      source: file,
      assetType: 'banner',
      aspectRatio: 350 / 180,
      title: 'Sesuaikan Banner (~1.94:1)',
      onConfirm: function (cropSpec, previewDataUrl) {
        _marketingBannerEditor.cropSpec = cropSpec;
        setMarketingBannerEditorPreview(previewDataUrl || URL.createObjectURL(file));
        showToast('✓ Framing Banner disimpan untuk pemrosesan server.');
      },
      onCancel: function () {
        _marketingBannerEditor.cropSpec = null;
        readMarketingBannerFileAsDataUrl(file).then(function (src) {
          setMarketingBannerEditorPreview(src);
        }).catch(function () {});
      }
    });
  }

  function renderMarketingBannerEditorBranches(selectedIds) {
    var container = $('mkt-banner-branch-list');
    var allToggle = $('mkt-banner-all-branches');
    var countEl = $('mkt-banner-branch-selection-count');
    if (!container) return;

    var selected = new Set(Array.isArray(selectedIds) ? selectedIds.map(String) : []);
    var user = getMarketingBannerUser();
    var ownBranch = String(user.branch_id || user.branchId || '');

    var html = [];
    (_marketingBannersState.branches || []).forEach(function (branch) {
      if (user.role === 'branch_manager' && ownBranch && String(branch.id) !== ownBranch) return;

      html.push(
        '<label class="x-marketing-banner-branch-check">' +
          '<input type="checkbox" value="' + esc(branch.id) + '" data-banner-create-branch>' +
          '<span>' + esc(branch.name || branch.id) + '</span>' +
          '<small>' + esc(branch.timezone || 'Asia/Jakarta') + '</small>' +
        '</label>'
      );
    });

    container.innerHTML = html.length
      ? html.join('')
      : '<div class="text-muted" style="font-size:12px;padding:10px 0;">Tidak ada cabang yang tersedia dalam scope akun ini.</div>';

    container.querySelectorAll('[data-banner-create-branch]').forEach(function (input) {
      input.checked = selected.has(String(input.value));
      input.addEventListener('change', refreshMarketingBannerBranchSelection);
    });

    if (allToggle) {
      allToggle.checked = false;
      allToggle.indeterminate = false;
      allToggle.onchange = function () {
        var checkboxes = container.querySelectorAll('[data-banner-create-branch]');
        checkboxes.forEach(function (input) {
          input.checked = allToggle.checked;
        });
        refreshMarketingBannerBranchSelection();
      };
    }

    refreshMarketingBannerBranchSelection();
  }

  function refreshMarketingBannerBranchSelection() {
    var container = $('mkt-banner-branch-list');
    var countEl = $('mkt-banner-branch-selection-count');
    var allToggle = $('mkt-banner-all-branches');
    if (!container) return;

    var inputs = Array.prototype.slice.call(container.querySelectorAll('[data-banner-create-branch]'));
    var checked = inputs.filter(function (input) { return input.checked; }).length;

    if (countEl) countEl.textContent = checked + ' cabang dipilih';
    if (allToggle) {
      allToggle.checked = inputs.length > 0 && checked === inputs.length;
      allToggle.indeterminate = checked > 0 && checked < inputs.length;
    }
  }

  function getSelectedMarketingBannerBranchIds() {
    var container = $('mkt-banner-branch-list');
    if (!container) return [];
    return Array.prototype.slice.call(container.querySelectorAll('[data-banner-create-branch]:checked')).map(function (input) {
      return String(input.value);
    });
  }

  async function populateMarketingBannerTargets(detail) {
    var revision = detail
      ? (detail.draft_revision || detail.published_revision || null)
      : null;

    try {
      var results = await Promise.all([
        adminFetch(API_BASE + '/admin/marketing/promotions', { headers: getAuthHeaders() }),
        adminFetch(API_BASE + '/admin/products', { headers: getAuthHeaders() }),
        adminFetch(API_BASE + '/admin/categories', { headers: getAuthHeaders() })
      ]);

      var promoJson = await results[0].json();
      var productJson = await results[1].json();
      var categoryJson = await results[2].json();

      _marketingBannersState.promotions = promoJson && Array.isArray(promoJson.promotions) ? promoJson.promotions : [];
      _marketingBannersState.products = productJson && Array.isArray(productJson.products) ? productJson.products : [];
      _marketingBannersState.categories = categoryJson && Array.isArray(categoryJson.categories) ? categoryJson.categories : [];

      var promoSelect = $('mkt-banner-cta-promotion');
      var productSelect = $('mkt-banner-cta-product');
      var categorySelect = $('mkt-banner-cta-category');

      if (promoSelect) {
        promoSelect.innerHTML = '<option value="">Pilih Promotion</option>' +
          _marketingBannersState.promotions.map(function (item) {
            return '<option value="' + esc(item.id) + '">' + esc(item.name || item.code || item.id) + '</option>';
          }).join('');
        promoSelect.value = revision && revision.cta_type === 'PROMOTION' ? (revision.promotion_id || '') : '';
      }

      if (productSelect) {
        productSelect.innerHTML = '<option value="">Pilih Product</option>' +
          _marketingBannersState.products.map(function (item) {
            return '<option value="' + esc(item.id) + '">' + esc(item.name || item.id) + '</option>';
          }).join('');
        productSelect.value = revision && revision.cta_type === 'PRODUCT' ? (revision.cta_target_id || '') : '';
      }

      if (categorySelect) {
        categorySelect.innerHTML = '<option value="">Pilih Category</option>' +
          _marketingBannersState.categories.map(function (item) {
            return '<option value="' + esc(item.id) + '">' + esc(item.name || item.id) + '</option>';
          }).join('');
        categorySelect.value = revision && revision.cta_type === 'CATEGORY' ? (revision.cta_target_id || '') : '';
      }

      var urlInput = $('mkt-banner-cta-url');
      if (urlInput) {
        urlInput.value = revision && revision.cta_type === 'URL' ? (revision.cta_url || '') : '';
      }

      updateMarketingBannerCtaFields();
    } catch (err) {
      console.error('[Banner] target load error:', err);
      showToast('⚠️ Target CTA gagal dimuat. Banner tanpa CTA tetap dapat disimpan.');
    }
  }

  function updateMarketingBannerCtaFields() {
    var typeEl = $('mkt-banner-cta-type');
    var type = typeEl ? String(typeEl.value || 'NONE').toUpperCase() : 'NONE';

    var map = {
      PROMOTION: 'mkt-banner-cta-promotion-wrap',
      PRODUCT: 'mkt-banner-cta-product-wrap',
      CATEGORY: 'mkt-banner-cta-category-wrap',
      URL: 'mkt-banner-cta-url-wrap'
    };

    Object.keys(map).forEach(function (key) {
      var wrap = $(map[key]);
      if (wrap) wrap.style.display = key === type ? '' : 'none';
    });
  }

  function buildMarketingBannerContentPayload(mediaId) {
    var typeEl = $('mkt-banner-cta-type');
    var ctaType = typeEl ? String(typeEl.value || 'NONE').toUpperCase() : 'NONE';

    var payload = {
      media_id: mediaId,
      title: $('mkt-banner-title-field') ? $('mkt-banner-title-field').value.trim() : '',
      alt_text: $('mkt-banner-alt-field') ? $('mkt-banner-alt-field').value.trim() : '',
      cta_type: ctaType,
      cta_target_id: null,
      cta_url: null,
      promotion_id: null
    };

    if (ctaType === 'PROMOTION') {
      payload.promotion_id = $('mkt-banner-cta-promotion') ? $('mkt-banner-cta-promotion').value : null;
    } else if (ctaType === 'PRODUCT') {
      payload.cta_target_id = $('mkt-banner-cta-product') ? $('mkt-banner-cta-product').value : null;
    } else if (ctaType === 'CATEGORY') {
      payload.cta_target_id = $('mkt-banner-cta-category') ? $('mkt-banner-cta-category').value : null;
    } else if (ctaType === 'URL') {
      payload.cta_url = $('mkt-banner-cta-url') ? $('mkt-banner-cta-url').value.trim() : null;
    }

    return payload;
  }

  function getMarketingBannerPlacementPayload() {
    var selectedBranches = getSelectedMarketingBannerBranchIds();
    var scheduleEnabled = $('mkt-banner-schedule-enabled') ? $('mkt-banner-schedule-enabled').checked : false;

    return {
      branch_ids: selectedBranches,
      position: Number($('mkt-banner-position') && $('mkt-banner-position').value || 1),
      active: $('mkt-banner-active') ? $('mkt-banner-active').checked : true,
      starts_at_local: scheduleEnabled && $('mkt-banner-starts-at') ? $('mkt-banner-starts-at').value : '',
      ends_at_local: scheduleEnabled && $('mkt-banner-ends-at') ? $('mkt-banner-ends-at').value : '',
      governance_locked: $('mkt-banner-governance-lock') ? $('mkt-banner-governance-lock').checked : false
    };
  }

  async function saveMarketingBannerDraft(shouldPublish) {
    var submitBtn = $('mkt-banner-save-draft');
    var publishBtn = $('mkt-banner-publish-action');

    if (submitBtn) submitBtn.disabled = true;
    if (publishBtn) publishBtn.disabled = true;

    try {
      var mediaId = _marketingBannerEditor.mediaId;

      if (_marketingBannerEditor.mediaFile) {
        var asset = await processMarketingBannerMedia(
          _marketingBannerEditor.mediaFile,
          _marketingBannerEditor.cropSpec
        );
        mediaId = asset.media_id || asset.id;
        _marketingBannerEditor.mediaId = mediaId;
      }

      if (!mediaId) {
        throw new Error('Media Banner wajib dipilih.');
      }

      var payload = buildMarketingBannerContentPayload(mediaId);
      var banner;

      if (_marketingBannerEditor.mode === 'create') {
        var createRes = await adminFetch(API_BASE + '/admin/marketing/banners', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var createJson = await createRes.json();
        if (!createRes.ok || !createJson.success) {
          throw new Error(createJson.error || 'Gagal membuat Banner.');
        }
        banner = createJson.banner;
        _marketingBannerEditor.bannerId = banner.id;

        var placementPayload = getMarketingBannerPlacementPayload();
        if (!placementPayload.branch_ids.length &&
            (placementPayload.starts_at_local || placementPayload.ends_at_local)) {
          throw new Error('Jadwal tayang membutuhkan minimal satu cabang target.');
        }

        if (placementPayload.branch_ids.length) {
          var assignRes = await adminFetch(
            API_BASE + '/admin/marketing/banners/' + encodeURIComponent(banner.id) + '/assignments/bulk',
            {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify(placementPayload)
            }
          );
          var assignJson = await assignRes.json();
          if (!assignRes.ok || !assignJson.success) {
            throw new Error(assignJson.error || 'Banner dibuat, tetapi penempatan gagal.');
          }
        }
      } else {
        var updateRes = await adminFetch(
          API_BASE + '/admin/marketing/banners/' + encodeURIComponent(_marketingBannerEditor.bannerId) + '/draft',
          {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
          }
        );
        var updateJson = await updateRes.json();
        if (!updateRes.ok || !updateJson.success) {
          throw new Error(updateJson.error || 'Gagal menyimpan Draft Banner.');
        }
        banner = updateJson.banner;
      }

      if (shouldPublish) {
        var publishRes = await adminFetch(
          API_BASE + '/admin/marketing/banners/' + encodeURIComponent(_marketingBannerEditor.bannerId) + '/publish',
          {
            method: 'POST',
            headers: getAuthHeaders(),
            body: '{}'
          }
        );
        var publishJson = await publishRes.json();
        if (!publishRes.ok || !publishJson.success) {
          if (publishRes.status === 409 && publishJson.conflict) {
            throw new Error('Publish ditolak: position pada Branch memiliki visibility window yang bentrok. Atur penempatan/jadwal terlebih dahulu.');
          }
          throw new Error(publishJson.error || 'Gagal Publish Banner.');
        }
      }

      closeMarketingBannerModal();
      await loadMarketingBanners();
      showToast(shouldPublish ? '✅ Banner berhasil dipublish.' : '✅ Draft Banner tersimpan.');
    } catch (err) {
      console.error('[Banner] save error:', err);
      showToast('❌ ' + (err.message || 'Gagal menyimpan Banner.'));
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      if (publishBtn) publishBtn.disabled = false;
    }
  }

  function submitMarketingBannerForm(event) {
    if (event) event.preventDefault();
    saveMarketingBannerDraft(false);
  }

  async function publishMarketingBanner(bannerId) {
    try {
      var res = await adminFetch(API_BASE + '/admin/marketing/banners/' + encodeURIComponent(bannerId) + '/publish', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: '{}'
      });
      var json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal Publish Banner.');
      }
      await loadMarketingBanners();
      showToast('✅ Banner berhasil dipublish.');
    } catch (err) {
      showToast('❌ ' + (err.message || 'Publish gagal.'));
    }
  }
  window.publishMarketingBanner = publishMarketingBanner;

  async function discardMarketingBannerDraft(bannerId) {
    if (!confirm('Buang Draft perubahan ini? Versi Banner yang sedang Published akan tetap digunakan.')) return;

    try {
      var res = await adminFetch(
        API_BASE + '/admin/marketing/banners/' + encodeURIComponent(bannerId) + '/discard-draft',
        {
          method: 'POST',
          headers: getAuthHeaders(),
          body: '{}'
        }
      );

      var json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal membuang Draft perubahan.');
      }

      await loadMarketingBanners();
      showToast('✅ Draft perubahan dibuang. Versi Published tetap aktif.');
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal membuang Draft perubahan.'));
    }
  }
  window.discardMarketingBannerDraft = discardMarketingBannerDraft;

  async function deleteMarketingBanner(bannerId) {
    if (!confirm('Hapus Draft Banner ini? Banner yang sudah pernah dipublish tidak dapat dihapus dari menu ini.')) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/marketing/banners/' + encodeURIComponent(bannerId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal menghapus Draft.');
      }
      await loadMarketingBanners();
      showToast('✅ Draft Banner dihapus.');
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal menghapus Draft.'));
    }
  }
  window.deleteMarketingBanner = deleteMarketingBanner;

  function previewMarketingBannerEditor() {
    var modal = $('modal-marketing-banner-preview');
    var stage = $('mkt-banner-preview-stage');
    var meta = $('mkt-banner-preview-meta');

    if (!modal || !stage) return;

    var title = $('mkt-banner-title-field') ? $('mkt-banner-title-field').value.trim() : 'Banner';
    var alt = $('mkt-banner-alt-field') ? $('mkt-banner-alt-field').value.trim() : title;
    var src = $('mkt-banner-preview') ? $('mkt-banner-preview').src : '';
    var ctaType = $('mkt-banner-cta-type') ? $('mkt-banner-cta-type').value : 'NONE';
    var scheduleEnabled = $('mkt-banner-schedule-enabled') ? $('mkt-banner-schedule-enabled').checked : false;
    var startsAt = scheduleEnabled && $('mkt-banner-starts-at') ? $('mkt-banner-starts-at').value : '';
    var endsAt = scheduleEnabled && $('mkt-banner-ends-at') ? $('mkt-banner-ends-at').value : '';
    var selectedBranches = getSelectedMarketingBannerBranchIds();

    $('modal-banner-preview-title').textContent = title || 'Preview Banner';
    $('modal-banner-preview-subtitle').textContent = 'Review / Preview · Belum dipublish';

    var img = src
      ? '<img src="' + esc(src) + '" alt="' + esc(alt || title || 'Banner') + '">'
      : '<div class="x-marketing-banner-preview-stage-empty">Belum ada media preview.</div>';

    stage.innerHTML =
      img +
      '<div class="x-marketing-banner-preview-stage-caption">' +
        '<strong>' + esc(title || 'Tanpa judul') + '</strong>' +
        '<span>' + esc(ctaType || 'NONE') + '</span>' +
      '</div>';

    var branchNames = [];
    (_marketingBannersState.branches || []).forEach(function (branch) {
      if (selectedBranches.indexOf(String(branch.id)) >= 0) {
        branchNames.push(branch.name || branch.id);
      }
    });

    meta.innerHTML = [
      '<div><span>Mode</span><strong>Draft / Review</strong></div>',
      '<div><span>CTA</span><strong>' + esc(ctaType || 'NONE') + '</strong></div>',
      '<div><span>Cabang</span><strong>' + esc(branchNames.length ? branchNames.join(', ') : 'Belum ditempatkan') + '</strong></div>',
      '<div><span>Schedule</span><strong>' + esc(scheduleEnabled ? ((startsAt || 'Mulai belum diisi') + (endsAt ? ' → ' + endsAt : '')) : 'Tanpa jadwal') + '</strong></div>'
    ].join('');

    modal.style.display = 'flex';
  }
  window.previewMarketingBannerEditor = previewMarketingBannerEditor;

  function openMarketingBannerPreview(key) {
    var row = findMarketingBannerRow(key);
    if (!row) return;

    var modal = $('modal-marketing-banner-preview');
    var stage = $('mkt-banner-preview-stage');
    var meta = $('mkt-banner-preview-meta');
    var title = $('modal-banner-preview-title');
    var subtitle = $('modal-banner-preview-subtitle');

    if (title) title.textContent = row.title || 'Preview Banner';

    var assignment = row.assignment;
    if (subtitle) {
      subtitle.textContent = assignment
        ? (assignment.branch_name || 'Customer Storefront') + ' · Homepage Banner'
        : 'Customer Storefront · Content belum ditempatkan';
    }

    if (stage) {
      var src = row.media && row.media.preview_url;
      var revision = row.draft_revision || row.published_revision || null;
      var img = src
        ? '<img src="' + esc(src) + '" alt="' + esc(row.alt_text || row.title || 'Banner') + '">'
        : '<div class="x-marketing-banner-preview-stage-empty">Belum ada media preview.</div>';

      stage.innerHTML =
        img +
        '<div class="x-marketing-banner-preview-stage-caption">' +
          '<strong>' + esc(row.title || 'Tanpa judul') + '</strong>' +
          '<span>' + esc((revision && revision.cta_type) || 'NONE') + '</span>' +
        '</div>';
    }

    if (meta) {
      var revision2 = row.draft_revision || row.published_revision || null;
      var lines = [
        '<div><span>Publikasi</span><strong>' + esc(String(row.publication_status || 'DRAFT')) + '</strong></div>',
        '<div><span>Placement</span><strong>Homepage Banner</strong></div>',
        '<div><span>Cabang</span><strong>' + esc(assignment ? assignment.branch_name : 'Belum ditempatkan') + '</strong></div>',
        '<div><span>Position</span><strong>' + esc(assignment ? String(assignment.position) : '—') + '</strong></div>',
        '<div><span>Jadwal</span><strong>' + esc(formatMarketingBannerScheduleWithTz(assignment)) + '</strong></div>',
        '<div><span>Visibility</span><strong>' + esc(assignment ? String(assignment.effective_status || '—') : '—') + '</strong></div>',
        '<div><span>CTA</span><strong>' + esc(revision2 ? (revision2.cta_type || 'NONE') : 'NONE') + '</strong></div>'
      ];

      if (revision2 && revision2.promotion_id) {
        lines.push('<div><span>Promotion</span><strong>' + esc(revision2.promotion_id) + '</strong></div>');
      }

      meta.innerHTML = lines.join('');
    }

    if (modal) modal.style.display = 'flex';
  }
  window.openMarketingBannerPreview = openMarketingBannerPreview;

  function closeMarketingBannerPreview() {
    var modal = $('modal-marketing-banner-preview');
    if (modal) modal.style.display = 'none';
  }
  window.closeMarketingBannerPreview = closeMarketingBannerPreview;

  function branchLocalInputFromUtc(iso, timeZone) {
    if (!iso) return '';
    var p = bannerDateTimeParts(iso, timeZone || 'Asia/Jakarta');
    if (!p) return '';
    return p.year + '-' +
      String(p.month).padStart(2, '0') + '-' +
      String(p.day).padStart(2, '0') + 'T' +
      String(p.hour).padStart(2, '0') + ':' +
      String(p.minute).padStart(2, '0');
  }

  function populateMarketingBannerAssignmentBranchSelect(selectedBranchId, disabled) {
    var select = $('mkt-assignment-branch');
    if (!select) return;

    var user = getMarketingBannerUser();
    var ownBranch = String(user.branch_id || user.branchId || '');
    var options = [];

    (_marketingBannersState.branches || []).forEach(function (branch) {
      if (user.role === 'branch_manager' && ownBranch && String(branch.id) !== ownBranch) return;
      options.push('<option value="' + esc(branch.id) + '">' + esc(branch.name || branch.id) + '</option>');
    });

    select.innerHTML = options.length ? options.join('') : '<option value="">Tidak ada cabang</option>';
    if (selectedBranchId) select.value = String(selectedBranchId);

    select.disabled = Boolean(disabled);

    updateMarketingBannerAssignmentTimezone();
  }

  function updateMarketingBannerAssignmentTimezone() {
    var select = $('mkt-assignment-branch');
    var note = $('mkt-assignment-timezone');
    if (!select || !note) return;

    var selected = (_marketingBannersState.branches || []).find(function (branch) {
      return String(branch.id) === String(select.value);
    });

    note.textContent = selected
      ? 'Timezone Branch: ' + (selected.timezone || 'Asia/Jakarta') + '. Input jadwal menggunakan waktu lokal Branch.'
      : '';
  }

  function setAssignmentLocalFields(assignment) {
    var tz = assignment
      ? (assignment.branch_timezone || assignment.timezone || 'Asia/Jakarta')
      : 'Asia/Jakarta';

    var enabled = Boolean(assignment && (assignment.starts_at || assignment.ends_at));

    var scheduleToggle = $('mkt-assignment-schedule-enabled');
    var fields = $('mkt-assignment-schedule-fields');
    var start = $('mkt-assignment-starts-at');
    var end = $('mkt-assignment-ends-at');

    if (scheduleToggle) scheduleToggle.checked = enabled;
    if (fields) fields.style.display = enabled ? '' : 'none';
    if (start) start.value = enabled ? branchLocalInputFromUtc(assignment.starts_at, tz) : '';
    if (end) end.value = enabled ? branchLocalInputFromUtc(assignment.ends_at, tz) : '';
  }

  function openMarketingBannerAssignmentEditor(row, reuse) {
    var bannerId = row.banner_id || row.id;
    var assignment = row.assignment || null;

    _marketingBannerAssignmentEditor = {
      bannerId: bannerId,
      assignmentId: assignment && assignment.id ? assignment.id : null,
      mode: assignment && assignment.id ? 'edit' : 'create'
    };

    var title = $('modal-banner-assignment-title');
    var subtitle = $('modal-banner-assignment-subtitle');
    var saveBtn = $('btn-save-banner-assignment');
    var activeEl = $('mkt-assignment-active');
    var positionEl = $('mkt-assignment-position');
    var lockEl = $('mkt-assignment-governance-lock');
    var lockWrap = $('mkt-assignment-governance-wrap');

    if (title) title.textContent = reuse ? 'Gunakan Lagi Banner' : (assignment ? 'Atur Penempatan Banner' : 'Tempatkan Banner ke Cabang');
    if (subtitle) subtitle.textContent = assignment
      ? 'Branch, position, Active, dan jadwal. Record ENDED tetap dapat digunakan kembali.'
      : 'Pilih Branch target dan aturan visibility.';
    if (saveBtn) saveBtn.textContent = assignment ? 'Simpan Perubahan' : 'Simpan Penempatan';

    populateMarketingBannerAssignmentBranchSelect(
      assignment ? assignment.branch_id : '',
      Boolean(assignment)
    );

    if (positionEl) positionEl.value = assignment ? Number(assignment.position || 1) : 1;
    if (activeEl) activeEl.checked = assignment ? Boolean(assignment.active) : true;

    if (reuse && assignment) {
      var tz = assignment.branch_timezone || assignment.timezone || 'Asia/Jakarta';
      if ($('mkt-assignment-schedule-enabled')) $('mkt-assignment-schedule-enabled').checked = true;
      if ($('mkt-assignment-schedule-fields')) $('mkt-assignment-schedule-fields').style.display = '';
      if ($('mkt-assignment-starts-at')) $('mkt-assignment-starts-at').value = '';
      if ($('mkt-assignment-ends-at')) $('mkt-assignment-ends-at').value = '';
      if ($('mkt-assignment-timezone')) $('mkt-assignment-timezone').textContent = 'Timezone Branch: ' + tz + '. Masukkan jadwal baru untuk memakai Banner kembali.';
    } else {
      setAssignmentLocalFields(assignment);
    }

    if (lockEl) {
      lockEl.checked = assignment ? Boolean(assignment.governance_locked) : false;
    }

    var user = getMarketingBannerUser();
    if (lockWrap) {
      lockWrap.style.display = (user.role === 'owner' || user.role === 'brand_manager') ? 'inline-flex' : 'none';
      if (user.role === 'branch_manager') {
        lockEl.checked = false;
        lockEl.disabled = true;
      } else if (lockEl) {
        lockEl.disabled = false;
      }
    }

    var modal = $('modal-marketing-banner-assignment');
    if (modal) modal.style.display = 'flex';
  }
  window.openMarketingBannerAssignmentEditor = openMarketingBannerAssignmentEditor;

  function closeMarketingBannerAssignmentModal() {
    var modal = $('modal-marketing-banner-assignment');
    if (modal) modal.style.display = 'none';
  }
  window.closeMarketingBannerAssignmentModal = closeMarketingBannerAssignmentModal;

  async function saveMarketingBannerAssignment(event) {
    if (event) event.preventDefault();

    var editor = _marketingBannerAssignmentEditor;
    var branchId = $('mkt-assignment-branch') ? $('mkt-assignment-branch').value : '';
    var position = $('mkt-assignment-position') ? Number($('mkt-assignment-position').value || 1) : 1;
    var scheduleEnabled = $('mkt-assignment-schedule-enabled') ? $('mkt-assignment-schedule-enabled').checked : false;
    var active = $('mkt-assignment-active') ? $('mkt-assignment-active').checked : true;

    if (!branchId) {
      showToast('❌ Branch wajib dipilih.');
      return;
    }

    var payload = {
      branch_id: branchId,
      placement: 'HOME_BANNER_CAROUSEL',
      position: position,
      active: active,
      starts_at_local: scheduleEnabled && $('mkt-assignment-starts-at') ? $('mkt-assignment-starts-at').value : '',
      ends_at_local: scheduleEnabled && $('mkt-assignment-ends-at') ? $('mkt-assignment-ends-at').value : '',
      governance_locked: $('mkt-assignment-governance-lock') ? $('mkt-assignment-governance-lock').checked : false
    };

    var btn = $('btn-save-banner-assignment');
    if (btn) btn.disabled = true;

    try {
      var url;
      var method;

      if (editor.mode === 'create') {
        url = API_BASE + '/admin/marketing/banners/' + encodeURIComponent(editor.bannerId) + '/assignments';
        method = 'POST';
      } else {
        url = API_BASE + '/admin/marketing/banners/' + encodeURIComponent(editor.bannerId) + '/assignments/' + encodeURIComponent(editor.assignmentId);
        method = 'PATCH';
        delete payload.branch_id;
        delete payload.placement;
      }

      var res = await adminFetch(url, {
        method: method,
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal menyimpan Assignment.');
      }

      closeMarketingBannerAssignmentModal();
      await loadMarketingBanners();
      showToast('✅ Penempatan Banner berhasil diperbarui.');
    } catch (err) {
      var suffix = err && err.message ? err.message : 'Gagal menyimpan Assignment.';
      showToast('❌ ' + suffix);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function toggleMarketingBannerAssignment(assignmentId, active) {
    var row = _marketingBannersState.rows.find(function (item) {
      return item.assignment && String(item.assignment.id) === String(assignmentId);
    });

    if (!row || !row.assignment) return;

    if (isMarketingBannerBranchManager() && row.assignment.governance_locked) {
      showToast('⚠️ Assignment ini dikunci Owner.');
      await loadMarketingBanners();
      return;
    }

    try {
      var res = await adminFetch(
        API_BASE + '/admin/marketing/banners/' + encodeURIComponent(row.banner_id || row.id) + '/assignments/' + encodeURIComponent(assignmentId),
        {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ active: Boolean(active) })
        }
      );

      var json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal mengubah visibility Banner.');
      }

      await loadMarketingBanners();
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal mengubah visibility Banner.'));
      await loadMarketingBanners();
    }
  }

  async function toggleMarketingBannerGovernance(assignmentId, locked) {
    var row = _marketingBannersState.rows.find(function (item) {
      return item.assignment && String(item.assignment.id) === String(assignmentId);
    });

    if (!row) return;

    try {
      var res = await adminFetch(
        API_BASE + '/admin/marketing/banners/' + encodeURIComponent(row.banner_id || row.id) + '/assignments/' + encodeURIComponent(assignmentId),
        {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ governance_locked: Boolean(locked) })
        }
      );
      var json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal mengubah governance lock.');
      }

      await loadMarketingBanners();
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal mengubah lock Banner.'));
    }
  }

  async function removeMarketingBannerAssignment(assignmentId) {
    var row = _marketingBannersState.rows.find(function (item) {
      return item.assignment && String(item.assignment.id) === String(assignmentId);
    });
    if (!row) return;

    if (!confirm('Hapus penempatan Banner dari cabang ini? Content Banner tetap tersimpan.')) return;

    try {
      var res = await adminFetch(
        API_BASE + '/admin/marketing/banners/' + encodeURIComponent(row.banner_id || row.id) + '/assignments/' + encodeURIComponent(assignmentId),
        {
          method: 'DELETE',
          headers: getAuthHeaders()
        }
      );
      var json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal menghapus Assignment.');
      }

      await loadMarketingBanners();
      showToast('✅ Penempatan Banner dihapus.');
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal menghapus Assignment.'));
    }
  }
  window.removeMarketingBannerAssignment = removeMarketingBannerAssignment;

  function wireMarketingBannerUi() {
    var createBtn = $('btn-mkt-create-banner');
    if (createBtn && !createBtn.dataset.bound) {
      createBtn.dataset.bound = '1';
      createBtn.addEventListener('click', openMarketingBannerCreate);
    }

    var filter = $('mkt-banners-branch-filter');
    if (filter && !filter.dataset.bound) {
      filter.dataset.bound = '1';
      filter.addEventListener('change', function () {
        _marketingBannersState.branchFilter = filter.value || '';
        loadMarketingBanners();
      });
    }

    var filePick = $('mkt-banner-pick');
    var fileInput = $('mkt-banner-file');
    if (filePick && fileInput && !filePick.dataset.bound) {
      filePick.dataset.bound = '1';
      filePick.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) {
          onMarketingBannerFileSelected(fileInput.files[0]);
        }
      });
    }

    var clear = $('mkt-banner-clear');
    if (clear && !clear.dataset.bound) {
      clear.dataset.bound = '1';
      clear.addEventListener('click', clearMarketingBannerMedia);
    }

    var ctaType = $('mkt-banner-cta-type');
    if (ctaType && !ctaType.dataset.bound) {
      ctaType.dataset.bound = '1';
      ctaType.addEventListener('change', updateMarketingBannerCtaFields);
    }

    var schedule = $('mkt-banner-schedule-enabled');
    var scheduleFields = $('mkt-banner-schedule-fields');
    if (schedule && !schedule.dataset.bound) {
      schedule.dataset.bound = '1';
      schedule.addEventListener('change', function () {
        if (scheduleFields) scheduleFields.style.display = schedule.checked ? '' : 'none';
        var publishAction = $('mkt-banner-publish-action');
        if (publishAction && _marketingBannerEditor.mode === 'create') {
          publishAction.textContent = schedule.checked ? 'Publikasikan & Jadwalkan' : 'Publish Sekarang';
        }
      });
    }

    var assignmentBranch = $('mkt-assignment-branch');
    if (assignmentBranch && !assignmentBranch.dataset.bound) {
      assignmentBranch.dataset.bound = '1';
      assignmentBranch.addEventListener('change', updateMarketingBannerAssignmentTimezone);
    }

    var assignmentSchedule = $('mkt-assignment-schedule-enabled');
    var assignmentScheduleFields = $('mkt-assignment-schedule-fields');
    if (assignmentSchedule && !assignmentSchedule.dataset.bound) {
      assignmentSchedule.dataset.bound = '1';
      assignmentSchedule.addEventListener('change', function () {
        if (assignmentScheduleFields) assignmentScheduleFields.style.display = assignmentSchedule.checked ? '' : 'none';
      });
    }

    var form = $('form-marketing-banner');
    if (form && !form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', submitMarketingBannerForm);
    }

    var publishBtn = $('mkt-banner-publish-action');
    if (publishBtn && !publishBtn.dataset.bound) {
      publishBtn.dataset.bound = '1';
      publishBtn.addEventListener('click', function () { saveMarketingBannerDraft(true); });
    }

    var assignmentForm = $('form-marketing-banner-assignment');
    if (assignmentForm && !assignmentForm.dataset.bound) {
      assignmentForm.dataset.bound = '1';
      assignmentForm.addEventListener('submit', saveMarketingBannerAssignment);
    }

    if ($('mkt-banner-governance-wrap')) {
      var user = getMarketingBannerUser();
      $('mkt-banner-governance-wrap').style.display = (user.role === 'owner' || user.role === 'brand_manager') ? 'inline-flex' : 'none';
    }
  }

  function initializeMarketingBanners() {
    wireMarketingBannerUi();
    loadMarketingBanners();
  }

  window.renderMarketingBannersSkeleton = initializeMarketingBanners;
  window.initializeMarketingBanners = initializeMarketingBanners;

  async function loadMarketingOverview() {
    try {
      var branchId = getEffectiveBranchId();
      var query = branchId && branchId !== 'all' ? '?branch_id=' + encodeURIComponent(branchId) : '';
      var res = await adminFetch('/api/v1/admin/marketing/overview' + query, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var json = await res.json();
      if (!json.success || !json.data) return;

      var cm = json.data.customer_metrics || {};
      var pm = json.data.promotion_metrics || {};

      var totalCustEl = $('mkt-total-customers');
      var retCustEl = $('mkt-returning-customers');
      var repRateSubEl = $('mkt-repeat-rate-sub');
      var activePromoEl = $('mkt-active-promotions');
      var totalPromoSubEl = $('mkt-total-promotions-sub');
      var totalRedEl = $('mkt-total-redemptions');
      var benefitSubEl = $('mkt-benefit-sub');

      if (totalCustEl) totalCustEl.textContent = cm.total_customers || 0;
      if (retCustEl) retCustEl.textContent = cm.returning_customers || 0;
      if (repRateSubEl) repRateSubEl.textContent = 'Repeat rate: ' + (cm.repeat_purchase_rate_pct || 0) + '%';
      if (activePromoEl) activePromoEl.textContent = pm.active_promotions || 0;
      if (totalPromoSubEl) totalPromoSubEl.textContent = (pm.total_promotions || 0) + ' program terdaftar';
      if (totalRedEl) totalRedEl.textContent = pm.total_redemptions || 0;
      if (benefitSubEl) benefitSubEl.textContent = 'Total manfaat: ' + formatMoney(pm.total_benefit_amount || 0);

      var tbody = $('tbody-mkt-recent-redemptions');
      if (tbody) {
        var recs = json.data.recent_redemptions || [];
        if (recs.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Belum ada klaim promosi yang tercatat.</td></tr>';
        } else {
          var rows = recs.map(function (r) {
            var timeText = r.redeemed_at ? esc(r.redeemed_at.substring(0, 19).replace('T', ' ')) : '—';
            return '<tr>' +
              '<td><strong>' + esc(r.promotion_name || 'Program Promosi') + '</strong></td>' +
              '<td><a href="#orders/' + encodeURIComponent(r.order_id) + '" style="font-weight:600;color:var(--primary);text-decoration:none;">#' + esc(r.order_id) + '</a></td>' +
              '<td>' + esc(r.branch_name || 'Cabang Utama') + '</td>' +
              '<td><code style="font-size:12px;background:#f8fafc;padding:2px 6px;border-radius:4px;">' + esc(r.customer_phone || '—') + '</code></td>' +
              '<td><span style="color:#059669;font-weight:700;">' + formatMoney(r.benefit_amount || 0) + '</span></td>' +
              '<td style="font-size:12px;color:#64748b;">' + timeText + '</td>' +
            '</tr>';
          });
          tbody.innerHTML = rows.join('');
        }
      }
    } catch (err) {
      console.error('[Load Marketing Overview Error]:', err);
      showToast('Gagal memuat ringkasan marketing.');
    }
  }
  window.loadMarketingOverview = loadMarketingOverview;

  var _marketingPromotionsState = {
    promotions: [],
    masterProducts: [],
    branches: []
  };

  async function loadMarketingPromotions() {
    try {
      var tbody = $('tbody-mkt-promotions');
      if (!tbody) return;

      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Memuat daftar promosi...</td></tr>';

      var res = await adminFetch('/api/v1/admin/marketing/promotions', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var json = await res.json();
      if (!json.success || !json.promotions) return;

      var promos = json.promotions || [];
      _marketingPromotionsState.promotions = promos;

      var user = getStoredUser();
      var isOwner = user && user.role === 'owner';

      if (promos.length === 0) {
        var createFirstBtn = isOwner ? '<button type="button" class="x-btn-primary" onclick="openCreatePromotionModal()" style="font-size:12px;padding:6px 14px;">+ Buat Promo Pertama</button>' : '';
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8">' +
          '<div style="font-size:36px;margin-bottom:8px;">🎁</div>' +
          '<div style="font-weight:700;color:var(--text-main);margin-bottom:4px;">Belum Ada Program Promosi</div>' +
          '<p class="text-muted" style="font-size:12px;margin:0 0 12px;">' + (isOwner ? 'Mulai buat promosi pertama seperti Insentif Instalasi PWA untuk mendorong retensi pelanggan.' : 'Belum ada program promosi.') + '</p>' +
          createFirstBtn +
          '</td></tr>';
        return;
      }

      var nowIso = new Date().toISOString();
      var rows = promos.map(function (p) {
        var statusBadge = '';
        if (p.is_active !== 1 && p.is_active !== true) {
          statusBadge = '<span class="x-badge" style="background:#f1f5f9;color:#64748b;font-weight:600;">Nonaktif</span>';
        } else if (p.start_at && p.start_at > nowIso) {
          statusBadge = '<span class="x-badge" style="background:#fef3c7;color:#b45309;font-weight:700;">Terjadwal</span>';
        } else if (p.end_at && p.end_at < nowIso) {
          statusBadge = '<span class="x-badge" style="background:#fee2e2;color:#b91c1c;font-weight:700;">Berakhir</span>';
        } else {
          statusBadge = '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:700;">Aktif</span>';
        }

        // Format Reward summary
        var rewardSummary = '—';
        if (Array.isArray(p.rewards) && p.rewards.length > 0) {
          var r0 = p.rewards[0];
          if (r0.reward_type === 'freebie_product') {
            rewardSummary = '<span style="font-weight:600;color:#0369a1;">🎁 ' + esc(r0.target_product_name || r0.target_product_id || 'Produk Gratis') + '</span>';
          } else {
            rewardSummary = esc(r0.reward_type);
          }
        }

        // Format Branch Scopes summary
        var scopeSummary = '<span class="x-badge" style="background:#f1f5f9;color:#475569;font-size:11px;">Semua Cabang</span>';
        if (Array.isArray(p.scopes) && p.scopes.length > 0) {
          var activeScopes = p.scopes.filter(function (s) { return s.is_active === 1; });
          scopeSummary = '<span class="x-badge" style="background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:600;">' +
            activeScopes.length + ' Cabang Aktif</span>';
        }

        // Capability display
        var capLabel = esc(p.capability_type || 'general');
        if (p.capability_type === 'install_incentive') capLabel = '📱 Insentif PWA';
        else if (p.capability_type === 'first_order') capLabel = '🥇 First Order';

        var actionBtns = '';
        if (isOwner) {
          actionBtns += '<button type="button" class="x-btn-secondary" onclick="openEditPromotionModal(\'' + esc(p.id) + '\')" style="padding:4px 8px;font-size:11px;margin-right:4px;">Edit</button>';
        }
        actionBtns += '<button type="button" class="x-btn-secondary" onclick="toggleMarketingPromotionActive(\'' + esc(p.id) + '\', ' + (p.is_active === 1 ? 0 : 1) + ')" style="padding:4px 8px;font-size:11px;margin-right:4px;">' +
          (p.is_active === 1 ? 'Nonaktifkan' : 'Aktifkan') +
        '</button>';
        if (isOwner) {
          actionBtns += '<button type="button" class="x-btn-secondary" onclick="deleteMarketingPromotion(\'' + esc(p.id) + '\')" style="padding:4px 8px;font-size:11px;color:#dc2626;">Hapus</button>';
        }

        return '<tr>' +
          '<td><strong>' + esc(p.name) + '</strong>' + (p.code ? ' <code style="font-size:11px;background:#f1f5f9;padding:2px 4px;border-radius:4px;">' + esc(p.code) + '</code>' : '') + '</td>' +
          '<td><span class="x-badge" style="background:#f0f9ff;color:#0369a1;font-size:11px;">' + capLabel + '</span><br><code style="font-size:10px;color:#64748b;">' + esc(p.stacking_policy) + '</code></td>' +
          '<td>' + rewardSummary + '</td>' +
          '<td>' + scopeSummary + '</td>' +
          '<td><strong>' + (p.redemptions_count || 0) + '</strong> klaim</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td style="text-align:right;white-space:nowrap;">' + actionBtns + '</td>' +
        '</tr>';
      });

      tbody.innerHTML = rows.join('');
    } catch (err) {
      console.error('[Load Marketing Promotions Error]:', err);
      showToast('Gagal memuat daftar promosi.');
    }
  }
  window.loadMarketingPromotions = loadMarketingPromotions;

  async function ensureMarketingDependenciesLoaded() {
    try {
      if (!_marketingPromotionsState.masterProducts.length) {
        var pRes = await adminFetch('/api/v1/admin/catalog/products', { headers: getAuthHeaders() });
        if (pRes.ok) {
          var pData = await pRes.json();
          _marketingPromotionsState.masterProducts = (pData && (pData.products || pData.data)) || [];
        }
      }
      if (!_marketingPromotionsState.branches.length) {
        var bRes = await adminFetch('/api/v1/admin/branches', { headers: getAuthHeaders() });
        if (bRes.ok) {
          var bData = await bRes.json();
          _marketingPromotionsState.branches = (bData && (bData.branches || bData.data)) || [];
        }
      }
    } catch (e) {
      console.warn('[Marketing Dependencies Load Warn]:', e);
    }
  }

  function renderPromoProductOptions(selectedProductId) {
    var selectEl = $('mkt-promo-target-product');
    if (!selectEl) return;

    var prods = _marketingPromotionsState.masterProducts || [];
    if (!prods.length) {
      selectEl.innerHTML = '<option value="">-- Tidak ada produk katalog master ditemukan --</option>';
      return;
    }

    var html = '<option value="">-- Pilih Produk Hadiah --</option>';
    prods.forEach(function (p) {
      var isSel = String(p.id) === String(selectedProductId) ? ' selected' : '';
      var priceText = p.price ? ' (' + formatMoney(p.price) + ')' : '';
      html += '<option value="' + esc(p.id) + '"' + isSel + '>' + esc(p.name) + priceText + '</option>';
    });
    selectEl.innerHTML = html;
  }

  function renderPromoBranchCheckboxes(selectedBranchIds) {
    var container = $('mkt-promo-branches-list');
    if (!container) return;

    var branches = _marketingPromotionsState.branches || [];
    if (!branches.length) {
      container.innerHTML = '<span class="text-muted" style="font-size:12px;">Tidak ada cabang ditemukan.</span>';
      return;
    }

    var selSet = {};
    (selectedBranchIds || []).forEach(function (id) { selSet[String(id)] = true; });

    var html = '';
    branches.forEach(function (b) {
      var checked = (selectedBranchIds === null || selectedBranchIds === undefined || selSet[String(b.id)]) ? ' checked' : '';
      html += '<label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;background:#f8fafc;padding:6px 10px;border-radius:6px;border:1px solid #e2e8f0;">' +
        '<input type="checkbox" name="mkt-promo-branch" value="' + esc(b.id) + '"' + checked + '> ' +
        '<span>' + esc(b.name) + '</span>' +
      '</label>';
    });
    container.innerHTML = html;
  }

  function togglePromoSelectAllBranches(checked) {
    var boxes = document.querySelectorAll('input[name="mkt-promo-branch"]');
    boxes.forEach(function (box) { box.checked = Boolean(checked); });
  }
  window.togglePromoSelectAllBranches = togglePromoSelectAllBranches;

  function onPromotionCapabilityChange() {
    var cap = $('mkt-promo-capability').value;
    var nameEl = $('mkt-promo-name');
    var codeEl = $('mkt-promo-code');
    if (cap === 'install_incentive' && (!nameEl.value || nameEl.value.indexOf('Hadiah') !== -1)) {
      if (!nameEl.value) nameEl.value = 'Hadiah Instalasi Aplikasi PWA';
      if (!codeEl.value) codeEl.value = 'PWABANGJO';
    }
  }
  window.onPromotionCapabilityChange = onPromotionCapabilityChange;

  function formatDateTimeLocal(isoStr) {
    if (!isoStr) return '';
    try {
      var d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    } catch (e) {
      return '';
    }
  }

  async function openCreatePromotionModal() {
    var user = getStoredUser();
    if (!user || user.role !== 'owner') {
      showToast('Akses ditolak: Hanya Owner yang berwenang membuat program promosi.');
      return;
    }

    var modal = $('modal-mkt-promotion');
    if (!modal) return;

    $('modal-mkt-promo-title').textContent = 'Buat Program Promosi Baru';
    $('mkt-promo-id').value = '';
    $('mkt-promo-name').value = '';
    $('mkt-promo-code').value = '';
    $('mkt-promo-capability').value = 'install_incentive';
    $('mkt-promo-stacking').value = 'exclusive';
    $('mkt-promo-limit-per-user').value = '1';
    $('mkt-promo-limit-total').value = '';
    $('mkt-promo-status').value = '1';
    if ($('mkt-promo-start-at')) $('mkt-promo-start-at').value = '';
    if ($('mkt-promo-end-at')) $('mkt-promo-end-at').value = '';
    $('mkt-promo-reward-type').value = 'freebie_product';
    if ($('mkt-promo-branches-all')) $('mkt-promo-branches-all').checked = true;

    modal.style.display = 'flex';

    await ensureMarketingDependenciesLoaded();
    renderPromoProductOptions(null);
    renderPromoBranchCheckboxes(null); // default all selected
    onPromotionCapabilityChange();
  }
  window.openCreatePromotionModal = openCreatePromotionModal;

  async function openEditPromotionModal(promoId) {
    var user = getStoredUser();
    if (!user || user.role !== 'owner') {
      showToast('Akses ditolak: Hanya Owner yang berwenang mengubah program promosi.');
      return;
    }

    var modal = $('modal-mkt-promotion');
    if (!modal) return;

    var promo = (_marketingPromotionsState.promotions || []).find(function (p) { return p.id === promoId; });
    if (!promo) {
      showToast('Data promosi tidak ditemukan.');
      return;
    }

    $('modal-mkt-promo-title').textContent = 'Edit Program Promosi';
    $('mkt-promo-id').value = promo.id;
    $('mkt-promo-name').value = promo.name || '';
    $('mkt-promo-code').value = promo.code || '';
    $('mkt-promo-capability').value = promo.capability_type || 'install_incentive';
    $('mkt-promo-stacking').value = promo.stacking_policy || 'exclusive';
    $('mkt-promo-limit-per-user').value = promo.max_redemptions_per_customer || 1;
    $('mkt-promo-limit-total').value = promo.max_redemptions_total || '';
    $('mkt-promo-status').value = promo.is_active === 1 ? '1' : '0';
    if ($('mkt-promo-start-at')) $('mkt-promo-start-at').value = formatDateTimeLocal(promo.start_at);
    if ($('mkt-promo-end-at')) $('mkt-promo-end-at').value = formatDateTimeLocal(promo.end_at);

    var targetProdId = null;
    if (Array.isArray(promo.rewards) && promo.rewards.length > 0) {
      targetProdId = promo.rewards[0].target_product_id;
      $('mkt-promo-reward-type').value = promo.rewards[0].reward_type || 'freebie_product';
    }

    var selectedBranchIds = [];
    if (Array.isArray(promo.scopes) && promo.scopes.length > 0) {
      selectedBranchIds = promo.scopes.map(function (s) { return s.branch_id; });
    }

    modal.style.display = 'flex';

    await ensureMarketingDependenciesLoaded();
    renderPromoProductOptions(targetProdId);
    renderPromoBranchCheckboxes(selectedBranchIds.length ? selectedBranchIds : null);
  }
  window.openEditPromotionModal = openEditPromotionModal;

  function closePromotionModal() {
    var modal = $('modal-mkt-promotion');
    if (modal) modal.style.display = 'none';
  }
  window.closePromotionModal = closePromotionModal;

  async function submitPromotionForm(e) {
    if (e && e.preventDefault) e.preventDefault();

    var submitBtn = $('btn-mkt-submit-promo');
    var promoId = $('mkt-promo-id').value;
    var name = $('mkt-promo-name').value.trim();
    var code = $('mkt-promo-code').value.trim();
    var capability = $('mkt-promo-capability').value;
    var stacking = $('mkt-promo-stacking').value;
    var limitPerUser = parseInt($('mkt-promo-limit-per-user').value, 10) || 1;
    var limitTotal = parseInt($('mkt-promo-limit-total').value, 10) || null;
    var isActive = $('mkt-promo-status').value === '1' ? 1 : 0;
    var startAtVal = $('mkt-promo-start-at') ? $('mkt-promo-start-at').value : '';
    var endAtVal = $('mkt-promo-end-at') ? $('mkt-promo-end-at').value : '';
    var rewardType = $('mkt-promo-reward-type').value;
    var targetProductId = $('mkt-promo-target-product').value;

    if (!name) {
      showToast('Nama promosi wajib diisi.');
      return;
    }
    if (!targetProductId) {
      showToast('Pilih produk hadiah dari katalog master.');
      return;
    }
    if (startAtVal && endAtVal) {
      var sTime = new Date(startAtVal).getTime();
      var eTime = new Date(endAtVal).getTime();
      if (eTime < sTime) {
        showToast('Tanggal berakhir promosi tidak boleh lebih awal dari tanggal mulai.');
        return;
      }
    }

    var branchBoxes = document.querySelectorAll('input[name="mkt-promo-branch"]:checked');
    var branchIds = Array.from(branchBoxes).map(function (b) { return b.value; });

    var rules = [];
    if (capability === 'install_incentive') {
      rules.push({
        rule_type: 'eligibility',
        rule_payload: {
          requires_pwa_installed: true,
          target_audience: 'anonymous_or_registered',
          first_order_only: true
        }
      });
    } else if (capability === 'first_order') {
      rules.push({
        rule_type: 'eligibility',
        rule_payload: {
          first_order_only: true
        }
      });
    }

    var rewards = [{
      reward_type: rewardType,
      target_product_id: targetProductId,
      amount_in_cents: 0
    }];

    var payload = {
      name: name,
      code: code || null,
      capability_type: capability,
      stacking_policy: stacking,
      priority_weight: capability === 'install_incentive' ? 100 : 50,
      max_redemptions_total: limitTotal,
      max_redemptions_per_customer: limitPerUser,
      start_at: startAtVal ? new Date(startAtVal).toISOString() : null,
      end_at: endAtVal ? new Date(endAtVal).toISOString() : null,
      is_active: isActive,
      rules: rules,
      rewards: rewards,
      branch_ids: branchIds
    };

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Menyimpan...';
    }

    try {
      var url = promoId ? ('/api/v1/admin/marketing/promotions/' + encodeURIComponent(promoId)) : '/api/v1/admin/marketing/promotions';
      var method = promoId ? 'PUT' : 'POST';

      var res = await adminFetch(url, {
        method: method,
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error((json && json.error) || 'Gagal menyimpan promosi.');
      }

      showToast(promoId ? 'Promosi berhasil diperbarui.' : 'Program promosi baru berhasil dibuat.');
      closePromotionModal();
      loadMarketingPromotions();
    } catch (err) {
      console.error('[Submit Promotion Error]:', err);
      showToast(err.message || 'Gagal menyimpan promosi.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Simpan Program Promosi';
      }
    }
  }
  window.submitPromotionForm = submitPromotionForm;

  async function toggleMarketingPromotionActive(promoId, newStatus) {
    try {
      var res = await adminFetch('/api/v1/admin/marketing/promotions/' + encodeURIComponent(promoId), {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: newStatus })
      });
      var json = await res.json();
      if (!res.ok || !json.success) throw new Error((json && json.error) || 'Gagal memperbarui status promosi.');

      showToast(newStatus === 1 ? 'Promosi diaktifkan.' : 'Promosi dinonaktifkan.');
      loadMarketingPromotions();
    } catch (err) {
      console.error('[Toggle Marketing Promotion Error]:', err);
      showToast(err.message || 'Gagal mengubah status promosi.');
    }
  }
  window.toggleMarketingPromotionActive = toggleMarketingPromotionActive;

  async function deleteMarketingPromotion(promoId) {
    var user = getStoredUser();
    if (!user || user.role !== 'owner') {
      showToast('Akses ditolak: Hanya Owner yang berwenang menghapus program promosi.');
      return;
    }

    if (!confirm('Apakah Anda yakin ingin menghapus program promosi ini? Tindakan ini tidak dapat dibatalkan.')) return;

    try {
      var res = await adminFetch('/api/v1/admin/marketing/promotions/' + encodeURIComponent(promoId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var json = await res.json();
      if (!res.ok || !json.success) throw new Error((json && json.error) || 'Gagal menghapus promosi.');

      showToast('Promosi berhasil dihapus.');
      loadMarketingPromotions();
    } catch (err) {
      console.error('[Delete Marketing Promotion Error]:', err);
      showToast(err.message || 'Gagal menghapus promosi.');
    }
  }
  window.deleteMarketingPromotion = deleteMarketingPromotion;

  window.__xentraInitDashboard = function () {
    checkAuth();
    validateServerSession();
    applyRoleBasedUI();
    loadBrandSettings();
    if (isBranchManager()) {
      loadInlineBranchCatalog();
    } else {
      loadCatalog();
    }
    loadOverview();
  };

  /* =========================================================================
     INITIALIZATION ON DOM READY
     ========================================================================= */
  var _isInitialized = false;
  async function initializeDashboard() {
    if (_isInitialized) return;
    _isInitialized = true;

    // Wire navigation click handlers for nav items (supports data-route and data-tab)
    document.querySelectorAll('.x-nav-item:not(.x-nav-parent)').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var route = btn.dataset.route || btn.dataset.tab;
        if (route) {
          navigateTo(route);
        }
      });
    });

    // Wire catalog sub-nav click handlers
    document.querySelectorAll('.x-nav-sub-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var route = btn.dataset.route || btn.dataset.tab;
        if (route) {
          navigateTo(route);
        }
      });
    });

    // Catalog parent: toggle sub-nav on click if already on catalog route
    var catalogParentBtn = $('nav-catalog-parent');
    if (catalogParentBtn) {
      catalogParentBtn.addEventListener('click', function () {
        var currentRoute = getCurrentRoute();
        var isCatalogActive = currentRoute === 'catalog' || currentRoute.indexOf('catalog/') === 0;
        if (!isCatalogActive) {
          // Navigate to catalog (will open sub-nav via applyRoute)
          navigateTo('catalog');
        } else {
          // Toggle sub-nav open/close without changing route
          var sub = $('nav-catalog-sub');
          if (sub) sub.classList.toggle('open');
          var expanded = sub && sub.classList.contains('open');
          catalogParentBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        }
      });
    }

    initAuthListeners();
    initBrandListeners();
    initSettingsProfileListeners();
    initCatalogListeners();
    initBranchSearchAndFilter();
    initBranchOperationsForm();
    initOrdersFilterListeners();
    initMobileSidebar();
    initBranchContextSelector();

    // Workforce form submit
    var formUser = $('form-user');
    if (formUser) {
      formUser.addEventListener('submit', submitUserForm);
    }

    if ($('btn-refresh-orders')) {
      $('btn-refresh-orders').addEventListener('click', loadOrders);
    }

    // Inline branch category button
    var btnAddBranchCatInline = $('btn-add-branch-category-inline');
    if (btnAddBranchCatInline) {
      btnAddBranchCatInline.addEventListener('click', async function () {
        if (!currentManagingBranchId) return;
        var name = prompt('Nama Kategori Baru untuk Cabang ini:');
        if (!name || !name.trim()) return;
        try {
          var res = await adminFetch(API_BASE + '/admin/branches/' + currentManagingBranchId + '/categories', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ name: name.trim() })
          });
          var data = await res.json();
          if (data.success) {
            showToast('\u2705 Kategori cabang berhasil dibuat!');
            loadInlineBranchCatalog();
          } else {
            showToast('\u274C ' + (data.error || 'Gagal membuat kategori.'));
          }
        } catch (err) {
          showToast('\u274C Kesalahan jaringan.');
        }
      });
    }

    /* =========================================================================
       PHASE 7: SETTINGS & INTEGRATIONS CONTROLLER
       ========================================================================= */
    var _activeSettingsSection = 'business/profile';

    function switchSettingsSection(sectionName, updateHash) {
      var validSections = [
        'business', 'business/profile', 'business/info', 'business/legal',
        'locations',
        'commerce', 'commerce/orders', 'commerce/payments', 'commerce/fulfillment',
        'channels', 'channels/website', 'channels/customer-app', 'channels/pos', 'channels/kiosk',
        'integrations',
        'notifications',
        'security'
      ];

      var sec = sectionName;
      if (sec === 'business') sec = 'business/profile';
      if (sec === 'commerce') sec = 'commerce/orders';
      if (sec === 'channels') sec = 'channels/website';

      if (validSections.indexOf(sec) === -1) {
        sec = 'business/profile';
      }

      _activeSettingsSection = sec;

      // Update sidebar nav button active state
      document.querySelectorAll('.settings-nav-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.settingsSection === sec);
        if (btn.dataset.settingsSection === sec) {
          btn.style.background = '#f1f5f9';
          btn.style.color = 'var(--primary, #059669)';
        } else {
          btn.style.background = 'transparent';
          btn.style.color = '#334155';
        }
      });

      // Show the selected panel
      var panelId = 'settings-panel-' + sec.replace(/\//g, '-');
      document.querySelectorAll('.settings-panel').forEach(function (panel) {
        panel.style.display = panel.id === panelId ? 'block' : 'none';
      });

      if (updateHash !== false) {
        navigateTo('settings/' + sec);
      }

      loadSettingsCurrentSubtab();
    }
    window.switchSettingsSection = switchSettingsSection;

    function loadSettingsCurrentSubtab() {
      var sec = _activeSettingsSection;
      if (sec === 'business/profile') loadSettingsProfile();
      else if (sec === 'business/info') loadSettingsBusinessInfo();
      else if (sec === 'locations') loadSettingsLocations();
      else if (sec === 'commerce/orders') loadSettingsCommerceOrders();
      else if (sec === 'commerce/payments') loadSettingsPayments();
      else if (sec === 'commerce/fulfillment') loadSettingsFulfillment();
      else if (sec === 'channels/website') loadSettingsWebsite();
      else if (sec === 'channels/customer-app') loadSettingsCustomerApp();
      else if (sec === 'channels/pos') loadSettingsPos();
      else if (sec === 'integrations') loadSettingsIntegrations();
      else if (sec === 'security') loadSettingsSecurity();
    }
    window.loadSettingsCurrentSubtab = loadSettingsCurrentSubtab;

    // 1. Business Profile
    async function loadSettingsProfile() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/business/profile', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.profile) return;

        var p = json.profile;
        if ($('set-profile-name')) $('set-profile-name').value = p.name || '';
        if ($('set-profile-tagline')) $('set-profile-tagline').value = p.tagline || '';
        var logoUrl = p.logo_url || '/assets/pwa/icon-192.png';
        if ($('set-profile-logo')) $('set-profile-logo').value = logoUrl;
        if ($('set-profile-logo-preview')) {
          $('set-profile-logo-preview').src = logoUrl;
          $('set-profile-logo-preview').style.display = 'block';
        }
        if ($('set-profile-logo-empty')) $('set-profile-logo-empty').style.display = 'none';
        var hasCustomLogo = Boolean(logoUrl && logoUrl !== '/assets/pwa/icon-192.png');
        if ($('btn-set-profile-logo-remove')) $('btn-set-profile-logo-remove').style.display = hasCustomLogo ? 'inline-block' : 'none';
        if ($('btn-set-profile-logo-pick')) $('btn-set-profile-logo-pick').textContent = hasCustomLogo ? '📁 Ganti Logo' : '📁 Unggah Logo';

        if ($('set-profile-color')) $('set-profile-color').value = p.primary_color || '#b6ff00';
        if ($('set-profile-color-hex')) $('set-profile-color-hex').value = p.primary_color || '#b6ff00';
        if ($('set-profile-domain')) $('set-profile-domain').textContent = p.custom_domain || window.location.host || '-';
      } catch (err) {
        console.warn('[Load Settings Profile Warn]:', err);
      }
    }
    window.loadSettingsProfile = loadSettingsProfile;

    // Hook settings profile listeners (logo upload & color pickers)
    function initSettingsProfileListeners() {
      var btnPick = $('btn-set-profile-logo-pick');
      var fileInput = $('input-set-profile-logo-file');
      var btnRemove = $('btn-set-profile-logo-remove');

      if (btnPick && fileInput) {
        btnPick.addEventListener('click', function () { fileInput.click(); });
        fileInput.addEventListener('change', async function () {
          var file = fileInput.files && fileInput.files[0];
          if (!file) return;

          var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
          if (allowed.indexOf(file.type) === -1) {
            showToast('❌ Format file tidak didukung. Gunakan JPG, PNG, atau WebP.');
            fileInput.value = '';
            return;
          }

          if (file.size > 10 * 1024 * 1024) {
            showToast('❌ Ukuran file melebihi batas 10 MB.');
            fileInput.value = '';
            return;
          }

          XentraCropEditor.open({
            source: file,
            assetType: 'logo',
            aspectRatio: 1.0,
            title: 'Potong & Posisikan Logo Brand (1:1)',
            onConfirm: async function (cropSpec, previewDataUrl) {
              try {
                await doUploadBrandLogo(file, cropSpec, previewDataUrl, btnPick);
              } finally {
                fileInput.value = '';
              }
            },
            onCancel: async function () {
              try {
                var reader = new FileReader();
                reader.onload = function (ev) {
                  doUploadBrandLogo(file, null, ev.target.result, btnPick);
                };
                reader.readAsDataURL(file);
              } catch (_) {}
              fileInput.value = '';
            }
          });
        });
      }

      if (btnRemove) {
        btnRemove.addEventListener('click', async function () {
          if (!confirm('Hapus logo brand kustom dan kembali ke default?')) return;
          try {
            var res = await adminFetch(API_BASE + '/admin/brand/logo', {
              method: 'DELETE',
              headers: getAuthHeaders()
            });
            var data = await res.json();
            if (res.ok && data.success) {
              showToast('✅ Logo brand kustom dihapus.');
              var defaultLogo = '/assets/pwa/icon-192.png';
              if ($('set-profile-logo')) $('set-profile-logo').value = defaultLogo;
              if ($('set-profile-logo-preview')) $('set-profile-logo-preview').src = defaultLogo;
              btnRemove.style.display = 'none';
              if (btnPick) btnPick.textContent = '📁 Unggah Logo';

              if ($('brand-logo')) $('brand-logo').value = defaultLogo;
              if ($('brand-logo-preview')) $('brand-logo-preview').src = defaultLogo;
              if ($('btn-brand-logo-remove')) $('btn-brand-logo-remove').style.display = 'none';
              if ($('btn-brand-logo-pick')) $('btn-brand-logo-pick').textContent = '📁 Unggah Logo';
              if ($('dash-sidebar-logo')) $('dash-sidebar-logo').src = defaultLogo;

              loadBrandSettings();
              loadSettingsProfile();
            } else {
              showToast('❌ Gagal menghapus logo.');
            }
          } catch (err) {
            showToast('❌ Kesalahan jaringan.');
          }
        });
      }

      // Synchronize color picker and hex input in Settings Profile
      var setColor = $('set-profile-color');
      var setColorHex = $('set-profile-color-hex');
      if (setColor && setColorHex) {
        setColor.addEventListener('input', function () {
          setColorHex.value = setColor.value;
        });
        setColorHex.addEventListener('input', function () {
          if (/^#[0-9A-Fa-f]{6}$/.test(setColorHex.value)) {
            setColor.value = setColorHex.value;
          }
        });
      }
    }


    async function saveSettingsProfile(e) {
      if (e) e.preventDefault();
      var btn = $('btn-save-settings-profile');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Menyimpan...';
      }
      try {
        var rawHex = ($('set-profile-color-hex') && $('set-profile-color-hex').value.trim()) || ($('set-profile-color') && $('set-profile-color').value) || '#b6ff00';
        if (!rawHex.startsWith('#')) rawHex = '#' + rawHex;
        if (/^#[0-9a-fA-F]{3}$/.test(rawHex)) {
          rawHex = '#' + rawHex[1] + rawHex[1] + rawHex[2] + rawHex[2] + rawHex[3] + rawHex[3];
        }
        if (!/^#[0-9a-fA-F]{6}$/.test(rawHex)) {
          showToast('❌ Format warna HEX tidak valid. Gunakan format #RRGGBB (contoh: #FF5500).');
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Simpan Profil';
          }
          return;
        }
        rawHex = rawHex.toUpperCase();

        var payload = {
          name: $('set-profile-name').value.trim(),
          tagline: $('set-profile-tagline').value.trim(),
          logo_url: $('set-profile-logo').value.trim(),
          primary_color: rawHex
        };

        var res = await adminFetch(API_BASE + '/admin/settings/business/profile', {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var json = await res.json();
        if (json.success) {
          showToast('✅ Profil brand berhasil disimpan.');
          if (json.profile) {
            applyBrandToUI(json.profile);
          }
          loadBrandSettings();
          loadSettingsProfile();
        } else {
          showToast('❌ Gagal: ' + (json.error || 'Terjadi kesalahan.'));
        }
      } catch (err) {
        showToast('❌ Kesalahan jaringan saat menyimpan profil.');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Simpan Profil';
        }
      }
    }
    window.saveSettingsProfile = saveSettingsProfile;

    // 2. Business Info
    async function loadSettingsBusinessInfo() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/business/info', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.info) return;

        var info = json.info;
        if ($('set-info-org-name')) $('set-info-org-name').textContent = info.organization_name || '—';
        if ($('set-info-phone')) $('set-info-phone').textContent = info.contact_phone || info.contact_whatsapp || '—';
        if ($('set-info-address')) $('set-info-address').textContent = info.primary_address || '—';
      } catch (err) {
        console.warn('[Load Business Info Warn]:', err);
      }
    }
    window.loadSettingsBusinessInfo = loadSettingsBusinessInfo;

    // 3. Locations Defaults
    async function loadSettingsLocations() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/locations/defaults', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.defaults) return;

        var defs = json.defaults;
        if ($('set-locations-count')) $('set-locations-count').textContent = defs.branches_count || 0;

        var tbody = $('tbody-set-locations-branches');
        if (tbody) {
          var branches = defs.branches || [];
          if (branches.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Belum ada cabang terdaftar.</td></tr>';
          } else {
            tbody.innerHTML = branches.map(function (b) {
              return '<tr>' +
                '<td><strong>' + esc(b.name) + '</strong></td>' +
                '<td>' + (b.is_active ? '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:700;">Aktif</span>' : '<span class="x-badge" style="background:#f1f5f9;color:#64748b;">Non-aktif</span>') + '</td>' +
                '<td>' + b.max_radius_km + ' km</td>' +
                '<td>' + formatMoney(b.price_per_km) + ' / km</td>' +
                '<td><a href="#branches/' + encodeURIComponent(b.id) + '" style="font-size:12px;font-weight:600;color:var(--primary);text-decoration:none;">Lihat Override Cabang ↗</a></td>' +
              '</tr>';
            }).join('');
          }
        }
      } catch (err) {
        console.warn('[Load Settings Locations Warn]:', err);
      }
    }
    window.loadSettingsLocations = loadSettingsLocations;

    // 4. Commerce Orders
    async function loadSettingsCommerceOrders() {
      try {
        await adminFetch(API_BASE + '/admin/settings/commerce/orders', { headers: getAuthHeaders() });
      } catch (_) {}
    }
    window.loadSettingsCommerceOrders = loadSettingsCommerceOrders;

    // 5. Commerce Payments
    async function loadSettingsPayments() {
      try {
        var branchId = getEffectiveBranchId();
        var query = branchId && branchId !== 'all' ? '?branch_id=' + encodeURIComponent(branchId) : '';
        var res = await adminFetch(API_BASE + '/admin/settings/commerce/payments' + query, { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.payment_settings) return;

        var ps = json.payment_settings;
        var scopeBadge = $('set-payment-scope-badge');
        if (scopeBadge) {
          scopeBadge.textContent = ps.has_branch_override ? 'Branch Override Aktif' : 'Brand Default';
          scopeBadge.style.background = ps.has_branch_override ? '#fef3c7' : '#f1f5f9';
          scopeBadge.style.color = ps.has_branch_override ? '#92400e' : '#475569';
        }

        var scopeSel = $('set-payment-scope-select');
        if (scopeSel) {
          scopeSel.innerHTML = '<option value="brand">Seluruh Brand (Default)</option>';
          (state.branches || []).forEach(function (b) {
            var opt = document.createElement('option');
            opt.value = b.id;
            opt.textContent = 'Cabang: ' + b.name;
            scopeSel.appendChild(opt);
          });
          scopeSel.value = (branchId && branchId !== 'all') ? branchId : 'brand';
        }

        if ($('set-payment-merchant-id')) $('set-payment-merchant-id').value = ps.merchant_id || '';
        if ($('set-payment-is-production')) $('set-payment-is-production').checked = Boolean(ps.is_production);
      } catch (err) {
        console.warn('[Load Settings Payments Warn]:', err);
      }
    }
    window.loadSettingsPayments = loadSettingsPayments;

    function onPaymentScopeChange() {
      var scopeSel = $('set-payment-scope-select');
      var val = scopeSel ? scopeSel.value : 'brand';
      var query = val !== 'brand' ? '?branch_id=' + encodeURIComponent(val) : '';
      adminFetch(API_BASE + '/admin/settings/commerce/payments' + query, { headers: getAuthHeaders() })
        .then(function (res) { return res.json(); })
        .then(function (json) {
          if (json.success && json.payment_settings) {
            var ps = json.payment_settings;
            var scopeBadge = $('set-payment-scope-badge');
            if (scopeBadge) {
              scopeBadge.textContent = ps.has_branch_override ? 'Branch Override Aktif' : 'Brand Default';
              scopeBadge.style.background = ps.has_branch_override ? '#fef3c7' : '#f1f5f9';
              scopeBadge.style.color = ps.has_branch_override ? '#92400e' : '#475569';
            }
            if ($('set-payment-merchant-id')) $('set-payment-merchant-id').value = ps.merchant_id || '';
            if ($('set-payment-is-production')) $('set-payment-is-production').checked = Boolean(ps.is_production);
          }
        });
    }
    window.onPaymentScopeChange = onPaymentScopeChange;

    async function saveSettingsPayments(e) {
      if (e) e.preventDefault();
      try {
        var scopeSel = $('set-payment-scope-select');
        var scopeVal = scopeSel ? scopeSel.value : 'brand';

        var payload = {
          branch_id: scopeVal !== 'brand' ? scopeVal : null,
          server_key: $('set-payment-server-key').value.trim(),
          client_key: $('set-payment-client-key').value.trim(),
          merchant_id: $('set-payment-merchant-id').value.trim(),
          is_production: $('set-payment-is-production').checked
        };

        var res = await adminFetch(API_BASE + '/admin/settings/commerce/payments', {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var json = await res.json();
        if (json.success) {
          showToast(json.message || 'Kredensial pembayaran berhasil disimpan.');
          loadSettingsPayments();
        } else {
          showToast('Gagal: ' + (json.error || 'Terjadi kesalahan.'));
        }
      } catch (err) {
        showToast('Kesalahan jaringan saat menyimpan kredensial pembayaran.');
      }
    }
    window.saveSettingsPayments = saveSettingsPayments;

    // 6. Commerce Fulfillment
    async function loadSettingsFulfillment() {
      try {
        var branchId = getEffectiveBranchId();
        var query = branchId && branchId !== 'all' ? '?branch_id=' + encodeURIComponent(branchId) : '';
        var res = await adminFetch(API_BASE + '/admin/settings/commerce/fulfillment' + query, { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.fulfillment) return;

        var f = json.fulfillment;
        var sel = $('set-ful-branch-select');
        if (sel) {
          sel.innerHTML = '';
          (state.branches || []).forEach(function (b) {
            var opt = document.createElement('option');
            opt.value = b.id;
            opt.textContent = b.name;
            sel.appendChild(opt);
          });
          if (f.branch_id) sel.value = f.branch_id;
        }

        var badge = $('set-ful-branch-badge');
        if (badge) badge.textContent = f.branch_name || 'Cabang Terpilih';

        if ($('set-ful-delivery-active')) $('set-ful-delivery-active').checked = Boolean(f.is_delivery_active);
        if ($('set-ful-pickup-active')) $('set-ful-pickup-active').checked = Boolean(f.is_pickup_active);
        if ($('set-ful-max-radius')) $('set-ful-max-radius').value = f.max_radius_km || 10;
        if ($('set-ful-free-km')) $('set-ful-free-km').value = f.free_delivery_km || 3;
        if ($('set-ful-price-km')) $('set-ful-price-km').value = f.price_per_km || 2500;
      } catch (err) {
        console.warn('[Load Fulfillment Warn]:', err);
      }
    }
    window.loadSettingsFulfillment = loadSettingsFulfillment;

    function onFulfillmentBranchChange() {
      var sel = $('set-ful-branch-select');
      var val = sel ? sel.value : null;
      if (!val) return;
      adminFetch(API_BASE + '/admin/settings/commerce/fulfillment?branch_id=' + encodeURIComponent(val), { headers: getAuthHeaders() })
        .then(function (res) { return res.json(); })
        .then(function (json) {
          if (json.success && json.fulfillment) {
            var f = json.fulfillment;
            var badge = $('set-ful-branch-badge');
            if (badge) badge.textContent = f.branch_name || 'Cabang Terpilih';
            if ($('set-ful-delivery-active')) $('set-ful-delivery-active').checked = Boolean(f.is_delivery_active);
            if ($('set-ful-pickup-active')) $('set-ful-pickup-active').checked = Boolean(f.is_pickup_active);
            if ($('set-ful-max-radius')) $('set-ful-max-radius').value = f.max_radius_km || 10;
            if ($('set-ful-free-km')) $('set-ful-free-km').value = f.free_delivery_km || 3;
            if ($('set-ful-price-km')) $('set-ful-price-km').value = f.price_per_km || 2500;
          }
        });
    }
    window.onFulfillmentBranchChange = onFulfillmentBranchChange;

    async function saveSettingsFulfillment(e) {
      if (e) e.preventDefault();
      try {
        var sel = $('set-ful-branch-select');
        var branchId = sel ? sel.value : null;
        if (!branchId) {
          showToast('Pilih cabang terlebih dahulu.');
          return;
        }

        var payload = {
          branch_id: branchId,
          is_delivery_active: $('set-ful-delivery-active').checked,
          is_pickup_active: $('set-ful-pickup-active').checked,
          max_radius_km: parseFloat($('set-ful-max-radius').value) || 10.0,
          free_delivery_km: parseFloat($('set-ful-free-km').value) || 3.0,
          price_per_km: parseFloat($('set-ful-price-km').value) || 2500.0
        };

        var res = await adminFetch(API_BASE + '/admin/settings/commerce/fulfillment', {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var json = await res.json();
        if (json.success) {
          showToast('Pengaturan pemenuhan cabang berhasil disimpan.');
        } else {
          showToast('Gagal: ' + (json.error || 'Terjadi kesalahan.'));
        }
      } catch (err) {
        showToast('Kesalahan jaringan saat menyimpan pemenuhan.');
      }
    }
    window.saveSettingsFulfillment = saveSettingsFulfillment;

    // 7. Channels: Website, PWA, POS
    async function loadSettingsWebsite() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/channels/website', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.channel) return;
        if ($('set-ch-website-url')) $('set-ch-website-url').textContent = json.channel.url;
        if ($('set-ch-website-link')) $('set-ch-website-link').href = json.channel.url;
      } catch (_) {}
    }
    window.loadSettingsWebsite = loadSettingsWebsite;

    async function loadSettingsCustomerApp() {
      try {
        await adminFetch(API_BASE + '/admin/settings/channels/customer-app', { headers: getAuthHeaders() });
      } catch (_) {}
    }
    window.loadSettingsCustomerApp = loadSettingsCustomerApp;

    async function loadSettingsPos() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/channels/pos', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.channel) return;

        var ch = json.channel;
        if ($('set-pos-shifts-badge')) $('set-pos-shifts-badge').textContent = (ch.active_shifts_count || 0) + ' Shift Aktif';

        var listEl = $('set-pos-shifts-list');
        if (listEl) {
          var shifts = ch.open_shifts || [];
          if (shifts.length === 0) {
            listEl.innerHTML = '<div class="text-muted" style="padding:8px 0;">Tidak ada shift kasir yang sedang aktif saat ini. Shift dimulai saat kasir membuka float kasir di terminal POS.</div>';
          } else {
            listEl.innerHTML = shifts.map(function (s) {
              return '<div style="padding:10px 14px;background:#f8fafc;border-radius:var(--radius-sm);border:1px solid #e2e8f0;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">' +
                '<div><strong>' + esc(s.branch_name) + '</strong> &nbsp;|&nbsp; Kasir: <code>' + esc(s.cashier_id) + '</code></div>' +
                '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:700;">Shift Terbuka</span>' +
              '</div>';
            }).join('');
          }
        }
      } catch (err) {
        console.warn('[Load POS Channel Warn]:', err);
      }
    }
    window.loadSettingsPos = loadSettingsPos;

    // 8. Integrations
    async function loadSettingsIntegrations() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/integrations', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.integrations) return;

        var cont = $('set-integrations-list');
        if (!cont) return;

        cont.innerHTML = json.integrations.map(function (i) {
          var badge = '';
          if (i.status === 'connected') {
            badge = '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:700;">Terhubung</span>';
          } else if (i.status === 'on_hold') {
            badge = '<span class="x-badge" style="background:#f1f5f9;color:#64748b;font-weight:700;">HOLD</span>';
          } else {
            badge = '<span class="x-badge" style="background:#fef3c7;color:#92400e;font-weight:700;">Belum Terhubung</span>';
          }

          var actionBtn = i.is_configurable
            ? '<button type="button" class="x-btn-secondary" style="font-size:12px;padding:6px 12px;" onclick="switchSettingsSection(\'commerce/payments\', true)">Konfigurasi ⚙️</button>'
            : '<span style="font-size:12px;color:#94a3b8;">Sistem Bawaan</span>';

          return '<div style="padding:16px;background:#ffffff;border:1px solid var(--border-color);border-radius:var(--radius-md);display:flex;justify-content:space-between;align-items:center;">' +
            '<div style="max-width:70%;">' +
              '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">' +
                '<strong style="font-size:14px;color:#1e293b;">' + esc(i.name) + '</strong>' +
                badge +
              '</div>' +
              '<div style="font-size:12px;color:#64748b;">' + esc(i.description) + '</div>' +
            '</div>' +
            '<div>' + actionBtn + '</div>' +
          '</div>';
        }).join('');
      } catch (err) {
        console.warn('[Load Integrations Warn]:', err);
      }
    }
    window.loadSettingsIntegrations = loadSettingsIntegrations;

    // 9. Security
    async function loadSettingsSecurity() {
      try {
        var res = await adminFetch(API_BASE + '/admin/settings/security', { headers: getAuthHeaders() });
        if (!res.ok) return;
        var json = await res.json();
        if (!json.success || !json.security) return;

        var sec = json.security;
        var u = sec.current_user || {};
        if ($('set-sec-user')) $('set-sec-user').textContent = u.username || 'User Session';
        if ($('set-sec-role')) $('set-sec-role').textContent = 'Role: ' + (u.role || '—') + (u.branch_id ? ' (Cabang: ' + u.branch_id + ')' : ' (Global)');

        var tbody = $('tbody-set-audit-logs');
        if (tbody) {
          var logs = sec.recent_audit_logs || [];
          if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Belum ada aktivitas keamanan tercatat.</td></tr>';
          } else {
            tbody.innerHTML = logs.map(function (l) {
              var timeStr = l.created_at ? esc(l.created_at.substring(0, 19).replace('T', ' ')) : '—';
              var resBadge = l.result === 'SUCCESS' || l.result === 'success'
                ? '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:700;">SUKSES</span>'
                : '<span class="x-badge" style="background:#fef2f2;color:#b91c1c;font-weight:700;">' + esc(l.result || 'INFO') + '</span>';
              return '<tr>' +
                '<td style="font-size:12px;color:#64748b;">' + timeStr + '</td>' +
                '<td><code>' + esc(l.actor_id || 'system') + '</code> (' + esc(l.actor_role || '-') + ')</td>' +
                '<td><strong>' + esc(l.action) + '</strong></td>' +
                '<td>' + esc(l.target_user_id || '—') + '</td>' +
                '<td>' + resBadge + '</td>' +
              '</tr>';
            }).join('');
          }
        }
      } catch (err) {
        console.warn('[Load Security Warn]:', err);
      }
    }
    window.loadSettingsSecurity = loadSettingsSecurity;

  /* =========================================================================
     BRANCH MANAGER OPERATIONAL CENTER — HARI INI (BM-1)
     ========================================================================= */
  var _hariIniState = {
    branch: null,
    orders: [],
    layout: null,
    inventory: []
  };

  async function loadHariIni() {
    var user = getStoredUser();
    if (!user || !user.branch_id) {
      console.warn("[BM Hari Ini]: User is not a branch manager or branch_id missing");
      return;
    }
    var branchId = user.branch_id;

    // 1. Fetch assigned branch details
    try {
      var bRes = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId), { headers: getAuthHeaders() });
      if (bRes.ok) {
        var bData = await bRes.json();
        if (bData.success && bData.branch) {
          _hariIniState.branch = bData.branch;
          var b = bData.branch;

          var nameEl = $("bm-hero-branch-name");
          if (nameEl) nameEl.textContent = b.name || ("Cabang " + branchId);

          var topbarBMBranchEl = $("dash-bm-branch-name");
          if (topbarBMBranchEl) topbarBMBranchEl.textContent = b.name || ("Cabang " + branchId);

          var dotEl = $("bm-hero-status-dot");
          var badgeEl = $("bm-hero-status-badge");
          var onlineBadgeEl = $("bm-hero-online-badge");
          var toggleBtn = $("btn-bm-toggle-open");

          var isOpen = b.is_open_override === 1 || b.is_open_override === true;
          var isDeliveryActive = b.is_delivery_active !== 0 && b.is_delivery_active !== false;

          if (dotEl) {
            dotEl.className = "x-status-dot " + (isOpen ? "x-status-dot-open" : "x-status-dot-closed");
          }
          if (badgeEl) {
            badgeEl.className = "x-badge " + (isOpen ? "x-badge-success" : "x-badge-danger");
            badgeEl.textContent = isOpen ? "CABANG: BUKA" : "CABANG: TUTUP";
          }
          if (onlineBadgeEl) {
            onlineBadgeEl.className = "x-badge " + (isDeliveryActive ? "x-badge-info" : "x-badge-warning");
            onlineBadgeEl.textContent = isDeliveryActive ? "ONLINE: AKTIF" : "ONLINE: DIJEDA";
          }
          if (toggleBtn) {
            toggleBtn.innerHTML = isOpen ? "<span>Tutup Sementara</span>" : "<span>Buka Cabang</span>";
            toggleBtn.className = isOpen ? "x-btn-secondary" : "x-btn-primary";
          }

          var onlineBtn = $("btn-bm-toggle-online-orders");
          if (onlineBtn) {
            onlineBtn.innerHTML = isDeliveryActive
              ? "<span>Pause Order Online</span>"
              : "<span>Resume Order Online</span>";
            onlineBtn.className = isDeliveryActive ? "x-btn-secondary" : "x-btn-primary";
            onlineBtn.style.color = isDeliveryActive ? "var(--text-main)" : "#ffffff";
          }
          // Live WIB date context
          var dateEl = $("bm-hero-date");
          if (dateEl) {
            try {
              var now = new Date();
              var days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
              var months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
              dateEl.textContent = days[now.getDay()] + ", " + now.getDate() + " " + months[now.getMonth()] + " " + now.getFullYear() + " • WIB";
            } catch (_) {
              dateEl.textContent = new Date().toISOString().substring(0, 10);
            }
          }
        }
      }
    } catch (e) {
      console.warn("[BM Hari Ini Branch Error]:", e);
    }

    // 2. Fetch assigned branch orders
    try {
      var oRes = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/orders?status=all", { headers: getAuthHeaders() });
      if (oRes.ok) {
        var oData = await oRes.json();
        if (oData.success && Array.isArray(oData.orders)) {
          var orders = oData.orders;
          _hariIniState.orders = orders;

          var pendingList = orders.filter(function (o) { return o.status === "pending"; });
          var activeList = orders.filter(function (o) { return ["confirmed", "preparing"].indexOf(o.status) !== -1; });
          var readyList = orders.filter(function (o) { return o.status === "ready"; });

          var todayStr = new Date().toISOString().substring(0, 10);
          var completedToday = orders.filter(function (o) {
            return o.status === "completed" && (o.created_at || "").substring(0, 10) === todayStr;
          });

          var completedSales = completedToday.reduce(function (acc, o) {
            return acc + (Number(o.grand_total) || 0);
          }, 0);

          if ($("bm-stat-pending-orders")) $("bm-stat-pending-orders").textContent = pendingList.length;
          if ($("bm-stat-active-orders")) $("bm-stat-active-orders").textContent = activeList.length;
          if ($("bm-stat-ready-orders")) $("bm-stat-ready-orders").textContent = readyList.length;
          if ($("bm-stat-completed-orders")) $("bm-stat-completed-orders").textContent = completedToday.length;
          if ($("bm-stat-net-sales-today")) $("bm-stat-net-sales-today").textContent = formatMoney(completedSales) + " total penjualan";

          renderHariIniPendingOrders(pendingList);
        }
      }
    } catch (e) {
      console.warn("[BM Hari Ini Orders Error]:", e);
    }

    // 3. Fetch dine-in tables layout
    try {
      var tRes = await adminFetch(API_BASE + "/dine-in/layout?branch_id=" + encodeURIComponent(branchId), { headers: getAuthHeaders() });
      if (tRes.ok) {
        var tData = await tRes.json();
        if (tData.success && Array.isArray(tData.tables)) {
          var tables = tData.tables;
          var avail = tables.filter(function (t) { return (t.operational_status || t.status) === "available"; }).length;
          var occupied = tables.filter(function (t) { return (t.operational_status || t.status) === "occupied"; }).length;
          var held = tables.filter(function (t) { return (t.operational_status || t.status) === "held"; }).length;
          var blocked = tables.filter(function (t) { return ["blocked", "out_of_service"].indexOf(t.operational_status || t.status) !== -1; }).length;

          if ($("bm-stat-tables-available")) $("bm-stat-tables-available").textContent = avail;
          if ($("bm-stat-tables-occupied")) $("bm-stat-tables-occupied").textContent = occupied;
          if ($("bm-stat-tables-held")) $("bm-stat-tables-held").textContent = held;
          if ($("bm-stat-tables-blocked")) $("bm-stat-tables-blocked").textContent = blocked;
        }
      }
    } catch (e) {
      console.warn("[BM Hari Ini Layout Error]:", e);
    }

    // 4. Fetch low stock inventory alerts & unavailable products
    try {
      var iRes = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/inventory", { headers: getAuthHeaders() });
      var pRes = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/products", { headers: getAuthHeaders() });
      
      var lowItems = [];
      var unavailItems = [];

      if (iRes.ok) {
        var iData = await iRes.json();
        if (iData.success && Array.isArray(iData.inventory)) {
          lowItems = iData.inventory.filter(function (item) {
            return item.stock <= (item.low_stock_threshold || 5);
          });
        }
      }

      if (pRes.ok) {
        var pData = await pRes.json();
        if (pData.success && Array.isArray(pData.assignments)) {
          unavailItems = pData.assignments.filter(function (p) {
            return p.is_available === 0 || p.is_available === false;
          });
        }
      }

      renderHariIniAttention(lowItems, unavailItems);
    } catch (e) {
      console.warn("[BM Hari Ini Inventory/Menu Error]:", e);
    }

    // 5. Fetch active approved branch marketing promotions
    try {
      var promoRes = await adminFetch(API_BASE + "/admin/marketing/promotions", { headers: getAuthHeaders() });
      if (promoRes.ok) {
        var promoData = await promoRes.json();
        if (promoData.success && Array.isArray(promoData.promotions)) {
          var activePromos = promoData.promotions.filter(function (p) {
            var active = (p.is_active === 1 || p.is_active === true || p.status === "active");
            if (!active) return false;
            // Branch scope check: null branch_id applies to all branches
            if (!p.branch_id || p.branch_id === branchId) return true;
            return false;
          });
          renderHariIniPromos(activePromos);
        }
      }
    } catch (e) {
      console.warn("[BM Hari Ini Promos Error]:", e);
    }

    // 6. Fetch authoritative recent branch operational activity logs
    try {
      var logsRes = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/operation-logs?limit=5", { headers: getAuthHeaders() });
      if (logsRes.ok) {
        var logsData = await logsRes.json();
        if (logsData.success && Array.isArray(logsData.logs)) {
          renderHariIniRecentActivity(logsData.logs);
        }
      }
    } catch (e) {
      console.warn("[BM Hari Ini Logs Error]:", e);
    }
  }
  window.loadHariIni = loadHariIni;

  function renderHariIniPromos(promos) {
    var container = $("bm-active-promos-list");
    if (!container) return;

    if (!promos || !promos.length) {
      container.innerHTML = "<div class=\"text-muted text-center py-4\" style=\"font-size:13px;\">Belum ada promosi aktif di cabang ini.</div>";
      return;
    }

    container.innerHTML = promos.slice(0, 4).map(function (p) {
      var discountStr = p.discount_type === "percentage" ? (p.discount_value + "%") : formatMoney(p.discount_value);
      return "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#f0fdf4;border-radius:6px;border:1px solid #dcfce7;\">" +
        "<div>" +
          "<div style=\"display:flex;align-items:center;gap:6px;\">" +
            "<strong style=\"font-size:13px;color:#166534;\">" + esc(p.name || p.title) + "</strong>" +
            (p.code ? ("<code style=\"font-size:11px;background:#bbf7d0;color:#14532d;padding:1px 5px;border-radius:3px;\">" + esc(p.code) + "</code>") : "") +
          "</div>" +
          "<div style=\"font-size:11px;color:#15803d;margin-top:2px;\">" + esc(p.description || "Promosi aktif dapat digunakan pelanggan.") + "</div>" +
        "</div>" +
        "<span class=\"x-badge x-badge-success\" style=\"font-size:11px;\">" + discountStr + "</span>" +
      "</div>";
    }).join("");
  }

  function renderHariIniRecentActivity(logs) {
    var container = $("bm-recent-activity-list");
    if (!container) return;

    if (!logs || !logs.length) {
      container.innerHTML = "<div class=\"text-muted text-center py-4\" style=\"font-size:13px;\">Belum ada aktivitas operasional tercatat hari ini.</div>";
      return;
    }

    container.innerHTML = logs.slice(0, 5).map(function (l) {
      var timeStr = l.created_at ? l.created_at.substring(11, 16) : "—";
      var actorDesc = esc(l.actor_id || "Staf") + " (" + esc(l.actor_role || "system") + ")";
      var actionDesc = "";

      if (l.field === "is_open_override") {
        var isOpen = l.new_value === "1" || l.new_value === 1 || l.new_value === "true";
        actionDesc = isOpen ? "Membuka operasional cabang" : "Menutup operasional cabang sementara";
      } else if (l.field === "is_delivery_active") {
        var isDel = l.new_value === "1" || l.new_value === 1 || l.new_value === "true";
        actionDesc = isDel ? "Mengaktifkan layanan pesanan online" : "Menjeda pesanan online cabang";
      } else if (l.field === "is_available") {
        var isAvail = l.new_value === "1" || l.new_value === 1 || l.new_value === "true";
        actionDesc = (isAvail ? "Mengaktifkan kembali menu" : "Menandai menu habis") + (l.product_id ? (" [ID: " + esc(l.product_id) + "]") : "");
      } else {
        actionDesc = "Perubahan " + esc(l.field) + " &rarr; " + esc(l.new_value || "null");
      }

      return "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;font-size:12px;\">" +
        "<div>" +
          "<span style=\"font-weight:700;color:var(--text-main);\">" + actionDesc + "</span>" +
          "<div style=\"font-size:11px;color:var(--text-muted);margin-top:2px;\">Oleh: " + actorDesc + "</div>" +
        "</div>" +
        "<span style=\"color:var(--text-muted);font-weight:600;font-size:11px;\">" + timeStr + "</span>" +
      "</div>";
    }).join("");
  }

  function renderHariIniPendingOrders(orders) {
    var tbody = $("bm-tbody-pending-orders");
    var countBadge = $("bm-badge-pending-count");
    if (countBadge) {
      if (orders && orders.length > 0) {
        countBadge.textContent = orders.length + " Menunggu";
        countBadge.style.display = "inline-block";
      } else {
        countBadge.style.display = "none";
      }
    }
    if (!tbody) return;

    if (!orders || orders.length === 0) {
      tbody.innerHTML = "<tr><td colspan=\"7\" class=\"text-center py-6 text-muted\"><span style=\"color:var(--accent-green);font-weight:700;\">✓</span> Tidak ada antrean pesanan yang memerlukan tindakan saat ini.</td></tr>";
      return;
    }

    tbody.innerHTML = orders.map(function (o) {
      var orderNum = esc(o.order_number || o.id);
      var cust = esc(o.customer_name || "Pelanggan");
      var typeBadge = (o.order_type === "delivery")
        ? "<span class=\"x-badge x-badge-info\">DELIVERY</span>"
        : (o.order_type === "dine_in" ? "<span class=\"x-badge\" style=\"background:#ede9fe;color:#6d28d9;\">DINE IN</span>" : "<span class=\"x-badge x-badge-warning\">PICKUP</span>");
      var time = (o.created_at || "").substring(11, 16) || "—";
      var total = formatMoney(o.grand_total);
      var statusBadge = "<span class=\"x-badge x-badge-warning\">MENUNGGU KONFIRMASI</span>";

      return "<tr>" +
        "<td><strong>" + orderNum + "</strong></td>" +
        "<td>" + cust + "</td>" +
        "<td>" + typeBadge + "</td>" +
        "<td>" + time + "</td>" +
        "<td><strong>" + total + "</strong></td>" +
        "<td>" + statusBadge + "</td>" +
        "<td>" +
          "<div style=\"display:flex;gap:6px;\">" +
            "<button type=\"button\" class=\"x-btn-primary\" style=\"font-size:11px;padding:4px 8px;\" onclick=\"quickAcceptBMOrder('" + esc(o.id) + "', this)\">Terima</button>" +
            "<button type=\"button\" class=\"x-btn-secondary\" style=\"font-size:11px;padding:4px 8px;color:#dc2626;border-color:#fecaca;\" onclick=\"quickRejectBMOrder('" + esc(o.id) + "')\">Tolak</button>" +
          "</div>" +
        "</td>" +
      "</tr>";
    }).join("");
  }

  function renderHariIniAttention(lowItems, unavailItems) {
    var hasLow = lowItems && lowItems.length > 0;
    var hasUnavail = unavailItems && unavailItems.length > 0;

    var menuContainer = $("bm-menu-unavail-list");
    var menuBadge = $("bm-badge-menu-unavail");
    if (menuBadge) {
      menuBadge.textContent = hasUnavail ? (unavailItems.length + " Habis") : "0 Habis";
      menuBadge.className = "x-badge " + (hasUnavail ? "x-badge-danger" : "");
      if (!hasUnavail) {
        menuBadge.style.background = "#e2e8f0";
        menuBadge.style.color = "var(--text-muted)";
      } else {
        menuBadge.style.background = "";
        menuBadge.style.color = "";
      }
    }
    if (menuContainer) {
      if (!hasUnavail) {
        menuContainer.innerHTML = "<div class=\"text-muted text-center py-3\" style=\"font-size:12px;\"><span style=\"color:var(--accent-green);font-weight:700;\">✓</span> Semua menu tersedia</div>";
      } else {
        menuContainer.innerHTML = unavailItems.slice(0, 4).map(function (p) {
          return "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#fef2f2;border-radius:6px;border:1px solid #fee2e2;\">" +
            "<div>" +
              "<strong style=\"font-size:12px;color:#991b1b;\">" + esc(p.product_name || p.name) + "</strong>" +
              "<div style=\"font-size:11px;color:#b91c1c;\">Status: Ditandai Habis di Cabang</div>" +
            "</div>" +
            "<span class=\"x-badge x-badge-danger\" style=\"font-size:10px;\">HABIS</span>" +
          "</div>";
        }).join("");
      }
    }

    var stockContainer = $("bm-stock-low-list");
    var stockBadge = $("bm-badge-stock-low");
    if (stockBadge) {
      stockBadge.textContent = hasLow ? (lowItems.length + " Menipis") : "0 Menipis";
      stockBadge.className = "x-badge " + (hasLow ? "x-badge-warning" : "");
      if (!hasLow) {
        stockBadge.style.background = "#e2e8f0";
        stockBadge.style.color = "var(--text-muted)";
      } else {
        stockBadge.style.background = "";
        stockBadge.style.color = "";
      }
    }
    if (stockContainer) {
      if (!hasLow) {
        stockContainer.innerHTML = "<div class=\"text-muted text-center py-3\" style=\"font-size:12px;\"><span style=\"color:var(--accent-green);font-weight:700;\">✓</span> Tidak ada stok yang perlu diperhatikan</div>";
      } else {
        stockContainer.innerHTML = lowItems.slice(0, 4).map(function (it) {
          return "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#fffbeb;border-radius:6px;border:1px solid #fef3c7;\">" +
            "<div>" +
              "<strong style=\"font-size:12px;color:#92400e;\">" + esc(it.product_name || it.name || it.product_id) + "</strong>" +
              "<div style=\"font-size:11px;color:#b45309;\">Tersisa " + esc(it.stock) + " (Batas: " + esc(it.low_stock_threshold || 5) + ")</div>" +
            "</div>" +
            "<span class=\"x-badge x-badge-warning\" style=\"font-size:10px;\">STOK TIPIS</span>" +
          "</div>";
        }).join("");
      }
    }

    // Backwards compatibility for legacy container
    var legacyContainer = $("bm-low-stock-list");
    if (legacyContainer) {
      if (!hasLow && !hasUnavail) {
        legacyContainer.innerHTML = "<div class=\"text-muted text-center py-4\" style=\"font-size:13px;\">✓ Semua menu tersedia &amp; stok dalam batas aman.</div>";
      } else {
        legacyContainer.innerHTML = (menuContainer ? menuContainer.innerHTML : '') + (stockContainer ? stockContainer.innerHTML : '');
      }
    }
  }

  function renderHariIniLowStock(items) {
    renderHariIniAttention(items, []);
  }

  async function toggleBranchOpen() {
    var user = getStoredUser();
    if (!user || !user.branch_id) return;
    var branch = _hariIniState.branch;
    var curOpen = branch ? (branch.is_open_override === 1 || branch.is_open_override === true) : true;
    var newOpen = curOpen ? 0 : 1;
    var actionName = newOpen ? "Buka Cabang" : "Tutup Sementara";

    if (!confirm("Apakah Anda yakin ingin melakukan " + actionName + " untuk operasional cabang?")) {
      return;
    }

    try {
      var res = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(user.branch_id), {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_open_override: newOpen })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast("Status operasional cabang berhasil diubah menjadi " + (newOpen ? "BUKA" : "TUTUP"));
        loadHariIni();
      } else {
        showToast("Gagal mengubah status: " + (data.error || "Terjadi kesalahan"));
      }
    } catch (e) {
      showToast("Kesalahan jaringan.");
    }
  }
  window.toggleBranchOpen = toggleBranchOpen;

  async function toggleBranchOnlineOrders() {
    var user = getStoredUser();
    if (!user || !user.branch_id) return;
    var branch = _hariIniState.branch;
    var curDelivery = branch ? (branch.is_delivery_active !== 0 && branch.is_delivery_active !== false) : true;
    var newDelivery = curDelivery ? 0 : 1;
    var actionName = newDelivery ? "Resume Order Online" : "Pause Order Online";

    if (!confirm("Apakah Anda yakin ingin melakukan " + actionName + " untuk cabang ini?")) {
      return;
    }

    try {
      var res = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(user.branch_id), {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_delivery_active: newDelivery })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast("Layanan pesanan online cabang berhasil " + (newDelivery ? "DIAKTIFKAN" : "DIJEDA"));
        loadHariIni();
        if (typeof loadBMJamOperasional === 'function') loadBMJamOperasional();
      } else {
        showToast("Gagal mengubah status: " + (data.error || "Terjadi kesalahan"));
      }
    } catch (e) {
      showToast("Kesalahan jaringan.");
    }
  }
  window.toggleBranchOnlineOrders = toggleBranchOnlineOrders;

  async function quickAcceptBMOrder(orderId, btnEl) {
    if (!confirm("Terima pesanan #" + orderId + "? Dapur akan mulai menyiapkan pesanan.")) return;
    if (_bmOrdersState.inFlightAccept[orderId]) return;
    _bmOrdersState.inFlightAccept[orderId] = true;

    if (btnEl) {
      btnEl.disabled = true;
      btnEl.dataset.originalText = btnEl.innerHTML;
      btnEl.innerHTML = 'Memproses...';
    }

    try {
      var res = await adminFetch(API_BASE + "/orders/" + encodeURIComponent(orderId) + "/branch-acceptance", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ decision: "accept", note: "Diterima melalui Aksi Cepat Dashboard" })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast("Pesanan #" + orderId + " berhasil diterima.");
        loadHariIni();
        if (typeof loadBMOrders === 'function') loadBMOrders({ background: true });
      } else {
        showToast("Gagal menerima pesanan: " + (data.error || "Terjadi kesalahan"));
        loadHariIni();
        if (typeof loadBMOrders === 'function') loadBMOrders();
      }
    } catch (e) {
      showToast("Kesalahan jaringan.");
    } finally {
      delete _bmOrdersState.inFlightAccept[orderId];
      if (btnEl) {
        btnEl.disabled = false;
        if (btnEl.dataset.originalText) btnEl.innerHTML = btnEl.dataset.originalText;
      }
    }
  }
  window.quickAcceptBMOrder = quickAcceptBMOrder;

  function quickRejectBMOrder(orderId) {
    openBMRejectModal(orderId, 'hari-ini');
  }
  window.quickRejectBMOrder = quickRejectBMOrder;

  /* =========================================================================
     BM-4: STAF OPERASIONAL CABANG (BRANCH-SCOPED WORKFORCE)
     ========================================================================= */
  var _bmStaffState = {
    users: [],
    fetchSeq: 0
  };

  async function loadBMStaff() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var tbody = $('bm-staff-tbody');
    if (tbody && (!_bmStaffState.users || !_bmStaffState.users.length)) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Memuat daftar staf cabang...</td></tr>';
    }

    var currentSeq = ++_bmStaffState.fetchSeq;

    try {
      var res = await adminFetch(API_BASE + '/admin/users?limit=100&branch_id=' + encodeURIComponent(branchId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (currentSeq !== _bmStaffState.fetchSeq) return;

      if (res.ok && data.success && Array.isArray(data.users)) {
        _bmStaffState.users = data.users;
        renderBMStaffTable(data.users);
      } else {
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Gagal memuat staf cabang: ' + esc(data.error || 'Terjadi kesalahan') + '</td></tr>';
        }
      }
    } catch (err) {
      if (currentSeq !== _bmStaffState.fetchSeq) return;
      console.warn('[BM Staff Load Error]:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat staf.</td></tr>';
      }
    }
  }
  window.loadBMStaff = loadBMStaff;

  function renderBMStaffTable(users) {
    var tbody = $('bm-staff-tbody');
    if (!tbody) return;

    var totalCount = (users || []).length;
    var activeCount = (users || []).filter(function (u) { return u.status === 'active'; }).length;
    var inactiveCount = totalCount - activeCount;

    if ($('bm-staff-stat-total')) $('bm-staff-stat-total').textContent = totalCount;
    if ($('bm-staff-stat-active')) $('bm-staff-stat-active').textContent = activeCount;
    if ($('bm-staff-stat-inactive')) $('bm-staff-stat-inactive').textContent = inactiveCount;

    if (!users || !users.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Belum ada staf kasir atau operasional terdaftar di cabang ini.</td></tr>';
      return;
    }

    var myId = (getStoredUser() || {}).id;

    tbody.innerHTML = users.map(function (u) {
      var isMe = u.id === myId;
      var isActive = u.status === 'active';
      var roleBadge = u.role === 'cashier'
        ? '<span class="x-badge x-badge-warning">KASIR</span>'
        : (u.role === 'kitchen' ? '<span class="x-badge" style="background:#ede9fe;color:#6d28d9;">DAPUR</span>' : '<span class="x-badge x-badge-info">' + esc(u.role).toUpperCase() + '</span>');

      var statusToggle = '' +
        '<label class="x-toggle' + (isActive ? ' x-toggle-on' : '') + '" style="margin:0 auto;display:inline-block;vertical-align:middle;">' +
          '<input type="checkbox" ' + (isActive ? 'checked ' : '') + (isMe ? 'disabled ' : '') +
            'onchange="toggleBMStaffStatus(\'' + u.id + '\', \'' + esc(u.full_name) + '\', this)">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      var actions = '';
      if (isMe) {
        actions = '<span class="text-muted" style="font-size:11px;">Akun Anda</span>';
      } else {
        actions = '<div style="display:flex; justify-content:flex-end; gap:6px;">' +
          '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="openEditUser(\'' + u.id + '\')">Edit</button>' +
          '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="resetBMStaffPassword(\'' + u.id + '\', \'' + esc(u.full_name) + '\')">Reset Password</button>' +
        '</div>';
      }

      return '<tr>' +
        '<td><strong>' + esc(u.full_name) + '</strong></td>' +
        '<td><code style="font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px;">' + esc(u.username) + '</code></td>' +
        '<td>' + roleBadge + '</td>' +
        '<td style="color:var(--text-muted);">' + esc(u.email || '—') + '</td>' +
        '<td class="text-center" style="vertical-align:middle;text-align:center;">' + statusToggle + '</td>' +
        '<td class="text-right" style="white-space:nowrap;vertical-align:middle;">' + actions + '</td>' +
      '</tr>';
    }).join('');
  }

  function openBMAddCashierModal() {
    if (typeof openCreateUserModal === 'function') {
      openCreateUserModal();
      var roleSelect = $('user-role');
      if (roleSelect) {
        roleSelect.innerHTML = '<option value="cashier" selected>Kasir</option>';
        roleSelect.value = 'cashier';
      }
      var branchSelect = $('user-branch');
      var user = getStoredUser();
      if (branchSelect && user && user.branch_id) {
        branchSelect.value = user.branch_id;
        branchSelect.disabled = true;
      }
    }
  }
  window.openBMAddCashierModal = openBMAddCashierModal;

  async function toggleBMStaffStatus(userId, name, inputElem) {
    var willActivate = inputElem ? inputElem.checked : false;
    var revert = function () {
      if (inputElem) {
        inputElem.checked = !willActivate;
        inputElem.disabled = false;
        var parentLabel = inputElem.closest('.x-toggle');
        if (parentLabel) {
          parentLabel.classList.toggle('x-toggle-on', !willActivate);
        }
      }
    };

    if (!willActivate) {
      if (!confirm('Nonaktifkan akun kasir "' + name + '"? Kasir ini tidak akan bisa login sampai diaktifkan kembali.')) {
        revert();
        return;
      }
    }

    if (inputElem) inputElem.disabled = true;

    try {
      var endpoint = willActivate ? '/enable' : '/disable';
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + endpoint, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Akun "' + name + '" berhasil ' + (willActivate ? 'diaktifkan.' : 'dinonaktifkan.'));
        loadBMStaff();
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
        revert();
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
      revert();
    }
  }
  window.toggleBMStaffStatus = toggleBMStaffStatus;

  async function resetBMStaffPassword(userId, name) {
    if (!confirm('Generate token reset password untuk kasir "' + name + '"? Token hanya dapat dilihat sekali.')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + '/reset-password', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success && data.reset_token) {
        if ($('reset-password-user-name')) $('reset-password-user-name').value = name;
        if ($('reset-password-token')) $('reset-password-token').value = data.reset_token;
        if ($('modal-reset-password')) $('modal-reset-password').style.display = 'flex';
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.resetBMStaffPassword = resetBMStaffPassword;

  /* =========================================================================
     BM-4: JAM OPERASIONAL & JADWAL CABANG
     ========================================================================= */
  async function loadBMJamOperasional() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success && data.branch) {
        var b = data.branch;
        var isOpen = b.is_open_override === 1 || b.is_open_override === true;
        var isDeliveryActive = b.is_delivery_active !== 0 && b.is_delivery_active !== false;

        var statusText = $('bm-jam-status-text');
        var toggleOpenBtn = $('btn-bm-jam-toggle-open');
        if (statusText) {
          statusText.innerHTML = isOpen
            ? '<span class="x-badge x-badge-success" style="font-size:11px;">BUKA (Operational Active)</span>'
            : '<span class="x-badge x-badge-danger" style="font-size:11px;">TUTUP SEMENTARA</span>';
        }
        if (toggleOpenBtn) {
          toggleOpenBtn.textContent = isOpen ? 'Tutup Toko' : 'Buka Toko';
          toggleOpenBtn.className = isOpen ? 'x-btn-secondary' : 'x-btn-primary';
        }

        var deliveryText = $('bm-jam-delivery-text');
        var toggleDeliveryBtn = $('btn-bm-jam-toggle-delivery');
        if (deliveryText) {
          deliveryText.innerHTML = isDeliveryActive
            ? '<span class="x-badge x-badge-success" style="font-size:11px;">AKTIF (Menerima Pesanan Online)</span>'
            : '<span class="x-badge x-badge-warning" style="font-size:11px;">DIJEDA (Online Orders Paused)</span>';
        }
        if (toggleDeliveryBtn) {
          toggleDeliveryBtn.textContent = isDeliveryActive ? 'Jeda Pesanan Online' : 'Aktifkan Layanan Online';
          toggleDeliveryBtn.className = isDeliveryActive ? 'x-btn-secondary' : 'x-btn-primary';
        }
      }
    } catch (err) {
      console.warn('[BM Jam Operasional Load Error]:', err);
    }
  }
  window.loadBMJamOperasional = loadBMJamOperasional;

  /* =========================================================================
     BM-5: LAPORAN OPERASIONAL HARIAN CABANG
     ========================================================================= */
  async function loadBMReports() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/orders?status=all', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success && Array.isArray(data.orders)) {
        var orders = data.orders;
        var todayStr = new Date().toISOString().substring(0, 10);

        var todayOrders = orders.filter(function (o) {
          return (o.created_at || '').substring(0, 10) === todayStr;
        });

        var completedOrders = todayOrders.filter(function (o) {
          return o.status === 'completed';
        });

        var netSales = completedOrders.reduce(function (acc, o) {
          return acc + (Number(o.grand_total) || 0);
        }, 0);

        var aov = completedOrders.length > 0 ? Math.round(netSales / completedOrders.length) : 0;

        if ($('bm-report-stat-sales')) $('bm-report-stat-sales').textContent = formatMoney(netSales);
        if ($('bm-report-stat-total-orders')) $('bm-report-stat-total-orders').textContent = todayOrders.length;
        if ($('bm-report-stat-completed-orders')) $('bm-report-stat-completed-orders').textContent = completedOrders.length + ' pesanan selesai';
        if ($('bm-report-stat-aov')) $('bm-report-stat-aov').textContent = formatMoney(aov);

        // Breakdown by channel (completed today)
        var deliveryOrders = completedOrders.filter(function (o) { return o.order_type === 'delivery'; });
        var pickupOrders = completedOrders.filter(function (o) { return o.order_type === 'pickup'; });
        var dineInOrders = completedOrders.filter(function (o) { return o.order_type === 'dine_in'; });

        var deliverySales = deliveryOrders.reduce(function (acc, o) { return acc + (Number(o.grand_total) || 0); }, 0);
        var pickupSales = pickupOrders.reduce(function (acc, o) { return acc + (Number(o.grand_total) || 0); }, 0);
        var dineInSales = dineInOrders.reduce(function (acc, o) { return acc + (Number(o.grand_total) || 0); }, 0);

        if ($('bm-report-channel-delivery')) $('bm-report-channel-delivery').textContent = deliveryOrders.length;
        if ($('bm-report-channel-delivery-sales')) $('bm-report-channel-delivery-sales').textContent = formatMoney(deliverySales);

        if ($('bm-report-channel-pickup')) $('bm-report-channel-pickup').textContent = pickupOrders.length;
        if ($('bm-report-channel-pickup-sales')) $('bm-report-channel-pickup-sales').textContent = formatMoney(pickupSales);

        if ($('bm-report-channel-dinein')) $('bm-report-channel-dinein').textContent = dineInOrders.length;
        if ($('bm-report-channel-dinein-sales')) $('bm-report-channel-dinein-sales').textContent = formatMoney(dineInSales);

        // Recent completed table
        var tbody = $('bm-report-completed-tbody');
        if (tbody) {
          if (!completedOrders.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">Belum ada pesanan selesai hari ini.</td></tr>';
          } else {
            tbody.innerHTML = completedOrders.slice(0, 5).map(function (o) {
              var typeBadge = (o.order_type === 'delivery')
                ? '<span class="x-badge x-badge-info">DELIVERY</span>'
                : (o.order_type === 'dine_in' ? '<span class="x-badge" style="background:#ede9fe;color:#6d28d9;">DINE IN</span>' : '<span class="x-badge x-badge-warning">PICKUP</span>');
              return '<tr>' +
                '<td><strong>' + esc(o.order_number || o.id) + '</strong></td>' +
                '<td>' + esc(o.customer_name || 'Pelanggan') + '</td>' +
                '<td>' + typeBadge + '</td>' +
                '<td><strong style="color:var(--accent-teal);">' + formatMoney(o.grand_total) + '</strong></td>' +
              '</tr>';
            }).join('');
          }
        }
      }
    } catch (err) {
      console.warn('[BM Reports Load Error]:', err);
    }
  }
  window.loadBMReports = loadBMReports;

  /* =========================================================================
     BM-2: OPERASIONAL PESANAN & MEJA (BRANCH MANAGER OPERATIONAL CENTER)
     ========================================================================= */
  var _bmOrdersState = {
    orders: [],
    searchQuery: '',
    statusFilter: 'all',
    typeFilter: 'all',
    pollTimer: null,
    fetchSeq: 0,
    inFlightAccept: {},
    detailCountdownTimer: null
  };

  var _bmTablesState = {
    tables: [],
    filterStatus: 'all',
    fetchSeq: 0
  };

  /* =========================================================================
     BM-3: OPERASIONAL MENU, STOK & PROMO (BRANCH MANAGER OPERATIONAL CENTER)
     ========================================================================= */
  var _bmMenuState = {
    products: [],
    categories: [],
    availableProducts: [],
    searchQuery: '',
    statusFilter: 'all',
    categoryFilter: 'all',
    addCatalogSearchQuery: '',
    fetchSeq: 0
  };

  var _bmStockState = {
    inventory: [],
    searchQuery: '',
    statusFilter: 'all',
    fetchSeq: 0
  };

  var _bmPromoState = {
    promotions: [],
    redemptions: [],
    fetchSeq: 0
  };

  function stopBMOrdersPolling() {
    if (_bmOrdersState.pollTimer) {
      clearInterval(_bmOrdersState.pollTimer);
      _bmOrdersState.pollTimer = null;
    }
  }

  function startBMOrdersPolling() {
    stopBMOrdersPolling();
    _bmOrdersState.pollTimer = setInterval(function () {
      if (document.visibilityState === 'hidden') return;
      loadBMOrders({ background: true });
    }, 10000);
  }

  window.startBMOrdersPolling = startBMOrdersPolling;
  window.stopBMOrdersPolling = stopBMOrdersPolling;

  async function loadBMOrders(opts) {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var isBg = opts && opts.background;
    var tbody = $('bm-orders-tbody');
    if (tbody && !isBg && (!_bmOrdersState.orders || !_bmOrdersState.orders.length)) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-muted">Memuat antrean pesanan cabang...</td></tr>';
    }

    var currentSeq = ++_bmOrdersState.fetchSeq;

    try {
      var queryParams = [];
      if (_bmOrdersState.statusFilter && _bmOrdersState.statusFilter !== 'all') {
        queryParams.push('status=' + encodeURIComponent(_bmOrdersState.statusFilter));
      }
      var qs = queryParams.length ? ('?' + queryParams.join('&')) : '';
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/orders' + qs, {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (currentSeq !== _bmOrdersState.fetchSeq) return;

      if (res.ok && data.success && Array.isArray(data.orders)) {
        _bmOrdersState.orders = data.orders;
        renderBMOrdersTable();
      } else {
        if (tbody && !isBg) {
          tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-danger">Gagal memuat pesanan: ' + esc(data.error || 'Terjadi kesalahan') + '</td></tr>';
        }
      }
    } catch (err) {
      if (currentSeq !== _bmOrdersState.fetchSeq) return;
      console.warn('[BM Orders Load Error]:', err);
      if (tbody && !isBg) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat pesanan.</td></tr>';
      }
    }
  }
  window.loadBMOrders = loadBMOrders;

  function onBMOrdersFilterChange() {
    var searchEl = $('bm-orders-search');
    var statusEl = $('bm-orders-filter-status');
    var typeEl = $('bm-orders-filter-type');

    if (searchEl) _bmOrdersState.searchQuery = searchEl.value.trim().toLowerCase();
    if (statusEl) _bmOrdersState.statusFilter = statusEl.value;
    if (typeEl) _bmOrdersState.typeFilter = typeEl.value;

    loadBMOrders();
  }
  window.onBMOrdersFilterChange = onBMOrdersFilterChange;

  function formatBMTimeRemaining(ms) {
    if (ms <= 0) return '00:00';
    var totalSec = Math.floor(ms / 1000);
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }

  function renderBMOrdersTable() {
    var tbody = $('bm-orders-tbody');
    if (!tbody) return;

    var filtered = (_bmOrdersState.orders || []).filter(function (ord) {
      if (_bmOrdersState.typeFilter && _bmOrdersState.typeFilter !== 'all') {
        var ordType = ord.order_type || ord.fulfillment_type || 'delivery';
        if (ordType !== _bmOrdersState.typeFilter) return false;
      }
      if (_bmOrdersState.searchQuery) {
        var q = _bmOrdersState.searchQuery;
        var num = (ord.order_number || ord.id || '').toLowerCase();
        var cust = (ord.customer_name || '').toLowerCase();
        var phone = (ord.customer_phone || '').toLowerCase();
        if (num.indexOf(q) === -1 && cust.indexOf(q) === -1 && phone.indexOf(q) === -1) {
          return false;
        }
      }
      return true;
    });

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-muted">Belum ada pesanan yang sesuai filter.</td></tr>';
      return;
    }

    var statusBadges = {
      pending: '<span class="x-badge x-badge-warning">MENUNGGU KONFIRMASI</span>',
      confirmed: '<span class="x-badge x-badge-info">DITERIMA (CONFIRMED)</span>',
      preparing: '<span class="x-badge x-badge-info">SEDANG DISIAPKAN</span>',
      ready: '<span class="x-badge x-badge-success">SIAP (READY)</span>',
      out_for_delivery: '<span class="x-badge x-badge-info">PENGIRIMAN</span>',
      completed: '<span class="x-badge x-badge-success">SELESAI</span>',
      rejected: '<span class="x-badge x-badge-danger">DITOLAK</span>',
      cancelled: '<span class="x-badge x-badge-danger">DIBATALKAN</span>',
      timeout: '<span class="x-badge x-badge-danger">TIMEOUT</span>'
    };

    var now = Date.now();

    var rowsHtml = filtered.map(function (ord) {
      var ordType = ord.order_type || ord.fulfillment_type || 'delivery';
      var typeBadge = (ordType === 'delivery')
        ? '<span class="x-badge x-badge-info">DELIVERY</span>'
        : (ordType === 'dine_in' ? '<span class="x-badge" style="background:#ede9fe;color:#6d28d9;">DINE-IN</span>' : '<span class="x-badge x-badge-warning">PICKUP</span>');

      var timeStr = (ord.created_at || '').substring(11, 16) || '—';
      var tableInfo = ord.table_number ? ('Meja ' + esc(ord.table_number)) : '—';
      var totalStr = formatMoney(ord.grand_total || ord.subtotal || 0);

      var statusCol = statusBadges[ord.status] || ('<span class="x-badge">' + esc(ord.status.toUpperCase()) + '</span>');
      if (ord.status === 'pending') {
        if (!ord.acceptance_deadline_at) {
          statusCol += '<div style="font-size:11px; font-weight:700; color:#b45309; margin-top:3px;">⏱ Memeriksa status...</div>';
          if (!_bmOrdersState.refreshPendingTimeout) {
            _bmOrdersState.refreshPendingTimeout = setTimeout(function () {
              _bmOrdersState.refreshPendingTimeout = null;
              loadBMOrders({ background: true });
            }, 3000);
          }
        } else {
          var expiresAtMs = new Date(ord.acceptance_deadline_at).getTime();
          if (isNaN(expiresAtMs)) {
            statusCol += '<div style="font-size:11px; font-weight:700; color:#6b7280; margin-top:3px;">⏱ Deadline tidak tersedia</div>';
          } else {
            var remainingMs = expiresAtMs - now;
            if (remainingMs > 0) {
              statusCol += '<div style="font-size:11px; font-weight:700; color:#b45309; margin-top:3px;">⏱ ' + formatBMTimeRemaining(remainingMs) + '</div>';
            } else {
              statusCol += '<div style="font-size:11px; font-weight:700; color:#dc2626; margin-top:3px;">⏱ Memeriksa status...</div>';
              if (!_bmOrdersState.refreshPendingTimeout) {
                _bmOrdersState.refreshPendingTimeout = setTimeout(function () {
                  _bmOrdersState.refreshPendingTimeout = null;
                  loadBMOrders({ background: true });
                }, 3000);
              }
            }
          }
        }
      }

      var isAccepting = !!_bmOrdersState.inFlightAccept[ord.id];
      var actionsHtml = '';
      if (ord.status === 'pending') {
        actionsHtml =
          '<div style="display:flex; gap:6px; justify-content:flex-end;">' +
            '<button type="button" class="x-btn-primary" style="font-size:11px; padding:4px 8px;" ' + (isAccepting ? 'disabled' : '') + ' onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'pending\', \'' + esc(ordType) + '\', this)">' + (isAccepting ? 'Memproses...' : 'Terima') + '</button>' +
            '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px; color:#dc2626; border-color:#fecaca;" ' + (isAccepting ? 'disabled' : '') + ' onclick="rejectBMOrder(\'' + esc(ord.id) + '\')">Tolak</button>' +
            '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Detail</button>' +
          '</div>';
      } else if (ord.status === 'confirmed') {
        actionsHtml =
          '<div style="display:flex; gap:6px; justify-content:flex-end;">' +
            '<button type="button" class="x-btn-primary" style="font-size:11px; padding:4px 8px;" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'confirmed\', \'' + esc(ordType) + '\', this)">Mulai Masak ➔</button>' +
            '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Detail</button>' +
          '</div>';
      } else if (ord.status === 'preparing') {
        actionsHtml =
          '<div style="display:flex; gap:6px; justify-content:flex-end;">' +
            '<button type="button" class="x-btn-primary" style="font-size:11px; padding:4px 8px;" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'preparing\', \'' + esc(ordType) + '\', this)">Tandai Siap ➔</button>' +
            '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Detail</button>' +
          '</div>';
      } else if (ord.status === 'ready') {
        var nextLabel = (ordType === 'delivery') ? 'Kirim Pesanan ➔' : 'Selesaikan ➔';
        actionsHtml =
          '<div style="display:flex; gap:6px; justify-content:flex-end;">' +
            '<button type="button" class="x-btn-primary" style="font-size:11px; padding:4px 8px;" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'ready\', \'' + esc(ordType) + '\', this)">' + nextLabel + '</button>' +
            '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Detail</button>' +
          '</div>';
      } else if (ord.status === 'out_for_delivery') {
        actionsHtml =
          '<div style="display:flex; gap:6px; justify-content:flex-end;">' +
            '<button type="button" class="x-btn-primary" style="font-size:11px; padding:4px 8px;" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'out_for_delivery\', \'' + esc(ordType) + '\', this)">Selesaikan ➔</button>' +
            '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Detail</button>' +
          '</div>';
      } else {
        // Terminal states: completed, rejected, cancelled, timeout
        actionsHtml =
          '<div style="display:flex; gap:6px; justify-content:flex-end;">' +
            '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Detail</button>' +
          '</div>';
      }

      return '<tr>' +
        '<td><strong>#' + esc(ord.order_number || ord.id.substring(0, 8)) + '</strong></td>' +
        '<td><small class="text-muted">' + timeStr + '</small></td>' +
        '<td><strong>' + esc(ord.customer_name || 'Pelanggan') + '</strong><br><small class="text-muted">' + esc(ord.customer_phone || '—') + '</small></td>' +
        '<td>' + typeBadge + '</td>' +
        '<td>' + tableInfo + '</td>' +
        '<td><strong>' + totalStr + '</strong></td>' +
        '<td>' + statusCol + '</td>' +
        '<td class="text-right">' + actionsHtml + '</td>' +
      '</tr>';
    });

    tbody.innerHTML = rowsHtml.join('');
  }

  async function advanceBMOrderStatus(orderId, currentStatus, fulfillmentType, btnEl) {
    if (currentStatus === 'pending') {
      if (!confirm('Terima pesanan #' + orderId + '? Dapur akan mulai mempersiapkan pesanan.')) return;
      if (_bmOrdersState.inFlightAccept[orderId]) return;
      _bmOrdersState.inFlightAccept[orderId] = true;

      if (btnEl) {
        btnEl.disabled = true;
        btnEl.dataset.originalText = btnEl.innerHTML;
        btnEl.innerHTML = 'Memproses...';
      }

      try {
        var res = await adminFetch(API_BASE + '/orders/' + encodeURIComponent(orderId) + '/branch-acceptance', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ decision: 'accept', note: 'Diterima oleh Branch Manager' })
        });
        var data = await res.json();
        if (res.ok && data.success) {
          showToast('Pesanan berhasil diterima (CONFIRMED).');
          loadBMOrders();
          if (typeof loadHariIni === 'function') loadHariIni();
          var detailView = $('bm-orders-detail-view');
          if (detailView && detailView.style.display !== 'none' && $('bm-detail-order-number') && $('bm-detail-order-number').textContent.indexOf(orderId) !== -1) {
            viewBMOrderDetail(orderId);
          }
        } else {
          showToast('Gagal menerima pesanan: ' + (data.error || 'Terjadi kesalahan'));
          loadBMOrders();
          if (typeof loadHariIni === 'function') loadHariIni();
          var detailView = $('bm-orders-detail-view');
          if (detailView && detailView.style.display !== 'none' && $('bm-detail-order-number') && $('bm-detail-order-number').textContent.indexOf(orderId) !== -1) {
            viewBMOrderDetail(orderId);
          }
        }
      } catch (e) {
        showToast('Kesalahan jaringan.');
      } finally {
        delete _bmOrdersState.inFlightAccept[orderId];
        if (btnEl) {
          btnEl.disabled = false;
          if (btnEl.dataset.originalText) btnEl.innerHTML = btnEl.dataset.originalText;
        }
      }
      return;
    }

    var isDelivery = (fulfillmentType === 'delivery');
    var nextMap = {
      confirmed: 'preparing',
      preparing: 'ready',
      ready: isDelivery ? 'out_for_delivery' : 'completed',
      out_for_delivery: 'completed'
    };

    var nextStatus = nextMap[currentStatus];
    if (!nextStatus) {
      showToast('Status tidak dapat diubah lagi.');
      return;
    }

    if (btnEl) {
      btnEl.disabled = true;
      btnEl.dataset.originalText = btnEl.innerHTML;
      btnEl.innerHTML = 'Menyimpan...';
    }

    try {
      var patchRes = await adminFetch(API_BASE + '/kitchen/orders/' + encodeURIComponent(orderId) + '/status', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: nextStatus, note: 'Status diperbarui oleh Branch Manager' })
      });
      var patchData = await patchRes.json();
      if (patchRes.ok && patchData.success) {
        showToast('Status pesanan berhasil diubah menjadi ' + nextStatus.toUpperCase());
        loadBMOrders();
        var detailView = $('bm-orders-detail-view');
        if (detailView && detailView.style.display !== 'none' && $('bm-detail-order-number') && $('bm-detail-order-number').textContent.indexOf(orderId) !== -1) {
          viewBMOrderDetail(orderId);
        }
      } else {
        showToast('Gagal mengubah status: ' + (patchData.error || 'Terjadi kesalahan'));
        loadBMOrders();
      }
    } catch (e) {
      showToast('Kesalahan jaringan.');
    } finally {
      if (btnEl) {
        btnEl.disabled = false;
        if (btnEl.dataset.originalText) btnEl.innerHTML = btnEl.dataset.originalText;
      }
    }
  }
  window.advanceBMOrderStatus = advanceBMOrderStatus;

  /* =========================================================================
     BRANCH ACCEPTANCE: REJECTION MODAL & SUBMIT
     ========================================================================= */
  var _bmRejectOrigin = 'orders';

  function openBMRejectModal(orderId, origin) {
    _bmRejectOrigin = origin || 'orders';
    var modal = $('modal-bm-reject-order');
    var idInput = $('bm-reject-order-id');
    var reasonInput = $('bm-reject-reason-input');
    var errorEl = $('bm-reject-error');
    var subtitle = $('bm-reject-order-subtitle');
    var btnText = $('bm-reject-btn-text');
    var confirmBtn = $('btn-bm-confirm-reject');

    if (idInput) idInput.value = orderId;
    if (reasonInput) reasonInput.value = '';
    if (errorEl) errorEl.style.display = 'none';
    if (subtitle) subtitle.textContent = 'Pesanan #' + orderId;
    if (btnText) btnText.textContent = 'Konfirmasi Tolak Pesanan';
    if (confirmBtn) confirmBtn.disabled = false;

    if (modal) modal.style.display = 'flex';
    if (reasonInput) setTimeout(function () { reasonInput.focus(); }, 50);
  }
  window.openBMRejectModal = openBMRejectModal;

  function closeBMRejectModal() {
    var modal = $('modal-bm-reject-order');
    if (modal) modal.style.display = 'none';
    var idInput = $('bm-reject-order-id');
    if (idInput) idInput.value = '';
  }
  window.closeBMRejectModal = closeBMRejectModal;

  function setBMRejectReason(reasonText) {
    var reasonInput = $('bm-reject-reason-input');
    var errorEl = $('bm-reject-error');
    if (reasonInput) {
      reasonInput.value = reasonText;
      reasonInput.focus();
    }
    if (errorEl) errorEl.style.display = 'none';
  }
  window.setBMRejectReason = setBMRejectReason;

  async function submitBMRejectOrder(event) {
    if (event && event.preventDefault) event.preventDefault();

    var idInput = $('bm-reject-order-id');
    var reasonInput = $('bm-reject-reason-input');
    var errorEl = $('bm-reject-error');
    var confirmBtn = $('btn-bm-confirm-reject');
    var btnText = $('bm-reject-btn-text');

    var orderId = idInput ? idInput.value.trim() : '';
    var reason = reasonInput ? reasonInput.value.trim() : '';

    if (!orderId) {
      closeBMRejectModal();
      return;
    }

    if (!reason) {
      if (errorEl) {
        errorEl.textContent = 'Alasan penolakan wajib diisi untuk catatan audit.';
        errorEl.style.display = 'block';
      }
      if (reasonInput) reasonInput.focus();
      return;
    }

    if (confirmBtn) confirmBtn.disabled = true;
    if (btnText) btnText.textContent = 'Menolak Pesanan...';

    try {
      var res = await adminFetch(API_BASE + '/orders/' + encodeURIComponent(orderId) + '/branch-acceptance', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ decision: 'reject', reason: reason })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Pesanan #' + orderId + ' telah ditolak.');
        closeBMRejectModal();
        if (_bmRejectOrigin === 'hari-ini' && typeof loadHariIni === 'function') {
          loadHariIni();
        }
        loadBMOrders();
        var detailView = $('bm-orders-detail-view');
        if (detailView && detailView.style.display !== 'none' && $('bm-detail-order-number') && $('bm-detail-order-number').textContent.indexOf(orderId) !== -1) {
          viewBMOrderDetail(orderId);
        }
      } else {
        showToast('Gagal menolak pesanan: ' + (data.error || 'Terjadi kesalahan'));
        if (confirmBtn) confirmBtn.disabled = false;
        if (btnText) btnText.textContent = 'Konfirmasi Tolak Pesanan';
        loadBMOrders();
      }
    } catch (e) {
      showToast('Kesalahan jaringan.');
      if (confirmBtn) confirmBtn.disabled = false;
      if (btnText) btnText.textContent = 'Konfirmasi Tolak Pesanan';
    }
  }
  window.submitBMRejectOrder = submitBMRejectOrder;

  function rejectBMOrder(orderId) {
    openBMRejectModal(orderId, 'orders');
  }
  window.rejectBMOrder = rejectBMOrder;

  async function viewBMOrderDetail(orderId) {
    var listView = $('bm-orders-list-view');
    var detailView = $('bm-orders-detail-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';

    if (_bmOrdersState.detailCountdownTimer) {
      clearInterval(_bmOrdersState.detailCountdownTimer);
      _bmOrdersState.detailCountdownTimer = null;
    }

    if ($('bm-detail-order-number')) $('bm-detail-order-number').textContent = '#' + orderId;
    if ($('bm-detail-items-tbody')) {
      $('bm-detail-items-tbody').innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Memuat rincian pesanan...</td></tr>';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/orders/' + encodeURIComponent(orderId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!res.ok || !data.success || !data.order) {
        showToast('Gagal memuat detail pesanan: ' + (data.error || 'Pesanan tidak ditemukan'));
        closeBMOrderDetail();
        return;
      }

      var ord = data.order;
      if ($('bm-detail-order-number')) $('bm-detail-order-number').textContent = '#' + (ord.order_number || ord.id);
      if ($('bm-detail-status-badge')) {
        $('bm-detail-status-badge').textContent = (ord.status || '').toUpperCase();
        $('bm-detail-status-badge').className = 'x-badge ' + (ord.status === 'completed' || ord.status === 'ready' ? 'x-badge-success' : (ord.status === 'rejected' || ord.status === 'cancelled' || ord.status === 'timeout' ? 'x-badge-danger' : 'x-badge-warning'));
      }

      var ordType = ord.order_type || ord.fulfillment_type || 'delivery';
      if ($('bm-detail-cust-name')) $('bm-detail-cust-name').textContent = ord.customer_name || 'Pelanggan';
      if ($('bm-detail-cust-phone')) $('bm-detail-cust-phone').textContent = ord.customer_phone || '—';
      if ($('bm-detail-fulfillment-badge')) $('bm-detail-fulfillment-badge').textContent = ordType.toUpperCase();
      if ($('bm-detail-order-time')) $('bm-detail-order-time').textContent = ord.created_at ? new Date(ord.created_at).toLocaleString('id-ID') : '—';
      if ($('bm-detail-order-notes')) $('bm-detail-order-notes').textContent = ord.notes || ord.order_notes || '—';

      var tableRow = $('bm-detail-table-row');
      if (tableRow) {
        if (ord.table_number) {
          tableRow.style.display = 'block';
          if ($('bm-detail-table-number')) $('bm-detail-table-number').textContent = 'Meja ' + ord.table_number;
        } else {
          tableRow.style.display = 'none';
        }
      }

      if ($('bm-detail-calc-subtotal')) $('bm-detail-calc-subtotal').textContent = formatMoney(ord.subtotal || 0);
      if ($('bm-detail-calc-delivery')) $('bm-detail-calc-delivery').textContent = formatMoney(ord.delivery_fee || 0);
      if ($('bm-detail-calc-discount')) $('bm-detail-calc-discount').textContent = formatMoney(ord.discount_amount || 0);
      if ($('bm-detail-calc-grandtotal')) $('bm-detail-calc-grandtotal').textContent = formatMoney(ord.grand_total || 0);
      if ($('bm-detail-pay-status')) $('bm-detail-pay-status').textContent = ((ord.payment_method || 'Tunai') + ' (' + (ord.payment_status || 'unpaid') + ')').toUpperCase();

      // P8: Branch Acceptance Warning Banner & Countdown
      var acceptanceBanner = $('bm-detail-acceptance-banner');
      var countdownText = $('bm-detail-countdown-text');

      if (acceptanceBanner) {
        if (ord.status === 'pending') {
          acceptanceBanner.style.display = 'block';

          if (!ord.acceptance_deadline_at) {
            if (countdownText) countdownText.textContent = 'Memeriksa status...';
            _bmOrdersState.detailCountdownTimer = setTimeout(function () {
              _bmOrdersState.detailCountdownTimer = null;
              viewBMOrderDetail(ord.id);
            }, 3000);
          } else {
            var expiresAtMs = new Date(ord.acceptance_deadline_at).getTime();
            if (isNaN(expiresAtMs)) {
              if (countdownText) countdownText.textContent = 'Deadline tidak tersedia';
            } else {
              var updateDetailCountdown = function () {
                var diff = expiresAtMs - Date.now();
                if (diff > 0) {
                  if (countdownText) countdownText.textContent = formatBMTimeRemaining(diff);
                } else {
                  if (countdownText) countdownText.textContent = 'Memeriksa status...';
                  if (_bmOrdersState.detailCountdownTimer) {
                    clearInterval(_bmOrdersState.detailCountdownTimer);
                    _bmOrdersState.detailCountdownTimer = null;
                  }
                  // Authoritative refresh from server; never mutate locally
                  viewBMOrderDetail(ord.id);
                }
              };

              updateDetailCountdown();
              _bmOrdersState.detailCountdownTimer = setInterval(updateDetailCountdown, 1000);
            }
          }
        } else {
          acceptanceBanner.style.display = 'none';
        }
      }

      // Render items
      var tbody = $('bm-detail-items-tbody');
      if (tbody) {
        var items = ord.items || [];
        if (!items.length) {
          tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Tidak ada item dalam pesanan ini.</td></tr>';
        } else {
          tbody.innerHTML = items.map(function (it) {
            var sub = it.item_subtotal != null ? it.item_subtotal : ((it.unit_price || 0) * (it.quantity || 1));
            return '<tr>' +
              '<td><strong>' + esc(it.product_name || it.product_id) + '</strong></td>' +
              '<td>' + formatMoney(it.unit_price || 0) + '</td>' +
              '<td>' + (it.quantity || 1) + '</td>' +
              '<td><small class="text-muted">' + esc(it.note || '—') + '</small></td>' +
              '<td class="text-right"><strong>' + formatMoney(sub) + '</strong></td>' +
            '</tr>';
          }).join('');
        }
      }

      // Render audit logs
      var logsList = $('bm-detail-logs-list');
      if (logsList) {
        var logs = ord.status_logs || [];
        if (!logs.length) {
          logsList.innerHTML = '<span class="text-muted">Tidak ada catatan audit tambahan.</span>';
        } else {
          logsList.innerHTML = logs.map(function (l) {
            var time = l.created_at ? new Date(l.created_at).toLocaleTimeString('id-ID') : '—';
            return '<div style="background:#f8fafc; padding:8px 12px; border-radius:6px; border:1px solid #e2e8f0;">' +
              '<div><strong>' + esc((l.previous_status || 'INIT') + ' ➔ ' + l.new_status) + '</strong> <small class="text-muted">(' + time + ')</small></div>' +
              '<div style="color:var(--text-muted); margin-top:2px;">' + esc(l.note || 'Pembaruan status sistem') + '</div>' +
            '</div>';
          }).join('');
        }
      }

      // Top action buttons in detail
      var topActions = $('bm-detail-actions-top');
      if (topActions) {
        if (ord.status === 'pending') {
          var isAccepting = !!_bmOrdersState.inFlightAccept[ord.id];
          topActions.innerHTML =
            '<button type="button" class="x-btn-primary" style="font-size:13px; padding:6px 14px;" ' + (isAccepting ? 'disabled' : '') + ' onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'pending\', \'' + esc(ordType) + '\', this);">Terima Pesanan</button>' +
            '<button type="button" class="x-btn-secondary" style="font-size:13px; padding:6px 14px; color:#dc2626; border-color:#fecaca;" ' + (isAccepting ? 'disabled' : '') + ' onclick="rejectBMOrder(\'' + esc(ord.id) + '\');">Tolak Pesanan</button>';
        } else if (ord.status === 'confirmed') {
          topActions.innerHTML =
            '<button type="button" class="x-btn-primary" style="font-size:13px; padding:6px 14px;" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'confirmed\', \'' + esc(ordType) + '\', this);">Mulai Memasak ➔</button>';
        } else if (ord.status === 'preparing') {
          topActions.innerHTML =
            '<button type="button" class="x-btn-primary" style="font-size:13px; padding:6px 14px;" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'preparing\', \'' + esc(ordType) + '\', this)">Tandai Siap ➔</button>';
        } else if (ord.status === 'ready') {
          var label = (ordType === 'delivery') ? 'Kirim Pesanan ➔' : 'Selesaikan Pesanan ➔';
          topActions.innerHTML =
            '<button type="button" class="x-btn-primary" style="font-size:13px; padding:6px 14px;" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'ready\', \'' + esc(ordType) + '\', this);">' + label + '</button>';
        } else if (ord.status === 'out_for_delivery') {
          topActions.innerHTML =
            '<button type="button" class="x-btn-primary" style="font-size:13px; padding:6px 14px;" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'out_for_delivery\', \'' + esc(ordType) + '\', this);">Selesaikan Pesanan ➔</button>';
        } else {
          topActions.innerHTML = '';
        }
      }

    } catch (e) {
      console.warn('[BM Detail Load Error]:', e);
      showToast('Kesalahan jaringan saat memuat detail.');
      closeBMOrderDetail();
    }
  }
  window.viewBMOrderDetail = viewBMOrderDetail;

  function closeBMOrderDetail() {
    if (_bmOrdersState.detailCountdownTimer) {
      clearInterval(_bmOrdersState.detailCountdownTimer);
      _bmOrdersState.detailCountdownTimer = null;
    }
    var listView = $('bm-orders-list-view');
    var detailView = $('bm-orders-detail-view');
    if (detailView) detailView.style.display = 'none';
    if (listView) listView.style.display = 'block';
  }
  window.closeBMOrderDetail = closeBMOrderDetail;

  /* =========================================================================
     BM-2: OPERASIONAL MEJA / DINE-IN CONTROLLER
     ========================================================================= */
  async function loadBMTables() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var grid = $('bm-tables-grid');
    if (grid && (!_bmTablesState.tables || !_bmTablesState.tables.length)) {
      grid.innerHTML = '<div class="text-center py-6 text-muted" style="grid-column:1/-1;">Memuat data meja cabang...</div>';
    }

    var currentSeq = ++_bmTablesState.fetchSeq;

    try {
      var res = await adminFetch(API_BASE + '/dine-in/layout?branch_id=' + encodeURIComponent(branchId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (currentSeq !== _bmTablesState.fetchSeq) return;

      if (res.ok && data.success && data.layout && Array.isArray(data.layout.tables)) {
        _bmTablesState.tables = data.layout.tables;
        updateBMTableStats(data.layout.tables);
        renderBMTablesGrid();
      } else {
        if (grid) {
          grid.innerHTML = '<div class="text-center py-6 text-danger" style="grid-column:1/-1;">Gagal memuat meja: ' + esc(data.error || 'Terjadi kesalahan') + '</div>';
        }
      }
    } catch (err) {
      if (currentSeq !== _bmTablesState.fetchSeq) return;
      console.warn('[BM Tables Load Error]:', err);
      if (grid) {
        grid.innerHTML = '<div class="text-center py-6 text-danger" style="grid-column:1/-1;">Kesalahan jaringan saat memuat meja.</div>';
      }
    }
  }
  window.loadBMTables = loadBMTables;

  function updateBMTableStats(tables) {
    var avail = 0, occupied = 0, held = 0, blocked = 0;
    (tables || []).forEach(function (t) {
      var st = t.operational_state || 'available';
      if (st === 'available') avail++;
      else if (st === 'occupied') occupied++;
      else if (st === 'held') held++;
      else if (st === 'blocked' || st === 'out_of_service') blocked++;
    });

    if ($('bm-tables-stat-available')) $('bm-tables-stat-available').textContent = avail;
    if ($('bm-tables-stat-occupied')) $('bm-tables-stat-occupied').textContent = occupied;
    if ($('bm-tables-stat-held')) $('bm-tables-stat-held').textContent = held;
    if ($('bm-tables-stat-blocked')) $('bm-tables-stat-blocked').textContent = blocked;
  }

  function onBMTablesFilterChange() {
    var filterEl = $('bm-tables-filter-status');
    if (filterEl) _bmTablesState.filterStatus = filterEl.value;
    renderBMTablesGrid();
  }
  window.onBMTablesFilterChange = onBMTablesFilterChange;

  function renderBMTablesGrid() {
    var grid = $('bm-tables-grid');
    if (!grid) return;

    var filtered = (_bmTablesState.tables || []).filter(function (t) {
      var st = t.operational_state || 'available';
      if (_bmTablesState.filterStatus === 'available') return st === 'available';
      if (_bmTablesState.filterStatus === 'occupied') return st === 'occupied';
      if (_bmTablesState.filterStatus === 'held') return st === 'held';
      if (_bmTablesState.filterStatus === 'blocked') return (st === 'blocked' || st === 'out_of_service');
      return true;
    });

    if (!filtered.length) {
      grid.innerHTML = '<div class="text-center py-6 text-muted" style="grid-column:1/-1;">Tidak ada meja yang sesuai filter status saat ini.</div>';
      return;
    }

    var stateCardConfigs = {
      available: { bg: '#ffffff', border: '#bbf7d0', badge: '<span class="x-badge x-badge-success">TERSEDIA</span>' },
      occupied: { bg: '#ffffff', border: '#bfdbfe', badge: '<span class="x-badge x-badge-info">TERISI</span>' },
      held: { bg: '#ffffff', border: '#fde68a', badge: '<span class="x-badge x-badge-warning">DITAHAN</span>' },
      blocked: { bg: '#fef2f2', border: '#fecaca', badge: '<span class="x-badge x-badge-danger">DIBLOKIR</span>' },
      out_of_service: { bg: '#fef2f2', border: '#fecaca', badge: '<span class="x-badge x-badge-danger">RUSAK</span>' }
    };

    grid.innerHTML = filtered.map(function (t) {
      var st = t.operational_state || 'available';
      var cfg = stateCardConfigs[st] || stateCardConfigs.available;
      var isBlocked = (st === 'blocked' || st === 'out_of_service');

      var actionsHtml = '';
      if (isBlocked) {
        actionsHtml = '<button type="button" class="x-btn-secondary" style="font-size:12px; padding:6px 12px; width:100%; color:#166534; border-color:#bbf7d0;" onclick="toggleBMTableBlocked(\'' + esc(t.id) + '\', false)">Buka Blokir (Tersedia)</button>';
      } else if (st === 'available') {
        actionsHtml = '<button type="button" class="x-btn-secondary" style="font-size:12px; padding:6px 12px; width:100%; color:#dc2626; border-color:#fecaca;" onclick="toggleBMTableBlocked(\'' + esc(t.id) + '\', true)">Blokir Meja</button>';
      } else if (st === 'occupied' && t.current_session_id) {
        actionsHtml = '<button type="button" class="x-btn-secondary" style="font-size:12px; padding:6px 12px; width:100%;" onclick="completeBMTableSession(\'' + esc(t.current_session_id) + '\')">Selesaikan Sesi Makan</button>';
      } else {
        actionsHtml = '<button type="button" class="x-btn-secondary" style="font-size:12px; padding:6px 12px; width:100%;" disabled>Sedang Digunakan</button>';
      }

      return '<div class="x-card" style="padding:16px; border:1px solid ' + cfg.border + '; border-radius:10px; background:' + cfg.bg + '; display:flex; flex-direction:column; justify-content:space-between; min-height:160px;">' +
        '<div>' +
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">' +
            '<h4 style="font-size:16px; font-weight:800; margin:0; color:var(--text-main);">' + esc(t.label || ('Meja ' + t.table_number)) + '</h4>' +
            cfg.badge +
          '</div>' +
          '<div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">Kapasitas: <strong>' + (t.capacity || 4) + ' Kursi</strong></div>' +
          (t.notes ? ('<div style="font-size:11px; color:#b91c1c; margin-bottom:8px; font-style:italic;">Catatan: ' + esc(t.notes) + '</div>') : '') +
        '</div>' +
        '<div style="margin-top:12px;">' + actionsHtml + '</div>' +
      '</div>';
    }).join('');
  }

  async function toggleBMTableBlocked(tableId, isBlocked) {
    var reason = '';
    if (isBlocked) {
      reason = prompt('Masukkan alasan pemblokiran meja (misal: Rusak, Renovasi, Khusus VIP):');
      if (reason === null) return;
    }

    try {
      var res = await adminFetch(API_BASE + '/dine-in/tables/' + encodeURIComponent(tableId) + '/block', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_blocked: isBlocked, reason: reason.trim() })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast(isBlocked ? 'Meja telah diblokir.' : 'Meja dibuka kembali (Tersedia).');
        loadBMTables();
      } else {
        showToast('Gagal mengubah status meja: ' + (data.error || 'Terjadi kesalahan'));
        loadBMTables();
      }
    } catch (e) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.toggleBMTableBlocked = toggleBMTableBlocked;

  async function completeBMTableSession(sessionId) {
    if (!confirm('Selesaikan sesi makan ini dan kosongkan meja untuk tamu berikutnya?')) return;
    try {
      var res = await adminFetch(API_BASE + '/dine-in/sessions/' + encodeURIComponent(sessionId) + '/complete', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Sesi makan selesai, meja kembali tersedia.');
        loadBMTables();
      } else {
        showToast('Gagal menyelesaikan sesi: ' + (data.error || 'Terjadi kesalahan'));
        loadBMTables();
      }
    } catch (e) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.completeBMTableSession = completeBMTableSession;

  function getBMTargetBranchId() {
    var user = getStoredUser();
    var fromUser = user ? (user.branch_id || user.branchId || (user.branch && user.branch.id)) : null;
    var fromActive = (typeof getActiveBranchId === 'function' ? getActiveBranchId() : null);
    var fromManaging = currentManagingBranchId || null;
    var fromEffective = (typeof getEffectiveBranchId === 'function' ? getEffectiveBranchId() : null);
    var branchId = fromUser || fromManaging || fromActive || fromEffective || null;
    if (branchId) currentManagingBranchId = branchId;
    return branchId;
  }

  /* =========================================================================
     BM-3: MENU OPERATIONAL CONTROLLER (PHASE 2: ADOPTION & CATEGORIES)
     ========================================================================= */
  async function loadBMMenu() {
    var branchId = getBMTargetBranchId();
    if (!branchId) return;

    currentManagingBranchId = branchId;

    var tbody = $('bm-menu-tbody');
    if (tbody && (!_bmMenuState.products || !_bmMenuState.products.length)) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Memuat daftar menu cabang...</td></tr>';
    }

    var currentSeq = ++_bmMenuState.fetchSeq;

    try {
      var [prodRes, catRes] = await Promise.all([
        adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/products', {
          headers: getAuthHeaders()
        }),
        adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/catalog', {
          headers: getAuthHeaders()
        })
      ]);

      var prodData = await prodRes.json();
      var catData = await catRes.json();

      if (currentSeq !== _bmMenuState.fetchSeq) return;

      if (catRes.ok && catData.success) {
        currentBranchCatalogData = catData;
        _bmMenuState.categories = catData.categories || [];
        _bmMenuState.availableProducts = catData.available_master_products || [];
        renderBMMenuCategoriesBar();
      }

      if (prodRes.ok && prodData.success && Array.isArray(prodData.assignments)) {
        var catalogAdoptedMap = {};
        if (catData && catData.success && Array.isArray(catData.adopted_products)) {
          catData.adopted_products.forEach(function (ap) {
            catalogAdoptedMap[ap.product_id] = ap;
          });
        }

        _bmMenuState.products = prodData.assignments.map(function (p) {
          var ap = catalogAdoptedMap[p.product_id] || {};
          return Object.assign({}, ap, p, {
            branch_category_id: ap.branch_category_id || null,
            branch_category_name: ap.branch_category_name || null,
            category_ids: ap.category_ids || (ap.branch_category_id ? [ap.branch_category_id] : []),
            categories: ap.categories || [],
            pricing_mode: ap.pricing_mode || 'lock',
            master_price: ap.master_price || p.price,
            min_price: ap.min_price || null,
            max_price: ap.max_price || null,
            name_override: ap.name_override || null,
            description_override: ap.description_override || null,
            image_override: ap.image_override || null
          });
        });

        updateBMMenuStats(_bmMenuState.products);
        renderBMMenuTable();
      } else {
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-danger">Gagal memuat menu: ' + esc(prodData.error || 'Terjadi kesalahan') + '</td></tr>';
        }
      }
    } catch (err) {
      if (currentSeq !== _bmMenuState.fetchSeq) return;
      console.warn('[BM Menu Load Error]:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat menu cabang.</td></tr>';
      }
    }
  }
  window.loadBMMenu = loadBMMenu;

  function updateBMMenuStats(products) {
    var total = (products || []).length;
    var avail = (products || []).filter(function (p) { return p.is_available === 1 || p.is_available === true; }).length;
    var unavail = total - avail;

    if ($('bm-menu-stat-total')) $('bm-menu-stat-total').textContent = total;
    if ($('bm-menu-stat-available')) $('bm-menu-stat-available').textContent = avail;
    if ($('bm-menu-stat-unavailable')) $('bm-menu-stat-unavailable').textContent = unavail;
  }

  function onBMMenuFilterChange() {
    var searchEl = $('bm-menu-search');
    var filterEl = $('bm-menu-filter-status');
    if (searchEl) _bmMenuState.searchQuery = searchEl.value.trim().toLowerCase();
    if (filterEl) _bmMenuState.statusFilter = filterEl.value;
    renderBMMenuTable();
  }
  window.onBMMenuFilterChange = onBMMenuFilterChange;

  function setBMMenuCategoryFilter(catId) {
    _bmMenuState.categoryFilter = catId;
    var label = $('bm-menu-cat-filter-label');
    if (label) {
      if (catId === 'all') {
        label.textContent = 'Semua kategori';
      } else {
        var cat = (_bmMenuState.categories || []).find(function (c) { return String(c.id) === String(catId); });
        label.textContent = 'Filter: ' + (cat ? cat.name : catId);
      }
    }
    renderBMMenuCategoriesBar();
    renderBMMenuTable();
  }
  window.setBMMenuCategoryFilter = setBMMenuCategoryFilter;

  function renderBMMenuCategoriesBar() {
    var bar = $('bm-menu-categories-bar');
    if (!bar) return;

    bar.innerHTML = '';

    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'x-cat-filter-btn' + (_bmMenuState.categoryFilter === 'all' ? ' active' : '');
    allBtn.style.borderRadius = '20px';
    allBtn.textContent = 'Semua';
    allBtn.addEventListener('click', function () { setBMMenuCategoryFilter('all'); });
    bar.appendChild(allBtn);

    var categories = _bmMenuState.categories || [];
    if (!categories.length) {
      var hint = document.createElement('span');
      hint.className = 'text-muted';
      hint.style.fontSize = '12px';
      hint.textContent = 'Belum ada kategori cabang. Klik "+ Kategori Cabang" untuk membuat.';
      bar.appendChild(hint);
      return;
    }

    categories.forEach(function (cat) {
      var isActive = String(_bmMenuState.categoryFilter) === String(cat.id);

      var chip = document.createElement('span');
      chip.dataset.catId = cat.id;
      chip.draggable = true;
      chip.style.cssText = [
        'display:inline-flex;align-items:center;gap:0;border-radius:20px;overflow:hidden;',
        'border:1px solid ' + (isActive ? 'var(--x-primary,#10b981)' : '#e2e8f0') + ';',
        'background:' + (isActive ? '#f0fdf4' : '#f8fafc') + ';',
        'transition:box-shadow 0.15s,opacity 0.15s;',
        'cursor:grab;'
      ].join('');

      var handle = document.createElement('span');
      handle.title = 'Tahan & geser untuk ubah urutan';
      handle.style.cssText = 'padding:5px 4px 5px 10px;font-size:13px;color:#94a3b8;cursor:grab;user-select:none;';
      handle.textContent = '⠿';
      chip.appendChild(handle);

      var thumbWrap = document.createElement('span');
      thumbWrap.style.cssText = 'width:22px;height:22px;border-radius:6px;overflow:hidden;background:#eef2f6;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:2px;';
      if (cat.image_url) {
        var thumbImg = document.createElement('img');
        thumbImg.src = cat.image_url;
        thumbImg.alt = '';
        thumbImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        thumbWrap.appendChild(thumbImg);
      } else {
        var thumbMono = document.createElement('span');
        thumbMono.style.cssText = 'font-size:10px;font-weight:700;color:#94a3b8;';
        thumbMono.textContent = (cat.name || '?').trim().slice(0, 1).toUpperCase();
        thumbWrap.appendChild(thumbMono);
      }
      chip.appendChild(thumbWrap);

      var nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.draggable = false;
      nameBtn.style.cssText = 'border:none;background:none;padding:6px 8px 6px 2px;font-size:13px;font-weight:' + (isActive ? '700' : '500') + ';cursor:pointer;color:#1e293b;';
      nameBtn.textContent = cat.name;
      nameBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        setBMMenuCategoryFilter(cat.id);
      });
      chip.appendChild(nameBtn);

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.draggable = false;
      editBtn.title = 'Ubah nama & gambar kategori';
      editBtn.style.cssText = 'border:none;background:none;padding:5px 5px;font-size:12px;cursor:pointer;color:#64748b;';
      editBtn.textContent = '✏️';
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openBranchCategoryEditModal(cat);
      });
      chip.appendChild(editBtn);

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.draggable = false;
      delBtn.title = 'Hapus kategori cabang';
      delBtn.style.cssText = 'border:none;background:none;padding:6px 10px 6px 4px;font-size:12px;cursor:pointer;color:#ef4444;opacity:0.8;';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteBMBranchCategory(cat.id, cat.name);
      });
      chip.appendChild(delBtn);

      // Drag and drop ordering
      chip.addEventListener('dragstart', function (e) {
        _dragSrcCatId = cat.id;
        _dragSrcEl = chip;
        chip.style.cursor = 'grabbing';
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', cat.id);
        setTimeout(function () {
          chip.style.opacity = '0.4';
          chip.style.transform = 'scale(0.96)';
        }, 0);
      });

      chip.addEventListener('dragend', function () {
        chip.style.opacity = '1';
        chip.style.cursor = 'grab';
        chip.style.transform = '';
        bar.querySelectorAll('[data-cat-id]').forEach(function (el) {
          el.style.borderLeft = '';
          el.style.borderRight = '';
          el.style.boxShadow = '';
        });
      });

      chip.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (chip !== _dragSrcEl) {
          var rect = chip.getBoundingClientRect();
          var midX = rect.left + rect.width / 2;
          if (e.clientX < midX) {
            chip.style.borderLeft = '3px solid var(--x-primary,#10b981)';
            chip.style.borderRight = '';
          } else {
            chip.style.borderLeft = '';
            chip.style.borderRight = '3px solid var(--x-primary,#10b981)';
          }
        }
      });

      chip.addEventListener('dragleave', function () {
        chip.style.borderLeft = '';
        chip.style.borderRight = '';
      });

      chip.addEventListener('drop', function (e) {
        e.preventDefault();
        chip.style.borderLeft = '';
        chip.style.borderRight = '';
        if (!_dragSrcCatId || _dragSrcCatId === cat.id || !_dragSrcEl) return;

        var rect = chip.getBoundingClientRect();
        var midX = rect.left + rect.width / 2;
        var insertBefore = e.clientX < midX;

        if (insertBefore) {
          bar.insertBefore(_dragSrcEl, chip);
        } else {
          bar.insertBefore(_dragSrcEl, chip.nextSibling);
        }

        var newOrder = Array.from(bar.querySelectorAll('[data-cat-id]')).map(function (el) {
          return el.dataset.catId;
        });

        saveBMBranchCategoryOrder(newOrder);
      });

      bar.appendChild(chip);
    });
  }

  async function saveBMBranchCategoryOrder(orderedIds) {
    var branchId = getBMTargetBranchId();
    if (!branchId) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/categories/reorder', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ order: orderedIds })
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Urutan kategori cabang disimpan.');
        if (_bmMenuState.categories) {
          var catMap = {};
          _bmMenuState.categories.forEach(function (c) { catMap[c.id] = c; });
          _bmMenuState.categories = orderedIds.map(function (id) { return catMap[id]; }).filter(Boolean);
        }
      } else {
        showToast('❌ ' + (data.error || 'Gagal menyimpan urutan kategori.'));
        loadBMMenu();
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan saat menyimpan urutan.');
      loadBMMenu();
    }
  }

  window.promptAddBMBranchCategory = function () {
    var branchId = getBMTargetBranchId();
    if (!branchId) {
      showToast('❌ Cabang tidak valid atau belum dipilih.');
      return;
    }
    currentManagingBranchId = branchId;
    openBranchCategoryCreateModal();
  };

  window.deleteBMBranchCategory = async function (catId, catName) {
    if (!confirm('Hapus kategori "' + catName + '"? Produk di kategori ini tidak akan dihapus, hanya dipindah ke tanpa kategori.')) return;

    var branchId = getBMTargetBranchId();
    if (!branchId) return;
    currentManagingBranchId = branchId;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/categories/' + encodeURIComponent(catId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Kategori cabang berhasil dihapus.');
        if (String(_bmMenuState.categoryFilter) === String(catId)) _bmMenuState.categoryFilter = 'all';
        loadBMMenu();
      } else {
        showToast('❌ ' + (data.error || 'Gagal menghapus kategori.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };

  function renderBMMenuTable() {
    var tbody = $('bm-menu-tbody');
    if (!tbody) return;

    var filtered = (_bmMenuState.products || []).filter(function (p) {
      var name = (p.product_name || p.name || '').toLowerCase();
      var matchesSearch = !_bmMenuState.searchQuery || name.indexOf(_bmMenuState.searchQuery) !== -1;
      if (!matchesSearch) return false;

      var isAvail = (p.is_available === 1 || p.is_available === true);
      if (_bmMenuState.statusFilter === 'available' && !isAvail) return false;
      if (_bmMenuState.statusFilter === 'unavailable' && isAvail) return false;

      if (_bmMenuState.categoryFilter && _bmMenuState.categoryFilter !== 'all') {
        var pCatIds = Array.isArray(p.category_ids) && p.category_ids.length > 0
          ? p.category_ids.map(String)
          : (p.branch_category_id ? [String(p.branch_category_id)] : []);
        if (pCatIds.indexOf(String(_bmMenuState.categoryFilter)) === -1) return false;
      }

      return true;
    });

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-muted">Tidak ada produk yang sesuai dengan kriteria filter.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (p) {
      var isAvail = (p.is_available === 1 || p.is_available === true);
      var isMasterActive = (p.is_master_active === 1 || p.is_master_active === true || p.is_master_active === undefined);

      var branchStatusBadge = isAvail
        ? '<span class="x-badge x-badge-success" style="font-size:11px;">TERSEDIA</span>'
        : '<span class="x-badge x-badge-danger" style="font-size:11px;">HABIS (OFF)</span>';

      var masterStatusBadge = isMasterActive
        ? '<span class="x-badge" style="font-size:10px; background:#f1f5f9; color:#475569;">AKTIF (BRAND)</span>'
        : '<span class="x-badge x-badge-danger" style="font-size:10px;">NONAKTIF (BRAND)</span>';

      var toggleBtn = '<label class="x-toggle' + (isAvail ? ' x-toggle-on' : '') + '" title="' + (isAvail ? 'Menu tersedia' : 'Menu habis') + '">' +
        '<input type="checkbox" ' + (isAvail ? 'checked' : '') + ' onchange="toggleBMProductAvailability(\'' + esc(p.product_id) + '\', this.checked ? 1 : 0)" aria-label="Ubah ketersediaan menu cabang">' +
        '<span class="x-toggle-slider"></span>' +
      '</label>';

      var catBadges = (p.category_names && p.category_names.length)
        ? p.category_names.map(function (cn) { return '<span class="x-badge x-badge-info" style="font-size:10px; margin-right:4px;">' + esc(cn) + '</span>'; }).join('')
        : (p.branch_category_name ? '<span class="x-badge x-badge-info" style="font-size:10px;">' + esc(p.branch_category_name) + '</span>' : '<span class="text-muted" style="font-size:11px;">—</span>');

      var productDataJson = esc(JSON.stringify({
        product_id: p.product_id,
        name: p.product_name || p.name,
        price: p.price,
        master_price: p.master_price || p.price,
        pricing_mode: p.pricing_mode || 'lock',
        min_price: p.min_price,
        max_price: p.max_price,
        branch_category_id: p.branch_category_id,
        category_ids: p.category_ids || (p.branch_category_id ? [p.branch_category_id] : []),
        categories: p.categories || []
      }));

      return '<tr>' +
        '<td><strong>' + esc(p.product_name || p.name) + '</strong></td>' +
        '<td>' + catBadges + '</td>' +
        '<td>' + formatMoney(p.price) + '</td>' +
        '<td><strong>' + esc(p.stock != null ? p.stock : '—') + '</strong></td>' +
        '<td>' + branchStatusBadge + '</td>' +
        '<td>' + masterStatusBadge + '</td>' +
        '<td style="text-align:right; white-space:nowrap;">' +
          '<div style="display:inline-flex; align-items:center; gap:8px;">' +
            toggleBtn +
            '<button type="button" class="x-action-menu-trigger" aria-label="Aksi menu ' + esc(p.product_name || p.name) + '" onclick="XentraActionMenu.open(this, [' +
              '{ label: \'Edit Menu / Kategori Cabang\', icon: \'✏️\', onClick: function() { openBranchOverrideModal(\'' + productDataJson + '\'); } },' +
              '{ divider: true },' +
              '{ label: \'Hapus dari Cabang\', icon: \'🗑️\', destructive: true, onClick: function() { removeBMBranchProduct(\'' + esc(p.product_id) + '\', \'' + esc(p.product_name || p.name) + '\'); } }' +
            '])">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  async function toggleBMProductAvailability(productId, nextVal) {
    var branchId = getBMTargetBranchId();
    if (!branchId) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/products/' + encodeURIComponent(productId), {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_available: nextVal })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast(nextVal === 1 ? 'Produk berhasil ditandai Tersedia.' : 'Produk ditandai Habis.');
        loadBMMenu();
      } else {
        showToast('Gagal mengubah ketersediaan: ' + (data.error || 'Terjadi kesalahan'));
        loadBMMenu();
      }
    } catch (e) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.toggleBMProductAvailability = toggleBMProductAvailability;

  window.removeBMBranchProduct = async function (productId, productName) {
    var branchId = getBMTargetBranchId();
    if (!branchId) return;

    if (!confirm('Hapus "' + productName + '" dari katalog cabang ini? Menu tidak akan lagi tampil di halaman pemesanan pelanggan.')) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/products/' + encodeURIComponent(productId), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('✅ Produk berhasil dihapus dari cabang.');
        loadBMMenu();
      } else {
        showToast('❌ ' + (data.error || 'Gagal menghapus produk.'));
      }
    } catch (err) {
      showToast('❌ Kesalahan jaringan.');
    }
  };

  /* Modal Pick Available Master Products to Adopt (BM Phase 4B) */
  window.openBMAddCatalogModal = async function () {
    var modal = $('modal-bm-add-catalog');
    if (!modal) return;

    _bmMenuState.addCatalogSearchQuery = '';
    _bmMenuState.selectedCatalogProductIds = new Set();
    var searchInput = $('bm-add-catalog-search');
    if (searchInput) searchInput.value = '';

    updateBMAddCatalogFooter();

    var container = $('bm-add-catalog-list');
    if (container) {
      container.innerHTML = '<div style="padding:32px 16px; text-align:center; color:#64748b; font-size:13px;">' +
        '<div style="font-size:24px; margin-bottom:8px;">⏳</div>' +
        '<div>Memuat katalog produk master...</div>' +
      '</div>';
    }
    modal.style.display = 'flex';

    var branchId = getBMTargetBranchId();
    if (!branchId) {
      if (container) container.innerHTML = '<div style="padding:24px; text-align:center; color:#dc2626; font-size:13px;">Cabang tidak teridentifikasi. Pastikan Anda telah memilih atau ditugaskan ke cabang.</div>';
      return;
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/catalog', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success) {
        currentBranchCatalogData = data;
        _bmMenuState.availableProducts = data.available_master_products || [];

        // Distinguish between already adopted and available master products
        var unadopted = (data.available_master_products || []).map(function (p) {
          return Object.assign({}, p, { is_adopted: false });
        });

        var adopted = (data.adopted_products || []).map(function (ap) {
          return {
            id: ap.product_id,
            name: ap.name,
            price: ap.price,
            master_price: ap.master_price,
            image_url: ap.image_url,
            pricing_mode: ap.pricing_mode,
            min_price: ap.min_price,
            max_price: ap.max_price,
            description: ap.description,
            is_adopted: true
          };
        });

        // Unadopted first, then adopted marked
        _bmMenuState.allCatalogProducts = unadopted.concat(adopted);

        // Populate branch categories target dropdown
        var catSelect = $('bm-add-catalog-target-category');
        if (catSelect) {
          var branchCats = data.categories || (_bmMenuState && _bmMenuState.categories) || [];
          var opts = ['<option value="">Otomatis / Menu Utama</option>'];
          branchCats.forEach(function (c) {
            opts.push('<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>');
          });
          catSelect.innerHTML = opts.join('');
        }

        renderBMAddCatalogList();
      } else {
        if (container) {
          container.innerHTML = '<div style="padding:24px; text-align:center; color:#dc2626; font-size:13px;">Gagal memuat katalog: ' + esc(data.error || 'Terjadi kesalahan') + '</div>';
        }
      }
    } catch (err) {
      console.warn('[BM Add Catalog Load Error]:', err);
      if (container) {
        container.innerHTML = '<div style="padding:24px; text-align:center; color:#dc2626; font-size:13px;">Kesalahan jaringan saat memuat katalog master.</div>';
      }
    }
  };

  window.closeBMAddCatalogModal = function () {
    var modal = $('modal-bm-add-catalog');
    if (modal) modal.style.display = 'none';
  };

  window.toggleBMAddCatalogSelectAll = function (isChecked) {
    if (!_bmMenuState.selectedCatalogProductIds) _bmMenuState.selectedCatalogProductIds = new Set();
    var all = _bmMenuState.allCatalogProducts || [];
    var q = (_bmMenuState.addCatalogSearchQuery || '').toLowerCase();
    var filtered = all.filter(function (p) {
      if (!q) return true;
      return (p.name || '').toLowerCase().indexOf(q) !== -1 || (p.description || '').toLowerCase().indexOf(q) !== -1;
    });

    filtered.forEach(function (p) {
      if (p.is_adopted) return;
      var pid = String(p.id);
      if (isChecked) {
        _bmMenuState.selectedCatalogProductIds.add(pid);
      } else {
        _bmMenuState.selectedCatalogProductIds.delete(pid);
      }
      var card = $('catalog-pick-card-' + pid);
      if (card) {
        if (isChecked) card.classList.add('is-selected');
        else card.classList.remove('is-selected');
      }
      var cb = $('catalog-pick-cb-' + pid);
      if (cb) cb.checked = isChecked;
    });

    updateBMAddCatalogFooter();
  };

  window.onBMAddCatalogFilterChange = function () {
    var searchInput = $('bm-add-catalog-search');
    if (searchInput) _bmMenuState.addCatalogSearchQuery = searchInput.value.trim().toLowerCase();
    renderBMAddCatalogList();
  };

  window.onBMSelectCatalogProduct = function (productId, isChecked) {
    if (!_bmMenuState.selectedCatalogProductIds) _bmMenuState.selectedCatalogProductIds = new Set();
    var pid = String(productId);
    if (isChecked) {
      _bmMenuState.selectedCatalogProductIds.add(pid);
    } else {
      _bmMenuState.selectedCatalogProductIds.delete(pid);
    }
    var card = $('catalog-pick-card-' + pid);
    if (card) {
      if (isChecked) card.classList.add('is-selected');
      else card.classList.remove('is-selected');
    }
    updateBMAddCatalogFooter();
  };

  window.toggleBMSelectCatalogProduct = function (productId) {
    var pid = String(productId);
    var checkbox = $('catalog-pick-cb-' + pid);
    if (!checkbox || checkbox.disabled) return;
    checkbox.checked = !checkbox.checked;
    window.onBMSelectCatalogProduct(pid, checkbox.checked);
  };

  function updateBMAddCatalogFooter() {
    var count = (_bmMenuState.selectedCatalogProductIds && _bmMenuState.selectedCatalogProductIds.size) || 0;
    var countEl = $('bm-add-catalog-count');
    if (countEl) {
      countEl.textContent = count + ' produk dipilih';
    }
    var submitBtn = $('btn-bm-submit-adopt-catalog');
    if (submitBtn) {
      submitBtn.disabled = count === 0;
      submitBtn.textContent = count > 0 ? ('Tambahkan (' + count + ') Menu') : 'Tambahkan Menu';
    }

    // Sync select-all checkbox state
    var selectAllCb = $('bm-add-catalog-select-all');
    if (selectAllCb) {
      var all = _bmMenuState.allCatalogProducts || [];
      var unadopted = all.filter(function (p) { return !p.is_adopted; });
      if (unadopted.length > 0 && count >= unadopted.length) {
        selectAllCb.checked = true;
      } else {
        selectAllCb.checked = false;
      }
    }
  }

  function renderBMAddCatalogList() {
    var container = $('bm-add-catalog-list');
    if (!container) return;

    var all = _bmMenuState.allCatalogProducts || [];
    var q = (_bmMenuState.addCatalogSearchQuery || '').toLowerCase();
    var filtered = all.filter(function (p) {
      if (!q) return true;
      return (p.name || '').toLowerCase().indexOf(q) !== -1 || (p.description || '').toLowerCase().indexOf(q) !== -1;
    });

    if (!filtered.length) {
      container.innerHTML = '<div style="background:#f8fafc; border:1px dashed #cbd5e1; border-radius:8px; padding:28px; text-align:center; color:#64748b; font-size:13px;">' +
        (q ? 'Tidak ada produk master yang sesuai dengan pencarian "' + esc(q) + '".' : 'Belum ada produk master yang tersedia untuk brand ini.') +
      '</div>';
      updateBMAddCatalogFooter();
      return;
    }

    var selectedSet = _bmMenuState.selectedCatalogProductIds || new Set();

    container.innerHTML = filtered.map(function (p) {
      var pid = String(p.id);
      var img = p.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100';
      var isRange = p.pricing_mode === 'range';
      var modeBadge = isRange
        ? '<span class="x-badge x-badge-range" style="font-size:11px;">Range (' + formatMoney(p.min_price) + ' - ' + formatMoney(p.max_price) + ')</span>'
        : '<span class="x-badge x-badge-lock" style="font-size:11px;">Harga Terkunci</span>';

      if (p.is_adopted) {
        return '<div class="x-catalog-picker-card is-adopted" id="catalog-pick-card-' + esc(pid) + '">' +
          '<div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">' +
            '<img src="' + esc(img) + '" style="width:44px; height:44px; border-radius:6px; object-fit:cover; flex-shrink:0; border:1px solid #e2e8f0;" alt="">' +
            '<div style="min-width:0; flex:1;">' +
              '<div style="font-weight:700; font-size:13.5px; color:#334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(p.name) + '</div>' +
              '<div style="display:flex; gap:6px; align-items:center; margin-top:2px; flex-wrap:wrap;">' +
                '<span style="font-size:12px; font-weight:700; color:#64748b;">' + formatMoney(p.price || p.master_price) + '</span>' +
                modeBadge +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">' +
            '<span class="x-badge x-badge-success" style="font-size:11px; padding:4px 10px;">✓ Sudah Diadopsi</span>' +
          '</div>' +
        '</div>';
      }

      var isSelected = selectedSet.has(pid);
      return '<div class="x-catalog-picker-card' + (isSelected ? ' is-selected' : '') + '" id="catalog-pick-card-' + esc(pid) + '" onclick="toggleBMSelectCatalogProduct(\'' + esc(pid) + '\')">' +
        '<div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">' +
          '<input type="checkbox" class="x-catalog-picker-checkbox" id="catalog-pick-cb-' + esc(pid) + '" ' + (isSelected ? 'checked' : '') + ' onclick="event.stopPropagation(); onBMSelectCatalogProduct(\'' + esc(pid) + '\', this.checked)">' +
          '<img src="' + esc(img) + '" style="width:44px; height:44px; border-radius:6px; object-fit:cover; flex-shrink:0; border:1px solid #e2e8f0;" alt="">' +
          '<div style="min-width:0; flex:1;">' +
            '<div style="font-weight:700; font-size:13.5px; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(p.name) + '</div>' +
            '<div style="display:flex; gap:6px; align-items:center; margin-top:2px; flex-wrap:wrap;">' +
              '<span style="font-size:12px; font-weight:700; color:var(--text-main);">' + formatMoney(p.price) + '</span>' +
              modeBadge +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">' +
          '<span style="font-size:12px; font-weight:600; color:' + (isSelected ? '#2563eb' : '#64748b') + ';">' + (isSelected ? '✓ Terpilih' : 'Pilih') + '</span>' +
        '</div>' +
      '</div>';
    }).join('');

    updateBMAddCatalogFooter();
  }

  window.submitBMAdoptCatalogBatch = async function () {
    var branchId = getBMTargetBranchId();
    if (!branchId) {
      showToast('❌ Cabang tidak valid atau belum dipilih.');
      return;
    }

    var selectedSet = _bmMenuState.selectedCatalogProductIds;
    if (!selectedSet || selectedSet.size === 0) {
      showToast('⚠️ Pilih minimal 1 produk master untuk diadopsi.');
      return;
    }

    var targetCatSelect = $('bm-add-catalog-target-category');
    var targetCatId = targetCatSelect ? targetCatSelect.value : '';

    var btn = $('btn-bm-submit-adopt-catalog');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Menambahkan...';
    }

    var pids = Array.from(selectedSet);
    var successCount = 0;
    var errorCount = 0;
    var lastError = '';

    for (var i = 0; i < pids.length; i++) {
      var pid = pids[i];
      try {
        var adoptPayload = { product_id: pid };
        if (targetCatId) {
          adoptPayload.branch_category_id = targetCatId;
          adoptPayload.category_ids = [targetCatId];
        }

        var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/adopt', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(adoptPayload)
        });
        var data = await res.json();
        if (res.ok && data.success) {
          successCount++;
        } else {
          errorCount++;
          lastError = data.message || data.error || 'Gagal mengadopsi';
        }
      } catch (e) {
        errorCount++;
        lastError = 'Kesalahan jaringan';
      }
    }

    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Tambahkan Menu';
    }

    if (successCount > 0) {
      showToast('✅ Berhasil menambahkan ' + successCount + ' menu ke cabang!');
      closeBMAddCatalogModal();
      if (typeof loadBMMenu === 'function') await loadBMMenu();
      if (typeof loadInlineBranchCatalog === 'function') loadInlineBranchCatalog();
    } else {
      showToast('❌ ' + (lastError || 'Gagal mengadopsi produk terpilih.'));
    }
  };

  /* =========================================================================
     BM-3: STOK & INVENTARIS OPERATIONAL CONTROLLER
     ========================================================================= */
  async function loadBMStock() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var tbody = $('bm-stock-tbody');
    if (tbody && (!_bmStockState.inventory || !_bmStockState.inventory.length)) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Memuat inventaris cabang...</td></tr>';
    }

    var currentSeq = ++_bmStockState.fetchSeq;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/inventory', {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (currentSeq !== _bmStockState.fetchSeq) return;

      if (res.ok && data.success && Array.isArray(data.inventory)) {
        _bmStockState.inventory = data.inventory;
        updateBMStockStats(data.inventory);
        renderBMStockTable();
      } else {
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Gagal memuat inventaris: ' + esc(data.error || 'Terjadi kesalahan') + '</td></tr>';
        }
      }
    } catch (err) {
      if (currentSeq !== _bmStockState.fetchSeq) return;
      console.warn('[BM Stock Load Error]:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat inventaris.</td></tr>';
      }
    }
  }
  window.loadBMStock = loadBMStock;

  function updateBMStockStats(items) {
    var total = (items || []).length;
    var outOfStock = (items || []).filter(function (it) { return Number(it.stock) <= 0; }).length;
    var lowStock = (items || []).filter(function (it) {
      var s = Number(it.stock);
      var th = Number(it.low_stock_threshold || 5);
      return s > 0 && s <= th;
    }).length;
    var safeStock = total - outOfStock - lowStock;

    if ($('bm-stock-stat-total')) $('bm-stock-stat-total').textContent = total;
    if ($('bm-stock-stat-safe')) $('bm-stock-stat-safe').textContent = safeStock;
    if ($('bm-stock-stat-low')) $('bm-stock-stat-low').textContent = lowStock;
    if ($('bm-stock-stat-out')) $('bm-stock-stat-out').textContent = outOfStock;
  }

  function onBMStockFilterChange() {
    var searchEl = $('bm-stock-search');
    var filterEl = $('bm-stock-filter-status');
    if (searchEl) _bmStockState.searchQuery = searchEl.value.trim().toLowerCase();
    if (filterEl) _bmStockState.statusFilter = filterEl.value;
    renderBMStockTable();
  }
  window.onBMStockFilterChange = onBMStockFilterChange;

  function renderBMStockTable() {
    var tbody = $('bm-stock-tbody');
    if (!tbody) return;

    var filtered = (_bmStockState.inventory || []).filter(function (it) {
      var name = (it.product_name || '').toLowerCase();
      var matchesSearch = !_bmStockState.searchQuery || name.indexOf(_bmStockState.searchQuery) !== -1;
      if (!matchesSearch) return false;

      var s = Number(it.stock);
      var th = Number(it.low_stock_threshold || 5);
      if (_bmStockState.statusFilter === 'out') return s <= 0;
      if (_bmStockState.statusFilter === 'low') return s > 0 && s <= th;
      if (_bmStockState.statusFilter === 'safe') return s > th;
      return true;
    });

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Tidak ada item inventaris yang sesuai kriteria filter.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (it) {
      var s = Number(it.stock);
      var th = Number(it.low_stock_threshold || 5);

      var badge = '';
      if (s <= 0) {
        badge = '<span class="x-badge x-badge-danger" style="font-size:11px;">HABIS (0)</span>';
      } else if (s <= th) {
        badge = '<span class="x-badge x-badge-warning" style="font-size:11px;">MENIPIS (&le; ' + th + ')</span>';
      } else {
        badge = '<span class="x-badge x-badge-success" style="font-size:11px;">AMAN</span>';
      }

      return '<tr>' +
        '<td><strong>' + esc(it.product_name) + '</strong></td>' +
        '<td>' + formatMoney(it.price) + '</td>' +
        '<td><strong style="font-size:14px;">' + s + '</strong></td>' +
        '<td><span class="text-muted">' + th + '</span></td>' +
        '<td>' + badge + '</td>' +
        '<td style="text-align:right;">' +
          '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 10px;" onclick="openBMStockAdjustmentModal(\'' + esc(it.product_id) + '\')">Sesuaikan Stok</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  function openBMStockAdjustmentModal(productId) {
    var item = (_bmStockState.inventory || []).find(function (it) { return it.product_id === productId; });
    if (!item) return;

    var modal = $('modal-bm-stock-adjust');
    if (!modal) return;

    if ($('bm-adjust-product-id')) $('bm-adjust-product-id').value = item.product_id;
    if ($('bm-adjust-product-name')) $('bm-adjust-product-name').textContent = item.product_name;
    if ($('bm-adjust-current-stock')) $('bm-adjust-current-stock').textContent = item.stock;

    var selectType = $('bm-adjust-movement-type');
    if (selectType) selectType.value = 'audit_adjustment';

    var qtyInput = $('bm-adjust-quantity');
    if (qtyInput) qtyInput.value = '';

    var notesInput = $('bm-adjust-notes');
    if (notesInput) notesInput.value = '';

    onBMAdjustTypeChange();
    modal.style.display = 'flex';
  }
  window.openBMStockAdjustmentModal = openBMStockAdjustmentModal;

  function closeBMStockAdjustModal() {
    var modal = $('modal-bm-stock-adjust');
    if (modal) modal.style.display = 'none';
  }
  window.closeBMStockAdjustModal = closeBMStockAdjustModal;

  function onBMAdjustTypeChange() {
    var selectType = $('bm-adjust-movement-type');
    var hint = $('bm-adjust-qty-hint');
    var qtyInput = $('bm-adjust-quantity');
    if (!selectType || !hint) return;

    if (selectType.value === 'waste_spoilage') {
      hint.textContent = 'Barang rusak/basi harus bernilai pengurangan negatif (misal: -3).';
      hint.style.color = '#dc2626';
      if (qtyInput && Number(qtyInput.value) > 0) {
        qtyInput.value = '-' + qtyInput.value;
      }
    } else {
      hint.textContent = 'Gunakan angka positif untuk menambah, negatif untuk mengurangi.';
      hint.style.color = 'var(--text-muted)';
    }
  }
  window.onBMAdjustTypeChange = onBMAdjustTypeChange;

  async function submitBMStockAdjustment(e) {
    if (e) e.preventDefault();
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var productId = $('bm-adjust-product-id') ? $('bm-adjust-product-id').value : '';
    var movementType = $('bm-adjust-movement-type') ? $('bm-adjust-movement-type').value : '';
    var qty = $('bm-adjust-quantity') ? Number($('bm-adjust-quantity').value) : NaN;
    var notes = $('bm-adjust-notes') ? $('bm-adjust-notes').value.trim() : '';

    if (!productId || isNaN(qty) || qty === 0) {
      showToast('Masukkan jumlah penyesuaian yang valid (bukan 0).');
      return;
    }

    if (movementType === 'waste_spoilage' && qty > 0) {
      showToast('Barang rusak (waste_spoilage) hanya menerima pengurangan stok (angka negatif).');
      return;
    }

    var submitBtn = $('btn-bm-submit-adjust');
    if (submitBtn) submitBtn.disabled = true;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId) + '/inventory/' + encodeURIComponent(productId), {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          movement_type: movementType,
          quantity: qty,
          notes: notes
        })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Stok operasional berhasil diperbarui!');
        closeBMStockAdjustModal();
        loadBMStock();
      } else {
        showToast('Gagal menyesuaikan stok: ' + (data.message || data.error || 'Terjadi kesalahan'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }
  window.submitBMStockAdjustment = submitBMStockAdjustment;

  /* =========================================================================
     BM-3: PROMOSI OPERATIONAL CONTROLLER
     ========================================================================= */
  async function loadBMPromotions() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;

    var listContainer = $('bm-promo-list');
    var redemptionsTbody = $('bm-promo-redemptions-tbody');

    if (listContainer && (!_bmPromoState.promotions || !_bmPromoState.promotions.length)) {
      listContainer.innerHTML = '<div class="text-center py-6 text-muted">Memuat promosi...</div>';
    }
    if (redemptionsTbody && (!_bmPromoState.redemptions || !_bmPromoState.redemptions.length)) {
      redemptionsTbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-muted">Memuat riwayat penebusan...</td></tr>';
    }

    var currentSeq = ++_bmPromoState.fetchSeq;

    try {
      var pRes = await adminFetch(API_BASE + '/admin/marketing/promotions', { headers: getAuthHeaders() });
      var pData = await pRes.json();

      var rUrl = API_BASE + '/admin/marketing/redemptions' + (branchId ? ('?branch_id=' + encodeURIComponent(branchId)) : '');
      var rRes = await adminFetch(rUrl, { headers: getAuthHeaders() });
      var rData = await rRes.json();

      if (currentSeq !== _bmPromoState.fetchSeq) return;

      var promos = (pRes.ok && pData.success && Array.isArray(pData.promotions)) ? pData.promotions : [];
      var redemptions = (rRes.ok && rData.success && Array.isArray(rData.redemptions)) ? rData.redemptions : [];

      _bmPromoState.promotions = promos;
      _bmPromoState.redemptions = redemptions;

      updateBMPromoStats(promos, redemptions);
      renderBMPromotionsList(promos);
      renderBMRedemptionsTable(redemptions);

    } catch (err) {
      if (currentSeq !== _bmPromoState.fetchSeq) return;
      console.warn('[BM Promo Load Error]:', err);
      if (listContainer) listContainer.innerHTML = '<div class="text-center py-6 text-danger">Kesalahan jaringan saat memuat promosi.</div>';
      if (redemptionsTbody) redemptionsTbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-danger">Kesalahan jaringan.</td></tr>';
    }
  }
  window.loadBMPromotions = loadBMPromotions;

  function updateBMPromoStats(promos, redemptions) {
    var activeCount = (promos || []).filter(function (p) { return p.is_active === 1 || p.is_active === true; }).length;
    var totalRedemptions = (redemptions || []).length;
    var totalDiscount = (redemptions || []).reduce(function (acc, r) {
      return acc + (Number(r.benefit_amount || r.discount_amount || r.discount_applied) || 0);
    }, 0);

    if ($('bm-promo-stat-active')) $('bm-promo-stat-active').textContent = activeCount;
    if ($('bm-promo-stat-redemptions')) $('bm-promo-stat-redemptions').textContent = totalRedemptions;
    if ($('bm-promo-stat-discount-given')) $('bm-promo-stat-discount-given').textContent = formatMoney(totalDiscount);
  }

  function renderBMPromotionsList(promos) {
    var container = $('bm-promo-list');
    if (!container) return;

    if (!promos || !promos.length) {
      container.innerHTML = '<div class="text-center py-6 text-muted">Belum ada promosi aktif dari Brand untuk cabang ini.</div>';
      return;
    }

    var now = new Date().toISOString();

    container.innerHTML = promos.map(function (p) {
      // Branch-level activation state
      var isBranchActive = p.branch_is_active !== undefined ? (p.branch_is_active === 1 || p.branch_is_active === true) : (p.is_active === 1 || p.is_active === true);
      var isBrandActive = (p.is_active === 1 || p.is_active === true);

      // Operational Status derivation
      var statusBadge = '';
      var canToggle = true;

      if (!isBrandActive) {
        statusBadge = '<span class="x-badge" style="background:#f1f5f9;color:#64748b;font-size:11px;">NONAKTIF (BRAND)</span>';
        canToggle = false;
      } else if (p.end_at && p.end_at < now) {
        statusBadge = '<span class="x-badge" style="background:#fee2e2;color:#991b1b;font-size:11px;">KADALUARSA</span>';
        canToggle = false;
      } else if (p.start_at && p.start_at > now) {
        statusBadge = '<span class="x-badge" style="background:#fef3c7;color:#92400e;font-size:11px;">TERJADWAL</span>';
      } else if (isBranchActive) {
        statusBadge = '<span class="x-badge x-badge-success" style="font-size:11px;font-weight:700;">AKTIF DI CABANG</span>';
      } else {
        statusBadge = '<span class="x-badge" style="background:#f1f5f9;color:#475569;font-size:11px;">NONAKTIF (CABANG)</span>';
      }

      // Action button
      var actionBtnHtml = '';
      if (canToggle) {
        if (isBranchActive) {
          actionBtnHtml = '<button type="button" class="x-btn-secondary" onclick="toggleBMPromoActivation(\'' + esc(p.id) + '\', 0, this)" style="padding:5px 12px;font-size:12px;color:#dc2626;border-color:#fca5a5;">Nonaktifkan di Cabang</button>';
        } else {
          actionBtnHtml = '<button type="button" class="x-btn-primary" onclick="toggleBMPromoActivation(\'' + esc(p.id) + '\', 1, this)" style="padding:5px 12px;font-size:12px;">Aktifkan di Cabang</button>';
        }
      } else {
        actionBtnHtml = '<span style="font-size:11px;color:#94a3b8;font-style:italic;">Dikelola Pusat</span>';
      }

      // Rewards summary text
      var rewardText = '';
      if (Array.isArray(p.rewards) && p.rewards.length > 0) {
        var rw = p.rewards[0];
        rewardText = (rw.reward_type === 'freebie_product' ? 'Gratis: ' : '') + (rw.target_product_name || rw.target_product_id || 'Produk Promo');
      } else if (p.discount_type) {
        rewardText = p.discount_type === 'percentage' ? (p.discount_value + '%') : formatMoney(p.discount_value);
      } else {
        rewardText = 'Insentif Promo';
      }

      var promoCode = p.code || p.promo_code;

      return '<div class="x-card" style="padding:14px 16px; border:1px solid var(--border-color); border-radius:8px; background:#ffffff;">' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">' +
          '<div>' +
            '<strong style="font-size:15px; color:var(--text-main);">' + esc(p.name || p.title || 'Promosi') + '</strong>' +
            (promoCode ? ('<div style="font-size:12px; margin-top:3px;">Kode: <code style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-weight:700;">' + esc(promoCode) + '</code></div>') : '') +
          '</div>' +
          statusBadge +
        '</div>' +
        (p.description ? ('<p style="font-size:12px; color:var(--text-muted); margin:4px 0 8px;">' + esc(p.description) + '</p>') : '') +
        '<div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; border-top:1px dashed var(--border-color); padding-top:10px; margin-top:8px;">' +
          '<div>Benefit: <strong style="color:var(--accent-teal);">' + esc(rewardText) + '</strong></div>' +
          actionBtnHtml +
        '</div>' +
      '</div>';
    }).join('');
  }

  async function toggleBMPromoActivation(promoId, newStatus, btnEl) {
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = 'Memproses...';
    }

    try {
      var res = await adminFetch('/api/v1/admin/marketing/promotions/' + encodeURIComponent(promoId) + '/branch-activation', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: newStatus })
      });
      var json = await res.json();
      if (!res.ok || !json.success) throw new Error((json && json.error) || 'Gagal mengubah status aktivasi promo di cabang.');

      showToast(newStatus === 1 ? 'Promo berhasil diaktifkan untuk operasional cabang ini.' : 'Promo berhasil dinonaktifkan di cabang ini.');
      loadBMPromotions();
    } catch (err) {
      console.error('[BM Promo Toggle Error]:', err);
      showToast(err.message || 'Gagal mengubah status promosi.');
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.textContent = newStatus === 1 ? 'Aktifkan di Cabang' : 'Nonaktifkan di Cabang';
      }
    }
  }
  window.toggleBMPromoActivation = toggleBMPromoActivation;

  function renderBMRedemptionsTable(redemptions) {
    var tbody = $('bm-promo-redemptions-tbody');
    if (!tbody) return;

    if (!redemptions || !redemptions.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-muted">Belum ada penebusan promo di cabang ini.</td></tr>';
      return;
    }

    tbody.innerHTML = redemptions.slice(0, 10).map(function (r) {
      var time = (r.redeemed_at || r.created_at || '').substring(0, 16).replace('T', ' ') || '—';
      var discountVal = Number(r.benefit_amount || r.discount_amount || r.discount_applied) || 0;
      return '<tr>' +
        '<td><strong>' + esc(r.order_number || r.order_id) + '</strong></td>' +
        '<td><code>' + esc(r.promo_code || r.promotion_name || 'Promo') + '</code></td>' +
        '<td><strong style="color:var(--accent-teal);">' + formatMoney(discountVal) + '</strong></td>' +
        '<td style="font-size:12px; color:var(--text-muted);">' + time + '</td>' +
      '</tr>';
    }).join('');
  }

  /* =========================================================================
     BM-4: STAF OPERASIONAL CABANG (BRANCH-SCOPED WORKFORCE)
     ========================================================================= */
  var _bmStaffState = {
    users: [],
    fetchSeq: 0
  };

  async function loadBMStaff() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var tbody = $('bm-staff-tbody');
    if (tbody && (!_bmStaffState.users || !_bmStaffState.users.length)) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Memuat daftar staf cabang...</td></tr>';
    }

    var currentSeq = ++_bmStaffState.fetchSeq;

    try {
      var res = await adminFetch(API_BASE + '/admin/users?limit=100&branch_id=' + encodeURIComponent(branchId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (currentSeq !== _bmStaffState.fetchSeq) return;

      if (res.ok && data.success && Array.isArray(data.users)) {
        _bmStaffState.users = data.users;
        renderBMStaffTable(data.users);
      } else {
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Gagal memuat staf cabang: ' + esc(data.error || 'Terjadi kesalahan') + '</td></tr>';
        }
      }
    } catch (err) {
      if (currentSeq !== _bmStaffState.fetchSeq) return;
      console.warn('[BM Staff Load Error]:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat staf.</td></tr>';
      }
    }
  }
  window.loadBMStaff = loadBMStaff;

  function renderBMStaffTable(users) {
    var tbody = $('bm-staff-tbody');
    if (!tbody) return;

    var totalCount = (users || []).length;
    var activeCount = (users || []).filter(function (u) { return u.status === 'active'; }).length;
    var inactiveCount = totalCount - activeCount;

    if ($('bm-staff-stat-total')) $('bm-staff-stat-total').textContent = totalCount;
    if ($('bm-staff-stat-active')) $('bm-staff-stat-active').textContent = activeCount;
    if ($('bm-staff-stat-inactive')) $('bm-staff-stat-inactive').textContent = inactiveCount;

    if (!users || !users.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Belum ada staf kasir atau operasional terdaftar di cabang ini.</td></tr>';
      return;
    }

    var myId = (getStoredUser() || {}).id;

    tbody.innerHTML = users.map(function (u) {
      var isMe = u.id === myId;
      var isActive = u.status === 'active';
      var roleBadge = u.role === 'cashier'
        ? '<span class="x-badge x-badge-warning">KASIR</span>'
        : (u.role === 'kitchen' ? '<span class="x-badge" style="background:#ede9fe;color:#6d28d9;">DAPUR</span>' : '<span class="x-badge x-badge-info">' + esc(u.role).toUpperCase() + '</span>');

      var statusToggle = '' +
        '<label class="x-toggle' + (isActive ? ' x-toggle-on' : '') + '" style="margin:0 auto;display:inline-block;vertical-align:middle;">' +
          '<input type="checkbox" ' + (isActive ? 'checked ' : '') + (isMe ? 'disabled ' : '') +
            'onchange="toggleBMStaffStatus(\'' + u.id + '\', \'' + esc(u.full_name) + '\', this)">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      var actions = '';
      if (isMe) {
        actions = '<span class="text-muted" style="font-size:11px;">Akun Anda</span>';
      } else {
        actions = '<div style="display:flex; justify-content:flex-end; gap:6px;">' +
          '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="resetBMStaffPassword(\'' + u.id + '\', \'' + esc(u.full_name) + '\')">Reset Password</button>' +
        '</div>';
      }

      return '<tr>' +
        '<td><strong>' + esc(u.full_name) + '</strong></td>' +
        '<td><code style="font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px;">' + esc(u.username) + '</code></td>' +
        '<td>' + roleBadge + '</td>' +
        '<td style="color:var(--text-muted);">' + esc(u.email || '—') + '</td>' +
        '<td class="text-center" style="vertical-align:middle;text-align:center;">' + statusToggle + '</td>' +
        '<td class="text-right" style="white-space:nowrap;vertical-align:middle;">' + actions + '</td>' +
      '</tr>';
    }).join('');
  }

  function openBMAddCashierModal() {
    var modal = $('modal-bm-add-cashier');
    if (modal) {
      var form = $('form-bm-add-cashier');
      if (form) form.reset();
      modal.style.display = 'flex';
    }
  }
  window.openBMAddCashierModal = openBMAddCashierModal;

  function closeBMAddCashierModal() {
    var modal = $('modal-bm-add-cashier');
    if (modal) modal.style.display = 'none';
  }
  window.closeBMAddCashierModal = closeBMAddCashierModal;

  async function submitBMAddCashier(e) {
    if (e && e.preventDefault) e.preventDefault();
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) {
      showToast('Gagal: Sesi branch manager tidak valid.');
      return;
    }

    var fullName = ($('bm-cashier-fullname') ? $('bm-cashier-fullname').value : '').trim();
    var username = ($('bm-cashier-username') ? $('bm-cashier-username').value : '').trim();
    var password = ($('bm-cashier-password') ? $('bm-cashier-password').value : '').trim();
    var email = ($('bm-cashier-email') ? $('bm-cashier-email').value : '').trim();

    if (!fullName || !username || !password) {
      showToast('Harap lengkapi semua kolom wajib.');
      return;
    }

    var btn = $('btn-bm-submit-cashier');
    if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

    try {
      var res = await adminFetch(API_BASE + '/admin/users', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          full_name: fullName,
          username: username,
          password: password,
          email: email || undefined,
          role: 'cashier',
          branch_id: branchId
        })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Akun kasir ' + username + ' berhasil ditambahkan.');
        closeBMAddCashierModal();
        loadBMStaff();
      } else {
        showToast('Gagal menambahkan kasir: ' + (data.error || data.message || 'Terjadi kesalahan'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Simpan Akun'; }
    }
  }
  window.submitBMAddCashier = submitBMAddCashier;

  async function toggleBMStaffStatus(userId, name, inputElem) {
    var willActivate = inputElem ? inputElem.checked : false;
    var revert = function () {
      if (inputElem) {
        inputElem.checked = !willActivate;
        inputElem.disabled = false;
        var parentLabel = inputElem.closest('.x-toggle');
        if (parentLabel) {
          parentLabel.classList.toggle('x-toggle-on', !willActivate);
        }
      }
    };

    if (!willActivate) {
      if (!confirm('Nonaktifkan akun kasir "' + name + '"? Kasir ini tidak akan bisa login sampai diaktifkan kembali.')) {
        revert();
        return;
      }
    }

    if (inputElem) inputElem.disabled = true;

    try {
      var endpoint = willActivate ? '/enable' : '/disable';
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + endpoint, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Akun "' + name + '" berhasil ' + (willActivate ? 'diaktifkan.' : 'dinonaktifkan.'));
        loadBMStaff();
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
        revert();
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
      revert();
    }
  }
  window.toggleBMStaffStatus = toggleBMStaffStatus;

  async function resetBMStaffPassword(userId, name) {
    if (!confirm('Generate token reset password untuk kasir "' + name + '"? Token hanya dapat dilihat sekali.')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + '/reset-password', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success && data.reset_token) {
        if ($('reset-password-user-name')) $('reset-password-user-name').value = name;
        if ($('reset-password-token')) $('reset-password-token').value = data.reset_token;
        if ($('modal-reset-password')) $('modal-reset-password').style.display = 'flex';
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.resetBMStaffPassword = resetBMStaffPassword;


    // Check for handoff ticket from xentra.cloud before initial auth check
    await handleHandoffExchange();

    var isPlatform = isPlatformContext();

    if (isPlatform) {
      // -------------------------------------------------------------
      // PLATFORM DASHBOARD SHELL INITIALIZATION (xentra.cloud)
      // -------------------------------------------------------------
      // Set platform sidebar brand and badge
      var brandTitle = $('dash-brand-title');
      if (brandTitle) brandTitle.textContent = 'XENTRA PLATFORM';
      var brandLogo = $('dash-sidebar-logo');
      if (brandLogo) brandLogo.src = '/assets/img/xentra-logo.png';
      var badgePro = document.querySelector('.x-dash-badge-pro');
      if (badgePro) badgePro.textContent = 'Platform Control Plane';

      // Topbar adjustments for platform
      var topbarBrandName = $('topbar-brand-name');
      if (topbarBrandName) topbarBrandName.textContent = 'Xentra Cloud Platform';
      var branchSelector = $('x-branch-selector');
      if (branchSelector) branchSelector.style.display = 'none';

      // Hide view store footer button in platform sidebar
      var viewStoreBtn = document.querySelector('.x-btn-view-store');
      if (viewStoreBtn) viewStoreBtn.style.display = 'none';

      // Render platform navigation menu items
      renderPlatformNavigation();

      // Check platform session/auth
      var isAuth = checkAuth();
      if (isAuth) {
        validateServerSession().then(function (isValid) {
          if (!isValid) return;
          var storedUser = getStoredUser();
          if (storedUser && storedUser.role !== 'platform_superadmin' && storedUser.brand_id) {
            fetch(API_BASE + '/auth/handoff/create', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify({ brand_id: storedUser.brand_id })
            }).then(function (res) {
              return res.json();
            }).then(function (data) {
              if (data && data.success && data.redirect_url) {
                window.location.replace(data.redirect_url);
              }
            }).catch(function () {});
          }
        });
      }

      // Apply initial route from URL hash
      applyRoute(getCurrentRoute());

    } else {
      // -------------------------------------------------------------
      // CLIENT OWNER DASHBOARD SHELL INITIALIZATION (<client-domain>)
      // -------------------------------------------------------------
      // Apply role-based UI before data load
      var isAuth = checkAuth();
      applyRoleBasedUI();
      validateServerSession();

      // Apply initial route from URL hash (enables deep-link and browser refresh)
      applyRoute(getCurrentRoute());

      // Initial data fetch if authenticated
      loadBrandSettings();
      initOverviewControls();
      initReportsControls();
      if (isAuth) {
        if (isBranchManager()) {
          loadHariIni();
        } else {
          loadCatalog();
        }
        // Load branches and populate branch context selector
        loadBranches().then(function () {
          populateBranchSelector(state.branches || []);
        }).catch(function () {});
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDashboard);
  } else {
    initializeDashboard();
  }

})();
