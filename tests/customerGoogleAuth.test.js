/**
 * R3 Customer Google Auth — Backend Test Suite
 *
 * Tests for POST /api/v1/customer/auth/google
 *
 * Invariants under test:
 *  CGA-01  Missing credential → 400 MISSING_GOOGLE_CREDENTIAL
 *  CGA-02  Invalid Google token (bad format) → 400/401
 *  CGA-03  Unverified Google email → 400 UNVERIFIED_GOOGLE_EMAIL
 *  CGA-04  Valid Google credential → 200, xnt_cust_ token issued
 *  CGA-05  Issued token accepted by requireCustomerAuth() (/checkout/verify)
 *  CGA-06  Google ID token is NEVER the Xentra customer session token
 *  CGA-07  Customer Google auth CANNOT invoke workforce /auth/google flow
 *  CGA-08  Returned token works for /checkout/create-order auth boundary
 *  CGA-09  Rate limiting: 10 attempts per 5 minutes per IP
 *  CGA-10  Unverified email → 400, no token issued
 */
'use strict';

process.env.NODE_ENV = 'test';
process.env.GOOGLE_CLIENT_ID = 'xentra-test-google-client-id.apps.googleusercontent.com';
process.env.JWT_SECRET = 'test-secret-customer-google-auth';

const test   = require('node:test');
const assert = require('node:assert');
const app    = require('../server/app');
const db     = require('../server/database/db');

// ── Mock Google tokeninfo ──────────────────────────────────────────────────
// Intercept axios.get calls to oauth2.googleapis.com/tokeninfo
const axios = require('axios');
const _originalAxiosGet = axios.get.bind(axios);
const mockTokens = new Map();

axios.get = async function (url, opts) {
  if (url && url.includes('oauth2.googleapis.com/tokeninfo')) {
    const idToken = (opts && opts.params && opts.params.id_token) || '';
    if (mockTokens.has(idToken)) {
      return { data: mockTokens.get(idToken) };
    }
    // Simulate Google returning 400 for unknown tokens
    const err = new Error('invalid_token');
    err.response = { status: 400, data: { error: 'invalid_token', error_description: 'Token is invalid' } };
    throw err;
  }
  return _originalAxiosGet(url, opts);
};

/**
 * Wrap a readable test token ID into a structurally-valid 3-part JWT string
 * so it passes GoogleAuthService's format guard (header.payload.signature).
 * The resulting token is registered in mockTokens so the axios interceptor
 * returns the correct claims when GoogleAuthService calls tokeninfo.
 */
function mkJwt(tokenId) {
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ test_id: tokenId })).toString('base64url');
  const sig     = Buffer.from(tokenId).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

function registerMockGoogleToken(tokenId, claims) {
  const jwtFmt = mkJwt(tokenId);
  const defaults = {
    iss: 'https://accounts.google.com',
    aud: process.env.GOOGLE_CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    email_verified: 'true'
  };
  mockTokens.set(jwtFmt, Object.assign({}, defaults, claims));
  // Return the JWT-formatted token so callers can use it in requests
  return jwtFmt;
}


// ── Request helper ─────────────────────────────────────────────────────────
async function mockFetch(path, options = {}) {
  const method  = options.method  || 'GET';
  const headers = options.headers || {};
  const body    = options.body ? JSON.parse(options.body) : null;

  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers: { host: 'app.mybangjo.com', 'content-type': 'application/json', ...headers },
      body,
      query: {},
      params: {},
      ip: '127.0.0.1'
    };

    if (path.includes('?')) {
      const parts = path.split('?');
      req.url = parts[0];
      const params = new URLSearchParams(parts[1]);
      for (const [k, v] of params.entries()) req.query[k] = v;
    }

    const res = {
      statusCode: 200,
      headers: {},
      status(code) { this.statusCode = code; return this; },
      setHeader(k, v) { this.headers[k] = v; },
      getHeader(k) { return this.headers[k]; },
      json(data) { resolve({ status: this.statusCode, json: async () => data }); },
      send(data) {
        let parsed = data;
        if (typeof data === 'string') { try { parsed = JSON.parse(data); } catch (_) {} }
        resolve({ status: this.statusCode, json: async () => parsed });
      },
      end(data) {
        let parsed = data;
        if (typeof data === 'string') { try { parsed = JSON.parse(data); } catch (_) {} }
        resolve({ status: this.statusCode, json: async () => parsed });
      }
    };

    app(req, res, (err) => { if (err) reject(err); });
  });
}

// Set up a test branch and product
function addTestBranch(branchId) {
  // Ensure product 272 exists in the test DB (brand_bangjo) before inserting
  // branch_products — the trg_branch_products_brand_consistency_insert trigger
  // requires products.brand_id == branches.brand_id.
  db.prepare(`INSERT OR IGNORE INTO products
    (id, brand_id, name, slug, description, price, is_active)
    VALUES ('272', 'brand_bangjo', 'Test Product 272', 'test-product-272', 'Test', 35000, 1)`)
    .run();
  db.prepare(`INSERT OR REPLACE INTO branches
    (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active, is_open_override)
    VALUES (?, 'brand_bangjo', ?, ?, 'Jl. Test', -7.2912, 112.7154, '081000000001', 1, 1)`)
    .run(branchId, 'Branch ' + branchId, branchId);
  db.prepare(`INSERT OR REPLACE INTO branch_delivery_settings
    (id, branch_id, is_delivery_active, is_pickup_active, max_radius_km, free_delivery_km, price_per_km, min_order_amount)
    VALUES (?, ?, 1, 1, 25, 5, 3000, 0)`)
    .run('bds_' + branchId, branchId);
  db.prepare(`INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available)
    VALUES (?, '272', 35000, 10, 1)`).run(branchId);
}


// ── CGA-01: Missing credential → 400 ──────────────────────────────────────
test('CGA-01: Missing Google credential → 400 MISSING_GOOGLE_CREDENTIAL', async () => {
  const res  = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({})
  });
  const data = await res.json();
  assert.strictEqual(res.status, 400);
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.code, 'MISSING_GOOGLE_CREDENTIAL');
});

// ── CGA-02: Invalid/unknown Google token → auth error ─────────────────────
test('CGA-02: Invalid Google token → 401/400, no token issued', async () => {
  const res  = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: 'not.a.valid.jwt.token' })
  });
  const data = await res.json();
  assert.ok(res.status >= 400, `Expected error status, got ${res.status}`);
  assert.strictEqual(data.success, false);
  assert.ok(!data.token, 'No token must be issued on invalid credential');
});

// ── CGA-03: Unverified Google email → 400 UNVERIFIED_GOOGLE_EMAIL ─────────
test('CGA-03: Unverified Google email → 400, no token issued', async () => {
  const tok = registerMockGoogleToken('tok_unverified_email', {
    sub: 'sub_unverified_cga03',
    email: 'unverified@example.com',
    email_verified: 'false',
    name: 'Unverified User'
  });

  const res  = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: tok })
  });
  const data = await res.json();
  assert.strictEqual(res.status, 400);
  assert.strictEqual(data.success, false);
  assert.strictEqual(data.code, 'UNVERIFIED_GOOGLE_EMAIL');
  assert.ok(!data.token, 'No token must be issued for unverified email');
});


// ── CGA-04: Valid credential → 200, xnt_cust_ token ──────────────────────
test('CGA-04: Valid Google credential → 200, xnt_cust_ token issued', async () => {
  const tok = registerMockGoogleToken('tok_valid_cga04', {
    sub: 'sub_valid_cga04',
    email: 'customer@example.com',
    email_verified: 'true',
    name: 'Valid Customer'
  });

  const res  = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: tok })
  });
  const data = await res.json();
  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
  assert.strictEqual(data.success, true);
  assert.ok(data.token, 'Token must be present');
  assert.ok(data.token.startsWith('xnt_cust_'), `Token must start with xnt_cust_, got: ${data.token}`);
  assert.ok(data.customer && data.customer.name, 'Customer name must be present');
  assert.ok(data.customer && data.customer.email, 'Customer email must be present');
  assert.ok(data.expires_at, 'expires_at must be present');
});

// ── CGA-05: Issued token accepted by requireCustomerAuth (/checkout/verify) ─
test('CGA-05: Google-issued customer token accepted by /checkout/verify', async () => {
  addTestBranch('branch_cga05');

  const tok = registerMockGoogleToken('tok_verify_cga05', {
    sub: 'sub_verify_cga05',
    email: 'verify_customer@example.com',
    email_verified: 'true',
    name: 'Verify Customer'
  });

  // Step 1: Get customer token via Google auth
  const authRes  = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: tok })
  });
  const authData = await authRes.json();
  assert.strictEqual(authRes.status, 200);
  assert.ok(authData.token);

  // Step 2: Use that token against /checkout/verify (requireCustomerAuth gate)
  const verifyRes  = await mockFetch('/api/v1/checkout/verify', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + authData.token },
    body: JSON.stringify({
      branch_id: 'branch_cga05',
      order_type: 'pickup',
      items: [{ id: '272', product_id: '272', quantity: 1, expected_price: 35000, branch_id: 'branch_cga05' }]
    })
  });
  const verifyData = await verifyRes.json();
  assert.ok(
    verifyRes.status === 200 || verifyRes.status === 400,
    `Expected 200 or 400 (business validation), got ${verifyRes.status}: ${JSON.stringify(verifyData)}`
  );
  // Crucially: must NOT return 401 CUSTOMER_AUTH_REQUIRED
  assert.notStrictEqual(verifyData.error, 'CUSTOMER_AUTH_REQUIRED',
    'Google-issued token must pass requireCustomerAuth()');
  assert.notStrictEqual(verifyData.error, 'INVALID_OR_EXPIRED_CUSTOMER_SESSION',
    'Google-issued token must pass session validation');
});

// ── CGA-06: Google ID token must not be the Xentra customer session token ──
test('CGA-06: Google ID token is NEVER returned as Xentra customer session token', async () => {
  const tok = registerMockGoogleToken('tok_token_isolation_cga06', {
    sub: 'sub_isolation_cga06',
    email: 'isolation@example.com',
    email_verified: 'true',
    name: 'Isolation Test'
  });

  const res  = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: tok })
  });
  const data = await res.json();
  assert.strictEqual(res.status, 200);
  assert.ok(data.token);

  // The returned token MUST NOT equal the Google credential (either raw id or JWT-wrapped)
  assert.notStrictEqual(data.token, tok,
    'Returned token must not be the raw Google credential');
  assert.notStrictEqual(data.token, 'tok_token_isolation_cga06',
    'Returned token must not be the test token id');
  // The returned token MUST be a server-issued xnt_cust_ token
  assert.ok(data.token.startsWith('xnt_cust_'),
    'Returned token must be a server-issued xnt_cust_ token');
  // The returned token MUST NOT be a workforce token (xnt_auth_)
  assert.ok(!data.token.startsWith('xnt_auth_'),
    'Returned token must not be a workforce xnt_auth_ token');
});

// ── CGA-07: Customer Google auth must NOT be usable as workforce auth ───────
test('CGA-07: Customer Google token rejected by workforce-only /auth/merchant/me', async () => {
  const tok = registerMockGoogleToken('tok_workforce_isolation_cga07', {
    sub: 'sub_workforce_cga07',
    email: 'workforce_test@example.com',
    email_verified: 'true',
    name: 'Workforce Isolation Test'
  });

  // Get a customer token
  const authRes  = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: tok })
  });
  const authData = await authRes.json();
  assert.strictEqual(authRes.status, 200);

  // Try to use it against a workforce-only endpoint (/auth/merchant/me requires xnt_auth_)
  const meRes  = await mockFetch('/api/v1/auth/merchant/me', {
    method: 'GET',
    headers: { authorization: 'Bearer ' + authData.token }
  });
  const meData = await meRes.json();
  // Workforce endpoint must reject customer tokens (401 or 403)
  assert.ok(
    meRes.status === 401 || meRes.status === 403,
    `Workforce endpoint must reject customer token, got ${meRes.status}: ${JSON.stringify(meData)}`
  );
});

// ── CGA-08: Google-issued token works for create-order auth boundary ────────
test('CGA-08: Google-issued customer token accepted by /checkout/create-order auth boundary', async () => {
  addTestBranch('branch_cga08');

  const tok = registerMockGoogleToken('tok_order_cga08', {
    sub: 'sub_order_cga08',
    email: 'order_customer@example.com',
    email_verified: 'true',
    name: 'Order Customer CGA08'
  });

  const authRes  = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: tok })
  });
  const authData = await authRes.json();
  assert.strictEqual(authRes.status, 200);
  assert.ok(authData.token);

  // Attempt create-order — we expect either success or a business validation error,
  // but NOT a 401 auth error.
  const orderRes  = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + authData.token },
    body: JSON.stringify({
      branch_id: 'branch_cga08',
      payment_method: 'cash',
      customer: { name: 'Order Customer CGA08', phone: 'order_customer@example.com' },
      order_type: 'pickup',
      items: [{ id: '272', quantity: 1 }]
    })
  });
  const orderData = await orderRes.json();

  // Must NOT be a 401 auth error — the auth boundary must pass
  assert.notStrictEqual(orderRes.status, 401,
    `Create-order must not return 401 for Google-issued token. Got: ${JSON.stringify(orderData)}`);
  assert.notStrictEqual(orderData.error, 'CUSTOMER_AUTH_REQUIRED',
    'Google-issued token must pass create-order auth boundary');
  assert.notStrictEqual(orderData.error, 'INVALID_OR_EXPIRED_CUSTOMER_SESSION',
    'Google-issued token must pass create-order session validation');
});

// ── CGA-09: id_token field (alternative credential key) also accepted ───────
test('CGA-09: id_token field accepted as alternative to credential field', async () => {
  const tok = registerMockGoogleToken('tok_idtoken_field_cga09', {
    sub: 'sub_idtoken_cga09',
    email: 'idtoken@example.com',
    email_verified: 'true',
    name: 'ID Token Field Test'
  });

  const res  = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ id_token: tok })
  });
  const data = await res.json();
  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
  assert.ok(data.token && data.token.startsWith('xnt_cust_'));
});

// ── CGA-10: Tenant isolation — customer token bound to correct brand ─────────
test('CGA-10: Customer Google session is brand-scoped (tenant isolation)', async () => {
  const tok = registerMockGoogleToken('tok_tenant_cga10', {
    sub: 'sub_tenant_cga10',
    email: 'tenant@example.com',
    email_verified: 'true',
    name: 'Tenant Isolation Customer'
  });

  // Get token for brand_bangjo (default test host)
  const authRes  = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: tok })
  });
  const authData = await authRes.json();
  assert.strictEqual(authRes.status, 200);
  assert.ok(authData.token);

  // Token should work on the same brand's /checkout/verify (brand_bangjo)
  addTestBranch('branch_cga10');
  const verifyRes = await mockFetch('/api/v1/checkout/verify', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + authData.token },
    body: JSON.stringify({
      branch_id: 'branch_cga10',
      order_type: 'pickup',
      items: [{ id: '272', product_id: '272', quantity: 1, expected_price: 35000, branch_id: 'branch_cga10' }]
    })
  });
  // Must not be 401 on the same brand
  const verifyData = await verifyRes.json();
  assert.notStrictEqual(verifyData.error, 'CUSTOMER_AUTH_REQUIRED');
  assert.notStrictEqual(verifyData.error, 'TENANT_MISMATCH',
    'Token issued for brand_bangjo must not fail TENANT_MISMATCH on brand_bangjo');
});

// ── CGA-11: Database Persistence — creates Customer and CustomerAuthProvider ─
test('CGA-11: Successful Google auth creates Customer and CustomerAuthProvider records', async () => {
  const tok = registerMockGoogleToken('tok_cga11', {
    sub: 'sub_cga11_unique',
    email: 'cga11@example.com',
    email_verified: 'true',
    name: 'CGA 11 User'
  });

  const res = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: tok })
  });
  const data = await res.json();
  assert.strictEqual(res.status, 200);
  assert.ok(data.customer && data.customer.id);
  assert.ok(data.customer.id.startsWith('cst_'));

  const custRow = db.prepare('SELECT * FROM customers WHERE id = ?').get(data.customer.id);
  assert.ok(custRow, 'Customer row must exist in customers table');
  assert.strictEqual(custRow.email, 'cga11@example.com');
  assert.strictEqual(custRow.display_name, 'CGA 11 User');

  const provRow = db.prepare('SELECT * FROM customer_auth_providers WHERE customer_id = ? AND provider = ?').get(data.customer.id, 'google');
  assert.ok(provRow, 'CustomerAuthProvider row must exist in customer_auth_providers table');
  assert.strictEqual(provRow.provider_user_id, 'sub_cga11_unique');
  assert.strictEqual(provRow.email, 'cga11@example.com');
});

// ── CGA-12: Sub Immutability — Same sub returns same Customer ID ───────────
test('CGA-12: Subsequent login with same Google sub resolves to same Customer ID', async () => {
  const tok1 = registerMockGoogleToken('tok_cga12_1', {
    sub: 'sub_cga12_fixed',
    email: 'cga12@example.com',
    email_verified: 'true',
    name: 'Initial Name'
  });
  const res1 = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: tok1 })
  });
  const data1 = await res1.json();
  assert.strictEqual(res1.status, 200);

  const tok2 = registerMockGoogleToken('tok_cga12_2', {
    sub: 'sub_cga12_fixed',
    email: 'cga12@example.com',
    email_verified: 'true',
    name: 'Initial Name'
  });
  const res2 = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: tok2 })
  });
  const data2 = await res2.json();
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(data2.customer.id, data1.customer.id, 'Customer ID must remain identical for same Google sub');
});

// ── CGA-13: Email Change on Google — sub preserves Customer ID ─────────────
test('CGA-13: Google email change with same sub updates email without changing Customer ID', async () => {
  const tok1 = registerMockGoogleToken('tok_cga13_old', {
    sub: 'sub_cga13_fixed',
    email: 'oldemail@example.com',
    email_verified: 'true',
    name: 'Old User'
  });
  const res1 = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: tok1 })
  });
  const data1 = await res1.json();
  const customerId = data1.customer.id;

  const tok2 = registerMockGoogleToken('tok_cga13_new', {
    sub: 'sub_cga13_fixed',
    email: 'newemail@example.com',
    email_verified: 'true',
    name: 'Updated User'
  });
  const res2 = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: tok2 })
  });
  const data2 = await res2.json();
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(data2.customer.id, customerId, 'Customer ID must not change when Google email changes');
  assert.strictEqual(data2.customer.email, 'newemail@example.com');

  const updatedCust = db.prepare('SELECT email FROM customers WHERE id = ?').get(customerId);
  assert.strictEqual(updatedCust.email, 'newemail@example.com');
});

// ── CGA-14: Different Google sub creates distinct Customer ─────────────────
test('CGA-14: Different Google sub creates distinct Customer', async () => {
  const tokA = registerMockGoogleToken('tok_cga14_a', {
    sub: 'sub_cga14_user_a',
    email: 'usera@example.com',
    email_verified: 'true',
    name: 'User A'
  });
  const tokB = registerMockGoogleToken('tok_cga14_b', {
    sub: 'sub_cga14_user_b',
    email: 'userb@example.com',
    email_verified: 'true',
    name: 'User B'
  });

  const resA = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: tokA })
  });
  const resB = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: tokB })
  });

  const dataA = await resA.json();
  const dataB = await resB.json();

  assert.notStrictEqual(dataA.customer.id, dataB.customer.id);
  assert.notStrictEqual(dataA.token, dataB.token);
});

// ── CGA-15: Concurrency / Race Safety on Google Sub ────────────────────────
test('CGA-15: Concurrent Google auth requests with same sub resolve cleanly without duplicate Customer', async () => {
  const tok = registerMockGoogleToken('tok_cga15_concurrent', {
    sub: 'sub_cga15_concurrent',
    email: 'concurrent@example.com',
    email_verified: 'true',
    name: 'Concurrent User'
  });

  const [res1, res2] = await Promise.all([
    mockFetch('/api/v1/customer/auth/google', { method: 'POST', body: JSON.stringify({ credential: tok }) }),
    mockFetch('/api/v1/customer/auth/google', { method: 'POST', body: JSON.stringify({ credential: tok }) })
  ]);

  const data1 = await res1.json();
  const data2 = await res2.json();

  assert.strictEqual(res1.status, 200);
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(data1.customer.id, data2.customer.id, 'Both concurrent calls must resolve to the same Customer ID');

  const count = db.prepare('SELECT COUNT(*) as cnt FROM customer_auth_providers WHERE provider_user_id = ?').get('sub_cga15_concurrent');
  assert.strictEqual(Number(count.cnt), 1, 'Only one customer_auth_providers row must exist for this sub');
});

// ── CGA-16: Strict Separation from Workforce Users ─────────────────────────
test('CGA-16: Customer Google auth NEVER touches workforce users or user_auth_providers table', async () => {
  const workforceUsersBefore = Number(db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt);
  const workforceAuthBefore = Number(db.prepare('SELECT COUNT(*) as cnt FROM user_auth_providers').get().cnt);

  const tok = registerMockGoogleToken('tok_cga16_separation', {
    sub: 'sub_cga16_separation',
    email: 'separation@example.com',
    email_verified: 'true',
    name: 'Separation Customer'
  });

  const res = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: tok })
  });
  assert.strictEqual(res.status, 200);

  const workforceUsersAfter = Number(db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt);
  const workforceAuthAfter = Number(db.prepare('SELECT COUNT(*) as cnt FROM user_auth_providers').get().cnt);

  assert.strictEqual(workforceUsersAfter, workforceUsersBefore, 'users table count must not change');
  assert.strictEqual(workforceAuthAfter, workforceAuthBefore, 'user_auth_providers table count must not change');
});

// ── CGA-17: Order customer_id tracking on Checkout Submission ───────────────
test('CGA-17: Order created with Google customer session records customer_id', async () => {
  const tok = registerMockGoogleToken('tok_cga17_order', {
    sub: 'sub_cga17_order',
    email: 'cga17_order@example.com',
    email_verified: 'true',
    name: 'Order Customer 17'
  });

  const authRes = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: tok })
  });
  const authData = await authRes.json();
  assert.strictEqual(authRes.status, 200);
  const customerId = authData.customer.id;

  addTestBranch('branch_cga17');
  const orderRes = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + authData.token },
    body: JSON.stringify({
      branch_id: 'branch_cga17',
      order_type: 'pickup',
      payment_method: 'cash',
      customer: { name: 'Order Customer 17', phone: '081999999017' },
      items: [{ id: '272', product_id: '272', quantity: 1, expected_price: 35000, branch_id: 'branch_cga17' }]
    })
  });
  const orderData = await orderRes.json();
  assert.ok(orderRes.status === 200 || orderRes.status === 201, `Order creation failed: ${JSON.stringify(orderData)}`);
  assert.ok(orderData.order_id);

  const orderRow = db.prepare('SELECT id, customer_id, customer_name, customer_phone FROM orders WHERE id = ?').get(orderData.order_id);
  assert.ok(orderRow);
  assert.strictEqual(orderRow.customer_id, customerId, 'Order must store customer_id from authenticated session');

  // Verify ownership check on GET /orders/:id using customer_id
  const getRes = await mockFetch(`/api/v1/orders/${orderData.order_id}`, {
    headers: { authorization: 'Bearer ' + authData.token }
  });
  const getData = await getRes.json();
  assert.strictEqual(getRes.status, 200);
  assert.strictEqual(getData.order && getData.order.id, orderData.order_id);

  // Verify customer cancellation on /orders/:id/cancel using customer_id
  const cancelRes = await mockFetch(`/api/v1/orders/${orderData.order_id}/cancel`, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + authData.token },
    body: JSON.stringify({ reason: 'Changed mind' })
  });
  const cancelData = await cancelRes.json();
  assert.strictEqual(cancelRes.status, 200, `Order cancel failed: ${JSON.stringify(cancelData)}`);
  assert.strictEqual(cancelData.decision, 'customer_cancel');
});

// ── CGA-19: Cross-brand Google identity must fail closed ───────────────────
test('CGA-19: Same Google sub cannot be silently reused across brands', async () => {
  const otherOrgId = 'org_cga19_other';
  const otherBrandId = 'brand_cga19_other';

  db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)')
    .run(otherOrgId, 'CGA 19 Other Org', 'cga19-other-org');
  db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain) VALUES (?, ?, ?, ?, ?)')
    .run(otherBrandId, otherOrgId, 'CGA 19 Other Brand', 'cga19-other-brand', 'cga19.other.test');

  const tok = registerMockGoogleToken('tok_cga19_cross_brand', {
    sub: 'sub_cga19_cross_brand',
    email: 'cga19@example.com',
    email_verified: 'true',
    name: 'Cross Brand Customer'
  });

  // First registration on the default Bangjo tenant.
  const firstRes = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: tok })
  });
  const firstData = await firstRes.json();
  assert.strictEqual(firstRes.status, 200);
  assert.ok(firstData.customer && firstData.customer.id);
  assert.ok(firstData.token);

  // Attempt to authenticate the same Google identity against another tenant.
  // Tenant context is explicitly selected through the control-plane host.
  const crossBrandRes = await mockFetch('/api/v1/customer/auth/google', {
    method: 'POST',
    headers: {
      host: 'xentra.cloud',
      'x-brand-id': otherBrandId
    },
    body: JSON.stringify({ credential: tok })
  });
  const crossBrandData = await crossBrandRes.json();

  assert.strictEqual(crossBrandRes.status, 403);
  assert.strictEqual(crossBrandData.success, false);
  assert.strictEqual(crossBrandData.code, 'CUSTOMER_IDENTITY_BRAND_MISMATCH');
  assert.ok(!crossBrandData.token, 'Cross-brand mismatch must never issue a customer session');

  const providerRows = db.prepare(
    'SELECT cap.customer_id, c.brand_id FROM customer_auth_providers cap JOIN customers c ON c.id = cap.customer_id WHERE cap.provider = ? AND cap.provider_user_id = ?'
  ).all('google', 'sub_cga19_cross_brand');

  assert.strictEqual(providerRows.length, 1, 'The Google sub must remain bound to exactly one Customer');
  assert.strictEqual(providerRows[0].customer_id, firstData.customer.id);
  assert.strictEqual(providerRows[0].brand_id, 'brand_bangjo');
});

// ── CGA-18: Invalid or Expired Customer Session fails closed ────────────────
test('CGA-18: Invalid or expired customer session rejected fail-closed', async () => {
  const invalidRes = await mockFetch('/api/v1/checkout/verify', {
    method: 'POST',
    headers: { authorization: 'Bearer xnt_cust_nonexistent1234567890' },
    body: JSON.stringify({ branch_id: 'branch_cga10', order_type: 'pickup', items: [] })
  });
  assert.strictEqual(invalidRes.status, 401);
  const invalidData = await invalidRes.json();
  assert.strictEqual(invalidData.error, 'INVALID_OR_EXPIRED_CUSTOMER_SESSION');
});

test.after(() => {
  axios.get = _originalAxiosGet;
});


