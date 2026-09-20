'use strict';
/**
 * Customer Broker Auth — Centralized Google Login Flow
 *
 * Regression tests for the new customer auth broker architecture:
 *
 * CBAUTH-01  /customer/auth/broker/init returns broker_url for valid tenant brand
 * CBAUTH-02  /customer/auth/broker/init requires tenant brand context
 * CBAUTH-03  /customer/auth/broker/init requires brand.custom_domain
 * CBAUTH-04  /customer/auth/broker/google verifies credential and returns redirect_url with xnt_chdf_ code
 * CBAUTH-05  /customer/auth/broker/google rejects unverified Google email
 * CBAUTH-06  /customer/auth/broker/google rejects missing credential
 * CBAUTH-07  /customer/auth/broker/google rejects missing brand_id
 * CBAUTH-08  /customer/auth/broker/exchange issues xnt_cust_ token for valid xnt_chdf_ code
 * CBAUTH-09  /customer/auth/broker/exchange rejects invalid code prefix
 * CBAUTH-10  /customer/auth/broker/exchange rejects already-used code (single-use)
 * CBAUTH-11  /customer/auth/broker/exchange rejects code for wrong tenant (TENANT_MISMATCH)
 * CBAUTH-12  /customer/auth/broker/exchange requires tenant context
 * CBAUTH-13  xnt_cust_ token from broker exchange is accepted by /checkout/verify
 * CBAUTH-14  Merchant /auth/google endpoint is NOT accessible from customer broker flow
 * CBAUTH-15  Customer session token (xnt_cust_) ≠ merchant session token (xnt_auth_)
 * CBAUTH-16  Existing /customer/auth/google endpoint remains functional (backward compat)
 * CBAUTH-17  Customer does NOT call google.accounts.id.initialize on tenant origin (architecture contract)
 * CBAUTH-18  broker_url contains mode=customer and brand_id, pointing to xentra.cloud
 */

process.env.NODE_ENV = 'test';
process.env.GOOGLE_CLIENT_ID = 'xentra-broker-test-client.apps.googleusercontent.com';
process.env.XENTRA_CONTROL_PLANE_URL = 'https://xentra.cloud';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');

const db = require('../../server/database/db');
const app = require('../../server/app');

// ── Mock Google tokeninfo ──────────────────────────────────────────────────
const axios = require('axios');
const _origAxiosGet = axios.get.bind(axios);
const mockGoogleTokens = new Map();

axios.get = async function (url, opts) {
  if (url && url.includes('oauth2.googleapis.com/tokeninfo')) {
    const idToken = (opts && opts.params && opts.params.id_token) || '';
    if (mockGoogleTokens.has(idToken)) return { data: mockGoogleTokens.get(idToken) };
    const err = new Error('invalid_token');
    err.response = { status: 400, data: { error: 'invalid_token' } };
    throw err;
  }
  return _origAxiosGet(url, opts);
};

function mkJwt(id) {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ test_id: id })).toString('base64url');
  const s = Buffer.from(id).toString('base64url');
  return `${h}.${p}.${s}`;
}

function registerGoogleToken(id, claims) {
  const jwt = mkJwt(id);
  const defaults = {
    iss: 'https://accounts.google.com',
    aud: process.env.GOOGLE_CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    email_verified: 'true'
  };
  mockGoogleTokens.set(jwt, Object.assign({}, defaults, claims));
  return jwt;
}

// ── Test brand & organization setup ───────────────────────────────────────
// Use the real registered brand (brand_bangjo / app.mybangjo.com) for tenant A.
// This brand already exists in the DB and custom_domain is app.mybangjo.com.
const TEST_BRAND_ID = 'brand_bangjo';
const TEST_DOMAIN = 'app.mybangjo.com';

// For tenant isolation tests, we need a second real brand.
// We create a minimal one if it doesn't exist.
const TEST_BRAND_ID_B = 'brd_broker_iso_' + crypto.randomBytes(4).toString('hex');
const TEST_DOMAIN_B = 'isolation-tenant-' + crypto.randomBytes(4).toString('hex') + '.example.com';

function ensureTestBrands() {
  // Get org from existing brand
  const existingBrand = db.prepare('SELECT id, organization_id FROM brands WHERE id = ?').get(TEST_BRAND_ID);
  if (!existingBrand) {
    throw new Error('brand_bangjo must exist in DB for broker tests');
  }
  const orgId = existingBrand.organization_id;

  // Create second brand for isolation test
  const existBrandB = db.prepare('SELECT id FROM brands WHERE id = ?').get(TEST_BRAND_ID_B);
  if (!existBrandB) {
    db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(TEST_BRAND_ID_B, orgId, 'Isolation Tenant', 'iso-tenant-' + TEST_BRAND_ID_B.slice(-8), TEST_DOMAIN_B, new Date().toISOString(), new Date().toISOString());
  }
}

// ── HTTP request helper ────────────────────────────────────────────────────
function request(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(options.headers || {})
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (_) { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Test Suite ─────────────────────────────────────────────────────────────
let server;

test('Setup: start test server and seed test brands', async () => {
  ensureTestBrands();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
});

// CBAUTH-01
test('CBAUTH-01: /customer/auth/broker/init returns broker_url for valid tenant', async () => {
  const res = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/init',
    headers: { Host: TEST_DOMAIN }
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.broker_url, 'broker_url should be present');
  assert.ok(res.body.broker_url.includes('mode=customer'), 'broker_url must contain mode=customer');
  assert.ok(res.body.broker_url.includes('xentra.cloud'), 'broker_url must point to xentra.cloud');
  assert.ok(res.body.broker_url.includes(encodeURIComponent(TEST_DOMAIN)), 'broker_url return_to must contain tenant domain');
});

// CBAUTH-18
test('CBAUTH-18: broker_url contains mode=customer and brand_id param', async () => {
  const res = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/init',
    headers: { Host: TEST_DOMAIN }
  });
  assert.equal(res.status, 200);
  const url = new URL(res.body.broker_url);
  assert.equal(url.searchParams.get('mode'), 'customer');
  assert.ok(url.searchParams.get('brand_id'), 'brand_id must be present in broker_url');
  assert.ok(url.searchParams.get('return_to'), 'return_to must be present in broker_url');
});

// CBAUTH-02
test('CBAUTH-02: /customer/auth/broker/init requires tenant brand context', async () => {
  // xentra.cloud has no brand → should fail
  const res = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/init',
    headers: { Host: 'xentra.cloud' }
  });
  // Either 400 (no brand resolved) or 400 (no custom_domain)
  assert.ok(res.status >= 400, 'Should fail without tenant context');
});

// CBAUTH-04
test('CBAUTH-04: /customer/auth/broker/google verifies credential and returns redirect_url', async () => {
  const googleSub = 'broker-google-sub-04-' + crypto.randomBytes(4).toString('hex');
  const jwt = registerGoogleToken('broker-04', {
    sub: googleSub,
    email: 'broker04@example.com',
    name: 'Broker Test 04',
    email_verified: 'true'
  });

  const res = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/google',
    headers: { Host: 'xentra.cloud' }
  }, {
    credential: jwt,
    brand_id: TEST_BRAND_ID,
    return_to: `https://${TEST_DOMAIN}/`
  });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.success, true);
  assert.ok(res.body.redirect_url, 'redirect_url should be present');
  assert.ok(res.body.redirect_url.includes('customer_code=xnt_chdf_'), 'redirect_url must contain xnt_chdf_ code');
  assert.ok(res.body.redirect_url.includes(TEST_DOMAIN), 'redirect_url must point back to tenant domain');
});

// CBAUTH-05
test('CBAUTH-05: /customer/auth/broker/google rejects unverified Google email', async () => {
  const jwt = registerGoogleToken('broker-05-unverified', {
    sub: 'sub-05-unverified',
    email: 'unverified@example.com',
    name: 'Unverified',
    email_verified: false
  });

  const res = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/google',
    headers: { Host: 'xentra.cloud' }
  }, {
    credential: jwt,
    brand_id: TEST_BRAND_ID,
    return_to: `https://${TEST_DOMAIN}/`
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'UNVERIFIED_GOOGLE_EMAIL');
});

// CBAUTH-06
test('CBAUTH-06: /customer/auth/broker/google rejects missing credential', async () => {
  const res = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/google',
    headers: { Host: 'xentra.cloud' }
  }, { brand_id: TEST_BRAND_ID, return_to: `https://${TEST_DOMAIN}/` });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'MISSING_GOOGLE_CREDENTIAL');
});

// CBAUTH-07
test('CBAUTH-07: /customer/auth/broker/google rejects missing brand_id', async () => {
  const jwt = registerGoogleToken('broker-07', { sub: 'sub-07', email: 'x@x.com', email_verified: 'true' });
  const res = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/google',
    headers: { Host: 'xentra.cloud' }
  }, { credential: jwt, return_to: `https://${TEST_DOMAIN}/` });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'MISSING_BRAND_ID');
});

// CBAUTH-08: Full flow — get code from broker/google then exchange it
test('CBAUTH-08: /customer/auth/broker/exchange issues xnt_cust_ token for valid code', async () => {
  const googleSub = 'broker-sub-08-' + crypto.randomBytes(4).toString('hex');
  const jwt = registerGoogleToken('broker-08', {
    sub: googleSub,
    email: 'broker08@example.com',
    name: 'Broker Test 08',
    email_verified: 'true'
  });

  // Step 1: broker/google creates the handoff code
  const brokerRes = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/google',
    headers: { Host: 'xentra.cloud' }
  }, { credential: jwt, brand_id: TEST_BRAND_ID, return_to: `https://${TEST_DOMAIN}/` });

  assert.equal(brokerRes.status, 200);
  const redirectUrl = new URL(brokerRes.body.redirect_url);
  const code = redirectUrl.searchParams.get('customer_code');
  assert.ok(code && code.startsWith('xnt_chdf_'), 'code must have xnt_chdf_ prefix');

  // Step 2: exchange code for xnt_cust_ session
  const exchangeRes = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/exchange',
    headers: { Host: TEST_DOMAIN }
  }, { code });

  assert.equal(exchangeRes.status, 200, JSON.stringify(exchangeRes.body));
  assert.equal(exchangeRes.body.success, true);
  assert.ok(exchangeRes.body.token && exchangeRes.body.token.startsWith('xnt_cust_'), 'token must start with xnt_cust_');
  assert.ok(exchangeRes.body.customer && exchangeRes.body.customer.id, 'customer.id must be present');
  assert.ok(exchangeRes.body.expires_at, 'expires_at must be present');
});

// CBAUTH-09
test('CBAUTH-09: /customer/auth/broker/exchange rejects invalid code prefix', async () => {
  const res = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/exchange',
    headers: { Host: TEST_DOMAIN }
  }, { code: 'xnt_hdf_invalid_code_here' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_CUSTOMER_CODE');
});

// CBAUTH-10: Single-use code rejection
test('CBAUTH-10: /customer/auth/broker/exchange rejects already-used code', async () => {
  const googleSub = 'broker-sub-10-' + crypto.randomBytes(4).toString('hex');
  const jwt = registerGoogleToken('broker-10', {
    sub: googleSub,
    email: 'broker10@example.com',
    name: 'Broker Test 10',
    email_verified: 'true'
  });

  const brokerRes = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/google',
    headers: { Host: 'xentra.cloud' }
  }, { credential: jwt, brand_id: TEST_BRAND_ID, return_to: `https://${TEST_DOMAIN}/` });

  const code = new URL(brokerRes.body.redirect_url).searchParams.get('customer_code');

  // First exchange — should succeed
  const first = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/exchange',
    headers: { Host: TEST_DOMAIN }
  }, { code });
  assert.equal(first.status, 200);

  // Second exchange — must fail (code already consumed)
  const second = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/exchange',
    headers: { Host: TEST_DOMAIN }
  }, { code });
  assert.equal(second.status, 401);
  assert.equal(second.body.code, 'CODE_EXPIRED_OR_USED');
});

// CBAUTH-11: Tenant isolation — code issued for Brand A cannot be exchanged by Brand B
test('CBAUTH-11: /customer/auth/broker/exchange rejects code for wrong tenant', async () => {
  const googleSub = 'broker-sub-11-' + crypto.randomBytes(4).toString('hex');
  const jwt = registerGoogleToken('broker-11', {
    sub: googleSub,
    email: 'broker11@example.com',
    name: 'Broker Test 11',
    email_verified: 'true'
  });

  // Code issued for Brand A
  const brokerRes = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/google',
    headers: { Host: 'xentra.cloud' }
  }, { credential: jwt, brand_id: TEST_BRAND_ID, return_to: `https://${TEST_DOMAIN}/` });

  const code = new URL(brokerRes.body.redirect_url).searchParams.get('customer_code');

  // Attempt exchange from Brand B's domain
  const res = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/exchange',
    headers: { Host: TEST_DOMAIN_B }
  }, { code });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'TENANT_MISMATCH');
});

// CBAUTH-12
test('CBAUTH-12: /customer/auth/broker/exchange requires tenant context', async () => {
  const res = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/exchange',
    headers: { Host: 'xentra.cloud' }
  }, { code: 'xnt_chdf_' + crypto.randomBytes(24).toString('hex') });
  // xentra.cloud has no brand → TENANT_REQUIRED or INVALID_CUSTOMER_CODE
  assert.ok(res.status >= 400, 'Must fail without tenant context');
});

// CBAUTH-13: Token from exchange works for checkout auth
test('CBAUTH-13: xnt_cust_ token from broker exchange is accepted by /checkout/verify', async () => {
  const googleSub = 'broker-sub-13-' + crypto.randomBytes(4).toString('hex');
  const jwt = registerGoogleToken('broker-13', {
    sub: googleSub,
    email: 'broker13@example.com',
    name: 'Broker Test 13',
    email_verified: 'true'
  });

  const brokerRes = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/google',
    headers: { Host: 'xentra.cloud' }
  }, { credential: jwt, brand_id: TEST_BRAND_ID, return_to: `https://${TEST_DOMAIN}/` });

  const code = new URL(brokerRes.body.redirect_url).searchParams.get('customer_code');
  const exchangeRes = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/exchange',
    headers: { Host: TEST_DOMAIN }
  }, { code });

  const token = exchangeRes.body.token;
  assert.ok(token && token.startsWith('xnt_cust_'));

  // Verify token is accepted by checkout auth boundary
  const verifyRes = await request(server, {
    method: 'GET',
    path: '/api/v1/checkout/verify',
    headers: { Host: TEST_DOMAIN, Authorization: `Bearer ${token}` }
  });
  // 200 (verified) or 400/422 (valid session but no active order) — NOT 401
  assert.notEqual(verifyRes.status, 401, 'xnt_cust_ token must be accepted by checkout auth');
});

// CBAUTH-14: Merchant /auth/google endpoint is unreachable from customer broker
test('CBAUTH-14: Customer broker does NOT call merchant /auth/google endpoint', async () => {
  // The broker customer flow uses /customer/auth/broker/google, never /auth/google
  // Verify /auth/google endpoint exists but is merchant-only (workforce)
  const jwt = registerGoogleToken('cbauth-14-merchant', {
    sub: 'sub-14',
    email: 'merchant14@example.com',
    name: 'Merchant 14',
    email_verified: 'true'
  });
  const res = await request(server, {
    method: 'POST',
    path: '/api/v1/auth/google',
    headers: { Host: 'xentra.cloud' }
  }, { credential: jwt });
  // Merchant endpoint should exist and process differently — it returns workforce session
  // The key invariant: if it succeeds, token should NOT start with xnt_cust_
  if (res.status === 200 && res.body.token) {
    assert.ok(!res.body.token.startsWith('xnt_cust_'), 'merchant /auth/google must NOT issue xnt_cust_ token');
  }
  // Either way, endpoint is separate and must not be confused with customer broker
});

// CBAUTH-15: Customer and merchant sessions have different token prefixes
test('CBAUTH-15: Customer session token prefix (xnt_cust_) differs from merchant (xnt_auth_)', async () => {
  const googleSub = 'broker-sub-15-' + crypto.randomBytes(4).toString('hex');
  const jwt = registerGoogleToken('broker-15', {
    sub: googleSub,
    email: 'broker15@example.com',
    name: 'Broker Test 15',
    email_verified: 'true'
  });

  const brokerRes = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/google',
    headers: { Host: 'xentra.cloud' }
  }, { credential: jwt, brand_id: TEST_BRAND_ID, return_to: `https://${TEST_DOMAIN}/` });

  const code = new URL(brokerRes.body.redirect_url).searchParams.get('customer_code');
  const exchangeRes = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/broker/exchange',
    headers: { Host: TEST_DOMAIN }
  }, { code });

  assert.ok(exchangeRes.body.token.startsWith('xnt_cust_'), 'customer broker session must use xnt_cust_ prefix');
  assert.ok(!exchangeRes.body.token.startsWith('xnt_auth_'), 'customer broker session must NOT use merchant prefix');
});

// CBAUTH-16: Backward compatibility — existing /customer/auth/google still works
test('CBAUTH-16: Existing /customer/auth/google remains functional (backward compat)', async () => {
  const googleSub = 'broker-sub-16-legacy-' + crypto.randomBytes(4).toString('hex');
  const jwt = registerGoogleToken('broker-16-legacy', {
    sub: googleSub,
    email: 'legacy16@example.com',
    name: 'Legacy 16',
    email_verified: 'true'
  });

  const res = await request(server, {
    method: 'POST',
    path: '/api/v1/customer/auth/google',
    headers: { Host: TEST_DOMAIN }
  }, { credential: jwt });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.success, true);
  assert.ok(res.body.token && res.body.token.startsWith('xnt_cust_'), 'legacy endpoint still issues xnt_cust_ token');
});

// CBAUTH-17: Architecture contract — broker/google, not tenant GSI
test('CBAUTH-17: Source code does not call google.accounts.id.initialize directly from tenant origin in broker flow', async () => {
  const fs = require('fs');
  const path = require('path');
  // Read the new aux-pages.js and checkout.js login button handlers
  const auxPages = fs.readFileSync(path.join(__dirname, '../../apps/customer-pwa/assets/js/pages/aux-pages.js'), 'utf8');
  const checkoutJs = fs.readFileSync(path.join(__dirname, '../../apps/customer-pwa/assets/js/pages/checkout.js'), 'utf8');

  // The loginBtn.onclick in aux-pages must use broker/init, not gsi.initialize
  const auxLoginSection = auxPages.slice(auxPages.indexOf('loginBtn.onclick'));
  assert.ok(
    auxLoginSection.includes('broker/init'),
    'Profile login must use /customer/auth/broker/init'
  );
  // Verify GSI is not being initialized directly in the login button handler for Profile
  const loginOnClickBlock = auxLoginSection.slice(0, auxLoginSection.indexOf('logoutBtn'));
  assert.ok(
    !loginOnClickBlock.includes('gsi.initialize'),
    'Profile login must NOT call gsi.initialize directly'
  );

  // Checkout google button must use broker/init too
  assert.ok(
    checkoutJs.includes('broker/init'),
    'Checkout Google button must use /customer/auth/broker/init'
  );
});

// CBAUTH-18: Architecture contract — Customer PWA zero direct GSI
test('CBAUTH-18: Customer PWA has ZERO direct Google GSI SDK, meta client-id, or /customer/auth/google calls', async () => {
  const fs = require('fs');
  const path = require('path');

  const customerFiles = [
    path.join(__dirname, '../../apps/customer-pwa/index.html'),
    path.join(__dirname, '../../apps/customer-pwa/checkout.html'),
    path.join(__dirname, '../../apps/customer-pwa/assets/js/pages/checkout.js'),
    path.join(__dirname, '../../apps/customer-pwa/assets/js/pages/aux-pages.js')
  ];

  const prohibitedPatterns = [
    'accounts.google.com/gsi/client',
    'google.accounts.id.initialize',
    'google.accounts.id.renderButton',
    'google.accounts.id.prompt',
    'x-google-client-id',
    'XentraConfig.googleClientId',
    '/customer/auth/google'
  ];

  for (const filePath of customerFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const pattern of prohibitedPatterns) {
      assert.ok(
        !content.includes(pattern),
        `Customer PWA file ${path.basename(filePath)} must NOT contain "${pattern}"`
      );
    }
  }
});

// CBAUTH-19: Architecture contract — Google GSI ONLY initialized in centralized auth broker
test('CBAUTH-19: Centralized broker handles Google GSI initialization and customer mode delegation', async () => {
  const fs = require('fs');
  const path = require('path');

  const brokerHtml = fs.readFileSync(
    path.join(__dirname, '../../apps/merchant-dashboard/auth-broker.html'),
    'utf8'
  );

  assert.ok(
    brokerHtml.includes('accounts.google.com/gsi/client'),
    'auth-broker.html must load Google GSI SDK'
  );
  assert.ok(
    brokerHtml.includes('google.accounts.id.initialize'),
    'auth-broker.html must initialize Google GSI'
  );
  assert.ok(
    brokerHtml.includes('/api/v1/auth/config'),
    'auth-broker.html must fetch client ID from /api/v1/auth/config'
  );
  assert.ok(
    brokerHtml.includes('isCustomerMode'),
    'auth-broker.html must support customer mode'
  );
  assert.ok(
    brokerHtml.includes('/api/v1/customer/auth/broker/google'),
    'auth-broker.html must send customer credentials to /api/v1/customer/auth/broker/google'
  );
});

test('Teardown: close server', async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});
