/**
 * Customer Session Authorization (Organization Scope v1) Test Suite
 *
 * Tests for requireCustomerAuth() & customer session authorization boundary:
 *   CSA-01: Same Brand -> 200 ALLOW
 *   CSA-02: Different Brand, Same Organization -> 200 ALLOW (req.customer preserved)
 *   CSA-03: Different Organization -> 403 TENANT_MISMATCH
 *   CSA-04: Forged Organization in body -> ignored, strictly checks req.organization_id
 *   CSA-05: Missing session organization -> resolves from DB; allows if matches reqOrgId, otherwise fails closed
 *   CSA-06: Customer Organization mismatch in DB vs request -> 403 TENANT_MISMATCH
 *   CSA-07: Missing/nonexistent Customer in DB -> 401 CUSTOMER_NOT_FOUND
 *   CSA-08: Cross-Org Checkout (/checkout/verify & /checkout/create-order) -> 403, no order/payment
 *   CSA-09: Same-Org Cross-Brand Checkout (/checkout/create-order) -> auth passes
 */
'use strict';

process.env.NODE_ENV = 'test';
process.env.GOOGLE_CLIENT_ID = 'xentra-test-google-client-id.apps.googleusercontent.com';
process.env.JWT_SECRET = 'test-secret-customer-session-auth';

const test   = require('node:test');
const assert = require('node:assert');
const app    = require('../server/app');
const db     = require('../server/database/db');

// Request helper
async function mockFetch(path, options = {}) {
  const method  = options.method  || 'GET';
  const headers = options.headers || {};
  const body    = options.body ? JSON.parse(options.body) : null;

  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      path: path.split('?')[0],
      headers: { host: 'app.mybangjo.com', 'content-type': 'application/json', ...headers },
      query: {},
      params: {},
      body: body || {},
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

function setupFixtures() {
  const bangjoBrand = db.prepare('SELECT organization_id FROM brands WHERE id = ?').get('brand_bangjo');
  const orgBangjo = bangjoBrand ? bangjoBrand.organization_id : 'org_bangjo';

  // Ensure sister brand exists in same org
  const sisterBrandId = 'brand_csa_sister';
  db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain) VALUES (?, ?, ?, ?, ?)')
    .run(sisterBrandId, orgBangjo, 'CSA Sister Brand', 'csa-sister', 'csa-sister.mybangjo.com');

  // Ensure other organization and brand exist
  const otherOrgId = 'org_csa_other';
  const otherBrandId = 'brand_csa_other';
  db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)')
    .run(otherOrgId, 'CSA Other Org', 'csa-other-org');
  db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain) VALUES (?, ?, ?, ?, ?)')
    .run(otherBrandId, otherOrgId, 'CSA Other Brand', 'csa-other-brand', 'csa.other.test');

  // Setup branch and product for brand_bangjo
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, name, slug, description, price, is_active)
    VALUES ('csa_p1', 'brand_bangjo', 'CSA Product 1', 'csa-product-1', 'Desc', 20000, 1)`).run();
  db.prepare(`INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active, is_open_override)
    VALUES ('branch_csa_bangjo', 'brand_bangjo', 'CSA Branch Bangjo', 'csa-branch-bangjo', 'Jl. Bangjo', -7.2, 112.7, '0811111111', 1, 1)`).run();
  db.prepare(`INSERT OR REPLACE INTO branch_delivery_settings
    (id, branch_id, is_delivery_active, is_pickup_active, max_radius_km, free_delivery_km, price_per_km, min_order_amount)
    VALUES ('bds_branch_csa_bangjo', 'branch_csa_bangjo', 1, 1, 25, 5, 3000, 0)`).run();
  db.prepare(`INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available)
    VALUES ('branch_csa_bangjo', 'csa_p1', 20000, 10, 1)`).run();

  // Setup branch and product for sister brand
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, name, slug, description, price, is_active)
    VALUES ('csa_p2', 'brand_csa_sister', 'CSA Product Sister', 'csa-product-sister', 'Desc', 25000, 1)`).run();
  db.prepare(`INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active, is_open_override)
    VALUES ('branch_csa_sister', 'brand_csa_sister', 'CSA Branch Sister', 'csa-branch-sister', 'Jl. Sister', -7.2, 112.7, '0822222222', 1, 1)`).run();
  db.prepare(`INSERT OR REPLACE INTO branch_delivery_settings
    (id, branch_id, is_delivery_active, is_pickup_active, max_radius_km, free_delivery_km, price_per_km, min_order_amount)
    VALUES ('bds_branch_csa_sister', 'branch_csa_sister', 1, 1, 25, 5, 3000, 0)`).run();
  db.prepare(`INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available)
    VALUES ('branch_csa_sister', 'csa_p2', 25000, 10, 1)`).run();

  // Setup branch and product for other org brand
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, name, slug, description, price, is_active)
    VALUES ('csa_p3', 'brand_csa_other', 'CSA Product Other', 'csa-product-other', 'Desc', 30000, 1)`).run();
  db.prepare(`INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active, is_open_override)
    VALUES ('branch_csa_other', 'brand_csa_other', 'CSA Branch Other', 'csa-branch-other', 'Jl. Other', -7.2, 112.7, '0833333333', 1, 1)`).run();
  db.prepare(`INSERT OR REPLACE INTO branch_delivery_settings
    (id, branch_id, is_delivery_active, is_pickup_active, max_radius_km, free_delivery_km, price_per_km, min_order_amount)
    VALUES ('bds_branch_csa_other', 'branch_csa_other', 1, 1, 25, 5, 3000, 0)`).run();
  db.prepare(`INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available)
    VALUES ('branch_csa_other', 'csa_p3', 30000, 10, 1)`).run();

  return { orgBangjo, sisterBrandId, otherOrgId, otherBrandId };
}

// ── CSA-01: Same Brand -> 200 ALLOW ─────────────────────────────────────────
test('CSA-01: Session for Brand A accessing Brand A -> 200 ALLOW', async () => {
  const { orgBangjo } = setupFixtures();
  const custId = 'cst_csa_01';
  db.prepare('INSERT OR REPLACE INTO customers (id, organization_id, brand_id, phone, display_name, email) VALUES (?, ?, ?, ?, ?, ?)')
    .run(custId, orgBangjo, 'brand_bangjo', '081200000001', 'CSA 01 User', 'csa01@example.com');

  const sess = global.TokenSessionStore.createCustomerSession('081200000001', 'brand_bangjo', 3600, {
    customerId: custId,
    organizationId: orgBangjo
  });

  const res = await mockFetch('/api/v1/addresses', {
    method: 'GET',
    headers: {
      host: 'app.mybangjo.com',
      authorization: 'Bearer ' + sess.token
    }
  });
  const data = await res.json();
  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
  assert.strictEqual(data.success, true);
});

// ── CSA-02: Different Brand, Same Organization -> 200 ALLOW ─────────────────
test('CSA-02: Session for Brand A accessing Brand B (Same Organization) -> 200 ALLOW', async () => {
  const { orgBangjo, sisterBrandId } = setupFixtures();
  const custId = 'cst_csa_02';
  db.prepare('INSERT OR REPLACE INTO customers (id, organization_id, brand_id, phone, display_name, email) VALUES (?, ?, ?, ?, ?, ?)')
    .run(custId, orgBangjo, 'brand_bangjo', '081200000002', 'CSA 02 User', 'csa02@example.com');

  // Token created under brand_bangjo
  const sess = global.TokenSessionStore.createCustomerSession('081200000002', 'brand_bangjo', 3600, {
    customerId: custId,
    organizationId: orgBangjo
  });

  // Accessing sister brand endpoint (csa-sister.mybangjo.com)
  const res = await mockFetch('/api/v1/addresses', {
    method: 'GET',
    headers: {
      host: 'csa-sister.mybangjo.com',
      authorization: 'Bearer ' + sess.token
    }
  });
  const data = await res.json();
  assert.strictEqual(res.status, 200, `Expected 200 on sister brand, got ${res.status}: ${JSON.stringify(data)}`);
  assert.strictEqual(data.success, true);
});

// ── CSA-03: Different Organization -> 403 TENANT_MISMATCH ───────────────────
test('CSA-03: Session for Org A accessing Org B -> 403 TENANT_MISMATCH', async () => {
  const { orgBangjo } = setupFixtures();
  const custId = 'cst_csa_03';
  db.prepare('INSERT OR REPLACE INTO customers (id, organization_id, brand_id, phone, display_name, email) VALUES (?, ?, ?, ?, ?, ?)')
    .run(custId, orgBangjo, 'brand_bangjo', '081200000003', 'CSA 03 User', 'csa03@example.com');

  const sess = global.TokenSessionStore.createCustomerSession('081200000003', 'brand_bangjo', 3600, {
    customerId: custId,
    organizationId: orgBangjo
  });

  // Accessing other org brand (csa.other.test)
  const res = await mockFetch('/api/v1/addresses', {
    method: 'GET',
    headers: {
      host: 'csa.other.test',
      authorization: 'Bearer ' + sess.token
    }
  });
  const data = await res.json();
  assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(data)}`);
  assert.strictEqual(data.error, 'TENANT_MISMATCH');
});

// ── CSA-04: Forged Organization in body -> ignored ──────────────────────────
test('CSA-04: Forged organization_id in request body is ignored -> strictly uses authoritative tenant', async () => {
  const { orgBangjo, otherOrgId } = setupFixtures();
  const custId = 'cst_csa_04';
  db.prepare('INSERT OR REPLACE INTO customers (id, organization_id, brand_id, phone, display_name, email) VALUES (?, ?, ?, ?, ?, ?)')
    .run(custId, orgBangjo, 'brand_bangjo', '081200000004', 'CSA 04 User', 'csa04@example.com');

  const sess = global.TokenSessionStore.createCustomerSession('081200000004', 'brand_bangjo', 3600, {
    customerId: custId,
    organizationId: orgBangjo
  });

  // Try to claim other organization in body on a brand_bangjo request
  const res = await mockFetch('/api/v1/addresses', {
    method: 'POST',
    headers: {
      host: 'app.mybangjo.com',
      authorization: 'Bearer ' + sess.token
    },
    body: JSON.stringify({
      organization_id: otherOrgId,
      label: 'Rumah CSA 04',
      address: 'Jl. Merdeka 4',
      latitude: -7.2,
      longitude: 112.7
    })
  });
  const data = await res.json();
  assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(data)}`);
});

// ── CSA-05: Missing session organization -> resolves from DB ────────────────
test('CSA-05: Legacy session without organizationId in session object resolves from DB customer record', async () => {
  const { orgBangjo } = setupFixtures();
  const custId = 'cst_csa_05';
  db.prepare('INSERT OR REPLACE INTO customers (id, organization_id, brand_id, phone, display_name, email) VALUES (?, ?, ?, ?, ?, ?)')
    .run(custId, orgBangjo, 'brand_bangjo', '081200000005', 'CSA 05 User', 'csa05@example.com');

  // Create bare session with customerId but NO organizationId
  const token = 'xnt_cust_test_legacy_org_resolution';
  const legacySession = {
    type: 'customer',
    role: 'customer',
    customerId: custId,
    customer_id: custId,
    phone: '081200000005',
    brandId: 'brand_bangjo',
    expiresAt: Date.now() + 3600000
  };
  global.TokenSessionStore.sessions.set(token, legacySession);

  // Access brand_bangjo (host app.mybangjo.com)
  const res = await mockFetch('/api/v1/addresses', {
    method: 'GET',
    headers: {
      host: 'app.mybangjo.com',
      authorization: 'Bearer ' + token
    }
  });
  const data = await res.json();
  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
  assert.strictEqual(legacySession.organization_id, orgBangjo, 'Should hydrate organization_id into session');
});

// ── CSA-06: Customer Organization mismatch in DB vs request -> 403 ──────────
test('CSA-06: Session customer belongs to different organization in DB -> 403 TENANT_MISMATCH', async () => {
  const { otherOrgId } = setupFixtures();
  const custId = 'cst_csa_06';
  // Customer belongs to otherOrgId in the DB
  db.prepare('INSERT OR REPLACE INTO customers (id, organization_id, brand_id, phone, display_name, email) VALUES (?, ?, ?, ?, ?, ?)')
    .run(custId, otherOrgId, 'brand_csa_other', '081200000006', 'CSA 06 User', 'csa06@example.com');

  const token = 'xnt_cust_test_mismatch_db';
  const session = {
    type: 'customer',
    role: 'customer',
    customerId: custId,
    customer_id: custId,
    organization_id: otherOrgId,
    phone: '081200000006',
    brandId: 'brand_bangjo',
    expiresAt: Date.now() + 3600000
  };
  global.TokenSessionStore.sessions.set(token, session);

  // Access brand_bangjo (orgBangjo)
  const res = await mockFetch('/api/v1/addresses', {
    method: 'GET',
    headers: {
      host: 'app.mybangjo.com',
      authorization: 'Bearer ' + token
    }
  });
  const data = await res.json();
  assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(data)}`);
  assert.strictEqual(data.error, 'TENANT_MISMATCH');
});

// ── CSA-07: Missing/nonexistent Customer in DB -> 401 CUSTOMER_NOT_FOUND ────
test('CSA-07: Nonexistent customer in DB -> 401 CUSTOMER_NOT_FOUND', async () => {
  const token = 'xnt_cust_test_missing_db_cust';
  const session = {
    type: 'customer',
    role: 'customer',
    customerId: 'cst_nonexistent_999999',
    customer_id: 'cst_nonexistent_999999',
    organization_id: 'org_bangjo',
    phone: '081299999999',
    brandId: 'brand_bangjo',
    expiresAt: Date.now() + 3600000
  };
  global.TokenSessionStore.sessions.set(token, session);

  const res = await mockFetch('/api/v1/addresses', {
    method: 'GET',
    headers: {
      host: 'app.mybangjo.com',
      authorization: 'Bearer ' + token
    }
  });
  const data = await res.json();
  assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}: ${JSON.stringify(data)}`);
  assert.strictEqual(data.error, 'CUSTOMER_NOT_FOUND');
});

// ── CSA-08: Cross-Org Checkout -> 403, no order/payment ────────────────────
test('CSA-08: Cross-Organization checkout (/checkout/create-order) -> 403 TENANT_MISMATCH', async () => {
  const { otherOrgId, otherBrandId } = setupFixtures();
  const custId = 'cst_csa_08';
  db.prepare('INSERT OR REPLACE INTO customers (id, organization_id, brand_id, phone, display_name, email) VALUES (?, ?, ?, ?, ?, ?)')
    .run(custId, otherOrgId, otherBrandId, '081200000008', 'CSA 08 User', 'csa08@example.com');

  // Token created under otherBrandId
  const sess = global.TokenSessionStore.createCustomerSession('081200000008', otherBrandId, 3600, {
    customerId: custId,
    organizationId: otherOrgId
  });

  // Attempt checkout on brand_bangjo using token from otherOrgId
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: {
      host: 'app.mybangjo.com',
      authorization: 'Bearer ' + sess.token
    },
    body: JSON.stringify({
      branch_id: 'branch_csa_bangjo',
      payment_method: 'cash',
      customer: { name: 'CSA 08 User', phone: '081200000008' },
      order_type: 'pickup',
      items: [{ id: 'csa_p1', quantity: 1 }]
    })
  });
  const data = await res.json();
  assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(data)}`);
  assert.strictEqual(data.error, 'TENANT_MISMATCH');
});

// ── CSA-09: Same-Org Cross-Brand Checkout -> Auth passes ───────────────────
test('CSA-09: Same-Organization Cross-Brand checkout (/checkout/create-order) -> auth passes', async () => {
  const { orgBangjo, sisterBrandId } = setupFixtures();
  const custId = 'cst_csa_09';
  db.prepare('INSERT OR REPLACE INTO customers (id, organization_id, brand_id, phone, display_name, email) VALUES (?, ?, ?, ?, ?, ?)')
    .run(custId, orgBangjo, 'brand_bangjo', '081200000009', 'CSA 09 User', 'csa09@example.com');

  // Session issued under brand_bangjo
  const sess = global.TokenSessionStore.createCustomerSession('081200000009', 'brand_bangjo', 3600, {
    customerId: custId,
    organizationId: orgBangjo
  });

  // Attempt checkout on sister brand (same organization)
  const res = await mockFetch('/api/v1/checkout/create-order', {
    method: 'POST',
    headers: {
      host: 'csa-sister.mybangjo.com',
      authorization: 'Bearer ' + sess.token
    },
    body: JSON.stringify({
      branch_id: 'branch_csa_sister',
      payment_method: 'cash',
      customer: { name: 'CSA 09 User', phone: '081200000009' },
      order_type: 'pickup',
      items: [{ id: 'csa_p2', quantity: 1 }]
    })
  });
  const data = await res.json();
  // Must NOT fail with 401 or 403 auth errors
  assert.notStrictEqual(res.status, 401, `Should not be 401: ${JSON.stringify(data)}`);
  assert.notStrictEqual(res.status, 403, `Should not be 403 TENANT_MISMATCH: ${JSON.stringify(data)}`);
  assert.ok(res.status === 200 || res.status === 201, `Expected 200 or 201, got ${res.status}: ${JSON.stringify(data)}`);
  assert.strictEqual(data.success, true);
  assert.ok(data.order_id || (data.order && data.order.id), 'Order should be created successfully');
});

// ── CSA-10: Brand A Address Does NOT Appear in Brand B (Commerce Isolation) ─
test('CSA-10: Brand A address is not returned when querying Brand B (Commerce Scope Isolation)', async () => {
  const { orgBangjo, sisterBrandId } = setupFixtures();
  const custId = 'cst_csa_10';
  db.prepare('INSERT OR REPLACE INTO customers (id, organization_id, brand_id, phone, display_name, email) VALUES (?, ?, ?, ?, ?, ?)')
    .run(custId, orgBangjo, 'brand_bangjo', '081200000010', 'CSA 10 User', 'csa10@example.com');

  const sess = global.TokenSessionStore.createCustomerSession('081200000010', 'brand_bangjo', 3600, {
    customerId: custId,
    organizationId: orgBangjo
  });

  // Create address in Brand A (app.mybangjo.com)
  const addRes = await mockFetch('/api/v1/addresses', {
    method: 'POST',
    headers: {
      host: 'app.mybangjo.com',
      authorization: 'Bearer ' + sess.token
    },
    body: JSON.stringify({
      label: 'Kantor Bangjo',
      address: 'Jl. Pemuda No 10',
      latitude: -7.26,
      longitude: 112.74
    })
  });
  assert.strictEqual(addRes.status, 201);

  // Query addresses under Brand A -> 1 address found
  const listBrandA = await mockFetch('/api/v1/addresses', {
    method: 'GET',
    headers: {
      host: 'app.mybangjo.com',
      authorization: 'Bearer ' + sess.token
    }
  });
  const dataA = await listBrandA.json();
  assert.strictEqual(listBrandA.status, 200);
  assert.strictEqual(dataA.addresses.length, 1);
  assert.strictEqual(dataA.addresses[0].label, 'Kantor Bangjo');

  // Query addresses under Brand B (csa-sister.mybangjo.com) with the SAME session
  // Authentication succeeds because same organization, but address array must be empty!
  const listBrandB = await mockFetch('/api/v1/addresses', {
    method: 'GET',
    headers: {
      host: 'csa-sister.mybangjo.com',
      authorization: 'Bearer ' + sess.token
    }
  });
  const dataB = await listBrandB.json();
  assert.strictEqual(listBrandB.status, 200);
  assert.strictEqual(dataB.addresses.length, 0, 'Addresses from Brand A must not leak to Brand B');
});

// ── CSA-11: customer_id cannot be forged via request body ───────────────────
test('CSA-11: Forged customer_id in request body cannot override session customer identity', async () => {
  const { orgBangjo } = setupFixtures();
  const legitimateCustId = 'cst_csa_11_legit';
  const victimCustId = 'cst_csa_11_victim';

  db.prepare('INSERT OR REPLACE INTO customers (id, organization_id, brand_id, phone, display_name, email) VALUES (?, ?, ?, ?, ?, ?)')
    .run(legitimateCustId, orgBangjo, 'brand_bangjo', '081200000011', 'Legit User', 'legit@example.com');
  db.prepare('INSERT OR REPLACE INTO customers (id, organization_id, brand_id, phone, display_name, email) VALUES (?, ?, ?, ?, ?, ?)')
    .run(victimCustId, orgBangjo, 'brand_bangjo', '081200000099', 'Victim User', 'victim@example.com');

  const sess = global.TokenSessionStore.createCustomerSession('081200000011', 'brand_bangjo', 3600, {
    customerId: legitimateCustId,
    organizationId: orgBangjo
  });

  // Try creating an address trying to forge customer_id to victimCustId in the payload
  const createRes = await mockFetch('/api/v1/addresses', {
    method: 'POST',
    headers: {
      host: 'app.mybangjo.com',
      authorization: 'Bearer ' + sess.token
    },
    body: JSON.stringify({
      customer_id: victimCustId,
      customerId: victimCustId,
      label: 'Forged Address',
      address: 'Jl. Palsu No 1',
      latitude: -7.2,
      longitude: 112.7
    })
  });
  const createData = await createRes.json();
  assert.strictEqual(createRes.status, 201);
  assert.strictEqual(createData.address.customer_id, legitimateCustId, 'Address must belong to authenticated customer, not forged ID');

  // Verify in DB directly
  const dbRow = db.prepare('SELECT customer_id FROM customer_addresses WHERE id = ?').get(createData.address.id);
  assert.strictEqual(dbRow.customer_id, legitimateCustId);
});

// ── CSA-12: Order history is isolated by customer_id and not accessible by another customer ──
test('CSA-12: Order history is strictly isolated between different customers', async () => {
  const { orgBangjo } = setupFixtures();
  const custA = 'cst_csa_12_a';
  const custB = 'cst_csa_12_b';

  db.prepare('INSERT OR REPLACE INTO customers (id, organization_id, brand_id, phone, display_name, email) VALUES (?, ?, ?, ?, ?, ?)')
    .run(custA, orgBangjo, 'brand_bangjo', '081200000021', 'Customer A', 'custA@example.com');
  db.prepare('INSERT OR REPLACE INTO customers (id, organization_id, brand_id, phone, display_name, email) VALUES (?, ?, ?, ?, ?, ?)')
    .run(custB, orgBangjo, 'brand_bangjo', '081200000022', 'Customer B', 'custB@example.com');

  const sessA = global.TokenSessionStore.createCustomerSession('081200000021', 'brand_bangjo', 3600, {
    customerId: custA,
    organizationId: orgBangjo
  });
  const sessB = global.TokenSessionStore.createCustomerSession('081200000022', 'brand_bangjo', 3600, {
    customerId: custB,
    organizationId: orgBangjo
  });

  // Seed an order for Customer A
  const ordA = 'ord_csa_12_a';
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_id, customer_phone, customer_name, order_type, subtotal, delivery_fee, discount_amount, grand_total, payment_method, status, created_at, updated_at)
    VALUES (?, ?, 'brand_bangjo', 'branch_csa_bangjo', ?, '081200000021', 'Customer A', 'pickup', 20000, 0, 0, 20000, 'cash', 'completed', datetime('now'), datetime('now'))
  `).run(ordA, 'ORD-CSA-12-A', custA);

  // Customer A queries /customer/orders -> sees ordA
  const resA = await mockFetch('/api/v1/customer/orders', {
    method: 'GET',
    headers: {
      host: 'app.mybangjo.com',
      authorization: 'Bearer ' + sessA.token
    }
  });
  const dataA = await resA.json();
  assert.strictEqual(resA.status, 200);
  assert.ok(dataA.orders.some(o => o.id === ordA));

  // Customer B queries /customer/orders -> does NOT see ordA
  const resB = await mockFetch('/api/v1/customer/orders', {
    method: 'GET',
    headers: {
      host: 'app.mybangjo.com',
      authorization: 'Bearer ' + sessB.token
    }
  });
  const dataB = await resB.json();
  assert.strictEqual(resB.status, 200);
  assert.ok(!dataB.orders.some(o => o.id === ordA), 'Customer B must never see Customer A order');
});
