const test = require('node:test');
const assert = require('node:assert');
const db = require('../server/database/db');
const { installConnectorMock, restoreConnectorMock, setConnectorHandler } = require('./helpers/connectorMock');

// Connector mock: read from DB so integration tests that verify adopt/reorder still pass
function dbReadingConnectorHandler(op, branchId) {
  if (op !== 'catalog.get') return { branch_id: branchId, categories: [], items: [] };
  const categories = db.prepare(`
    SELECT id, name, image_url, sort_order FROM branch_categories WHERE branch_id = ? ORDER BY sort_order
  `).all(branchId);
  const items = db.prepare(`
    SELECT bp.product_id, bp.branch_id, bp.branch_category_id AS category_id, p.name, p.slug, p.description, p.image_url,
           bp.price, bp.is_available, bp.stock, bp.low_stock_threshold, bc.name as category_name
    FROM branch_products bp
    JOIN products p ON p.id = bp.product_id
    LEFT JOIN branch_categories bc ON bc.id = bp.branch_category_id AND bc.branch_id = bp.branch_id
    WHERE bp.branch_id = ?
  `).all(branchId);
  return { branch_id: branchId, categories, items };
}

// Install mock BEFORE requiring the app so api.js picks up the mocked connector
installConnectorMock();
setConnectorHandler(dbReadingConnectorHandler);

const app = require('../server/app');

// Helper to make mock requests to Express app
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

    // Extract query string
    if (path.includes('?')) {
      const parts = path.split('?');
      req.url = parts[0];
      const params = new URLSearchParams(parts[1]);
      for (const [k, v] of params.entries()) {
        req.query[k] = v;
      }
    }

    let statusCode = 200;
    let responseData = null;

    const res = {
      statusCode: 200,
      headers: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      setHeader(k, v) {
        this.headers[k] = v;
      },
      getHeader(k) {
        return this.headers[k];
      },
      writeHead(code, headers) {
        this.statusCode = code;
        if (headers) Object.assign(this.headers, headers);
      },
      json(data) {
        resolve({ status: this.statusCode, json: async () => data });
      },
      send(data) {
        let parsed = data;
        if (typeof data === 'string') {
          try { parsed = JSON.parse(data); } catch (_) {}
        }
        resolve({ status: this.statusCode, text: async () => data, json: async () => parsed });
      },
      end(data) {
        let parsed = data;
        if (typeof data === 'string') {
          try { parsed = JSON.parse(data); } catch (_) {}
        }
        resolve({ status: this.statusCode, text: async () => data, json: async () => parsed });
      }
    };

    app(req, res, (err) => {
      if (err) reject(err);
    });
  });
}

// Helper: Create an OTP-verified customer session token
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
  db.prepare(`UPDATE brands SET primary_color = '#b6ff00' WHERE id = 'brand_bangjo'`).run();
});


test('API GET /api/v1/brand/info: returns brand info for host app.mybangjo.com', async () => {
  const res = await mockFetch('/api/v1/brand/info');
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.brand.slug, 'bangjo');
  assert.strictEqual(data.brand.primary_color, '#b6ff00');
});

test('API GET /api/v1/catalog/menu: returns categories and active menu items', async () => {
  const res = await mockFetch('/api/v1/catalog/menu');
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(Array.isArray(data.categories));
  assert.ok(data.categories.length > 0);
  assert.ok(data.all_products.length >= 5);
});

test('API POST /api/v1/checkout/create-order: validates items and creates order snapshot (Online Midtrans)', async () => {
  const customerToken = await createCustomerSession('081234567890');

  const payload = {
    branch_id: 'branch_bangjo_barat',
    payment_method: 'midtrans',
    customer: {
      name: 'Budi Santoso',
      phone: '081234567890'
    },
    order_type: 'delivery',
    delivery: {
      address: 'Jl. Darmo Permai Selatan No. 12',
      latitude: -7.291230,
      longitude: 112.716750
    },
    items: [
      { id: '272', quantity: 2, note: 'Pedas level 2' },
      { id: '345', quantity: 2, note: 'Sedikit kuah' }
    ]
  };

  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify(payload)
  });

  assert.strictEqual(res.status, 201);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.order_id.startsWith('ord_'));
  assert.ok(data.order_number.startsWith('XN-'));
  // Subtotal = (25000 * 2) + (12000 * 2) = 50000 + 24000 = 74000
  assert.strictEqual(data.subtotal, 74000);
  assert.strictEqual(data.payment.method, 'midtrans');
  assert.ok(data.snap_token);

  // 1. Verify unauthorized visitor without customer session is rejected with 403 (NEW-01)
  const unauthRes = await mockFetch(`/api/v1/orders/${data.order_id}`);
  assert.strictEqual(unauthRes.status, 403, 'Unauthorized visitor without matching customer session must be rejected with 403');

  // 2. Verify query ?phone= cannot bypass authentication (NEW-01 Phone Bypass Guard)
  const phoneBypassRes = await mockFetch(`/api/v1/orders/${data.order_id}?phone=081234567890`);
  assert.strictEqual(phoneBypassRes.status, 403, 'Naked phone parameter MUST NOT grant access without OTP session token');

  // 3. Verify authorized customer with verified OTP session token gets sanitized projection (NEW-01)
  const orderRes = await mockFetch(`/api/v1/orders/${data.order_id}`, {
    headers: { 'x-customer-token': customerToken }
  });
  assert.strictEqual(orderRes.status, 200);
  const orderData = await orderRes.json();
  assert.strictEqual(orderData.success, true);
  assert.strictEqual(orderData.order.id, data.order_id);
  assert.strictEqual(orderData.payment.payment_method, 'midtrans');
  assert.strictEqual(orderData.payment.payment_status, 'pending');
  assert.strictEqual(orderData.payment.raw_webhook_response, undefined, 'raw_webhook_response must never leak to customer tracking');
  assert.strictEqual(orderData.payment.merchant_id, undefined, 'internal merchant_id must never leak to customer tracking');
});

test('API POST /api/v1/checkout/create-order: creates cash order without Midtrans snap token', async () => {
  const customerToken = await createCustomerSession('081234567891');

  const payload = {
    branch_id: 'branch_bangjo_barat',
    payment_method: 'cash',
    customer: {
      name: 'Budi Santoso',
      phone: '081234567891'
    },
    order_type: 'delivery',
    delivery: {
      address: 'Jl. Darmo Permai Selatan No. 12',
      latitude: -7.291230,
      longitude: 112.716750
    },
    items: [
      { id: '272', quantity: 1 }
    ]
  };

  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify(payload)
  });

  assert.strictEqual(res.status, 201);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.payment.method, 'cash');
  assert.strictEqual(data.snap_token, null);

  // P1 ISOLATION TEST (NEW-01/Pass4): Product belonging to Brand but NOT allocated to Branch -> STRICTLY REJECTED 400
  const unallocatedPayload = {
    branch_id: 'branch_bangjo_barat',
    payment_method: 'cash',
    customer: { name: 'Customer Test', phone: '081234567891' },
    order_type: 'delivery',
    delivery: { address: 'Jl. Darmo', latitude: -7.291230, longitude: 112.716750 },
    items: [{ id: '99999_unallocated_prod', quantity: 1 }]
  };

  const unallocatedRes = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify(unallocatedPayload)
  });
  assert.strictEqual(unallocatedRes.status, 400);
  const unallocatedData = await unallocatedRes.json();
  assert.strictEqual(unallocatedData.success, false);
});

test('Delivery schedule: no schedule sent -> order is ASAP (default), slot null (TIMEZONE RULE #12)', async () => {
  const customerToken = await createCustomerSession('081299996001');

  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_bangjo_barat',
      payment_method: 'cash',
      customer: { name: 'Asap Customer', phone: '081299996001' },
      order_type: 'delivery',
      delivery: { address: 'Jl. Darmo', latitude: -7.291230, longitude: 112.716750 },
      items: [{ id: '272', quantity: 1 }]
    })
  });

  assert.strictEqual(res.status, 201);
  const data = await res.json();
  const row = db.prepare('SELECT fulfillment_schedule_type, scheduled_slot_start FROM orders WHERE id = ?').get(data.order_id);
  assert.strictEqual(row.fulfillment_schedule_type, 'asap', 'Default schedule must stay ASAP');
  assert.strictEqual(row.scheduled_slot_start, null, 'No schedule -> no slot stored');
});

test('Delivery schedule: scheduled order stores the canonical device-timezone ISO start/end (TIMEZONE RULE #13)', async () => {
  const customerToken = await createCustomerSession('081299996002');
  // Device-local, timezone-aware ISO derived from the customer picker
  // (e.g. WIB +07:00). The server must persist it verbatim and must NOT
  // assume/translate any timezone.
  const isoStart = '2026-09-10T01:00:00+07:00';
  const isoEnd = '2026-09-10T01:30:00+07:00';

  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_bangjo_barat',
      payment_method: 'cash',
      customer: { name: 'Scheduled Customer', phone: '081299996002' },
      order_type: 'delivery',
      schedule_type: 'scheduled',
      scheduled_slot_start: isoStart,
      scheduled_slot_end: isoEnd,
      delivery: { address: 'Jl. Darmo', latitude: -7.291230, longitude: 112.716750 },
      items: [{ id: '272', quantity: 1 }]
    })
  });

  assert.strictEqual(res.status, 201);
  const data = await res.json();
  const row = db.prepare('SELECT fulfillment_schedule_type, scheduled_slot_start, scheduled_slot_end FROM orders WHERE id = ?').get(data.order_id);
  assert.strictEqual(row.fulfillment_schedule_type, 'scheduled');
  assert.strictEqual(row.scheduled_slot_start, isoStart, 'Server stores the device-local ISO verbatim');
  assert.strictEqual(row.scheduled_slot_end, isoEnd);
});

test('Pick-up schedule: scheduled pick-up order persists the device-timezone ISO like delivery', async () => {
  const customerToken = await createCustomerSession('081299996003');
  const isoStart = '2026-09-10T17:00:00+07:00';
  const isoEnd = '2026-09-10T17:30:00+07:00';

  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_bangjo_barat',
      payment_method: 'cash',
      customer: { name: 'Pickup Scheduled', phone: '081299996003' },
      order_type: 'pickup',
      schedule_type: 'scheduled',
      scheduled_slot_start: isoStart,
      scheduled_slot_end: isoEnd,
      items: [{ id: '272', quantity: 1 }]
    })
  });

  assert.strictEqual(res.status, 201);
  const data = await res.json();
  const row = db.prepare('SELECT order_type, fulfillment_schedule_type, scheduled_slot_start, scheduled_slot_end FROM orders WHERE id = ?').get(data.order_id);
  assert.strictEqual(row.order_type, 'pickup');
  assert.strictEqual(row.fulfillment_schedule_type, 'scheduled');
  assert.strictEqual(row.scheduled_slot_start, isoStart, 'Scheduled pick-up stores the ISO verbatim');
  assert.strictEqual(row.scheduled_slot_end, isoEnd);
});

test('Reservation create order: future booking accepted, same-day rejected via API', async () => {
  const customerToken = await createCustomerSession('081299996004');
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);

  // Future booking (tomorrow) -> accepted as pure table booking
  const okRes = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_bangjo_barat',
      payment_method: 'cash',
      customer: { name: 'Reservation Customer', phone: '081299996004' },
      order_type: 'reservation',
      reservation_date: tomorrowStr,
      reservation_time: '19:00',
      guest_count: 4,
      items: []
    })
  });
  const okResBody = await okRes.json();
  assert.strictEqual(okRes.status, 201, 'reservation create body: ' + JSON.stringify(okResBody));
  const okData = okResBody;
  const row = db.prepare('SELECT order_type, scheduled_slot_start, status, order_note FROM orders WHERE id = ?').get(okData.order_id);
  assert.strictEqual(row.order_type, 'reservation');
  assert.strictEqual(row.scheduled_slot_start, tomorrowStr);
  assert.strictEqual(row.status, 'confirmed');
  assert.ok(String(row.order_note).includes('4 Tamu'), 'Guest count persisted in reservation note');

  // Same-day -> strictly rejected by the server (never UI-only)
  const sameDayRes = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_bangjo_barat',
      payment_method: 'cash',
      customer: { name: 'Reservation Customer', phone: '081299996004' },
      order_type: 'reservation',
      reservation_date: todayStr,
      reservation_time: '19:00',
      guest_count: 4,
      items: []
    })
  });
  assert.strictEqual(sameDayRes.status, 400);
  const sameDayData = await sameDayRes.json();
  assert.strictEqual(sameDayData.status, 'SAME_DAY_RESERVATION_REJECTED');
});

test('API Admin: GET & PUT /api/v1/admin/brand updates theme color and logo', async () => {
  // Login first to get admin session token
  const loginRes = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'bangjo123' })
  });
  const loginData = await loginRes.json();
  const authHeaders = { authorization: 'Bearer ' + loginData.token };

  const getRes = await mockFetch('/api/v1/admin/brand', { headers: authHeaders });
  assert.strictEqual(getRes.status, 200);
  const getData = await getRes.json();
  assert.strictEqual(getData.success, true);

  const putRes = await mockFetch('/api/v1/admin/brand', {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Bangjo Express Resto',
      primary_color: '#ff4d4f',
      logo_url: '/assets/pwa/icon-192.png'
    })
  });
  assert.strictEqual(putRes.status, 200);
  const putData = await putRes.json();
  assert.strictEqual(putData.success, true);
  assert.strictEqual(putData.brand.primary_color, '#ff4d4f');
  assert.strictEqual(putData.brand.name, 'Bangjo Express Resto');
});

test('API Admin: GET /api/v1/admin/products & GET /api/v1/admin/branches', async () => {
  const loginRes = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'bangjo123' })
  });
  const loginData = await loginRes.json();
  const authHeaders = { authorization: 'Bearer ' + loginData.token };

  const prodRes = await mockFetch('/api/v1/admin/products', { headers: authHeaders });
  assert.strictEqual(prodRes.status, 200);
  const prodData = await prodRes.json();
  assert.strictEqual(prodData.success, true);
  assert.ok(prodData.products.length >= 5);

  const branchRes = await mockFetch('/api/v1/admin/branches', { headers: authHeaders });
  assert.strictEqual(branchRes.status, 200);
  const branchData = await branchRes.json();
  assert.strictEqual(branchData.success, true);
  assert.ok(branchData.branches.length >= 1);
});

test('API Admin: GET /api/v1/admin/analytics/summary returns metrics', async () => {
  const loginRes = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'bangjo123' })
  });
  const loginData = await loginRes.json();
  const authHeaders = { authorization: 'Bearer ' + loginData.token };

  const res = await mockFetch('/api/v1/admin/analytics/summary', { headers: authHeaders });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(typeof data.summary.total_orders === 'number');
  assert.ok(typeof data.summary.total_omzet === 'number');
});

test('API Merchant Auth: POST /api/v1/auth/merchant/login authenticates owner', async () => {
  const badRes = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'wrongpassword' })
  });
  assert.strictEqual(badRes.status, 401);

  const goodRes = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'bangjo123' })
  });
  assert.strictEqual(goodRes.status, 200);
  const goodData = await goodRes.json();
  assert.strictEqual(goodData.success, true);
  assert.ok(goodData.token.startsWith('xnt_auth_'));
  assert.strictEqual(goodData.user.username, 'admin');
  assert.strictEqual(goodData.user.role, 'owner');

  // Test /auth/merchant/me with valid Bearer token
  const meRes = await mockFetch('/api/v1/auth/merchant/me', {
    headers: { authorization: 'Bearer ' + goodData.token }
  });
  assert.strictEqual(meRes.status, 200);
  const meData = await meRes.json();
  assert.strictEqual(meData.success, true);
  assert.strictEqual(meData.user.username, 'admin');
  assert.strictEqual(meData.user.role, 'owner');

  // Test /auth/merchant/me without token -> 401 Unauthorized
  const unauthRes = await mockFetch('/api/v1/auth/merchant/me');
  assert.strictEqual(unauthRes.status, 401);
});

test('API Admin Branch Creation: Valid Branch with WhatsApp succeeds', async () => {
  const loginRes = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'bangjo123' })
  });
  const loginData = await loginRes.json();
  const authHeaders = { authorization: 'Bearer ' + loginData.token };

  const payload = {
    name: 'Bangjo Surabaya Timur',
    phone: '081987654321',
    address_text: 'Jl. Kertajaya No. 99, Surabaya',
    latitude: -7.2801,
    longitude: 112.7562
  };

  const res = await mockFetch('/api/v1/admin/branches', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(payload)
  });

  assert.strictEqual(res.status, 201);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.branch_id.startsWith('branch_'));
  assert.strictEqual(data.branch.phone, '081987654321');
  assert.strictEqual(data.branch.name, 'Bangjo Surabaya Timur');
});

test('API Admin Branch Creation: Missing WhatsApp number is REJECTED', async () => {
  const loginRes = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'bangjo123' })
  });
  const loginData = await loginRes.json();
  const authHeaders = { authorization: 'Bearer ' + loginData.token };

  const payloadWithoutPhone = {
    name: 'Bangjo Cabang Tanpa WA',
    address_text: 'Jl. Rungkut No. 12',
    phone: '' // Missing phone
  };

  const res = await mockFetch('/api/v1/admin/branches', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(payloadWithoutPhone)
  });

  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.ok(data.error.includes('WhatsApp'));
});

test('API Admin Branch Creation: OWNER_WHATSAPP_NUMBER in env does not act as fallback', async () => {
  const loginRes = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'bangjo123' })
  });
  const loginData = await loginRes.json();
  const authHeaders = { authorization: 'Bearer ' + loginData.token };

  process.env.OWNER_WHATSAPP_NUMBER = '628999999999';

  const payload = {
    name: 'Bangjo Cabang Bypass Attempt',
    address_text: 'Jl. Manyar No. 44'
    // phone omitted completely
  };

  const res = await mockFetch('/api/v1/admin/branches', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(payload)
  });

  // Must still be rejected even if OWNER_WHATSAPP_NUMBER is present
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.ok(data.error.includes('WhatsApp'));

  delete process.env.OWNER_WHATSAPP_NUMBER;
});

test('API Kitchen RBAC: Branch-level operators cannot view or update orders from another branch (FINDING-01 & FINDING-02)', async () => {
  // 1. Create a branch-scoped kitchen user for branch_bangjo_barat
  const db = require('../server/database/db');
  const crypto = require('crypto');
  const kitchenPasswordHash = crypto.createHash('sha256').update('kitchen123').digest('hex');

  db.prepare(`
    INSERT OR REPLACE INTO users (id, brand_id, organization_id, branch_id, username, email, password_hash, full_name, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'usr_kitchen_barat',
    'brand_bangjo',
    'org_xentra_holding',
    'branch_bangjo_barat',
    'kitchen_barat',
    'kitchen_barat@bangjo.com',
    kitchenPasswordHash,
    'Koki Barat',
    'kitchen'
  );

  // 2. Login as kitchen_barat
  const loginRes = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'kitchen_barat', password: 'kitchen123' })
  });
  const loginData = await loginRes.json();
  assert.strictEqual(loginData.success, true);
  assert.strictEqual(loginData.user.branch_id, 'branch_bangjo_barat');
  const authHeaders = { authorization: 'Bearer ' + loginData.token };

  // 3. Attempting to query queue of another branch explicitly returns 403 FORBIDDEN_BRANCH_ACCESS
  const forbiddenQueueRes = await mockFetch('/api/v1/kitchen/queue?branch_id=branch_bangjo_timur', {
    headers: authHeaders
  });
  assert.strictEqual(forbiddenQueueRes.status, 403);
  const forbiddenQueueData = await forbiddenQueueRes.json();
  assert.strictEqual(forbiddenQueueData.error, 'FORBIDDEN_BRANCH_ACCESS');

  // 4. Create an order assigned to a DIFFERENT branch (branch_bangjo_timur)
  const orderOtherBranchId = 'ord_timur_' + Date.now();
  db.prepare(`
    INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active)
    VALUES ('branch_bangjo_timur', 'brand_bangjo', 'Bangjo Timur', 'bangjo-timur', 'Jl. Timur No. 1', -7.28, 112.75, '081234567891', 1)
  `).run();

  db.prepare(`
    INSERT INTO orders (id, brand_id, branch_id, order_number, customer_name, customer_phone, order_type, status, subtotal, grand_total)
    VALUES (?, 'brand_bangjo', 'branch_bangjo_timur', ?, 'Customer Timur', '081200000000', 'dine_in', 'confirmed', 50000, 50000)
  `).run(orderOtherBranchId, 'XN-TIMUR-' + Date.now());

  // 5. Kitchen Barat attempts to modify status of order in Branch Timur -> REJECTED 404/Forbidden
  const updateRes = await mockFetch(`/api/v1/kitchen/orders/${orderOtherBranchId}/status`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ status: 'preparing' })
  });

  assert.strictEqual(updateRes.status, 404);
  const updateData = await updateRes.json();
  assert.strictEqual(updateData.success, false);
  assert.ok(updateData.error.includes('kewenangan cabang'));

  // 6. Create an order in Barat branch to test role transition whitelist (FINDING-02A)
  const orderBaratId = 'ord_barat_' + Date.now();
  db.prepare(`
    INSERT INTO orders (id, brand_id, branch_id, order_number, customer_name, customer_phone, order_type, status, subtotal, grand_total)
    VALUES (?, 'brand_bangjo', 'branch_bangjo_barat', ?, 'Customer Barat', '081200000001', 'dine_in', 'confirmed', 35000, 35000)
  `).run(orderBaratId, 'XN-BARAT-' + Date.now());

  // Kitchen role attempts governance action ('cancelled' / 'refunded') -> REJECTED 403 INSUFFICIENT_ROLE_AUTHORITY
  const kitchenCancelRes = await mockFetch(`/api/v1/kitchen/orders/${orderBaratId}/status`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ status: 'cancelled' })
  });
  assert.strictEqual(kitchenCancelRes.status, 403);
  const kitchenCancelData = await kitchenCancelRes.json();
  assert.strictEqual(kitchenCancelData.error, 'INSUFFICIENT_ROLE_AUTHORITY');

  // Kitchen role advances operational cooking state ('preparing') -> ALLOWED 200 OK
  const kitchenCookRes = await mockFetch(`/api/v1/kitchen/orders/${orderBaratId}/status`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ status: 'preparing' })
  });
  assert.strictEqual(kitchenCookRes.status, 200);
  const kitchenCookData = await kitchenCookRes.json();
  assert.strictEqual(kitchenCookData.success, true);
  assert.strictEqual(kitchenCookData.new_status, 'preparing');
});

test('API Reporting RBAC: Branch manager cannot access multi-branch comparison report (NEW-01/Pass4)', async () => {
  const db = require('../server/database/db');
  const crypto = require('crypto');
  const bmPasswordHash = crypto.createHash('sha256').update('bm123').digest('hex');

  db.prepare(`
    INSERT OR REPLACE INTO users (id, brand_id, organization_id, branch_id, username, email, password_hash, full_name, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'usr_bm_barat',
    'brand_bangjo',
    'org_xentra_holding',
    'branch_bangjo_barat',
    'bm_barat',
    'bm_barat@bangjo.com',
    bmPasswordHash,
    'Branch Manager Barat',
    'branch_manager'
  );

  // Login as branch_manager
  const loginRes = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'bm_barat', password: 'bm123' })
  });
  const loginData = await loginRes.json();
  const authHeaders = { authorization: 'Bearer ' + loginData.token };

  // 1. Branch manager can access branch-scoped sales report -> 200 OK
  const salesRes = await mockFetch('/api/v1/reports/sales', { headers: authHeaders });
  assert.strictEqual(salesRes.status, 200);
  const salesData = await salesRes.json();
  assert.strictEqual(salesData.success, true);

  // 2. Branch manager attempts to access multi-branch comparison / branches report -> STRICTLY FORBIDDEN 403
  const comparisonRes = await mockFetch('/api/v1/reports/branch_comparison', { headers: authHeaders });
  assert.strictEqual(comparisonRes.status, 403);
  const comparisonData = await comparisonRes.json();
  assert.strictEqual(comparisonData.error, 'INSUFFICIENT_REPORT_AUTHORITY');

  const branchesRes = await mockFetch('/api/v1/reports/branches', { headers: authHeaders });
  assert.strictEqual(branchesRes.status, 403);
  const branchesData = await branchesRes.json();
  assert.strictEqual(branchesData.error, 'INSUFFICIENT_REPORT_AUTHORITY');

  // 3. Branch manager can update their assigned branch profile (lat, lng, address) -> 200 OK
  const updateProfileRes = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat', {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      address_text: 'Jl. Mayjen Sungkono No. 99, Surabaya Barat',
      latitude: -7.2915,
      longitude: 112.7158
    })
  });
  assert.strictEqual(updateProfileRes.status, 200);
  const updateProfileData = await updateProfileRes.json();
  assert.strictEqual(updateProfileData.success, true);

  // 4. Branch manager attempts to update ANOTHER branch -> 403 FORBIDDEN_BRANCH_SCOPE
  const updateOtherRes = await mockFetch('/api/v1/admin/branches/branch_bangjo_timur', {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ name: 'Hacked Name' })
  });
  assert.strictEqual(updateOtherRes.status, 403);
});

test('API Delivery Checkout: Strictly rejects delivery orders without valid coordinates (NEW-02/Pass4)', async () => {
  const customerToken = await createCustomerSession('081234567892');

  // Attempt delivery order with formatted_address only but missing numeric lat/lng -> REJECTED 400
  const invalidCoordsPayload = {
    branch_id: 'branch_bangjo_barat',
    payment_method: 'cash',
    customer: { name: 'Customer Jauh', phone: '081234567892' },
    order_type: 'delivery',
    address: { formatted_address: 'Lokasi Sangat Jauh 50 km' }, // No lat/lng
    items: [{ id: '272', quantity: 1 }]
  };

  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify(invalidCoordsPayload)
  });

  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.ok(data.error.includes('Titik koordinat pengantaran'));
});

test('API POS Cash Settlement: POST /api/v1/pos/orders/:id/settle-cash completes lifecycle with auth guard', async () => {
  const db = require('../server/database/db');
  const customerToken = await createCustomerSession('081234567893');

  // 1. Create a cash order via checkout
  const orderRes = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_bangjo_barat',
      payment_method: 'cash',
      customer: { name: 'Customer Bayar Tunai', phone: '081234567893' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(orderRes.status, 201);
  const orderData = await orderRes.json();
  const orderId = orderData.order_id;

  // 2. Unauthenticated attempt -> 401 Unauthorized
  const unauthRes = await mockFetch(`/api/v1/pos/orders/${orderId}/settle-cash`, {
    method: 'POST',
    body: JSON.stringify({ amount_tendered: 50000 })
  });
  assert.strictEqual(unauthRes.status, 401);

  // 3. Login as authorized merchant staff
  const loginRes = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'bangjo123' })
  });
  assert.strictEqual(loginRes.status, 200);
  const loginData = await loginRes.json();
  const authHeaders = { authorization: `Bearer ${loginData.token}` };

  // 4. R5 CHECK-2: a customer-app cash order starts AWAITING_BRANCH_ACCEPTANCE
  // ('pending') and CANNOT be settled before the branch ACCEPTs it — cash
  // settlement is a payment mutation, NOT an acceptance act.
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'pending');
  const prematureSettle = await mockFetch(`/api/v1/pos/orders/${orderId}/settle-cash`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ amount_tendered: 50000 })
  });
  assert.strictEqual(prematureSettle.status, 400);
  assert.ok(/ORDER_NOT_ACCEPTED/.test((await prematureSettle.json()).error || ''), 'unaccepted cash order cannot be settled');
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'pending');

  // 4b. Branch ACCEPT (admin seed user is role 'owner' → brand-wide) → confirmed.
  const acceptRes = await mockFetch(`/api/v1/orders/${orderId}/branch-acceptance`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ decision: 'accept', note: 'Diterima kas' })
  });
  assert.strictEqual(acceptRes.status, 200);
  assert.strictEqual((await acceptRes.json()).new_status, 'confirmed');

  // 4c. Authorized cash settlement AFTER acceptance
  const settleRes = await mockFetch(`/api/v1/pos/orders/${orderId}/settle-cash`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ amount_tendered: 50000 })
  });
  assert.strictEqual(settleRes.status, 200);
  const settleData = await settleRes.json();
  assert.strictEqual(settleData.success, true);
  assert.strictEqual(settleData.payment.payment_status, 'settlement');

  // Settlement must NOT mutate order acceptance state: stays confirmed.
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'confirmed');

  // Verify in database: order_payments.payment_status is settlement
  const payRow = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(orderId);
  assert.strictEqual(payRow.payment_status, 'settlement');

  // 5. Idempotent retry -> 200 with idempotent: true
  const retryRes = await mockFetch(`/api/v1/pos/orders/${orderId}/settle-cash`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ amount_tendered: 50000 })
  });
  assert.strictEqual(retryRes.status, 200);
  const retryData = await retryRes.json();
  assert.strictEqual(retryData.idempotent, true);
});

test('API 21: POS Shift Lifecycle Endpoints (Open, Current, Cash Movement, Close)', async () => {
  // 1. Seed dedicated cashier in branch barat
  const crypto = require('crypto');
  const passHash = crypto.createHash('sha256').update('kasir123').digest('hex');
  db.prepare(`
    INSERT OR REPLACE INTO users (id, organization_id, username, password_hash, role, brand_id, branch_id)
    VALUES ('usr_cashier_barat_main', 'org_xentra_holding', 'kasir_barat_main', ?, 'cashier', 'brand_bangjo', 'branch_bangjo_barat')
  `).run(passHash);
  db.prepare("DELETE FROM pos_shifts WHERE cashier_id = 'usr_cashier_barat_main'").run();

  // Login as authorized merchant staff
  const loginRes = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'bangjo123' })
  });
  assert.strictEqual(loginRes.status, 200);
  const loginData = await loginRes.json();
  const authHeaders = { authorization: `Bearer ${loginData.token}` };

  // 2. Open Shift
  const openRes = await mockFetch('/api/v1/pos/shifts/open', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ branch_id: 'branch_bangjo_barat', cashier_id: 'usr_cashier_barat_main', starting_float: 200000 })
  });
  assert.strictEqual(openRes.status, 201);
  const openData = await openRes.json();
  assert.strictEqual(openData.success, true);
  assert.strictEqual(openData.shift.starting_float, 200000);
  const shiftId = openData.shift.id;

  // 3. Get Current Shift
  const currentRes = await mockFetch('/api/v1/pos/shifts/current?branch_id=branch_bangjo_barat&cashier_id=usr_cashier_barat_main', {
    headers: authHeaders
  });
  assert.strictEqual(currentRes.status, 200);
  const currentData = await currentRes.json();
  assert.strictEqual(currentData.has_active_shift, true);
  assert.strictEqual(currentData.shift.id, shiftId);

  // 4. Cash Movement (Cash In & Cash Out)
  const cashInRes = await mockFetch(`/api/v1/pos/shifts/${shiftId}/cash-movement`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ type: 'in', amount: 50000, reason: 'Tambahan modal koin' })
  });
  assert.strictEqual(cashInRes.status, 200);
  const cashInData = await cashInRes.json();
  assert.strictEqual(cashInData.shift.total_cash_in, 50000);

  const cashOutRes = await mockFetch(`/api/v1/pos/shifts/${shiftId}/cash-movement`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ type: 'out', amount: 20000, reason: 'Beli es batu' })
  });
  assert.strictEqual(cashOutRes.status, 200);
  const cashOutData = await cashOutRes.json();
  assert.strictEqual(cashOutData.shift.total_cash_out, 20000);

  // 5. Close Shift
  const closeRes = await mockFetch(`/api/v1/pos/shifts/${shiftId}/close`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ actual_cash: 230000 }) // Expected: 200k + 50k - 20k = 230k (Balanced)
  });
  assert.strictEqual(closeRes.status, 200);
  const closeData = await closeRes.json();
  assert.strictEqual(closeData.success, true);
  assert.strictEqual(closeData.shift.status, 'closed');
  assert.strictEqual(closeData.shift.variance, 0);

  // 6. Cross-Cashier / Cross-Branch Ownership Guard Verification (NEW-01)
  // Seed Cashier A and Cashier B
  const passHash2 = crypto.createHash('sha256').update('kasir123').digest('hex');
  db.prepare(`
    INSERT OR REPLACE INTO users (id, organization_id, username, password_hash, role, brand_id, branch_id)
    VALUES 
      ('usr_cashier_a', 'org_xentra_holding', 'kasir_a', ?, 'cashier', 'brand_bangjo', 'branch_bangjo_barat'),
      ('usr_cashier_b', 'org_xentra_holding', 'kasir_b', ?, 'cashier', 'brand_bangjo', 'branch_bangjo_barat')
  `).run(passHash2, passHash2);

  // Cashier B opens a shift
  const { PosShiftService } = require('../domains/pos');
  db.prepare("DELETE FROM pos_shifts WHERE cashier_id = 'usr_cashier_b'").run();
  const shiftB = PosShiftService.openShift({
    branch_id: 'branch_bangjo_barat',
    cashier_id: 'usr_cashier_b',
    starting_float: 100000
  });

  // Login as Cashier A
  const loginCashierARes = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'kasir_a', password: 'kasir123' })
  });
  const loginCashierAData = await loginCashierARes.json();
  const cashierAHeaders = { authorization: `Bearer ${loginCashierAData.token}` };

  // Cashier A attempts cash-movement on Shift B -> 403 Forbidden
  const forbiddenMoveRes = await mockFetch(`/api/v1/pos/shifts/${shiftB.id}/cash-movement`, {
    method: 'POST',
    headers: cashierAHeaders,
    body: JSON.stringify({ type: 'in', amount: 500000 })
  });
  assert.strictEqual(forbiddenMoveRes.status, 403);

  // Cashier A attempts close on Shift B -> 403 Forbidden
  const forbiddenCloseRes = await mockFetch(`/api/v1/pos/shifts/${shiftB.id}/close`, {
    method: 'POST',
    headers: cashierAHeaders,
    body: JSON.stringify({ actual_cash: 100000 })
  });
  assert.strictEqual(forbiddenCloseRes.status, 403);

  // Clean up shiftB
  PosShiftService.closeShift({
    shift_id: shiftB.id,
    actual_cash: 100000,
    actor_id: 'usr_cashier_b',
    actor_role: 'cashier'
  });

  // 7. Cashier Cross-Branch Open Shift Guard (NEW-03)
  // Cashier A assigned to branch_bangjo_barat tries to open shift in branch_bangjo_timur -> 403 Forbidden
  const forbiddenOpenRes = await mockFetch('/api/v1/pos/shifts/open', {
    method: 'POST',
    headers: cashierAHeaders,
    body: JSON.stringify({ branch_id: 'branch_bangjo_timur', starting_float: 50000 })
  });
  assert.strictEqual(forbiddenOpenRes.status, 403);

  // 8. Cashier Cross-Branch Order Access Guard (NEW-02)
  // Cashier A assigned to branch_bangjo_barat attempts to view order belonging to branch_bangjo_timur -> 403 Forbidden
  const timurOrderId = `ord_test_timur_${Date.now()}`;
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, ?, 'brand_bangjo', 'branch_bangjo_timur', 'Tamu Timur', '0899999999', 'dine_in', 'pos_cashier', 50000, 50000, 'cash', 'pending')
  `).run(timurOrderId, `XN-TIMUR-${Date.now()}`);

  const crossBranchOrderRes = await mockFetch(`/api/v1/orders/${timurOrderId}`, {
    headers: cashierAHeaders
  });
  assert.strictEqual(crossBranchOrderRes.status, 403, 'Branch-scoped cashier MUST NOT read orders of another branch');
});

/* =============================================================================
   TASK B1 — ORGANIZATION → BRAND → BRANCH OPERATIONAL BOUNDARY
   Hierarchy integrity, branch scope enforcement, operational state transitions,
   runtime consumer effect, and the branch_operation_logs audit trail.
   ============================================================================= */

async function b1Login(username, password) {
  const res = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  return { status: res.status, data, headers: { authorization: 'Bearer ' + data.token } };
}

async function b1PutBranch(token, branchId, payload) {
  return mockFetch('/api/v1/admin/branches/' + branchId, {
    method: 'PUT',
    headers: token,
    body: JSON.stringify(payload)
  });
}

test('B1 Hierarchy: cross-brand branch tamper is rejected and admin list is brand-scoped', async () => {
  const crypto = require('crypto');
  // Seed a second Organization → Brand → Branch that does NOT belong to the resolved tenant.
  db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_other_co', 'Other Co Holding', 'other-co')`).run();
  db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_other_co', 'org_other_co', 'Other Brand', 'other-brand')`).run();
  db.prepare(`
    INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active)
    VALUES ('branch_other_co', 'brand_other_co', 'Cabang Brand Lain', 'cabang-lain', 'Jl. Lain No. 1', -6.2, 106.8, '081222222222', 1)
  `).run();

  const owner = await b1Login('admin', 'bangjo123');
  assert.strictEqual(owner.status, 200);

  // 1. Admin branch list must NOT expose another brand's branch.
  const listRes = await mockFetch('/api/v1/admin/branches', { headers: owner.headers });
  const listData = await listRes.json();
  assert.strictEqual(listRes.status, 200);
  assert.ok(listData.branches.every((b) => b.brand_id === undefined || b.brand_id === 'brand_bangjo'));
  assert.ok(!listData.branches.some((b) => b.id === 'branch_other_co'), 'Cross-brand branch leaked into admin list');

  // 2. Mutating a branch of ANOTHER brand by swapping the Branch ID → 404 (ownership guard).
  const tamperRes = await b1PutBranch(owner.headers, 'branch_other_co', { is_open_override: 0 });
  assert.strictEqual(tamperRes.status, 404, 'Cross-brand branch mutation must be rejected');
  const tamperData = await tamperRes.json();
  assert.strictEqual(tamperData.success, false);

  // 3. The foreign branch remains untouched.
  const foreignBranch = db.prepare("SELECT is_open_override FROM branches WHERE id = 'branch_other_co'").get();
  assert.strictEqual(foreignBranch.is_open_override, 1);
});

test('B1 Branch Manager scope: own-branch operational transition allowed, cross-branch denied', async () => {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update('bm1pass').digest('hex');
  db.prepare(`
    INSERT OR REPLACE INTO users (id, brand_id, organization_id, branch_id, username, email, password_hash, full_name, role)
    VALUES ('usr_b1_bm', 'brand_bangjo', 'org_xentra_holding', 'branch_bangjo_barat', 'bm_b1', 'bm_b1@bangjo.com', ?, 'BM B1', 'branch_manager')
  `).run(hash);
  db.prepare(`
    INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active, is_open_override)
    VALUES ('branch_b1_timur', 'brand_bangjo', 'Bangjo B1 Timur', 'bangjo-b1-timur', 'Jl. B1 No. 1', -7.29, 112.74, '081233333333', 1, 1)
  `).run();

  const bm = await b1Login('bm_b1', 'bm1pass');
  assert.strictEqual(bm.status, 200);
  assert.strictEqual(bm.data.user.branch_id, 'branch_bangjo_barat');

  // Sanity: branch is open before the transition (server-authoritative state).
  const before = db.prepare("SELECT is_open_override FROM branches WHERE id = 'branch_bangjo_barat'").get();
  assert.strictEqual(before.is_open_override, 1);

  // 1. Branch Manager closes ONLY their own assigned branch → 200, state persisted.
  const closeRes = await b1PutBranch(bm.headers, 'branch_bangjo_barat', { is_open_override: 0 });
  assert.strictEqual(closeRes.status, 200);
  const closeData = await closeRes.json();
  assert.strictEqual(closeData.success, true);
  assert.strictEqual(closeData.branch.is_open_override, 0);
  const afterClose = db.prepare("SELECT is_open_override FROM branches WHERE id = 'branch_bangjo_barat'").get();
  assert.strictEqual(afterClose.is_open_override, 0);

  // 2. Audit trail recorded: actor = branch_manager, field, before/after values.
  const auditRow = db.prepare(`
    SELECT * FROM branch_operation_logs
    WHERE branch_id = 'branch_bangjo_barat' AND field = 'is_open_override'
    ORDER BY created_at DESC, rowid DESC LIMIT 1
  `).get();
  assert.ok(auditRow, 'branch_operation_logs row must exist for an authorized operational mutation');
  assert.strictEqual(auditRow.actor_role, 'branch_manager');
  assert.strictEqual(auditRow.previous_value, '1');
  assert.strictEqual(auditRow.new_value, '0');
  assert.strictEqual(auditRow.brand_id, 'brand_bangjo');
  assert.strictEqual(auditRow.authorized, 1);

  // 3. Branch Manager tries to close ANOTHER branch → 403 FORBIDDEN_BRANCH_SCOPE.
  const crossRes = await b1PutBranch(bm.headers, 'branch_b1_timur', { is_open_override: 0 });
  assert.strictEqual(crossRes.status, 403);
  const crossData = await crossRes.json();
  assert.strictEqual(crossData.error, 'FORBIDDEN_BRANCH_SCOPE');
  const untouched = db.prepare("SELECT is_open_override FROM branches WHERE id = 'branch_b1_timur'").get();
  assert.strictEqual(untouched.is_open_override, 1);

  // Restore barat to open so later tests keep a deliverable branch.
  const reopenRes = await b1PutBranch(bm.headers, 'branch_bangjo_barat', { is_open_override: 1 });
  assert.strictEqual(reopenRes.status, 200);
});

test('B1 Operational state: invalid transitions rejected; state is server-authoritative for runtime consumers', async () => {
  const owner = await b1Login('admin', 'bangjo123');
  assert.strictEqual(owner.status, 200);

  // 1. Invalid operational-state values are rejected (no silent persistence of arbitrary values).
  const invalid1 = await b1PutBranch(owner.headers, 'branch_bangjo_barat', { is_open_override: 2 });
  assert.strictEqual(invalid1.status, 400);
  const invalid2 = await b1PutBranch(owner.headers, 'branch_bangjo_barat', { is_open_override: 'buka' });
  assert.strictEqual(invalid2.status, 400);
  const invalid3 = await b1PutBranch(owner.headers, 'branch_bangjo_barat', { is_active: 'yes' });
  assert.strictEqual(invalid3.status, 400);
  const stillOpen = db.prepare("SELECT is_open_override, is_active FROM branches WHERE id = 'branch_bangjo_barat'").get();
  assert.strictEqual(stillOpen.is_open_override, 1);
  assert.strictEqual(stillOpen.is_active, 1);

  // 2. Public branch endpoint exposes the authoritative open/close state.
  const publicBefore = await mockFetch('/api/v1/brand/branches');
  const publicBeforeData = await publicBefore.json();
  const baratPublic = publicBeforeData.branches.find((b) => b.id === 'branch_bangjo_barat');
  assert.strictEqual(baratPublic.is_open_override, 1);

  // 3. Close EVERY currently-open delivery branch (deterministic: earlier tests may have created
  //    additional delivery branches in this shared in-file DB) → delivery matching must find no
  //    eligible branch (fail-safe; operational state is authoritative for the runtime consumer).
  const openDeliveryBranches = db.prepare(`
    SELECT b.id FROM branches b
    LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
    WHERE b.brand_id = 'brand_bangjo' AND b.is_active = 1 AND b.is_open_override = 1 AND s.is_delivery_active = 1
  `).all();
  assert.ok(openDeliveryBranches.length >= 1, 'Expected at least one open delivery branch before close');
  for (const br of openDeliveryBranches) {
    const closeRes = await b1PutBranch(owner.headers, br.id, { is_open_override: 0 });
    assert.strictEqual(closeRes.status, 200, 'Close of ' + br.id);
  }

  const publicClosed = await mockFetch('/api/v1/brand/branches');
  const publicClosedData = await publicClosed.json();
  assert.strictEqual(publicClosedData.branches.find((b) => b.id === 'branch_bangjo_barat').is_open_override, 0);

  const matchRes = await mockFetch('/api/v1/delivery/match-branch', {
    method: 'POST',
    body: JSON.stringify({ latitude: -7.29123, longitude: 112.71675 })
  });
  const matchData = await matchRes.json();
  assert.strictEqual(matchData.eligible, false, 'Closed branches must not be offered for delivery');
  assert.ok(/belum ada cabang/i.test(matchData.reason || ''), 'Reason must reflect no active branch');

  // 4. Reopen every branch that was closed so the shared test DB is left as found.
  for (const br of openDeliveryBranches) {
    const reopenRes = await b1PutBranch(owner.headers, br.id, { is_open_override: 1 });
    assert.strictEqual(reopenRes.status, 200, 'Reopen of ' + br.id);
  }
  const afterOpen = db.prepare("SELECT is_open_override FROM branches WHERE id = 'branch_bangjo_barat'").get();
  assert.strictEqual(afterOpen.is_open_override, 1);
});

test('B1 Authorization: operational mutation requires a managing role; login rejects cross-brand branch reference', async () => {
  const crypto = require('crypto');
  // 1. A kitchen (branch-scoped non-manager) role cannot mutate branch operational state.
  const kitchenHash = crypto.createHash('sha256').update('b1kitchen').digest('hex');
  db.prepare(`
    INSERT OR REPLACE INTO users (id, brand_id, organization_id, branch_id, username, email, password_hash, full_name, role)
    VALUES ('usr_b1_kitchen', 'brand_bangjo', 'org_xentra_holding', 'branch_bangjo_barat', 'b1_kitchen', 'b1_kitchen@bangjo.com', ?, 'Kitchen B1', 'kitchen')
  `).run(kitchenHash);
  const kitchen = await b1Login('b1_kitchen', 'b1kitchen');
  assert.strictEqual(kitchen.status, 200);
  const denied = await b1PutBranch(kitchen.headers, 'branch_bangjo_barat', { is_open_override: 0 });
  assert.strictEqual(denied.status, 403);
  const deniedData = await denied.json();
  assert.strictEqual(deniedData.error, 'INSUFFICIENT_PERMISSIONS');

  // 2. No token → 401.
  const anon = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat', {
    method: 'PUT',
    body: JSON.stringify({ is_open_override: 0 })
  });
  assert.strictEqual(anon.status, 401);

  // 3. Login integrity: an operator row whose branch_id references a branch of ANOTHER brand
  //    must not be able to log in (branch/brand relationship enforced at the identity boundary).
  const rogueHash = crypto.createHash('sha256').update('roguepass').digest('hex');
  db.prepare(`
    INSERT OR REPLACE INTO users (id, brand_id, organization_id, branch_id, username, email, password_hash, full_name, role)
    VALUES ('usr_b1_rogue', 'brand_bangjo', 'org_xentra_holding', 'branch_other_co', 'b1_rogue', 'b1_rogue@bangjo.com', ?, 'Rogue B1', 'branch_manager')
  `).run(rogueHash);
  const rogue = await b1Login('b1_rogue', 'roguepass');
  assert.strictEqual(rogue.status, 401);
  assert.strictEqual(rogue.data.error, 'BRANCH_TENANT_MISMATCH');
});

/* =============================================================================
   TASK C1 — PRODUCT → BRANCH ASSIGNMENT BOUNDARY
   Explicit assignment, brand consistency (app + DB trigger), owner/brand vs
   branch-manager authority split, assignment != inventory.
   ============================================================================= */

async function c1Login(username, password) {
  const res = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  return { status: res.status, data, headers: { authorization: 'Bearer ' + data.token } };
}

function c1CountAssignments(branchId, productId) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branchId, productId);
  return row.c;
}

test('C1 Assignment: valid assign is idempotent; cross-brand/cross-org rejected; DB trigger enforces brand consistency', async () => {
  const crypto = require('crypto');
  // Brand-master product owned by the resolved brand, and a product owned by ANOTHER brand.
  db.prepare(`
    INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, regular_price, is_active, sort_order)
    VALUES ('prod_c1_new', 'brand_bangjo', '34', 'Produk C1 Baru', 'produk-c1-baru', 18000, 20000, 1, 50)
  `).run();
  db.prepare(`
    INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, is_active)
    VALUES ('prod_other_co', 'brand_other_co', NULL, 'Produk Brand Lain', 'produk-brand-lain', 99999, 1)
  `).run();

  const owner = await c1Login('admin', 'bangjo123');
  assert.strictEqual(owner.status, 200);

  // 1. Valid assignment → 201; assignment row carries NO fabricated stock (stock stays NULL).
  const assignRes = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat/products', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ product_id: 'prod_c1_new' })
  });
  assert.strictEqual(assignRes.status, 201);
  const assignData = await assignRes.json();
  assert.strictEqual(assignData.success, true);
  assert.strictEqual(assignData.already_assigned, false);
  assert.strictEqual(assignData.assignment.product_id, 'prod_c1_new');
  assert.strictEqual(assignData.assignment.stock, null, 'Assignment must not fabricate inventory');
  assert.strictEqual(c1CountAssignments('branch_bangjo_barat', 'prod_c1_new'), 1);

  // 2. Duplicate assign → deterministic already_assigned (PK prevents inconsistent duplicates).
  const dupRes = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat/products', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ product_id: 'prod_c1_new' })
  });
  assert.strictEqual(dupRes.status, 200);
  const dupData = await dupRes.json();
  assert.strictEqual(dupData.already_assigned, true);
  assert.strictEqual(c1CountAssignments('branch_bangjo_barat', 'prod_c1_new'), 1);

  // 3. Product of Brand B cannot be assigned to a Branch of Brand A (app-layer).
  const crossBrandRes = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat/products', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ product_id: 'prod_other_co' })
  });
  assert.strictEqual(crossBrandRes.status, 400);
  const crossBrandData = await crossBrandRes.json();
  assert.strictEqual(crossBrandData.error, 'PRODUCT_BRAND_MISMATCH');
  assert.strictEqual(c1CountAssignments('branch_bangjo_barat', 'prod_other_co'), 0);

  // 4. Branch of another brand/organization is not addressable (ownership guard).
  const crossOrgRes = await mockFetch('/api/v1/admin/branches/branch_other_co/products', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ product_id: 'prod_c1_new' })
  });
  assert.strictEqual(crossOrgRes.status, 404);

  // 5. Database trigger rejects a raw cross-brand write even if the app layer is bypassed.
  assert.throws(
    () => db.prepare("INSERT INTO branch_products (branch_id, product_id) VALUES ('branch_bangjo_barat', 'prod_other_co')").run(),
    /CROSS_BRAND_ASSIGNMENT_REJECTED/,
    'DB-level brand-consistency trigger must abort cross-brand assignment'
  );

  // 6. Assignment list reflects the new row.
  const listRes = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat/products', { headers: owner.headers });
  assert.strictEqual(listRes.status, 200);
  const listData = await listRes.json();
  assert.ok(listData.assignments.some((a) => a.product_id === 'prod_c1_new' && a.product_name === 'Produk C1 Baru'));
});

test('C1 Branch scope: availability toggle is own-branch only, audited, and never mutates stock', async () => {
  const crypto = require('crypto');
  const bmHash = crypto.createHash('sha256').update('c1bmpass').digest('hex');
  db.prepare(`
    INSERT OR REPLACE INTO users (id, brand_id, organization_id, branch_id, username, email, password_hash, full_name, role)
    VALUES ('usr_c1_bm', 'brand_bangjo', 'org_xentra_holding', 'branch_bangjo_barat', 'bm_c1', 'bm_c1@bangjo.com', ?, 'BM C1', 'branch_manager')
  `).run(bmHash);
  db.prepare(`
    INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active)
    VALUES ('branch_c1_timur', 'brand_bangjo', 'Bangjo C1 Timur', 'bangjo-c1-timur', 'Jl. C1 No. 1', -7.28, 112.76, '081244444444', 1)
  `).run();

  const bm = await c1Login('bm_c1', 'c1bmpass');
  assert.strictEqual(bm.status, 200);

  const stockBefore = db.prepare("SELECT stock FROM branch_products WHERE branch_id = 'branch_bangjo_barat' AND product_id = 'prod_c1_new'").get().stock;

  // 1. Branch Manager toggles availability of an assigned product in OWN branch → 200.
  const toggleRes = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat/products/prod_c1_new', {
    method: 'PATCH',
    headers: bm.headers,
    body: JSON.stringify({ is_available: 0 })
  });
  assert.strictEqual(toggleRes.status, 200);
  const toggleData = await toggleRes.json();
  assert.strictEqual(toggleData.success, true);
  assert.strictEqual(toggleData.assignment.is_available, 0);

  const rowAfter = db.prepare("SELECT is_available, stock FROM branch_products WHERE branch_id = 'branch_bangjo_barat' AND product_id = 'prod_c1_new'").get();
  assert.strictEqual(rowAfter.is_available, 0, 'availability persisted server-side');
  assert.strictEqual(rowAfter.stock, stockBefore, 'availability toggle MUST NOT mutate stock (assignment != inventory)');

  // 2. Audit trail row exists (product-scoped, actor = branch_manager, authorized).
  const auditRow = db.prepare(`
    SELECT * FROM branch_operation_logs
    WHERE action = 'branch_product.update' AND product_id = 'prod_c1_new' AND branch_id = 'branch_bangjo_barat'
    ORDER BY created_at DESC, rowid DESC LIMIT 1
  `).get();
  assert.ok(auditRow, 'product availability change must be audited');
  assert.strictEqual(auditRow.actor_role, 'branch_manager');
  assert.strictEqual(auditRow.field, 'is_available');
  assert.strictEqual(auditRow.new_value, '0');
  assert.strictEqual(auditRow.authorized, 1);

  // 3. Branch Manager cannot toggle ANOTHER branch → 403 (scope guard runs before mutation).
  const crossRes = await mockFetch('/api/v1/admin/branches/branch_c1_timur/products/prod_c1_new', {
    method: 'PATCH',
    headers: bm.headers,
    body: JSON.stringify({ is_available: 0 })
  });
  assert.strictEqual(crossRes.status, 403);
  assert.strictEqual((await crossRes.json()).error, 'FORBIDDEN_BRANCH_SCOPE');

  // 4. Toggling a product that is NOT assigned to the branch → 404.
  const notAssignedRes = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat/products/prod_c1_never', {
    method: 'PATCH',
    headers: bm.headers,
    body: JSON.stringify({ is_available: 0 })
  });
  assert.strictEqual(notAssignedRes.status, 404);

  // 5. Invalid availability values → 400.
  const invalidRes = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat/products/prod_c1_new', {
    method: 'PATCH',
    headers: bm.headers,
    body: JSON.stringify({ is_available: 2 })
  });
  assert.strictEqual(invalidRes.status, 400);

  // 6. Non-manager roles cannot toggle availability.
  const kitchenHash = crypto.createHash('sha256').update('c1kitchen').digest('hex');
  db.prepare(`
    INSERT OR REPLACE INTO users (id, brand_id, organization_id, branch_id, username, email, password_hash, full_name, role)
    VALUES ('usr_c1_kitchen', 'brand_bangjo', 'org_xentra_holding', 'branch_bangjo_barat', 'c1_kitchen', 'c1_kitchen@bangjo.com', ?, 'Kitchen C1', 'kitchen')
  `).run(kitchenHash);
  const kitchen = await c1Login('c1_kitchen', 'c1kitchen');
  assert.strictEqual(kitchen.status, 200);
  const kitchenRes = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat/products/prod_c1_new', {
    method: 'PATCH',
    headers: kitchen.headers,
    body: JSON.stringify({ is_available: 1 })
  });
  assert.strictEqual(kitchenRes.status, 403);
  assert.strictEqual((await kitchenRes.json()).error, 'INSUFFICIENT_PERMISSIONS');

  // 7. Anonymous request → 401.
  const anonRes = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat/products/prod_c1_new', {
    method: 'PATCH',
    body: JSON.stringify({ is_available: 1 })
  });
  assert.strictEqual(anonRes.status, 401);

  // Restore availability so seeded-state consumers stay coherent.
  const restoreRes = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat/products/prod_c1_new', {
    method: 'PATCH',
    headers: bm.headers,
    body: JSON.stringify({ is_available: 1 })
  });
  assert.strictEqual(restoreRes.status, 200);
});

/* =============================================================================
   TASK C2 — BRANCH INVENTORY BOUNDARY
   Branch-scoped physical stock: atomic guarded mutation, ledger audit,
   no negative stock, idempotency, authorization & isolation.
   ============================================================================= */

async function c2Patch(branchId, productId, body, headers) {
  return mockFetch('/api/v1/admin/branches/' + branchId + '/inventory/' + productId, {
    method: 'PATCH',
    headers: headers || {},
    body: JSON.stringify(body)
  });
}

function c2Stock(branchId, productId) {
  const row = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branchId, productId);
  return row ? row.stock : undefined;
}

test('C2 Inventory: valid adjustment from NULL stock, ledger audit, negative & type/quantity validation', async () => {
  const owner = await c1Login('admin', 'bangjo123');
  assert.strictEqual(owner.status, 200);

  // prod_c1_new was assigned in the C1 test with stock NULL (assignment != inventory).
  assert.strictEqual(c2Stock('branch_bangjo_barat', 'prod_c1_new'), null, 'C1 assignment carries no stock');

  // 1. audit_adjustment +5 must start from zero (no fabricated stock before the adjustment).
  const plusRes = await c2Patch('branch_bangjo_barat', 'prod_c1_new', { movement_type: 'audit_adjustment', quantity: 5 }, owner.headers);
  assert.strictEqual(plusRes.status, 200);
  const plusData = await plusRes.json();
  assert.strictEqual(plusData.success, true);
  assert.strictEqual(plusData.movement.previous_stock, 0);
  assert.strictEqual(plusData.movement.current_stock, 5);
  assert.strictEqual(plusData.stock, 5);

  // 2. Reduction -3 → 2, ledger records actor role.
  const minusRes = await c2Patch('branch_bangjo_barat', 'prod_c1_new', { movement_type: 'audit_adjustment', quantity: -3, notes: 'Koreksi opname' }, owner.headers);
  assert.strictEqual(minusRes.status, 200);
  const ledgerRow = db.prepare(`
    SELECT * FROM inventory_movements
    WHERE branch_id = 'branch_bangjo_barat' AND product_id = 'prod_c1_new'
    ORDER BY created_at DESC, rowid DESC LIMIT 1
  `).get();
  assert.ok(ledgerRow, 'immutable ledger entry written');
  assert.strictEqual(ledgerRow.movement_type, 'audit_adjustment');
  assert.strictEqual(ledgerRow.quantity, -3);
  assert.strictEqual(ledgerRow.previous_stock, 5);
  assert.strictEqual(ledgerRow.current_stock, 2);
  assert.ok(String(ledgerRow.notes).startsWith('[owner]'), 'actor role recorded in ledger notes');

  // 3. Over-reduction below zero → 409, stock unchanged.
  const overRes = await c2Patch('branch_bangjo_barat', 'prod_c1_new', { movement_type: 'audit_adjustment', quantity: -5 }, owner.headers);
  assert.strictEqual(overRes.status, 409);
  assert.strictEqual((await overRes.json()).error, 'INSUFFICIENT_STOCK');
  assert.strictEqual(c2Stock('branch_bangjo_barat', 'prod_c1_new'), 2);

  // 4. Manual API refuses order/PO-owned movement types.
  const poRes = await c2Patch('branch_bangjo_barat', 'prod_c1_new', { movement_type: 'purchase_in', quantity: 5 }, owner.headers);
  assert.strictEqual(poRes.status, 400);
  assert.strictEqual((await poRes.json()).error, 'INVALID_MOVEMENT_TYPE');
  const saleRes = await c2Patch('branch_bangjo_barat', 'prod_c1_new', { movement_type: 'sale_deduction', quantity: -1 }, owner.headers);
  assert.strictEqual(saleRes.status, 400);

  // 5. waste_spoilage must be a reduction only.
  const wastePlus = await c2Patch('branch_bangjo_barat', 'prod_c1_new', { movement_type: 'waste_spoilage', quantity: 1 }, owner.headers);
  assert.strictEqual(wastePlus.status, 400);
  const wasteMinus = await c2Patch('branch_bangjo_barat', 'prod_c1_new', { movement_type: 'waste_spoilage', quantity: -1 }, owner.headers);
  assert.strictEqual(wasteMinus.status, 200);
  assert.strictEqual(c2Stock('branch_bangjo_barat', 'prod_c1_new'), 1);

  // 6. Quantity validation rejects invalid values.
  for (const bad of [-1, 1.5, 'abc', null, '', 0]) {
    // -1 alone is only valid if it would not go negative here; use a separate controlled case below.
    if (bad === -1) continue;
    const invalidRes = await c2Patch('branch_bangjo_barat', 'prod_c1_new', { movement_type: 'audit_adjustment', quantity: bad }, owner.headers);
    assert.strictEqual(invalidRes.status, 400, 'quantity=' + JSON.stringify(bad) + ' must be rejected');
    assert.strictEqual((await invalidRes.json()).error, 'INVALID_QUANTITY');
  }

  // 7. Inventory list reflects authoritative stock.
  const listRes = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat/inventory', { headers: owner.headers });
  assert.strictEqual(listRes.status, 200);
  const listData = await listRes.json();
  const row = listData.inventory.find((i) => i.product_id === 'prod_c1_new');
  assert.ok(row, 'assigned product present in branch inventory');
  assert.strictEqual(row.stock, 1);
});

test('C2 Inventory: isolation, authorization, idempotency and scope guards', async () => {
  const owner = await c1Login('admin', 'bangjo123');
  assert.strictEqual(owner.status, 200);

  // 1. Unassigned product → inventory mutation rejected (assignment boundary).
  const unassignedRes = await c2Patch('branch_bangjo_barat', 'prod_c1_never', { movement_type: 'audit_adjustment', quantity: 1 }, owner.headers);
  assert.strictEqual(unassignedRes.status, 404);

  // 2. Branch isolation: assign prod_c1_new to branch_c1_timur; mutating Timur must not touch Barat.
  await mockFetch('/api/v1/admin/branches/branch_c1_timur/products', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ product_id: 'prod_c1_new' })
  });
  assert.strictEqual(c2Stock('branch_c1_timur', 'prod_c1_new'), null);
  const baratBefore = c2Stock('branch_bangjo_barat', 'prod_c1_new');
  const timurPlus = await c2Patch('branch_c1_timur', 'prod_c1_new', { movement_type: 'audit_adjustment', quantity: 7 }, owner.headers);
  assert.strictEqual(timurPlus.status, 200);
  assert.strictEqual(c2Stock('branch_c1_timur', 'prod_c1_new'), 7);
  assert.strictEqual(c2Stock('branch_bangjo_barat', 'prod_c1_new'), baratBefore, 'Branch A mutation must not leak into Branch B');

  // 3. Cross-brand / cross-org branch is not addressable.
  const crossBrandRes = await c2Patch('branch_other_co', 'prod_c1_new', { movement_type: 'audit_adjustment', quantity: 1 }, owner.headers);
  assert.strictEqual(crossBrandRes.status, 404);

  // 4. Branch Manager: own branch allowed, foreign branch forbidden, kitchen/anonymous rejected.
  const bm = await c1Login('bm_c1', 'c1bmpass');
  assert.strictEqual(bm.status, 200);
  const bmOwn = await c2Patch('branch_bangjo_barat', 'prod_c1_new', { movement_type: 'audit_adjustment', quantity: 1, notes: 'Stok awal' }, bm.headers);
  assert.strictEqual(bmOwn.status, 200);
  const bmForeign = await c2Patch('branch_c1_timur', 'prod_c1_new', { movement_type: 'audit_adjustment', quantity: 1 }, bm.headers);
  assert.strictEqual(bmForeign.status, 403);
  assert.strictEqual((await bmForeign.json()).error, 'FORBIDDEN_BRANCH_SCOPE');

  const kitchen = await c1Login('c1_kitchen', 'c1kitchen');
  const kitchenRes = await c2Patch('branch_bangjo_barat', 'prod_c1_new', { movement_type: 'audit_adjustment', quantity: 1 }, kitchen.headers);
  assert.strictEqual(kitchenRes.status, 403);
  assert.strictEqual((await kitchenRes.json()).error, 'INSUFFICIENT_PERMISSIONS');

  const anonRes = await c2Patch('branch_bangjo_barat', 'prod_c1_new', { movement_type: 'audit_adjustment', quantity: 1 });
  assert.strictEqual(anonRes.status, 401);
  const anonList = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat/inventory');
  assert.strictEqual(anonList.status, 401);

  // 5. Idempotency through the API: same mutation_id twice → one stock change.
  const stockBeforeIdem = c2Stock('branch_bangjo_barat', 'prod_c1_new');
  const idem1 = await c2Patch('branch_bangjo_barat', 'prod_c1_new', { movement_type: 'audit_adjustment', quantity: 2, mutation_id: 'c2_mut_001' }, owner.headers);
  assert.strictEqual(idem1.status, 200);
  const idem1Data = await idem1.json();
  assert.strictEqual(idem1Data.movement.idempotent, undefined);
  const stockAfterOne = c2Stock('branch_bangjo_barat', 'prod_c1_new');
  assert.strictEqual(stockAfterOne, stockBeforeIdem + 2);

  const idem2 = await c2Patch('branch_bangjo_barat', 'prod_c1_new', { movement_type: 'audit_adjustment', quantity: 2, mutation_id: 'c2_mut_001' }, owner.headers);
  assert.strictEqual(idem2.status, 200);
  const idem2Data = await idem2.json();
  assert.strictEqual(idem2Data.movement.idempotent, true, 'replay must be flagged idempotent');
  assert.strictEqual(c2Stock('branch_bangjo_barat', 'prod_c1_new'), stockAfterOne, 'replay must not change stock');
  const idemLedgerCount = db.prepare("SELECT COUNT(*) AS c FROM inventory_movements WHERE mutation_id = 'c2_mut_001'").get().c;
  assert.strictEqual(idemLedgerCount, 1);
});

/* =============================================================================
   TASK C4 — BRANCH MATCHING (public runtime path)
   /delivery/match-branch accepts an optional cart and performs FULL-CART
   matching through canonical EligibilityService: partial-cart branches are
   excluded, no-branch-fits fails closed, invalid input fails safely.
   ============================================================================= */

test('C4 API /delivery/match-branch: full-cart matching fails closed when no branch can satisfy the cart', async () => {
  // Only products assigned to branch_bangjo_barat are eligible there; a
  // nonexistent product can never be fulfilled -> deterministic fail-closed
  // BEFORE any routing call (no network dependency).
  const res = await mockFetch('/api/v1/delivery/match-branch', {
    method: 'POST',
    body: JSON.stringify({
      latitude: -7.2912,
      longitude: 112.7154,
      subtotal: 10000,
      items: [{ id: 'c4_probe_never_assigned', quantity: 1 }]
    })
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.eligible, false);
  assert.strictEqual(data.branch, null);
  assert.ok(/memenuhi seluruh/i.test(data.reason || ''), 'explicit full-cart reason');
});

test('C4 API /delivery/match-branch: full-cart match selects the branch able to satisfy the cart (RouteService stubbed)', async () => {
  const RouteService = require('../server/services/RouteService');
  const original = RouteService.getRoadDistance;
  RouteService.getRoadDistance = async () => ({ distance_meters: 1500, duration_seconds: 480, provider: 'osrm' });
  try {
    const res = await mockFetch('/api/v1/delivery/match-branch', {
      method: 'POST',
      body: JSON.stringify({
        latitude: -7.2912,
        longitude: 112.7154,
        subtotal: 35000,
        items: [{ id: '272', quantity: 1 }] // seeded & assigned to branch_bangjo_barat only
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.eligible, true, 'cart item is assigned to the seeded branch');
    assert.strictEqual(data.branch.id, 'branch_bangjo_barat');
    assert.ok(data.delivery && typeof data.delivery.final_delivery_fee === 'number');
    assert.strictEqual(data.delivery.routing_provider, 'osrm', 'routing source is disclosed');
    assert.strictEqual(data.delivery.routing_estimated, false);
  } finally {
    RouteService.getRoadDistance = original;
  }
});

test('C4 API /delivery/match-branch: invalid input fails safely (400 non-array items, fail-safe invalid coordinates)', async () => {
  // Explicitly provided non-array items -> deterministic 400 (never silently ignored).
  const badItems = await mockFetch('/api/v1/delivery/match-branch', {
    method: 'POST',
    body: JSON.stringify({ latitude: -7.2912, longitude: 112.7154, items: 'not-an-array' })
  });
  assert.strictEqual(badItems.status, 400);
  assert.ok(/array/i.test((await badItems.json()).error || ''));

  // Out-of-range coordinates -> fail-safe eligible:false (no fabricated match).
  const badCoords = await mockFetch('/api/v1/delivery/match-branch', {
    method: 'POST',
    body: JSON.stringify({ latitude: 999, longitude: 112.7154 })
  });
  assert.strictEqual(badCoords.status, 200);
  const data = await badCoords.json();
  assert.strictEqual(data.eligible, false);
  assert.ok(/tidak valid/i.test(data.reason || ''), 'explicit invalid-coordinate reason');
});

/* =============================================================================
   C4/CHECKOUT CONTRACT ALIGNMENT — AUTO vs CUSTOMER_SELECTED fulfillment branch
   A client branch_id is a preference, never authority. Core validates the
   selected branch through canonical eligibility and REJECTS (no silent rematch)
   when it is ineligible. Exactly ONE fulfillment branch per order.
   ============================================================================= */

function csOrdersCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
}

function csAddBranch(id, { is_active = 1, is_open_override = 1, delivery = 1, pickup = 1, assign272 = false } = {}) {
  db.prepare(`INSERT OR REPLACE INTO branches
    (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active, is_open_override)
    VALUES (?, 'brand_bangjo', ?, ?, 'Jl. CS', -7.2912, 112.7154, '081200000099', ?, ?)`)
    .run(id, 'Cabang ' + id, id, is_active, is_open_override);
  db.prepare(`INSERT OR REPLACE INTO branch_delivery_settings
    (id, branch_id, is_delivery_active, is_pickup_active, max_radius_km, free_delivery_km, price_per_km, min_order_amount)
    VALUES (?, ?, ?, ?, 25, 5, 3000, 0)`)
    .run('bds_' + id, id, delivery, pickup);
  if (assign272) {
    db.prepare(`INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available)
      VALUES (?, '272', 35000, 10, 1)`).run(id);
  }
}

test('C4/Checkout CUSTOMER_SELECTED: valid selected branch is used and the order stores exactly one fulfillment branch', async () => {
  csAddBranch('branch_cs_open', { assign272: true });
  const customerToken = await createCustomerSession('081200000001');
  const before = csOrdersCount();
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_cs_open',
      payment_method: 'cash',
      customer: { name: 'Customer Pilih Cabang', phone: '081200000001' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(res.status, 201);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(csOrdersCount(), before + 1, 'exactly one order created');
  const order = db.prepare('SELECT branch_id FROM orders WHERE id = ?').get(data.order_id);
  assert.strictEqual(order.branch_id, 'branch_cs_open', 'order bound to the single selected branch');
});

test('C4/Checkout CUSTOMER_SELECTED: closed branch is rejected — no order, NO silent rematch to an open branch', async () => {
  // branch_cs_closed is closed but fully stocked with product 272; branch_cs_open
  // (open, stocked) also exists — if a rematch happened, this would pick it.
  csAddBranch('branch_cs_closed', { is_open_override: 0, assign272: true });
  const customerToken = await createCustomerSession('081200000002');
  const before = csOrdersCount();
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_cs_closed',
      payment_method: 'cash',
      customer: { name: 'Customer Tutup', phone: '081200000002' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.reason, 'BRANCH_CLOSED');
  assert.ok(/tutup/i.test(data.error || ''), 'explicit closed-branch reason');
  assert.strictEqual(csOrdersCount(), before, 'rejected order must NOT be created');
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM orders WHERE branch_id = 'branch_cs_closed'").get().c, 0, 'no silent rematch/order');
});

test('C4/Checkout CUSTOMER_SELECTED: delivery-disabled branch is rejected for a delivery order', async () => {
  csAddBranch('branch_cs_nodelivery', { delivery: 0, pickup: 1, assign272: true });
  const customerToken = await createCustomerSession('081200000003');
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_cs_nodelivery',
      payment_method: 'cash',
      customer: { name: 'Customer Antar', phone: '081200000003' },
      order_type: 'delivery',
      delivery: { address: 'Jl. Kirim', latitude: -7.2912, longitude: 112.7154 },
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.reason, 'FULFILLMENT_NOT_SUPPORTED');
  assert.ok(/tidak mendukung/i.test(data.error || ''));
});

test('C4/Checkout CUSTOMER_SELECTED: cross-brand and inactive branches are rejected (tenant + active scope)', async () => {
  // Cross-brand branch (exists, belongs to another brand) -> 404, never a candidate.
  const customerTokenCross = await createCustomerSession('081200000004');
  const cross = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerTokenCross },
    body: JSON.stringify({
      branch_id: 'branch_other_co',
      payment_method: 'cash',
      customer: { name: 'Customer Lintas', phone: '081200000004' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(cross.status, 404);

  // Inactive branch within the brand -> 404 (active state enforced at resolution).
  csAddBranch('branch_cs_inactive', { is_active: 0, assign272: true });
  const customerTokenInactive = await createCustomerSession('081200000005');
  const inactive = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerTokenInactive },
    body: JSON.stringify({
      branch_id: 'branch_cs_inactive',
      payment_method: 'cash',
      customer: { name: 'Customer Nonaktif', phone: '081200000005' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(inactive.status, 404);
});

test('C4/Checkout CUSTOMER_SELECTED: product not assigned to the selected open branch is rejected (canonical assignment bound)', async () => {
  csAddBranch('branch_cs_noassign', { assign272: false }); // open, but does NOT carry product 272
  const customerToken = await createCustomerSession('081200000006');
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_cs_noassign',
      payment_method: 'cash',
      customer: { name: 'Customer Tanpa Produk', phone: '081200000006' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.ok(/belum dialokasikan|tidak ditemukan/i.test(data.error || ''), 'assignment bound via gate');
});

test('C4/Checkout remote/gift delivery: fulfillment branch drives delivery routing; buyer location is not a delivery input', async () => {
  // Delivery destination (Bandar Lampung analog) is distinct from any buyer
  // location. The order must bind to the SELECTED fulfillment branch and the
  // stored delivery destination must be exactly the one provided — routing
  // originates from the branch, never from a buyer coordinate.
  const customerToken = await createCustomerSession('081200000007');
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_cs_open',
      payment_method: 'cash',
      customer: { name: 'Buyer Jakarta', phone: '081200000007' }, // buyer location is NOT sent/used
      order_type: 'delivery',
      delivery: { address: 'Alamat Penerima Bandar Lampung', latitude: -7.25, longitude: 112.78 },
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(res.status, 201, 'branch -> destination is the valid geospatial input');
  const data = await res.json();
  const order = db.prepare('SELECT branch_id FROM orders WHERE id = ?').get(data.order_id);
  assert.strictEqual(order.branch_id, 'branch_cs_open', 'fulfillment branch = selected branch');
  const del = db.prepare('SELECT destination_latitude, destination_longitude, destination_address FROM order_deliveries WHERE order_id = ?').get(data.order_id)
    || db.prepare('SELECT delivery_latitude AS destination_latitude, delivery_longitude AS destination_longitude, delivery_address AS destination_address FROM orders WHERE id = ?').get(data.order_id);
  assert.ok(del, 'delivery destination persisted');
  assert.strictEqual(Number(del.destination_latitude), -7.25);
  assert.strictEqual(Number(del.destination_longitude), 112.78);
});

/* ============================================================================
   R1 CART/CHECKOUT BOUNDARY — MULTI-BRANCH CART IS ALLOWED; CHECKOUT IS
   SINGLE-BRANCH; ORDER IS SINGLE-BRANCH. The server enforces the canonical
   single-branch checkout rule: per-item branch provenance that mixes scopes,
   or contradicts the resolved fulfillment branch, is REJECTED with
   CHECKOUT_SINGLE_BRANCH_REQUIRED — never silently merged/split/rematched.
   Items WITHOUT provenance (legacy single-group carts) are unchanged.
   ============================================================================ */

test('R1 create-order: single-branch checkout whose item provenance matches the checkout branch is accepted', async () => {
  csAddBranch('branch_r1_a', { assign272: true });
  const before = csOrdersCount();
  const customerToken = await createCustomerSession('081200000010');
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_r1_a',
      payment_method: 'cash',
      customer: { name: 'Customer R1 Scope', phone: '081200000010' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1, branch_id: 'branch_r1_a' }]
    })
  });
  assert.strictEqual(res.status, 201);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(csOrdersCount(), before + 1, 'exactly one order created');
  const order = db.prepare('SELECT branch_id FROM orders WHERE id = ?').get(data.order_id);
  assert.strictEqual(order.branch_id, 'branch_r1_a', 'order bound to the single checkout branch');
});

test('R1 create-order: items mixing TWO branch scopes are rejected (CHECKOUT_SINGLE_BRANCH_REQUIRED) — no order', async () => {
  csAddBranch('branch_r1_b', { assign272: true });
  const before = csOrdersCount();
  const customerToken = await createCustomerSession('081200000011');
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_r1_a',
      payment_method: 'cash',
      customer: { name: 'Customer R1 Mixed', phone: '081200000011' },
      order_type: 'pickup',
      items: [
        { id: '272', quantity: 1, branch_id: 'branch_r1_a' },
        { id: '272', quantity: 1, branch_id: 'branch_r1_b' }
      ]
    })
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.status, 'CHECKOUT_SINGLE_BRANCH_REQUIRED', 'deterministic semantic status');
  assert.ok(/satu cabang/i.test(data.error || ''), 'explicit single-branch message');
  assert.strictEqual(csOrdersCount(), before, 'rejected checkout must NOT create an order');
});

test('R1 create-order: single provenance contradicting the checkout branch is rejected — no silent re-home', async () => {
  const before = csOrdersCount();
  const customerToken = await createCustomerSession('081200000012');
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_r1_a',
      payment_method: 'cash',
      customer: { name: 'Customer R1 WrongScope', phone: '081200000012' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1, branch_id: 'branch_r1_b' }]
    })
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.status, 'CHECKOUT_SINGLE_BRANCH_REQUIRED');
  assert.ok(/branch_r1_b/i.test(data.error || ''), 'names the conflicting provenance scope');
  assert.strictEqual(csOrdersCount(), before, 'no order and no silent move to another branch');
});

test('R1 checkout/verify: mixed-branch provenance is rejected at the verify boundary too', async () => {
  const customerToken = await createCustomerSession('081200000013b');
  const res = await mockFetch('/api/v1/checkout/verify', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_r1_a',
      order_type: 'pickup',
      customer: { name: 'Customer R1 Verify', phone: '081200000013b' },
      items: [
        { id: '272', quantity: 1, branch_id: 'branch_r1_a' },
        { id: '272', quantity: 1, branch_id: 'branch_r1_b' }
      ]
    })
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.status, 'CHECKOUT_SINGLE_BRANCH_REQUIRED');
});

test('R1 create-order: legacy items WITHOUT provenance keep working (regression — single-branch flow unchanged)', async () => {
  const before = csOrdersCount();
  const customerToken = await createCustomerSession('081200000014');
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_r1_a',
      payment_method: 'cash',
      customer: { name: 'Customer R1 Legacy', phone: '081200000014' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 2 }] // no branch_id → legacy unassigned scope
    })
  });
  assert.strictEqual(res.status, 201, 'legacy payload must not be affected by the R1 guard');
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(csOrdersCount(), before + 1);
});

test('R1.5 independent checkouts: failure of one branch checkout does not block another branch checkout', async () => {
  // Checkout A targets a closed branch carrying the same product → rejected.
  csAddBranch('branch_r1_closed', { is_open_override: 0, assign272: true });
  const beforeA = csOrdersCount();
  const customerTokenA = await createCustomerSession('081200000015');
  const aRes = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerTokenA },
    body: JSON.stringify({
      branch_id: 'branch_r1_closed',
      payment_method: 'cash',
      customer: { name: 'Customer R1 FailA', phone: '081200000015' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1, branch_id: 'branch_r1_closed' }]
    })
  });
  assert.strictEqual(aRes.status, 400, 'checkout A fails (closed branch)');

  // Checkout B (open branch, same product) succeeds independently right after.
  const beforeB = csOrdersCount();
  const customerTokenB = await createCustomerSession('081200000016');
  const bRes = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerTokenB },
    body: JSON.stringify({
      branch_id: 'branch_r1_a',
      payment_method: 'cash',
      customer: { name: 'Customer R1 OkB', phone: '081200000016' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1, branch_id: 'branch_r1_a' }]
    })
  });
  assert.strictEqual(bRes.status, 201, 'failure of checkout A must not invalidate checkout B');
  assert.strictEqual(csOrdersCount(), beforeB + 1, 'only checkout B produced an order');
});

/* ============================================================================
   R2/R3 — BRANCH SELECTION MODE + FINAL CHECKOUT VERIFICATION
   selection_mode (AUTO | CUSTOMER_SELECTED) is HOW the fulfillment branch was
   chosen — distinct from fulfillment branch_id itself, and persisted on the
   order. AUTO = Core matches via BranchMatcher; CUSTOMER_SELECTED = the
   customer's branch_id is INPUT, never authority. Checkout always performs
   fresh authoritative verification (gate) before any Order is created.
   ============================================================================ */

test('R2 AUTO selection: create-order without branch_id matches via Core and persists selection_mode AUTO', async () => {
  const RouteService = require('../server/services/RouteService');
  const original = RouteService.getRoadDistance;
  RouteService.getRoadDistance = async () => ({ distance_meters: 1500, duration_seconds: 480, provider: 'osrm' });
  try {
    csAddBranch('branch_r2_auto', { assign272: true });
    const before = csOrdersCount();
    const customerToken = await createCustomerSession('081200000020');
    const res = await mockFetch('/api/v1/checkout/create-order', {
      method: 'POST',
      headers: { 'x-customer-token': customerToken },
      body: JSON.stringify({
        selection_mode: 'AUTO',
        payment_method: 'cash',
        customer: { name: 'Customer AUTO', phone: '081200000020' },
        order_type: 'delivery',
        delivery: { address: 'Jl. R2 Auto', latitude: -7.2912, longitude: 112.7154 },
        items: [{ id: '272', quantity: 1 }]
      })
    });
    assert.strictEqual(res.status, 201, 'AUTO selection must produce an order when an eligible branch exists');
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(csOrdersCount(), before + 1, 'exactly one order');
    const order = db.prepare('SELECT branch_id, selection_mode FROM orders WHERE id = ?').get(data.order_id);
    assert.ok(order.branch_id, 'Core established the authoritative fulfillment branch');
    assert.strictEqual(order.selection_mode, 'AUTO', 'selection_mode AUTO persisted');
  } finally {
    RouteService.getRoadDistance = original;
  }
});

test('R2 CUSTOMER_SELECTED: explicit mode + valid branch is accepted and persisted', async () => {
  csAddBranch('branch_r2_cs', { assign272: true });
  const before = csOrdersCount();
  const customerToken = await createCustomerSession('081200000021');
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_r2_cs',
      selection_mode: 'CUSTOMER_SELECTED',
      payment_method: 'cash',
      customer: { name: 'Customer Pilih', phone: '081200000021' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(res.status, 201);
  const data = await res.json();
  assert.strictEqual(csOrdersCount(), before + 1);
  const order = db.prepare('SELECT branch_id, selection_mode FROM orders WHERE id = ?').get(data.order_id);
  assert.strictEqual(order.branch_id, 'branch_r2_cs');
  assert.strictEqual(order.selection_mode, 'CUSTOMER_SELECTED', 'selection_mode CUSTOMER_SELECTED persisted');
});

test('R2 legacy derivation: branch_id without a mode is derived as CUSTOMER_SELECTED (backward compatible)', async () => {
  const before = csOrdersCount();
  const customerToken = await createCustomerSession('081200000022');
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_r2_cs', // no selection_mode → derived
      payment_method: 'cash',
      customer: { name: 'Customer Legacy Mode', phone: '081200000022' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(res.status, 201, 'legacy branch_id-only payloads keep working');
  const data = await res.json();
  assert.strictEqual(csOrdersCount(), before + 1);
  const order = db.prepare('SELECT selection_mode FROM orders WHERE id = ?').get(data.order_id);
  assert.strictEqual(order.selection_mode, 'CUSTOMER_SELECTED');
});

test('R2 mode normalization: lowercase customer_selected is accepted', async () => {
  const customerToken = await createCustomerSession('081200000023');
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_r2_cs',
      selection_mode: 'customer_selected',
      payment_method: 'cash',
      customer: { name: 'Customer Lower', phone: '081200000023' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(res.status, 201, 'mode normalized to uppercase');
});

test('R2 invalid selection_mode value is rejected (INVALID_SELECTION_MODE)', async () => {
  const before = csOrdersCount();
  const customerToken = await createCustomerSession('081200000024');
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_r2_cs',
      selection_mode: 'NEAREST',
      payment_method: 'cash',
      customer: { name: 'Customer ModeBuruk', phone: '081200000024' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.status, 'INVALID_SELECTION_MODE');
  assert.strictEqual(csOrdersCount(), before, 'no order created');
});

test('R2 AUTO + branch_id is contradictory and rejected — client cannot smuggle a branch into AUTO', async () => {
  const before = csOrdersCount();
  const customerToken = await createCustomerSession('081200000025');
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_r2_cs',
      selection_mode: 'AUTO',
      payment_method: 'cash',
      customer: { name: 'Customer ModeAUTO', phone: '081200000025' },
      order_type: 'delivery',
      delivery: { address: 'Jl. X', latitude: -7.2912, longitude: 112.7154 },
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.status, 'INVALID_SELECTION_MODE', 'AUTO requests Core matching — a supplied branch_id contradicts it');
  assert.strictEqual(csOrdersCount(), before, 'no order created');
});

test('R2 CUSTOMER_SELECTED without branch_id is rejected', async () => {
  const customerToken = await createCustomerSession('081200000026');
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      selection_mode: 'CUSTOMER_SELECTED',
      payment_method: 'cash',
      customer: { name: 'Customer NoBranch', phone: '081200000026' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.status, 'INVALID_SELECTION_MODE');
  assert.ok(/branch_id/i.test(data.error || ''), 'explains that branch_id is required');
});

test('R3 final verification: stale stock at the checkout branch prevents Order creation', async () => {
  // Branch is open, stocked, and assigned — then stock runs out before checkout.
  csAddBranch('branch_r2_stale', { assign272: true });
  db.prepare("UPDATE branch_products SET stock = 0 WHERE branch_id = ? AND product_id = '272'").run('branch_r2_stale');
  const before = csOrdersCount();
  const customerToken = await createCustomerSession('081200000027');
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_r2_stale',
      payment_method: 'cash',
      customer: { name: 'Customer Stale', phone: '081200000027' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(res.status, 400, 'fresh verification must fail against stale stock');
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.status, 'OUT_OF_STOCK');
  assert.strictEqual(csOrdersCount(), before, 'final verification failure must NOT create an Order');
});

/* ============================================================================
   R5 — BRANCH ACCEPTANCE (Order/Acceptance boundary)
   pending (AWAITING_BRANCH_ACCEPTANCE) → ACCEPT ('confirmed', the locked
   operational acceptance state) or REJECT ('rejected', terminal, distinct from
   customer 'cancelled'). Server-authoritative, branch/brand-scoped, atomic,
   audited in order_status_logs, idempotent for repeated identical decisions,
   and never silently rematched. TIMEOUT is reserved (separate worker task).
   ============================================================================ */

async function r5Login(username, role, branchId) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update('r5pass').digest('hex');
  db.prepare(`
    INSERT OR REPLACE INTO users (id, brand_id, organization_id, branch_id, username, email, password_hash, full_name, role)
    VALUES (?, 'brand_bangjo', 'org_xentra_holding', ?, ?, ?, ?, 'R5 User', ?)
  `).run('usr_' + username, branchId || null, username, username + '@bangjo.test', hash, role);
  return b1Login(username, 'r5pass');
}

async function r5CreatePendingOrder(branchId, phone, existingToken) {
  const customerToken = existingToken || await createCustomerSession(phone);
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: branchId,
      payment_method: 'cash',
      customer: { name: 'Customer R5', phone },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(res.status, 201, 'pending order must be created for acceptance test');
  const data = await res.json();
  return data.order_id;
}

function r5AuditCount(orderId) {
  return db.prepare('SELECT COUNT(*) AS c FROM order_status_logs WHERE order_id = ?').get(orderId).c;
}

test('R5 ACCEPT: own-branch branch_manager accepts a pending order → confirmed, audited, branch immutable', async () => {
  csAddBranch('branch_r5_acc', { assign272: true });
  const bm = await r5Login('r5_bm_acc', 'branch_manager', 'branch_r5_acc');
  assert.strictEqual(bm.status, 200);
  const orderId = await r5CreatePendingOrder('branch_r5_acc', '081200000050');
  const created = db.prepare('SELECT status, branch_id FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(created.status, 'pending', 'AWAITING_BRANCH_ACCEPTANCE');

  const res = await mockFetch('/api/v1/orders/' + orderId + '/branch-acceptance', {
    method: 'POST',
    headers: bm.headers,
    body: JSON.stringify({ decision: 'accept', note: 'Siap diproses' })
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.decision, 'accept');
  assert.strictEqual(data.new_status, 'confirmed', 'ACCEPTED = confirmed (locked operational acceptance state)');
  assert.strictEqual(data.idempotent, undefined);

  const order = db.prepare('SELECT status, branch_id FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(order.status, 'confirmed');
  assert.strictEqual(order.branch_id, 'branch_r5_acc', 'fulfillment branch unchanged after acceptance');

  const logs = db.prepare('SELECT * FROM order_status_logs WHERE order_id = ?').all(orderId);
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].previous_status, 'pending');
  assert.strictEqual(logs[0].new_status, 'confirmed');
  assert.strictEqual(logs[0].actor_type, 'branch_actor');
  assert.ok(logs[0].note.includes('[ACCEPT by branch_manager'), 'audit carries actor role + decision');
});

test('R5 ACCEPT idempotency: repeating ACCEPT on an accepted order is a safe no-op (no duplicate audit)', async () => {
  const orderId = await r5CreatePendingOrder('branch_r5_acc', '081200000051');
  const bm = await r5Login('r5_bm_acc2', 'branch_manager', 'branch_r5_acc');
  assert.strictEqual(bm.status, 200);

  const first = await mockFetch('/api/v1/orders/' + orderId + '/branch-acceptance', {
    method: 'POST', headers: bm.headers, body: JSON.stringify({ decision: 'accept' })
  });
  assert.strictEqual(first.status, 200);
  assert.strictEqual((await first.json()).new_status, 'confirmed');
  assert.strictEqual(r5AuditCount(orderId), 1);

  const second = await mockFetch('/api/v1/orders/' + orderId + '/branch-acceptance', {
    method: 'POST', headers: bm.headers, body: JSON.stringify({ decision: 'accept' })
  });
  assert.strictEqual(second.status, 200);
  const secondData = await second.json();
  assert.strictEqual(secondData.success, true);
  assert.strictEqual(secondData.idempotent, true, 'repeated decision is an explicit no-op');
  assert.strictEqual(secondData.new_status, 'confirmed');
  assert.strictEqual(r5AuditCount(orderId), 1, 'no duplicate audit entry');
});

test('R5 REJECT: owner (brand-wide) rejects with reason → rejected, terminal, audited; no accept after', async () => {
  csAddBranch('branch_r5_rej', { assign272: true });
  const owner = await r5Login('r5_owner_rej', 'owner', null);
  assert.strictEqual(owner.status, 200);
  const orderId = await r5CreatePendingOrder('branch_r5_rej', '081200000052');

  const res = await mockFetch('/api/v1/orders/' + orderId + '/branch-acceptance', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ decision: 'reject', reason: 'Cabang penuh dan tidak dapat melayani hari ini' })
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.new_status, 'rejected');

  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(order.status, 'rejected');
  const log = db.prepare('SELECT * FROM order_status_logs WHERE order_id = ?').get(orderId);
  assert.ok(log.note.includes('[REJECT by owner'), 'audit carries actor + decision');
  assert.ok(log.note.includes('Cabang penuh'), 'audit carries the rejection reason');

  // Terminal: ACCEPT after REJECT must fail; no silent rematch/revival.
  const lateAccept = await mockFetch('/api/v1/orders/' + orderId + '/branch-acceptance', {
    method: 'POST', headers: owner.headers, body: JSON.stringify({ decision: 'accept' })
  });
  assert.strictEqual(lateAccept.status, 400, 'ACCEPT after REJECT is an invalid transition');
  const unchanged = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(unchanged.status, 'rejected');
});

test('R5 REJECT without a reason is rejected (REASON_REQUIRED) with no state change', async () => {
  const bm = await r5Login('r5_bm_noreason', 'branch_manager', 'branch_r5_acc');
  const orderId = await r5CreatePendingOrder('branch_r5_acc', '081200000053');
  const res = await mockFetch('/api/v1/orders/' + orderId + '/branch-acceptance', {
    method: 'POST', headers: bm.headers, body: JSON.stringify({ decision: 'reject' })
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.status, 'REASON_REQUIRED');
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'pending');
  assert.strictEqual(r5AuditCount(orderId), 0);
});

test('R5 branch scope: branch_manager cannot accept an order from ANOTHER branch (no cross-branch authority)', async () => {
  csAddBranch('branch_r5_other', { assign272: true });
  const orderId = await r5CreatePendingOrder('branch_r5_other', '081200000054');
  const bmOther = await r5Login('r5_bm_other_scope', 'branch_manager', 'branch_r5_acc'); // assigned to branch_r5_acc
  const res = await mockFetch('/api/v1/orders/' + orderId + '/branch-acceptance', {
    method: 'POST', headers: bmOther.headers, body: JSON.stringify({ decision: 'accept' })
  });
  assert.strictEqual(res.status, 404, 'order is not within this manager\'s branch authority');
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'pending');
});

test('R5 role boundary: cashier cannot use the branch-acceptance endpoint (403)', async () => {
  csAddBranch('branch_r5_role', { assign272: true });
  const orderId = await r5CreatePendingOrder('branch_r5_role', '081200000055');
  const cashier = await r5Login('r5_cashier_role', 'cashier', 'branch_r5_role');
  assert.strictEqual(cashier.status, 200);
  const res = await mockFetch('/api/v1/orders/' + orderId + '/branch-acceptance', {
    method: 'POST', headers: cashier.headers, body: JSON.stringify({ decision: 'accept' })
  });
  assert.strictEqual(res.status, 403, 'cashier is not an acceptance actor');
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'pending');
});

test('R5 REJECT on an order with a settled payment is blocked (refund flow first) — no state change, no audit', async () => {
  csAddBranch('branch_r5_paid', { assign272: true });
  const owner = await r5Login('r5_owner_paid', 'owner', null);
  const orderId = await r5CreatePendingOrder('branch_r5_paid', '081200000056');
  // Cash create-order already inserts the order_payments row (pending) —
  // mark it settled to simulate money already taken for this order.
  db.prepare("UPDATE order_payments SET payment_status = 'settlement', provider = 'midtrans' WHERE order_id = ?").run(orderId);

  const res = await mockFetch('/api/v1/orders/' + orderId + '/branch-acceptance', {
    method: 'POST', headers: owner.headers, body: JSON.stringify({ decision: 'reject', reason: 'Tidak sanggup melayani' })
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.ok(/ORDER_ALREADY_PAID/.test(data.error || ''), 'settled payment blocks branch rejection');
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'pending');
  assert.strictEqual(r5AuditCount(orderId), 0);
});

test('R5 invalid decision value is rejected (INVALID_DECISION)', async () => {
  const owner = await r5Login('r5_owner_bad', 'owner', null);
  const orderId = await r5CreatePendingOrder('branch_r5_acc', '081200000057');
  const res = await mockFetch('/api/v1/orders/' + orderId + '/branch-acceptance', {
    method: 'POST', headers: owner.headers, body: JSON.stringify({ decision: 'maybe' })
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.status, 'INVALID_DECISION');
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'pending');
});

/* ============================================================================
   R6/R7 — ACCEPTANCE TIMEOUT + CUSTOMER CANCELLATION
   R6: pending (AWAITING_BRANCH_ACCEPTANCE) + 3 min → 'timeout' (BRANCH_TIMEOUT),
       applied by the server-authoritative AcceptanceTimeoutService only.
   R7: POST /orders/:id/cancel — customer cancels ONLY while pending
       (CUSTOMER_CANCEL, actor derived from the authenticated OTP session);
       ACCEPTED/rejected/timed-out/cancelled orders cannot be customer-cancelled.
   ============================================================================ */

async function r6r7CustomerToken(phone) {
  const send = await mockFetch('/api/v1/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({ phone })
  });
  const sendData = await send.json();
  const verify = await mockFetch('/api/v1/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: sendData.challenge_id, otp: '123456', phone })
  });
  const verifyData = await verify.json();
  assert.ok(verifyData.token, 'customer OTP token must be issued');
  return { headers: { authorization: 'Bearer ' + verifyData.token }, rawToken: verifyData.token };
}

test('R6 API: an overdue pending order is timed out by the worker sweep and ACCEPT afterwards is rejected', async () => {
  csAddBranch('branch_r6_to', { assign272: true });
  const orderId = await r5CreatePendingOrder('branch_r6_to', '081200000080');
  db.prepare("UPDATE orders SET created_at = datetime('now','-200 seconds') WHERE id = ?").run(orderId);

  const AcceptanceTimeoutService = require('../server/services/AcceptanceTimeoutService');
  const sweep = AcceptanceTimeoutService.checkAndApplyTimeouts();
  assert.strictEqual(sweep.timed_out, 1, 'the overdue order timed out');
  const timed = db.prepare('SELECT status, branch_id FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(timed.status, 'timeout');
  assert.strictEqual(timed.branch_id, 'branch_r6_to', 'timed-out order stays on its original branch');

  // ACCEPT racing AFTER the timeout must be rejected deterministically.
  const owner = await r5Login('r5_owner_r6', 'owner', null);
  const lateAccept = await mockFetch('/api/v1/orders/' + orderId + '/branch-acceptance', {
    method: 'POST', headers: owner.headers, body: JSON.stringify({ decision: 'accept' })
  });
  assert.strictEqual(lateAccept.status, 400, 'ACCEPT after TIMEOUT is an invalid transition');
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'timeout');
});

test('R7 customer cancel: pending order → CUSTOMER_CANCEL, audited with the authenticated phone; duplicate cancel is a no-op', async () => {
  csAddBranch('branch_r7_c', { assign272: true });
  const phone = '081200000081';
  const custAuth = await r6r7CustomerToken(phone);
  const orderId = await r5CreatePendingOrder('branch_r7_c', phone, custAuth.rawToken);

  const res = await mockFetch('/api/v1/orders/' + orderId + '/cancel', {
    method: 'POST', headers: custAuth.headers, body: JSON.stringify({ reason: 'Ganti rencana' })
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.decision, 'customer_cancel');
  assert.strictEqual(data.new_status, 'cancelled');

  const log = db.prepare('SELECT * FROM order_status_logs WHERE order_id = ?').get(orderId);
  assert.strictEqual(log.previous_status, 'pending');
  assert.strictEqual(log.new_status, 'cancelled');
  assert.strictEqual(log.actor_type, 'customer', 'actor is the authenticated customer, never client-classified');
  assert.strictEqual(log.actor_id, phone, 'actor id is the authenticated phone');
  assert.ok(log.note.includes('[CUSTOMER_CANCEL]'), 'CUSTOMER_CANCEL stays distinct from other cancel classes');

  // Duplicate cancellation: deterministic rejection, no state corruption.
  const dup = await mockFetch('/api/v1/orders/' + orderId + '/cancel', {
    method: 'POST', headers: custAuth.headers, body: JSON.stringify({ reason: 'lagi' })
  });
  assert.strictEqual(dup.status, 400);
  const dupData = await dup.json();
  assert.strictEqual(dupData.status, 'CUSTOMER_CANCEL_NOT_ALLOWED');
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'cancelled');
  assert.strictEqual(r5AuditCount(orderId), 1, 'no duplicate audit entry');
});

test('R7 customer cancel after ACCEPT is NOT allowed (server-enforced, UI alone insufficient)', async () => {
  csAddBranch('branch_r7_a', { assign272: true });
  const phone = '081200000082';
  const custAuth = await r6r7CustomerToken(phone);
  const orderId = await r5CreatePendingOrder('branch_r7_a', phone, custAuth.rawToken);

  const owner = await r5Login('r5_owner_r7a', 'owner', null);
  const accept = await mockFetch('/api/v1/orders/' + orderId + '/branch-acceptance', {
    method: 'POST', headers: owner.headers, body: JSON.stringify({ decision: 'accept' })
  });
  assert.strictEqual(accept.status, 200);

  const cancel = await mockFetch('/api/v1/orders/' + orderId + '/cancel', {
    method: 'POST', headers: custAuth.headers, body: JSON.stringify({ reason: 'Batal saja' })
  });
  assert.strictEqual(cancel.status, 400, 'ACCEPTED order cannot be customer-cancelled');
  const data = await cancel.json();
  assert.strictEqual(data.status, 'CUSTOMER_CANCEL_NOT_ALLOWED');
  assert.ok(/diterima cabang/i.test(data.error || ''), 'explains the accepted-branch state');
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'confirmed');
});

test('R7 customer cancel: ownership enforced — another customer cannot cancel the order (403)', async () => {
  csAddBranch('branch_r7_o', { assign272: true });
  const ownerPhone = '081200000083';
  const otherAuth = await r6r7CustomerToken('081200000084');
  const orderId = await r5CreatePendingOrder('branch_r7_o', ownerPhone);

  const res = await mockFetch('/api/v1/orders/' + orderId + '/cancel', {
    method: 'POST', headers: otherAuth.headers, body: JSON.stringify({ reason: 'bukan pesanan saya' })
  });
  assert.strictEqual(res.status, 403);
  const data = await res.json();
  assert.strictEqual(data.error, 'FORBIDDEN_ORDER_OWNERSHIP');
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'pending');
});

test('R7 customer cancel of REJECTED and TIMED-OUT orders is not allowed (terminal states)', async () => {
  csAddBranch('branch_r7_t', { assign272: true });
  const phone = '081200000085';
  const custAuth = await r6r7CustomerToken(phone);
  const owner = await r5Login('r5_owner_r7t', 'owner', null);

  // Rejected first.
  const rejOrder = await r5CreatePendingOrder('branch_r7_t', phone, custAuth.rawToken);
  const reject = await mockFetch('/api/v1/orders/' + rejOrder + '/branch-acceptance', {
    method: 'POST', headers: owner.headers, body: JSON.stringify({ decision: 'reject', reason: 'Menu habis' })
  });
  assert.strictEqual(reject.status, 200);
  const rejCancel = await mockFetch('/api/v1/orders/' + rejOrder + '/cancel', {
    method: 'POST', headers: custAuth.headers, body: JSON.stringify({ reason: 'batal' })
  });
  assert.strictEqual(rejCancel.status, 400);
  assert.strictEqual((await rejCancel.json()).status, 'CUSTOMER_CANCEL_NOT_ALLOWED');
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(rejOrder).status, 'rejected', 'REJECTED is never rewritten as customer cancel');

  // Then timed out.
  const toOrder = await r5CreatePendingOrder('branch_r7_t', phone, custAuth.rawToken);
  db.prepare("UPDATE orders SET created_at = datetime('now','-200 seconds') WHERE id = ?").run(toOrder);
  const AcceptanceTimeoutService = require('../server/services/AcceptanceTimeoutService');
  AcceptanceTimeoutService.checkAndApplyTimeouts();
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(toOrder).status, 'timeout');
  const toCancel = await mockFetch('/api/v1/orders/' + toOrder + '/cancel', {
    method: 'POST', headers: custAuth.headers, body: JSON.stringify({ reason: 'batal' })
  });
  assert.strictEqual(toCancel.status, 400);
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(toOrder).status, 'timeout', 'TIMEOUT is never rewritten as customer cancel');
});

test('R7 customer cancel guards: no session → 401; settled payment → ORDER_ALREADY_PAID (no state change)', async () => {
  csAddBranch('branch_r7_g', { assign272: true });
  const phone = '081200000086';
  const custAuth = await r6r7CustomerToken(phone);
  const orderId = await r5CreatePendingOrder('branch_r7_g', phone, custAuth.rawToken);

  // No session.
  const anon = await mockFetch('/api/v1/orders/' + orderId + '/cancel', {
    method: 'POST', body: JSON.stringify({ reason: 'x' })
  });
  assert.strictEqual(anon.status, 401, 'anonymous cancel is rejected');

  // Settled payment blocks CUSTOMER_CANCEL (refund flow first).
  db.prepare("UPDATE order_payments SET payment_status = 'settlement', provider = 'midtrans' WHERE order_id = ?").run(orderId);
  const paidCancel = await mockFetch('/api/v1/orders/' + orderId + '/cancel', {
    method: 'POST', headers: custAuth.headers, body: JSON.stringify({ reason: 'batal' })
  });
  assert.strictEqual(paidCancel.status, 400);
  assert.ok(/ORDER_ALREADY_PAID/.test((await paidCancel.json()).error || ''), 'settled payment requires a refund flow');
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'pending');
  assert.strictEqual(r5AuditCount(orderId), 0, 'no audit entry for a blocked cancel');
});

/* ============================================================================
   R5 POST-AUDIT (CHECK-1 / CHECK-4):
   The generic kitchen PATCH must NOT offer acceptance ('confirmed') or generic
   cancellation ('cancelled'); those are exclusively served by
   /orders/:id/branch-acceptance (branch actors) and /orders/:id/cancel
   (customer, pending only). Payment settlement never bypasses Branch ACCEPT.
   ============================================================================ */

test('R5 CHECK-1: kitchen PATCH rejects manager-set confirmed/cancelled (403) — acceptance & generic cancel have dedicated endpoints', async () => {
  csAddBranch('branch_r5_chk1', { assign272: true });
  const bm = await r5Login('r5_bm_chk1', 'branch_manager', 'branch_r5_chk1');
  assert.strictEqual(bm.status, 200);

  const orderId = await r5CreatePendingOrder('branch_r5_chk1', '081200000095');
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'pending');

  const patchConfirmed = await mockFetch(`/api/v1/kitchen/orders/${orderId}/status`, {
    method: 'PATCH', headers: bm.headers, body: JSON.stringify({ status: 'confirmed' })
  });
  assert.strictEqual(patchConfirmed.status, 403, 'generic PATCH must not ACCEPT (branch-acceptance endpoint only)');

  const patchCancelled = await mockFetch(`/api/v1/kitchen/orders/${orderId}/status`, {
    method: 'PATCH', headers: bm.headers, body: JSON.stringify({ status: 'cancelled' })
  });
  assert.strictEqual(patchCancelled.status, 403, 'generic PATCH must not cancel after ACCEPT (R8 exception flow, later task)');

  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'pending');
  assert.strictEqual(r5AuditCount(orderId), 0, 'no audit row for blocked transitions');
});

test('R5 CHECK-2 API: midtrans settlement keeps order AWAITING; only branch-acceptance confirms', async () => {
  const PaymentGatewayService = require('../domains/payment/services/PaymentGatewayService');
  csAddBranch('branch_r5_chk2', { assign272: true });

  const customerToken = await createCustomerSession('081200000096');
  const orderRes = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify({
      branch_id: 'branch_r5_chk2',
      payment_method: 'midtrans',
      customer: { name: 'Customer CHK2', phone: '081200000096' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(orderRes.status, 201);
  const orderData = await orderRes.json();
  const orderId = orderData.order_id;
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'pending');

  // Simulate Midtrans settlement (crypto signature verification is covered by
  // the payment domain suite; here we exercise the order-state boundary).
  const handled = PaymentGatewayService.handleWebhook({
    order_id: orderId,
    status_code: '200',
    gross_amount: String(orderData.grand_total) + '.00',
    transaction_status: 'settlement',
    payment_type: 'qris'
  }, { skipSignatureCheck: true });
  assert.strictEqual(handled.payment_status, 'settlement');
  assert.strictEqual(
    db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status,
    'pending',
    'paid order is still AWAITING_BRANCH_ACCEPTANCE — payment is not acceptance'
  );

  // Branch ACCEPT (owner, brand-wide) → confirmed.
  const owner = await r5Login('r5_owner_chk2', 'owner', null);
  const acceptRes = await mockFetch(`/api/v1/orders/${orderId}/branch-acceptance`, {
    method: 'POST', headers: owner.headers, body: JSON.stringify({ decision: 'accept' })
  });
  assert.strictEqual(acceptRes.status, 200);
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'confirmed');
});

/* =============================================================================
   GLOBAL BRANCH ACTIVATION (OWNER AUTHORITY VS BRANCH MANAGER OPERATIONAL STATE)
   ============================================================================= */

test('GLOBAL ACTIVATION 1: Owner can globally deactivate and reactivate a branch', async () => {
  const owner = await b1Login('admin', 'bangjo123');
  assert.strictEqual(owner.status, 200);

  const targetBranch = 'branch_bangjo_timur';

  // 1. Deactivate branch
  const deactRes = await b1PutBranch(owner.headers, targetBranch, { is_active: 0 });
  assert.strictEqual(deactRes.status, 200);
  const deactData = await deactRes.json();
  assert.strictEqual(deactData.success, true);
  assert.strictEqual(deactData.branch.is_active, 0);

  const rowDeact = db.prepare('SELECT is_active FROM branches WHERE id = ?').get(targetBranch);
  assert.strictEqual(rowDeact.is_active, 0);

  // Audit trail recorded
  const auditRow = db.prepare(`
    SELECT * FROM branch_operation_logs
    WHERE branch_id = ? AND field = 'is_active'
    ORDER BY created_at DESC, rowid DESC LIMIT 1
  `).get(targetBranch);
  assert.ok(auditRow);
  assert.strictEqual(auditRow.actor_role, 'owner');
  assert.strictEqual(auditRow.new_value, '0');

  // Customer endpoint /brand/branches must exclude the deactivated branch
  const publicRes = await mockFetch('/api/v1/brand/branches');
  const publicData = await publicRes.json();
  assert.ok(!publicData.branches.some(b => b.id === targetBranch), 'Deactivated branch must not be in public list');

  // Reactivate branch
  const reactRes = await b1PutBranch(owner.headers, targetBranch, { is_active: 1 });
  assert.strictEqual(reactRes.status, 200);
  const reactData = await reactRes.json();
  assert.strictEqual(reactData.branch.is_active, 1);

  const rowReact = db.prepare('SELECT is_active FROM branches WHERE id = ?').get(targetBranch);
  assert.strictEqual(rowReact.is_active, 1);
});

test('GLOBAL ACTIVATION 2: Branch Manager is strictly FORBIDDEN (403) from mutating is_active', async () => {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update('bm_act_pass').digest('hex');
  db.prepare(`
    INSERT OR REPLACE INTO users (id, brand_id, organization_id, branch_id, username, email, password_hash, full_name, role)
    VALUES ('usr_bm_act', 'brand_bangjo', 'org_xentra_holding', 'branch_bangjo_barat', 'bm_act', 'bm_act@bangjo.com', ?, 'BM Act', 'branch_manager')
  `).run(hash);

  const bm = await b1Login('bm_act', 'bm_act_pass');
  assert.strictEqual(bm.status, 200);

  // BM tries to mutate is_active on their OWN branch
  const deniedRes = await b1PutBranch(bm.headers, 'branch_bangjo_barat', { is_active: 0 });
  assert.strictEqual(deniedRes.status, 403);
  const deniedData = await deniedRes.json();
  assert.strictEqual(deniedData.error, 'INSUFFICIENT_PERMISSIONS');

  // Branch remains active
  const branchRow = db.prepare('SELECT is_active FROM branches WHERE id = ?').get('branch_bangjo_barat');
  assert.strictEqual(branchRow.is_active, 1);
});

test('GLOBAL ACTIVATION 3: Cross-brand is_active mutation by Owner is rejected with 404', async () => {
  const owner = await b1Login('admin', 'bangjo123');
  assert.strictEqual(owner.status, 200);

  // Attempt to mutate branch belonging to another brand
  const crossRes = await b1PutBranch(owner.headers, 'branch_other_co', { is_active: 0 });
  assert.strictEqual(crossRes.status, 404);

  const foreignBranch = db.prepare("SELECT is_active FROM branches WHERE id = 'branch_other_co'").get();
  assert.strictEqual(foreignBranch.is_active, 1);
});

/* =========================================================================
   BRANCH CATALOG MANAGEMENT TESTS (ADOPTION, LOCAL PRICING & CATEGORIES)
   ========================================================================= */

test('BRANCH CATALOG 1: GET /admin/branches/:id/catalog returns adopted products and available master products', async () => {
  const owner = await b1Login('admin', 'bangjo123');
  assert.strictEqual(owner.status, 200);

  const res = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat/catalog', {
    method: 'GET',
    headers: owner.headers
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(Array.isArray(data.adopted_products));
  assert.ok(Array.isArray(data.available_master_products));
  assert.ok(Array.isArray(data.categories));
});

test('BRANCH CATALOG 2: POST /admin/branches/:id/adopt enforces PricingPolicyModel LOCK mode', async () => {
  const owner = await b1Login('admin', 'bangjo123');
  
  // Ensure master product has lock mode
  db.prepare("INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, pricing_mode, is_active) VALUES ('prod_test_lock', 'brand_bangjo', '34', 'Menu Lock Test', 'menu-lock-test', 25000, 'lock', 1)").run();
  // Ensure not currently adopted in barat
  db.prepare("DELETE FROM branch_products WHERE branch_id = 'branch_bangjo_barat' AND product_id = 'prod_test_lock'").run();

  // Adopt with client price 30000 (different from master 25000)
  const res = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat/adopt', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({
      product_id: 'prod_test_lock',
      price: 30000
    })
  });
  assert.strictEqual(res.status, 201);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  // Must enforce owner base price 25000 in lock mode
  assert.strictEqual(data.adopted.price, 25000);

  const bp = db.prepare("SELECT price, is_available FROM branch_products WHERE branch_id = 'branch_bangjo_barat' AND product_id = 'prod_test_lock'").get();
  assert.strictEqual(bp.price, 25000);
  assert.strictEqual(bp.is_available, 1);
});

test('BRANCH CATALOG 3: POST /admin/branches/:id/adopt enforces PricingPolicyModel RANGE mode (accepts within, rejects outside)', async () => {
  const owner = await b1Login('admin', 'bangjo123');
  
  db.prepare("INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, pricing_mode, min_price, max_price, is_active) VALUES ('prod_test_range', 'brand_bangjo', '34', 'Menu Range Test', 'menu-range-test', 20000, 'range', 18000, 24000, 1)").run();
  db.prepare("DELETE FROM branch_products WHERE branch_id = 'branch_bangjo_barat' AND product_id = 'prod_test_range'").run();

  // Reject price above max (26000 > 24000)
  const rejectRes = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat/adopt', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({
      product_id: 'prod_test_range',
      price: 26000
    })
  });
  assert.strictEqual(rejectRes.status, 400);
  const rejectData = await rejectRes.json();
  assert.strictEqual(rejectData.error, 'INVALID_BRANCH_PRICE');

  // Accept valid price within range (22000)
  const acceptRes = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat/adopt', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({
      product_id: 'prod_test_range',
      price: 22000
    })
  });
  assert.strictEqual(acceptRes.status, 201);
  const acceptData = await acceptRes.json();
  assert.strictEqual(acceptData.adopted.price, 22000);

  // Verify reflection in Customer PWA menu API (menuData.all_products is array of all branch products)
  const menuRes = await mockFetch('/api/v1/catalog/menu?branch_id=branch_bangjo_barat', { method: 'GET' });
  assert.strictEqual(menuRes.status, 200);
  const menuData = await menuRes.json();
  const prods = Array.isArray(menuData.all_products) ? menuData.all_products : (menuData.products?.items || []);
  const found = prods.find(p => p.id === 'prod_test_range');
  assert.ok(found, 'Adopted product must appear in Customer PWA branch catalog');
  assert.strictEqual(found.price, 22000);
});

test('BRANCH CATALOG 4: DELETE /admin/branches/:id/products/:productId removes product from branch catalog and customer view', async () => {
  const owner = await b1Login('admin', 'bangjo123');

  const delRes = await mockFetch('/api/v1/admin/branches/branch_bangjo_barat/products/prod_test_range', {
    method: 'DELETE',
    headers: owner.headers
  });
  assert.strictEqual(delRes.status, 200);

  // Verify no longer appears in Customer PWA branch catalog
  const menuRes = await mockFetch('/api/v1/catalog/menu?branch_id=branch_bangjo_barat', { method: 'GET' });
  const menuData = await menuRes.json();
  const prods = Array.isArray(menuData.all_products) ? menuData.all_products : (menuData.products?.items || []);
  const found = prods.find(p => p.id === 'prod_test_range');
  assert.strictEqual(found, undefined, 'Un-adopted product must NOT appear in Customer PWA branch catalog');
});

// ==============================================================================
// TARGETED FIX #1: Checkout Delivery Promo Fallback Regression Tests
// ==============================================================================
test('CHECKOUT PROMO REGRESSION — CASE A: branch without promo config has delivery discount = 0 (no fabricated default)', async () => {
  const customerToken = await createCustomerSession('081299990001');

  // Create isolated branch with 0 / unconfigured promo
  const testBranchId = 'branch_nopromo_' + Date.now();
  db.prepare(`
    INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active, is_open_override)
    VALUES (?, 'brand_bangjo', 'Cabang No Promo', ?, 'Jl. Tanpa Promo No. 1', -7.2912, 112.7154, '081299990001', 1, 1)
  `).run(testBranchId, 'slug-' + testBranchId);

  db.prepare(`
    INSERT INTO branch_delivery_settings (id, branch_id, free_delivery_km, price_per_km, max_radius_km, promo_min_order, promo_delivery_discount)
    VALUES (?, ?, 0, 3000, 20, 0, 0)
  `).run('bds_' + testBranchId, testBranchId);

  // Adopt standard product (id 272, price 25000) so branch can fulfill order
  db.prepare(`
    INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, is_available)
    VALUES (?, '272', 25000, 1)
  `).run(testBranchId);

  // Subtotal = 25000 * 3 = 75000 (exceeds the old fabricated threshold of 50000)
  const payload = {
    branch_id: testBranchId,
    selection_mode: 'customer_selected',
    payment_method: 'cash',
    customer: {
      name: 'Pelanggan No Promo',
      phone: '081299990001'
    },
    order_type: 'delivery',
    delivery: {
      address: 'Jl. Pemuda No. 10',
      latitude: -7.2600,
      longitude: 112.7400
    },
    items: [
      { id: '272', quantity: 3 }
    ]
  };

  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify(payload)
  });

  assert.strictEqual(res.status, 201);
  const data = await res.json();
  assert.strictEqual(data.success, true);

  // Verify the order in database: discount_amount MUST be 0, no fabricated promo applied
  const orderRow = db.prepare('SELECT subtotal, delivery_fee, discount_amount, grand_total FROM orders WHERE id = ?').get(data.order_id);
  assert.strictEqual(orderRow.subtotal, 75000);
  assert.strictEqual(orderRow.discount_amount, 0, 'Branch without promo config must have discount_amount = 0');
  assert.strictEqual(orderRow.grand_total, orderRow.subtotal + orderRow.delivery_fee, 'Grand total must equal subtotal + full delivery fee without fabricated discount');
});

test('CHECKOUT PROMO REGRESSION — CASE B: branch with valid promo config applies configured discount', async () => {
  const customerToken = await createCustomerSession('081299990002');

  // Create isolated branch with custom promo configuration: discount 7000 on min_order 60000
  const testBranchId = 'branch_withpromo_' + Date.now();
  db.prepare(`
    INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active, is_open_override)
    VALUES (?, 'brand_bangjo', 'Cabang With Promo', ?, 'Jl. Ada Promo No. 2', -7.2912, 112.7154, '081299990002', 1, 1)
  `).run(testBranchId, 'slug-' + testBranchId);

  db.prepare(`
    INSERT INTO branch_delivery_settings (id, branch_id, free_delivery_km, price_per_km, max_radius_km, promo_min_order, promo_delivery_discount)
    VALUES (?, ?, 0, 3000, 20, 60000, 7000)
  `).run('bds_' + testBranchId, testBranchId);

  // Adopt standard product (id 272, price 25000)
  db.prepare(`
    INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, is_available)
    VALUES (?, '272', 25000, 1)
  `).run(testBranchId);

  // Subtotal = 25000 * 3 = 75000 (exceeds 60000 target)
  const payload = {
    branch_id: testBranchId,
    selection_mode: 'customer_selected',
    payment_method: 'cash',
    customer: {
      name: 'Pelanggan With Promo',
      phone: '081299990002'
    },
    order_type: 'delivery',
    delivery: {
      address: 'Jl. Pemuda No. 10',
      latitude: -7.2600,
      longitude: 112.7400
    },
    items: [
      { id: '272', quantity: 3 }
    ]
  };

  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': customerToken },
    body: JSON.stringify(payload)
  });

  assert.strictEqual(res.status, 201);
  const data = await res.json();
  assert.strictEqual(data.success, true);

  // Verify the order in database: discount_amount MUST be exactly 7000 (from branch config)
  const orderRow = db.prepare('SELECT subtotal, delivery_fee, discount_amount, grand_total FROM orders WHERE id = ?').get(data.order_id);
  assert.strictEqual(orderRow.subtotal, 75000);
  assert.strictEqual(orderRow.discount_amount, 7000, 'Branch with promo config must apply exactly the branch-configured discount');
  assert.strictEqual(orderRow.grand_total, orderRow.subtotal + orderRow.delivery_fee - 7000, 'Grand total must reflect branch-configured promo discount');
});

test('API Branch Categories: PUT /api/v1/admin/branches/:id/categories/reorder updates sort order and reflects in customer catalog', async () => {
  // Login as admin
  const loginRes = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'bangjo123' })
  });
  const loginData = await loginRes.json();
  const authHeaders = { authorization: 'Bearer ' + loginData.token };

  const testBranchId = 'branch_bangjo_barat';
  const initialCats = db.prepare('SELECT id, name, sort_order FROM branch_categories WHERE branch_id = ? ORDER BY sort_order ASC').all(testBranchId);
  assert.ok(initialCats.length >= 2, 'Must have at least 2 categories');

  const reversedIds = initialCats.map(c => c.id).reverse();

  // Call reorder endpoint
  const reorderRes = await mockFetch(`/api/v1/admin/branches/${testBranchId}/categories/reorder`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ order: reversedIds })
  });
  assert.strictEqual(reorderRes.status, 200);
  const reorderData = await reorderRes.json();
  assert.strictEqual(reorderData.success, true);

  // Check database sort order
  const updatedCats = db.prepare('SELECT id, name, sort_order FROM branch_categories WHERE branch_id = ? ORDER BY sort_order ASC').all(testBranchId);
  assert.deepStrictEqual(updatedCats.map(c => c.id), reversedIds);

  // Check customer menu endpoint reflects the new order
  const menuRes = await mockFetch(`/api/v1/catalog/menu?branch_id=${testBranchId}`);
  assert.strictEqual(menuRes.status, 200);
  const menuData = await menuRes.json();
  assert.strictEqual(menuData.success, true);
  assert.deepStrictEqual(menuData.categories.map(c => c.id), reversedIds);
});



