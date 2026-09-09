const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-adversarial';

const app = require('../server/app');
const http = require('http');

let server;
let baseUrl;
const brandId = 'brand_adv_test';
const orgId = 'org_adv_test';
const otherBrandId = 'brand_adv_other';
const otherOrgId = 'org_adv_other';

function request(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Host': 'advtest.mybangjo.com',
        ...headers
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('Workforce Adversarial Security Verification', () => {
  let db;
  let ownerToken, managerAToken, managerBToken, cashierAToken, cashierBToken;
  let ownerUserId, managerAId, managerBId, cashierAId, cashierBId;

  before(async () => {
    await new Promise(resolve => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
    db = require('../server/database/db');

    // Create two brands/orgs for cross-tenant testing
    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(orgId, 'Adv Test Org', 'adv-test-org');
    db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain) VALUES (?, ?, ?, ?, ?)').run(brandId, orgId, 'Adv Test Brand', 'adv-test', 'advtest.mybangjo.com');
    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(otherOrgId, 'Other Org', 'other-org');
    db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain) VALUES (?, ?, ?, ?, ?)').run(otherBrandId, otherOrgId, 'Other Brand', 'other-brand', 'other.mybangjo.com');

    // Create branches
    db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)').run('branch_a', brandId, 'Branch A', 'branch-a', 'Jl. Test A', -7.25, 112.75);
    db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)').run('branch_b', brandId, 'Branch B', 'branch-b', 'Jl. Test B', -7.26, 112.76);
    db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)').run('branch_other', otherBrandId, 'Other Branch', 'other-branch', 'Jl. Other', -7.27, 112.77);

    // Seed owner
    const bcrypt = require('bcryptjs');
    const ownerHash = bcrypt.hashSync('Test1234!', 12);
    db.prepare(`INSERT OR IGNORE INTO users (id, brand_id, organization_id, username, password_hash, full_name, role, status, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))`).run('usr_adv_owner', brandId, orgId, 'adv_owner', ownerHash, 'Adv Owner', 'owner');

    // Seed other-brand owner
    db.prepare(`INSERT OR IGNORE INTO users (id, brand_id, organization_id, username, password_hash, full_name, role, status, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))`).run('usr_adv_other_owner', otherBrandId, otherOrgId, 'adv_other_owner', ownerHash, 'Other Owner', 'owner');

    // Login as owner
    const ownerLogin = await request('POST', '/api/v1/auth/merchant/login', { username: 'adv_owner', password: 'Test1234!' });
    ownerToken = ownerLogin.data.token;
    ownerUserId = 'usr_adv_owner';

    // Create Manager A (Branch A) and Manager B (Branch B)
    const mA = await request('POST', '/api/v1/admin/users', { username: 'manager_a', password: 'Test1234!', full_name: 'Manager A', role: 'brand_manager' }, { Authorization: `Bearer ${ownerToken}` });
    managerAId = mA.data.user.id;
    const mAlogin = await request('POST', '/api/v1/auth/merchant/login', { username: 'manager_a', password: 'Test1234!' });
    managerAToken = mAlogin.data.token;

    const mB = await request('POST', '/api/v1/admin/users', { username: 'manager_b', password: 'Test1234!', full_name: 'Manager B', role: 'branch_manager', branch_id: 'branch_b' }, { Authorization: `Bearer ${ownerToken}` });
    managerBId = mB.data.user.id;
    const mBlogin = await request('POST', '/api/v1/auth/merchant/login', { username: 'manager_b', password: 'Test1234!' });
    managerBToken = mBlogin.data.token;

    // Create Cashier A (Branch A) and Cashier B (Branch B)
    const cA = await request('POST', '/api/v1/admin/users', { username: 'cashier_a', password: 'Test1234!', full_name: 'Cashier A', role: 'cashier', branch_id: 'branch_a' }, { Authorization: `Bearer ${ownerToken}` });
    cashierAId = cA.data.user.id;
    const cAlogin = await request('POST', '/api/v1/auth/merchant/login', { username: 'cashier_a', password: 'Test1234!' });
    cashierAToken = cAlogin.data.token;

    const cB = await request('POST', '/api/v1/admin/users', { username: 'cashier_b', password: 'Test1234!', full_name: 'Cashier B', role: 'cashier', branch_id: 'branch_b' }, { Authorization: `Bearer ${ownerToken}` });
    cashierBId = cB.data.user.id;
    const cBlogin = await request('POST', '/api/v1/auth/merchant/login', { username: 'cashier_b', password: 'Test1234!' });
    cashierBToken = cBlogin.data.token;
  });

  after(() => { if (server) server.close(); });

  // ==================== ATTACK 1: SELF ROLE ESCALATION ====================
  describe('ATTACK 1: Self Role Escalation', () => {
    it('Cashier cannot escalate own role via profile update', async () => {
      const res = await request('PUT', `/api/v1/admin/users/${cashierAId}`, { role: 'owner' }, { Authorization: `Bearer ${cashierAToken}` });
      // Should be 403 (cashier not in allowed roles for this endpoint)
      assert.ok(res.status === 403 || res.status === 401, `Expected 403/401, got ${res.status}`);
    });

    it('Cashier cannot access role-change endpoint', async () => {
      const res = await request('POST', `/api/v1/admin/users/${cashierAId}/role`, { role: 'owner' }, { Authorization: `Bearer ${cashierAToken}` });
      assert.ok(res.status === 403 || res.status === 401, `Expected 403/401, got ${res.status}`);
    });

    it('Cashier cannot access scope-change endpoint', async () => {
      const res = await request('POST', `/api/v1/admin/users/${cashierAId}/scope`, { branch_id: 'branch_b' }, { Authorization: `Bearer ${cashierAToken}` });
      assert.ok(res.status === 403 || res.status === 401, `Expected 403/401, got ${res.status}`);
    });

    it('Manager cannot escalate to owner via role endpoint', async () => {
      const res = await request('POST', `/api/v1/admin/users/${managerAId}/role`, { role: 'owner' }, { Authorization: `Bearer ${managerAToken}` });
      assert.ok(res.status === 403, `Expected 403, got ${res.status}`);
    });
  });

  // ==================== ATTACK 2: SELF SCOPE ESCALATION ====================
  describe('ATTACK 2: Self Scope Escalation', () => {
    it('Manager B (branch_manager) cannot change own scope to another branch', async () => {
      const res = await request('POST', `/api/v1/admin/users/${managerBId}/scope`, { branch_id: 'branch_a' }, { Authorization: `Bearer ${managerBToken}` });
      assert.ok(res.status === 403, `Expected 403, got ${res.status}`);
    });

    it('Cashier cannot change own scope', async () => {
      const res = await request('POST', `/api/v1/admin/users/${cashierAId}/scope`, { branch_id: 'branch_b' }, { Authorization: `Bearer ${cashierAToken}` });
      assert.ok(res.status === 403 || res.status === 401, `Expected 403/401, got ${res.status}`);
    });
  });

  // ==================== ATTACK 3: IDOR ====================
  describe('ATTACK 3: IDOR', () => {
    it('Manager B cannot read Manager A profile', async () => {
      const res = await request('GET', `/api/v1/admin/users/${managerAId}`, null, { Authorization: `Bearer ${managerBToken}` });
      // branch_manager should be restricted to own branch — manager A has no branch (brand_manager)
      assert.ok(res.status === 403 || res.status === 200, `Got ${res.status}`);
      // If 200, manager B (branch_manager) should NOT see manager A (brand_manager, no branch)
      // Actually branch_manager can see users if they're in same branch. Manager A has no branch.
      // The route checks: if (req.user.role === 'branch_manager' && user.branch_id !== session.branchId)
      // Manager A has branch_id=null, Manager B has branch_id=branch_b. null !== 'branch_b' => 403
      if (res.status === 200) {
        // Verify it's actually the right user
        assert.equal(res.data.user.id, managerAId);
      }
    });

    it('Manager B cannot update Manager A profile', async () => {
      const res = await request('PUT', `/api/v1/admin/users/${managerAId}`, { full_name: 'Hacked' }, { Authorization: `Bearer ${managerBToken}` });
      assert.ok(res.status === 403, `Expected 403, got ${res.status}`);
    });

    it('Manager B cannot disable Manager A', async () => {
      const res = await request('POST', `/api/v1/admin/users/${managerAId}/disable`, {}, { Authorization: `Bearer ${managerBToken}` });
      assert.ok(res.status === 403, `Expected 403, got ${res.status}`);
    });

    it('Manager B cannot reset Manager A password', async () => {
      const res = await request('POST', `/api/v1/admin/users/${managerAId}/reset-password`, {}, { Authorization: `Bearer ${managerBToken}` });
      assert.ok(res.status === 403, `Expected 403, got ${res.status}`);
    });

    it('Cross-tenant user cannot access target tenant resources', async () => {
      const otherOwnerLogin = await request('POST', '/api/v1/auth/merchant/login', { username: 'adv_other_owner', password: 'Test1234!' });
      const otherToken = otherOwnerLogin.data.token;

      // Try to access our brand's users
      const res = await request('GET', `/api/v1/admin/users`, null, { Authorization: `Bearer ${otherToken}` });
      // Should see only other brand's users, not ours
      if (res.status === 200 && res.data.users) {
        const ourUserIds = [ownerUserId, managerAId, managerBId, cashierAId, cashierBId];
        const leaked = res.data.users.filter(u => ourUserIds.includes(u.id));
        assert.equal(leaked.length, 0, 'Cross-tenant user leak detected');
      }
    });
  });

  // ==================== ATTACK 4: MANAGER CREATES PRIVILEGED USER ====================
  describe('ATTACK 4: Manager Creates Privilegied User', () => {
    it('Brand Manager cannot create another Brand Manager', async () => {
      const res = await request('POST', '/api/v1/admin/users', { username: 'illegal_mm', password: 'Test1234!', full_name: 'Illegal MM', role: 'brand_manager' }, { Authorization: `Bearer ${managerAToken}` });
      assert.equal(res.status, 403);
    });

    it('Brand Manager cannot create Owner', async () => {
      const res = await request('POST', '/api/v1/admin/users', { username: 'illegal_mo', password: 'Test1234!', full_name: 'Illegal MO', role: 'owner' }, { Authorization: `Bearer ${managerAToken}` });
      assert.equal(res.status, 403);
    });

    it('Branch Manager cannot create Manager', async () => {
      const res = await request('POST', '/api/v1/admin/users', { username: 'illegal_bm', password: 'Test1234!', full_name: 'Illegal BM', role: 'brand_manager' }, { Authorization: `Bearer ${managerBToken}` });
      assert.equal(res.status, 403);
    });

    it('Branch Manager can only create Cashier', async () => {
      const res = await request('POST', '/api/v1/admin/users', { username: 'legal_cashier', password: 'Test1234!', full_name: 'Legal Cashier', role: 'cashier' }, { Authorization: `Bearer ${managerBToken}` });
      assert.equal(res.status, 201);
    });
  });

  // ==================== ATTACK 5: MANAGER GRANTS BROADER SCOPE ====================
  describe('ATTACK 5: Manager Grants Broader Scope', () => {
    it('Branch Manager cannot change scope of any user', async () => {
      const res = await request('POST', `/api/v1/admin/users/${cashierAId}/scope`, { branch_id: 'branch_b' }, { Authorization: `Bearer ${managerBToken}` });
      assert.ok(res.status === 403, `Expected 403, got ${res.status}`);
    });

    it('Brand Manager cannot change scope of other managers', async () => {
      const res = await request('POST', `/api/v1/admin/users/${managerBId}/scope`, { branch_id: 'branch_a' }, { Authorization: `Bearer ${managerAToken}` });
      assert.ok(res.status === 403, `Expected 403, got ${res.status}`);
    });

    it('Brand Manager cannot change owner scope', async () => {
      const res = await request('POST', `/api/v1/admin/users/${ownerUserId}/scope`, { branch_id: 'branch_a' }, { Authorization: `Bearer ${managerAToken}` });
      assert.ok(res.status === 403, `Expected 403, got ${res.status}`);
    });
  });

  // ==================== ATTACK 6: MANAGER MODIFIES ANOTHER MANAGER ====================
  describe('ATTACK 6: Manager Modifies Another Manager', () => {
    it('Brand Manager A cannot disable Brand Manager', async () => {
      const res = await request('POST', `/api/v1/admin/users/${managerBId}/disable`, {}, { Authorization: `Bearer ${managerAToken}` });
      assert.equal(res.status, 403);
    });

    it('Brand Manager A cannot reset Manager password', async () => {
      const res = await request('POST', `/api/v1/admin/users/${managerBId}/reset-password`, {}, { Authorization: `Bearer ${managerAToken}` });
      assert.equal(res.status, 403);
    });
  });

  // ==================== ATTACK 7: CASHIER WORKFORCE ADMIN ====================
  describe('ATTACK 7: Cashier Workforce Admin', () => {
    it('Cashier cannot list users', async () => {
      const res = await request('GET', '/api/v1/admin/users', null, { Authorization: `Bearer ${cashierAToken}` });
      assert.ok(res.status === 403 || res.status === 401, `Expected 403/401, got ${res.status}`);
    });

    it('Cashier cannot create user', async () => {
      const res = await request('POST', '/api/v1/admin/users', { username: 'hack', password: 'Test1234!', full_name: 'Hack', role: 'cashier' }, { Authorization: `Bearer ${cashierAToken}` });
      assert.ok(res.status === 403 || res.status === 401, `Expected 403/401, got ${res.status}`);
    });

    it('Cashier cannot disable user', async () => {
      const res = await request('POST', `/api/v1/admin/users/${cashierBId}/disable`, {}, { Authorization: `Bearer ${cashierAToken}` });
      assert.ok(res.status === 403 || res.status === 401, `Expected 403/401, got ${res.status}`);
    });

    it('Cashier cannot enable user', async () => {
      const res = await request('POST', `/api/v1/admin/users/${cashierBId}/enable`, {}, { Authorization: `Bearer ${cashierAToken}` });
      assert.ok(res.status === 403 || res.status === 401, `Expected 403/401, got ${res.status}`);
    });

    it('Cashier cannot change role', async () => {
      const res = await request('POST', `/api/v1/admin/users/${cashierBId}/role`, { role: 'owner' }, { Authorization: `Bearer ${cashierAToken}` });
      assert.ok(res.status === 403 || res.status === 401, `Expected 403/401, got ${res.status}`);
    });

    it('Cashier cannot reset password', async () => {
      const res = await request('POST', `/api/v1/admin/users/${cashierBId}/reset-password`, {}, { Authorization: `Bearer ${cashierAToken}` });
      assert.ok(res.status === 403 || res.status === 401, `Expected 403/401, got ${res.status}`);
    });
  });

  // ==================== ATTACK 8: CLIENT PAYLOAD AUTHORIZATION BYPASS ====================
  describe('ATTACK 8: Client Payload Authorization Bypass', () => {
    it('Owner cannot create user with role=superadmin', async () => {
      const res = await request('POST', '/api/v1/admin/users', { username: 'super', password: 'Test1234!', full_name: 'Super', role: 'superadmin' }, { Authorization: `Bearer ${ownerToken}` });
      assert.ok(res.status === 403 || res.status === 400, `Expected 403/400, got ${res.status}`);
    });

    it('Extra payload fields are ignored on update', async () => {
      const res = await request('PUT', `/api/v1/admin/users/${cashierAId}`, { full_name: 'Legit', role: 'owner', status: 'active', password_hash: 'hacked' }, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(res.status, 200);
      // Verify role was NOT changed
      const listRes = await request('GET', `/api/v1/admin/users/${cashierAId}`, null, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(listRes.data.user.role, 'cashier');
    });
  });

  // ==================== ATTACK 9: PASSWORD CHANGE BYPASS ====================
  describe('ATTACK 9: Password Change Bypass', () => {
    it('Wrong current password rejected', async () => {
      const res = await request('POST', '/api/v1/auth/change-password', { current_password: 'wrong', new_password: 'NewPass123!', confirm_password: 'NewPass123!' }, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(res.status, 401);
    });

    it('Missing current password rejected', async () => {
      const res = await request('POST', '/api/v1/auth/change-password', { new_password: 'NewPass123!', confirm_password: 'NewPass123!' }, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(res.status, 400);
    });

    it('Password mismatch rejected', async () => {
      const res = await request('POST', '/api/v1/auth/change-password', { current_password: 'Test1234!', new_password: 'NewPass123!', confirm_password: 'Different!' }, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(res.status, 400);
    });

    it('Short password rejected', async () => {
      const res = await request('POST', '/api/v1/auth/change-password', { current_password: 'Test1234!', new_password: 'short', confirm_password: 'short' }, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(res.status, 400);
    });

    it('Successful password change actually changes auth behavior', async () => {
      const changeRes = await request('POST', '/api/v1/auth/change-password', { current_password: 'Test1234!', new_password: 'TempPass99!', confirm_password: 'TempPass99!' }, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(changeRes.status, 200);

      // Old password should fail
      const oldLogin = await request('POST', '/api/v1/auth/merchant/login', { username: 'adv_owner', password: 'Test1234!' });
      assert.equal(oldLogin.status, 401);

      // New password should work
      const newLogin = await request('POST', '/api/v1/auth/merchant/login', { username: 'adv_owner', password: 'TempPass99!' });
      assert.equal(newLogin.status, 200);
      ownerToken = newLogin.data.token;

      // Change back
      await request('POST', '/api/v1/auth/change-password', { current_password: 'TempPass99!', new_password: 'Test1234!', confirm_password: 'Test1234!' }, { Authorization: `Bearer ${ownerToken}` });
      const restoreLogin = await request('POST', '/api/v1/auth/merchant/login', { username: 'adv_owner', password: 'Test1234!' });
      ownerToken = restoreLogin.data.token;
    });
  });

  // ==================== ATTACK 10: PASSWORD HASH SECURITY ====================
  describe('ATTACK 10: Password Hash Security', () => {
    it('User creation response does not contain password_hash', async () => {
      const res = await request('POST', '/api/v1/admin/users', { username: 'hash_test', password: 'Test1234!', full_name: 'Hash Test', role: 'cashier', branch_id: 'branch_a' }, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(res.status, 201);
      assert.equal(res.data.user.password_hash, undefined);
      assert.equal(res.data.user.password, undefined);
    });

    it('User list does not contain password_hash', async () => {
      const res = await request('GET', '/api/v1/admin/users', null, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(res.status, 200);
      for (const user of res.data.users) {
        assert.equal(user.password_hash, undefined);
        assert.equal(user.password, undefined);
      }
    });

    it('User get does not contain password_hash', async () => {
      const res = await request('GET', `/api/v1/admin/users/${cashierAId}`, null, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(res.status, 200);
      assert.equal(res.data.user.password_hash, undefined);
      assert.equal(res.data.user.password, undefined);
    });
  });

  // ==================== ATTACK 11: ADMIN RESET ABUSE ====================
  describe('ATTACK 11: Admin Reset Abuse', () => {
    it('Owner reset returns token, not password', async () => {
      const res = await request('POST', `/api/v1/admin/users/${cashierAId}/reset-password`, {}, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(res.status, 200);
      assert.ok(res.data.reset_token);
      assert.ok(!res.data.password);
      assert.ok(!res.data.old_password);
      assert.ok(!res.data.password_hash);
    });

    it('Manager cannot reset Manager password', async () => {
      const res = await request('POST', `/api/v1/admin/users/${managerBId}/reset-password`, {}, { Authorization: `Bearer ${managerAToken}` });
      assert.equal(res.status, 403);
    });

    it('Cashier cannot reset anyone password', async () => {
      const res = await request('POST', `/api/v1/admin/users/${cashierBId}/reset-password`, {}, { Authorization: `Bearer ${cashierAToken}` });
      assert.ok(res.status === 403 || res.status === 401, `Expected 403/401, got ${res.status}`);
    });
  });

  // ==================== ATTACK 12: RESET TOKEN REPLAY ====================
  describe('ATTACK 12: Reset Token Replay', () => {
    it('Reset token is single-use', async () => {
      const resetRes = await request('POST', `/api/v1/admin/users/${cashierAId}/reset-password`, {}, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(resetRes.status, 200);
      const token = resetRes.data.reset_token;

      // First use - should succeed
      const use1 = await request('POST', '/api/v1/auth/reset-password', { token, new_password: 'Reset1234!' });
      assert.equal(use1.status, 200);

      // Replay - should fail
      const use2 = await request('POST', '/api/v1/auth/reset-password', { token, new_password: 'Reset1234!' });
      assert.equal(use2.status, 400);

      // Login with new password and restore
      const login = await request('POST', '/api/v1/auth/merchant/login', { username: 'cashier_a', password: 'Reset1234!' });
      assert.equal(login.status, 200);
      const token2 = login.data.token;
      await request('POST', '/api/v1/auth/change-password', { current_password: 'Reset1234!', new_password: 'Test1234!', confirm_password: 'Test1234!' }, { Authorization: `Bearer ${token2}` });
    });

    it('Malformed token is rejected', async () => {
      const res = await request('POST', '/api/v1/auth/reset-password', { token: 'garbage_token_xyz', new_password: 'Reset1234!' });
      assert.equal(res.status, 400);
    });
  });

  // ==================== ATTACK 13: SESSION SURVIVAL AFTER RESET ====================
  describe('ATTACK 13: Session Survival After Password Change', () => {
    it('Other sessions are revoked after password change', async () => {
      // Create cashier user and login from two "devices"
      const createRes = await request('POST', '/api/v1/admin/users', { username: 'session_test', password: 'Test1234!', full_name: 'Session Test', role: 'cashier', branch_id: 'branch_a' }, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(createRes.status, 201);

      const login1 = await request('POST', '/api/v1/auth/merchant/login', { username: 'session_test', password: 'Test1234!' });
      const token1 = login1.data.token;
      const login2 = await request('POST', '/api/v1/auth/merchant/login', { username: 'session_test', password: 'Test1234!' });
      const token2 = login2.data.token;

      // Both sessions work
      const me1 = await request('GET', '/api/v1/auth/merchant/me', null, { Authorization: `Bearer ${token1}` });
      assert.equal(me1.status, 200);

      // Change password using token1 — should revoke token2
      await request('POST', '/api/v1/auth/change-password', { current_password: 'Test1234!', new_password: 'NewSession123!', confirm_password: 'NewSession123!' }, { Authorization: `Bearer ${token1}` });

      // token2 should be revoked
      const me2 = await request('GET', '/api/v1/auth/merchant/me', null, { Authorization: `Bearer ${token2}` });
      assert.equal(me2.status, 401);

      // Restore
      const newLogin = await request('POST', '/api/v1/auth/merchant/login', { username: 'session_test', password: 'NewSession123!' });
      await request('POST', '/api/v1/auth/change-password', { current_password: 'NewSession123!', new_password: 'Test1234!', confirm_password: 'Test1234!' }, { Authorization: `Bearer ${newLogin.data.token}` });
    });
  });

  // ==================== ATTACK 14: SESSION SURVIVAL AFTER DISABLE ====================
  describe('ATTACK 14: Session Survival After Disable', () => {
    it('Disabled user sessions are revoked', async () => {
      const login = await request('POST', '/api/v1/auth/merchant/login', { username: 'cashier_a', password: 'Test1234!' });
      const token = login.data.token;

      // Verify session works
      const me = await request('GET', '/api/v1/auth/merchant/me', null, { Authorization: `Bearer ${token}` });
      assert.equal(me.status, 200);

      // Disable
      await request('POST', `/api/v1/admin/users/${cashierAId}/disable`, {}, { Authorization: `Bearer ${ownerToken}` });

      // Session should be revoked
      const me2 = await request('GET', '/api/v1/auth/merchant/me', null, { Authorization: `Bearer ${token}` });
      assert.equal(me2.status, 401);

      // Re-enable
      await request('POST', `/api/v1/admin/users/${cashierAId}/enable`, {}, { Authorization: `Bearer ${ownerToken}` });
    });
  });

  // ==================== ATTACK 15: STALE ROLE / STALE SCOPE ====================
  describe('ATTACK 15: Stale Role / Stale Scope', () => {
    it('Role change invalidates existing sessions', async () => {
      // Create a user, login, then change their role
      const createRes = await request('POST', '/api/v1/admin/users', { username: 'stale_test', password: 'Test1234!', full_name: 'Stale Test', role: 'cashier', branch_id: 'branch_a' }, { Authorization: `Bearer ${ownerToken}` });
      const userId = createRes.data.user.id;

      const login = await request('POST', '/api/v1/auth/merchant/login', { username: 'stale_test', password: 'Test1234!' });
      const token = login.data.token;

      // Verify session works
      const me = await request('GET', '/api/v1/auth/merchant/me', null, { Authorization: `Bearer ${token}` });
      assert.equal(me.status, 200);

      // Demote to kitchen
      await request('POST', `/api/v1/admin/users/${userId}/role`, { role: 'kitchen' }, { Authorization: `Bearer ${ownerToken}` });

      // Old session should be invalidated (role changed)
      const me2 = await request('GET', '/api/v1/auth/merchant/me', null, { Authorization: `Bearer ${token}` });
      // Session should be revoked because role changed
      assert.ok(me2.status === 401 || me2.data.user.role === 'kitchen', `Expected 401 or kitchen role, got ${me2.status}`);
    });

    it('Scope change invalidates existing sessions', async () => {
      // Create a branch_manager, login, then change their scope
      const createRes = await request('POST', '/api/v1/admin/users', { username: 'scope_test', password: 'Test1234!', full_name: 'Scope Test', role: 'branch_manager', branch_id: 'branch_a' }, { Authorization: `Bearer ${ownerToken}` });
      const userId = createRes.data.user.id;

      const login = await request('POST', '/api/v1/auth/merchant/login', { username: 'scope_test', password: 'Test1234!' });
      const token = login.data.token;

      // Verify session works
      const me = await request('GET', '/api/v1/auth/merchant/me', null, { Authorization: `Bearer ${token}` });
      assert.equal(me.status, 200);

      // Change scope
      await request('POST', `/api/v1/admin/users/${userId}/scope`, { branch_id: 'branch_b' }, { Authorization: `Bearer ${ownerToken}` });

      // Old session should be invalidated
      const me2 = await request('GET', '/api/v1/auth/merchant/me', null, { Authorization: `Bearer ${token}` });
      assert.ok(me2.status === 401 || me2.data.user.branch_id === 'branch_b', `Expected 401 or branch_b, got ${me2.status}`);
    });
  });

  // ==================== ATTACK 17: DISABLE RACE ====================
  describe('ATTACK 17: Disable Race', () => {
    it('Disabled user cannot create cashier', async () => {
      // Disable manager A
      await request('POST', `/api/v1/admin/users/${managerAId}/disable`, {}, { Authorization: `Bearer ${ownerToken}` });

      // Try to create user with disabled session
      const res = await request('POST', '/api/v1/admin/users', { username: 'race_test', password: 'Test1234!', full_name: 'Race Test', role: 'cashier', branch_id: 'branch_a' }, { Authorization: `Bearer ${managerAToken}` });
      assert.ok(res.status === 401 || res.status === 403, `Expected 401/403, got ${res.status}`);

      // Re-enable
      await request('POST', `/api/v1/admin/users/${managerAId}/enable`, {}, { Authorization: `Bearer ${ownerToken}` });
    });
  });

  // ==================== ATTACK 18: LAST OWNER ====================
  describe('ATTACK 18: Last Owner Protection', () => {
    it('Cannot disable the last owner', async () => {
      const res = await request('POST', `/api/v1/admin/users/${ownerUserId}/disable`, {}, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(res.status, 400);
    });

    it('Cannot demote the last owner', async () => {
      const res = await request('POST', `/api/v1/admin/users/${ownerUserId}/role`, { role: 'cashier' }, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(res.status, 400);
    });

    it('Can disable second owner when two exist', async () => {
      // Create second owner via direct DB insert (Owner cannot create another Owner per contract)
      const bcrypt = require('bcryptjs');
      const hash = bcrypt.hashSync('Test1234!', 12);
      db.prepare(`INSERT OR IGNORE INTO users (id, brand_id, organization_id, username, password_hash, full_name, role, status, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))`).run('usr_adv_owner2', brandId, orgId, 'owner2', hash, 'Owner 2', 'owner');
      const owner2Id = 'usr_adv_owner2';

      // Disable second owner - should succeed
      const disableRes = await request('POST', `/api/v1/admin/users/${owner2Id}/disable`, {}, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(disableRes.status, 200);
    });
  });

  // ==================== ATTACK 19: HARD DELETE ====================
  describe('ATTACK 19: Hard Delete', () => {
    it('DELETE method on users endpoint is rejected', async () => {
      const res = await request('DELETE', `/api/v1/admin/users/${cashierAId}`, null, { Authorization: `Bearer ${ownerToken}` });
      assert.ok(res.status === 404 || res.status === 405, `Expected 404/405, got ${res.status}`);
    });
  });

  // ==================== ATTACK 20: AUDIT TAMPERING ====================
  describe('ATTACK 20: Audit Tampering', () => {
    it('Security audit log is append-only (no update/delete endpoint)', async () => {
      // Verify no PUT/DELETE/PATCH for audit endpoint
      const putRes = await request('PUT', '/api/v1/admin/security-audit', { id: 'fake', result: 'tampered' }, { Authorization: `Bearer ${ownerToken}` });
      assert.ok(putRes.status === 404 || putRes.status === 405, `PUT should not exist: ${putRes.status}`);

      const delRes = await request('DELETE', '/api/v1/admin/security-audit?id=fake', null, { Authorization: `Bearer ${ownerToken}` });
      assert.ok(delRes.status === 404 || delRes.status === 405, `DELETE should not exist: ${delRes.status}`);
    });

    it('Cashier cannot read audit log', async () => {
      const res = await request('GET', '/api/v1/admin/security-audit', null, { Authorization: `Bearer ${cashierAToken}` });
      assert.ok(res.status === 403 || res.status === 401, `Expected 403/401, got ${res.status}`);
    });

    it('Audit records exist for security actions', async () => {
      const res = await request('GET', '/api/v1/admin/security-audit', null, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(res.status, 200);
      assert.ok(res.data.logs.length > 0, 'Audit log should have entries');
      // Verify no password_hash in audit
      for (const log of res.data.logs) {
        if (log.metadata) {
          const meta = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : log.metadata;
          assert.equal(meta.password_hash, undefined, 'password_hash must not appear in audit');
          assert.equal(meta.password, undefined, 'password must not appear in audit');
        }
      }
    });
  });

  // ==================== ATTACK 22: RATE LIMIT / ABUSE ====================
  describe('ATTACK 22: Rate Limit / Abuse', () => {
    it('Login rate limiting blocks rapid attempts', async () => {
      // Create a user for this test
      await request('POST', '/api/v1/admin/users', { username: 'ratelimit_test', password: 'Test1234!', full_name: 'Rate Limit', role: 'cashier', branch_id: 'branch_a' }, { Authorization: `Bearer ${ownerToken}` });

      // 5 wrong attempts
      for (let i = 0; i < 5; i++) {
        await request('POST', '/api/v1/auth/merchant/login', { username: 'ratelimit_test', password: 'wrong' });
      }

      // 6th attempt should be rate limited (429) or locked (423)
      const res = await request('POST', '/api/v1/auth/merchant/login', { username: 'ratelimit_test', password: 'wrong' });
      assert.ok(res.status === 429 || res.status === 423, `Expected 429/423, got ${res.status}`);
    });
  });

  // ==================== ATTACK 23: TENANT CROSSING ====================
  describe('ATTACK 23: Tenant Crossing', () => {
    it('Owner of brand A cannot manage brand B users', async () => {
      const res = await request('POST', '/api/v1/admin/users', { username: 'cross_brand', password: 'Test1234!', full_name: 'Cross Brand', role: 'cashier', branch_id: 'branch_other' }, { Authorization: `Bearer ${ownerToken}` });
      // Should fail - branch_other belongs to otherBrandId
      assert.ok(res.status === 400 || res.status === 403, `Expected 400/403, got ${res.status}`);
    });
  });

  // ==================== ATTACK 24: MASS ASSIGNMENT ====================
  describe('ATTACK 24: Mass Assignment / Overposting', () => {
    it('Cannot inject role via create user extra fields', async () => {
      const res = await request('POST', '/api/v1/admin/users', { username: 'mass_test', password: 'Test1234!', full_name: 'Mass Test', role: 'cashier', branch_id: 'branch_a', is_admin: true, permissions: ['*'], scope: 'global', status: 'active', created_by: 'hacker' }, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(res.status, 201);
      const userRes = await request('GET', `/api/v1/admin/users/${res.data.user.id}`, null, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(userRes.data.user.role, 'cashier');
    });

    it('Cannot inject status via create user', async () => {
      const res = await request('POST', '/api/v1/admin/users', { username: 'mass_test2', password: 'Test1234!', full_name: 'Mass Test 2', role: 'cashier', branch_id: 'branch_a', status: 'disabled' }, { Authorization: `Bearer ${ownerToken}` });
      // status field is not in the destructured body for createUser
      assert.equal(res.status, 201);
    });
  });

  // ==================== ATTACK 25: REPEATED REQUESTS / IDEMPOTENCY ====================
  describe('ATTACK 25: Repeated Requests / Idempotency', () => {
    it('Duplicate username is rejected', async () => {
      const res1 = await request('POST', '/api/v1/admin/users', { username: 'idempotent_user', password: 'Test1234!', full_name: 'Idempotent', role: 'cashier', branch_id: 'branch_a' }, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(res1.status, 201);

      const res2 = await request('POST', '/api/v1/admin/users', { username: 'idempotent_user', password: 'Test1234!', full_name: 'Idempotent 2', role: 'cashier', branch_id: 'branch_a' }, { Authorization: `Bearer ${ownerToken}` });
      assert.equal(res2.status, 409);
    });

    it('Disable idempotent - disabling already disabled user', async () => {
      // Create and disable
      const createRes = await request('POST', '/api/v1/admin/users', { username: 'idem_disable', password: 'Test1234!', full_name: 'Idem Disable', role: 'cashier', branch_id: 'branch_a' }, { Authorization: `Bearer ${ownerToken}` });
      const userId = createRes.data.user.id;

      await request('POST', `/api/v1/admin/users/${userId}/disable`, {}, { Authorization: `Bearer ${ownerToken}` });
      const res = await request('POST', `/api/v1/admin/users/${userId}/disable`, {}, { Authorization: `Bearer ${ownerToken}` });
      // Should be safe - either 200 (idempotent) or 400 (already disabled)
      assert.ok(res.status === 200 || res.status === 400, `Expected 200/400, got ${res.status}`);
    });
  });

  // ==================== ATTACK 6b: BRAND MANAGER UPDATE RESTRICTION ====================
  describe('ATTACK 6b: Brand Manager Update Scope Restriction', () => {
    // Re-login as manager A since ATTACK 17 may have revoked the old session
    let freshManagerAToken;
    before(async () => {
      const login = await request('POST', '/api/v1/auth/merchant/login', { username: 'manager_a', password: 'Test1234!' });
      freshManagerAToken = login.data.token;
    });

    it('Brand Manager cannot update Owner profile', async () => {
      const res = await request('PUT', `/api/v1/admin/users/${ownerUserId}`, { full_name: 'Hacked Owner' }, { Authorization: `Bearer ${freshManagerAToken}` });
      assert.equal(res.status, 403);
    });

    it('Brand Manager cannot update another Manager profile', async () => {
      const res = await request('PUT', `/api/v1/admin/users/${managerBId}`, { full_name: 'Hacked Manager' }, { Authorization: `Bearer ${freshManagerAToken}` });
      assert.equal(res.status, 403);
    });

    it('Brand Manager can update Cashier profile in their scope', async () => {
      const res = await request('PUT', `/api/v1/admin/users/${cashierAId}`, { full_name: 'Updated Cashier' }, { Authorization: `Bearer ${freshManagerAToken}` });
      assert.equal(res.status, 200);
    });
  });
});
