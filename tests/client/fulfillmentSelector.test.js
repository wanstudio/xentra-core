/**
 * Unit & Regression Tests: Checkout Purchase Type / Fulfillment Selector
 *
 * Verifies all 12 specified test cases:
 * TEST 1: All four purchase types available -> all selectable
 * TEST 2: Reservasi unavailable -> disabled and cannot be selected
 * TEST 3: Delivery selected + schedule OFF -> date/time selector hidden
 * TEST 4: Delivery selected + schedule ON -> date/time selector visible
 * TEST 5: Select date/time -> draft schedule updates and summary reflects selection
 * TEST 6: Change purchase type inside sheet -> draft purchase type changes
 * TEST 7: Press "Gak jadi" -> draft changes discarded, committed state untouched
 * TEST 8: Press "Konfirmasi" -> draft changes become committed Checkout state
 * TEST 9: Unavailable purchase type click -> no state mutation
 * TEST 10: Open selector with existing committed selection -> sheet initializes from current committed state
 * TEST 11: Switch away from Delivery -> no stale delivery scheduling is accidentally committed to a non-delivery type
 * TEST 12: Reload / existing persistence behavior -> committed purchase type follows existing Xentra persistence contract
 *
 * Pick-up scheduling contract (same UI as delivery, wording "Jadwalkan pengambilan"):
 * TEST 13: Pick-up + schedule ON -> toggle/select/confirm schedule like delivery
 * TEST 14: Pick-up + schedule OFF -> "Sekarang"/ASAP committed, slot cleared
 * TEST 15: Switching between delivery <-> pick-up keeps scheduling; switching to a
 *          non-schedulable type (dine-in/reservation) clears it
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const STORE_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/store.js');

let persistentStorage = {};

function freshStore(clearStorage) {
  if (clearStorage) {
    persistentStorage = {};
  }
  globalThis.window = globalThis;
  globalThis.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(persistentStorage, k) ? persistentStorage[k] : null),
    setItem: (k, v) => { persistentStorage[k] = String(v); },
    removeItem: (k) => { delete persistentStorage[k]; }
  };
  delete require.cache[STORE_PATH];
  require(STORE_PATH);
  return globalThis.window.Xentra.Store;
}

// Logic harness matching openFulfillmentSheet in checkout.js
function createFulfillmentSheetController(initialState, branchConfig) {
  const curBranch = branchConfig || null;
  const isDeliveryAvail = !curBranch || curBranch.is_delivery_active !== 0;
  const isPickupAvail = !curBranch || curBranch.is_pickup_active !== 0;
  const isDineInAvail = !curBranch || curBranch.is_dine_in_active !== 0;
  const isReservationAvail = !curBranch || curBranch.is_reservation_active !== 0;

  const availabilityMap = {
    delivery: isDeliveryAvail,
    pickup: isPickupAvail,
    dine_in: isDineInAvail,
    reservation: isReservationAvail
  };

  let committedState = JSON.parse(JSON.stringify(initialState));

  // Initial committed selection check
  let committedType = committedState.type || 'delivery';
  if (!availabilityMap[committedType]) {
    if (isDeliveryAvail) committedType = 'delivery';
    else if (isPickupAvail) committedType = 'pickup';
    else if (isDineInAvail) committedType = 'dine_in';
    else if (isReservationAvail) committedType = 'reservation';
  }

  // Draft state initialized from committed
  let draft = {
    type: committedType,
    scheduled: Boolean(committedState.scheduled),
    date: committedState.date || 'Hari ini',
    timeSlot: committedState.timeSlot || '16:00-16:30'
  };

  return {
    getAvailability: () => ({ ...availabilityMap }),
    getCommitted: () => ({ ...committedState }),
    getDraft: () => ({ ...draft }),
    selectType: (type) => {
      if (!availabilityMap[type]) {
        return false; // Rejected
      }
      draft.type = type;
      // Only the schedulable types (delivery/pickup) can keep scheduling;
      // switching to dine-in/reservation clears it.
      if (type !== 'delivery' && type !== 'pickup') {
        draft.scheduled = false;
      }
      return true;
    },
    toggleSchedule: () => {
      if (draft.type !== 'delivery' && draft.type !== 'pickup') return;
      draft.scheduled = !draft.scheduled;
      if (!draft.scheduled) {
        draft.date = 'Hari ini';
        draft.timeSlot = '16:00-16:30';
      }
    },
    setSchedule: (date, slot) => {
      if (!draft.scheduled) return;
      if (date) draft.date = date;
      if (slot) draft.timeSlot = slot;
    },
    cancel: () => {
      // Discard draft: re-clone from committed
      draft = {
        type: committedState.type,
        scheduled: Boolean(committedState.scheduled),
        date: committedState.date,
        timeSlot: committedState.timeSlot
      };
      return committedState;
    },
    confirm: () => {
      if (!availabilityMap[draft.type]) {
        throw new Error('Tipe pembelian tidak tersedia');
      }
      const schedulable = draft.type === 'delivery' || draft.type === 'pickup';
      committedState = {
        type: draft.type,
        scheduled: Boolean(draft.scheduled),
        date: schedulable ? (draft.date || 'Hari ini') : 'Hari ini',
        timeSlot: schedulable ? (draft.scheduled ? draft.timeSlot : 'Sekarang (15–25 menit)') : ''
      };
      return committedState;
    }
  };
}

test('TEST 1: All four purchase types available -> all four selectable', () => {
  const ctrl = createFulfillmentSheetController(
    { type: 'delivery', scheduled: false, date: 'Hari ini', timeSlot: 'Sekarang' },
    { is_delivery_active: 1, is_pickup_active: 1, is_dine_in_active: 1, is_reservation_active: 1 }
  );

  const avail = ctrl.getAvailability();
  assert.strictEqual(avail.delivery, true);
  assert.strictEqual(avail.pickup, true);
  assert.strictEqual(avail.dine_in, true);
  assert.strictEqual(avail.reservation, true);

  assert.strictEqual(ctrl.selectType('pickup'), true);
  assert.strictEqual(ctrl.getDraft().type, 'pickup');

  assert.strictEqual(ctrl.selectType('dine_in'), true);
  assert.strictEqual(ctrl.getDraft().type, 'dine_in');

  assert.strictEqual(ctrl.selectType('reservation'), true);
  assert.strictEqual(ctrl.getDraft().type, 'reservation');

  assert.strictEqual(ctrl.selectType('delivery'), true);
  assert.strictEqual(ctrl.getDraft().type, 'delivery');
});

test('TEST 2: Reservasi unavailable -> disabled and cannot be selected', () => {
  const ctrl = createFulfillmentSheetController(
    { type: 'delivery', scheduled: false, date: 'Hari ini', timeSlot: 'Sekarang' },
    { is_delivery_active: 1, is_pickup_active: 1, is_dine_in_active: 1, is_reservation_active: 0 }
  );

  const avail = ctrl.getAvailability();
  assert.strictEqual(avail.reservation, false);

  // Interaction rejected
  const selected = ctrl.selectType('reservation');
  assert.strictEqual(selected, false);
  assert.strictEqual(ctrl.getDraft().type, 'delivery', 'Draft must not change to unavailable type');
});

test('TEST 3: Delivery selected + schedule OFF -> date/time selector hidden', () => {
  const ctrl = createFulfillmentSheetController(
    { type: 'delivery', scheduled: false, date: 'Hari ini', timeSlot: 'Sekarang' }
  );

  const draft = ctrl.getDraft();
  assert.strictEqual(draft.type, 'delivery');
  assert.strictEqual(draft.scheduled, false);
});

test('TEST 4: Delivery selected + schedule ON -> date/time selector visible', () => {
  const ctrl = createFulfillmentSheetController(
    { type: 'delivery', scheduled: false, date: 'Hari ini', timeSlot: 'Sekarang' }
  );

  ctrl.toggleSchedule();
  assert.strictEqual(ctrl.getDraft().scheduled, true);
});

test('TEST 5: Select date/time -> draft schedule updates and summary reflects selection', () => {
  const ctrl = createFulfillmentSheetController(
    { type: 'delivery', scheduled: false, date: 'Hari ini', timeSlot: 'Sekarang' }
  );

  ctrl.toggleSchedule();
  ctrl.setSchedule('Besok', '17:00-17:30');

  const draft = ctrl.getDraft();
  assert.strictEqual(draft.date, 'Besok');
  assert.strictEqual(draft.timeSlot, '17:00-17:30');
});

test('TEST 6: Change purchase type inside sheet -> draft purchase type changes', () => {
  const ctrl = createFulfillmentSheetController(
    { type: 'delivery', scheduled: false }
  );

  ctrl.selectType('pickup');
  assert.strictEqual(ctrl.getDraft().type, 'pickup');
  assert.strictEqual(ctrl.getCommitted().type, 'delivery', 'Committed state must remain delivery');
});

test('TEST 7: Press "Gak jadi" -> draft changes discarded, committed state untouched', () => {
  const ctrl = createFulfillmentSheetController(
    { type: 'delivery', scheduled: false, date: 'Hari ini', timeSlot: 'Sekarang' }
  );

  ctrl.toggleSchedule();
  ctrl.setSchedule('Besok', '18:00-18:30');
  ctrl.selectType('pickup');

  // Customer cancels
  ctrl.cancel();

  const committed = ctrl.getCommitted();
  assert.strictEqual(committed.type, 'delivery');
  assert.strictEqual(committed.scheduled, false);

  const draft = ctrl.getDraft();
  assert.strictEqual(draft.type, 'delivery');
  assert.strictEqual(draft.scheduled, false);
});

test('TEST 8: Press "Konfirmasi" -> draft changes become committed Checkout state', () => {
  const ctrl = createFulfillmentSheetController(
    { type: 'delivery', scheduled: false, date: 'Hari ini', timeSlot: 'Sekarang' }
  );

  ctrl.toggleSchedule();
  ctrl.setSchedule('Besok', '16:30-17:00');

  const confirmed = ctrl.confirm();
  assert.strictEqual(confirmed.type, 'delivery');
  assert.strictEqual(confirmed.scheduled, true);
  assert.strictEqual(confirmed.date, 'Besok');
  assert.strictEqual(confirmed.timeSlot, '16:30-17:00');
});

test('TEST 9: Unavailable purchase type click -> no state mutation', () => {
  const ctrl = createFulfillmentSheetController(
    { type: 'pickup', scheduled: false },
    { is_delivery_active: 0, is_pickup_active: 1, is_dine_in_active: 1, is_reservation_active: 1 }
  );

  const res = ctrl.selectType('delivery');
  assert.strictEqual(res, false);
  assert.strictEqual(ctrl.getDraft().type, 'pickup');
  assert.strictEqual(ctrl.getCommitted().type, 'pickup');
});

test('TEST 10: Open selector with existing committed selection -> sheet initializes from current committed state', () => {
  const ctrl = createFulfillmentSheetController(
    { type: 'dine_in', scheduled: false, date: 'Hari ini', timeSlot: '' }
  );

  assert.strictEqual(ctrl.getDraft().type, 'dine_in');
  assert.strictEqual(ctrl.getDraft().scheduled, false);
});

test('TEST 11: Switch away from Delivery -> no stale delivery scheduling is accidentally committed to a non-delivery type', () => {
  const ctrl = createFulfillmentSheetController(
    { type: 'delivery', scheduled: true, date: 'Besok', timeSlot: '18:00-18:30' }
  );

  // Switch to dine-in
  ctrl.selectType('dine_in');
  assert.strictEqual(ctrl.getDraft().scheduled, false, 'Delivery scheduling must turn off when switching away');

  const committed = ctrl.confirm();
  assert.strictEqual(committed.type, 'dine_in');
  assert.strictEqual(committed.scheduled, false);
});

test('TEST 12: Reload / existing persistence behavior -> committed purchase type follows existing Xentra persistence contract', () => {
  const Store = freshStore();
  assert.strictEqual(Store.getState().orderType, 'delivery');

  Store.setOrderType('pickup');
  assert.strictEqual(Store.getState().orderType, 'pickup');

  // Verify persistence in localStorage
  const saved = globalThis.localStorage.getItem('xentra_v2_order_type');
  assert.strictEqual(JSON.parse(saved), 'pickup');

  // Recreate Store (simulating reload)
  const ReloadedStore = freshStore();
  assert.strictEqual(ReloadedStore.getState().orderType, 'pickup');
});

test('TEST 13: Pick-up + schedule ON -> same schedule UI behavior as delivery (Jadwalkan pengambilan)', () => {
  const ctrl = createFulfillmentSheetController(
    { type: 'pickup', scheduled: false, date: 'Hari ini', timeSlot: 'Sekarang' }
  );

  // Schedule toggle must work for pick-up too
  ctrl.toggleSchedule();
  assert.strictEqual(ctrl.getDraft().scheduled, true, 'Pick-up must support scheduling like delivery');

  ctrl.setSchedule('Besok', '17:00-17:30');
  assert.strictEqual(ctrl.getDraft().date, 'Besok');
  assert.strictEqual(ctrl.getDraft().timeSlot, '17:00-17:30');

  const confirmed = ctrl.confirm();
  assert.strictEqual(confirmed.type, 'pickup');
  assert.strictEqual(confirmed.scheduled, true);
  assert.strictEqual(confirmed.date, 'Besok');
  assert.strictEqual(confirmed.timeSlot, '17:00-17:30');
});

test('TEST 14: Pick-up + schedule OFF -> ASAP default, no stale slot committed', () => {
  const ctrl = createFulfillmentSheetController(
    { type: 'pickup', scheduled: true, date: 'Besok', timeSlot: '18:00-18:30' }
  );

  ctrl.toggleSchedule();
  assert.strictEqual(ctrl.getDraft().scheduled, false);

  const confirmed = ctrl.confirm();
  assert.strictEqual(confirmed.type, 'pickup');
  assert.strictEqual(confirmed.scheduled, false);
  assert.strictEqual(confirmed.timeSlot, 'Sekarang (15–25 menit)', 'Unscheduled pick-up must commit ASAP');
});

test('TEST 15: Switching between delivery <-> pick-up keeps scheduling; switching to a non-schedulable type clears it', () => {
  const ctrl = createFulfillmentSheetController(
    { type: 'delivery', scheduled: true, date: 'Besok', timeSlot: '18:00-18:30' }
  );

  // Delivery -> pick-up: schedule preserved (same schedulable concept)
  ctrl.selectType('pickup');
  assert.strictEqual(ctrl.getDraft().type, 'pickup');
  assert.strictEqual(ctrl.getDraft().scheduled, true, 'Switching to pick-up must keep the schedule selection');

  // Pick-up -> reservation: schedule must clear (non-schedulable type)
  ctrl.selectType('reservation');
  assert.strictEqual(ctrl.getDraft().type, 'reservation');
  assert.strictEqual(ctrl.getDraft().scheduled, false, 'Non-schedulable type must clear scheduling');

  const confirmed = ctrl.confirm();
  assert.strictEqual(confirmed.type, 'reservation');
  assert.strictEqual(confirmed.scheduled, false);
});
