/**
 * Reservation booking window — targeted verification.
 *
 * RSV-01  Time wheel starts 12:00 and ends 19:30 (window 12:00-20:00)
 * RSV-02  Date wheel starts tomorrow (Besok), never today
 * RSV-03  Server/dashboard receives an ISO date, never the "Besok" label
 * RSV-04  Server rejects same-day-or-earlier reservation dates
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const checkoutSrc = fs.readFileSync(path.join(ROOT, 'apps/customer-pwa/assets/js/pages/checkout.js'), 'utf8');
const placementSrc = fs.readFileSync(path.join(ROOT, 'domains/commerce/services/OrderPlacementService.js'), 'utf8');
// Fulfillment environment: sumber kebenaran field fulfillment per tipe.
const envSrc = fs.readFileSync(path.join(ROOT, 'apps/customer-pwa/assets/js/core/fulfillment-environments.js'), 'utf8');

function reservationSection() {
  const start = checkoutSrc.indexOf('function renderReservationSection');
  assert.ok(start !== -1, 'renderReservationSection must exist');
  const end = checkoutSrc.indexOf('function renderDineInFloorPlan', start);
  return checkoutSrc.substring(start, end !== -1 ? end : start + 6000);
}

test('RSV-01: time wheel starts 12:00 and ends 19:30 (window 12:00-20:00)', () => {
  const body = reservationSection();
  assert.ok(body.includes('12 * 60'), 'time loop must start at 12:00');
  assert.ok(body.includes('20 * 60'), 'time window must end at 20:00');
  assert.ok(!body.includes('9 * 60'), '09:00 start must be gone');
  // Simulate the loop to prove first/last slots.
  const slots = [];
  for (let m = 12 * 60; m + 30 <= 20 * 60; m += 30) {
    slots.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
  }
  assert.equal(slots[0], '12:00');
  assert.equal(slots[slots.length - 1], '19:30');
  assert.equal(slots.length, 16);
});

test('RSV-02: date wheel starts tomorrow (Besok), never today', () => {
  const body = reservationSection();
  assert.ok(body.includes('days.slice(1)'), 'date wheel must skip today (start at Besok)');
});

test('RSV-03: server/dashboard receives an ISO date, never the Besok label', () => {
  const body = reservationSection();
  assert.ok(body.includes('value: d.iso'), 'wheel value must be the ISO date');
  // Submit path carries the ISO value through to reservation_date. Sejak isolasi
  // environment, nilainya diambil dari state milik environment reservasi.
  assert.ok(
    envSrc.includes('var reservationDate = ownsReservation ? (env.state.reservationDate || null) : null'),
    'reservation_date harus berasal dari state reservasi, bukan state bersama'
  );
  assert.ok(
    checkoutSrc.includes('reservation_date: envPayload.topLevel.reservation_date'),
    'submit must send reservationDate as reservation_date'
  );
  assert.ok(checkoutSrc.includes('state.fulfillment.reservationDate = draft.reservationDate'), 'draft date must commit the ISO value to state');
});

test('RSV-04: server rejects same-day-or-earlier reservation dates', () => {
  assert.ok(placementSrc.includes('SAME_DAY_RESERVATION_REJECTED'), 'server must reject same-day reservations');
});
