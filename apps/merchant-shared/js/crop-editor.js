/**
 * XENTRA — MERCHANT SHARED CROP EDITOR
 *
 * Generic image crop/pan/zoom UI primitive. Canonical processed pixels remain
 * server-authoritative in the Media System pipeline.
 */
(function () {
  'use strict';
  var S = window.XentraShared;
  var $ = S.$;
  var showToast = S.showToast;
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

    // Bind-once guard: pointer/wheel/keyboard listeners must only ever be
    // attached a single time even though open() re-runs initElements().
    var _interactionBound = false;

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
      _modal         = $('modal-crop-editor');
      _viewport      = $('crop-viewport');
      _canvasWrapper = $('crop-canvas-wrapper');
      _img           = $('crop-target-image');
      _framingBox    = $('crop-framing-box');
      _zoomSlider    = $('crop-zoom-slider');
      _zoomValue     = $('crop-zoom-value');
      _dimInfo       = $('crop-dimensions-info');
      _ratioInfo     = $('crop-ratio-info');
      _titleEl       = $('crop-editor-title');

      if (!_modal) return;

      // Button handlers
      var btnClose   = $('btn-crop-close');   if (btnClose)   btnClose.onclick   = cancel;
      var btnCancel  = $('btn-crop-cancel');  if (btnCancel)  btnCancel.onclick  = cancel;
      var btnConfirm = $('btn-crop-confirm'); if (btnConfirm) btnConfirm.onclick = confirm;
      var btnReset   = $('btn-crop-reset');   if (btnReset)   btnReset.onclick   = reset;

      var btnZoomIn = $('btn-crop-zoom-in');
      if (btnZoomIn) {
        btnZoomIn.onclick = function () { setZoom(Math.min(3.0, _zoom + 0.1)); };
      }
      var btnZoomOut = $('btn-crop-zoom-out');
      if (btnZoomOut) {
        btnZoomOut.onclick = function () { setZoom(Math.max(1.0, _zoom - 0.1)); };
      }

      if (_zoomSlider) {
        _zoomSlider.oninput = function () { setZoom(parseFloat(_zoomSlider.value)); };
      }

      // Pointer/touch/wheel/keyboard interaction — bound exactly once for the
      // lifetime of this singleton editor (open/close cycles never re-bind).
      if (_viewport && !_interactionBound) {
        _interactionBound = true;

        _viewport.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('pointermove',   handlePointerMove);
        window.addEventListener('pointerup',     handlePointerUp);
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
          if      (e.key === 'ArrowLeft')        { _panX += step; updateTransform(); e.preventDefault(); }
          else if (e.key === 'ArrowRight')       { _panX -= step; updateTransform(); e.preventDefault(); }
          else if (e.key === 'ArrowUp')          { _panY += step; updateTransform(); e.preventDefault(); }
          else if (e.key === 'ArrowDown')        { _panY -= step; updateTransform(); e.preventDefault(); }
          else if (e.key === '+' || e.key === '=') { setZoom(Math.min(3.0, _zoom + 0.1)); e.preventDefault(); }
          else if (e.key === '-' || e.key === '_') { setZoom(Math.max(1.0, _zoom - 0.1)); e.preventDefault(); }
          else if (e.key === 'Escape')           { cancel(); e.preventDefault(); }
        });

        // Global Escape close for when the viewport is not focused. Safe against
        // double-cancel: the viewport handler runs first and hides the modal,
        // so this handler sees display==='none' and skips.
        document.addEventListener('keydown', function (e) {
          if (e.key !== 'Escape') return;
          if (!_modal || _modal.style.display === 'none') return;
          cancel();
          e.preventDefault();
        });
      }
    }

    function handlePointerDown(e) {
      if (!_modal || _modal.style.display === 'none') return;
      _isDragging  = true;
      _dragStartX  = e.clientX;
      _dragStartY  = e.clientY;
      _dragStartPanX = _panX;
      _dragStartPanY = _panY;
      if (_viewport) _viewport.focus();
    }

    function handlePointerMove(e) {
      if (!_isDragging) return;
      _panX = _dragStartPanX + (e.clientX - _dragStartX);
      _panY = _dragStartPanY + (e.clientY - _dragStartY);
      clampPan();
      updateTransform();
    }

    function handlePointerUp() {
      if (_isDragging) _isDragging = false;
    }

    function setZoom(val) {
      _zoom = Math.min(3.0, Math.max(1.0, val));
      if (_zoomSlider) _zoomSlider.value = _zoom;
      if (_zoomValue)  _zoomValue.textContent = Math.round(_zoom * 100) + '%';
      clampPan();
      updateTransform();
    }

    function clampPan() {
      if (!_naturalWidth || !_naturalHeight || !_frameWidth || !_frameHeight) return;
      var currentScale = _baseScale * _zoom;
      var renderedW    = _naturalWidth  * currentScale;
      var renderedH    = _naturalHeight * currentScale;

      // Max pan offset allowed so crop frame stays completely filled by image
      var maxPanX = Math.max(0, (renderedW - _frameWidth)  / 2);
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
      var vpWidth  = _viewport.clientWidth  || 320;
      var vpHeight = _viewport.clientHeight || 240;

      // Padding around crop frame inside viewport
      var pad    = 24;
      var availW = Math.max(100, vpWidth  - pad);
      var availH = Math.max(100, vpHeight - pad);

      // Frame aspect ratio = _targetRatio
      if (availW / availH > _targetRatio) {
        _frameHeight = availH;
        _frameWidth  = Math.round(_frameHeight * _targetRatio);
      } else {
        _frameWidth  = availW;
        _frameHeight = Math.round(_frameWidth / _targetRatio);
      }

      if (_framingBox) {
        _framingBox.style.width  = _frameWidth  + 'px';
        _framingBox.style.height = _frameHeight + 'px';
        _framingBox.style.left   = Math.round((vpWidth  - _frameWidth)  / 2) + 'px';
        _framingBox.style.top    = Math.round((vpHeight - _frameHeight) / 2) + 'px';
      }

      // Base scale must cover the framing box completely ("cover" mode)
      var scaleX = _frameWidth  / _naturalWidth;
      var scaleY = _frameHeight / _naturalHeight;
      _baseScale = Math.max(scaleX, scaleY);

      _img.style.width  = _naturalWidth  + 'px';
      _img.style.height = _naturalHeight + 'px';

      clampPan();
      updateTransform();
    }

    function reset() {
      _zoom = 1.0;
      _panX = 0;
      _panY = 0;
      if (_zoomSlider) _zoomSlider.value = 1.0;
      if (_zoomValue)  _zoomValue.textContent = '100%';
      clampPan();
      updateTransform();
    }

    /**
     * Open the crop editor with configuration.
     * @param {Object} options
     * @param {string|File|Blob} options.source    - Image URL or File/Blob
     * @param {string}           options.assetType - 'product'|'category'|'logo'|'avatar'|'banner'|'general'
     * @param {number}           [options.aspectRatio] - Target aspect ratio override
     * @param {string}           [options.title]   - Modal title override
     * @param {Function}         [options.onConfirm] - Callback(cropSpec, dataUrl)
     * @param {Function}         [options.onCancel]  - Callback()
     */
    function open(options) {
      initElements();
      // Fresh interaction state for every open (safety against a pointerup
      // that was lost while the modal was closing).
      _isDragging = false;
      _activeConfig       = options || {};
      _onConfirmCallback  = _activeConfig.onConfirm || null;
      _onCancelCallback   = _activeConfig.onCancel  || null;

      var assetType = (_activeConfig.assetType || 'general').toLowerCase();
      var ratioMap  = {
        logo:     1.0,
        product:  1.0,
        category: 1.0,
        avatar:   1.0,
        banner:   350 / 180, // ~1.944
        general:  1.0
      };

      _targetRatio = typeof _activeConfig.aspectRatio === 'number' && _activeConfig.aspectRatio > 0
        ? _activeConfig.aspectRatio
        : (ratioMap[assetType] || 1.0);

      if (_titleEl) {
        _titleEl.textContent = _activeConfig.title ||
          (assetType === 'banner' ? 'Sesuaikan Banner Promo (~1.94:1)' : 'Sesuaikan Potongan Foto (1:1)');
      }
      if (_ratioInfo) {
        _ratioInfo.textContent = 'Rasio Target: ' +
          (assetType === 'banner' ? '±1.94:1 (Banner)' : '1:1 (Persegi)');
      }

      var src = _activeConfig.source;
      if (!src) {
        showToast('❌ Tidak ada sumber gambar untuk diedit.');
        return;
      }

      if (typeof src === 'string') {
        loadImage(src);
      } else if (src instanceof Blob || src instanceof File) {
        var reader = new FileReader();
        reader.onload = function (ev) { loadImage(ev.target.result); };
        reader.readAsDataURL(src);
      }
    }

    function loadImage(srcUrl) {
      _sourceImg = new Image();
      _sourceImg.onload = function () {
        _naturalWidth  = _sourceImg.naturalWidth  || _sourceImg.width;
        _naturalHeight = _sourceImg.naturalHeight || _sourceImg.height;

        if (_dimInfo) {
          _dimInfo.textContent = 'Sumber: ' + _naturalWidth + ' × ' + _naturalHeight + ' px';
        }

        if (_img) _img.src = srcUrl;

        if (_modal) _modal.style.display = 'flex';

        // Compute initial sizing after layout
        setTimeout(function () { calculateFrameLayout(); reset(); }, 50);
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

      // Visible crop box in source image space
      var cropSourceW = _frameWidth  / currentScale;
      var cropSourceH = _frameHeight / currentScale;

      var centerSourceX = (_naturalWidth  / 2) - (_panX / currentScale);
      var centerSourceY = (_naturalHeight / 2) - (_panY / currentScale);

      var x = Math.round(centerSourceX - (cropSourceW / 2));
      var y = Math.round(centerSourceY - (cropSourceH / 2));
      var w = Math.round(cropSourceW);
      var h = Math.round(cropSourceH);

      // Clamp inside source image bounds
      x = Math.max(0, Math.min(_naturalWidth  - w, x));
      y = Math.max(0, Math.min(_naturalHeight - h, y));
      w = Math.min(w, _naturalWidth  - x);
      h = Math.min(h, _naturalHeight - y);

      return {
        x: x, y: y, width: w, height: h,
        source_width:  _naturalWidth,
        source_height: _naturalHeight,
        aspect_ratio:  Number((w / h).toFixed(4)),
        zoom:          Number(_zoom.toFixed(2)),
        asset_type:    (_activeConfig && _activeConfig.assetType) || 'general'
      };
    }

    /**
     * Render client-side interactive preview dataURL.
     * NOTE: This is purely for UI feedback, NOT canonical M3 processed pixels.
     */
    function generatePreviewCanvas(spec) {
      try {
        var canvas    = document.createElement('canvas');
        var maxDim    = 400;
        var previewW  = maxDim;
        var previewH  = Math.round(previewW / (spec.aspect_ratio || 1.0));
        if (previewH > maxDim) {
          previewH = maxDim;
          previewW = Math.round(previewH * (spec.aspect_ratio || 1.0));
        }
        canvas.width  = previewW;
        canvas.height = previewH;
        var ctx = canvas.getContext('2d');
        if (ctx && _sourceImg) {
          ctx.drawImage(_sourceImg, spec.x, spec.y, spec.width, spec.height, 0, 0, previewW, previewH);
          return canvas.toDataURL('image/jpeg', 0.85);
        }
      } catch (_) {}
      return null;
    }

    function confirm() {
      var spec       = computeCropSpec();
      var previewUrl = generatePreviewCanvas(spec);
      if (_modal) _modal.style.display = 'none';
      if (typeof _onConfirmCallback === 'function') _onConfirmCallback(spec, previewUrl);
    }

    function cancel() {
      if (_modal) _modal.style.display = 'none';
      if (typeof _onCancelCallback === 'function') _onCancelCallback();
    }

    // Responsive window resize
    window.addEventListener('resize', function () {
      if (_modal && _modal.style.display !== 'none') calculateFrameLayout();
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
})();
