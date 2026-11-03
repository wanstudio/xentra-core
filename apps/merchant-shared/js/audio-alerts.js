/**
 * XENTRA NOTIFICATION & AUDIO ALERTS ENGINE
 *
 * Provides cross-app audible chimes and voice alerts:
 * 1. Dedicated MP3 audio alert ("Ada pesanan baru.mp3") for incoming orders.
 * 2. Web Audio API synthesized chimes (zero network latency, offline-ready).
 * 3. Web Speech API voice synthesis fallback.
 * 4. Graceful unlock on initial user gesture (handles Mobile browser Autoplay policies).
 */
(function () {
  'use strict';

  var _audioCtx = null;
  var _unlocked = false;
  var _orderAudio = null;
  var _orderAlertActive = false;
  var _orderAlertRepeatCount = 0;
  var _orderAlertMaxRepeats = 5;
  var _orderAlertPauseMs = 1000;
  var _orderAlertTimer = null;

  var DEFAULT_SOUND_CONFIG = {
    enabled: true,
    volume: 80,
    soundType: 'voice', // 'voice' | 'bell' | 'siren'
    repeatMode: 'loop'  // 'loop' | 'single'
  };

  function getSoundConfig() {
    try {
      var raw = localStorage.getItem('xentra_merchant_sound_config');
      if (raw) {
        var parsed = JSON.parse(raw);
        return Object.assign({}, DEFAULT_SOUND_CONFIG, parsed);
      }
    } catch (_) {}
    return Object.assign({}, DEFAULT_SOUND_CONFIG);
  }

  function setSoundConfig(config) {
    try {
      var current = getSoundConfig();
      var merged = Object.assign({}, current, config);
      localStorage.setItem('xentra_merchant_sound_config', JSON.stringify(merged));
      if (_orderAudio) {
        _orderAudio.volume = Math.max(0, Math.min(1, (merged.volume !== undefined ? merged.volume : 80) / 100));
      }
      return merged;
    } catch (_) {
      return config;
    }
  }

  function getOrderAudio() {
    if (!_orderAudio && typeof Audio !== 'undefined') {
      try {
        _orderAudio = new Audio('/merchant-shared/audio/ada-pesanan-baru.mp3');
        _orderAudio.preload = 'auto';
        var cfg = getSoundConfig();
        _orderAudio.volume = Math.max(0, Math.min(1, (cfg.volume !== undefined ? cfg.volume : 80) / 100));
        _orderAudio.onerror = function () {
          if (_orderAudio && _orderAudio.src && _orderAudio.src.indexOf('/merchant-shared/') !== -1) {
            _orderAudio.src = '/merchant-app/assets/audio/ada-pesanan-baru.mp3';
            _orderAudio.load();
          }
        };
      } catch (_) {}
    }
    return _orderAudio;
  }

  function getAudioContext() {
    if (!_audioCtx) {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        _audioCtx = new AudioCtx();
      }
    }
    if (_audioCtx && _audioCtx.state === 'suspended') {
      _audioCtx.resume().catch(function () {});
    }
    return _audioCtx;
  }

  // Auto unlock on first user gesture
  function unlockAudio() {
    if (_unlocked) return;
    var ctx = getAudioContext();
    if (ctx) {
      if (ctx.state === 'suspended') {
        ctx.resume().then(function () {
          _unlocked = true;
        }).catch(function () {});
      } else {
        _unlocked = true;
      }
    }
    var audio = getOrderAudio();
    if (audio) {
      try {
        audio.load();
      } catch (_) {}
    }
    // Also unlock speech synthesis if available
    if ('speechSynthesis' in window) {
      try {
        var silent = new SpeechSynthesisUtterance('');
        window.speechSynthesis.speak(silent);
      } catch (_) {}
    }
    // Request notification permission during user gesture if not yet decided
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        Notification.requestPermission().catch(function () {});
      } catch (_) {}
    }
  }

  ['click', 'touchstart', 'keydown'].forEach(function (evt) {
    window.addEventListener(evt, unlockAudio, { once: true, passive: true });
  });

  /**
   * Play an Indonesian voice prompt using Web Speech API (fallback)
   */
  function speakIndonesian(text, volume) {
    if (!('speechSynthesis' in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      var utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'id-ID';
      utter.rate = 1.05;
      utter.pitch = 1.1;
      utter.volume = Math.max(0, Math.min(1, volume == null ? 1.0 : Number(volume)));

      var voices = window.speechSynthesis.getVoices();
      var idVoice = voices.find(function (v) {
        return v.lang === 'id-ID' || v.lang.startsWith('id');
      });
      if (idVoice) utter.voice = idVoice;

      window.speechSynthesis.speak(utter);
    } catch (_) {}
  }

  /**
   * Synthesize a melodic chime (fallback & sound choice)
   */
  function playChime(tones, durationPerTone, type, volumeGain) {
    var ctx = getAudioContext();
    if (!ctx || ctx.state === 'suspended') return;

    try {
      var now = ctx.currentTime;
      var duration = durationPerTone || 0.16;
      tones = tones || [587.33, 880, 1174.66]; // D5, A5, D6
      var targetGain = (volumeGain !== undefined ? volumeGain : 0.4);

      tones.forEach(function (freq, idx) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();

        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * duration);

        gain.gain.setValueAtTime(0.001, now + idx * duration);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001, targetGain), now + idx * duration + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, now + (idx + 1) * duration + 0.08);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * duration);
        osc.stop(now + (idx + 1) * duration + 0.1);
      });
    } catch (_) {}
  }

  /**
   * Stop any recurring order alert immediately (e.g. order accepted or rejected)
   */
  function stopOrderAlert() {
    if (window.XentraNative && typeof window.XentraNative.stopOrderAlarm === 'function') {
      try { window.XentraNative.stopOrderAlarm(); } catch (_) {}
    }
    _orderAlertActive = false;
    if (_orderAlertTimer) {
      clearTimeout(_orderAlertTimer);
      _orderAlertTimer = null;
    }
    if (_orderAudio) {
      try {
        _orderAudio.pause();
        _orderAudio.currentTime = 0;
        _orderAudio.onended = null;
      } catch (_) {}
    }
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
  }

  function scheduleNextOrderAlert(options) {
    if (!_orderAlertActive) return;
    if (_orderAlertRepeatCount >= _orderAlertMaxRepeats) {
      _orderAlertActive = false;
      return;
    }
    if (_orderAlertTimer) clearTimeout(_orderAlertTimer);
    _orderAlertTimer = setTimeout(function () {
      _orderAlertTimer = null;
      if (_orderAlertActive) {
        playOrderAlertStep(options);
      }
    }, _orderAlertPauseMs);
  }

  function playOrderAlertStep(options) {
    if (!_orderAlertActive) return;
    if (_orderAlertRepeatCount >= _orderAlertMaxRepeats) {
      _orderAlertActive = false;
      return;
    }
    _orderAlertRepeatCount++;

    var config = getSoundConfig();
    var vol = (options && options.volume !== undefined)
      ? Number(options.volume) / 100
      : (config.volume !== undefined ? config.volume : 80) / 100;
    var soundType = (options && options.soundType) || config.soundType || 'voice';

    var isSingle = !!(options && (options.single || options.maxRepeats === 1 || (config.repeatMode === 'single')));

    if (soundType === 'bell') {
      playChime([523.25, 659.25, 783.99, 1046.50], 0.14, 'sine', 0.5 * vol);
      if (!isSingle) {
        scheduleNextOrderAlert(options);
      } else {
        _orderAlertActive = false;
      }
      return;
    }

    if (soundType === 'siren') {
      playChime([880, 1174.66, 880, 1174.66], 0.14, 'triangle', 0.6 * vol);
      if (!isSingle) {
        scheduleNextOrderAlert(options);
      } else {
        _orderAlertActive = false;
      }
      return;
    }

    // Default 'voice': MP3 "Ada pesanan baru.mp3"
    var audio = getOrderAudio();
    if (audio) {
      try {
        audio.loop = false;
        audio.volume = Math.max(0, Math.min(1, vol));
        audio.currentTime = 0;
        audio.onended = function () {
          if (isSingle || _orderAlertRepeatCount >= _orderAlertMaxRepeats) {
            _orderAlertActive = false;
            return;
          }
          scheduleNextOrderAlert(options);
        };
        var playPromise = audio.play();
        if (playPromise !== undefined && typeof playPromise.then === 'function') {
          playPromise.then(function () {
            // Audio played successfully
          }).catch(function (err) {
            // If play was stopped or interrupted by pause, never trigger fallback
            if (err && (err.name === 'AbortError' || err.code === 20)) {
              return;
            }
            if (!_orderAlertActive) return;
            fallbackOrderAlert(options);
            if (!isSingle && _orderAlertRepeatCount < _orderAlertMaxRepeats) {
              scheduleNextOrderAlert(options);
            } else {
              _orderAlertActive = false;
            }
          });
          return;
        }
        return;
      } catch (err) {
        if (err && (err.name === 'AbortError' || err.code === 20)) return;
        if (!_orderAlertActive) return;
        fallbackOrderAlert(options);
        if (!isSingle && _orderAlertRepeatCount < _orderAlertMaxRepeats) {
          scheduleNextOrderAlert(options);
        } else {
          _orderAlertActive = false;
        }
        return;
      }
    }
    if (!_orderAlertActive) return;
    fallbackOrderAlert(options);
    if (!isSingle && _orderAlertRepeatCount < _orderAlertMaxRepeats) {
      scheduleNextOrderAlert(options);
    } else {
      _orderAlertActive = false;
    }
  }

  /**
   * Play the genuine recorded MP3 "Ada pesanan baru.mp3" or selected ringtone
   * Repeats with 1s pause between loops up to max repeats, or stops when accepted/rejected.
   */
  function playOrderAlertAudio(options) {
    options = options || {};
    var config = getSoundConfig();
    if (!config.enabled && !options.force) {
      return;
    }
    var isSingle = !!(options.single || (config.repeatMode === 'single') || (options.maxRepeats === 1));

    // Only invoke native alarm service for repeating merchant alarms.
    // For single alerts (Owner App / notification chime), do NOT trigger native loop alarm.
    if (!isSingle && window.XentraNative && typeof window.XentraNative.playOrderAlarm === 'function') {
      try { window.XentraNative.playOrderAlarm(); } catch (_) {}
    }
    // If an alert is already actively playing and not finished, do not double-trigger or overlap
    if (_orderAlertActive && !options.force) {
      return;
    }
    stopOrderAlert();
    _orderAlertActive = true;
    _orderAlertRepeatCount = 0;

    _orderAlertMaxRepeats = (options.maxRepeats !== undefined)
      ? Number(options.maxRepeats)
      : (isSingle ? 1 : 5);
    _orderAlertPauseMs = (options.pauseMs !== undefined) ? Number(options.pauseMs) : 1000;

    playOrderAlertStep(options);
  }

  function fallbackOrderAlert(options) {
    var config = getSoundConfig();
    var vol = (config.volume !== undefined ? config.volume : 80) / 100;
    // Only synthesize chime if MP3 fails to load; NEVER speak robot voice to avoid messy overlap
    playChime([523.25, 659.25, 783.99, 1046.50], 0.12, 'sine', 0.4 * vol);
  }

  function testAlertSound(soundType, volume) {
    stopOrderAlert();
    var current = getSoundConfig();
    var targetType = soundType || current.soundType || 'voice';
    var targetVol = (volume !== undefined ? volume : current.volume);

    _orderAlertActive = true;
    _orderAlertRepeatCount = 0;
    _orderAlertMaxRepeats = 1;
    _orderAlertPauseMs = 1000;

    playOrderAlertStep({
      force: true,
      single: true,
      soundType: targetType,
      volume: targetVol
    });
  }

  /**
   * Canonical Alert Types:
   */
  var XentraAudio = {
    unlock: unlockAudio,
    stopOrderAlert: stopOrderAlert,

    // 1. Order Baru Masuk (Merchant App / POS) — Audio asli "Ada pesanan baru.mp3" (Repeat 1s up to 5x)
    orderReceived: playOrderAlertAudio,
    orderIncoming: playOrderAlertAudio,

    // 2. Konfirmasi Kasir Terima Pesanan — Fast pleasant ascending ding (E5, C6) ~0.2 detik, hentikan alarm
    orderAccepted: function () {
      stopOrderAlert();
      playChime([659.25, 1046.50], 0.10, 'sine');
    },

    // 2b. Tolak Pesanan — Hentikan alarm pesanan baru & bunyikan konfirmasi tolak
    orderRejected: function () {
      stopOrderAlert();
      playChime([440, 349.23], 0.15, 'triangle');
    },

    // 3. Pembayaran Berhasil / Kas Masuk (POS / Kasir) — Double Ding Cash Register
    paymentReceived: function (options) {
      options = options || {};
      if (options.enabled === false) return;
      var volume = Math.max(0, Math.min(1, Number(options.volume == null ? 75 : options.volume) / 100));
      playChime([987.77, 1318.51], 0.15, 'triangle', 0.5 * volume); // B5, E6
      if (options.voice !== false) {
        setTimeout(function () {
          speakIndonesian(options.text || 'Pembayaran berhasil diterima!', volume);
        }, 350);
      }
    },

    // 4. Tugas Delivery Baru (Driver App) — Sirine ritmik + MP3 / Voice Looping hingga diterima
    deliveryAssigned: function (options) {
      options = options || {};
      playChime([523.25, 659.25, 783.99, 1046.50, 783.99, 1046.50], 0.12, 'triangle'); // C5, E5, G5, C6, G5, C6 (nyaring di jalanan)
      if (navigator.vibrate) {
        try { navigator.vibrate([400, 150, 400, 150, 600]); } catch (_) {}
      }
      playOrderAlertAudio({
        maxRepeats: options.maxRepeats !== undefined ? options.maxRepeats : 6,
        pauseMs: options.pauseMs !== undefined ? options.pauseMs : 1200,
        force: true
      });
      if (options.voice !== false) {
        setTimeout(function () {
          speakIndonesian(options.text || 'Ada tugas pengantaran baru! Silakan terima tugas.');
        }, 700);
      }
    },

    // 5. Status Pesanan Siap / Driver Menuju (Customer PWA / Operational)
    statusUpdate: function (options) {
      options = options || {};
      playChime([659.25, 880], 0.18, 'sine'); // E5, A5
      if (options.text) {
        setTimeout(function () {
          speakIndonesian(options.text);
        }, 400);
      }
    },

    // 6. Peringatan / Kendala (Stok Habis / Driver Tolak)
    alertWarning: function (options) {
      options = options || {};
      playChime([440, 349.23], 0.22, 'triangle'); // A4, F4
      if (options.text) {
        setTimeout(function () {
          speakIndonesian(options.text);
        }, 450);
      }
    },

    // 7. Sound Configuration & Testing API
    getSoundConfig: getSoundConfig,
    setSoundConfig: setSoundConfig,
    testAlertSound: testAlertSound
  };

  window.XentraAudio = XentraAudio;
})();
