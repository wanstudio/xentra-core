const test = require('node:test');
const assert = require('node:assert');
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

test('API POST /api/v1/checkout/create-order: validates items and creates order snapshot', async () => {
  const payload = {
    branch_id: 'branch_bangjo_barat',
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
  assert.ok(data.snap_token);
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

test('API GET /health: returns 200 OK and ready persistence status', async () => {
  const res = await mockFetch('/health');
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.status, 'ok');
  assert.strictEqual(data.persistence, 'ready');
  assert.strictEqual(data.version, '2.2.5');
});

test('API GET /api/v1/brand/info with unknown tenant host: returns 404 TENANT_NOT_FOUND', async () => {
  const res = await mockFetch('/api/v1/brand/info', {
    headers: { host: 'unknown-tenant.com' }
  });
  assert.strictEqual(res.status, 404);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.error, 'TENANT_NOT_FOUND');
});

