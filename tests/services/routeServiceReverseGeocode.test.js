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

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 1: Search Box Reverse Candidate Prioritization & Fallback Hierarchy
// ═══════════════════════════════════════════════════════════════════════════════

function mockSearchBox(features) {
  axios.get = async (url) => {
    if (url.includes('/searchbox/v1/reverse')) {
      return { data: { features: features || [] } };
    }
    if (url.includes('/geocode/v6/reverse')) {
      return { data: { features: [] } };
    }
    return { data: {} };
  };
}

test('Case A — POI candidate takes priority over neighborhood in Search Box Reverse', async () => {
  mockSearchBox([
    {
      geometry: { coordinates: [104.98108, -5.36219] },
      properties: {
        feature_type: 'poi',
        name: 'MU STATIONERY',
        address: 'Jl. Melati 3',
        full_address: 'Jl. Melati 3, Pringsewu, 35371, Indonesia',
        place_formatted: 'Pringsewu, 35371, Indonesia',
        context: {
          street: { name: 'Jl. Melati 3' },
          neighborhood: { name: 'Pringsewu Timur' },
          place: { name: 'Pringsewu' }
        }
      }
    },
    {
      geometry: { coordinates: [104.98108, -5.36219] },
      properties: {
        feature_type: 'neighborhood',
        name: 'Pringsewu Timur',
        full_address: 'Pringsewu Timur, Pringsewu, Indonesia',
        place_formatted: 'Pringsewu, Indonesia'
      }
    }
  ]);

  const res = await RouteService.reverseGeocode(-5.3621, 104.9812);
  assert.strictEqual(res.title, 'MU STATIONERY', 'POI name must become the title');
  assert.strictEqual(res.provider, 'mapbox_searchbox');
  assert.ok(res.address.includes('MU STATIONERY') || res.address.includes('Jl. Melati 3'));
  assert.notStrictEqual(res.title, 'Pringsewu Timur', 'Must not fall back to neighborhood when POI exists');
});

test('Case B — Address candidate takes priority over district/region', async () => {
  mockSearchBox([
    {
      geometry: { coordinates: [106.8456, -6.2088] },
      properties: {
        feature_type: 'address',
        name: 'Jl. Pegangsaan Timur No. 56',
        full_address: 'Jl. Pegangsaan Timur No. 56, Menteng, Jakarta Pusat',
        context: {
          street: { name: 'Jl. Pegangsaan Timur' },
          neighborhood: { name: 'Menteng' },
          place: { name: 'Jakarta Pusat' }
        }
      }
    },
    {
      geometry: { coordinates: [106.8456, -6.2088] },
      properties: {
        feature_type: 'district',
        name: 'Jakarta Pusat',
        full_address: 'Jakarta Pusat, DKI Jakarta'
      }
    }
  ]);

  const res = await RouteService.reverseGeocode(-6.2088, 106.8456);
  assert.strictEqual(res.title, 'Jl. Pegangsaan Timur No. 56');
  assert.strictEqual(res.road, 'Jl. Pegangsaan Timur');
  assert.notStrictEqual(res.title, 'Jakarta Pusat');
});

test('Case C — Only street available resolves to street name', async () => {
  mockSearchBox([
    {
      geometry: { coordinates: [104.9812, -5.3621] },
      properties: {
        feature_type: 'street',
        name: 'Jl. Jenderal Sudirman',
        full_address: 'Jl. Jenderal Sudirman, Pringsewu',
        context: {
          neighborhood: { name: 'Pringsewu Barat' },
          place: { name: 'Pringsewu' }
        }
      }
    }
  ]);

  const res = await RouteService.reverseGeocode(-5.3621, 104.9812);
  assert.strictEqual(res.title, 'Jl. Jenderal Sudirman');
  assert.strictEqual(res.road, 'Jl. Jenderal Sudirman');
  assert.strictEqual(res.neighborhood, 'Pringsewu Barat');
});

test('Case D — Only neighborhood available in Geocoding v6 is accepted as broad context', async () => {
  axios.get = async (url) => {
    if (url.includes('/searchbox/v1/reverse')) {
      return { data: { features: [] } };
    }
    if (url.includes('/geocode/v6/reverse')) {
      return {
        data: {
          features: [
            {
              properties: {
                feature_type: 'neighborhood',
                name: 'Pringsewu Timur',
                full_address: 'Pringsewu Timur, Pringsewu, Lampung',
                context: {
                  locality: { name: 'Pringsewu' },
                  place: { name: 'Pringsewu' }
                }
              }
            }
          ]
        }
      };
    }
    return { data: {} };
  };

  const res = await RouteService.reverseGeocode(-5.3621, 104.9812);
  assert.strictEqual(res.title, 'Pringsewu Timur');
  assert.strictEqual(res.neighborhood, 'Pringsewu Timur');
  assert.strictEqual(res.provider, 'mapbox_geocoding_v6');
});

test('Case E — District-only feature in Geocoding v6 must not leak into road', async () => {
  axios.get = async (url) => {
    if (url.includes('/searchbox/v1/reverse')) {
      return { data: { features: [] } };
    }
    if (url.includes('/geocode/v6/reverse')) {
      return {
        data: {
          features: [
            {
              properties: {
                feature_type: 'district',
                name: 'Pringsewu',
                full_address: 'Pringsewu, Lampung, Indonesia'
              }
            }
          ]
        }
      };
    }
    return { data: {} };
  };

  const res = await RouteService.reverseGeocode(-5.3621, 104.9812);
  assert.strictEqual(res.road, '', 'district must not leak into road');
});

test('Case F — Postcode in Search Box Reverse must never become road or title', async () => {
  mockSearchBox([
    {
      geometry: { coordinates: [112.7154, -7.2912] },
      properties: {
        feature_type: 'postcode',
        name: '60225',
        full_address: '60225, Surabaya'
      }
    }
  ]);

  const res = await RouteService.reverseGeocode(-7.2912, 112.7154);
  assert.notStrictEqual(res.title, '60225');
  assert.notStrictEqual(res.road, '60225');
});

test('Case G — Country/Region in Search Box Reverse must never become road or title', async () => {
  mockSearchBox([
    {
      geometry: { coordinates: [112.7154, -7.2912] },
      properties: {
        feature_type: 'country',
        name: 'Indonesia',
        full_address: 'Indonesia'
      }
    }
  ]);

  const res = await RouteService.reverseGeocode(-7.2912, 112.7154);
  assert.notStrictEqual(res.road, 'Indonesia');
  assert.strictEqual(res.road, '');
});

test('Case H — When Search Box Reverse throws, falls back gracefully to Geocoding v6', async () => {
  axios.get = async (url) => {
    if (url.includes('/searchbox/v1/reverse')) {
      throw new Error('SearchBox 503 Service Unavailable');
    }
    if (url.includes('/geocode/v6/reverse')) {
      return {
        data: {
          features: [
            {
              properties: {
                feature_type: 'street',
                name: 'Jl. Ahmad Yani',
                full_address: 'Jl. Ahmad Yani, Pringsewu',
                context: {
                  place: { name: 'Pringsewu' }
                }
              }
            }
          ]
        }
      };
    }
    return { data: {} };
  };

  const res = await RouteService.reverseGeocode(-5.3621, 104.9812);
  assert.strictEqual(res.title, 'Jl. Ahmad Yani');
  assert.strictEqual(res.road, 'Jl. Ahmad Yani');
  assert.strictEqual(res.provider, 'mapbox_geocoding_v6');
});

test('Case I — When all remote providers fail, returns safe coordinate-only fallback', async () => {
  axios.get = async () => {
    throw new Error('Network timeout');
  };

  const res = await RouteService.reverseGeocode(-5.3621, 104.9812);
  assert.strictEqual(res.title, 'Titik Terpilih');
  assert.strictEqual(res.provider, 'coordinate_fallback');
  assert.ok(res.address.includes('-5.3621') && res.address.includes('104.9812'));
});