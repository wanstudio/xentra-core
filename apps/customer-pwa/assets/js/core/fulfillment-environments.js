/**
 * Fulfillment Environments — isolasi Delivery, Pickup, Dine-in, Reservation.
 *
 * Masalahnya: checkout dulu punya SATU `state.fulfillment` yang dipakai bersama
 * keempat tipe. Akibatnya nilai milik satu tipe bisa terbaca tipe lain — memilih
 * meja dine-in lalu pindah ke delivery, dan `table_ids` ikut terkirim di payload
 * delivery. Perubahan satu tipe merembet ke tipe lain.
 *
 * Aturannya sekarang:
 *
 *   CHECKOUT
 *   ├── Shared Core              (cart, customer, payment, order, branch)
 *   └── Fulfillment Environment  (delivery | pickup | dine_in | reservation)
 *
 * Setiap environment MEMILIKI objek state sendiri. Tidak ada field fulfillment
 * yang dibagi. Saat tipe berganti, environment lama di-unmount (listenernya
 * dilepas, state sementaranya direset) dan environment baru di-mount.
 *
 * Modul ini murni logika — tidak menyentuh DOM saat dimuat, supaya bisa diuji di
 * Node tanpa browser.
 */
(function () {
  'use strict';

  var TYPES = ['delivery', 'pickup', 'dine_in', 'reservation'];

  // Alias lama 'dinein' masih tersimpan di Store/localStorage dari versi
  // sebelumnya, jadi normalisasi dilakukan di satu tempat saja.
  function normalize(type) {
    if (type === 'dinein') return 'dine_in';
    return TYPES.indexOf(type) !== -1 ? type : 'delivery';
  }

  function isSchedulable(type) {
    return type === 'delivery' || type === 'pickup';
  }

  // Field fulfillment yang HARUS dipisah per tipe. Dipakai sebagai daftar
  // kepemilikan: environment hanya mengirim field yang memang miliknya.
  var OWNERSHIP = {
    delivery: { schedule: true, address: true, deliveryFee: true, table: false, reservation: false },
    pickup: { schedule: true, address: false, deliveryFee: false, table: false, reservation: false },
    dine_in: { schedule: false, address: false, deliveryFee: false, table: true, reservation: false },
    reservation: { schedule: false, address: false, deliveryFee: false, table: false, reservation: true }
  };

  // Nilai netral untuk field yang bukan milik tipe ini. Dikirim eksplisit supaya
  // bentuk payload di server tidak berubah, tetapi TIDAK PERNAH berisi nilai
  // sisa dari tipe lain.
  function neutralState() {
    return {
      tableNumber: '',
      table_ids: [],
      reservationDate: '',
      reservationTime: '12:00',
      reservationName: '',
      reservationPhone: '',
      guestCount: null
    };
  }

  function defaultState(type) {
    var base = {
      type: type,
      scheduled: false,
      date: 'Hari Ini',
      timeSlot: '12.00 - 12.30',
      note: ''
    };
    var neutral = neutralState();
    var k;
    for (k in neutral) {
      if (Object.prototype.hasOwnProperty.call(neutral, k)) base[k] = neutral[k];
    }

    if (type === 'dine_in') {
      base.guestCount = 1;
    } else if (type === 'reservation') {
      base.guestCount = 2;
    }
    return base;
  }

  // ── Environment ──
  // Satu objek per tipe. `state` miliknya sendiri; `listeners` melacak listener
  // miliknya sendiri supaya bisa dilepas saat unmount.
  function createEnvironment(type) {
    var t = normalize(type);

    var env = {
      type: t,
      state: defaultState(t),
      listeners: [],
      mounted: false,

      owns: function (what) {
        return OWNERSHIP[t][what] === true;
      },

      isSchedulable: function () {
        return isSchedulable(t);
      },

      // Listener milik environment ini. Dilepas semua saat unmount, jadi tidak
      // ada handler tipe lama yang masih hidup setelah tipe berganti.
      on: function (target, event, handler, options) {
        if (!target || typeof target.addEventListener !== 'function') return handler;
        target.addEventListener(event, handler, options);
        env.listeners.push({ target: target, event: event, handler: handler, options: options });
        return handler;
      },

      off: function (target, event, handler) {
        for (var i = env.listeners.length - 1; i >= 0; i--) {
          var l = env.listeners[i];
          if (l.target === target && l.event === event && (!handler || l.handler === handler)) {
            try { l.target.removeEventListener(l.event, l.handler, l.options); } catch (e) { /* sudah lepas */ }
            env.listeners.splice(i, 1);
          }
        }
      },

      teardownListeners: function () {
        for (var i = 0; i < env.listeners.length; i++) {
          var l = env.listeners[i];
          try { l.target.removeEventListener(l.event, l.handler, l.options); } catch (e) { /* sudah lepas */ }
        }
        env.listeners.length = 0;
      },

      // State sementara dibuang; environment kembali ke bentuk bersihnya.
      reset: function () {
        env.state = defaultState(t);
        return env.state;
      },

      unmount: function () {
        env.teardownListeners();
        env.reset();
        env.mounted = false;
      },

      mount: function () {
        env.mounted = true;
        return env.state;
      },

      // Validasi khusus tipe ini. Dipanggil pipeline order bersama; tipe lain
      // tidak pernah ikut memeriksa.
      validate: function (ctx) {
        ctx = ctx || {};
        if (t === 'delivery') {
          if (!ctx.hasAddress) {
            return { ok: false, message: 'Alamat pengiriman belum lengkap. Isi dulu alamat pengantarannya.' };
          }
          return { ok: true, message: '' };
        }
        if (t === 'pickup') {
          if (!ctx.branchId) {
            return { ok: false, message: 'Cabang pengambilan belum dipilih.' };
          }
          return { ok: true, message: '' };
        }
        if (t === 'dine_in') {
          var ids = env.state.table_ids || [];
          if (!ids.length) {
            return { ok: false, message: 'Silakan pilih nomor meja untuk makan di tempat (Dine-in).' };
          }
          return { ok: true, message: '' };
        }
        // reservation
        if (!env.state.reservationDate) {
          return { ok: false, message: 'Silakan pilih tanggal reservasi terlebih dahulu.' };
        }
        return { ok: true, message: '' };
      },

      // Field yang boleh masuk payload. Field milik tipe lain SELALU netral,
      // walaupun state environment ini ternyata terisi — jadi tidak ada jalan
      // nilai fulfillment bocor ke tipe lain.
      payloadFields: function () {
        var ownsTable = env.owns('table');
        var ownsReservation = env.owns('reservation');

        var fulfillment = { type: t };
        var topLevel = {};

        var tableNumber = ownsTable ? (env.state.tableNumber || null) : null;
        var tableIds = ownsTable && Array.isArray(env.state.table_ids) ? env.state.table_ids.slice() : [];
        var reservationDate = ownsReservation ? (env.state.reservationDate || null) : null;
        var guestCount = (ownsTable || ownsReservation) ? (env.state.guestCount || null) : null;

        fulfillment.table_number = tableNumber;
        fulfillment.table_ids = tableIds;
        fulfillment.reservation_date = reservationDate;
        fulfillment.guest_count = guestCount;

        topLevel.table_number = tableNumber;
        topLevel.table_ids = tableIds;
        topLevel.reservation_date = reservationDate;
        topLevel.guest_count = guestCount;

        return { fulfillment: fulfillment, topLevel: topLevel };
      }
    };

    return env;
  }

  // ── Registry & switching ──
  var registry = null;
  var active = null;

  function getRegistry() {
    if (registry) return registry;
    registry = {};
    for (var i = 0; i < TYPES.length; i++) {
      registry[TYPES[i]] = createEnvironment(TYPES[i]);
    }
    registry.delivery.mounted = true;
    return registry;
  }

  function getActive() {
    var reg = getRegistry();
    if (!active) active = reg.delivery;
    return active;
  }

  /**
   * Ganti environment aktif.
   *
   * Urutannya penting: environment LAMA di-unmount lebih dulu (listener dilepas,
   * state sementaranya dibuang), baru yang baru di-mount. Jadi tidak ada listener
   * atau nilai sisa dari tipe sebelumnya yang masih hidup.
   */
  function switchTo(nextType) {
    var reg = getRegistry();
    var next = reg[normalize(nextType)];
    var prev = getActive();

    if (prev === next) {
      // Tipe sama: tidak ada yang di-unmount, state tetap. Berbeda dengan
      // berpindah tipe, di sini nilai yang sudah diisi tamu harus bertahan.
      next.mounted = true;
      return next;
    }

    prev.unmount();
    next.mount();
    active = next;
    return next;
  }

  function getState(type) {
    var reg = getRegistry();
    return reg[normalize(type)].state;
  }

  // Dipakai tes dan dipakai checkout saat memuat ulang halaman: kembalikan semua
  // environment ke keadaan bersih tanpa mengubah tipe aktif.
  function resetAll() {
    var reg = getRegistry();
    for (var i = 0; i < TYPES.length; i++) {
      reg[TYPES[i]].reset();
    }
    return reg;
  }

  window.Xentra = window.Xentra || {};
  window.Xentra.FulfillmentEnvironments = {
    TYPES: TYPES,
    normalize: normalize,
    isSchedulable: isSchedulable,
    create: createEnvironment,
    getActive: getActive,
    getState: getState,
    switchTo: switchTo,
    resetAll: resetAll
  };
})();
