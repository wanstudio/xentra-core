'use strict';

const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const RouteService = require('../../server/services/RouteService');

const ORIG_GET = axios.get;

after(() => { axios.get = ORIG_GET; });

test('RouteService.searchAddress — Mapbox Search Box Suggest returns normalized POI/address results with hydrated coordinates', async () => {
  axios.get = async (url) => {
    if (url.includes('/searchbox/v1/suggest')) {
      return {
        data: {
          suggestions: [
            {
              name: 'Alfamart Melati',
              mapbox_id: 'mbx_sug_01',
              feature_type: 'poi',
              address: 'Jl. Mawar III No.356',
              full_address: 'Jl. Mawar III No.356, Pringsewu, 35371, Indonesia',
              place_formatted: 'Pringsewu, 35371, Indonesia'
            }
          ]
        }
      };
    }
    if (url.includes('/searchbox/v1/retrieve/mbx_sug_01')) {
      return {
        data: {
          features: [
            {
              geometry: { coordinates: [104.98175, -5.36256] },
              properties: {
                name: 'Alfamart Melati',
                full_address: 'Jl. Mawar III No.356, Pringsewu, 35371, Indonesia'
              }
            }
          ]
        }
      };
    }
    return { data: {} };
  };

  const results = await RouteService.searchAddress('Alfamart', -5.3621, 104.9812, 'sess_test_1');
  assert.ok(Array.isArray(results), 'results should be an array');
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].title, 'Alfamart Melati');
  assert.strictEqual(results[0].provider, 'mapbox_searchbox');
  assert.strictEqual(results[0].latitude, -5.36256);
  assert.strictEqual(results[0].longitude, 104.98175);
  assert.ok(results[0].distance_meters != null, 'distance_meters should be computed with proximity');
});

test('RouteService.searchAddress — short queries (< 3 chars) return empty array without network calls', async () => {
  let called = false;
  axios.get = async () => {
    called = true;
    return { data: {} };
  };

  const results = await RouteService.searchAddress('ab');
  assert.deepStrictEqual(results, []);
  assert.strictEqual(called, false, 'No network call for queries < 3 chars');
});

test('RouteService.searchAddress — falls back to Nominatim when Mapbox Search Box fails', async () => {
  axios.get = async (url) => {
    if (url.includes('/searchbox/v1/suggest')) {
      throw new Error('SearchBox Rate Limited');
    }
    if (url.includes('nominatim.openstreetmap.org/search')) {
      return {
        data: [
          {
            lat: '-5.3650',
            lon: '104.9830',
            display_name: 'Jl. Ahmad Yani, Pringsewu, Lampung, Indonesia'
          }
        ]
      };
    }
    return { data: {} };
  };

  const results = await RouteService.searchAddress('Ahmad Yani', -5.3621, 104.9812);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].title, 'Jl. Ahmad Yani');
  assert.strictEqual(results[0].provider, 'nominatim');
  assert.strictEqual(results[0].latitude, -5.365);
  assert.strictEqual(results[0].longitude, 104.983);
});

test('RouteService.searchAddress — returns empty array when both Mapbox and Nominatim fail', async () => {
  axios.get = async () => {
    throw new Error('Total network failure');
  };

  const results = await RouteService.searchAddress('Lokasi Tidak Ada');
  assert.deepStrictEqual(results, []);
});

test('RouteService.retrieveAddress — retrieves exact coordinates and address for mapbox_id', async () => {
  axios.get = async (url) => {
    if (url.includes('/searchbox/v1/retrieve/mbx_ret_99')) {
      return {
        data: {
          features: [
            {
              geometry: { coordinates: [105.2668, -5.3971] },
              properties: {
                name: 'Toko Buku Gramedia',
                full_address: 'Jl. Raden Intan No. 63, Bandar Lampung, Indonesia'
              }
            }
          ]
        }
      };
    }
    return { data: {} };
  };

  const detail = await RouteService.retrieveAddress('mbx_ret_99', 'sess_test_2');
  assert.ok(detail != null);
  assert.strictEqual(detail.title, 'Toko Buku Gramedia');
  assert.strictEqual(detail.latitude, -5.3971);
  assert.strictEqual(detail.longitude, 105.2668);
  assert.strictEqual(detail.provider, 'mapbox_searchbox');
});

test('RouteService.retrieveAddress — returns null if mapbox_id not found or request fails', async () => {
  axios.get = async () => {
    throw new Error('Not found');
  };

  const detail = await RouteService.retrieveAddress('mbx_invalid');
  assert.strictEqual(detail, null);

  const emptyDetail = await RouteService.retrieveAddress('');
  assert.strictEqual(emptyDetail, null);
});
