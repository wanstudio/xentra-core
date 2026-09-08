'use strict';
/**
 * Location & Address Foundation Tests
 *
 * Verifies:
 * 1. Distinct location concepts: GPS, Search, Map, Favorite Address, Active Destination
 * 2. Active Destination: can exist for guest, originates from any source, not silently overwritten by GPS when explicit
 * 3. Selecting Favorite Address makes it Active Destination
 * 4. Favorite Address: persisted in customer_addresses, bound to (brand_id, customer_phone)
 * 5. Full CRUD on /api/v1/addresses (GET, POST, PUT, DELETE) with requireCustomerAuth()
 * 6. Historical order freezing: past order delivery data is frozen and unaffected by favorite address mutations
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const app = require('../../server/app');
const db = require('../../server/database/db');

const STORE_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/store.js');
const LOCATION_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/location.js');

function freshClientContext(seedStorage) {
  const storage = seedStorage || {};
  globalThis.window = globalThis;
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
              coords: { latitude: -7.28, longitude: 112.72, accuracy: 15 }
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
  require(STORE_PATH);
  require(LOCATION_PATH);

  return {
    Store: globalThis.window.Xentra.Store,
    XentraLocation: globalThis.window.XentraLocation
  };
}

async function mockFetch(path, options = {}) {
  const method = options.method || 'GET';
  const headers = options.headers || {};
  const body = options.body ? JSON.parse(options.body) : null;

  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers: { host: 'app.mybangjo.com', 'content-type': 'application/json', ...headers },
      body,
      query: {},
      params: {}
    };

    if (path.includes('?')) {
      const parts = path.split('?');
      req.url = parts[0];
      const params = new URLSearchParams(parts[1]);
      for (const [k, v] of params.entries()) {
        req.query[k] = v;
      }
    }

    const res = {
      statusCode: 200,
      headers: {},
      status(code) { this.statusCode = code; return this; },
      setHeader(k, v) { this.headers[k] = v; },
      getHeader(k) { return this.headers[k]; },
      writeHead(code, headers) { this.statusCode = code; if (headers) Object.assign(this.headers, headers); },
      json(data) { resolve({ status: this.statusCode, json: async () => data }); },
      send(data) {
        let parsed = data;
        if (typeof data === 'string') { try { parsed = JSON.parse(data); } catch (_) {} }
        resolve({ status: this.statusCode, text: async () => data, json: async () => parsed });
      },
      end(data) {
        let parsed = data;
        if (typeof data === 'string') { try { parsed = JSON.parse(data); } catch (_) {} }
        resolve({ status: this.statusCode, text: async () => data, json: async () => parsed });
      }
    };

    app(req, res, (err) => { if (err) reject(err); });
  });
}

async function createCustomerSession(phone) {
  const otpRes = await mockFetch('/api/v1/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({ phone })
  });
  const otpData = await otpRes.json();
  const verifyRes = await mockFetch('/api/v1/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: otpData.challenge_id, otp: '123456', phone })
  });
  const verifyData = await verifyRes.json();
  return verifyData.token;
}

test.beforeEach(() => {
  try {
    db.prepare('DELETE FROM customer_addresses').run();
  } catch (_) {}
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. ACTIVE DESTINATION STATE & SOURCE SEPARATION TESTS
// ═════════════════════════════════════════════════════════════════════════════

test('LOC-01: Distinct location source builders create canonical shapes', () => {
  const { XentraLocation } = freshClientContext();

  const gpsDest = XentraLocation.createDestinationFromGps({ latitude: -7.25, longitude: 112.75, accuracy: 10 });
  assert.strictEqual(gpsDest.source, 'gps');
  assert.strictEqual(gpsDest.is_explicit, false);
  assert.strictEqual(gpsDest.latitude, -7.25);
  assert.strictEqual(gpsDest.longitude, 112.75);

  const searchDest = XentraLocation.createDestinationFromSearch({
    display_name: 'Jl. Pemuda No. 1, Surabaya',
    latitude: -7.26,
    longitude: 112.74
  });
  assert.strictEqual(searchDest.source, 'search');
  assert.strictEqual(searchDest.is_explicit, true);
  assert.strictEqual(searchDest.address, 'Jl. Pemuda No. 1, Surabaya');

  const mapDest = XentraLocation.createDestinationFromMap({ lat: -7.27, lng: 112.73 }, 'Gedung Sate', 'Depan gerbang utama');
  assert.strictEqual(mapDest.source, 'map');
  assert.strictEqual(mapDest.is_explicit, true);
  assert.strictEqual(mapDest.address, 'Gedung Sate');
  assert.strictEqual(mapDest.detail, 'Depan gerbang utama');

  const favDest = XentraLocation.createDestinationFromFavorite({
    id: 'addr_123',
    address: 'Jl. Dharmawangsa No. 10',
    latitude: -7.28,
    longitude: 112.76,
    label: 'Kantor',
    detail: 'Lantai 3'
  });
  assert.strictEqual(favDest.source, 'favorite');
  assert.strictEqual(favDest.is_explicit, true);
  assert.strictEqual(favDest.label, 'Kantor');
  assert.strictEqual(favDest.favorite_id, 'addr_123');
});

test('LOC-02: Guest customer can set and use Active Destination without registration', () => {
  const { Store } = freshClientContext();

  assert.strictEqual(Store.getState().customerSession, null, 'User is unauthenticated guest');
  assert.strictEqual(Store.getActiveDestination(), null);

  Store.setActiveDestination({
    address: 'Jl. Tunjungan No. 5',
    latitude: -7.258,
    longitude: 112.739,
    label: 'Tunjungan Plaza',
    source: 'search',
    is_explicit: true
  });

  const active = Store.getActiveDestination();
  assert.ok(active, 'Active destination exists for guest');
  assert.strictEqual(active.address, 'Jl. Tunjungan No. 5');
  assert.strictEqual(active.latitude, -7.258);
  assert.strictEqual(active.longitude, 112.739);
  assert.strictEqual(active.source, 'search');
  assert.strictEqual(active.is_explicit, true);

  // Synchronized with legacy location for backward compatibility
  const legacyLoc = Store.getState().location;
  assert.ok(legacyLoc);
  assert.strictEqual(legacyLoc.formatted_address, 'Jl. Tunjungan No. 5');
  assert.strictEqual(legacyLoc.latitude, -7.258);
});

test('LOC-03: Background GPS must NOT silently overwrite an explicitly selected Active Destination', () => {
  const { Store, XentraLocation } = freshClientContext();

  // Explicitly selected from search or favorite
  Store.setActiveDestination({
    address: 'Kantor Pusat',
    latitude: -7.29,
    longitude: 112.71,
    source: 'search',
    is_explicit: true
  });

  const current = Store.getActiveDestination();
  assert.strictEqual(XentraLocation.canUpdateFromGps(current), false, 'canUpdateFromGps must be false when destination is explicit');

  // If destination was set purely by lightweight initial GPS (not explicit), GPS update is allowed
  const gpsDest = XentraLocation.createDestinationFromGps({ latitude: -7.28, longitude: 112.72 });
  Store.setActiveDestination(gpsDest);
  assert.strictEqual(XentraLocation.canUpdateFromGps(Store.getActiveDestination()), true, 'canUpdateFromGps allows updates when origin was non-explicit GPS');
});

test('LOC-04: Selecting Favorite Address makes that address the Active Destination with source=favorite', () => {
  const { Store, XentraLocation } = freshClientContext();

  const favoriteRecord = {
    id: 'addr_fav_99',
    label: 'Apartemen',
    address: 'Jl. Mayjen Sungkono No. 89, Surabaya',
    detail: 'Tower A Unit 1204',
    latitude: -7.2891,
    longitude: 112.7123
  };

  const newActive = XentraLocation.createDestinationFromFavorite(favoriteRecord);
  Store.setActiveDestination(newActive);

  const active = Store.getActiveDestination();
  assert.strictEqual(active.source, 'favorite');
  assert.strictEqual(active.is_explicit, true);
  assert.strictEqual(active.address, 'Jl. Mayjen Sungkono No. 89, Surabaya');
  assert.strictEqual(active.label, 'Apartemen');
  assert.strictEqual(active.favorite_id, 'addr_fav_99');
  assert.strictEqual(active.latitude, -7.2891);
  assert.strictEqual(active.longitude, 112.7123);
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. FAVORITE ADDRESS CRUD & SECURITY TESTS
// ═════════════════════════════════════════════════════════════════════════════

test('LOC-05: Favorite Address persistence requires valid OTP session token', async () => {
  const getRes = await mockFetch('/api/v1/addresses');
  assert.strictEqual(getRes.status, 401, 'Unauthenticated visitor cannot access /addresses');

  const postRes = await mockFetch('/api/v1/addresses', {
    method: 'POST',
    body: JSON.stringify({
      label: 'Rumah',
      address: 'Jl. Mawar 10',
      latitude: -7.29,
      longitude: 112.71
    })
  });
  assert.strictEqual(postRes.status, 401, 'Unauthenticated visitor cannot create saved address');
});

test('LOC-06: Create, List, Update, and Delete Favorite Address lifecycle', async () => {
  const phone = '081299990001';
  const token = await createCustomerSession(phone);
  const headers = { 'x-customer-token': token };

  // 1. Create first address (becomes primary by default)
  const createRes1 = await mockFetch('/api/v1/addresses', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      label: 'Rumah',
      address: 'Jl. Raya Darmo No. 50, Surabaya',
      detail: 'Pagar putih',
      note: 'Titip di satpam',
      latitude: -7.2855,
      longitude: 112.7381
    })
  });
  assert.strictEqual(createRes1.status, 201);
  const data1 = await createRes1.json();
  assert.strictEqual(data1.success, true);
  assert.ok(data1.address.id.startsWith('addr_'));
  assert.strictEqual(data1.address.label, 'Rumah');
  assert.strictEqual(data1.address.is_primary, 1);
  const addr1Id = data1.address.id;

  // 2. Create second address
  const createRes2 = await mockFetch('/api/v1/addresses', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      label: 'Kantor',
      address: 'Jl. Basuki Rahmat No. 12, Surabaya',
      detail: 'Lobby gedung',
      latitude: -7.2711,
      longitude: 112.7422
    })
  });
  assert.strictEqual(createRes2.status, 201);
  const data2 = await createRes2.json();
  assert.strictEqual(data2.address.is_primary, 0, 'Second address should not be primary unless specified');
  const addr2Id = data2.address.id;

  // 3. List addresses
  const listRes = await mockFetch('/api/v1/addresses', { headers });
  assert.strictEqual(listRes.status, 200);
  const listData = await listRes.json();
  assert.strictEqual(listData.success, true);
  assert.strictEqual(listData.addresses.length, 2);
  assert.strictEqual(listData.addresses[0].id, addr1Id, 'Primary address should be first');

  // 4. Update address (Ubah)
  const updateRes = await mockFetch(`/api/v1/addresses/${addr2Id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      label: 'Kantor Baru',
      address: 'Jl. Pemuda No. 99, Surabaya',
      detail: 'Lantai 5 Suite 501',
      latitude: -7.2650,
      longitude: 112.7480,
      is_primary: 1
    })
  });
  assert.strictEqual(updateRes.status, 200);
  const updateData = await updateRes.json();
  assert.strictEqual(updateData.success, true);
  assert.strictEqual(updateData.address.label, 'Kantor Baru');
  assert.strictEqual(updateData.address.address, 'Jl. Pemuda No. 99, Surabaya');
  assert.strictEqual(updateData.address.is_primary, 1);

  // Verify primary promotion demoted previous primary
  const verifyList = await mockFetch('/api/v1/addresses', { headers });
  const verifyData = await verifyList.json();
  const addr1After = verifyData.addresses.find(a => a.id === addr1Id);
  const addr2After = verifyData.addresses.find(a => a.id === addr2Id);
  assert.strictEqual(addr2After.is_primary, 1);
  assert.strictEqual(addr1After.is_primary, 0);

  // 5. Delete address (Hapus)
  const deleteRes = await mockFetch(`/api/v1/addresses/${addr2Id}`, {
    method: 'DELETE',
    headers
  });
  assert.strictEqual(deleteRes.status, 200);
  const delData = await deleteRes.json();
  assert.strictEqual(delData.success, true);

  // Verify deletion
  const afterDelList = await mockFetch('/api/v1/addresses', { headers });
  const afterDelData = await afterDelList.json();
  assert.strictEqual(afterDelData.addresses.length, 1);
  assert.strictEqual(afterDelData.addresses[0].id, addr1Id);

  // Deleting again returns 404
  const delAgain = await mockFetch(`/api/v1/addresses/${addr2Id}`, { method: 'DELETE', headers });
  assert.strictEqual(delAgain.status, 404);
});

test('LOC-07: Cross-customer isolation prevents unauthorized update/delete', async () => {
  const tokenA = await createCustomerSession('081299990002');
  const tokenB = await createCustomerSession('081299990003');

  // Customer A creates address
  const createRes = await mockFetch('/api/v1/addresses', {
    method: 'POST',
    headers: { 'x-customer-token': tokenA },
    body: JSON.stringify({
      label: 'Rumah A',
      address: 'Jl. Kenanga No. 1',
      latitude: -7.25,
      longitude: 112.75
    })
  });
  const data = await createRes.json();
  const addrAId = data.address.id;

  // Customer B cannot update Customer A's address
  const putRes = await mockFetch(`/api/v1/addresses/${addrAId}`, {
    method: 'PUT',
    headers: { 'x-customer-token': tokenB },
    body: JSON.stringify({ label: 'Hacked Label' })
  });
  assert.strictEqual(putRes.status, 404, 'Cannot update another customer address');

  // Customer B cannot delete Customer A's address
  const delRes = await mockFetch(`/api/v1/addresses/${addrAId}`, {
    method: 'DELETE',
    headers: { 'x-customer-token': tokenB }
  });
  assert.strictEqual(delRes.status, 404, 'Cannot delete another customer address');

  // Customer A's address remains intact
  const getRes = await mockFetch('/api/v1/addresses', {
    headers: { 'x-customer-token': tokenA }
  });
  const aList = await getRes.json();
  assert.strictEqual(aList.addresses.length, 1);
  assert.strictEqual(aList.addresses[0].label, 'Rumah A');
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. HISTORICAL ORDER FREEZING INVARIANT TEST
// ═════════════════════════════════════════════════════════════════════════════

test('LOC-08: Historical order delivery data is frozen and unaffected by Favorite Address updates or deletion', async () => {
  const phone = '081299990004';
  const token = await createCustomerSession(phone);
  const headers = { 'x-customer-token': token };

  // 1. Customer creates a favorite address
  const addrRes = await mockFetch('/api/v1/addresses', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      label: 'Rumah Asli',
      address: 'Jl. Raya Kupang Indah No. 7, Surabaya',
      latitude: -7.2912,
      longitude: 112.7154
    })
  });
  const addrData = await addrRes.json();
  const savedAddrId = addrData.address.id;

  // 2. Customer places a delivery order using this address
  const orderRes = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      branch_id: 'branch_bangjo_barat',
      payment_method: 'cash',
      customer: { name: 'Siti Rahma', phone },
      order_type: 'delivery',
      delivery: {
        address: addrData.address.address,
        latitude: addrData.address.latitude,
        longitude: addrData.address.longitude
      },
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(orderRes.status, 201);
  const orderResult = await orderRes.json();
  const orderId = orderResult.order_id;

  // Check frozen delivery record in database
  const frozenDel = db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(orderId);
  assert.ok(frozenDel, 'order_deliveries record must exist');
  assert.strictEqual(frozenDel.destination_address, 'Jl. Raya Kupang Indah No. 7, Surabaya');
  assert.strictEqual(frozenDel.destination_latitude, -7.2912);
  assert.strictEqual(frozenDel.destination_longitude, 112.7154);

  // 3. Customer modifies the favorite address
  await mockFetch(`/api/v1/addresses/${savedAddrId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      label: 'Rumah Sudah Pindah',
      address: 'Jl. Rungkut Industri No. 99, Surabaya',
      latitude: -7.3300,
      longitude: 112.7600
    })
  });

  // Verify order_deliveries is UNTOUCHED
  const frozenDelAfterEdit = db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(orderId);
  assert.strictEqual(frozenDelAfterEdit.destination_address, 'Jl. Raya Kupang Indah No. 7, Surabaya', 'Frozen address must NOT mutate');
  assert.strictEqual(frozenDelAfterEdit.destination_latitude, -7.2912);

  // 4. Customer DELETES the favorite address completely
  await mockFetch(`/api/v1/addresses/${savedAddrId}`, {
    method: 'DELETE',
    headers
  });

  // Verify order_deliveries is STILL UNTOUCHED
  const frozenDelAfterDelete = db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(orderId);
  assert.ok(frozenDelAfterDelete, 'order_deliveries survives address deletion');
  assert.strictEqual(frozenDelAfterDelete.destination_address, 'Jl. Raya Kupang Indah No. 7, Surabaya');
});

test('LOC-09: Navigation stack contract — overlays close in LIFO order without leaving page', () => {
  const NAV_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/nav.js');
  delete require.cache[NAV_PATH];
  globalThis.window = globalThis;
  require(NAV_PATH);

  const XentraNav = globalThis.window.XentraNav;
  assert.strictEqual(XentraNav.hasOpen(), false);

  let sheet1Closed = false;
  let sheet2Closed = false;
  let sheet3Closed = false;

  XentraNav.pushClose(() => { sheet1Closed = true; });
  XentraNav.pushClose(() => { sheet2Closed = true; });
  XentraNav.pushClose(() => { sheet3Closed = true; });

  assert.strictEqual(XentraNav.hasOpen(), true);

  // First back press: closes topmost sheet (sheet3)
  const c1 = XentraNav.close();
  assert.strictEqual(c1, true);
  assert.strictEqual(sheet3Closed, true);
  assert.strictEqual(sheet2Closed, false);
  assert.strictEqual(sheet1Closed, false);

  // Second back press: closes sheet2
  const c2 = XentraNav.close();
  assert.strictEqual(c2, true);
  assert.strictEqual(sheet2Closed, true);
  assert.strictEqual(sheet1Closed, false);

  // Third back press: closes sheet1
  const c3 = XentraNav.close();
  assert.strictEqual(c3, true);
  assert.strictEqual(sheet1Closed, true);
  assert.strictEqual(XentraNav.hasOpen(), false);

  // When no overlays open, close returns false (allows normal navigation)
  const c4 = XentraNav.close();
  assert.strictEqual(c4, false);
});

test('LOC-10: Location Picker Flow D — Detail Alamat validation and separation of Active Destination vs Favorite Address', () => {
  const client = freshClientContext();
  const Store = client.Store;

  // Initial state: no destination
  assert.strictEqual(Store.getActiveDestination(), null);

  // Flow D Scenario 1: Checkbox UNCHECKED
  // User selects location, inputs label, leaves "Simpan sebagai favorit" UNCHECKED
  Store.setActiveDestination({
    address: 'Jl. Melati 1, Pringsewu Timur, Indonesia',
    latitude: -5.3582,
    longitude: 104.9754,
    label: 'Warung Pecel Vihara',
    detail: 'Patokan depan ruko',
    source: 'map',
    is_explicit: true
  });

  const dest1 = Store.getActiveDestination();
  assert.strictEqual(dest1.label, 'Warung Pecel Vihara');
  assert.strictEqual(dest1.source, 'map');
  assert.strictEqual(dest1.favorite_id, null, 'Unchecked favorite must NOT have favorite_id');

  // Flow D Scenario 2: Checkbox CHECKED
  // User checks "Simpan sebagai favorit" -> Saved to addresses, then set as Active Destination
  const savedFavId = 'addr_fav_test_01';
  Store.setActiveDestination({
    address: 'Jl. Dewi 18, Pidada 1, Panjang Bandar Lampung',
    latitude: -5.4600,
    longitude: 105.3100,
    label: 'Rumah Ibu',
    detail: 'patokan samping vihara',
    source: 'favorite',
    is_explicit: true,
    favorite_id: savedFavId
  });

  const dest2 = Store.getActiveDestination();
  assert.strictEqual(dest2.label, 'Rumah Ibu');
  assert.strictEqual(dest2.source, 'favorite');
  assert.strictEqual(dest2.favorite_id, savedFavId);
});

test('LOC-11: Location Picker Flow B (GPS) — must NEVER automatically create Favorite Address', () => {
  const client = freshClientContext();
  const Store = client.Store;
  const XentraLocation = client.XentraLocation;

  // Simulate GPS coordinates reverse geocoded
  const gpsCoords = { latitude: -5.3971, longitude: 105.2668, accuracy: 10 };
  const destGps = XentraLocation.createDestinationFromGps(gpsCoords, 'Jl. Raden Intan No. 55');

  assert.strictEqual(destGps.source, 'gps');
  assert.strictEqual(destGps.is_explicit, false);
  assert.strictEqual(destGps.favorite_id, undefined);

  Store.setActiveDestination(destGps);
  const active = Store.getActiveDestination();
  assert.strictEqual(active.source, 'gps');
  assert.strictEqual(active.favorite_id, null, 'GPS must NEVER create or link a favorite_id');
});

test('LOC-12: Location Picker Flow A (Search) and Flow C (Map) create explicit canonical destinations', () => {
  const client = freshClientContext();
  const XentraLocation = client.XentraLocation;

  // Search
  const searchDest = XentraLocation.createDestinationFromSearch({
    display_name: 'Perwara Interior, Jl. Mawar I No.6, Pringsewu',
    latitude: -5.3621,
    longitude: 104.9812,
    label: 'Perwara Interior'
  });
  assert.strictEqual(searchDest.source, 'search');
  assert.strictEqual(searchDest.is_explicit, true);
  assert.strictEqual(searchDest.label, 'Perwara Interior');

  // Map
  const mapDest = XentraLocation.createDestinationFromMap(
    { latitude: -5.3650, longitude: 104.9830 },
    'Jl. Ahmad Yani, Pringsewu',
    'Depan Bank BRI'
  );
  assert.strictEqual(mapDest.source, 'map');
  assert.strictEqual(mapDest.is_explicit, true);
  assert.strictEqual(mapDest.detail, 'Depan Bank BRI');
});

