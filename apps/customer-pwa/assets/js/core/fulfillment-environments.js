/**
 * Xentra Fulfillment Environments
 *
 * Shared customer-checkout isolation + fulfillment presentation contract.
 *
 * One canonical Commerce Order remains shared. Each purchase type gets its own
 * operational environment with its own phases, labels, actions, timing/context,
 * exceptions and handoff semantics.
 *
 * This module is intentionally presentation/coordination metadata only. It is
 * NOT a replacement for server-side authorization or the canonical backend
 * Order/Payment/Dining/Delivery state machines.
 */
(function () {
  'use strict';

  var TYPES = ['delivery', 'pickup', 'dine_in', 'reservation'];

  function normalize(type) {
    if (type === 'dinein') return 'dine_in';
    return TYPES.indexOf(type) !== -1 ? type : 'delivery';
  }

  function isSchedulable(type) {
    return type === 'delivery' || type === 'pickup';
  }

  var OWNERSHIP = {
    delivery: { schedule: true, address: true, deliveryFee: true, table: false, reservation: false },
    pickup: { schedule: true, address: false, deliveryFee: false, table: false, reservation: false },
    dine_in: { schedule: false, address: false, deliveryFee: false, table: true, reservation: false },
    reservation: { schedule: false, address: false, deliveryFee: false, table: false, reservation: true }
  };

  /*
   * Human-facing environment contract.
   *
   * Primary phases are deliberately smaller than the complete event graph.
   * Assignment, arrival, cash handover, payment settlement and other events
   * remain substates/actions/context rather than being forced into new phases.
   */
  var PRESENTATIONS = {
    delivery: {
      label: 'Delivery',
      phases: [
        { key: 'accepted', label: 'Pesanan diterima', description: 'Cabang sudah menerima pesanan.' },
        { key: 'preparing', label: 'Sedang disiapkan', description: 'Pesanan sedang disiapkan.' },
        { key: 'ready', label: 'Siap diantar', description: 'Pesanan siap diserahkan untuk pengantaran.' },
        { key: 'delivering', label: 'Sedang diantar', description: 'Pesanan sedang menuju alamat tujuan.' },
        { key: 'completed', label: 'Selesai diantar', description: 'Pesanan sudah selesai diantar.' }
      ],
      statusLabels: {
        pending: 'Menunggu diterima',
        confirmed: 'Pesanan diterima',
        preparing: 'Sedang disiapkan',
        ready: 'Siap diantar',
        out_for_delivery: 'Sedang diantar',
        completed: 'Selesai diantar',
        rejected: 'Pesanan ditolak',
        cancelled: 'Pesanan dibatalkan',
        timeout: 'Waktu penerimaan habis',
        fulfillment_exception: 'Perlu penanganan'
      },
      completion: { label: 'Selesai diantar', actor: 'driver' },
      handoffs: ['branch_to_driver', 'driver_to_customer', 'cod_to_cashier'],
      exceptions: ['customer_unavailable', 'customer_refuses_cod', 'driver_reassignment', 'delivery_failed', 'cash_variance'],
      timing: true
    },

    pickup: {
      label: 'Pickup',
      phases: [
        { key: 'accepted', label: 'Pesanan diterima', description: 'Cabang sudah menerima pesanan.' },
        { key: 'preparing', label: 'Sedang disiapkan', description: 'Pesanan sedang disiapkan.' },
        { key: 'ready', label: 'Siap diambil', description: 'Pesanan sudah siap di konter.' },
        { key: 'completed', label: 'Sudah diambil', description: 'Pesanan sudah diserahkan kepada pelanggan.' }
      ],
      statusLabels: {
        pending: 'Menunggu diterima',
        confirmed: 'Pesanan diterima',
        preparing: 'Sedang disiapkan',
        ready: 'Siap diambil',
        completed: 'Sudah diambil',
        rejected: 'Pesanan ditolak',
        cancelled: 'Pesanan dibatalkan',
        timeout: 'Waktu penerimaan habis',
        fulfillment_exception: 'Perlu penanganan'
      },
      completion: { label: 'Sudah diambil', actor: 'fulfillment_handoff' },
      handoffs: ['branch_to_customer'],
      exceptions: ['customer_unavailable', 'customer_cancellation', 'item_unavailable'],
      timing: true
    },

    dine_in: {
      label: 'Dine-in',
      phases: [
        { key: 'accepted', label: 'Pesanan diterima', description: 'Cabang sudah menerima pesanan dan konteks meja aktif.' },
        { key: 'preparing', label: 'Sedang disiapkan', description: 'Pesanan sedang disiapkan.' },
        { key: 'ready', label: 'Siap disajikan', description: 'Pesanan siap disajikan ke meja.' },
        { key: 'completed', label: 'Pesanan selesai', description: 'Pesanan ini sudah selesai.' }
      ],
      statusLabels: {
        pending: 'Menunggu diterima',
        confirmed: 'Pesanan diterima',
        preparing: 'Sedang disiapkan',
        ready: 'Siap disajikan',
        completed: 'Pesanan selesai',
        active_table: 'Sedang makan',
        rejected: 'Pesanan ditolak',
        cancelled: 'Pesanan dibatalkan',
        timeout: 'Waktu penerimaan habis',
        fulfillment_exception: 'Perlu penanganan'
      },
      completion: { label: 'Pesanan selesai', actor: 'dine_in_order_authority' },
      handoffs: ['branch_to_kitchen', 'kitchen_to_table'],
      exceptions: ['customer_absent_cash', 'table_blocked', 'session_not_closable'],
      timing: false
    },

    reservation: {
      label: 'Reservasi',
      phases: [
        { key: 'created', label: 'Reservasi dibuat', description: 'Permintaan reservasi sudah tercatat.' },
        { key: 'confirmed', label: 'Reservasi dikonfirmasi', description: 'Reservasi sudah dikonfirmasi cabang.' },
        { key: 'arrival', label: 'Menunggu kedatangan', description: 'Tamu tinggal datang sesuai jadwal.' }
      ],
      statusLabels: {
        pending: 'Menunggu konfirmasi',
        confirmed: 'Reservasi dikonfirmasi',
        cancelled: 'Reservasi dibatalkan',
        rejected: 'Reservasi ditolak',
        timeout: 'Waktu penerimaan habis',
        active_table: 'Tamu sudah datang'
      },
      completion: { label: 'Handoff ke Dine-in', actor: 'branch_operational' },
      handoffs: ['reservation_to_dine_in'],
      exceptions: ['customer_late', 'no_show', 'reservation_cancelled', 'check_in_failed'],
      timing: true
    }
  };

  var STATUS_PHASE_INDEX = {
    delivery: {
      pending: 0, confirmed: 0, preparing: 1, ready: 2, out_for_delivery: 3, completed: 4
    },
    pickup: {
      pending: 0, confirmed: 0, preparing: 1, ready: 2, completed: 3
    },
    dine_in: {
      pending: 0, confirmed: 0, preparing: 1, ready: 2, completed: 3, active_table: 0
    },
    reservation: {
      pending: 0, confirmed: 1, active_table: 2
    }
  };

  function getPresentation(type) {
    return PRESENTATIONS[normalize(type)];
  }

  function getStatusLabel(type, status) {
    var p = getPresentation(type);
    if (p.statusLabels[status]) return p.statusLabels[status];
    return String(status || '').replace(/_/g, ' ');
  }

  function getStatusPhaseIndex(type, status, context) {
    var t = normalize(type);
    var c = context || {};
    if (t === 'delivery' && c.deliveryStatus) {
      var ds = String(c.deliveryStatus);
      if (ds === 'on_delivery' || ds === 'delivered') return ds === 'delivered' ? 4 : 3;
      if (ds === 'picked_up') return 3;
    }
    var map = STATUS_PHASE_INDEX[t] || STATUS_PHASE_INDEX.delivery;
    return Object.prototype.hasOwnProperty.call(map, status) ? map[status] : 0;
  }

  function project(type, status, context) {
    var t = normalize(type);
    var p = getPresentation(t);
    var c = context || {};
    var idx = getStatusPhaseIndex(t, status, c);
    if (idx < 0) idx = 0;
    if (idx >= p.phases.length) idx = p.phases.length - 1;

    return {
      type: t,
      label: p.label,
      phases: p.phases,
      currentPhaseIndex: idx,
      currentPhase: p.phases[idx],
      statusLabel: getStatusLabel(t, status),
      completion: p.completion,
      handoffs: p.handoffs.slice(),
      exceptions: p.exceptions.slice(),
      timing: p.timing,
      isException: ['rejected', 'cancelled', 'timeout', 'fulfillment_exception'].indexOf(status) !== -1
    };
  }

  function action(type, surface, status, context) {
    var t = normalize(type);
    var s = String(surface || '');
    var c = context || {};
    var ds = c.deliveryStatus || '';
    if (t === 'delivery') {
      if (s === 'merchant' && status === 'ready') return { label: 'Atur Pengantaran', authority: 'branch_manager', kind: 'dispatch' };
      if (s === 'merchant' && status === 'out_for_delivery') return { label: 'Menunggu Driver', authority: 'driver', kind: 'wait' };
      if (s === 'driver' && (ds === 'assigned' || status === 'ready')) return { label: 'Ambil Pesanan', authority: 'driver', kind: 'pickup' };
      if (s === 'driver' && ds === 'picked_up') return { label: 'Mulai Antar', authority: 'driver', kind: 'start_delivery' };
      if (s === 'driver' && ds === 'on_delivery') return { label: 'Selesai Antar', authority: 'driver', kind: 'complete_delivery' };
    }
    if (t === 'pickup' && s === 'merchant' && status === 'ready') {
      return { label: 'Tunggu Pelanggan', authority: 'fulfillment_handoff', kind: 'wait' };
    }
    if (t === 'dine_in' && s === 'merchant' && status === 'ready') {
      return { label: 'Siap Disajikan', authority: 'dine_in_operational', kind: 'serve' };
    }
    if (t === 'reservation' && s === 'merchant' && status === 'confirmed') {
      return { label: 'Tunggu Kedatangan', authority: 'branch_operational', kind: 'wait' };
    }
    return null;
  }

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

      getPresentation: function () {
        return getPresentation(t);
      },

      project: function (status, context) {
        return project(t, status, context);
      },

      action: function (surface, status, context) {
        return action(t, surface, status, context);
      },

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
            try { l.target.removeEventListener(l.event, l.handler, l.options); } catch (e) {}
            env.listeners.splice(i, 1);
          }
        }
      },

      teardownListeners: function () {
        for (var i = 0; i < env.listeners.length; i++) {
          var l = env.listeners[i];
          try { l.target.removeEventListener(l.event, l.handler, l.options); } catch (e) {}
        }
        env.listeners.length = 0;
      },

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
        if (!env.state.reservationDate) {
          return { ok: false, message: 'Silakan pilih tanggal reservasi terlebih dahulu.' };
        }
        return { ok: true, message: '' };
      },

      payloadFields: function () {
        var ownsTable = env.owns('table');
        var ownsReservation = env.owns('reservation');

        var fulfillment = { type: t };
        var topLevel = {};

        var tableNumber = ownsTable ? (env.state.tableNumber || null) : null;
        var tableIds = ownsTable && Array.isArray(env.state.table_ids) ? env.state.table_ids.slice() : [];
        var reservationDate = ownsReservation ? (env.state.reservationDate || null) : null;
        var reservationTime = ownsReservation ? (env.state.reservationTime || '12:00') : null;
        var guestCount = (ownsTable || ownsReservation) ? (env.state.guestCount || null) : null;

        fulfillment.table_number = tableNumber;
        fulfillment.table_ids = tableIds;
        fulfillment.reservation_date = reservationDate;
        fulfillment.reservation_time = reservationTime;
        fulfillment.guest_count = guestCount;

        topLevel.table_number = tableNumber;
        topLevel.table_ids = tableIds;
        topLevel.reservation_date = reservationDate;
        topLevel.reservation_time = reservationTime;
        topLevel.guest_count = guestCount;

        return { fulfillment: fulfillment, topLevel: topLevel };
      }
    };

    return env;
  }

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

  function switchTo(nextType) {
    var reg = getRegistry();
    var next = reg[normalize(nextType)];
    var prev = getActive();

    if (prev === next) {
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
    PRESENTATIONS: PRESENTATIONS,
    normalize: normalize,
    isSchedulable: isSchedulable,
    getPresentation: getPresentation,
    getStatusLabel: getStatusLabel,
    project: project,
    action: action,
    create: createEnvironment,
    getActive: getActive,
    getState: getState,
    switchTo: switchTo,
    resetAll: resetAll
  };
})();
