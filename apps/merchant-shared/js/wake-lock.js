/**
 * XENTRA SCREEN WAKE LOCK ENGINE
 *
 * Keeps the device display active (prevents screen timeout/lock) during operational hours
 * so audible alarms and incoming orders can be processed continuously without being suppressed by lockscreen.
 */
(function () {
  'use strict';

  var _sentinel = null;
  var _enabled = true; // Enabled by default for operational dashboard / POS / merchant devices
  var STORAGE_KEY = 'xentra_screen_wake_lock_enabled';

  try {
    var stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      _enabled = stored === 'true';
    }
  } catch (_) {}

  var isSupported = ('wakeLock' in navigator && typeof navigator.wakeLock.request === 'function');

  async function requestWakeLock() {
    if (!isSupported || !_enabled) return false;
    if (_sentinel && !_sentinel.released) return true;

    try {
      _sentinel = await navigator.wakeLock.request('screen');
      _sentinel.addEventListener('release', function () {
        _sentinel = null;
        updateUI();
        notifyStateChange();
      });
      updateUI();
      notifyStateChange();
      return true;
    } catch (err) {
      console.warn('[XentraWakeLock] Request failed:', err && err.message);
      updateUI();
      return false;
    }
  }

  function releaseWakeLock() {
    if (_sentinel) {
      try {
        _sentinel.release();
      } catch (_) {}
      _sentinel = null;
      updateUI();
      notifyStateChange();
    }
  }

  function setEnabled(val) {
    _enabled = Boolean(val);
    try {
      localStorage.setItem(STORAGE_KEY, _enabled ? 'true' : 'false');
    } catch (_) {}
    if (_enabled) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }
    updateUI();
  }

  function toggle() {
    setEnabled(!_enabled);
    return _enabled;
  }

  function isAcquired() {
    return Boolean(_sentinel && !_sentinel.released);
  }

  function isEnabled() {
    return _enabled;
  }

  function updateUI() {
    var switchEl = document.getElementById('switch-wake-lock');
    if (switchEl) {
      switchEl.classList.toggle('is-on', _enabled);
      switchEl.classList.toggle('is-off', !_enabled);
    }
  }

  function notifyStateChange() {
    try {
      window.dispatchEvent(new CustomEvent('xentra:wakelock-change', {
        detail: {
          active: isAcquired(),
          enabled: _enabled,
          supported: isSupported
        }
      }));
    } catch (_) {}
  }

  // Automatically re-acquire when returning to tab/app (Android releases wake lock on tab hide/switch)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && _enabled) {
      requestWakeLock();
    }
  });

  // Re-attempt acquire on first user gesture (satisfies browsers requiring user activation)
  ['click', 'touchstart', 'keydown'].forEach(function (evt) {
    window.addEventListener(evt, function () {
      if (_enabled && !_sentinel) {
        requestWakeLock();
      }
    }, { once: true, passive: true });
  });

  window.XentraWakeLock = {
    isSupported: isSupported,
    isEnabled: isEnabled,
    isAcquired: isAcquired,
    request: requestWakeLock,
    release: releaseWakeLock,
    setEnabled: setEnabled,
    toggle: toggle,
    updateUI: updateUI
  };

  window.toggleScreenWakeLock = function () {
    var newState = toggle();
    if (window.XentraShared && typeof window.XentraShared.showToast === 'function') {
      window.XentraShared.showToast(
        newState
          ? 'Layar Tetap Aktif DIAKTIFKAN (mencegah HP terkunci saat memantau pesanan)'
          : 'Layar Tetap Aktif DINONAKTIFKAN'
      );
    }
  };

  // Auto-initiate when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (_enabled) requestWakeLock();
      updateUI();
    });
  } else {
    if (_enabled) requestWakeLock();
    updateUI();
  }
})();
