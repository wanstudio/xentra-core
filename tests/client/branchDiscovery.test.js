/**
 * P2 HOME / FAST BRANCH DISCOVERY — core/discovery.js contract
 *
 * Home discovery is DISCOVERY ONLY: it uses a cheap straight-line (haversine)
 * proximity computation for presentation. It never does routing, ETA,
 * delivery-cost, payment, stock, eligibility, or acceptance on Home, and the
 * first displayed branch is never a fulfillment commitment.
 *
 * These tests exercise the PURE module `core/discovery.js` (a browser IIFE)
 * inside the same minimal Node harness as cartScope.test.js: `window` shim —
 * discovery.js touches window.Xentra only, no DOM, no localStorage.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const DISCOVERY_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/discovery.js');

function loadDiscovery() {
  globalThis.window = globalThis;
  delete require.cache[DISCOVERY_PATH];
  require(DISCOVERY_PATH);
  return globalThis.window.Xentra.Discovery;
}

// Jakarta landmarks (lat ~-6, lng ~107) used to assert real distance sanity:
// M point (Monas) vs B point (Blok M, ~8km south along the same longitude).
const MONAS = { latitude: -6.1754, longitude: 106.8272 };
const BLOK_M = { latitude: -6.2444, longitude: 106.7986 };

test('distanceKm returns finite positive straight-line km for valid coordinates', () => {
  const D = loadDiscovery();
  const d = D.distanceKm(MONAS.latitude, MONAS.longitude, BLOK_M.latitude, BLOK_M.longitude);
  assert.ok(typeof d === 'number' && isFinite(d), 'distance is a finite number');
  assert.ok(d > 7 && d < 11, 'Blok M is ~8-9 km straight-line from Monas, got ' + d);
  assert.strictEqual(d, D.distanceKm(BLOK_M.latitude, BLOK_M.longitude, MONAS.latitude, MONAS.longitude));
});

test('distanceKm returns 0 for identical coordinates', () => {
  const D = loadDiscovery();
  assert.strictEqual(D.distanceKm(-6.2, 106.8, -6.2, 106.8), 0);
});

test('distanceKm returns null on any non-numeric / missing coordinate', () => {
  const D = loadDiscovery();
  assert.strictEqual(D.distanceKm(null, 106.8, -6.2, 106.8), null);
  assert.strictEqual(D.distanceKm(-6.2, undefined, -6.2, 106.8), null);
  assert.strictEqual(D.distanceKm('abc', 106.8, -6.2, 106.8), null);
});

test('orderBranches without an origin preserves server order untouched', () => {
  const D = loadDiscovery();
  const branches = [
    { id: 3, latitude: -6.24, longitude: 106.79 },
    { id: 1, latitude: -6.17, longitude: 106.82 },
    { id: 2, latitude: -6.30, longitude: 106.85 }
  ];
  const ordered = D.orderBranches(branches, null);
  assert.deepStrictEqual(ordered.map((b) => b.id), [3, 1, 2], 'server order preserved without origin');
  assert.ok(ordered.every((b) => b._distance_km === null), 'no distance measurement without origin');
});

test('orderBranches sorts by ascending straight-line distance when origin is given', () => {
  const D = loadDiscovery();
  const branches = [
    { id: 'far', latitude: BLOK_M.latitude, longitude: BLOK_M.longitude },
    { id: 'near', latitude: MONAS.latitude, longitude: MONAS.longitude },
    { id: 'mid', latitude: -6.20, longitude: 106.82 }
  ];
  const ordered = D.orderBranches(branches, { latitude: MONAS.latitude, longitude: MONAS.longitude });
  assert.strictEqual(ordered[0].id, 'near');
  assert.strictEqual(ordered[2].id, 'far');
  assert.ok(ordered[0]._distance_km <= ordered[1]._distance_km);
  assert.ok(ordered[1]._distance_km <= ordered[2]._distance_km);
});

test('orderBranches places unmeasurable branches LAST preserving server order, without mutation', () => {
  const D = loadDiscovery();
  const branches = [
    { id: 1, latitude: -6.20, longitude: 106.82 },     // measurable
    { id: 2 },                                          // unmeasurable (no coords)
    { id: 3, latitude: -6.26, longitude: 106.85 },     // measurable
    { id: 4 }                                           // unmeasurable (no coords)
  ];
  const origin = { latitude: MONAS.latitude, longitude: MONAS.longitude };
  const ordered = D.orderBranches(branches, origin);

  assert.strictEqual(ordered[0].id, 1);
  assert.strictEqual(ordered[1].id, 3);
  assert.strictEqual(ordered[2].id, 2, 'unmeasurable follows measurable');
  assert.strictEqual(ordered[3].id, 4, 'unmeasurable keep server relative order');

  // Input immutability: the original array and branch objects are untouched.
  assert.strictEqual(branches.length, 4);
  assert.ok(!('_distance_km' in branches[0]), 'source branch is not mutated');
  assert.strictEqual(ordered.length, 4);
});

test('orderBranches rejects a single-branch list gracefully (1 relevant branch → no discovery list)', () => {
  const D = loadDiscovery();
  const single = D.orderBranches([{ id: 'solo', latitude: -6.2, longitude: 106.8 }], null);
  assert.strictEqual(single.length, 1);
  assert.strictEqual(single[0].id, 'solo');
  assert.strictEqual(D.orderBranches(null, null).length, 0, 'null input yields empty list');
  assert.strictEqual(D.orderBranches([], { latitude: -6.2, longitude: 106.8 }).length, 0);
});