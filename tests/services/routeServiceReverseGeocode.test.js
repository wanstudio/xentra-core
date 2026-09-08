/**
 * RouteService.reverseGeocode — Mapbox Geocoding v6 structured-context
 * regression tests.
 *
 * Regression: when Mapbox returns a NON-ADDRESSABLE top feature (postcode,
 * country, region, district), the fallback `road: road || neighborhood || name`
 * leaked the feature name (e.g. the postal code "60225") as the road/address
 * title. Fixed server-side by excluding non-addressable feature types; these
 * tests lock that behavior in.
 */
'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const RouteService = require('../../server/services/RouteService');

const ORIG_GET = axios.get;

after(() => { axios.get = ORIG_GET; });

function stubMapbox(feature) {
  axios.get = async () => ({ data: { features: feature ? [feature] : [] } });
}

test('RouteService reverseGeocode — postcode feature NEVER leaks as road (regression: 60225 title bug)', async () => {
  stubMapbox({
    properties: {
      feature_type: 'postcode',
      name: '60225',
      full_address: '60225, Darmo, Wonokromo, Surabaya, East Java',
      context: {
        postcode: { name: '60225' },
        neighborhood: { name: 'Darmo' },
        locality: { name: 'Wonokromo' },
        place: { name: 'Surabaya' }
      }
    }
  });

  const res = await RouteService.reverseGeocode(-7.2912, 112.7154);
  assert.strictEqual(res.road, 'Darmo', 'road falls back to neighborhood context — never the postcode name');
  assert.notStrictEqual(res.road, '60225');
  assert.ok(!/^\d{4,6}$/.test(res.road), 'road must never be a pure numeric postcode');
  assert.strictEqual(res.neighborhood, 'Darmo', 'context neighborhood still resolves');
  assert.strictEqual(res.locality, 'Wonokromo');
  assert.strictEqual(res.city, 'Surabaya');
  assert.ok(res.address.includes('60225'), 'full address keeps the postal code for context');
});

test('RouteService reverseGeocode — bare postcode feature with NO context resolves to empty road (acute bug)', async () => {
  // The exact failure the fix targets: Mapbox returns ONLY a postcode feature
  // (no street, no address, no neighborhood context). Pre-fix this leaked
  // name "60225" into road via the name fallback.
  stubMapbox({
    properties: {
      feature_type: 'postcode',
      name: '60225',
      full_address: '60225'
    }
  });

  const res = await RouteService.reverseGeocode(-7.2912, 112.7154);
  assert.strictEqual(res.road, '', 'bare postcode must not become the road');
  assert.notStrictEqual(res.road, '60225');
  assert.ok(res.address.includes('60225'), 'full address keeps the postal code only as context');
});

test('RouteService reverseGeocode — street feature still resolves the road name', async () => {
  stubMapbox({
    properties: {
      feature_type: 'street',
      name: 'Jalan Darmo',
      full_address: 'Jalan Darmo, Wonokromo, Surabaya',
      context: {
        neighborhood: { name: 'Darmo' },
        place: { name: 'Surabaya' }
      }
    }
  });

  const res = await RouteService.reverseGeocode(-7.2912, 112.7154);
  assert.strictEqual(res.road, 'Jalan Darmo');
  assert.strictEqual(res.neighborhood, 'Darmo');
});

test('RouteService reverseGeocode — country/region feature cannot leak into road', async () => {
  stubMapbox({
    properties: {
      feature_type: 'country',
      name: 'Indonesia',
      full_address: 'Indonesia'
    }
  });

  const res = await RouteService.reverseGeocode(-7.2912, 112.7154);
  assert.strictEqual(res.road, '', 'non-addressable country feature must not become the road');
});