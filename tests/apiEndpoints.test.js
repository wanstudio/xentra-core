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
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        resolve({ status: statusCode, json: async () => responseData });
      },
      send(data) {
        responseData = data;
        resolve({ status: statusCode, text: async () => responseData, json: async () => JSON.parse(responseData) });
      },
      setHeader() {},
      getHeader() {}
    };

    app(req, res, (err) => {
      if (err) reject(err);
    });
  });
}

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
    VALUES (?, 'brand_bangjo', 'branch_bangjo_timur', 'XN-TIMUR-999', 'Customer Timur', '081200000000', 'dine_in', 'confirmed', 50000, 50000)
  `).run(orderOtherBranchId);

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
    VALUES (?, 'brand_bangjo', 'branch_bangjo_barat', 'XN-BARAT-111', 'Customer Barat', '081200000001', 'dine_in', 'confirmed', 35000, 35000)
  `).run(orderBaratId);

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
  // 1. Login as authorized merchant staff
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
    body: JSON.stringify({ branch_id: 'branch_bangjo_barat', starting_float: 200000 })
  });
  assert.strictEqual(openRes.status, 201);
  const openData = await openRes.json();
  assert.strictEqual(openData.success, true);
  assert.strictEqual(openData.shift.starting_float, 200000);
  const shiftId = openData.shift.id;

  // 3. Get Current Shift
  const currentRes = await mockFetch('/api/v1/pos/shifts/current?branch_id=branch_bangjo_barat', {
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
  const crypto = require('crypto');
  const passHash = crypto.createHash('sha256').update('kasir123').digest('hex');
  db.prepare(`
    INSERT OR REPLACE INTO users (id, organization_id, username, password_hash, role, brand_id, branch_id)
    VALUES 
      ('usr_cashier_a', 'org_xentra_holding', 'kasir_a', ?, 'cashier', 'brand_bangjo', 'branch_bangjo_barat'),
      ('usr_cashier_b', 'org_xentra_holding', 'kasir_b', ?, 'cashier', 'brand_bangjo', 'branch_bangjo_barat')
  `).run(passHash, passHash);

  // Cashier B opens a shift
  const { PosShiftService } = require('../domains/pos');
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
});

