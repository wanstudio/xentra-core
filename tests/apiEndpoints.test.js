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
      { id: 'prod_nasgor_spesial', quantity: 2, note: 'Pedas level 2' },
      { id: 'prod_es_teh_manis', quantity: 2, note: 'Sedikit es' }
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
  // Subtotal = (28000 * 2) + (6000 * 2) = 56000 + 12000 = 68000
  assert.strictEqual(data.subtotal, 68000);
  assert.ok(data.snap_token);
});
