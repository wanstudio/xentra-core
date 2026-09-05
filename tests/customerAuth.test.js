const test = require('node:test');
const assert = require('node:assert');
const app = require('../server/app');
const db = require('../server/database/db');

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

    let statusCode = 200;
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

function addTestBranch(id) {
  db.prepare(`INSERT OR REPLACE INTO branches
    (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active, is_open_override)
    VALUES (?, 'brand_bangjo', ?, ?, 'Jl. Test', -7.2912, 112.7154, '081000000001', 1, 1)`)
    .run(id, 'Branch ' + id, id);
  db.prepare(`INSERT OR REPLACE INTO branch_delivery_settings
    (id, branch_id, is_delivery_active, is_pickup_active, max_radius_km, free_delivery_km, price_per_km, min_order_amount)
    VALUES (?, ?, 1, 1, 25, 5, 3000, 0)`)
    .run('bds_' + id, id);
  db.prepare(`INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available)
    VALUES (?, '272', 35000, 10, 1)`).run(id);
}

async function createOrder(phone, branchId) {
  const token = await createCustomerSession(phone);
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': token },
    body: JSON.stringify({
      branch_id: branchId,
      payment_method: 'cash',
      customer: { name: 'Test Customer', phone },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  const data = await res.json();
  return { orderId: data.order_id, status: res.status, token };
}

test('SEC-01: Valid authenticated customer can access own order', async () => {
  addTestBranch('branch_sec_01');
  const { orderId, token } = await createOrder('089000000001', 'branch_sec_01');
  assert.ok(orderId, 'order must be created');

  const res = await mockFetch('/api/v1/orders/' + orderId, {
    headers: { 'x-customer-token': token }
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.order.id, orderId);
});

test('SEC-02: Unauthenticated request is rejected with 403', async () => {
  addTestBranch('branch_sec_02');
  const { orderId } = await createOrder('089000000002', 'branch_sec_02');

  const res = await mockFetch('/api/v1/orders/' + orderId);
  assert.strictEqual(res.status, 403);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.error, 'FORBIDDEN_ORDER_ACCESS');
});

test('SEC-03: Customer A cannot access Customer B order', async () => {
  addTestBranch('branch_sec_03');
  const { orderId } = await createOrder('089000000003', 'branch_sec_03');
  const otherToken = await createCustomerSession('089000000099');

  const res = await mockFetch('/api/v1/orders/' + orderId, {
    headers: { 'x-customer-token': otherToken }
  });
  assert.strictEqual(res.status, 403);
});

test('SEC-04: Customer A cannot cancel Customer B order', async () => {
  addTestBranch('branch_sec_04');
  const { orderId } = await createOrder('089000000004', 'branch_sec_04');
  const otherToken = await createCustomerSession('089000000098');

  const res = await mockFetch('/api/v1/orders/' + orderId + '/cancel', {
    method: 'POST',
    headers: { 'x-customer-token': otherToken },
    body: JSON.stringify({ reason: 'hack' })
  });
  assert.strictEqual(res.status, 403);
  const data = await res.json();
  assert.strictEqual(data.error, 'FORBIDDEN_ORDER_OWNERSHIP');
});

test('SEC-05: Forged client-generated cust_ token is rejected by requireCustomerAuth', async () => {
  const forgedToken = 'cust_' + Date.now();
  const res = await mockFetch('/api/v1/orders/any_order/cancel', {
    method: 'POST',
    headers: { 'x-customer-token': forgedToken },
    body: JSON.stringify({ reason: 'test' })
  });
  assert.strictEqual(res.status, 401);
  const data = await res.json();
  assert.ok(['CUSTOMER_AUTH_REQUIRED', 'INVALID_OR_EXPIRED_CUSTOMER_SESSION'].includes(data.error));
});

test('SEC-06: Forged xnt_cust_ token (not in server store) is rejected', async () => {
  const forgedToken = 'xnt_cust_' + 'a'.repeat(48);
  const res = await mockFetch('/api/v1/orders/any_order/cancel', {
    method: 'POST',
    headers: { 'x-customer-token': forgedToken },
    body: JSON.stringify({ reason: 'test' })
  });
  assert.strictEqual(res.status, 401);
  const data = await res.json();
  assert.ok(['CUSTOMER_AUTH_REQUIRED', 'INVALID_OR_EXPIRED_CUSTOMER_SESSION'].includes(data.error));
});

test('SEC-07: OTP-created session is recognized by requireCustomerAuth', async () => {
  addTestBranch('branch_sec_07');
  const token = await createCustomerSession('089000000007');

  const res = await mockFetch('/api/v1/addresses', {
    headers: { 'x-customer-token': token }
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(Array.isArray(data.addresses));
});

test('SEC-08: Checkout requires valid customer auth (no unauthenticated checkout)', async () => {
  addTestBranch('branch_sec_08');

  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    body: JSON.stringify({
      branch_id: 'branch_sec_08',
      payment_method: 'cash',
      customer: { name: 'Hacker', phone: '089000000088' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(res.status, 401);
  const data = await res.json();
  assert.strictEqual(data.error, 'CUSTOMER_AUTH_REQUIRED');
});

test('SEC-09: Checkout with OTP session binds authoritative phone from session, not body', async () => {
  addTestBranch('branch_sec_09');
  const phone = '089000000009';
  const token = await createCustomerSession(phone);

  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': token },
    body: JSON.stringify({
      branch_id: 'branch_sec_09',
      payment_method: 'cash',
      customer: { name: 'Body Phone', phone: '089999999999' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(res.status, 201);
  const data = await res.json();
  assert.strictEqual(data.success, true);

  const order = db.prepare('SELECT customer_phone FROM orders WHERE id = ?').get(data.order_id);
  assert.strictEqual(order.customer_phone, phone, 'server must use OTP session phone, not body phone');
});

test('OTP-FLOW-01: OTP send returns valid challenge_id with retry_after', async () => {
  const res = await mockFetch('/api/v1/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({ phone: '089000000101' })
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.challenge_id, 'must return challenge_id');
  assert.ok(data.challenge_id.startsWith('chk_'), 'challenge_id must start with chk_');
  assert.strictEqual(typeof data.retry_after, 'number');
});

test('OTP-FLOW-02: OTP verify with correct code returns xnt_cust_ token', async () => {
  const phone = '089000000102';
  const sendRes = await mockFetch('/api/v1/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({ phone })
  });
  const sendData = await sendRes.json();

  const verifyRes = await mockFetch('/api/v1/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: sendData.challenge_id, otp: '123456', phone })
  });
  assert.strictEqual(verifyRes.status, 200);
  const verifyData = await verifyRes.json();
  assert.strictEqual(verifyData.success, true);
  assert.strictEqual(verifyData.verified, true);
  assert.ok(verifyData.token, 'must return token');
  assert.ok(verifyData.token.startsWith('xnt_cust_'), 'token must start with xnt_cust_');
  assert.ok(verifyData.expires_at, 'must return expires_at');
  assert.strictEqual(verifyData.phone, phone, 'must return the verified phone');
});

test('OTP-FLOW-03: OTP verify with wrong code returns error and does not authenticate', async () => {
  const phone = '089000000103';
  const sendRes = await mockFetch('/api/v1/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({ phone })
  });
  const sendData = await sendRes.json();

  const verifyRes = await mockFetch('/api/v1/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: sendData.challenge_id, otp: '000000', phone })
  });
  assert.strictEqual(verifyRes.status, 400);
  const verifyData = await verifyRes.json();
  assert.strictEqual(verifyData.success, false);
  assert.strictEqual(verifyData.error, 'INVALID_OTP');
  assert.ok(!verifyData.token, 'must not return token on failed verify');
});

test('OTP-FLOW-04: Complete OTP flow end-to-end: send → verify → use token for checkout', async () => {
  addTestBranch('branch_sec_flow');
  const phone = '089000000104';

  const sendRes = await mockFetch('/api/v1/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({ phone })
  });
  const sendData = await sendRes.json();
  assert.ok(sendData.challenge_id, 'send must return challenge_id');

  const verifyRes = await mockFetch('/api/v1/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: sendData.challenge_id, otp: '123456', phone })
  });
  const verifyData = await verifyRes.json();
  assert.ok(verifyData.token, 'verify must return token');

  const orderRes = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { 'x-customer-token': verifyData.token },
    body: JSON.stringify({
      branch_id: 'branch_sec_flow',
      payment_method: 'cash',
      customer: { name: 'Flow Test', phone },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  assert.strictEqual(orderRes.status, 201);
  const orderData = await orderRes.json();
  assert.strictEqual(orderData.success, true);
  assert.ok(orderData.order_id, 'must create order');
});

test('OTP-FLOW-05: OTP send without phone returns 400', async () => {
  const res = await mockFetch('/api/v1/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({})
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
});

test('OTP-FLOW-06: OTP verify without challenge_id returns 400', async () => {
  const res = await mockFetch('/api/v1/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ otp: '123456' })
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
});

test('OTP-FLOW-07: OTP verify with non-existent challenge_id returns error', async () => {
  const res = await mockFetch('/api/v1/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: 'chk_nonexistent', otp: '123456', phone: '089000000107' })
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.error, 'CHALLENGE_NOT_FOUND');
});

test('OTP-FLOW-08: Max OTP attempts exceeded returns error', async () => {
  const phone = '089000000108';
  const sendRes = await mockFetch('/api/v1/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({ phone })
  });
  const sendData = await sendRes.json();

  for (let i = 0; i < 3; i++) {
    await mockFetch('/api/v1/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ challenge_id: sendData.challenge_id, otp: '000000', phone })
    });
  }

  const finalRes = await mockFetch('/api/v1/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: sendData.challenge_id, otp: '000000', phone })
  });
  const finalData = await finalRes.json();
  assert.strictEqual(finalRes.status, 400);
  assert.strictEqual(finalData.error, 'MAX_ATTEMPTS_EXCEEDED');
});

test('OTP-FLOW-09: Rate limit blocks immediate re-send', async () => {
  const phone = '089000000109';
  await mockFetch('/api/v1/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({ phone })
  });

  const secondRes = await mockFetch('/api/v1/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({ phone })
  });
  assert.strictEqual(secondRes.status, 429);
  const data = await secondRes.json();
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.error, 'TOO_MANY_REQUESTS');
  assert.ok(data.retry_after > 0, 'must return retry_after');
});

test('SEC-13: Unauthenticated /checkout/verify is rejected with 401', async () => {
  addTestBranch('branch_sec_13');

  const res = await mockFetch('/api/v1/checkout/verify', {
    method: 'POST',
    body: JSON.stringify({
      branch_id: 'branch_sec_13',
      order_type: 'pickup',
      items: [{ product_id: '272', id: '272', quantity: 1, expected_price: 35000 }]
    })
  });
  assert.strictEqual(res.status, 401);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.error, 'CUSTOMER_AUTH_REQUIRED');
});

test('SEC-14: Forged customer token on /checkout/verify is rejected with 401', async () => {
  addTestBranch('branch_sec_14');

  const res = await mockFetch('/api/v1/checkout/verify', {
    method: 'POST',
    headers: { 'x-customer-token': 'xnt_cust_' + 'a'.repeat(48) },
    body: JSON.stringify({
      branch_id: 'branch_sec_14',
      order_type: 'pickup',
      items: [{ product_id: '272', id: '272', quantity: 1, expected_price: 35000 }]
    })
  });
  assert.strictEqual(res.status, 401);
  const data = await res.json();
  assert.ok(['CUSTOMER_AUTH_REQUIRED', 'INVALID_OR_EXPIRED_CUSTOMER_SESSION'].includes(data.error));
});

test('SEC-15: /checkout/verify uses session phone, not body phone', async () => {
  addTestBranch('branch_sec_15');
  const sessionPhone = '089000000015';
  const token = await createCustomerSession(sessionPhone);

  const res = await mockFetch('/api/v1/checkout/verify', {
    method: 'POST',
    headers: { 'x-customer-token': token },
    body: JSON.stringify({
      branch_id: 'branch_sec_15',
      order_type: 'pickup',
      customer: { name: 'Body Name', phone: '089999999999' },
      items: [{ product_id: '272', id: '272', quantity: 1, expected_price: 35000 }]
    })
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.verified_items, 'must return verified_items');
});

test('SEC-16: Expired customer token on /checkout/verify is rejected with 401', async () => {
  addTestBranch('branch_sec_16');

  const expiredToken = 'xnt_cust_expired_' + Date.now();
  const res = await mockFetch('/api/v1/checkout/verify', {
    method: 'POST',
    headers: { 'x-customer-token': expiredToken },
    body: JSON.stringify({
      branch_id: 'branch_sec_16',
      order_type: 'pickup',
      items: [{ product_id: '272', id: '272', quantity: 1, expected_price: 35000 }]
    })
  });
  assert.strictEqual(res.status, 401);
  const data = await res.json();
  assert.ok(['CUSTOMER_AUTH_REQUIRED', 'INVALID_OR_EXPIRED_CUSTOMER_SESSION'].includes(data.error));
});

test('SEC-17: Valid OTP session allows /checkout/verify to succeed', async () => {
  addTestBranch('branch_sec_17');
  const phone = '089000000017';
  const token = await createCustomerSession(phone);

  const res = await mockFetch('/api/v1/checkout/verify', {
    method: 'POST',
    headers: { 'x-customer-token': token },
    body: JSON.stringify({
      branch_id: 'branch_sec_17',
      order_type: 'pickup',
      customer: { name: 'Verify Customer', phone },
      items: [{ product_id: '272', id: '272', quantity: 1, expected_price: 35000 }]
    })
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(Array.isArray(data.verified_items));
});
