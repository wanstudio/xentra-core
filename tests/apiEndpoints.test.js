const test = require('node:test');
const assert = require('node:assert');
const app = require('../server/app');
const db = require('../server/database/db');

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
    body: JSON.stringify(payload)
  });

  assert.strictEqual(res.status, 201);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.order_id.startsWith('ord_'));
  assert.ok(data.order_number.startsWith('XN-'));
  // Subtotal = (35000 * 2) + (15000 * 2) = 70000 + 30000 = 100000
  assert.strictEqual(data.subtotal, 100000);
  assert.strictEqual(data.payment.method, 'midtrans');
  assert.ok(data.snap_token);

  // 1. Verify unauthorized visitor without customer session is rejected with 403 (NEW-01)
  const unauthRes = await mockFetch(`/api/v1/orders/${data.order_id}`);
  assert.strictEqual(unauthRes.status, 403, 'Unauthorized visitor without matching customer session must be rejected with 403');

  // 2. Verify query ?phone= cannot bypass authentication (NEW-01 Phone Bypass Guard)
  const phoneBypassRes = await mockFetch(`/api/v1/orders/${data.order_id}?phone=081234567890`);
  assert.strictEqual(phoneBypassRes.status, 403, 'Naked phone parameter MUST NOT grant access without OTP session token');

  // 3. Verify authorized customer with verified OTP session token gets sanitized projection (NEW-01)
  const otpRes = await mockFetch('/api/v1/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({ phone: '081234567890' })
  });
  const otpData = await otpRes.json();
  const verifyRes = await mockFetch('/api/v1/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: otpData.challenge_id, otp: '123456', phone: '081234567890' })
  });
  const verifyData = await verifyRes.json();
  assert.ok(verifyData.token, 'OTP verify must return customer token');

  const orderRes = await mockFetch(`/api/v1/orders/${data.order_id}`, {
    headers: { 'x-customer-token': verifyData.token }
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
  const payload = {
    branch_id: 'branch_bangjo_barat',
    payment_method: 'cash',
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
      { id: '272', quantity: 1 }
    ]
  };

  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
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
    customer: { name: 'Customer Test', phone: '081234567890' },
    order_type: 'delivery',
    delivery: { address: 'Jl. Darmo', latitude: -7.291230, longitude: 112.716750 },
    items: [{ id: '99999_unallocated_prod', quantity: 1 }]
  };

  const unallocatedRes = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    body: JSON.stringify(unallocatedPayload)
  });
  assert.strictEqual(unallocatedRes.status, 400);
  const unallocatedData = await unallocatedRes.json();
  assert.strictEqual(unallocatedData.success, false);
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
  // Attempt delivery order with formatted_address only but missing numeric lat/lng -> REJECTED 400
  const invalidCoordsPayload = {
    branch_id: 'branch_bangjo_barat',
    payment_method: 'cash',
    customer: { name: 'Customer Jauh', phone: '081234567890' },
    order_type: 'delivery',
    address: { formatted_address: 'Lokasi Sangat Jauh 50 km' }, // No lat/lng
    items: [{ id: '272', quantity: 1 }]
  };

  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    body: JSON.stringify(invalidCoordsPayload)
  });

  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.ok(data.error.includes('Titik koordinat pengantaran'));
});

test('API POS Cash Settlement: POST /api/v1/pos/orders/:id/settle-cash completes lifecycle with auth guard', async () => {
  const db = require('../server/database/db');

  // 1. Create a cash order via checkout
  const orderRes = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    body: JSON.stringify({
      branch_id: 'branch_bangjo_barat',
      payment_method: 'cash',
      customer: { name: 'Customer Bayar Tunai', phone: '081234567890' },
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

  // 4. Authorized cash settlement
  const settleRes = await mockFetch(`/api/v1/pos/orders/${orderId}/settle-cash`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ amount_tendered: 50000 })
  });
  assert.strictEqual(settleRes.status, 200);
  const settleData = await settleRes.json();
  assert.strictEqual(settleData.success, true);
  assert.strictEqual(settleData.payment.payment_status, 'settlement');

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

