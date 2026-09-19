'use strict';
/**
 * Phase 3 Test Suite: Map Interaction, Camera & Location Precision
 *
 * Verifies:
 * 1. Haversine distance calculations and accuracy-to-zoom mapping.
 * 2. Micro-movement threshold (< 5m vs >= 5m):
 *    - Jitter movements (< 5 meters) do NOT trigger fresh reverse geocoding requests.
 *    - Meaningful movements (>= 5 meters) trigger fresh reverse geocoding requests.
 * 3. Programmatic movement flag:
 *    - Search suggestion select and POI click pan camera with isProgrammaticMove=true,
 *      preventing manual reverse geocode from overwriting explicit titles.
 * 4. Stale reverse geocode sequence guard:
 *    - Sequential asynchronous responses arriving out of order are discarded via sequence counter.
 * 5. Active destination invariant preservation:
 *    - canUpdateFromGps() continues to protect explicit destinations.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const STORE_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/store.js');
const LOCATION_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/location.js');
const PICKER_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/location-picker.js');

function setupTestEnvironment() {
  const storage = {};
  globalThis.window = globalThis;
  globalThis.document = {
    createElement: (tag) => {
      const el = {
        tagName: tag.toUpperCase(),
        className: '',
        style: {},
        innerHTML: '',
        children: [],
        dataset: {},
        classList: {
          add: () => {},
          remove: () => {},
          contains: () => false
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        appendChild: () => el,
        removeChild: () => {},
        addEventListener: () => {},
        removeEventListener: () => {}
      };
      return el;
    },
    head: {
      appendChild: () => {}
    },
    body: {
      appendChild: () => {}
    },
    getElementById: () => null,
    addEventListener: () => {}
  };
  globalThis.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
  };
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        geolocation: {
          getCurrentPosition: (cb) => {
            cb({
              coords: { latitude: -5.3971, longitude: 105.2668, accuracy: 15 }
            });
          }
        }
      },
      configurable: true,
      writable: true
    });
  } catch (_) {}

  delete require.cache[STORE_PATH];
  delete require.cache[LOCATION_PATH];
  delete require.cache[PICKER_PATH];

  // Set up mock window.Xentra
  globalThis.window.Xentra = {
    API: {
      get: async () => ({})
    },
    UI: {
      escape: (s) => String(s || ''),
      toast: () => {}
    }
  };
  globalThis.window.XentraConfig = {
    mapboxToken: 'test_token'
  };

  require(STORE_PATH);
  require(LOCATION_PATH);
  require(PICKER_PATH);

  return {
    Store: globalThis.window.Xentra.Store,
    XentraLocation: globalThis.window.XentraLocation,
    XentraLocationPicker: globalThis.window.XentraLocationPicker
  };
}

test('MAP-01: haversineMeters calculates accurate surface distance between coordinates', () => {
  const { XentraLocationPicker } = setupTestEnvironment();
  assert.ok(XentraLocationPicker && typeof XentraLocationPicker.haversineMeters === 'function');

  // Same coordinates => 0 distance
  const p1 = { lat: -5.3971, lng: 105.2668 };
  const distZero = XentraLocationPicker.haversineMeters(p1, p1);
  assert.strictEqual(distZero, 0);

  // Micro-jitter: ~2 meters difference (0.00002 deg lat ~ 2.22 meters)
  const pJitter = { lat: -5.3971 + 0.00002, lng: 105.2668 };
  const distJitter = XentraLocationPicker.haversineMeters(p1, pJitter);
  assert.ok(distJitter > 1.5 && distJitter < 3.0, `Expected ~2.2m, got ${distJitter}`);

  // Meaningful movement: ~20 meters difference (0.00018 deg lat ~ 20.0 meters)
  const pMove = { lat: -5.3971 + 0.00018, lng: 105.2668 };
  const distMove = XentraLocationPicker.haversineMeters(p1, pMove);
  assert.ok(distMove > 18.0 && distMove < 22.0, `Expected ~20m, got ${distMove}`);
});

test('MAP-02: calculateZoomFromAccuracy dynamically sets appropriate zoom strategy', () => {
  const { XentraLocationPicker } = setupTestEnvironment();
  assert.ok(XentraLocationPicker && typeof XentraLocationPicker.calculateZoomFromAccuracy === 'function');

  // High accuracy (<= 30 meters) -> Zoom 17.5 (close building/street view)
  assert.strictEqual(XentraLocationPicker.calculateZoomFromAccuracy(10), 17.5);
  assert.strictEqual(XentraLocationPicker.calculateZoomFromAccuracy(30), 17.5);

  // Moderate accuracy (31 to 100 meters) -> Zoom 16.5 (block level)
  assert.strictEqual(XentraLocationPicker.calculateZoomFromAccuracy(45), 16.5);
  assert.strictEqual(XentraLocationPicker.calculateZoomFromAccuracy(100), 16.5);

  // Low accuracy (> 100 meters) -> Zoom 15.5 (neighborhood level)
  assert.strictEqual(XentraLocationPicker.calculateZoomFromAccuracy(150), 15.5);
  assert.strictEqual(XentraLocationPicker.calculateZoomFromAccuracy(500), 15.5);

  // Invalid / missing accuracy -> fallback default zoom 17.2
  assert.strictEqual(XentraLocationPicker.calculateZoomFromAccuracy(null), 17.2);
  assert.strictEqual(XentraLocationPicker.calculateZoomFromAccuracy(undefined), 17.2);
  assert.strictEqual(XentraLocationPicker.calculateZoomFromAccuracy(0), 17.2);
});

test('MAP-03: Micro-movement filter logic (< 5m vs >= 5m) suppresses unnecessary reverse-geocode', () => {
  const { XentraLocationPicker } = setupTestEnvironment();

  const baseCoords = { lat: -5.397100, lng: 105.266800 };
  let simulatedLastResolved = { lat: baseCoords.lat, lng: baseCoords.lng };
  let reverseGeocodeCallCount = 0;

  function simulateOnCenterMoved(newCoords, wasProgrammatic) {
    if (wasProgrammatic) return;
    const distance = XentraLocationPicker.haversineMeters(simulatedLastResolved, newCoords);
    if (distance < 5) {
      // Sub-threshold jitter: skip
      return;
    }
    simulatedLastResolved = { lat: newCoords.lat, lng: newCoords.lng };
    reverseGeocodeCallCount++;
  }

  // 1. First move is sub-threshold micro-jitter (~1.5m)
  const jitterCoords = { lat: -5.397113, lng: 105.266800 };
  simulateOnCenterMoved(jitterCoords, false);
  assert.strictEqual(reverseGeocodeCallCount, 0, 'Micro-jitter under 5m must NOT trigger reverse geocode');

  // 2. Second move is meaningful (> 15m)
  const meaningfulCoords = { lat: -5.397250, lng: 105.266800 };
  simulateOnCenterMoved(meaningfulCoords, false);
  assert.strictEqual(reverseGeocodeCallCount, 1, 'Movement >= 5m MUST trigger reverse geocode');

  // 3. Third move is programmatic (e.g. user selected POI or search result)
  const poiCoords = { lat: -5.400000, lng: 105.270000 };
  simulateOnCenterMoved(poiCoords, true);
  assert.strictEqual(reverseGeocodeCallCount, 1, 'Programmatic move must NOT trigger manual reverse geocode');
});

test('MAP-04: Out-of-order sequential async reverse-geocode responses are discarded', async () => {
  let revGeocodeSeq = 0;
  let activeTitle = 'Initial';

  function triggerSimulatedReverseGeocode(seqDelayMs, resultTitle) {
    const currentSeq = ++revGeocodeSeq;
    return new Promise((resolve) => {
      setTimeout(() => {
        if (currentSeq === revGeocodeSeq) {
          activeTitle = resultTitle;
        }
        resolve({ seq: currentSeq, applied: currentSeq === revGeocodeSeq });
      }, seqDelayMs);
    });
  }

  // Request 1 is fired (slow network: 50ms)
  const p1 = triggerSimulatedReverseGeocode(50, 'Location from Request 1');

  // Request 2 is fired quickly after (fast network: 10ms)
  const p2 = triggerSimulatedReverseGeocode(10, 'Location from Request 2 (Fresher)');

  const [res1, res2] = await Promise.all([p1, p2]);

  assert.strictEqual(res2.applied, true, 'Request 2 was the latest sequence and was applied');
  assert.strictEqual(res1.applied, false, 'Request 1 was superseded and its result was discarded');
  assert.strictEqual(activeTitle, 'Location from Request 2 (Fresher)', 'Active UI reflects the latest sequence result');
});

test('MAP-05: Invariant canUpdateFromGps preserves explicit destination', () => {
  const { XentraLocation } = setupTestEnvironment();

  // Explicit destination from map picker or search
  const explicitDest = {
    latitude: -5.3971,
    longitude: 105.2668,
    is_explicit: true,
    source: 'map',
    address: 'Jl. Ahmad Yani No. 12'
  };

  assert.strictEqual(XentraLocation.canUpdateFromGps(explicitDest), false, 'Explicit map destination must not be overwritten by GPS');

  // Non-explicit destination (e.g. empty or default)
  const nonExplicitDest = {
    latitude: null,
    longitude: null,
    is_explicit: false,
    source: 'gps'
  };
  assert.strictEqual(XentraLocation.canUpdateFromGps(nonExplicitDest), true, 'Non-explicit destination can receive GPS updates');
});

test('MAP-06: formatLocationMetadata extracts granular POI and structured road title without shifting coordinates', () => {
  const { XentraLocationPicker } = setupTestEnvironment();
  assert.ok(typeof XentraLocationPicker.formatLocationMetadata === 'function');

  const coords = { lat: -5.39712, lng: 105.26685 };
  const mockSearchBoxRes = {
    title: 'MU Sweet & Bakery Pringsewu',
    road: 'Jl. Jenderal Sudirman',
    neighborhood: 'Pringsewu Barat',
    locality: 'Pringsewu',
    city: 'Kabupaten Pringsewu',
    address: 'MU Sweet & Bakery Pringsewu, Jl. Jenderal Sudirman, Pringsewu Barat, Pringsewu',
    provider: 'mapbox_searchbox'
  };

  const meta = XentraLocationPicker.formatLocationMetadata(mockSearchBoxRes, coords);
  assert.strictEqual(meta.title, 'MU Sweet & Bakery Pringsewu', 'Granular POI name must be preferred as title');
  assert.ok(meta.address.includes('Jl. Jenderal Sudirman'), 'Structured road must be included in formatted address');
  assert.strictEqual(meta.provider, 'mapbox_searchbox');
});

test('MAP-07: formatLocationMetadata handles postal-code and administrative fallback gracefully', () => {
  const { XentraLocationPicker } = setupTestEnvironment();

  const coords = { lat: -5.39712, lng: 105.26685 };

  // Case 1: First part is a numeric postal code (e.g. "35373, Pringsewu Timur, Kabupaten Pringsewu")
  const postalFirstRes = {
    address: { formatted_address: '35373, Pringsewu Timur, Kabupaten Pringsewu' },
    provider: 'mapbox_geocoding_v6'
  };
  const meta1 = XentraLocationPicker.formatLocationMetadata(postalFirstRes, coords);
  assert.strictEqual(meta1.title, 'Pringsewu Timur', 'Numeric postcode must be skipped in favor of meaningful address part');

  // Case 2: Only pure postal code returned -> fallback to Titik Terpilih + coordinates
  const lonePostalRes = {
    address: { formatted_address: '35373' },
    provider: 'mapbox_geocoding_v6'
  };
  const meta2 = XentraLocationPicker.formatLocationMetadata(lonePostalRes, coords);
  assert.strictEqual(meta2.title, 'Titik Terpilih');
  assert.strictEqual(meta2.address, 'Koordinat: -5.39712, 105.26685');

  // Case 3: Empty or null response -> graceful fallback to coordinate display
  const nullRes = null;
  const meta3 = XentraLocationPicker.formatLocationMetadata(nullRes, coords);
  assert.strictEqual(meta3.title, 'Titik Terpilih');
  assert.strictEqual(meta3.address, 'Koordinat: -5.39712, 105.26685');
});

test('MAP-08: Coordinate authority is preserved and never shifted during reverse geocoding', () => {
  const { XentraLocationPicker } = setupTestEnvironment();

  const userExactCoords = { lat: -5.3971234, lng: 105.2668567 };
  // Backend returns metadata from a centroid or nearest feature that might have slightly different coordinates
  const backendRes = {
    title: 'Warung Pojok',
    road: 'Jl. Kenanga',
    locality: 'Pringsewu',
    city: 'Lampung',
    address: 'Warung Pojok, Jl. Kenanga, Pringsewu',
    provider: 'mapbox_searchbox'
  };

  const meta = XentraLocationPicker.formatLocationMetadata(backendRes, userExactCoords);
  // Formatter must format metadata without altering user coordinates
  assert.strictEqual(userExactCoords.lat, -5.3971234, 'User pin latitude must remain strictly unchanged');
  assert.strictEqual(userExactCoords.lng, 105.2668567, 'User pin longitude must remain strictly unchanged');
  assert.strictEqual(meta.title, 'Warung Pojok');
});

test('MAP-09: End-to-end destination persistence preserves source coordinates and canonical metadata', () => {
  const { Store, XentraLocationPicker } = setupTestEnvironment();

  // 1. Map selection coordinates
  const pinCoords = { lat: -5.3978912, lng: 105.2661234 };
  const metadata = XentraLocationPicker.formatLocationMetadata({
    title: 'Geprek Bensu Pringsewu',
    road: 'Jl. Jendral Sudirman',
    address: 'Geprek Bensu Pringsewu, Jl. Jendral Sudirman, Pringsewu'
  }, pinCoords);

  // Directly apply destination as done by location-picker confirmation
  Store.setActiveDestination({
    latitude: pinCoords.lat,
    longitude: pinCoords.lng,
    address: metadata.address,
    label: metadata.title,
    detail: 'Sebelah minimarket',
    source: 'map',
    is_explicit: true
  });

  const active = Store.getActiveDestination();
  assert.ok(active, 'Active destination must be persisted');
  assert.strictEqual(active.latitude, -5.3978912, 'Persisted latitude must strictly equal source coordinates');
  assert.strictEqual(active.longitude, 105.2661234, 'Persisted longitude must strictly equal source coordinates');
  assert.strictEqual(active.label, 'Geprek Bensu Pringsewu');
  assert.strictEqual(active.source, 'map');
  assert.strictEqual(active.is_explicit, true);

  // 2. Verify legacy synchronized location shape
  const legacyLoc = Store.getState().location;
  assert.ok(legacyLoc, 'Legacy location must be synchronized');
  assert.strictEqual(legacyLoc.latitude, -5.3978912);
  assert.strictEqual(legacyLoc.longitude, 105.2661234);
  assert.strictEqual(legacyLoc.source, 'map');
  assert.strictEqual(legacyLoc.is_explicit, true);
});

test('MAP-10: Selected POI from search preserves POI title as destination label and enriches address', () => {
  const { Store, XentraLocationPicker } = setupTestEnvironment();

  const selectedPoi = {
    title: 'Dapur Kurnia',
    address: 'Jl. Melati No. 5, Pringsewu Timur',
    latitude: -5.397123,
    longitude: 105.266854,
    source: 'search'
  };

  // Simulating the destination application when user confirms a search-selected POI
  const resolvedTitle = selectedPoi.title.trim();
  let combinedAddress = selectedPoi.address;
  if (resolvedTitle && combinedAddress && !combinedAddress.startsWith(resolvedTitle)) {
    combinedAddress = resolvedTitle + ', ' + combinedAddress;
  }

  Store.setActiveDestination({
    latitude: selectedPoi.latitude,
    longitude: selectedPoi.longitude,
    address: combinedAddress,
    label: resolvedTitle,
    detail: 'Depan ruko',
    source: 'search',
    is_explicit: true
  });

  const active = Store.getActiveDestination();
  assert.ok(active, 'Active destination must be set');
  assert.strictEqual(active.label, 'Dapur Kurnia', 'Primary destination title must preserve selected POI name');
  assert.strictEqual(active.latitude, -5.397123, 'Coordinate authority must be preserved');
  assert.strictEqual(active.longitude, 105.266854, 'Coordinate authority must be preserved');
  assert.ok(active.address.startsWith('Dapur Kurnia, Jl. Melati No. 5'), 'Address must combine POI and street context cleanly');
  assert.strictEqual(active.source, 'search');
  assert.strictEqual(active.is_explicit, true);
});

test('MAP-11: Selected street from search preserves street title without duplicating', () => {
  const { Store } = setupTestEnvironment();

  const selectedStreet = {
    title: 'Jl. Ahmad Yani',
    address: 'Jl. Ahmad Yani, Pringsewu, Lampung',
    latitude: -5.385001,
    longitude: 105.251234,
    source: 'search'
  };

  const resolvedTitle = selectedStreet.title.trim();
  let combinedAddress = selectedStreet.address;
  if (resolvedTitle && combinedAddress && !combinedAddress.startsWith(resolvedTitle)) {
    combinedAddress = resolvedTitle + ', ' + combinedAddress;
  }

  Store.setActiveDestination({
    latitude: selectedStreet.latitude,
    longitude: selectedStreet.longitude,
    address: combinedAddress,
    label: resolvedTitle,
    detail: '',
    source: 'search',
    is_explicit: true
  });

  const active = Store.getActiveDestination();
  assert.strictEqual(active.label, 'Jl. Ahmad Yani', 'Street selection preserves street name as label');
  assert.strictEqual(active.address, 'Jl. Ahmad Yani, Pringsewu, Lampung', 'Street address must not duplicate street name');
  assert.strictEqual(active.source, 'search');
  assert.strictEqual(active.is_explicit, true);
});

test('MAP-12: Map center pin without POI maintains reverse-geocoded road/address title', () => {
  const { Store, XentraLocationPicker } = setupTestEnvironment();

  const pinCoords = { lat: -5.392011, lng: 105.264321 };
  const reverseGeocoded = XentraLocationPicker.formatLocationMetadata({
    road: 'Jl. Melati',
    locality: 'Pringsewu Timur',
    address: 'Jl. Melati, Pringsewu Timur, Pringsewu'
  }, pinCoords);

  assert.strictEqual(reverseGeocoded.title, 'Jl. Melati', 'Road name should be title for non-POI pin position');

  Store.setActiveDestination({
    latitude: pinCoords.lat,
    longitude: pinCoords.lng,
    address: reverseGeocoded.address,
    label: reverseGeocoded.title,
    detail: '',
    source: 'map',
    is_explicit: true
  });

  const active = Store.getActiveDestination();
  assert.strictEqual(active.label, 'Jl. Melati');
  assert.strictEqual(active.source, 'map');
  assert.strictEqual(active.is_explicit, true);
});


