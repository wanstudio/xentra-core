/**
 * XENTRA DELIVERY SCHEDULE — device-local timezone slot calculation
 *
 * Locked rule under test:
 *   - current time = DEVICE local timezone (never server/WordPress).
 *   - interval 30 minutes.
 *   - first slot = now + 1 hour, then ROUND UP to next 30-minute boundary.
 *     Order is mandatory: +1h FIRST, round UP SECOND.
 *   - a first slot that lands after midnight belongs to the NEXT device day.
 *   - ASAP stays the default; scheduled orders store a canonical, timezone-
 *     aware ISO timestamp derived from the device-local choice.
 *
 * REQUIRED MATRIX:
 *   1. 13:00 -> first slot 14:00
 *   2. 13:01 -> 14:30
 *   3. 13:29 -> 14:30
 *   4. 13:30 -> 14:30
 *   5. 13:31 -> 15:00
 *   6. 13:56 -> 15:00
 *   7. 23:40 -> next day 01:00 (labelled Besok, never "Hari ini")
 *   8. device timezone different from server timezone
 *   9. device timezone positive/negative offset vs server
 *  10. off day
 *  11. operating hours boundary
 *  12. ASAP stays default (server test in apiEndpoints)
 *  13. scheduled order stores the correct time/date (server test in apiEndpoints)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MODULE_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/delivery-schedule.js');
const m = require(MODULE_PATH);

function at(y, mo, d, h, mi) {
  return new Date(y, mo, d, h, mi);
}

function firstSlotLabel(y, mo, d, h, mi) {
  return m.minutesLabel(m.computeFirstSlotStart(at(y, mo, d, h, mi)).minutes);
}

function dayPools(y, mo, d, h, mi) {
  return m.buildDayPools(at(y, mo, d, h, mi));
}

// ── Locked math: now + 1h → round UP to 30-min boundary ──

test('1: device 13:00 -> +1h = 14:00 (already on boundary) -> first slot 14:00', () => {
  assert.strictEqual(firstSlotLabel(2026, 8, 9, 13, 0), '14:00');
});

test('2: device 13:01 -> 14:01 -> round UP -> 14:30', () => {
  assert.strictEqual(firstSlotLabel(2026, 8, 9, 13, 1), '14:30');
});

test('3: device 13:29 -> 14:29 -> round UP -> 14:30', () => {
  assert.strictEqual(firstSlotLabel(2026, 8, 9, 13, 29), '14:30');
});

test('4: device 13:30 -> 14:30 (boundary) -> first slot 14:30', () => {
  assert.strictEqual(firstSlotLabel(2026, 8, 9, 13, 30), '14:30');
});

test('5: device 13:31 -> 14:31 -> round UP -> 15:00', () => {
  assert.strictEqual(firstSlotLabel(2026, 8, 9, 13, 31), '15:00');
});

test('6: device 13:56 -> 14:56 -> round UP -> 15:00', () => {
  assert.strictEqual(firstSlotLabel(2026, 8, 9, 13, 56), '15:00');
});

test('7: device 23:40 -> 00:40 next day -> round UP 01:00 -> first pool is Besok 01:00-01:30, never "Hari ini"', () => {
  const pools = dayPools(2026, 8, 9, 23, 40);
  assert.strictEqual(pools[0].day.value, 'Hari ini');
  assert.strictEqual(pools[0].slots.length, 0, 'Hari ini must offer no slots when the first slot belongs to tomorrow');
  assert.strictEqual(pools[1].day.value, 'Besok');
  assert.strictEqual(pools[1].slots[0].value, '01:00-01:30');
  // The first slot must never appear under "Hari ini"
  const todayLabels = pools[0].slots.map((s) => s.value);
  assert.ok(!todayLabels.includes('01:00-01:30'));
});

test('7b: day-label resolution for ISO uses the DEVICE-local calendar (no UTC/toISOString off-by-one)', () => {
  const days = m.buildScheduleDays(at(2026, 8, 9, 23, 40));
  assert.strictEqual(days[0].value, 'Hari ini');
  assert.strictEqual(days[0].iso, '2026-09-09', 'iso must be the device-local date');
  assert.strictEqual(days[1].iso, '2026-09-10');
  // iso must equal the device-LOCAL calendar date, never a server/UTC-derived one
  const localParts = at(2026, 8, 9, 23, 40).toLocaleDateString('sv-SE');
  assert.strictEqual(days[0].iso, localParts, 'device-local date must be used');
  // The no-UTC property itself is proven under explicit device timezones by the
  // subprocess tests (8) & (9) below.
});

// ── Operating hours / off day (module hooks; core has no operating-hours record yet) ──

test('10: off day (window null) -> no slots across all 7 days', () => {
  const pools = m.buildDayPools(at(2026, 8, 9, 13, 56), { opening_time: null, closing_time: null });
  assert.strictEqual(pools.length, 7);
  pools.forEach((p, i) => assert.strictEqual(p.slots.length, 0, `day ${i} must have no slots`));
});

test('11: operating hours boundary clamps slots to [open, close]', () => {
  const pools = m.buildDayPools(at(2026, 8, 9, 13, 56), { opening_time: '10:00', closing_time: '21:00' });
  const today = pools[0].slots;
  // 13:56 -> +1h 14:56 -> round 15:00 -> first legal slot 15:00 (open 10:00 is earlier)
  assert.strictEqual(today[0].value, '15:00-15:30');
  // no slot may cross the 21:00 close boundary
  const last = today[today.length - 1];
  assert.strictEqual(last.value, '20:30-21:00');
  assert.ok(!today.some((s) => m.labelToMinutes(s.value) >= 1270), 'no slot may start at/after 21:10');
});

test('11b: first slot before open is clamped to opening time', () => {
  const pools = m.buildDayPools(at(2026, 8, 9, 8, 0), { opening_time: '10:00', closing_time: '21:00' });
  assert.strictEqual(pools[0].slots[0].value, '10:00-10:30');
});

test('11c: first slot after close -> that day yields nothing (falls to next day window)', () => {
  const pools = m.buildDayPools(at(2026, 8, 9, 21, 30), { opening_time: '10:00', closing_time: '21:00' });
  assert.strictEqual(pools[0].slots.length, 0, 'today has no legal slot');
  assert.strictEqual(pools[1].slots[0].value, '10:00-10:30', 'next day starts at open');
});

// ── Canonical timezone-aware storage (test #13 client half) ──

test('13: selected slot converts to a canonical ISO WITH the device offset', () => {
  const now = at(2026, 8, 9, 13, 56);
  const iso = m.selectedSlotToIso(now, 'Hari ini', '15:00-15:30');
  const offsetMin = -now.getTimezoneOffset();
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const offStr = sign + String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0');
  assert.strictEqual(iso.start, '2026-09-09T15:00:00' + offStr);
  assert.strictEqual(iso.end, '2026-09-09T15:30:00' + offStr);
});

test('13b: day-carry slot resolves to the NEXT device date in ISO', () => {
  const iso = m.selectedSlotToIso(at(2026, 8, 9, 23, 40), 'Besok', '01:00-01:30');
  assert.ok(iso.start.startsWith('2026-09-10T01:00:00'));
  assert.ok(iso.end.startsWith('2026-09-10T01:30:00'));
});

// ── Real device-timezone simulation (subprocess with explicit TZ) ──

function runWithTz(tz, script) {
  const out = execFileSync(process.execPath, ['-e', script], {
    env: Object.assign({}, process.env, { TZ: tz }),
    encoding: 'utf8'
  });
  return JSON.parse(out.trim().split('\n').pop());
}

function tzProbeScript() {
  return `
    const m = require(${JSON.stringify(MODULE_PATH)});
    const now = new Date('2026-09-09T17:30:00Z');
    const first = m.computeFirstSlotStart(now);
    const pools = m.buildDayPools(now);
    console.log(JSON.stringify({
      isoToday: m.buildScheduleDays(now)[0].iso,
      firstSlot: m.minutesLabel(first.minutes),
      secondSlot: m.minutesLabel(first.minutes + m.SLOT_MINUTES),
      todayFirstSlot: pools[0].slots[0] ? pools[0].slots[0].value : null
    }));
  `;
}

test('8: device timezone differs from server (UTC) timezone — the picker follows the DEVICE tz', () => {
  const wib = runWithTz('Asia/Jakarta', tzProbeScript());
  // 2026-09-09T17:30Z in UTC+07 = Sep 10 00:30 device-local.
  assert.strictEqual(wib.isoToday, '2026-09-10', 'device-local date (not the server/UTC date) is Hari ini');
  assert.strictEqual(wib.firstSlot, '01:30'); // 00:30 + 1h = 01:30 (boundary)
  assert.strictEqual(wib.secondSlot, '02:00');
});

test('9: positive vs negative device offset against the same instant produce their own local first slots', () => {
  const wib = runWithTz('Asia/Jakarta', tzProbeScript());
  const ny = runWithTz('America/New_York', tzProbeScript());
  // Same UTC instant: WIB sees Sep 10 00:30; NY sees Sep 9 13:30.
  assert.strictEqual(wib.isoToday, '2026-09-10');
  assert.strictEqual(wib.firstSlot, '01:30');
  assert.strictEqual(ny.isoToday, '2026-09-09');
  assert.strictEqual(ny.firstSlot, '14:30'); // 13:30 + 1h = 14:30 (boundary)
  assert.notStrictEqual(wib.firstSlot, ny.firstSlot, 'slots must depend on the device-local time');
});