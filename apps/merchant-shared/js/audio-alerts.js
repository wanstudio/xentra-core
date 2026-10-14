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

  function getOrderAudio() {
    if (!_orderAudio && typeof Audio !== 'undefined') {
      try {
        _orderAudio = new Audio('/merchant-shared/audio/ada-pesanan-baru.mp3');
        _orderAudio.preload = 'auto';
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
  function speakIndonesian(text) {
    if (!('speechSynthesis' in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      var utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'id-ID';
      utter.rate = 1.05;
      utter.pitch = 1.1;
      utter.volume = 1.0;

      var voices = window.speechSynthesis.getVoices();
      var idVoice = voices.find(function (v) {
        return v.lang === 'id-ID' || v.lang.startsWith('id');
      });
      if (idVoice) utter.voice = idVoice;

      window.speechSynthesis.speak(utter);
    } catch (_) {}
  }

  /**
   * Synthesize a melodic chime (fallback)
   */
  function playChime(tones, durationPerTone, type) {
    var ctx = getAudioContext();
    if (!ctx || ctx.state === 'suspended') return;

    try {
      var now = ctx.currentTime;
      var duration = durationPerTone || 0.16;
      tones = tones || [587.33, 880, 1174.66]; // D5, A5, D6

      tones.forEach(function (freq, idx) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();

        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * duration);

        gain.gain.setValueAtTime(0.001, now + idx * duration);
        gain.gain.exponentialRampToValueAtTime(0.4, now + idx * duration + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, now + (idx + 1) * duration + 0.08);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * duration);
        osc.stop(now + (idx + 1) * duration + 0.1);
      });
    } catch (_) {}
  }

  /**
   * Play the genuine recorded MP3 "Ada pesanan baru.mp3"
   */
  function playOrderAlertAudio(options) {
    options = options || {};
    var audio = getOrderAudio();
    if (audio) {
      try {
        audio.currentTime = 0;
        var playPromise = audio.play();
        if (playPromise !== undefined && typeof playPromise.then === 'function') {
          playPromise.then(function () {
            // Audio played successfully!
          }).catch(function () {
            // Fallback to Web Audio chime + Speech if browser blocks MP3 autoplay
            fallbackOrderAlert(options);
          });
          return;
        }
        return;
      } catch (_) {
        fallbackOrderAlert(options);
        return;
      }
    }
    fallbackOrderAlert(options);
  }

  function fallbackOrderAlert(options) {
    playChime([523.25, 659.25, 783.99, 1046.50], 0.12, 'sine');
    if (options && options.voice !== false) {
      setTimeout(function () {
        speakIndonesian(options.text || 'Ada pesanan baru masuk!');
      }, 500);
    }
  }

  /**
   * Canonical Alert Types:
   */
  var XentraAudio = {
    unlock: unlockAudio,

    // 1. Order Baru Masuk (Merchant App / POS) — Audio asli "Ada pesanan baru.mp3"
    orderReceived: playOrderAlertAudio,
    orderIncoming: playOrderAlertAudio,

    // 2. Konfirmasi Kasir Terima Pesanan — Fast pleasant ascending ding (E5, C6) ~0.2 detik, tanpa suara robot
    orderAccepted: function () {
      playChime([659.25, 1046.50], 0.10, 'sine');
    },

    // 3. Pembayaran Berhasil / Kas Masuk (POS / Kasir) — Double Ding Cash Register
    paymentReceived: function (options) {
      options = options || {};
      playChime([987.77, 1318.51], 0.15, 'triangle'); // B5, E6
      if (options.voice !== false) {
        setTimeout(function () {
          speakIndonesian(options.text || 'Pembayaran berhasil diterima!');
        }, 350);
      }
    },

    // 4. Tugas Delivery Baru (Driver App) — Chime ritmik motor/bel sepeda + Voice
    deliveryAssigned: function (options) {
      options = options || {};
      playChime([440, 554.37, 659.25, 880], 0.13, 'sine'); // A4, C#5, E5, A5
      if (options.voice !== false) {
        setTimeout(function () {
          speakIndonesian(options.text || 'Tugas pengantaran baru!');
        }, 550);
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
    }
  };

  window.XentraAudio = XentraAudio;
})();
