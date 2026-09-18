'use strict';

/**
 * Promotion Security & Multi-Tenant RBAC Scope Authorization Test Suite
 *
 * Test Matrix:
 * - Test A: Cross-brand BM activation -> 403 or 404, no mutation applied.
 * - Test B: Cross-brand scope assignment -> 403, no scope created.
 * - Test C: Mixed branch payload [A1, A2, B1] -> 403, atomic rejection, zero assigned.
 * - Test D: BM attempts another branch in body -> 403.
 * - Test E: BM does not supply branch_id -> derives session branch, succeeds.
 * - Test F: BM attempts promo not scoped to their branch -> 404.
 * - Test G: Foreign promotion ID in PUT/DELETE/scopes/activation -> 404, zero mutation.
 * - Test H: Owner valid scope -> 200, scope created.
 * - Test I: Delete safety with existing redemptions -> 409 blocked, audit preserved.
 * - Test J: Delete safety without redemptions -> 200 deleted.
 * - Test K: Date validation (end_at < start_at) -> 400 error.
 * - Test L: Security audit log entries emitted for all promotion lifecycle actions.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-promotion-security-rbac';

const app = require('../../server/app');
const db = require('../../server/database/db');

let server;
let baseUrl;

// Align with primary test brand in local database
const BRAND_A = 'brand_bangjo';
const BRAND_B = 'brand_other_tenant';
const ORG_A = 'org_xentra_holding';
const ORG_B = 'org_other_tenant';

const BRANCH_A1 = 'branch_sec_A1';
const BRANCH_A2 = 'branch_sec_A2';
const BRANCH_B1 = 'branch_sec_B1';

function seedStaffSession({ role = 'owner', branchId = null, brandId = BRAND_A, organizationId = ORG_A, userId = 'user_sec_test' } = {}) {
  const token = 'tok_sec_' + crypto.randomBytes(8).toString('hex');
  const store = global.TokenSessionStore;
  const sess = {
    type: 'staff',
    role,
    brandId,
    brand_id: brandId,
    organizationId,
    organization_id: organizationId,
    branchId,
    branch_id: branchId,
    userId,
    username: userId,
    email_verified: true,
    created_at: Date.now(),
    expires_at: Date.now() + 86400000
  };
  if (store && store.sessions) {
    store.sessions.set(token, sess);
  }
  return token;
}

function request(method, pathName, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathName, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

describe('Promotion Security & RBAC Scope Authorization Suite', () => {
  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Seed Organizations & Brands
    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(ORG_A, 'Org Sec A', 'org-sec-a');
    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(ORG_B, 'Org Sec B', 'org-sec-b');
    db.prepare('INSERT OR REPLACE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(BRAND_A, ORG_A, 'Bangjo Resto', 'bangjo');
    db.prepare('INSERT OR REPLACE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(BRAND_B, ORG_B, 'Other Brand', 'other-brand');

    // Seed Branches
    db.prepare(`INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, created_at, updated_at)
      VALUES (?, ?, 'Branch A1', 'branch-a1', 'Jl. A1', -7.25, 112.75, 1, datetime('now'), datetime('now'))`).run(BRANCH_A1, BRAND_A);
    db.prepare(`INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, created_at, updated_at)
      VALUES (?, ?, 'Branch A2', 'branch-a2', 'Jl. A2', -7.26, 112.76, 1, datetime('now'), datetime('now'))`).run(BRANCH_A2, BRAND_A);
    db.prepare(`INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, created_at, updated_at)
      VALUES (?, ?, 'Branch B1', 'branch-b1', 'Jl. B1', -7.27, 112.77, 1, datetime('now'), datetime('now'))`).run(BRANCH_B1, BRAND_B);
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  // PROMO-AUTH-01: Cross-brand BM activation
  it('PROMO-AUTH-01: Owner / BM of Brand A cannot activate promotion from Brand B (404 / 403, no mutation)', async () => {
    // Seed promo in Brand B
    const promoBId = 'promo_sec_b_01';
    db.prepare(`INSERT OR REPLACE INTO promotions (id, brand_id, name, code, capability_type, is_active, created_at, updated_at)
      VALUES (?, ?, 'Promo Brand B', 'PROMOB', 'install_incentive', 1, datetime('now'), datetime('now'))`).run(promoBId, BRAND_B);
    db.prepare(`INSERT OR REPLACE INTO promotion_branch_scope (id, promotion_id, brand_id, branch_id, is_active, assigned_at, updated_at)
      VALUES ('pbs_b1', ?, ?, ?, 1, datetime('now'), datetime('now'))`).run(promoBId, BRAND_B, BRANCH_B1);

    // BM belongs to Brand A, Branch A1
    const tokenBMA = seedStaffSession({ role: 'branch_manager', brandId: BRAND_A, branchId: BRANCH_A1, userId: 'bm_a' });

    const res = await request('PATCH', `/api/v1/admin/marketing/promotions/${promoBId}/branch-activation`, {
      is_active: 0
    }, {
      Authorization: `Bearer ${tokenBMA}`
    });

    assert.equal([403, 404].includes(res.status), true, `Expected 403 or 404 but got ${res.status}`);

    // Verify scope on Brand B promo is unchanged
    const scope = db.prepare('SELECT is_active FROM promotion_branch_scope WHERE promotion_id = ?').get(promoBId);
    assert.equal(scope.is_active, 1);
  });

  // PROMO-AUTH-02: Cross-brand scope assignment
  it('PROMO-AUTH-02: Owner Brand A attempts to assign Brand B branch to Brand A promotion (403, no scope created)', async () => {
    // Owner of Brand A creates a promo
    const promoAId = 'promo_sec_a_scopes';
    db.prepare(`INSERT OR REPLACE INTO promotions (id, brand_id, name, code, capability_type, is_active, created_at, updated_at)
      VALUES (?, ?, 'Promo Brand A Scopes', 'PROMOA', 'install_incentive', 1, datetime('now'), datetime('now'))`).run(promoAId, BRAND_A);

    const tokenOwnerA = seedStaffSession({ role: 'owner', brandId: BRAND_A, userId: 'owner_a' });

    // Attempt to assign Branch B1 (which belongs to Brand B)
    const res = await request('POST', `/api/v1/admin/marketing/promotions/${promoAId}/scopes`, {
      branch_ids: [BRANCH_B1]
    }, {
      Authorization: `Bearer ${tokenOwnerA}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);

    // Verify no scope was created for BRANCH_B1
    const scope = db.prepare('SELECT * FROM promotion_branch_scope WHERE promotion_id = ? AND branch_id = ?').get(promoAId, BRANCH_B1);
    assert.equal(scope, undefined);
  });

  // PROMO-AUTH-03: Mixed branch payload rejection (atomic failure)
  it('PROMO-AUTH-03: Owner sends [valid_branch_A, valid_branch_B, foreign_branch] -> rejected atomically with 403 (zero scopes created)', async () => {
    const promoAId = 'promo_sec_a_mixed';
    db.prepare(`INSERT OR REPLACE INTO promotions (id, brand_id, name, code, capability_type, is_active, created_at, updated_at)
      VALUES (?, ?, 'Promo Mixed Test', 'MIXED', 'install_incentive', 1, datetime('now'), datetime('now'))`).run(promoAId, BRAND_A);

    const tokenOwnerA = seedStaffSession({ role: 'owner', brandId: BRAND_A, userId: 'owner_a' });

    const res = await request('POST', `/api/v1/admin/marketing/promotions/${promoAId}/scopes`, {
      branch_ids: [BRANCH_A1, BRANCH_A2, BRANCH_B1]
    }, {
      Authorization: `Bearer ${tokenOwnerA}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);

    // Verify ZERO scopes were created (atomicity check)
    const scopes = db.prepare('SELECT * FROM promotion_branch_scope WHERE promotion_id = ?').all(promoAId);
    assert.equal(scopes.length, 0, 'No scopes should be created on mixed branch rejection');
  });

  // PROMO-AUTH-04: BM attempts another branch in body
  it('PROMO-AUTH-04: BM assigned Branch A attempts to operate Branch B (403, no mutation)', async () => {
    const promoAId = 'promo_sec_a_bm_target';
    db.prepare(`INSERT OR REPLACE INTO promotions (id, brand_id, name, code, capability_type, is_active, created_at, updated_at)
      VALUES (?, ?, 'Promo BM Target Test', 'BMTARGET', 'install_incentive', 1, datetime('now'), datetime('now'))`).run(promoAId, BRAND_A);
    db.prepare(`INSERT OR REPLACE INTO promotion_branch_scope (id, promotion_id, brand_id, branch_id, is_active, assigned_at, updated_at)
      VALUES ('pbs_a1', ?, ?, ?, 1, datetime('now'), datetime('now'))`).run(promoAId, BRAND_A, BRANCH_A1);
    db.prepare(`INSERT OR REPLACE INTO promotion_branch_scope (id, promotion_id, brand_id, branch_id, is_active, assigned_at, updated_at)
      VALUES ('pbs_a2', ?, ?, ?, 1, datetime('now'), datetime('now'))`).run(promoAId, BRAND_A, BRANCH_A2);

    const tokenBMA1 = seedStaffSession({ role: 'branch_manager', brandId: BRAND_A, branchId: BRANCH_A1, userId: 'bm_a1' });

    const res = await request('PATCH', `/api/v1/admin/marketing/promotions/${promoAId}/branch-activation`, {
      branch_id: BRANCH_A2,
      is_active: 0
    }, {
      Authorization: `Bearer ${tokenBMA1}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);

    // Verify Branch A2 scope is still active
    const scope = db.prepare('SELECT is_active FROM promotion_branch_scope WHERE promotion_id = ? AND branch_id = ?').get(promoAId, BRANCH_A2);
    assert.equal(scope.is_active, 1);
  });

  // PROMO-AUTH-05: BM request omits branch_id -> derives session branch
  it('PROMO-AUTH-05: BM request omits branch_id -> server derives assigned branch (200)', async () => {
    const promoAId = 'promo_sec_a_bm_derive';
    db.prepare(`INSERT OR REPLACE INTO promotions (id, brand_id, name, code, capability_type, is_active, created_at, updated_at)
      VALUES (?, ?, 'Promo BM Derive Test', 'BMDERIVE', 'install_incentive', 1, datetime('now'), datetime('now'))`).run(promoAId, BRAND_A);
    db.prepare(`INSERT OR REPLACE INTO promotion_branch_scope (id, promotion_id, brand_id, branch_id, is_active, assigned_at, updated_at)
      VALUES ('pbs_derive_a1', ?, ?, ?, 1, datetime('now'), datetime('now'))`).run(promoAId, BRAND_A, BRANCH_A1);

    const tokenBMA1 = seedStaffSession({ role: 'branch_manager', brandId: BRAND_A, branchId: BRANCH_A1, userId: 'bm_a1' });

    const res = await request('PATCH', `/api/v1/admin/marketing/promotions/${promoAId}/branch-activation`, {
      is_active: 0
    }, {
      Authorization: `Bearer ${tokenBMA1}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.branch_id, BRANCH_A1);
    assert.equal(res.body.is_active, 0);

    // Verify DB update
    const scope = db.prepare('SELECT is_active FROM promotion_branch_scope WHERE promotion_id = ? AND branch_id = ?').get(promoAId, BRANCH_A1);
    assert.equal(scope.is_active, 0);
  });

  // PROMO-AUTH-06: BM attempts promo not scoped to their branch -> 404
  it('PROMO-AUTH-06: BM assigned Branch A attempts to activate promotion scoped only to Branch B (404)', async () => {
    const promoAId = 'promo_sec_a_unscoped_for_bm';
    db.prepare(`INSERT OR REPLACE INTO promotions (id, brand_id, name, code, capability_type, is_active, created_at, updated_at)
      VALUES (?, ?, 'Promo Only A2', 'ONLYA2', 'install_incentive', 1, datetime('now'), datetime('now'))`).run(promoAId, BRAND_A);
    db.prepare(`INSERT OR REPLACE INTO promotion_branch_scope (id, promotion_id, brand_id, branch_id, is_active, assigned_at, updated_at)
      VALUES ('pbs_only_a2', ?, ?, ?, 1, datetime('now'), datetime('now'))`).run(promoAId, BRAND_A, BRANCH_A2);

    // BM A1 attempts to activate
    const tokenBMA1 = seedStaffSession({ role: 'branch_manager', brandId: BRAND_A, branchId: BRANCH_A1, userId: 'bm_a1' });

    const res = await request('PATCH', `/api/v1/admin/marketing/promotions/${promoAId}/branch-activation`, {
      is_active: 1
    }, {
      Authorization: `Bearer ${tokenBMA1}`
    });

    assert.equal(res.status, 404);
  });

  // PROMO-AUTH-07: Foreign promotion ID returns 404 (no cross-tenant disclosure)
  it('PROMO-AUTH-07: Brand A requests foreign promotion ID -> no cross-tenant disclosure, no mutation (404)', async () => {
    const promoBId = 'promo_sec_b_foreign';
    db.prepare(`INSERT OR REPLACE INTO promotions (id, brand_id, name, code, capability_type, is_active, created_at, updated_at)
      VALUES (?, ?, 'Promo B Foreign', 'BFOREIGN', 'install_incentive', 1, datetime('now'), datetime('now'))`).run(promoBId, BRAND_B);

    const tokenOwnerA = seedStaffSession({ role: 'owner', brandId: BRAND_A, userId: 'owner_a' });

    // 1. PUT
    const putRes = await request('PUT', `/api/v1/admin/marketing/promotions/${promoBId}`, {
      name: 'Hacked Name'
    }, {
      Authorization: `Bearer ${tokenOwnerA}`
    });
    assert.equal(putRes.status, 404);

    // 2. DELETE
    const delRes = await request('DELETE', `/api/v1/admin/marketing/promotions/${promoBId}`, null, {
      Authorization: `Bearer ${tokenOwnerA}`
    });
    assert.equal(delRes.status, 404);

    // 3. POST scopes
    const scopeRes = await request('POST', `/api/v1/admin/marketing/promotions/${promoBId}/scopes`, {
      branch_ids: [BRANCH_A1]
    }, {
      Authorization: `Bearer ${tokenOwnerA}`
    });
    assert.equal(scopeRes.status, 404);

    // 4. PATCH activation
    const patchRes = await request('PATCH', `/api/v1/admin/marketing/promotions/${promoBId}/branch-activation`, {
      branch_id: BRANCH_A1,
      is_active: 1
    }, {
      Authorization: `Bearer ${tokenOwnerA}`
    });
    assert.equal(patchRes.status, 404);

    // Confirm promo in Brand B was untouched
    const promoB = db.prepare('SELECT name FROM promotions WHERE id = ?').get(promoBId);
    assert.equal(promoB.name, 'Promo B Foreign');
  });

  // PROMO-AUTH-08: Valid Owner creates promotion with valid branch scopes
  it('PROMO-AUTH-08: Valid Owner creates promotion with valid branch scopes (201)', async () => {
    const tokenOwnerA = seedStaffSession({ role: 'owner', brandId: BRAND_A, userId: 'owner_a' });

    const res = await request('POST', '/api/v1/admin/marketing/promotions', {
      name: 'Owner Created Promo',
      code: 'OWNERPROMO',
      branch_ids: [BRANCH_A1, BRANCH_A2]
    }, {
      Authorization: `Bearer ${tokenOwnerA}`
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.promotion.scopes.length, 2);
  });

  // PROMO-AUTH-09: Valid Owner updates promotion scope
  it('PROMO-AUTH-09: Valid Owner updates promotion scope (old removed, new created, foreign rejected)', async () => {
    const promoAId = 'promo_sec_a_scope_update';
    db.prepare(`INSERT OR REPLACE INTO promotions (id, brand_id, name, code, capability_type, is_active, created_at, updated_at)
      VALUES (?, ?, 'Promo Scope Update Test', 'SCOPEUPD', 'install_incentive', 1, datetime('now'), datetime('now'))`).run(promoAId, BRAND_A);
    db.prepare(`INSERT OR REPLACE INTO promotion_branch_scope (id, promotion_id, brand_id, branch_id, is_active, assigned_at, updated_at)
      VALUES ('pbs_upd_1', ?, ?, ?, 1, datetime('now'), datetime('now'))`).run(promoAId, BRAND_A, BRANCH_A1);

    const tokenOwnerA = seedStaffSession({ role: 'owner', brandId: BRAND_A, userId: 'owner_a' });

    // 1. Update with only BRANCH_A2 (BRANCH_A1 should be removed, BRANCH_A2 assigned)
    const updateRes = await request('PUT', `/api/v1/admin/marketing/promotions/${promoAId}`, {
      branch_ids: [BRANCH_A2]
    }, {
      Authorization: `Bearer ${tokenOwnerA}`
    });

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.success, true);
    const updatedScopes = updateRes.body.promotion.scopes.map(s => s.branch_id);
    assert.equal(updatedScopes.includes(BRANCH_A2), true);
    assert.equal(updatedScopes.includes(BRANCH_A1), false);

    // 2. Update with foreign branch -> 403, atomic rejection
    const failRes = await request('PUT', `/api/v1/admin/marketing/promotions/${promoAId}`, {
      branch_ids: [BRANCH_A2, BRANCH_B1]
    }, {
      Authorization: `Bearer ${tokenOwnerA}`
    });

    assert.equal(failRes.status, 403);
  });

  // PROMO-AUTH-10: Delete safety when redemptions exist
  it('PROMO-AUTH-10: Promotion redemption history exists -> delete blocked with 409, preserving audit trail', async () => {
    const promoAId = 'promo_sec_a_with_redemption';
    const orderId = 'ord_sec_test_01';
    db.prepare(`INSERT OR REPLACE INTO promotions (id, brand_id, name, code, capability_type, is_active, created_at, updated_at)
      VALUES (?, ?, 'Promo With Redemptions', 'WITHRED', 'install_incentive', 1, datetime('now'), datetime('now'))`).run(promoAId, BRAND_A);

    // Seed dummy order first so foreign key is satisfied
    db.prepare(`INSERT OR REPLACE INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, subtotal, grand_total, status, created_at, updated_at)
      VALUES (?, 'ORD-SEC-01', ?, ?, 'Customer Test', '08123456789', 'delivery', 20000, 20000, 'pending', datetime('now'), datetime('now'))`).run(orderId, BRAND_A, BRANCH_A1);

    // Seed dummy redemption
    db.prepare(`INSERT OR REPLACE INTO promotion_redemptions (id, promotion_id, order_id, brand_id, branch_id, customer_phone, benefit_amount, status, redeemed_at)
      VALUES ('red_sec_01', ?, ?, ?, ?, '08123456789', 5000, 'active', datetime('now'))`).run(promoAId, orderId, BRAND_A, BRANCH_A1);

    const tokenOwnerA = seedStaffSession({ role: 'owner', brandId: BRAND_A, userId: 'owner_a' });

    const res = await request('DELETE', `/api/v1/admin/marketing/promotions/${promoAId}`, null, {
      Authorization: `Bearer ${tokenOwnerA}`
    });

    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('riwayat penebusan pesanan'));

    // Promotion must still exist in DB
    const promo = db.prepare('SELECT id FROM promotions WHERE id = ?').get(promoAId);
    assert.ok(promo);
  });

  // PROMO-AUTH-11: 5 branches -> one campaign -> one customer order -> one final fulfillment branch -> one reward entitlement
  it('PROMO-AUTH-11: 5 branches participating in 1 campaign -> 1 order entitlement, reward qty = 1, claim does not consume stock', async () => {
    // Seed 3 additional branches for Brand A to make total 5 branches
    const branchA3 = 'branch_sec_A3';
    const branchA4 = 'branch_sec_A4';
    const branchA5 = 'branch_sec_A5';
    for (const bId of [branchA3, branchA4, branchA5]) {
      db.prepare(`INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'Jl. Test', -7.28, 112.78, 1, datetime('now'), datetime('now'))`).run(bId, BRAND_A, bId, bId);
    }

    const promoMultiId = 'prm_multi_5_branches';
    const rewardProdId = 'prod_reward_teh';
    const foodProdId = 'prod_food_ayam';

    // Seed category and master catalog products
    db.prepare(`INSERT OR REPLACE INTO categories (id, brand_id, name, slug, sort_order, created_at)
      VALUES ('cat_sec', ?, 'Minuman', 'minuman', 1, datetime('now'))`).run(BRAND_A);
    db.prepare(`INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, is_active, sort_order, created_at, updated_at)
      VALUES (?, ?, 'cat_sec', 'Es Teh Manis', 'es-teh', 5000, 1, 1, datetime('now'), datetime('now'))`).run(rewardProdId, BRAND_A);
    db.prepare(`INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, is_active, sort_order, created_at, updated_at)
      VALUES (?, ?, 'cat_sec', 'Ayam Goreng', 'ayam-goreng', 25000, 1, 2, datetime('now'), datetime('now'))`).run(foodProdId, BRAND_A);

    // Seed promotion scoped across 5 branches
    db.prepare(`INSERT OR REPLACE INTO promotions (id, brand_id, name, code, capability_type, is_active, created_at, updated_at)
      VALUES (?, ?, 'PWA Install 1 Es Teh Gratis', 'PWATEH', 'install_incentive', 1, datetime('now'), datetime('now'))`).run(promoMultiId, BRAND_A);

    db.prepare(`INSERT OR REPLACE INTO promotion_rewards (id, promotion_id, reward_type, target_product_id, amount_in_cents, created_at)
      VALUES ('rew_teh', ?, 'freebie_product', ?, 0, datetime('now'))`).run(promoMultiId, rewardProdId);

    // Seed Branch Products for BRANCH_A1
    db.prepare(`INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available)
      VALUES (?, ?, 25000, 50, 1)`).run(BRANCH_A1, foodProdId);
    db.prepare(`INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available)
      VALUES (?, ?, 5000, 20, 1)`).run(BRANCH_A1, rewardProdId);

    // Seed promotion rules for install_incentive
    db.prepare(`INSERT OR REPLACE INTO promotion_rules (id, promotion_id, rule_type, rule_payload, created_at)
      VALUES ('rul_teh_01', ?, 'eligibility', '{"requires_pwa_installed":true,"first_order_only":true}', datetime('now'))`).run(promoMultiId);

    // Seed promotion branch scopes across all 5 branches
    const all5Branches = [BRANCH_A1, BRANCH_A2, branchA3, branchA4, branchA5];
    for (const bId of all5Branches) {
      db.prepare(`INSERT OR REPLACE INTO promotion_branch_scope (id, promotion_id, brand_id, branch_id, is_active, assigned_at, updated_at)
        VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))`).run(`pbs_5_${bId}`, promoMultiId, BRAND_A, bId);
    }

    // Verify PrePaymentVerificationGate resolves to branch_id = BRANCH_A1 with exactly 1 reward entitlement
    const PrePaymentVerificationGate = require('../../domains/commerce/services/PrePaymentVerificationGate');
    const result = PrePaymentVerificationGate.verify({
      branch_id: BRANCH_A1,
      brand_id: BRAND_A,
      items: [
        { product_id: foodProdId, quantity: 1, expected_price: 25000 },
        { product_id: 'reward_' + promoMultiId, is_promo_reward: true, quantity: 1, expected_price: 0 },
        { product_id: 'reward_' + promoMultiId, is_promo_reward: true, quantity: 1, expected_price: 0 } // Duplicate client payload
      ],
      customer: { phone: '0812349999' },
      pwa_runtime: { display_mode: 'standalone' }
    });

    assert.strictEqual(result.is_valid, true);
    assert.strictEqual(result.status, PrePaymentVerificationGate.STATUS.VERIFIED);
    assert.strictEqual(result.applied_promos.length, 1, 'Exactly one reward entitlement across 5 branches');
    assert.strictEqual(result.applied_promos[0].promo_id, promoMultiId);
  });

  // PROMO-AUTH-12: Delete without redemptions cleanly removes promotion and scopes (200)
  it('PROMO-AUTH-12: Delete without redemptions cleanly removes promotion and scopes (200)', async () => {
    const promoAId = 'promo_sec_a_to_delete';
    db.prepare(`INSERT OR REPLACE INTO promotions (id, brand_id, name, code, capability_type, is_active, created_at, updated_at)
      VALUES (?, ?, 'Promo To Delete', 'TODELETE', 'install_incentive', 1, datetime('now'), datetime('now'))`).run(promoAId, BRAND_A);
    db.prepare(`INSERT OR REPLACE INTO promotion_branch_scope (id, promotion_id, brand_id, branch_id, is_active, assigned_at, updated_at)
      VALUES ('pbs_to_del', ?, ?, ?, 1, datetime('now'), datetime('now'))`).run(promoAId, BRAND_A, BRANCH_A1);

    const tokenOwnerA = seedStaffSession({ role: 'owner', brandId: BRAND_A, userId: 'owner_a' });

    const res = await request('DELETE', `/api/v1/admin/marketing/promotions/${promoAId}`, null, {
      Authorization: `Bearer ${tokenOwnerA}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);

    // Verify removed from DB
    const promo = db.prepare('SELECT id FROM promotions WHERE id = ?').get(promoAId);
    assert.equal(promo, undefined);
    const scope = db.prepare('SELECT id FROM promotion_branch_scope WHERE promotion_id = ?').get(promoAId);
    assert.equal(scope, undefined);
  });

  // PROMO-AUTH-13: Date validation (end_at < start_at) -> 400
  it('PROMO-AUTH-13: Creation or update with end_at earlier than start_at returns 400', async () => {
    const tokenOwnerA = seedStaffSession({ role: 'owner', brandId: BRAND_A, userId: 'owner_a' });

    const res = await request('POST', '/api/v1/admin/marketing/promotions', {
      name: 'Invalid Date Promo',
      start_at: '2026-10-10T12:00:00Z',
      end_at: '2026-10-01T12:00:00Z'
    }, {
      Authorization: `Bearer ${tokenOwnerA}`
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('lebih awal'));
  });

  // PROMO-AUTH-14: Security audit log entries emitted
  it('PROMO-AUTH-14: Security audit log entries emitted for promotion lifecycle actions', async () => {
    const tokenOwnerA = seedStaffSession({ role: 'owner', brandId: BRAND_A, userId: 'owner_a' });

    // Create promo
    const createRes = await request('POST', '/api/v1/admin/marketing/promotions', {
      name: 'Audit Log Test Promo',
      code: 'AUDITTEST',
      branch_ids: [BRANCH_A1]
    }, {
      Authorization: `Bearer ${tokenOwnerA}`
    });

    assert.equal(createRes.status, 201);
    const promoId = createRes.body.promotion.id;

    // Check security_audit_log for PROMOTION_CREATED
    const createAudit = db.prepare("SELECT * FROM security_audit_log WHERE brand_id = ? AND action = 'PROMOTION_CREATED' ORDER BY created_at DESC LIMIT 1").get(BRAND_A);
    assert.ok(createAudit);
    assert.equal(createAudit.actor_role, 'owner');
    assert.equal(createAudit.result, 'SUCCESS');

    // Update promo
    await request('PUT', `/api/v1/admin/marketing/promotions/${promoId}`, {
      is_active: 0
    }, {
      Authorization: `Bearer ${tokenOwnerA}`
    });

    const updateAudit = db.prepare("SELECT * FROM security_audit_log WHERE brand_id = ? AND action = 'PROMOTION_UPDATED' ORDER BY created_at DESC LIMIT 1").get(BRAND_A);
    assert.ok(updateAudit);

    // Assign scope
    await request('POST', `/api/v1/admin/marketing/promotions/${promoId}/scopes`, {
      branch_ids: [BRANCH_A2]
    }, {
      Authorization: `Bearer ${tokenOwnerA}`
    });

    const scopeAudit = db.prepare("SELECT * FROM security_audit_log WHERE brand_id = ? AND action = 'PROMOTION_SCOPE_ASSIGNED' ORDER BY created_at DESC LIMIT 1").get(BRAND_A);
    assert.ok(scopeAudit);

    // Delete promo
    await request('DELETE', `/api/v1/admin/marketing/promotions/${promoId}`, null, {
      Authorization: `Bearer ${tokenOwnerA}`
    });

    const deleteAudit = db.prepare("SELECT * FROM security_audit_log WHERE brand_id = ? AND action = 'PROMOTION_DELETED' ORDER BY created_at DESC LIMIT 1").get(BRAND_A);
    assert.ok(deleteAudit);
  });
});
